# 3D Printed Shop v30 — gesprek en online informatie

## Nieuw in v29
- Chatbot reageert ook op begroetingen en eenvoudige gewone gesprekjes.
- Algemene feitelijke vragen worden automatisch opgezocht in Wikipedia en DuckDuckGo Instant Answers.
- Vervolgvragen zoals “en waarom?” gebruiken de vorige onderwerpvraag als context.
- Volledige DuckDuckGo-resultaten openen via een gewone zoeklink; de gratis DuckDuckGo-API levert geen volledige zoekresultatenlijst.
- Er wordt geen lokaal AI-model of API-sleutel vereist.
- Geen Firebase-profielen, bestellingen, privéchats, adressen of wachtwoorden naar zoekdiensten sturen.

# 3D Printed Shop — gratis GitHub/Firebase-editie (v30)

## Wat is er veranderd in versie 12
- Nieuwe STL- en 3MF-modellen (maximaal 10 MiB per bestand) worden in kleine Base64-delen opgeslagen in Firebase Realtime Database.
- De upload gebruikt **geen Firebase Storage**, geen Storage-bucket, geen CORS-instellingen, geen Cloud Functions en geen betaald Blaze-abonnement.
- De modelbestanden worden alleen opgehaald wanneer een klant een productpagina met 3D-configurator opent. De productlijst zelf downloadt de modeldata niet.
- De bestaande productcatalogus, productkeuzes, 3D-configurator, bestellingen, chat, offertes, reviews, favorieten en voorraadfuncties blijven behouden.
- Geen PowerShell of terminal nodig voor het plaatsen van de webshop of het instellen van de database-regels.

## Gratis publiceren
1. Pak deze ZIP uit.
2. Upload/vervang de bestanden in je GitHub-repository en laat GitHub Pages de site publiceren.
3. Open [Firebase Console](https://console.firebase.google.com/) en kies project `webshop-3cf70`.
4. Open **Realtime Database → Rules**.
5. Open het bestand `database.rules.json` uit deze ZIP, kopieer de volledige inhoud naar de Rules-editor en klik op **Publish/Publiceren**.
6. Open je webshop, ga naar Sitebeheer → Producten en upload een STL- of 3MF-bestand. Nieuwe modellen worden daarna in de gratis database bewaard.

Je hoeft geen Firebase Storage aan te zetten, geen CORS te configureren en je project niet naar Blaze te upgraden.

## Gratis limieten en opslag
Firebase Realtime Database op het Spark-abonnement biedt momenteel:
- 1 GB opgeslagen databasegegevens;
- 10 GB dataverkeer/downloads per maand;
- maximaal 100 gelijktijdige verbindingen.

Een 10 MiB model wordt door Base64-codering ongeveer 13,3 MiB in de database. Daardoor passen er theoretisch ongeveer 75 modellen van 10 MiB in 1 GiB, maar in de praktijk minder omdat je productgegevens, chats en bestellingen ook database-opslag gebruiken. Elke volledige 3D-preview downloadt ongeveer 13,3 MiB. Het gratis maandelijkse downloadtegoed kan dus opraken wanneer veel bezoekers zware modellen openen. Firebase toont het actuele verbruik in de Usage/Usage and billing-weergave.

De uploads worden ongewijzigd in stukken opgeslagen. 3MF is al een ZIP-container en is meestal niet verder zinvol met gzip te verkleinen. Deze gratis versie voert geen aparte compressietaak na upload uit.

## Bestaande 3D-modellen uit eerdere versies
Modellen die eerder naar Firebase Storage zijn geüpload blijven in hun oude Storage-bucket staan. Op het gratis Spark-abonnement is die bucket niet toegankelijk. Upload voor die producten het oorspronkelijke STL- of 3MF-bestand opnieuw via Sitebeheer → Producten → Bewerken. De nieuwe upload komt in Realtime Database terecht.

Oudere modellen die al als Base64 in Realtime Database stonden blijven leesbaar.

## Veiligheid en gebruik
De meegeleverde database-regels sluiten aan bij de bestaande webshopstructuur. De webshop gebruikt voor het beheer nog een eigen client-side accountsysteem en geen Firebase Authentication met beheerdersrollen. Daardoor zijn de bestaande brede lees-/schrijfrechten niet geschikt om gevoelige klantgegevens of vertrouwelijke bestanden te beveiligen. Iedereen kan technisch gezien proberen data naar toegankelijke databasepaden te schrijven. Publiceer de webshop niet met gevoelige gegevens voordat de database-regels en authenticatie professioneel zijn aangescherpt.

## Overige functies
- Offertes voor maatwerk met afbeelding, omschrijving, afmetingen en kleurkeuze.
- Chat, bestellingen, verzendkosten en track & trace.
- Reviews na bezorging.
- Productcategorieën, gedeelde productopties en kleurstaaltjes.
- Voorraadbeheer, favorieten en omzetdashboard.
- STL/3MF kleurconfigurator. STL wordt als één onderdeel getoond; 3MF kan uit meerdere onderdelen bestaan.

## Controleren na publiceren
- Upload eerst een klein STL- of 3MF-testbestand.
- Open de productpagina en controleer of de 3D-preview verschijnt.
- Als de upload wordt geweigerd, controleer dan of het bestand `database.rules.json` volledig is gepubliceerd in Realtime Database → Rules.
- Houd de gratis opslag- en downloadquota in de gaten.

De code is lokaal gecontroleerd op JavaScript-syntaxis, JSON-validiteit en ZIP-integriteit. De live verbinding met jouw Firebase-project is niet door deze lokale controle getest.


## 3MF-preview voor Bambu Studio, OrcaSlicer en PrusaSlicer

De productpreview bevat een ingebouwde parser voor 3MF-bestanden. Deze leest standaard 3MF-meshes en volgt Production Extension-verwijzingen naar onderdelen in aparte `3D/Objects/*.model`-bestanden. Ook `p:path`, `objectid`, geneste componenten en transformaties worden verwerkt. De Three.js 3MFLoader wordt niet gebruikt, omdat die bij sommige geldige Production Extension-bestanden vastloopt. STL-preview en de productkleurkeuze blijven beschikbaar.

De parser gebruikt de ingebouwde browser-API om ZIP/DEFLATE uit te pakken, dus er is geen extra bibliotheek, buildstap of PowerShell nodig. Na het uploaden naar GitHub Pages wordt de gewijzigde `app.js` door de nieuwe versietag `v=14-3mf-preview-fix` opnieuw geladen.


## 3D-preview correctie (v14)

In v13 werd de container voor de kleurkeuzes gezocht binnen `#productModelViewer`, terwijl deze container in de productpagina ernaast staat. Daardoor kon de 3D-preview na het inlezen van het model alsnog stoppen met `Cannot set properties of null (setting 'innerHTML')`. v14 zoekt de kleurkeuze-container binnen de omliggende `.product-model-section` en maakt zo nodig een lege container aan. De preview kan daardoor ook blijven werken wanneer kleurkeuzes niet aanwezig zijn.

De melding dat de standaard Three.js-loader uitwijkt naar de productieparser is geen fatale fout op zichzelf; bij 3MF Production Extension-bestanden is dit een verwachte fallback. Deze melding is nu informatief in plaats van een waarschuwing. De cacheversie is verhoogd naar `v=14-3mf-preview-fix`, zodat GitHub Pages de nieuwe JavaScript-bestanden ophaalt.


## Versie 15 – reparatie 3MF-preview

- De 3MF-preview gebruikt nu eerst de productieparser voor Bambu Studio-, OrcaSlicer- en PrusaSlicer-bestanden met externe `p:path`-modelonderdelen.
- Verwijzingen naar externe modelbestanden worden genormaliseerd, ook wanneer een export relatieve paden gebruikt.
- De eenheden van afzonderlijke 3MF-modelonderdelen worden omgerekend naar millimeters.
- Elk product gebruikt uitsluitend het bij dat product geüploade STL- of 3MF-bestand. Er is geen hardcoded bestandsnaam, product-specifiek GLB-bestand of reserveweergave.
- De 3MF-preview gebruikt een generieke browserparser voor standaard 3MF-meshes en Production Extension-verwijzingen zoals `p:path` naar geneste `3D/Objects/*.model`-bestanden. Meerdere build-items, componenten en transforms worden verwerkt.
- In v15 werd bij één aangeleverd testmodel een apart GLB-reservebestand gebruikt. Dat was product-specifiek en is in v16 verwijderd.

Vervang bij publiceren alle bestanden uit de ZIP in de GitHub-repository. Er is geen aparte `models`-map nodig.


## Versie 16 – generieke 3MF-preview

- De product-specifieke Kerstboom-voor-oma-GLB-koppeling en de bijbehorende `models`-map zijn volledig verwijderd.
- Alle producten volgen hetzelfde upload- en previewpad op basis van hun eigen modelbestand.
- De Three.js 3MFLoader is uit de preview verwijderd; deze kon bij Production Extension-bestanden crashen met `Cannot read properties of undefined (reading 'mesh')`.
- STL blijft de Three.js STLLoader gebruiken. 3MF wordt voor elk product ingelezen door dezelfde ingebouwde parser, die standaard meshes, externe `.model`-onderdelen, geneste componentverwijzingen en transforms verwerkt.
- De echte upload `Kerstboom voor oma.3mf` is als generieke test gebruikt: de parser leest het externe bestand `3D/Objects/object_1.model` uit en vindt daarin een mesh. Er is geen bestandsnaam-detectie of productgebonden uitzondering meer.
- Er is geen PowerShell, betaalde Firebase Storage of extra backend nodig.
- Getest met vier ZIP/3MF-varianten in Chromium: het aangeleverde Bambu Studio-bestand (1 mesh), een standaard 3MF (1 mesh), meerdere build-items (2 meshes) en geneste externe componentverwijzingen (1 mesh).


## Versie 17 – 3D-preview zichtbaar maken

- De modelpositie wordt na het schalen correct gecentreerd. Dit verhelpt modellen die wel als geladen werden gemeld maar buiten het camerabeeld stonden door de grote build-offset in veel 3MF-bestanden.
- De camera berekent automatisch de juiste afstand op basis van de afmetingen van het model.
- Het previewcanvas wordt pas gerenderd met de werkelijk beschikbare breedte en hoogte; bij het zichtbaar worden van de productdialoog wordt opnieuw geschaald.
- De statusmelding zegt nu expliciet wanneer het model daadwerkelijk gerenderd wordt.


## Versie 18 — filamentbeheer en automatische kleurvoorraad

De oude tab **Voorraad** is vervangen door **Filamentbeheer**.

### Filamentkleuren beheren

1. Open Sitebeheer → Filamentbeheer.
2. Vul de kleurnaam in en kies de kleur met de kleurkiezer (het kleurvak). Je hoeft geen HEX-code te typen.
3. Vul de huidige voorraad in grammen in, kies het materiaal en stel desgewenst een waarschuwingsgrens in.
4. Klik op Kleur toevoegen. Actieve filamentkleuren verschijnen automatisch als kleurkeuze bij alle normale producten.

De offertefunctie gebruikt nog steeds de afzonderlijke lijst onder `settings/quoteColors`; filamentkleuren worden niet aan offertes toegevoegd.

### Gramverbruik per product

Open Sitebeheer → Producten → Bewerken en vul bij **Filamentverbruik per productstuk (gram)** het verbruik in. Dit veld wordt niet op productpagina's of in winkelwagen-/besteloverzichten getoond. Wanneer een bestelling wordt geplaatst, boekt de webshop `gramverbruik × aantal` af van de gekozen filamentkleur. Bij een mislukte bestelling wordt de reservering teruggedraaid.

Als er minder filament over is dan één productstuk nodig heeft, wordt die kleur voor dat product automatisch uitgeschakeld. Als geen enkele actieve kleur genoeg heeft, wordt het product als uitverkocht behandeld. Na het aanvullen van gramvoorraad wordt de kleur automatisch weer beschikbaar.

### Firebase Rules publiceren

GitHub Pages publiceert de Realtime Database-regels niet automatisch. Open Firebase Console → Realtime Database → Rules, vervang de regels door de bijgewerkte `database.rules.json` uit deze ZIP en klik op **Publiceren**. Dit voegt validatie toe voor filamentkleuren en `filamentGramsPerUnit`.

### Let op over privégegevens

Het gramverbruik wordt niet in de webshopinterface aan klanten getoond. In deze bestaande projectconfiguratie zijn Realtime Database-productgegevens echter publiek leesbaar volgens de huidige Firebase-regels. Iemand die de database technisch rechtstreeks uitleest, kan productmetadata zien. Voor echte beveiliging tegen database-uitlezen is Firebase Authentication met afgeschermde adminregels nodig; deze versie verandert het bestaande aanmeldsysteem daarvoor niet.


## Versie 20 — filamentkleuren gelijk tonen en eigen klanttekst

- Filamentbeheer is nu de enige bron voor de globale filamentkleurkeuze. Een oude productgroep met de naam **Filamentkleur** wordt vervangen door het actuele filamentpalet, zodat er geen dubbele of afwijkende filamentkleurstappen op productpagina's verschijnen. Als alle filamentkleuren gepauzeerd of verwijderd zijn, blijft ook geen verouderde filamentkeuzelijst zichtbaar.
- HEX-kleuren worden op één manier genormaliseerd (ook oudere waarden zonder `#` of in de korte 3-tekensnotatie). Filamentbeheer, productkeuzes, winkelwagen, dashboard en 3D-kleurkeuze gebruiken zo dezelfde kleurwaarde. De kleurstaaltjes hebben dezelfde vlakke kleurweergave.
- In Sitebeheer → Producten → Bewerken kun je **Klant mag zelf tekst invoeren** aanzetten en een eigen titel invoeren, bijvoorbeeld “Welke naam mag erop?”. De klant krijgt dan tijdens het kiezen van het product een tekstveld (maximaal 160 tekens). Een niet-lege tekst is vereist voordat het product in de winkelwagen kan. De tekst wordt bij de productkeuzes in de winkelwagen en bestelling bewaard.
- De tekstinstelling staat per product en wordt apart opgeslagen; offerte-/maatwerkkeuzes en de bestaande filamentvoorraadboekingen worden hierdoor niet aangepast.
- De cacheversies van `app.js` en `styles.css` zijn verhoogd zodat GitHub Pages de nieuwe bestanden opnieuw ophaalt.

Publiceer de inhoud van deze ZIP in dezelfde GitHub-repository. De live Firebase-koppeling kan alleen met jouw eigen projectgegevens worden gecontroleerd; deze lokale controles simuleren geen echte bestelling of Firebase-write.


## Versie 21 — laptopweergave, offertewaarschuwing en visuele verbetering

- De navigatie schaalt op laptopbreedtes terug naar compacte pictogramknoppen zodat de zoekbalk en navigatie samen binnen de schermbreedte blijven. De knoppen behouden toegankelijke labels en titels.
- De inhoud, beheerpanelen en dialoogvensters krijgen maximale breedtes en hoogtes op basis van de viewport. Op lagere laptopschermen kunnen lange formulieren binnen het venster scrollen in plaats van buiten beeld te vallen.
- Direct onder de kleurkeuze in het offerteformulier staat de waarschuwing: “Let op! De kleuren kunnen op zijn voor sommige producten als het veel filament kost. Ik hoop dat jullie hier begrip voor hebben.”
- De hero, offertekaart, productkaarten en focusstijlen zijn subtiel opgefrist voor een consistenter geheel. De bestaande functies en gegevensstructuur zijn niet bewust gewijzigd.
- De cacheversies zijn verhoogd naar `v=21-laptop-fit-quote-warning` zodat GitHub Pages de bijgewerkte bestanden opnieuw laadt.

De lokale controles controleren JavaScript-syntaxis, HTML-structuur en ZIP-integriteit. De weergave kan niet op ieder fysiek laptopscherm worden geverifieerd; test de gepubliceerde site ook even op jouw laptop.

> **Let op bij de versiegeschiedenis:** de secties **Versie 27** en **Versie 28** zijn historisch. In de actieve versie 29 is de Tavily/CORS-proxy-zoekmethode vervangen door de combinatie Wikipedia + DuckDuckGo Instant Answers en eenvoudige gespreksreacties. De lange tekst onder het chat-invoerveld blijft verwijderd.

## Versie 22 – webshopassistent

Deze versie voegt een vaste webshopassistent rechtsonder toe. De assistent gebruikt de reeds geladen product-, categorie-, productoptie-, filament- en contactgegevens uit de webshop om vragen te beantwoorden over onder meer:

- het assortiment en productprijzen;
- beschikbare productkeuzes en filamentkleuren (waarbij voorraad per product kan verschillen);
- maatwerk en het aanvragen van een offerte;
- bestellen, accounts, betalen en bestellingen volgen;
- verzendkosten (€ 3,95), gratis ophalen en de maximale levertijd van 14 dagen;
- contact en retourvragen.

De assistent is lokaal in de browser geïmplementeerd. Er wordt geen externe AI-API gebruikt en chatberichten worden niet naar Firebase opgeslagen. Daardoor zijn geen API-sleutel, extra server of extra Firebase-databaseverzoeken nodig voor het chatten. Antwoorden buiten de kennis en gegevens van deze webshop worden niet als feiten verzonnen; bij onbekende vragen verwijst de assistent naar de contactpagina of de klantenchat.

### Testen

Open de webshop en druk rechtsonder op **Vraag het de bot**. Test in ieder geval:

1. “Wat is de levertijd?” – antwoord moet maximaal 14 dagen noemen.
2. “Wat zijn de verzendkosten?” – € 3,95 en gratis ophalen.
3. “Welke filamentkleuren zijn beschikbaar?” – gebruikt de actieve kleuren uit Filamentbeheer.
4. “Hoe vraag ik een offerte aan?” – knop opent het offerteformulier.
5. Vraag naar een bestaande productnaam – assistent toont gegevens en een knop om het product te openen.
6. Test op mobiel en laptop; het chatvenster moet binnen het scherm blijven en met Escape/sluitknop dicht kunnen.

Let op: versie 22 voegt geen Cloudflare D1-database of Worker toe. Bestaande projectonderdelen, waaronder de al aanwezige printercamera-configuratie, zijn ongewijzigd gelaten.


## Versie 23 — uitgebreide ingebouwde webshopassistent

- De assistent is uitgebreid met een lokale kennisbank die aansluit op de werkelijk aanwezige webshopfuncties en -voorwaarden.
- Hij kan actuele producten, beschrijvingen, prijzen, categorieën, productopties en actieve filamentkleuren opzoeken in de gegevens die de webshop al heeft geladen.
- Onderwerpen omvatten bestellen, winkelwagen, eigen klanttekst (max. 160 tekens), maatwerkoffertes, offerte-afmetingen (max. 180 mm per richting), afbeeldingseisen (PNG/JPG/WEBP, max. 12 MB), filamentbeschikbaarheid per product, 3D-voorbeelden, betalingen, bestellingen volgen, retourverzoeken, reviews, favorieten, accounts, privacy, cookies en contact.
- De actuele voorwaarden in de code worden gebruikt: maximale levertijd 14 dagen, verzending € 3,95, ophalen gratis en verzending binnen Nederland.
- De chatbot toont tijdens het zoeken een korte verwerkingsindicator. Dit is lokale verwerking van webshopinformatie en geen generatieve AI.
- Er is geen externe AI-dienst, API-sleutel, webzoekdienst, Cloudflare Worker of extra Firebase-opslag nodig. Chatberichten worden niet naar Firebase verstuurd of persistent opgeslagen.
- Bij informatie die de website niet bevat, geeft de assistent aan dat hij het niet zeker weet en verwijst hij naar contact of de klantenchat in plaats van gegevens te verzinnen. Hij kan niet live op het openbare internet zoeken.
- De chat heeft uitgebreidere vraagknoppen en onthoudt binnen het geopende gesprek het laatst besproken product voor eenvoudige vervolgvragen.
- De cacheversies zijn verhoogd naar `v=23-expanded-local-assistant`.

### Testen

1. Open de vaste knop rechtsonder en controleer dat het chatvenster binnen het scherm blijft.
2. Stel vragen over levertijd, verzendkosten, ophalen, betaling, retouren, eigen tekst, offertes, account, favorieten en privacy.
3. Vraag naar een bestaande productnaam; de assistent moet actuele prijs, omschrijving en beschikbare opties tonen.
4. Vraag welke kleuren beschikbaar zijn en controleer dat de namen overeenkomen met Filamentbeheer; vraag daarna naar kleuren bij een specifiek product.
5. Klik op de knoppen voor offerte, producten, winkelwagen en Mijn bestellingen; de bestaande webshopacties moeten openen.
6. Controleer dat tijdens het beantwoorden een zoek-/verwerkingsindicator zichtbaar wordt en daarna verdwijnt.
7. Controleer dat de bot onbekende informatie niet verzint en uitlegt dat hij niet live op internet zoekt.


## Versie 24 — uitgebreidere hulp voor accounts en zoeken zonder API-sleutel

- De chatbot legt in afzonderlijke stappen uit hoe een klant inlogt, een account aanmaakt, de gebruikersnaam wijzigt en uitlogt.
- Er is een apart en eerlijk antwoord voor een vergeten wachtwoord. In de huidige webshopcode bestaat geen automatische wachtwoordreset; de bot verzint die functie niet en verwijst naar de contactpagina.
- De bot geeft extra uitleg over de gebruikersnaamregels (3–20 tekens; letters, cijfers, punt, underscore of koppelteken), het e-mailadres, de wachtwoordlengte (minimaal 8 tekens) en de accountknoppen in de navigatie.
- Een onbekende vraag triggert nu een openbare zoekactie in Wikipedia via de MediaWiki Action API. Dit is een publiek toegankelijke zoek-API, zonder account of API-sleutel; de site toont maximaal drie resultaten met links naar de bronnen.
- Voor een volledige webzoekopdracht wordt een DuckDuckGo-resultatenpagina in een nieuw tabblad geopend. Dit geeft echte webresultaten zonder sleutel, maar de zoekresultaten worden niet binnen de chatbot ingelezen: DuckDuckGo publiceert geen algemene gratis webresultaten-API voor deze toepassing. De officiële Instant Answer API is geen volledige webzoek-API.
- De chatbot laat zien wanneer hij lokale informatie of openbare bronnen opzoekt.
- Zoekvragen worden alleen bij een expliciete webzoekvraag of een niet-herkende webshopvraag naar de openbare zoekbron gestuurd. Chatberichten worden niet opgeslagen in Firebase.

### Testen versie 24

1. Vraag: “Hoe log ik in?” — de bot geeft een stappenplan en een knop om het inlogvenster te openen.
2. Vraag: “Hoe maak ik een account aan?” — de bot noemt de gebruikersnaamregels, e-mail en minimale wachtwoordlengte.
3. Vraag: “Ik ben mijn wachtwoord vergeten” — de bot zegt dat er geen automatische resetfunctie bestaat en verwijst naar contact; er wordt niet om het wachtwoord gevraagd.
4. Vraag: “Hoe wijzig ik mijn gebruikersnaam?” en “Hoe log ik uit?” — de bot legt het accountmenu uit.
5. Vraag: “Zoek op internet naar wat is 3D-printen” — de bot doet een Wikipedia-zoekactie en biedt een knop voor volledige DuckDuckGo-resultaten.
6. Stel een onbekende vraag — de bot probeert openbare kennis te zoeken, en meldt wanneer er geen samenvatting beschikbaar is.
7. Controleer dat alle oude webshopacties, productinformatie en de 14-dagen-levertijd blijven werken.


## Historische versie 26 — lokale generatieve AI (niet meer actief)

De chatbot is omgebouwd van trefwoordherkenning en vooraf geschreven FAQ-teksten naar een lokaal generatief taalmodel. Hij gebruikt **Qwen3.5-2B** via **WebLLM** in de browser. Het model formuleert antwoorden zelf op basis van een actuele, compacte context uit de geladen Firebase-catalogus en feitelijke uitleg over de functies van de website.

- Geen AI-API-sleutel, AI-account, betaalde AI-dienst of Cloudflare nodig.
- De AI-inference gebeurt lokaal in de browser; chatberichten worden niet naar Firebase of een AI-cloud verstuurd.
- Producten, basisprijzen, beschrijvingen, categorieën, opties, meerprijzen, actieve filamentkleuren, beschikbaarheid, 3D-preview- en reviewinformatie komen uit de actuele webshopstatus.
- De assistent krijgt ook de feitelijke werking van accounts, bestellen, winkelwagen, maatwerkoffertes, chats, tracking, verzending, ophalen, betaling, retouren, reviews, favorieten, contact, privacy en Sitebeheer mee.
- De eerste keer moet de browser de WebLLM-engine en het model downloaden. WebLLM vereist WebGPU; apparaten zonder geschikte GPU kunnen de chatbot niet lokaal gebruiken. Het gekozen model heeft volgens de gepubliceerde modeltabel een geschatte VRAM-behoefte van circa 2,2 GB. Dat is een indicatie; de werkelijke eisen verschillen per browser en apparaat.
- De browsercache kan modelbestanden voor volgende bezoeken bewaren.
- De chatbot heeft geen onbeperkte toegang tot alle websites. Een expliciete openbare zoekopdracht gebruikt de Wikimedia/Wikipedia-zoekfunctie; het openen van volledige DuckDuckGo-resultaten gebeurt buiten de chatbot en die pagina wordt niet automatisch gelezen.
- De AI kan nog steeds fouten maken. Ontbrekende webshopgegevens moeten als onbekend worden gemeld, niet worden verzonnen.

**Belangrijk:** test WebGPU en de eerste modeldownload na publicatie op een echte laptop/desktop en mobiel apparaat. Alleen JavaScript-syntaxis- en ZIP-controles kunnen de werking van de GPU-engine niet bewijzen. Zie `TEST-CHATBOT.md`.


## Versie 27 — uitgebreide webshop-FAQ en sleutelvrij online zoeken

De chatbot is opnieuw opgebouwd zodat bezoekers niets hoeven te downloaden of te installeren. De lokale WebLLM/WebGPU-engine uit versie 26 is verwijderd.

- Webshopvragen worden beantwoord met een uitgebreide Nederlandse FAQ over assortiment, prijzen, productopties, filamentkleuren en materialen, voorraadstatus, maatwerkoffertes, eigen tekst, 3D-previews, STL/3MF, slicers, bestellen, winkelwagen, accountfuncties, betalen, verzending, ophalen, tracking, retouren, reviews, favorieten, klantenchat, printercamera, privacy, cookies, voorwaarden en contact.
- De chatbot gebruikt de geladen publieke productcatalogus, basisprijzen, actuele productopties, actieve filamentkleuren en beschikbaarheidsstatus. Productvragen kunnen dus aansluiten bij de gegevens in Firebase die de webshop al publiek heeft geladen.
- Algemene vragen buiten de FAQ worden automatisch online gezocht. De integratie gebruikt de sleutelvrije Tavily Search API met `X-Tavily-Access-Mode: keyless`; volgens de Tavily-documentatie vereist dit geen account, API-sleutel of configuratie. De sleutelvrije dienst is gratis maar wel begrensd in gebruik. Wanneer de limiet is bereikt of de dienst niet werkt, toont de chatbot directe links naar Google, Bing, DuckDuckGo en Brave.
- Online zoekresultaten bevatten een korte door Tavily gegenereerde samenvatting plus links naar de gevonden websites. Bronnen openen in een nieuw tabblad. Controleer belangrijke, actuele of gevoelige informatie bij de oorspronkelijke bron.
- Privacybescherming: de chatbot haalt geen klantprofielen, adressen, gebruikersnamen, bestellingen, offertes of privéchats uit Firebase op. Deze gegevens worden ook niet naar Tavily verstuurd. Berichten worden niet in Firebase opgeslagen. Invoer die lijkt op een e-mailadres, telefoonnummer, Nederlandse postcode, IBAN, ingevulde inloggegevens, klant-/bestelnummer, trackingcode of concreet huisadres wordt geblokkeerd vóór online zoeken.
- De bot vraagt nooit om wachtwoorden, herstelcodes, volledige betaalkaartgegevens of persoonlijke adresgegevens. Voor eigen bestellingen en accountinformatie verwijst hij naar de normale, ingelogde schermen van de webshop.
- Er is geen lokale AI-modeldownload, WebGPU-ondersteuning, externe API-sleutel, Cloudflare-onderdeel of aparte installatie nodig. Alleen de online zoekfunctie vereist een internetverbinding; de FAQ werkt met de webshopgegevens die de pagina al geladen heeft.
- De volledige webzoekfunctie is afhankelijk van de beschikbaarheid en gebruikslimieten van Tavily. De rechtstreekse zoekmachineknoppen zijn een terugvalmogelijkheid, geen garantie dat een externe zoekmachine de inhoud in de chatbot teruglevert.

### Testen versie 27

Zie `TEST-CHATBOT.md` voor de uitgebreide checklist. Controleer in elk geval dat er geen WebGPU-download verschijnt, dat webshopantwoorden kloppen met de live catalogus, dat onbekende algemene vragen online worden opgezocht, dat bronlinks werken en dat de chatbot geen privégegevens uit Firebase kan ophalen. Test de sleutelvrije Tavily-aanroep ook op de gepubliceerde GitHub Pages-site; externe diensten kunnen hun voorwaarden, CORS-instellingen of gebruikslimieten wijzigen.


## Versie 28 — reparatie online zoeken en opschonen chatbot

- De Tavily-aanroep gebruikt nu alleen de kernparameters voor de sleutelvrije Search API; optionele velden die een foutieve aanvraag konden veroorzaken zijn verwijderd.
- Als Tavily niet reageert, probeert de chatbot automatisch openbare HTML-zoekresultaten van DuckDuckGo en Bing op te halen via een gratis CORS-proxy voor openbare GET-verzoeken. Resultaten worden in de chat getoond met titel, samenvatting en bronlink.
- De zoekresultaten worden maximaal drie minuten tijdelijk in het geheugen van de browser gecachet om dubbele verzoeken te beperken. Er worden geen Firebase-account-, order-, adres- of chatsessies meegestuurd. De bestaande invoerfilter blijft vóór online zoeken actief.
- De uitgebreide tekst onder het chat-invoerveld is verwijderd.
- Externe zoekdiensten en de gratis proxy blijven afhankelijk van hun eigen beschikbaarheid en limieten; als beide zoekroutes mislukken, blijven directe links naar zoekmachines beschikbaar.

### Testen versie 28

- Test een bekende FAQ-vraag, een onbekende webshopvraag en een algemene internetzoekvraag.
- Controleer dat een mislukte Tavily-aanroep automatisch DuckDuckGo/Bing probeert en dat gevonden resultaten met klikbare bronlinks verschijnen.
- Controleer dat er geen kleine uitleg-/privacytekst meer onder het chat-invoerveld staat.
- Controleer dat de privacyfilter persoonlijke gegevens tegenhoudt voordat een externe zoekopdracht wordt uitgevoerd.


## Historische chatbotuitleg v29 (vervangen in v30) — gesprek, Wikipedia en DuckDuckGo

De chatbot uit v29 vervangt de online zoekmethode uit v27/v28. De oude Tavily- en openbare CORS-proxy-aanroepen zijn uit de actieve code verwijderd.

- Begroetingen, bedankjes, eenvoudige smalltalk en gewone reacties krijgen een gesprekspassend antwoord.
- Vragen over de webshop gaan eerst naar de uitgebreide FAQ en de actuele openbare productinformatie.
- Andere feitelijke vragen worden parallel opgezocht via de Nederlandstalige Wikipedia-API en de DuckDuckGo Instant Answer API. Als er geen Nederlandstalige Wikipedia-resultaten zijn, probeert hij Engelstalige Wikipedia.
- De assistent combineert de gevonden directe samenvatting en Wikipedia-fragmenten en toont bronkaarten. Vervolgvragen zoals “en waarom?” gebruiken de vorige onderwerpvraag als zoekcontext.
- DuckDuckGo's openbare API is een Instant Answer API, geen volledige zoekresultaten-API. Daarom geeft de chatbot ook een directe knop naar de volledige DuckDuckGo-zoekpagina; hij leest die volledige pagina niet automatisch uit.
- De chatbot is geen volledig generatief taalmodel. De kleine gespreksreacties zijn ingebouwde gesprekspatronen; feitelijke antwoorden worden op basis van de opgehaalde bronfragmenten samengesteld.
- De invoerfilter blijft actief; de assistent haalt geen accountprofielen, wachtwoorden, klantadressen, bestellingen of privéchats uit Firebase op en stuurt die gegevens niet naar zoekdiensten.

Deze automatische zoekflow is in v30 aangepast: standaard wordt niet online gezocht. Zie de v30-sectie en `TEST-CHATBOT.md` voor de actuele werkwijze.


## Versie 30 — productadvies en handmatige zoekkeuze

- De chatbot zoekt niet langer automatisch online bij iedere onbekende vraag.
- Onder het invoerveld staat een keuzelijst: **Gewoon antwoorden / advies**, **Zoek in mijn webshop** en **Zoek op het internet**.
- “Zoek in mijn webshop” doorzoekt de reeds geladen openbare productcatalogus, productbeschrijvingen en lokale FAQ; hierbij wordt geen externe zoekdienst aangeroepen.
- “Zoek op het internet” voert de bestaande sleutelvrije zoekactie via Wikipedia en DuckDuckGo Instant Answers uit en toont bronlinks. DuckDuckGo levert via deze openbare API geen volledige zoekresultatenlijst.
- Bij de vraag “Welk product zou jij het meeste aanraden?” vergelijkt de chatbot beschikbare producten op actuele bestelbaarheid, publieke reviews, productinformatie, opties en 3D-preview. Hij licht zijn keuze toe en toont maximaal twee alternatieven. De rangschikking gebruikt geen verborgen omzet-, bestel- of klantgegevens.
- De standaardmodus blijft bij gesprek en advies; zoeken gebeurt alleen na een expliciete keuze of een duidelijke opdracht zoals “zoek op internet”.
- Geen AI-modeldownload, API-sleutel of extra Firebase-opslag vereist.

Zie `TEST-CHATBOT.md` voor de v30-controles. De externe Wikipedia/DuckDuckGo-verbinding moet na publicatie in de echte browser worden getest. Dit is geen vrij generatief taalmodel; aanbevelingen worden transparant samengesteld uit de beschikbare webshopgegevens.


## v31 chatbot updates
- De gewone verzendknop voert een normaal gesprek zonder automatisch te zoeken.
- Het pijltje naast de verzendknop bevat precies twee zoekacties: webshop en internet.
- Productaantallen en bestelbare/niet-bestelbare productaantallen worden direct uit de geladen openbare productcatalogus berekend.
- Goedkoopste en duurste bestelbare producten kunnen dynamisch worden vergeleken op basis van basisprijs.
- De chatbot bewaart een beperkte gesprekscontext alleen in het huidige browsertabblad.
- Dit blijft een regelgestuurde assistent en is geen volledig generatief taalmodel; willekeurige vragen buiten de kennisbasis vereisen een externe AI-dienst of een lokaal model.


## Versie 32 — maatwerkherkenning en gesprek
- Standaard chat herkent verzoeken om een 3D-print te laten maken. Als een gelijkend actief product in het assortiment wordt gevonden (inclusief kleine typfouten), wordt daarnaar verwezen. Als er geen gelijkend product wordt gevonden, legt de assistent uit dat de bezoeker een maatwerkofferte moet aanvragen en toont een directe knop naar het offerteformulier.
- Gewone verzoeken om documenten/huiswerk uit te printen worden niet als 3D-printofferte behandeld.
- De gewone gesprekmodus is uitgebreid met natuurlijkere reacties voor hobby's, sport, games, muziek, school, gevoelens, films, dieren, ruimte, geschiedenis, techniek, meningen, grappen en weetjes.
- De standaardmodus blijft offline en zoekt niet automatisch op internet. Voor willekeurige feitelijke vragen gebruikt de bezoeker expliciet de internetzoekoptie.
- De chatbot blijft regelgestuurd en is geen generatief taalmodel; reacties zijn breder en contextgevoeliger maar niet gelijk aan ChatGPT.


## Versie 33 — uitgebreide FAQ-kennisbank

- De chatbot bevat nu de oorspronkelijke 43 webshoponderwerpen plus 150 aanvullende kennisbankonderwerpen.
- De aanvullende onderwerpen behandelen onder meer: de basis van 3D-printen, FDM, materialen PLA/PETG/ABS/TPU, sterkte, hitte, water, voedselveiligheid, laaglijnen, supports, infill, tolerantie, nabewerking, bestandsformaten STL/3MF, slicers, ontwerpbestanden, offertes, productopties, bestelling, betaling, verzending, retouren, reviews, accounts, privacy, storingen en algemene wetenschap/techniekvragen.
- De antwoorden zijn uitgebreider en geven aan wanneer iets afhangt van product, materiaal, voorraad of beheerinstellingen. Onbekende bedrijfsregels, prijzen, klantgegevens en verborgen voorraad worden niet verzonnen.
- De FAQ-herkenning vergelijkt ook woorden met kleine typefouten en herkent meer natuurlijke vraagformuleringen.
- Productaantallen, prijzen, kleuren, productopties en beschikbaarheid blijven waar mogelijk uit de actuele openbare productgegevens komen; de extra kennisbank vervangt deze dynamische gegevens niet.
- De twee bestaande handmatige zoekopties bij het pijltje naast de verzendknop blijven behouden.
- Dit blijft een FAQ-/regelgestuurde assistent, geen vrij generatief AI-model. Een FAQ kan nooit letterlijk iedere willekeurige vraag beantwoorden; onbekende of actuele feiten moeten via de internetzoekoptie worden gecontroleerd.

### Testen versie 33

- Test algemene vragen zoals “Wat is 3D-printen?”, “Wat is infill?”, “Wat is het verschil tussen PLA en PETG?” en “Wat is een STL-bestand?”.
- Test webshopvragen zoals levertijd, verzendkosten, account, betaling, retouren, offerte, maatwerk, eigen tekst, kleuren, productaantal en voorraad.
- Test typefouten zoals “wat is filaament?” en “hoe werkt 3d prinen?”.
- Test dat er bij een vraag over persoonlijke bestellingen, wachtwoorden, adressen of betaalgegevens geen persoonlijke informatie wordt opgehaald of verstuurd.
- Test “Zoek in mijn webshop” en “Zoek op het internet” apart; deze handmatige opties blijven buiten de gewone FAQ-modus.


## Versie 33 — uitgebreide FAQ-kennisbank

- De chatbot bevat nu de oorspronkelijke 43 webshoponderwerpen plus 150 aanvullende kennisbankonderwerpen.
- De aanvullende onderwerpen behandelen onder meer: de basis van 3D-printen, FDM, materialen PLA/PETG/ABS/TPU, sterkte, hitte, water, voedselveiligheid, laaglijnen, supports, infill, tolerantie, nabewerking, bestandsformaten STL/3MF, slicers, ontwerpbestanden, offertes, productopties, bestelling, betaling, verzending, retouren, reviews, accounts, privacy, storingen en algemene wetenschap/techniekvragen.
- De antwoorden zijn uitgebreider en geven aan wanneer iets afhangt van product, materiaal, voorraad of beheerinstellingen. Onbekende bedrijfsregels, prijzen, klantgegevens en verborgen voorraad worden niet verzonnen.
- De FAQ-herkenning vergelijkt ook woorden met kleine typefouten en herkent meer natuurlijke vraagformuleringen.
- Productaantallen, prijzen, kleuren, productopties en beschikbaarheid blijven waar mogelijk uit de actuele openbare productgegevens komen; de extra kennisbank vervangt deze dynamische gegevens niet.
- De twee bestaande handmatige zoekopties bij het pijltje naast de verzendknop blijven behouden.
- Dit blijft een FAQ-/regelgestuurde assistent, geen vrij generatief AI-model. Een FAQ kan nooit letterlijk iedere willekeurige vraag beantwoorden; onbekende of actuele feiten moeten via de internetzoekoptie worden gecontroleerd.

### Testen versie 33

- Test algemene vragen zoals “Wat is 3D-printen?”, “Wat is infill?”, “Wat is het verschil tussen PLA en PETG?” en “Wat is een STL-bestand?”.
- Test webshopvragen zoals levertijd, verzendkosten, account, betaling, retouren, offerte, maatwerk, eigen tekst, kleuren, productaantal en voorraad.
- Test typefouten zoals “wat is filaament?” en “hoe werkt 3d prinen?”.
- Test dat er bij een vraag over persoonlijke bestellingen, wachtwoorden, adressen of betaalgegevens geen persoonlijke informatie wordt opgehaald of verstuurd.
- Test “Zoek in mijn webshop” en “Zoek op het internet” apart; deze handmatige opties blijven buiten de gewone FAQ-modus.


## Versie 34 – chatbot herstel en 300 extra FAQ-vraagvarianten

Deze versie bevat 300 aanvullende FAQ-items in `assistant-faq-300.js` naast de bestaande kennisbank. De chatknop heeft daarnaast een kleine HTML-noodbediening om het paneel ook te kunnen openen wanneer het JavaScript-modulebestand niet laadt. Dit herstelt de bediening van het paneel, maar het versturen van berichten vereist nog steeds dat `app.js` en de benodigde Firebase-modules correct laden.


## Nieuwe toevoeging — filamentvoorraad downloaden

In Sitebeheer → Filamentbeheer staat nu de knop **Download overzicht**. Die downloadt de actuele Firebase-voorraad als CSV-bestand dat je direct in Excel kunt openen. Het bestand bevat uitsluitend de kolommen **Kleur**, **Materiaal** en **Aantal over (gram)**. Zowel actieve als gepauzeerde filamentkleuren worden opgenomen; de voorraadhoeveelheid wordt uit de meest recente geladen Firebase-gegevens gehaald.
