# NovaShop - demo zonder Firebase Authentication

Deze demo gebruikt **Firebase Realtime Database**. Firebase Authentication wordt niet meer gebruikt.

## Sitebeheer demo-inlog
- E-mail: beheer@jouwdomein.nl
- Wachtwoord: NovaShop123!

Pas deze gegevens aan in `beheer-config.js`.

## Klantenaccounts
Registratie en login lezen/schrijven klantprofielen onder `users` in Realtime Database. In deze speeldemo wordt het wachtwoord als gewone tekst opgeslagen.

## LET OP
Dit is bewust een onbeveiligde demo. `database.rules.json` en `storage.rules` staan volledig open. Iedereen kan gegevens lezen, wijzigen en verwijderen. Beheerdersgegevens staan in openbare JavaScript en zijn zichtbaar voor bezoekers. Gebruik geen echte klantgegevens of echte wachtwoorden en zet dit niet live als echte webshop.

## Installatie
1. Controleer de Firebase-configuratie in `firebase.js`.
2. Publiceer `database.rules.json` bij Firebase Realtime Database.
3. Publiceer `storage.rules` bij Firebase Storage als je productafbeeldingen wilt uploaden.


## Firebase Storage CORS instellen (voor GitHub Pages)
De uploadfout met `Access-Control-Allow-Origin` kan niet alleen met JavaScript worden opgelost. Stel de CORS-configuratie één keer in op de Firebase Storage-bucket. In deze ZIP staat daarvoor `cors.json`.

Voer dit uit met Google Cloud CLI / gsutil (ingelogd op het Google-account van het Firebase-project):

```bash
gsutil cors set cors.json gs://webshop-3cf70.firebasestorage.app
gsutil cors get gs://webshop-3cf70.firebasestorage.app
```

Of met de nieuwe gcloud-opdracht:

```bash
gcloud storage buckets update gs://webshop-3cf70.firebasestorage.app --cors-file=cors.json
```

Daarna de GitHub Pages-site hard vernieuwen (Ctrl+F5) en opnieuw proberen. Controleer ook in Firebase Console of Storage is ingeschakeld en of de Storage-regels upload toestaan. De CORS-configuratie staat los van de Realtime Database.
