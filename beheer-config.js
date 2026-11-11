// Beheerdersgegevens (wachtwoord is gehasht, niet leesbaar). Het e-mailadres wordt NIET meer vooringevuld.
// Nieuw wachtwoord instellen: zie README.
export const BEHEER_CONFIG = {
  adminEmail: "58156557@leerling.hetbouwens.nl",
  salt: "MwfuBEam5SYXXg9Ol9nYOg==",
  hash: "qTmXZIPhFyEqzo0Pjf+bkuVHjd6xMsg7Of5zaHJHs5c=",
  iterations: 150000,
  // Live camerabeeld van de 3D-printer (zie README, stap "Livecamera"). Leeg laten = camera-blok verborgen.
  // Voorbeeld: "https://camera.jouwdomein.nl/api/stream.mjpeg?src=a1mini"
  cameraUrl: "cameraUrl: "https://sand-sterling-raises-occupation.trycloudflare.com/api/stream.mjpeg?src=a1mini"
};
