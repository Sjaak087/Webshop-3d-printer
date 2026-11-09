# BlauwShop — zonder Firebase Authentication

Deze versie gebruikt **geen Firebase Authentication** en geen Firebase-SDK in de openbare website. Klantaccounts staan in Firebase Realtime Database. Wachtwoorden van klanten worden op de server met scrypt gehasht; ze worden niet als platte tekst opgeslagen. Een kleine Node.js-backend controleert inloggen, klantrechten en beheerdersrechten. GitHub Pages host alleen de website.

## Waar stel ik de beheerder in?

Maak `backend/.env` aan door `backend/.env.example` te kopiëren. De instellingen staan op:

- **Regel 6:** `ADMIN_EMAIL=...` — het e-mailadres waarmee je Sitebeheer opent.
- **Regel 7:** `ADMIN_PASSWORD=...` — het wachtwoord voor Sitebeheer (minimaal 12 tekens).

Gebruik op die regels je eigen e-mailadres en een sterk, uniek wachtwoord. Zet deze waarden **niet** in `src/main.js`, GitHub Pages of een openbaar bestand. `backend/.env` staat in `.gitignore` en hoort privé te blijven.

Wanneer je de backend op Render of een andere hostingdienst plaatst, vul je dezelfde waarden in als omgevingsvariabelen `ADMIN_EMAIL` en `ADMIN_PASSWORD` in het dashboard van die hostingdienst. Daar stel je ook de andere variabelen uit `.env.example` in. De regels 6 en 7 van het voorbeeldbestand zijn dus de instellingen; bij online hosting zijn de dashboard-variabelen leidend.

## Eenmalig instellen

### 1. Firebase Realtime Database voorbereiden

Open Firebase Console → project `webshop-3cf70` → Realtime Database → **Rules**. Publiceer deze regels:

```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```

De backend gebruikt de Firebase Admin SDK met een geheime service-account-sleutel en kan de database server-side beheren. Bezoekers en de browser krijgen geen directe database-toegang.

### 2. Backend configureren

1. Kopieer `backend/.env.example` naar `backend/.env`.
2. Stel op regel 6 en 7 het beheerders-e-mailadres en beheerderswachtwoord in.
3. Maak in Firebase Console → Projectinstellingen → **Serviceaccounts** een privésleutel voor een serviceaccount. Bewaar het JSON-bestand veilig.
4. Open dat JSON-bestand en plak de volledige JSON-inhoud als één regel achter `FIREBASE_SERVICE_ACCOUNT_JSON=` in `backend/.env`. Deel dit bestand of de inhoud nooit.
5. Vervang `JWT_SECRET` door een willekeurige geheime tekst van minstens 32 tekens. Bijvoorbeeld lokaal: `openssl rand -hex 32`.
6. Laat `FIREBASE_DATABASE_URL` staan op de database-URL van jouw project.

### 3. Backend lokaal starten

Vereist Node.js 20 of nieuwer.

```bash
cd backend
npm install
npm start
```

De API luistert standaard op `http://localhost:8787`.

### 4. Backend online zetten

De GitHub Pages-website kan niet zelf veilig wachtwoorden controleren of de geheime Firebase-service-account-sleutel bewaren. Daarom moet de backend apart online staan.

Bijvoorbeeld met Render:

1. Push de volledige repository naar GitHub.
2. Maak bij Render een nieuwe **Web Service** aan vanuit die repository.
3. Stel **Root Directory** in op `backend`.
4. Stel **Build Command** in op `npm install` en **Start Command** op `npm start`.
5. Voeg de variabelen uit `backend/.env.example` toe bij Environment. Vul de echte waarden in, vooral `FIREBASE_SERVICE_ACCOUNT_JSON`, `JWT_SECRET`, `ADMIN_EMAIL` en `ADMIN_PASSWORD`.
6. Zet `FRONTEND_ORIGIN` op de origin van je GitHub Pages-site, bijvoorbeeld `https://jouwgebruikersnaam.github.io` (zonder `/repositorynaam`).
7. Deploy de service en kopieer de HTTPS-URL die Render geeft.

### 5. Frontend aan de backend koppelen

Open `src/config.js`. **Regel 2** bevat de backend-URL:

```js
export const API_BASE_URL = "http://localhost:8787";
```

Vervang dit door de HTTPS-URL van jouw online backend, bijvoorbeeld `https://jouw-api.onrender.com`. Commit en push daarna de wijziging naar GitHub. GitHub Actions bouwt en publiceert de site.

## Gebruik

- Klanten kiezen **Account maken**. De accountgegevens worden server-side in Realtime Database opgeslagen; het wachtwoord staat daar alleen als scrypt-hash.
- Klanten loggen in via de eigen login, niet via Firebase Authentication.
- De beheerder logt in via dezelfde knop **Inloggen**, maar gebruikt het e-mailadres en wachtwoord uit de backend-omgevingsvariabelen.
- Na het inloggen verschijnt **Sitebeheer**. Daar staan Producten, Track & trace en Chats.
- De backend controleert bij elke beschermde actie de sessie en rol. Een klant kan niet zelf een admin-rol aanmaken.

## Let op

- Firebase Authentication is niet nodig en wordt door deze versie nergens geïmporteerd of aangeroepen.
- Bestaande accounts die uitsluitend in Firebase Authentication stonden, worden niet automatisch overgezet. Klanten moeten opnieuw een account maken; stel voor de beheerder de waarden uit regel 6 en 7 in.
- Deze starter verwerkt geen online betalingen, verzendlabels of e-mailnotificaties.
- Bewaar de service-account JSON, `.env` en backend-omgevingsvariabelen privé. Plaats ze nooit in GitHub of de openbare website.
