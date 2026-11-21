# 3D Printed Shop — Dashboard, voorraad, favorieten en 3D-configurator

## Nieuwe functies in versie 8

### Omzetdashboard (Sitebeheer → Dashboard)
- Realtime totalen voor geregistreerde bestelwaarde, ontvangen betalingen, open bestellingen en lage voorraad.
- Bestelwaarde van de afgelopen zeven dagen, populairste producten en recente bestellingen.
- Let op: het dashboard gebruikt de bestel- en betaalstatus die in Firebase zijn opgeslagen. Het is geen boekhoudpakket en berekent geen belasting, terugbetalingen of nettowinst.

### Voorraadbeheer (Sitebeheer → Voorraad)
- Per product kan voorraadregistratie worden ingeschakeld, met aantallen en een waarschuwingsgrens.
- Bij nul voorraad is het product niet bestelbaar.
- Bij het aanmaken van een normale of chatbestelling wordt de beschikbare voorraad met een Realtime Database-transactie gereserveerd/afgeboekt.
- Als het aanmaken van de order mislukt, probeert de app de voorraadreservering terug te draaien.

### Favorieten
- Een hartknop staat bij elke productkaart; de favorieten zijn ook via het hart in de navigatie te openen.
- Voor bezoekers worden favorieten lokaal in de browser bewaard.
- Voor ingelogde klanten worden favorieten aan het profiel gekoppeld en tussen apparaten gesynchroniseerd.

### STL- en 3MF-productconfigurator
- In Sitebeheer → Producten → Bewerken kan per product één STL- of 3MF-bestand worden toegevoegd.
- Het bestand wordt in de browser gecomprimeerd voordat het naar Firebase Realtime Database gaat. Gzip wordt alleen gebruikt wanneer het resultaat kleiner is; een 3MF is zelf al een ZIP-container en wordt doorgaans ongewijzigd bewaard wanneer gzip geen winst oplevert.
- Bronbestandlimiet: 25 MB. Opgeslagen modeldata: maximaal 1,5 MB gecomprimeerde binaire data (circa 2,0 MB als Base64 in Realtime Database). Grotere modellen worden geweigerd om de databank niet onnodig te vullen.
- De klant kan het model draaien en per modelonderdeel een kleur kiezen. Alleen kleurstaaltjes die bij dat product als kleurcode (`colorHex`) zijn ingesteld en niet op uitverkocht staan, zijn beschikbaar.
- Een STL-bestand wordt als één kleurdeel behandeld. Bij 3MF worden de meshes als onderdelen gegroepeerd; om maximaal acht kleurkeuzes overzichtelijk te houden worden extra meshes samengevoegd onder “Overige onderdelen”.
- De kleurkeuzes worden aan winkelwagenregel, bestelling en openbare track & trace toegevoegd.
- De viewer gebruikt Three.js 0.170.0 vanaf jsDelivr. De browser heeft daarom internettoegang nodig om de 3D-loader en Three.js modules op te halen.

## Publiceren
1. Vervang de bestaande Firebase Hosting-bestanden door alle bestanden uit deze ZIP.
2. Publiceer `database.rules.json` via Firebase Console → Realtime Database → Rules. De regels bevatten nu validatie voor modeldata, voorraadaantallen en favorieten. De regels uit jouw Firebase-project worden hiermee vervangen; controleer ze voordat je publiceert.
3. Test met een testproduct: voeg een klein STL/3MF-bestand toe, stel minstens één productoptie in met een kleurstaaltje, voeg het product aan de winkelwagen toe en plaats een testbestelling om de voorraadtransactie te controleren.
4. Vernieuw de website met Ctrl+Shift+R of wis de sitecache op mobiel.

## Grenzen en aandachtspunten
- De 3D-preview is een browserweergave voor kleurkeuze en rotatie, geen slicer. Hij berekent geen printtijd, filamentgebruik, supports, prijs of daadwerkelijke printbaarheid.
- Een STL bevat doorgaans één mesh en heeft daarom één instelbare kleur. Gebruik 3MF wanneer het ontwerp uit meerdere afzonderlijke onderdelen bestaat die ieder apart gekleurd moeten kunnen worden.
- De modelbestanden worden in Realtime Database bewaard als gecomprimeerde Base64-data. Dat is handig voor kleine modellen maar minder efficiënt dan Firebase Storage voor veel/grote modellen. Voor een grote catalogus is Firebase Storage met toegangsregels en metadata in Realtime Database de betere schaalbare oplossing.
- De bestaande app gebruikt nog een eigen client-side accountsysteem en bestaande brede lees-/schrijfrechten. Favorieten zijn handig maar niet privacy-afgeschermd tegen willekeurige databaselezers zolang Firebase Authentication en gebruikersgebonden regels niet zijn ingericht. Ook orders, chats, offertes, instellingen en productmodellen zijn door de bestaande brede regels niet privé beschermd. Zet deze site niet met echte gevoelige klantinformatie of vertrouwelijke modelbestanden live voordat authenticatie, strikte database- en Storage-regels en server-side validatie zijn geregeld.
- Dashboardbedragen zijn gebaseerd op de huidige orderrecords. Controleer betaalstatussen zelf in je betaalomgeving; er is geen automatische boekhoud- of bankkoppeling.
- Live verbinding met jouw eigen Firebase-project is niet door deze lokale codecontrole gevalideerd.

## Reeds aanwezige functies die behouden blijven
- Offerte aanvragen voor eigen producten met titel, beschrijving, afbeelding, L/B/H tot 180 mm en kleurkeuze.
- Offertes bekijken, chatten, omzetten naar bestelling en verwijderen.
- Productcategorieën beheren en filteren op de homepage.
- Gedeelde/live productkeuzes met kleurstaaltjes, prijsverschillen en uitverkochtstatus.
- Foto's in chats vooraf lokaal verkleinen.
- Reviews per product (sterren, titel en beschrijving) na bezorging/ophalen.
- Algemene voorwaarden, contactpagina, verzendkosten, bestellingen, chat en track & trace.
