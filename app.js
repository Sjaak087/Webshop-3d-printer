import { db } from "./firebase.js";
import { BEHEER_CONFIG as CFG } from "./beheer-config.js";
import { ref, onValue, get, push, set, update, remove, query, orderByChild, equalTo } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";

const $ = s => document.querySelector(s);
const SHIPPING = 3.95;   // verzendkosten per bestelling
const STATUSES = ["ontvangen", "verwerkt", "in de maak", "gemaakt", "klaar voor bezorging"];
const STAGES = ["in wachtrij", "in bereiding", "gemaakt"];   // fase per product zolang de bestelling "in de maak" is
const stageOf = i => STAGES.includes(i.stage) ? i.stage : STAGES[0];
const CAMERA_STATUSES = [...STATUSES];   // camera tonen bij alle bestelstatussen
const state = { user: null, admin: false, products: [], cart: [], tab: "products", loaded: false, orderNote: "" };
const overlay = $("#overlay"), content = $("#dialogContent");
let unsubs = [];                       // listeners van het open dialoogvenster
$("#year").textContent = new Date().getFullYear();

/* ---------- helpers ---------- */
const safe = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = n => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(Number(n) || 0);
const short = id => String(id || "").slice(-6);
const when = t => t ? new Date(t).toLocaleString("nl-NL") : "";
let toastTimer;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3000); }
function openDialog(html) { cleanup(); content.innerHTML = html; overlay.classList.remove("hidden"); }
function cleanup() { unsubs.forEach(u => u()); unsubs = []; }
function closeDialog() { cleanup(); overlay.classList.add("hidden"); content.innerHTML = ""; }
function listen(q, cb) { unsubs.push(onValue(q, cb)); }   // wordt automatisch opgeruimd
const toList = snap => Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v }));
const optList = p => (Array.isArray(p?.options) ? p.options : Object.values(p?.options || {})).filter(o => o && o.name);
const isSoldOut = p => !!p.soldOut || (optList(p).length > 0 && optList(p).every(o => o.soldOut));
const itemKey = (id, option) => id + "|" + (option || "");
const optText = i => i.option ? ` · ${safe(i.optionLabel || "Keuze")}: <b>${safe(i.option)}</b>` : "";
$("#closeDialog").onclick = closeDialog;
overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeDialog(); });

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
function saveSession() { sessionStorage.setItem("novashopUser", JSON.stringify({ uid: state.user.uid, email: state.user.email, role: state.user.role })); }
function setUser(u, admin) { state.user = u; state.admin = admin; fails = 0; saveSession(); refreshNav(); }
function refreshNav() {
  $("#accountBtn").textContent = state.user && !state.admin ? "Mijn account" : "Inloggen";
  $("#adminEntry").textContent = state.admin ? "Sitebeheer · ingelogd" : "Sitebeheer";
}

/* ---------- winkelwagen (blijft bewaard) ---------- */
try { state.cart = JSON.parse(localStorage.getItem("novashopCart") || "[]"); } catch { state.cart = []; }
function saveCart() { try { localStorage.setItem("novashopCart", JSON.stringify(state.cart)); } catch { } $("#cartCount").textContent = state.cart.reduce((n, x) => n + x.qty, 0); }
function cartIssue(c) {
  const p = state.products.find(x => x.id === c.id); if (!p) return "Niet meer beschikbaar";
  if (isSoldOut(p)) return "Uitverkocht";
  const opts = optList(p);
  if (opts.length) { const o = opts.find(x => x.name === c.option); if (!o) return "Kies opnieuw een " + (p.optionLabel || "optie").toLowerCase(); if (o.soldOut) return "Deze optie is uitverkocht"; }
  return "";
}
function addCart(id, option = "") {
  const p = state.products.find(x => x.id === id); if (!p) return;
  if (isSoldOut(p)) return toast("Dit product is uitverkocht");
  const opts = optList(p); let choice = null;
  if (opts.length) {
    choice = opts.find(o => o.name === option);
    if (!choice) return toast(`Kies eerst een ${(p.optionLabel || "optie").toLowerCase()}`);
    if (choice.soldOut) return toast("Deze optie is uitverkocht");
  }
  const key = itemKey(id, choice?.name);
  const it = state.cart.find(x => itemKey(x.id, x.option) === key);
  if (it) it.qty++; else state.cart.push({ id, title: p.title, price: Number(p.price), image: "", qty: 1, ...(choice ? { option: choice.name, optionLabel: p.optionLabel || "Keuze" } : {}) });
  saveCart(); toast("Toegevoegd aan je winkelwagen");
}

/* ---------- producten ---------- */
onValue(ref(db, "products"), snap => { state.products = toList(snap).filter(p => p.active !== false); state.loaded = true; renderProducts(); });
function renderProducts() {
  const q = ($("#search").value || "").toLowerCase();
  const list = state.products.filter(p => (p.title + " " + (p.description || "")).toLowerCase().includes(q));
  $("#productTotal").textContent = `${list.length} producten`;
  $("#products").innerHTML = list.length ? list.map(p => { const out = isSoldOut(p), opts = optList(p); return `<article class="product-card ${out ? "sold-out" : ""}"><button class="product-open" data-open="${safe(p.id)}"><div class="product-image">${p.image ? `<img loading="lazy" src="${safe(p.image)}" alt="${safe(p.title)}">` : "<span>✦</span>"}${out ? `<span class="sold-badge">Uitverkocht</span>` : ""}</div><div class="product-info"><h3>${safe(p.title)}</h3><strong>${money(p.price)}</strong></div></button>${out ? `<button class="add-small" disabled>Uitverkocht</button>` : opts.length ? `<button class="add-small" data-open="${safe(p.id)}">Kies ${safe((p.optionLabel || "optie").toLowerCase())}</button>` : `<button class="add-small" data-add="${safe(p.id)}">＋ In winkelwagen</button>`}</article>`; }).join("") : `<div class="empty-state">Nog geen producten gevonden.<br><small>Beheerder? Voeg producten toe via Sitebeheer.</small></div>`;
}
$("#searchBtn").onclick = renderProducts; $("#search").addEventListener("input", renderProducts);
$("#products").addEventListener("click", e => {
  const add = e.target.closest("[data-add]"); if (add) return addCart(add.dataset.add);
  const open = e.target.closest("[data-open]"); if (open) showProduct(open.dataset.open);
});
function showProduct(id) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  const opts = optList(p), out = isSoldOut(p), label = p.optionLabel || "Keuze"; let chosen = "";
  openDialog(`<div class="product-detail"><div class="detail-image">${p.image ? `<img src="${safe(p.image)}" alt="${safe(p.title)}">` : "✦"}</div><div><p class="eyebrow">PRODUCTDETAILS</p><h2>${safe(p.title)}</h2><div class="detail-price">${money(p.price)}</div><p class="description">${safe(p.description || "Geen beschrijving beschikbaar.")}</p>${opts.length ? `<div class="option-group"><b>Kies een ${safe(label.toLowerCase())}</b><div class="option-chips">${opts.map((o, i) => `<button type="button" class="opt-chip" data-opt="${i}" ${o.soldOut ? "disabled" : ""}>${safe(o.name)}${o.soldOut ? " · uitverkocht" : ""}</button>`).join("")}</div></div>` : ""}${out ? `<div class="sold-note">Dit product is uitverkocht.</div>` : ""}<button class="primary full" id="detailAdd" ${out ? "disabled" : ""}>＋ Toevoegen aan winkelwagen</button></div></div>`);
  content.querySelectorAll("[data-opt]").forEach(b => b.onclick = () => { chosen = opts[Number(b.dataset.opt)].name; content.querySelectorAll("[data-opt]").forEach(x => x.classList.toggle("active", x === b)); });
  $("#detailAdd").onclick = () => { if (opts.length && !chosen) return toast(`Kies eerst een ${label.toLowerCase()}`); addCart(id, chosen); closeDialog(); };
}

/* ---------- winkelwagen-dialoog ---------- */
$("#cartBtn").onclick = showCart;
function showCart() {
  const sub = state.cart.reduce((n, x) => n + x.price * x.qty, 0), total = sub + SHIPPING;
  openDialog(`<p class="eyebrow">JOUW SELECTIE</p><h2>Winkelwagen</h2>${state.cart.length ? `<div class="cart-lines">${state.cart.map(x => { const k = safe(itemKey(x.id, x.option)), issue = state.loaded ? cartIssue(x) : ""; return `<div class="cart-line"><div class="cart-line-info"><b>${safe(x.title)}</b>${x.option ? `<small>${safe(x.optionLabel || "Keuze")}: <b>${safe(x.option)}</b></small>` : ""}<small>${money(x.price)} per stuk</small>${issue ? `<small class="line-issue">${safe(issue)}</small>` : ""}<div class="quantity-control"><button type="button" aria-label="Minder" data-qty="${k}" data-delta="-1">−</button><span>${x.qty}</span><button type="button" aria-label="Meer" data-qty="${k}" data-delta="1">＋</button></div></div><div class="cart-line-actions"><b>${money(x.price * x.qty)}</b><button class="remove-item" data-remove="${k}">Verwijder</button></div></div>`; }).join("")}</div><div class="cart-sum"><div><span>Subtotaal</span><span>${money(sub)}</span></div><div><span>Verzendkosten</span><span>${money(SHIPPING)}</span></div></div><div class="cart-total"><span>Totaal</span><b>${money(total)}</b></div><div class="stack note-field"><label>Opmerking bij je bestelling (optioneel)<textarea id="orderNote" rows="3" maxlength="500" placeholder="Bijv. gewenste afwerking of een wens voor de kleur">${safe(state.orderNote)}</textarea></label></div><button class="primary full" id="checkout">Verder naar bestellen</button>` : `<div class="empty-state">Je winkelwagen is nog leeg.</div><button class="secondary full" id="continue">Verder winkelen</button>`}`);
  content.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { state.cart = state.cart.filter(x => itemKey(x.id, x.option) !== b.dataset.remove); saveCart(); showCart(); });
  content.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => {
    const it = state.cart.find(x => itemKey(x.id, x.option) === b.dataset.qty); if (!it) return;
    it.qty += Number(b.dataset.delta); if (it.qty <= 0) state.cart = state.cart.filter(x => x !== it);
    saveCart(); showCart();
  });
  $("#continue")?.addEventListener("click", closeDialog);
  $("#orderNote")?.addEventListener("input", e => state.orderNote = e.target.value);
  $("#checkout")?.addEventListener("click", () => state.user && !state.admin ? placeOrder() : authForm("login", "Log in met een klantaccount om je bestelling af te ronden."));
}

/* ---------- klantaccount ---------- */
function authForm(mode = "login", message = "") {
  const login = mode === "login";
  openDialog(`<p class="eyebrow">3D PRINTED SHOP ACCOUNT</p><h2>${login ? "Welkom terug" : "Account aanmaken"}</h2><p class="muted">${safe(message)}</p><form id="authForm" class="stack"><label>E-mailadres<input type="email" id="authEmail" required autocomplete="email"></label><label>Wachtwoord<input type="password" id="authPassword" required minlength="${login ? 1 : 8}" autocomplete="${login ? "current-password" : "new-password"}"></label>${login ? "" : `<p class="hint">Minimaal 8 tekens.</p>`}<button class="primary full">${login ? "Inloggen" : "Account aanmaken"}</button></form><p class="switch-auth">${login ? "Nog geen account?" : "Heb je al een account?"} <button id="switchAuth" class="inline-link">${login ? "Account aanmaken" : "Inloggen"}</button></p>`);
  $("#authForm").onsubmit = async e => {
    e.preventDefault(); if (locked()) return;
    const btn = e.submitter; btn && (btn.disabled = true);
    const email = $("#authEmail").value.trim().toLowerCase(), pw = $("#authPassword").value;
    try {
      const key = await emailKey(email), accRef = ref(db, "accounts/" + key), acc = (await get(accRef)).val();
      if (!login) {
        if (acc) return toast("Dit e-mailadres bestaat al.");
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        await set(accRef, { email, salt, hash: await hashPw(pw, salt), createdAt: Date.now() });
        setUser({ uid: key, email, role: "customer" }, false); closeDialog(); toast("Account aangemaakt!");
      } else {
        if (!acc || await hashPw(pw, acc.salt) !== acc.hash) return failed();
        setUser({ uid: key, email, role: "customer" }, false); closeDialog(); toast("Je bent ingelogd");
      }
    } catch (err) { console.error(err); toast("Accountactie mislukt. Probeer het opnieuw."); }
    finally { btn && (btn.disabled = false); }
  };
  $("#switchAuth").onclick = () => authForm(login ? "register" : "login");
}
$("#accountBtn").onclick = () => state.user && !state.admin ? accountMenu() : authForm();
function accountMenu() {
  openDialog(`<p class="eyebrow">MIJN ACCOUNT</p><h2>${safe(state.user.email)}</h2><div class="stack"><button class="secondary full" id="myOrders">Mijn bestellingen</button><button class="secondary full" id="myChats">Mijn chats</button><button class="secondary full" id="logout">Uitloggen</button></div>`);
  $("#myOrders").onclick = showMyOrders; $("#myChats").onclick = showMyChats;
  $("#logout").onclick = logout;
}
function logout() { state.user = null; state.admin = false; sessionStorage.removeItem("novashopUser"); refreshNav(); closeDialog(); toast("Je bent uitgelogd"); }

/* ---------- bestellen ---------- */
async function placeOrder() {
  if (!state.cart.length) return;
  if (!state.loaded) return toast("Producten worden nog geladen, probeer het zo opnieuw.");
  const bad = state.cart.filter(c => cartIssue(c));
  if (bad.length) { state.cart = state.cart.filter(c => !cartIssue(c)); saveCart(); toast("Niet meer beschikbaar en uit je winkelwagen gehaald: " + bad.map(b => b.title + (b.option ? ` (${b.option})` : "")).join(", ")); return showCart(); }
  const items = state.cart.map(c => { const p = state.products.find(x => x.id === c.id); return { id: c.id, title: p.title, price: Number(p.price), qty: c.qty, ...(optList(p).length ? { option: c.option, optionLabel: p.optionLabel || "Keuze" } : {}) }; });
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0), total = subtotal + SHIPPING;
  const note = (state.orderNote || "").trim().slice(0, 500);
  const orderKey = push(ref(db, "orders")).key, chatKey = push(ref(db, "chats")).key, msgKey = push(ref(db, `chats/${chatKey}/messages`)).key, now = Date.now();
  try {
    await update(ref(db), {                         // alles-of-niets in één schrijfactie
      ["orders/" + orderKey]: { userId: state.user.uid, email: state.user.email, items, subtotal, shipping: SHIPPING, total, status: STATUSES[0], createdAt: now, chatId: chatKey, ...(note ? { note } : {}) },
      ["chats/" + chatKey]: { orderId: orderKey, userId: state.user.uid, email: state.user.email, createdAt: now, lastMessage: "Bestelling geplaatst", lastMessageAt: now, messages: { [msgKey]: { sender: "system", text: `Je bestelling is ontvangen. Totaal: ${money(total)} (incl. ${money(SHIPPING)} verzendkosten). Stel hier gerust je vragen.`, createdAt: now } } }
    });
    state.cart = []; state.orderNote = ""; saveCart(); toast("Bestelling geplaatst! Je chat is geopend."); openChat(chatKey);
  } catch (e) { console.error(e); toast("Bestellen lukte niet. Probeer het opnieuw."); }
}
function showMyOrders() {
  openDialog(`<p class="eyebrow">OVERZICHT</p><h2>Mijn bestellingen</h2><div id="ordersBox" class="stack"><p class="muted">Laden…</p></div>`);
  listen(query(ref(db, "orders"), orderByChild("userId"), equalTo(state.user.uid)), snap => {
    const orders = toList(snap).sort((a, b) => b.createdAt - a.createdAt);
    $("#ordersBox").innerHTML = orders.length ? orders.map(o => `<div class="order-row"><div><b>Bestelling #${short(o.id)}</b><small>${when(o.createdAt)} · ${money(o.total)}</small><span class="status-pill">${safe(o.status)}</span></div><button class="secondary" data-track="${safe(o.id)}">Volgen</button></div>`).join("") : "<p class='muted'>Je hebt nog geen bestellingen.</p>";
    content.querySelectorAll("[data-track]").forEach(b => b.onclick = () => showOrderTracking(b.dataset.track));
  });
}
function renderCamera(show, getShown, setShown) {
  const box = $("#camBox");
  if (!box) return;
  if (!show) {
    if (getShown() !== false) { setShown(false); box.innerHTML = ""; }
    return;
  }
  const url = String(CFG.cameraUrl || "").trim();
  if (!url) {
    if (getShown() !== "setup") {
      setShown("setup");
      box.innerHTML = `<div class="cam-card"><div class="cam-head"><b>Printercamera</b><span class="cam-wait">NIET INGESTELD</span></div><div class="cam-offline">De livecamera is nog niet gekoppeld.<br><small>Stel de camerabrug in en vul daarna de HTTPS-stream-URL in bij <code>beheer-config.js</code> (cameraUrl).</small></div></div>`;
    }
    return;
  }
  if (getShown() === true) return;
  setShown(true);
  box.innerHTML = `<div class="cam-card"><div class="cam-head"><b>Live meekijken</b><span class="cam-wait" id="camState">● VERBINDEN…</span></div><div class="cam-frame"><img id="camImg" alt="Livebeeld van de 3D-printer"><div class="cam-offline hidden" id="camOff"><b class="cam-off-title">3D printer is offline</b><br><small>We proberen het automatisch opnieuw.</small><br><button class="secondary" id="camRetry">Opnieuw proberen</button></div></div></div>`;
  const img = $("#camImg"), off = $("#camOff"), label = $("#camState");
  let loadTimer, retryTimer, pollTimer, statusOk = false;
  const statusUrl = (() => { try { const u = new URL(url); u.pathname = u.pathname.replace(/stream\.mjpeg$/, "status"); u.search = ""; return u.href; } catch { return ""; } })();
  const stopAll = () => { clearTimeout(loadTimer); clearTimeout(retryTimer); clearInterval(pollTimer); };
  const setLabel = (text, cls) => { label.textContent = text; label.className = cls; };
  const offline = () => { stopAll(); img.removeAttribute("src"); setLabel("● OFFLINE", "cam-off"); img.classList.add("hidden"); off.classList.remove("hidden"); retryTimer = setTimeout(load, 20000); };
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
  img.onload = () => { clearTimeout(loadTimer); setLabel("● LIVE", "cam-live"); clearInterval(pollTimer); pollTimer = setInterval(poll, 8000); };
  img.onerror = offline;
  $("#camRetry").onclick = load;
  unsubs.push(() => { stopAll(); img.onload = img.onerror = null; });
  load();
}
function showOrderTracking(id) {
  openDialog(`<p class="eyebrow">TRACK & TRACE</p><h2>Bestelling #${short(id)}</h2><div id="trackBox"></div><div id="camBox"></div>`);
  let camShown = null;
  listen(ref(db, "orders/" + id), snap => {
    const o = snap.val(); if (!o) return; const idx = STATUSES.indexOf(o.status);
    renderCamera(CAMERA_STATUSES.includes(o.status), () => camShown, v => camShown = v);
    $("#trackBox").innerHTML = `<div class="tracking">${STATUSES.map((x, i) => `<div class="track-step ${idx >= i ? "done" : ""}"><span>${i + 1}</span><b>${x}</b></div>`).join("")}</div><p class="muted">Huidige status: <b>${safe(o.status)}</b></p><div class="order-items">${(o.items || []).map(i => `<div>${safe(i.title)}${optText(i)} × ${i.qty}${o.status === "in de maak" ? ` <span class="stage-chip st${STAGES.indexOf(stageOf(i))}">${stageOf(i)}</span>` : ""}</div>`).join("")}</div>${o.note ? `<p class="order-note"><b>Jouw opmerking:</b> ${safe(o.note)}</p>` : ""}<div class="cart-sum"><div><span>Subtotaal</span><span>${money(o.subtotal ?? o.total)}</span></div><div><span>Verzendkosten</span><span>${money(o.shipping ?? 0)}</span></div><div><b>Totaal</b><b>${money(o.total)}</b></div></div><button class="primary full" id="trackChat">Open chat over deze bestelling</button>`;
    $("#trackChat").onclick = () => o.chatId && openChat(o.chatId);
  });
}
function showMyChats() {
  if (!state.user) return authForm();
  openDialog(`<p class="eyebrow">SERVICE</p><h2>Mijn chats</h2><div id="chatsBox" class="stack"><p class="muted">Laden…</p></div>`);
  listen(query(ref(db, "chats"), orderByChild("userId"), equalTo(state.user.uid)), snap => {
    const chats = toList(snap).sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    $("#chatsBox").innerHTML = chats.length ? chats.map(c => `<button class="chat-list-item" data-chat="${safe(c.id)}"><b>Bestelling #${short(c.orderId)}</b><small>${safe(c.lastMessage || "Chat openen")}</small></button>`).join("") : "<p class='muted'>Je hebt nog geen chats. Na een bestelling verschijnt hier je gesprek.</p>";
    content.querySelectorAll("[data-chat]").forEach(b => b.onclick = () => openChat(b.dataset.chat));
  });
}
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
function openChat(id) {
  if (!state.user) return authForm();
  get(ref(db, "chats/" + id)).then(s => {
    const c = s.val(); if (!c) return toast("Chat niet gevonden");
    if (!state.admin && c.userId !== state.user.uid) return toast("Geen toegang tot deze chat");
    openDialog(`<div class="chat-shell"><div class="chat-heading"><div class="chat-title-wrap"><p class="eyebrow">3D PRINTED SHOP KLANTENSERVICE</p><h2>Bestelling #${short(c.orderId)}</h2><small class="chat-subtitle">${safe(c.email || "Gesprek met 3D Printed Shop")}</small></div><button class="secondary" id="chatTrack">Bestelling volgen</button></div><div class="chat-notice">Deel hier je vraag of een link. Links en Tikkie-betaalverzoeken kun je direct openen.</div><div id="messages" class="messages" aria-live="polite"></div><form id="sendMessage" class="send-message"><input id="messageText" placeholder="Typ je bericht…" required maxlength="1000" autocomplete="off"><button class="primary">Verstuur</button></form></div>`);
    $("#chatTrack").onclick = () => c.orderId && showOrderTracking(c.orderId);
    $("#sendMessage").onsubmit = async e => {
      e.preventDefault(); const input = $("#messageText"), text = input.value.trim(); if (!text) return;
      const now = Date.now();
      try {
        await update(ref(db), { [`chats/${id}/messages/${push(ref(db, `chats/${id}/messages`)).key}`]: { sender: state.admin ? "admin" : "user", uid: state.user.uid, text, createdAt: now }, [`chats/${id}/lastMessage`]: text, [`chats/${id}/lastMessageAt`]: now });
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

/* ---------- sitebeheer ---------- */
$("#adminEntry").onclick = () => state.admin ? adminPanel() : openAdminLogin();
function openAdminLogin() {
  openDialog(`<p class="eyebrow">ALLEEN VOOR BEHEERDERS</p><h2>Sitebeheer</h2><form id="adminLoginForm" class="stack" autocomplete="off"><label>E-mailadres<input id="adminEmail" type="email" required autocomplete="off"></label><label>Wachtwoord<input id="adminPassword" type="password" required autocomplete="current-password"></label><button class="primary full">Inloggen als beheerder</button></form>`);
  $("#adminLoginForm").onsubmit = async e => {
    e.preventDefault(); if (locked()) return;
    const email = $("#adminEmail").value.trim().toLowerCase(), pw = $("#adminPassword").value;
    const hash = await hashPw(pw, CFG.salt, CFG.iterations);
    if (email !== CFG.adminEmail.toLowerCase() || hash !== CFG.hash) return failed();
    setUser({ uid: "admin", email, role: "admin" }, true); closeDialog(); adminPanel();
  };
}
function adminPanel() {
  if (!state.admin) return openAdminLogin();
  openDialog(`<div class="admin-head"><div><p class="eyebrow">3D PRINTED SHOP</p><h2>Sitebeheer</h2></div><span class="admin-label">BEHEERDER</span></div><div class="tabs"><button data-tab="products">Producten</button><button data-tab="orders">Track & trace</button><button data-tab="history">Bestellingen</button><button data-tab="chats">Chats</button><button id="adminLogout">Uitloggen</button></div><div id="adminContent"></div>`);
  $("#adminLogout").onclick = logout;
  content.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { state.tab = b.dataset.tab; adminTab(); });
  adminTab();
}
function adminTab() {
  content.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x.dataset.tab === state.tab));
  cleanup(); const target = $("#adminContent"); if (!target) return;
  if (state.tab === "products") listen(ref(db, "products"), snap => {
    const ps = toList(snap);
    target.innerHTML = `<div class="admin-toolbar"><h3>Producten beheren</h3><button class="primary" id="newProduct">＋ Product toevoegen</button></div>${ps.length ? ps.map(p => { const opts = optList(p); return `<div class="admin-row"><div class="admin-product">${p.image ? `<img src="${safe(p.image)}" alt="">` : "✦"}<div><b>${safe(p.title)}</b>${p.soldOut ? ` <span class="badge-out">UITVERKOCHT</span>` : ""}<small>${money(p.price)}</small>${opts.length ? `<div class="opt-admin"><small>${safe(p.optionLabel || "Keuze")}:</small>${opts.map((o, i) => `<button type="button" class="opt-toggle ${o.soldOut ? "out" : ""}" data-optout="${safe(p.id)}" data-i="${i}" title="Klik om uitverkocht aan/uit te zetten">${safe(o.name)}${o.soldOut ? " · uitverkocht" : ""}</button>`).join("")}</div>` : ""}</div></div><div class="admin-actions"><button class="secondary" data-soldout="${safe(p.id)}">${p.soldOut ? "Weer beschikbaar" : "Uitverkocht"}</button> <button class="secondary" data-edit="${safe(p.id)}">Bewerken</button> <button class="remove-item" data-delete="${safe(p.id)}">Verwijderen</button></div></div>`; }).join("") : "<p class='muted'>Je hebt nog geen producten toegevoegd.</p>"}`;
    $("#newProduct").onclick = () => productEditor();
    target.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => productEditor(b.dataset.edit));
    target.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => { if (confirm("Dit product verwijderen?")) { await remove(ref(db, "products/" + b.dataset.delete)); toast("Product verwijderd"); } });
    target.querySelectorAll("[data-soldout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.soldout); if (p) update(ref(db, "products/" + p.id), { soldOut: !p.soldOut }).then(() => toast(p.soldOut ? "Product weer beschikbaar" : "Product op uitverkocht gezet")).catch(() => toast("Opslaan mislukt")); });
    target.querySelectorAll("[data-optout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.optout), o = p && optList(p)[Number(b.dataset.i)]; if (o) update(ref(db, `products/${p.id}/options/${b.dataset.i}`), { soldOut: !o.soldOut }).then(() => toast(o.soldOut ? `${o.name} weer beschikbaar` : `${o.name} op uitverkocht gezet`)).catch(() => toast("Opslaan mislukt")); });
  });
  else if (state.tab === "orders") listen(ref(db, "orders"), snap => {
    const os = toList(snap).sort((a, b) => b.createdAt - a.createdAt);
    target.innerHTML = `<h3>Bestellingen en status</h3>${os.length ? os.map(o => `<div class="admin-row order-admin"><div><b>#${short(o.id)} · ${safe(o.email)}</b><small>${(o.items || []).map(i => `<span class="oi">${safe(i.title)}${optText(i)} × ${i.qty}</span>`).join("")}<span class="oi">${money(o.subtotal ?? o.total)} + ${money(o.shipping ?? 0)} verzending = <b>${money(o.total)}</b></span></small>${o.note ? `<p class="order-note"><b>Opmerking klant:</b> ${safe(o.note)}</p>` : ""}${o.status === "in de maak" ? `<div class="stage-panel"><b>Voortgang per product</b>${(o.items || []).map((i, n) => `<div class="stage-row"><span>${safe(i.title)}${optText(i)} × ${i.qty}</span><select data-stage="${safe(o.id)}" data-i="${n}">${STAGES.map(st => `<option ${stageOf(i) === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>`).join("")}</div>` : ""}</div><select data-status="${safe(o.id)}">${STATUSES.map(s => `<option ${o.status === s ? "selected" : ""}>${s}</option>`).join("")}</select><button class="secondary" data-ochat="${safe(o.chatId || "")}">Chat</button></div>`).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}`;
    target.querySelectorAll("[data-status]").forEach(s => s.onchange = () => update(ref(db, "orders/" + s.dataset.status), { status: s.value }).then(() => toast("Bestelstatus bijgewerkt")));
    target.querySelectorAll("[data-stage]").forEach(sel => sel.onchange = () => update(ref(db, `orders/${sel.dataset.stage}/items/${sel.dataset.i}`), { stage: sel.value }).then(() => toast("Fase bijgewerkt")).catch(() => toast("Opslaan mislukt")));
    target.querySelectorAll("[data-ochat]").forEach(b => b.onclick = () => b.dataset.ochat && openChat(b.dataset.ochat));
  });
  else if (state.tab === "history") listen(ref(db, "orders"), snap => {
    const os = toList(snap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));   // oudste eerst
    target.innerHTML = `<h3>Alle bestellingen · oudste eerst (${os.length})</h3>${os.length ? os.map(o => `<div class="order-card"><div class="order-card-head"><b>Bestelling #${short(o.id)}</b><span class="status-pill">${safe(o.status)}</span></div><small class="order-when">Geplaatst op ${when(o.createdAt)}</small><small>${safe(o.email)}</small><div class="order-items">${(o.items || []).map(i => `<div>${safe(i.title)}${optText(i)} × ${i.qty} · ${money(i.price * i.qty)}${o.status === "in de maak" ? ` <span class="stage-chip st${STAGES.indexOf(stageOf(i))}">${stageOf(i)}</span>` : ""}</div>`).join("")}</div>${o.note ? `<p class="order-note"><b>Opmerking klant:</b> ${safe(o.note)}</p>` : ""}<div class="cart-sum"><div><span>Subtotaal</span><span>${money(o.subtotal ?? o.total)}</span></div><div><span>Verzendkosten</span><span>${money(o.shipping ?? 0)}</span></div><div><b>Totaal</b><b>${money(o.total)}</b></div></div><div class="admin-actions"><button class="secondary" data-ochat="${safe(o.chatId || "")}">Chat openen</button><button class="primary" data-finish="${safe(o.id)}">Afronden en verwijderen</button></div></div>`).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}`;
    target.querySelectorAll("[data-ochat]").forEach(b => b.onclick = () => b.dataset.ochat && openChat(b.dataset.ochat));
    target.querySelectorAll("[data-finish]").forEach(b => b.onclick = async () => {
      const o = os.find(x => x.id === b.dataset.finish); if (!o) return;
      if (!confirm(`Bestelling #${short(o.id)} afronden? De bestelling, de chat en de track & trace worden definitief verwijderd.`)) return;
      try { await update(ref(db), { ["orders/" + o.id]: null, ...(o.chatId ? { ["chats/" + o.chatId]: null } : {}) }); toast("Bestelling afgerond en verwijderd"); }
      catch (err) { console.error(err); toast("Verwijderen mislukt. Probeer het opnieuw."); }
    });
  });
  else listen(ref(db, "chats"), snap => {
    const cs = toList(snap).sort((a, b) => (b.lastMessageAt || b.createdAt) - (a.lastMessageAt || a.createdAt));
    target.innerHTML = `<h3>Klantenchats</h3>${cs.length ? cs.map(c => `<button class="chat-list-item" data-achat="${safe(c.id)}"><b>${safe(c.email || "Klant")} · #${short(c.orderId)}</b><small>${safe(c.lastMessage || "Nieuw gesprek")}</small></button>`).join("") : "<p class='muted'>Er zijn nog geen chats.</p>"}`;
    target.querySelectorAll("[data-achat]").forEach(b => b.onclick = () => openChat(b.dataset.achat));
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
  const p = id ? ((await get(ref(db, "products/" + id))).val() || {}) : {};
  let image = p.image || "";
  openDialog(`<p class="eyebrow">CATALOGUS</p><h2>${id ? "Product bewerken" : "Nieuw product"}</h2><form id="productForm" class="stack"><label>Titel<input id="pTitle" required maxlength="100" value="${safe(p.title || "")}"></label><label>Prijs in euro<input id="pPrice" type="number" min="0" step="0.01" required value="${p.price ?? ""}"></label><label>Beschrijving<textarea id="pDescription" rows="4" maxlength="2000">${safe(p.description || "")}</textarea></label><label>Productafbeelding<input id="pImage" type="file" accept="image/*"></label><p class="hint">JPG, PNG of WEBP. De afbeelding wordt automatisch verkleind.</p><img id="pPreview" class="preview" alt="" ${image ? `src="${safe(image)}"` : "hidden"}><fieldset class="opt-editor"><legend>Keuzes voor de klant (bijv. kleuren)</legend><label>Naam van de keuze<input id="pOptLabel" maxlength="30" placeholder="Kleur" value="${safe(p.optionLabel || "")}"></label><div id="optRows" class="opt-rows"></div><button type="button" class="secondary" id="addOpt">＋ Optie toevoegen</button><p class="hint">Laat leeg als dit product geen keuze heeft. Klanten kiezen er dan precies één. Met "uitverkocht" blokkeer je alleen die optie.</p></fieldset><label class="check"><input type="checkbox" id="pSoldOut" ${p.soldOut ? "checked" : ""}> Hele product uitverkocht</label><button class="primary full" id="pSave">Product opslaan</button></form>`);
  const rows = $("#optRows");
  const addRow = (o = {}) => {
    const d = document.createElement("div"); d.className = "opt-row";
    d.innerHTML = `<input class="o-name" maxlength="40" placeholder="bijv. Rood" value="${safe(o.name || "")}"><label><input type="checkbox" class="o-out" ${o.soldOut ? "checked" : ""}> uitverkocht</label><button type="button" class="remove-item o-del" aria-label="Optie verwijderen">✕</button>`;
    d.querySelector(".o-del").onclick = () => d.remove(); rows.appendChild(d);
  };
  optList(p).forEach(addRow); $("#addOpt").onclick = () => addRow();
  $("#pImage").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { image = await shrinkImage(f); $("#pPreview").src = image; $("#pPreview").hidden = false; toast("Afbeelding klaar"); }
    catch (err) { console.error(err); e.target.value = ""; toast(err.message.includes("groot") ? err.message : "Deze afbeelding kan niet worden gelezen. Kies een JPG, PNG of WEBP."); }
  };
  $("#productForm").onsubmit = async e => {
    e.preventDefault();
    const price = Number($("#pPrice").value); if (!Number.isFinite(price) || price < 0) return toast("Vul een geldige prijs in");
    const opts = [...rows.querySelectorAll(".opt-row")].map(r => ({ name: r.querySelector(".o-name").value.trim(), soldOut: r.querySelector(".o-out").checked })).filter(o => o.name);
    const names = opts.map(o => o.name.toLowerCase()); if (new Set(names).size !== names.length) return toast("Elke optie moet een andere naam hebben");
    const btn = $("#pSave"); btn.disabled = true; btn.textContent = "Opslaan…";
    const data = { title: $("#pTitle").value.trim(), price, description: $("#pDescription").value.trim(), image, active: true, soldOut: $("#pSoldOut").checked, optionLabel: opts.length ? ($("#pOptLabel").value.trim() || "Kleur") : null, options: opts.length ? opts : null, updatedAt: Date.now() };
    try { id ? await update(ref(db, "products/" + id), data) : await set(push(ref(db, "products")), { ...data, createdAt: Date.now() }); toast("Product opgeslagen"); adminPanel(); }
    catch (err) { console.error(err); btn.disabled = false; btn.textContent = "Product opslaan"; toast("Opslaan mislukt: " + (err.code || err.message)); }
  };
}

/* ---------- start ---------- */
try { const s = JSON.parse(sessionStorage.getItem("novashopUser") || "null"); if (s?.uid) { state.user = s; state.admin = s.role === "admin"; } } catch { sessionStorage.removeItem("novashopUser"); }
refreshNav(); saveCart();
