# Testchecklist chatbot v30 — aanbevelingen en handmatig zoeken

## Gewoon antwoorden (standaard)
- De standaardkeuze is “Gewoon antwoorden / advies”.
- “Hoi”, “Hoe gaat het?” en gewone gesprekjes starten geen zoekopdracht.
- Vraag “Welk product zou jij het meeste aanraden?”: de chatbot rangschikt actieve, beschikbare producten op basis van bestelbaarheid, reviews, beschikbare productinformatie en functies.
- De chatbot toont waarom de eerste keuze wordt aanbevolen en maximaal twee alternatieven.
- Controleer dat de bot niet doet alsof hij verkoopcijfers of verborgen voorraadgegevens kent.
- Test een vraag over een concreet product: actuele productnaam, basisprijs, beschrijving en openbare opties moeten uit de geladen catalogus komen.
- Test verzendkosten (€3,95), gratis ophalen en maximale levertijd 14 dagen.

## Expliciet zoeken kiezen bij verzenden
- Kies “Zoek in mijn webshop”: zoekt lokaal in geladen productgegevens, productbeschrijvingen en uitgebreide FAQ. Er wordt geen externe zoekdienst aangeroepen.
- Kies “Zoek op het internet”: raadpleegt Wikipedia NL/EN en DuckDuckGo Instant Answers; volledige zoekpagina-links worden getoond.
- Zet de keuze terug op “Gewoon antwoorden / advies”: er mag niet automatisch een webzoekopdracht volgen bij een onbekende algemene vraag.
- Test dat de modus-selector en verzendknop worden uitgeschakeld tijdens verwerking en daarna weer actief worden.
- Test de suggestieknop “Web zoeken”: die moet de internetmodus gebruiken.

## Privacy en veiligheid
- Test een fictief e-mailadres, telefoonnummer, postcode, IBAN, wachtwoord, herstelcode, bestelnummer, trackingcode of huisadres; de vraag mag niet worden doorgestuurd naar een zoekdienst.
- Controleer dat de chatbot geen klantorders, offertes, privéchats, accountprofielen of adressen uit Firebase uitleest.
- Controleer dat chatberichten niet in Firebase worden opgeslagen.

## Technisch
- `node --check app.js`
- `unzip -t` op de uiteindelijke ZIP.
- De echte browserverbinding met Wikipedia/DuckDuckGo moet na publicatie op GitHub Pages worden getest; externe API's kunnen CORS/rate-limits hebben.

## Beperking
Deze versie is geen volledig generatief taalmodel. De standaardmodus gebruikt de uitgebreide webshopkennis, gesprekspatronen en een transparante productrangschikking. De gebruiker kiest zelf wanneer een lokale webshopzoekactie of externe online zoekactie wordt uitgevoerd.
