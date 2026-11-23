# Testchecklist chatbot v28 — uitgebreide webshop-FAQ + online zoeken

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

## Online zoeken
- Stel een algemene vraag zonder "zoek op internet"; controleer dat een niet-FAQ-vraag online wordt opgezocht.
- Stel expliciet een online zoekvraag; controleer antwoord, webbronlinks en de knoppen Google, Bing, DuckDuckGo en Brave.
- Controleer dat bronlinks in een nieuw tabblad openen.
- Controleer dat een onbereikbare of begrensde zoekdienst een nette melding geeft en directe zoekmachine-links toont.
- De sleutelvrije Tavily-functie is gratis en heeft een gebruikslimiet; deze limiet/uptime wordt door Tavily beheerd.

## Privacy en veiligheid
- Controleer dat de chatbot geen klantorders, offertes, chats, accountprofielen of adressen uit Firebase uitleest.
- Test met een fictief e-mailadres, telefoonnummer, postcode, IBAN, ingevulde gebruikersnaam/wachtwoord, klant-/bestelnummer, trackingcode of huisadres; de vraag mag niet naar Tavily worden doorgestuurd.
- Controleer dat er niet om wachtwoorden, herstelcodes, betaalkaartgegevens of adresgegevens wordt gevraagd.
- Controleer dat chatberichten niet in Firebase worden opgeslagen.
- Controleer dat de zoekopdracht alleen als vraagtekst naar Tavily gaat en dat geen Firebase-records worden meegestuurd.
- Controleer dat zoekresultaten als onbetrouwbare externe bron worden behandeld en dat links veilig in een nieuw tabblad openen.

## Technisch
- `node --check --input-type=module < app.js`
- `unzip -t` op de uiteindelijke ZIP.
- Test de Tavily-fetch in de echte gepubliceerde GitHub Pages-omgeving; externe diensten kunnen CORS, rate-limits of tijdelijke storingen hebben.


## Reparatie online zoeken v28
- Test een niet-FAQ webshopvraag: de bot probeert Tavily keyless en valt bij fouten terug op DuckDuckGo/Bing via de openbare GET-proxy.
- Controleer dat zoekresultaatkaarten titels, samenvattingen en externe bronlinks tonen.
- Herhaal dezelfde zoekvraag binnen drie minuten: de tijdelijke browsercache moet onnodige herhaalverzoeken beperken.
- Controleer dat de lange tekst onder het chat-invoerveld verwijderd is.
