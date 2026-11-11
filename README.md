# NovaShop

## Wat is er veranderd
- **Afbeeldingen uploaden werkt weer**: de afbeelding wordt in de browser verkleind (max 900 px) en in de database bewaard. Firebase Storage, CORS en `gcloud` zijn niet meer nodig. Bestaande producten met een oude afbeelding blijven werken.
- **Sitebeheer**: het e-mailadres wordt niet meer vooringevuld en het beheerderswachtwoord staat gehasht (PBKDF2) in `beheer-config.js`. Er is een uitlogknop en een rem op herhaald fout inloggen.
- **Klantaccounts**: wachtwoorden worden gehasht opgeslagen (voorheen platte tekst) en het wachtwoord zit niet meer in de sessie. Accounts staan nu in `accounts/`; oude testaccounts uit `users/` moet je opnieuw aanmaken (je kunt `users` in Firebase verwijderen).
- **Verzendkosten**: bij elke bestelling komt automatisch € 3,95 bij het totaal; zichtbaar in winkelwagen, bestelling, track & trace en sitebeheer. Pas `SHIPPING` bovenaan `app.js` aan om het bedrag te wijzigen.
- **Chatlinks**: links met of zonder `https://` (ook `www.` en `tikkie.me/...`) zijn nu klikbaar, ook met & in de link.
- **Technisch**: bestelling + chat worden in één schrijfactie opgeslagen, klanten laden alleen hun eigen bestellingen/chats (query + index), listeners worden opgeruimd (geen dubbele updates/lekken), winkelwagen blijft bewaard, Escape sluit vensters, prijzen worden bij bestellen opnieuw uit de database genomen.

- **Livecamera (Bambu Lab A1 mini)**: in track & trace staat een live camerabeeld zolang de bestelling de status *verwerkt* of *gemaakt* heeft (aanpassen via `CAMERA_STATUSES` bovenaan `app.js`). Staat `cameraUrl` in `beheer-config.js` leeg, dan is het blok verborgen.

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

## Livecamera instellen (A1 mini)
De A1 mini heeft geen RTSP maar een eigen JPEG-stroom op poort 6000. Het meegeleverde `bambu_cam.py` (alleen Python nodig) leest die stroom en biedt hem aan als MJPEG-stream. Hij verbindt alleen met de printer zolang er iemand kijkt.
1. **Printer**: zet *LAN Mode Liveview* aan (niet de volledige LAN Only Mode). Noteer het IP-adres en de Access Code.
2. **Python** installeren op een pc die aanstaat (python.org, vink "Add python.exe to PATH" aan).
3. Open `bambu_cam.py`, vul bovenin `PRINTER_IP` en `ACCESS_CODE` in en start met `python bambu_cam.py`.
4. Test: `http://localhost:1984/api/stream.mjpeg?src=a1mini` moet live beeld geven (de A1 mini geeft maar ca. 1 beeld per seconde).
5. **Publiek via https**: Cloudflare Tunnel naar `http://localhost:1984`, met als Path `api/stream.mjpeg`.
6. Zet het https-adres in `beheer-config.js` bij `cameraUrl` en zet de bestanden op GitHub Pages.

Let op: wie de camera-URL kent kan meekijken.
