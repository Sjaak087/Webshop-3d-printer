import { app, db } from "./firebase.js";
import { FCM_VAPID_KEY } from "./push-config.js";
import { ref, set, get, remove } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getMessaging, getToken, isSupported, onMessage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";

let foregroundListenerInstalled = false;

function tokenKey(token) {
  // Stable non-secret RTDB child key. The actual FCM token remains stored as the value.
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function targetPath(role, userId, token) {
  const key = tokenKey(token);
  if (role === "admin") return `notificationTokens/admins/sitebeheer/${key}`;
  if (!userId) throw new Error("Je moet ingelogd zijn om chatmeldingen in te schakelen.");
  return `notificationTokens/customers/${userId}/${key}`;
}


function preferencePath(role, userId, chatId) {
  if (!chatId) throw new Error("De chat ontbreekt voor deze meldingsinstelling.");
  if (role === "admin") return `chatNotificationPreferences/${chatId}/admins/sitebeheer`;
  if (!userId) throw new Error("Je moet ingelogd zijn om meldingen voor deze chat op te slaan.");
  return `chatNotificationPreferences/${chatId}/customers/${userId}`;
}

export async function getChatPushPreference({ role, userId = null, chatId } = {}) {
  const snapshot = await get(ref(db, preferencePath(role, userId, chatId)));
  return snapshot.val()?.enabled === true;
}

export async function disableChatPushForChat({ role, userId = null, chatId } = {}) {
  await set(ref(db, preferencePath(role, userId, chatId)), {
    enabled: false,
    updatedAt: Date.now()
  });
  return true;
}

function assertPushSetup() {
  if (!("Notification" in window)) throw new Error("Deze browser ondersteunt geen browsermeldingen.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Deze browser ondersteunt geen pushmeldingen.");
  if (!FCM_VAPID_KEY || FCM_VAPID_KEY.startsWith("VUL_HIER")) {
    throw new Error("De publieke VAPID-sleutel ontbreekt nog. Vul deze in push-config.js in.");
  }
}

export async function requestChatPushPermission() {
  assertPushSetup();
  if (Notification.permission === "granted" || Notification.permission === "denied") return Notification.permission;
  // Moet rechtstreeks vanuit de klik op de knop worden aangeroepen.
  return await Notification.requestPermission();
}

export async function enableChatPush({ role, userId = null, chatId = null } = {}) {
  assertPushSetup();

  // De eigen toestemmingsknop roept requestChatPushPermission rechtstreeks aan.
  let permission = Notification.permission;
  if (permission === "default") permission = await requestChatPushPermission();
  if (permission !== "granted") {
    if (permission === "denied") throw new Error("Meldingen zijn in je browser geblokkeerd. Sta meldingen toe via de site-instellingen van je browser.");
    throw new Error("Je hebt geen toestemming gegeven voor meldingen.");
  }

  if (!(await isSupported())) throw new Error("Firebase Cloud Messaging wordt niet door deze browser ondersteund.");
  const registration = await navigator.serviceWorker.register(new URL("./firebase-messaging-sw.js", import.meta.url));
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: FCM_VAPID_KEY,
    serviceWorkerRegistration: registration
  });
  if (!token) throw new Error("Firebase heeft geen push-token teruggegeven. Probeer het opnieuw.");

  const path = targetPath(role, userId, token);
  await set(ref(db, path), {
    token,
    role: role === "admin" ? "admin" : "customer",
    updatedAt: Date.now()
  });
  // Een token is apparaat/account-breed; de aan/uit-keuze wordt per chat apart bewaard.
  if (chatId) {
    await set(ref(db, preferencePath(role, userId, chatId)), {
      enabled: true,
      updatedAt: Date.now()
    });
  }
  try { localStorage.setItem("novashopChatPushChoice", "allowed"); } catch { }

  installForegroundListener(messaging);
  return { permission, tokenSaved: true };
}


export async function removeChatPushRegistration({ role, userId = null } = {}) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  if (!("serviceWorker" in navigator) || !(await isSupported())) return false;
  const registration = await navigator.serviceWorker.getRegistration(new URL("./", import.meta.url).href);
  if (!registration) return false;
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: FCM_VAPID_KEY,
    serviceWorkerRegistration: registration
  });
  if (!token) return false;
  await remove(ref(db, targetPath(role, userId, token)));
  return true;
}

export async function installForegroundChatPush() {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  if (!("serviceWorker" in navigator) || !(await isSupported())) return false;
  await navigator.serviceWorker.register(new URL("./firebase-messaging-sw.js", import.meta.url));
  const messaging = getMessaging(app);
  installForegroundListener(messaging);
  return true;
}

function installForegroundListener(messaging) {
  if (foregroundListenerInstalled) return;
  foregroundListenerInstalled = true;
  onMessage(messaging, payload => {
    const data = payload?.data || {};
    if (data.type !== "chat-message" || !data.chatId || Notification.permission !== "granted") return;
    const readPath = data.targetRole === "admin"
      ? `chats/${data.chatId}/readBy/admins/sitebeheer/${data.messageId}`
      : `chats/${data.chatId}/readBy/customers/${data.targetUserId || ""}/${data.messageId}`;
    const preferencePath = data.targetRole === "admin"
      ? `chatNotificationPreferences/${data.chatId}/admins/sitebeheer`
      : `chatNotificationPreferences/${data.chatId}/customers/${data.targetUserId || ""}`;
    const showForegroundNotification = () => navigator.serviceWorker.ready.then(registration => registration.showNotification(
      data.title || "Nieuw bericht in je chat",
      {
        body: data.body || "Je hebt een nieuw bericht ontvangen.",
        icon: new URL("./favicon.ico", import.meta.url).href,
        badge: new URL("./favicon.ico", import.meta.url).href,
        tag: `chat-${data.chatId}`,
        renotify: true,
        timestamp: Number(data.createdAt) || Date.now(),
        data: { chatId: data.chatId, targetRole: data.targetRole || "customer" }
      }
    ));
    Promise.all([get(ref(db, readPath)), get(ref(db, preferencePath))]).then(([readSnapshot, preferenceSnapshot]) => {
      if (readSnapshot.val() === true || preferenceSnapshot.val()?.enabled !== true) return;
      return showForegroundNotification();
    }).catch(error => {
      console.warn("Leesstatus of chatvoorkeur kon niet worden gecontroleerd; voorgrondmelding wordt getoond:", error);
      return showForegroundNotification();
    }).catch(error => console.warn("Voorgrondmelding kon niet worden getoond:", error));
  });
}
