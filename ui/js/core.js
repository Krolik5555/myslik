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

// приглушённая палитра, читаемая и на чёрном, и на белом.
// null = НЕТ своего цвета: нода наследует цвет области (см. itemColor) — это не «белый».
// "#ffffff" = ЯВНЫЙ белый: он самостоятельный, область его не перекрывает. Раньше белого в
// палитре не было вовсе, а null рисовался белым кружком — выбрав «белый», человек получал
// цвет области. Теперь это два разных кружка: прочерк (наследовать) и белый (свой).
const PALETTE=[null,"#ffffff","#e0625a","#e8a14b","#5fb98e","#5b9bd6","#9b7fd6","#d67fb0","#8a8f98"];
const NEUTRAL=()=>getComputedStyle(document.body).getPropertyValue("--acc").trim()||"#ffffff";
/* Смешение цветов — в OKLab, а не в RGB. В RGB смесь двух насыщенных цветов проваливается в
   грязь (красный+зелёный = бурый) и темнеет: RGB описывает сигнал для лампы, а не восприятие.
   OKLab перцептивно ровный — смесь держит светлоту и даёт тот цвет, который человек и ждёт.
   Формулы Бьёрна Оттоссона.
   Вход: массив hex-строк ЛИБО объектов {c:"#hex", w:вес} — вес нужен, чтобы ближний источник
   тянул сильнее дальнего. Выход: hex. */
const _hex2rgb=h=>{ h=String(h||"").trim().replace(/^#/,"");
  if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
  const n=parseInt(h,16); return (h.length===6 && !isNaN(n)) ? [(n>>16)&255,(n>>8)&255,n&255] : null; };
const _lin=c=>{ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const _unlin=c=>{ const v=c<=0.0031308 ? c*12.92 : 1.055*Math.pow(Math.max(c,0),1/2.4)-0.055;
  return Math.round(Math.max(0,Math.min(1,v))*255); };
function mixColors(list){
  const parts=(list||[]).map(x=>{
    const hex=(typeof x==="string")?x:(x&&x.c), w=(typeof x==="string")?1:((x&&x.w!=null)?x.w:1);
    const rgb=_hex2rgb(hex); return (rgb && w>0) ? {rgb,w} : null; }).filter(Boolean);
  if(!parts.length) return null;
  if(parts.length===1) return "#"+parts[0].rgb.map(v=>v.toString(16).padStart(2,"0")).join("");
  const tot=parts.reduce((s,p)=>s+p.w,0);
  let L=0,A=0,B=0;
  parts.forEach(({rgb,w})=>{
    const [r,g,b]=rgb, k=w/tot;
    const R=_lin(r), G=_lin(g), Bl=_lin(b);
    const l=Math.cbrt(0.4122214708*R+0.5363325363*G+0.0514459929*Bl);
    const m=Math.cbrt(0.2119034982*R+0.6806995451*G+0.1073969566*Bl);
    const s=Math.cbrt(0.0883024619*R+0.2817188376*G+0.6299787005*Bl);
    L+=k*(0.2104542553*l+0.7936177850*m-0.0040720468*s);
    A+=k*(1.9779984951*l-2.4285922050*m+0.4505937099*s);
    B+=k*(0.0259040371*l+0.7827717662*m-0.8086757660*s);
  });
  const l_=L+0.3963377774*A+0.2158037573*B, m_=L-0.1055613458*A-0.0638541728*B, s_=L-0.0894841775*A-1.2914855480*B;
  const l=l_*l_*l_, m=m_*m_*m_, s=s_*s_*s_;
  const r=_unlin( 4.0767416621*l-3.3077115913*m+0.2309699292*s);
  const g=_unlin(-1.2684380046*l+2.6097574011*m-0.3413193965*s);
  const b=_unlin(-0.0041960863*l-0.7034186147*m+1.7076147010*s);
  return "#"+[r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("");
}
const areaColor = id => { const a=areaById(id); return a&&a.color?a.color:null; };
const itemColor = it => it.color || (it.area?areaColor(it.area):null) || null;
// Набор кружков выбора цвета. «Нет цвета» рисуем приглушённым кружком с прочерком (.none),
// а НЕ белым: белый кружок читался как «белый цвет», хотя означал «наследовать» — и нода
// в зелёной области становилась зелёной. Явный белый теперь отдельный кружок палитры.
function swatchRow(current){
  return PALETTE.map((c,i)=> c
    ? `<button class="swatch${(current||null)===c?" on":""}" data-ci="${i}" title="${c==="#ffffff"?"Белый — свой цвет, область его не перекроет":c}" style="background:${c}"></button>`
    : `<button class="swatch none${current?"":" on"}" data-ci="${i}" title="Без своего цвета — наследует цвет области">—</button>`
  ).join("");
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
      graphDoingGlow:true, graphDoingGlowRadius:110, graphDoingGlowBright:0.3, graphDoingGlowBlur:30 }
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
    if(it.status===undefined) it.status=((it.kind==="note"||it.kind==="flow")?"note":"todo");
    // МИГРАЦИЯ: значения "inbox" в статусе больше нет — вкладка Inbox снесена, а «неразобранность»
    // теперь выводится из отсутствия координат (нода лежит в лотке графа, см. Graph.build).
    // Бэкфилл строкой выше сработал бы только на undefined, поэтому чиним старые данные явно —
    // иначе задача навсегда осталась бы со статусом, которого в приложении уже не существует,
    // и пропала бы из «Задач».
    if(it.status==="inbox") it.status="todo";
    if(it.kind==="flow") ensureFlow(it);   // нормализуем содержимое схемы
    if(it.size!=null){ const sz=+it.size; it.size = (sz>=0.4&&sz<=3)?sz:1; }   // индивидуальный множитель размера ноды
    if(it.doneAt!=null && typeof it.doneAt!=="number") delete it.doneAt;       // дата выполнения (для метки опоздания)
    if(it.folder!=null){ it.folder = typeof it.folder==="string" ? it.folder : undefined; if(it.folder==="") it.folder=undefined; }   // привязанная папка на ПК: только непустая строка
  });
  s.items.forEach(it=>{ if(it.parent && !seen.has(it.parent)) it.parent=null; });   // снять висячие parent
  s.links=s.links.filter(l=>Array.isArray(l)&&l.length>=2 &&
    (seen.has(l[0])||/^hub_/.test(l[0])) && (seen.has(l[1])||/^hub_/.test(l[1])))   // выкинуть связи в никуда
    .map(l=>{ const len=+l[2]; return (len>=0.3&&len<=3)?[l[0],l[1],len]:[l[0],l[1]]; });   // per-link длина (3-й элемент, множитель)
  // МИГРАЦИЯ: членство в области — это поле it.area, связь элемент↔область граф рисует из него сам.
  // Раньше бросок на область писал вместо этого обычную связь в s.links: линия была, а области у
  // элемента не было (в списках он не числился). Если же область всё-таки стояла — хранимая связь
  // заслоняла авто-связь, и «Открепить» не снимало область. Переносим членство в поле и связь убираем.
  { const byId=new Map(s.items.map(it=>[it.id,it]));
    const areaIds=new Set(s.areas.map(a=>a.id));
    s.links=s.links.filter(l=>{
      const ah=/^hub_/.test(l[0]), bh=/^hub_/.test(l[1]);
      if(ah===bh) return true;                                 // элемент↔элемент (и хаб↔хаб) — не наш случай
      const it=byId.get(ah?l[1]:l[0]), aid=(ah?l[0]:l[1]).slice(4);
      if(it && !it.area && areaIds.has(aid)) it.area=aid;      // область ещё не проставлена — берём из связи
      return false;                                            // саму связь не храним
    }); }
  s.v=2;
  return s;
}

let S = defaultState();
let _prevView=null;   // для анимации входа: отличаем смену вкладки от обычной перерисовки
let saveTimer=null;
/* persist(quiet) — единственная воронка записи. quiet=true: сохранить, но НЕ считать это
   действием человека (см. undo ниже). Нужен ровно одному месту — авто-сохранению раскладки,
   когда физика графа остыла сама по себе. */
function persist(quiet){
  // Снимок кладём в момент, когда окно дебаунса ОТКРЫВАЕТСЯ. Это и есть граница действия:
  // пока человек тянет ползунок или пока одно «создать ноду» дёргает persist четыре раза
  // подряд, таймер каждый раз сбрасывается и окно не закрывается — значит снимок будет один.
  // Иначе Ctrl+Z отматывал бы свечение по пикселю, а создание ноды требовало бы четырёх нажатий.
  if(saveTimer===null && !quiet) undoPush();
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{ saveTimer=null; _undoLast=_undoSnap(); _undoKeyLast=_undoKey(); Store.save(S); },250);
}

/* ===========================================================
   ОТКАТ (Ctrl+Z) / ПОВТОР (Ctrl+Shift+Z)
   Историю храним СНИМКАМИ: снимок ловит любое действие сам, без правки 68 мест вызова persist.
   Снимок — строка: её дешевле мерить и она вдвое компактнее клона объекта.

   В СНИМОК ИДУТ ТОЛЬКО ДАННЫЕ (заметки, связи, области, теги) — и НЕ идут настройки.
   Причина не в экономии: settings.view — это текущая вкладка, то есть навигация лежит в том же
   объекте, что и данные. Со снимком всего S выходило двойное зло: переключение вкладки само
   становилось шагом отката, а откат правки заодно перебрасывал на ту вкладку, где ты был в
   момент снимка. Тема, ползунки, свёрнутые ветки и лоток — тоже вид, а не содержимое: откат
   их не трогает.
   Отсюда же второе правило: шаг кладём, ТОЛЬКО если данные реально изменились. Иначе переход
   по вкладкам плодил бы пустые шаги, и Ctrl+Z молча ничего не делал.

   КООРДИНАТЫ — ТОЖЕ ВИД, А НЕ СОДЕРЖИМОЕ. Подвинул ноду — это не правка, отменять нечего.
   Поэтому сравниваем состояния по КЛЮЧУ, из которого x/y выброшены (_undoKey), а восстанавливаем
   из ПОЛНОГО снимка (_undoSnap). Координаты в снимке всё же нужны: без них воскресшая нода
   (откат удаления, повтор создания) потеряла бы место и уехала в лоток.
   Но «поставлена ли нода на холст» (x==null) — это как раз содержимое: вытянуть мысль из лотка
   значит разобрать её, и такое отменять надо. Поэтому в ключе координат нет, а признак
   размещённости есть.

   Два предела, и второй важнее первого: медиа полотен лежит в S строкой base64 (одно видео —
   до 24 МБ), поэтому лимита «50 шагов» мало — 50 таких снимков это гигабайт. Режем и по памяти.
   =========================================================== */
const UNDO_STEPS=50;                    // 50 × ~43 КБ ≈ 2 МБ на обычных данных — с запасом
const UNDO_BYTES=16*1024*1024;          // потолок на всю историю: спасает, когда в полотне видео
let _undoStack=[], _redoStack=[], _undoLast=null, _undoKeyLast=null, _undoBusy=false;
// полный снимок — для восстановления
const _undoSnap=()=>JSON.stringify({items:S.items, links:S.links, areas:S.areas, tags:S.tags});
// ключ — для сравнения: без x/y, но с признаком «стоит на холсте»
const _noXY=o=>{ const r=Object.assign({},o); delete r.x; delete r.y; r._on=(o.x!=null); return r; };
const _undoKey=()=>JSON.stringify({items:S.items.map(_noXY), links:S.links, areas:S.areas.map(_noXY), tags:S.tags});
const _undoTrim=a=>{ let n=a.reduce((s,x)=>s+x.length,0);
  while(a.length>UNDO_STEPS || (a.length>1 && n>UNDO_BYTES)) n-=a.shift().length; };
function undoInit(){ _undoLast=_undoSnap(); _undoKeyLast=_undoKey(); _undoStack=[]; _redoStack=[]; }
function undoPush(){
  if(_undoLast===null || _undoBusy) return;
  // не шаг: переключили вкладку, дёрнули ползунок, подвинули ноду — содержимое то же
  if(_undoKey()===_undoKeyLast) return;
  _undoStack.push(_undoLast); _undoTrim(_undoStack);
  _redoStack.length=0;                  // новое действие обрывает ветку повтора — как везде
}
function _undoApply(snap){
  // _undoBusy: render() ниже сам зовёт persist() (синхронизация view в views.js и
  // recomputeHierarchy в графе). Без флага откат положил бы снимок сам на себя и убил повтор.
  _undoBusy=true;
  const d=JSON.parse(snap);
  /* Ноды остаются там, где стоят: откат — про содержимое, а не про раскладку.
     Но координаты из снимка всё же берём в двух случаях: нода воскресла (её сейчас нет —
     иначе потеряла бы место и уехала в лоток) или в снимке она лежала в лотке (x==null),
     то есть откатываем сам факт «разобрал» и обязаны вернуть её обратно в лоток. */
  const держать=(было,стало)=>{ const p=new Map(); было.forEach(o=>{ if(o.x!=null) p.set(o.id,o); });
    стало.forEach(o=>{ if(o.x==null) return; const c=p.get(o.id); if(c){ o.x=c.x; o.y=c.y; } }); };
  держать(S.items, d.items); держать(S.areas, d.areas);
  S.items=d.items; S.links=d.links; S.areas=d.areas; S.tags=d.tags;   // настройки и вкладку не трогаем
  if(areaFilter && !S.areas.some(a=>a.id===areaFilter)) areaFilter=null;   // область могли откатить в небытие
  render();
  _undoBusy=false;
  _undoLast=_undoSnap(); _undoKeyLast=_undoKey();   // снимок правим координатами — пересчитываем от факта
  clearTimeout(saveTimer); saveTimer=null; Store.save(S);
}
function undoStep(){ if(!_undoStack.length) return false;
  _redoStack.push(_undoLast); _undoTrim(_redoStack); _undoApply(_undoStack.pop()); return true; }
function redoStep(){ if(!_redoStack.length) return false;
  _undoStack.push(_undoLast); _undoTrim(_undoStack); _undoApply(_redoStack.pop()); return true; }
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
