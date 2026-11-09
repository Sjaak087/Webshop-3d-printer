# BlauwShop — GitHub Pages, zonder Firebase Authentication

Deze versie gebruikt gewone browserbestanden: **geen Vite, geen npm-build en geen Firebase Authentication**. Daardoor kan GitHub Pages de bestanden rechtstreeks laden. De website staat op GitHub Pages; de Node.js-backend controleert accounts en beheerdersrechten en schrijft veilig naar Firebase Realtime Database.

## Belangrijk: gebruik de volledige nieuwe map

Pak de ZIP uit en vervang de oude bestanden in je GitHub-repository door de bestanden uit deze map. Laat niet oude en nieuwe versies door elkaar staan.

### Bestanden die je moet houden / vervangen

- `index.html`
- `src/main.js` — dit is de nieuwe gewone JavaScript-versie; **niet verwijderen**
- `src/config.js`
- `src/style.css`
- de hele map `backend/`
- `database.rules.json`
- `favicon.ico`, `favicon.svg`, `.nojekyll`, `.gitignore`

### Oude bestanden die je moet verwijderen

Verwijder uit de GitHub-repository, als ze er nog staan:

- `src/firebase.js` en andere oude Firebase Auth-bestanden
- een extra `main.js` in de hoofdmap (de website gebruikt alleen `src/main.js`)
- `vite.config.js`
- het oude `package.json` in de hoofdmap
- de oude map `.github/workflows/` met `deploy.yml`
- `node_modules/` en `dist/` (als die mappen bestaan)

Verwijder **niet** `backend/server.js` of `src/main.js`.

## GitHub Pages instellen (zonder buildstap)

1. Open je GitHub-repository en upload de nieuwe bestanden naar de hoofdmap van de repository. `index.html` moet dus direct in de hoofdmap staan, niet in een extra map.
2. Ga naar **Settings → Pages**.
3. Bij **Build and deployment → Source** kies je **Deploy from a branch**.
4. Kies branch `main` en map `/ (root)` en klik **Save**.
5. Wacht tot GitHub de site publiceert. De website laadt `src/config.js`, `src/main.js` en `src/style.css` rechtstreeks. Er is geen `npm install` of build nodig voor de website.

## Waar stel ik de beheerdersgegevens in?

Open `backend/.env.example` en maak daarvan een privébestand `backend/.env`.

- **Regel 6:** `ADMIN_EMAIL=...` — het beheerders-e-mailadres.
- **Regel 7:** `ADMIN_PASSWORD=...` — het beheerderswachtwoord (minimaal 12 tekens).

Voorbeeld:

```env
ADMIN_EMAIL=jouwmail@example.com
ADMIN_PASSWORD=KiesEenEigenSterkWachtwoord
```

Zet `backend/.env` of het wachtwoord nooit op GitHub. Het staat in `.gitignore`. Wanneer de backend online staat, vul je deze waarden in bij de Environment-variabelen van je hostingdienst; die online waarden zijn leidend.

## Firebase Realtime Database voorbereiden

Open Firebase Console → project `webshop-3cf70` → Realtime Database → **Rules**. Publiceer:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

De backend gebruikt de Firebase Admin SDK. De browser krijgt geen directe database-toegang en er wordt geen Firebase Authentication gebruikt.

## Backend configureren en online zetten

De backend heeft Node.js 20 of nieuwer nodig en moet apart gehost worden (bijvoorbeeld als Web Service bij Render).

1. Maak in Firebase Console → Projectinstellingen → **Serviceaccounts** een privésleutel voor een serviceaccount. Bewaar de JSON-sleutel privé.
2. Zet bij je backend-hosting de variabelen uit `backend/.env.example`:
   - `PORT` (hosting mag zelf de poort bepalen)
   - `FRONTEND_ORIGIN` = de origin van je GitHub Pages-site, bijvoorbeeld `https://jouwgebruikersnaam.github.io` (zonder `/repositorynaam`)
   - `FIREBASE_DATABASE_URL` = de database-URL van dit project
   - `FIREBASE_SERVICE_ACCOUNT_JSON` = de volledige service-account-JSON als één regel
   - `JWT_SECRET` = een lange willekeurige geheime sleutel van minstens 32 tekens
   - `ADMIN_EMAIL` en `ADMIN_PASSWORD` = jouw beheerderslogin
3. Voor Render: maak een **Web Service** vanuit je GitHub-repository, zet **Root Directory** op `backend`, **Build Command** op `npm install` en **Start Command** op `npm start`.
4. Deploy de backend en kopieer de HTTPS-URL die je hostingdienst geeft.

## De website aan de backend koppelen

Open `src/config.js`. **Regel 5** bevat `API_BASE_URL`. Vervang `http://localhost:8787` door de HTTPS-URL van je backend, bijvoorbeeld:

```js
window.BLAUWSHOP_CONFIG = Object.freeze({
  API_BASE_URL: "https://jouw-api.onrender.com"
});
```

Sla op en upload `src/config.js` opnieuw naar GitHub. Let op: zolang `API_BASE_URL` op `localhost` staat, probeert de online website de backend op de computer van de bezoeker te bereiken. Dat werkt niet voor bezoekers.

## Wat werkt er in de webshop?

- Klantaccounts registreren en inloggen via de eigen backend (geen Firebase Authentication).
- Producten bekijken en in winkelwagen plaatsen.
- Bestellingen opslaan in Realtime Database.
- Bestelstatussen beheren via Sitebeheer.
- Klant en beheerder kunnen met elkaar chatten.
- Beheerder kan producten toevoegen, aanpassen en verwijderen.

Klantwachtwoorden worden op de server gehasht. De backend controleert klant- en beheerdersrechten. Deze startversie verwerkt geen online betalingen, verzendlabels of e-mailnotificaties.
