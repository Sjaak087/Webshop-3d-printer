// Firebase voor 3D Printed Shop.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCBLpFJIC0yppKjQAwazMqv9QC0X4MBNaI",
  authDomain: "webshop-3cf70.firebaseapp.com",
  databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "webshop-3cf70",
  messagingSenderId: "253002374669",
  appId: "1:253002374669:web:3058a5c9b2d4f111503f44",
  measurementId: "G-7YTVRGHRKL"
};

export const app = initializeApp(firebaseConfig);

// Maak in Firebase Console > App Check een reCAPTCHA v3-sitekey aan.
// De betaalfunctie vereist een geldige App Check-token.
const APP_CHECK_SITE_KEY = "VUL_HIER_JE_RECAPTCHA_V3_SITE_KEY_IN";
if (APP_CHECK_SITE_KEY && !APP_CHECK_SITE_KEY.startsWith("VUL_HIER")) {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });
}

export const db = getDatabase(app);
