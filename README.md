# 3D Printed Shop — Dashboard, voorraad, favorieten en 3D-configurator (v9)

## Nieuwe functies in versie 9
- 3D-modellen uploaden tot 10 MB zonder compressie in de browser.
- Modelbestanden opslaan in Firebase Storage en ze achteraf comprimeren met een apart Node-script.
- Bestaande dashboard-, voorraad-, favorieten- en configuratorfuncties uit versie 8 blijven behouden.

## Bestaande functies uit versie 8

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
- Uploadlimiet: maximaal 10 MiB (10 MB in de beheerweergave) per bestand. Het originele bestand wordt zonder browsercompressie rechtstreeks naar Firebase Storage geüpload.
- Het productrecord in Realtime Database bewaart alleen bestandsmetadata en het Storage-pad. De 3D-viewer haalt het modelbestand op wanneer de productpagina wordt geopend.
- Later comprimeren: het meegeleverde beheerscript `functions/scripts/compress-product-models.cjs` scant de productmodellen, maakt een gzip-kopie als die kleiner is, past daarna het Storage-pad in Realtime Database aan en verwijdert pas vervolgens het grotere origineel. Bij 3MF-bestanden levert gzip meestal weinig of geen winst op; die blijven dan ongewijzigd.
- Een STL-bestand wordt als één kleurdeel behandeld. Bij 3MF worden de meshes als onderdelen gegroepeerd; om maximaal acht kleurkeuzes overzichtelijk te houden worden extra meshes samengevoegd onder “Overige onderdelen”.
- De klant kan het model draaien en per modelonderdeel een kleur kiezen. Alleen kleurstaaltjes die bij dat product als kleurcode (`colorHex`) zijn ingesteld en niet op uitverkocht staan, zijn beschikbaar.
- Oude modellen uit versie 8 die als Base64 in Realtime Database zijn opgeslagen blijven leesbaar. Nieuwe uploads gebruiken Firebase Storage.

## Publiceren
1. Schakel Cloud Storage for Firebase in voor project `webshop-3cf70` en controleer in Firebase Console welk opslagbucket actief is. Het project verwacht `webshop-3cf70.firebasestorage.app`.
2. Vervang de bestaande Firebase Hosting-bestanden door alle bestanden uit deze ZIP.
3. Publiceer `database.rules.json` via Firebase Console → Realtime Database → Rules en `storage.rules` via Firebase Console → Storage → Rules (of gebruik Firebase CLI). Controleer eerst bestaande regels; deze bestanden vervangen de regels die je publiceert.
4. Stel voor browserdownloads de CORS-instellingen in met het meegeleverde `cors.json` en de opdracht uit het onderdeel “Modellen comprimeren”.
5. Test met een testproduct: upload een klein STL/3MF-bestand, sla het product op en open de productpagina om te controleren of de viewer het bestand kan laden.
6. Vernieuw de website met Ctrl+Shift+R of wis de sitecache op mobiel.

## Modellen comprimeren na upload
1. Ga lokaal naar de map `functions` en voer `npm install` uit.
2. Maak in Firebase Console een service-account voor serverbeheer en download het JSON-sleutelbestand. Bewaar het buiten de webshopmap en deel het nooit. Stel daarna `GOOGLE_APPLICATION_CREDENTIALS` in naar het bestandspad (PowerShell: `$env:GOOGLE_APPLICATION_CREDENTIALS="C:\pad\service-account.json"`).
3. Voer vanuit de map `functions` `npm run compress:models` uit. Het script verwerkt alleen nieuwe modellen die nog `encoding: raw` hebben. Het comprimeert alleen wanneer gzip kleiner is, werkt eerst de databaseverwijzing bij en verwijdert daarna het origineel.

Voor browserverkeer bevat deze versie `cors.json`, beperkt tot de GitHub Pages-origin `https://sjaak087.github.io`. De meegeleverde scripts stellen deze instelling in op de bucket met de actuele Google Cloud CLI-opdracht `gcloud storage buckets update --cors-file`. CORS is een instelling van de Storage-bucket, niet van GitHub Pages; alleen een ZIP pushen verandert de bucketconfiguratie dus niet. Zie [Google Cloud: CORS instellen](https://cloud.google.com/storage/docs/using-cors) en [Firebase: bestanden downloaden in de browser](https://firebase.google.com/docs/storage/web/download-files).

Krijg je na het uitvoeren van het script nog steeds de melding “Response to preflight request doesn't pass access control check”? Controleer dan in Google Cloud Console of de bucketnaam exact `webshop-3cf70.firebasestorage.app` is, of Cloud Storage voor dit Firebase-project is ingeschakeld en of de Storage-regels zijn gepubliceerd. De browser kan bij een mislukte preflight de onderliggende 403/404 verbergen als CORS-melding. De uploadfunctie toont nu Firebase-foutcodes waar die beschikbaar zijn; bekijk ook de browserconsole.

Het script draait niet automatisch bij iedere upload; je voert het uit wanneer je de nieuw geüploade modellen wilt comprimeren. Zorg dat alleen een vertrouwde beheerder het script en de service-accountgegevens gebruikt.

## Grenzen en aandachtspunten
- De 3D-preview is een browserweergave voor kleurkeuze en rotatie, geen slicer. Hij berekent geen printtijd, filamentgebruik, supports, prijs of daadwerkelijke printbaarheid.
- Een STL bevat doorgaans één mesh en heeft daarom één instelbare kleur. Gebruik 3MF wanneer het ontwerp uit meerdere afzonderlijke onderdelen bestaat die ieder apart gekleurd moeten kunnen worden.
- Nieuwe modelbestanden staan in Firebase Storage; alleen metadata en het bestandspad staan in Realtime Database. Dit voorkomt dat grote Base64-bestanden productrecords en databaseverkeer opblazen.
- De meegeleverde Storage-regels laten openbare modeldownloads toe en nieuwe uploads tot 10 MiB toe in `product-models/`; bestaande bestanden kunnen via de browser niet worden overschreven of verwijderd. Omdat de webshop nog een eigen client-side accountsysteem gebruikt en geen Firebase Authentication voor beheerders, kan de uploadregel niet betrouwbaar vaststellen of de uploader echt beheerder is. Iedereen kan daardoor technisch een bestand tot 10 MiB uploaden naar deze map. Voor een openbare winkel is server-side autorisatie of Firebase Authentication met beheerdersrollen sterk aan te raden; houd opslaggebruik in de gaten.
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
