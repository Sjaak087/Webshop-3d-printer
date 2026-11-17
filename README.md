# 3D Printed Shop

## Nieuwe webshop-update

- **Skeleton loaders bij Firebase**: tijdens het ophalen van producten, bestellingen, chats, track & trace en Sitebeheer verschijnt een shimmer-/laadanimatie in plaats van een leeg vlak.
- **Algemene voorwaarden en contactpagina**: beide pagina's zijn bereikbaar via links onderaan de webshop. De algemene voorwaarden zijn als basisversie toegevoegd; controleer de tekst op je eigen werkwijze voordat je publiceert.
- **Contactpagina beheren**: open Sitebeheer > Contactpagina om de paginatitel, introtekst, naam, adres, e-mailadres, telefoon, openingstijden en extra informatie te wijzigen. Deze inhoud wordt opgeslagen in `settings/contact` in Firebase en wordt getoond via de footerlink Contact.
- **Naam- en adreslabels**: de contact- en privacy-informatie gebruikt de eenvoudige labels **Naam** en **Adres**.
- **Verzendkosten duidelijk zichtbaar**: € 3,95 bij bezorgen en gratis bij ophalen wordt op de homepage, in de winkelwagen, tijdens het afrekenen en op de algemene-voorwaardenpagina getoond.

- **Vernieuwd Tailwind-ontwerp**: strakkere productkaarten met drie producten per rij op desktop, moderne knoppen, voordelenbalk, Lucide-iconen en vloeiende hover-/vensteranimaties.
- **Productdetail met galerij**: per product maximaal drie afbeeldingen. De eerste afbeelding is de hoofdafbeelding.
- **Meerdere productopties**: voeg in Sitebeheer > Producten > Bewerken meerdere optiegroepen toe, zoals *Kleur*, *Formaat* en *Afwerking*. Elke optiegroep vormt één stap in de configurator (bijvoorbeeld **Stap 1 / 3**).
- **Prijs per optie**: geef iedere optie een toeslag (bijvoorbeeld `2.50`) of korting (bijvoorbeeld `-1.00`). De berekende prijs wordt in de configurator en winkelwagen getoond en opnieuw berekend wanneer de bestelling wordt geplaatst. Verschillende combinaties blijven aparte winkelwagenregels.
- **Openbare track & trace-link**: bij Mijn bestellingen staat een knop **Deellink**. De link werkt zonder account en toont alleen het volg-overzicht, de status, productkeuzes, voortgang en planning. De chat, klantnaam en het e-mailadres worden niet in dit openbare volg-overzicht opgenomen. De willekeurige deelcode is 192 bits lang. De pagina zelf bevat geen bedieningsknoppen voor chat of account. De huidige Firebase-regels geven op dit pad nog wel schrijfrechten voor de browserapp; een Cloud Function is nodig om dit ook op databaseniveau strikt alleen-lezen te maken.
- **Bijwerken van gedeelde status**: wijzigingen van bestelstatus, printfase en printplanning worden ook naar de openbare volgpagina bijgewerkt.

### Nieuwe installatie-/publicatiestap

Upload de bijgewerkte bestanden naar je hosting en publiceer daarna ook de bijgewerkte `database.rules.json` via Firebase Console > Realtime Database > Regels. De openbare volgpagina gebruikt het pad `publicTrack/<willekeurige-deelcode>`; publiceer de regels voordat je de deellinks deelt.

## Wat is er veranderd
- **Afbeeldingen uploaden werkt weer**: de afbeelding wordt in de browser verkleind (max 900 px) en in de database bewaard. Firebase Storage, CORS en `gcloud` zijn niet meer nodig. Bestaande producten met een oude afbeelding blijven werken.
- **Sitebeheer**: het e-mailadres wordt niet meer vooringevuld en het beheerderswachtwoord staat gehasht (PBKDF2) in `beheer-config.js`. Er is een uitlogknop en een rem op herhaald fout inloggen.
- **Klantaccounts**: wachtwoorden worden gehasht opgeslagen (voorheen platte tekst) en het wachtwoord zit niet meer in de sessie. Accounts staan nu in `accounts/`; oude testaccounts uit `users/` moet je opnieuw aanmaken (je kunt `users` in Firebase verwijderen).
- **Verzendkosten**: € 3,95 bij bezorgen, € 0 bij ophalen en € 0 bij bestellingen die via chat starten. De betaalfunctie herberekent het bedrag op de server.
- **Chatlinks**: links met of zonder `https://` (ook `www.` en `tikkie.me/...`) zijn nu klikbaar, ook met & in de link.
- **Technisch**: bestelling + chat worden in één schrijfactie opgeslagen, klanten laden alleen hun eigen bestellingen/chats (query + index), listeners worden opgeruimd (geen dubbele updates/lekken), winkelwagen blijft bewaard, Escape sluit vensters, prijzen worden bij bestellen opnieuw uit de database genomen.

- **Livecamera (Bambu Lab A1 mini)**: Track & Trace toont het camerablok bij alle bestelstatussen (*ontvangen*, *verwerkt*, *gemaakt* en *klaar voor bezorging*). Als `cameraUrl` leeg is, verschijnt een duidelijke melding dat de camera nog gekoppeld moet worden. Bij een ingestelde stream toont de pagina verbindingsstatus, livebeeld en een knop om opnieuw te proberen.

- **Camera offline**: komt er binnen 15 seconden geen beeld, of valt de printer uit terwijl het beeld live is, dan staat er **"3D printer is offline"**. De pagina probeert het elke 20 seconden automatisch opnieuw (of met de knop). Het uitvallen tijdens live beeld herkent de site via `/api/status` van `bambu_cam.py`: **start de camerabrug daarom opnieuw op met het nieuwe bestand**.
- **Keuzes per product (bijv. kleuren)**: in Sitebeheer > Producten > Bewerken vul je de naam van de keuze (bijv. *Kleur*) in en voeg je opties toe (Rood, Blauw, ...). De klant moet er in het productvenster precies één kiezen voordat het product in de winkelwagen kan. Dezelfde kleur en een andere kleur zijn aparte regels in de winkelwagen.
- **Uitverkocht**: elk product heeft een knop **Uitverkocht / Weer beschikbaar** in de productlijst, en elke optie is daar met één klik uitverkocht te zetten (klik op de optie). In de editor kan dat ook met de vinkjes. Zijn alle opties uitverkocht, dan is het hele product uitverkocht. Uitverkochte producten/opties zijn niet te bestellen; bij het bestellen wordt dit opnieuw gecontroleerd.
- **Gekozen optie zichtbaar**: in Sitebeheer > Track & trace staat bij elke bestelling per product welke optie/kleur is gekozen; de klant ziet dit ook in zijn track & trace.
- **Tab Bestellingen (Sitebeheer)**: alle bestellingen van oud naar nieuw, met datum en tijd van plaatsen, de gekozen opties en de bedragen. Met **Afronden en verwijderen** (na bevestiging) verdwijnen de bestelling, de chat en de track & trace van die bestelling definitief uit de database.
- **Status "in de maak"**: de track & trace heeft nu vijf stappen: ontvangen, verwerkt, **in de maak**, gemaakt, klaar voor bezorging. Zet je een bestelling op "in de maak", dan verschijnt in Sitebeheer > Track & trace per product een keuze: **in wachtrij**, **in bereiding** of **gemaakt**. De klant ziet die fase per product in zijn track & trace. Bestel je meerdere stuks van hetzelfde product (bijv. 6×), dan krijgt **elk stuk een eigen fase**: in Sitebeheer staat er per stuk een keuze ("stuk 1 van 6", enz.) en de klant ziet per stuk de fase in zijn track & trace.
- **Opmerking bij je bestelling**: in de winkelwagen staat een veld voor een opmerking (max. 500 tekens). Die staat bij de bestelling in Sitebeheer (beide bestelltabs) en in de track & trace van de klant.
- **Agenda (Sitebeheer > Agenda)**: weekoverzicht van maandag t/m zondag met elk uur (00:00–23:00). Kies eerst een bestelling (oudste bovenaan, nieuwste onderaan), kies daarna één product uit die bestelling (elk stuk apart: bij 1 kerstboom en 3 openers kies je dus 4 keer een stuk), kies datum, van- en tot-tijd (einddatum voor nachtprints) en klik op Inplannen. Je kunt ook op een uur in de agenda klikken om datum en tijd in te vullen. Ingeplande tijd is bezet: dubbel inplannen (één printer) wordt geweigerd. Zodra alle stukken van een bestelling zijn ingepland, wordt de verwachte klaartijd (het einde van het laatste stuk) berekend. Die staat in de track & trace van de klant (met per stuk de geplande tijd) en bij de bestelling in Sitebeheer. Klik op een blok in de agenda om het te selecteren; met Verwijder maak je de tijd weer vrij. Er is geen nieuwe databaseregel nodig: de planning staat bij de bestelling en verdwijnt dus ook bij Afronden en verwijderen.

- **Sitebeheer en klantaccount los van elkaar**: inloggen bij Sitebeheer logt je niet meer uit bij je klantaccount (en uitloggen bij Sitebeheer laat je klantaccount staan). In een chat die je vanuit Sitebeheer opent praat je als beheerder; je eigen bestellingschat blijft een klantchat.
- **Fase per stuk in de agenda**: onder elk stuk in de agenda kies je in wachtrij, bezig of gemaakt. In de track & trace staat dan bij dat stuk een geel pulserend **bezig** of een groen **✓ gemaakt**; in de agenda krijgt het blok een vinkje of ⏳.

- **Productafbeelding volledig zichtbaar**: op de homepage en in het productvenster wordt de hele afbeelding getoond (niet meer half bijgesneden).

## Installeren
1. Zet alle bestanden op GitHub Pages (vervang de oude; `storage.rules` en `cors.json` mogen weg).
2. Firebase Console > Realtime Database > Rules: plak de inhoud van `database.rules.json` en publiceer.

## Nieuw beheerderswachtwoord
Maak een nieuwe `salt` en `hash` met Node:
```
node -e 'const c=require("crypto");const s=c.randomBytes(16);console.log(s.toString("base64"),c.pbkdf2Sync("NIEUW_WACHTWOORD",s,150000,32,"sha256").toString("base64"))'
```
Zet de eerste waarde bij `salt` en de tweede bij `hash` in `beheer-config.js`.

## Eerlijk over de beveiliging en openbare volg-links
Zonder Firebase Authentication of een backend kan de browsercode zelf niets echt afdwingen. De nieuwe openbare volg-link gebruikt een willekeurige, moeilijk te raden code en leest alleen het afgeslankte pad `publicTrack/<code>`, maar de bestaande database-regels geven voor compatibiliteit nog steeds brede lees-/schrijfrechten op onder andere `orders`, `chats`, `products` en de schrijfkant van `publicTrack`. Daardoor is de hele database met de huidige configuratie niet privé of fraudebestendig. De login is een afscherming van de interface, geen harde beveiliging. Deel geen klantgegevens of gevoelige gegevens via deze huidige database-opzet. Voor een echte klantwebshop moet Firebase Authentication met gebruikersgebonden regels en een server-/Cloud Function voor order- en public-track-updates worden ingericht.

## Livecamera instellen (Bambu Lab A1 mini)

**Belangrijk:** de printer moet bereikbaar zijn via een pc op hetzelfde netwerk, en de stream moet via HTTPS online komen. GitHub Pages kan niet rechtstreeks bij een lokaal IP-adres zoals `192.168.x.x`.

1. Zet op de printer **LAN Mode Liveview** aan. Noteer het lokale IP-adres en de Access Code (8 tekens).
2. Installeer Python 3 op een pc die aan hetzelfde netwerk hangt als de printer (vink *Add to PATH* aan).
3. Start in PowerShell, in de map van de site:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-camera.ps1
   ```
   Het script **vraagt zelf om het IP-adres en de Access Code** (en onthoudt ze in je gebruikersmap, niet in GitHub), controleert of de printer bereikbaar is, installeert zo nodig `cloudflared`, start de tunnel en **geeft het nieuwe tunnel-adres automatisch door aan de website** via Firebase. Je hoeft `cameraUrl` dus niet meer aan te passen en te pushen.
   Handmatig kan ook: `python bambu_cam.py --tunnel` (of zonder `--tunnel` alleen de lokale brug).
4. Test lokaal: `http://127.0.0.1:1984/api/stream.mjpeg`. Je moet livebeeld zien.
5. Wil je liever een vaste URL? Gebruik een named tunnel met eigen domein en zet die in `beheer-config.js` (`cameraUrl`). Een adres in Firebase (automatisch) wint van `beheer-config.js`.

**Eenmalig:** publiceer de bijgewerkte `database.rules.json` in de Firebase-console (Realtime Database > Regels), anders kan de camera-tab niets opslaan.

### Camera uitschakelen (Sitebeheer > Camera)
In Sitebeheer staat een tab **Camera**. Daar zet je de camera voor een tijd uit (30 min, 1, 3, 12, 24 uur of tot je hem zelf weer aanzet). Klanten zien dan in plaats van het beeld: *"Sorry, we ervaren op dit moment problemen met de camera. We proberen dit zo snel mogelijk op te lossen."* Na afloop gaat de camera vanzelf weer aan.

### Privacy en veiligheid
De stream is toegankelijk voor bezoekers van de website die de URL kunnen openen. Deel de URL niet openbaar als je dat niet wilt. Zet nooit het printer-IP of de Access Code in `beheer-config.js` of GitHub; alleen de publieke HTTPS-stream-URL hoort daar. Laat de pc en de tunnel draaien zolang klanten livebeeld moeten kunnen zien.

### Let op: trycloudflare.com-adressen verlopen
Een "quick tunnel" (`cloudflared tunnel --url ...`, adres eindigt op `.trycloudflare.com`) krijgt bij elke herstart een **nieuwe willekeurige naam**. De oude naam bestaat dan niet meer en de browser meldt `net::ERR_NAME_NOT_RESOLVED`. Gebruik voor een vaste URL een **named tunnel** met je eigen domein (stap 5), of werk `cameraUrl` bij elke herstart bij en push opnieuw.

### Als het niet werkt
- Geeft de lokale test-URL geen beeld, controleer IP-adres, Access Code en LAN Mode Liveview.
- Werkt lokaal wel maar de HTTPS-URL niet, controleer de tunnel en of die naar poort 1984 verwijst.
- Controleer of `cameraUrl` exact dezelfde HTTPS-URL bevat.


## Nieuw in deze versie: gebruikersnamen, ophalen, adresgegevens en iDEAL | Wero

### Gebruikersnamen
- Nieuwe accounts vullen bij registratie een gebruikersnaam in (3–20 tekens: letters, cijfers, punt, `_` of `-`).
- Bestaande accounts zonder gebruikersnaam krijgen na het inloggen een verplichte instel-popup.
- De gebruikersnaam wordt op profiel-, chat- en bestelschermen getoond in plaats van het e-mailadres.
- Gebruikersnamen worden in `profiles/` opgeslagen; de unieke naamreservering staat onder `usernames/`.
- Een gebruiker kan de naam via Mijn account wijzigen. Een eerder gebruikte naam blijft gereserveerd voor hetzelfde account, zodat iemand anders hem niet kan overnemen.

### Bestellen
Na **Verder naar bestellen** kiest de klant tussen:
1. **Online afrekenen**: bezorging of ophalen. Bij bezorgen moeten voornaam, achternaam, straat, huisnummer, postcode en dorp/stad ingevuld worden. Land is vast ingesteld op Nederland. Bij ophalen worden adresvelden verborgen en komt er € 0 verzendkosten bij.
2. **Verder via chat**: er wordt direct een chatbestelling gemaakt, zonder adresformulier, verzendkosten of iDEAL-betaling.

De bezorgkosten staan op € 3,95. Als je dat bedrag aanpast, wijzig dan `SHIPPING` bovenin `app.js`.

### Adres in Sitebeheer
In Sitebeheer > Track & trace en Sitebeheer > Bestellingen zie je voor bezorgbestellingen de ingevulde naam en het volledige Nederlandse afleveradres, plus de gekozen afhandeling en betaalstatus. Het openbare track & trace-overzicht krijgt geen adresvelden.

### Betalen via Tikkie (handmatig)
De iDEAL/Mollie-checkout is vervangen door een Tikkie-afhandeling. Er is geen betaalprovider-API-key of bankrekeningnummer in de webshopcode nodig.

1. De klant vult bij normaal afrekenen de gegevens in en kiest bezorgen of gratis ophalen.
2. Na klikken op **Bestelling plaatsen / wachten op Tikkie** wordt de bestelling opgeslagen met betaalstatus **Wachten op Tikkie**. De klant wordt niet automatisch doorgestuurd naar een betaalpagina.
3. Open **Sitebeheer > Track & trace**. Bij elke Tikkie-bestelling staat een invoerveld **Tikkie-link voor klant**.
4. Maak zelf een Tikkie-verzoek aan in de officiële Tikkie-app of omgeving, controleer dat het verzoekbedrag gelijk is aan het totaal van de bestelling en plak de persoonlijke betaallink bij de juiste bestelling.
5. Klik **Tikkie-link opslaan**. De klant ziet de link direct onder **Mijn account > Mijn bestellingen** en kan daar op **Open jouw Tikkie-betaling** klikken.
6. Controleer zelf in je bank/Tikkie-omgeving of het geld echt ontvangen is. Klik daarna in Sitebeheer op **Markeer als betaald**. De website controleert Tikkie-betalingen niet automatisch.

**Belangrijk:** maak voor iedere bestelling een eigen Tikkie-betaalverzoek met het exacte bestelbedrag. Gebruik geen algemene herbruikbare betaal-link als het bedrag per bestelling verschilt. Tikkie is een betaalverzoek; de webshop kan de ontvangst niet automatisch verifiëren in deze implementatie.

### Eenmalig opruimen van de oude Mollie-koppeling
Als je eerder de Mollie-versie hebt gepubliceerd, verwijder dan de oude Cloud Functions zodat de ongebruikte Mollie-endpoints niet blijven bestaan:
```bash
firebase functions:delete createIdealCheckout mollieWebhook --region europe-west1
```
Bevestig de verwijdering in de Firebase CLI. De nieuwe Tikkie-flow heeft geen Cloud Functions nodig.

### Beveiliging vóór live gebruik
De huidige webshop heeft nog een eigen accountsysteem en de bestaande Realtime Database-regels bevatten brede lees-/schrijfrechten. Dat betekent dat deze Tikkie-link-velden op dit moment niet afdoende beschermd zijn tegen ongeautoriseerde databasewijzigingen. Zet de webshop niet met echte klantgegevens of betalingen live voordat Firebase Authentication en strikte database-regels zijn ingericht. Een Tikkie-link is persoonlijk betaalmateriaal: deel hem alleen met de bedoelde klant en controleer betaling altijd in je eigen bankomgeving.


### Rabobank-betaalverzoeken naast Tikkie
Sitebeheer accepteert nu zowel HTTPS-links van `tikkie.me` / `tikkie.nl` als Rabobank-betaalverzoeken op `betaalverzoek.rabobank.nl`. In het beheer plak je de link bij de bestelling en kies je **Betaallink opslaan**. De klant ziet vervolgens een algemene knop **Open jouw betaalverzoek** bij Mijn bestellingen. Controleer de betaling zelf in je bankapp voordat je **Markeer als betaald** gebruikt. De webshop verifieert de ontvangst niet automatisch.


### Nieuw tabblad Mijn bestellingen
In Sitebeheer staat nu een apart tabblad **Mijn bestellingen** naast **Track & trace** en **Bestellingen**. Het toont de volledige orderlijst met betaalstatus, betaalverzoekveld, klantadres en bestelvoortgang. In het klantaccount is **Mijn bestellingen** eveneens robuuster gemaakt: bestellingen worden gevonden op account-ID óf op het e-mailadres van het account, zodat oudere bestellingen die alleen een e-mailadres bevatten ook zichtbaar zijn.


### Mijn bestellingen-knop in de hoofdnavigatie
Er staat nu een aparte knop **Mijn bestellingen** direct naast **Mijn chats** in de navigatie bovenaan de webshop. Klanten die zijn ingelogd openen hiermee direct hun orders en betaallinks. Bezoekers die nog niet zijn ingelogd krijgen eerst het inlogscherm. Op kleine schermen blijft de knop zichtbaar als een pakket/check-icoon met de toegankelijke naam “Mijn bestellingen”.


## Loader-update v4
De productloader gebruikt nu een opvallender dansend skelet per laadkaart en per productafbeelding. De CSS- en JavaScript-URL hebben een versietag om oude browsercache te omzeilen. Na uploaden kan de browser nog één keer hard vernieuwd worden (Ctrl+Shift+R).


## Update 17 november 2026 — printerloader v8

- De AMS Lite is volledig uit de loader verwijderd.
- De eerdere schematische SVG is vervangen door een gedetailleerde, transparante studio-render van een Bambu Lab A1 Mini zonder AMS.
- Op het kleine printersdisplay wordt een dynamisch percentage en een voortgangsbalk weergegeven.
- De witte achtergrond en vier seconden minimale eerste productlaadtijd zijn behouden.
- De cacheversies van `styles.css` en `app.js` zijn verhoogd naar `v8-a1mini-realistic`.

De loader is een visuele webanimatie; het percentage is geen uitlezing van een fysieke printer.
