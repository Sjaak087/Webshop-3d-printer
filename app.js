import { db } from "./firebase.js";
import { enableChatPush, installForegroundChatPush, removeChatPushRegistration, requestChatPushPermission, getChatPushPreference, disableChatPushForChat } from "./chat-notifications.js";
import { BEHEER_CONFIG as CFG } from "./beheer-config.js";
import { ASSISTANT_EXTRA_FAQ } from "./assistant-faq-extra.js";
import { ASSISTANT_EXTRA_300 } from "./assistant-faq-300.js";
import { ASSISTANT_CONVERSATION_MESSAGES, ASSISTANT_GENERAL_MESSAGES } from "./assistant-chat-messages.js";
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
const state = { user: null, admin: false, maintenanceActive: false, products: [], categories: [], optionSets: {}, filaments: [], reviews: {}, favoriteIds: new Set(), categoryFilter: "all", cart: [], tab: "dashboard", loaded: false, productsError: false, orderNote: "", pendingQuoteRequest: false, plan: { orderId: null, key: null, week: null, form: { date: "", from: "", to: "", endDate: "" }, orders: [], scroll: 7 * 44 } };
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
const normalizeColorHex = value => {
  const raw = String(value || "").trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) return "#" + [...raw.slice(1)].map(ch => ch + ch).join("");
  if (/^#?[0-9a-f]{6}$/.test(raw)) return raw.startsWith("#") ? raw : `#${raw}`;
  return "";
};
const validColorHex = value => !!normalizeColorHex(value);
const filamentHexOf = filament => normalizeColorHex(filament?.hex) || normalizeColorHex(filament?.colorHex) || normalizeColorHex(filament?.color);
function productColorChoices(product) {
  const seen = new Set();
  return optionGroupsOf(product).flatMap(group => (group.options || []).map(option => ({ name: option.name, hex: normalizeColorHex(option.colorHex), soldOut: !!option.soldOut, group: group.label })))
    .filter(option => validColorHex(option.hex) && !option.soldOut && !seen.has(option.hex) && seen.add(option.hex));
}
const storedOptionGroupsOf = p => {
  // Alleen de eigen/gedeelde productopties. De globale filamentkleuren worden
  // hieronder runtime toegevoegd en mogen nooit in productopties worden opgeslagen.
  const sharedSet = p?.optionSetId ? state.optionSets?.[p.optionSetId] : null;
  const source = sharedSet && sharedSet.groups != null ? sharedSet.groups : p?.optionGroups;
  const raw = Array.isArray(source) ? source : Object.values(source || {});
  const normalizeOption = o => ({
    name: String(o.name), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut,
    ...(validColorHex(o.colorHex) ? { colorHex: normalizeColorHex(o.colorHex) } : {})
  });
  const groups = raw.filter(g => g && g.label && (Array.isArray(g.options) || g.options)).map((g, i) => ({
    id: g.id || `group-${i}`, label: String(g.label), options: (Array.isArray(g.options) ? g.options : Object.values(g.options || {})).filter(o => o && o.name).map(normalizeOption)
  }));
  // Filamentkleur is managed centrally in Filamentbeheer. Old product-level
  // copies must not appear as a second, conflicting customer choice.
  const isFilamentGroup = label => /^filamentkleur(?:\s|$)/i.test(String(label || "").trim());
  const productGroups = groups.filter(group => !isFilamentGroup(group.label));
  if (groups.length || (sharedSet && sharedSet.groups != null)) return productGroups;
  const old = legacyOptions(p);
  return old.length && !isFilamentGroup(p.optionLabel || "Keuze") ? [{ id: "legacy", label: p.optionLabel || "Keuze", options: old.map(normalizeOption) }] : [];
};
const activeFilaments = () => (state.filaments || []).filter(f => f && f.active !== false && !!filamentHexOf(f));
const filamentGramsFor = p => Math.max(0, Number(p?.filamentGramsPerUnit) || 0);
const optionGroupsOf = p => {
  const groups = storedOptionGroupsOf(p);
  const colors = activeFilaments();
  if (colors.length) {
    const gramsNeeded = filamentGramsFor(p);
    groups.push({
      id: "filament-colors", filamentGroup: true, label: "Filamentkleur",
      options: colors.map(color => ({
        name: String(color.name || "Filamentkleur").trim(), priceDelta: 0,
        colorHex: filamentHexOf(color), filamentId: color.id,
        soldOut: Number(color.gramsAvailable || 0) <= 0 || (gramsNeeded > 0 && Number(color.gramsAvailable || 0) < gramsNeeded)
      }))
    });
  }
  const customTextLabel = String(p?.customTextLabel || "").trim();
  if (p?.customTextEnabled === true && customTextLabel) {
    groups.push({ id: "customer-text", inputType: "text", label: customTextLabel, options: [] });
  }
  return groups;
};
const serializableOptionGroups = groups => groups.map(g => ({
  label: String(g.label || "").trim(),
  options: (Array.isArray(g.options) ? g.options : []).map(o => ({
    name: String(o.name || "").trim(), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut,
    ...(validColorHex(o.colorHex) ? { colorHex: normalizeColorHex(o.colorHex) } : {})
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
  const groups = serializableOptionGroups(storedOptionGroupsOf(product));
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
const isSoldOut = p => {
  if (p?.soldOut) return true;
  const groups = optionGroupsOf(p);
  if (filamentGramsFor(p) > 0 && !activeFilaments().length) return true;
  return groups.some(g => g.options.length > 0 && g.options.every(o => o.soldOut));
};
const selectionsOf = item => Array.isArray(item?.selections) ? item.selections : (item?.option ? [{ label: item.optionLabel || "Keuze", value: item.option, priceDelta: 0 }] : []);
const selectionsKey = selections => selectionsOf({ selections }).map(s => `${encodeURIComponent(s.label)}=${encodeURIComponent(s.value)}`).join("|");
const modelColorsOf = item => Array.isArray(item?.modelColors) ? item.modelColors : [];
const modelColorsKey = colors => modelColorsOf({ modelColors: colors }).map(c => `${Number(c.partIndex)||0}:${encodeURIComponent(c.partName || "deel")}:${String(c.colorHex || "").toLowerCase()}`).sort().join(",");
const itemKey = (id, selections, modelColors = []) => id + "|" + (Array.isArray(selections) ? selectionsKey(selections) : (selections || "")) + "|3d:" + modelColorsKey(modelColors);
const optText = item => {
  const choices = selectionsOf(item);
  const choiceText = choices.length ? ` · ${choices.map(s => `${safe(s.label)}: ${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(s.colorHex))}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(s.value)}</b>`).join(" · ")}` : "";
  const d = item?.dimensions;
  const dims = d ? ` · ${Number(d.length)} × ${Number(d.width)} × ${Number(d.height)} mm (L × B × H)` : "";
  const modelText = modelColorsOf(item).map(c => `3D ${safe(c.partName || "onderdeel")}: <i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(c.colorHex) || "#808080")}"></i> ${safe(c.colorName || c.colorHex || "kleur")}`).join(" · ");
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
document.addEventListener("keydown", e => {
  if (!state.maintenanceActive || state.admin || e.repeat || e.altKey || e.ctrlKey || e.metaKey || String(e.key).toLowerCase() !== "s") return;
  if (!overlay.classList.contains("hidden")) return;
  const target = e.target;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  e.preventDefault();
  openAdminLogin();
});
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
function syncPushForActiveAccount() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  // Klant- en beheerderssessie zijn onafhankelijk; koppel beide als ze actief zijn.
  if (state.user?.uid) {
    enableChatPush({ role: "customer", userId: state.user.uid })
      .catch(error => console.warn("Automatische FCM-koppeling klant mislukt:", error));
  }
  if (state.admin) {
    enableChatPush({ role: "admin" })
      .catch(error => console.warn("Automatische FCM-koppeling Sitebeheer mislukt:", error));
  }
}
function setCustomer(u) { state.user = u; fails = 0; sessionStorage.setItem("novashopUser", JSON.stringify({ uid: u.uid, email: u.email, username: u.username || "", role: "customer" })); refreshNav(); attachCustomerFavorites(); syncPushForActiveAccount(); }
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
function openPendingNotificationChat() {
  const chatId = sessionStorage.getItem("pendingNotificationChat");
  const role = sessionStorage.getItem("pendingNotificationRole") || "customer";
  if (!chatId) return false;
  if (role === "admin" && state.admin) {
    sessionStorage.removeItem("pendingNotificationChat"); sessionStorage.removeItem("pendingNotificationRole");
    openChat(chatId, true); return true;
  }
  if (role !== "admin" && state.user?.uid) {
    sessionStorage.removeItem("pendingNotificationChat"); sessionStorage.removeItem("pendingNotificationRole");
    openChat(chatId, false); return true;
  }
  return false;
}
async function activateCustomer(uid, email, suggested = "") {
  const profile = (await get(ref(db, `profiles/${uid}`))).val();
  if (profile?.username) { setCustomer({ uid, email, username: profile.username, role: "customer" }); closeDialog(); toast("Je bent ingelogd"); if (!openPendingNotificationChat()) continuePendingQuoteRequest(); return; }
  usernamePrompt(uid, email, suggested);
}
function usernamePrompt(uid, email, suggested = "") {
  openDialog(`<p class="eyebrow">PROFIEL AFRONDEN</p><h2>Kies je gebruikersnaam</h2><p class="muted">Je account heeft nog geen gebruikersnaam. Deze naam wordt zichtbaar op je profiel, bestellingen en chats. Je e-mailadres blijft privé voor klanten.</p><form id="usernameForm" class="stack"><label>Gebruikersnaam<input id="usernameInput" required minlength="3" maxlength="20" pattern="[A-Za-z0-9._-]{3,20}" autocomplete="nickname" value="${safe(suggested)}" placeholder="Bijv. printfan23"></label><small class="hint">3–20 tekens: letters, cijfers, punt, _ of -.</small><button class="primary full">Gebruikersnaam opslaan</button></form>`);
  lockDialog = true; $("#closeDialog").hidden = true;
  $("#usernameForm").onsubmit = async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true;
    try {
      const username = await claimUsername(uid, $("#usernameInput").value);
      setCustomer({ uid, email, username, role: "customer" }); closeDialog(true); toast("Gebruikersnaam ingesteld!"); if (!openPendingNotificationChat()) continuePendingQuoteRequest();
    } catch (err) { toast(err.message || "Gebruikersnaam opslaan mislukt"); }
    finally { btn.disabled = false; }
  };
}
function renderMaintenanceScreen() {
  const screen = $("#maintenanceScreen");
  if (!screen) return;
  const visible = state.maintenanceActive && !state.admin;
  const wasVisible = screen.dataset.active === "true";
  const justOpened = visible && !wasVisible;
  if (justOpened && !overlay.classList.contains("hidden")) closeDialog(true);
  screen.hidden = !visible;
  screen.dataset.active = String(visible);
  document.body.classList.toggle("maintenance-active", visible);
  for (const element of document.body.children) {
    if (["maintenanceScreen", "overlay", "toast"].includes(element.id)) continue;
    element.inert = visible;
  }
  if (justOpened) screen.focus({ preventScroll: true });
}
function setAdmin() {
  state.admin = true;
  fails = 0;
  sessionStorage.setItem("novashopAdmin", "1");
  refreshNav();
  renderMaintenanceScreen();
  syncPushForActiveAccount();
}
const CHAT_PUSH_CHOICE_KEY = "novashopChatPushChoice";
function showChatPushWelcome() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  if (!window.isSecureContext || state.maintenanceActive) return;
  let choice = "";
  try { choice = localStorage.getItem(CHAT_PUSH_CHOICE_KEY) || ""; } catch { }
  if (choice === "later" || Notification.permission === "denied") return;
  if (Notification.permission === "granted") {
    try { localStorage.setItem(CHAT_PUSH_CHOICE_KEY, "allowed"); } catch { }
    syncPushForActiveAccount();
    return;
  }
  // Voorkom dat deze introductie over een loginvenster of andere dialoog heen opent.
  if (!overlay.classList.contains("hidden")) return;
  openDialog(`<div class="push-welcome">
    <div class="push-welcome-icon" aria-hidden="true">🔔</div>
    <p class="eyebrow">BLIJF OP DE HOOGTE</p>
    <h2>Mis geen nieuw chatbericht</h2>
    <p class="muted">Ontvang een melding wanneer 3D Printed Shop een bericht stuurt in een van je chats. Je kunt dit later altijd aanpassen via je browserinstellingen.</p>
    <button type="button" class="primary full" id="allowChatPushWelcome">Meldingen toestaan</button>
    <button type="button" class="secondary full" id="laterChatPushWelcome">Niet nu</button>
    <small class="push-welcome-note">Na je klik vraagt je browser zelf om toestemming. Je keuze wordt onthouden.</small>
  </div>`);
  lockDialog = true;
  $("#closeDialog").hidden = true;
  $("#allowChatPushWelcome").onclick = async () => {
    const button = $("#allowChatPushWelcome");
    button.disabled = true;
    button.textContent = "Toestemming aanvragen…";
    try {
      // Dit verzoek start direct vanuit de klik zodat de browser de officiële prompt mag tonen.
      const permission = await requestChatPushPermission();
      if (permission !== "granted") {
        if (permission === "denied") {
          notificationWelcomeError("Meldingen zijn door je browser geblokkeerd. Je kunt dit wijzigen via de site-instellingen van je browser.");
        } else {
          button.disabled = false;
          button.textContent = "Opnieuw proberen";
        }
        return;
      }
      try { localStorage.setItem(CHAT_PUSH_CHOICE_KEY, "allowed"); } catch { }
      const hasAccount = !!state.admin || !!state.user?.uid;
      if (hasAccount) {
        const target = state.admin ? { role: "admin" } : { role: "customer", userId: state.user.uid };
        await enableChatPush(target);
      }
      closeDialog(true);
      toast(hasAccount ? "Chatmeldingen zijn ingeschakeld op dit apparaat." : "Toestemming opgeslagen. Log in om je chatmeldingen aan je account te koppelen.");
      syncPushForActiveAccount();
    } catch (error) {
      console.warn("Chatmeldingen instellen mislukt:", error);
      notificationWelcomeError(error.message || "Meldingen instellen is mislukt. Probeer het later opnieuw.");
    }
  };
  $("#laterChatPushWelcome").onclick = () => {
    try { localStorage.setItem(CHAT_PUSH_CHOICE_KEY, "later"); } catch { }
    closeDialog(true);
  };
  function notificationWelcomeError(message) {
    const note = document.querySelector(".push-welcome-note");
    if (note) { note.textContent = message; note.classList.add("is-error"); }
    const btn = $("#allowChatPushWelcome");
    if (btn) { btn.disabled = false; btn.textContent = "Opnieuw proberen"; }
  }
}
function scheduleChatPushWelcome(attempt = 0) {
  if (attempt > 24) return;
  window.setTimeout(() => {
    if (state.maintenanceActive) return;
    if (!overlay.classList.contains("hidden")) return scheduleChatPushWelcome(attempt + 1);
    showChatPushWelcome();
  }, attempt === 0 ? 900 : 500);
}

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
  const requiredGrams = filamentGramsFor(p) * Math.max(1, Number(c.qty) || 1);
  if (requiredGrams > 0) {
    const filamentChoice = selectionsOf(c).find(choice => choice.filamentId);
    if (!filamentChoice) return "Kies een filamentkleur";
    const filament = state.filaments.find(item => item.id === filamentChoice.filamentId && item.active !== false);
    if (!filament) return "De gekozen filamentkleur is niet meer beschikbaar";
    if (Number(filament.gramsAvailable || 0) < requiredGrams) return `Niet genoeg ${filament.name}-filament (nodig: ${requiredGrams} g, beschikbaar: ${Math.max(0, Number(filament.gramsAvailable) || 0)} g)`;
  }
  const allowedModelHexes = new Set(productColorChoices(p).map(c => c.hex.toLowerCase()));
  if (modelColorsOf(c).some(c => !allowedModelHexes.has(String(c.colorHex || "").toLowerCase()))) return "Een gekozen 3D-kleur is niet meer beschikbaar";
  const groups = optionGroupsOf(p), selected = selectionsOf(c);
  if (groups.length !== selected.length) return "Kies de productopties opnieuw";
  for (const group of groups) {
    const s = selected.find(x => x.label === group.label);
    if (group.inputType === "text") {
      if (!String(s?.value || "").trim()) return `Vul ${group.label.toLowerCase()} in`;
      continue;
    }
    const choice = (group.options || []).find(o => o.name === s?.value);
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
  if (groups.length !== chosen.length) return toast("Kies eerst alle productopties");
  let delta = 0;
  for (const group of groups) {
    const selected = chosen.find(x => x.label === group.label);
    if (group.inputType === "text") {
      if (!String(selected?.value || "").trim()) return toast(`Vul ${group.label.toLowerCase()} in`);
      continue;
    }
    const option = (group.options || []).find(o => o.name === selected?.value);
    if (!option) return toast(`Kies eerst een ${group.label.toLowerCase()}`);
    if (option.soldOut) return toast("Deze optie is uitverkocht");
    delta += Number(option.priceDelta) || 0;
  }
  const itemPrice = Math.max(0, Number(p.price) + delta);
  const key = itemKey(id, chosen, normalizedModelColors);
  const it = state.cart.find(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) === key);
  const nextQty = (it?.qty || 0) + 1;
  const gramNeed = filamentGramsFor(p) * nextQty;
  const selectedFilament = chosen.find(choice => choice.filamentId);
  if (gramNeed > 0) {
    const filament = state.filaments.find(item => item.id === selectedFilament?.filamentId && item.active !== false);
    if (!filament || Number(filament.gramsAvailable || 0) < gramNeed) return toast(`Niet genoeg filament voor ${nextQty} stuk(s) van dit product.`);
  }
  if (it) it.qty = nextQty;
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
let filamentSnapshotReceived = false;
function completeInitialProductLoad() {
  if (state.loaded || !productSnapshotReceived || !optionSetSnapshotReceived || !filamentSnapshotReceived || productLoadTimer !== null) return;
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
onValue(ref(db, "settings/filaments"), snap => {
  state.filaments = toList(snap).map(f => ({ ...f, hex: filamentHexOf(f) || "" })).sort((a, b) => String(a.name).localeCompare(String(b.name), "nl"));
  filamentSnapshotReceived = true;
  if (state.loaded) renderProducts();
  completeInitialProductLoad();
}, error => {
  console.error("Firebase filament inventory could not be loaded", error);
  state.filaments = [];
  filamentSnapshotReceived = true;
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
  const stepComplete = (group, selection) => group?.inputType === "text" ? !!String(selection?.value || "").trim() : !!selection;
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
          ${current.inputType === "text"
            ? `<div class="option-text-entry"><input id="productCustomText" type="text" maxlength="160" autocomplete="off" aria-label="${safe(current.label)}" placeholder="Typ hier je tekst…" value="${safe(currentChoice || "")}"><small>Vul de tekst in die je op dit product wilt laten zetten.</small></div>`
            : `<div class="option-choices">${(current.options || []).map((o, i) => {
                const active = currentChoice === o.name;
                return `<button type="button" class="option-choice ${active ? "active" : ""}" data-choice="${i}" ${o.soldOut ? "disabled" : ""}>
                  <span class="option-choice-title">${validColorHex(o.colorHex) ? `<i class="product-option-swatch" style="--option-color:${safe(normalizeColorHex(o.colorHex))}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(o.name)}</b></span>
                  <small>${deltaText(o.priceDelta)}${o.soldOut ? " · Uitverkocht" : ""}</small>
                </button>`;
              }).join("")}</div>`}
          <div class="option-wizard-actions">
            <button type="button" class="secondary" id="optionBack" ${step === 0 ? "disabled" : ""}><i data-lucide="chevron-left"></i> Vorige</button>
            ${step < groups.length - 1
              ? `<button type="button" class="primary" id="optionNext" ${!stepComplete(current, chosen[step]) ? "disabled" : ""}>Volgende stap <i data-lucide="arrow-right"></i></button>`
              : `<button type="button" class="primary" id="detailAdd" ${(!stepComplete(current, chosen[step]) || (p.model3d && !modelReady)) ? "disabled" : ""}><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen</button>`}
          </div>
          <div class="option-summary"><span>Prijs tot nu toe</span><b>${money(total)}</b></div>
          ${chosen.some(Boolean) ? `<div class="config-summary">${chosen.filter(Boolean).map(s => `<div class="config-summary-row"><span>${safe(s.label)}</span><b>${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(s.colorHex))}" aria-label="Kleurvoorbeeld"></i>` : ""}${safe(s.value)} · ${deltaText(s.priceDelta)}</b></div>`).join("")}</div>` : ""}
        </div>` : ""}
        ${!groups.length && !out ? `<button class="primary full" id="detailAdd" ${p.model3d && !modelReady ? "disabled" : ""}><i data-lucide="shopping-bag"></i> Toevoegen aan winkelwagen · ${money(p.price)}</button>` : ""}
        ${groups.length && !out && step === groups.length - 1 && groups.every((group, index) => stepComplete(group, chosen[index])) ? `<p class="hint">Je hebt alle ${groups.length} keuzes gemaakt. De prijs hierboven is inclusief alle toeslagen en kortingen.</p>` : ""}
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
          if (addButton) addButton.disabled = (groups.length ? !stepComplete(groups[step], chosen[step]) : false);
        }
      }).then(cleanupViewer => {
        if (thisGeneration === modelViewerGeneration && viewerRoot?.isConnected) modelViewerCleanup = cleanupViewer;
        else cleanupViewer?.();
      });
    }
    content.querySelectorAll("[data-image]").forEach(b => b.onclick = () => { activeImage = Number(b.dataset.image); render(); });
    content.querySelectorAll("[data-choice]").forEach(b => b.onclick = () => {
      const option = current.options[Number(b.dataset.choice)];
      chosen[step] = { label: current.label, value: option.name, priceDelta: Number(option.priceDelta) || 0, ...(validColorHex(option.colorHex) ? { colorHex: normalizeColorHex(option.colorHex) } : {}), ...(option.filamentId ? { filamentId: option.filamentId } : {}) };
      chosen = chosen.slice(0, step + 1); render();
    });
    $("#productCustomText")?.addEventListener("input", event => {
      const value = event.currentTarget.value;
      chosen[step] = { label: current.label, value, priceDelta: 0, inputType: "text" };
      const complete = stepComplete(current, chosen[step]);
      const nextButton = $("#optionNext"), addButton = $("#detailAdd");
      if (nextButton) nextButton.disabled = !complete;
      if (addButton) addButton.disabled = !complete || (p.model3d && !modelReady);
    });
    $("#optionBack")?.addEventListener("click", () => { step = Math.max(0, step - 1); render(); });
    $("#optionNext")?.addEventListener("click", () => { if (!stepComplete(current, chosen[step])) return; step = Math.min(groups.length - 1, step + 1); render(); });
    $("#detailAdd")?.addEventListener("click", () => {
      if (groups.some((group, index) => !stepComplete(group, chosen[index]))) return toast("Maak eerst alle keuzes af");
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
  openDialog(`<p class="eyebrow">JOUW SELECTIE</p><h2>Winkelwagen</h2>${state.cart.length ? `<div class="cart-lines">${state.cart.map(x => { const k = safe(itemKey(x.id, selectionsOf(x), modelColorsOf(x))), issue = state.loaded ? cartIssue(x) : "", choices = selectionsOf(x); return `<div class="cart-line"><div class="cart-line-info"><b>${safe(x.title)}</b>${choices.map(s => `<small>${safe(s.label)}: <b>${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(s.colorHex))}" aria-label="Kleurvoorbeeld"></i>` : ""}${safe(s.value)}</b> <span class="muted">(${deltaText(s.priceDelta)})</span></small>`).join("")}${modelColorsOf(x).map(c => `<small>3D ${safe(c.partName || "onderdeel")}: <i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(c.colorHex) || "#808080")}"></i> ${safe(c.colorName || c.colorHex || "kleur")}</small>`).join("")}<small>${money(x.price)} per stuk</small>${issue ? `<small class="line-issue">${safe(issue)}</small>` : ""}<div class="quantity-control"><button type="button" aria-label="Minder" data-qty="${k}" data-delta="-1">−</button><span>${x.qty}</span><button type="button" aria-label="Meer" data-qty="${k}" data-delta="1">＋</button></div></div><div class="cart-line-actions"><b>${money(x.price * x.qty)}</b><button class="remove-item" data-remove="${k}">Verwijder</button></div></div>`; }).join("")}</div><div class="cart-sum"><div><span>Subtotaal</span><span>${money(sub)}</span></div><div><span>Verzendkosten</span><span>${money(SHIPPING)} bij verzenden · ophalen gratis</span></div></div><div class="cart-total"><span>Producttotaal</span><b>${money(sub)}</b></div><div class="stack note-field"><label>Opmerking bij je bestelling (optioneel)<textarea id="orderNote" rows="3" maxlength="500" placeholder="Bijv. gewenste afwerking of een wens voor de kleur">${safe(state.orderNote)}</textarea></label></div><button class="primary full" id="checkout">Verder naar bestellen</button>` : `<div class="empty-state">Je winkelwagen is nog leeg.</div><button class="secondary full" id="continue">Verder winkelen</button>`}`);
  content.querySelectorAll("[data-remove]").forEach(b => b.onclick = () => { state.cart = state.cart.filter(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) !== b.dataset.remove); saveCart(); showCart(); });
  content.querySelectorAll("[data-qty]").forEach(b => b.onclick = () => {
    const it = state.cart.find(x => itemKey(x.id, selectionsOf(x), modelColorsOf(x)) === b.dataset.qty); if (!it) return;
    const nextQty = it.qty + Number(b.dataset.delta);
    if (nextQty > 0) {
      const issue = cartIssue({ ...it, qty: nextQty });
      if (issue) return toast(issue);
    }
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
        <aside class="quote-color-warning" role="note" aria-label="Let op bij de kleurkeuze"><span class="quote-color-warning-icon" aria-hidden="true">!</span><p><strong>Let op!</strong> De kleuren kunnen op zijn voor sommige producten als het veel filament kost. Ik hoop dat jullie hier begrip voor hebben.</p></aside>
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
function logoutCustomer() { const previousUid = state.user?.uid; if (previousUid) removeChatPushRegistration({ role: "customer", userId: previousUid }).catch(error => console.warn("Pushregistratie klant opruimen mislukt:", error)); if (favoritesUnsubscribe) { favoritesUnsubscribe(); favoritesUnsubscribe = null; } state.user = null; sessionStorage.removeItem("novashopUser"); state.favoriteIds = readGuestFavorites(); refreshNav(); if (state.loaded) renderProducts(); closeDialog(); toast("Je bent uitgelogd"); }
function logoutAdmin() { removeChatPushRegistration({ role: "admin" }).catch(error => console.warn("Pushregistratie beheerder opruimen mislukt:", error)); state.admin = false; sessionStorage.removeItem("novashopAdmin"); refreshNav(); closeDialog(); renderMaintenanceScreen(); toast("Je bent uitgelogd bij Sitebeheer"); }

/* ---------- voorraad reserveren bij bestelling ---------- */
async function reserveInventory(items) {
  // Filament wordt per kleur gereserveerd. Maatwerkoffertes hebben geen
  // filamentId en vallen bewust buiten deze voorraadadministratie.
  const requiredByFilament = new Map();
  for (const item of (items || [])) {
    if (!item?.id || String(item.id).startsWith("maatwerk-")) continue;
    const productSnap = await get(ref(db, `products/${item.id}`));
    const product = productSnap.val();
    if (!product) throw new Error(`Product ${item.title || "onbekend"} bestaat niet meer.`);
    const gramsPerUnit = Math.max(0, Number(product.filamentGramsPerUnit) || 0);
    if (!gramsPerUnit) continue;
    const selected = selectionsOf(item).find(choice => choice.filamentId);
    if (!selected?.filamentId) throw new Error(`Kies eerst een filamentkleur voor ${product.title || item.title}.`);
    const grams = gramsPerUnit * Math.max(1, Number(item.qty) || 1);
    const current = requiredByFilament.get(selected.filamentId) || { grams: 0, name: selected.value || "Filament" };
    current.grams += grams;
    requiredByFilament.set(selected.filamentId, current);
  }
  const reservations = [];
  try {
    for (const [filamentId, requirement] of requiredByFilament) {
      const filamentSnap = await get(ref(db, `settings/filaments/${filamentId}`));
      const filament = filamentSnap.val();
      if (!filament || filament.active === false) throw new Error(`De kleur ${requirement.name} is niet meer beschikbaar.`);
      const stockRef = ref(db, `settings/filaments/${filamentId}/gramsAvailable`);
      const tx = await runTransaction(stockRef, current => {
        const available = Number(current);
        if (!Number.isFinite(available) || available < requirement.grams) return;
        return Math.round((available - requirement.grams) * 100) / 100;
      }, { applyLocally: false });
      if (!tx.committed) throw new Error(`Niet genoeg ${filament.name || requirement.name}-filament. Nodig: ${requirement.grams} g.`);
      reservations.push({ filamentId, grams: requirement.grams });
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
      await runTransaction(ref(db, `settings/filaments/${reservation.filamentId}/gramsAvailable`), current => {
        const available = Number(current);
        if (!Number.isFinite(available)) return;
        return Math.round((available + reservation.grams) * 100) / 100;
      }, { applyLocally: false });
    } catch (error) { console.error("Filamentreservering kon niet worden teruggedraaid", error); }
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
        const selectionText = (item.selections || []).map(s => `${safe(s.label)}: ${validColorHex(s.colorHex) ? `<i class="product-option-swatch inline" style="--option-color:${safe(normalizeColorHex(s.colorHex))}" aria-label="Kleurvoorbeeld"></i>` : ""}<b>${safe(s.value)}</b>`).join(" · ");
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
    openDialog(`<div class="chat-shell"><div class="chat-heading"><div class="chat-title-wrap"><p class="eyebrow">3D PRINTED SHOP KLANTENSERVICE</p><h2>${isQuoteChat ? `Offerte · ${safe(c.quoteTitle || "Eigen product")}` : `Bestelling #${short(c.orderId)}`}</h2><small class="chat-subtitle">${safe(c.username || "Gesprek met 3D Printed Shop")}</small></div>${c.orderId ? `<button class="secondary" id="chatTrack">Bestelling volgen</button>` : `<span class="status-pill">Offertegesprek</span>`}</div><div class="chat-notice">${isQuoteChat ? (c.orderId ? `Deze offerte is omgezet naar bestelling #${short(c.orderId)}. Bespreek hier eventuele vragen over je bestelling.` : "Bespreek hier de mogelijkheden en details van je maatwerkproduct.") : "Deel hier je vraag, een link of een foto. Foto's worden automatisch sterk verkleind voordat ze worden opgeslagen."}</div><div class="chat-push-settings"><button type="button" class="secondary" id="enableChatNotifications">🔔 Meldingen inschakelen</button><small id="chatPushHint">Ontvang een browsermelding als er een nieuw bericht in deze chat staat. Je browser vraagt eerst toestemming.</small></div><div id="messages" class="messages" aria-live="polite"></div><div id="chatImagePending" class="chat-image-pending" hidden></div><form id="sendMessage" class="send-message"><label for="chatImageInput" class="chat-attach-button" title="Foto toevoegen" aria-label="Foto toevoegen"><i data-lucide="paperclip"></i></label><input id="chatImageInput" type="file" accept="image/*" hidden><input id="messageText" placeholder="Typ je bericht…" maxlength="1000" autocomplete="off"><button class="primary">Verstuur</button></form><small class="chat-upload-hint">Maximaal 12 MB origineel · automatisch verkleind tot ongeveer 65 KB.</small></div>`);
    if (window.lucide) window.lucide.createIcons();
    const notificationButton = $("#enableChatNotifications");
    const notificationHint = $("#chatPushHint");
    const chatPushTarget = { role: asAdmin ? "admin" : "customer", userId: asAdmin ? null : state.user?.uid, chatId: id };
    let chatPushEnabled = false;
    let chatPushPreferenceLoaded = false;
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      notificationButton.hidden = true;
      notificationHint.textContent = "Deze browser ondersteunt geen pushmeldingen.";
    } else if (Notification.permission === "denied") {
      notificationButton.disabled = true;
      notificationButton.textContent = "Meldingen geblokkeerd in browser";
      notificationHint.textContent = "Je hebt meldingen eerder geblokkeerd. Wijzig dit via de site-instellingen van je browser.";
    } else {
      notificationButton.textContent = "🔔 Meldingen voor deze chat inschakelen";
      notificationHint.textContent = "Je keuze wordt per chat in Firebase opgeslagen en blijft bewaard na opnieuw openen.";
      getChatPushPreference(chatPushTarget).then(enabled => {
        chatPushEnabled = enabled;
        chatPushPreferenceLoaded = true;
        notificationButton.textContent = enabled ? "✓ Meldingen voor deze chat aan" : "🔔 Meldingen voor deze chat inschakelen";
        notificationHint.textContent = enabled
          ? "Meldingen staan voor deze chat aan. Je kunt ze hier weer uitzetten."
          : "Meldingen staan voor deze chat uit. Schakel ze in om nieuwe berichten te ontvangen.";
      }).catch(error => {
        console.warn("Chatmeldingsvoorkeur kon niet worden geladen:", error);
        chatPushPreferenceLoaded = true;
        notificationHint.textContent = "De opgeslagen meldingskeuze kon niet worden geladen. Probeer opnieuw.";
      });
    }
    notificationButton.onclick = async () => {
      if (!chatPushPreferenceLoaded && Notification.permission !== "denied") {
        notificationHint.textContent = "Opgeslagen meldingsinstelling wordt geladen. Probeer zo nog eens.";
        return;
      }
      notificationButton.disabled = true;
      notificationButton.textContent = "Bezig…";
      try {
        if (chatPushEnabled) {
          await disableChatPushForChat(chatPushTarget);
          chatPushEnabled = false;
          notificationButton.textContent = "🔔 Meldingen voor deze chat inschakelen";
          notificationHint.textContent = "Meldingen staan voor deze chat uit. Je kunt ze later weer inschakelen.";
          toast("Meldingen voor deze chat zijn uitgezet.");
        } else {
          await enableChatPush(chatPushTarget);
          chatPushEnabled = true;
          notificationButton.textContent = "✓ Meldingen voor deze chat aan";
          notificationHint.textContent = "Meldingen staan voor deze chat aan. Je keuze is opgeslagen.";
          toast("Meldingen voor deze chat zijn opgeslagen.");
        }
      } catch (error) {
        console.warn("Chatmeldingen instellen mislukt:", error);
        notificationHint.textContent = error.message || "Chatmeldingen instellen is mislukt.";
        notificationButton.textContent = chatPushEnabled ? "✓ Meldingen voor deze chat aan" : "🔔 Opnieuw proberen";
      } finally {
        notificationButton.disabled = Notification.permission === "denied";
      }
    };
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
    const readByPath = asAdmin
      ? `chats/${id}/readBy/admins/sitebeheer`
      : `chats/${id}/readBy/customers/${state.user.uid}`;
    const locallyReadMessageIds = new Set();
    const pendingReadMessageIds = new Set();
    let pendingReadMessages = [];
    const markVisibleChatMessagesRead = async () => {
      const box = $("#messages");
      if (!box || !box.isConnected || document.visibilityState !== "visible" || !document.hasFocus()) return;
      // Alleen als de nieuwste berichten onderin zichtbaar zijn, gelden ze als gelezen.
      if (box.scrollHeight - box.scrollTop - box.clientHeight > 70) return;
      const incoming = pendingReadMessages.filter(message => message.sender !== "system" && message.sender !== (asAdmin ? "admin" : "user"));
      const updates = {};
      for (const message of incoming) {
        const messageId = String(message.id || "");
        if (!messageId || locallyReadMessageIds.has(messageId) || pendingReadMessageIds.has(messageId)) continue;
        updates[`${readByPath}/${messageId}`] = true;
        pendingReadMessageIds.add(messageId);
      }
      if (!Object.keys(updates).length) return;
      try {
        // Alleen berichten die daadwerkelijk zichtbaar zijn in een actieve chat krijgen een leesvink.
        await update(ref(db), updates);
        Object.keys(updates).forEach(path => {
          const messageId = path.slice(path.lastIndexOf("/") + 1);
          locallyReadMessageIds.add(messageId);
          pendingReadMessageIds.delete(messageId);
        });
      } catch (error) {
        Object.keys(updates).forEach(path => pendingReadMessageIds.delete(path.slice(path.lastIndexOf("/") + 1)));
        console.warn("Leesstatus chat kon niet worden opgeslagen:", error);
      }
    };
    const onChatVisibilityChange = () => markVisibleChatMessagesRead();
    document.addEventListener("visibilitychange", onChatVisibilityChange);
    window.addEventListener("focus", onChatVisibilityChange);
    const chatMessagesBox = $("#messages");
    chatMessagesBox?.addEventListener("scroll", onChatVisibilityChange, { passive: true });
    unsubs.push(() => {
      document.removeEventListener("visibilitychange", onChatVisibilityChange);
      window.removeEventListener("focus", onChatVisibilityChange);
      chatMessagesBox?.removeEventListener("scroll", onChatVisibilityChange);
    });
    listen(ref(db, `chats/${id}/messages`), snap => {
      const box = $("#messages"); if (!box) return;
      const msgs = toList(snap).sort((a, b) => a.createdAt - b.createdAt);
      pendingReadMessages = msgs;
      const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 70 || !box.children.length;
      box.innerHTML = msgs.map(m => `<div class="message ${m.sender === "admin" ? "theirs" : m.sender === "system" ? "system" : "mine"}">${chatMessageMarkup(m)}</div>`).join("");
      if (stick) box.scrollTop = box.scrollHeight;
      markVisibleChatMessagesRead();
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
  $("#adminEmail")?.focus();
  $("#adminLoginForm").onsubmit = async e => {
    e.preventDefault(); if (locked()) return;
    const email = $("#adminEmail").value.trim().toLowerCase(), pw = $("#adminPassword").value;
    const hash = await hashPw(pw, CFG.salt, CFG.iterations);
    if (email !== CFG.adminEmail.toLowerCase() || hash !== CFG.hash) return failed();
    setAdmin(); closeDialog(); if (!openPendingNotificationChat()) adminPanel();
  };
}
function dashboardTab(target) {
  let orders = [], products = [], filaments = [];
  const draw = () => {
    if (!target.isConnected) return;
    const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const received = orders.filter(order => order.paymentStatus === "paid").reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const openOrders = orders.filter(order => order.status !== "bezorgd").length;
    const lowStock = filaments.filter(filament => filament.active !== false && Number(filament.gramsAvailable || 0) <= Number(filament.lowStockThreshold ?? 100));
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
    target.innerHTML = `<div class="dashboard-welcome"><div><p class="eyebrow">OVERZICHT · 3D PRINTED SHOP</p><h3>Jouw webshop in één oogopslag</h3><p class="muted">Live overzicht van bestellingen, omzet en filamentvoorraad.</p></div><span class="dashboard-live"><i></i> Live gegevens</span></div>
      <div class="dashboard-kpis">
        <article class="dashboard-kpi"><span>Totale bestelwaarde</span><strong>${money(totalRevenue)}</strong><small>Alle geregistreerde bestellingen</small></article>
        <article class="dashboard-kpi"><span>Ontvangen betalingen</span><strong>${money(received)}</strong><small>Als betaald of niet van toepassing gemarkeerd</small></article>
        <article class="dashboard-kpi"><span>Bestellingen open</span><strong>${openOrders}</strong><small>Wachten nog op afronding</small></article>
        <article class="dashboard-kpi ${lowStock.length ? "warning" : ""}"><span>Filament bijna op</span><strong>${lowStock.length}</strong><small>${lowStock.length ? "Kleuren vragen aandacht" : "Geen filamentwaarschuwingen"}</small></article>
      </div>
      <div class="dashboard-grid"><section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Bestelwaarde · afgelopen 7 dagen</h3><p class="muted">Op basis van de besteldatum</p></div><span class="dashboard-total">${money(daily.reduce((sum,d)=>sum+d.value,0))}</span></div><div class="dashboard-bars">${daily.map(day => `<div class="dashboard-bar-col"><strong>${day.value ? money(day.value) : "—"}</strong><div class="dashboard-bar-track"><i style="height:${Math.max(day.value ? 8 : 2, day.value / maxDaily * 100)}%"></i></div><small>${day.label}</small></div>`).join("")}</div></section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Meest verkochte producten</h3><p class="muted">Op basis van aantal bestelde stuks</p></div></div>${topList.length ? `<div class="dashboard-top-list">${topList.map((item,index)=>`<div><span class="dashboard-rank">${index+1}</span><span class="dashboard-product-name">${safe(item.title)}</span><b>${item.quantity}×</b></div>`).join("")}</div>` : `<p class="muted">Er zijn nog geen productverkopen geregistreerd.</p>`}</section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Filamentmeldingen</h3><p class="muted">Kleuren op of onder hun voorraadgrens</p></div><button type="button" class="secondary" id="dashboardStockLink">Filament beheren</button></div>${lowStock.length ? `<div class="dashboard-top-list">${lowStock.slice(0,6).map(filament=>`<div><span class="stock-alert-dot"></span><span class="dashboard-product-name"><i class="product-option-swatch inline" style="--option-color:${safe(filamentHexOf(filament) || "#808080")}"></i> ${safe(filament.name)}</span><b>${Math.max(0,Number(filament.gramsAvailable)||0)} g</b></div>`).join("")}</div>` : `<p class="muted">Alle filamentkleuren zijn op peil.</p>`}</section>
      <section class="dashboard-panel"><div class="dashboard-panel-head"><div><h3>Recente bestellingen</h3><p class="muted">De vijf nieuwste aanvragen</p></div><button type="button" class="secondary" id="dashboardOrdersLink">Bestellingen bekijken</button></div>${orders.length ? `<div class="dashboard-top-list">${[...orders].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,5).map(order=>`<div><span class="dashboard-order-dot"></span><span class="dashboard-product-name">${safe(order.username||"Klant")} · #${short(order.id)}</span><b>${money(order.total)}</b></div>`).join("")}</div>` : `<p class="muted">Nog geen bestellingen.</p>`}</section></div>`;
    $("#dashboardStockLink")?.addEventListener("click", () => { state.tab = "filament"; adminTab(); });
    $("#dashboardOrdersLink")?.addEventListener("click", () => { state.tab = "orders"; adminTab(); });
  };
  listen(ref(db, "orders"), snap => { orders = toList(snap); draw(); });
  listen(ref(db, "products"), snap => { products = toList(snap); draw(); });
  listen(ref(db, "settings/filaments"), snap => { filaments = toList(snap).map(f => ({ ...f, hex: filamentHexOf(f) || "" })); draw(); });
}
function filamentTab(target) {
  let filaments = [];
  const draw = () => {
    if (!target.isConnected) return;
    const active = filaments.filter(item => item.active !== false);
    const totalGrams = active.reduce((sum, item) => sum + Math.max(0, Number(item.gramsAvailable) || 0), 0);
    const low = active.filter(item => Number(item.gramsAvailable || 0) <= Number(item.lowStockThreshold ?? 100));
    target.innerHTML = `<div class="admin-toolbar"><div><h3>Filamentbeheer</h3><p class="muted">Beheer je kleurenpalet en gramvoorraad. Actieve kleuren verschijnen automatisch bij alle gewone producten; offertes gebruiken hun eigen kleurenlijst.</p></div><div class="filament-toolbar-actions"><button type="button" class="secondary" id="downloadFilamentOverview">Download overzicht</button><span class="status-pill">${active.length} actieve kleuren</span></div></div>
      <div class="inventory-summary filament-summary"><div><small>Actieve kleuren</small><b>${active.length}</b></div><div><small>Filament op voorraad</small><b>${Math.round(totalGrams * 10) / 10} g</b></div><div><small>Lage voorraad</small><b>${low.length}</b></div></div>
      <form id="filamentCreateForm" class="filament-create-form"><label>Naam van de kleur<input name="name" maxlength="50" required placeholder="Bijv. Mat zwart"></label><label>Kies een kleur<div class="filament-color-picker"><input name="hex" type="color" value="#222222" aria-label="Kleur kiezen"><span>Gebruik het kleurenpalet</span></div></label><label>Hoeveelheid op voorraad (gram)<input name="gramsAvailable" type="number" min="0" max="1000000" step="0.1" value="1000" required></label><label>Materiaal<select name="material"><option>PLA</option><option>PETG</option><option>ABS</option><option>TPU</option><option>Andere</option></select></label><label>Waarschuwingsgrens (gram)<input name="lowStockThreshold" type="number" min="0" max="1000000" step="1" value="100" required></label><button type="submit" class="primary">Kleur toevoegen</button></form>
      <div class="filament-list">${filaments.length ? filaments.map(item => {
        const grams = Math.max(0, Number(item.gramsAvailable) || 0), threshold = Math.max(0, Number(item.lowStockThreshold ?? 100) || 0), isLow = item.active !== false && grams <= threshold;
        return `<form class="filament-row ${isLow ? "is-low" : ""} ${item.active === false ? "is-inactive" : ""}" data-filament-form="${safe(item.id)}"><div class="filament-color-preview"><span style="--filament-color:${safe(filamentHexOf(item) || "#808080")}"></span></div><label>Naam<input name="name" maxlength="50" required value="${safe(item.name || "")}"></label><label>Kleurpalet<input name="hex" type="color" value="${safe(filamentHexOf(item) || "#808080")}" aria-label="${safe(item.name || "Filamentkleur")} kleur kiezen"></label><label>Voorraad (gram)<input name="gramsAvailable" type="number" min="0" max="1000000" step="0.1" value="${grams}" required></label><label>Materiaal<select name="material">${["PLA","PETG","ABS","TPU","Andere"].map(m => `<option ${String(item.material || "PLA") === m ? "selected" : ""}>${m}</option>`).join("")}</select></label><label>Waarschuw bij (gram)<input name="lowStockThreshold" type="number" min="0" max="1000000" step="1" value="${threshold}" required></label><div class="filament-row-actions"><small>${item.active === false ? "Niet zichtbaar bij producten" : isLow ? "Bijna op" : "Actief bij producten"} · ${grams} g</small><button type="submit" class="primary">Opslaan</button><button type="button" class="secondary" data-filament-toggle="${safe(item.id)}">${item.active === false ? "Activeren" : "Pauzeren"}</button><button type="button" class="remove-item" data-filament-delete="${safe(item.id)}">Verwijderen</button></div></form>`;
      }).join("") : `<p class="empty-state">Je hebt nog geen filamentkleuren toegevoegd. Voeg hierboven je eerste kleur toe.</p>`}</div>
      <p class="hint filament-private-note">Het gramverbruik per product is alleen zichtbaar in Sitebeheer. Bij een bestelling wordt het opgegeven aantal gram automatisch van de gekozen kleur afgehaald. Een kleur wordt automatisch uitverkocht voor een product zodra er minder gram over is dan dat product nodig heeft.</p>`;
    const downloadButton = target.querySelector("#downloadFilamentOverview");
    if (downloadButton) downloadButton.onclick = () => {
      if (!filaments.length) return toast("Er zijn nog geen filamentkleuren om te downloaden.");
      // Export all filament entries (including paused colours), using the latest
      // values received from Firebase. Keep the file limited to the three
      // columns requested for the stock overview.
      const csvCell = value => `"${String(value ?? "").replace(/"/g, '""')}"`;
      const rows = [
        ["Kleur", "Materiaal", "Aantal over (gram)"],
        ...filaments.map(item => [
          item.name || "Onbenoemde kleur",
          item.material || "Niet opgegeven",
          new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 1 }).format(Math.max(0, Number(item.gramsAvailable) || 0))
        ])
      ];
      const csv = "\uFEFF" + rows.map(row => row.map(csvCell).join(";")).join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `filamentvoorraad-${date}.csv`;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Filamentoverzicht gedownload.");
    };
    const createForm = target.querySelector("#filamentCreateForm");
    createForm.onsubmit = async event => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
      const name = String(data.get("name") || "").trim(), hex = String(data.get("hex") || "").toLowerCase(), gramsAvailable = Number(data.get("gramsAvailable")), lowStockThreshold = Number(data.get("lowStockThreshold")), material = String(data.get("material") || "PLA");
      if (!name || !validColorHex(hex) || !Number.isFinite(gramsAvailable) || gramsAvailable < 0 || !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) return toast("Controleer de kleurnaam, kleur en gramhoeveelheden.");
      if (filaments.some(item => String(item.name).toLocaleLowerCase("nl") === name.toLocaleLowerCase("nl") && item.active !== false)) return toast("Deze filamentkleur bestaat al.");
      const id = push(ref(db, "settings/filaments")).key;
      const button = form.querySelector("button[type=submit]"); button.disabled = true;
      try { await set(ref(db, `settings/filaments/${id}`), { name, hex, gramsAvailable: Math.round(gramsAvailable * 10) / 10, lowStockThreshold, material, active: true, createdAt: Date.now(), updatedAt: Date.now() }); toast("Filamentkleur toegevoegd. De kleur verschijnt automatisch bij producten."); }
      catch (error) { console.error("Filamentkleur toevoegen mislukt", error); toast("Filamentkleur toevoegen mislukt. Controleer de Firebase-regels."); }
      finally { button.disabled = false; }
    };
    target.querySelectorAll("[data-filament-form]").forEach(form => {
      form.onsubmit = async event => {
        event.preventDefault(); const id = form.dataset.filamentForm, data = new FormData(form);
        const name = String(data.get("name") || "").trim(), hex = String(data.get("hex") || "").toLowerCase(), gramsAvailable = Number(data.get("gramsAvailable")), lowStockThreshold = Number(data.get("lowStockThreshold")), material = String(data.get("material") || "PLA");
        if (!name || !validColorHex(hex) || !Number.isFinite(gramsAvailable) || gramsAvailable < 0 || !Number.isFinite(lowStockThreshold) || lowStockThreshold < 0) return toast("Controleer de ingevulde filamentgegevens.");
        if (filaments.some(item => item.id !== id && String(item.name).toLocaleLowerCase("nl") === name.toLocaleLowerCase("nl") && item.active !== false)) return toast("Een andere actieve kleur heeft deze naam al.");
        const button = form.querySelector("button[type=submit]"); button.disabled = true;
        try {
          // Save only this filament's fields. The live Firebase listener can update
          // the local list while a form is being edited; avoid replacing the form
          // DOM until this save finishes so user input is not lost mid-edit.
          await update(ref(db, `settings/filaments/${id}`), { name, hex, gramsAvailable: Math.round(gramsAvailable * 10) / 10, lowStockThreshold, material, updatedAt: Date.now() });
          toast("Filamentvoorraad opgeslagen.");
          // Render the latest snapshot after the confirmed write.
          draw();
        }
        catch (error) { console.error("Filament opslaan mislukt", error); toast("Filament opslaan mislukt. Controleer de Firebase-regels."); }
        finally { button.disabled = false; }
      };
    });
    target.querySelectorAll("[data-filament-toggle]").forEach(button => button.onclick = async () => {
      const item = filaments.find(value => value.id === button.dataset.filamentToggle); if (!item) return;
      try { await update(ref(db, `settings/filaments/${item.id}`), { active: item.active === false, updatedAt: Date.now() }); toast(item.active === false ? "Filamentkleur weer actief" : "Filamentkleur gepauzeerd"); }
      catch (error) { console.error(error); toast("Filamentkleur bijwerken mislukt."); }
    });
    target.querySelectorAll("[data-filament-delete]").forEach(button => button.onclick = async () => {
      const item = filaments.find(value => value.id === button.dataset.filamentDelete); if (!item) return;
      if (!confirm(`Filamentkleur ${item.name} definitief verwijderen? Deze kleur verdwijnt dan ook uit de productkeuzes.`)) return;
      try { await remove(ref(db, `settings/filaments/${item.id}`)); toast("Filamentkleur verwijderd"); }
      catch (error) { console.error(error); toast("Filamentkleur verwijderen mislukt."); }
    });
  };
  listen(ref(db, "settings/filaments"), snap => {
    filaments = toList(snap).map(f => ({ ...f, hex: filamentHexOf(f) || "" })).sort((a,b) => String(a.name).localeCompare(String(b.name), "nl"));
    // Firebase emits snapshots for any update. Rebuilding this list while a user
    // is typing in a filament row discards their unsaved input, so defer redraw.
    if (!target.querySelector("[data-filament-form]:focus-within")) draw();
  });
}

function adminPanel() {
  if (!state.admin) return openAdminLogin();
  openDialog(`<div class="admin-head"><div><p class="eyebrow">3D PRINTED SHOP</p><h2>Sitebeheer</h2></div><span class="admin-label">BEHEERDER</span></div><div class="tabs admin-tabs"><button data-tab="dashboard">Dashboard</button><button data-tab="products">Producten</button><button data-tab="filament">Filamentbeheer</button><button data-tab="categories">Categorieën</button><button data-tab="orders">Track & trace</button><button data-tab="myorders">Mijn bestellingen</button><button data-tab="history">Bestellingen</button><button data-tab="agenda">Agenda</button><button data-tab="chats">Chats</button><button data-tab="quotes">Offertes</button><button data-tab="camera">Camera</button><button data-tab="contact">Contactpagina</button><button data-tab="maintenance">Onderhoud</button><button id="adminLogout">Uitloggen</button></div><div id="adminContent"></div>`);
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
function maintenanceAdminTab(target) {
  if (!state.admin) return openAdminLogin();
  const active = state.maintenanceActive;
  target.innerHTML = `<section class="maintenance-admin-card">
    <div class="maintenance-admin-icon" aria-hidden="true">${active ? "⚠" : "✓"}</div>
    <div class="maintenance-admin-copy">
      <p class="eyebrow">WEBSHOPSTATUS</p>
      <h3>${active ? "Onderhoudsmodus staat aan" : "De website is online"}</h3>
      <p class="muted">${active ? "Bezoekers zien momenteel alleen de onderhoudsmelding. Jij kunt de website blijven beheren." : "De webshop is zichtbaar voor bezoekers en werkt normaal."}</p>
      <div class="maintenance-admin-state ${active ? "is-active" : "is-online"}"><span></span>${active ? "Onderhoud actief" : "Website online"}</div>
    </div>
    <button type="button" class="${active ? "secondary" : "primary"}" id="maintenanceToggle">${active ? "Website weer online zetten" : "Website in onderhoud zetten"}</button>
  </section>
  <div class="maintenance-admin-help"><b>Hoe kom je er weer in?</b><p>Wanneer de onderhoudspagina actief is, druk je op de letter <kbd>S</kbd> op je toetsenbord. Daarna kun je met je Sitebeheer-e-mailadres en wachtwoord inloggen.</p></div>`;
  const button = $("#maintenanceToggle");
  button.onclick = async () => {
    if (!state.admin) return openAdminLogin();
    const next = !state.maintenanceActive;
    if (next && !confirm("Weet je zeker dat je de webshop in onderhoud wilt zetten? Bezoekers zien dan alleen de onderhoudsmelding.")) return;
    button.disabled = true;
    try {
      await set(ref(db, "settings/maintenance"), { active: next, updatedAt: Date.now() });
      state.maintenanceActive = next;
      renderMaintenanceScreen();
      toast(next ? "Onderhoudsmodus ingeschakeld." : "De website is weer online.");
      maintenanceAdminTab(target);
    } catch (error) {
      console.error("Onderhoudsmodus opslaan mislukt", error);
      toast("Onderhoudsmodus opslaan mislukt. Controleer de Firebase-regels.");
      button.disabled = false;
    }
  };
}

function adminTab() {
  content.querySelectorAll("[data-tab]").forEach(x => x.classList.toggle("active", x.dataset.tab === state.tab));
  cleanup(); const target = $("#adminContent"); if (!target) return;
  target.innerHTML = firebaseLoadingMarkup("Firebase-gegevens laden…");
  if (state.tab === "dashboard") dashboardTab(target);
  else if (state.tab === "filament") filamentTab(target);
  else if (state.tab === "products") {
    let ps = [];
    const drawProducts = () => {
      if (!target.isConnected) return;
      target.innerHTML = `<div class="admin-toolbar"><h3>Producten beheren</h3><button class="primary" id="newProduct"><i data-lucide="plus"></i> Product toevoegen</button></div>${ps.length ? ps.map(p => { const groups = storedOptionGroupsOf(p); return `<div class="admin-row"><div class="admin-product">${p.image ? `<img src="${safe(p.image)}" alt="">` : "✦"}<div><b>${safe(p.title)}</b>${isSoldOut(p) ? ` <span class="badge-out">UITVERKOCHT</span>` : ""}${p.optionSetId ? ` <span class="status-pill" title="Deze productkeuzes worden gedeeld met andere producten">LIVE GEKOPPELD</span>` : ""}${p.model3d ? ` <span class="status-pill">3D MODEL</span>` : ""}<small>${money(p.price)}${p.categoryId && categoryLabel(p.categoryId) ? ` · ${safe(categoryLabel(p.categoryId))}` : ""}${filamentGramsFor(p) ? ` · ${filamentGramsFor(p)} g filament per stuk` : ""}${p.customTextEnabled && p.customTextLabel ? ` · eigen tekst: ${safe(p.customTextLabel)}` : ""}</small>${groups.map((g, gi) => `<div class="opt-admin"><small>${safe(g.label)}:</small>${g.options.map((o, oi) => `<button type="button" class="opt-toggle ${o.soldOut ? "out" : ""}" data-optout="${safe(p.id)}" data-g="${gi}" data-i="${oi}" title="Klik om uitverkocht aan/uit te zetten">${safe(o.name)} · ${deltaText(o.priceDelta)}${o.soldOut ? " · uitverkocht" : ""}</button>`).join("")}</div>`).join("")}</div></div><div class="admin-actions"><button class="secondary" data-soldout="${safe(p.id)}">${p.soldOut ? "Weer beschikbaar" : "Uitverkocht"}</button> <button class="secondary" data-edit="${safe(p.id)}">Bewerken</button> <button class="remove-item" data-delete="${safe(p.id)}">Verwijderen</button></div></div>`; }).join("") : "<p class='muted'>Je hebt nog geen producten toegevoegd.</p>"}`;
      $("#newProduct").onclick = () => productEditor();
      target.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => productEditor(b.dataset.edit));
      target.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => { if (confirm("Dit product verwijderen?")) { await remove(ref(db, "products/" + b.dataset.delete)); toast("Product verwijderd"); } });
      target.querySelectorAll("[data-soldout]").forEach(b => b.onclick = () => { const p = ps.find(x => x.id === b.dataset.soldout); if (p) update(ref(db, "products/" + p.id), { soldOut: !p.soldOut }).then(() => toast(p.soldOut ? "Product weer beschikbaar" : "Product op uitverkocht gezet")).catch(() => toast("Opslaan mislukt")); });
      target.querySelectorAll("[data-optout]").forEach(b => b.onclick = () => {
        const p = ps.find(x => x.id === b.dataset.optout), gIndex = Number(b.dataset.g), oIndex = Number(b.dataset.i), g = p && storedOptionGroupsOf(p)[gIndex], o = g && g.options[oIndex];
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
  else if (state.tab === "maintenance") maintenanceAdminTab(target);
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
    import("three/addons/controls/OrbitControls.js")
  ]).then(([THREE, stl, controls]) => ({ THREE, STLLoader: stl.STLLoader, OrbitControls: controls.OrbitControls })).catch(error => { threeToolkitPromise = null; throw error; });
  return threeToolkitPromise;
}

// Bambu Studio, OrcaSlicer and PrusaSlicer can store the actual meshes in
// separate 3D/Objects/*.model parts (3MF Production Extension). The stock
// Parse the ZIP package directly so each uploaded model is handled
// consistently, including external 3MF Production Extension references
// (p:path), without filename-specific fallbacks or converted assets.
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
  const normalizePath = (value, basePath = "") => {
    let path = String(value || "").replace(/\\/g, "/");
    try { path = decodeURIComponent(path); } catch (_) { /* Keep literal ZIP path if it is not URI encoded. */ }
    if (!path.startsWith("/" ) && basePath) path = `${basePath.slice(0, basePath.lastIndexOf("/") + 1)}${path}`;
    const segments = [];
    for (const segment of path.split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") { if (segments.length) segments.pop(); continue; }
      segments.push(segment);
    }
    return segments.join("/");
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
  const pathAttribute = node => {
    if (!node) return "";
    const namespaced = node.getAttributeNS?.(productionNamespace, "path");
    if (namespaced) return namespaced;
    for (const attribute of Array.from(node.attributes || [])) {
      if (attribute.localName === "path" && (!attribute.namespaceURI || attribute.namespaceURI === productionNamespace)) return attribute.value;
    }
    return node.getAttribute("p:path") || node.getAttribute("path") || "";
  };
  let rootPath = "3D/3dmodel.model";
  if (zipEntries.has("_rels/.rels")) {
    const relDoc = await parseXml("_rels/.rels");
    const relationships = Array.from(relDoc.getElementsByTagNameNS?.("*", "Relationship") || relDoc.getElementsByTagName("Relationship"));
    const startPart = relationships.find(rel => /3dmodel/i.test(rel.getAttribute("Type") || ""));
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
  const makeMesh = (objectNode, objectId, unit = "millimeter") => {
    const meshNode = firstChild(objectNode, "mesh");
    if (!meshNode) return null;
    const verticesNode = firstChild(meshNode, "vertices");
    const trianglesNode = firstChild(meshNode, "triangles");
    const vertices = children(verticesNode, "vertex");
    const triangles = children(trianglesNode, "triangle");
    if (!vertices.length || !triangles.length) return null;
    const unitScale = ({ micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 })[String(unit || "millimeter").toLowerCase()] || 1;
    const positions = new Float32Array(vertices.length * 3);
    vertices.forEach((vertex, index) => {
      positions[index * 3] = Number(vertex.getAttribute("x")) * unitScale;
      positions[index * 3 + 1] = Number(vertex.getAttribute("y")) * unitScale;
      positions[index * 3 + 2] = Number(vertex.getAttribute("z")) * unitScale;
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
    const mesh = makeMesh(objectNode, objectId, part.unit);
    if (mesh) group.add(mesh);
    const componentsNode = firstChild(objectNode, "components");
    for (const component of children(componentsNode, "component")) {
      const referencedPath = pathAttribute(component);
      const childPart = referencedPath ? normalizePath(referencedPath, partPath) : partPath;
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
    const referencedPath = pathAttribute(item);
    const itemPath = referencedPath ? normalizePath(referencedPath, rootPath) : rootPath;
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
    const [{ THREE, STLLoader, OrbitControls }, buffer] = await Promise.all([loadThreeToolkit(), decodeProductModel(model)]);
    if (disposed || !root.isConnected) return cleanup;
    if (model.format === "stl") {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      modelRoot = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x9aa7b8, metalness: 0.08, roughness: 0.68 }));
      modelRoot.name = "Volledig model";
    } else if (model.format === "3mf") {
      // Always parse the uploaded 3MF itself. No filename-based fallback or
      // preconverted model is used, so every product follows the same path.
      // This parser supports normal 3MF meshes and Production Extension
      // references (p:path) to nested 3D/Objects/*.model parts.
      modelRoot = await parseProduction3MF(THREE, buffer);
    } else {
      throw new Error("Dit 3D-bestandstype wordt niet ondersteund. Upload een STL- of 3MF-bestand.");
    }
    if (!modelRoot) throw new Error("Het 3D-model kon niet worden gelezen.");
    // Zet de gebruikelijke 3MF-Z-as om naar de Y-as van Three.js voordat
    // we de grenzen bepalen. 3MF-build-items bevatten vaak ook een grote
    // bed-offset (bijv. 90, 90, 80 mm); die moet na het schalen volledig
    // worden weggehaald, anders blijft het model ver buiten beeld.
    modelRoot.rotation.x = -Math.PI / 2;
    modelRoot.updateMatrixWorld(true);
    const originalBounds = new THREE.Box3().setFromObject(modelRoot);
    const originalSize = originalBounds.getSize(new THREE.Vector3());
    const originalCenter = originalBounds.getCenter(new THREE.Vector3());
    const largestDimension = Math.max(originalSize.x, originalSize.y, originalSize.z);
    if (!Number.isFinite(largestDimension) || largestDimension <= 0) throw new Error("Het model bevat geen bruikbare driehoeken.");

    // Let op de volgorde: Object3D.position wordt niet door de eigen scale
    // vermenigvuldigd. Dus eerst schalen en daarna de positie instellen op
    // -center * scale. Alleen position.sub(center) laat een enorme offset over.
    const modelScale = 1.75 / largestDimension;
    modelRoot.scale.setScalar(modelScale);
    modelRoot.position.set(
      -originalCenter.x * modelScale,
      -originalCenter.y * modelScale,
      -originalCenter.z * modelScale
    );
    modelRoot.updateMatrixWorld(true);
    const normalizedBounds = new THREE.Box3().setFromObject(modelRoot);
    const normalizedSphere = normalizedBounds.getBoundingSphere(new THREE.Sphere());
    if (!Number.isFinite(normalizedSphere.radius) || normalizedSphere.radius <= 0) throw new Error("Het model kon niet goed in het previewvenster worden geplaatst.");

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
    const camera = new THREE.PerspectiveCamera(38, 1, 0.001, 1000);
    // Bereken de camera-afstand uit de echte modelgrootte. Zo blijven ook
    // heel kleine en grote STL/3MF-bestanden zichtbaar zonder vaste zoom.
    const viewDirection = new THREE.Vector3(1, 0.78, 1.15).normalize();
    const cameraDistance = Math.max(0.5, normalizedSphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.28);
    camera.position.copy(normalizedSphere.center).addScaledVector(viewDirection, cameraDistance);
    camera.near = Math.max(0.001, normalizedSphere.radius / 1000);
    camera.far = Math.max(100, cameraDistance + normalizedSphere.radius * 30);
    camera.updateProjectionMatrix();
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvas.style.width = "100%"; canvas.style.height = "100%"; canvas.style.display = "block";
    scene.add(new THREE.HemisphereLight(0xffffff, 0x708096, 2.1));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2); keyLight.position.set(4, 6, 5); scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xc6ddff, 1.0); fillLight.position.set(-4, 2, -4); scene.add(fillLight);
    scene.add(modelRoot);
    controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.07;
    controls.minDistance = Math.max(0.05, normalizedSphere.radius * 0.15);
    controls.maxDistance = Math.max(cameraDistance * 12, normalizedSphere.radius * 30);
    controls.target.copy(normalizedSphere.center);
    camera.lookAt(normalizedSphere.center);
    const resize = () => {
      if (!root.isConnected) return;
      const rect = root.getBoundingClientRect();
      const width = Math.floor(rect.width), height = Math.floor(rect.height);
      // Niet renderen met een geforceerde maat wanneer de dialoog nog verborgen is.
      // ResizeObserver probeert opnieuw zodra het previewvak echt zichtbaar is.
      if (width < 1 || height < 1) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe(root); resize();
    requestAnimationFrame(resize);
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
    if (status) status.textContent = "3D-model zichtbaar · sleep om te draaien.";
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
  let groups = storedOptionGroupsOf(p).map(g => ({ label: g.label, options: g.options.map(o => ({ ...o })) }));
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
        <p class="hint">Upload een STL- of 3MF-bestand van maximaal 10 MB. Het originele bestand wordt ongewijzigd in kleine delen opgeslagen in de gratis Firebase Realtime Database; Firebase Storage en een betaald abonnement zijn hiervoor niet nodig. Het model wordt pas gedownload wanneer een klant de productpagina opent. Klanten kunnen het model draaien en alleen kiezen uit actieve kleurstaaltjes van dit product. Elk product gebruikt zijn eigen originele upload; er is geen bestandsnaam-afhankelijke reserveweergave. STL heeft één kleurdeel; de afzonderlijke objecten en componenten uit 3MF worden als aparte onderdelen ingelezen.</p>
        <div id="modelFileStatus" class="model-file-status">${p.model3d ? `<b>${safe(p.model3d.name || "3D-model")}</b><small>${safe(String(p.model3d.format || "").toUpperCase())} · ${formatFileSize(p.model3d.originalBytes || 0)} origineel · ${formatFileSize(p.model3d.storedBytes || 0)} opgeslagen (${p.model3d.databasePath ? "gratis database-opslag" : p.model3d.encoding === "gzip" ? "gzip gecomprimeerd" : "bestaand model"})</small>` : "Nog geen 3D-model toegevoegd."}</div>
        <button type="button" class="secondary" id="remove3DModel" ${p.model3d ? "" : "hidden"}>3D-model verwijderen</button>
      </fieldset>
      <fieldset class="opt-editor"><legend>Filamentverbruik · alleen zichtbaar in Sitebeheer</legend>
        <label>Filamentverbruik per productstuk (gram)<input id="pFilamentGrams" type="number" min="0" max="100000" step="0.1" value="${Math.max(0, Number(p.filamentGramsPerUnit) || 0)}" placeholder="Bijv. 85"></label>
        <small class="hint">Dit aantal is nooit zichtbaar voor klanten. Bij elke bestelling wordt dit aantal gram afgetrokken van de voorraad van de gekozen filamentkleur. Een kleur is automatisch uitverkocht als er minder gram beschikbaar is dan dit product nodig heeft.</small>
      </fieldset>
      <fieldset class="opt-editor"><legend>Productopties en prijsaanpassingen</legend>
        <div class="choice-copy-row"><label>Product om live mee te koppelen<select id="copyOptionsFrom"><option value="">Selecteer een product…</option>${availableProducts.filter(source => source.id !== id && storedOptionGroupsOf(source).length).map(source => `<option value="${safe(source.id)}">${safe(source.title)}</option>`).join("")}</select></label><button type="button" class="secondary" id="copyOptionsBtn">Live koppelen</button></div>
        <p id="optionLinkStatus" class="hint">${linkedOptionSetId ? "Dit product gebruikt een gedeelde keuzeset. Wijzigingen worden voor alle gekoppelde producten gepubliceerd zodra je opslaat." : "Dit product heeft eigen keuzes. Kies een ander product en gebruik Live koppelen om dezelfde keuzes voortaan samen te beheren."}</p>
        <button type="button" class="secondary" id="unlinkOptionSet" ${linkedOptionSetId ? "" : "hidden"}>Loskoppelen en zelfstandig maken</button>
        <div id="optionGroupsEditor" class="choice-groups-editor"></div>
        <button type="button" class="secondary" id="addOptionGroup"><i data-lucide="plus"></i> Optiegroep toevoegen</button>
        <p class="hint">Elke optiegroep wordt één stap in de productconfigurator. Kleurvoorbeelden, prijsverschillen en uitverkocht-statussen worden gedeeld. Na opslaan zien alle gekoppelde producten de update automatisch via Firebase.</p>
      </fieldset>
      <fieldset class="opt-editor">
        <legend>Eigen tekst van de klant</legend>
        <label class="check"><input type="checkbox" id="pCustomTextEnabled" ${p.customTextEnabled === true ? "checked" : ""}> Klant mag zelf tekst invoeren</label>
        <label>Titel van het tekstveld<input id="pCustomTextLabel" maxlength="60" value="${safe(p.customTextLabel || "")}" placeholder="Bijv. Welke naam mag erop?" ${p.customTextEnabled === true ? "" : "disabled"}></label>
        <small class="hint">Als je dit aanzet, verschijnt bij het product een extra stap met dit opschrift. De klant kan daar zelf een tekst invullen (maximaal 160 tekens).</small>
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
  const customTextToggle = $("#pCustomTextEnabled"), customTextTitle = $("#pCustomTextLabel");
  customTextToggle.onchange = () => { customTextTitle.disabled = !customTextToggle.checked; };
  const refreshModelFileStatus = () => {
    const box = $("#modelFileStatus"), removeButton = $("#remove3DModel");
    if (box) box.innerHTML = model3d ? `<b>${safe(model3d.name || "3D-model")}</b><small>${safe(String(model3d.format || "").toUpperCase())} · ${formatFileSize(model3d.originalBytes || 0)} origineel · ${formatFileSize(model3d.storedBytes || 0)} opgeslagen (${model3d.databasePath ? "gratis database-opslag" : model3d.encoding === "gzip" ? "gzip gecomprimeerd" : "bestaand model"})</small>` : "Nog geen 3D-model toegevoegd.";
    if (removeButton) removeButton.hidden = !model3d;
  };
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
      groups = storedOptionGroupsOf({ optionSetId: setId }).map(g => ({ label: g.label, options: g.options.map(o => ({ ...o })) }));
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
    const optionGroups = groups.map(g => ({ label: String(g.label || "").trim(), options: g.options.map(o => ({ name: String(o.name || "").trim(), priceDelta: Number(o.priceDelta) || 0, soldOut: !!o.soldOut, ...(validColorHex(o.colorHex) ? { colorHex: normalizeColorHex(o.colorHex) } : {}) })).filter(o => o.name) })).filter(g => g.label || g.options.length);
    if (optionGroups.some(g => !g.label || !g.options.length)) return toast("Geef elke optiestap een naam en voeg minimaal één optie toe");
    if (new Set(optionGroups.map(g => g.label.toLowerCase())).size !== optionGroups.length) return toast("Elke optiestap moet een eigen naam hebben");
    const allNamesValid = optionGroups.every(g => new Set(g.options.map(o => o.name.toLowerCase())).size === g.options.length);
    if (!allNamesValid) return toast("Binnen een optiestap moeten de optienamen uniek zijn");
    const customTextEnabled = $("#pCustomTextEnabled").checked;
    const customTextLabel = String($("#pCustomTextLabel").value || "").trim();
    if (customTextEnabled && !customTextLabel) return toast("Vul een titel in voor het tekstveld van de klant.");
    if (customTextEnabled && optionGroups.some(group => group.label.toLocaleLowerCase("nl") === customTextLabel.toLocaleLowerCase("nl"))) return toast("De titel van het tekstveld moet anders zijn dan de andere keuzestappen.");
    if (customTextEnabled && customTextLabel.toLocaleLowerCase("nl") === "filamentkleur") return toast("Gebruik voor het tekstveld een andere titel dan Filamentkleur.");
    const filamentGramsPerUnit = Number($("#pFilamentGrams").value || 0);
    if (!Number.isFinite(filamentGramsPerUnit) || filamentGramsPerUnit < 0 || filamentGramsPerUnit > 100000) return toast("Vul een geldig gramverbruik in (0 tot 100.000 gram).");
    const btn = $("#pSave"); btn.disabled = true; btn.textContent = "Opslaan…";
    const now = Date.now();
    const data = { title: $("#pTitle").value.trim(), price, description: $("#pDescription").value.trim(), image: images[0] || "", images: images.slice(0, 3), model3d: model3d || null, active: true, categoryId: $("#pCategory").value || null, soldOut: $("#pSoldOut").checked, filamentGramsPerUnit: Math.round(filamentGramsPerUnit * 10) / 10, customTextEnabled, customTextLabel: customTextEnabled ? customTextLabel : "", stockTracked: null, stockQuantity: null, lowStockThreshold: null, optionSetId: linkedOptionSetId || null, optionGroups: linkedOptionSetId ? null : (optionGroups.length ? optionGroups : null), optionLabel: null, options: null, updatedAt: now };
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

/* ---------- uitgebreide webshop-FAQ + gesprek + online zoekassistent ----------
   Webshopvragen gebruiken de kennisbank en openbare product-/kleurgegevens.
   Voor algemene onderwerpen gebruikt de assistent Wikipedia's publieke
   MediaWiki-API en DuckDuckGo's Instant Answer API. De volledige DuckDuckGo-
   zoekresultaten openen via een gewone zoeklink (DDG heeft geen volledige
   openbare resultaten-API). Er worden geen klantprofielen, adressen,
   wachtwoorden, orders of privéchats opgehaald of meegestuurd.
*/
const assistantPanel = document.querySelector("#shopAssistantPanel");
const assistantToggle = document.querySelector("#shopAssistantToggle");
const assistantClose = document.querySelector("#shopAssistantClose");
const assistantMessages = document.querySelector("#shopAssistantMessages");
const assistantForm = document.querySelector("#shopAssistantForm");
const assistantInput = document.querySelector("#shopAssistantInput");
const assistantSearchMenuToggle = document.querySelector("#shopAssistantSearchMenuToggle");
const assistantSearchMenu = document.querySelector("#shopAssistantSearchMenu");
const assistantSuggestions = document.querySelector("#shopAssistantSuggestions");
let assistantBusy = false;
const assistantConversationHistory = [];
let assistantLastBotText = "";

function assistantNormalize(value) {
  return String(value ?? "").toLocaleLowerCase("nl-NL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[-‐‑–—]/g, " ").replace(/[^a-z0-9#€., -]/g, " ").replace(/\s+/g, " ").trim();
}
function assistantTokens(value) {
  const stop = new Set(["heb", "heeft", "hebben", "kan", "kun", "jullie", "ik", "wij", "ons", "onze", "de", "het", "een", "voor", "van", "met", "op", "in", "is", "zijn", "er", "wat", "hoe", "welke", "waar", "wil", "graag", "dit", "deze", "dat", "die", "als", "naar", "bij", "en", "of", "maar", "me", "mij", "je", "jouw", "kunnen", "zou", "willen", "mag", "moet", "dan", "ook", "eens", "even", "mijn", "ons", "onze", "kan", "kunnen"]);
  return assistantNormalize(value).split(/\s+/).filter(token => token.length > 2 && !stop.has(token));
}
function assistantAddMessage(text, role = "bot", actions = []) {
  if (!assistantMessages) return null;
  const bubble = document.createElement("div");
  bubble.className = `shop-assistant-message ${role}`;
  const paragraph = document.createElement("p");
  paragraph.textContent = String(text ?? "");
  bubble.append(paragraph);
  const messageText = String(text ?? "");
  assistantConversationHistory.push({ role, text: messageText.slice(0, 1600) });
  if (assistantConversationHistory.length > 24) assistantConversationHistory.shift();
  if (role === "bot") assistantLastBotText = messageText.slice(0, 1600);
  if (actions.length) {
    const row = document.createElement("div"); row.className = "shop-assistant-actions";
    actions.forEach(action => {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = action.label;
      button.addEventListener("click", () => {
        closeShopAssistant();
        try { action.run(); } catch (error) { console.error("Assistant action failed", error); }
      });
      row.append(button);
    });
    bubble.append(row);
  }
  assistantMessages.append(bubble);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
  return bubble;
}
function assistantAddThinking(label = "Ik zoek de juiste informatie erbij…") {
  if (!assistantMessages) return null;
  const bubble = document.createElement("div");
  bubble.className = "shop-assistant-message bot assistant-thinking";
  bubble.setAttribute("role", "status");
  bubble.innerHTML = '<span class="assistant-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="assistant-thinking-label"></span>';
  bubble.querySelector(".assistant-thinking-label").textContent = label;
  assistantMessages.append(bubble);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
  return bubble;
}
function openShopAssistant() {
  if (!assistantPanel) return;
  assistantPanel.hidden = false;
  assistantToggle?.setAttribute("aria-expanded", "true");
  assistantToggle?.classList.add("is-open");
  window.setTimeout(() => assistantInput?.focus(), 50);
}
function closeShopAssistant() {
  if (!assistantPanel) return;
  assistantPanel.hidden = true;
  assistantToggle?.setAttribute("aria-expanded", "false");
  assistantToggle?.classList.remove("is-open");
}
function assistantFindProducts(question) {
  const normalized = assistantNormalize(question);
  const tokens = assistantTokens(question);
  return (state.products || []).filter(product => product && product.active !== false).map(product => {
    const title = assistantNormalize(product.title || "");
    const description = assistantNormalize(product.description || "");
    const category = assistantNormalize(categoryLabel(product.categoryId) || "");
    const score = (title && normalized.includes(title) ? 12 : 0)
      + tokens.reduce((sum, token) => sum + (title.includes(token) ? 3 : description.includes(token) ? 1 : category.includes(token) ? 1 : 0), 0);
    return { product, score };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score);
}
function assistantBuildActions(question) {
  const q = assistantNormalize(question);
  const actions = [];
  const productMatch = assistantFindProducts(question)[0];
  const add = (label, run) => { if (actions.length < 3) actions.push({ label, run }); };
  if (productMatch && productMatch.score >= 4) add(`Bekijk ${String(productMatch.product.title || "product").slice(0, 30)}`, () => showProduct(productMatch.product.id));
  if (/\b(offerte|maatwerk|eigen ontwerp|laten maken)\b/.test(q)) add("Offerte aanvragen", () => $("#requestQuoteBtn")?.click());
  if (/\b(bestelling|bestellingen|order|track|track trace|status|volgen|bezorging|betaallink|retour)\b/.test(q)) add("Mijn bestellingen", () => { if (state.user) showMyOrders(); else authForm(); });
  if (/\b(chat|chats|bericht|berichten|klantenservice)\b/.test(q)) add("Mijn chats", () => { if (state.user) showMyChats(); else authForm(); });
  if (/\b(account|inloggen|registreren|wachtwoord|gebruikersnaam|log ik in|log in)\b/.test(q) && !state.user) add("Inloggen of account maken", () => authForm());
  if (/\b(winkelwagen|mandje|afrekenen|bestellen)\b/.test(q)) add("Winkelwagen openen", () => { closeShopAssistant(); $("#cartBtn")?.click(); });
  if (/\b(favoriet|favorieten|bewaren)\b/.test(q)) add("Favorieten openen", () => { closeShopAssistant(); $("#favoritesBtn")?.click(); });
  if (/\b(privacy|cookies|cookie)\b/.test(q)) add("Privacy en cookies", () => { closeShopAssistant(); $("#openPrivacy")?.click(); });
  if (/\b(voorwaarden|algemene voorwaarden)\b/.test(q)) add("Algemene voorwaarden", () => { closeShopAssistant(); openTermsPage(); });
  if (/\b(contact|e-mail|email|telefoon|openingstijden|hulp|klacht)\b/.test(q)) add("Contactpagina", () => openContactPage());
  if (/\b(product|producten|assortiment|kleur|filament|categorie|zoeken)\b/.test(q)) add("Bekijk assortiment", () => { closeShopAssistant(); document.querySelector("#producten")?.scrollIntoView({ behavior: "smooth" }); });
  return actions;
}

const ASSISTANT_FAQ = [
  { id: "catalog", terms: ["assortiment", "welke producten", "wat verkopen", "wat hebben jullie", "alle producten", "collectie", "catalogus", "aanbod", "wat kan ik kopen", "wat bieden jullie", "wat is er te koop"], answer: () => assistantCatalogAnswer() },
  { id: "shipping", terms: ["verzending", "verzendkosten", "verzenden", "levertijd", "bezorgen", "bezorging", "levering", "hoe lang duurt"], answer: () => "Verzenden binnen Nederland kost €3,95. Zelf ophalen is gratis. De webshop noemt een maximale levertijd van 14 dagen. De daadwerkelijke planning kan per bestelling verschillen; de actuele voortgang vind je bij Mijn bestellingen." },
  { id: "pickup", terms: ["ophalen", "afhalen", "zelf ophalen", "gratis ophalen", "afhaalpunt"], answer: () => "Ophalen is gratis. Kies tijdens het bestellen de beschikbare ophaal-/afspraakroute. De bestelling wordt bij de status ‘klaar voor bezorging’ als klaar om op te halen weergegeven." },
  { id: "shipping-abroad", terms: ["buitenland", "belgie", "duitsland", "internationaal", "naar het buitenland", "buiten nederland"], answer: () => "De huidige webshopinstellingen noemen Nederland als verzendland. Ik kan daarom geen verzending naar andere landen toezeggen. Vraag via de contactpagina na of een uitzondering mogelijk is." },
  { id: "order", terms: ["bestellen", "bestelproces", "hoe bestel", "afrekenen", "checkout", "winkelwagen", "mandje"], answer: () => "Open een product, kies de gewenste opties en kleuren en voeg het toe aan de winkelwagen. Controleer daarna de aantallen en keuzes in je winkelwagen en rond de bestelling af. Voor online bestellen is een klantaccount nodig. De winkelwagen bewaart je keuzes in deze browser." },
  { id: "account-create", terms: ["account maken", "account aanmaken", "account aan", "registreren", "registratie", "nieuw account", "aanmelden"], answer: () => "Een account maak je via ‘Mijn account’ en daarna de registratieoptie. Je e-mailadres moet uniek zijn. Je kiest een unieke gebruikersnaam van 3 tot en met 20 tekens; letters, cijfers, punt, underscore en koppelteken zijn toegestaan. Een nieuw wachtwoord moet minimaal 8 tekens lang zijn. Deel je wachtwoord nooit met de chatbot of iemand anders." },
  { id: "account-login", terms: ["inloggen", "login", "log ik in", "log in", "aanmelden account", "kan niet inloggen", "account openen", "mijn account"], answer: () => "Open ‘Mijn account’ en log in met het e-mailadres dat bij je account hoort en je eigen wachtwoord. De chatbot kan je wachtwoord niet zien of ophalen. Na meerdere mislukte pogingen kan tijdelijk een oplopende wachttijd gelden. Deel geen inloggegevens in de chat." },
  { id: "username", terms: ["gebruikersnaam wijzigen", "naam wijzigen", "nickname", "accountnaam", "gebruikersnaam aanpassen", "gebruikersnaam", "username"], answer: () => "Je kunt je gebruikersnaam via ‘Mijn account’ wijzigen. De gebruikersnaam moet uniek zijn en bestaat uit 3 tot en met 20 tekens. Toegestaan zijn letters, cijfers, punt, underscore en koppelteken. Je e-mailadres is niet je openbare profielnaam." },
  { id: "logout", terms: ["uitloggen", "afmelden", "uitloggen account", "log uit", "log ik uit", "uit loggen"], answer: () => "Open het accountmenu en kies ‘Uitloggen’. Daarmee sluit je je huidige aanmeldsessie af op dit apparaat. De chatbot logt je niet uit en vraagt nooit om je wachtwoord." },
  { id: "password", terms: ["wachtwoord vergeten", "wachtwoord reset", "wachtwoord wijzigen", "nieuw wachtwoord", "password reset", "password vergeten", "wachtwoord", "password"], answer: () => "In deze versie is er geen zelfbedieningsfunctie om een wachtwoord te resetten of te wijzigen. Neem via de contactpagina contact op voor hulp. Stuur je wachtwoord, herstelcodes of andere geheime gegevens nooit via de chat." },
  { id: "address", terms: ["mijn adres", "huisadres", "woonadres", "verzendadres", "bezorgadres", "adres wijzigen", "adres aanpassen", "postcode", "huisnummer"], answer: () => "De chatbot haalt geen klantadressen op en kan ze niet tonen of wijzigen. Vul je bezorggegevens alleen in op de daarvoor bedoelde beveiligde stap van het bestelproces. Zet nooit je adres of postcode in deze chat." },
  { id: "payment", terms: ["betalen", "betaalmethode", "betaling", "tikkie", "betaalverzoek", "betaallink", "hoe betaal ik"], answer: () => "De checkout werkt met een betaalverzoek via Tikkie. Als de beheerder een betaallink aan je bestelling heeft toegevoegd, vind je die bij ‘Mijn bestellingen’. Bestellingen die via de klantenchat worden afgesproken kunnen via die chat verder worden afgehandeld. Deel nooit je volledige betaalgegevens, kaartnummer of beveiligingscode in de chat." },
  { id: "payment-status", terms: ["betaalstatus", "betaling gelukt", "betaling mislukt", "betaallink vinden", "link betalen"], answer: () => "Je persoonlijke betaalstatus en eventuele betaallink zijn alleen zichtbaar bij ‘Mijn bestellingen’ nadat je bent ingelogd. De chatbot haalt geen betalingsgegevens op en kan een betaling niet bevestigen of wijzigen." },
  { id: "price", terms: ["prijs", "prijzen", "kosten", "wat kost", "hoe duur", "meerprijs", "toeslag", "korting"], answer: ({ question }) => assistantPriceAnswer(question) },
  { id: "options", terms: ["opties", "keuzes", "variant", "varianten", "maat", "kleur kiezen", "productopties", "keuzelijst"], answer: ({ question }) => assistantOptionsAnswer(question) },
  { id: "colors", terms: ["filamentkleuren", "beschikbare kleuren", "kleuren", "kleurkeuze", "filament kleur", "welke kleur", "kleurvoorraad"], answer: () => assistantColorsAnswer() },
  { id: "material", terms: ["filament", "materiaal", "pla", "petg", "abs", "tpu", "kunststof", "printmateriaal"], answer: () => "De webshop gebruikt materiaalkeuzes zoals PLA, PETG, ABS en TPU waar die door de beheerder zijn ingesteld. Welke materialen en kleuren bestelbaar zijn, hangt af van het specifieke product en de actieve voorraad. Je ziet alleen de beschikbare keuzes op de productpagina." },
  { id: "stock", terms: ["voorraad", "uitverkocht", "niet beschikbaar", "niet bestelbaar", "voorraadstatus", "op voorraad"], answer: ({ question }) => assistantStockAnswer(question) },
  { id: "custom-text", terms: ["eigen tekst", "personaliseren", "personalisatie", "naam erop", "tekst op product", "tekst toevoegen", "tekstveld", "eigen naam"], answer: () => "Sommige producten hebben een eigen tekstveld. De titel van dat veld verschilt per product en is zichtbaar op de productpagina. Als het veld aanwezig is, kun je maximaal 160 tekens invoeren. Niet ieder product ondersteunt eigen tekst." },
  { id: "quote", terms: ["offerte", "maatwerk", "eigen ontwerp", "eigen 3d ontwerp", "iets laten maken", "op maat", "custom ontwerp"], answer: () => "Voor maatwerk gebruik je de knop voor een eigen ontwerp/offerte. Je moet ingelogd zijn. Vul een titel (maximaal 90 tekens), beschrijving (maximaal 1.800 tekens), afmetingen en kleur in. Lengte, breedte en hoogte moeten elk een geheel getal van 1 t/m 180 mm zijn. Een ontwerpafbeelding is verplicht (PNG, JPG of WEBP; maximaal 12 MB). Na indienen wordt een persoonlijke chat voor de offerte geopend." },
  { id: "quote-status", terms: ["offerte status", "offerte volgen", "offerte ingediend", "offerte bekijken", "mijn aanvraag", "aanvraag status"], answer: () => "Je eigen offerte en het gesprek daarover vind je na inloggen via ‘Mijn chats’. Een offerteaanvraag opent een persoonlijke chat waarin de aanvraag verder kan worden besproken. De chatbot kan geen persoonlijke offertegegevens ophalen of wijzigen." },
  { id: "cart", terms: ["winkelwagen bewaren", "winkelwagen leeg", "winkelmand", "winkelwagen werkt", "keuzes bewaren", "bestelnotitie", "opmerking bestelling"], answer: () => "De winkelwagen bewaart aantallen, gekozen opties, eventuele eigen tekst en 3D-onderdeelskleuren in de browser. Je kunt bij online bestellen ook een bestelopmerking van maximaal 500 tekens toevoegen. Browsergegevens kunnen verdwijnen als je browseropslag wist of een andere browser gebruikt." },
  { id: "favorites", terms: ["favorieten", "favoriet", "hartje", "bewaren voor later", "verlanglijst", "product bewaren"], answer: () => "Gebruik het hartje bij een product om het als favoriet te bewaren. Als je bent ingelogd, worden favorieten aan je account gekoppeld. Als gast blijven ze in de browser waarin je ze hebt opgeslagen." },
  { id: "tracking", terms: ["bestelling volgen", "mijn bestelling", "volg ik mijn bestelling", "volg mijn bestelling", "pakket volgen", "mijn pakket", "track en trace", "track trace", "bestelstatus", "orderstatus", "voortgang bestelling", "waar is mijn pakket"], answer: () => "Je eigen bestelling volg je via ‘Mijn bestellingen’ nadat je bent ingelogd. Daar zie je de status en, wanneer beschikbaar, de voortgang en betaallink. Een openbare track-and-trace-deellink is alleen-lezen en toont beperkte bestelgegevens; geen account of chat. De chatbot zelf haalt geen bestellingen of adressen op." },
  { id: "statuses", terms: ["bestelstatussen", "status ontvangen", "in de maak", "klaar voor bezorging", "bestelling verwerkt", "printstatus", "statussen"], answer: () => "De bestelstatus kan zijn: ontvangen, verwerkt, in de maak, gemaakt, klaar voor bezorging of bezorgd. Bij een bestelling die wordt opgehaald betekent ‘klaar voor bezorging’ dat die klaar is om op te halen. Tijdens ‘in de maak’ kan de voortgang per productstuk apart worden bijgehouden." },
  { id: "agenda", terms: ["agenda", "planning", "printplanning", "ingepland", "tijdslot", "printtijd", "wanneer wordt mijn product gemaakt", "planning print"], answer: () => "De webshopbeheerder kan printtijd in de agenda plannen per productstuk. De agenda voorkomt dat tijdsloten overlappen. Klanten zien de bestelstatus en, wanneer die is bijgewerkt, de fase per productstuk bij ‘Mijn bestellingen’. De chatbot kan geen persoonlijke printdatum of planning uit je account ophalen." },
  { id: "order-note", terms: ["bestelopmerking", "opmerking toevoegen", "notitie bij bestelling", "bericht bij mijn bestelling", "speciale instructie bestelling"], answer: () => "Bij een online bestelling kun je een optionele bestelopmerking toevoegen van maximaal 500 tekens. Zet geen wachtwoorden, betaalgegevens of onnodige persoonsgegevens in die opmerking." },
  { id: "product-images", terms: ["productfoto", "productfotos", "afbeeldingen product", "meerdere foto's", "galerij", "productafbeelding"], answer: ({ question }) => { const best = assistantFindProducts(question)[0]; if (best && best.score >= 4) { const count = productImages(best.product).length; return `${best.product.title || "Dit product"} heeft ${count} productafbeelding(en) in de geladen webshopgegevens. Open de productpagina om de fotogalerij te bekijken.`; } return "Een product kan meerdere afbeeldingen hebben. Als er meer dan één afbeelding is ingesteld, toont de productpagina een fotogalerij."; } },
  { id: "chat-attachments", terms: ["afbeelding in chat", "foto in chat", "bestand in chat", "bijlage chat", "foto sturen", "afbeelding sturen"], answer: () => "In de klantenchat kunnen afbeeldingen worden toegevoegd. De webshop verkleint afbeeldingen in de browser voor opslag. Stuur via de chat geen identiteitsdocumenten, betaalgegevens, wachtwoorden of andere gevoelige informatie." },
  { id: "filament-stock", terms: ["filamentverbruik", "gram filament", "voorraad wordt afgeboekt", "voorraad afboeken", "voorraad terug", "materiaalverbruik"], answer: () => "Voor sommige producten is filamentverbruik per stuk ingesteld. De webshop controleert of de gekozen kleur genoeg beschikbare voorraad heeft. Bij een bestelling wordt het benodigde verbruik gereserveerd of afgeboekt; als de bestelling niet lukt, wordt die voorraad weer vrijgegeven. Exacte interne gramvoorraden zijn beheerinformatie." },
  { id: "shared-options", terms: ["gedeelde opties", "opties meerdere producten", "zelfde opties", "keuzes bij meerdere producten", "opties gekoppeld"], answer: () => "Sommige keuze-opties kunnen door de beheerder als gedeelde set aan meerdere producten zijn gekoppeld. Daardoor kunnen dezelfde keuzes op meerdere productpagina's voorkomen. De concrete opties en prijzen die je kunt kiezen, zie je altijd bij het betreffende product." },
  { id: "returns", terms: ["retour", "retourneren", "retourbeleid", "terugsturen", "retouraanvraag", "geld terug", "retourtermijn"], answer: () => "Een retourverzoek kan in deze webshop binnen 14 dagen na ontvangst of ophalen worden ingediend, wanneer de retourknop bij de bezorgde bestelling beschikbaar is. Het verzoek moet worden beoordeeld. Voor producten die volgens persoonlijke specificaties zijn gemaakt kan een wettelijke uitzondering op het herroepingsrecht gelden. Bekijk ook de algemene voorwaarden." },
  { id: "reviews", terms: ["review", "reviews", "beoordeling", "beoordelingen", "sterren", "ervaring achterlaten", "product beoordelen"], answer: () => "Een review kan beschikbaar zijn nadat je een product hebt besteld en de bestelling is bezorgd of opgehaald. Als de reviewoptie bij je bestelling wordt getoond, kun je die gebruiken. Productpagina's tonen reviewinformatie wanneer er beoordelingen zijn." },
  { id: "chat", terms: ["mijn chats", "klantenchat", "klantenservice chat", "chatbericht", "bericht sturen", "gesprek met beheerder"], answer: () => "Via ‘Mijn chats’ kun je na inloggen je eigen service- en offertegesprekken bekijken en berichten sturen. Bij een maatwerkofferte wordt automatisch een persoonlijk gesprek geopend. De chatbot kan geen privéberichten uit je account lezen." },
  { id: "3d-preview", terms: ["3d voorbeeld", "3d preview", "3d model", "3d bestanden", "3d bestand", "stl bestand", "3mf bestand", "model draaien", "stl", "3mf", "voorbeeld bekijken", "model bekijken"], answer: () => "Producten met een gekoppeld model kunnen een interactieve 3D-preview tonen. De webshop ondersteunt STL en 3MF. Je kunt het model draaien; ondersteunde 3MF-bestanden kunnen meerdere onderdelen en onderdeelkleuren bevatten. Niet ieder product heeft een 3D-preview. De preview is geen slicer en berekent geen officiële printtijd, materiaalkosten of printbaarheid." },
  { id: "slicer", terms: ["bambu studio", "orcaslicer", "prusa slicer", "prusa slicer", "slicer", "snijsoftware", "3mf export"], answer: () => "De webshop noemt Bambu Studio, OrcaSlicer en PrusaSlicer als compatibele slicers voor de bijbehorende 3D-bestanden. De browserpreview zelf is geen slicer en vervangt geen controle van instellingen, printbaarheid of printtijd in je eigen slicersoftware." },
  { id: "camera", terms: ["printercamera", "camera", "live camera", "print bekijken", "printerbeeld"], answer: () => "Bij bestellingen kan een printercamera-weergave zichtbaar zijn als die voor de bestelling beschikbaar en door de beheerder ingeschakeld is. De camera kan tijdelijk worden uitgeschakeld. De chatbot kan geen camera inschakelen of de print bedienen." },
  { id: "cookies", terms: ["cookies", "cookie instellingen", "browseropslag", "lokale opslag", "gegevens browser"], answer: () => "De webshop gebruikt noodzakelijke browseropslag voor functies zoals winkelwagen en sessie. In de huidige code zijn geen optionele statistiek- of marketingcookies ingesteld. Je kunt je voorkeuren aanpassen via ‘Cookie-instellingen’ onderaan de website." },
  { id: "privacy", terms: ["privacy", "persoonsgegevens", "gegevens beveiligen", "gegevens verwijderen", "gegevens opslaan", "data", "chatbot privacy"], answer: () => "Onderaan de webshop staat de privacyverklaring met informatie over gegevensverwerking en je privacyrechten. Typ geen wachtwoorden, herstelcodes, betaalkaartgegevens, volledige adressen of andere gevoelige persoonsgegevens in de chatbot. De chatbot leest geen klantorders, profielen, adressen of privéchats uit Firebase." },
  { id: "contact", terms: ["contact", "contact opnemen", "klantenservice", "hulp nodig", "klacht", "vraag stellen", "openingstijden"], answer: () => "Voor een vraag die niet in deze uitleg staat, gebruik je de contactpagina van de webshop. Daar staan de klantgerichte contactgegevens en eventuele openingstijden die door de beheerder zijn ingevuld. De chatbot toont geen privé- of accountgegevens." },
  { id: "terms", terms: ["voorwaarden", "algemene voorwaarden", "regels webshop", "juridisch", "rechten en plichten"], answer: () => "De algemene voorwaarden zijn te openen via de link onderaan de webshop. Daar vind je de formele afspraken over bestellen, betalen, levering en retouren. Bij een verschil tussen een korte chatuitleg en de gepubliceerde voorwaarden zijn de voorwaarden leidend." },
  { id: "admin", terms: ["beheerder", "sitebeheer", "admin", "beheeromgeving", "voorraadbeheer", "dashboard"], answer: () => "De beheeromgeving is alleen voor de webshopbeheerder. Deze klantenassistent kan geen beheeracties uitvoeren en deelt geen beheerwachtwoorden, interne voorraadgrammen, waarschuwingsgrenzen of afgeschermde dashboardinformatie." },
  { id: "chatbot", terms: ["chatbot", "assistent", "werkt de bot", "kunstmatige intelligentie", "ai bot", "faq bot"], answer: () => "Je kunt gewone vragen stellen of gewoon even praten. Voor webshopvragen gebruik ik de webshopuitleg en actuele openbare productinformatie. Je kiest zelf via het pijltje naast de verzendknop of ik in de webshop of op internet zoek. Voor internetvragen gebruik ik Wikipedia en DuckDuckGo. Ik ben geen vrij generatief AI-model zoals ChatGPT; ik combineer gesprekshulp met gevonden informatie. Deel nooit wachtwoorden, adressen, betaalgegevens of persoonlijke bestelgegevens in deze chat." },
  ...ASSISTANT_EXTRA_FAQ,
  ...ASSISTANT_EXTRA_300
];

function assistantIsProductCountQuestion(question) {
  const q = assistantNormalize(question);
  const hasCountWord = /\b(hoeveel|aantal|number|how many)\b/.test(q);
  const hasProductWord = /\b(product|producten|artikel|artikelen|item|items)\b/.test(q);
  return hasCountWord && hasProductWord;
}

// Herkent printverzoeken ook wanneer de bezoeker kleine typefouten maakt.
function assistantEditDistance(left, right) {
  const a = String(left || ""), b = String(right || "");
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}
function assistantWordsClose(left, right) {
  const a = assistantNormalize(left), b = assistantNormalize(right);
  if (!a || !b) return false;
  if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  const distance = assistantEditDistance(a, b);
  const maxDistance = Math.max(a.length, b.length) >= 7 ? 2 : 1;
  return distance <= maxDistance && (1 - distance / Math.max(a.length, b.length)) >= 0.72;
}
function assistantIsPrintRequest(question) {
  const q = assistantNormalize(question);
  if (!q) return false;
  const words = q.split(/\s+/);
  const hasPrintWord = words.some(word => ["print", "printen", "printje", "geprint", "printen", "uitprinten", "geprint"].some(target => assistantWordsClose(word, target)));
  const has3d = /\b3\s*d\b/.test(q);
  const hasShopCue = /\b(jullie|bij jullie|voor mij|voor ons|voor me|webshop|winkel|shop)\b/.test(q);
  const hasMakeRequest = /\b(laten maken|maken jullie|kunnen jullie maken|kun je maken|wil maken|willen maken|maak voor mij|op maat maken)\b/.test(q) || (has3d && /\b(maken|maak|laten|ontwerp)\b/.test(q)) || (hasShopCue && /\b(maken|maak|ontwerpen|ontwerp)\b/.test(q));
  const hasRequestLanguage = /\b(wil|wilt|willen|zou|zouden|kun|kan|kunnen|mag|graag|laten|zoek|maken|maken jullie)\b/.test(q);
  // Een gewone vraag om huiswerk/documenten op papier te printen is geen 3D-printofferte.
  const paperTask = /\b(huiswerk|schoolwerk|document|werkstuk|formulier|papier|brief|pdf|verslag)\b/.test(q)
    && !has3d && !hasShopCue;
  if (paperTask) return false;
  return (hasPrintWord && (hasRequestLanguage || hasShopCue || has3d)) || (has3d && hasMakeRequest) || (hasMakeRequest && hasShopCue);
}
function assistantRequestedPrintProduct(question) {
  const ignored = new Set([
    "ik", "wij", "we", "jullie", "je", "jij", "mij", "me", "ons", "onze", "voor", "van", "de", "het", "een", "en", "of", "aan", "bij", "met", "wil", "wilt", "willen", "zou", "zouden", "kun", "kan", "kunnen", "mag", "graag", "laten", "laat", "maken", "maak", "print", "printen", "printje", "geprint", "uitprinten", "3d", "iets", "ook", "nog", "hebben", "heb", "bestaan", "bestaat", "bestellen", "bestel", "kunnen", "jullie", "als", "dat", "dit", "voor", "mijn", "eigen", "ontwerp", "product", "ding", "dingetje", "speciaal", "eentje", "eens"
  ]);
  const queryWords = assistantNormalize(question).split(/\s+/).filter(word => word.length >= 3 && !ignored.has(word));
  if (!queryWords.length) return null;
  const products = (state.products || []).filter(product => product && product.active !== false);
  const matches = products.map(product => {
    const titleWords = assistantNormalize(product.title || "").split(/\s+/).filter(word => word.length >= 3 && !["voor", "van", "met", "een", "het", "de", "en"].includes(word));
    if (!titleWords.length) return { product, score: 0, matched: 0 };
    const weights = titleWords.map(titleWord => {
      let best = 0;
      for (const queryWord of queryWords) {
        if (queryWord === titleWord) best = Math.max(best, 1);
        else if (queryWord.includes(titleWord) || titleWord.includes(queryWord)) {
          const shorter = Math.min(queryWord.length, titleWord.length);
          if (shorter >= 4) best = Math.max(best, 0.88);
        } else {
          const distance = assistantEditDistance(queryWord, titleWord);
          const similarity = 1 - distance / Math.max(queryWord.length, titleWord.length);
          if (distance <= (titleWord.length >= 9 ? 2 : 1) && similarity >= 0.72) best = Math.max(best, similarity);
        }
      }
      return best;
    });
    const coverage = weights.reduce((sum, score) => sum + score, 0) / weights.length;
    const exactHits = weights.filter(score => score >= 0.98).length;
    const queryCoverage = queryWords.filter(queryWord => titleWords.some(titleWord => queryWord === titleWord || (assistantEditDistance(queryWord, titleWord) <= 1 && Math.min(queryWord.length, titleWord.length) >= 4))).length / queryWords.length;
    return { product, score: coverage * 0.78 + queryCoverage * 0.22, matched: exactHits, coverage };
  }).sort((a, b) => b.score - a.score);
  const best = matches[0];
  if (!best) return null;
  const titleWordCount = assistantNormalize(best.product.title || "").split(/\s+/).filter(word => word.length >= 3 && !["voor", "van", "met", "een", "het", "de", "en"].includes(word)).length;
  const threshold = titleWordCount <= 1 ? 0.78 : 0.68;
  return best.score >= threshold ? best.product : null;
}
function assistantUnlistedPrintAnswer(question) {
  const quoteAction = { label: "Offerte aanvragen", run: () => { closeShopAssistant(); $("#requestQuoteBtn")?.click(); } };
  if (!state.loaded || state.productsError) {
    return { text: "Ik kan op dit moment niet betrouwbaar controleren of we dit product al in het assortiment hebben. Open het productoverzicht om eerst te kijken. Denk je dat het maatwerk is, dan kun je ook een offerte aanvragen; de beheerder kan dan beoordelen of het te printen is.", actions: [quoteAction] };
  }
  const product = assistantRequestedPrintProduct(question);
  if (product) {
    const available = !isSoldOut(product);
    const message = `Ik heb een product in ons assortiment gevonden dat waarschijnlijk bij je vraag past: ${product.title}. ${available ? "Volgens de huidige webshopgegevens is het beschikbaar." : "Dit product staat op dit moment niet als bestelbaar vermeld."} Bekijk de productpagina om de opties, kleuren en prijs te controleren. Bedoel je iets anders of wil je een aangepaste versie? Dan kun je daarvoor een offerte aanvragen.`;
    return { text: message, actions: [
      { label: `Bekijk ${String(product.title || "product").slice(0, 28)}`, run: () => { closeShopAssistant(); showProduct(product.id); } },
      quoteAction
    ] };
  }
  return {
    text: "Dat specifieke product zie ik niet terug in ons huidige assortiment. We kunnen wel bekijken of we het als maatwerk kunnen printen. Vraag daarvoor een offerte aan; beschrijf wat je wilt, voeg een afbeelding of ontwerp toe en geef de gewenste afmetingen en kleur op. Dan kan de webshopbeheerder beoordelen of het mogelijk is en wat het kost. Kleine typfouten in je omschrijving zijn geen probleem.",
    actions: [quoteAction]
  };
}
function assistantProductCountAnswer(question = "") {
  if (!state.loaded) return "Ik laad het actuele productoverzicht nog. Probeer het over een paar seconden nog eens; ik wil je geen verkeerd aantal geven.";
  if (state.productsError) return "Ik kan het actuele productaantal nu niet betrouwbaar uitlezen omdat het productoverzicht niet goed geladen is. Ververs de webshop en probeer het opnieuw.";
  const products = (state.products || []).filter(product => product && product.active !== false);
  const available = products.filter(product => !isSoldOut(product));
  const unavailable = products.length - available.length;
  const availableWord = available.length === 1 ? "product" : "producten";
  const unavailableWord = unavailable === 1 ? "product" : "producten";
  const q = assistantNormalize(question);
  if (/\b(uitverkocht|niet bestelbaar|niet beschikbaar)\b/.test(q)) {
    return `Op dit moment zijn ${unavailable} van de ${products.length} actieve producten niet bestelbaar volgens de voorraad- en beschikbaarheidscontrole van de webshop.`;
  }
  if (/\b(bestelbaar|beschikbaar|op voorraad)\b/.test(q)) {
    return `Op dit moment zijn ${available.length} van de ${products.length} actieve producten bestelbaar volgens de actuele webshopcontrole. De beschikbaarheid kan veranderen wanneer voorraad of productopties worden aangepast.`;
  }
  return `We hebben op dit moment ${products.length} actieve producten in de webshop. Daarvan zijn ${available.length} ${availableWord} volgens de actuele beschikbaarheidscontrole bestelbaar en ${unavailable} ${unavailableWord} momenteel niet bestelbaar. Ik tel hierbij ieder product één keer; verschillende kleur- of maatopties tel ik niet als aparte producten.`;
}
function assistantCatalogExtremesAnswer(question = "") {
  if (!state.loaded) return "Ik laad het assortiment nog. Probeer het zo nog eens, dan kan ik de actuele prijzen vergelijken.";
  const products = (state.products || []).filter(product => product && product.active !== false && !isSoldOut(product));
  if (!products.length) return "Ik zie op dit moment geen actieve, bestelbare producten om op prijs te vergelijken.";
  const q = assistantNormalize(question);
  const wantsExpensive = /\b(duurste|meest duur|hoogste prijs|kostbaarste)\b/.test(q);
  const sorted = [...products].sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  const selected = wantsExpensive ? sorted.slice(-3).reverse() : sorted.slice(0, 3);
  const heading = wantsExpensive ? "De duurste bestelbare producten op basis van hun basisprijs zijn:" : "De voordeligste bestelbare producten op basis van hun basisprijs zijn:";
  return `${heading}\n${selected.map((product, index) => `${index + 1}. ${product.title || "Product"} — vanaf €${(Number(product.price) || 0).toFixed(2).replace(".", ",")}`).join("\n")}\n\nLet op: gekozen opties kunnen de eindprijs veranderen. De winkelwagen berekent het definitieve bedrag.`;
}

function assistantCatalogAnswer() {
  const products = (state.products || []).filter(product => product && product.active !== false);
  if (!state.loaded) return "De productcatalogus wordt nog geladen. Probeer het over een moment opnieuw of open het productoverzicht.";
  if (!products.length) return "Er staan op dit moment geen actieve producten in het productoverzicht.";
  const availableCount = products.filter(product => !isSoldOut(product)).length;
  const lines = products.slice(0, 24).map(product => `• ${product.title || "Product"} — vanaf €${(Number(product.price) || 0).toFixed(2).replace(".", ",")}${isSoldOut(product) ? " (momenteel niet beschikbaar)" : ""}`);
  const extra = products.length > 24 ? `\nEr zijn nog ${products.length - 24} actieve producten. Bekijk het volledige assortiment op de website.` : "";
  return `We hebben op dit moment ${products.length} actieve producten in de webshop. ${availableCount} daarvan zijn volgens de actuele beschikbaarheidscontrole bestelbaar.\n\nDit is het assortiment dat op dit moment is geladen:\n${lines.join("\n")}${extra}\n\nOpen een product voor de actuele opties, kleuren, meerprijzen en eventuele 3D-preview.`;
}
function assistantProductAnswer(product, question = "") {
  const price = (Number(product.price) || 0).toFixed(2).replace(".", ",");
  const lines = [`${product.title || "Dit product"} kost vanaf €${price}.`, `Beschikbaarheid: ${isSoldOut(product) ? "momenteel niet beschikbaar" : "volgens de webshop beschikbaar"}.`];
  const description = String(product.description || "").trim();
  if (description) lines.push(`Beschrijving: ${description.slice(0, 460)}${description.length > 460 ? "…" : ""}`);
  const groups = optionGroupsOf(product);
  if (groups.length) {
    const optionText = groups.map(group => {
      const values = (group.options || []).map(option => `${option.name || "Keuze"}${option.soldOut ? " (uitverkocht)" : ""}${Number(option.priceDelta) ? ` (${Number(option.priceDelta) > 0 ? "+" : "−"}€${Math.abs(Number(option.priceDelta)).toFixed(2).replace(".", ",")})` : ""}`).join(", ");
      return `${group.label || "Keuze"}: ${values || "keuzes staan op de productpagina"}`;
    });
    lines.push(`Mogelijke keuzes: ${optionText.join("; ")}.`);
  }
  const colors = productColorChoices(product).filter(option => !option.soldOut).map(option => option.name).filter(Boolean);
  if (colors.length) lines.push(`Beschikbare modelkleuren: ${[...new Set(colors)].slice(0, 12).join(", ")}.`);
  if (product.customTextEnabled === true && String(product.customTextLabel || "").trim()) lines.push(`Eigen tekst: dit product heeft het veld ‘${String(product.customTextLabel).trim()}’ (maximaal 160 tekens).`);
  if (product.model3d) lines.push("Er is een 3D-preview aan dit product gekoppeld.");
  const reviews = reviewStats(product.id);
  if (reviews.count) lines.push(`Reviews: ${reviews.count} beoordeling(en), gemiddeld ${Math.round(reviews.average * 10) / 10} van 5 sterren.`);
  lines.push("De productpagina en winkelwagen tonen de definitieve prijs nadat je alle opties hebt gekozen.");
  return lines.join("\n");
}
function assistantPriceAnswer(question) {
  const matches = assistantFindProducts(question);
  const best = matches[0];
  if (best && best.score >= 4) return assistantProductAnswer(best.product, question);
  return "De actuele productprijzen staan bij de producten in het assortiment. De getoonde prijs is de basisprijs; gekozen opties kunnen een toeslag of korting hebben. De webshop berekent het totaal in de productkeuze en winkelwagen. Noem eventueel de productnaam, dan zoek ik de actuele basisprijs erbij.";
}
function assistantOptionsAnswer(question) {
  const best = assistantFindProducts(question)[0];
  if (best && best.score >= 4) return assistantProductAnswer(best.product, question);
  return "De beschikbare opties verschillen per product. Een product kan keuzevelden hebben voor bijvoorbeeld uitvoering, formaat of kleur; sommige keuzes hebben een meerprijs of zijn uitverkocht. Open de productpagina om precies te zien welke opties voor dat product beschikbaar zijn.";
}
function assistantColorsAnswer() {
  const colors = activeFilaments().filter(filament => Number(filament.gramsAvailable || 0) > 0).map(filament => `${filament.name || "Kleur"} (${filament.material || "materiaal niet vermeld"})`);
  if (!colors.length) return "Ik zie op dit moment geen actieve filamentkleur met beschikbare voorraad in de geladen webshopgegevens. De actuele kleurkeuzes worden per product op de productpagina getoond.";
  return `De volgende actieve filamentkleuren hebben volgens de geladen gegevens voorraad: ${[...new Set(colors)].join(", ")}.\n\nNiet iedere kleur hoeft bij ieder product te passen. Op de productpagina zie je welke kleuren voor dat specifieke product bestelbaar zijn.`;
}
function assistantStockAnswer(question) {
  const best = assistantFindProducts(question)[0];
  if (best && best.score >= 4) {
    const product = best.product;
    const choices = optionGroupsOf(product).flatMap(group => (group.options || []).filter(option => option.soldOut).map(option => `${group.label || "Keuze"}: ${option.name}`));
    const available = !isSoldOut(product);
    return `${product.title || "Dit product"}: ${available ? "volgens de webshop beschikbaar" : "momenteel niet beschikbaar"}.${choices.length ? ` Deze keuze-opties zijn als uitverkocht gemarkeerd: ${choices.join(", ")}.` : " De bestelbare opties worden op de productpagina getoond."} Exacte interne voorraadhoeveelheden deelt de chatbot niet.`;
  }
  return "De webshop controleert of een product en de gekozen filamentkleur voldoende voorraad hebben. Opties die uitverkocht zijn of waarvoor onvoldoende filament beschikbaar is, worden niet als bestelbaar aangeboden. Exacte interne voorraadgrammen zijn beheerinformatie en worden hier niet getoond.";
}
function assistantIsRecommendationRequest(question) {
  const q = assistantNormalize(question);
  return /\b(raad je aan|aanraden|aanbevelen|aanbeveelt|aanbevolen|beste keuze|wat zou jij kiezen|wat zou jij kopen|wat is jouw favoriet|favoriete product|meest aanraden|het meeste aanraden|welk product.*(beste|aanraden|aanbevelen)|welke product.*(beste|aanraden|aanbevelen))\b/.test(q);
}
function assistantRecommendationList(question = "") {
  const products = (state.products || []).filter(product => product && product.active !== false);
  const availableProducts = products.filter(product => !isSoldOut(product));
  const pool = availableProducts.length ? availableProducts : products;
  const genericWords = new Set(["product", "producten", "raad", "raadt", "aan", "aanraden", "aanbevelen", "aanbevolen", "meest", "meeste", "beste", "keuze", "kies", "kiezen", "zou", "jij", "ik", "welk", "welke", "wat", "voor", "mij", "jouw", "favoriet", "favoriete", "eigenlijk", "het", "een", "de", "van", "is", "zijn", "kun", "kan", "je", "meer"]);
  const intentTokens = assistantTokens(question).filter(token => !genericWords.has(token));
  return pool.map(product => {
    const title = assistantNormalize(product.title || "");
    const description = assistantNormalize(product.description || "");
    const category = assistantNormalize(categoryLabel(product.categoryId) || "");
    const matchScore = intentTokens.reduce((sum, token) => sum + (title.includes(token) ? 4 : description.includes(token) ? 2 : category.includes(token) ? 3 : 0), 0);
    const stats = reviewStats(product.id);
    const reviewCount = Number(stats.count || 0);
    const average = Number(stats.average || 0);
    // Bayesian smoothing avoids treating one 5-star review as definitive.
    const adjustedRating = reviewCount ? ((average * reviewCount) + (4 * 3)) / (reviewCount + 3) : 0;
    const groups = optionGroupsOf(product);
    const optionCount = groups.reduce((sum, group) => sum + (group.options || []).filter(option => !option.soldOut).length, 0);
    const price = Math.max(0, Number(product.price) || 0);
    const descriptionScore = Math.min(5, Math.ceil(description.length / 90));
    const reviewScore = reviewCount ? adjustedRating * 10 + Math.min(reviewCount, 10) * 0.45 : 0;
    const featureScore = (product.model3d ? 2 : 0) + (optionCount ? 1.5 : 0) + (product.customTextEnabled === true ? 1 : 0) + descriptionScore;
    const availabilityScore = !isSoldOut(product) ? 18 : -30;
    return {
      product, stats, reviewCount, average, adjustedRating, price, optionCount,
      score: matchScore * 4 + reviewScore + featureScore + availabilityScore
    };
  }).sort((a, b) => b.score - a.score || (a.price - b.price) || String(a.product.title || "").localeCompare(String(b.product.title || ""), "nl"));
}
function assistantRecommendationAnswer(question) {
  if (!state.loaded) return "Ik ben het actuele assortiment nog aan het laden. Probeer het zo nog eens; dan kan ik mijn advies baseren op de producten die nu echt in de webshop staan.";
  const products = assistantRecommendationList(question);
  if (!products.length) return "Ik kan op dit moment geen actieve producten in het assortiment vinden. Zodra er producten zichtbaar zijn, kan ik ze voor je vergelijken.";
  const best = products[0];
  const p = best.product;
  const priceText = `vanaf €${best.price.toFixed(2).replace(".", ",")}`;
  const reasons = [];
  reasons.push(isSoldOut(p) ? "dit product staat momenteel niet als bestelbaar vermeld" : "dit product staat volgens de webshop als beschikbaar vermeld");
  if (best.reviewCount) reasons.push(`klanten beoordelen het gemiddeld met ${best.average.toFixed(1).replace(".", ",")}/5 uit ${best.reviewCount} ${best.reviewCount === 1 ? "review" : "reviews"}`);
  else reasons.push("er zijn nog geen klantreviews, dus ik kan de kwaliteit niet op klantbeoordelingen baseren");
  if (p.model3d) reasons.push("je kunt het model eerst in de 3D-preview bekijken");
  if (best.optionCount) reasons.push(`er zijn ${best.optionCount} bestelbare keuze-optie(s) zichtbaar`);
  if (String(p.description || "").trim()) reasons.push("de productpagina bevat extra productinformatie");
  const paragraphs = [
    `Als ik op basis van het huidige assortiment één product moet aanraden, kies ik ${p.title || "dit product"} (${priceText}).`,
    `Waarom? ${reasons.join("; ")}. Dit is mijn praktische aanbeveling op basis van de beschikbare productinformatie, bestelbaarheid en eventuele reviews. Ik gebruik geen verborgen verkoopcijfers en kan dus niet zeggen dat dit per se het populairste product is.`,
    assistantProductAnswer(p, question)
  ];
  const alternatives = products.slice(1, 3);
  if (alternatives.length) {
    paragraphs.push("Andere opties die ik ook zou overwegen:");
    alternatives.forEach((item, index) => {
      const availability = isSoldOut(item.product) ? "momenteel niet bestelbaar" : "beschikbaar";
      const rating = item.reviewCount ? ` · ${item.average.toFixed(1).replace(".", ",")}/5 (${item.reviewCount} reviews)` : " · nog geen reviews";
      paragraphs.push(`${index + 2}. ${item.product.title || "Product"} — vanaf €${item.price.toFixed(2).replace(".", ",")} · ${availability}${rating}`);
    });
  }
  paragraphs.push("Als je vertelt waarvoor je het zoekt (bijvoorbeeld cadeau, decoratie, praktisch gebruik of een bepaald budget), kan ik gerichter kiezen.");
  return { text: paragraphs.join("\n\n"), recommendations: products.slice(0, 3) };
}
function assistantRecommendationActions(recommendations) {
  return (recommendations || []).filter(item => item?.product?.id).slice(0, 3).map(item => ({
    label: `Bekijk ${String(item.product.title || "product").slice(0, 25)}`,
    run: () => { closeShopAssistant(); showProduct(item.product.id); }
  }));
}

function assistantFindFaq(question) {
  const normalized = assistantNormalize(question);
  if (!normalized) return null;
  const asksCatalog = /\b(assortiment|catalogus|alle producten|welke producten|wat verkopen|wat hebben jullie|aanbod|collectie|wat voor producten|wat is er te koop|welke zijn het|wat zijn ze)\b/.test(normalized);
  if (asksCatalog) return ASSISTANT_FAQ.find(item => item.id === "catalog");
  const productMatches = assistantFindProducts(question);
  if (productMatches[0]?.score >= 6) {
    return { id: "dynamic-product", answer: () => assistantProductAnswer(productMatches[0].product, question) };
  }

  const queryTokens = normalized.split(/\s+/).filter(token => token.length >= 3);
  const stopTokens = new Set(["wat", "hoe", "waar", "welke", "welk", "kan", "kun", "jullie", "willen", "voor", "met", "een", "het", "de", "van", "dan", "ook", "heb", "heeft", "zijn", "was", "ben", "mijn", "jouw", "dit", "dat", "deze", "daar", "hier", "graag"]);
  const meaningful = queryTokens.filter(token => !stopTokens.has(token));
  let best = null;
  let bestScore = 0;

  for (const entry of ASSISTANT_FAQ) {
    let entryScore = 0;
    for (const rawTerm of entry.terms || []) {
      const term = assistantNormalize(rawTerm);
      if (!term) continue;
      if (normalized.includes(term)) {
        const words = term.split(/\s+/).filter(Boolean);
        const phraseScore = words.length >= 2 ? 3.5 + Math.min(words.length, 5) * 0.45 + Math.min(term.length, 36) * 0.025 : 1.5 + Math.min(term.length, 12) * 0.12;
        entryScore = Math.max(entryScore, phraseScore);
        continue;
      }

      // Typfouten: vergelijk elk woord van een FAQ-term met de woorden in de vraag.
      const termTokens = term.split(/\s+/).filter(token => token.length >= 4);
      if (!termTokens.length) continue;
      let matched = 0;
      for (const termToken of termTokens) {
        const found = meaningful.some(queryToken => {
          if (queryToken === termToken) return true;
          const shorter = Math.min(queryToken.length, termToken.length);
          if (shorter < 5) return false;
          const distance = assistantEditDistance(queryToken, termToken);
          const allowed = Math.max(queryToken.length, termToken.length) >= 9 ? 2 : 1;
          return distance <= allowed && (1 - distance / Math.max(queryToken.length, termToken.length)) >= 0.76;
        });
        if (found) matched++;
      }
      const coverage = matched / termTokens.length;
      if (coverage >= (termTokens.length === 1 ? 1 : 0.66)) {
        const fuzzyScore = (termTokens.length === 1 ? 1.65 : 2.8 + coverage * 2.3) + Math.min(termTokens.length, 4) * 0.2;
        entryScore = Math.max(entryScore, fuzzyScore);
      }
    }
    if (entryScore > bestScore) {
      best = entry;
      bestScore = entryScore;
    }
  }
  return bestScore >= 2.05 ? best : null;
}
function assistantIsSafetyRestricted(question) {
  const q = assistantNormalize(question);
  return [
    /\b(wapen|wapens|pistool|pistolen|geweer|geweren|vuurwapen|munitie|kogels|mes|messen|switchblade|knife|knives|gun|firearm|ammunition)\b/,
    /\b(drugs|wiet|cannabis|hasj|cocaine|xtc|mdma|speed|meth|heroine|vape|vapen|sigaret|nicotine|alcohol|drank)\b/,
    /\b(gokken|casino|sportweddenschap|weddenschap|betting|gambling|poker|slots)\b/,
    /\b(porno|pornografie|porn|sexvideo|adult video)\b/,
    /\b(zelfmoord|zelfdoding|zelfbeschadiging|zelfverwonding|suicide|self harm|self-harm)\b/,
    /\b(gevaarlijke challenge|choking challenge|fire challenge|treinsurfen|train surfing|van een brug springen|extreme stunt)\b/
  ].some(pattern => pattern.test(q));
}
function assistantContainsPrivateData(question) {
  const value = String(question || "");
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || /(?:\+31|0031|0)[\s.-]?(?:6|[1-9])[\d\s().-]{7,}/.test(value)
    || /\b[1-9][0-9]{3}\s?[A-Z]{2}\b/i.test(value)
    || /\bNL\d{2}[A-Z]{4}\d{10}\b/i.test(value)
    || /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/i.test(value)
    || /\b(?:kaartnummer|creditcardnummer|rekeningnummer|bankrekening|cvc|cvv)\s*(?:is|:|=)\s*[A-Z0-9 -]{3,}/i.test(value)
    || /\b(?:wachtwoord|password|inlogcode|herstelcode|pincode|gebruikersnaam|login|accountnaam)\s*(?:is|:|=)\s*\S+/i.test(value)
    || /\b(?:bestelnummer|ordernummer|klantnummer|offertenummer|trackingcode|track(?:\s|-)?en(?:\s|-)?trace)\s*(?:is|:|#|=)?\s*[A-Z0-9-]{4,}\b/i.test(value)
    || /\b(?:mijn|ons|het)\s*(?:huisadres|woonadres|bezorgadres|verzendadres|adres)\s*(?:is|:|=)\s*[^,;]{5,}/i.test(value)
    || /\b[A-ZÀ-ÿ][A-ZÀ-ÿ' -]{2,}(?:straat|laan|weg|plein|dreef|hof|pad)\s+\d{1,4}[A-Z]?\b/i.test(value);
}
function assistantIsWebSearchRequest(question) {
  return /\b(op het internet|op internet|op het web|online zoeken|zoek online|zoek op internet|zoek op het web|web zoeken|zoekmachine|zoek op google|zoek op bing|zoek op duckduckgo)\b/i.test(question);
}
function assistantIsShopQuestion(question) {
  return /\b(webshop|webwinkel|website|winkel|shop|jullie|uw|bedrijf|bestel|bestelling|order|product|producten|filament|kleur|voorraad|levering|verzend|retour|offerte|maatwerk|winkelwagen|winkelmand|account|inlog|wachtwoord|gebruikersnaam|betaal|betaling|tikkie|stl|3mf|slicer|review|favoriet|chat|printercamera|ophalen)\b/i.test(assistantNormalize(question));
}
function assistantWebQuery(question) {
  return String(question || "").trim().replace(/\s+/g, " ").slice(0, 300);
}
function assistantSearchQuery(question, scope = "general") {
  const query = assistantWebQuery(question);
  if (scope !== "shop") return query;
  const host = String(window.location.hostname || "").replace(/[^a-z0-9.-]/gi, "");
  const firstPath = String(window.location.pathname || "/").split("/").filter(Boolean)[0] || "";
  const siteTarget = host ? `${host}${firstPath ? `/${firstPath}` : ""}` : "";
  return siteTarget ? `${query} site:${siteTarget}` : `${query} 3D Printed Shop`;
}
const ASSISTANT_WEB_CACHE = new Map();
let assistantLastTopicQuestion = "";
let assistantLastTopicScope = "general";

function assistantSafeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

function assistantSearchEngineLinks(query) {
  const q = encodeURIComponent(query);
  return [
    { label: "DuckDuckGo", url: `https://duckduckgo.com/?q=${q}` },
    { label: "Wikipedia", url: `https://nl.wikipedia.org/w/index.php?search=${q}` },
    { label: "Google", url: `https://www.google.com/search?q=${q}` },
    { label: "Bing", url: `https://www.bing.com/search?q=${q}` }
  ];
}

function assistantResolveFollowUp(question) {
  const normalized = assistantNormalize(question);
  const isFollowUp = /^(en |maar |waarom|hoezo|hoe dan|vertel meer|meer hierover|meer uitleg|wat bedoel je|welke daarvan|welke dan|welke zijn het|wat zijn ze|wat kost die|hoe duur is die|en de prijs|en de tweede|en de eerste|de tweede|de eerste|en die|die dan|kun je dat uitleggen|kan je dat uitleggen|en nu|en daarna|wat gebeurde er daarna|waarom dan|hoeveel waren het|hoeveel zijn er)\b/.test(normalized)
    || /^(en waarom|en hoe|en welke|en wanneer|en waar|vertel eens meer|leg dat uit|wat bedoel je daarmee)$/.test(normalized);
  if (isFollowUp && assistantLastTopicQuestion) return `${assistantLastTopicQuestion} ${question}`.slice(0, 500);
  return question;
}

function assistantLastUserMessage() {
  for (let index = assistantConversationHistory.length - 1; index >= 0; index--) {
    if (assistantConversationHistory[index]?.role === "user") return String(assistantConversationHistory[index].text || "");
  }
  return "";
}
const assistantMessageCursors = {
  conversation: Object.fromEntries(Object.entries(ASSISTANT_CONVERSATION_MESSAGES).map(([key, messages]) => [key, Math.floor(Math.random() * messages.length)])),
  general: Object.fromEntries(Object.entries(ASSISTANT_GENERAL_MESSAGES).map(([key, messages]) => [key, Math.floor(Math.random() * messages.length)]))
};
function assistantPickStoredMessage(bank, group, kind = "conversation") {
  const messages = bank?.[group];
  if (!Array.isArray(messages) || !messages.length) return "Vertel gerust iets meer, dan denk ik met je mee.";
  const cursors = assistantMessageCursors[kind] || (assistantMessageCursors[kind] = {});
  const index = Number(cursors[group] || 0) % messages.length;
  cursors[group] = index + 1;
  return messages[index];
}
function assistantGeneralMessageGroup(question) {
  const q = assistantNormalize(question);
  if (/\b(schrijf|herschrijf|tekst|mail|e-mail|bericht|verhaal|formuleer|spelling|taalgebruik|presentatie)\b/.test(q)) return "writing";
  if (/\b(plan|planning|plannen|schema|agenda|deadline|studieplanning|organiseer|indelen)\b/.test(q)) return "planning";
  if (/\b(idee|bedenk|verzin|brainstorm|creatief|ontwerp|concept)\b/.test(q)) return "brainstorm";
  if (/\b(leg uit|uitleg|begrijp|betekent|verklaar|wat is|hoe werkt)\b/.test(q)) return "explain";
  if (/\b(vergelijk|verschil|beter|voordeel|nadelen|tegenover|welke kiezen)\b/.test(q)) return "compare";
  if (/\b(fout|werkt niet|probleem|kapot|lukt niet|error|storing|mislukt|bug)\b/.test(q)) return "troubleshoot";
  if (/\b(samenvat|samenvatting|korter|hoofdlijnen|kernpunten|vat samen)\b/.test(q)) return "summary";
  if (/\b(ordenen|ordenen|structuur|overzicht|sorteren|categorie|indeling)\b/.test(q)) return "organize";
  if (/\b(advies|raad je|aanraden|kiezen|keuze|beslissen|beslissing|wat zou ik)\b/.test(q)) return "decision";
  return "clarify";
}
function assistantGeneralHelpReply(question) {
  const group = assistantGeneralMessageGroup(question);
  return assistantPickStoredMessage(ASSISTANT_GENERAL_MESSAGES, group, "general");
}
function assistantIsGeneralHelpRequest(question) {
  const q = assistantNormalize(question);
  return /\b( help |kun je me helpen|kan je me helpen|help me|maak|schrijf|herschrijf|bedenk|verzin|plan|planning|vergelijk|samenvat|vat samen|leg uit|controleer|verbeter|bereken|organiseer|orden|formuleer|ontwerp|stappenplan|advies|raad je aan|idee)\b/.test(` ${q} `)
    || /^(help|hulp|ik heb hulp nodig|ik loop vast|ik weet niet hoe verder)$/.test(q);
}
function assistantSmallTalkReply(question) {
  const q = assistantNormalize(question).replace(/[.,!?]+$/g, "").trim();
  if (!q) return null;
  if (/^(hoi|hoi ik wil gewoon even praten|ik wil gewoon even praten|hallo|hallo daar|hey|heyy|heyyy|yo|goedemorgen|goeiemorgen|goedemiddag|goedenavond|dag|he|hoi hoi|heya)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "greeting");
  }
  if (/^(hoe gaat het|hoe gaat het met je|alles goed|alles goed met jou|hoe is het|hoe gaat ie|hoe gaatie)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "checkIn");
  }
  if (/^(bedankt|dank je|dankjewel|thanks|thx|dank je wel|super bedankt|heel erg bedankt)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "thanks");
  }
  if (/^(doei|tot ziens|tot later|later|bye|ik ga weer|spreek je later)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "goodbye");
  }
  if (/^(wie ben jij|wat ben jij|ben je een robot|ben je echt|ben je een ai|ben jij ai|wat is je naam)$/.test(q)) {
    return "Ik ben de digitale assistent van deze webshop. Ik ben software, geen mens, maar ik kan wel met je kletsen, ideeën uitwerken, productvragen beantwoorden en je helpen informatie te vinden. Waar ben je benieuwd naar?";
  }
  if (/^(hoe oud ben je|heb je een leeftijd|wanneer ben je geboren)$/.test(q)) {
    return "Ik heb geen menselijke leeftijd of verjaardag. Ik ben een digitale assistent die in deze webshop draait. 😄 Hoe oud ben jij trouwens niet iets wat je hier hoeft te delen — zullen we het over iets leuks hebben?";
  }
  if (/^(wat kun je|wat kan je|waarmee kun je helpen|waarmee kan je helpen|wat kan ik vragen|wat weet je|wat doe je)$/.test(q)) {
    return "Je kunt me van alles vragen over de webshop, maar ook gewoon met me praten. Denk aan hobby's, sport, games, dieren, wetenschap, geschiedenis, techniek, films, muziek of een creatief idee. Ik kan meedenken en uitleg geven; voor actuele feiten kun je via het pijltje bewust kiezen om online te zoeken.";
  }
  if (/^(ok|oke|okay|ja|nee|aha|hmm|hmmm|precies|klopt|snap ik|duidelijk|is goed|prima)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "acknowledgement");
  }
  if (/^(ik verveel me|ik ben verveeld|ik weet niet wat ik moet doen|ik heb niks te doen|ik heb niets te doen)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "openChat");
  }
  if (/^(vertel een grap|maak me aan het lachen|heb je een grap|grapje)$/.test(q)) {
    return "Waarom nam de 3D-printer een pauze? Omdat hij even een nieuwe laag nodig had. 😄 Zal ik nog een grap vertellen, een raadsel geven of een ander onderwerp kiezen?";
  }
  if (/^(vertel een raadsel|heb je een raadsel|raadsel)$/.test(q)) {
    return "Raadsel: ik heb lagen, maar ben geen taart. Ik word gemaakt, maar leef niet. Wat ben ik? Denk maar even na!";
  }
  if (/^(vertel een weetje|leuk weetje|interessant weetje|wist je dat)$/.test(q)) {
    return "Leuk weetje: octopussen hebben drie harten en een groot deel van hun zenuwcellen zit in hun armen. Daardoor kunnen hun armen sommige bewegingen deels zelfstandig uitvoeren. 🐙 Zal ik nog een weetje geven over dieren, ruimte, techniek of geschiedenis?";
  }
  if (/^(doe een quiz|quiz|quiz me|stel me een vraag)$/.test(q)) {
    return "Mini-quiz! 🧠 Welke planeet staat bekend als de rode planeet: A) Venus, B) Mars of C) Jupiter? Wat denk jij?";
  }
  if (/^(vertel een verhaal|bedenk een verhaal|maak een verhaaltje)$/.test(q)) {
    return "Er was eens een kleine robot die in een werkplaats woonde. Hij kon maar één ding maken: perfecte kubusjes. Op een dag vroeg iemand om een cadeau dat nergens te koop was. De robot keek naar zijn printer, glimlachte op zijn eigen robotmanier en begon te ontwerpen. Voor het eerst maakte hij geen kubus, maar iets dat precies bij iemand paste. En dat bleek veel leuker dan perfect zijn. Wil je dat ik het verhaal verder vertel of een heel ander verhaal bedenk?";
  }
  if (/^(wat vind je van 3d printen|wat vind jij van 3d printen|vind je 3d printen leuk)$/.test(q)) {
    return "Mijn kijk erop: 3D-printen is bijzonder omdat je een digitaal ontwerp stap voor stap kunt omzetten in iets tastbaars. Het is vooral interessant dat je iets kunt aanpassen aan je eigen idee, in plaats van alleen te kiezen wat al bestaat. Wat zou jij zelf graag eens willen laten maken?";
  }
  if (/^(ik ben blij|ik ben vrolijk|ik heb een leuke dag|mijn dag is leuk|ik ben enthousiast|ik heb goed nieuws)$/.test(q)) {
    return "Wat leuk om te horen! 😊 Wat maakte je dag zo fijn? Is er iets bijzonders gebeurd of is het gewoon zo'n fijne dag?";
  }
  if (/^(ik ben verdrietig|ik voel me rot|ik heb een rotdag|ik ben gestrest|ik ben boos|ik zit ergens mee|ik voel me niet zo goed)$/.test(q)) {
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "empathy");
  }
  if (/^(ik ben moe|ik heb slecht geslapen|ik ben uitgeput)$/.test(q)) {
    return "Dat is vervelend. Was het een drukke dag, of heb je gewoon niet zo goed kunnen slapen? Misschien is het fijn om het even rustig aan te doen.";
  }
  if (/^(ik vind het leuk|ik vind dat leuk|ik hou van|ik houd van|ik ben fan van)\b/.test(q)) {
    const subject = q.replace(/^(ik vind het leuk|ik vind dat leuk|ik hou van|ik houd van|ik ben fan van)\s*/, "").trim();
    return subject ? `Leuk! ${subject} dus. Wat vind je daar het leukste aan — en hoe ben je daarin geïnteresseerd geraakt?` : "Leuk! Vertel eens wat je zo leuk vindt.";
  }
  return null;
}
function assistantIsConversationalPrompt(question) {
  const q = assistantNormalize(question);
  return /\b(wat vind jij|wat vind je|wat denk jij|wat denk je|jouw mening|jouw favoriete|favoriete kleur|favoriete film|favoriete game|lievelingsdier|lievelingskleur|lievelingseten|heb jij|ben jij|hou jij|houd jij|waar hou je van|waar houd je van|wat doe jij|wat ben je aan het doen|hoe was je dag|waar woon je|heb je gevoelens|heb je vrienden|heb je een hobby|en jij|wat zou jij|wat lijkt jou|ik vind|ik hou van|ik houd van|ik ben fan|mijn hobby|mijn lievelings|ik speel|ik game|ik kijk|ik luister|ik sport|ik teken|ik bouw|ik maak graag|ik ben blij|ik ben verdrietig|ik verveel me|ik heb zin|ik wil gewoon praten|vertel een grap|vertel een raadsel|vertel een weetje|wat zullen we doen|waar zullen we over praten)\b/.test(q)
    || /^(ik ben|ik voel|ik denk|ik vind|ik heb|ik ga|mijn dag|vandaag|gisteren|morgen|op school|na school)\b/.test(q);
}
function assistantConversationReply(question) {
  const q = assistantNormalize(question);
  const previousUser = assistantNormalize(assistantLastUserMessage());
  if (/\b(wat vind jij van|wat vind je van|wat denk jij van|wat denk je van|wat is jouw mening over|wat is je mening over)\b/.test(q)) {
    const subject = q.replace(/\b(wat vind jij van|wat vind je van|wat denk jij van|wat denk je van|wat is jouw mening over|wat is je mening over)\b/, "").replace(/[?!.]+$/g, "").trim();
    if (subject) return `Goede vraag. Mijn kijk op ${subject} is dat er meestal meerdere kanten aan zitten. Ik zou vooral letten op wat mensen er goed aan vinden, welke nadelen er kunnen zijn en voor wie het wel of juist niet werkt. Ik heb geen persoonlijke ervaringen, maar ik kan wel een afgewogen mening met argumenten geven. Wat vind jij er zelf van?`;
    return "Waarover wil je mijn mening horen? Noem het onderwerp maar, dan denk ik met je mee en zal ik ook de andere kant bekijken.";
  }
  if (/^(wat vind jij leuk|wat vind je leuk|wat doe je graag|waar hou je van|waar houd je van|wat is jouw favoriete onderwerp)$/.test(q)) {
    return "Ik heb geen persoonlijke voorkeuren zoals een mens, maar ik praat graag mee over creatieve ideeën, techniek, wetenschap, dieren, games en verhalen. Een onderwerp waarbij je iets nieuws ontdekt vind ik altijd leuk om samen uit te pluizen. Wat is jouw favoriete onderwerp?";
  }
  if (/\b(wat is jouw|wat is je|wat zijn jouw|wat zijn je)\b/.test(q) && /\b(favoriete|favoriet|lievelings|liefste)\b/.test(q)) {
    if (/\b(dier|huisdier)\b/.test(q)) return "Ik heb geen eigen huisdier of persoonlijke favoriet, maar als ik er één moet kiezen op basis van karakter en bijzonder gedrag, zijn octopussen erg fascinerend. Welk dier vind jij het leukst?";
    if (/\b(kleur)\b/.test(q)) return "Ik heb geen persoonlijke lievelingskleur, maar blauw en groen zijn mooie combinaties voor een rustige uitstraling. Welke kleur kies jij meestal?";
    if (/\b(eten|gerecht|pizza)\b/.test(q)) return "Ik kan zelf niet eten, maar pizza is een veelzijdige favoriet van veel mensen omdat je er zoveel kanten mee op kunt. Wat is jouw favoriete eten?";
    if (/\b(game|spel)\b/.test(q)) return "Ik speel zelf geen games, maar ik vind games met vrijheid om te bouwen, ontdekken en experimenteren interessant. Wat is jouw favoriete game?";
    return "Ik heb geen persoonlijke favorieten zoals een mens, maar ik kan wel helpen kiezen. Waar gaat je vraag precies over — muziek, films, games, eten, dieren of iets anders?";
  }
  if (/\b(heb jij|ben jij|wat doe jij|wat zou jij|wat lijkt jou|hou jij|houd jij)\b/.test(q) && /\b(hobby|favoriet|leuk|graag|doen|kiezen|spelen|kijken|luisteren|interesse)\b/.test(q)) {
    return "Ik heb zelf geen vrije tijd of persoonlijke ervaringen zoals een mens, maar ik kan wel voorkeuren beredeneren. Ik vind creatieve dingen, interessante techniek en ideeën waarbij je iets nieuws maakt leuke onderwerpen om over te praten. Wat vind jij leuk om in je vrije tijd te doen?";
  }
  if (/\b(hoe was je dag|wat ben je aan het doen|heb je gevoelens|heb je vrienden|heb je een hobby|waar woon je|waar hou je van|waar houd je van)\b/.test(q)) {
    if (/\b(hoe was je dag)\b/.test(q)) return "Ik heb zelf geen dag zoals een mens, maar ik ben er om met je te praten. Hoe was jouw dag? Gebeurde er iets leuks of juist iets vervelends?";
    if (/\b(wat ben je aan het doen)\b/.test(q)) return "Op dit moment beantwoord ik jouw bericht en probeer ik goed aan te sluiten op wat je zegt. 😊 Wat ben jij aan het doen?";
    if (/\b(gevoelens|vrienden|hobby)\b/.test(q)) return "Ik heb geen gevoelens, vrienden of hobby's zoals een mens. Ik kan wel gesprekken voeren, meedenken en allerlei onderwerpen met je verkennen. Wat doe jij graag als je vrije tijd hebt?";
    return "Ik heb geen fysieke woonplaats; ik ben een digitale assistent in deze webshop. Je hoeft hier zelf ook geen adres of andere privégegevens te delen. Waar wil je het over hebben?";
  }
  if (/\b(mijn lievelings|lievelingsdier|lievelingskleur|lievelingseten|mijn favoriete|favoriete game|favoriete film)\b/.test(q)) {
    if (/\b(dier|hond|kat|paard|konijn)\b/.test(q)) return "Een dier als favoriet kiezen is lastig; elk dier heeft iets bijzonders. Honden zijn vaak sociaal, katten kunnen eigenzinnig zijn en vogels zijn vaak verrassend slim. Welk dier vind jij het leukst?";
    if (/\b(game|spel)\b/.test(q)) return "Games kunnen heel verschillend zijn: bouwen, avontuur, strategie of samenwerken. Welke game speel je het liefst, en wat maakt die zo leuk?";
    if (/\b(kleur)\b/.test(q)) return "Kleuren kunnen heel verschillend aanvoelen: blauw en groen vaak rustig, geel en oranje energiek, paars wat creatiever. Welke kleur past het best bij jou?";
    return "Leuk onderwerp! Vertel eens wat jouw favoriet is en waarom je die kiest.";
  }
  if (/\b(ik ga|ik ben van plan|straks ga ik|morgen ga ik|dit weekend ga ik)\b/.test(q)) return "Oh, dat klinkt als iets om naar uit te kijken! Is het iets wat je vaker doet, of juist een bijzonder plan?";
  if (/\b(mijn hobby|ik hobby|ik speel|ik game|ik kijk graag|ik kijk|ik luister graag|ik luister|ik sport|ik teken|ik bouw|ik maak graag)\b/.test(q)) {
    const cleaned = question.trim();
    return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "interest");
  }
  if (/\b(ik ben|ik voel|ik vind|ik denk|ik hou van|ik houd van|ik heb|mijn dag|vandaag|gisteren|morgen)\b/.test(q)) {
    if (/\b(school|huiswerk|toets|leren|les)\b/.test(q)) return "School kan soms best veel tegelijk zijn. Gaat het om een vak dat je leuk vindt, of juist iets waar je tegenop ziet? Ik kan ook helpen iets uit te leggen of samen een planning te bedenken.";
    if (/\b(voetbal|sport|wedstrijd|trainen|team)\b/.test(q)) return "Leuk! Sport kan behoorlijk spannend zijn, zeker als je ergens voor traint of een wedstrijd hebt. Doe je zelf aan die sport, of volg je vooral een team?";
    if (/\b(game|gamen|minecraft|fortnite|roblox|playstation|xbox|nintendo)\b/.test(q)) return "Ah, games! Wat vind je er vooral leuk aan: bouwen, ontdekken, samenwerken, competitie of het verhaal? En welke game speel je op dit moment het meest?";
    if (/\b(muziek|lied|zingen|instrument|concert)\b/.test(q)) return "Muziek kan echt de sfeer van een dag veranderen. Naar welke muziek luister je graag? Heb je een favoriete artiest of juist verschillende stijlen door elkaar?";
    if (/\b(dier|hond|kat|paard|konijn|huisdier)\b/.test(q)) return /\b(ik heb|mijn)\b/.test(q) ? "Wat leuk! Wat voor dier heb je, en hoe heet die?" : "Dieren zijn fascinerend. Heb je zelf een huisdier, of is er een dier dat je heel graag zou willen hebben?";
    return "Ik luister. Vertel gerust wat er precies speelt of wat je eraan leuk, lastig of interessant vindt. Wat gebeurde er daarna?";
  }
  if (/^(kun je me helpen|kan je me helpen|help me|ik heb hulp nodig)$/.test(q)) return "Natuurlijk. Vertel me waar je mee bezig bent en wat je graag wilt bereiken. Dan pakken we het stap voor stap aan.";
  if (/^(wat zullen we doen|waar zullen we over praten|waar wil je over praten|waar heb je zin in)$/.test(q)) return "We kunnen een mini-quiz doen, een raadsel proberen, praten over sport, games, dieren, muziek of films, een creatief idee bedenken, of gewoon bespreken hoe je dag gaat. Waar heb jij nu het meeste zin in?";
  if (/\b(en jij|en met jou|hoe zit dat bij jou)\b/.test(q)) return "Ik heb geen eigen dag of ervaringen zoals jij, maar ik kan wel met je meedenken. Vertel eens: wat zou jij kiezen of hoe kijk jij ertegenaan?";
  if (/\b(ja|nee|graag|zeker|misschien|dat klopt|precies)\b/.test(q) && assistantLastBotText) {
    if (previousUser) return "Helder! 😊 Wil je daar nog iets over vertellen, of zullen we een nieuw onderwerp pakken?";
  }
  if (/\b(ik wil gewoon praten|laten we kletsen|gewoon even praten|ik wil kletsen)\b/.test(q)) return "Gezellig. Dan hoeft er geen speciale vraag te zijn. Hoe was je dag, of wat is iets waar je de laatste tijd veel aan denkt?";
  if (/\b(ik weet het niet|geen idee|maakt niet uit)\b/.test(q)) return "Geen probleem. Ik kan een grappig weetje vertellen, een raadsel geven, een paar leuke onderwerpen voorstellen of gewoon een vraag stellen: wat was vandaag het leukste moment?";
  if (/\b(ruimte|planeten|heelal|sterren|maan|mars)\b/.test(q)) return "Ruimte is een geweldig onderwerp om over te praten. Er zijn planeten met enorme stormen, manen onder een dikke ijslaag en sterren die veel groter zijn dan onze zon. Welk deel vind je het interessantst: planeten, zwarte gaten, astronauten of buitenaards leven?";
  if (/\b(geschiedenis|romeinen|egypte|middeleeuwen|dinosaurussen|historisch)\b/.test(q)) return "Geschiedenis zit vol verrassende verhalen. Wat ik er interessant aan vind, is hoe gewone keuzes en uitvindingen soms enorme gevolgen kregen. Welke periode of gebeurtenis spreekt jou aan?";
  if (/\b(techniek|computer|programmeren|robot|elektronica|uitvinding)\b/.test(q)) return "Techniek is leuk omdat ideeën uiteindelijk iets kunnen worden dat echt werkt. Ben je vooral benieuwd naar hoe iets werkt, of zou je zelf iets willen bouwen of programmeren?";
  if (/\b(film|films|serie|series|bioscoop|acteur)\b/.test(q)) return "Films en series zijn een leuk gespreksonderwerp. Hou je meer van actie, komedie, avontuur, sciencefiction of juist spannende mysteries?";
  if (/\b(eten|koken|pizza|pasta|gerecht|recept)\b/.test(q)) return "Lekker onderwerp! Ben je meer iemand die graag kookt en nieuwe dingen probeert, of kies je meestal iets wat je al kent?";
  if (/\b(vriend|vrienden|klas|familie|thuis)\b/.test(q)) return "Dat kan van alles betekenen. Wil je vertellen wat er speelt? Ik kan luisteren en samen met je bekijken wat je ermee zou kunnen doen.";
  if (!assistantLooksLikeInformationQuestion(question)) return assistantPickStoredMessage(ASSISTANT_CONVERSATION_MESSAGES, "followUp");
  return "Dat is een interessante vraag. Ik wil geen feiten verzinnen die ik niet zeker weet. Ik kan er wel met je over meedenken; voor een feitelijk antwoord kun je via het pijltje naast de verzendknop ‘Zoek op het internet’ kiezen. Als je vooral een mening of gesprek bedoelt, vertel dan gerust wat je zelf denkt.";
}

function assistantLooksLikeInformationQuestion(question) {
  const q = assistantNormalize(question);
  return /\?/.test(question)
    || /^(wat|wie|waar|wanneer|waarom|hoe|welke|welk|hoeveel|is |zijn |was |waren |kan |kun |mag |moet |heeft |hebben |bestaat |betekent |vertel over|vertel me over|vertel eens wat over|vertel me iets over|ik wil praten over|laten we praten over|praat over|leg uit|zoek |vergelijk |wanneer komt|wat weet je van)\b/.test(q)
    || /\b(zoek op|zoek naar|vertel over|vertel me over|vertel eens wat over|vertel me iets over|ik wil praten over|laten we praten over|praat over|leg uit|wat betekent|wie was|wie is|wat is|hoe werkt|hoe werkt dat)\b/.test(q);
}

async function assistantFetchJson(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET", mode: "cors", credentials: "omit",
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}

async function assistantSearchWikipedia(query) {
  const search = String(query || "").trim().slice(0, 260);
  if (!search) return [];
  const buildUrl = language => {
    const params = new URLSearchParams({
      action: "query", generator: "search", gsrsearch: search,
      gsrnamespace: "0", gsrlimit: "4", prop: "extracts|info",
      exintro: "1", explaintext: "1", exchars: "850", inprop: "url",
      format: "json", formatversion: "2", origin: "*"
    });
    return `https://${language}.wikipedia.org/w/api.php?${params.toString()}`;
  };
  let data;
  let language = "nl";
  try {
    data = await assistantFetchJson(buildUrl("nl"));
  } catch (error) {
    console.warn("Dutch Wikipedia search failed", error);
  }
  let pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
  if (!pages.length) {
    try {
      language = "en";
      data = await assistantFetchJson(buildUrl("en"));
      pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
    } catch (error) {
      console.warn("English Wikipedia search failed", error);
    }
  }
  return pages
    .filter(page => page && page.title)
    .sort((a, b) => (Number(a.index) || 999) - (Number(b.index) || 999))
    .slice(0, 4)
    .map(page => ({
      title: String(page.title).slice(0, 150),
      url: assistantSafeHttpsUrl(page.fullurl) || `https://${language}.wikipedia.org/wiki/${encodeURIComponent(String(page.title).replace(/ /g, "_"))}`,
      content: String(page.extract || page.snippet || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 850),
      source: "Wikipedia"
    }));
}

function assistantCollectDuckDuckGoTopics(topics, output = []) {
  if (!Array.isArray(topics)) return output;
  for (const topic of topics) {
    if (topic?.Topics) {
      assistantCollectDuckDuckGoTopics(topic.Topics, output);
      continue;
    }
    const url = assistantSafeHttpsUrl(topic?.FirstURL);
    const text = String(topic?.Text || "").replace(/\s+/g, " ").trim();
    if (url && text) output.push({
      title: text.split(" - ")[0].slice(0, 140), url,
      content: text.slice(0, 420), source: "DuckDuckGo"
    });
    if (output.length >= 6) break;
  }
  return output;
}

async function assistantSearchDuckDuckGo(query) {
  const params = new URLSearchParams({
    q: String(query || "").trim().slice(0, 260),
    format: "json", no_html: "1", skip_disambig: "1", kl: "nl-nl"
  });
  const data = await assistantFetchJson(`https://api.duckduckgo.com/?${params.toString()}`);
  const results = [];
  const abstractUrl = assistantSafeHttpsUrl(data?.AbstractURL);
  if (abstractUrl && data?.AbstractText) results.push({
    title: String(data.Heading || "DuckDuckGo direct antwoord").slice(0, 140),
    url: abstractUrl, content: String(data.AbstractText).slice(0, 850), source: "DuckDuckGo"
  });
  const definitionUrl = assistantSafeHttpsUrl(data?.DefinitionURL);
  if (definitionUrl && data?.Definition) results.push({
    title: String(data.DefinitionSource || "Definitie").slice(0, 140),
    url: definitionUrl, content: String(data.Definition).slice(0, 500), source: "DuckDuckGo"
  });
  const related = assistantCollectDuckDuckGoTopics(data?.RelatedTopics || []);
  results.push(...related);
  const answerText = [data?.Answer, data?.AbstractText, data?.Definition]
    .map(value => String(value || "").trim())
    .find(Boolean) || "";
  const answerUrl = assistantSafeHttpsUrl(data?.AnswerType ? data?.Redirect : "") || abstractUrl || definitionUrl;
  return {
    answer: answerText.slice(0, 1100),
    answerUrl,
    heading: String(data?.Heading || "").slice(0, 140),
    results: [...new Map(results.map(item => [item.url, item])).values()].slice(0, 6)
  };
}

async function assistantSearchOnline(question, scope = "general") {
  const rawQuery = assistantWebQuery(question);
  const queryText = assistantSearchQuery(question, scope);
  const cacheKey = `${scope}:${queryText}`;
  const cached = ASSISTANT_WEB_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.savedAt < 3 * 60 * 1000) return cached.data;

  // Wikipedia's MediaWiki API and DuckDuckGo Instant Answers both support
  // public, keyless browser requests. DuckDuckGo does not syndicate full
  // search-result lists through this API; a direct search link is also shown.
  const searchResults = await Promise.allSettled([
    assistantSearchWikipedia(rawQuery),
    assistantSearchDuckDuckGo(rawQuery)
  ]);
  const wikiResults = searchResults[0].status === "fulfilled" ? searchResults[0].value : [];
  const ddgData = searchResults[1].status === "fulfilled" ? searchResults[1].value : { answer: "", results: [] };
  if (searchResults[0].status === "rejected") console.warn("Wikipedia lookup failed", searchResults[0].reason);
  if (searchResults[1].status === "rejected") console.warn("DuckDuckGo instant answer lookup failed", searchResults[1].reason);

  const results = [...wikiResults, ...(ddgData.results || [])];
  const unique = [...new Map(results.map(item => [item.url, item])).values()].slice(0, 7);
  const answerParts = [];
  if (ddgData.answer) answerParts.push(`DuckDuckGo: ${ddgData.answer}`);
  const topWiki = wikiResults.find(item => item.content);
  if (topWiki) answerParts.push(`Wikipedia (${topWiki.title}): ${topWiki.content}`);
  const normalized = {
    query: queryText,
    answer: answerParts.join("\n\n").slice(0, 2000),
    results: unique,
    responseTime: null,
    searchProvider: "Wikipedia / DuckDuckGo",
    searchedSources: [
      ...(searchResults[0].status === "fulfilled" ? ["Wikipedia"] : []),
      ...(searchResults[1].status === "fulfilled" ? ["DuckDuckGo"] : [])
    ]
  };
  ASSISTANT_WEB_CACHE.set(cacheKey, { savedAt: Date.now(), data: normalized });
  return normalized;
}

function assistantSearchWebsiteLocal(question) {
  const catalogCount = assistantIsProductCountQuestion(question) ? assistantProductCountAnswer(question) : "";
  const priceExtremes = /\b(goedkoopste|voordeligste|duurste|meest duur|hoogste prijs)\b/.test(assistantNormalize(question)) ? assistantCatalogExtremesAnswer(question) : "";
  const recommendation = assistantIsRecommendationRequest(question) ? assistantRecommendationAnswer(question) : null;
  const products = assistantFindProducts(question).filter(item => item.score > 0).slice(0, 6);
  const faq = assistantFindFaq(question);
  let faqAnswer = "";
  if (faq) {
    try { faqAnswer = faq.answer({ question }); } catch (error) { console.warn("Local FAQ search failed", error); }
  }
  return { products, faq, faqAnswer, recommendation, catalogCount, priceExtremes };
}
function assistantAddWebsiteResults(question, data) {
  const matched = data.products || [];
  const summary = [];
  if (data.catalogCount) summary.push(data.catalogCount);
  if (data.priceExtremes) summary.push(data.priceExtremes);
  if (data.recommendation && typeof data.recommendation === "object") summary.push(data.recommendation.text);
  else if (typeof data.recommendation === "string") summary.push(data.recommendation);
  if (data.faqAnswer && !data.recommendation) summary.push(`Informatie uit de webshop:\n${data.faqAnswer}`);
  if (matched.length && !data.recommendation) summary.push(`Producten die bij je zoekvraag passen:\n${matched.map((item, index) => `${index + 1}. ${item.product.title || "Product"} — vanaf €${(Number(item.product.price) || 0).toFixed(2).replace(".", ",")}${isSoldOut(item.product) ? " · niet bestelbaar" : " · beschikbaar"}`).join("\n")}`);
  if (!summary.length) summary.push(`Ik heb in de lokale webshopgegevens geen duidelijke match gevonden voor “${question}”. Probeer een productnaam, categorie of onderwerp zoals verzenden, betalen, kleuren, maatwerk of 3D-preview. Je kunt ook de zoekbalk van de webshop gebruiken.`);
  const actions = data.recommendation?.recommendations
    ? assistantRecommendationActions(data.recommendation.recommendations)
    : matched.slice(0, 3).filter(item => item.product?.id).map(item => ({
      label: `Bekijk ${String(item.product.title || "product").slice(0, 25)}`,
      run: () => { closeShopAssistant(); showProduct(item.product.id); }
    }));
  const bubble = assistantAddMessage(summary.join("\n\n"), "bot", actions);
  if (bubble && matched.length) {
    const list = document.createElement("div");
    list.className = "assistant-web-results";
    matched.forEach(({ product }) => {
      const card = document.createElement("div");
      card.className = "assistant-web-result assistant-local-result";
      const title = document.createElement("strong"); title.textContent = String(product.title || "Product").slice(0, 140);
      const detail = document.createElement("span"); detail.textContent = `Vanaf €${(Number(product.price) || 0).toFixed(2).replace(".", ",")} · ${isSoldOut(product) ? "niet bestelbaar" : "beschikbaar"}`;
      const desc = document.createElement("small"); desc.textContent = String(product.description || "Product uit het actuele assortiment").slice(0, 180);
      card.append(title, detail, desc); list.append(card);
    });
    bubble.append(list);
  }
}

function assistantAddOnlineResults(question, data, shopSearch = false) {
  const engineLinks = assistantSearchEngineLinks(data.query || question);
  const hasAnswer = !!data.answer;
  const searchLabel = shopSearch ? "de openbare webshopinformatie" : "Wikipedia en DuckDuckGo";
  const summary = hasAnswer
    ? `Ik heb ${searchLabel} geraadpleegd voor “${question}”. Hieronder combineer ik de directe informatie en gevonden samenvattingen. Controleer belangrijke of actuele informatie altijd bij de oorspronkelijke bron.`
    : data.results.length
      ? `Ik heb in ${searchLabel} bronnen gevonden voor “${question}”. Dit zijn de beste treffers en hun samenvattingen:`
      : `Ik vond geen directe samenvatting in Wikipedia of DuckDuckGo voor “${question}”. Via de zoeklinks hieronder kun je de volledige zoekresultaten bekijken.`;
  const bubble = assistantAddMessage(hasAnswer ? `${summary}\n\n${data.answer}` : summary, "bot", assistantBuildActions(question));
  if (!bubble) return;
  if (data.results.length) {
    const list = document.createElement("div");
    list.className = "assistant-web-results";
    data.results.forEach(item => {
      const card = document.createElement("a");
      card.className = "assistant-web-result";
      card.href = item.url;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      const title = document.createElement("strong");
      title.textContent = String(item.title || item.url).slice(0, 140);
      const snippet = document.createElement("span");
      snippet.textContent = String(item.content || "").slice(0, 360);
      const domain = document.createElement("small");
      try { domain.textContent = item.source ? `${item.source} · ${new URL(item.url).hostname.replace(/^www\./, "")}` : new URL(item.url).hostname.replace(/^www\./, ""); } catch { domain.textContent = item.source || "Webbron"; }
      if (item.published_date) domain.textContent += ` · ${String(item.published_date).slice(0, 16)}`;
      card.append(title, snippet, domain);
      list.append(card);
    });
    bubble.append(list);
  }
  const engines = document.createElement("div");
  engines.className = "assistant-search-engines";
  const label = document.createElement("span");
  label.textContent = "Ook zoeken via:";
  engines.append(label);
  engineLinks.forEach(item => {
    const link = document.createElement("a");
    link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer";
    link.textContent = item.label;
    engines.append(link);
  });
  bubble.append(engines);
  assistantMessages.scrollTop = assistantMessages.scrollHeight;
}
function closeAssistantSearchMenu() {
  if (assistantSearchMenu) assistantSearchMenu.hidden = true;
  assistantSearchMenuToggle?.setAttribute("aria-expanded", "false");
}
function toggleAssistantSearchMenu() {
  if (!assistantSearchMenu || assistantBusy) return;
  const willOpen = assistantSearchMenu.hidden;
  assistantSearchMenu.hidden = !willOpen;
  assistantSearchMenuToggle?.setAttribute("aria-expanded", String(willOpen));
}
async function sendShopAssistantQuestion(value, selectedMode = "chat") {
  const question = String(value || "").trim();
  if (!question || assistantBusy) return;
  const mode = ["chat", "website", "internet"].includes(selectedMode) ? selectedMode : "chat";
  assistantBusy = true;
  if (assistantInput) assistantInput.disabled = true;
  if (assistantSearchMenuToggle) assistantSearchMenuToggle.disabled = true;
  const submitButton = assistantForm?.querySelector('button[type="submit"]');
  if (submitButton) submitButton.disabled = true;
  closeAssistantSearchMenu();
  assistantAddMessage(question, "user");
  const modeLabels = { chat: "Ik denk even met je mee…", website: "Ik doorzoek de openbare webshopinformatie…", internet: "Ik zoek in Wikipedia en DuckDuckGo…" };
  const thinking = assistantAddThinking(modeLabels[mode]);
  let searchScope = mode === "website" ? "shop" : "general";
  try {
    if (assistantIsSafetyRestricted(question)) {
      thinking?.remove();
      assistantAddMessage("Ik kan niet helpen met praktische instructies of zoekhulp voor dit onderwerp.", "bot");
    } else if (assistantContainsPrivateData(question)) {
      thinking?.remove();
      assistantAddMessage("Deel geen e-mailadres, telefoonnummer, postcode, IBAN, wachtwoord of herstelcode in deze chat. Ik heb je bericht niet doorgestuurd naar een zoekdienst. Stel je vraag opnieuw zonder persoonlijke gegevens.", "bot");
    } else if (mode === "website") {
      const contextualQuestion = assistantResolveFollowUp(question);
      const label = thinking?.querySelector(".assistant-thinking-label");
      if (label) label.textContent = "Ik doorzoek de productcatalogus en webshopuitleg…";
      const data = assistantSearchWebsiteLocal(contextualQuestion);
      thinking?.remove();
      assistantAddWebsiteResults(question, data);
      assistantLastTopicQuestion = contextualQuestion;
      assistantLastTopicScope = "shop";
    } else if (mode === "internet") {
      const contextualQuestion = assistantResolveFollowUp(question);
      assistantLastTopicQuestion = contextualQuestion;
      assistantLastTopicScope = "general";
      const label = thinking?.querySelector(".assistant-thinking-label");
      if (label) label.textContent = "Ik zoek in Wikipedia en DuckDuckGo…";
      const data = await assistantSearchOnline(contextualQuestion, "general");
      thinking?.remove();
      assistantAddOnlineResults(question, data, false);
    } else {
      const contextualQuestion = assistantResolveFollowUp(question);
      const smallTalk = assistantSmallTalkReply(question);
      if (smallTalk) {
        thinking?.remove();
        assistantAddMessage(smallTalk, "bot");
      } else if (assistantIsPrintRequest(contextualQuestion)) {
        thinking?.remove();
        const printResult = assistantUnlistedPrintAnswer(contextualQuestion);
        assistantLastTopicQuestion = contextualQuestion;
        assistantLastTopicScope = "shop";
        assistantAddMessage(printResult.text, "bot", printResult.actions);
      } else if (assistantIsProductCountQuestion(contextualQuestion)) {
        thinking?.remove();
        assistantAddMessage(assistantProductCountAnswer(contextualQuestion), "bot", assistantBuildActions(contextualQuestion));
        assistantLastTopicQuestion = contextualQuestion;
        assistantLastTopicScope = "shop";
      } else if (/\b(goedkoopste|voordeligste|duurste|meest duur|hoogste prijs)\b/.test(assistantNormalize(contextualQuestion))) {
        thinking?.remove();
        assistantAddMessage(assistantCatalogExtremesAnswer(contextualQuestion), "bot", assistantBuildActions(contextualQuestion));
        assistantLastTopicQuestion = contextualQuestion;
        assistantLastTopicScope = "shop";
      } else if (assistantIsRecommendationRequest(contextualQuestion)) {
        const recommendation = assistantRecommendationAnswer(contextualQuestion);
        thinking?.remove();
        if (typeof recommendation === "string") assistantAddMessage(recommendation, "bot");
        else assistantAddMessage(recommendation.text, "bot", assistantRecommendationActions(recommendation.recommendations));
        assistantLastTopicQuestion = contextualQuestion;
        assistantLastTopicScope = "shop";
      } else {
        const faq = assistantFindFaq(contextualQuestion);
        if (faq) {
          thinking?.remove();
          const answer = faq.answer({ question: contextualQuestion });
          assistantLastTopicQuestion = contextualQuestion;
          assistantLastTopicScope = "shop";
          assistantAddMessage(answer, "bot", assistantBuildActions(contextualQuestion));
        } else if (!assistantIsShopQuestion(contextualQuestion) && assistantIsGeneralHelpRequest(contextualQuestion)) {
          thinking?.remove();
          assistantAddMessage(assistantGeneralHelpReply(contextualQuestion), "bot");
        } else if ((!assistantLooksLikeInformationQuestion(contextualQuestion) || assistantIsConversationalPrompt(contextualQuestion)) && !assistantIsShopQuestion(contextualQuestion)) {
          thinking?.remove();
          assistantAddMessage(assistantConversationReply(question), "bot");
        } else {
          thinking?.remove();
          assistantAddMessage("Ik wil je geen antwoord verzinnen. Ik kan deze vraag niet met zekerheid beantwoorden op basis van de informatie die ik nu heb. Gebruik het pijltje naast de verzendknop en kies ‘Zoek in mijn webshop’ voor product- en winkelinformatie of ‘Zoek op het internet’ voor algemene informatie. Als het een persoonlijke vraag of een mening is, kun je die ook gewoon anders formuleren; dan denk ik met je mee.", "bot", assistantBuildActions(contextualQuestion));
        }
      }
    }
  } catch (error) {
    console.warn("Assistant lookup failed", error);
    thinking?.remove();
    const detail = String(error?.message || "");
    const rateLimited = /429|rate|limit|quota|capacity/i.test(detail);
    const fallback = assistantAddMessage(rateLimited
      ? "De online informatiebron heeft tijdelijk een gebruikslimiet bereikt. Je kunt het later opnieuw proberen of de zoeklinks hieronder openen."
      : "De online informatiebron is tijdelijk niet bereikbaar. Je kunt de zoeklinks hieronder rechtstreeks openen.", "bot");
    if (fallback) {
      const engines = document.createElement("div"); engines.className = "assistant-search-engines";
      const label = document.createElement("span"); label.textContent = "Zoek verder via:"; engines.append(label);
      assistantSearchEngineLinks(assistantSearchQuery(question, searchScope)).forEach(item => {
        const link = document.createElement("a"); link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = item.label; engines.append(link);
      });
      fallback.append(engines);
    }
  } finally {
    assistantBusy = false;
    if (assistantInput) assistantInput.disabled = false;
    if (assistantSearchMenuToggle) assistantSearchMenuToggle.disabled = false;
    if (submitButton) submitButton.disabled = false;
    if (assistantPanel && !assistantPanel.hidden) assistantInput?.focus();
  }
}
// Open/dicht-knop wordt ook door een kleine HTML-fallback bediend, zodat het paneel opent als de module niet laadt.
assistantClose?.addEventListener("click", closeShopAssistant);
assistantForm?.addEventListener("submit", event => {
  event.preventDefault();
  const question = assistantInput?.value.trim();
  if (!question) return;
  assistantInput.value = "";
  sendShopAssistantQuestion(question, "chat");
});
assistantSearchMenuToggle?.addEventListener("click", toggleAssistantSearchMenu);
assistantSearchMenu?.addEventListener("click", event => {
  const choice = event.target.closest("[data-assistant-send-mode]");
  if (!choice || assistantBusy) return;
  const question = assistantInput?.value.trim();
  if (!question) {
    closeAssistantSearchMenu();
    assistantInput?.focus();
    assistantAddMessage("Typ eerst je vraag. Open daarna het pijltje naast de verzendknop en kies waar ik moet zoeken.", "bot");
    return;
  }
  assistantInput.value = "";
  closeAssistantSearchMenu();
  sendShopAssistantQuestion(question, choice.dataset.assistantSendMode || "chat");
});
document.addEventListener("click", event => {
  if (!event.target.closest(".assistant-send-wrap")) closeAssistantSearchMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeAssistantSearchMenu();
});
assistantSuggestions?.addEventListener("click", event => {
  const button = event.target.closest("[data-assistant-prompt]");
  if (!button || assistantBusy) return;
  sendShopAssistantQuestion(button.dataset.assistantPrompt, button.dataset.assistantMode || "chat");
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && assistantPanel && !assistantPanel.hidden) closeShopAssistant();
});

/* ---------- start ---------- */
try { const s = JSON.parse(sessionStorage.getItem("novashopUser") || "null"); if (s?.uid && s.role === "customer") state.user = s; else if (s?.role === "admin") { sessionStorage.removeItem("novashopUser"); sessionStorage.setItem("novashopAdmin", "1"); } } catch { sessionStorage.removeItem("novashopUser"); }
if (sessionStorage.getItem("novashopAdmin") === "1") state.admin = true;
installForegroundChatPush().catch(error => console.warn("Voorgrondmeldingen niet gestart:", error));
if (state.user?.uid || state.admin) syncPushForActiveAccount();
onValue(ref(db, "settings/maintenance"), snap => {
  const config = snap.val() || {};
  state.maintenanceActive = config.active === true;
  renderMaintenanceScreen();
  if (!state.maintenanceActive) scheduleChatPushWelcome();
}, error => console.warn("Onderhoudsstatus laden mislukt", error));
if (!state.user?.uid) state.favoriteIds = readGuestFavorites();
refreshNav(); saveCart();
if (state.user?.uid) { const cachedUser = state.user; get(ref(db, `profiles/${cachedUser.uid}`)).then(snap => { const profile = snap.val(); if (profile?.username) setCustomer({ ...cachedUser, username: profile.username }); else usernamePrompt(cachedUser.uid, cachedUser.email, cachedUser.username || ""); }).catch(() => {}); }
const startupParams = new URLSearchParams(location.search);
const notificationChatId = startupParams.get("openChat");
const notificationRole = startupParams.get("openRole") === "admin" ? "admin" : "customer";
if (notificationChatId) {
  sessionStorage.setItem("pendingNotificationChat", notificationChatId);
  sessionStorage.setItem("pendingNotificationRole", notificationRole);
  if (notificationRole === "admin") {
    if (state.admin) openPendingNotificationChat();
    else openAdminLogin();
  } else if (state.user?.uid) openPendingNotificationChat();
  else authForm("login", "Log in om het nieuwe chatbericht te bekijken.");
  startupParams.delete("openChat");
  startupParams.delete("openRole");
  const cleanUrl = `${location.pathname}${startupParams.toString() ? `?${startupParams}` : ""}${location.hash}`;
  history.replaceState({}, "", cleanUrl);
}
const publicTrackToken = startupParams.get("track");
if (publicTrackToken) showPublicTracking(publicTrackToken);
const returnedOrder = new URLSearchParams(location.search).get("order");
if (returnedOrder) { toast("Je bent terug van de betaalpagina. De betaalstatus wordt door Mollie bevestigd."); history.replaceState({}, "", location.pathname); }
