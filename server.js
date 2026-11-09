import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { promisify } from "node:util";
import admin from "firebase-admin";

const scrypt = promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT || 8787);
const DATABASE_URL = process.env.FIREBASE_DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = normalizeEmail(process.env.ADMIN_EMAIL);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "http://localhost:5173")
  .split(",").map(value => value.trim()).filter(Boolean);

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}
function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function safeCompare(left, right) {
  const a = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const b = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function recordKey(value) {
  const key = String(value || "");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) throw httpError(400, "Ongeldige recordcode.");
  return key;
}
function emailKey(email) {
  return Buffer.from(email).toString("base64url");
}

if (!DATABASE_URL || !JWT_SECRET || JWT_SECRET.length < 32 || !ADMIN_EMAIL || ADMIN_PASSWORD.length < 12) {
  throw new Error("Vul FIREBASE_DATABASE_URL, JWT_SECRET (minimaal 32 tekens), ADMIN_EMAIL en ADMIN_PASSWORD (minimaal 12 tekens) in backend/.env.");
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON bevat geen geldige JSON.");
}
if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON mist service-accountgegevens. Voeg de Firebase service-account JSON toe.");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: DATABASE_URL
});
const db = admin.database();

app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Deze website mag de API niet gebruiken."));
  }
}));
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });

async function getValue(path) {
  const snapshot = await db.ref(path).get();
  return snapshot.exists() ? snapshot.val() : null;
}
function makeToken(user) {
  return jwt.sign({ uid: user.uid, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "12h", issuer: "blauwshop-api" });
}
function requireLogin(req, res, next) {
  const value = String(req.headers.authorization || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: "Log eerst in." });
  try {
    req.user = jwt.verify(match[1], JWT_SECRET, { issuer: "blauwshop-api" });
    return next();
  } catch {
    return res.status(401).json({ error: "Je sessie is verlopen. Log opnieuw in." });
  }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin" || normalizeEmail(req.user.email) !== ADMIN_EMAIL) {
    return res.status(403).json({ error: "Alleen de beheerder mag dit doen." });
  }
  return next();
}
function cleanProduct(body, current = {}) {
  const title = String(body.title ?? current.title ?? "").trim().slice(0, 120);
  const price = Number(body.price ?? current.price);
  const image = String(body.image ?? current.image ?? "").trim().slice(0, 1500);
  const description = String(body.description ?? current.description ?? "").trim().slice(0, 5000);
  if (!title || !Number.isFinite(price) || price < 0) throw httpError(400, "Vul een productnaam en geldige prijs in.");
  if (image) {
    let parsed;
    try { parsed = new URL(image); } catch { throw httpError(400, "Afbeeldingslink is ongeldig."); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw httpError(400, "Afbeeldingslink moet met http of https beginnen.");
  }
  return { title, price, image, description, active: body.active ?? current.active ?? true };
}

app.get("/api/health", (req, res) => res.json({ ok: true, service: "blauwshop-api" }));
app.get("/api/products", async (req, res, next) => {
  try { res.json(await getValue("products") || {}); } catch (error) { next(error); }
});

app.post("/api/auth/register", registerLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw httpError(400, "Vul een geldig e-mailadres in.");
    if (password.length < 8 || password.length > 128) throw httpError(400, "Gebruik een wachtwoord van minimaal 8 tekens.");
    if (email === ADMIN_EMAIL) throw httpError(400, "Dit e-mailadres is gereserveerd voor sitebeheer.");

    const uid = db.ref("users").push().key;
    const indexRef = db.ref(`emailIndex/${emailKey(email)}`);
    const transaction = await indexRef.transaction(current => current || uid);
    if (transaction.snapshot.val() !== uid) throw httpError(409, "Er bestaat al een account met dit e-mailadres.");

    const salt = crypto.randomBytes(16).toString("hex");
    const derived = await scrypt(password, salt, 64);
    await db.ref(`users/${uid}`).set({ email, role: "customer", passwordHash: `${salt}:${derived.toString("hex")}`, createdAt: Date.now() });
    const user = { uid, email, role: "customer" };
    res.status(201).json({ token: makeToken(user), user });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    if (!email || !password || password.length > 128) throw httpError(400, "Vul je e-mailadres en wachtwoord in.");

    if (email === ADMIN_EMAIL) {
      if (!safeCompare(password, ADMIN_PASSWORD)) throw httpError(401, "E-mailadres of wachtwoord klopt niet.");
      let uid = await getValue(`emailIndex/${emailKey(email)}`);
      if (!uid) {
        uid = db.ref("users").push().key;
        await db.ref(`emailIndex/${emailKey(email)}`).set(uid);
      }
      await db.ref(`users/${uid}`).update({ email, role: "admin", lastLoginAt: Date.now() });
      const user = { uid, email, role: "admin" };
      return res.json({ token: makeToken(user), user });
    }

    const uid = await getValue(`emailIndex/${emailKey(email)}`);
    const account = uid ? await getValue(`users/${uid}`) : null;
    if (!account?.passwordHash || account.role !== "customer") throw httpError(401, "E-mailadres of wachtwoord klopt niet.");
    const [salt, expectedHex] = String(account.passwordHash).split(":");
    const actual = await scrypt(password, salt, 64);
    if (!safeCompare(actual, Buffer.from(expectedHex || "", "hex"))) throw httpError(401, "E-mailadres of wachtwoord klopt niet.");
    const user = { uid, email, role: "customer" };
    res.json({ token: makeToken(user), user });
  } catch (error) { next(error); }
});

app.get("/api/me", requireLogin, (req, res) => {
  res.json({ user: { uid: req.user.uid, email: req.user.email, role: req.user.role } });
});

app.post("/api/products", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const product = cleanProduct(req.body || {});
    const id = db.ref("products").push().key;
    await db.ref(`products/${id}`).set(product);
    res.status(201).json({ id, product });
  } catch (error) { next(error); }
});
app.patch("/api/products/:id", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const id = recordKey(req.params.id);
    const current = await getValue(`products/${id}`);
    if (!current) throw httpError(404, "Product niet gevonden.");
    const product = cleanProduct(req.body || {}, current);
    await db.ref(`products/${id}`).set(product);
    res.json({ id, product });
  } catch (error) { next(error); }
});
app.delete("/api/products/:id", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const id = recordKey(req.params.id);
    await db.ref(`products/${id}`).remove();
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/orders", requireLogin, async (req, res, next) => {
  try {
    const all = await getValue("orders") || {};
    if (req.user.role === "admin") return res.json(all);
    return res.json(Object.fromEntries(Object.entries(all).filter(([, order]) => order.userId === req.user.uid)));
  } catch (error) { next(error); }
});
app.post("/api/orders", requireLogin, async (req, res, next) => {
  try {
    const requested = req.body?.items;
    if (!Array.isArray(requested) || !requested.length || requested.length > 30) throw httpError(400, "Je winkelwagen bevat geen geldige producten.");
    const allProducts = await getValue("products") || {};
    const items = requested.map(line => {
      const product = allProducts[String(line.productId || "")];
      const qty = Number(line.qty);
      if (!product || product.active === false || !Number.isInteger(qty) || qty < 1 || qty > 99) throw httpError(400, "Een product uit je winkelwagen is niet meer beschikbaar.");
      return { productId: String(line.productId), title: product.title, price: Number(product.price) || 0, qty };
    });
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const orderId = db.ref("orders").push().key;
    const chatId = db.ref("chats").push().key;
    const now = Date.now();
    const order = { userId: req.user.uid, email: req.user.email, items, total, status: "Ontvangen", createdAt: now, chatId };
    const chat = { userId: req.user.uid, email: req.user.email, orderId, lastMessage: "Bestelling geplaatst", messages: {} };
    await db.ref().update({ [`orders/${orderId}`]: order, [`chats/${chatId}`]: chat });
    res.status(201).json({ orderId, chatId, order, chat });
  } catch (error) { next(error); }
});
app.patch("/api/orders/:id/status", requireLogin, requireAdmin, async (req, res, next) => {
  try {
    const id = recordKey(req.params.id);
    const statuses = ["Ontvangen", "Verwerkt", "Gemaakt", "Klaar voor bezorging"];
    if (!statuses.includes(req.body?.status)) throw httpError(400, "Deze bestelstatus is niet geldig.");
    const orderRef = db.ref(`orders/${id}`);
    if (!(await orderRef.get()).exists()) throw httpError(404, "Bestelling niet gevonden.");
    await orderRef.update({ status: req.body.status });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/chats", requireLogin, async (req, res, next) => {
  try {
    const all = await getValue("chats") || {};
    if (req.user.role === "admin") return res.json(all);
    return res.json(Object.fromEntries(Object.entries(all).filter(([, chat]) => chat.userId === req.user.uid)));
  } catch (error) { next(error); }
});
app.post("/api/chats/:id/messages", requireLogin, async (req, res, next) => {
  try {
    const chatId = recordKey(req.params.id);
    const chatRef = db.ref(`chats/${chatId}`);
    const snapshot = await chatRef.get();
    if (!snapshot.exists()) throw httpError(404, "Chat niet gevonden.");
    const chat = snapshot.val();
    if (req.user.role !== "admin" && chat.userId !== req.user.uid) throw httpError(403, "Je hebt geen toegang tot deze chat.");
    const text = String(req.body?.text || "").trim();
    if (!text || text.length > 2000) throw httpError(400, "Een bericht moet tussen 1 en 2000 tekens bevatten.");
    const messageId = chatRef.child("messages").push().key;
    const message = { uid: req.user.uid, name: req.user.role === "admin" ? "Beheer" : req.user.email, text, time: Date.now() };
    await chatRef.update({ lastMessage: text });
    await chatRef.child(`messages/${messageId}`).set(message);
    res.status(201).json({ id: messageId, message });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Er ging iets mis op de server." : error.message });
});

app.listen(PORT, () => console.log(`BlauwShop API luistert op poort ${PORT}`));
