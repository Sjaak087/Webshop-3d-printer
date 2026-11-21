# 3D Printed Shop — gratis GitHub/Firebase-editie (v12)

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
