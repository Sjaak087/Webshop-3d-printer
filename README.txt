# BlauwShop — GitHub Pages versie zonder buildstap

Deze versie gebruikt één `index.html` met de webshopcode inline. Er is geen `main.js`, `src/`-map, npm, Vite of buildstap nodig. Daarmee voorkom je de `main.js 404` die ontstaat als GitHub Pages de broncode direct serveert in plaats van een Vite-build.

## Zo zet je hem online
1. Maak eerst een kopie van je huidige GitHub-repository als back-up.
2. Pak deze ZIP uit op je computer.
3. Upload **de inhoud van deze map** naar de hoofdmap (root) van je GitHub-repository. `index.html` moet direct naast `favicon.svg` en `database.rules.json` staan. Zet de bestanden niet in een extra map.
4. Commit de wijzigingen naar `main`.
5. Ga naar GitHub → **Settings → Pages**.
6. Zet **Source** op **Deploy from a branch**.
7. Kies branch `main` en map `/ (root)`, klik **Save**.
8. Wacht tot de Pages-deployment groen is. Open de gepubliceerde URL en doe één harde refresh met `Ctrl + Shift + R`.

> Gebruik bij deze ZIP dus niet de oude GitHub Actions/Vite-workflow. Deze versie is juist bedoeld om direct uit de repository-root te serveren.

## Firebase eenmalig instellen
1. Firebase Console → Authentication → Sign-in method → schakel **Email/Password** in.
2. Maak bij Authentication → Users je beheeraccount aan.
3. Open `index.html`, zoek `ADMIN_EMAILS` en vervang `beheer@voorbeeld.nl` door het beheerdersadres.
4. Open `database.rules.json`, vervang daar ook alle voorkomens van `beheer@voorbeeld.nl` door exact hetzelfde adres.
5. Publiceer de regels in Firebase → Realtime Database → Rules → Publish.
6. Verifieer het beheer-e-mailadres via de verificatiemail. Log daarna opnieuw in.

## Functies
- Producten toevoegen, aanpassen en verwijderen.
- Productoverzicht, productdetails en winkelwagen.
- Registreren, inloggen en login onthouden.
- Bestellingen aanmaken en koppelen aan een chat.
- Klantchats en beheerder-chatbeheer.
- Track & trace met de statussen Ontvangen, Verwerkt, Gemaakt en Klaar voor bezorging.

## Belangrijk
- Wachtwoorden staan niet in de code. Deel ze nooit via GitHub.
- De Firebase webconfig is clientconfiguratie; de Realtime Database Rules zijn de beveiligingslaag.
- Deze starter verwerkt nog geen betalingen en maakt geen verzendlabels aan.
- Productafbeeldingen worden ingevoerd als publieke `https://`- of `http://`-URL, niet als upload naar Firebase Storage.
- Firebase SDK wordt via de officiële `gstatic` CDN geladen; een internetverbinding is vereist.
