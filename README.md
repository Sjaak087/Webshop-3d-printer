# NovaShop

## Wat is er veranderd
- **Afbeeldingen uploaden werkt weer**: de afbeelding wordt in de browser verkleind (max 900 px) en in de database bewaard. Firebase Storage, CORS en `gcloud` zijn niet meer nodig. Bestaande producten met een oude afbeelding blijven werken.
- **Sitebeheer**: het e-mailadres wordt niet meer vooringevuld en het beheerderswachtwoord staat gehasht (PBKDF2) in `beheer-config.js`. Er is een uitlogknop en een rem op herhaald fout inloggen.
- **Klantaccounts**: wachtwoorden worden gehasht opgeslagen (voorheen platte tekst) en het wachtwoord zit niet meer in de sessie. Accounts staan nu in `accounts/`; oude testaccounts uit `users/` moet je opnieuw aanmaken (je kunt `users` in Firebase verwijderen).
- **Technisch**: bestelling + chat worden in één schrijfactie opgeslagen, klanten laden alleen hun eigen bestellingen/chats (query + index), listeners worden opgeruimd (geen dubbele updates/lekken), winkelwagen blijft bewaard, Escape sluit vensters, prijzen worden bij bestellen opnieuw uit de database genomen.

## Installeren
1. Zet alle bestanden op GitHub Pages (vervang de oude; `storage.rules` en `cors.json` mogen weg).
2. Firebase Console > Realtime Database > Rules: plak de inhoud van `database.rules.json` en publiceer.

## Nieuw beheerderswachtwoord
Maak een nieuwe `salt` en `hash` met Node:
```
node -e 'const c=require("crypto");const s=c.randomBytes(16);console.log(s.toString("base64"),c.pbkdf2Sync("NIEUW_WACHTWOORD",s,150000,32,"sha256").toString("base64"))'
```
Zet de eerste waarde bij `salt` en de tweede bij `hash` in `beheer-config.js`.

## Eerlijk over de beveiliging
Zonder Firebase Authentication of een backend kan de browsercode zelf niets echt afdwingen: iemand die de database-URL kent kan nog steeds producten, bestellingen en chats lezen/wijzigen. De login is daarom een afscherming van de interface, geen harde beveiliging. Voor echte klanten: schakel Firebase Authentication in en laat de regels op `auth.uid` en een admin-claim controleren.
