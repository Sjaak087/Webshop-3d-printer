const admin = require("firebase-admin");
const { onValueCreated } = require("firebase-functions/v2/database");
const { logger } = require("firebase-functions");

admin.initializeApp({ databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app" });

const DATABASE_INSTANCE = "webshop-3cf70-default-rtdb";
const DATABASE_REGION = "europe-west1";
const OFFLINE_TTL_SECONDS = 60 * 60 * 24 * 28; // FCM Web Push: maximaal 28 dagen bewaren.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function tokenList(snapshot) {
  const raw = snapshot.val() || {};
  return Object.entries(raw)
    .map(([key, value]) => ({ key, token: typeof value === "string" ? value : value?.token }))
    .filter(item => typeof item.token === "string" && item.token.length > 20);
}

function detectSender(message, chat) {
  const candidates = [message.sender, message.senderRole, message.role, message.fromRole]
    .map(value => String(value || "").trim().toLowerCase())
    .filter(Boolean);
  if (candidates.some(value => ["system", "systeem", "bot"].includes(value))) return "system";
  if (candidates.some(value => ["admin", "sitebeheer", "beheerder", "owner", "staff", "support"].includes(value))) return "admin";
  if (candidates.some(value => ["user", "customer", "klant", "client", "buyer"].includes(value))) return "customer";

  const uid = String(message.uid || message.userId || message.senderId || "");
  if (uid === "admin" || message.isAdmin === true) return "admin";
  const chatUserId = String(chat.userId || chat.customerId || "");
  if (uid && chatUserId && uid === chatUserId) return "customer";
  return null;
}

function tokenRootFor(sender, chat) {
  if (sender === "admin") {
    const customerId = String(chat.userId || chat.customerId || "").trim();
    return customerId ? `notificationTokens/customers/${customerId}` : null;
  }
  return "notificationTokens/admins/sitebeheer";
}

function preferencePathFor(sender, chatId, chat) {
  if (sender === "admin") {
    const customerId = String(chat.userId || chat.customerId || "").trim();
    return customerId ? `chatNotificationPreferences/${chatId}/customers/${customerId}` : null;
  }
  return `chatNotificationPreferences/${chatId}/admins/sitebeheer`;
}

function readMarkerPathFor(sender, chatId, chat) {
  if (sender === "admin") {
    const customerId = String(chat.userId || chat.customerId || "").trim();
    return customerId ? `chats/${chatId}/readBy/customers/${customerId}` : null;
  }
  return `chats/${chatId}/readBy/admins/sitebeheer`;
}

async function sendToTokens(tokens, data, tokenRoot) {
  let sent = 0;
  const staleKeys = [];
  let transientFailure = false;
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await admin.messaging().sendEachForMulticast({
      tokens: batch.map(item => item.token),
      data,
      webpush: {
        headers: {
          TTL: String(OFFLINE_TTL_SECONDS),
          Urgency: "high"
        }
      }
    });
    sent += result.successCount;
    result.responses.forEach((response, index) => {
      const code = response.error?.code || "";
      if (!response.success && (
        code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
      )) staleKeys.push(batch[index].key);
      else if (!response.success) transientFailure = true;
    });
  }

  if (staleKeys.length) {
    await Promise.all(staleKeys.map(key => admin.database().ref(`${tokenRoot}/${key}`).remove()));
  }
  if (transientFailure) throw new Error("Een of meer FCM-pushmeldingen konden tijdelijk niet worden verzonden.");
  return sent;
}

exports.sendChatPush = onValueCreated({
  ref: "/chats/{chatId}/messages/{messageId}",
  instance: DATABASE_INSTANCE,
  region: DATABASE_REGION,
  retry: true
}, async event => {
  const message = event.data.val();
  const { chatId, messageId } = event.params;
  if (!message) return;

  const database = admin.database();
  const chatSnapshot = await database.ref(`chats/${chatId}`).get();
  const chat = chatSnapshot.val();
  if (!chat) return;

  const sender = detectSender(message, chat);
  if (!sender || sender === "system") {
    logger.info("Chat push ignored: sender is not a customer/admin message", { chatId, messageId, sender: message.sender || null });
    return;
  }

  const tokenRoot = tokenRootFor(sender, chat);
  const readMarkerPath = readMarkerPathFor(sender, chatId, chat);
  const preferencePath = preferencePathFor(sender, chatId, chat);
  if (!tokenRoot || !readMarkerPath || !preferencePath) {
    logger.warn("Chat push has no recipient mapping", { chatId, messageId, sender, chatUserId: chat.userId || null });
    return;
  }

  // Stuur alleen een push als de ontvanger meldingen voor juist deze chat heeft aangezet.
  const preferenceSnapshot = await database.ref(preferencePath).get();
  if (preferenceSnapshot.val()?.enabled !== true) {
    logger.info("Chat push skipped: notifications are disabled for this chat", { chatId, messageId, sender, preferencePath });
    return;
  }

  // Geef de open chat tijd om de leesbevestiging naar Realtime Database te schrijven.
  // Zo krijgt iemand die het bericht al zichtbaar heeft gelezen geen onnodige push.
  await sleep(1800);
  const readSnapshot = await database.ref(`${readMarkerPath}/${messageId}`).get();
  if (readSnapshot.val() === true) {
    logger.info("Chat push skipped: recipient already read message", { chatId, messageId, sender });
    return;
  }

  const snapshot = await database.ref(tokenRoot).get();
  const tokens = tokenList(snapshot);
  if (!tokens.length) {
    logger.info("No FCM recipients registered", { chatId, messageId, sender, tokenRoot });
    return;
  }

  // Idempotency marker avoids duplicate sends when the event is retried.
  const marker = database.ref(`chatPushProcessed/${chatId}/${messageId}`);
  const claim = await marker.transaction(current => current ? undefined : { claimedAt: Date.now() }, undefined, false);
  if (!claim.committed) return;

  const customerId = String(chat.userId || chat.customerId || "");
  const targetRole = sender === "admin" ? "customer" : "admin";
  const title = sender === "admin"
    ? "Nieuw bericht van 3D Printed Shop"
    : `Nieuw bericht van ${String(chat.username || "een klant").slice(0, 60)}`;

  // Geen privé-chattekst in de systeemmelding. Alle FCM datawaarden zijn strings.
  const data = {
    type: "chat-message",
    chatId: String(chatId),
    messageId: String(messageId),
    createdAt: String(Number(message.createdAt) || Date.now()),
    targetRole,
    targetUserId: targetRole === "customer" ? customerId : "sitebeheer",
    title,
    body: message.imageData ? "Je hebt een nieuw bericht of een foto ontvangen." : "Je hebt een nieuw bericht ontvangen."
  };

  try {
    const sent = await sendToTokens(tokens, data, tokenRoot);
    logger.info("Chat push sent", { chatId, messageId, sender, targetRole, sent });
  } catch (error) {
    await marker.remove().catch(() => {});
    logger.error("Chat push failed", { chatId, messageId, sender, error });
    throw error;
  }
});
