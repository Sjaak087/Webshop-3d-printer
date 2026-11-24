# Chatmeldingen via Firebase Cloud Messaging (FCM)

Deze webshop gebruikt Firebase Cloud Messaging voor browserpushmeldingen bij nieuwe, nog niet gelezen chatberichten.

## 1. Public VAPID-sleutel

De public VAPID-key die je hebt aangeleverd staat al in `push-config.js`. Controleer dat deze overeenkomt met Firebase Console → Projectinstellingen → Cloud Messaging → Web Push-certificaten. Deel nooit de private VAPID-key of een service-accountbestand.

## 2. Cloud Function bijwerken en uitrollen

De Realtime Database-campagne in Firebase Messaging is niet hetzelfde als een automatische trigger op een chatbericht. De meegeleverde Cloud Function `sendChatPush` luistert naar:

`/chats/{chatId}/messages/{messageId}`

Installeer Node.js 22 en Firebase CLI. Open de terminal in de hoofdmap van dit project en voer uit:

```bash
npm install -g firebase-tools
firebase login
firebase use webshop-3cf70
npm --prefix functions install
npm --prefix functions run lint
firebase deploy --only functions:sendChatPush
```

De Firebase Cloud Functions-trigger vereist het Blaze-abonnement en een gekoppeld factureringsaccount. Stel desgewenst budgetmeldingen in.

## 3. Leesstatus en meldingsregels

- De afzender wordt herkend uit `sender` (`admin` of `user`) en, als dat veld ontbreekt, uit de afzender-ID.
- Een beheerderbericht gaat naar de klant die bij `chats/{chatId}/userId` hoort.
- Een klantbericht gaat naar de Sitebeheer-apparaten die pushmeldingen hebben ingeschakeld.
- De chat schrijft een leesmarker weg per afzonderlijk bericht, maar alleen wanneer de chat zichtbaar is, het browservenster focus heeft en de gebruiker naar de nieuwste berichten kijkt.
- De Cloud Function wacht kort op die leesmarker. Is het bericht al gelezen, dan wordt geen push verstuurd.
- Als de push later op het apparaat aankomt, controleert de service worker de leesmarker nogmaals. Zo wordt een offline bewaarde melding onderdrukt wanneer het bericht intussen op een ander apparaat is gelezen.
- De FCM Web Push TTL is ingesteld op 28 dagen. Een melding kan dus worden afgeleverd zodra het apparaat weer online komt, zolang FCM/browser en token de melding nog accepteren.
- De systeemmelding bevat geen privé-chattekst.

## 4. Browser en Windows

Webpush vereist HTTPS (of localhost tijdens lokaal testen), een browser met Notification API, Service Worker en Push API, en toestemming van de gebruiker. De service worker `firebase-messaging-sw.js` moet in de root van de website staan.

Op Windows kun je testen met een actuele versie van Microsoft Edge of Google Chrome:

1. Open de gepubliceerde website via HTTPS.
2. Sta meldingen toe wanneer de browser dit vraagt.
3. Controleer Windows Instellingen → Systeem → Meldingen en zorg dat meldingen voor Edge of Chrome aanstaan.
4. Controleer dat Niet storen / Focus niet actief is.
5. Laat de site open op de achtergrond of sluit het tabblad en stuur vanuit een ander apparaat een testbericht.

Windows kan een melding alsnog verbergen wanneer meldingen voor de browser of Windows zelf uitstaan, de browserprofielinstellingen meldingen blokkeren of Niet storen is ingeschakeld. De website kan die besturingssysteeminstellingen niet zelf overrulen.

## 5. Toestemming

De eigen introductiepopup verschijnt bij een eerste geschikt bezoek. De officiële browserprompt verschijnt pas nadat de bezoeker op **Meldingen toestaan** klikt. De browser bewaart de toestemming; de website bewaart daarnaast de eigen keuze. Na het inloggen wordt het FCM-token aan de juiste klant- of Sitebeheer-registratie gekoppeld.

Als toestemming eerder is geblokkeerd, moet de gebruiker deze eerst via de browserinstellingen weer toestaan. De site kan de browserprompt niet forceren.

## 6. Testen en logboeken

Na het uitrollen van de functie kun je in Firebase Console → Functions → `sendChatPush` de logs controleren. Relevante logregels zijn onder meer:

- `Chat push sent`: een of meer FCM-registraties zijn door FCM geaccepteerd.
- `No FCM recipients registered`: er is nog geen apparaat voor de ontvangende klant/Sitebeheer geregistreerd.
- `Chat push skipped: recipient already read message`: het bericht had al een leesmarker.
- `Chat push ignored: sender is not a customer/admin message`: het bericht was een systeembericht of de afzender kon niet worden herkend.

Een succesvolle FCM-verzendstatus garandeert niet dat Windows het toastbericht zichtbaar toont; controleer ook browser- en Windows-meldingsinstellingen.

## Bestaande projectbeperking

De webshop gebruikt een eigen accountlogin en geen Firebase Authentication. De bestaande database-regels laten brede lees-/schrijfrechten op onder andere chats toe. De leesmarkers en tokenregistraties passen bij die bestaande structuur, maar vormen geen server-side identiteitscontrole. Herzie de Firebase-beveiligingsregels en koppel de database-acties aan betrouwbare server-side identiteiten voordat de webshop als beveiligde productieomgeving wordt gebruikt.


## Per-chat meldingsvoorkeur (nieuw)

De knop in een geopende chat bewaart de keuze nu afzonderlijk in Realtime Database op `chatNotificationPreferences/{chatId}/customers/{uid}` of `chatNotificationPreferences/{chatId}/admins/sitebeheer`. Bij het opnieuw openen van dezelfde chat wordt de keuze teruggelezen. De Cloud Function verstuurt alleen een push wanneer de ontvanger die specifieke chat heeft ingeschakeld.

Na het uploaden van de bestanden naar GitHub moeten de gewijzigde Realtime Database-regels worden gepubliceerd in Firebase Console of met `firebase deploy --only database`. De Cloud Function moet opnieuw worden uitgerold met `firebase deploy --only functions:sendChatPush`.
