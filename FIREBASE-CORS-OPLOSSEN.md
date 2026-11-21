# Firebase Storage CORS-fout oplossen

De webshop draait op `https://sjaak087.github.io` en gebruikt de bucket `webshop-3cf70.firebasestorage.app`. CORS wordt op de Storage-bucket ingesteld; een commit naar GitHub Pages past dit niet automatisch toe.

## Windows

1. Installeer de Google Cloud CLI als die nog niet aanwezig is.
2. Open PowerShell in de uitgepakte projectmap.
3. Voer `gcloud auth login` uit en meld aan met het Google-account dat rechten heeft op bucket `webshop-3cf70.firebasestorage.app`.
4. Voer `./configure-storage-cors.ps1` uit.

## macOS / Linux

1. Installeer de Google Cloud CLI.
2. Voer `gcloud auth login` uit.
3. Open de projectmap en voer `bash ./configure-storage-cors.sh` uit.

Het script stelt de CORS-configuratie uit `cors.json` in en leest daarna de actieve instelling terug. Hiervoor zijn bucketrechten nodig, doorgaans de rol Storage Admin.

## Controleer na afloop

- GitHub Pages-origin: `https://sjaak087.github.io` (zonder projectpad of afsluitende slash).
- Storage-bucket: `webshop-3cf70.firebasestorage.app`.
- Storage-regels: publiceer `storage.rules` via Firebase Console → Storage → Rules.
- Test eerst met een klein STL- of 3MF-bestand en bekijk bij een fout ook de browserconsole.

**Let op:** deze ZIP bevat de juiste configuratie en een script om die toe te passen, maar kan de bucketinstelling niet zelf wijzigen. Als de preflight na toepassing nog steeds faalt, controleer dan of Cloud Storage daadwerkelijk actief is en of de geselecteerde bucket overeenkomt met `firebase.js`; een onderliggende 403- of 404-fout kan door de browser als CORS-fout worden weergegeven.
