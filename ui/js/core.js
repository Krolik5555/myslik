"use strict";
/* ===========================================================
   planner — KROLIK edition
   =========================================================== */

/* ---------- storage abstraction (pywebview OR browser) ---------- */
const HasPy = () => !!(window.pywebview && window.pywebview.api);
const Store = {
  async load(){
    if(HasPy()) return await window.pywebview.api.load();
    try{ return JSON.parse(localStorage.getItem("planner")||"null"); }catch(e){ return null; }
  },
  async save(s){
    if(HasPy()) return await window.pywebview.api.save(s);
    localStorage.setItem("planner", JSON.stringify(s));
  },
  async backup(){
    if(HasPy()) return await window.pywebview.api.backup();
    return "browser:localStorage";
  },
  async exportData(s){
    if(HasPy()) return await window.pywebview.api.export_data(s);
    const blob=new Blob([JSON.stringify(s,null,2)],{type:"application/json"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download="myslik-export.json"; a.click(); return "browser-download";
  },
  async importData(){
    if(HasPy()) return await window.pywebview.api.import_data();
    return await new Promise(res=>{
      const i=document.createElement("input"); i.type="file"; i.accept="application/json";
      i.onchange=()=>{ const f=i.files[0]; if(!f) return res(null);
        const r=new FileReader(); r.onload=()=>{ try{res(JSON.parse(r.result));}catch(e){res(null);} }; r.readAsText(f); };
      i.click();
    });
  }
};

/* ---------- helpers ---------- */
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const el = (t,c,h)=>{ const e=document.createElement(t); if(c)e.className=c; if(h!=null)e.innerHTML=h; return e; };
const uid = ()=> Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc = s => String(s==null?"":s).replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[m]));

const startOfDay = d => { const x=new Date(d); x.setHours(0,0,0,0); return x; };
const today = () => startOfDay(new Date());
const ymd = d => { const x=new Date(d); return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0"); };
const parseYmd = s => {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  return startOfDay(new Date(y, m - 1, d));
};
const addDays = (d,n)=>{ const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const daysBetween = (a,b)=> Math.round((startOfDay(a)-startOfDay(b))/86400000);

function dueLabel(due){
  if(!due) return null;
  const diff = daysBetween(parseYmd(due), today());
  if(diff<0) return {cls:"over", txt:"просрочено "+Math.abs(diff)+"д"};
  if(diff===0) return {cls:"today", txt:"сегодня"};
  if(diff===1) return {cls:"", txt:"завтра"};
  if(diff<7) return {cls:"", txt:["вс","пн","вт","ср","чт","пт","сб"][parseYmd(due).getDay()]};
  const d=parseYmd(due);
  return {cls:"", txt:d.getDate()+"."+String(d.getMonth()+1).padStart(2,"0")};
}
// бейдж срока для карточки задачи с учётом выполнения: выполнено вовремя → ничего;
// выполнено с опозданием → метка опоздания; не выполнено → обычный dueLabel (вкл. «просрочено»)
function dueBadge(it){
  if(it.done){
    if(it.due && it.doneAt){ const late=daysBetween(new Date(it.doneAt), parseYmd(it.due)); if(late>0) return {cls:"late", txt:"с опозданием "+late+"д"}; }
    return null;
  }
  return dueLabel(it.due);
}
const REPEAT={none:"",daily:"каждый день",weekly:"каждую неделю",monthly:"каждый месяц"};
function nextRepeat(due,rep){
  const d=parseYmd(due)||today();
  if(rep==="daily") return ymd(addDays(d,1));
  if(rep==="weekly") return ymd(addDays(d,7));
  if(rep==="monthly"){ const n=new Date(d); n.setMonth(n.getMonth()+1); return ymd(n); }
  return null;
}

/* ---------- default state ---------- */
const ICONS=["ti-home","ti-briefcase","ti-puzzle","ti-video","ti-bulb","ti-shopping-cart","ti-heart",
  "ti-rocket","ti-camera","ti-music","ti-palette","ti-code","ti-book","ti-plane","ti-coin","ti-flame",
  "ti-star","ti-bolt","ti-leaf","ti-paw","ti-movie","ti-pencil","ti-world","ti-coffee"];

// приглушённая палитра, читаемая и на чёрном, и на белом; null = по умолчанию (белый/чёрный по теме, всегда перетекает)
const PALETTE=[null,"#e0625a","#e8a14b","#5fb98e","#5b9bd6","#9b7fd6","#d67fb0","#8a8f98"];
const NEUTRAL=()=>getComputedStyle(document.body).getPropertyValue("--acc").trim()||"#ffffff";
const areaColor = id => { const a=areaById(id); return a&&a.color?a.color:null; };
const itemColor = it => it.color || (it.area?areaColor(it.area):null) || null;
// набор кружков выбора цвета; null отрисовываем как нейтральный (белый по умолчанию)
function swatchRow(current){
  return PALETTE.map((c,i)=>`<button class="swatch${(current||null)===(c||null)?" on":""}" data-ci="${i}" title="${c?c:"по умолчанию"}" style="background:${c||"var(--acc)"}"></button>`).join("");
}

// привязать папку к ноде (выбор через системный диалог; только в приложении)
async function pickItemFolder(it, after){
  if(!HasPy()){ toast("Привязка папки доступна только в приложении",{icon:"ti-folder"}); return; }
  try{ const p=await window.pywebview.api.pick_folder(); if(p){ it.folder=p; touch(it); persist(); if(after) after(); toast("Папка привязана",{icon:"ti-folder-check"}); } }
  catch(e){ toast("Не удалось выбрать папку"); }
}
// открыть привязанную папку в проводнике
function openItemFolder(it){
  if(!it||!it.folder) return;
  if(!HasPy()){ toast("Открытие папки доступно только в приложении",{icon:"ti-folder"}); return; }
  Promise.resolve(window.pywebview.api.open_path(it.folder)).then(ok=>{ if(!ok) toast("Папка не найдена на ПК",{icon:"ti-alert-triangle"}); }, ()=>toast("Не удалось открыть папку"));
}

function defaultState(){
  return {
    v:2,
    areas:[
      {id:"a_other", name:"Прочее",  icon:"ti-home"},
      {id:"a_work",  name:"Работа",  icon:"ti-video"},
      {id:"a_addon", name:"Аддоны",  icon:"ti-puzzle"}
    ],
    items:[],
    links:[],
    tags:[],   // реестр стилизованных тегов: {name, icon?, color?, size?, shape?} — все свойства опциональны
    settings:{ theme:"dark", view:"today", graphDrift:4, graphSpread:1, graphBg:true, glow:1, graphLinkLen:1, graphNodeSize:1, graphDegScale:1, graphDoneScale:0.6, graphDoneLinkLen:0.6, graphLinkBright:1, graphFadedBright:0.5,
      graphDoingGlow:true, graphDoingGlowRadius:110, graphDoingGlowBright:0.3, graphDoingGlowBlur:30,
      boardLabels:{ inbox:"Inbox", todo:"Запланировано", doing:"В работе", done:"Готово" } }
  };
}

/* ---------- стилизованные теги ---------- */
const TAG_SHAPES=["circle","square","diamond","hexagon"];
function tagStyle(name){ return (S.tags||[]).find(t=>t.name===name)||null; }
// слитый стиль ноды по её тегам: max размер, первый заданный цвет/иконку/форму
function itemTagStyle(it){
  if(!it||!it.tags||!it.tags.length||!S.tags||!S.tags.length) return null;
  let size=null,color=null,icon=null,shape=null;
  it.tags.forEach(t=>{ const ts=tagStyle(t); if(!ts) return;
    if(ts.size!=null) size=Math.max(size||0, ts.size);
    if(ts.color && !color) color=ts.color;
    if(ts.icon && !icon) icon=ts.icon;
    if(ts.shape && !shape) shape=ts.shape;
  });
  return (size!=null||color||icon||shape)?{size,color,icon,shape}:null;
}
function isProjectTag(name){ const t=tagStyle(name); return !!(t&&t.project); }
function itemProjectTag(it){ if(!it||!Array.isArray(it.tags)) return null; for(const t of it.tags){ const ts=tagStyle(t); if(ts&&ts.project) return ts; } return null; }
function isProjectItem(it){ return !!itemProjectTag(it); }
// глиф иконки Tabler (читаем ::before из подключённого шрифта, кэшируем) — для отрисовки прямо в SVG-ноде
const _glyphCache={};
function iconGlyph(tiName){
  if(!tiName) return "";
  const key=String(tiName).replace(/^ti-/,"");
  if(_glyphCache[key]!==undefined) return _glyphCache[key];
  let c="";
  try{ const i=document.createElement("i"); i.className="ti ti-"+key; i.style.cssText="position:absolute;left:-9999px;visibility:hidden;"; document.body.appendChild(i);
    const raw=getComputedStyle(i,"::before").content; document.body.removeChild(i);
    if(raw && raw!=="none") c=raw.replace(/^["']|["']$/g,"");
  }catch(e){}
  _glyphCache[key]=c; return c;
}

// нормализация загруженного/импортированного состояния: бэкилл полей, дедуп id,
// белый список иконок и валидация цветов — защита от битых/вредоносных данных (импорт/ручная правка json)
function sanitizeState(s){
  if(!s || typeof s!=="object") return defaultState();
  s.settings = Object.assign({}, defaultState().settings, s.settings||{});
  if(!Array.isArray(s.areas)) s.areas=[];
  if(!Array.isArray(s.items)) s.items=[];
  if(!Array.isArray(s.links)) s.links=[];
  const okColor=c=>(typeof c==="string"&&/^#[0-9a-fA-F]{3,8}$/.test(c))?c:null;
  s.areas.forEach(a=>{ if(!ICONS.includes(a.icon)) a.icon="ti-folder"; a.color=okColor(a.color); a.name=String(a.name==null?"":a.name); });
  // реестр стилизованных тегов (все свойства опциональны → null если не заданы), дедуп по имени
  if(!Array.isArray(s.tags)) s.tags=[];
  { const seenT=new Set(); s.tags=s.tags.filter(t=>t&&typeof t==="object"&&typeof t.name==="string"&&t.name.trim()&&!seenT.has(t.name)&&seenT.add(t.name)).map(t=>({
      name:String(t.name).trim(),
      icon:(t.icon&&ICONS.includes(t.icon))?t.icon:null,
      color:okColor(t.color),
      size:(t.size!=null&&+t.size>=0.4&&+t.size<=3)?+t.size:null,
      shape:TAG_SHAPES.includes(t.shape)?t.shape:null,
      project: t.project===true
    })); }
  const seen=new Set();
  s.items.forEach(it=>{
    if(typeof it.id!=="string" || !it.id || seen.has(it.id)) it.id=uid();   // дедуп/восстановление id
    seen.add(it.id);
    it.title=String(it.title==null?"":it.title); it.body=String(it.body==null?"":it.body);
    if(it.icon!==undefined && !ICONS.includes(it.icon)) delete it.icon;     // иконка только из белого списка
    it.color=okColor(it.color);
    if(!Array.isArray(it.tags)) it.tags=[]; it.tags=it.tags.map(t=>String(t));
    if(it.deleted===undefined) it.deleted=false;
    if(it.repeat===undefined) it.repeat="none";
    if(it.status===undefined) it.status=((it.kind==="note"||it.kind==="flow")?"note":(it.due?"todo":"inbox"));
    if(it.kind==="flow") ensureFlow(it);   // нормализуем содержимое схемы
    if(it.size!=null){ const sz=+it.size; it.size = (sz>=0.4&&sz<=3)?sz:1; }   // индивидуальный множитель размера ноды
    if(it.doneAt!=null && typeof it.doneAt!=="number") delete it.doneAt;       // дата выполнения (для метки опоздания)
    if(it.folder!=null){ it.folder = typeof it.folder==="string" ? it.folder : undefined; if(it.folder==="") it.folder=undefined; }   // привязанная папка на ПК: только непустая строка
  });
  s.items.forEach(it=>{ if(it.parent && !seen.has(it.parent)) it.parent=null; });   // снять висячие parent
  s.links=s.links.filter(l=>Array.isArray(l)&&l.length>=2 &&
    (seen.has(l[0])||/^hub_/.test(l[0])) && (seen.has(l[1])||/^hub_/.test(l[1])))   // выкинуть связи в никуда
    .map(l=>{ const len=+l[2]; return (len>=0.3&&len<=3)?[l[0],l[1],len]:[l[0],l[1]]; });   // per-link длина (3-й элемент, множитель)
  s.v=2;
  return s;
}

let S = defaultState();
let _prevView=null;   // для анимации входа: отличаем смену вкладки от обычной перерисовки
let saveTimer=null;
function persist(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>Store.save(S),250); }
function touch(it){ it.updated=Date.now(); }

const areaById = id => S.areas.find(a=>a.id===id);
const areaName = id => { const a=areaById(id); return a?a.name:"Без области"; };
const areaIcon = id => { const a=areaById(id); return a?a.icon:"ti-circle"; };

/* ---------- view state ---------- */
let view = "today";
let areaFilter = null;
let calOffset = 0;        // смещение месяца в календаре
let notesMode = "graph";  // graph | list
let showDone = false;     // показывать ли выполненные задачи
let taskFilter = "all";   // фильтр вкладки «Задачи»: all | today | week | nodue
let tagFilter = null;     // фильтр по тегу (клик по чипу тега) — сквозной, поверх области/срока
let listQuery = "";       // текстовый фильтр списков («Задачи» / «Заметки»-список), сбрасывается при смене вкладки
