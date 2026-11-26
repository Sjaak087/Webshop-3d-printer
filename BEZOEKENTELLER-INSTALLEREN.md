# Bezoekenteller installeren

De bezoekenteller draait in een aparte module: `visitor-counter.js`. Daardoor werkt hij onafhankelijk van `app.js`, klantaccounts en Sitebeheer. Niemand hoeft als beheerder ingelogd te zijn en Sitebeheer hoeft niet open te staan. Iedere volledige opening of herlaadbeurt van de webshop verhoogt `analytics/daily/JJJJ-MM-DD/visits` met precies 1. Dezelfde persoon kan dus onbeperkt opnieuw meetellen, ook meerdere keren op één dag.

Alle bezoekers gebruiken de kalenderdag van `Europe/Amsterdam`, zodat het dashboard en bezoekers uit andere tijdzones dezelfde dagtotalen zien. Er worden geen IP-adressen, namen, e-mailadressen, bezoekers-ID's, cookies of sessiemarkers opgeslagen voor de bezoekenteller. Alleen een geaggregeerd dagtotaal wordt bewaard.

## Firebase-regels publiceren

Alleen bestanden naar GitHub uploaden werkt de Firebase Database-regels niet bij. Publiceer ook de meegeleverde `database.rules.json`:

1. Open Firebase Console en kies project `webshop-3cf70`.
2. Open **Realtime Database**.
3. Ga naar **Rules**.
4. Neem de inhoud van `database.rules.json` over en klik op **Publish**.

De regels staan alleen een verhoging met precies 1 toe voor de openbare bezoekenteller. De transactie voorkomt dat gelijktijdige bezoekers elkaars verhoging overschrijven.

## Testen

1. Publiceer de volledige projectmap op GitHub Pages.
2. Publiceer de Firebase-regels zoals hierboven beschreven.
3. Open de webshop in twee verschillende browsers/apparaten. Iedere volledige paginalading hoort het dagtotaal met 1 te verhogen.
4. Vernieuw een browser een aantal keer. Elke herlaadbeurt hoort opnieuw te tellen.
5. Sluit Sitebeheer en log uit. Open de webshop vanuit een andere browser: het aantal wordt nog steeds direct in Firebase bijgewerkt.
6. Open later **Sitebeheer → Statistieken**. Het dashboard leest de opgeslagen totalen live uit Firebase.

## Grenzen

De eigenaar hoeft niet online te zijn, maar de browser van de bezoeker moet wel internet hebben om de website en Firebase te bereiken. Als de bezoeker offline is of Firebase niet bereikbaar is, kan het bezoek niet direct worden opgeslagen. Omdat de teller publiek bereikbaar is en bewust onbeperkt +1 toestaat, is hij geschikt als indicatieve teller en niet als fraudebestendige boekhoudregistratie.
