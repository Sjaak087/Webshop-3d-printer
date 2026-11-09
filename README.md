# BlauwShop – Firebase webshop

Een responsive webshop met productcatalogus, productdetailpagina, winkelwagen, accounts, bestelling, klant-/beheerchat, sitebeheer en orderstatussen.

## Starten
1. Installeer Node.js (18 of nieuwer).
2. Pak de ZIP uit en open deze map in een terminal.
3. Voer uit:
   ```bash
   npm install
   npm run dev
   ```
4. Voor GitHub Pages: `npm run build`. Publiceer de inhoud van `dist/` met GitHub Pages. Vite gebruikt standaard relatieve root-paden; zet eventueel `base: './'` in `vite.config.js` als je publiceert onder `gebruikersnaam.github.io/repository/`.

## Firebase eenmalig instellen
1. Open Firebase Console → project `webshop-3cf70`.
2. Authentication → Sign-in method → schakel **Email/Password** in.
3. Authentication → Users → voeg je beheeraccount toe met het e-mailadres dat in `src/firebase.js` bij `ADMIN_EMAILS` staat. Het wachtwoord stel je uitsluitend in Firebase in; zet het nooit in scripts of GitHub.
4. Pas `beheer@voorbeeld.nl` in `database.rules.json` aan naar exact hetzelfde admin-e-mailadres. Pas ook `ADMIN_EMAILS` in `src/firebase.js` aan.
5. Realtime Database → Rules → plak de inhoud van `database.rules.json` en klik Publish.
6. Maak in Firebase Authentication ook normale gebruikers via de registratieknop van de site.

## Belangrijke beveiligingsnotities
- Firebase web-config en de API key zijn bedoeld om in een client-app te staan; ze zijn geen wachtwoord. Database Security Rules bepalen toegang.
- De admin e-mail in de frontend verbergt de beheerknop, maar is op zichzelf **geen beveiliging**. De database-regels blokkeren schrijf-/beheeracties voor andere accounts. Voor een productie-webshop is een sterkere admin-rol via Firebase custom claims (ingesteld met een vertrouwde Cloud Function/Admin SDK) aan te raden. Vertrouw nooit op alleen een e-mailadres in browsercode.
- De voorbeeldregels gebruiken het admin-e-mailadres als eenvoudige startoplossing. Wijzig het op beide plekken. Test de regels met Firebase Rules Playground voordat je echte klantgegevens gebruikt.
- Deze demo verwerkt geen betalingen, verzendlabels of e-mailmeldingen. Voeg daarvoor een betrouwbare betaalprovider en server-side backend toe.
- Afbeeldingen worden hier via een publieke afbeeldings-URL opgeslagen. Gebruik bij voorkeur Firebase Storage en toegangsregels als je afbeeldingen wilt uploaden.
