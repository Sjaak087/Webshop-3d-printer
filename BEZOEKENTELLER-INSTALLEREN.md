# Bezoekenteller installeren

De bezoekenteller verhoogt `analytics/daily/JJJJ-MM-DD/visits` bij iedere volledige paginalading. Herhaald openen en vernieuwen telt dus telkens opnieuw. Er wordt geen bezoekers-ID, cookie of `sessionStorage`-marker gebruikt voor deze teller. De opslag bevat alleen een geaggregeerd dagtotaal.

## Belangrijk: Firebase-regels publiceren

Alleen bestanden naar GitHub uploaden werkt niet de Firebase Database-regels bij. Publiceer daarom ook de meegeleverde `database.rules.json`:

1. Open Firebase Console en kies project `webshop-3cf70`.
2. Open **Realtime Database**.
3. Ga naar **Rules**.
4. Neem de inhoud van `database.rules.json` over en klik op **Publish**.

De regels laten de openbare bezoeksteller uitsluitend met precies `+1` verhogen. Andere statistiekvelden hebben ook hun eigen incrementregel.

## Testen

1. Publiceer de bestanden op GitHub Pages en de Database-regels in Firebase.
2. Open de webshop volledig opnieuw of vernieuw de pagina een paar keer.
3. Open **Sitebeheer → Statistieken**.
4. Het aantal bezoeken van vandaag hoort met iedere volledige paginalading met één te stijgen.

Navigeren tussen onderdelen binnen dezelfde geladen pagina telt niet als een nieuwe opening. Vernieuwen of de website opnieuw openen telt wel.
