// Firebase-configuratie voor NovaShop.
// De Firebase web-API-key is bedoeld om in de browser te staan.
// Beveilig je gegevens met Firebase Authentication en de meegeleverde database-/storage-regels.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCBLpFJIC0yppKjQAwazMqv9QC0X4MBNaI",
  authDomain: "webshop-3cf70.firebaseapp.com",
  databaseURL: "https://webshop-3cf70-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "webshop-3cf70",
  storageBucket: "webshop-3cf70.firebasestorage.app",
  messagingSenderId: "253002374669",
  appId: "1:253002374669:web:3058a5c9b2d4f111503f44",
  measurementId: "G-7YTVRGHRKL"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
