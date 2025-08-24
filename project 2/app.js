
const CG_BASE = "https://api.coingecko.com/api/v3";
const CG_MARKETS = `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&locale=en`;
const cgInfo = (id) =>
  `${CG_BASE}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
const CC_MULTI = (syms) =>
  `https://min-api.cryptocompare.com/data/pricemulti?fsyms=${encodeURIComponent(syms.join(","))}&tsyms=USD`;


const cors = (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`;


const $ = (s) => document.querySelector(s);
const on = (ev, sel, cb) =>
  document.addEventListener(ev, (e) => { const el = e.target.closest(sel); if (el) cb(e, el); });

const show = (sel) => $(sel)?.classList.remove("d-none");
const hide = (sel) => $(sel)?.classList.add("d-none");
function err(m){ const b=$("#alertBox"); if(!b) return; b.textContent=m; b.classList.remove("d-none"); }
function clearErr(){ const b=$("#alertBox"); if(!b) return; b.textContent=""; b.classList.add("d-none"); }
function loading(v){ v ? show("#loader") : hide("#loader"); }


let lastReqTime = 0;
async function fetchWithRateLimit(url, {retries=2, baseDelay=1200} = {}){
  const GAP = 850;
  const now = Date.now();
  const wait = Math.max(0, lastReqTime + GAP - now);
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastReqTime = Date.now();

  for (let i=0; ; i++){
    const res = await fetch(url);
    if (res.status !== 429 || i === retries) return res;
    await new Promise(r => setTimeout(r, baseDelay * (i+1)));
  }
}


const LIST_KEY = "cg_markets_cache_v2";
const LIST_TTL = 12 * 60 * 60 * 1000;
function loadListCache(){
  try{
    const o = JSON.parse(localStorage.getItem(LIST_KEY));
    if (o && Array.isArray(o.data) && Date.now() - o.at < LIST_TTL) return o.data;
  }catch{}
  return null;
}
function saveListCache(list){
  try{ localStorage.setItem(LIST_KEY, JSON.stringify({ at: Date.now(), data: list })); }catch{}
}


const INFO_TTL = 2 * 60 * 1000;
const infoCache = new Map();      
const infoInflight = new Map();  


const WL_KEY = "watchlist_ids";
const WL_MAX = 5;

const wlLoad = () => { try { return JSON.parse(localStorage.getItem(WL_KEY)) || []; } catch { return []; } };
const wlSave = (a) => { localStorage.setItem(WL_KEY, JSON.stringify(a)); updateReportsCount(); };

function removeFromWatchlist(id){
  wlSave(wlLoad().filter(x=>x!==id));
}
function addToWatchlist(id){
  const wl = wlLoad();
  if (wl.includes(id)) return {ok:true};
  if (wl.length >= WL_MAX) return {ok:false, needModal:true};
  wl.push(id); wlSave(wl); return {ok:true};
}
function updateReportsCount(){
  const n = wlLoad().length;
  const btn = document.querySelector('[data-route="reports"]');
  if (btn) btn.innerHTML = `דוחות <span class="badge text-bg-secondary">${n}</span>`;
}

let ROUTE = "coins";
function go(r){
  ROUTE = r; clearErr();
  if (r === "about")   return renderAbout();
  if (r === "reports") return renderReports();
  return renderCoins();
}
on("click", "[data-route]", (_, el)=> go(el.dataset.route));

function renderAbout(){
  const photo = "prisoner no.1234567 yuval.jpg"; 
  $("#app-content").innerHTML = `
    <section class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex align-items-center gap-3 mb-3">
          <img src="${photo}" alt="Yuval Moshe Tamir" width="96" height="96"
               class="rounded-circle border" style="object-fit:cover" onerror="this.remove()">
          <div>
            <h2 class="h5 m-0">אודות הפרויקט</h2>
            <div class="text-muted small">Vanilla JS · Bootstrap · Fetch API · CoinGecko · CryptoCompare</div>
          </div>
        </div>
        <ul class="list-unstyled mb-3">
          <li><strong>שם מלא:</strong> Yuval Moshe Tamir</li>
          <li><strong>אימייל:</strong> yuvaltamir1324@gmail.com</li>
          <li><strong>שפות:</strong> עברית (שפת אם), אנגלית (רמה טובה)</li>
        </ul>
        <p class="text-muted small m-0">
          דשבורד קריפטו: רשימת Top 100 לפי שווי שוק, More Info עם Cache, דוחות (עד 5) וגרף זמן אמת.
        </p>
      </div>
    </section>
  `;
}

function renderCoins(){
  $("#app-content").innerHTML = `
    <section class="mb-3 d-flex align-items-end justify-content-between">
      <div>
        <h2 class="h5 mb-1">מטבעות</h2>
        <p class="text-muted m-0">Top 100 Market Cap · More Info (USD/EUR/ILS) · הוסף לדוחות</p>
      </div>
      <div class="d-flex gap-2">
        <input id="searchInput" class="form-control" placeholder="חפש קוד (BTC)">
        <button id="searchBtn" class="btn btn-primary">חיפוש</button>
      </div>
    </section>
    <section class="card shadow-sm"><div class="p-2"><div id="coinsGrid" class="grid"></div></div></section>
  `;
  fetchMarkets();
}


const coinById = new Map();  
const coinBySym = new Map(); 

async function fetchMarkets(){
  loading(true);
  try{
    const cached = loadListCache();
    if (cached) { indexCoins(cached); window.__coins = cached; renderCoinsGrid(cached); return; }

    const r = await fetchWithRateLimit(cors(CG_MARKETS));
    if(!r.ok) throw new Error("markets http " + r.status);
    const list = await r.json();

    saveListCache(list);
    indexCoins(list);
    window.__coins = list;
    renderCoinsGrid(list);
  }catch(e){
    console.error(e);
    err("נכשלה טעינת רשימת המטבעות.");
  }finally{ loading(false); }
}

function indexCoins(list){
  coinById.clear(); coinBySym.clear();
  for (const c of list){
    coinById.set(c.id, c);
    coinBySym.set((c.symbol||"").toUpperCase(), c);
  }
}


function renderCoinsGrid(list){
  const grid = $("#coinsGrid");
  grid.innerHTML = "";
  if(!list.length){ grid.innerHTML = `<div class="text-muted">אין תוצאות</div>`; return; }

  const frag = document.createDocumentFragment();
  for (const c of list){
    const { id, symbol, name, image, current_price, high_24h, low_24h } = c;
    const SYM = (symbol||"").toUpperCase();
    const safe = `info-${id.replace(/[^a-z0-9_-]/gi,"_")}`;
    const on = wlLoad().includes(id);

    const card = document.createElement("div");
    card.className = "card shadow-sm";
    card.innerHTML = `
      <div class="card-body d-flex flex-column gap-2">
        <div class="d-flex justify-content-between align-items-center">
          <div class="d-flex align-items-center gap-2">
            ${image?`<img src="${image}" width="20" height="20" alt="${name}">`:""}
            <div><strong>${SYM}</strong> <span class="text-muted">· ${name}</span></div>
          </div>
          <div class="form-check form-switch m-0">
            <input class="form-check-input" type="checkbox" ${on?"checked":""} data-watch="${id}" aria-label="הוסף/הסר מדוחות">
          </div>
        </div>
        <button class="btn btn-sm btn-outline-secondary" data-more="${id}" data-target="#${safe}" aria-label="פרטים נוספים">More Info</button>
        <div id="${safe}" class="collapse border-top pt-2 small" data-loaded="0"></div>
        <div class="small text-muted d-flex justify-content-between">
          <span>24h Low ${low_24h!=null?`$${low_24h}`:"N/A"}</span>
          <span>Price ${current_price!=null?`$${current_price}`:"N/A"}</span>
          <span>24h High ${high_24h!=null?`$${high_24h}`:"N/A"}</span>
        </div>
      </div>`;
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}


on("click", "#searchBtn", ()=>{
  const q = ($("#searchInput").value||"").trim().toUpperCase();
  if(!q) return renderCoinsGrid(window.__coins||[]);
  const c = coinBySym.get(q);
  renderCoinsGrid(c ? [c] : []);
});


async function getInfo(id){
  const now = Date.now();
  const c = infoCache.get(id);
  if (c && now - c.at < INFO_TTL) return c.data;
  if (infoInflight.has(id)) return infoInflight.get(id);

  const p = (async ()=>{
    const r = await fetchWithRateLimit(cors(cgInfo(id)));
    if(!r.ok) throw new Error("info http " + r.status);
    const data = await r.json();
    infoCache.set(id, { at: now, data });
    return data;
  })();

  infoInflight.set(id, p);
  try { return await p; }
  finally { infoInflight.delete(id); }
}

on("click", "[data-more]", async (_, btn)=>{
  const id = btn.getAttribute("data-more");
  const panel = $(btn.getAttribute("data-target"));
  if(!panel) return;

  if(panel.dataset.loaded === "1"){ panel.classList.toggle("show"); return; }

  panel.innerHTML = `
    <div class="d-flex align-items-center gap-2 text-muted">
      <div class="spinner-border spinner-border-sm" role="status" aria-label="Loading"></div>
      טוען פרטי מטבע…
    </div>`;

  btn.disabled = true; const old = btn.textContent; btn.textContent = "טוען…";
  try{
    const info = await getInfo(id);
    const md  = info?.market_data || {};
    const img = info?.image?.small || coinById.get(id)?.image || "";
    const name= info?.name || coinById.get(id)?.name || id;

    const pUSD = md?.current_price?.usd ?? null;
    const pEUR = md?.current_price?.eur ?? null;
    const pILS = md?.current_price?.ils ?? null;
    const hi   = md?.high_24h?.usd ?? null;
    const lo   = md?.low_24h?.usd ?? null;

    const fmt = (v, sym="$") => v!=null ? `${sym}${v}` : "N/A";

    panel.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        ${img?`<img src="${img}" width="28" height="28" alt="${name}">`:""} <strong>${name}</strong>
      </div>
      <div class="row g-2">
        <div class="col-4"><div class="small text-muted">USD</div><div class="fw-semibold">${fmt(pUSD,"$")}</div></div>
        <div class="col-4"><div class="small text-muted">EUR</div><div>${fmt(pEUR,"€")}</div></div>
        <div class="col-4"><div class="small text-muted">ILS</div><div>${fmt(pILS,"₪")}</div></div>
        <div class="col-6"><div class="small text-muted">24h High (USD)</div><div>${fmt(hi,"$")}</div></div>
        <div class="col-6"><div class="small text-muted">24h Low (USD)</div><div>${fmt(lo,"$")}</div></div>
      </div>`;
    panel.dataset.loaded = "1";
    panel.classList.add("show");
  }catch(e){
    console.error(e);
    err("נכשלה טעינת פרטי המטבע.");
    panel.innerHTML = `<div class="text-danger small">שגיאה בטעינה.</div>`;
  }finally{
    btn.disabled=false; btn.textContent=old;
  }
});


let pendingAdd = null;

on("change", "[data-watch]", (_, sw)=>{
  const id = sw.getAttribute("data-watch");
  if (sw.checked){
    const res = addToWatchlist(id);
    if(!res.ok && res.needModal){
      sw.checked = false; 
      pendingAdd = id;
      openFullModal();
    }
  } else {
    removeFromWatchlist(id);
  }
  updateReportsCount();
});

function ensureModal(){
  if ($("#fullModal")) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = `
    <div class="modal fade" id="fullModal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">הרשימה מלאה</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body">
            <p class="mb-2">אפשר לבחור מטבע להסרה כדי לפנות מקום לחדש.</p>
            <div id="fullModalList" class="list-group"></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" data-bs-dismiss="modal">ביטול</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(wrapper.firstElementChild);
}

function openFullModal(){
  ensureModal();
  const list = $("#fullModalList"); list.innerHTML = "";
  const wl = wlLoad();

  for (const id of wl){
    const c = coinById.get(id) || { symbol: id, name: id, image: "" };
    const sym = (c.symbol||"").toUpperCase();
    const row = document.createElement("button");
    row.type = "button";
    row.className = "list-group-item list-group-item-action d-flex align-items-center justify-content-between";
    row.setAttribute("data-remove-existing", id);
    row.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        ${c.image?`<img src="${c.image}" width="20" height="20" alt="${c.name}">`:""}
        <strong>${sym}</strong> <span class="text-muted">· ${c.name}</span>
      </div>
      <span class="badge text-bg-danger">הסר</span>`;
    list.appendChild(row);
  }

  const m = bootstrap.Modal.getOrCreateInstance($("#fullModal"));
  m.show();
}

on("click", "[data-remove-existing]", (_, btn)=>{
  const id = btn.getAttribute("data-remove-existing");
  removeFromWatchlist(id);
  updateReportsCount();
  
  if (pendingAdd){
    addToWatchlist(pendingAdd);
    updateReportsCount();
    
    const oldSw = document.querySelector(`[data-watch="${id}"]`);
    if (oldSw) oldSw.checked = false;
    const newSw = document.querySelector(`[data-watch="${pendingAdd}"]`);
    if (newSw) newSw.checked = true;
    pendingAdd = null;
  }
  
  const m = bootstrap.Modal.getInstance($("#fullModal"));
  if (m) m.hide();
});


function renderReports(){
  const ids = wlLoad();

  $("#app-content").innerHTML = `
    <section class="mb-3 d-flex align-items-end justify-content-between">
      <div><h2 class="h5 mb-1">דוחות</h2><p class="text-muted m-0">נבחרו ${ids.length} / ${WL_MAX}</p></div>
      <div><button id="btnStopRt" class="btn btn-outline-danger btn-sm d-none">עצור גרף</button></div>
    </section>
    <section class="card shadow-sm mb-3">
      <div class="list-group list-group-flush" id="reportsList">
        ${ids.length ? "" : `<div class="list-group-item text-muted">לא נבחרו מטבעות.</div>`}
      </div>
    </section>
    <section class="card shadow-sm">
      <div class="card-body">
        <h3 class="h6 mb-3">גרף זמן אמת (USD)</h3>
        <div id="rtChart" style="height:320px;width:100%"></div>
      </div>
    </section>
  `;

  if(!ids.length){ stopRealtime(); return; }

  const listEl = $("#reportsList");
  listEl.innerHTML = "";

  (async ()=>{
    loading(true);
    try{
      const syms = [];
      for(const id of ids){
        const c = coinById.get(id);
        if(!c) continue;
        const sym   = (c.symbol||"").toUpperCase();
        const name  = c.name || id;
        const img   = c.image || "";
        const price = c.current_price ?? null;

        syms.push(sym);

        const row = document.createElement("div");
        row.className = "list-group-item d-flex align-items-center justify-content-between";
        row.innerHTML = `
          <div class="d-flex align-items-center gap-2">
            ${img?`<img src="${img}" width="24" height="24" alt="${name}">`:""}
            <div><strong>${sym}</strong> <span class="text-muted">· ${name}</span></div>
          </div>
          <div class="d-flex align-items-center gap-3">
            <div class="text-nowrap">${price!=null?`$${price}`:`<span class="text-muted">N/A</span>`}</div>
            <button class="btn btn-sm btn-outline-danger" data-remove="${id}">הסר</button>
          </div>`;
        listEl.appendChild(row);
      }
      startRealtime(syms.slice(0, WL_MAX));
    } finally { loading(false); }
  })();
}

on("click", "[data-remove]", (_, btn)=>{
  const id = btn.getAttribute("data-remove");
  removeFromWatchlist(id);
  btn.closest(".list-group-item")?.remove();
  updateReportsCount();
  if(!$("#reportsList").children.length){
    $("#reportsList").innerHTML = `<div class="list-group-item text-muted">לא נבחרו מטבעות.</div>`;
    stopRealtime();
  }
});


let RT = { timer:null, chart:null, map:new Map(), limit:50 };

function stopRealtime(){
  if(RT.timer){ clearInterval(RT.timer); RT.timer=null; }
  const btn = $("#btnStopRt");
  if(btn) btn.classList.add("d-none");
}

function startRealtime(syms){
  stopRealtime();
  if(!syms.length) return;

  const series = syms.map(s => ({ type:"line", name:s, showInLegend:true, xValueType:"dateTime", dataPoints:[] }));
  RT.map.clear();
  RT.chart = new CanvasJS.Chart("rtChart", { axisX:{ valueFormatString:"HH:mm:ss" }, axisY:{ prefix:"$" }, data: series });
  RT.chart.render();
  syms.forEach((s,i)=> RT.map.set(s, series[i]));

  const btn = $("#btnStopRt");
  if(btn){
    btn.classList.remove("d-none");
    btn.onclick = () => stopRealtime();
  }

  const url = CC_MULTI(syms); 
  RT.timer = setInterval(async ()=>{
    if(ROUTE!=="reports" || !document.getElementById("rtChart")) return stopRealtime();
    try{
      const r = await fetch(url);
      if(!r.ok) throw new Error(r.status);
      const json = await r.json();
      const t = Date.now();
      for(const s of syms){
        const price = json?.[s]?.USD; const ds = RT.map.get(s);
        if(ds && typeof price==="number"){
          ds.dataPoints.push({ x:t, y:price });
          if(ds.dataPoints.length > RT.limit) ds.dataPoints.shift();
        }
      }
      RT.chart.render();
    }catch{  }
  }, 2000);
}


(function init(){
  updateReportsCount();
  go("coins");
})();

