# Chatmeldingen via Firebase Cloud Messaging (FCM)

De webshop kan hiermee echte browser-pushmeldingen tonen voor nieuwe berichten in de bestaande chats. De browser vraagt zelf toestemming via het standaard toestemmingsvenster. Er wordt niets geregistreerd voordat iemand op **Meldingen inschakelen** in een chat drukt.

## 1. Public VAPID-sleutel

De door jou aangeleverde Public VAPID Key is al ingevuld in `push-config.js`. Controleer in Firebase Console dat dit inderdaad de **Public key** is onder **Projectinstellingen → Cloud Messaging → Web Push-certificaten**.

Plak nooit de private VAPID key of een service-account JSON in de websitecode.

## 2. Cloud Functions activeren en deployen

De realtime chatmelding komt uit een serverfunctie. De Firebase-console-campagne/testmelding triggert niet vanzelf op een nieuwe database-chatregel.

Cloud Functions vereist voor dit project het Firebase **Blaze**-abonnement (gekoppeld factureringsaccount). Stel in Google Cloud/Firebase eerst een budgetmelding in.

Installeer Node.js 22 en Firebase CLI, open een terminal in de hoofdmap van dit project en voer uit:

```bash
npm install -g firebase-tools
firebase login
firebase use webshop-3cf70
npm --prefix functions install
firebase deploy --only functions:sendChatPush
firebase deploy --only database
```

De functie luistert naar nieuwe items onder `chats/{chatId}/messages/{messageId}` in de bestaande Realtime Database-regio `europe-west1`.

## 3. Browser toestemming geven

1. Publiceer de volledige website op HTTPS (bijvoorbeeld GitHub Pages).
2. Bij het eerste bezoek verschijnt automatisch een korte uitleg-popup.
3. Klik op **Meldingen toestaan**. Pas na deze klik opent de officiële browserprompt; automatisch openen bij paginalaad wordt door moderne browsers geblokkeerd.
4. Geef toestemming. De browser onthoudt die keuze en de website bewaart de keuze ook lokaal.
5. Als de bezoeker nog niet is ingelogd, wordt de toestemming onthouden en wordt het FCM-token automatisch aan het klantaccount gekoppeld zodra die persoon inlogt. Voor Sitebeheer gebeurt dit na het inloggen.
6. Met **Niet nu** wordt de keuze lokaal bewaard en verschijnt de introductie-popup niet telkens opnieuw. Meldingen kunnen later nog vanuit een chat worden ingeschakeld.

Klantmeldingen worden naar het account van die klant gestuurd wanneer Sitebeheer antwoordt. Berichten van klanten sturen een melding naar apparaten waarop Sitebeheer meldingen heeft ingeschakeld. Uitloggen verwijdert de registratie van dat account/apparaat.

Als de browser eerder op **Blokkeren** is gezet, moet de gebruiker meldingen eerst toestaan via de site-instellingen van de browser. De standaard browserprompt kan dan niet opnieuw automatisch worden getoond.

## 4. Gedrag

- De melding verschijnt wanneer de website op de achtergrond staat of gesloten is, zolang het apparaat/browser push ondersteunt en online is.
- Bij een open website wordt een melding via de service worker getoond.
- De melding bevat geen privé-chattekst; alleen de melding dat er een nieuw bericht is.
- Klikken op de melding opent de betreffende chat. Is de gebruiker uitgelogd, dan wordt eerst het juiste inlogscherm getoond.
- FCM werkt voor deze webapp alleen via HTTPS en een browser die service workers en Push API ondersteunt.

## Belangrijke bestaande projectbeperking

De webshop gebruikt een eigen accountlogin en geen Firebase Authentication. Dit is een aangepaste koppeling op de bestaande account-ID's en is geen vervanging voor een beveiligde Firebase Auth-gebaseerde autorisatie. De huidige database heeft al brede lees-/schrijfrechten voor verschillende bestaande gegevens. Herzie die regels afzonderlijk voordat dit project als beveiligde productieomgeving wordt gebruikt.
