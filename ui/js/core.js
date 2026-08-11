"use strict";
/* ===========================================================
   planner — KROLIK edition
   =========================================================== */

/* ---------- storage abstraction (pywebview OR browser) ----------
   HasPy проверяет КОНКРЕТНЫЙ метод, а не сам объект api. Причина: pywebview собирает мост
   двумя скриптами — api.js создаёт window.pywebview с ПУСТЫМ api:{}, и только finish.js
   навешивает методы через _createApi и диспатчит pywebviewready. В зазоре между ними
   проверка «объект api существует» истинна, а api.load() бросает TypeError: приложение
   стартовало бы в мёртвое окно. */
const HasPy = () => typeof (window.pywebview && window.pywebview.api && window.pywebview.api.load) === "function";
/* ВЕРСИЯ ДОСОК. Python-сторона хранит доски ОТДЕЛЬНЫМ файлом (app.py: BOARDS_FILE) — сюда
   бьётся замер: без версии мост нёс бы S.boards ПОЛНОСТЬЮ на КАЖДЫЙ save(), хотя на живых
   данных доски — 3.5+ МБ из 4+ МБ, и абсолютное большинство действий (чек-бокс задачи,
   ползунок настроек графа) их вообще не касаются. bridge_bench.py: несвязанная правка через
   мост — 95 мс со старой Python-логикой (indent=1, один файл), 75 мс после разноса файлов,
   но БЕЗ этого счётчика мост всё ещё нёс бы полный объём — падение было в основном за счёт
   Python-стороны, а не самой передачи.
   ВСЕ прямые S.boards[...]=/delete S.boards[...] ОБЯЗАНЫ идти через boardSet/boardDelete —
   иначе мутация не долетит до Store.save() как «доски изменились», и правка останется только
   в памяти вкладки до следующего случайного «настоящего» изменения доски. */
let _boardsVer = 0;
let _boardsVerSent = -1;   // -1: гарантированно не равно _boardsVer → первая же запись сессии несёт доски
function boardSet(key, value){
  if(!S.boards || typeof S.boards!=="object") S.boards={};
  S.boards[key]=value; _boardsVer++;
}
function boardDelete(key){
  if(S.boards && key in S.boards){ delete S.boards[key]; _boardsVer++; }
}
const Store = {
  async load(){
    if(HasPy()) return await window.pywebview.api.load();
    try{ return JSON.parse(localStorage.getItem("planner")||"null"); }catch(e){ return null; }
  },
  async save(s){
    if(HasPy()){
      // В деве такого разделения нет (всё в одном ключе localStorage) — там доски шлём всегда,
      // иначе следующая же «несвязанная» запись стёрла бы их из localStorage начисто.
      const слатьДоски = _boardsVer !== _boardsVerSent;
      const пакет = слатьДоски ? s : Object.assign({}, s, {boards:null});
      const ok = await window.pywebview.api.save(пакет);
      if(ok!==false && слатьДоски) _boardsVerSent = _boardsVer;
      return ok;
    }
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
/* makeDate(y,mo,d) — Date из ЧЕЛОВЕЧЕСКИХ чисел (mo 1..12) или null, если такой даты не было.
   new Date(y,mo-1,d) молча нормализует переполнение: 29 февраля невисокосного года становится
   1 марта, 31.04 — 1 мая, а месяц «00» уезжает в декабрь прошлого года. Поэтому после создания
   сверяем результат с тем, что просили: не сошлось — даты не существует. */
function makeDate(y,mo,d){
  y=+y; mo=+mo; d=+d;
  if(!(y>=1970 && y<=9999) || !(mo>=1 && mo<=12) || !(d>=1 && d<=31)) return null;
  const x=startOfDay(new Date(y,mo-1,d));
  return (x.getFullYear()===y && x.getMonth()===mo-1 && x.getDate()===d) ? x : null;
}
const daysInMonth = (y,mo)=> new Date(y,mo,0).getDate();   // mo 1..12

const REPEAT={none:"",daily:"каждый день",weekly:"каждую неделю",monthly:"каждый месяц"};
/* Следующий срок повтора. Два правила, оба про «дата должна остаться осмысленной»:
   1) месяц считаем через 1-е число с зажимом дня по длине целевого месяца — иначе
      31.01 + месяц = «31 февраля» = 3 марта, и февраль пропускается целиком, а число
      31 навсегда превращается в 1–3;
   2) крутим вперёд, пока срок не окажется в будущем: повтор просроченной задачи иначе
      рождает копию, уже просроченную, и её приходится закрывать по разу за период. */
function nextRepeat(due,rep){
  const start=parseYmd(due)||today();
  if(!REPEAT[rep] || rep==="none") return null;
  const anchor=start.getDate();          // «число месяца», от которого пляшем: 31 остаётся 31
  const T=today();
  let d=start, guard=0;
  do{
    if(rep==="daily") d=addDays(d,1);
    else if(rep==="weekly") d=addDays(d,7);
    else if(rep==="monthly"){
      const n=new Date(d); n.setDate(1); n.setMonth(n.getMonth()+1);
      n.setDate(Math.min(anchor, daysInMonth(n.getFullYear(), n.getMonth()+1)));
      d=startOfDay(n);
    }
    else return null;
  } while(d<=T && ++guard<4000);          // guard: страховка от вечного цикла на битых данных
  return ymd(d);
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
/* Путь папки для передачи ДРУГОМУ человеку: у общей папки Dropbox совпадает только часть
   от её корня, а локальное начало у каждого своё (тут E:\_Dropbox\, у коллеги — иное место).
   Поэтому всё до корня Dropbox отрезается, и путь начинается с «<Команда> Dropbox\…».
   Корень ищется как ПОСЛЕДНИЙ сегмент, ОКАНЧИВАЮЩИЙСЯ на «Dropbox»: у корня имя всегда
   такое («Dropbox» или «Moviestudio Dropbox»), а вложенная папка вроде «Dropbox links»
   под правило не попадает и путь не обрежет. Путь мимо Dropbox отдаётся целиком:
   резать в нём нечего, общего начала у людей нет. */
function shortFolder(p){
  if(!p || typeof p!=="string") return "";
  const parts=p.split(/[\\/]+/).filter(Boolean);
  let root=-1;
  parts.forEach((s,i)=>{ if(/dropbox$/i.test(s.trim())) root=i; });
  return root<0 ? p : parts.slice(root).join("\\");
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
    /* Доски нод-полотен: ключ — id ноды. Лежат ОТДЕЛЬНО от items намеренно: снимок отката
       (_undoSnap) сериализует items целиком, и рисунки раздували бы историю на каждый шаг.
       Доска ПОЛЯ ноды лежит здесь же под ключом "fld_"+id поля — по той же причине. */
    boards:{},
    /* Картинки полей: ключ "m_…" → data-URL. Тоже вне items и по той же причине: одна
       фотография — сотни килобайт base64, и каждый шаг отмены таскал бы их копию. */
    media:{},
    /* Шаблоны нод: {id, name, kind, title, tags[], fields[{type,name,h}]}. По шаблону нода
       рождается сразу с нужными полями (см. fields.js). */
    templates:[],
    tags:[],   // реестр стилизованных тегов: {name, icon?, color?, size?, shape?} — все свойства опциональны
    settings:{ theme:"dark", view:"today", graphDrift:4, graphSpread:1, graphBg:true, glow:1, graphLinkLen:1, graphNodeSize:1, graphDegScale:1, graphDoneScale:0.6, graphDoneLinkLen:0.6, graphLinkBright:1, graphFadedBright:0.5,
      graphDoingGlow:true, graphDoingGlowRadius:110, graphDoingGlowBright:0.3, graphDoingGlowBlur:30,
      /* ЧЕМ РИСУЕТСЯ ГРАФ: "svg" — старый путь (создаёт DOM-элемент на каждый узел и связь),
         "canvas" — одним холстом. ДЕФОЛТ СМЕНЁН на canvas (2026-08-11): замер аудита — на
         SVG-пути пересчёт стилей и раскладки съедал 38 из 47 мс кадра на дереве 654 узла,
         canvas обходит эту статью целиком. У кого уже сохранён свой выбор — ЭТА строка на них
         не влияет вовсе: sanitizeState сливает дефолт с файлом через
         Object.assign({}, defaultState().settings, s.settings||{}) — явно сохранённое
         значение всегда побеждает дефолт. Проверено отдельно (test_canvas_default.js): и
         "svg", и "canvas", однажды сохранённые, остаются как есть; дефолт трогает только
         СОВСЕМ новый файл (ключа graphRender ещё не было вовсе) — то есть только новых
         пользователей. Откат — та же строка назад на "svg". */
      graphRender:"canvas",
      /* ПОТОЛОК КАДРОВ ГРАФА, 0 — как у монитора. По умолчанию потолка НЕТ: он режет ватты
         вчетверо (42.6 → 19.6 на 165 Гц), но процент занятости видеокарты в диспетчере задач —
         то, на что смотрит человек, — при этом не меняется, и КРОЛИК разницы не увидел.
         Переключатель остаётся в настройках графа: на ноутбуке от батареи он полезен.
         КЛЮЧ ПЕРЕИМЕНОВАН из graphMaxFps намеренно: у тех, кто успел попробовать потолок 60,
         он уже лежал в файле, и возврат к значению по умолчанию до них бы не доехал. */
      graphFpsCap:0,
      /* ЗУМ И ПАН ГОТОВОЙ КАРТИНКОЙ вместо перерисовки (см. _рисоватьХолст в graph.js).
         Замер: честный кадр 0.641 мс, кадр картинкой 0.001 мс. Плата — пока крутят колесо,
         картинка масштабируется и слегка мылит (пересъём при растяжении больше чем на четверть). */
      graphFastZoom:true,
      asideW:420, asideFrac:0.34, asideOn:true,   // правая панель: доля от ширины окна и показана ли
      sideHidden:false,            // левая полоса: свёрнута ли до кромки
      template:null,               // шаблон новых нод по умолчанию (id из S.templates); null — как раньше, одно описание
      graph:"g_main" }             // активный граф (id из S.graphs); ноды и области у каждого свои
  };
}

/* Значок графа по умолчанию. Намеренно НЕ ti-affiliate: этой иконкой отмечен вид «Заметки»
   в той же полосе, и два одинаковых значка подряд читались как дубль одного и того же. */
const GRAPH_ICON_DEF="ti-topology-star-3";
/* ---------- графы ----------
   Графов может быть несколько, и они НЕ пересекаются: свои ноды, свои области, свои связи.
   Чтобы не переписывать сотню обращений к S.items по всему коду, активный граф подставляется
   геттерами: S.items — это items активного графа. Свойства НЕперечисляемые, поэтому в файл
   уезжает только s.graphs, без дубля. */
function graphBind(s){
  const активный=()=>s.graphs.find(g=>g.id===s.settings.graph)||s.graphs[0];
  ["items","areas","links"].forEach(ключ=>{
    delete s[ключ];
    Object.defineProperty(s, ключ, { configurable:true, enumerable:false,
      get:()=>активный()[ключ], set:v=>{ активный()[ключ]=v; } });
  });
  return s;
}
const graphCurrent = ()=> (S.graphs||[]).find(g=>g.id===S.settings.graph) || (S.graphs||[])[0] || null;
function graphAdd(name){
  if(!Array.isArray(S.graphs)) S.graphs=[];
  const g={id:"g_"+uid(), name:String(name||"").trim().slice(0,40)||("Граф "+(S.graphs.length+1)),
           icon:GRAPH_ICON_DEF, color:null, items:[], areas:[], links:[]};
  S.graphs.push(g); persist();
  return g;
}
/* Переключение графа обнуляет ИСТОРИЮ отката: снимки сняты с прежнего графа, и Ctrl+Z после
   перехода подменил бы содержимое соседнего. Фильтр по области тоже сбрасываем — область
   принадлежала тому графу и в этом её нет. */
function graphSwitch(id){
  if(!S.graphs.some(g=>g.id===id) || S.settings.graph===id) return false;
  S.settings.graph=id; areaFilter=null; asideId=null;
  persist(); undoInit();
  return true;
}
function graphRename(id, name){
  const g=(S.graphs||[]).find(x=>x.id===id); if(!g) return false;
  const n=String(name||"").trim().slice(0,40); if(!n) return false;
  g.name=n; persist(); return true;
}
/* Удаление графа уносит ВСЁ его содержимое, включая доски и картинки нод: хранилища общие,
   и без этого от снесённого графа остались бы мегабайты, которые уже некому показать.
   Последний граф удалить нельзя — приложению нужно где-то жить. */
function graphDelete(id){
  if(!Array.isArray(S.graphs) || S.graphs.length<2) return false;
  const g=S.graphs.find(x=>x.id===id); if(!g) return false;
  g.items.forEach(it=>{
    boardDelete(it.id);
    (it.fields||[]).forEach(f=>{
      if(f.media && S.media) delete S.media[f.media];
      if(f.type==="board") boardDelete(fieldBoardKey(f.id));
    });
  });
  S.graphs=S.graphs.filter(x=>x.id!==id);
  if(S.settings.graph===id){ S.settings.graph=S.graphs[0].id; areaFilter=null; asideId=null; undoInit(); }
  persist();
  return true;
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

/* ---------- поля ноды ----------
   Кроме общего описания (it.body) у ноды бывают ИМЕНОВАННЫЕ поля: текст, картинка, доска.
   Здесь только то, что нужно санитайзеру; вся работа с полями — в ui/js/fields.js. */
const FIELD_TYPES=["text","image","board"];
const FIELDS_MAX=30;                       // потолок: защита от чужого json, а не от человека
const FIELD_H_MIN=90, FIELD_H_MAX=1400, FIELD_H_DEF=220;
/* Высота врезки. Хранится у поля и переживает сессию — её тянут ручкой руками, поэтому
   значение ЗАЖИМАЕМ в пределы, а не отбрасываем: человек, растянувший доску на 1200 px,
   иначе получал бы её обратно 220-й. Мусор (не число) — это дефолт. */
const fieldHeight = h => { const v=Math.round(+h||0); return v ? Math.max(FIELD_H_MIN, Math.min(FIELD_H_MAX, v)) : FIELD_H_DEF; };
// доска родится повыше картинки: её собственный тулбар съедает верхние ~50 px, и в 220 px
// на рисование остаётся полоска
const FIELD_BOARD_H_DEF=340;
const fieldHeightFor = (type,h) => fieldHeight(h || (type==="board" ? FIELD_BOARD_H_DEF : FIELD_H_DEF));
// доска поля лежит в S.boards, как и доска полотна: снимок отката сериализует items целиком
const fieldBoardKey = fid => "fld_"+fid;
/* ---------- СЕТКА ПОЛЕЙ ----------
   Поля лежат на сетке из 12 колонок, как плитки дашборда: у каждой свои координаты, а не
   место в списке. gx — колонка (0…11), gw — сколько колонок занимает, gy и gh — верх и высота
   В ПИКСЕЛЯХ. Вертикаль в пикселях, а не в «строках сетки», потому что содержимое полей разной
   природы: текст растёт под свой текст, картинка живёт по своим пропорциям, доске нужен запас
   под тулбар — общей «единицы строки» для них не существует.

   Порядок в массиве fields остаётся, но раскладку больше НЕ задаёт: он нужен отчёту, поиску и
   шаблонам. Читаем сверху вниз и слева направо — сортировкой по (gy, gx). */
const GRID_COLS=12, GRID_GAP=8;
const gridW = w => Math.max(1, Math.min(GRID_COLS, Math.round(+w||GRID_COLS)));
// СТАРОЕ: доля ряда в процентах. Осталась только для переноса старых данных на сетку
const FIELD_W_MIN=15;
const fieldWidth = w => { const v=Math.round(+w||0); return (v>=FIELD_W_MIN && v<100) ? v : 100; };

// нормализация загруженного/импортированного состояния: бэкилл полей, дедуп id,
// белый список иконок и валидация цветов — защита от битых/вредоносных данных (импорт/ручная правка json)
function sanitizeState(s){
  if(!s || typeof s!=="object") return defaultState();
  s.settings = Object.assign({}, defaultState().settings, s.settings||{});
  const okColor=c=>(typeof c==="string"&&/^#[0-9a-fA-F]{3,8}$/.test(c))?c:null;
  /* Доски нод. Чужой или подпорченный json может принести сюда что угодно, а сцена уходит
     в Excalidraw как есть — мусорный элемент валит рендер всей доски. Пропускаем только
     объекты с типом и id, остальное молча отбрасываем. */
  const чистаяДоска=b=>{
    const d=(b && typeof b==="object" && !Array.isArray(b)) ? b : {};
    const els=Array.isArray(d.elements)?d.elements:[];
    return {
      elements: els.filter(e=>e && typeof e==="object" && !Array.isArray(e)
                              && typeof e.type==="string" && typeof e.id==="string"),
      files: (d.files && typeof d.files==="object" && !Array.isArray(d.files)) ? d.files : {},
      appState: (d.appState && typeof d.appState==="object" && !Array.isArray(d.appState)) ? d.appState : {},
      fromFlow: d.fromFlow===true
    };
  };
  if(!s.boards || typeof s.boards!=="object" || Array.isArray(s.boards)) s.boards={};
  Object.keys(s.boards).forEach(k=>{ s.boards[k]=чистаяДоска(s.boards[k]); });
  /* МИГРАЦИЯ: глобальная вкладка «Доска» снесена — её содержимое переезжает в отдельную ноду.
     id ноды детерминированный: если санитайзер отработает дважды (старт + приход моста),
     второй раз просто не найдёт что переносить, а дубль создать не сможет физически. */
  if(s.draw && typeof s.draw==="object" && Array.isArray(s.draw.elements) && s.draw.elements.length){
    const ID="flow_общая_доска";
    if(!s.items.some(it=>it && it.id===ID)){
      s.items.push({id:ID, kind:"flow", title:"Общая доска", body:"", status:"note",
                    area:null, tags:[], deleted:false, repeat:"none", created:Date.now()});
    }
    s.boards[ID]=чистаяДоска(s.draw);
    s.draw={elements:[], files:{}, appState:{}};
  }
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
  /* Картинки полей: только строка-data-URL картинки. Чужой json может принести сюда путь
     к файлу или javascript: — такое в <img src> не пускаем. */
  if(!s.media || typeof s.media!=="object" || Array.isArray(s.media)) s.media={};
  Object.keys(s.media).forEach(k=>{ const v=s.media[k];
    if(typeof v!=="string" || !/^data:image\//i.test(v)) delete s.media[k]; });
  /* Шаблоны нод. Поля шаблона — только описание («какие блоки завести»), без содержимого:
     картинка и доска у каждой ноды свои. */
  if(!Array.isArray(s.templates)) s.templates=[];
  { const seenTpl=new Set();
    s.templates=s.templates.filter(t=>t&&typeof t==="object"&&!Array.isArray(t)).slice(0,60).map(t=>{
      let id=(typeof t.id==="string"&&t.id&&!seenTpl.has(t.id))?t.id:("tpl_"+uid()); seenTpl.add(id);
      // названия ноды в шаблоне нет намеренно (см. templateSeed в fields.js) — из старых данных выбрасываем
      return { id, name:String(t.name==null?"":t.name).trim().slice(0,60)||"Шаблон",
        kind:(t.kind==="note"||t.kind==="task")?t.kind:"note",
        tags:Array.isArray(t.tags)?t.tags.map(x=>String(x)).slice(0,20):[],
        fields:(Array.isArray(t.fields)?t.fields:[]).filter(f=>f&&typeof f==="object").slice(0,FIELDS_MAX)
          /* Флаги раскладки (br — своя строка, st — под соседом в колонке, gwm — ширину задали
             руками) обязаны пережить чистку: без них шаблон помнил только состав, и поля,
             стоявшие в ряд и стопкой, приезжали каждое своей строкой. */
          .map((f,n)=>{ const о={ type:FIELD_TYPES.includes(f.type)?f.type:"text",
                     name:String(f.name==null?"":f.name).slice(0,80),
                     gw:gridW(f.gw!=null?f.gw:GRID_COLS),
                     gh:fieldHeight(f.gh!=null?f.gh:f.h) };
            if(f.br===true) о.br=true;
            if(f.st===true && n>0) о.st=true;
            if(f.gwm===true) о.gwm=true;
            return о; }) };
    }); }
  if(s.settings.template && !s.templates.some(t=>t.id===s.settings.template)) s.settings.template=null;

  /* ГРАФЫ. Ноды, области и связи принадлежат КОНКРЕТНОМУ графу: их два и больше, и они друг о
     друге не знают вовсе. Общими остаются доски, картинки, теги и шаблоны — они адресуются по
     id и одинаково нужны везде. Старые данные (items/areas/links на верхнем уровне) переезжают
     в первый граф; сами поля дальше живут геттерами на активный граф (graphBind). */
  if(!Array.isArray(s.graphs) || !s.graphs.length){
    s.graphs=[{id:"g_main", name:"Мой граф", icon:GRAPH_ICON_DEF, items:s.items||[], areas:s.areas||[], links:s.links||[]}];
  }
  { const виден=new Set();
    s.graphs=s.graphs.filter(g=>g&&typeof g==="object"&&!Array.isArray(g)).slice(0,20).map((g,i)=>{
      let id=(typeof g.id==="string"&&g.id&&!виден.has(g.id))?g.id:("g_"+uid()); виден.add(id);
      return { id, name:String(g.name==null?"":g.name).trim().slice(0,40)||("Граф "+(i+1)),
               icon:ICONS.includes(g.icon)?g.icon:GRAPH_ICON_DEF,   // значок только из белого списка
               color:okColor(g.color),
               items:Array.isArray(g.items)?g.items:[], areas:Array.isArray(g.areas)?g.areas:[],
               links:Array.isArray(g.links)?g.links:[] };
    });
    if(!s.graphs.length) s.graphs=[{id:"g_main", name:"Мой граф", icon:GRAPH_ICON_DEF, items:[], areas:[], links:[]}];
  }
  if(!s.graphs.some(g=>g.id===s.settings.graph)) s.settings.graph=s.graphs[0].id;

  /* КАМЕРА — СВОЯ У КАЖДОГО ГРАФА (2026-08-12). Раньше graphCam был один на всё приложение:
     переключился на другой граф — камера оставалась там же, где была на прежнем, и человек
     видел пустоту или чужой угол дерева, пока не находил, куда делись ноды (см. graph.js).
     Формат на диске меняется со ПЛОСКОГО {tx,ty,zoom} на СЛОВАРЬ {idГрафа:{tx,ty,zoom}}.
     Старую плоскую камеру относим к графу, что был активен на момент сохранения — это и есть
     тот граф, который человек тогда видел (s.settings.graph уже проверен строкой выше). */
  { const кам=s.settings.graphCam;
    if(кам && typeof кам==="object" && !Array.isArray(кам) && isFinite(кам.tx) && isFinite(кам.ty) && isFinite(кам.zoom)){
      s.settings.graphCam = {[s.settings.graph]: {tx:+кам.tx, ty:+кам.ty, zoom:+кам.zoom}};
    } else if(!кам || typeof кам!=="object" || Array.isArray(кам)){
      s.settings.graphCam = {};
    }
  }

  /* Множества id — ОБЩИЕ на все графы: доски и картинки лежат в одном хранилище, и одинаковый
     id ноды в двух графах означал бы двух хозяев у одного холста. */
  const seenF=new Set();   // id полей уникальны ГЛОБАЛЬНО: по ним же лежат доски (ключ "fld_"+id)
  const seen=new Set();
  s.graphs.forEach(гр=>{ s.items=гр.items; s.areas=гр.areas; s.links=гр.links;
    _sanitizeGraph(s, seen, seenF, okColor);
    гр.items=s.items; гр.areas=s.areas; гр.links=s.links; });
  /* Уборка мусора считается ПО ВСЕМ графам сразу: хранилище досок и картинок одно, и,
     подметая по одному графу, мы снесли бы содержимое нод соседнего. */
  { const живыеМедиа=new Set(), живыеДоски=new Set();
    s.graphs.forEach(гр=>гр.items.forEach(it=>{ живыеДоски.add(it.id);
      (it.fields||[]).forEach(f=>{ if(f.media) живыеМедиа.add(f.media);
        if(f.type==="board") живыеДоски.add(fieldBoardKey(f.id)); }); }));
    Object.keys(s.media).forEach(k=>{ if(!живыеМедиа.has(k)) delete s.media[k]; });
    Object.keys(s.boards).forEach(k=>{ if(/^fld_/.test(k) && !живыеДоски.has(k)) delete s.boards[k]; });
  }
  graphBind(s);
  s.v=2;
  return s;
}
/* Чистка ОДНОГО графа: работает с s.items/s.areas/s.links, которые вызывающий подставил.
   Множества id приходят снаружи — они общие на все графы (см. выше). */
function _sanitizeGraph(s, seen, seenF, okColor){
  if(!Array.isArray(s.areas)) s.areas=[];
  if(!Array.isArray(s.items)) s.items=[];
  if(!Array.isArray(s.links)) s.links=[];
  /* Сами ЭЛЕМЕНТЫ массивов тоже могут быть мусором (null, число, строка) — функция для того и
     существует, чтобы принять чужой/подпорченный json. Без фильтра первый же it.title ронял
     импорт с TypeError, и приложение оставалось с наполовину применённым состоянием. */
  s.areas=s.areas.filter(a=>a && typeof a==="object" && !Array.isArray(a));
  s.items=s.items.filter(it=>it && typeof it==="object" && !Array.isArray(it));
  /* МИГРАЦИЯ: корзины больше нет. Ноды, помеченные удалёнными в старых данных, сносим
     насовсем — иначе они висели бы в файле невидимками, недоступные ни через один вид.
     Их доски и картинки уйдут следом сами: осиротевшее подметается общей уборкой. */
  s.items=s.items.filter(it=>it.deleted!==true);
  s.areas.forEach(a=>{ if(!ICONS.includes(a.icon)) a.icon="ti-folder"; a.color=okColor(a.color); a.name=String(a.name==null?"":a.name); });
  s.items.forEach(it=>{
    if(typeof it.id!=="string" || !it.id || seen.has(it.id)){
      /* Смена id (битый json, склейка экспортов) обязана тянуть за собой доску: она лежит
         в s.boards по СТАРОМУ ключу и иначе осиротела бы, а нода открылась бы пустой. */
      const старый=it.id;
      it.id=uid();
      if(typeof старый==="string" && старый && s.boards[старый] && !s.boards[it.id]){
        s.boards[it.id]=s.boards[старый]; delete s.boards[старый];
      }
    }
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
    // срок: только «YYYY-MM-DD», и только существующая дата — иначе parseYmd отдаст сдвинутый
    // день (2026-02-31 → 3 марта) и он тихо разъедется по календарю, спискам и повторам
    if(it.due!=null){ const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(it.due)); it.due = (m && makeDate(m[1],m[2],m[3])) ? String(it.due) : null; }
    if(it.folder!=null){ it.folder = typeof it.folder==="string" ? it.folder : undefined; if(it.folder==="") it.folder=undefined; }   // привязанная папка на ПК: только непустая строка
    /* Дополнительные поля ноды. Столкнувшийся id поля переименовываем ВМЕСТЕ с его доской:
       иначе две ноды рисовали бы на одном холсте (ключ доски выводится из id поля). */
    if(it.fields!=null){
      if(!Array.isArray(it.fields)) it.fields=[];
      it.fields = it.fields.filter(f=>f&&typeof f==="object"&&!Array.isArray(f)).slice(0,FIELDS_MAX).map((f,n)=>{
        let id=(typeof f.id==="string"&&f.id&&!seenF.has(f.id))?f.id:null;
        if(!id){ const старый=(typeof f.id==="string")?f.id:""; id="f_"+uid();
          // доску забираем только если по старому ключу никто не сидит: при столкновении id
          // хозяин — тот, кого санитайзер прошёл первым, иначе перенос украл бы у него холст
          if(старый && !seenF.has(старый) && s.boards[fieldBoardKey(старый)] && !s.boards[fieldBoardKey(id)]){
            s.boards[fieldBoardKey(id)]=s.boards[fieldBoardKey(старый)]; delete s.boards[fieldBoardKey(старый)]; } }
        seenF.add(id);
        const тип=FIELD_TYPES.includes(f.type)?f.type:"text";
        const o={ id, type:тип, name:String(f.name==null?"":f.name).slice(0,80) };
        if(f.off===true) o.off=true;      // свёрнутое поле остаётся свёрнутым между сессиями
        if(f.br===true) o.br=true;        // «с новой строки» — иначе плитку не положить ПОД другую
        /* «Под предыдущей плиткой, в той же колонке». Флага не было до двухуровневой раскладки,
           и его отсутствие читается верно: поле без обоих флагов открывает новую колонку. */
        if(f.st===true && n>0) o.st=true;
        // «ширину этой строки задали руками» — без пометки нормализация растянула бы её обратно
        if(f.gwm===true) o.gwm=true;
        /* Доля строки. Старые данные знали проценты (w) или координаты сетки (gx/gy) — от них
           берём только ширину: строки теперь выводятся из порядка и долей, а координаты
           не хранятся вовсе. Первая плитка бывшей строки помечается «с новой строки». */
        o.gw = f.gw!=null ? gridW(f.gw) : gridW(Math.round(fieldWidth(f.w)/100*GRID_COLS));
        /* Начало строки. Явный флаг важнее всего; иначе поле во всю ширину заведомо занимало
           строку целиком, а узкое — делило её с соседом (так было и в координатах, и в долях). */
        if(f.br===true || (n>0 && (o.gw>=GRID_COLS || f.gx===0))) o.br=true;
        // высота плитки в пикселях: у старых полей это h, у текста без высоты — свой дефолт
        o.gh = fieldHeight(f.gh!=null ? f.gh : (f.h!=null ? f.h : fieldHeightFor(тип)));
        if(тип==="text") o.value=String(f.value==null?"":f.value);
        if(тип==="image") o.media=(typeof f.media==="string"&&s.media[f.media])?f.media:null;
        return o;
      });
      if(!it.fields.length) delete it.fields;   // пустой массив в каждой ноде — лишний вес файла и шум в снимке отката
    }
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
  return s;
}

// стартовое состояние тоже прогоняем через санитайзер: он и графы соберёт, и геттеры повесит
let S = sanitizeState(defaultState());
let _prevView=null;   // для анимации входа: отличаем смену вкладки от обычной перерисовки
let saveTimer=null;
let _undoWindow=false;   // открыто ли окно «одного действия человека» (см. persist)
/* persist(quiet) — единственная воронка записи. quiet=true: сохранить, но НЕ считать это
   действием человека (см. undo ниже). Нужен ровно одному месту — авто-сохранению раскладки,
   когда физика графа остыла сама по себе. */
/* Общая точка планирования записи на диск. Раньше _undoApply (см. ниже) писала СВОИМ путём —
   немедленно и синхронно, в обход этого таймера: держат Ctrl+Z секунду, Windows шлёт keydown
   автоповтором, и КАЖДЫЙ шаг отката синхронно гнал через мост pywebview весь файл (на живых
   данных — 4.2 МБ, десятки раз подряд). Теперь и обычная правка, и шаг отката ложатся в ОДИН
   таймер: несколько быстрых шагов подряд (в том числе автоповтор, если где-то ещё не отфильтрован)
   схлопываются в одну запись после паузы. */
function _scheduleWrite(cb, мс){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{ saveTimer=null; cb(); }, мс==null?250:мс);
}
function persist(quiet){
  // Снимок кладём в момент, когда окно дебаунса ОТКРЫВАЕТСЯ. Это и есть граница действия:
  // пока человек тянет ползунок или пока одно «создать ноду» дёргает persist четыре раза
  // подряд, таймер каждый раз сбрасывается и окно не закрывается — значит снимок будет один.
  // Иначе Ctrl+Z отматывал бы свечение по пикселю, а создание ноды требовало бы четырёх нажатий.
  /* Границу действия отмечает ОТДЕЛЬНЫЙ флаг, а не «висит ли таймер записи». Раньше признаком
     служило saveTimer!==null, но тихое автосохранение раскладки (persist(true), когда физика
     графа остыла сама) открывало ровно тот же таймер — не делая снимка. Действие человека,
     попавшее в эти 250 мс, снимок уже не получало: Ctrl+Z молча пропускал шаг. */
  if(!quiet && !_undoWindow){ undoPush(); _undoWindow=true; }
  /* ТИХАЯ запись не трогает историю отката. Раньше в конце дебаунса ВСЕГДА снимались два
     полных снимка состояния (_undoSnap и _undoKey) — на живом файле это лишняя сериализация
     мегабайтов в потоке интерфейса на каждое автосохранение камеры и раскладки, то есть рывок
     ровно посреди работы. Человеческим правкам снимки по-прежнему нужны: они и есть граница
     шага отката. Флаг сбрасывает ЛЮБАЯ нетихая запись, попавшая в то же окно, — иначе тихая
     проглотила бы границу чужого действия. */
  if(!quiet) _saveЧеловек=true;
  _scheduleWrite(()=>{
    if(_saveЧеловек){ _undoWindow=false; _undoLast=_undoSnap(); _undoKeyLast=_undoKey(); }
    _saveЧеловек=false;
    writeNow();
  });
}
let _saveЧеловек=false;   // была ли в текущем окне дебаунса запись от действия человека

/* writeNow / flushSave — фактическая запись. Раньше здесь стоял голый Store.save(S):
   промис никто не читал, поэтому отказ диска (нет места, файл занят антивирусом, папка
   стала недоступной) выглядел как успешная работа — человек продолжал писать в память,
   а на диск не попадало ничего. Теперь результат читается и провал виден. */
let _saveFailed=false;
async function writeNow(){
  try{
    const ok=await Store.save(S);
    if(ok===false){ _saveTrouble("Не удалось записать файл данных"); return false; }
    if(_saveFailed){ _saveFailed=false; toast("Сохранение восстановлено",{icon:"ti-device-floppy"}); }
    return true;
  }catch(e){
    _saveTrouble("Сохранение сорвалось: "+((e&&e.message)||e));
    return false;
  }
}
function _saveTrouble(msg){
  if(_saveFailed) return;            // не долбить одним и тем же тостом на каждый автосейв
  _saveFailed=true;
  toast(msg+" — данные пока только в памяти",{icon:"ti-alert-triangle",label:"Экспортировать",hold:true,
    onAction:()=>{ if(typeof doExport==="function") doExport(); }});
}
// Дожать отложенную запись немедленно: перед закрытием окна и перед выгрузкой страницы.
// Без этого последние 250 мс работы (дебаунс persist) исчезали вместе с окном.
async function flushSave(){
  if(saveTimer!==null){ clearTimeout(saveTimer); saveTimer=null; _undoWindow=false; _undoLast=_undoSnap(); _undoKeyLast=_undoKey(); }
  return await writeNow();
}
const saveBroken = ()=>_saveFailed;

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
/* КАРМАН УДАЛЁННОГО. Корзины больше нет: удалил — удалено, второй раз подтверждать нечего.
   Но вернуть по Ctrl+Z обязано вернуть ВСЁ, а тяжёлое содержимое ноды (доска полотна, доски
   и картинки полей) лежит вне неё и в снимок отката не входит — иначе каждый шаг истории
   таскал бы копии фотографий. Поэтому при удалении складываем содержимое сюда, в память,
   и достаём обратно, когда нода воскресла. В файл карман не пишется и живёт до перезапуска. */
const TRASH_KEEP=40;                 // помним последние удаления; дальше содержимое отпускаем
const _trash=new Map();              // id ноды → {boards:{ключ:сцена}, media:{ключ:data-URL}}
function trashKeep(it){
  if(!it) return;
  const карман={boards:{}, media:{}};
  if(S.boards && S.boards[it.id]){ карман.boards[it.id]=S.boards[it.id]; }
  (Array.isArray(it.fields)?it.fields:[]).forEach(f=>{
    const к=fieldBoardKey(f.id);
    if(S.boards && S.boards[к]) карман.boards[к]=S.boards[к];
    if(f.media && S.media && S.media[f.media]) карман.media[f.media]=S.media[f.media];
  });
  _trash.set(it.id, карман);
  while(_trash.size>TRASH_KEEP) _trash.delete(_trash.keys().next().value);
}
// вернуть содержимое нодам, которые снова появились в списке (после отката)
function trashRevive(items){
  if(!_trash.size) return;
  (items||[]).forEach(it=>{
    const к=_trash.get(it.id); if(!к) return;
    if(!S.media  || typeof S.media !=="object") S.media={};
    Object.keys(к.boards).forEach(x=>{ if(!S.boards || !S.boards[x]) boardSet(x, к.boards[x]); });
    Object.keys(к.media ).forEach(x=>{ if(!S.media[x])  S.media[x] =к.media[x];  });
  });
}
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
  trashRevive(S.items);   // воскресшим нодам вернуть их доски и картинки (см. карман удалённых)
  if(areaFilter && !S.areas.some(a=>a.id===areaFilter)) areaFilter=null;   // область могли откатить в небытие
  render();
  _undoBusy=false;
  _undoLast=_undoSnap(); _undoKeyLast=_undoKey();   // снимок правим координатами — пересчитываем от факта
  /* Запись — той же отложенной дорогой, что и обычная правка (_scheduleWrite), а не немедленно.
     Снимок для отката (строка выше) остаётся синхронным — от него зависит корректность
     следующего шага, и это дёшево (в памяти); на диск идёт то же самое значение, только
     позже и одним разом, если шагов подряд несколько. */
  _scheduleWrite(writeNow);
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
// что показано в правой панели: id выбранного элемента (null — панель пустая)
let asideId = null;
let asideGroup = null;   // выделено несколько нод — показываем сводку по ним
let areaFilter = null;
let calOffset = 0;        // смещение месяца в календаре
let notesMode = "graph";  // graph | list
let showDone = false;     // показывать ли выполненные задачи
let taskFilter = "all";   // фильтр вкладки «Задачи»: all | today | week | nodue
let tagFilter = null;     // фильтр по тегу (клик по чипу тега) — сквозной, поверх области/срока
let listQuery = "";       // текстовый фильтр списков («Задачи» / «Заметки»-список), сбрасывается при смене вкладки
