import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyCBLpFJIC0yppKjQAwazMqv9QC0X4MBNaI",
  authDomain: "webshop-3cf70.firebaseapp.com",
  databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "webshop-3cf70",
  storageBucket: "webshop-3cf70.firebasestorage.app",
  messagingSenderId: "253002374669",
  appId: "1:253002374669:web:3058a5c9b2d4f111503f44",
  measurementId: "G-7YTVRGHRKL"
};

// Vul het admin-e-mailadres in dat je ook als Firebase Authentication-gebruiker aanmaakt.
// Zet hier NOOIT een wachtwoord in. E-mailcontrole in de browser is geen beveiligingsgrens;
// zie README en database.rules.json voor de echte beveiliging.
export const ADMIN_EMAILS = ["beheer@voorbeeld.nl"];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
export const authPersistenceReady = setPersistence(auth, browserLocalPersistence);
