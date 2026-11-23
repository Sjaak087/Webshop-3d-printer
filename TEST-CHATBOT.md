# Testchecklist chatbot v23

De chatbot is een ingebouwde, lokale assistent. Er is geen externe AI-API, API-sleutel, live internetzoekfunctie of extra Firebase-opslag. Tijdens het verwerken toont de bot een korte indicator.

## Praktische vragen

- Wat is de levertijd? → maximaal 14 dagen.
- Wat kost verzenden? → € 3,95; ophalen is gratis.
- Kan ik mijn eigen tekst laten toevoegen? → legt het tekstveld uit (maximaal 160 tekens) en dat dit per product verschilt.
- Hoe vraag ik een offerte aan? → account, titel/beschrijving, afmetingen tot 180 mm per richting, beschikbare offerte-kleur en afbeelding PNG/JPG/WEBP tot 12 MB.
- Welke filamentkleuren zijn er? → toont actieve Filamentbeheer-kleuren.
- Welke kleuren zijn beschikbaar bij [productnaam]? → productafhankelijke kleurkeuzes en voorraadbeschikbaarheid.
- Hoe volg ik mijn bestelling? → Mijn bestellingen en account-login.
- Hoe werkt betalen? → verwijst naar de actuele betaalinformatie bij Mijn bestellingen.
- Hoe werkt retourneren? → legt de 14-dagen-verzoekperiode uit en noemt de mogelijke uitzondering voor maatwerk.
- Hoe werkt het 3D-voorbeeld? → uitleg over de interactieve productpreview.
- Hoe werkt favorieten? → hartje en Favorieten-navigatie.
- Waar vind ik contact? → toont de ingestelde contactgegevens.

## Technische controles

- JavaScript syntaxcheck: `node --check --input-type=module < app.js`
- HTML en verwijzingen op duplicaten controleren.
- ZIP-integriteit controleren met `unzip -t`.
- Visueel testen op desktop, laptop en mobiel.
- Live Firebase-gegevens zijn afhankelijk van het gekoppelde Firebase-project en kunnen niet door een offline ZIP-test worden bevestigd.
