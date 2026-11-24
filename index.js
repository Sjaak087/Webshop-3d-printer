const admin = require("firebase-admin");
const { onValueCreated } = require("firebase-functions/v2/database");
const { logger } = require("firebase-functions");

admin.initializeApp({ databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app" });

const DATABASE_INSTANCE = "webshop-3cf70-default-rtdb";
const DATABASE_REGION = "europe-west1";

function tokenList(snapshot) {
  const raw = snapshot.val() || {};
  return Object.entries(raw)
    .map(([key, value]) => ({ key, token: typeof value === "string" ? value : value?.token }))
    .filter(item => typeof item.token === "string" && item.token.length > 20);
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
      webpush: { headers: { TTL: "3600" } }
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
  if (!message || !["admin", "user"].includes(message.sender)) return;

  const chatSnapshot = await admin.database().ref(`chats/${chatId}`).get();
  const chat = chatSnapshot.val();
  if (!chat) return;

  let tokenRoot;
  let title;
  if (message.sender === "admin") {
    if (!chat.userId) return;
    tokenRoot = `notificationTokens/customers/${chat.userId}`;
    title = "Nieuw bericht van 3D Printed Shop";
  } else {
    tokenRoot = "notificationTokens/admins/sitebeheer";
    title = `Nieuw bericht van ${String(chat.username || "een klant").slice(0, 60)}`;
  }

  // Idempotency marker avoids duplicate sends when an event is retried.
  const marker = admin.database().ref(`chatPushProcessed/${chatId}/${messageId}`);
  const claim = await marker.transaction(current => current ? undefined : { claimedAt: Date.now() }, undefined, false);
  if (!claim.committed) return;

  try {
    const snapshot = await admin.database().ref(tokenRoot).get();
    const tokens = tokenList(snapshot);
    if (!tokens.length) {
      logger.info("No FCM recipients registered", { chatId, sender: message.sender });
      return;
    }

    // Do not include chat text in OS notifications, to avoid exposing private messages on a locked screen.
    const data = {
      type: "chat-message",
      chatId: String(chatId),
      messageId: String(messageId),
      title,
      targetRole: message.sender === "admin" ? "customer" : "admin",
      body: message.imageData ? "Je hebt een nieuw bericht of een foto ontvangen." : "Je hebt een nieuw bericht ontvangen."
    };
    const sent = await sendToTokens(tokens, data, tokenRoot);
    logger.info("Chat push sent", { chatId, sender: message.sender, sent });
  } catch (error) {
    await marker.remove().catch(() => {});
    logger.error("Chat push failed", { chatId, messageId, error });
    throw error;
  }
});
