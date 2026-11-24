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


## v31 aanvullingen
- [x] Twee zoekacties staan in menu naast de gewone verzendknop.
- [x] Gewoon verzenden start geen automatische online zoekopdracht.
- [x] Productaantal wordt dynamisch berekend uit actieve catalogusgegevens nadat `state.loaded` waar is.
- [x] Beschikbare en niet-bestelbare aantallen worden apart vermeld.
- [x] Goedkoopste/duurste producten komen uit het actuele assortiment.
- [ ] Live Firebase-data, live zoekdiensten en gebruikerservaring moeten op de gepubliceerde site worden getest.


## v32 — maatwerk-printherkenning en bredere gesprekmodus
- Vraag “Kunnen jullie een product dat nog niet in de webshop staat 3D-printen?”: de bot legt uit dat dit via een offerteaanvraag loopt en toont de knop “Offerte aanvragen”.
- Vraag met een typefout, bijvoorbeeld “Kunnen jullie een kerstbooom voor oma 3d printen?” als “Kerstboom voor oma” in de catalogus staat: de fuzzy productnaamherkenning moet het bestaande product vinden en niet onterecht een offerte eisen.
- Vraag naar een onbekend product, bijvoorbeeld “Kunnen jullie een bureaunaamplaatje 3d printen?” als dat niet in de catalogus staat: de bot verwijst naar maatwerkofferte.
- “Ik wil mijn huiswerk uitprinten” mag niet als 3D-printofferte worden gezien.
- Gewone gespreksprompts over hobby's, sport, games, muziek, gevoelens, school, films, dieren, ruimte en techniek krijgen een onderwerpgerichte reactie en een natuurlijke vervolgvraag.
- Opinievragen zoals “Wat vind jij van ...?” krijgen een afgewogen reactie zonder te doen alsof de bot persoonlijke ervaringen heeft.
- Extra gespreksthema’s: favoriete dieren/kleuren/games, “hoe was je dag?”, gevoelens/hobby’s, vakantieplannen, grappen, raadsels, weetjes, een korte verhaalstarter en een mini-quiz.
- Dit blijft regelgestuurde gespreksondersteuning; voor werkelijk willekeurige, contextueel redenerende antwoorden is een generatief AI-model nodig.


## v33 — uitgebreide FAQ-kennisbank

- [x] Extra FAQ-module toegevoegd met 150 aanvullende onderwerpen.
- [x] FAQ-zoekmatch uitgebreid met fuzzy matching voor kleine typefouten.
- [x] Actuele catalogus-/prijs-/kleur-/voorraadfuncties blijven dynamisch.
- [x] Twee expliciete zoekopties blijven aanwezig bij de verzendknop.
- [ ] Test in een echte browser op GitHub Pages met live Firebase-productgegevens.
- [ ] Controleer dat externe Wikipedia/DuckDuckGo-aanroepen vanuit het gepubliceerde domein blijven werken.

Aanbevolen controlevragen: “Wat is 3D-printen?”, “Waarom zie je laagjes?”, “Wat is infill?”, “Wat is het verschil tussen PLA en PETG?”, “Kan een print tegen hitte?”, “Kan ik een foto laten printen?”, “Wat moet er in een offerte?”, “Hoe lang duurt een print?”, “Wat is STL?”, “Hoe werkt een slicer?”, “Wat betekent in de maak?”, “Hoe werkt retourneren?”, “Wat als mijn kleur uitverkocht is?”, “Wat is Firebase?” en “Wat is zwaartekracht?”.


## v33 — uitgebreide FAQ-kennisbank

- [x] Extra FAQ-module toegevoegd met 150 aanvullende onderwerpen.
- [x] FAQ-zoekmatch uitgebreid met fuzzy matching voor kleine typefouten.
- [x] Actuele catalogus-/prijs-/kleur-/voorraadfuncties blijven dynamisch.
- [x] Twee expliciete zoekopties blijven aanwezig bij de verzendknop.
- [ ] Test in een echte browser op GitHub Pages met live Firebase-productgegevens.
- [ ] Controleer dat externe Wikipedia/DuckDuckGo-aanroepen vanuit het gepubliceerde domein blijven werken.

Aanbevolen controlevragen: “Wat is 3D-printen?”, “Waarom zie je laagjes?”, “Wat is infill?”, “Wat is het verschil tussen PLA en PETG?”, “Kan een print tegen hitte?”, “Kan ik een foto laten printen?”, “Wat moet er in een offerte?”, “Hoe lang duurt een print?”, “Wat is STL?”, “Hoe werkt een slicer?”, “Wat betekent in de maak?”, “Hoe werkt retourneren?”, “Wat als mijn kleur uitverkocht is?”, “Wat is Firebase?” en “Wat is zwaartekracht?”.


## Extra controle versie 34
- [ ] Open de webshop en klik op **Vraag het de bot**; het paneel moet openen en sluiten.
- [ ] Verstuur een gewone chatvraag.
- [ ] Kies apart **Zoek in mijn webshop** en **Zoek op het internet**.
- [ ] Test een aantal onderwerpen uit de 300 extra FAQ-items.
- [ ] Controleer bij problemen de browserconsole en netwerkfouten voor `app.js`, `assistant-faq-300.js` en Firebase.
