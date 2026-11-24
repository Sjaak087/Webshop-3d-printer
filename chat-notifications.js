import { app, db } from "./firebase.js";
import { FCM_VAPID_KEY } from "./push-config.js";
import { ref, set, remove } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
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

function assertPushSetup() {
  if (!("Notification" in window)) throw new Error("Deze browser ondersteunt geen browsermeldingen.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Deze browser ondersteunt geen pushmeldingen.");
  if (!FCM_VAPID_KEY || FCM_VAPID_KEY.startsWith("VUL_HIER")) {
    throw new Error("De publieke VAPID-sleutel ontbreekt nog. Vul deze in push-config.js in.");
  }
}

export async function enableChatPush({ role, userId = null } = {}) {
  assertPushSetup();

  // Deze functie wordt rechtstreeks door de knopklik aangeroepen.
  // Daardoor toont de browser zelf zijn standaard toestemmingsvenster.
  let permission = Notification.permission;
  if (permission === "default") permission = await Notification.requestPermission();
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
    navigator.serviceWorker.ready.then(registration => registration.showNotification(
      data.title || "Nieuw bericht in je chat",
      {
        body: data.body || "Je hebt een nieuw bericht ontvangen.",
        icon: new URL("./favicon.ico", import.meta.url).href,
        badge: new URL("./favicon.ico", import.meta.url).href,
        tag: `chat-${data.chatId}`,
        data: { chatId: data.chatId, targetRole: data.targetRole || "customer" }
      }
    )).catch(error => console.warn("Voorgrondmelding kon niet worden getoond:", error));
  });
}
