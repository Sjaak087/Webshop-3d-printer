import { db, functions } from "./firebase.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { BEHEER_CONFIG as CFG } from "./beheer-config.js";
import { ref, onValue, get, push, set, update, remove, query, orderByChild, equalTo, runTransaction } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = s => document.querySelector(s);
const SHIPPING = 3.95;   // verzendkosten bij verzenden; ophalen is gratis
const PRODUCT_LOADING_MIN_MS = 4000; // eerste productlading minimaal 4 seconden zichtbaar
const STATUSES = ["ontvangen", "verwerkt", "in de maak", "gemaakt", "klaar voor bezorging", "bezorgd"];
const STAGES = ["in wachtrij", "in bereiding", "gemaakt"];   // fase per product zolang de bestelling "in de maak" is
const stageOf = i => STAGES.includes(i.stage) ? i.stage : STAGES[0];
const RETURN_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const returnDeadline = o => Number(o.deliveredAt || 0) + RETURN_WINDOW_MS;
const returnWindowOpen = o => !!o.deliveredAt && Date.now() < returnDeadline(o) && !o.returnRequestAt && o.status === "bezorgd";
// fase per stuk: bij 6x hetzelfde product kan elk stuk een eigen fase hebben (i.stages[n]); oude bestellingen vallen terug op i.stage
const unitStages = i => Array.from({ length: Math.max(1, Number(i.qty) || 1) }, (_, n) => STAGES.includes(i.stages?.[n]) ? i.stages[n] : stageOf(i));
const STAGE_LABEL = { "in wachtrij": "in wachtrij", "in bereiding": "bezig", "gemaakt": "✓ gemaakt" };
const stageChip = st => `<span class="stage-chip st${STAGES.indexOf(st)}">${STAGE_LABEL[st]}</span>`;
const hasStage = i => !!i.stage || (i.stages && Object.values(i.stages).some(Boolean));
const showStage = (o, i) => o.status === "in de maak" || hasStage(i);   // ook zichtbaar als je een stuk in de agenda een fase geeft
async function setStage(o, n, u, st) { const it = (o.items || [])[n]; if (!it) return; const arr = unitStages(it); arr[u] = st; await update(ref(db, `orders/${o.id}/items/${n}`), { stages: arr }); await syncPublicTrack(o.id); }
const stageChips = i => { const u = unitStages(i); return u.length === 1 ? ` ${stageChip(u[0])}` : `<span class="unit-stages">${u.map((st, n) => `<span class="unit-chip">Stuk ${n + 1} ${stageChip(st)}</span>`).join("")}</span>`; };
const CAMERA_STATUSES = [...STATUSES];   // camera tonen bij alle bestelstatussen
const isPickupOrder = order => order?.fulfillmentMethod === "pickup" || order?.fulfillmentMethod === "chat" || order?.paymentMethod === "chat";
const statusLabel = (order, status = order?.status) => {
  if (status === "klaar voor bezorging") return isPickupOrder(order) ? "klaar om op te halen" : "klaar voor verzending";
  if (status === "bezorgd") return isPickupOrder(order) ? "opgehaald" : "bezorgd";
  return status || "ontvangen";
};
const fulfillmentLabel = order => isPickupOrder(order) ? "Ophalen" : "Verzenden";
const state = { user: null, admin: false, products: [], categories: [], categoryFilter: "all", cart: [], tab: "products", loaded: false, productsError: false, orderNote: "", pendingQuoteRequest: false, plan: { orderId: null, key: null, week: null, form: { date: "", from: "", to: "", endDate: "" }, orders: [], scroll: 7 * 44 } };
const overlay = $("#overlay"), content = $("#dialogContent");
const DEFAULT_CONTACT = { title: "Neem contact met ons op", intro: "Heb je een vraag over een product of bestelling? Neem gerust contact met ons op.", name: "", address: "", email: "", phone: "", hours: "", extra: "" };
let contactSettings = { ...DEFAULT_CONTACT };
let unsubs = [];                       // listeners van het open dialoogvenster
let lockDialog = false;
$("#year").textContent = new Date().getFullYear();

/* ---------- helpers ---------- */
const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const categoryLabel = id => state.categories.find(c => c.id === id && c.active !== false)?.name || "";
function renderCategoryFilters() {
  const root = $("#categoryFilters"); if (!root) return;
  const cats = state.categories.filter(c => c.active !== false).sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || String(a.name).localeCompare(String(b.name), "nl"));
  if (state.categoryFilter !== "all" && !cats.some(c => c.id === state.categoryFilter)) state.categoryFilter = "all";
  root.hidden = !cats.length;
  root.innerHTML = cats.length ? `<div class="category-filter-label">Categorieën</div><div class="category-filter-list"><button type="button" class="category-filter ${state.categoryFilter === "all" ? "active" : ""}" data-category-filter="all" aria-pressed="${state.categoryFilter === "all"}">Alles</button>${cats.map(c => `<button type="button" class="category-filter ${state.categoryFilter === c.id ? "active" : ""}" data-category-filter="${safe(c.id)}" aria-pressed="${state.categoryFilter === c.id}">${safe(c.name)}</button>`).join("")}</div>` : "";
}
$("#categoryFilters")?.addEventListener("click", e => { const b = e.target.closest("[data-category-filter]"); if (!b) return; state.categoryFilter = b.dataset.categoryFilter; renderCategoryFilters(); renderProducts(); });
function a1MiniPrinterMarkup() {
  return `<svg class="a1-mini-printer-svg" viewBox="0 0 260 190" role="presentation" focusable="false" aria-hidden="true">
    <ellipse cx="128" cy="174" rx="91" ry="8" fill="#08152c" opacity=".28"/>
    <!-- Compacte basis en touchscreen -->
    <path d="M37 146 194 146 220 155 62 158Z" fill="#aeb8c6" stroke="#657386" stroke-width="1.5"/>
    <path d="M37 146 194 146 194 166 62 169 37 159Z" fill="#f7f9fc" stroke="#aab4c2" stroke-width="1.5"/>
    <path d="M194 146 220 155 220 167 194 166Z" fill="#d4dbe5" stroke="#8793a3" stroke-width="1.3"/>
    <rect x="168" y="146" width="31" height="19" rx="3" fill="#172a40" stroke="#60728a" stroke-width="1.1"/>
    <rect x="171" y="149" width="25" height="13" rx="1.5" fill="#eaf6f5"/>
    <text class="a1-screen-percent" x="173" y="155" fill="#18354a" font-size="5.6" font-family="Arial,sans-serif" font-weight="700">0%</text>
    <rect x="173" y="157.5" width="21" height="2.8" rx="1.2" fill="#c6d7d7"/>
    <rect class="a1-screen-progress-fill" x="173" y="157.5" width="0" height="2.8" rx="1.2" fill="#0da69c"/>
    <!-- Rechter staander en bovenrail: A1 mini cantilever-frame -->
    <path d="M197 37 214 42 214 151 198 146Z" fill="#d7dee8" stroke="#7c899b" stroke-width="1.6"/>
    <path d="M203 43 208 45 208 142 203 141Z" fill="#f8fafc" opacity=".95"/>
    <path d="M51 39 208 39 216 45 59 45Z" fill="#f7f9fc" stroke="#8995a5" stroke-width="1.5"/>
    <path d="M59 45 216 45 216 57 59 57Z" fill="#b7c1ce" stroke="#718096" stroke-width="1.3"/>
    <path d="M64 48 208 48 208 52 64 52Z" fill="#26364d"/>
    <rect x="62" y="36" width="10" height="13" rx="2" fill="#e8edf4" stroke="#8592a3"/>
    <!-- Filamentrol en gebogen toevoerbuis -->
    <circle cx="231" cy="30" r="15" fill="#25364d" stroke="#d8e1ec" stroke-width="3"/>
    <circle cx="231" cy="30" r="8.5" fill="#8d9caf" stroke="#f8fafc" stroke-width="2"/>
    <circle cx="231" cy="30" r="3" fill="#26364d"/>
    <path d="M220 20 C204 5 186 10 171 23 S145 39 132 47" fill="none" stroke="#f5a942" stroke-width="4" stroke-linecap="round"/>
    <path d="M220 20 C204 5 186 10 171 23 S145 39 132 47" fill="none" stroke="#ffe0a8" stroke-width="1.2" stroke-linecap="round" opacity=".9"/>
    <!-- Bewegende printkop op de horizontale rail -->
    <g class="a1-printer-head">
      <rect x="105" y="48" width="44" height="31" rx="6" fill="#f8fafc" stroke="#78879a" stroke-width="1.7"/>
      <path d="M109 52h36v5h-36Z" fill="#d6dee8"/>
      <rect x="115" y="59" width="24" height="13" rx="3" fill="#25364d"/>
      <circle cx="127" cy="65.5" r="3.1" fill="#62d7d0"/>
      <path d="M116 78h22l-3 12h-16Z" fill="#aeb9c8" stroke="#657386" stroke-width="1.2"/>
      <path d="M122 89h10l-3 9h-4Z" fill="#25364d"/>
      <path d="M127 97v5" stroke="#f5a942" stroke-width="2.8" stroke-linecap="round" class="a1-nozzle-glow"/>
      <path d="M121 79h12" stroke="#fff" stroke-width="1.4" opacity=".9"/>
    </g>
    <!-- Printbed en mat -->
    <g class="a1-printer-bed">
      <path d="M50 124 173 124 194 134 69 134Z" fill="#26364d" stroke="#718096" stroke-width="1.3"/>
      <path d="M69 134 194 134 194 139 69 139Z" fill="#8a98aa"/>
      <path d="M83 126 168 126 183 132 98 132Z" fill="#43536a"/>
    </g>
    <!-- Klein printobject waarvan de lagen opbouwen -->
    <g class="a1-printed-object">
      <path d="M105 123 105 108 114 102 142 102 151 108 151 123Z" fill="#17a6a1" stroke="#087d80" stroke-width="1.2"/>
      <path d="M105 108 114 102 142 102 151 108 141 113 115 113Z" fill="#56d8ca" stroke="#087d80" stroke-width="1.1"/>
      <path d="M111 116h34M110 120h37M113 112h32" fill="none" stroke="#a5fff0" stroke-width="1.1" opacity=".8"/>
      <path d="M115 104 115 122M121 103 121 123M127 103 127 123M133 103 133 123M139 103 139 122" stroke="#087d80" stroke-width=".7" opacity=".55"/>
    </g>
    <path d="M45 160 190 160" stroke="#fff" stroke-width="1" opacity=".8"/>
  </svg>`;
}
const A1_LOADER_PROGRESS_MS = 4000;
const A1_LOADER_PROGRESS_MAX = 95;
function updateA1LoaderDisplays(now = performance.now()) {
  document.querySelectorAll(".a1-loader").forEach(loader => {
    let startedAt = Number(loader.dataset.progressStartedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) {
      startedAt = now;
      loader.dataset.progressStartedAt = String(startedAt);
    }
    const elapsed = Math.max(0, now - startedAt);
    const progress = Math.min(A1_LOADER_PROGRESS_MAX, Math.floor((elapsed / A1_LOADER_PROGRESS_MS) * A1_LOADER_PROGRESS_MAX));
    const percent = loader.querySelector(".a1-screen-percent");
    const fill = loader.querySelector(".a1-screen-progress-fill");
    if (percent) percent.textContent = `${progress}%`;
    if (fill) fill.setAttribute("width", (21 * progress / 100).toFixed(2));
    loader.setAttribute("aria-label", `Product wordt geladen: ${progress}%`);
  });
  requestAnimationFrame(updateA1LoaderDisplays);
}
requestAnimationFrame(updateA1LoaderDisplays);

function productSkeletonMarkup(count = 6) {
  const initialProgressStart = (performance.now() - Math.max(0, Date.now() - productLoadingStartedAt)).toFixed(2);
  const cards = Array.from({ length: count }, () => `<article class="skeleton-card" aria-hidden="true"><div class="skeleton-image"><div class="a1-loader" data-progress-started-at="${initialProgressStart}"><div class="a1-loader-scene"><div class="a1-loader-brand"><span class="a1-status-dot"></span>BAMBU LAB <b>A1 MINI</b></div>${a1MiniPrinterMarkup()}<span class="a1-loader-caption">Product wordt geprint…</span><span class="a1-loader-subline">Printkop beweegt · laag voor laag</span></div></div></div><div class="skeleton-line skeleton-title"></div><div class="skeleton-line skeleton-price"></div><div class="skeleton-line skeleton-button"></div></article>`).join("");
  return `<div class="product-loading-state"><div class="product-loading-status"><span class="product-loading-spinner" aria-hidden="true"></span><span>Ons assortiment komt eraan…</span></div><div class="product-skeleton-grid">${cards}</div></div>`;
}
function firebaseLoadingMarkup(label = "Gegevens laden…") {
  return `<div class="firebase-loading" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><span>${safe(label)}</span><div class="firebase-loading-lines"><i></i><i></i><i></i></div></div>`;
}
const money = n => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const short = id => String(id || "").slice(-6);
const when = t => t ? new Date(t).toLocaleString("nl-NL") : "";
let toastTimer;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3000); }
function openDialog(html) { lockDialog = false; $("#closeDialog").hidden = false; cleanup(); content.innerHTML = html; overlay.classList.remove("hidden"); }
function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function closeDialog(force = false) { if (lockDialog && force !== true) return; lockDialog = false; $("#closeDialog").hidden = false; cleanup(); overlay.classList.add("hidden"); content.innerHTML = ""; }
function listen(q, cb) { unsubs.push(onValue(q, cb)); }   // wordt automatisch opgeruimd
const toList = snap => Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v }));
const legacyOptions = p => (Array.isArray(p?.options) ? p.options : Object.values(p?.options || {})).filter(o => o && o.name);
const optionGroupsOf = p => {
  const raw = Array.isArray(p?.optionGroups) ? p.optionGroups : Object.values(p?.optionGroups || {});
  const groups = raw.filter(g => g && g.label && (Array.isArray(g.options) || g.options)).map((g, i) => ({
    id: g.id || `group-${i}`, label: String(g.label), options: (Array.isArray(g.options) ? g.options : Object.values(g.options || {})).filter(o => o && o.name).map(o => ({
      name: String(o.name), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut
    }))
  }));
  if (groups.length) return groups;
  const old = legacyOptions(p);
  return old.length ? [{ id: "legacy", label: p.optionLabel || "Keuze", options: old.map(o => ({ name: String(o.name), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut })) }] : [];
};
const optList = p => optionGroupsOf(p).flatMap(g => g.options);
const isSoldOut = p => !!p.soldOut || optionGroupsOf(p).some(g => g.options.length > 0 && g.options.every(o => o.soldOut));
const selectionsOf = item => Array.isArray(item?.selections) ? item.selections : (item?.option ? [{ label: item.optionLabel || "Keuze", value: item.option, priceDelta: 0 }] : []);
const selectionsKey = selections => selectionsOf({ selections }).map(s => `${encodeURIComponent(s.label)}=${encodeURIComponent(s.value)}`).join("|");
const itemKey = (id, selections) => id + "|" + (Array.isArray(selections) ? selectionsKey(selections) : (selections || ""));
const optText = item => {
  const choices = selectionsOf(item);
  const choiceText = choices.length ? ` · ${choices.map(s => `${safe(s.label)}: <b>${safe(s.value)}</b>`).join(" · ")}` : "";
  const d = item?.dimensions;
  const dims = d ? ` · ${Number(d.length)} × ${Number(d.width)} × ${Number(d.height)} mm (L × B × H)` : "";
  return choiceText + dims;
};
const deltaText = n => Number(n) > 0 ? `+ ${money(n)}` : Number(n) < 0 ? `− ${money(Math.abs(n))}` : "Geen meerprijs";
const productImages = p => (Array.isArray(p?.images) && p.images.length ? p.images : [p?.image]).filter(Boolean).slice(0, 3);
const publicTrackPayload = o => ({
  shortId: short(o.id), status: o.status || "ontvangen", fulfillmentMethod: isPickupOrder(o) ? "pickup" : "delivery", createdAt: o.createdAt || Date.now(),
  items: (o.items || []).map((i, n) => ({ title: i.title, qty: i.qty, selections: selectionsOf(i), ...(i.dimensions ? { dimensions: i.dimensions } : {}), ...(i.customDescription ? { customDescription: i.customDescription } : {}), stages: unitStages(i), plan: Object.fromEntries(Object.entries(o.plan || {}).filter(([k]) => k.startsWith(`${n}_`))) })),
  subtotal: o.subtotal ?? o.total ?? 0, shipping: o.shipping ?? 0, total: o.total ?? 0,
  estimatedReady: o.estimatedReady || planInfoSafe(o).ready || null
});
function planInfoSafe(o) {
  const total = (o.items || []).reduce((n, i) => n + Math.max(1, Number(i.qty) || 1), 0);
  const endTimes = Object.values(o.plan || {}).map(s => Number(s?.endTs)).filter(Number.isFinite);
  return { ready: total && endTimes.length === total ? Math.max(...endTimes) : null };
}
const randomToken = () => [...crypto.getRandomValues(new Uint8Array(24))].map(x => x.toString(16).padStart(2, "0")).join("");
const trackUrl = token => `${location.origin}${location.pathname}?track=${encodeURIComponent(token)}`;
async function syncPublicTrack(orderId) {
  const snap = await get(ref(db, `orders/${orderId}`)), order = snap.val();
  if (order?.publicToken) await set(ref(db, `publicTrack/${order.publicToken}`), publicTrackPayload({ ...order, id: orderId }));
}
async function copyTrackLink(token) {
  const url = trackUrl(token);
  try { await navigator.clipboard.writeText(url); toast("Deellink gekopieerd"); }
  catch { openDialog(`<p class="eyebrow">TRACK & TRACE DELEN</p><h2>Jouw deellink</h2><p class="muted">Kopieer deze link en stuur hem door.</p><input class="share-url" readonly value="${safe(url)}"><button class="primary full" id="copyFallback">Kopiëren</button>`); $("#copyFallback").onclick = () => { $("#dialogContent .share-url").select(); document.execCommand("copy"); toast("Link gekopieerd"); }; }
}
$("#closeDialog").onclick = () => closeDialog();
overlay.addEventListener("click", e => { if (e.target === overlay && !lockDialog) closeDialog(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.classList.contains("hidden") && !lockDialog) closeDialog(); });

/* ---------- wachtwoorden (PBKDF2, nooit meer platte tekst) ---------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function hashPw(pw, salt, iter = 150000) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(salt), iterations: iter }, key, 256));
}
async function emailKey(email) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
let fails = 0, lockUntil = 0;           // simpele rem op gokken
function locked() { const s = Math.ceil((lockUntil - Date.now()) / 1000); if (s > 0) { toast(`Te veel pogingen. Probeer het over ${s} seconden opnieuw.`); return true } return false; }
function failed() { if (++fails >= 5) { lockUntil = Date.now() + Math.min(300000, 15000 * 2 ** (fails - 5)); } toast("E-mailadres of wachtwoord klopt niet."); }
// klant en beheerder zijn twee aparte sessies: inloggen bij Sitebeheer logt je niet uit bij je klantaccount (en andersom)
function setCustomer(u) { state.user = u; fails = 0; sessionStorage.setItem("novashopUser", JSON.stringify({ uid: u.uid, email: u.email, username: u.username || "", role: "customer" })); refreshNav(); }
function continuePendingQuoteRequest() { if (!state.pendingQuoteRequest || !state.user) return; state.pendingQuoteRequest = false; startQuoteRequest(); }
const usernameKey = value => String(value || "").trim().toLowerCase();
function validUsername(value) { return /^[a-zA-Z0-9._-]{3,20}$/.test(String(value || "").trim()); }
async function claimUsername(uid, username) {
  const clean = String(username || "").trim(), key = usernameKey(clean);
  if (!validUsername(clean)) throw new Error("Gebruikersnaam moet 3–20 tekens bevatten: letters, cijfers, punt, _ of -.");
  const result = await runTransaction(ref(db, `usernames/${key}`), current => current == null || current === uid ? uid : undefined);
  if (!result.committed || result.snapshot.val() !== uid) throw new Error("Deze gebruikersnaam is al bezet. Kies een andere.");
  await set(ref(db, `profiles/${uid}`), { username: clean, usernameKey: key, updatedAt: Date.now() });
  return clean;
}
async function activateCustomer(uid, email, suggested = "") {
  const profile = (await get(ref(db, `profiles/${uid}`))).val();
  if (profile?.username) { setCustomer({ uid, email, username: profile.username, role: "customer" }); closeDialog(); toast("Je bent ingelogd"); continuePendingQuoteRequest(); return; }
  usernamePrompt(uid, email, suggested);
}
function usernamePrompt(uid, email, suggested = "") {
  openDialog(`<p class="eyebrow">PROFIEL AFRONDEN</p><h2>Kies je gebruikersnaam</h2><p class="muted">Je account heeft nog geen gebruikersnaam. Deze naam wordt zichtbaar op je profiel, bestellingen en chats. Je e-mailadres blijft privé voor klanten.</p><form id="usernameForm" class="stack"><label>Gebruikersnaam<input id="usernameInput" required minlength="3" maxlength="20" pattern="[A-Za-z0-9._-]{3,20}" autocomplete="nickname" value="${safe(suggested)}" placeholder="Bijv. printfan23"></label><small class="hint">3–20 tekens: letters, cijfers, punt, _ of -.</small><button class="primary full">Gebruikersnaam opslaan</button></form>`);
  lockDialog = true; $("#closeDialog").hidden = true;
  $("#usernameForm").onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true;
    try {
      const username = await claimUsername(uid, $("#usernameInput").value);
      setCustomer({ uid, email, username, role: "customer" }); closeDialog(true); toast("Gebruikersnaam ingesteld!"); continuePendingQuoteRequest();
    } catch (err) { toast(err.message || "Gebruikersnaam opslaan mislukt"); }
    finally { btn.disabled = false; }
  };
}
function setAdmin() { state.admin = true; fails = 0; sessionStorage.setItem("novashopAdmin", "1"); refreshNav(); }
function refreshNav() {
  $("#accountBtn").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"></circle><path d="M4.5 21a7.5 7.5 0 0 1 15 0"></path></svg><span>${state.user ? safe(state.user.username || "Mijn account") : "Inloggen"}</span>`;
  $("#adminEntry").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6h16M4 12h10M4 18h7"></path><circle cx="18" cy="15" r="3"></circle><path d="M18 10v2m0 6v2m-5-5h2m6 0h2"></path></svg><span>${state.admin ? "Sitebeheer · ingelogd" : "Sitebeheer"}</span>`;
  $("#accountBtn").setAttribute("aria-label", state.user ? "Mijn account" : "Inloggen");
  $("#adminEntry").setAttribute("aria-label", state.admin ? "Sitebeheer · ingelogd" : "Sitebeheer");
}

/* ---------- winkelwagen (blijft bewaard) ---------- */
try { state.cart = JSON.parse(localStorage.getItem("novashopCart") || "[]"); } catch { state.cart = []; }
function saveCart() { try { localStorage.setItem("novashopCart", JSON.stringify(state.cart)); } catch { } $("#cartCount").textContent = state.cart.reduce((n, x) => n + x.qty, 0); }
function cartIssue(c) {
  const p = state.products.find(x => x.id === c.id); if (!p) return "Niet meer beschikbaar";
  if (isSoldOut(p)) return "Uitverkocht";
  const groups = optionGroupsOf(p), selected = selectionsOf(c);
  if (groups.length !== selected.length) return "Kies de productopties opnieuw";
  for (const group of groups) {
    const s = selected.find(x => x.label === group.label);
    const choice = group.options.find(o => o.name === s?.value);
    if (!choice) return `Kies opnieuw een ${group.label.toLowerCase()}`;
    if (choice.soldOut) return `De optie ${choice.name} is uitverkocht`;
  }
  return "";
}
function addCart(id, selections = []) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  if (isSoldOut(p)) return toast("Dit product is uitverkocht");
  const groups = optionGroupsOf(p), chosen = Array.isArray(selections) ? selections : [];
  if (groups.length !== chosen.length) return toast("Kies eerst alle productopties");
  let delta = 0;
  for (const group of groups) {
    const selected = chosen.find(x => x.label === group.label);
    const option = group.options.find(o => o.name === selected?.value);
    if (!option) return toast(`Kies eerst een ${group.label.toLowerCase()}`);
    if (option.soldOut) return toast("Deze optie is uitverkocht");
    delta += Number(option.priceDelta) || 0;
  }
  const itemPrice = Math.max(0, Number(p.price) + delta);
  const key = itemKey(id, chosen);
  const it = state.cart.find(x => itemKey(x.id, selectionsOf(x)) === key);
  if (it) it.qty++;
  else state.cart.push({ id, title: p.title, basePrice: Number(p.price), price: itemPrice, selections: chosen.map(x => ({ ...x })), qty: 1 });
  saveCart(); toast("Toegevoegd aan je winkelwagen");
}

/* ---------- producten ---------- */
const productLoadingStartedAt = Date.now();
let productLoadTimer = null;
let pendingProductSnapshot = [];
let productSnapshotReceived = false;
let pendingProductError = false;
function completeInitialProductLoad() {
  if (state.loaded || !productSnapshotReceived || productLoadTimer !== null) return;
  const remaining = Math.max(0, PRODUCT_LOADING_MIN_MS - (Date.now() - productLoadingStartedAt));
  productLoadTimer = setTimeout(() => {
    state.products = pendingProductSnapshot;
    state.productsError = pendingProductError;
    state.loaded = true;
    renderProducts();
  }, remaining);
}
onValue(ref(db, "products"), snap => {
  const products = toList(snap).filter(p => p.active !== false);
  if (!state.loaded) {
    pendingProductSnapshot = products;
    pendingProductError = false;
    productSnapshotReceived = true;
    renderProducts(); // Toon voor ieder afzonderlijk product een eigen loader.
    completeInitialProductLoad();
    return;
  }
  state.products = products;
  state.productsError = false;
  renderProducts();
}, error => {
  console.error("Firebase product load failed", error);
  if (!state.loaded) {
    pendingProductSnapshot = [];
    pendingProductError = true;
    productSnapshotReceived = true;
    completeInitialProductLoad();
    return;
  }
  state.productsError = true;
  renderProducts();
});
onValue(ref(db, "categories"), snap => {
  state.categories = toList(snap).filter(c => c.name).sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || String(a.name).localeCompare(String(b.name), "nl"));
  renderCategoryFilters();
  if (state.loaded) renderProducts();
}, error => console.error("Firebase categories load failed", error));
onValue(ref(db, "settings/contact"), snap => { contactSettings = { ...DEFAULT_CONTACT, ...(snap.val() || {}) }; updatePrivacyContactDetails(); const page = $("#contactPageContent"); if (page) page.innerHTML = contactPageMarkup(); }, error => console.error("Firebase contact settings load failed", error));
function renderProducts() {
  const productsEl = $("#products");
  if (!state.loaded) { productsEl.setAttribute("aria-busy", "true"); productsEl.innerHTML = productSkeletonMarkup(pendingProductSnapshot.length || 6); return; }
  productsEl.setAttribute("aria-busy", "false");
  if (state.productsError) { $("#productTotal").textContent = ""; productsEl.innerHTML = `<div class="empty-state">Producten konden niet worden geladen.<br><small>Controleer je verbinding en probeer de pagina opnieuw te laden.</small></div>`; return; }
  const q = ($("#search").value || "").toLowerCase();
  const list = state.products.filter(p => (state.categoryFilter === "all" || p.categoryId === state.categoryFilter) && (p.title + " " + (p.description || "")).toLowerCase().includes(q));
  $("#productTotal").textContent = `${list.length} producten`;
  $("#products").innerHTML = list.length ? list.map(p => {
    const out = isSoldOut(p), groups = optionGroupsOf(p), images = productImages(p), image = images[0];
    return `<article class="product-card ${out ? "sold-out" : ""}">
      <button class="product-open" data-open="${safe(p.id)}" aria-label="Bekijk ${safe(p.title)}">
        <div class="product-image">${image ? `<div class="product-image-loader" role="status" aria-label="Product wordt geladen"><div class="a1-loader"><div class="a1-loader-scene"><div class="a1-loader-brand"><span class="a1-status-dot"></span>BAMBU LAB <b>A1 MINI</b></div>${a1MiniPrinterMarkup()}<span class="a1-loader-caption">Product wordt geprint…</span><span class="a1-loader-subline">Printkop beweegt · laag voor laag</span></div></div></div><img class="product-image-source" loading="lazy" decoding="async" src="${safe(image)}" alt="${safe(p.title)}">` : `<span class="product-placeholder"><i data-lucide="box"></i></span>`}${out ? `<span class="sold-badge">Uitverkocht</span>` : ""}${images.length > 1 ? `<span class="image-count"><i data-lucide="images"></i> ${images.length}</span>` : ""}</div>
        <div class="product-info"><h3>${safe(p.title)}</h3>${categoryLabel(p.categoryId) ? `<span class="product-category-chip">${safe(categoryLabel(p.categoryId))}</span>` : ""}<strong>${money(p.price)}</strong>${groups.length ? `<small class="product-options-hint">${groups.length} ${groups.length === 1 ? "keuze" : "keuzes"} mogelijk</small>` : ""}</div>
      </button>
      ${out ? `<button class="add-small" disabled>Uitverkocht</button>` : groups.length ? `<button class="add-small" data-open="${safe(p.id)}">Stel samen</button>` : `<button class="add-small" data-add="${safe(p.id)}">In winkelwagen</button>`}
    </article>`;
  }).join("") : `<div class="empty-state">Geen producten gevonden.<br><small>Pas je zoekopdracht aan of bekijk later nog eens ons assortiment.</small></div>`;
  bindProductImageLoaders();
}
function finishProductImageLoad(img, succeeded) {
  const imageBox = img.closest(".product-image");
  const loader = imageBox?.querySelector(".product-image-loader");
  if (succeeded) {
    img.classList.add("is-loaded");
    if (loader) {
      const percent = loader.querySelector(".a1-screen-percent");
      const fill = loader.querySelector(".a1-screen-progress-fill");
      if (percent) percent.textContent = "100%";
      if (fill) fill.setAttribute("width", "21");
      loader.classList.add("is-finishing");
      setTimeout(() => loader.remove(), 220);
    }
  } else {
    img.remove();
    if (loader) {
      loader.classList.add("is-error");
      loader.innerHTML = `<span class="product-image-error">Afbeelding niet beschikbaar</span>`;
      loader.setAttribute("aria-label", "Afbeelding niet beschikbaar");
    }
  }
}
function bindProductImageLoaders() {
  $("#products").querySelectorAll("img.product-image-source").forEach(img => {
    img.addEventListener("load", () => finishProductImageLoad(img, true), { once: true });
    img.addEventListener("error", () => finishProductImageLoad(img, false), { once: true });
    if (img.complete && img.naturalWidth > 0) finishProductImageLoad(img, true);
  });
}
$("#searchBtn").onclick = renderProducts; $("#search").addEventListener("input", renderProducts);
$("#products").addEventListener("click", e => {
  const add = e.target.closest("[data-add]"); if (add) return addCart(add.dataset.add);
  const open = e.target.closest("[data-open]"); if (open) showProduct(open.dataset.open);
});
function showProduct(id) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  const groups = optionGroupsOf(p), images = productImages(p), out = isSoldOut(p);
  let chosen = [], step = 0, activeImage = 0;
  const selectedPrice = () => Number(p.price) + chosen.reduce((sum, x) => sum + (Number(x?.priceDelta) || 0), 0);
  const render = () => {
    const total = Math.max(0, selectedPrice());
    const current = groups[step];
    const currentChoice = chosen[step]?.value;
    const image = images[activeImage] || "";
    content.innerHTML = `<div class="product-detail">
      <div class="detail-gallery">
        <div class="detail-image">${image ? `<img src="${safe(image)}" alt="${safe(p.title)} afbeelding ${activeImage + 1}">` : `<i data-lucide="box"></i>`}</div>
        ${images.length > 1 ? `<div class="detail-thumbs">${images.map((src, i) => `<button class="detail-thumb ${i === activeImage ? "active" : ""}" data-image="${i}" aria-label="Afbeelding ${i + 1}"><img src="${safe(src)}" alt=""></button>`).join("")}</div>` : ""}
      </div>
      <div class="detail-content">
        <p class="eyebrow">PRODUCTDETAILS</p><h2>${safe(p.title)}</h2>
        <div class="detail-price">${money(total)}</div>
        <p class="description">${safe(p.description || "Een uniek product, met zorg gemaakt. Stel hieronder jouw uitvoering samen.")}</p>
        ${out ? `<div class="sold-note">Dit product is uitverkocht.</div>` : ""}
        ${groups.length && !out ? `<div class="option-wizard">
          <div class="option-wizard-top"><b>${safe(current.label)}</b><span>STAP ${step + 1} / ${groups.length}</span></div>
          <div class="option-progress">${groups.map((g, i) => `<span class="${i <= step ? "done" : ""}"></span>`).join("")}</div>
          <div class="option-choices">${current.options.map((o, i) => {
            const active = currentChoice === o.name;
            return `<button type="button" class="option-choice ${active ? "active" : ""}" data-choice="${i}" ${o.soldOut ? "disabled" : ""}>
              <b>${safe(o.name)}</b><small>${deltaText(o.priceDelta)}${o.soldOut ? " · Uitverkocht" : ""}</small>
            </button>`;
          }).join("")}</div>
          <div class="option-wizard-actions">
            <button type="button" class="secondary" id="optionBack" ${step === 0 ? "disabled" : ""}><i data-lucide="chevron-left"></i> Vorige</button>
            ${step < groups.length - 1
              ? `<button type="button" class="primary" id="optionNext" ${!chosen[step] ? "disabled" : ""}>Volgende stap <i data-lucide="arrow-right"></i></button>`
              : `<button type="button" class="primary" id="detailAdd" ${!chosen[step] ? "disabled" : ""}><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen</button>`}
          </div>
          <div class="option-summary"><span>Prijs tot nu toe</span><b>${money(total)}</b></div>
          ${chosen.some(Boolean) ? `<div class="config-summary">${chosen.filter(Boolean).map(s => `<div class="config-summary-row"><span>${safe(s.label)}</span><b>${safe(s.value)} · ${deltaText(s.priceDelta)}</b></div>`).join("")}</div>` : ""}
        </div>` : ""}
        ${!groups.length && !out ? `<button class="primary full" id="detailAdd"><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen · ${money(p.price)}</button>` : ""}
        ${groups.length && !out && step === groups.length - 1 && chosen.every(Boolean) ? `<p class="hint">Je hebt alle ${groups.length} keuzes gemaakt. De prijs hierboven is inclusief alle toeslagen en kortingen.</p>` : ""}
        ${out ? `<button class="primary full" disabled>Momenteel niet beschikbaar</button>` : ""}
      </div>
    </div>`;
    content.querySelectorAll("[data-image]").forEach(b => b.onclick = () => { activeImage = Number(b.dataset.image); render(); });
    content.querySelectorAll("[data-choice]").forEach(b => b.onclick = () => {
      const option = current.options[Number(b.dataset.choice)];
      chosen[step] = { label: current.label, value: option.name, priceDelta: Number(option.priceDelta) || 0 };
      chosen = chosen.slice(0, step + 1); render();
    });
    $("#optionBack")?.addEventListener("click", () => { step = Math.max(0, step - 1); render(); });
    $("#optionNext")?.addEventListener("click", () => { if (!chosen[step]) return; step = Math.min(groups.length - 1, step + 1); render(); });
    $("#detailAdd")?.addEventListener("click", () => {
      if (groups.length && chosen.length !== groups.length) return toast("Maak eerst alle keuzes af");
      addCart(id, chosen); closeDialog();
    });
  };
  openDialog(`<div class="loading">Product laden…</div>`);
  render();
}

/* ---------- winkelwagen-dialoog ---------- */
$("#cartBtn").onclick = showCart;
function showCart() {
  const sub = state.cart.reduce((n, x) => n + x.price * x.qty, 0);
  openDialog(`<p class="eyebrow">JOUW SELECTIE</p><h2>Winkelwagen</h2>${state.cart.length ? `<div class="cart-lines">${state.cart.map(x => { const k = safe(itemKey(x.id, selectionsOf(x))), issue = state.loaded ? cartIssue(x) : "", choices = selectionsOf(x); return `<div class="cart-line"><div class="cart-line-info"><b>${safe(x.title)}</b>${choices.map(s => `<small>${safe(s.label)}: <b>${safe(s.value)}</b> <span class="muted">(${deltaText(s.priceDelta)})</span></small>`).join("")}<small>${money(x.price)} per stuk</small>${issue ? `<small class="line-issue">${safe(issue)}</small>` : ""}<div class="quantity-control"><button type="button" aria-label="Minder" data-qty="${k}" data-delta="-1">−</button><span>${x.qty}</span><button type="button" aria-label="Meer" data-qty="${k}" data-delta="1">＋</button></div></div><div class="cart-line-actions"><b>${money(x.price * x.qty)}</b><button class="remove-item" data-remove="${k}">Verwijder</button></div></div>`; }).join("")}</div><div class="cart-sum"><div><span>Subtotaal</span><span>${money(sub)}</span></div><div><span>Verzendkosten</span><span>${money(SHIPPING)} bij verzenden · ophalen gratis</span></div></div><div class="cart-total"><span>Producttotaal</span><b>${money(sub)}</b></div><div class="stack note-field"><label>Opmerking bij je bestelling (optioneel)<textarea id="orderNote" rows="3" maxlength="500" placeholder="Bijv. gewenste afwerking of een wens voor de kleur">${safe(state.orderNote)}</textarea></label></div><button class="primary full" id="checkout">Verder naar bestellen</button>` : `<div class="empty-state">Je winkelwagen is nog leeg.</div><button class="secondary full" id="continue">Verder winkelen</button>`}`);
  content.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { state.cart = state.cart.filter(x => itemKey(x.id, selectionsOf(x)) !== b.dataset.remove); saveCart(); showCart(); });
  content.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => {
    const it = state.cart.find(x => itemKey(x.id, selectionsOf(x)) === b.dataset.qty); if (!it) return;
    it.qty += Number(b.dataset.delta); if (it.qty <= 0) state.cart = state.cart.filter(x => x !== it);
    saveCart(); showCart();
  });
  $("#continue")?.addEventListener("click", closeDialog);
  $("#orderNote")?.addEventListener("input", e => state.orderNote = e.target.value);
  $("#checkout")?.addEventListener("click", () => state.user ? checkoutChoice() : authForm("login", "Log in met een klantaccount om je bestelling af te ronden."));
}

/* ---------- maatwerkoffertes ---------- */
function quoteColorsFrom(raw, includeInactive = false) {
  return Object.entries(raw || {}).map(([id, value]) => ({ id, ...(value || {}) }))
    .filter(c => c.name && /^#[0-9a-f]{6}$/i.test(String(c.hex || "")) && (includeInactive || (c.active !== false && c.soldOut !== true)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "nl"));
}
async function startQuoteRequest() {
  if (!state.user) { state.pendingQuoteRequest = true; return authForm("login", "Log in met je klantaccount om je eigen product aan te vragen. Na het inloggen opent het offerteformulier automatisch."); }
  openDialog(`<p class="eyebrow">MAATWERK · EIGEN ONTWERP</p><h2>Vraag een offerte aan</h2><div id="quoteFormBox" class="stack">${firebaseLoadingMarkup("Beschikbare kleuren laden…")}</div>`);
  try {
    const colorsSnap = await get(ref(db, "settings/quoteColors"));
    const colors = quoteColorsFrom(colorsSnap.val());
    if (!colors.length) {
      $("#quoteFormBox").innerHTML = `<div class="empty-state">Er zijn nog geen kleuren beschikbaar voor maatwerk. Neem contact op met de webshopbeheerder of probeer het later opnieuw.</div>`;
      return;
    }
    $("#quoteFormBox").innerHTML = `<p class="muted">Beschrijf wat je wilt laten printen. Alle afmetingen zijn in millimeters; elk maximaal 180 mm.</p>
      <form id="quoteRequestForm" class="stack quote-form">
        <label>Titel van je product<input name="title" required maxlength="90" placeholder="Bijv. Eigen telefoonhouder"></label>
        <label>Beschrijving<textarea name="description" required rows="4" maxlength="1800" placeholder="Wat moet het product kunnen en waar moet ik op letten?"></textarea></label>
        <div class="quote-dimensions"><label>Lengte (mm)<input name="length" type="number" min="1" max="180" step="1" required inputmode="numeric" placeholder="180"></label><label>Breedte (mm)<input name="width" type="number" min="1" max="180" step="1" required inputmode="numeric" placeholder="100"></label><label>Hoogte (mm)<input name="height" type="number" min="1" max="180" step="1" required inputmode="numeric" placeholder="80"></label></div>
        <small class="hint">Maximaal 180 mm per richting (L, B én H).</small>
        <fieldset class="quote-color-fieldset"><legend>Gewenste kleur</legend><div class="quote-color-choices">${colors.map(c => `<label class="quote-color-choice"><input type="radio" name="colorId" value="${safe(c.id)}" required><span class="quote-color-swatch" style="--quote-color:${safe(c.hex)}"></span><b>${safe(c.name)}</b></label>`).join("")}</div></fieldset>
        <label>Afbeelding of ontwerp toevoegen<input name="image" type="file" accept="image/*" required><small class="hint">Upload een duidelijke afbeelding (PNG, JPG of WEBP). De afbeelding wordt automatisch verkleind.</small></label>
        <div id="quoteImagePreview" class="quote-image-preview" hidden></div>
        <button type="submit" class="primary full">Offerte aanvragen en chat starten</button>
      </form>`;
    const form = $("#quoteRequestForm"), fileInput = form.elements.image, preview = $("#quoteImagePreview");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (!file) { preview.hidden = true; preview.innerHTML = ""; return; }
      if (!file.type.startsWith("image/")) { fileInput.value = ""; return toast("Kies een afbeeldingsbestand."); }
      if (file.size > 12 * 1024 * 1024) { fileInput.value = ""; return toast("Kies een afbeelding kleiner dan 12 MB."); }
      preview.hidden = false; preview.innerHTML = `<img alt="Voorbeeld van je ontwerp" src="${URL.createObjectURL(file)}"><span>${safe(file.name)}</span>`;
    });
    form.onsubmit = async e => {
      e.preventDefault();
      const submit = e.submitter; if (!state.user) return authForm("login");
      const data = new FormData(form), length = Number(data.get("length")), width = Number(data.get("width")), height = Number(data.get("height"));
      if (![length, width, height].every(n => Number.isInteger(n) && n >= 1 && n <= 180)) return toast("Lengte, breedte en hoogte moeten ieder tussen 1 en 180 mm zijn.");
      const file = fileInput.files?.[0]; if (!file || !file.type.startsWith("image/")) return toast("Voeg een afbeelding van je ontwerp toe.");
      submit.disabled = true; submit.textContent = "Offerte en chat aanmaken…";
      try {
        // Controleer direct vóór opslaan opnieuw of de gekozen kleur nog beschikbaar is.
        const freshColorsSnap = await get(ref(db, "settings/quoteColors"));
        const freshColors = quoteColorsFrom(freshColorsSnap.val());
        const chosen = freshColors.find(c => c.id === data.get("colorId"));
        if (!chosen) throw new Error("Deze kleur is ondertussen uitverkocht of niet meer beschikbaar. Kies een andere kleur.");
        const image = await shrinkImage(file, 1000, 300000);
        const quoteId = push(ref(db, "quotes")).key, chatId = push(ref(db, "chats")).key, now = Date.now();
        const title = String(data.get("title") || "").trim().slice(0, 90), description = String(data.get("description") || "").trim().slice(0, 1800);
        if (!title || !description) throw new Error("Vul een titel en beschrijving in.");
        const dimensions = { length, width, height };
        const quote = { userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, title, description, image, imageName: String(file.name || "ontwerp").slice(0, 120), dimensions, colorId: chosen.id, colorName: chosen.name, colorHex: chosen.hex, status: "ontvangen", createdAt: now, chatId };
        const msgId = push(ref(db, `chats/${chatId}/messages`)).key;
        const systemText = `Je offerteaanvraag voor “${title}” is ontvangen. Afmetingen: ${length} × ${width} × ${height} mm (L × B × H). Kleur: ${chosen.name}. We bespreken je aanvraag hier verder.`;
        await update(ref(db), {
          [`quotes/${quoteId}`]: quote,
          [`chats/${chatId}`]: { kind: "quote", quoteId, quoteTitle: title, userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, createdAt: now, lastMessage: systemText, lastMessageAt: now, messages: { [msgId]: { sender: "system", text: systemText, createdAt: now } } }
        });
        closeDialog(); toast("Offerteaanvraag verstuurd"); openChat(chatId);
      } catch (error) {
        console.error("Quote request failed", error); toast(error.message || "Offerte aanvragen is niet gelukt."); submit.disabled = false; submit.textContent = "Offerte aanvragen en chat starten";
      }
    };
  } catch (error) {
    console.error("Quote colors could not be loaded", error);
    $("#quoteFormBox").innerHTML = `<p class="muted">De beschikbare kleuren konden niet worden geladen. Probeer het opnieuw.</p><button type="button" class="secondary" id="retryQuoteColors">Opnieuw proberen</button>`;
    $("#retryQuoteColors").onclick = startQuoteRequest;
  }
}
$("#requestQuoteBtn").onclick = startQuoteRequest;

/* ---------- klantaccount ---------- */
function authForm(mode = "login", message = "") {
  const login = mode === "login";
  openDialog(`<p class="eyebrow">3D PRINTED SHOP ACCOUNT</p><h2>${login ? "Welkom terug" : "Account aanmaken"}</h2><p class="muted">${safe(message)}</p><form id="authForm" class="stack">${login ? "" : `<label>Gebruikersnaam<input type="text" id="authUsername" required minlength="3" maxlength="20" pattern="[A-Za-z0-9._-]{3,20}" autocomplete="nickname" placeholder="Bijv. printfan23"></label>`}<label>E-mailadres<input type="email" id="authEmail" required autocomplete="email"></label><label>Wachtwoord<input type="password" id="authPassword" required minlength="${login ? 1 : 8}" autocomplete="${login ? "current-password" : "new-password"}"></label>${login ? "" : `<p class="hint">Minimaal 8 tekens. Je gebruikersnaam is zichtbaar; je e-mailadres niet.</p>`}<button class="primary full">${login ? "Inloggen" : "Account aanmaken"}</button></form><p class="switch-auth">${login ? "Nog geen account?" : "Heb je al een account?"} <button id="switchAuth" class="inline-link">${login ? "Account aanmaken" : "Inloggen"}</button></p>`);
  $("#authForm").onsubmit = async e => {
    e.preventDefault(); if (locked()) return;
    const btn = e.submitter; btn && (btn.disabled = true);
    const email = $("#authEmail").value.trim().toLowerCase(), pw = $("#authPassword").value;
    try {
      const key = await emailKey(email), accRef = ref(db, "accounts/" + key), acc = (await get(accRef)).val();
      if (!login) {
        const username = $("#authUsername").value.trim();
        if (!validUsername(username)) return toast("Gebruikersnaam moet 3–20 tekens bevatten.");
        if (acc) return toast("Dit e-mailadres bestaat al.");
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const claimed = await claimUsername(key, username);
        try { await set(accRef, { email, salt, hash: await hashPw(pw, salt), createdAt: Date.now() }); }
        catch (err) { await set(ref(db, `usernames/${usernameKey(claimed)}`), null); throw err; }
        setCustomer({ uid: key, email, username: claimed, role: "customer" }); closeDialog(); toast("Account aangemaakt!"); continuePendingQuoteRequest();
      } else {
        if (!acc || await hashPw(pw, acc.salt) !== acc.hash) return failed();
        await activateCustomer(key, email);
      }
    } catch (err) { console.error(err); toast(err.message || "Accountactie mislukt. Probeer het opnieuw."); }
    finally { btn && (btn.disabled = false); }
  };
  $("#switchAuth").onclick = () => authForm(login ? "register" : "login");
}
$("#accountBtn").onclick = () => state.user ? accountMenu() : authForm();
function accountMenu() {
  openDialog(`<p class="eyebrow">MIJN ACCOUNT</p><h2>${safe(state.user.username || "Mijn account")}</h2><p class="muted">Je e-mailadres wordt niet als profielnaam getoond.</p><div class="stack"><button class="secondary full" id="myOrders">Mijn bestellingen</button><button class="secondary full" id="myChats">Mijn chats</button><button class="secondary full" id="editUsername">Gebruikersnaam wijzigen</button><button class="secondary full" id="logout">Uitloggen</button></div>`);
  $("#myOrders").onclick = showMyOrders; $("#myChats").onclick = showMyChats;
  $("#editUsername").onclick = () => usernamePrompt(state.user.uid, state.user.email, state.user.username || "");
  $("#logout").onclick = logoutCustomer;
}
function logoutCustomer() { state.user = null; sessionStorage.removeItem("novashopUser"); refreshNav(); closeDialog(); toast("Je bent uitgelogd"); }
function logoutAdmin() { state.admin = false; sessionStorage.removeItem("novashopAdmin"); refreshNav(); closeDialog(); toast("Je bent uitgelogd bij Sitebeheer"); }

/* ---------- bestellen ---------- */
function checkoutChoice() {
  if (!state.cart.length) return toast("Je winkelwagen is leeg.");
  const subtotal = state.cart.reduce((n, x) => n + x.price * x.qty, 0);
  openDialog(`<p class="eyebrow">AFREKENEN</p><h2>Hoe wil je je bestelling ontvangen?</h2><p class="muted">Kies verzenden of ophalen. Bij ophalen via chat hoef je geen adres in te vullen.</p><div class="checkout-methods"><button class="checkout-method" id="normalCheckout"><b>Verzenden of ophalen</b><small>Kies daarna in het formulier of je het product wilt laten verzenden of gratis wilt ophalen. Bij verzenden vul je je adres in.</small><strong>${money(subtotal)} + eventuele verzendkosten</strong></button><button class="checkout-method" id="chatCheckout"><b>Ophalen via chat</b><small>Geen verzendadres nodig en geen verzendkosten. We spreken in de chat af wanneer je de bestelling kunt ophalen.</small><strong>${money(subtotal)} · ophalen gratis</strong></button></div>`);
  $("#normalCheckout").onclick = checkoutForm;
  $("#chatCheckout").onclick = placeChatOrder;
}
function checkoutForm() {
  const sub = state.cart.reduce((n, x) => n + x.price * x.qty, 0);
  openDialog(`<p class="eyebrow">GEGEVENS VOOR JE BESTELLING</p><h2>Verzenden of ophalen</h2><form id="shippingForm" class="stack checkout-form">
    <fieldset class="checkout-pick"><legend>Hoe wil je je bestelling ontvangen?</legend><label><input type="radio" name="fulfillment" value="delivery" checked> Verzenden <span>+ ${money(SHIPPING)}</span></label><label><input type="radio" name="fulfillment" value="pickup"> Ophalen <span>Gratis</span></label></fieldset>
    <div id="addressFields"><div class="checkout-two"><label>Voornaam<input name="firstName" required maxlength="60" autocomplete="given-name"></label><label>Achternaam<input name="lastName" required maxlength="80" autocomplete="family-name"></label></div>
    <div class="checkout-two"><label>Straat<input name="street" required maxlength="100" autocomplete="address-line1"></label><label>Huisnummer<input name="houseNumber" required maxlength="12"></label></div>
    <label>Toevoeging (optioneel)<input name="addition" maxlength="20" placeholder="Bijv. A"></label>
    <div class="checkout-two"><label>Postcode<input name="postcode" required maxlength="8" autocomplete="postal-code" placeholder="1234 AB" pattern="[0-9]{4}\\s?[A-Za-z]{2}"></label><label>Dorp / stad<input name="city" required maxlength="80" autocomplete="address-level2"></label></div>
    <label>Land<input value="Nederland" readonly></label></div>
    <label>Opmerking (optioneel)<textarea name="note" rows="3" maxlength="500">${safe(state.orderNote || "")}</textarea></label>
    <div class="cart-total"><span>Producten</span><b>${money(sub)}</b></div><p id="checkoutTotal" class="checkout-total">Totaal bij verzenden: <b>${money(sub + SHIPPING)}</b></p>
    <button class="primary full" id="payIdeal">Bestelling plaatsen · wachten op betaalverzoek · ${money(sub + SHIPPING)}</button>
  </form>`);
  const form = $("#shippingForm"), addressFields = $("#addressFields"), payBtn = $("#payIdeal"), totalEl = $("#checkoutTotal");
  const sync = () => { const pickup = form.elements.fulfillment.value === "pickup"; addressFields.hidden = pickup; addressFields.querySelectorAll("input").forEach(el => el.required = !pickup && el.name !== "addition"); const total = sub + (pickup ? 0 : SHIPPING); totalEl.innerHTML = `Totaal (${pickup ? "ophalen" : "verzenden"}): <b>${money(total)}</b>`; payBtn.textContent = `Bestelling plaatsen · betaalverzoek volgt · ${money(total)}`; };
  form.querySelectorAll('input[name="fulfillment"]').forEach(el => el.addEventListener("change", sync)); sync();
  form.onsubmit = async e => {
    e.preventDefault(); if (!state.user) return authForm("login");
    if (!state.loaded) return toast("Producten worden nog geladen.");
    const data = new FormData(form), pickup = data.get("fulfillment") === "pickup";
    const address = pickup ? null : { firstName: String(data.get("firstName") || "").trim(), lastName: String(data.get("lastName") || "").trim(), street: String(data.get("street") || "").trim(), houseNumber: String(data.get("houseNumber") || "").trim(), addition: String(data.get("addition") || "").trim(), postcode: String(data.get("postcode") || "").trim().toUpperCase(), city: String(data.get("city") || "").trim(), country: "Nederland" };
    if (!pickup && !/^[0-9]{4}\s?[A-Z]{2}$/.test(address.postcode)) return toast("Vul een geldige Nederlandse postcode in.");
    const bad = state.cart.filter(c => cartIssue(c)); if (bad.length) return toast("Controleer je winkelwagen: een product/optie is niet meer beschikbaar.");
    payBtn.disabled = true; payBtn.textContent = "Bestelling aanmaken…";
    try {
      const items = state.cart.map(c => { const product = state.products.find(x => x.id === c.id); const selected = selectionsOf(c); const delta = selected.reduce((sum, choice) => { const group = optionGroupsOf(product).find(g => g.label === choice.label), option = group?.options.find(o => o.name === choice.value); return sum + (Number(option?.priceDelta) || 0); }, 0); return { id: c.id, title: product.title, price: Math.max(0, Number(product.price) + delta), qty: c.qty, ...(selected.length ? { selections: selected } : {}) }; });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0), shipping = pickup ? 0 : SHIPPING, total = subtotal + shipping;
      const orderId = push(ref(db, "orders")).key, now = Date.now(), publicToken = randomToken();
      const order = { userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, items, subtotal, shipping, total, address, fulfillmentMethod: pickup ? "pickup" : "delivery", paymentMethod: "tikkie", paymentStatus: "awaiting_tikkie", status: STATUSES[0], createdAt: now, publicToken, ...(String(data.get("note") || "").trim() ? { note: String(data.get("note") || "").trim().slice(0, 500) } : {}) };
      await update(ref(db), { [`orders/${orderId}`]: order, [`publicTrack/${publicToken}`]: publicTrackPayload({ ...order, id: orderId }) });
      state.cart = []; state.orderNote = ""; saveCart();
      openDialog(`<p class="eyebrow">BESTELLING AANGEMAAKT</p><h2>Wachten op betaalverzoek</h2><p>Je bestelling <b>#${short(orderId)}</b> is aangemaakt. Zodra de beheerder de betaallink toevoegt, verschijnt die hier bij <b>Mijn bestellingen</b>.</p><p class="muted">Totaal: <b>${money(total)}</b>. Je hoeft nu nog niets te betalen.</p><button class="primary full" id="toMyOrders">Bekijk mijn bestellingen</button>`);
      $("#toMyOrders").onclick = showMyOrders;
    } catch (err) { console.error(err); toast("Bestelling aanmaken is niet gelukt. Probeer het opnieuw."); payBtn.disabled = false; sync(); }
  };
}
async function placeChatOrder() {
  if (!state.cart.length || !state.user) return;
  if (!state.loaded) return toast("Producten worden nog geladen.");
  const bad = state.cart.filter(c => cartIssue(c)); if (bad.length) return toast("Controleer je winkelwagen: een product/optie is niet meer beschikbaar.");
  const items = state.cart.map(c => { const p = state.products.find(x => x.id === c.id); const selected = selectionsOf(c); const delta = selected.reduce((sum, s) => { const group = optionGroupsOf(p).find(g => g.label === s.label), option = group?.options.find(o => o.name === s.value); return sum + (Number(option?.priceDelta) || 0); }, 0); return { id: c.id, title: p.title, price: Math.max(0, Number(p.price) + delta), qty: c.qty, ...(selected.length ? { selections: selected } : {}) }; });
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0), total = subtotal, note = (state.orderNote || "").trim().slice(0, 500);
  const orderKey = push(ref(db, "orders")).key, chatKey = push(ref(db, "chats")).key, msgKey = push(ref(db, `chats/${chatKey}/messages`)).key, now = Date.now(), publicToken = randomToken();
  const newOrder = { userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, items, subtotal, shipping: 0, total, fulfillmentMethod: "pickup", address: null, paymentMethod: "chat", paymentStatus: "not_required", status: STATUSES[0], createdAt: now, chatId: chatKey, publicToken, ...(note ? { note } : {}) };
  try {
    await update(ref(db), { ["orders/" + orderKey]: newOrder, ["publicTrack/" + publicToken]: publicTrackPayload({ ...newOrder, id: orderKey }), ["chats/" + chatKey]: { orderId: orderKey, userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, createdAt: now, lastMessage: "Bestelling · ophalen", lastMessageAt: now, messages: { [msgKey]: { sender: "system", text: `Je bestelling is aangemaakt met afhalen als afhandeling. Producttotaal: ${money(total)}. Er zijn geen verzendkosten toegevoegd. We bespreken de verdere afspraken hier in de chat.`, createdAt: now } } } });
    state.cart = []; state.orderNote = ""; saveCart(); toast("Chatbestelling aangemaakt"); openChat(chatKey);
  } catch (e) { console.error(e); toast("Chatbestelling starten lukte niet."); }
}
function showMyOrders() {
  openDialog(`<p class="eyebrow">OVERZICHT</p><h2>Mijn bestellingen</h2><div id="ordersBox" class="stack">${firebaseLoadingMarkup("Bestellingen laden…")}</div>`);
  // Lees alle bestellingen en filter op account-ID of e-mailadres.
  // Zo blijven oudere bestellingen zichtbaar die alleen een e-mailadres opsloegen.
  listen(ref(db, "orders"), snap => {
    const email = String(state.user.email || "").trim().toLowerCase();
    const orders = toList(snap).filter(o =>
      o.userId === state.user.uid ||
      (email && String(o.email || "").trim().toLowerCase() === email)
    ).sort((a, b) => b.createdAt - a.createdAt);
    $("#ordersBox").innerHTML = orders.length ? orders.map(o => `<div class="order-row"><div><b>Bestelling #${short(o.id)}</b><small>${when(o.createdAt)} · ${money(o.total)} · ${fulfillmentLabel(o)} · betaling: ${safe(o.paymentStatus === "awaiting_tikkie" ? "Wachten op betaalverzoek" : o.paymentStatus === "tikkie_link_added" ? "Betaallink beschikbaar" : o.paymentStatus || "niet geregistreerd")}</small>${o.address ? `<p class="order-note"><b>Verzendadres:</b> ${safe([o.address.firstName, o.address.lastName].filter(Boolean).join(" "))}, ${safe(o.address.street || "")} ${safe(o.address.houseNumber || "")}, ${safe(o.address.postcode || "")} ${safe(o.address.city || "")}</p>` : ""}<span class="status-pill">${safe(statusLabel(o))}</span>${o.paymentMethod === "tikkie" ? (o.tikkieLink ? `<p class="order-note"><b>Betaal via betaalverzoek:</b> <a href="${safe(o.tikkieLink)}" target="_blank" rel="noopener noreferrer">Open jouw betaalverzoek</a></p>` : `<p class="order-note">De betaallink wordt nog door de webshopbeheerder toegevoegd.</p>`) : ""}${o.deliveredAt ? `<p class="order-note">${isPickupOrder(o) ? "Opgehaald" : "Afgeleverd"} op ${when(o.deliveredAt)}. ${o.returnRequestAt ? `Retour aangevraagd op ${when(o.returnRequestAt)}. Status: ${o.returnStatus === "handled" ? "afgehandeld" : "in behandeling"}.` : Date.now() < returnDeadline(o) ? `Retour aanvragen kan tot ${when(returnDeadline(o))}.` : "De retourtermijn van 14 dagen is verstreken."}</p>` : ""}</div><div class="order-actions"><button class="secondary" data-track="${safe(o.id)}">Volgen</button><button class="secondary" data-share="${safe(o.id)}"><i data-lucide="share-2"></i> Deellink</button>${returnWindowOpen(o) ? `<button class="primary" data-return="${safe(o.id)}">Retour aanvragen</button>` : ""}</div></div>`).join("") : "<p class='muted'>Je hebt nog geen bestellingen.</p>";
    content.querySelectorAll("[data-track]").forEach(b => b.onclick = () => showOrderTracking(b.dataset.track));
    content.querySelectorAll("[data-share]").forEach(b => b.onclick = () => createShareTrack(b.dataset.share));
    content.querySelectorAll("[data-return]").forEach(b => b.onclick = async () => {
      const id = b.dataset.return;
      if (!confirm("Wil je voor deze bestelling een retour aanvragen? De webshopbeheerder ontvangt je aanvraag.")) return;
      try {
        const snap = await get(ref(db, `orders/${id}`));
        const order = snap.val();
        if (!order || order.userId !== state.user.uid || !returnWindowOpen({ ...order, id })) return toast("Retour aanvragen is niet meer mogelijk.");
        const now = Date.now();
        await update(ref(db, `orders/${id}`), { returnRequestAt: now, returnStatus: "requested" });
        await syncPublicTrack(id);
        toast("Retouraanvraag verzonden. De beheerder ziet deze bij Sitebeheer.");
      } catch (err) { console.error(err); toast("Retouraanvraag versturen is niet gelukt."); }
    });
  });
}
async function createShareTrack(orderId) {
  try {
    const snap = await get(ref(db, `orders/${orderId}`)), order = snap.val();
    if (!order || (state.user && order.userId !== state.user.uid && !state.admin)) return toast("Deze bestelling is niet beschikbaar");
    const token = order.publicToken || randomToken();
    if (!order.publicToken) await update(ref(db, `orders/${orderId}`), { publicToken: token });
    await set(ref(db, `publicTrack/${token}`), publicTrackPayload({ ...order, id: orderId }));
    await copyTrackLink(token);
  } catch (e) { console.error(e); toast("Deellink maken is niet gelukt"); }
}
let camStop = null, camUrlShown = "", camCfg = {};   // camCfg = settings/camera uit Firebase (aan/uit, tijdelijk uit, stream-URL)
const CAM_MSG = "Sorry, we ervaren op dit moment problemen met de camera. We proberen dit zo snel mogelijk op te lossen.";
const camDisabled = () => camCfg.enabled === false && (!camCfg.until || camCfg.until > Date.now());
function camHalt() { if (camStop) camStop(); camStop = null; }
function renderCamera(show, getShown, setShown) {
  const box = $("#camBox");
  if (!box) return;
  if (!show) {
    if (getShown() !== false) { camHalt(); setShown(false); box.innerHTML = ""; }
    return;
  }
  if (camDisabled()) {
    if (getShown() !== "off") {
      camHalt(); setShown("off");
      box.innerHTML = `<div class="cam-card"><div class="cam-head"><b>Printercamera</b><span class="cam-off">TIJDELIJK UIT</span></div><div class="cam-offline"><b class="cam-off-title">Camera tijdelijk niet beschikbaar</b><br><small>${CAM_MSG}</small></div></div>`;
    }
    return;
  }
  const url = String(camCfg.url || CFG.cameraUrl || "").trim();   // URL uit Firebase (door bambu_cam.py) wint van beheer-config.js
  if (!url) {
    if (getShown() !== "setup") {
      camHalt(); setShown("setup");
      box.innerHTML = `<div class="cam-card"><div class="cam-head"><b>Printercamera</b><span class="cam-wait">NIET INGESTELD</span></div><div class="cam-offline">De livecamera is nog niet gekoppeld.<br><small>Stel de camerabrug in en vul daarna de HTTPS-stream-URL in bij <code>beheer-config.js</code> (cameraUrl).</small></div></div>`;
    }
    return;
  }
  if (getShown() === true && camUrlShown === url) return;
  camHalt(); camUrlShown = url; setShown(true);
  box.innerHTML = `<div class="cam-card"><div class="cam-head"><b>Live meekijken</b><span class="cam-wait" id="camState">● VERBINDEN…</span></div><div class="cam-frame"><img id="camImg" alt="Livebeeld van de 3D-printer"><div class="cam-offline hidden" id="camOff"><b class="cam-off-title">3D printer is offline</b><br><small>We proberen het automatisch opnieuw.</small><br><button class="secondary" id="camRetry">Opnieuw proberen</button></div></div></div>`;
  const img = $("#camImg"), off = $("#camOff"), label = $("#camState");
  let loadTimer, retryTimer, pollTimer, statusOk = false, fails = 0;
  const statusUrl = (() => { try { const u = new URL(url); u.pathname = u.pathname.replace(/stream\.mjpeg$/, "status"); u.search = ""; return u.href; } catch { return ""; } })();
  const stopAll = () => { clearTimeout(loadTimer); clearTimeout(retryTimer); clearInterval(pollTimer); };
  const setLabel = (text, cls) => { label.textContent = text; label.className = cls; };
  const offline = () => { stopAll(); img.removeAttribute("src"); setLabel("● OFFLINE", "cam-off"); img.classList.add("hidden"); off.classList.remove("hidden"); retryTimer = setTimeout(load, Math.min(20000 * 2 ** fails++, 300000)); };   // backoff: 20s, 40s, 80s … max 5 min (geen foutenregen in de console)
  const poll = async () => {                       // vangt een printer op die uitvalt terwijl het beeld al live was
    if (!statusUrl) return;
    try {
      const r = await fetch(statusUrl, { cache: "no-store" });
      if (!r.ok) return clearInterval(pollTimer);   // oude camerabrug zonder /api/status: niets afdwingen
      const j = await r.json(); statusOk = true;
      if (!j.online) offline();
    } catch { if (statusOk) offline(); }
  };
  const load = () => {
    stopAll(); off.classList.add("hidden"); img.classList.remove("hidden"); setLabel("● VERBINDEN…", "cam-wait");
    img.src = url + (url.includes("?") ? "&" : "?") + "t=" + Date.now();
    loadTimer = setTimeout(offline, 15000);        // geen beeld binnen 15 seconden = printer offline
  };
  img.onload = () => { fails = 0; clearTimeout(loadTimer); setLabel("● LIVE", "cam-live"); clearInterval(pollTimer); pollTimer = setInterval(poll, 8000); };
  img.onerror = offline;
  $("#camRetry").onclick = () => { fails = 0; load(); };
  camStop = () => { stopAll(); img.onload = img.onerror = null; img.removeAttribute("src"); };
  unsubs.push(() => { stopAll(); img.onload = img.onerror = null; });
  load();
}
function showOrderTracking(id, asAdmin = false) {
  openDialog(`<p class="eyebrow">TRACK & TRACE</p><h2>Bestelling #${short(id)}</h2><div id="trackBox"></div><div id="camBox"></div>`);
  let camShown = null, curOrder = null, camTimer;
  const drawCam = () => {
    clearTimeout(camTimer);
    renderCamera(!!curOrder && CAMERA_STATUSES.includes(curOrder.status), () => camShown, v => camShown = v);
    if (camCfg.enabled === false && camCfg.until > Date.now()) camTimer = setTimeout(drawCam, Math.min(camCfg.until - Date.now() + 500, 2147483000));   // na afloop vanzelf weer aan
  };
  unsubs.push(() => clearTimeout(camTimer));
  unsubs.push(onValue(ref(db, "settings/camera"), snap => { camCfg = snap.val() || {}; drawCam(); }, () => {}));
  listen(ref(db, "orders/" + id), snap => {
    const o = snap.val(); if (!o) return; const idx = STATUSES.indexOf(o.status);
    curOrder = o; drawCam();
    $("#trackBox").innerHTML = `<div class="tracking">${STATUSES.map((x, i) => `<div class="track-step ${idx >= i ? "done" : ""}"><span>${i + 1}</span><b>${safe(statusLabel(o, x))}</b></div>`).join("")}</div><p class="muted">Afhandeling: <b>${safe(fulfillmentLabel(o))}</b> · Huidige status: <b>${safe(statusLabel(o))}</b></p><div class="order-items">${(o.items || []).map(i => `<div>${safe(i.title)}${optText(i)} × ${i.qty}${showStage(o, i) ? stageChips(i) : ""}${Array.from({ length: Math.max(1, Number(i.qty) || 1) }, (_, u) => slotLine(o, (o.items || []).indexOf(i), u)).join("")}</div>`).join("")}</div>${planBox(o, false)}${o.note ? `<p class="order-note"><b>Jouw opmerking:</b> ${safe(o.note)}</p>` : ""}<div class="cart-sum"><div><span>Subtotaal</span><span>${money(o.subtotal ?? o.total)}</span></div><div><span>Verzendkosten</span><span>${money(o.shipping ?? 0)}</span></div><div><b>Totaal</b><b>${money(o.total)}</b></div></div><div class="tracking-actions"><button class="secondary" id="trackShare"><i data-lucide="share-2"></i> Deel track & trace</button><button class="primary" id="trackChat">Open chat over deze bestelling</button></div>`;
    $("#trackShare").onclick = () => o.publicToken ? copyTrackLink(o.publicToken) : createShareTrack(id);
     $("#trackChat").onclick = () => o.chatId && openChat(o.chatId, asAdmin);
  });
}
function showPublicTracking(token) {
  document.body.classList.add("public-tracking-mode");
  if (!/^[a-f0-9]{32,64}$/i.test(String(token || ""))) {
    openDialog(`<p class="eyebrow">TRACK & TRACE</p><h2>Ongeldige volg-link</h2><p class="muted">Controleer of je de volledige link hebt ontvangen.</p>`);
    return;
  }
  openDialog(`<div class="public-track-head"><div><p class="eyebrow">3D PRINTED SHOP · TRACK & TRACE</p><h2>Bestelling volgen</h2><p class="public-track-note">Dit is een alleen-lezen overzicht. Inloggen is niet nodig.</p></div><span class="status-pill">Link actief</span></div><div id="publicTrackBox" class="stack">${firebaseLoadingMarkup("Bestelling laden…")}</div>`);
  listen(ref(db, `publicTrack/${token}`), snap => {
    const o = snap.val(), box = $("#publicTrackBox");
    if (!box) return;
    if (!o) { box.innerHTML = `<div class="empty-state">Deze track & trace-link is niet gevonden of niet meer beschikbaar.</div>`; return; }
    const idx = STATUSES.indexOf(o.status);
    const whenReady = o.estimatedReady ? whenShort(o.estimatedReady) : "";
    box.innerHTML = `<div class="public-track-head"><div><b>Bestelling #${safe(o.shortId || "—")}</b><small class="public-track-note">Geplaatst op ${when(o.createdAt)}</small></div><span class="status-pill">${safe(statusLabel(o))}</span></div>
      <div class="tracking">${STATUSES.map((s, i) => `<div class="track-step ${idx >= i ? "done" : ""}"><span>${idx > i ? "✓" : i + 1}</span><b>${safe(statusLabel(o, s))}</b></div>`).join("")}</div>
      <h3>Bestellingsoverzicht</h3>
      ${(o.items || []).map((item, n) => {
        const units = Math.max(1, Number(item.qty) || 1), stages = item.stages || [];
        const selectionText = (item.selections || []).map(s => `${safe(s.label)}: <b>${safe(s.value)}</b>`).join(" · ");
        const schedules = Object.entries(item.plan || {}).sort(([a],[b]) => a.localeCompare(b)).map(([k, slot]) => slot?.startTs ? `<small>Stuk ${Number(k.split("_").pop()) + 1}: ${whenShort(slot.startTs)} – ${new Date(slot.endTs).toLocaleTimeString("nl-NL",{hour:"2-digit",minute:"2-digit"})}</small>` : "").join("");
        return `<div class="public-item"><b>${safe(item.title)} × ${units}</b>${selectionText ? `<small>${selectionText}</small>` : ""}${item.dimensions ? `<small>Afmetingen: ${Number(item.dimensions.length)} × ${Number(item.dimensions.width)} × ${Number(item.dimensions.height)} mm (L × B × H)</small>` : ""}${item.customDescription ? `<small>${safe(item.customDescription)}</small>` : ""}${units > 1 || idx >= 2 ? `<div class="unit-stages">${Array.from({length:units},(_,u)=>`<span class="unit-chip">Stuk ${u+1}: ${stageChip(stages[u] || STAGES[0])}</span>`).join("")}</div>` : ""}${schedules}</div>`;
      }).join("")}
      ${whenReady ? `<div class="plan-box ready"><b>Verwacht klaar met printen:</b> ${safe(whenReady)}</div>` : ""}
      <div class="cart-sum"><div><span>Subtotaal</span><span>${money(o.subtotal)}</span></div><div><span>Verzendkosten</span><span>${money(o.shipping)}</span></div><div><b>Totaal</b><b>${money(o.total)}</b></div></div>
      <p class="public-track-note">Deze link geeft alleen de bestelstatus en productvoortgang weer. Klantaccount en chat zijn niet zichtbaar.</p>`;
  }, () => { const box = $("#publicTrackBox"); if (box) box.innerHTML = `<p class="muted">Track & trace kon niet worden geladen.</p>`; });
}
function showMyChats() {
  if (!state.user) return authForm();
  openDialog(`<p class="eyebrow">SERVICE</p><h2>Mijn chats</h2><div id="chatsBox" class="stack">${firebaseLoadingMarkup("Chats laden…")}</div>`);
  listen(query(ref(db, "chats"), orderByChild("userId"), equalTo(state.user.uid)), snap => {
    const chats = toList(snap).sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    $("#chatsBox").innerHTML = chats.length ? chats.map(c => `<button class="chat-list-item" data-chat="${safe(c.id)}"><b>${c.kind === "quote" ? `Offerte · ${safe(c.quoteTitle || "Eigen product")}` : `Bestelling #${short(c.orderId)}`}${c.orderId && c.kind === "quote" ? ` · bestelling #${short(c.orderId)}` : ""}</b><small>${safe(c.lastMessage || "Chat openen")}</small></button>`).join("") : "<p class='muted'>Je hebt nog geen chats. Na een bestelling of offerteaanvraag verschijnt hier je gesprek.</p>";
    content.querySelectorAll("[data-chat]").forEach(b => b.onclick = () => openChat(b.dataset.chat));
  });
}
$("#myOrdersBtn").onclick = () => state.user ? showMyOrders() : authForm();
$("#myChatsBtn").onclick = showMyChats;

/* ---------- chat ---------- */
function formatChatText(value) {
  // Werkt op de ruwe tekst: eerst links zoeken, daarna alles apart escapen (geen kapotte &amp;-links).
  const re = /(?<![@\w.\/-])(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|(?:[a-z0-9-]+\.)+(?:com|nl|me|be|eu|org|net|io|app)(?:\/[^\s<>"]*)?)/gi;
  const text = String(value ?? ""); let out = "", last = 0, m;
  while ((m = re.exec(text))) {
    let raw = m[0], tail = "";
    while (/[),.!?;:'"\]]$/.test(raw)) { tail = raw.slice(-1) + tail; raw = raw.slice(0, -1); }
    let html = null;
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
      if (/^https?:$/.test(url.protocol) && url.hostname.includes(".")) {
        const h = url.hostname.toLowerCase(), tikkie = /(^|\.)tikkie\.(me|nl)$/.test(h);
        html = `<a class="chat-link ${tikkie ? "tikkie-link" : ""}" href="${safe(url.href)}" target="_blank" rel="noopener noreferrer">${tikkie ? `<span class="tikkie-link-label">Open Tikkie ↗</span>` : safe(h.replace(/^www\./, "")) + " ↗"}</a>`;
      }
    } catch { }
    out += safe(text.slice(last, m.index)) + (html ? html + safe(tail) : safe(m[0]));
    last = m.index + m[0].length;
  }
  return out + safe(text.slice(last));   // regels worden door CSS (pre-wrap) getoond
}
function openChat(id, asAdmin = false) {
  asAdmin = asAdmin && state.admin;
  if (!asAdmin && !state.user) return authForm();
  get(ref(db, "chats/" + id)).then(s => {
    const c = s.val(); if (!c) return toast("Chat niet gevonden");
    if (!asAdmin && c.userId !== state.user.uid) return toast("Geen toegang tot deze chat");
    const isQuoteChat = c.kind === "quote";
    openDialog(`<div class="chat-shell"><div class="chat-heading"><div class="chat-title-wrap"><p class="eyebrow">3D PRINTED SHOP KLANTENSERVICE</p><h2>${isQuoteChat ? `Offerte · ${safe(c.quoteTitle || "Eigen product")}` : `Bestelling #${short(c.orderId)}`}</h2><small class="chat-subtitle">${safe(c.username || "Gesprek met 3D Printed Shop")}</small></div>${c.orderId ? `<button class="secondary" id="chatTrack">Bestelling volgen</button>` : `<span class="status-pill">Offertegesprek</span>`}</div><div class="chat-notice">${isQuoteChat ? (c.orderId ? `Deze offerte is omgezet naar bestelling #${short(c.orderId)}. Bespreek hier eventuele vragen over je bestelling.` : "Bespreek hier de mogelijkheden en details van je maatwerkproduct.") : "Deel hier je vraag of een link. Links en Tikkie-betaalverzoeken kun je direct openen."}</div><div id="messages" class="messages" aria-live="polite"></div><form id="sendMessage" class="send-message"><input id="messageText" placeholder="Typ je bericht…" required maxlength="1000" autocomplete="off"><button class="primary">Verstuur</button></form></div>`);
    if (c.orderId) $("#chatTrack").onclick = () => showOrderTracking(c.orderId, asAdmin);
    $("#sendMessage").onsubmit = async e => {
      e.preventDefault(); const input = $("#messageText"), text = input.value.trim(); if (!text) return;
      const now = Date.now();
      try {
        await update(ref(db), { [`chats/${id}/messages/${push(ref(db, `chats/${id}/messages`)).key}`]: { sender: asAdmin ? "admin" : "user", uid: asAdmin ? "admin" : state.user.uid, text, createdAt: now }, [`chats/${id}/lastMessage`]: text, [`chats/${id}/lastMessageAt`]: now });
        input.value = ""; input.focus();
      } catch (err) { console.error(err); toast("Bericht verzenden mislukt."); }
    };
    listen(ref(db, `chats/${id}/messages`), snap => {
      const box = $("#messages"); if (!box) return;
      const msgs = toList(snap).sort((a, b) => a.createdAt - b.createdAt);
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 70 || !box.children.length;
      box.innerHTML = msgs.map(m => `<div class="message ${m.sender === "admin" ? "theirs" : m.sender === "system" ? "system" : "mine"}"><p>${formatChatText(m.text)}</p><small>${m.sender === "admin" ? "3D Printed Shop" : m.sender === "system" ? "Systeem" : "Jij"} · ${when(m.createdAt)}</small></div>`).join("");
      if (stick) box.scrollTop = box.scrollHeight;
    });
  }).catch(() => toast("Chat laden mislukt."));
}


/* ---------- agenda / printplanning ---------- */
const HOUR_PX = 44;
const DAYNAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
const pad2 = n => String(n).padStart(2, "0");
const dateStr = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const timeStr = d => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
const toTs = (date, time) => new Date(`${date}T${time}`).getTime();
const whenShort = t => new Date(t).toLocaleString("nl-NL", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
// elk stuk van een bestelling is apart in te plannen: 1 kerstboom + 3 openers = 4 stukken
const unitsOf = o => (o.items || []).flatMap((i, n) => { const of = Math.max(1, Number(i.qty) || 1); return Array.from({ length: of }, (_, u) => ({ key: `${n}_${u}`, item: i, n, u, of })); });
const slotOf = (o, key) => { const p = o.plan?.[key]; return p && Number.isFinite(p.startTs) && Number.isFinite(p.endTs) ? p : null; };
const planInfo = o => { const us = unitsOf(o), done = us.filter(x => slotOf(o, x.key)); return { total: us.length, planned: done.length, ready: us.length && done.length === us.length ? Math.max(...done.map(x => slotOf(o, x.key).endTs)) : null }; };
const unitLabel = x => `${x.item.title}${selectionsOf(x.item).length ? " · " + selectionsOf(x.item).map(s => `${s.label}: ${s.value}`).join(", ") : ""}${x.of > 1 ? ` (stuk ${x.u + 1} van ${x.of})` : ""}`;
const hueOf = id => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
// samenvatting voor klant en beheerder: verwachte klaartijd of hoeveel nog ingepland moet worden
const planBox = (o, forAdmin) => { const p = planInfo(o); if (!p.total) return ""; return `<div class="plan-box ${p.ready ? "ready" : ""}">${p.ready ? `<b>🖨️ Verwacht klaar met printen:</b> ${whenShort(p.ready)}` : `<b>🖨️ Printplanning:</b> ${p.planned === 0 ? "nog niet ingepland" : `${p.planned} van ${p.total} stuks ingepland`}${forAdmin ? "" : " · de verwachte klaartijd volgt zodra alles is ingepland"}`}</div>`; };
const slotLine = (o, n, u) => { const sl = slotOf(o, `${n}_${u}`); return sl ? `<small class="slot-line">🗓️ ${whenShort(sl.startTs)} – ${new Date(sl.endTs).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</small>` : ""; };
async function setSlot(o, key, slot) {
  const plan = { ...(o.plan || {}) }; if (slot) plan[key] = slot; else delete plan[key];
  const { ready } = planInfo({ ...o, plan });
  await update(ref(db), { [`orders/${o.id}/plan/${key}`]: slot, [`orders/${o.id}/estimatedReady`]: ready });
  await syncPublicTrack(o.id);
}
function agendaTab(target, orders) {
  const P = state.plan; P.orders = orders;
  const os = [...orders].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));   // oud boven, nieuw onder
  if (!P.week) P.week = mondayOf(new Date());
  const sel = os.find(o => o.id === P.orderId) || null; if (!sel) { P.orderId = null; P.key = null; }
  const units = sel ? unitsOf(sel) : [];
  if (sel && !units.some(x => x.key === P.key)) P.key = (units.find(x => !slotOf(sel, x.key)) || units[0])?.key || null;
  const F = P.form, info = sel ? planInfo(sel) : null;
  const all = os.flatMap(o => unitsOf(o).map(x => ({ o, x, sl: slotOf(o, x.key) })).filter(a => a.sl));
  const days = Array.from({ length: 7 }, (_, i) => new Date(P.week.getFullYear(), P.week.getMonth(), P.week.getDate() + i));
  const todayS = dateStr(new Date());
  const col = (d) => {
    const ds = d.getTime(), de = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    return all.filter(a => a.sl.startTs < de && a.sl.endTs > ds).map(a => {
      const s = new Date(Math.max(a.sl.startTs, ds)), e = a.sl.endTs >= de ? null : new Date(a.sl.endTs);
      const m1 = s.getHours() * 60 + s.getMinutes(), m2 = e ? e.getHours() * 60 + e.getMinutes() : 1440;
      const h = Math.max(18, (m2 - m1) / 60 * HOUR_PX - 2), isSel = a.o.id === P.orderId && a.x.key === P.key;
      return `<button type="button" class="ag-block ${isSel ? "sel" : ""} blk-st${STAGES.indexOf(unitStages(a.x.item)[a.x.u])}" data-blk="${safe(a.o.id)}|${a.x.key}" style="top:${m1 / 60 * HOUR_PX}px;height:${h}px;background:hsl(${hueOf(a.o.id)} 55% 42%)" title="#${short(a.o.id)} · ${safe(unitLabel(a.x))}">${unitStages(a.x.item)[a.x.u] === "gemaakt" ? "✓ " : unitStages(a.x.item)[a.x.u] === "in bereiding" ? "⏳ " : ""}<b>#${short(a.o.id)}</b> ${safe(unitLabel(a.x))}<br><small>${timeStr(new Date(a.sl.startTs))}–${timeStr(new Date(a.sl.endTs))}</small></button>`;
    }).join("");
  };
  const prevScroll = target.querySelector(".ag-wrap")?.scrollTop;
  if (prevScroll != null) P.scroll = prevScroll;
  target.innerHTML = `<h3>Agenda · printafspraken inplannen</h3>
  <div class="plan-panel">
    <div class="plan-step"><b>1. Kies een bestelling</b> <small>(oudste bovenaan, nieuwste onderaan)</small>
      <div class="plan-list">${os.length ? os.map(o => { const p = planInfo(o); return `<button type="button" class="plan-item ${o.id === P.orderId ? "active" : ""}" data-pord="${safe(o.id)}"><b>#${short(o.id)}</b> · ${when(o.createdAt)}<small>${safe(o.username || "Klant")} · ${p.total} stuks · ${p.ready ? "✓ alles ingepland" : `${p.planned}/${p.total} ingepland`}</small></button>`; }).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}</div></div>
    ${sel ? `<div class="plan-step"><b>2. Kies een product uit bestelling #${short(sel.id)}</b> <small>(elk stuk apart)</small>
      <div class="plan-list">${units.map(x => { const sl = slotOf(sel, x.key); return `<div class="plan-unit ${x.key === P.key ? "active" : ""}"><button type="button" class="plan-item" data-punit="${x.key}"><b>${safe(unitLabel(x))}</b><small>${sl ? `ingepland: ${whenShort(sl.startTs)} – ${timeStr(new Date(sl.endTs))}` : "nog niet ingepland"}</small></button>${sl ? `<button type="button" class="remove-item" data-pdel="${x.key}">Verwijder</button>` : ""}<div class="stage-btns">${STAGES.map(st => `<button type="button" class="stage-btn st${STAGES.indexOf(st)} ${unitStages(x.item)[x.u] === st ? "on" : ""}" data-pstage="${x.key}|${st}">${STAGE_LABEL[st]}</button>`).join("")}</div></div>`; }).join("")}</div></div>
    <div class="plan-step"><b>3. Datum en tijd</b>
      <div class="plan-form"><label>Datum<input type="date" id="pgDate" value="${F.date}"></label><label>Van<input type="time" id="pgFrom" value="${F.from}" step="900"></label><label>Tot<input type="time" id="pgTo" value="${F.to}" step="900"></label><label>Einddatum<input type="date" id="pgEnd" value="${F.endDate}"></label></div>
      <button type="button" class="primary" id="pgGo">Inplannen</button></div>
    ${planBox(sel, true)}` : ""}
  </div>
  <div class="ag-nav"><button type="button" class="secondary" id="agPrev">‹ Vorige week</button><b>${days[0].toLocaleDateString("nl-NL", { day: "numeric", month: "long" })} – ${days[6].toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</b><button type="button" class="secondary" id="agToday">Vandaag</button><button type="button" class="secondary" id="agNext">Volgende week ›</button></div>
  <p class="hint">Klik op een uur in de agenda om die datum en tijd in te vullen. Bezette tijden kunnen niet dubbel worden ingepland (er is één printer).</p>
  <div class="ag-wrap"><div class="ag-grid"><div class="ag-corner"></div>${days.map((d, i) => `<div class="ag-head ${dateStr(d) === todayS ? "today" : ""}">${DAYNAMES[i]}<small>${d.getDate()}/${d.getMonth() + 1}</small></div>`).join("")}
    <div class="ag-times">${Array.from({ length: 24 }, (_, h) => `<div>${pad2(h)}:00</div>`).join("")}</div>
    ${days.map(d => `<div class="ag-col ${dateStr(d) === todayS ? "today" : ""}" data-day="${dateStr(d)}">${col(d)}</div>`).join("")}</div></div>`;
  const wrap = target.querySelector(".ag-wrap"); wrap.scrollTop = P.scroll;
  const again = () => agendaTab(target, P.orders);
  target.querySelectorAll("[data-pord]").forEach(b => b.onclick = () => { P.orderId = b.dataset.pord; P.key = null; again(); });
  target.querySelectorAll("[data-punit]").forEach(b => b.onclick = () => { P.key = b.dataset.punit; again(); });
  target.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => { try { await setSlot(sel, b.dataset.pdel, null); toast("Afspraak verwijderd"); } catch (e) { console.error(e); toast("Verwijderen mislukt"); } });
  target.querySelectorAll("[data-pstage]").forEach(b => b.onclick = async () => { const [k, st] = b.dataset.pstage.split("|"), x = units.find(y => y.key === k); if (!x) return; try { await setStage(sel, x.n, x.u, st); toast(st === "gemaakt" ? "Stuk staat op gemaakt ✓" : st === "in bereiding" ? "Stuk staat op bezig" : "Stuk staat in de wachtrij"); } catch (e) { console.error(e); toast("Opslaan mislukt"); } });
  target.querySelectorAll("[data-blk]").forEach(b => b.onclick = e => { e.stopPropagation(); const [oid, k] = b.dataset.blk.split("|"); P.orderId = oid; P.key = k; again(); });
  const keep = (id, k) => { const el = target.querySelector(id); if (el) el.oninput = () => { F[k] = el.value; if (k === "date" && (!F.endDate || F.endDate < el.value)) { F.endDate = el.value; const e2 = target.querySelector("#pgEnd"); if (e2) e2.value = el.value; } }; };
  keep("#pgDate", "date"); keep("#pgFrom", "from"); keep("#pgTo", "to"); keep("#pgEnd", "endDate");
  target.querySelector("#agPrev").onclick = () => { P.week = new Date(P.week.getFullYear(), P.week.getMonth(), P.week.getDate() - 7); again(); };
  target.querySelector("#agNext").onclick = () => { P.week = new Date(P.week.getFullYear(), P.week.getMonth(), P.week.getDate() + 7); again(); };
  target.querySelector("#agToday").onclick = () => { P.week = mondayOf(new Date()); again(); };
  target.querySelectorAll(".ag-col").forEach(c => c.onclick = e => {
    const h = Math.min(23, Math.max(0, Math.floor((e.clientY - c.getBoundingClientRect().top) / HOUR_PX)));
    const [y, m, d] = c.dataset.day.split("-").map(Number), s = new Date(y, m - 1, d, h), en = new Date(s.getTime() + 3600000);
    Object.assign(F, { date: dateStr(s), from: timeStr(s), to: timeStr(en), endDate: dateStr(en) });
    if (!sel) toast("Kies eerst een bestelling en een product"); again();
  });
  const go = target.querySelector("#pgGo");
  if (go) go.onclick = async () => {
    if (!sel || !P.key) return toast("Kies eerst een bestelling en een product");
    if (!F.date || !F.from || !F.to) return toast("Vul datum, van- en tot-tijd in");
    const startTs = toTs(F.date, F.from), endTs = toTs(F.endDate || F.date, F.to);
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs)) return toast("Ongeldige datum of tijd");
    if (endTs <= startTs) return toast("De eindtijd moet na de starttijd liggen");
    const clash = all.find(a => !(a.o.id === sel.id && a.x.key === P.key) && a.sl.startTs < endTs && startTs < a.sl.endTs);
    if (clash) return toast(`Die tijd is al bezet door bestelling #${short(clash.o.id)} (${whenShort(clash.sl.startTs)} – ${timeStr(new Date(clash.sl.endTs))})`);
    go.disabled = true;
    try {
      await setSlot(sel, P.key, { date: F.date, start: F.from, end: F.to, endDate: F.endDate || F.date, startTs, endTs });
      const unplanned = units.find(x => x.key !== P.key && !slotOf(sel, x.key));
      if (unplanned) P.key = unplanned.key;
      Object.assign(F, { date: F.endDate || F.date, from: F.to, to: "", endDate: F.endDate || F.date });   // volgende stuk begint standaard waar dit eindigt
      toast("Printafspraak ingepland");
    } catch (e) { console.error(e); toast("Inplannen mislukt. Probeer het opnieuw."); }
    finally { go.disabled = false; }
  };
}

/* ---------- sitebeheer ---------- */
$("#adminEntry").onclick = () => state.admin ? adminPanel() : openAdminLogin();
function openAdminLogin() {
  openDialog(`<p class="eyebrow">ALLEEN VOOR BEHEERDERS</p><h2>Sitebeheer</h2><form id="adminLoginForm" class="stack" autocomplete="off"><label>E-mailadres<input id="adminEmail" type="email" required autocomplete="off"></label><label>Wachtwoord<input id="adminPassword" type="password" required autocomplete="current-password"></label><button class="primary full">Inloggen als beheerder</button></form>`);
  $("#adminLoginForm").onsubmit = async e => {
    e.preventDefault(); if (locked()) return;
    const email = $("#adminEmail").value.trim().toLowerCase(), pw = $("#adminPassword").value;
    const hash = await hashPw(pw, CFG.salt, CFG.iterations);
    if (email !== CFG.adminEmail.toLowerCase() || hash !== CFG.hash) return failed();
    setAdmin(); closeDialog(); adminPanel();
  };
}
function adminPanel() {
  if (!state.admin) return openAdminLogin();
  openDialog(`<div class="admin-head"><div><p class="eyebrow">3D PRINTED SHOP</p><h2>Sitebeheer</h2></div><span class="admin-label">BEHEERDER</span></div><div class="tabs admin-tabs"><button data-tab="products">Producten</button><button data-tab="categories">Categorieën</button><button data-tab="orders">Track & trace</button><button data-tab="myorders">Mijn bestellingen</button><button data-tab="history">Bestellingen</button><button data-tab="agenda">Agenda</button><button data-tab="chats">Chats</button><button data-tab="quotes">Offertes</button><button data-tab="camera">Camera</button><button data-tab="contact">Contactpagina</button><button id="adminLogout">Uitloggen</button></div><div id="adminContent"></div>`);
  $("#adminLogout").onclick = logoutAdmin;
  content.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; adminTab(); });
  adminTab();
}
function cameraTab(target) {
  target.innerHTML = firebaseLoadingMarkup("Cameragegevens laden…");
  const save = data => update(ref(db, "settings/camera"), { ...data, updatedAt: Date.now() }).catch(() => toast("Opslaan mislukt. Zijn de Firebase-regels (database.rules.json) al gepubliceerd?"));
  listen(ref(db, "settings/camera"), snap => {
    const c = snap.val() || {}; camCfg = c;
    const off = camDisabled();
    const until = off && c.until ? new Date(c.until).toLocaleString("nl-NL", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
    const src = c.url ? "automatisch doorgegeven door bambu_cam.py" : CFG.cameraUrl ? "uit beheer-config.js" : "nog niet ingesteld";
    target.innerHTML = `<h3>Printercamera</h3><div class="cam-admin"><div class="cam-admin-state ${off ? "is-off" : "is-on"}"><span class="dot"></span><div><b>${off ? "Camera is uitgeschakeld" : "Camera staat aan"}</b><small>${off ? (until ? `Gaat automatisch weer aan op ${safe(until)}` : "Blijft uit totdat je hem weer inschakelt") : "Klanten zien het livebeeld bij hun bestelling"}</small></div></div>${off ? `<button class="primary full" id="camToggle">Camera weer inschakelen</button>` : `<div class="stack"><label>Hoe lang uitschakelen?<select id="camDur"><option value="30">30 minuten</option><option value="60" selected>1 uur</option><option value="180">3 uur</option><option value="720">12 uur</option><option value="1440">24 uur</option><option value="0">Tot ik hem weer aanzet</option></select></label><button class="primary full" id="camToggle">Camera uitschakelen</button></div>`}<p class="muted cam-admin-src">Stream-adres: ${safe(src)}</p><p class="eyebrow cam-admin-lbl">ZO ZIEN KLANTEN HET ALS DE CAMERA UIT STAAT</p><div class="cam-card"><div class="cam-head"><b>Printercamera</b><span class="cam-off">TIJDELIJK UIT</span></div><div class="cam-offline"><b class="cam-off-title">Camera tijdelijk niet beschikbaar</b><br><small>${CAM_MSG}</small></div></div></div>`;
    $("#camToggle").onclick = () => {
      if (off) return save({ enabled: true, until: 0 }).then(() => toast("Camera weer ingeschakeld"));
      const m = Number($("#camDur").value) || 0;
      save({ enabled: false, until: m ? Date.now() + m * 60000 : 0 }).then(() => toast("Camera uitgeschakeld"));
    };
  });
}
function categoryAdminTab(target) {
  let categories = [];
  const draw = () => {
    if (!target.isConnected) return;
    target.innerHTML = `<div class="admin-toolbar"><div><h3>Categorieën beheren</h3><p class="muted">Maak categorieën aan die klanten op de homepage kunnen kiezen. Koppel producten via Producten → Bewerken.</p></div><span class="status-pill">${categories.filter(c => c.active !== false).length} zichtbaar</span></div><form id="categoryCreateForm" class="category-create-form"><label>Nieuwe categorienaam<input name="name" required maxlength="50" placeholder="Bijv. Sleutelhangers"></label><button class="primary" type="submit">Categorie toevoegen</button></form><div class="category-admin-list">${categories.length ? categories.map(c => `<div class="category-admin-row" data-category-row="${safe(c.id)}"><div class="category-admin-main"><b>${safe(c.name)}</b><small>${c.active === false ? "Verborgen op de homepage" : "Zichtbaar op de homepage"}</small></div><button type="button" class="secondary" data-category-active="${safe(c.id)}">${c.active === false ? "Tonen" : "Verbergen"}</button><button type="button" class="remove-item" data-category-delete="${safe(c.id)}">Verwijderen</button></div>`).join("") : `<div class="empty-state">Nog geen categorieën. Voeg hierboven je eerste categorie toe.</div>`}</div>`;
    $("#categoryCreateForm").onsubmit = async e => {
      e.preventDefault(); const name = String(new FormData(e.currentTarget).get("name") || "").trim();
      if (!name || name.length > 50) return toast("Vul een categorienaam van maximaal 50 tekens in.");
      if (categories.some(c => String(c.name).toLocaleLowerCase("nl") === name.toLocaleLowerCase("nl"))) return toast("Deze categorie bestaat al.");
      const id = push(ref(db, "categories")).key;
      try { await set(ref(db, `categories/${id}`), { name, active: true, sortOrder: categories.length, createdAt: Date.now(), updatedAt: Date.now() }); e.currentTarget.reset(); toast("Categorie toegevoegd"); }
      catch (err) { console.error(err); toast("Categorie toevoegen mislukt. Controleer de Firebase-regels."); }
    };
    target.querySelectorAll("[data-category-active]").forEach(b => b.onclick = async () => { const cat = categories.find(c => c.id === b.dataset.categoryActive); if (!cat) return; try { await update(ref(db, `categories/${cat.id}`), { active: cat.active === false, updatedAt: Date.now() }); toast(cat.active === false ? "Categorie wordt weer getoond" : "Categorie verborgen"); } catch (err) { console.error(err); toast("Categorie bijwerken mislukt"); } });
    target.querySelectorAll("[data-category-delete]").forEach(b => b.onclick = async () => { const cat = categories.find(c => c.id === b.dataset.categoryDelete); if (!cat) return; if (!confirm(`Categorie “${cat.name}” verwijderen? Producten blijven bestaan, maar worden niet meer aan deze categorie gekoppeld.`)) return; try { const snap = await get(ref(db, "products")), products = snap.val() || {}, updates = { [`categories/${cat.id}`]: null }; Object.entries(products).forEach(([pid, product]) => { if (product?.categoryId === cat.id) updates[`products/${pid}/categoryId`] = null; }); await update(ref(db), updates); toast("Categorie verwijderd"); } catch (err) { console.error(err); toast("Categorie verwijderen mislukt"); } });
  };
  listen(ref(db, "categories"), snap => { categories = toList(snap).sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || String(a.name).localeCompare(String(b.name), "nl")); draw(); });
}

function contactAdminTab(target) {
  listen(ref(db, "settings/contact"), snap => {
    const c = { ...DEFAULT_CONTACT, ...(snap.val() || {}) };
    target.innerHTML = `<h3>Contactpagina beheren</h3><p class="muted">Pas hier de inhoud aan die bezoekers via de link Contact onderaan de webshop zien. Gebruik bij Naam en Adres de gegevens die je openbaar wilt tonen.</p>
      <form id="contactSettingsForm" class="stack contact-admin-form">
        <label>Paginatitel<input name="title" maxlength="90" value="${safe(c.title)}" placeholder="Neem contact met ons op"></label>
        <label>Introtekst<textarea name="intro" rows="3" maxlength="700">${safe(c.intro)}</textarea></label>
        <label>Naam<input name="name" maxlength="120" value="${safe(c.name)}" placeholder="Naam"></label>
        <label>Adres<textarea name="address" rows="2" maxlength="240" placeholder="Straat, huisnummer, postcode en plaats">${safe(c.address)}</textarea></label>
        <label>E-mailadres<input name="email" type="email" maxlength="160" value="${safe(c.email)}" placeholder="info@voorbeeld.nl"></label>
        <label>Telefoonnummer<input name="phone" type="tel" maxlength="40" value="${safe(c.phone)}" placeholder="06 12345678"></label>
        <label>Openingstijden<textarea name="hours" rows="2" maxlength="300">${safe(c.hours)}</textarea></label>
        <label>Extra informatie<textarea name="extra" rows="4" maxlength="1200">${safe(c.extra)}</textarea></label>
        <button class="primary full" type="submit">Contactpagina opslaan</button>
      </form>`;
    $("#contactSettingsForm").onsubmit = async e => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      const data = Object.fromEntries(["title", "intro", "name", "address", "email", "phone", "hours", "extra"].map(key => [key, String(form.get(key) || "").trim()]));
      try {
        await update(ref(db, "settings/contact"), { ...data, updatedAt: Date.now() });
        toast("Contactpagina opgeslagen");
      } catch (error) {
        console.error("Contact settings save failed", error);
        toast("Opslaan mislukt. Controleer de Firebase-regels.");
      }
    };
  });
}

function quoteAdminTab(target) {
  let quotes = [], colors = [];
  const draw = () => {
    if (!target.isConnected) return;
    const colorManager = `<section class="quote-color-manager"><div class="admin-toolbar"><div><h3>Kleuren voor maatwerk</h3><p class="muted">Deze kleuren kunnen klanten kiezen bij een nieuwe offerteaanvraag.</p></div></div><form id="quoteColorForm" class="quote-color-form"><label>Kleurnaam<input name="name" required maxlength="50" placeholder="Bijv. Zwart"></label><label>Kleur<input name="hex" type="color" value="#222222" required></label><button type="submit" class="primary">Kleur toevoegen</button></form><div class="quote-color-list">${colors.length ? colors.map(c => `<div class="quote-color-item ${c.soldOut ? "is-sold-out" : ""}"><span class="quote-color-swatch" style="--quote-color:${safe(c.hex)}"></span><b>${safe(c.name)}</b><code>${safe(c.hex)}</code><span class="quote-color-state">${c.soldOut ? "Uitverkocht" : "Beschikbaar"}</span><button type="button" class="secondary" data-quote-color-out="${safe(c.id)}">${c.soldOut ? "Weer beschikbaar" : "Uitverkocht zetten"}</button><button type="button" class="remove-item" data-quote-color-delete="${safe(c.id)}">Verwijderen</button></div>`).join("") : `<p class="muted">Er zijn nog geen kleuren toegevoegd.</p>`}</div></section>`;
    const quoteCards = quotes.length ? quotes.map(q => `<article class="quote-admin-card"><div class="quote-admin-top"><div><p class="eyebrow">OFFERTE #${short(q.id)}</p><h4>${safe(q.title || "Eigen product")}</h4><small>${safe(q.username || "Klant")} · ${when(q.createdAt)}</small></div><span class="status-pill">${safe(q.status || "ontvangen")}</span></div><div class="quote-admin-body"><img src="${safe(q.image || "")}" alt="Aangeleverde afbeelding voor ${safe(q.title || "offerte")}" class="quote-admin-image"><div class="quote-admin-details"><p>${safe(q.description || "Geen beschrijving")}</p><p><b>Afmetingen:</b> ${Number(q.dimensions?.length) || "—"} × ${Number(q.dimensions?.width) || "—"} × ${Number(q.dimensions?.height) || "—"} mm (L × B × H)</p><p><b>Kleur:</b> <span class="quote-color-swatch inline" style="--quote-color:${safe(q.colorHex || "#ccc")}"></span> ${safe(q.colorName || "Niet opgegeven")}</p><p><b>E-mail:</b> ${safe(q.email || "—")}</p><p><b>Status:</b> <select data-quote-status="${safe(q.id)}" ${q.orderId ? "disabled" : ""}>${(q.orderId ? ["ontvangen", "in overleg", "offerte verzonden", "geaccepteerd", "afgewezen", "omgezet naar bestelling"] : ["ontvangen", "in overleg", "offerte verzonden", "geaccepteerd", "afgewezen"]).map(st => `<option value="${safe(st)}" ${(q.status || "ontvangen") === st ? "selected" : ""}>${safe(st)}</option>`).join("")}</select></p>${q.orderId ? `<p class="quote-order-link">Omgezet naar bestelling <b>#${short(q.orderId)}</b></p>` : ""}</div></div><div class="admin-actions"><button type="button" class="secondary" data-quote-chat="${safe(q.chatId || "")}">Offertechat openen</button>${!q.orderId ? `<button type="button" class="primary" data-quote-convert="${safe(q.id)}">Omzetten naar bestelling</button>` : `<button type="button" class="secondary" data-quote-order-chat="${safe(q.chatId || "")}">Bestelchat openen</button>`}<button type="button" class="remove-item" data-quote-delete="${safe(q.id)}">Offerte verwijderen</button></div></article>`).join("") : `<div class="empty-state">Er zijn nog geen offerteaanvragen.</div>`;
    target.innerHTML = `<div class="admin-toolbar"><div><h3>Offertes beheren</h3><p class="muted">Bekijk de aanvraag, afbeelding, afmetingen en chat. Zet een afgeronde offerte om naar een normale bestelling met track & trace.</p></div><span class="status-pill">${quotes.filter(q => !q.orderId).length} open</span></div>${colorManager}<h3>Offerteaanvragen (${quotes.length})</h3>${quoteCards}`;
    $("#quoteColorForm")?.addEventListener("submit", async e => {
      e.preventDefault(); const form = e.currentTarget, data = new FormData(form), name = String(data.get("name") || "").trim(), hex = String(data.get("hex") || "");
      if (!name || !/^#[0-9a-f]{6}$/i.test(hex)) return toast("Vul een geldige kleurnaam en kleur in.");
      const id = push(ref(db, "settings/quoteColors")).key;
      try { await set(ref(db, `settings/quoteColors/${id}`), { name, hex: hex.toUpperCase(), active: true, createdAt: Date.now() }); form.reset(); toast("Kleur toegevoegd"); }
      catch (err) { console.error(err); toast("Kleur toevoegen mislukt. Controleer de Firebase-regels."); }
    });
    target.querySelectorAll("[data-quote-color-out]").forEach(b => b.onclick = async () => {
      const c = colors.find(x => x.id === b.dataset.quoteColorOut); if (!c) return;
      try { await update(ref(db, `settings/quoteColors/${c.id}`), { soldOut: !c.soldOut, updatedAt: Date.now() }); toast(c.soldOut ? `${c.name} is weer beschikbaar` : `${c.name} is op uitverkocht gezet`); }
      catch (err) { console.error(err); toast("Beschikbaarheid van kleur aanpassen mislukt"); }
    });
    target.querySelectorAll("[data-quote-color-delete]").forEach(b => b.onclick = async () => {
      const c = colors.find(x => x.id === b.dataset.quoteColorDelete); if (!c || !confirm(`Kleur “${c.name}” verwijderen uit de keuzelijst? Bestaande offertes blijven ongewijzigd.`)) return;
      try { await remove(ref(db, `settings/quoteColors/${c.id}`)); toast("Kleur verwijderd"); } catch (err) { console.error(err); toast("Kleur verwijderen mislukt"); }
    });
    target.querySelectorAll("[data-quote-delete]").forEach(b => b.onclick = async () => {
      const q = quotes.find(x => x.id === b.dataset.quoteDelete); if (!q) return;
      const explanation = q.orderId ? "Deze offerte is al omgezet naar een bestelling. Alleen het offertedossier wordt verwijderd; de bestelling, bestelchat en track & trace blijven bestaan." : "De offerteaanvraag en de bijbehorende chat worden definitief verwijderd.";
      if (!confirm(`Offerte “${q.title || "Eigen product"}” verwijderen?\n\n${explanation}`)) return;
      try { await update(ref(db), { [`quotes/${q.id}`]: null, ...(!q.orderId && q.chatId ? { [`chats/${q.chatId}`]: null } : {}) }); toast("Offerte verwijderd"); }
      catch (err) { console.error(err); toast("Offerte verwijderen mislukt. Controleer de Firebase-regels."); }
    });
    target.querySelectorAll("[data-quote-status]").forEach(sel => sel.onchange = async () => {
      const q = quotes.find(x => x.id === sel.dataset.quoteStatus), now = Date.now();
      try {
        const updates = { [`quotes/${sel.dataset.quoteStatus}/status`]: sel.value, [`quotes/${sel.dataset.quoteStatus}/updatedAt`]: now };
        if (q?.chatId) {
          const message = `De status van je offerteaanvraag “${q.title || "Eigen product"}” is bijgewerkt naar: ${sel.value}.`;
          const messageId = push(ref(db, `chats/${q.chatId}/messages`)).key;
          updates[`chats/${q.chatId}/messages/${messageId}`] = { sender: "system", text: message, createdAt: now };
          updates[`chats/${q.chatId}/lastMessage`] = message;
          updates[`chats/${q.chatId}/lastMessageAt`] = now;
        }
        await update(ref(db), updates); toast("Offertestatus bijgewerkt");
      } catch (err) { console.error(err); toast("Status bijwerken mislukt"); }
    });
    target.querySelectorAll("[data-quote-chat], [data-quote-order-chat]").forEach(b => b.onclick = () => b.dataset.quoteChat || b.dataset.quoteOrderChat ? openChat(b.dataset.quoteChat || b.dataset.quoteOrderChat, true) : toast("Geen chat gekoppeld."));
    target.querySelectorAll("[data-quote-convert]").forEach(b => b.onclick = () => showQuoteConversion(b.dataset.quoteConvert));
  };
  listen(ref(db, "quotes"), snap => { quotes = toList(snap).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); draw(); });
  listen(ref(db, "settings/quoteColors"), snap => { colors = quoteColorsFrom(snap.val(), true); draw(); });
}
async function showQuoteConversion(quoteId) {
  const q = (await get(ref(db, `quotes/${quoteId}`))).val();
  if (!q || q.orderId) return toast("Deze offerte bestaat niet of is al omgezet.");
  openDialog(`<p class="eyebrow">OFFERTE AFRONDEN</p><h2>Omzetten naar bestelling</h2><p class="muted">${safe(q.title)} · ${Number(q.dimensions?.length)} × ${Number(q.dimensions?.width)} × ${Number(q.dimensions?.height)} mm</p><form id="quoteConvertForm" class="stack"><label>Afgesproken productprijs (€)<input name="price" type="number" min="0.01" max="100000" step="0.01" required placeholder="Bijv. 12,50"></label><label>Afhandeling<select name="fulfillment"><option value="pickup">Ophalen · gratis</option><option value="delivery">Verzenden · ${money(SHIPPING)} verzendkosten</option></select></label><div id="quoteDeliveryFields" class="stack" hidden><p class="hint">Vul het verzendadres in zodat de bestelling op dezelfde manier kan worden afgehandeld als een gewone verzendbestelling.</p><div class="checkout-two"><label>Voornaam<input name="firstName" maxlength="60"></label><label>Achternaam<input name="lastName" maxlength="80"></label></div><div class="checkout-two"><label>Straat<input name="street" maxlength="100"></label><label>Huisnummer<input name="houseNumber" maxlength="12"></label></div><label>Toevoeging<input name="addition" maxlength="20"></label><div class="checkout-two"><label>Postcode<input name="postcode" maxlength="8" pattern="[0-9]{4}\\s?[A-Za-z]{2}"></label><label>Plaats<input name="city" maxlength="80"></label></div></div><p class="muted" id="quoteConvertTotal">Totaal wordt berekend na keuze.</p><button class="primary full">Offerte omzetten naar bestelling en track &amp; trace aanmaken</button></form>`);
  const form = $("#quoteConvertForm"), addressBox = $("#quoteDeliveryFields"), totalLine = $("#quoteConvertTotal");
  const updateTotal = () => {
    const method = form.elements.fulfillment.value, price = Number(form.elements.price.value) || 0, shipping = method === "delivery" ? SHIPPING : 0;
    totalLine.innerHTML = `Verzendkosten: <b>${money(shipping)}</b> · Totaal: <b>${money(price + shipping)}</b>`;
    addressBox.hidden = method !== "delivery";
    addressBox.querySelectorAll("input").forEach(el => el.required = method === "delivery" && !["addition"].includes(el.name));
  };
  form.elements.fulfillment.addEventListener("change", updateTotal); form.elements.price.addEventListener("input", updateTotal); updateTotal();
  form.onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter, data = new FormData(form), price = Number(data.get("price")), method = String(data.get("fulfillment"));
    if (!Number.isFinite(price) || price <= 0 || price > 100000) return toast("Vul een geldige prijs in.");
    let address = null;
    if (method === "delivery") {
      address = { firstName: String(data.get("firstName") || "").trim(), lastName: String(data.get("lastName") || "").trim(), street: String(data.get("street") || "").trim(), houseNumber: String(data.get("houseNumber") || "").trim(), addition: String(data.get("addition") || "").trim(), postcode: String(data.get("postcode") || "").trim().toUpperCase(), city: String(data.get("city") || "").trim(), country: "Nederland" };
      if (!/^[0-9]{4}\s?[A-Z]{2}$/.test(address.postcode)) return toast("Vul een geldige Nederlandse postcode in.");
    }
    btn.disabled = true; btn.textContent = "Bestelling aanmaken…";
    try {
      const orderId = push(ref(db, "orders")).key, publicToken = randomToken(), now = Date.now(), shipping = method === "delivery" ? SHIPPING : 0, total = price + shipping;
      const order = { userId: q.userId, username: q.username || "Klant", email: q.email || "", items: [{ id: `maatwerk-${quoteId}`, title: q.title, price, qty: 1, selections: [{ label: "Kleur", value: q.colorName || "Niet opgegeven" }], dimensions: q.dimensions, customDescription: q.description, quoteId }], subtotal: price, shipping, total, address, fulfillmentMethod: method, paymentMethod: "tikkie", paymentStatus: "awaiting_tikkie", status: STATUSES[0], createdAt: now, publicToken, chatId: q.chatId, customQuoteId: quoteId, note: `Maatwerkofferte: ${q.title}. ${q.description}` };
      const msgId = push(ref(db, `chats/${q.chatId}/messages`)).key, systemText = `Je offerte is omgezet naar bestelling #${short(orderId)}. Productprijs: ${money(price)}. Verzendkosten: ${money(shipping)}. Totaal: ${money(total)}. De track & trace is beschikbaar via Mijn bestellingen.`;
      const updates = { [`orders/${orderId}`]: order, [`publicTrack/${publicToken}`]: publicTrackPayload({ ...order, id: orderId }), [`quotes/${quoteId}/status`]: "omgezet naar bestelling", [`quotes/${quoteId}/orderId`]: orderId, [`quotes/${quoteId}/convertedAt`]: now, [`chats/${q.chatId}/orderId`]: orderId, [`chats/${q.chatId}/lastMessage`]: systemText, [`chats/${q.chatId}/lastMessageAt`]: now, [`chats/${q.chatId}/messages/${msgId}`]: { sender: "system", text: systemText, createdAt: now } };
      await update(ref(db), updates); closeDialog(); toast("Offerte is omgezet naar een normale bestelling met track & trace."); state.tab = "quotes"; adminTab();
    } catch (err) { console.error("Quote conversion failed", err); toast("Omzetten naar bestelling is niet gelukt."); btn.disabled = false; btn.textContent = "Offerte omzetten naar bestelling en track & trace aanmaken"; }
  };
}
function adminTab() {
  content.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x.dataset.tab === state.tab));
  cleanup(); const target = $("#adminContent"); if (!target) return;
  target.innerHTML = firebaseLoadingMarkup("Firebase-gegevens laden…");
  if (state.tab === "products") listen(ref(db, "products"), snap => {
    const ps = toList(snap);
    target.innerHTML = `<div class="admin-toolbar"><h3>Producten beheren</h3><button class="primary" id="newProduct"><i data-lucide="plus"></i> Product toevoegen</button></div>${ps.length ? ps.map(p => { const groups = optionGroupsOf(p); return `<div class="admin-row"><div class="admin-product">${p.image ? `<img src="${safe(p.image)}" alt="">` : "✦"}<div><b>${safe(p.title)}</b>${p.soldOut ? ` <span class="badge-out">UITVERKOCHT</span>` : ""}<small>${money(p.price)}${p.categoryId && categoryLabel(p.categoryId) ? ` · ${safe(categoryLabel(p.categoryId))}` : ""}</small>${groups.map((g, gi) => `<div class="opt-admin"><small>${safe(g.label)}:</small>${g.options.map((o, oi) => `<button type="button" class="opt-toggle ${o.soldOut ? "out" : ""}" data-optout="${safe(p.id)}" data-g="${gi}" data-i="${oi}" title="Klik om uitverkocht aan/uit te zetten">${safe(o.name)} · ${deltaText(o.priceDelta)}${o.soldOut ? " · uitverkocht" : ""}</button>`).join("")}</div>`).join("")}</div></div><div class="admin-actions"><button class="secondary" data-soldout="${safe(p.id)}">${p.soldOut ? "Weer beschikbaar" : "Uitverkocht"}</button> <button class="secondary" data-edit="${safe(p.id)}">Bewerken</button> <button class="remove-item" data-delete="${safe(p.id)}">Verwijderen</button></div></div>`; }).join("") : "<p class='muted'>Je hebt nog geen producten toegevoegd.</p>"}`;
    $("#newProduct").onclick = () => productEditor();
    target.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => productEditor(b.dataset.edit));
    target.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => { if (confirm("Dit product verwijderen?")) { await remove(ref(db, "products/" + b.dataset.delete)); toast("Product verwijderd"); } });
    target.querySelectorAll("[data-soldout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.soldout); if (p) update(ref(db, "products/" + p.id), { soldOut: !p.soldOut }).then(() => toast(p.soldOut ? "Product weer beschikbaar" : "Product op uitverkocht gezet")).catch(() => toast("Opslaan mislukt")); });
    target.querySelectorAll("[data-optout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.optout), g = p && optionGroupsOf(p)[Number(b.dataset.g)], o = g && g.options[Number(b.dataset.i)]; if (!o) return; const path = p.optionGroups ? `products/${p.id}/optionGroups/${b.dataset.g}/options/${b.dataset.i}` : `products/${p.id}/options/${b.dataset.i}`; update(ref(db, path), { soldOut: !o.soldOut }).then(() => toast(o.soldOut ? `${o.name} weer beschikbaar` : `${o.name} op uitverkocht gezet`)).catch(() => toast("Opslaan mislukt")); });
  });
  else if (state.tab === "orders" || state.tab === "myorders") listen(ref(db, "orders"), snap => {
    const os = toList(snap).sort((a, b) => b.createdAt - a.createdAt);
    target.innerHTML = `<h3>${state.tab === "myorders" ? "Mijn bestellingen · overzicht en betaallinks" : "Bestellingen en status"}</h3>${os.length ? os.map(o => `<div class="admin-row order-admin"><div><b>#${short(o.id)} · ${safe(o.username || "Klant")}</b><small>${(o.items || []).map(i => `<span class="oi">${safe(i.title)}${optText(i)} × ${i.qty}</span>`).join("")}<span class="oi">${money(o.subtotal ?? o.total)} + ${money(o.shipping ?? 0)} verzending = <b>${money(o.total)}</b></span></small>${planBox(o, true)}<p class="order-note"><b>Afhandeling:</b> ${fulfillmentLabel(o)} · <b>Betaling:</b> ${safe(o.paymentStatus || "Niet geregistreerd")}</p>${o.paymentMethod === "tikkie" ? `<div class="stage-panel"><b>Betaallink voor klant</b><input type="url" data-tikkie-input="${safe(o.id)}" value="${safe(o.tikkieLink || "")}" placeholder="https://tikkie.me/... of https://betaalverzoek.rabobank.nl/..."><div class="admin-actions"><button class="secondary" data-tikkie-save="${safe(o.id)}">Betaallink opslaan</button><button class="secondary" data-tikkie-paid="${safe(o.id)}">Markeer als betaald</button></div></div>` : ""}${o.address ? `<p class="order-note"><b>Verzendadres:</b> ${safe([o.address.firstName, o.address.lastName].filter(Boolean).join(" "))}, ${safe(o.address.street || "")} ${safe(o.address.houseNumber || "")} ${safe(o.address.addition || "")}, ${safe(o.address.postcode || "")} ${safe(o.address.city || "")}, ${safe(o.address.country || "Nederland")}</p>` : ""}${o.note ? `<p class="order-note"><b>Opmerking klant:</b> ${safe(o.note)}</p>` : ""}${o.returnRequestAt ? `<div class="stage-panel"><b>Retouraanvraag ontvangen</b><p class="order-note">Aangevraagd op ${when(o.returnRequestAt)} · ${o.returnStatus === "handled" ? "Afgehandeld" : "Wacht op afhandeling"}</p>${o.returnStatus !== "handled" ? `<button class="secondary" data-return-handled="${safe(o.id)}">Markeer retouraanvraag als afgehandeld</button>` : ""}</div>` : ""}${o.deliveredAt ? `<p class="order-note">${isPickupOrder(o) ? "Opgehaald" : "Afgeleverd"} op ${when(o.deliveredAt)} · retourtermijn eindigt ${when(returnDeadline(o))}</p>` : ""}${o.status === "in de maak" ? `<div class="stage-panel"><b>Voortgang per product</b>${(o.items || []).map((i, n) => unitStages(i).map((cur, u, all) => `<div class="stage-row"><span>${safe(i.title)}${optText(i)}${all.length > 1 ? ` · stuk ${u + 1} van ${all.length}` : ""}</span><select data-stage="${safe(o.id)}" data-i="${n}" data-u="${u}">${STAGES.map(st => `<option ${cur === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>`).join("")).join("")}</div>` : ""}</div><select data-status="${safe(o.id)}">${STATUSES.map(s => `<option value="${safe(s)}" ${s === o.status ? "selected" : ""}>${safe(statusLabel(o, s))}</option>`).join("")}</select><button class="secondary" data-ochat="${safe(o.chatId || "")}">Chat</button></div>`).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}`;
    target.querySelectorAll("[data-status]").forEach(s => s.onchange = async () => { try { const id = s.dataset.status, order = os.find(o => o.id === id); const changes = { status: s.value }; if (s.value === "bezorgd" && !order?.deliveredAt) changes.deliveredAt = Date.now(); if (s.value !== "bezorgd" && order?.status === "bezorgd") changes.deliveredAt = null; await update(ref(db, "orders/" + id), changes); await syncPublicTrack(id); toast("Bestelstatus bijgewerkt"); } catch { toast("Opslaan mislukt"); } });
    target.querySelectorAll("[data-return-handled]").forEach(b => b.onclick = async () => { try { await update(ref(db, `orders/${b.dataset.returnHandled}`), { returnStatus: "handled", returnHandledAt: Date.now() }); toast("Retouraanvraag als afgehandeld gemarkeerd."); } catch { toast("Bijwerken mislukt."); } });
    target.querySelectorAll("[data-stage]").forEach(sel => sel.onchange = async () => { const o = os.find(x => x.id === sel.dataset.stage), it = o && (o.items || [])[Number(sel.dataset.i)]; if (!it) return; const arr = unitStages(it); arr[Number(sel.dataset.u)] = sel.value; try { await update(ref(db, `orders/${o.id}/items/${sel.dataset.i}`), { stages: arr }); await syncPublicTrack(o.id); toast("Fase bijgewerkt"); } catch { toast("Opslaan mislukt"); } });
    target.querySelectorAll("[data-tikkie-save]").forEach(b => b.onclick = async () => { const id = b.dataset.tikkieSave, input = target.querySelector(`[data-tikkie-input="${id}"]`), link = (input?.value || "").trim(); let url; try { url = new URL(link); } catch { return toast("Vul een geldige Tikkie-link in."); } const allowedPaymentHosts = ["tikkie.me", "www.tikkie.me", "tikkie.nl", "www.tikkie.nl", "betaalverzoek.rabobank.nl"]; if (url.protocol !== "https:" || !allowedPaymentHosts.includes(url.hostname.toLowerCase())) return toast("Gebruik een geldige HTTPS Tikkie- of Rabobank-betaalverzoeklink."); try { await update(ref(db, `orders/${id}`), { tikkieLink: url.href, paymentStatus: "tikkie_link_added" }); toast("Tikkie-link opgeslagen. De klant ziet hem bij Mijn bestellingen."); } catch { toast("Opslaan van Tikkie-link mislukt."); } });
    target.querySelectorAll("[data-tikkie-paid]").forEach(b => b.onclick = async () => { if (!confirm("Heb je gecontroleerd dat deze Tikkie-betaling binnen is?")) return; try { await update(ref(db, `orders/${b.dataset.tikkiePaid}`), { paymentStatus: "paid", paidAt: Date.now() }); toast("Bestelling als betaald gemarkeerd."); } catch { toast("Bijwerken mislukt."); } });
    target.querySelectorAll("[data-ochat]").forEach(b => b.onclick = () => b.dataset.ochat && openChat(b.dataset.ochat, true));
  });
  else if (state.tab === "categories") categoryAdminTab(target);
  else if (state.tab === "quotes") quoteAdminTab(target);
  else if (state.tab === "camera") cameraTab(target);
  else if (state.tab === "contact") contactAdminTab(target);
  else if (state.tab === "agenda") listen(ref(db, "orders"), snap => agendaTab(target, toList(snap)));
  else if (state.tab === "history") listen(ref(db, "orders"), snap => {
    const os = toList(snap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));   // oudste eerst
    target.innerHTML = `<h3>Alle bestellingen · oudste eerst (${os.length})</h3>${os.length ? os.map(o => `<div class="order-card"><div class="order-card-head"><b>Bestelling #${short(o.id)} · ${safe(o.username || "Klant")}</b><span class="status-pill">${safe(statusLabel(o))}</span></div><small class="order-when">Geplaatst op ${when(o.createdAt)}</small><small>${safe(o.username || "Klant")}</small><div class="order-items">${(o.items || []).map(i => `<div>${safe(i.title)}${optText(i)} × ${i.qty} · ${money(i.price * i.qty)}${showStage(o, i) ? stageChips(i) : ""}</div>`).join("")}</div>${o.note ? `<p class="order-note"><b>Opmerking klant:</b> ${safe(o.note)}</p>` : ""}${planBox(o, true)}<p class="order-note"><b>Afhandeling:</b> ${fulfillmentLabel(o)} · <b>Betaling:</b> ${safe(o.paymentStatus || "Niet geregistreerd")}</p>${o.address ? `<p class="order-note"><b>Verzendadres:</b> ${safe([o.address.firstName, o.address.lastName].filter(Boolean).join(" "))}, ${safe(o.address.street || "")} ${safe(o.address.houseNumber || "")} ${safe(o.address.addition || "")}, ${safe(o.address.postcode || "")} ${safe(o.address.city || "")}, ${safe(o.address.country || "Nederland")}</p>` : ""}<div class="cart-sum"><div><span>Subtotaal</span><span>${money(o.subtotal ?? o.total)}</span></div><div><span>Verzendkosten</span><span>${money(o.shipping ?? 0)}</span></div><div><b>Totaal</b><b>${money(o.total)}</b></div></div><div class="admin-actions"><button class="secondary" data-ochat="${safe(o.chatId || "")}">Chat openen</button><button class="primary" data-finish="${safe(o.id)}">Afronden en verwijderen</button></div></div>`).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}`;
    target.querySelectorAll("[data-ochat]").forEach(b => b.onclick = () => b.dataset.ochat && openChat(b.dataset.ochat, true));
    target.querySelectorAll("[data-finish]").forEach(b => b.onclick = async () => {
      const o = os.find(x => x.id === b.dataset.finish); if (!o) return;
      if (!confirm(`Bestelling #${short(o.id)} afronden? De bestelling, de chat en de track & trace worden definitief verwijderd.`)) return;
      try { await update(ref(db), { ["orders/" + o.id]: null, ...(o.chatId ? { ["chats/" + o.chatId]: null } : {}), ...(o.publicToken ? { ["publicTrack/" + o.publicToken]: null } : {}) }); toast("Bestelling afgerond en verwijderd"); }
      catch (err) { console.error(err); toast("Verwijderen mislukt. Probeer het opnieuw."); }
    });
  });
  else listen(ref(db, "chats"), snap => {
    const cs = toList(snap).sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    target.innerHTML = `<h3>Klantenchats</h3>${cs.length ? cs.map(c => `<button class="chat-list-item" data-achat="${safe(c.id)}"><b>${safe(c.username || "Klant")} · ${c.kind === "quote" ? `Offerte: ${safe(c.quoteTitle || "Eigen product")}` : `Bestelling #${short(c.orderId)}`}</b><small>${safe(c.lastMessage || "Nieuw gesprek")}</small></button>`).join("") : "<p class='muted'>Er zijn nog geen chats.</p>"}`;
    target.querySelectorAll("[data-achat]").forEach(b => b.onclick = () => openChat(b.dataset.achat, true));
  });
}

/* ---------- afbeelding verkleinen in de browser (geen Storage/CORS nodig) ---------- */
async function shrinkImage(file, max = 900, limit = 300000) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement("canvas"); cv.width = Math.round(bmp.width * scale); cv.height = Math.round(bmp.height * scale);
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(bmp, 0, 0, cv.width, cv.height);
  for (let q = 0.85; q >= 0.4; q -= 0.1) { const url = cv.toDataURL("image/jpeg", q); if (url.length <= limit) return url; }
  throw new Error("Afbeelding is te groot, kies een kleinere.");
}
async function productEditor(id = null) {
  if (id) openDialog(firebaseLoadingMarkup("Productgegevens laden…"));
  const p = id ? ((await get(ref(db, "products/" + id))).val() || {}) : {};
  const [categoriesSnap, allProductsSnap] = await Promise.all([get(ref(db, "categories")), get(ref(db, "products"))]);
  const productCategories = toList(categoriesSnap).sort((a,b) => String(a.name).localeCompare(String(b.name), "nl"));
  const availableProducts = toList(allProductsSnap).filter(source => source.active !== false);
  let images = productImages(p);
  let groups = optionGroupsOf(p).map(g => ({ label: g.label, options: g.options.map(o => ({ ...o })) }));
  openDialog(`<p class="eyebrow">CATALOGUS</p><h2>${id ? "Product bewerken" : "Nieuw product"}</h2>
    <form id="productForm" class="stack">
      <label>Titel<input id="pTitle" required maxlength="100" value="${safe(p.title || "")}"></label>
      <label>Basisprijs in euro<input id="pPrice" type="number" min="0" step="0.01" required value="${p.price ?? ""}"></label>
      <label>Beschrijving<textarea id="pDescription" rows="4" maxlength="2000">${safe(p.description || "")}</textarea></label>
      <label>Categorie<select id="pCategory"><option value="">Geen categorie</option>${productCategories.map(cat => `<option value="${safe(cat.id)}" ${p.categoryId === cat.id ? "selected" : ""}>${safe(cat.name)}${cat.active === false ? " (verborgen)" : ""}</option>`).join("")}</select></label>
      <fieldset class="opt-editor"><legend>Productafbeeldingen · maximaal 3</legend>
        <input id="pImage" type="file" accept="image/*" multiple>
        <p class="hint">Voeg maximaal drie foto's toe. De eerste afbeelding wordt de hoofdafbeelding in de productlijst.</p>
        <div id="imagePreviewGrid" class="image-editor-grid"></div>
      </fieldset>
      <fieldset class="opt-editor"><legend>Productopties en prijsaanpassingen</legend>
        <div class="choice-copy-row"><label>Keuzes kopiëren van een ander product<select id="copyOptionsFrom"><option value="">Selecteer een product…</option>${availableProducts.filter(source => source.id !== id && optionGroupsOf(source).length).map(source => `<option value="${safe(source.id)}">${safe(source.title)}</option>`).join("")}</select></label><button type="button" class="secondary" id="copyOptionsBtn">Keuzes kopiëren</button></div>
        <div id="optionGroupsEditor" class="choice-groups-editor"></div>
        <button type="button" class="secondary" id="addOptionGroup"><i data-lucide="plus"></i> Optiegroep toevoegen</button>
        <p class="hint">Elke optiegroep wordt één stap in de productconfigurator. Per optie kun je een bedrag toevoegen (bijv. 2,50) of aftrekken (bijv. -1,00). Laat de prijs op 0,00 voor geen prijsverschil.</p>
      </fieldset>
      <label class="check"><input type="checkbox" id="pSoldOut" ${p.soldOut ? "checked" : ""}> Hele product uitverkocht</label>
      <button class="primary full" id="pSave">Product opslaan</button>
    </form>`);
  const imageGrid = $("#imagePreviewGrid"), imageInput = $("#pImage"), groupWrap = $("#optionGroupsEditor");
  const drawImages = () => {
    imageGrid.innerHTML = images.map((src, i) => `<div class="image-editor-item"><img src="${safe(src)}" alt="Productfoto ${i + 1}"><button type="button" data-remove-image="${i}" aria-label="Afbeelding ${i + 1} verwijderen">×</button></div>`).join("");
    imageGrid.querySelectorAll("[data-remove-image]").forEach(b => b.onclick = () => { images.splice(Number(b.dataset.removeImage), 1); drawImages(); });
  };
  const drawGroups = () => {
    groupWrap.innerHTML = groups.map((g, gi) => `<div class="choice-group-editor" data-group="${gi}">
      <div class="choice-group-head"><label>Naam van stap ${gi + 1}<input class="group-label" maxlength="40" required placeholder="Bijv. Kleur, formaat of afwerking" value="${safe(g.label)}"></label><button type="button" class="remove-item" data-remove-group="${gi}">Verwijder stap</button></div>
      <div class="choice-options">${g.options.map((o, oi) => `<div class="choice-option-row" data-option="${oi}">
        <input class="choice-name" maxlength="50" required placeholder="Optienaam, bijv. Rood" value="${safe(o.name)}">
        <div class="delta-wrap"><input class="choice-delta" type="number" step="0.01" value="${Number(o.priceDelta) || 0}" aria-label="Prijsaanpassing in euro"></div>
        <label><input class="choice-out" type="checkbox" ${o.soldOut ? "checked" : ""}> uitverkocht</label>
        <button type="button" class="remove-item" data-remove-option="${oi}" aria-label="Optie verwijderen">×</button>
      </div>`).join("")}</div>
      <button type="button" class="secondary" data-add-option="${gi}"><i data-lucide="plus"></i> Optie toevoegen</button>
    </div>`).join("");
    groupWrap.querySelectorAll(".group-label").forEach(el => el.oninput = () => { groups[Number(el.closest("[data-group]").dataset.group)].label = el.value; });
    groupWrap.querySelectorAll(".choice-name").forEach(el => el.oninput = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].name = el.value; });
    groupWrap.querySelectorAll(".choice-delta").forEach(el => el.oninput = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].priceDelta = Number(el.value) || 0; });
    groupWrap.querySelectorAll(".choice-out").forEach(el => el.onchange = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].soldOut = el.checked; });
    groupWrap.querySelectorAll("[data-remove-group]").forEach(b => b.onclick = () => { groups.splice(Number(b.dataset.removeGroup), 1); drawGroups(); });
    groupWrap.querySelectorAll("[data-add-option]").forEach(b => b.onclick = () => { groups[Number(b.dataset.addOption)].options.push({ name: "", priceDelta: 0, soldOut: false }); drawGroups(); });
    groupWrap.querySelectorAll("[data-remove-option]").forEach(b => b.onclick = () => { const g = Number(b.closest("[data-group]").dataset.group); groups[g].options.splice(Number(b.dataset.removeOption), 1); drawGroups(); });
  };
  drawImages(); drawGroups();
  $("#copyOptionsBtn").onclick = () => {
    const sourceId = $("#copyOptionsFrom").value; if (!sourceId) return toast("Selecteer eerst een product om keuzes van te kopiëren.");
    const source = availableProducts.find(x => x.id === sourceId); if (!source) return toast("Dat bronproduct is niet beschikbaar.");
    const sourceGroups = optionGroupsOf(source); if (!sourceGroups.length) return toast("Dit product heeft geen keuzes om te kopiëren.");
    if (groups.length && !confirm("De huidige keuzes van dit product worden vervangen door de gekopieerde keuzes. Doorgaan?")) return;
    groups = sourceGroups.map(g => ({ label: g.label, options: g.options.map(o => ({ name: o.name, priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut })) }));
    drawGroups(); toast(`Keuzes van “${source.title}” gekopieerd. Sla het product op om ze te bewaren.`);
  };
  $("#addOptionGroup").onclick = () => { groups.push({ label: `Keuze ${groups.length + 1}`, options: [{ name: "", priceDelta: 0, soldOut: false }] }); drawGroups(); };
  imageInput.onchange = async e => {
    const files = [...e.target.files || []];
    if (images.length + files.length > 3) { toast("Je kunt maximaal 3 afbeeldingen toevoegen"); imageInput.value = ""; return; }
    try {
      for (const file of files) images.push(await shrinkImage(file, 900, 180000));
      drawImages(); toast("Afbeeldingen toegevoegd");
    } catch (err) { console.error(err); toast("Een afbeelding kon niet worden verwerkt. Probeer een kleiner bestand."); }
    finally { imageInput.value = ""; }
  };
  $("#productForm").onsubmit = async e => {
    e.preventDefault();
    const price = Number($("#pPrice").value); if (!Number.isFinite(price) || price < 0) return toast("Vul een geldige basisprijs in");
    const optionGroups = groups.map(g => ({ label: String(g.label || "").trim(), options: g.options.map(o => ({ name: String(o.name || "").trim(), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut })).filter(o => o.name) })).filter(g => g.label || g.options.length);
    if (optionGroups.some(g => !g.label || !g.options.length)) return toast("Geef elke optiestap een naam en voeg minimaal één optie toe");
    if (new Set(optionGroups.map(g => g.label.toLowerCase())).size !== optionGroups.length) return toast("Elke optiestap moet een eigen naam hebben");
    const allNamesValid = optionGroups.every(g => new Set(g.options.map(o => o.name.toLowerCase())).size === g.options.length);
    if (!allNamesValid) return toast("Binnen een optiestap moeten de optienamen uniek zijn");
    const btn = $("#pSave"); btn.disabled = true; btn.textContent = "Opslaan…";
    const data = { title: $("#pTitle").value.trim(), price, description: $("#pDescription").value.trim(), image: images[0] || "", images: images.slice(0, 3), active: true, categoryId: $("#pCategory").value || null, soldOut: $("#pSoldOut").checked, optionGroups: optionGroups.length ? optionGroups : null, optionLabel: null, options: null, updatedAt: Date.now() };
    try { id ? await update(ref(db, "products/" + id), data) : await set(push(ref(db, "products")), { ...data, createdAt: Date.now() }); toast("Product opgeslagen"); adminPanel(); }
    catch (err) { console.error(err); btn.disabled = false; btn.textContent = "Product opslaan"; toast("Opslaan mislukt: " + (err.code || err.message)); }
  };
}


/* ---------- privacy- en cookievoorkeuren ---------- */
const COOKIE_PREF_KEY = "3dPrintedShopCookiePreferences";
const readCookiePreferences = () => {
  try { return JSON.parse(localStorage.getItem(COOKIE_PREF_KEY) || "null"); }
  catch { return null; }
};
function saveCookiePreferences(optionalAllowed) {
  const preferences = {
    necessary: true,
    analytics: !!optionalAllowed,
    marketing: !!optionalAllowed,
    savedAt: new Date().toISOString(),
    version: 1
  };
  try { localStorage.setItem(COOKIE_PREF_KEY, JSON.stringify(preferences)); } catch {}
  $("#cookieBanner").hidden = true;
  toast(optionalAllowed ? "Je cookievoorkeur is opgeslagen." : "Alleen noodzakelijke opslag is toegestaan.");
}
function contactPageMarkup() {
  const c = contactSettings;
  const rows = [];
  if (String(c.name || "").trim()) rows.push(`<div class="contact-detail"><span>Naam</span><strong>${safe(c.name)}</strong></div>`);
  if (String(c.address || "").trim()) rows.push(`<div class="contact-detail"><span>Adres</span><strong>${safe(c.address).replace(/\n/g, "<br>")}</strong></div>`);
  if (String(c.email || "").trim()) {
    const email = String(c.email).trim();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    rows.push(`<div class="contact-detail"><span>E-mailadres</span><strong>${validEmail ? `<a href="mailto:${safe(email)}">${safe(email)}</a>` : safe(email)}</strong></div>`);
  }
  if (String(c.phone || "").trim()) {
    const phone = String(c.phone).trim(), dial = phone.replace(/[^0-9+]/g, "");
    rows.push(`<div class="contact-detail"><span>Telefoon</span><strong><a href="tel:${safe(dial)}">${safe(phone)}</a></strong></div>`);
  }
  if (String(c.hours || "").trim()) rows.push(`<div class="contact-detail"><span>Openingstijden</span><strong>${safe(c.hours).replace(/\n/g, "<br>")}</strong></div>`);
  return `<p class="eyebrow">3D PRINTED SHOP</p><h2>${safe(c.title || "Contact")}</h2><p class="legal-page-intro">${safe(c.intro || "Heb je een vraag? Neem gerust contact met ons op.").replace(/\n/g, "<br>")}</p><div class="contact-details">${rows.length ? rows.join("") : `<p class="muted">De contactgegevens worden binnenkort toegevoegd.</p>`}</div>${String(c.extra || "").trim() ? `<div class="contact-extra">${safe(c.extra).replace(/\n/g, "<br>")}</div>` : ""}<p class="shipping-note contact-shipping-note">Verzendkosten: <strong>${money(SHIPPING)}</strong> bij verzenden · Ophalen is gratis.</p>`;
}
function openContactPage() {
  openDialog(`<div id="contactPageContent" class="legal-page contact-page">${contactPageMarkup()}</div>`);
}
function updatePrivacyContactDetails() {
  const el = $("#privacyControllerDetails");
  if (!el) return;
  const details = [
    contactSettings.name && `Naam: ${contactSettings.name}`,
    contactSettings.address && `Adres: ${contactSettings.address}`,
    contactSettings.email && `E-mail: ${contactSettings.email}`
  ].filter(Boolean);
  el.innerHTML = details.length ? details.map(safe).join("<br>") : "[vul naam, adres en e-mailadres in]";
}
function openTermsPage() {
  const c = contactSettings;
  const identity = [
    c.name ? `<p><strong>Naam:</strong> ${safe(c.name)}</p>` : "",
    c.address ? `<p><strong>Adres:</strong> ${safe(c.address).replace(/\n/g, "<br>")}</p>` : "",
    c.email ? `<p><strong>E-mailadres:</strong> ${safe(c.email)}</p>` : "",
    c.phone ? `<p><strong>Telefoon:</strong> ${safe(c.phone)}</p>` : ""
  ].filter(Boolean).join("") || `<p>De gegevens van de aanbieder worden op de contactpagina gepubliceerd.</p>`;
  openDialog(`<div class="legal-page"><p class="eyebrow">3D PRINTED SHOP</p><h2>Algemene voorwaarden</h2><p class="privacy-updated">Laatst bijgewerkt: 17 november 2026</p>
    <div class="legal-content">
      <h3>1. Gegevens van de aanbieder</h3>${identity}
      <h3>2. Toepasselijkheid</h3><p>Deze algemene voorwaarden zijn van toepassing op het gebruik van deze webshop en op bestellingen die via de webshop worden geplaatst. Door een bestelling te plaatsen, ga je akkoord met deze voorwaarden. Dwingende wettelijke consumentenrechten blijven altijd gelden.</p>
      <h3>3. Aanbod en prijzen</h3><p>Producten, afbeeldingen, omschrijvingen en prijzen worden zo zorgvuldig mogelijk weergegeven. Een afbeelding kan kleine verschillen vertonen met het uiteindelijke 3D-geprinte product. De prijs en gekozen productopties worden vóór het plaatsen van de bestelling getoond. Eventuele duidelijke vergissingen of typefouten zijn niet bindend.</p>
      <h3>4. Bestellen</h3><p>Om online te bestellen heb je een klantaccount nodig. Controleer je gekozen producten, opties en gegevens voordat je de bestelling plaatst. Na het plaatsen wordt de bestelling geregistreerd en kun je de voortgang via Mijn bestellingen volgen. Een bestelling die via chat wordt aangemaakt, staat altijd als ophalen geregistreerd: je hoeft daarvoor geen verzendadres in te vullen en we spreken het ophaalmoment in de chat af.</p>
      <h3>5. Betaling</h3><p>Bij online bestellingen ontvang je na het plaatsen van de bestelling een persoonlijk betaalverzoek via Tikkie of een andere in de webshop aangegeven betaalmethode. De bestelling wordt verder afgehandeld volgens de betaalinstructies bij dat verzoek. Bij bestellingen via chat worden betaalafspraken rechtstreeks besproken.</p>
      <h3>6. Verzenden en ophalen</h3><p>Verzenden is op dit moment beschikbaar voor adressen in Nederland. De verzendkosten bedragen <strong>${money(SHIPPING)}</strong> per verzendbestelling. Ophalen is gratis. De gekozen verzend- of ophaalmethode en de bijbehorende kosten worden tijdens het bestellen getoond. De voortgang en eventuele planning zijn zichtbaar via Mijn bestellingen.</p>
      <h3>7. Producten op maat en herroeping</h3><p>Sommige producten kunnen worden samengesteld met keuzes zoals kleur, formaat of afwerking. Voor producten die volgens persoonlijke specificaties worden gemaakt, kan een wettelijke uitzondering op het herroepingsrecht gelden. Of zo'n uitzondering van toepassing is, hangt af van het product en de bestelling. Wettelijke consumentenrechten die niet uitgesloten mogen worden, blijven behouden. Je kunt via Mijn bestellingen binnen 14 dagen na ontvangst of ophalen een retourverzoek indienen; dit verzoek wordt beoordeeld aan de hand van de toepasselijke regels en de omstandigheden.</p>
      <h3>8. Klachten en contact</h3><p>Heb je een vraag, klacht of probleem met je bestelling? Neem dan contact op via de contactpagina of de chat in je account. Vermeld bij vragen over een bestelling het bestelnummer, zodat we je goed kunnen helpen.</p>
      <h3>9. Aansprakelijkheid</h3><p>De aanbieder is niet aansprakelijk voor schade voor zover die aansprakelijkheid wettelijk mag worden uitgesloten. Dit beperkt geen aansprakelijkheid die op grond van dwingend recht niet mag worden uitgesloten, waaronder aansprakelijkheid voor opzet of bewuste roekeloosheid.</p>
      <h3>10. Privacy</h3><p>Persoonsgegevens worden verwerkt zoals beschreven in de privacyverklaring onderaan de webshop.</p>
      <h3>11. Wijzigingen en toepasselijk recht</h3><p>De meest recente versie van deze voorwaarden is op de webshop te vinden. Op bestellingen is het toepasselijke Nederlandse recht van toepassing, met behoud van de bescherming die dwingend consumentenrecht biedt.</p>
      <p class="legal-draft-note"><strong>Controleer vóór publicatie:</strong> dit is een basisversie. Controleer of de voorwaarden passen bij je eigen werkwijze, assortiment, retourbeleid en bedrijfsgegevens. Laat de tekst zo nodig juridisch nakijken.</p>
    </div></div>`);
}

function openPrivacyNotice() {
  $("#privacyModal").hidden = false;
  document.body.classList.add("privacy-open");
  $("#closePrivacy").focus();
}
function closePrivacyNotice() {
  $("#privacyModal").hidden = true;
  document.body.classList.remove("privacy-open");
}
function openCookiePreferences() {
  closePrivacyNotice();
  $("#cookieBanner").hidden = false;
  $("#cookieBanner").scrollIntoView({ behavior: "smooth", block: "end" });
}
const cookiePreferences = readCookiePreferences();
if (!cookiePreferences) $("#cookieBanner").hidden = false;
$("#acceptAllCookies").onclick = () => saveCookiePreferences(true);
$("#rejectOptionalCookies").onclick = () => saveCookiePreferences(false);
$("#openTerms").onclick = openTermsPage;
$("#openContact").onclick = openContactPage;
$("#openPrivacy").onclick = openPrivacyNotice;
$("#cookiePrivacyLink").onclick = openPrivacyNotice;
$("#closePrivacy").onclick = closePrivacyNotice;
$("#privacyDone").onclick = closePrivacyNotice;
$("#openCookieSettings").onclick = openCookiePreferences;
$("#privacyCookieSettings").onclick = openCookiePreferences;
$("#privacyModal").querySelector("[data-close-privacy]").onclick = closePrivacyNotice;
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#privacyModal").hidden) closePrivacyNotice(); });

/* ---------- start ---------- */
try { const s = JSON.parse(sessionStorage.getItem("novashopUser") || "null"); if (s?.uid && s.role === "customer") state.user = s; else if (s?.role === "admin") { sessionStorage.removeItem("novashopUser"); sessionStorage.setItem("novashopAdmin", "1"); } } catch { sessionStorage.removeItem("novashopUser"); }
if (sessionStorage.getItem("novashopAdmin") === "1") state.admin = true;
refreshNav(); saveCart();
if (state.user?.uid) { const cachedUser = state.user; get(ref(db, `profiles/${cachedUser.uid}`)).then(snap => { const profile = snap.val(); if (profile?.username) setCustomer({ ...cachedUser, username: profile.username }); else usernamePrompt(cachedUser.uid, cachedUser.email, cachedUser.username || ""); }).catch(() => {}); }
const publicTrackToken = new URLSearchParams(location.search).get("track");
if (publicTrackToken) showPublicTracking(publicTrackToken);
const returnedOrder = new URLSearchParams(location.search).get("order");
if (returnedOrder) { toast("Je bent terug van de betaalpagina. De betaalstatus wordt door Mollie bevestigd."); history.replaceState({}, "", location.pathname); }
