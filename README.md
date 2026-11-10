# NovaShop – bijgewerkte webshop

Deze versie bevat:
- Firebase Realtime Database voor producten, bestellingen en chats.
- Winkelwagen met live totaal aantal stuks en plus/min-knoppen.
- Chat met automatisch aanklikbare http(s)-links.
- Herkenbare Tikkie-links met een duidelijke knop om het betaalverzoek te openen.
- Chatvenster met duidelijkere indeling, berichtrollen en tijdstippen.
- `favicon.ico`.

## Productafbeeldingen uploaden: vereiste Firebase-instelling

De browserconsole-fout `preflight request does not pass access control check` is een CORS-fout van de Storage-bucket. Alleen de websitecode of ZIP aanpassen kan de bucketconfiguratie niet wijzigen.

1. Open Google Cloud Console / Cloud Shell voor Firebase-project `webshop-3cf70`.
2. Upload `cors.json` naar Cloud Shell.
3. Voer uit:

```bash
gcloud storage buckets update gs://webshop-3cf70.firebasestorage.app --cors-file=cors.json
```

4. Controleer de exacte bucketnaam in Firebase Console > Storage als Google Cloud de bucket niet vindt.
5. Controleer Firebase Console > Storage > Rules en zorg dat de regels uploads toestaan voor de accounts die mogen beheren.
6. Wacht even, herlaad de GitHub Pages-site en probeer één afbeelding te uploaden.

CORS en Storage Security Rules zijn twee verschillende instellingen. Een upload kan nog steeds worden geweigerd door Storage Rules, ook als CORS correct is. Deel bij een volgende fout de volledige foutcode uit de browserconsole (bijvoorbeeld `storage/unauthorized` of `storage/unknown`).

## Belangrijk over "echte versie"

Deze frontend houdt nog de eerder gevraagde login zonder Firebase Authentication aan. De huidige `database.rules.json` staat lezen en schrijven open en het beheerderswachtwoord staat in `beheer-config.js`. Dat is bruikbaar als persoonlijke test, maar niet geschikt voor een openbare webshop met echte klantgegevens of echte bestellingen: bezoekers kunnen de JavaScript-code bekijken en rechtstreeks databasegegevens wijzigen.

Voor een echte productieversie zonder Firebase Authentication is een backend (bijvoorbeeld Firebase Cloud Functions) nodig die klantlogins, beheerdersrechten en alle databasebewerkingen controleert. Alleen frontendcode kan dat niet veilig afdwingen. Deze ZIP maakt die backend niet automatisch actief.
