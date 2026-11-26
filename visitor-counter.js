// Onafhankelijke bezoekenteller voor de webshop.
// Deze module draait los van app.js, klantlogin en Sitebeheer.
import { db } from "./firebase.js";
import { ref, runTransaction } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

function dutchDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function recordPageVisit() {
  const path = `analytics/daily/${dutchDayKey()}/visits`;
  try {
    // Een transaction voorkomt dat gelijktijdige bezoekers elkaars +1 overschrijven.
    // Geen cookie, login, account-ID, sessiemarker of limiet per persoon.
    const result = await runTransaction(
      ref(db, path),
      current => (Number(current) || 0) + 1,
      { applyLocally: false }
    );
    if (!result.committed) throw new Error("De bezoekenteller is niet opgeslagen.");
  } catch (error) {
    console.warn(
      "Bezoek kon niet worden geregistreerd. Controleer de Firebase-verbinding en de gepubliceerde database-regels.",
      error
    );
  }
}

// Iedere volledige opening of herlaadbeurt telt opnieuw, voor elke bezoeker.
void recordPageVisit();
