# BlauwShop – Firebase webshop

Een responsive webshop met productoverzicht, productdetails, winkelwagen, accountregistratie/inloggen, bestellen, klant-/beheerchat en track & trace. De website is voorbereid voor automatische publicatie op GitHub Pages.

## 1. Firebase instellen (eenmalig)

Open Firebase Console en selecteer project `webshop-3cf70`.

1. **Authentication → Sign-in method**: schakel **Email/Password** in.
2. **Authentication → Users**: maak je beheeraccount aan met het e-mailadres dat je hieronder instelt. Zorg dat het e-mailadres geverifieerd is. Bij registratie via de site wordt voor het ingestelde beheeradres een verificatiemail verstuurd.
3. Open `src/firebase.js` en vervang `beheer@voorbeeld.nl` in `ADMIN_EMAILS` door je eigen beheerdersmailadres (gebruik dezelfde schrijfwijze).
4. Open `database.rules.json` en vervang op de aangegeven admin-regelplekken `beheer@voorbeeld.nl` door exact hetzelfde e-mailadres. Publiceer daarna de regels via **Realtime Database → Rules → Publish**.
5. Zorg dat het e-mailadres van het beheeraccount in Firebase Authentication als **geverifieerd** staat. Na het verifiëren moet de beheerder opnieuw inloggen zodat Firebase een bijgewerkt ID-token gebruikt.
6. Klanten kunnen via de knop **Account maken** zelf een account aanmaken.

**Gebruik nooit een wachtwoord in `firebase.js`, GitHub of andere scripts.** De Firebase webconfig is clientconfiguratie; de Realtime Database-regels zijn de toegangsbeveiliging.

## 2. Lokaal testen

Vereist Node.js 20 of nieuwer.

```bash
npm install
npm run dev
```

Voor een productie-build:

```bash
npm run build
npm run preview
```

## 3. Publiceren op GitHub Pages

1. Pak de ZIP uit. Zet **de inhoud** van de map `blauwshop` (dus `package.json`, `index.html`, `src/`, `.github/`, enzovoort) in de hoofdmap van je GitHub-repository. Zet niet de hele map `blauwshop` als submap in de repository.
2. Commit en push naar de branch `main`.
3. Open op GitHub **Settings → Pages** en kies bij **Build and deployment → Source** voor **GitHub Actions**.
4. De workflow `.github/workflows/deploy.yml` installeert dependencies, bouwt de website en publiceert automatisch de map `dist`. Na een geslaagde workflow toont GitHub de website-URL bij Settings → Pages.

De Vite-config gebruikt relatieve assetpaden, zodat JavaScript, CSS en favicon ook werken op een URL in de vorm `gebruikersnaam.github.io/repository/`.

## Wat is aangesloten?

- Producten toevoegen, wijzigen en verwijderen in Sitebeheer.
- Productkaarten en productdetailpagina's.
- Winkelwagen die in de browser bewaard blijft.
- Firebase Authentication met blijvende login-sessie.
- Bestellingen die gekoppeld worden aan een klant en een chat.
- Chats voor de klant en een overzicht voor de beheerder.
- Bestelstatussen: Ontvangen, Verwerkt, Gemaakt en Klaar voor bezorging.
- Klanten lezen alleen hun eigen bestellingen en chats; de beheerder kan alles bekijken.

## Grenzen van deze versie

Dit project voert nog geen online betalingen uit, maakt geen verzendlabels aan en verstuurt geen automatische bestel- of verzendmails. Productafbeeldingen worden via een http(s)-afbeeldingslink opgeslagen; uploaden naar Firebase Storage is nog niet ingebouwd. Voor een echte winkel met betalingen en persoonsgegevens is een server-side betaal-/bestelbackend en aanvullende beveiligingscontrole nodig.

## Beheeraccount beveiligen

De beheerderstoegang is in deze starter beveiligd met een geverifieerd Firebase Authentication-e-mailadres, zowel in de interface als in de Realtime Database-regels. Voor een grotere of commerciële webshop is een Firebase custom claim (toegekend door een vertrouwde server of Cloud Function) sterker dan een e-mailadres-regel.
