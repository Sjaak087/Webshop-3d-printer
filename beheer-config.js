// Beheerdersgegevens (wachtwoord is gehasht, niet leesbaar). Het e-mailadres wordt NIET meer vooringevuld.
// Nieuw wachtwoord instellen: zie README.
export const BEHEER_CONFIG = {
  adminEmail: "58156557@leerling.hetbouwens.nl",
  salt: "MwfuBEam5SYXXg9Ol9nYOg==",
  hash: "qTmXZIPhFyEqzo0Pjf+bkuVHjd6xMsg7Of5zaHJHs5c=",
  iterations: 150000,
  // Publieke HTTPS-MJPEG-stream van bambu_cam.py via een tunnel.
  // Vul dit pas in nadat de camerabrug op de printer-pc werkt.
  // Voorbeeld: "https://camera.jouwdomein.nl/api/stream.mjpeg"
  cameraUrl: ""
};
