// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function colRange(a,b){
  const A=a.charCodeAt(0), B=b.charCodeAt(0);
  const out=[];
  for(let c=A;c<=B;c++) out.push(String.fromCharCode(c));
  return out;
}

function normalizeText(s){
  return (s||"").toString().replace(/\s+/g," ").trim();
}

function safeLocation(chestID){
  const m = (chestID||"").trim().match(/^([A-Z])(\d+)-(\d+)$/);
  if(!m) return "";
  return `${m[1]}${m[2]}-${m[3]}`;
}

function parseCSV(text){
  const rows=[];
  let i=0, field="", row=[], inQ=false;
  const pushField = ()=>{ row.push(field); field=""; };
  const pushRow = ()=>{ rows.push(row); row=[]; };

  while(i<text.length){
    const ch=text[i];
    if(inQ){
      if(ch === '"'){
        if(text[i+1] === '"'){ field+='"'; i+=2; continue; }
        inQ=false; i++; continue;
      }
      field += ch; i++; continue;
    }else{
      if(ch === '"'){ inQ=true; i++; continue; }
      if(ch === ","){ pushField(); i++; continue; }
      if(ch === "\r"){ i++; continue; }
      if(ch === "\n"){ pushField(); pushRow(); i++; continue; }
      field += ch; i++; continue;
    }
  }
  pushField(); pushRow();
  while(rows.length && rows[rows.length-1].every(v => (v||"").trim()==="")) rows.pop();
  return rows;
}

function rowsToItems(csvRows){
  if(!csvRows.length) return [];
  const header = csvRows[0].map(h => normalizeText(h));
  const idx = (name) => header.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const iDesc = idx("Description");
  const iChest= idx("ChestID");
  const iCol  = idx("Column");
  const iCat  = idx("Categories");

  const iDesc2 = iDesc>=0 ? iDesc : header.findIndex(h=>h.toLowerCase().includes("description"));
  const iChest2= iChest>=0 ? iChest : header.findIndex(h=>h.toLowerCase().includes("chest"));
  const iCol2  = iCol>=0 ? iCol : header.findIndex(h=>h.toLowerCase()==="column");
  const iCat2  = iCat>=0 ? iCat : header.findIndex(h=>h.toLowerCase().includes("categor"));

  const out=[];
  for(let r=1;r<csvRows.length;r++){
    const row=csvRows[r];
    const Description = normalizeText(row[iDesc2] ?? "");
    const ChestID     = normalizeText(row[iChest2] ?? "");
    const Column      = normalizeText(row[iCol2] ?? "");
    const Category    = normalizeText(row[iCat2] ?? "");
    if(!Description || !ChestID) continue;

    out.push({
      Description,
      ChestID,
      Location: safeLocation(ChestID),
      Column: Column || (ChestID[0] || ""),
      Category
    });
  }
  return out;
}

function parseChestID(chestID){
  const m = (chestID || "").trim().match(/^([A-Z])(\d+)-(\d+)$/);
  if(!m) return null;
  return { col: m[1], cluster: parseInt(m[2],10), num: parseInt(m[3],10) };
}

function renderLocator(chestID, targetId="locator2"){
  const el = $(targetId);
  if(!el) return;

  const p = parseChestID(chestID);
  if(!p || !(p.cluster === 1 || p.cluster === 2) || !(p.num >= 1 && p.num <= 9)){
    el.innerHTML = `<div class="muted">—</div>`;
    return;
  }

  const makeBlock = (title, activeCluster) => {
    const wrap = document.createElement("div");
    wrap.className = "locBlock";

    const t = document.createElement("div");
    t.className = "locTitle";
    t.textContent = title;

    const g = document.createElement("div");
    g.className = "miniGrid";

    for(let n=1; n<=9; n++){
      const c = document.createElement("div");
      c.className = "miniCell" + ((p.cluster === activeCluster && p.num === n) ? " on" : "");
      c.textContent = n;
      g.appendChild(c);
    }

    wrap.appendChild(t);
    wrap.appendChild(g);
    return wrap;
  };

  el.innerHTML = "";
  el.appendChild(makeBlock(`${p.col}1 (Top)`, 1));
  el.appendChild(makeBlock(`${p.col}2 (Bottom)`, 2));
}

// ---------- state ----------
let ALL = [];
let FILTERED = [];
let ACTIVE_KEY = "";
let ACTIVE_COL = "";
let sortKey = "Description";
let sortDir = 1; // 1 asc, -1 desc

// ---------- map build ----------
function buildMap(){
  const east  = colRange("A","I").reverse(); // I top -> A bottom
  const south = colRange("J","O");
  const west  = colRange("P","X");

  $("eastCols").innerHTML = "";
  $("southCols").innerHTML = "";
  $("westCols").innerHTML = "";

  for(const c of south) $("southCols").appendChild(makeColBtn(c));
  for(const c of east)  $("eastCols").appendChild(makeColBtn(c));
  for(const c of west)  $("westCols").appendChild(makeColBtn(c));

  refreshColDots();
}

function makeColBtn(letter){
  const btn = document.createElement("div");
  btn.className = "colBtn";
  btn.dataset.col = letter;
  btn.title = `Column ${letter}`;
  btn.textContent = letter;

  const dot = document.createElement("div");
  dot.className = "dot";
  btn.appendChild(dot);

  btn.addEventListener("click", () => {
    setActiveColumn(letter);
    ACTIVE_KEY = "";
    renderTable();
  });

  return btn;
}

function setActiveColumn(letter){
  ACTIVE_COL = letter || "";
  document.querySelectorAll(".colBtn").forEach(b=>{
    b.classList.toggle("active", b.dataset.col === ACTIVE_COL);
  });
}

function refreshColDots(){
  const colsWithItems = new Set(ALL.map(x => x.Column).filter(Boolean));
  document.querySelectorAll(".colBtn").forEach(b=>{
    b.classList.toggle("hasItems", colsWithItems.has(b.dataset.col));
  });
}

// ---------- table ----------
function applyFilter(){
  const q = normalizeText($("q").value).toLowerCase();
  if(!q){
    FILTERED = ALL.slice();
  }else{
    FILTERED = ALL.filter(it=>{
      const hay = `${it.Description} ${it.Location} ${it.Category}`.toLowerCase();
      return hay.includes(q);
    });
  }
  sortFiltered();
  $("countAll").textContent = ALL.length.toString();
  $("countNow").textContent = FILTERED.length.toString();

  // --- AUTO-SELECTION LOGIC (pick first result if any) ---
  if (FILTERED.length > 0) {
    selectItem(FILTERED[0]);
  } else {
    clearSelection();
  }
}


function sortFiltered(){
  const key = sortKey;
  const dir = sortDir;
  const get = (it)=>{
    if(key==="Location") return it.Location || "";
    if(key==="Category") return it.Category || "";
    return it.Description || "";
  };
  FILTERED.sort((a,b)=>{
    const A = get(a).toLowerCase();
    const B = get(b).toLowerCase();
    if(A<B) return -1*dir;
    if(A>B) return  1*dir;
    return 0;
  });
  renderSortArrows();
}

function renderSortArrows(){
  $("arItem").textContent = (sortKey==="Description") ? (sortDir===1 ? "▲" : "▼") : "";
  $("arLoc").textContent  = (sortKey==="Location")    ? (sortDir===1 ? "▲" : "▼") : "";
  $("arCat").textContent  = (sortKey==="Category")    ? (sortDir===1 ? "▲" : "▼") : "";
}

function renderTable(){
  const tb = $("rows");
  tb.innerHTML = "";

  for(const it of FILTERED){
    const tr = document.createElement("tr");
    const key = `${it.ChestID}|||${it.Description}`;
    tr.classList.toggle("active", key === ACTIVE_KEY);

    const tdItem = document.createElement("td");
    tdItem.textContent = it.Description;

    const tdLoc = document.createElement("td");
    tdLoc.className = "mono";
    tdLoc.textContent = it.Location;

    const tdCat = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = it.Category || "—";
    tdCat.appendChild(tag);

    tr.appendChild(tdItem);
    tr.appendChild(tdLoc);
    tr.appendChild(tdCat);

    tr.addEventListener("click", ()=> selectItem(it));
    tb.appendChild(tr);
  }
}

function selectItem(it){
  ACTIVE_KEY = `${it.ChestID}|||${it.Description}`;
  setActiveColumn(it.Column);

  $("selDesc2").textContent  = it.Description || "—";
  $("selChest2").textContent = it.Location || "—";
  renderLocator(it.ChestID, "locator2");

  renderTable();
}

// ---------- loading ----------
async function tryLoadServerCSV(){
  try{
    const res = await fetch("items.csv", { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const txt = await res.text();
    const parsed = parseCSV(txt);
    const items = rowsToItems(parsed);
    if(!items.length) throw new Error("No items parsed.");
    setItems(items);
    showNotice("", false);
    showPicker(false);
    return true;
  }catch(err){
    showNotice("Server load failed (likely local file mode). Select items.csv from disk.", true);
    showPicker(true);
    return false;
  }
}

function showNotice(msg, show){
  const n = $("notice");
  n.textContent = msg || "";
  n.style.display = show ? "block" : "none";
}

function showPicker(show){
  $("pickerRow").classList.toggle("show", !!show);
}

function setItems(items){
  ALL = items;
  FILTERED = items.slice();

  buildMap();
  refreshColDots();
  applyFilter();
  renderTable();

  $("selDesc2").textContent = "—";
  $("selChest2").textContent = "—";
  renderLocator("", "locator2");
}

function clearSelection(){
  ACTIVE_KEY = "";
  setActiveColumn("");

  $("selDesc2").textContent  = "—";
  $("selChest2").textContent = "—";
  renderLocator("", "locator2");

  renderTable();
}

async function loadLocalFile(){
  const f = $("file").files?.[0];
  if(!f) return;
  const txt = await f.text();
  const parsed = parseCSV(txt);
  const items = rowsToItems(parsed);
  setItems(items);
  showNotice("Local CSV loaded.", true);
}

// ---------- init ----------
function wireUI(){
  $("q").addEventListener("input", ()=>{
    applyFilter();
    renderTable();
  });

  $("clear").addEventListener("click", ()=>{
    $("q").value = "";
    setActiveColumn("");
    ACTIVE_KEY = "";
    applyFilter();
    renderTable();
  });

  $("loadBtn").addEventListener("click", loadLocalFile);

  $("thItem").addEventListener("click", ()=>{
    if(sortKey==="Description") sortDir *= -1;
    sortKey="Description";
    sortFiltered();
    renderTable();
  });
  $("thLoc").addEventListener("click", ()=>{
    if(sortKey==="Location") sortDir *= -1;
    sortKey="Location";
    sortFiltered();
    renderTable();
  });
  $("thCat").addEventListener("click", ()=>{
    if(sortKey==="Category") sortDir *= -1;
    sortKey="Category";
    sortFiltered();
    renderTable();
  });
}

(async function init(){
  wireUI();
  renderSortArrows();
  await tryLoadServerCSV();
})();
