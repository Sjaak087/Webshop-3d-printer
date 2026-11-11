# 3D Printed Shop

## Wat is er veranderd
- **Afbeeldingen uploaden werkt weer**: de afbeelding wordt in de browser verkleind (max 900 px) en in de database bewaard. Firebase Storage, CORS en `gcloud` zijn niet meer nodig. Bestaande producten met een oude afbeelding blijven werken.
- **Sitebeheer**: het e-mailadres wordt niet meer vooringevuld en het beheerderswachtwoord staat gehasht (PBKDF2) in `beheer-config.js`. Er is een uitlogknop en een rem op herhaald fout inloggen.
- **Klantaccounts**: wachtwoorden worden gehasht opgeslagen (voorheen platte tekst) en het wachtwoord zit niet meer in de sessie. Accounts staan nu in `accounts/`; oude testaccounts uit `users/` moet je opnieuw aanmaken (je kunt `users` in Firebase verwijderen).
- **Verzendkosten**: bij elke bestelling komt automatisch € 3,95 bij het totaal; zichtbaar in winkelwagen, bestelling, track & trace en sitebeheer. Pas `SHIPPING` bovenaan `app.js` aan om het bedrag te wijzigen.
- **Chatlinks**: links met of zonder `https://` (ook `www.` en `tikkie.me/...`) zijn nu klikbaar, ook met & in de link.
- **Technisch**: bestelling + chat worden in één schrijfactie opgeslagen, klanten laden alleen hun eigen bestellingen/chats (query + index), listeners worden opgeruimd (geen dubbele updates/lekken), winkelwagen blijft bewaard, Escape sluit vensters, prijzen worden bij bestellen opnieuw uit de database genomen.

- **Livecamera (Bambu Lab A1 mini)**: Track & Trace toont het camerablok bij alle bestelstatussen (*ontvangen*, *verwerkt*, *gemaakt* en *klaar voor bezorging*). Als `cameraUrl` leeg is, verschijnt een duidelijke melding dat de camera nog gekoppeld moet worden. Bij een ingestelde stream toont de pagina verbindingsstatus, livebeeld en een knop om opnieuw te proberen.

## Installeren
1. Zet alle bestanden op GitHub Pages (vervang de oude; `storage.rules` en `cors.json` mogen weg).
2. Firebase Console > Realtime Database > Rules: plak de inhoud van `database.rules.json` en publiceer.

## Nieuw beheerderswachtwoord
Maak een nieuwe `salt` en `hash` met Node:
```
node -e 'const c=require("crypto");const s=c.randomBytes(16);console.log(s.toString("base64"),c.pbkdf2Sync("NIEUW_WACHTWOORD",s,150000,32,"sha256").toString("base64"))'
```
Zet de eerste waarde bij `salt` en de tweede bij `hash` in `beheer-config.js`.

## Eerlijk over de beveiliging
Zonder Firebase Authentication of een backend kan de browsercode zelf niets echt afdwingen: iemand die de database-URL kent kan nog steeds producten, bestellingen en chats lezen/wijzigen. De login is daarom een afscherming van de interface, geen harde beveiliging. Voor echte klanten: schakel Firebase Authentication in en laat de regels op `auth.uid` en een admin-claim controleren.

## Livecamera instellen (Bambu Lab A1 mini)

**Belangrijk:** de websitecode kan de camera niet zelf aanzetten. De printer moet bereikbaar zijn via een pc op hetzelfde netwerk en de stream moet via HTTPS beschikbaar worden gemaakt. GitHub Pages kan niet rechtstreeks bij een lokaal IP-adres zoals `192.168.x.x`.

1. Zet op de printer **LAN Mode Liveview** aan. Noteer het lokale IP-adres en de Access Code.
2. Installeer Python 3 op een pc die aan hetzelfde netwerk hangt als de printer.
3. Stel de omgevingsvariabelen in en start `bambu_cam.py`:
   - Windows PowerShell:
     ```powershell
     $env:PRINTER_IP="192.168.1.50"
     $env:ACCESS_CODE="VUL_HIER_DE_ACCESS_CODE_IN"
     python bambu_cam.py
     ```
   - macOS/Linux:
     ```bash
     PRINTER_IP="192.168.1.50" ACCESS_CODE="VUL_HIER_DE_ACCESS_CODE_IN" python3 bambu_cam.py
     ```
   Vervang het voorbeeld-IP en de Access Code door de waarden van je printer. Bewaar de Access Code privé.
4. Test op die pc: `http://127.0.0.1:1984/api/stream.mjpeg`. Je moet livebeeld zien.
5. Maak de camerabrug bereikbaar met een **HTTPS-tunnel** naar `http://127.0.0.1:1984` (bijvoorbeeld Cloudflare Tunnel) met een eigen hostnaam, bijvoorbeeld `camera.jouwdomein.nl`.
6. Test `https://camera.jouwdomein.nl/api/stream.mjpeg` in een browser.
7. Vul die exacte HTTPS-URL in als `cameraUrl` in `beheer-config.js`, commit/push de bestanden naar GitHub en wacht tot GitHub Pages is bijgewerkt.

### Privacy en veiligheid
De stream is toegankelijk voor bezoekers van de website die de URL kunnen openen. Deel de URL niet openbaar als je dat niet wilt. Zet nooit het printer-IP of de Access Code in `beheer-config.js` of GitHub; alleen de publieke HTTPS-stream-URL hoort daar. Laat de pc en de tunnel draaien zolang klanten livebeeld moeten kunnen zien.

### Als het niet werkt
- Geeft de lokale test-URL geen beeld, controleer IP-adres, Access Code en LAN Mode Liveview.
- Werkt lokaal wel maar de HTTPS-URL niet, controleer de tunnel en of die naar poort 1984 verwijst.
- Controleer of `cameraUrl` exact dezelfde HTTPS-URL bevat.
