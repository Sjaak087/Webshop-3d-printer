# Testchecklist chatbot v29 — gesprek + Wikipedia + DuckDuckGo

## Start en apparaat
- Open de webshop in een recente browser op desktop en mobiel.
- Open de vaste knop rechtsonder en stel een vraag.
- Controleer dat er geen WebGPU-check, AI-modeldownload of lokale AI-initialisatie verschijnt.
- Controleer de denk-indicator en dat het invoerveld tijdens een zoekopdracht is uitgeschakeld.

## Webshop-FAQ en live productgegevens
- Test verzendkosten (€3,95), gratis ophalen en de vermelde maximale levertijd (14 dagen).
- Test bestellen, winkelwagen, account aanmaken, inloggen, gebruikersnaam wijzigen en wachtwoord vergeten.
- Test Tikkie/betaallink, betaalstatus en dat de chatbot geen eigen bestelling uitleest.
- Test retouren (14 dagen na ontvangst/ophalen), reviews, favorieten en klantenchat.
- Test maatwerkofferte: login, titel-/beschrijvingslimieten, afmetingen en afbeeldingseisen.
- Test actieve filamentkleuren, materiaalsoorten, productopties, meerprijzen en uitverkochte opties.
- Test catalogusvragen en controleer dat productnamen, basisprijzen en beschikbaarheid uit de geladen webshopdata komen.
- Test STL/3MF-preview, onderdeelkleuren, Bambu Studio, OrcaSlicer en PrusaSlicer.
- Test camera, printstatus, privacy, cookies, contactpagina en voorwaarden.

## Gewoon gesprek en online zoeken
- Start met “hoi”: de bot reageert als gesprekspartner en stuurt geen zoekopdracht.
- Test “hoe gaat het?”, “bedankt”, “ik verveel me” en “ik had een leuke dag”.
- Test een gewone vraag zonder de woorden “zoek op internet”; bijvoorbeeld “Wat is een vulkaan?”
- Controleer dat Wikipedia NL wordt doorzocht en dat Wikipedia-titels, samenvattingen en bronlinks verschijnen.
- Controleer dat DuckDuckGo Instant Answers wordt geraadpleegd en dat een directe samenvatting of gerelateerde onderwerpen verschijnen wanneer beschikbaar.
- Controleer dat de volledige DuckDuckGo-resultaten via de DuckDuckGo-zoeklink openen. De officiële Instant Answer API levert geen volledige SERP-resultaten.
- Test een vervolgbericht als “en waarom?”; de vorige onderwerpvraag moet als context worden meegenomen.
- Test een onderwerp waarvoor geen directe samenvatting bestaat; de bot mag niet zeggen dat de zoekdienst niet bereikbaar is alleen omdat er geen instant answer is, maar moet de volledige zoeklinks tonen.
- Controleer dat een onbereikbare API een nette foutmelding geeft en dat directe Wikipedia- en DuckDuckGo-links beschikbaar blijven.

## Privacy en veiligheid
- Controleer dat de chatbot geen klantorders, offertes, chats, accountprofielen of adressen uit Firebase uitleest.
- Test met een fictief e-mailadres, telefoonnummer, postcode, IBAN, ingevulde gebruikersnaam/wachtwoord, klant-/bestelnummer, trackingcode of huisadres; de vraag mag niet naar Wikipedia en DuckDuckGo worden doorgestuurd.
- Controleer dat er niet om wachtwoorden, herstelcodes, betaalkaartgegevens of adresgegevens wordt gevraagd.
- Controleer dat chatberichten niet in Firebase worden opgeslagen.
- Controleer dat de zoekopdracht alleen als vraagtekst naar Wikipedia en DuckDuckGo gaat en dat geen Firebase-records worden meegestuurd.
- Controleer dat zoekresultaten als onbetrouwbare externe bron worden behandeld en dat links veilig in een nieuw tabblad openen.

## Technisch
- `node --check --input-type=module < app.js`
- `unzip -t` op de uiteindelijke ZIP.
- Test de Wikipedia en DuckDuckGo-fetch in de echte gepubliceerde GitHub Pages-omgeving; externe diensten kunnen CORS, rate-limits of tijdelijke storingen hebben.


## Beperkingen
- Dit is een brongebaseerde gesprekshulp, geen volledig generatief taalmodel. De korte praatreacties zijn ingebouwde gespreksreacties; feitelijke vragen worden opgezocht en op basis van de bronfragmenten samengevat.
- DuckDuckGo's gratis Instant Answer API geeft directe antwoorden/gerelateerde onderwerpen, geen volledige lijst met zoekresultaten. Voor volledige DuckDuckGo-resultaten opent de gebruiker de zoekpagina zelf.
- Wikipedia wordt via de publieke MediaWiki-API opgezocht met `origin=*`; raadpleeg de officiële API-documentatie voor CORS-gebruik.
