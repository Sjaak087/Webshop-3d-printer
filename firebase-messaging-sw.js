/* Firebase Cloud Messaging service worker. Must stay in the website root. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCBLpFJIC0yppKjQAwazMqv9QC0X4MBNa",
  authDomain: "webshop-3cf70.firebaseapp.com",
  databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "webshop-3cf70",
  messagingSenderId: "253002374669",
  appId: "1:253002374669:web:3058a5c9b2d4f111503f44",
  measurementId: "G-7YTVRGHRKL"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(async payload => {
  const data = payload?.data || {};
  if (data.type !== "chat-message" || !data.chatId) return;

  // Controleer bij aflevering opnieuw of de ontvanger dit bericht inmiddels op een ander apparaat las.
  // Dit voorkomt verlate Windows/browsermeldingen na offline-periodes.
  try {
    const readPath = data.targetRole === "admin"
      ? `chats/${data.chatId}/readBy/admins/sitebeheer/${data.messageId}`
      : `chats/${data.chatId}/readBy/customers/${data.targetUserId || ""}/${data.messageId}`;
    const preferencePath = data.targetRole === "admin"
      ? `chatNotificationPreferences/${data.chatId}/admins/sitebeheer`
      : `chatNotificationPreferences/${data.chatId}/customers/${data.targetUserId || ""}`;
    const [readSnapshot, preferenceSnapshot] = await Promise.all([
      firebase.database().ref(readPath).once("value"),
      firebase.database().ref(preferencePath).once("value")
    ]);
    if (readSnapshot.val() === true || preferenceSnapshot.val()?.enabled !== true) return;
  } catch (error) {
    // Fail open: een tijdelijke databasefout blokkeert de al verstuurde push niet.
    console.warn("Leesstatus of chatvoorkeur voor achtergrondmelding kon niet worden gecontroleerd:", error);
  }

  const title = data.title || "Nieuw bericht in je chat";
  const options = {
    body: data.body || "Je hebt een nieuw bericht ontvangen.",
    icon: new URL("./favicon.ico", self.registration.scope).href,
    badge: new URL("./favicon.ico", self.registration.scope).href,
    tag: `chat-${data.chatId}`,
    renotify: true,
    timestamp: Number(data.createdAt) || Date.now(),
    data: { chatId: data.chatId, targetRole: data.targetRole || "customer" }
  };
  return self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const chatId = String(event.notification?.data?.chatId || "");
  const targetRole = String(event.notification?.data?.targetRole || "customer");
  const destination = new URL(self.registration.scope);
  if (chatId) destination.searchParams.set("openChat", chatId);
  destination.searchParams.set("openRole", targetRole);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        await client.focus();
        if ("navigate" in client) await client.navigate(destination.href);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(destination.href);
  })());
});
