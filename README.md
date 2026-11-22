# 3D Printed Shop — gratis GitHub/Firebase-editie (v14)

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
