// Firebase-configuratie voor 3D Printed Shop (Realtime Database). Firebase Storage is niet meer nodig:
// productafbeeldingen worden in de browser verkleind en als kleine afbeelding in de database bewaard.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

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

export const db = getDatabase(initializeApp(firebaseConfig));
