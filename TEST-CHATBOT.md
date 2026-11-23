# Testchecklist chatbot v24

## Accountvragen
- “Hoe log ik in?” → stappenplan met knop om het loginvenster te openen.
- “Hoe maak ik een account aan?” → 3–20 tekens, toegestane tekens, e-mailadres en wachtwoord van minimaal 8 tekens.
- “Wachtwoord vergeten” → vermeldt dat er momenteel geen automatische resetfunctie is en stuurt nooit om het wachtwoord.
- “Hoe wijzig ik mijn gebruikersnaam?” → accountmenu en naamregels.
- “Hoe log ik uit?” → gebruikersnaam bovenaan → Uitloggen.
- “Hoe log ik in als beheerder?” → verwijst naar het afgeschermde Sitebeheer en geeft geen wachtwoorden.

## Openbaar zoeken zonder API-sleutel
- “Zoek op internet naar 3D-printen” → zoekt Wikipedia via MediaWiki Action API met origin=* en toont maximaal drie bronacties.
- Dezelfde zoekvraag biedt “Volledige webresultaten openen” in DuckDuckGo.
- Onbekende vraag → probeert de openbare Wikipedia-zoekfunctie.
- Als Wikipedia onbereikbaar is, blijft DuckDuckGo als handmatige zoekactie beschikbaar.
- Geen API-sleutel, externe AI-key of Firebase-write nodig.

## Bestaande webshopvragen
- levertijd maximaal 14 dagen; verzending € 3,95; ophalen gratis.
- filamentkleuren en beschikbaarheid per product.
- eigen tekst, maatwerkofferte, productprijzen, 3D-preview.
- bestellingen, chats, favorieten, reviews, retouren, contact en privacy.

## Technisch
- `node --check --input-type=module < app.js`
- Testscript voor de intent-herkenning.
- `unzip -t` voor de definitieve ZIP.
- Live Firebase-gegevens en browser-CORS zijn niet te simuleren met een statische syntaxcheck; test de gepubliceerde GitHub Pages-site ook werkelijk.
