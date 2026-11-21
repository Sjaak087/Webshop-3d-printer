import { db } from "./firebase.js";
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
const state = { user: null, admin: false, products: [], categories: [], optionSets: {}, reviews: {}, favoriteIds: new Set(), categoryFilter: "all", cart: [], tab: "dashboard", loaded: false, productsError: false, orderNote: "", pendingQuoteRequest: false, plan: { orderId: null, key: null, week: null, form: { date: "", from: "", to: "", endDate: "" }, orders: [], scroll: 7 * 44 } };
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
const validColorHex = value => /^#[0-9a-f]{6}$/i.test(String(value || ""));
function productColorChoices(product) {
  const seen = new Set();
  return optionGroupsOf(product).flatMap(group => group.options.map(option => ({ name: option.name, hex: String(option.colorHex || "").toLowerCase(), soldOut: !!option.soldOut, group: group.label })))
    .filter(option => validColorHex(option.hex) && !option.soldOut && !seen.has(option.hex) && seen.add(option.hex));
}
const optionGroupsOf = p => {
  // Een optionSetId verwijst naar één gedeelde set in Firebase. Daardoor zien
  // alle gekoppelde producten dezelfde opties na iedere Realtime Database-update.
  const sharedSet = p?.optionSetId ? state.optionSets?.[p.optionSetId] : null;
  const source = sharedSet && sharedSet.groups != null ? sharedSet.groups : p?.optionGroups;
  const raw = Array.isArray(source) ? source : Object.values(source || {});
  const normalizeOption = o => ({
    name: String(o.name), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut,
    ...(validColorHex(o.colorHex) ? { colorHex: String(o.colorHex).toLowerCase() } : {})
  });
  const groups = raw.filter(g => g && g.label && (Array.isArray(g.options) || g.options)).map((g, i) => ({
    id: g.id || `group-${i}`, label: String(g.label), options: (Array.isArray(g.options) ? g.options : Object.values(g.options || {})).filter(o => o && o.name).map(normalizeOption)
  }));
  if (groups.length || (sharedSet && sharedSet.groups != null)) return groups;
  const old = legacyOptions(p);
  return old.length ? [{ id: "legacy", label: p.optionLabel || "Keuze", options: old.map(normalizeOption) }] : [];
};
const serializableOptionGroups = groups => groups.map(g => ({
  label: String(g.label || "").trim(),
  options: (Array.isArray(g.options) ? g.options : []).map(o => ({
    name: String(o.name || "").trim(), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut,
    ...(validColorHex(o.colorHex) ? { colorHex: String(o.colorHex).toLowerCase() } : {})
  })).filter(o => o.name)
})).filter(g => g.label || g.options.length);
async function ensureSharedOptionSet(product) {
  if (!product?.id) throw new Error("Het bronproduct is niet beschikbaar.");
  if (product.optionSetId) {
    const existing = await get(ref(db, `settings/productOptionSets/${product.optionSetId}`));
    if (existing.exists()) {
      state.optionSets[product.optionSetId] = existing.val();
      return product.optionSetId;
    }
  }
  const groups = serializableOptionGroups(optionGroupsOf(product));
  if (!groups.length) throw new Error("Dit product heeft geen keuzes om live te koppelen.");
  const setId = push(ref(db, "settings/productOptionSets")).key;
  const now = Date.now();
  const setData = { name: `Gedeelde keuzes · ${product.title || "Product"}`, groups, createdAt: now, updatedAt: now };
  const updates = {
    [`settings/productOptionSets/${setId}`]: setData,
    [`products/${product.id}/optionSetId`]: setId,
    [`products/${product.id}/optionGroups`]: null,
    [`products/${product.id}/optionLabel`]: null,
    [`products/${product.id}/options`]: null
  };
  await update(ref(db), updates);
  state.optionSets[setId] = setData;
  return setId;
}
const optList = p => optionGroupsOf(p).flatMap(g => g.options);
const isSoldOut = p => !!p.soldOut || (p?.stockTracked === true && Number(p.stockQuantity || 0) <= 0) || optionGroupsOf(p).some(g => g.options.length > 0 && g.options.every(o => o.soldOut));
const selectionsOf = item => Array.isArray(item?.selections) ? item.selections : (item?.option ? [{ label: item.optionLabel || "Keuze", value: item.option, priceDelta: 0 }] : []);
const selectionsKey = selections => selectionsOf({ selections }).map(s => `${encodeURIComponent(s.label)}=${encodeURIComponent(s.value)}`).join("|");
const modelColorsOf = item => Array.isArray(item?.modelColors) ? item.modelColors : [];
const modelColorsKey = colors => modelColorsOf({ modelColors: colors }).map(c => `${Number(c.partIndex)||0}:${encodeURIComponent(c.partName || "deel")}:${String(c.colorHex || "").toLowerCase()}`).sort().join(",");
const itemKey = (id, selections, modelColors = []) => id + "|" + (Array.isArray(selections) ? selectionsKey(selections) : (selections || "")) + "|3d:" + modelColorsKey(modelColors);
const optText = item => {
  const choices = selectionsOf(item);
  const choiceText = choices.length ? ` · ${choices.map(s => `${safe(s.label)}: ${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(s.colorHex)}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(s.value)}</b>`).join(" · ")}` : "";
  const d = item?.dimensions;
  const dims = d ? ` · ${Number(d.length)} × ${Number(d.width)} × ${Number(d.height)} mm (L × B × H)` : "";
  const modelText = modelColorsOf(item).map(c => `3D ${safe(c.partName || "onderdeel")}: <i class="product-option-swatch inline" style="--option-color:${safe(c.colorHex || "#808080")}"></i> ${safe(c.colorName || c.colorHex || "kleur")}`).join(" · ");
  return choiceText + dims + (modelText ? ` · ${modelText}` : "");
};
const deltaText = n => Number(n) > 0 ? `+ ${money(n)}` : Number(n) < 0 ? `− ${money(Math.abs(n))}` : "Geen meerprijs";
const productImages = p => (Array.isArray(p?.images) && p.images.length ? p.images : [p?.image]).filter(Boolean).slice(0, 3);
const eligibleProductsForOrder = order => Object.fromEntries((order?.items || []).filter(item => item?.id).map(item => [String(item.id), true]));
function reviewsForProduct(productId) {
  return Object.entries(state.reviews || {}).map(([orderId, productMap]) => productMap?.[productId] ? ({ ...productMap[productId], orderId }) : null).filter(Boolean).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
function reviewStats(productId) {
  const reviews = reviewsForProduct(productId), average = reviews.length ? reviews.reduce((sum, review) => sum + Number(review.stars || 0), 0) / reviews.length : 0;
  return { reviews, average, count: reviews.length };
}
function starText(value) { const n = Math.max(0, Math.min(5, Math.round(Number(value) || 0))); return "★".repeat(n) + "☆".repeat(5 - n); }
function productRatingSummary(productId) {
  const { average, count } = reviewStats(productId);
  return count ? `<div class="product-rating-summary" aria-label="Gemiddeld ${average.toFixed(1).replace('.', ',')} uit 5 sterren"><span>${starText(average)}</span><b>${average.toFixed(1).replace('.', ',')}</b><small>${count} ${count === 1 ? "review" : "reviews"}</small></div>` : `<div class="product-rating-summary no-reviews"><span>☆☆☆☆☆</span><small>Nog geen reviews</small></div>`;
}
function productReviewsMarkup(productId) {
  const { reviews, average, count } = reviewStats(productId);
  return `<div class="product-reviews-head"><div><p class="eyebrow">ERVARINGEN VAN KLANTEN</p><h3>Reviews</h3><p class="muted">Echte ervaringen van klanten die dit product hebben besteld.</p></div>${count ? `<div class="review-overview"><strong>${average.toFixed(1).replace('.', ',')}</strong><span>${starText(average)}</span><small>${count} ${count === 1 ? "beoordeling" : "beoordelingen"}</small></div>` : `<div class="review-overview empty"><strong>Nieuw</strong><span>☆☆☆☆☆</span><small>Wees de eerste</small></div>`}</div>${count ? `<div class="product-review-list">${reviews.slice(0, 8).map(review => `<article class="product-review-card"><div class="product-review-top"><span class="review-stars">${starText(review.stars)}</span><time>${when(review.createdAt)}</time></div><h4>${safe(review.title || "Ervaring")}</h4><p>${safe(review.description || "")}</p><small class="review-author"><i data-lucide="user-round"></i> ${safe(review.username || "Klant")}</small></article>`).join("")}</div>${count > 8 ? `<p class="hint">De nieuwste 8 van ${count} reviews worden getoond.</p>` : ""}` : `<div class="review-empty-card"><span class="review-empty-icon">✦</span><b>Dit product wacht op zijn eerste review</b><small>Heb je dit product ontvangen? Deel straks jouw ervaring.</small></div>`}`;
}
function reviewActionMarkup(order, item) {
  if (order?.status !== "bezorgd" || !order.deliveredAt || !item?.id || (state.user && order.userId !== state.user.uid)) return "";
  const existing = state.reviews?.[order.id]?.[item.id];
  return existing ? `<div class="review-already"><span class="review-stars">${starText(existing.stars)}</span><small>Je review is geplaatst: <b>${safe(existing.title || "Bedankt!")}</b></small></div>` : `<button type="button" class="review-write-button" data-review-write="${safe(order.id)}" data-review-product="${safe(item.id)}"><i data-lucide="star"></i> Schrijf een review</button>`;
}
function refreshReviewActions() {
  document.querySelectorAll("[data-review-slot]").forEach(slot => {
    const orderId = slot.dataset.orderId, productId = slot.dataset.productId;
    slot.innerHTML = reviewActionMarkup({ id: orderId, userId: slot.dataset.orderUser, status: slot.dataset.orderStatus, deliveredAt: Number(slot.dataset.deliveredAt || 0) }, { id: productId });
  });
  document.querySelectorAll("[data-review-write]").forEach(button => button.onclick = () => openProductReviewForm(button.dataset.reviewWrite, button.dataset.reviewProduct));
  if (window.lucide) window.lucide.createIcons();
}
const publicTrackPayload = o => ({
  shortId: short(o.id), status: o.status || "ontvangen", fulfillmentMethod: isPickupOrder(o) ? "pickup" : "delivery", createdAt: o.createdAt || Date.now(),
  items: (o.items || []).map((i, n) => ({ title: i.title, qty: i.qty, selections: selectionsOf(i), ...(modelColorsOf(i).length ? { modelColors: modelColorsOf(i) } : {}), ...(i.dimensions ? { dimensions: i.dimensions } : {}), ...(i.customDescription ? { customDescription: i.customDescription } : {}), stages: unitStages(i), plan: Object.fromEntries(Object.entries(o.plan || {}).filter(([k]) => k.startsWith(`${n}_`))) })),
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
function setCustomer(u) { state.user = u; fails = 0; sessionStorage.setItem("novashopUser", JSON.stringify({ uid: u.uid, email: u.email, username: u.username || "", role: "customer" })); refreshNav(); attachCustomerFavorites(); }
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
  const favCount = $("#favoriteCount"); if (favCount) { favCount.textContent = state.favoriteIds.size ? String(state.favoriteIds.size) : ""; favCount.hidden = state.favoriteIds.size === 0; }
}
let favoritesUnsubscribe = null;
function readGuestFavorites() {
  try { const ids = JSON.parse(localStorage.getItem("novashopGuestFavorites") || "[]"); return new Set(Array.isArray(ids) ? ids.map(String) : []); } catch { return new Set(); }
}
function saveGuestFavorites() {
  try { localStorage.setItem("novashopGuestFavorites", JSON.stringify([...state.favoriteIds])); } catch { }
}
function attachCustomerFavorites() {
  if (favoritesUnsubscribe) { favoritesUnsubscribe(); favoritesUnsubscribe = null; }
  if (!state.user?.uid) { state.favoriteIds = readGuestFavorites(); if (state.loaded) renderProducts(); refreshNav(); return; }
  const uid = state.user.uid, favRef = ref(db, `profiles/${uid}/favorites`);
  const guest = readGuestFavorites();
  get(favRef).then(async snap => {
    if (!state.user || state.user.uid !== uid) return;
    const remote = snap.val() || {}, updates = {};
    guest.forEach(id => { if (!remote[id]) updates[id] = true; });
    if (Object.keys(updates).length) await update(favRef, updates);
    try { localStorage.removeItem("novashopGuestFavorites"); } catch { }
    favoritesUnsubscribe = onValue(favRef, favSnap => {
      if (!state.user || state.user.uid !== uid) return;
      state.favoriteIds = new Set(Object.entries(favSnap.val() || {}).filter(([, value]) => value === true).map(([id]) => id));
      if (state.loaded) renderProducts(); refreshNav();
    }, error => console.warn("Favorieten konden niet live worden geladen", error));
  }).catch(error => { console.warn("Favorieten laden mislukt", error); state.favoriteIds = guest; refreshNav(); if (state.loaded) renderProducts(); });
}
async function toggleFavorite(productId) {
  const exists = state.favoriteIds.has(productId);
  if (exists) state.favoriteIds.delete(productId); else state.favoriteIds.add(productId);
  refreshNav(); if (state.loaded) renderProducts();
  try {
    if (state.user?.uid) {
      const favRef = ref(db, `profiles/${state.user.uid}/favorites/${productId}`);
      if (exists) await remove(favRef); else await set(favRef, true);
    } else saveGuestFavorites();
    toast(exists ? "Verwijderd uit favorieten" : "Toegevoegd aan favorieten");
  } catch (error) {
    console.error(error); if (exists) state.favoriteIds.add(productId); else state.favoriteIds.delete(productId);
    refreshNav(); if (state.loaded) renderProducts(); toast("Favoriet opslaan is niet gelukt");
  }
}
function showFavorites() {
  const favorites = state.products.filter(product => state.favoriteIds.has(product.id));
  openDialog(`<p class="eyebrow">JOUW VERLANGLIJST</p><h2>Favorieten</h2><p class="muted">Bewaar producten die je later wilt bekijken of bestellen.</p><div class="favorite-list">${favorites.length ? favorites.map(product => `<div class="favorite-row"><img src="${safe(product.image || "")}" alt=""><div><b>${safe(product.title)}</b><small>${money(product.price)}</small><button type="button" class="text-button" data-fav-open="${safe(product.id)}">Bekijk product</button></div><button type="button" class="remove-item" data-fav-remove="${safe(product.id)}">Verwijderen</button></div>`).join("") : `<div class="empty-state">Je hebt nog geen favorieten opgeslagen.</div>`}</div>`);
  content.querySelectorAll("[data-fav-open]").forEach(button => button.onclick = () => showProduct(button.dataset.favOpen));
  content.querySelectorAll("[data-fav-remove]").forEach(button => button.onclick = async () => { await toggleFavorite(button.dataset.favRemove); showFavorites(); });
}
$("#favoritesBtn")?.addEventListener("click", showFavorites);

/* ---------- winkelwagen (blijft bewaard) ---------- */
try { state.cart = JSON.parse(localStorage.getItem("novashopCart") || "[]"); } catch { state.cart = []; }
function saveCart() { try { localStorage.setItem("novashopCart", JSON.stringify(state.cart)); } catch { } $("#cartCount").textContent = state.cart.reduce((n, x) => n + x.qty, 0); }
function cartIssue(c) {
  const p = state.products.find(x => x.id === c.id); if (!p) return "Niet meer beschikbaar";
  if (isSoldOut(p)) return "Uitverkocht";
  if (p.stockTracked === true && Number(p.stockQuantity || 0) < Number(c.qty || 1)) return `Niet genoeg voorraad (beschikbaar: ${Math.max(0, Number(p.stockQuantity) || 0)})`;;
  const allowedModelHexes = new Set(productColorChoices(p).map(c => c.hex.toLowerCase()));
  if (modelColorsOf(c).some(c => !allowedModelHexes.has(String(c.colorHex || "").toLowerCase()))) return "Een gekozen 3D-kleur is niet meer beschikbaar";
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
function addCart(id, selections = [], modelColors = []) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  if (isSoldOut(p)) return toast("Dit product is uitverkocht");
  const groups = optionGroupsOf(p), chosen = Array.isArray(selections) ? selections : [];
  const allowedHexes = new Set(productColorChoices(p).map(c => c.hex.toLowerCase()));
  const normalizedModelColors = modelColorsOf({ modelColors }).filter(c => allowedHexes.has(String(c.colorHex || "").toLowerCase())).map(c => ({ partIndex: Math.max(0, Number(c.partIndex) || 0), partName: String(c.partName || "Onderdeel"), colorName: String(c.colorName || "Kleur"), colorHex: String(c.colorHex).toLowerCase() }));
  if (modelColors.length && normalizedModelColors.length !== modelColors.length) return toast("Kies alleen kleuren die bij dit product zijn ingesteld");
  if (p.stockTracked === true) { const existingQty = state.cart.filter(x => x.id === id).reduce((n,x) => n + (Number(x.qty)||0), 0); if (Number(p.stockQuantity || 0) < existingQty + 1) return toast("Niet genoeg voorraad voor dit product"); }
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
  const key = itemKey(id, chosen, normalizedModelColors);
  const it = state.cart.find(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) === key);
  if (it) it.qty++;
  else state.cart.push({ id, title: p.title, basePrice: Number(p.price), price: itemPrice, selections: chosen.map(x => ({ ...x })), ...(normalizedModelColors.length ? { modelColors: normalizedModelColors } : {}), qty: 1 });
  saveCart(); toast("Toegevoegd aan je winkelwagen");
}

/* ---------- producten ---------- */
const productLoadingStartedAt = Date.now();
let productLoadTimer = null;
let pendingProductSnapshot = [];
let productSnapshotReceived = false;
let pendingProductError = false;
let optionSetSnapshotReceived = false;
function completeInitialProductLoad() {
  if (state.loaded || !productSnapshotReceived || !optionSetSnapshotReceived || productLoadTimer !== null) return;
  const remaining = Math.max(0, PRODUCT_LOADING_MIN_MS - (Date.now() - productLoadingStartedAt));
  productLoadTimer = setTimeout(() => {
    state.products = pendingProductSnapshot;
    state.productsError = pendingProductError;
    state.loaded = true;
    renderProducts();
  }, remaining);
}
onValue(ref(db, "settings/productOptionSets"), snap => {
  state.optionSets = snap.val() || {};
  optionSetSnapshotReceived = true;
  if (state.loaded) renderProducts();
  completeInitialProductLoad();
}, error => {
  console.error("Firebase shared product options could not be loaded", error);
  state.optionSets = {};
  optionSetSnapshotReceived = true;
  completeInitialProductLoad();
});
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
onValue(ref(db, "reviews"), snap => {
  state.reviews = snap.val() || {};
  if (state.loaded) renderProducts();
  const productReviewBox = $("#productReviews");
  if (productReviewBox?.dataset.productId) productReviewBox.innerHTML = productReviewsMarkup(productReviewBox.dataset.productId);
  refreshReviewActions();
}, error => console.error("Firebase reviews load failed", error));
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
        <div class="product-info"><h3>${safe(p.title)}</h3>${categoryLabel(p.categoryId) ? `<span class="product-category-chip">${safe(categoryLabel(p.categoryId))}</span>` : ""}${productRatingSummary(p.id)}<strong>${money(p.price)}</strong>${groups.length ? `<small class="product-options-hint">${groups.length} ${groups.length === 1 ? "keuze" : "keuzes"} mogelijk</small>` : ""}</div>
      </button>
      <button type="button" class="product-favorite ${state.favoriteIds.has(p.id) ? "is-favorite" : ""}" data-favorite="${safe(p.id)}" aria-label="${state.favoriteIds.has(p.id) ? "Verwijder uit favorieten" : "Voeg toe aan favorieten"}" aria-pressed="${state.favoriteIds.has(p.id)}"><i data-lucide="heart"></i></button>
      ${out ? `<button class="add-small" disabled>Uitverkocht</button>` : groups.length || p.model3d ? `<button class="add-small" data-open="${safe(p.id)}">Stel samen</button>` : `<button class="add-small" data-add="${safe(p.id)}">In winkelwagen</button>`}
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
  const favorite = e.target.closest("[data-favorite]"); if (favorite) { e.preventDefault(); e.stopPropagation(); toggleFavorite(favorite.dataset.favorite); return; }
  const add = e.target.closest("[data-add]"); if (add) return addCart(add.dataset.add);
  const open = e.target.closest("[data-open]"); if (open) showProduct(open.dataset.open);
});
function showProduct(id) {
  const p = state.products.find(x => x.id === id); if (!p) return;
  const groups = optionGroupsOf(p), images = productImages(p), out = isSoldOut(p), availableModelColors = productColorChoices(p);
  let chosen = [], step = 0, activeImage = 0, modelColors = [], modelReady = !p.model3d || !availableModelColors.length, modelViewerCleanup = null, modelViewerGeneration = 0;
  const selectedPrice = () => Number(p.price) + chosen.reduce((sum, x) => sum + (Number(x?.priceDelta) || 0), 0);
  const render = () => {
    modelViewerGeneration++;
    modelViewerCleanup?.(); modelViewerCleanup = null;
    const thisGeneration = modelViewerGeneration;
    const total = Math.max(0, selectedPrice());
    const current = groups[step];
    const currentChoice = chosen[step]?.value;
    const image = images[activeImage] || "";
    content.innerHTML = `<div class="product-detail">
      <div class="detail-gallery">
        <div class="detail-image">${image ? `<img src="${safe(image)}" alt="${safe(p.title)} afbeelding ${activeImage + 1}">` : `<i data-lucide="box"></i>`}</div>
        ${images.length > 1 ? `<div class="detail-thumbs">${images.map((src, i) => `<button class="detail-thumb ${i === activeImage ? "active" : ""}" data-image="${i}" aria-label="Afbeelding ${i + 1}"><img src="${safe(src)}" alt=""></button>`).join("")}</div>` : ""}
        ${p.model3d ? `<section class="product-model-section"><div class="product-model-heading"><div><p class="eyebrow">INTERACTIEF 3D-MODEL</p><h3>Stel jouw kleuren samen</h3></div><span class="model-viewer-badge">3D</span></div><div id="productModelViewer" class="product-model-viewer"><canvas aria-label="Draaibaar 3D-productvoorbeeld" tabindex="0"></canvas><span class="model-viewer-state" role="status">3D-model voorbereiden…</span></div><div class="model-part-color-controls"></div><p class="hint">Draai het model met je vinger of muis. Je kunt alleen kleuren kiezen die bij dit product zijn ingesteld.</p></section>` : ""}
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
              <span class="option-choice-title">${validColorHex(o.colorHex) ? `<i class="product-option-swatch" style="--option-color:${safe(o.colorHex)}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(o.name)}</b></span>
              <small>${deltaText(o.priceDelta)}${o.soldOut ? " · Uitverkocht" : ""}</small>
            </button>`;
          }).join("")}</div>
          <div class="option-wizard-actions">
            <button type="button" class="secondary" id="optionBack" ${step === 0 ? "disabled" : ""}><i data-lucide="chevron-left"></i> Vorige</button>
            ${step < groups.length - 1
              ? `<button type="button" class="primary" id="optionNext" ${!chosen[step] ? "disabled" : ""}>Volgende stap <i data-lucide="arrow-right"></i></button>`
              : `<button type="button" class="primary" id="detailAdd" ${(!chosen[step] || (p.model3d && !modelReady)) ? "disabled" : ""}><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen</button>`}
          </div>
          <div class="option-summary"><span>Prijs tot nu toe</span><b>${money(total)}</b></div>
          ${chosen.some(Boolean) ? `<div class="config-summary">${chosen.filter(Boolean).map(s => `<div class="config-summary-row"><span>${safe(s.label)}</span><b>${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(s.colorHex)}" aria-label="Kleurvoorbeeld"></i>` : ""}${safe(s.value)} · ${deltaText(s.priceDelta)}</b></div>`).join("")}</div>` : ""}
        </div>` : ""}
        ${!groups.length && !out ? `<button class="primary full" id="detailAdd" ${p.model3d && !modelReady ? "disabled" : ""}><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen · ${money(p.price)}</button>` : ""}
        ${groups.length && !out && step === groups.length - 1 && chosen.every(Boolean) ? `<p class="hint">Je hebt alle ${groups.length} keuzes gemaakt. De prijs hierboven is inclusief alle toeslagen en kortingen.</p>` : ""}
        ${out ? `<button class="primary full" disabled>Momenteel niet beschikbaar</button>` : ""}
      </div>
    </div>
    <section class="product-reviews" id="productReviews" data-product-id="${safe(p.id)}">${productReviewsMarkup(p.id)}</section>`;
    if (p.model3d) {
      const viewerRoot = $("#productModelViewer");
      mountProductModelViewer(viewerRoot, p.model3d, availableModelColors, modelColors, colors => {
        if (thisGeneration === modelViewerGeneration) {
          modelColors = colors;
          modelReady = true;
          const addButton = $("#detailAdd");
          if (addButton && (!groups.length || chosen.length === groups.length)) addButton.disabled = false;
        }
      }).then(cleanupViewer => {
        if (thisGeneration === modelViewerGeneration && viewerRoot?.isConnected) modelViewerCleanup = cleanupViewer;
        else cleanupViewer?.();
      });
    }
    content.querySelectorAll("[data-image]").forEach(b => b.onclick = () => { activeImage = Number(b.dataset.image); render(); });
    content.querySelectorAll("[data-choice]").forEach(b => b.onclick = () => {
      const option = current.options[Number(b.dataset.choice)];
      chosen[step] = { label: current.label, value: option.name, priceDelta: Number(option.priceDelta) || 0, ...(validColorHex(option.colorHex) ? { colorHex: option.colorHex } : {}) };
      chosen = chosen.slice(0, step + 1); render();
    });
    $("#optionBack")?.addEventListener("click", () => { step = Math.max(0, step - 1); render(); });
    $("#optionNext")?.addEventListener("click", () => { if (!chosen[step]) return; step = Math.min(groups.length - 1, step + 1); render(); });
    $("#detailAdd")?.addEventListener("click", () => {
      if (groups.length && chosen.length !== groups.length) return toast("Maak eerst alle keuzes af");
      addCart(id, chosen, modelColors); closeDialog();
    });
  };
  openDialog(`<div class="loading">Product laden…</div>`);
  unsubs.push(() => { modelViewerGeneration++; modelViewerCleanup?.(); modelViewerCleanup = null; });
  render();
}

/* ---------- winkelwagen-dialoog ---------- */
$("#cartBtn").onclick = showCart;
function showCart() {
  const sub = state.cart.reduce((n, x) => n + x.price * x.qty, 0);
  openDialog(`<p class="eyebrow">JOUW SELECTIE</p><h2>Winkelwagen</h2>${state.cart.length ? `<div class="cart-lines">${state.cart.map(x => { const k = safe(itemKey(x.id, selectionsOf(x), modelColorsOf(x))), issue = state.loaded ? cartIssue(x) : "", choices = selectionsOf(x); return `<div class="cart-line"><div class="cart-line-info"><b>${safe(x.title)}</b>${choices.map(s => `<small>${safe(s.label)}: <b>${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(s.colorHex)}" aria-label="Kleurvoorbeeld"></i>` : ""}${safe(s.value)}</b> <span class="muted">(${deltaText(s.priceDelta)})</span></small>`).join("")}${modelColorsOf(x).map(c => `<small>3D ${safe(c.partName || "onderdeel")}: <i class="product-option-swatch inline" style="--option-color:${safe(c.colorHex || "#808080")}"></i> ${safe(c.colorName || c.colorHex || "kleur")}</small>`).join("")}<small>${money(x.price)} per stuk</small>${issue ? `<small class="line-issue">${safe(issue)}</small>` : ""}<div class="quantity-control"><button type="button" aria-label="Minder" data-qty="${k}" data-delta="-1">−</button><span>${x.qty}</span><button type="button" aria-label="Meer" data-qty="${k}" data-delta="1">＋</button></div></div><div class="cart-line-actions"><b>${money(x.price * x.qty)}</b><button class="remove-item" data-remove="${k}">Verwijder</button></div></div>`; }).join("")}</div><div class="cart-sum"><div><span>Subtotaal</span><span>${money(sub)}</span></div><div><span>Verzendkosten</span><span>${money(SHIPPING)} bij verzenden · ophalen gratis</span></div></div><div class="cart-total"><span>Producttotaal</span><b>${money(sub)}</b></div><div class="stack note-field"><label>Opmerking bij je bestelling (optioneel)<textarea id="orderNote" rows="3" maxlength="500" placeholder="Bijv. gewenste afwerking of een wens voor de kleur">${safe(state.orderNote)}</textarea></label></div><button class="primary full" id="checkout">Verder naar bestellen</button>` : `<div class="empty-state">Je winkelwagen is nog leeg.</div><button class="secondary full" id="continue">Verder winkelen</button>`}`);
  content.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { state.cart = state.cart.filter(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) !== b.dataset.remove); saveCart(); showCart(); });
  content.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => {
    const it = state.cart.find(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) === b.dataset.qty); if (!it) return;
    const nextQty = it.qty + Number(b.dataset.delta), product = state.products.find(x => x.id === it.id);
    if (nextQty > it.qty && product?.stockTracked === true && state.cart.filter(x => x.id === it.id).reduce((n, x) => n + Number(x.qty || 0), 0) + 1 > Number(product.stockQuantity || 0)) return toast("Niet genoeg voorraad voor extra stuks.");
    it.qty = nextQty; if (it.qty <= 0) state.cart = state.cart.filter(x => x !== it);
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
function logoutCustomer() { if (favoritesUnsubscribe) { favoritesUnsubscribe(); favoritesUnsubscribe = null; } state.user = null; sessionStorage.removeItem("novashopUser"); state.favoriteIds = readGuestFavorites(); refreshNav(); if (state.loaded) renderProducts(); closeDialog(); toast("Je bent uitgelogd"); }
function logoutAdmin() { state.admin = false; sessionStorage.removeItem("novashopAdmin"); refreshNav(); closeDialog(); toast("Je bent uitgelogd bij Sitebeheer"); }

/* ---------- voorraad reserveren bij bestelling ---------- */
async function reserveInventory(items) {
  const quantities = new Map();
  (items || []).forEach(item => quantities.set(String(item.id), (quantities.get(String(item.id)) || 0) + Math.max(1, Number(item.qty) || 1)));
  const reservations = [];
  try {
    for (const [productId, qty] of quantities) {
      const productSnap = await get(ref(db, `products/${productId}`));
      const product = productSnap.val();
      if (!product || product.stockTracked !== true) continue;
      const stockRef = ref(db, `products/${productId}/stockQuantity`);
      const tx = await runTransaction(stockRef, current => {
        const available = Number(current);
        if (!Number.isFinite(available) || available < qty) return;
        return available - qty;
      }, { applyLocally: false });
      if (!tx.committed) throw new Error(`Onvoldoende voorraad voor ${product.title || "een product"}.`);
      reservations.push({ productId, qty });
    }
    return reservations;
  } catch (error) {
    await releaseInventory(reservations);
    throw error;
  }
}
async function releaseInventory(reservations) {
  for (const reservation of reservations || []) {
    try {
      await runTransaction(ref(db, `products/${reservation.productId}/stockQuantity`), current => (Number.isFinite(Number(current)) ? Number(current) : 0) + reservation.qty, { applyLocally: false });
    } catch (error) { console.error("Voorraadreservering kon niet worden teruggedraaid", error); }
  }
}

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
    let stockReservations = [];
    try {
      const items = state.cart.map(c => { const product = state.products.find(x => x.id === c.id); const selected = selectionsOf(c); const delta = selected.reduce((sum, choice) => { const group = optionGroupsOf(product).find(g => g.label === choice.label), option = group?.options.find(o => o.name === choice.value); return sum + (Number(option?.priceDelta) || 0); }, 0); return { id: c.id, title: product.title, price: Math.max(0, Number(product.price) + delta), qty: c.qty, ...(selected.length ? { selections: selected } : {}), ...(modelColorsOf(c).length ? { modelColors: modelColorsOf(c).map(color => ({ ...color })) } : {}) }; });
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0), shipping = pickup ? 0 : SHIPPING, total = subtotal + shipping;
      stockReservations = await reserveInventory(items);
      const orderId = push(ref(db, "orders")).key, now = Date.now(), publicToken = randomToken();
      const order = { userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, items, reviewEligibleProducts: eligibleProductsForOrder({ items }), subtotal, shipping, total, address, fulfillmentMethod: pickup ? "pickup" : "delivery", paymentMethod: "tikkie", paymentStatus: "awaiting_tikkie", status: STATUSES[0], createdAt: now, publicToken, ...(String(data.get("note") || "").trim() ? { note: String(data.get("note") || "").trim().slice(0, 500) } : {}) };
      await update(ref(db), { [`orders/${orderId}`]: order, [`publicTrack/${publicToken}`]: publicTrackPayload({ ...order, id: orderId }) });
      stockReservations = [];
      state.cart = []; state.orderNote = ""; saveCart();
      openDialog(`<p class="eyebrow">BESTELLING AANGEMAAKT</p><h2>Wachten op betaalverzoek</h2><p>Je bestelling <b>#${short(orderId)}</b> is aangemaakt. Zodra de beheerder de betaallink toevoegt, verschijnt die hier bij <b>Mijn bestellingen</b>.</p><p class="muted">Totaal: <b>${money(total)}</b>. Je hoeft nu nog niets te betalen.</p><button class="primary full" id="toMyOrders">Bekijk mijn bestellingen</button>`);
      $("#toMyOrders").onclick = showMyOrders;
    } catch (err) { console.error(err); if (stockReservations.length) await releaseInventory(stockReservations); toast(err.message || "Bestelling aanmaken is niet gelukt. Probeer het opnieuw."); payBtn.disabled = false; sync(); }
  };
}
async function placeChatOrder() {
  if (!state.cart.length || !state.user) return;
  if (!state.loaded) return toast("Producten worden nog geladen.");
  const bad = state.cart.filter(c => cartIssue(c)); if (bad.length) return toast("Controleer je winkelwagen: een product/optie is niet meer beschikbaar.");
  const items = state.cart.map(c => { const p = state.products.find(x => x.id === c.id); const selected = selectionsOf(c); const delta = selected.reduce((sum, s) => { const group = optionGroupsOf(p).find(g => g.label === s.label), option = group?.options.find(o => o.name === s.value); return sum + (Number(option?.priceDelta) || 0); }, 0); return { id: c.id, title: p.title, price: Math.max(0, Number(p.price) + delta), qty: c.qty, ...(selected.length ? { selections: selected } : {}), ...(modelColorsOf(c).length ? { modelColors: modelColorsOf(c).map(color => ({ ...color })) } : {}) }; });
  const subtotal = items.reduce((n, i) => n + i.price * i.qty, 0), total = subtotal, note = (state.orderNote || "").trim().slice(0, 500);
  const orderKey = push(ref(db, "orders")).key, chatKey = push(ref(db, "chats")).key, msgKey = push(ref(db, `chats/${chatKey}/messages`)).key, now = Date.now(), publicToken = randomToken();
  const newOrder = { userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, items, reviewEligibleProducts: eligibleProductsForOrder({ items }), subtotal, shipping: 0, total, fulfillmentMethod: "pickup", address: null, paymentMethod: "chat", paymentStatus: "not_required", status: STATUSES[0], createdAt: now, chatId: chatKey, publicToken, ...(note ? { note } : {}) };
  let stockReservations = [];
  try {
    stockReservations = await reserveInventory(items);
    await update(ref(db), { ["orders/" + orderKey]: newOrder, ["publicTrack/" + publicToken]: publicTrackPayload({ ...newOrder, id: orderKey }), ["chats/" + chatKey]: { orderId: orderKey, userId: state.user.uid, username: state.user.username || "Klant", email: state.user.email, createdAt: now, lastMessage: "Bestelling · ophalen", lastMessageAt: now, messages: { [msgKey]: { sender: "system", text: `Je bestelling is aangemaakt met afhalen als afhandeling. Producttotaal: ${money(total)}. Er zijn geen verzendkosten toegevoegd. We bespreken de verdere afspraken hier in de chat.`, createdAt: now } } } });
    stockReservations = [];
    state.cart = []; state.orderNote = ""; saveCart(); toast("Chatbestelling aangemaakt"); openChat(chatKey);
  } catch (e) { console.error(e); if (stockReservations.length) await releaseInventory(stockReservations); toast(e.message || "Chatbestelling starten lukte niet."); }
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
    $("#ordersBox").innerHTML = orders.length ? orders.map(o => `<div class="order-row"><div><b>Bestelling #${short(o.id)}</b><small>${when(o.createdAt)} · ${money(o.total)} · ${fulfillmentLabel(o)} · betaling: ${safe(o.paymentStatus === "awaiting_tikkie" ? "Wachten op betaalverzoek" : o.paymentStatus === "tikkie_link_added" ? "Betaallink beschikbaar" : o.paymentStatus || "niet geregistreerd")}</small>${o.address ? `<p class="order-note"><b>Verzendadres:</b> ${safe([o.address.firstName, o.address.lastName].filter(Boolean).join(" "))}, ${safe(o.address.street || "")} ${safe(o.address.houseNumber || "")}, ${safe(o.address.postcode || "")} ${safe(o.address.city || "")}</p>` : ""}<span class="status-pill">${safe(statusLabel(o))}</span>${o.paymentMethod === "tikkie" ? (o.tikkieLink ? `<p class="order-note"><b>Betaal via betaalverzoek:</b> <a href="${safe(o.tikkieLink)}" target="_blank" rel="noopener noreferrer">Open jouw betaalverzoek</a></p>` : `<p class="order-note">De betaallink wordt nog door de webshopbeheerder toegevoegd.</p>`) : ""}${o.deliveredAt ? `<p class="order-note">${isPickupOrder(o) ? "Opgehaald" : "Afgeleverd"} op ${when(o.deliveredAt)}. ${o.returnRequestAt ? `Retour aangevraagd op ${when(o.returnRequestAt)}. Status: ${o.returnStatus === "handled" ? "afgehandeld" : "in behandeling"}.` : Date.now() < returnDeadline(o) ? `Retour aanvragen kan tot ${when(returnDeadline(o))}.` : "De retourtermijn van 14 dagen is verstreken."}</p>` : ""}${o.status === "bezorgd" && o.deliveredAt ? `<div class="order-review-list"><b>Deel je ervaring</b>${(o.items || []).map(item => `<div class="order-review-item"><span>${safe(item.title)}</span><div class="review-action-slot" data-review-slot data-order-id="${safe(o.id)}" data-order-user="${safe(o.userId || "")}" data-product-id="${safe(item.id || "")}" data-order-status="${safe(o.status)}" data-delivered-at="${Number(o.deliveredAt) || 0}">${reviewActionMarkup(o, item)}</div></div>`).join("")}</div>` : ""}</div><div class="order-actions"><button class="secondary" data-track="${safe(o.id)}">Volgen</button><button class="secondary" data-share="${safe(o.id)}"><i data-lucide="share-2"></i> Deellink</button>${returnWindowOpen(o) ? `<button class="primary" data-return="${safe(o.id)}">Retour aanvragen</button>` : ""}</div></div>`).join("") : "<p class='muted'>Je hebt nog geen bestellingen.</p>";
    // Legacy bestellingen die al als bezorgd staan krijgen een eenmalige productlijst voor reviewcontrole.
    orders.filter(o => o.status === "bezorgd" && !o.reviewEligibleProducts && o.userId === state.user.uid).forEach(o => update(ref(db, `orders/${o.id}/reviewEligibleProducts`), eligibleProductsForOrder(o)).catch(err => console.warn("Review-geschiktheid kon niet worden bijgewerkt", err)));
    refreshReviewActions();
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
async function openProductReviewForm(orderId, productId) {
  if (!state.user) return authForm("login");
  try {
    const [orderSnap, reviewSnap] = await Promise.all([get(ref(db, `orders/${orderId}`)), get(ref(db, `reviews/${orderId}/${productId}`))]);
    const order = orderSnap.val();
    if (!order || order.userId !== state.user.uid || order.status !== "bezorgd" || !order.deliveredAt || !(order.items || []).some(item => String(item.id) === String(productId))) return toast("Je kunt alleen een review plaatsen voor een product uit een bezorgde bestelling.");
    const item = (order.items || []).find(entry => String(entry.id) === String(productId));
    if (reviewSnap.exists()) {
      const existing = reviewSnap.val();
      openDialog(`<div class="review-thanks"><div class="review-thanks-icon">✓</div><p class="eyebrow">BEDANKT VOOR JE REVIEW</p><h2>${safe(existing.title || "Jouw beoordeling")}</h2><div class="review-stars big">${starText(existing.stars)}</div><p>${safe(existing.description || "")}</p><small class="muted">Je hebt dit product al beoordeeld.</small><button class="primary full" id="reviewBack">Terug naar mijn bestellingen</button></div>`);
      $("#reviewBack").onclick = showMyOrders;
      return;
    }
    openDialog(`<div class="review-form-head"><p class="eyebrow">JOUW ERVARING TELT</p><h2>Beoordeel ${safe(item.title)}</h2><p class="muted">Je bestelling is ${isPickupOrder(order) ? "opgehaald" : "bezorgd"}. Deel je eerlijke ervaring met andere klanten.</p></div><form id="productReviewForm" class="stack product-review-form"><fieldset class="review-star-picker"><legend>Hoeveel sterren geef je?</legend><div class="review-star-options">${[5,4,3,2,1].map(n => `<input type="radio" id="reviewStars${n}" name="stars" value="${n}" required><label for="reviewStars${n}" title="${n} ${n === 1 ? "ster" : "sterren"}" aria-label="${n} ${n === 1 ? "ster" : "sterren"}">★</label>`).join("")}</div></fieldset><label>Titel van je review<input name="title" required maxlength="80" placeholder="Bijv. Precies wat ik zocht!"></label><label>Beschrijving<textarea name="description" required rows="5" maxlength="900" placeholder="Wat vind je van de kwaliteit, afwerking en het product?"></textarea><small class="hint">Maximaal 900 tekens. Houd je review vriendelijk en eerlijk.</small></label><button class="primary full" type="submit">Review plaatsen</button></form>`);
    $("#productReviewForm").onsubmit = async e => {
      e.preventDefault(); const form = e.currentTarget, data = new FormData(form), stars = Number(data.get("stars")), title = String(data.get("title") || "").trim(), description = String(data.get("description") || "").trim(), submit = form.querySelector("button[type=submit]");
      if (!Number.isInteger(stars) || stars < 1 || stars > 5 || !title || !description) return toast("Vul sterren, een titel en een beschrijving in.");
      submit.disabled = true; submit.textContent = "Review plaatsen…";
      try {
        // Controleer de bestelling nogmaals vlak voor het opslaan.
        const latest = (await get(ref(db, `orders/${orderId}`))).val();
        if (!latest || latest.userId !== state.user.uid || latest.status !== "bezorgd" || !latest.deliveredAt || !(latest.items || []).some(entry => String(entry.id) === String(productId))) throw new Error("Deze bestelling voldoet niet meer aan de voorwaarden voor een review.");
        if (latest.reviewEligibleProducts?.[productId] !== true) {
          await update(ref(db, `orders/${orderId}/reviewEligibleProducts`), { ...eligibleProductsForOrder(latest) });
        }
        const existing = await get(ref(db, `reviews/${orderId}/${productId}`));
        if (existing.exists()) throw new Error("Je hebt dit product voor deze bestelling al beoordeeld.");
        const review = { userId: state.user.uid, username: state.user.username || "Klant", orderId, productId, productTitle: item.title, stars, title: title.slice(0, 80), description: description.slice(0, 900), createdAt: Date.now() };
        await set(ref(db, `reviews/${orderId}/${productId}`), review);
        toast("Bedankt! Je review is geplaatst."); showMyOrders();
      } catch (err) { console.error("Review plaatsen mislukt", err); toast(err.message || "Review plaatsen mislukt. Probeer het opnieuw."); submit.disabled = false; submit.textContent = "Review plaatsen"; }
    };
  } catch (err) { console.error(err); toast(err.message || "Reviewformulier openen mislukt."); }
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
        const selectionText = (item.selections || []).map(s => `${safe(s.label)}: ${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(s.colorHex)}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(s.value)}</b>`).join(" · ");
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
async function shrinkChatImage(file) {
  if (!file || !String(file.type || "").startsWith("image/")) throw new Error("Kies een geldig afbeeldingsbestand.");
  if (file.size > 12 * 1024 * 1024) throw new Error("Kies een foto kleiner dan 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    // Foto's worden in de browser verkleind en als JPEG opgeslagen; canvas verwijdert ook EXIF-metadata.
    for (const maxSide of [760, 640, 560, 480, 400]) {
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.76, 0.66, 0.56, 0.46, 0.38]) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (dataUrl.length <= 88000) return dataUrl;
      }
    }
  } finally { bitmap.close?.(); }
  throw new Error("Deze foto kan niet klein genoeg worden gemaakt. Kies een andere of kleinere foto.");
}
function chatMessageMarkup(message) {
  const imageData = String(message.imageData || "");
  const image = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(imageData) && imageData.length <= 88000
    ? `<a class="chat-image-link" href="${imageData}" target="_blank" rel="noopener noreferrer" aria-label="Foto openen"><img class="chat-image" src="${imageData}" alt="${safe(message.imageName || "Foto in chat")}" loading="lazy"></a>` : "";
  const text = message.text ? `<p>${formatChatText(message.text)}</p>` : "";
  return `${image}${text}<small>${message.sender === "admin" ? "3D Printed Shop" : message.sender === "system" ? "Systeem" : "Jij"} · ${when(message.createdAt)}${image ? " · Foto" : ""}</small>`;
}
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
    openDialog(`<div class="chat-shell"><div class="chat-heading"><div class="chat-title-wrap"><p class="eyebrow">3D PRINTED SHOP KLANTENSERVICE</p><h2>${isQuoteChat ? `Offerte · ${safe(c.quoteTitle || "Eigen product")}` : `Bestelling #${short(c.orderId)}`}</h2><small class="chat-subtitle">${safe(c.username || "Gesprek met 3D Printed Shop")}</small></div>${c.orderId ? `<button class="secondary" id="chatTrack">Bestelling volgen</button>` : `<span class="status-pill">Offertegesprek</span>`}</div><div class="chat-notice">${isQuoteChat ? (c.orderId ? `Deze offerte is omgezet naar bestelling #${short(c.orderId)}. Bespreek hier eventuele vragen over je bestelling.` : "Bespreek hier de mogelijkheden en details van je maatwerkproduct.") : "Deel hier je vraag, een link of een foto. Foto's worden automatisch sterk verkleind voordat ze worden opgeslagen."}</div><div id="messages" class="messages" aria-live="polite"></div><div id="chatImagePending" class="chat-image-pending" hidden></div><form id="sendMessage" class="send-message"><label for="chatImageInput" class="chat-attach-button" title="Foto toevoegen" aria-label="Foto toevoegen"><i data-lucide="paperclip"></i></label><input id="chatImageInput" type="file" accept="image/*" hidden><input id="messageText" placeholder="Typ je bericht…" maxlength="1000" autocomplete="off"><button class="primary">Verstuur</button></form><small class="chat-upload-hint">Maximaal 12 MB origineel · automatisch verkleind tot ongeveer 65 KB.</small></div>`);
    if (window.lucide) window.lucide.createIcons();
    if (c.orderId) $("#chatTrack").onclick = () => showOrderTracking(c.orderId, asAdmin);
    const chatForm = $("#sendMessage"), messageInput = $("#messageText"), imageInput = $("#chatImageInput"), pendingImage = $("#chatImagePending");
    let pendingObjectUrl = "";
    imageInput.onchange = () => {
      const file = imageInput.files?.[0];
      if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl);
      pendingObjectUrl = "";
      if (!file) { pendingImage.hidden = true; pendingImage.innerHTML = ""; return; }
      if (!String(file.type || "").startsWith("image/")) { imageInput.value = ""; pendingImage.hidden = true; return toast("Kies een afbeeldingsbestand."); }
      if (file.size > 12 * 1024 * 1024) { imageInput.value = ""; pendingImage.hidden = true; return toast("Kies een foto kleiner dan 12 MB."); }
      pendingObjectUrl = URL.createObjectURL(file);
      pendingImage.hidden = false;
      pendingImage.innerHTML = `<img src="${pendingObjectUrl}" alt="Voorbeeld van toegevoegde foto"><div><b>${safe(file.name || "Foto")}</b><small>Wordt sterk verkleind bij verzenden</small></div><button type="button" class="remove-item" id="removeChatImage" aria-label="Foto verwijderen">×</button>`;
      $("#removeChatImage").onclick = () => { if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl); pendingObjectUrl = ""; imageInput.value = ""; pendingImage.hidden = true; pendingImage.innerHTML = ""; };
    };
    chatForm.onsubmit = async e => {
      e.preventDefault(); const text = messageInput.value.trim(), file = imageInput.files?.[0]; if (!text && !file) return;
      const submit = chatForm.querySelector("button.primary"), now = Date.now(); submit.disabled = true;
      try {
        let imageData = "";
        if (file) { submit.textContent = "Foto verkleinen…"; imageData = await shrinkChatImage(file); }
        const messageId = push(ref(db, `chats/${id}/messages`)).key;
        const message = { sender: asAdmin ? "admin" : "user", uid: asAdmin ? "admin" : state.user.uid, ...(text ? { text } : {}), ...(imageData ? { imageData, imageName: String(file.name || "foto").slice(0, 100), imageType: "image/jpeg" } : {}), createdAt: now };
        const lastMessage = text || (imageData ? "📷 Foto verstuurd" : "Nieuw bericht");
        await update(ref(db), { [`chats/${id}/messages/${messageId}`]: message, [`chats/${id}/lastMessage`]: lastMessage, [`chats/${id}/lastMessageAt`]: now });
        messageInput.value = ""; imageInput.value = "";
        if (pendingObjectUrl) URL.revokeObjectURL(pendingObjectUrl); pendingObjectUrl = ""; pendingImage.hidden = true; pendingImage.innerHTML = "";
        submit.textContent = "Verstuur"; messageInput.focus();
      } catch (err) { console.error(err); toast(err.message || "Bericht of foto verzenden mislukt."); }
      finally { submit.disabled = false; submit.textContent = "Verstuur"; }
    };
    listen(ref(db, `chats/${id}/messages`), snap => {
      const box = $("#messages"); if (!box) return;
      const msgs = toList(snap).sort((a, b) => a.createdAt - b.createdAt);
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 70 || !box.children.length;
      box.innerHTML = msgs.map(m => `<div class="message ${m.sender === "admin" ? "theirs" : m.sender === "system" ? "system" : "mine"}">${chatMessageMarkup(m)}</div>`).join("");
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
function dashboardTab(target) {
  let orders = [], products = [];
  const draw = () => {
    if (!target.isConnected) return;
    const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const received = orders.filter(order => order.paymentStatus === "paid").reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const openOrders = orders.filter(order => order.status !== "bezorgd").length;
    const lowStock = products.filter(product => product.stockTracked === true && Number(product.stockQuantity || 0) <= Number(product.lowStockThreshold ?? 3));
    const daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index));
      const next = new Date(date); next.setDate(next.getDate() + 1);
      const value = orders.filter(order => Number(order.createdAt) >= date.getTime() && Number(order.createdAt) < next.getTime()).reduce((sum, order) => sum + (Number(order.total) || 0), 0);
      return { label: date.toLocaleDateString("nl-NL", { weekday: "short" }), value };
    });
    const maxDaily = Math.max(1, ...daily.map(day => day.value));
    const topProducts = new Map();
    orders.forEach(order => (order.items || []).forEach(item => {
      const current = topProducts.get(item.id) || { title: item.title || "Product", quantity: 0, revenue: 0 };
      current.quantity += Number(item.qty) || 1; current.revenue += (Number(item.price) || 0) * (Number(item.qty) || 1); topProducts.set(item.id || item.title, current);
    }));
    const topList = [...topProducts.values()].sort((a,b) => b.quantity - a.quantity).slice(0, 5);
    target.innerHTML = `<div class="dashboard-welcome"><div><p class="eyebrow">OVERZICHT · 3D PRINTED SHOP</p><h3>Jouw webshop in één oogopslag</h3><p class="muted">Live overzicht van bestellingen, omzet en voorraad.</p></div><span class="dashboard-live"><i></i> Live gegevens</span></div>
      <div class="dashboard-kpis">
        <article class="dashboard-kpi"><span>Totale bestelwaarde</span><strong>${money(totalRevenue)}</strong><small>Alle geregistreerde bestellingen</small></article>
        <article class="dashboard-kpi"><span>Ontvangen betalingen</span><strong>${money(received)}</strong><small>Als betaald of niet van toepassing gemarkeerd</small></article>
        <article class="dashboard-kpi"><span>Bestellingen open</span><strong>${openOrders}</strong><small>Wachten nog op afronding</small></article>
        <article class="dashboard-kpi ${lowStock.length ? "warning" : ""}"><span>Lage voorraad</span><strong>${lowStock.length}</strong><small>${lowStock.length ? "Producten vragen aandacht" : "Geen voorraadwaarschuwingen"}</small></article>
      </div>
      <div class="dashboard-grid"><section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Bestelwaarde · afgelopen 7 dagen</h3><p class="muted">Op basis van de besteldatum</p></div><span class="dashboard-total">${money(daily.reduce((sum,d)=>sum+d.value,0))}</span></div><div class="dashboard-bars">${daily.map(day => `<div class="dashboard-bar-col"><strong>${day.value ? money(day.value) : "—"}</strong><div class="dashboard-bar-track"><i style="height:${Math.max(day.value ? 8 : 2, day.value / maxDaily * 100)}%"></i></div><small>${day.label}</small></div>`).join("")}</div></section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Meest verkochte producten</h3><p class="muted">Op basis van aantal bestelde stuks</p></div></div>${topList.length ? `<div class="dashboard-top-list">${topList.map((item,index)=>`<div><span class="dashboard-rank">${index+1}</span><span class="dashboard-product-name">${safe(item.title)}</span><b>${item.quantity}×</b></div>`).join("")}</div>` : `<p class="muted">Er zijn nog geen productverkopen geregistreerd.</p>`}</section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Voorraadmeldingen</h3><p class="muted">Producten op of onder hun ingestelde minimum</p></div><button type="button" class="secondary" id="dashboardStockLink">Voorraad beheren</button></div>${lowStock.length ? `<div class="dashboard-top-list">${lowStock.slice(0,6).map(product=>`<div><span class="stock-alert-dot"></span><span class="dashboard-product-name">${safe(product.title)}</span><b>${Math.max(0,Number(product.stockQuantity)||0)} over</b></div>`).join("")}</div>` : `<p class="muted">Alle bijgehouden voorraden zijn op peil.</p>`}</section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Recente bestellingen</h3><p class="muted">De vijf nieuwste aanvragen</p></div><button type="button" class="secondary" id="dashboardOrdersLink">Bestellingen bekijken</button></div>${orders.length ? `<div class="dashboard-top-list">${[...orders].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,5).map(order=>`<div><span class="dashboard-order-dot"></span><span class="dashboard-product-name">${safe(order.username||"Klant")} · #${short(order.id)}</span><b>${money(order.total)}</b></div>`).join("")}</div>` : `<p class="muted">Nog geen bestellingen.</p>`}</section></div>`;
    $("#dashboardStockLink")?.addEventListener("click", () => { state.tab = "inventory"; adminTab(); });
    $("#dashboardOrdersLink")?.addEventListener("click", () => { state.tab = "orders"; adminTab(); });
  };
  listen(ref(db, "orders"), snap => { orders = toList(snap); draw(); });
  listen(ref(db, "products"), snap => { products = toList(snap); draw(); });
}
function inventoryTab(target) {
  let products = [];
  const draw = () => {
    if (!target.isConnected) return;
    const tracked = products.filter(product => product.stockTracked === true);
    const low = tracked.filter(product => Number(product.stockQuantity || 0) <= Number(product.lowStockThreshold ?? 3));
    target.innerHTML = `<div class="admin-toolbar"><div><h3>Voorraadbeheer</h3><p class="muted">Houd aantallen bij. Bij nul voorraad wordt het product automatisch niet bestelbaar.</p></div><span class="status-pill">${low.length} waarschuwingen</span></div>
      <div class="inventory-summary"><div><small>Voorraad bijgehouden</small><b>${tracked.length}</b></div><div><small>Lage voorraad</small><b>${low.length}</b></div><div><small>Producten totaal</small><b>${products.length}</b></div></div>
      <div class="inventory-list">${products.length ? products.map(product => {
        const enabled = product.stockTracked === true, quantity = Math.max(0, Number(product.stockQuantity) || 0), threshold = Math.max(0, Number(product.lowStockThreshold ?? 3) || 0), isLow = enabled && quantity <= threshold;
        return `<form class="inventory-row ${isLow ? "is-low" : ""}" data-inventory-form="${safe(product.id)}"><div class="inventory-product"><img src="${safe(product.image || "")}" alt=""><div><b>${safe(product.title)}</b><small>${enabled ? (isLow ? "Voorraad bijna op" : "Voorraad wordt bijgehouden") : "Geen voorraadlimiet ingesteld"}</small></div></div><label class="inventory-track"><input type="checkbox" name="tracked" ${enabled ? "checked" : ""}> Voorraad bijhouden</label><label>Voorraad<input name="quantity" type="number" min="0" max="100000" step="1" value="${quantity}" ${enabled ? "" : "disabled"}></label><label>Waarschuw bij<input name="threshold" type="number" min="0" max="100000" step="1" value="${threshold}" ${enabled ? "" : "disabled"}></label><button type="submit" class="primary">Opslaan</button></form>`;
      }).join("") : `<p class="empty-state">Er zijn nog geen producten.</p>`}</div>`;
    target.querySelectorAll("[data-inventory-form]").forEach(form => {
      const trackedInput = form.elements.tracked, quantityInput = form.elements.quantity, thresholdInput = form.elements.threshold;
      trackedInput.onchange = () => { quantityInput.disabled = !trackedInput.checked; thresholdInput.disabled = !trackedInput.checked; };
      form.onsubmit = async event => {
        event.preventDefault(); const id = form.dataset.inventoryForm;
        const quantity = Number(quantityInput.value), threshold = Number(thresholdInput.value);
        if (trackedInput.checked && (!Number.isInteger(quantity) || quantity < 0 || !Number.isInteger(threshold) || threshold < 0)) return toast("Vul hele, positieve voorraadgetallen in.");
        const button = form.querySelector("button[type=submit]"); button.disabled = true; button.textContent = "Opslaan…";
        try { await update(ref(db, `products/${id}`), { stockTracked: trackedInput.checked, stockQuantity: trackedInput.checked ? quantity : null, lowStockThreshold: trackedInput.checked ? threshold : null, stockUpdatedAt: Date.now() }); toast("Voorraad bijgewerkt"); }
        catch (error) { console.error(error); toast("Voorraad opslaan mislukt. Controleer de Firebase-regels."); }
        finally { button.disabled = false; button.textContent = "Opslaan"; }
      };
    });
  };
  listen(ref(db, "products"), snap => { products = toList(snap).sort((a,b)=>String(a.title).localeCompare(String(b.title),"nl")); draw(); });
}

function adminPanel() {
  if (!state.admin) return openAdminLogin();
  openDialog(`<div class="admin-head"><div><p class="eyebrow">3D PRINTED SHOP</p><h2>Sitebeheer</h2></div><span class="admin-label">BEHEERDER</span></div><div class="tabs admin-tabs"><button data-tab="dashboard">Dashboard</button><button data-tab="products">Producten</button><button data-tab="inventory">Voorraad</button><button data-tab="categories">Categorieën</button><button data-tab="orders">Track & trace</button><button data-tab="myorders">Mijn bestellingen</button><button data-tab="history">Bestellingen</button><button data-tab="agenda">Agenda</button><button data-tab="chats">Chats</button><button data-tab="quotes">Offertes</button><button data-tab="camera">Camera</button><button data-tab="contact">Contactpagina</button><button id="adminLogout">Uitloggen</button></div><div id="adminContent"></div>`);
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
      const order = { userId: q.userId, username: q.username || "Klant", email: q.email || "", items: [{ id: `maatwerk-${quoteId}`, title: q.title, price, qty: 1, selections: [{ label: "Kleur", value: q.colorName || "Niet opgegeven" }], dimensions: q.dimensions, customDescription: q.description, quoteId }], reviewEligibleProducts: { [`maatwerk-${quoteId}`]: true }, subtotal: price, shipping, total, address, fulfillmentMethod: method, paymentMethod: "tikkie", paymentStatus: "awaiting_tikkie", status: STATUSES[0], createdAt: now, publicToken, chatId: q.chatId, customQuoteId: quoteId, note: `Maatwerkofferte: ${q.title}. ${q.description}` };
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
  if (state.tab === "dashboard") dashboardTab(target);
  else if (state.tab === "inventory") inventoryTab(target);
  else if (state.tab === "products") {
    let ps = [];
    const drawProducts = () => {
      if (!target.isConnected) return;
      target.innerHTML = `<div class="admin-toolbar"><h3>Producten beheren</h3><button class="primary" id="newProduct"><i data-lucide="plus"></i> Product toevoegen</button></div>${ps.length ? ps.map(p => { const groups = optionGroupsOf(p); return `<div class="admin-row"><div class="admin-product">${p.image ? `<img src="${safe(p.image)}" alt="">` : "✦"}<div><b>${safe(p.title)}</b>${p.soldOut ? ` <span class="badge-out">UITVERKOCHT</span>` : ""}${p.optionSetId ? ` <span class="status-pill" title="Deze productkeuzes worden gedeeld met andere producten">LIVE GEKOPPELD</span>` : ""}${p.model3d ? ` <span class="status-pill">3D MODEL</span>` : ""}<small>${money(p.price)}${p.categoryId && categoryLabel(p.categoryId) ? ` · ${safe(categoryLabel(p.categoryId))}` : ""}${p.stockTracked === true ? ` · voorraad ${Math.max(0, Number(p.stockQuantity)||0)}` : ""}</small>${groups.map((g, gi) => `<div class="opt-admin"><small>${safe(g.label)}:</small>${g.options.map((o, oi) => `<button type="button" class="opt-toggle ${o.soldOut ? "out" : ""}" data-optout="${safe(p.id)}" data-g="${gi}" data-i="${oi}" title="Klik om uitverkocht aan/uit te zetten">${safe(o.name)} · ${deltaText(o.priceDelta)}${o.soldOut ? " · uitverkocht" : ""}</button>`).join("")}</div>`).join("")}</div></div><div class="admin-actions"><button class="secondary" data-soldout="${safe(p.id)}">${p.soldOut ? "Weer beschikbaar" : "Uitverkocht"}</button> <button class="secondary" data-edit="${safe(p.id)}">Bewerken</button> <button class="remove-item" data-delete="${safe(p.id)}">Verwijderen</button></div></div>`; }).join("") : "<p class='muted'>Je hebt nog geen producten toegevoegd.</p>"}`;
      $("#newProduct").onclick = () => productEditor();
      target.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => productEditor(b.dataset.edit));
      target.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => { if (confirm("Dit product verwijderen?")) { await remove(ref(db, "products/" + b.dataset.delete)); toast("Product verwijderd"); } });
      target.querySelectorAll("[data-soldout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.soldout); if (p) update(ref(db, "products/" + p.id), { soldOut: !p.soldOut }).then(() => toast(p.soldOut ? "Product weer beschikbaar" : "Product op uitverkocht gezet")).catch(() => toast("Opslaan mislukt")); });
      target.querySelectorAll("[data-optout]").forEach(b => b.onclick = () => {
        const p = ps.find(x => x.id === b.dataset.optout), gIndex = Number(b.dataset.g), oIndex = Number(b.dataset.i), g = p && optionGroupsOf(p)[gIndex], o = g && g.options[oIndex];
        if (!o) return;
        const path = p.optionSetId ? `settings/productOptionSets/${p.optionSetId}/groups/${gIndex}/options/${oIndex}` : (p.optionGroups ? `products/${p.id}/optionGroups/${gIndex}/options/${oIndex}` : `products/${p.id}/options/${oIndex}`);
        update(ref(db, path), { soldOut: !o.soldOut }).then(() => toast(o.soldOut ? `${o.name} weer beschikbaar` : `${o.name} op uitverkocht gezet`)).catch(() => toast("Opslaan mislukt"));
      });
    };
    listen(ref(db, "products"), snap => { ps = toList(snap); drawProducts(); });
    listen(ref(db, "settings/productOptionSets"), snap => { state.optionSets = snap.val() || {}; drawProducts(); });
  }
  else if (state.tab === "orders" || state.tab === "myorders") listen(ref(db, "orders"), snap => {
    const os = toList(snap).sort((a, b) => b.createdAt - a.createdAt);
    target.innerHTML = `<h3>${state.tab === "myorders" ? "Mijn bestellingen · overzicht en betaallinks" : "Bestellingen en status"}</h3>${os.length ? os.map(o => `<div class="admin-row order-admin"><div><b>#${short(o.id)} · ${safe(o.username || "Klant")}</b><small>${(o.items || []).map(i => `<span class="oi">${safe(i.title)}${optText(i)} × ${i.qty}</span>`).join("")}<span class="oi">${money(o.subtotal ?? o.total)} + ${money(o.shipping ?? 0)} verzending = <b>${money(o.total)}</b></span></small>${planBox(o, true)}<p class="order-note"><b>Afhandeling:</b> ${fulfillmentLabel(o)} · <b>Betaling:</b> ${safe(o.paymentStatus || "Niet geregistreerd")}</p>${o.paymentMethod === "tikkie" ? `<div class="stage-panel"><b>Betaallink voor klant</b><input type="url" data-tikkie-input="${safe(o.id)}" value="${safe(o.tikkieLink || "")}" placeholder="https://tikkie.me/... of https://betaalverzoek.rabobank.nl/..."><div class="admin-actions"><button class="secondary" data-tikkie-save="${safe(o.id)}">Betaallink opslaan</button><button class="secondary" data-tikkie-paid="${safe(o.id)}">Markeer als betaald</button></div></div>` : ""}${o.address ? `<p class="order-note"><b>Verzendadres:</b> ${safe([o.address.firstName, o.address.lastName].filter(Boolean).join(" "))}, ${safe(o.address.street || "")} ${safe(o.address.houseNumber || "")} ${safe(o.address.addition || "")}, ${safe(o.address.postcode || "")} ${safe(o.address.city || "")}, ${safe(o.address.country || "Nederland")}</p>` : ""}${o.note ? `<p class="order-note"><b>Opmerking klant:</b> ${safe(o.note)}</p>` : ""}${o.returnRequestAt ? `<div class="stage-panel"><b>Retouraanvraag ontvangen</b><p class="order-note">Aangevraagd op ${when(o.returnRequestAt)} · ${o.returnStatus === "handled" ? "Afgehandeld" : "Wacht op afhandeling"}</p>${o.returnStatus !== "handled" ? `<button class="secondary" data-return-handled="${safe(o.id)}">Markeer retouraanvraag als afgehandeld</button>` : ""}</div>` : ""}${o.deliveredAt ? `<p class="order-note">${isPickupOrder(o) ? "Opgehaald" : "Afgeleverd"} op ${when(o.deliveredAt)} · retourtermijn eindigt ${when(returnDeadline(o))}</p>` : ""}${o.status === "in de maak" ? `<div class="stage-panel"><b>Voortgang per product</b>${(o.items || []).map((i, n) => unitStages(i).map((cur, u, all) => `<div class="stage-row"><span>${safe(i.title)}${optText(i)}${all.length > 1 ? ` · stuk ${u + 1} van ${all.length}` : ""}</span><select data-stage="${safe(o.id)}" data-i="${n}" data-u="${u}">${STAGES.map(st => `<option ${cur === st ? "selected" : ""}>${st}</option>`).join("")}</select></div>`).join("")).join("")}</div>` : ""}</div><select data-status="${safe(o.id)}">${STATUSES.map(s => `<option value="${safe(s)}" ${s === o.status ? "selected" : ""}>${safe(statusLabel(o, s))}</option>`).join("")}</select><button class="secondary" data-ochat="${safe(o.chatId || "")}">Chat</button></div>`).join("") : "<p class='muted'>Nog geen bestellingen.</p>"}`;
    target.querySelectorAll("[data-status]").forEach(s => s.onchange = async () => { try { const id = s.dataset.status, order = os.find(o => o.id === id); const changes = { status: s.value }; if (s.value === "bezorgd" && !order?.deliveredAt) changes.deliveredAt = Date.now(); if (s.value === "bezorgd" && order) changes.reviewEligibleProducts = { ...(order.reviewEligibleProducts || {}), ...eligibleProductsForOrder(order) }; if (s.value !== "bezorgd" && order?.status === "bezorgd") changes.deliveredAt = null; await update(ref(db, "orders/" + id), changes); await syncPublicTrack(id); toast("Bestelstatus bijgewerkt"); } catch { toast("Opslaan mislukt"); } });
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
function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
const MAX_PRODUCT_MODEL_BYTES = 10 * 1024 * 1024;
// Kleine stukjes blijven ruim onder Firebase Realtime Database's maximale stringgrootte.
// 768 KiB ruwe bytes wordt ongeveer 1 MiB Base64 per database-write.
const PRODUCT_MODEL_CHUNK_BYTES = 768 * 1024;
function bytesToBase64(bytes) {
  let binary = "";
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + step, bytes.length)));
  }
  return btoa(binary);
}
function base64ToBytes(encoded) {
  const binary = atob(encoded), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
async function uploadProductModelFile(file, productId) {
  const extension = String(file.name || "").split(".").pop().toLowerCase();
  if (!["stl", "3mf"].includes(extension)) throw new Error("Upload alleen een STL- of 3MF-bestand.");
  if (!file.size || file.size > MAX_PRODUCT_MODEL_BYTES) throw new Error("Het STL- of 3MF-bestand mag maximaal 10 MB zijn.");
  const header = new Uint8Array(await file.slice(0, Math.min(file.size, 84)).arrayBuffer());
  if (header.length < 5) throw new Error("Dit bestand lijkt geen geldig 3D-model te zijn.");
  if (extension === "3mf" && !(header[0] === 0x50 && header[1] === 0x4b)) throw new Error("Dit 3MF-bestand heeft geen geldige ZIP-container.");
  if (extension === "stl" && file.size < 84 && !new TextDecoder().decode(header.slice(0, 5)).toLowerCase().startsWith("solid")) throw new Error("Dit STL-bestand is ongeldig of onvolledig.");

  const baseName = String(file.name || "model").replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70) || "model";
  const uniqueId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  // RTDB-sleutels mogen geen punt bevatten; gebruik daarom alleen de unieke ID.
  const path = `productModels/${productId}/${uniqueId}`;
  const chunkCount = Math.ceil(file.size / PRODUCT_MODEL_CHUNK_BYTES);
  try {
    for (let index = 0; index < chunkCount; index++) {
      const start = index * PRODUCT_MODEL_CHUNK_BYTES;
      const end = Math.min(start + PRODUCT_MODEL_CHUNK_BYTES, file.size);
      const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
      await set(ref(db, `${path}/chunks/${index}`), bytesToBase64(bytes));
    }
    // Metadata wordt als laatste geschreven: de viewer ziet het model pas als de upload compleet is.
    await set(ref(db, `${path}/meta`), {
      format: extension,
      originalBytes: file.size,
      chunkCount,
      name: String(file.name || `model.${extension}`).slice(0, 120),
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error("Gratis Realtime Database modelupload mislukt", { code: error?.code || "", message: error?.message || String(error) });
    await remove(ref(db, path)).catch(cleanupError => console.warn("Onvolledige modelupload kon niet automatisch worden opgeruimd", cleanupError));
    const code = String(error?.code || "");
    if (code.includes("PERMISSION_DENIED") || code.includes("permission-denied")) {
      throw new Error("Firebase Realtime Database heeft de modelupload geweigerd. Publiceer de meegeleverde database.rules.json via Firebase Console → Realtime Database → Rules.");
    }
    if (code.includes("NETWORK") || !navigator.onLine) {
      throw new Error("De internetverbinding is onderbroken tijdens het uploaden. Probeer het opnieuw met een stabiele verbinding.");
    }
    throw new Error(`3D-model opslaan in de gratis Firebase-database is mislukt: ${error?.message || code || "onbekende fout"}`);
  }
  return {
    format: extension,
    name: String(file.name || `${baseName}.${extension}`).slice(0, 120),
    databasePath: path,
    encoding: "base64-chunks",
    originalBytes: file.size,
    storedBytes: Math.ceil(file.size / 3) * 4,
    chunkCount,
    updatedAt: Date.now()
  };
}
async function decodeProductModel(model) {
  let bytes;
  if (model.databasePath) {
    const snapshot = await get(ref(db, model.databasePath));
    if (!snapshot.exists()) throw new Error("Dit 3D-model staat niet meer in de gratis Firebase-database. Upload het originele STL- of 3MF-bestand opnieuw bij het product.");
    const record = snapshot.val() || {};
    const meta = record.meta || {};
    const chunkCount = Number(meta.chunkCount);
    if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 14) throw new Error("De opgeslagen 3D-modelgegevens zijn onvolledig of ongeldig.");
    let encoded = "";
    for (let index = 0; index < chunkCount; index++) {
      const part = record.chunks?.[index];
      if (typeof part !== "string" || !part.length) throw new Error("Een deel van het 3D-model ontbreekt. Upload het model opnieuw.");
      encoded += part;
    }
    bytes = base64ToBytes(encoded);
    const expectedBytes = Number(model.originalBytes || meta.originalBytes);
    if (bytes.byteLength > MAX_PRODUCT_MODEL_BYTES || bytes.byteLength !== expectedBytes) throw new Error("De opgeslagen 3D-modelgrootte klopt niet. Upload het model opnieuw.");
  } else if (model.storagePath) {
    throw new Error("Dit oude model staat nog in Firebase Storage. Dat werkt niet met het gratis Spark-abonnement. Upload het originele STL- of 3MF-bestand opnieuw bij het product.");
  } else {
    // Achterwaartse compatibiliteit met oudere modellen die als Base64 in Realtime Database staan.
    bytes = base64ToBytes(model.data || "");
  }
  if (model.encoding === "gzip") {
    if (typeof DecompressionStream === "undefined") throw new Error("Deze browser kan het gecomprimeerde 3D-model niet openen. Gebruik een recente browser.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).arrayBuffer();
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
let threeToolkitPromise = null;
async function loadThreeToolkit() {
  if (!threeToolkitPromise) threeToolkitPromise = Promise.all([
    import("three"),
    import("three/addons/loaders/STLLoader.js"),
    import("three/addons/loaders/3MFLoader.js"),
    import("three/addons/controls/OrbitControls.js")
  ]).then(([THREE, stl, threeMF, controls]) => ({ THREE, STLLoader: stl.STLLoader, ThreeMFLoader: threeMF.ThreeMFLoader, OrbitControls: controls.OrbitControls })).catch(error => { threeToolkitPromise = null; throw error; });
  return threeToolkitPromise;
}

// Bambu Studio, OrcaSlicer and PrusaSlicer can store the actual meshes in
// separate 3D/Objects/*.model parts (3MF Production Extension). The stock
// ThreeMFLoader in older Three.js releases does not follow p:path references.
// This fallback resolves those references inside the 3MF ZIP and builds the
// Three.js groups directly, so multi-part projects can still be previewed.
async function parseProduction3MF(THREE, buffer) {
  // A 3MF file is a ZIP archive. Read its central directory directly and use
  // the browser's native DEFLATE stream, avoiding another third-party runtime.
  const zipBytes = new Uint8Array(buffer);
  const zipView = new DataView(buffer);
  const u16 = (offset) => zipView.getUint16(offset, true);
  const u32 = (offset) => zipView.getUint32(offset, true);
  let eocd = -1;
  const searchStart = Math.max(0, zipBytes.length - 22 - 65535);
  for (let offset = zipBytes.length - 22; offset >= searchStart; offset--) {
    if (u32(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Dit 3MF-bestand is geen geldig ZIP-archief.");
  const entryCount = u16(eocd + 10);
  const centralDirectoryOffset = u32(eocd + 16);
  if (entryCount === 0xffff || centralDirectoryOffset === 0xffffffff) throw new Error("Dit 3MF-bestand gebruikt een niet-ondersteund ZIP64-formaat.");
  const zipEntries = new Map();
  let cursor = centralDirectoryOffset;
  const decoder = new TextDecoder("utf-8");
  for (let index = 0; index < entryCount; index++) {
    if (u32(cursor) !== 0x02014b50) throw new Error("De inhoudsopgave van het 3MF-archief is beschadigd.");
    const flags = u16(cursor + 8);
    const method = u16(cursor + 10);
    const compressedSize = u32(cursor + 20);
    const uncompressedSize = u32(cursor + 24);
    const nameLength = u16(cursor + 28);
    const extraLength = u16(cursor + 30);
    const commentLength = u16(cursor + 32);
    const localHeaderOffset = u32(cursor + 42);
    const name = decoder.decode(zipBytes.subarray(cursor + 46, cursor + 46 + nameLength));
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) throw new Error("Dit 3MF-bestand gebruikt een niet-ondersteund ZIP64-onderdeel.");
    if (name && !name.endsWith("/")) zipEntries.set(name, { flags, method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  const normalizePath = value => {
    let path = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
    try { path = decodeURIComponent(path); } catch (_) { /* Keep literal ZIP path if it is not URI encoded. */ }
    return path.replace(/^\.\//, "");
  };
  const textCache = new Map();
  const readZipEntry = async (rawPath) => {
    const path = normalizePath(rawPath);
    if (textCache.has(path)) return textCache.get(path);
    const entry = zipEntries.get(path);
    if (!entry) throw new Error(`Het 3MF-onderdeel '${path}' ontbreekt in het bestand.`);
    if (entry.uncompressedSize > 120 * 1024 * 1024) throw new Error(`Het 3MF-onderdeel '${path}' is te groot om veilig in de preview te openen.`);
    const local = entry.localHeaderOffset;
    if (u32(local) !== 0x04034b50) throw new Error(`Het 3MF-onderdeel '${path}' heeft een ongeldige ZIP-header.`);
    const localNameLength = u16(local + 26);
    const localExtraLength = u16(local + 28);
    const dataOffset = local + 30 + localNameLength + localExtraLength;
    const compressed = zipBytes.subarray(dataOffset, dataOffset + entry.compressedSize);
    let unpacked;
    if (entry.method === 0) {
      unpacked = compressed.slice();
    } else if (entry.method === 8) {
      if (typeof DecompressionStream === "undefined") throw new Error("Deze browser kan de ZIP-compressie van dit 3MF-bestand niet openen. Gebruik een recente Chrome-, Edge- of Firefox-browser.");
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        unpacked = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (error) {
        throw new Error(`Het 3MF-onderdeel '${path}' kon niet worden uitgepakt: ${error?.message || error}`);
      }
    } else {
      throw new Error(`Het 3MF-onderdeel '${path}' gebruikt een niet-ondersteunde ZIP-compressie (${entry.method}).`);
    }
    if (unpacked.byteLength !== entry.uncompressedSize) throw new Error(`De uitgepakte grootte van '${path}' klopt niet.`);
    textCache.set(path, unpacked);
    return unpacked;
  };
  const decodeText = async path => new TextDecoder("utf-8").decode(await readZipEntry(path));
  const xmlParser = new DOMParser();
  const parseXml = async path => {
    const document = xmlParser.parseFromString(await decodeText(path), "application/xml");
    if (document.querySelector("parsererror")) throw new Error(`Het 3MF-onderdeel '${path}' bevat ongeldige XML.`);
    return document;
  };
  const children = (node, localName) => Array.from(node?.children || []).filter(child => child.localName === localName);
  const firstChild = (node, localName) => children(node, localName)[0] || null;
  const productionNamespace = "http://schemas.microsoft.com/3dmanufacturing/production/2015/06";
  const pathAttribute = node => node.getAttributeNS?.(productionNamespace, "path") || node.getAttribute("p:path") || node.getAttribute("path") || "";
  let rootPath = "3D/3dmodel.model";
  if (zipEntries.has("_rels/.rels")) {
    const relDoc = await parseXml("_rels/.rels");
    const startPart = Array.from(relDoc.getElementsByTagName("Relationship")).find(rel => /3dmodel/i.test(rel.getAttribute("Type") || ""));
    if (startPart?.getAttribute("Target")) rootPath = normalizePath(startPart.getAttribute("Target"));
  }
  if (!zipEntries.has(rootPath)) {
    rootPath = Array.from(zipEntries.keys()).find(path => /^3D\/3dmodel\.model$/i.test(path)) || Array.from(zipEntries.keys()).find(path => /\.model$/i.test(path));
  }
  if (!rootPath || !zipEntries.has(rootPath)) throw new Error("In dit 3MF-bestand is geen hoofdmodel gevonden.");

  const parsedParts = new Map();
  const getPart = async rawPath => {
    const path = normalizePath(rawPath);
    if (!parsedParts.has(path)) {
      parsedParts.set(path, (async () => {
        const document = await parseXml(path);
        const model = document.documentElement;
        const resources = firstChild(model, "resources");
        const objects = new Map(children(resources, "object").map(object => [String(object.getAttribute("id")), object]));
        return { objects, build: firstChild(model, "build"), unit: model.getAttribute("unit") || "millimeter" };
      })());
    }
    return await parsedParts.get(path);
  };
  const objectCache = new Map();
  const building = new Set();
  const readTransform = value => {
    if (!value) return null;
    const t = value.trim().split(/\s+/).map(Number);
    if (t.length !== 12 || !t.every(Number.isFinite)) return null;
    // 3MF stores an affine transform in row-vector order; Matrix4.set uses
    // column-vector order, so transpose the 3x3 portion and translation.
    return new THREE.Matrix4().set(
      t[0], t[3], t[6], t[9],
      t[1], t[4], t[7], t[10],
      t[2], t[5], t[8], t[11],
      0, 0, 0, 1
    );
  };
  const makeMesh = (objectNode, objectId) => {
    const meshNode = firstChild(objectNode, "mesh");
    if (!meshNode) return null;
    const verticesNode = firstChild(meshNode, "vertices");
    const trianglesNode = firstChild(meshNode, "triangles");
    const vertices = children(verticesNode, "vertex");
    const triangles = children(trianglesNode, "triangle");
    if (!vertices.length || !triangles.length) return null;
    const positions = new Float32Array(vertices.length * 3);
    vertices.forEach((vertex, index) => {
      positions[index * 3] = Number(vertex.getAttribute("x"));
      positions[index * 3 + 1] = Number(vertex.getAttribute("y"));
      positions[index * 3 + 2] = Number(vertex.getAttribute("z"));
    });
    const indices = [];
    triangles.forEach(triangle => {
      const a = Number(triangle.getAttribute("v1")), b = Number(triangle.getAttribute("v2")), c = Number(triangle.getAttribute("v3"));
      if ([a, b, c].every(index => Number.isInteger(index) && index >= 0 && index < vertices.length)) indices.push(a, b, c);
    });
    if (!indices.length) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const name = String(objectNode.getAttribute("name") || `Onderdeel ${objectId}`).slice(0, 70);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.04, roughness: 0.72 }));
    mesh.name = name;
    return mesh;
  };
  const resolveObject = async (partPath, objectId) => {
    partPath = normalizePath(partPath);
    const cacheKey = `${partPath}#${objectId}`;
    if (objectCache.has(cacheKey)) return objectCache.get(cacheKey);
    if (building.has(cacheKey)) throw new Error("Dit 3MF-bestand bevat een kringverwijzing tussen onderdelen.");
    const part = await getPart(partPath);
    const objectNode = part.objects.get(String(objectId));
    if (!objectNode) throw new Error(`3MF-object ${objectId} ontbreekt in '${partPath}'.`);
    building.add(cacheKey);
    const group = new THREE.Group();
    group.name = String(objectNode.getAttribute("name") || `Object ${objectId}`).slice(0, 70);
    const mesh = makeMesh(objectNode, objectId);
    if (mesh) group.add(mesh);
    const componentsNode = firstChild(objectNode, "components");
    for (const component of children(componentsNode, "component")) {
      const childPart = normalizePath(pathAttribute(component) || partPath);
      const childId = component.getAttribute("objectid");
      const childGroup = (await resolveObject(childPart, childId)).clone(true);
      const transform = readTransform(component.getAttribute("transform"));
      if (transform) childGroup.applyMatrix4(transform);
      group.add(childGroup);
    }
    building.delete(cacheKey);
    objectCache.set(cacheKey, group);
    return group;
  };

  const rootPart = await getPart(rootPath);
  const buildItems = children(rootPart.build, "item");
  if (!buildItems.length) throw new Error("Het 3MF-hoofdmodel bevat geen plaatsbare onderdelen.");
  const result = new THREE.Group();
  result.name = "3MF-model";
  for (const item of buildItems) {
    const itemPath = normalizePath(pathAttribute(item) || rootPath);
    const objectId = item.getAttribute("objectid");
    const instance = (await resolveObject(itemPath, objectId)).clone(true);
    const transform = readTransform(item.getAttribute("transform"));
    if (transform) instance.applyMatrix4(transform);
    result.add(instance);
  }
  let meshCount = 0;
  result.traverse(child => { if (child.isMesh && child.geometry) meshCount++; });
  if (!meshCount) throw new Error("Het 3MF-bestand bevat geen meshes die de preview kan weergeven.");
  return result;
}
async function mountProductModelViewer(root, model, availableColors, initialColors, onColorsChange) {
  if (!root || !(model?.data || model?.storagePath || model?.databasePath)) return null;
  const canvas = root.querySelector("canvas"), status = root.querySelector(".model-viewer-state");
  // The color controls are a sibling of #productModelViewer inside the
  // .product-model-section, not a child of the canvas/viewer root itself.
  // Query from the enclosing section so the element is actually found.
  let controlsRoot = root.closest(".product-model-section")?.querySelector(".model-part-color-controls")
    || root.parentElement?.querySelector(".model-part-color-controls")
    || null;
  // Keep the preview functional even if another page template omitted the
  // optional color-control container.
  if (!controlsRoot) {
    controlsRoot = document.createElement("div");
    controlsRoot.className = "model-part-color-controls";
    root.insertAdjacentElement("afterend", controlsRoot);
  }
  let renderer, controls, frame = 0, resizeObserver, disposed = false, modelRoot = null;
  const cleanup = () => {
    disposed = true; cancelAnimationFrame(frame); resizeObserver?.disconnect(); controls?.dispose();
    if (modelRoot) modelRoot.traverse(child => { if (child.isMesh) { child.geometry?.dispose?.(); const materials = Array.isArray(child.material) ? child.material : [child.material]; materials.forEach(material => material?.dispose?.()); } });
    renderer?.dispose();
  };
  try {
    if (status) status.textContent = "3D-model laden…";
    const [{ THREE, STLLoader, ThreeMFLoader, OrbitControls }, buffer] = await Promise.all([loadThreeToolkit(), decodeProductModel(model)]);
    if (disposed || !root.isConnected) return cleanup;
    if (model.format === "stl") {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      modelRoot = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.08, roughness: 0.68 }));
      modelRoot.name = "Volledig model";
    } else {
      // Use Three.js' standard loader when it can read the file. For
      // Bambu/Orca/Prusa production-extension archives, fall back to the
      // multi-part parser which follows external p:path model references.
      try {
        modelRoot = new ThreeMFLoader().parse(buffer);
        let parsedMeshes = 0;
        modelRoot?.traverse(child => { if (child.isMesh && child.geometry) parsedMeshes++; });
        if (!modelRoot || !parsedMeshes) modelRoot = await parseProduction3MF(THREE, buffer);
      } catch (standardLoaderError) {
        console.info("3MF wordt met de aanvullende productieparser ingelezen.", standardLoaderError?.message || standardLoaderError);
        modelRoot = await parseProduction3MF(THREE, buffer);
      }
    }
    if (!modelRoot) throw new Error("Het 3D-model kon niet worden gelezen.");
    modelRoot.rotation.x = -Math.PI / 2; // STL/3MF gebruikt doorgaans Z als boven-as; Three.js gebruikt Y.
    const box = new THREE.Box3().setFromObject(modelRoot), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    if (!Number.isFinite(size.x + size.y + size.z) || Math.max(size.x, size.y, size.z) <= 0) throw new Error("Het model bevat geen bruikbare driehoeken.");
    modelRoot.position.sub(center);
    modelRoot.scale.setScalar(1.75 / Math.max(size.x, size.y, size.z));
    const meshes = [];
    modelRoot.traverse(child => { if (child.isMesh && child.geometry) meshes.push(child); });
    if (!meshes.length) throw new Error("In dit bestand is geen 3D-mesh gevonden.");
    const partGroups = [];
    meshes.forEach((mesh, index) => {
      const partIndex = Math.min(index, 7);
      if (!partGroups[partIndex]) partGroups[partIndex] = { name: String(mesh.name || mesh.userData?.name || (partIndex === 7 && meshes.length > 8 ? "Overige onderdelen" : `Onderdeel ${partIndex + 1}`)).slice(0, 70), meshes: [] };
      partGroups[partIndex].meshes.push(mesh);
      mesh.material = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => {
        const clone = material?.clone ? material.clone() : new THREE.MeshStandardMaterial();
        if (clone.color) clone.color.set(0x9aa7b8);
        clone.roughness = 0.72; clone.metalness = 0.04; clone.needsUpdate = true; return clone;
      });
      if (mesh.material.length === 1) mesh.material = mesh.material[0];
    });
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xf8fafc);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100); camera.position.set(2.8, 2.2, 3.3);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x708096, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(4, 6, 5); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xc6ddff, 1.0); fillLight.position.set(-4, 2, -4); scene.add(fillLight);
    scene.add(modelRoot);
    controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.07; controls.minDistance = 1.4; controls.maxDistance = 7; controls.target.set(0, 0, 0);
    camera.lookAt(0, 0, 0);
    const resize = () => { if (!root.isConnected) return; const width = Math.max(220, root.clientWidth), height = Math.max(200, root.clientHeight || 280); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root); resize();
    const allowed = (availableColors || []).filter(color => validColorHex(color.hex));
    const current = [];
    const applyPartColor = (index, hex, colorName) => {
      const color = allowed.find(option => option.hex.toLowerCase() === String(hex).toLowerCase()); if (!color) return;
      (partGroups[index]?.meshes || []).forEach(mesh => {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach(material => { material.color?.set(color.hex); material.needsUpdate = true; });
      });
      current[index] = { partIndex: index, partName: partGroups[index]?.name || `Onderdeel ${index + 1}`, colorName: color.name, colorHex: color.hex };
    };
    if (allowed.length) {
      controlsRoot.innerHTML = `<p class="model-part-color-title">Kies de kleur per onderdeel</p>${partGroups.map((part,index) => `<label class="model-part-color-row"><span>${safe(part.name)}</span><select data-model-part-color="${index}">${allowed.map(color => `<option value="${safe(color.hex)}">${safe(color.name)}</option>`).join("")}</select></label>`).join("")}`;
      partGroups.forEach((part,index) => {
        const previous = (initialColors || []).find(color => Number(color.partIndex) === index && allowed.some(option => option.hex.toLowerCase() === String(color.colorHex).toLowerCase()));
        const fallback = allowed[0], color = previous ? allowed.find(option => option.hex.toLowerCase() === String(previous.colorHex).toLowerCase()) : fallback;
        const select = controlsRoot.querySelector(`[data-model-part-color="${index}"]`); if (select) select.value = color.hex;
        applyPartColor(index, color.hex, color.name);
        if (select) select.onchange = () => { const selected = allowed.find(option => option.hex === select.value); if (!selected) return; applyPartColor(index, selected.hex, selected.name); onColorsChange?.(current.filter(Boolean).map(item => ({ ...item }))); };
      });
      onColorsChange?.(current.filter(Boolean).map(item => ({ ...item })));
    } else {
      controlsRoot.innerHTML = `<p class="model-color-missing">Voeg bij dit product eerst kleurstaaltjes toe via Sitebeheer → Producten → Bewerken. Alleen die ingestelde kleuren kunnen voor dit model worden gekozen.</p>`;
    }
    if (status) status.textContent = "Draai het model met je muis of vinger.";
    const animate = () => { if (disposed || !root.isConnected) return; frame = requestAnimationFrame(animate); controls.update(); renderer.render(scene, camera); };
    animate();
    return cleanup;
  } catch (error) {
    console.error("3D preview could not be rendered", error);
    if (status && root.isConnected) status.textContent = error?.message || "3D-voorvertoning niet beschikbaar. Controleer het STL/3MF-bestand en de internetverbinding.";
    return cleanup;
  }
}
async function productEditor(id = null) {
  if (id) openDialog(firebaseLoadingMarkup("Productgegevens laden…"));
  const p = id ? ((await get(ref(db, "products/" + id))).val() || {}) : {};
  const [categoriesSnap, allProductsSnap, optionSetsSnap] = await Promise.all([get(ref(db, "categories")), get(ref(db, "products")), get(ref(db, "settings/productOptionSets"))]);
  state.optionSets = optionSetsSnap.val() || {};
  const productCategories = toList(categoriesSnap).sort((a,b) => String(a.name).localeCompare(String(b.name), "nl"));
  const availableProducts = toList(allProductsSnap).filter(source => source.active !== false);
  let images = productImages(p);
  let model3d = p.model3d || null;
  const draftProductId = id || push(ref(db, "products")).key;
  let linkedOptionSetId = p.optionSetId || null;
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
      <fieldset class="opt-editor model-upload-editor"><legend>3D-model en productconfigurator</legend>
        <label>Upload een STL- of 3MF-bestand<input id="pModelFile" type="file" accept=".stl,.3mf,model/stl,model/3mf"></label>
        <p class="hint">Upload een STL- of 3MF-bestand van maximaal 10 MB. Het originele bestand wordt ongewijzigd in kleine delen opgeslagen in de gratis Firebase Realtime Database; Firebase Storage en een betaald abonnement zijn hiervoor niet nodig. Het model wordt pas gedownload wanneer een klant de productpagina opent. Klanten kunnen het model draaien en alleen kiezen uit actieve kleurstaaltjes van dit product. STL heeft één kleurdeel; onderdelen uit 3MF worden waar mogelijk apart getoond.</p>
        <div id="modelFileStatus" class="model-file-status">${p.model3d ? `<b>${safe(p.model3d.name || "3D-model")}</b><small>${safe(String(p.model3d.format || "").toUpperCase())} · ${formatFileSize(p.model3d.originalBytes || 0)} origineel · ${formatFileSize(p.model3d.storedBytes || 0)} opgeslagen (${p.model3d.databasePath ? "gratis database-opslag" : p.model3d.encoding === "gzip" ? "gzip gecomprimeerd" : "bestaand model"})</small>` : "Nog geen 3D-model toegevoegd."}</div>
        <button type="button" class="secondary" id="remove3DModel" ${p.model3d ? "" : "hidden"}>3D-model verwijderen</button>
      </fieldset>
      <fieldset class="opt-editor"><legend>Voorraadbeheer</legend>
        <label class="check"><input type="checkbox" id="pStockTracked" ${p.stockTracked === true ? "checked" : ""}> Voorraad bijhouden voor dit product</label>
        <div class="inventory-editor-fields" id="pStockFields" ${p.stockTracked === true ? "" : "hidden"}><label>Huidige voorraad<input id="pStockQuantity" type="number" min="0" max="100000" step="1" value="${Math.max(0, Number(p.stockQuantity) || 0)}"></label><label>Waarschuw bij voorraad van<input id="pStockThreshold" type="number" min="0" max="100000" step="1" value="${Math.max(0, Number(p.lowStockThreshold ?? 3))}"></label><small class="hint">Bij voorraad 0 wordt het product automatisch uitverkocht en kan het niet worden besteld. Voorraad wordt bij iedere geslaagde bestelling afgeboekt.</small></div>
      </fieldset>
      <fieldset class="opt-editor"><legend>Productopties en prijsaanpassingen</legend>
        <div class="choice-copy-row"><label>Product om live mee te koppelen<select id="copyOptionsFrom"><option value="">Selecteer een product…</option>${availableProducts.filter(source => source.id !== id && optionGroupsOf(source).length).map(source => `<option value="${safe(source.id)}">${safe(source.title)}</option>`).join("")}</select></label><button type="button" class="secondary" id="copyOptionsBtn">Live koppelen</button></div>
        <p id="optionLinkStatus" class="hint">${linkedOptionSetId ? "Dit product gebruikt een gedeelde keuzeset. Wijzigingen worden voor alle gekoppelde producten gepubliceerd zodra je opslaat." : "Dit product heeft eigen keuzes. Kies een ander product en gebruik Live koppelen om dezelfde keuzes voortaan samen te beheren."}</p>
        <button type="button" class="secondary" id="unlinkOptionSet" ${linkedOptionSetId ? "" : "hidden"}>Loskoppelen en zelfstandig maken</button>
        <div id="optionGroupsEditor" class="choice-groups-editor"></div>
        <button type="button" class="secondary" id="addOptionGroup"><i data-lucide="plus"></i> Optiegroep toevoegen</button>
        <p class="hint">Elke optiegroep wordt één stap in de productconfigurator. Kleurvoorbeelden, prijsverschillen en uitverkocht-statussen worden gedeeld. Na opslaan zien alle gekoppelde producten de update automatisch via Firebase.</p>
      </fieldset>
      <label class="check"><input type="checkbox" id="pSoldOut" ${p.soldOut ? "checked" : ""}> Hele product uitverkocht</label>
      <button class="primary full" id="pSave">Product opslaan</button>
    </form>`);
  const imageGrid = $("#imagePreviewGrid"), imageInput = $("#pImage"), groupWrap = $("#optionGroupsEditor"), modelFileInput = $("#pModelFile");
  const drawImages = () => {
    imageGrid.innerHTML = images.map((src, i) => `<div class="image-editor-item"><img src="${safe(src)}" alt="Productfoto ${i + 1}"><button type="button" data-remove-image="${i}" aria-label="Afbeelding ${i + 1} verwijderen">×</button></div>`).join("");
    imageGrid.querySelectorAll("[data-remove-image]").forEach(b => b.onclick = () => { images.splice(Number(b.dataset.removeImage), 1); drawImages(); });
  };
  const drawGroups = () => {
    groupWrap.innerHTML = groups.map((g, gi) => `<div class="choice-group-editor" data-group="${gi}">
      <div class="choice-group-head"><label>Naam van stap ${gi + 1}<input class="group-label" maxlength="40" required placeholder="Bijv. Kleur, formaat of afwerking" value="${safe(g.label)}"></label><button type="button" class="remove-item" data-remove-group="${gi}">Verwijder stap</button></div>
      <div class="choice-options">${g.options.map((o, oi) => { const hasColor = validColorHex(o.colorHex); return `<div class="choice-option-row" data-option="${oi}">
        <input class="choice-name" maxlength="50" required placeholder="Optienaam, bijv. Rood" value="${safe(o.name)}">
        <div class="delta-wrap"><input class="choice-delta" type="number" step="0.01" value="${Number(o.priceDelta) || 0}" aria-label="Prijsaanpassing in euro"></div>
        <label class="choice-color-field"><input class="choice-color-enabled" type="checkbox" ${hasColor ? "checked" : ""}><span>Kleurvoorbeeld</span><input class="choice-color" type="color" value="${hasColor ? safe(o.colorHex) : "#808080"}" ${hasColor ? "" : "disabled"} aria-label="Kleurvoorbeeld kiezen"></label>
        <label class="choice-out-field"><input class="choice-out" type="checkbox" ${o.soldOut ? "checked" : ""}> uitverkocht</label>
        <button type="button" class="remove-item" data-remove-option="${oi}" aria-label="Optie verwijderen">×</button>
      </div>`; }).join("")}</div>
      <button type="button" class="secondary" data-add-option="${gi}"><i data-lucide="plus"></i> Optie toevoegen</button>
    </div>`).join("");
    groupWrap.querySelectorAll(".group-label").forEach(el => el.oninput = () => { groups[Number(el.closest("[data-group]").dataset.group)].label = el.value; });
    groupWrap.querySelectorAll(".choice-name").forEach(el => el.oninput = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].name = el.value; });
    groupWrap.querySelectorAll(".choice-delta").forEach(el => el.oninput = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].priceDelta = Number(el.value) || 0; });
    groupWrap.querySelectorAll(".choice-color-enabled").forEach(el => el.onchange = () => {
      const row = el.closest("[data-option]"), g = Number(el.closest("[data-group]").dataset.group), o = Number(row.dataset.option), picker = row.querySelector(".choice-color");
      picker.disabled = !el.checked;
      groups[g].options[o].colorHex = el.checked ? picker.value : "";
    });
    groupWrap.querySelectorAll(".choice-color").forEach(el => el.oninput = () => {
      const row = el.closest("[data-option]"), g = Number(el.closest("[data-group]").dataset.group), o = Number(row.dataset.option);
      if (row.querySelector(".choice-color-enabled").checked) groups[g].options[o].colorHex = el.value;
    });
    groupWrap.querySelectorAll(".choice-out").forEach(el => el.onchange = () => { const g = Number(el.closest("[data-group]").dataset.group), o = Number(el.closest("[data-option]").dataset.option); groups[g].options[o].soldOut = el.checked; });
    groupWrap.querySelectorAll("[data-remove-group]").forEach(b => b.onclick = () => { groups.splice(Number(b.dataset.removeGroup), 1); drawGroups(); });
    groupWrap.querySelectorAll("[data-add-option]").forEach(b => b.onclick = () => { groups[Number(b.dataset.addOption)].options.push({ name: "", priceDelta: 0, soldOut: false }); drawGroups(); });
    groupWrap.querySelectorAll("[data-remove-option]").forEach(b => b.onclick = () => { const g = Number(b.closest("[data-group]").dataset.group); groups[g].options.splice(Number(b.dataset.removeOption), 1); drawGroups(); });
  };
  const updateOptionLinkStatus = () => {
    const status = $("#optionLinkStatus"), unlink = $("#unlinkOptionSet");
    if (status) status.textContent = linkedOptionSetId
      ? "LIVE GEKOPPELD: dit product deelt zijn keuzes met andere producten. Wijzigingen worden na opslaan automatisch overal bijgewerkt."
      : "Dit product heeft eigen keuzes. Koppel het aan een ander product om één gedeelde keuzeset te gebruiken.";
    if (unlink) unlink.hidden = !linkedOptionSetId;
  };
  drawImages(); drawGroups(); updateOptionLinkStatus();
  const refreshModelFileStatus = () => {
    const box = $("#modelFileStatus"), removeButton = $("#remove3DModel");
    if (box) box.innerHTML = model3d ? `<b>${safe(model3d.name || "3D-model")}</b><small>${safe(String(model3d.format || "").toUpperCase())} · ${formatFileSize(model3d.originalBytes || 0)} origineel · ${formatFileSize(model3d.storedBytes || 0)} opgeslagen (${model3d.databasePath ? "gratis database-opslag" : model3d.encoding === "gzip" ? "gzip gecomprimeerd" : "bestaand model"})</small>` : "Nog geen 3D-model toegevoegd.";
    if (removeButton) removeButton.hidden = !model3d;
  };
  $("#pStockTracked").onchange = () => { $("#pStockFields").hidden = !$("#pStockTracked").checked; };
  $("#remove3DModel").onclick = () => { model3d = null; modelFileInput.value = ""; refreshModelFileStatus(); toast("3D-model wordt verwijderd na opslaan"); };
  modelFileInput.onchange = async () => {
    const file = modelFileInput.files?.[0]; if (!file) return;
    const status = $("#modelFileStatus"); status.textContent = "Bestand controleren en ongewijzigd uploaden…"; modelFileInput.disabled = true;
    try { model3d = await uploadProductModelFile(file, draftProductId); refreshModelFileStatus(); toast("Origineel 3D-model geüpload"); }
    catch (error) { console.error("3D model upload failed", error); status.textContent = error.message || "Het 3D-model kon niet worden geüpload."; toast(error.message || "3D-model uploaden mislukt"); }
    finally { modelFileInput.disabled = false; modelFileInput.value = ""; }
  };
  $("#copyOptionsBtn").onclick = async () => {
    const sourceId = $("#copyOptionsFrom").value; if (!sourceId) return toast("Selecteer eerst een product om live mee te koppelen.");
    const source = availableProducts.find(x => x.id === sourceId); if (!source) return toast("Dat bronproduct is niet beschikbaar.");
    if (source.optionSetId && source.optionSetId === linkedOptionSetId) return toast("Deze producten zijn al aan dezelfde keuzes gekoppeld.");
    if (groups.length && !confirm("De huidige keuzes worden vervangen door gedeelde keuzes. Vanaf nu worden wijzigingen bij beide producten zichtbaar. Doorgaan?")) return;
    const button = $("#copyOptionsBtn"); button.disabled = true; button.textContent = "Koppelen…";
    try {
      // Lees de bron opnieuw om te voorkomen dat een verouderde editor-snapshot
      // een inmiddels gekoppelde productkeuzeset dubbel aanmaakt.
      const freshSourceSnap = await get(ref(db, `products/${source.id}`));
      if (!freshSourceSnap.exists()) throw new Error("Het bronproduct is intussen verwijderd.");
      const freshSource = { id: source.id, ...freshSourceSnap.val() };
      const setId = await ensureSharedOptionSet(freshSource);
      source.optionSetId = setId;
      const setSnap = await get(ref(db, `settings/productOptionSets/${setId}`));
      if (!setSnap.exists()) throw new Error("De gedeelde keuzeset kon niet worden geladen.");
      const setData = setSnap.val();
      state.optionSets[setId] = setData;
      linkedOptionSetId = setId;
      groups = optionGroupsOf({ optionSetId: setId }).map(g => ({ label: g.label, options: g.options.map(o => ({ ...o })) }));
      drawGroups(); updateOptionLinkStatus();
      toast(`Live gekoppeld aan “${source.title}”. Sla dit product op om de koppeling vast te leggen.`);
    } catch (err) {
      console.error("Could not create live product option link", err);
      toast(err.message || "Live koppelen is mislukt. Controleer de Firebase-regels.");
    } finally { button.disabled = false; button.textContent = "Live koppelen"; }
  };
  $("#unlinkOptionSet").onclick = () => {
    if (!linkedOptionSetId) return;
    if (!confirm("Dit product loskoppelen? De huidige keuzes blijven als zelfstandige kopie bij dit product staan.")) return;
    linkedOptionSetId = null; updateOptionLinkStatus(); toast("Product wordt zelfstandig na opslaan.");
  };
  $("#addOptionGroup").onclick = () => { groups.push({ label: `Keuze ${groups.length + 1}`, options: [{ name: "", priceDelta: 0, soldOut: false, colorHex: "" }] }); drawGroups(); };
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
    const optionGroups = groups.map(g => ({ label: String(g.label || "").trim(), options: g.options.map(o => ({ name: String(o.name || "").trim(), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut, ...(validColorHex(o.colorHex) ? { colorHex: String(o.colorHex).toLowerCase() } : {}) })).filter(o => o.name) })).filter(g => g.label || g.options.length);
    if (optionGroups.some(g => !g.label || !g.options.length)) return toast("Geef elke optiestap een naam en voeg minimaal één optie toe");
    if (new Set(optionGroups.map(g => g.label.toLowerCase())).size !== optionGroups.length) return toast("Elke optiestap moet een eigen naam hebben");
    const allNamesValid = optionGroups.every(g => new Set(g.options.map(o => o.name.toLowerCase())).size === g.options.length);
    if (!allNamesValid) return toast("Binnen een optiestap moeten de optienamen uniek zijn");
    const btn = $("#pSave"); btn.disabled = true; btn.textContent = "Opslaan…";
    const now = Date.now();
    const stockTracked = $("#pStockTracked").checked, stockQuantity = Number($("#pStockQuantity").value), lowStockThreshold = Number($("#pStockThreshold").value);
    if (stockTracked && (!Number.isInteger(stockQuantity) || stockQuantity < 0 || !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0)) return toast("Vul hele, niet-negatieve voorraadaantallen in");
    const data = { title: $("#pTitle").value.trim(), price, description: $("#pDescription").value.trim(), image: images[0] || "", images: images.slice(0, 3), model3d: model3d || null, active: true, categoryId: $("#pCategory").value || null, soldOut: $("#pSoldOut").checked, stockTracked, stockQuantity: stockTracked ? stockQuantity : null, lowStockThreshold: stockTracked ? lowStockThreshold : null, optionSetId: linkedOptionSetId || null, optionGroups: linkedOptionSetId ? null : (optionGroups.length ? optionGroups : null), optionLabel: null, options: null, updatedAt: now };
    try {
      const productId = draftProductId;
      const writes = Object.fromEntries(Object.entries(data).map(([key, value]) => [`products/${productId}/${key}`, value]));
      if (!id) writes[`products/${productId}/createdAt`] = now;
      if (linkedOptionSetId) {
        writes[`settings/productOptionSets/${linkedOptionSetId}/groups`] = optionGroups;
        writes[`settings/productOptionSets/${linkedOptionSetId}/updatedAt`] = now;
      }
      await update(ref(db), writes);
      toast(linkedOptionSetId ? "Product opgeslagen. De gedeelde keuzes zijn direct bijgewerkt bij alle gekoppelde producten." : "Product opgeslagen");
      adminPanel();
    }
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
if (!state.user?.uid) state.favoriteIds = readGuestFavorites();
refreshNav(); saveCart();
if (state.user?.uid) { const cachedUser = state.user; get(ref(db, `profiles/${cachedUser.uid}`)).then(snap => { const profile = snap.val(); if (profile?.username) setCustomer({ ...cachedUser, username: profile.username }); else usernamePrompt(cachedUser.uid, cachedUser.email, cachedUser.username || ""); }).catch(() => {}); }
const publicTrackToken = new URLSearchParams(location.search).get("track");
if (publicTrackToken) showPublicTracking(publicTrackToken);
const returnedOrder = new URLSearchParams(location.search).get("order");
if (returnedOrder) { toast("Je bent terug van de betaalpagina. De betaalstatus wordt door Mollie bevestigd."); history.replaceState({}, "", location.pathname); }
