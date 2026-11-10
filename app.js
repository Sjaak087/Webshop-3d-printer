import { db, storage } from "./firebase.js";
import { BEHEER_CONFIG } from "./beheer-config.js";
import { ref, onValue, get, push, set, update, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-database.js";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js";

const $ = s => document.querySelector(s);
const state = { user:null, admin:false, products:[], cart:[], activeProduct:null, activeChat:null, orders:[], chats:[], currentTab:"products" };
const overlay=$("#overlay"), content=$("#dialogContent");
$("#year").textContent=new Date().getFullYear();

function toast(msg){const el=$("#toast");el.textContent=msg;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2800)}
function openDialog(html){content.innerHTML=html;overlay.classList.remove("hidden")}
function closeDialog(){overlay.classList.add("hidden");content.innerHTML=""}
$("#closeDialog").onclick=closeDialog; overlay.addEventListener("click",e=>{if(e.target===overlay)closeDialog()});
const money=n=>new Intl.NumberFormat("nl-NL",{style:"currency",currency:"EUR"}).format(Number(n)||0);
const safe=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const isAdmin=u=>!!u && u.role==="admin";

onValue(ref(db,"products"),snap=>{
 state.products=Object.entries(snap.val()||{}).map(([id,p])=>({id,...p})).filter(p=>p.active!==false);
 renderProducts();
});

function renderProducts(){
 const q=($("#search").value||"").toLowerCase();
 const list=state.products.filter(p=>(p.title+" "+(p.description||"")).toLowerCase().includes(q));
 $("#productTotal").textContent=`${list.length} producten`;
 $("#products").innerHTML=list.length?list.map(p=>`<article class="product-card" data-id="${safe(p.id)}"><button class="product-open" data-open="${safe(p.id)}"><div class="product-image">${p.image?`<img src="${safe(p.image)}" alt="${safe(p.title)}">`:"<span>✦</span>"}</div><div class="product-info"><h3>${safe(p.title)}</h3><strong>${money(p.price)}</strong></div></button><button class="add-small" data-add="${safe(p.id)}">＋ In winkelwagen</button></article>`).join(""):`<div class="empty-state">Nog geen producten gevonden.<br><small>Beheerder? Voeg producten toe via Sitebeheer.</small></div>`;
}
$("#searchBtn").onclick=renderProducts;$("#search").addEventListener("input",renderProducts);
$("#products").addEventListener("click",e=>{
 const add=e.target.closest("[data-add]");if(add){e.stopPropagation();addCart(add.dataset.add);return}
 const open=e.target.closest("[data-open]");if(open)showProduct(open.dataset.open);
});
function showProduct(id){
 const p=state.products.find(x=>x.id===id);if(!p)return;
 state.activeProduct=id;
 openDialog(`<div class="product-detail"><div class="detail-image">${p.image?`<img src="${safe(p.image)}" alt="${safe(p.title)}">`:"✦"}</div><div><p class="eyebrow">PRODUCTDETAILS</p><h2>${safe(p.title)}</h2><div class="detail-price">${money(p.price)}</div><p class="description">${safe(p.description||"Geen beschrijving beschikbaar.")}</p><button class="primary full" id="detailAdd">＋ Toevoegen aan winkelwagen</button></div></div>`);
 $("#detailAdd").onclick=()=>{addCart(id);closeDialog()};
}
function addCart(id){const p=state.products.find(x=>x.id===id);if(!p)return;const item=state.cart.find(x=>x.id===id);if(item)item.qty++;else state.cart.push({id,title:p.title,price:Number(p.price),image:p.image||"",qty:1});renderCartCount();toast("Toegevoegd aan je winkelwagen")}
function renderCartCount(){$("#cartCount").textContent=state.cart.reduce((n,x)=>n+x.qty,0)}
$("#cartBtn").onclick=showCart;
function showCart(){
 const total=state.cart.reduce((n,x)=>n+x.price*x.qty,0);
 openDialog(`<p class="eyebrow">JOUW SELECTIE</p><h2>Winkelwagen</h2>${state.cart.length?`<div class="cart-lines">${state.cart.map(x=>`<div class="cart-line"><div><b>${safe(x.title)}</b><small>${money(x.price)} · aantal ${x.qty}</small></div><div><b>${money(x.price*x.qty)}</b><button class="remove-item" data-remove="${x.id}">Verwijder</button></div></div>`).join("")}</div><div class="cart-total"><span>Totaal</span><b>${money(total)}</b></div><button class="primary full" id="checkout">Verder naar bestellen</button>`:`<div class="empty-state">Je winkelwagen is nog leeg.</div><button class="secondary full" id="continue">Verder winkelen</button>`}`);
 content.querySelectorAll("[data-remove]").forEach(b=>b.onclick=()=>{state.cart=state.cart.filter(x=>x.id!==b.dataset.remove);showCart();renderCartCount()});
 $("#continue")?.addEventListener("click",closeDialog);
 $("#checkout")?.addEventListener("click",()=>{if(!state.user){authForm("login","Log in om je bestelling af te ronden.");return}placeOrder()});
}
function authForm(mode="login",message=""){
 openDialog(`<p class="eyebrow">NOVA ACCOUNT</p><h2>${mode==="login"?"Welkom terug":"Account aanmaken"}</h2><p class="muted">${safe(message)}</p><form id="authForm" class="stack"><label>E-mailadres<input type="email" id="authEmail" required autocomplete="email"></label><label>Wachtwoord<input type="password" id="authPassword" required autocomplete="${mode==="login"?"current-password":"new-password"}"></label><button class="primary full">${mode==="login"?"Inloggen":"Account aanmaken"}</button></form><p class="switch-auth">${mode==="login"?"Nog geen account?":"Heb je al een account?"} <button id="switchAuth" class="inline-link">${mode==="login"?"Account aanmaken":"Inloggen"}</button></p>`);
 $("#authForm").onsubmit=async e=>{
  e.preventDefault();
  const email=$("#authEmail").value.trim().toLowerCase(),password=$("#authPassword").value;
  try{
   const usersSnap=await get(ref(db,"users"));
   const users=Object.entries(usersSnap.val()||{});
   if(mode==="register"){
    if(users.some(([,u])=>(u.email||"").toLowerCase()===email)){toast("Dit e-mailadres bestaat al.");return}
    const accountRef=push(ref(db,"users"));
    const user={uid:accountRef.key,email,password,createdAt:Date.now(),accountType:"customer"};
    await set(accountRef,user); state.user=user; state.admin=false;
   }else{
    const found=users.find(([,u])=>(u.email||"").toLowerCase()===email && u.password===password);
    if(!found){toast("E-mailadres of wachtwoord klopt niet.");return}
    state.user={uid:found[0],...found[1]};state.admin=false;
   }
   sessionStorage.setItem("novashopUser",JSON.stringify(state.user));
   $("#accountBtn").textContent="Mijn account";closeDialog();toast(mode==="register"?"Account aangemaakt!":"Je bent ingelogd");
  }catch(err){toast("Accountactie mislukt: "+err.message)}
 };
 $("#switchAuth").onclick=()=>authForm(mode==="login"?"register":"login");
}
$("#accountBtn").onclick=()=>state.user?accountMenu():authForm();
function accountMenu(){openDialog(`<p class="eyebrow">MIJN ACCOUNT</p><h2>${safe(state.user.email)}</h2><div class="stack"><button class="secondary full" id="myOrders">Mijn bestellingen</button><button class="secondary full" id="myChats">Mijn chats</button><button class="secondary full" id="logout">Uitloggen</button></div>`);$("#myOrders").onclick=()=>{closeDialog();showMyOrders()};$("#myChats").onclick=()=>showMyChats();$("#logout").onclick=async()=>{state.user=null;state.admin=false;sessionStorage.removeItem("novashopUser");$("#accountBtn").textContent="Inloggen";state.cart=[];renderCartCount();closeDialog();toast("Je bent uitgelogd")}}
async function placeOrder(){
 if(!state.cart.length)return;
 const total=state.cart.reduce((n,x)=>n+x.price*x.qty,0),orderRef=push(ref(db,"orders"));
 const order={userId:state.user.uid,email:state.user.email,items:state.cart.map(({id,title,price,qty})=>({id,title,price,qty})),total,status:"ontvangen",createdAt:Date.now()};
 try{
  await set(orderRef,order);
  const chatRef=push(ref(db,"chats"));
  await set(chatRef,{orderId:orderRef.key,userId:state.user.uid,email:state.user.email,createdAt:Date.now(),lastMessage:"Bestelling geplaatst",messages:{[push(ref(db,"temp")).key]:{sender:"system",text:"Je bestelling is ontvangen. Stel hier gerust je vragen.",createdAt:Date.now()}}});
  await update(orderRef,{chatId:chatRef.key});
  state.cart=[];renderCartCount();closeDialog();toast("Bestelling geplaatst! Je chat is geopend.");openChat(chatRef.key);
 }catch(e){toast("Bestellen lukte niet: "+e.message)}
}
function showMyOrders(){if(!state.user){authForm();return}onValue(ref(db,"orders"),snap=>{const orders=Object.entries(snap.val()||{}).map(([id,o])=>({id,...o})).filter(o=>o.userId===state.user.uid).sort((a,b)=>b.createdAt-a.createdAt);openDialog(`<p class="eyebrow">OVERZICHT</p><h2>Mijn bestellingen</h2>${orders.length?orders.map(o=>`<div class="order-row"><div><b>Bestelling #${o.id.slice(-6)}</b><small>${new Date(o.createdAt).toLocaleString("nl-NL")} · ${money(o.total)}</small><span class="status-pill">${safe(o.status)}</span></div><button class="secondary" data-track="${o.id}">Volgen</button></div>`).join(""):"<p class='muted'>Je hebt nog geen bestellingen.</p>"}`);content.querySelectorAll("[data-track]").forEach(b=>b.onclick=()=>showOrderTracking(b.dataset.track))},{onlyOnce:true})}
function showOrderTracking(id){get(ref(db,"orders/"+id)).then(s=>{const o=s.val();if(!o)return;openDialog(`<p class="eyebrow">TRACK & TRACE</p><h2>Bestelling #${id.slice(-6)}</h2><div class="tracking">${["ontvangen","verwerkt","gemaakt","klaar voor bezorging"].map((x,i)=>`<div class="track-step ${["ontvangen","verwerkt","gemaakt","klaar voor bezorging"].indexOf(o.status)>=i?"done":""}"><span>${i+1}</span><b>${x}</b></div>`).join("")}</div><p class="muted">Huidige status: <b>${safe(o.status)}</b></p><button class="primary full" id="trackChat">Open chat over deze bestelling</button>`);$("#trackChat").onclick=()=>o.chatId&&openChat(o.chatId)})}
function showMyChats(){if(!state.user){authForm();return}onValue(ref(db,"chats"),snap=>{const chats=Object.entries(snap.val()||{}).map(([id,c])=>({id,...c})).filter(c=>c.userId===state.user.uid).sort((a,b)=>b.createdAt-a.createdAt);openDialog(`<p class="eyebrow">SERVICE</p><h2>Mijn chats</h2>${chats.length?chats.map(c=>`<button class="chat-list-item" data-chat="${c.id}"><b>Bestelling #${(c.orderId||"").slice(-6)}</b><small>${safe(c.lastMessage||"Chat openen")}</small></button>`).join(""):"<p class='muted'>Je hebt nog geen chats. Na een bestelling verschijnt hier je gesprek.</p>"}`);content.querySelectorAll("[data-chat]").forEach(b=>b.onclick=()=>openChat(b.dataset.chat))},{onlyOnce:true})}
$("#myChatsBtn").onclick=showMyChats;
function openChat(id){
 if(!state.user)return authForm();
 state.activeChat=id;
 onValue(ref(db,"chats/"+id),snap=>{
  const c=snap.val();if(!c){toast("Chat niet gevonden");return}
  if(!state.admin&&c.userId!==state.user.uid)return;
  const messages=Object.entries(c.messages||{}).map(([mid,m])=>({id:mid,...m})).sort((a,b)=>a.createdAt-b.createdAt);
  openDialog(`<div class="chat-heading"><div><p class="eyebrow">KLANTENSERVICE</p><h2>Chat bestelling #${(c.orderId||"").slice(-6)}</h2></div><button class="secondary" id="chatTrack">Track & trace</button></div><div id="messages" class="messages">${messages.map(m=>`<div class="message ${m.sender==="admin"?"theirs":m.sender==="system"?"system":"mine"}"><p>${safe(m.text)}</p><small>${m.sender==="admin"?"NovaShop":m.sender==="system"?"Systeem":"Jij"} · ${new Date(m.createdAt).toLocaleString("nl-NL")}</small></div>`).join("")}</div><form id="sendMessage" class="send-message"><input id="messageText" placeholder="Typ je bericht…" required maxlength="1000"><button class="primary">Verstuur</button></form>`);
  $("#messages").scrollTop=$("#messages").scrollHeight;
  $("#sendMessage").onsubmit=async e=>{e.preventDefault();const text=$("#messageText").value.trim();if(!text)return;const m=push(ref(db,`chats/${id}/messages`));await set(m,{sender:state.admin?"admin":"user",uid:state.user.uid,text,createdAt:Date.now()});await update(ref(db,"chats/"+id),{lastMessage:text,lastMessageAt:Date.now()});$("#messageText").value=""};
  $("#chatTrack").onclick=()=>get(ref(db,"chats/"+id)).then(s=>{const c=s.val();if(c?.orderId)showOrderTracking(c.orderId)});
 });
}
function adminPanel(){
 if(!state.admin){authForm();return}
 openDialog(`<div class="admin-head"><div><p class="eyebrow">NOVA SHOP</p><h2>Sitebeheer</h2></div><span class="admin-label">BEHEERDER</span></div><div class="tabs"><button data-tab="products" class="active">Producten</button><button data-tab="orders">Track & trace</button><button data-tab="chats">Chats</button></div><div id="adminContent"></div>`);
 content.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>{state.currentTab=b.dataset.tab;content.querySelectorAll("[data-tab]").forEach(x=>x.classList.toggle("active",x===b));renderAdminTab()});
 renderAdminTab();
}
function renderAdminTab(){
 const target=$("#adminContent");if(!target)return;
 if(state.currentTab==="products"){
  onValue(ref(db,"products"),snap=>{const ps=Object.entries(snap.val()||{}).map(([id,p])=>({id,...p}));target.innerHTML=`<div class="admin-toolbar"><h3>Producten beheren</h3><button class="primary" id="newProduct">＋ Product toevoegen</button></div>${ps.length?ps.map(p=>`<div class="admin-row"><div class="admin-product">${p.image?`<img src="${safe(p.image)}">`:"✦"}<div><b>${safe(p.title)}</b><small>${money(p.price)}</small></div></div><div><button class="secondary" data-edit="${p.id}">Bewerken</button> <button class="remove-item" data-delete="${p.id}">Verwijderen</button></div></div>`).join(""):"<p class='muted'>Je hebt nog geen producten toegevoegd.</p>"}`;
   $("#newProduct").onclick=()=>productEditor();target.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>productEditor(b.dataset.edit));target.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{if(confirm("Dit product verwijderen?")){const p=ps.find(x=>x.id===b.dataset.delete);await remove(ref(db,"products/"+b.dataset.delete));if(p?.imagePath)try{await deleteObject(storageRef(storage,p.imagePath))}catch{}toast("Product verwijderd")}});
  });
 }else if(state.currentTab==="orders"){
  onValue(ref(db,"orders"),snap=>{state.orders=Object.entries(snap.val()||{}).map(([id,o])=>({id,...o})).sort((a,b)=>b.createdAt-a.createdAt);target.innerHTML=`<h3>Bestellingen en status</h3>${state.orders.length?state.orders.map(o=>`<div class="admin-row order-admin"><div><b>#${o.id.slice(-6)} · ${safe(o.email)}</b><small>${(o.items||[]).map(i=>`${safe(i.title)} × ${i.qty}`).join(", ")} · ${money(o.total)}</small></div><select data-status="${o.id}">${["ontvangen","verwerkt","gemaakt","klaar voor bezorging"].map(s=>`<option ${o.status===s?"selected":""}>${s}</option>`).join("")}</select><button class="secondary" data-openorderchat="${o.chatId||""}">Chat</button></div>`).join(""):"<p class='muted'>Nog geen bestellingen.</p>"}`;
   target.querySelectorAll("[data-status]").forEach(sel=>sel.onchange=()=>update(ref(db,"orders/"+sel.dataset.status),{status:sel.value}).then(()=>toast("Bestelstatus bijgewerkt")));target.querySelectorAll("[data-openorderchat]").forEach(b=>b.onclick=()=>b.dataset.openorderchat&&openChat(b.dataset.openorderchat));
  });
 }else{
  onValue(ref(db,"chats"),snap=>{state.chats=Object.entries(snap.val()||{}).map(([id,c])=>({id,...c})).sort((a,b)=>(b.lastMessageAt||b.createdAt)-(a.lastMessageAt||a.createdAt));target.innerHTML=`<h3>Klantenchats</h3>${state.chats.length?state.chats.map(c=>`<button class="chat-list-item" data-adminchat="${c.id}"><b>${safe(c.email||"Klant")} · #${(c.orderId||"").slice(-6)}</b><small>${safe(c.lastMessage||"Nieuw gesprek")}</small></button>`).join(""):"<p class='muted'>Er zijn nog geen chats.</p>"}`;target.querySelectorAll("[data-adminchat]").forEach(b=>b.onclick=()=>openChat(b.dataset.adminchat))});
 }
}
async function productEditor(id=null){
 const snap=id?await get(ref(db,"products/"+id)):null,p=snap?.val()||{};
 openDialog(`<p class="eyebrow">CATALOGUS</p><h2>${id?"Product bewerken":"Nieuw product"}</h2><form id="productForm" class="stack"><label>Titel<input id="pTitle" required maxlength="100" value="${safe(p.title||"")}"></label><label>Prijs in euro<input id="pPrice" type="number" min="0" step="0.01" required value="${p.price??""}"></label><label>Beschrijving<textarea id="pDescription" rows="4">${safe(p.description||"")}</textarea></label><label>Productafbeelding<input id="pImage" type="file" accept="image/png,image/jpeg,image/webp"></label>${p.image?`<img class="preview" src="${safe(p.image)}">`:""}<button class="primary full">Product opslaan</button></form>`);
 $("#productForm").onsubmit=async e=>{e.preventDefault();const title=$("#pTitle").value.trim(),price=Number($("#pPrice").value),description=$("#pDescription").value.trim(),file=$("#pImage").files[0];if(!Number.isFinite(price)||price<0)return toast("Vul een geldige prijs in");try{let image=p.image||"",imagePath=p.imagePath||"";if(file){if(file.size>5*1024*1024)return toast("Afbeelding mag maximaal 5 MB zijn");if(!["image/jpeg","image/png","image/webp"].includes(file.type))return toast("Gebruik JPG, PNG of WEBP");imagePath=`products/${id||"new-"+Date.now()}/${file.name.replace(/[^a-zA-Z0-9._-]/g,"_")}`;const r=storageRef(storage,imagePath);await uploadBytes(r,file);image=await getDownloadURL(r)}const product={title,price,description,image,imagePath,active:true,updatedAt:Date.now()};if(id)await update(ref(db,"products/"+id),product);else await set(push(ref(db,"products")), {...product,createdAt:Date.now()});closeDialog();toast("Product opgeslagen")}catch(err){toast("Opslaan mislukt: "+err.message)}};
}
$("#adminEntry").onclick=()=>{if(state.admin)adminPanel();else openAdminLogin()};
function openAdminLogin(){
 openDialog(`<p class="eyebrow">ALLEEN VOOR BEHEERDERS</p><h2>Sitebeheer</h2><p class="muted">Log in met de gegevens uit beheer-config.js.</p><form id="adminLoginForm" class="stack"><label>E-mailadres<input id="adminEmail" type="email" required autocomplete="username" value="${safe(BEHEER_CONFIG.adminEmail)}"></label><label>Wachtwoord<input id="adminPassword" type="password" required autocomplete="current-password"></label><button class="primary full">Inloggen als beheerder</button></form>`);
 $("#adminLoginForm").onsubmit=e=>{
  e.preventDefault();
  const email=$("#adminEmail").value.trim().toLowerCase(),password=$("#adminPassword").value;
  if(email!==BEHEER_CONFIG.adminEmail.toLowerCase()||password!==BEHEER_CONFIG.adminPassword){toast("E-mailadres of wachtwoord klopt niet.");return}
  state.user={uid:"admin",email,role:"admin",accountType:"admin"};state.admin=true;
  sessionStorage.setItem("novashopUser",JSON.stringify(state.user));
  closeDialog();adminPanel();
 };
}
try{
 const saved=JSON.parse(sessionStorage.getItem("novashopUser")||"null");
 if(saved?.uid){state.user=saved;state.admin=saved.role==="admin";$("#accountBtn").textContent="Mijn account";}
}catch{sessionStorage.removeItem("novashopUser")}
$("#adminEntry").textContent=state.admin?"Sitebeheer · ingelogd":"Sitebeheer";
