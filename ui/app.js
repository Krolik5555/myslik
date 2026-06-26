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
    a.download="planner-export.json"; a.click(); return "browser-download";
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
    settings:{ theme:"dark", view:"today",
      boardLabels:{ inbox:"Inbox", todo:"Запланировано", doing:"В работе", done:"Готово" } }
  };
}
function boardLabel(k){ const m=(S.settings&&S.settings.boardLabels)||{}; return m[k]||{inbox:"Inbox",todo:"Запланировано",doing:"В работе",done:"Готово"}[k]; }

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
  });
  s.items.forEach(it=>{ if(it.parent && !seen.has(it.parent)) it.parent=null; });   // снять висячие parent
  s.links=s.links.filter(l=>Array.isArray(l)&&l.length===2 &&
    (seen.has(l[0])||/^hub_/.test(l[0])) && (seen.has(l[1])||/^hub_/.test(l[1])));   // выкинуть связи в никуда
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

/* ===========================================================
   QUICK CAPTURE PARSER
   =========================================================== */
function parseCapture(raw){
  let s=" "+raw+" ";
  let area=null, due=null, repeat="none", priority=0;

  // #область  (match by name prefix, case-insensitive)
  s=s.replace(/#([\wа-яёA-Za-zЁ-]+)/gi,(m,name)=>{
    const low=name.toLowerCase();
    const a=S.areas.find(a=>a.name.toLowerCase().startsWith(low)) ||
            S.areas.find(a=>a.name.toLowerCase().includes(low));
    if(a){ area=a.id; return " "; }
    return m;
  });
  // priority
  s=s.replace(/(^|\s)!{1,3}(?=\s)/g,(m)=>{ priority=Math.min(3,(m.trim().length)); return " "; });
  // repeat — границы кириллице-осознанные (JS \b не считает кириллицу словом → раньше не срабатывало)
  if(/(?<![а-яёa-z0-9])(каждый день|ежедневно)(?![а-яёa-z0-9])/i.test(s)){ repeat="daily"; s=s.replace(/(?<![а-яёa-z0-9])(каждый день|ежедневно)(?![а-яёa-z0-9])/gi," "); }
  if(/(?<![а-яёa-z0-9])(каждую неделю|еженедельно)(?![а-яёa-z0-9])/i.test(s)){ repeat="weekly"; s=s.replace(/(?<![а-яёa-z0-9])(каждую неделю|еженедельно)(?![а-яёa-z0-9])/gi," "); }
  if(/(?<![а-яёa-z0-9])(каждый месяц|ежемесячно)(?![а-яёa-z0-9])/i.test(s)){ repeat="monthly"; s=s.replace(/(?<![а-яёa-z0-9])(каждый месяц|ежемесячно)(?![а-яёa-z0-9])/gi," "); }
  // dates
  if(/(?<![а-яёa-z0-9])сегодня(?![а-яёa-z0-9])/i.test(s)){ due=ymd(today()); s=s.replace(/(?<![а-яёa-z0-9])сегодня(?![а-яёa-z0-9])/gi," "); }
  else if(/(?<![а-яёa-z0-9])завтра(?![а-яёa-z0-9])/i.test(s)){ due=ymd(addDays(today(),1)); s=s.replace(/(?<![а-яёa-z0-9])завтра(?![а-яёa-z0-9])/gi," "); }
  else if(/(?<![а-яёa-z0-9])послезавтра(?![а-яёa-z0-9])/i.test(s)){ due=ymd(addDays(today(),2)); s=s.replace(/(?<![а-яёa-z0-9])послезавтра(?![а-яёa-z0-9])/gi," "); }
  const wd={"пн":1,"вт":2,"ср":3,"чт":4,"пт":5,"сб":6,"вс":0};
  s=s.replace(/(?<![а-яёa-z0-9])(пн|вт|ср|чт|пт|сб|вс)(?![а-яёa-z0-9])/i,(m,w)=>{
    if(due) return m;
    const tgt=wd[w.toLowerCase()], cur=today().getDay(); let add=(tgt-cur+7)%7; if(add===0)add=7;
    due=ymd(addDays(today(),add)); return " ";
  });
  s=s.replace(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?\b/,(m,d,mo,y)=>{
    if(due) return m;
    let year= y? (y.length===2?2000+(+y):+y) : today().getFullYear();
    const cand=startOfDay(new Date(year,(+mo)-1,+d));
    if(!y && cand < today()) cand.setFullYear(year+1);
    due=ymd(cand); return " ";
  });
  s=s.replace(/(?<![а-яёa-z0-9])через\s+(\d{1,3})\s*(дн|день|дня|дней|нед|недел\w*)(?![а-яёa-z0-9])/i,(m,n,unit)=>{
    if(due) return m;
    const k=/нед/i.test(unit)?7:1; due=ymd(addDays(today(),(+n)*k)); return " ";
  });

  return { title:s.replace(/\s+/g," ").trim(), area, due, repeat, priority };
}

/* ===========================================================
   ITEM CRUD
   =========================================================== */
function addItem(data){
  const it=Object.assign({
    id:uid(), kind:"task", title:"", body:"", area:areaFilter||null,
    status:"inbox", due:null, repeat:"none", priority:0, tags:[],
    created:Date.now(), updated:Date.now(), done:false, x:null, y:null, pin:false, parent:null, deleted:false, deletedAt:null
  }, data);
  if(it.kind==="note" || it.kind==="flow"){ it.status="note"; }
  else if(it.due && it.status==="inbox"){ it.status="todo"; }
  if(it.kind==="flow") ensureFlow(it);
  S.items.unshift(it); persist(); return it;
}
function deleteItem(id){
  const it=S.items.find(i=>i.id===id);
  if(it){ it.deleted=true; it.deletedAt=Date.now(); touch(it); persist(); }
}
function hardDeleteItem(id){
  S.items=S.items.filter(i=>i.id!==id);
  S.links=S.links.filter(l=>l[0]!==id && l[1]!==id);
  S.items.forEach(i=>{ if(i.parent===id) i.parent=null; });          // снять висячие parent
  if(S.settings&&S.settings.collapsed) delete S.settings.collapsed[id]; // убрать мёртвый ключ свёрнутости
  persist();
}
function restoreItem(id){
  const it=S.items.find(i=>i.id===id);
  if(it){ it.deleted=false; it.deletedAt=null; touch(it); persist(); }
}
function toggleDone(it){
  if(it.kind!=="task") return;
  if(!it.done){
    it.done=true; it.status="done"; touch(it);
    if(it.repeat && it.repeat!=="none"){
      const nd=nextRepeat(it.due,it.repeat);   // nextRepeat сам берёт today() если due пуст
      addItem({kind:"task", title:it.title, body:it.body||"", area:it.area, due:nd, repeat:it.repeat, priority:it.priority, tags:it.tags.slice(), status:"todo"});
      toast("Повтор создан: "+(dueLabel(nd)?.txt||""));
    }
  } else { it.done=false; it.status=it.due?"todo":"inbox"; touch(it); }
  persist();
}
function linkExists(a,b){ return S.links.some(l=>(l[0]===a&&l[1]===b)||(l[0]===b&&l[1]===a)); }
function addLink(a,b){ if(a!==b && !linkExists(a,b)){ S.links.push([a,b]); persist(); return true; } return false; }
function removeLink(a,b){ S.links=S.links.filter(l=>!((l[0]===a&&l[1]===b)||(l[0]===b&&l[1]===a))); persist(); }
function linksOf(id){ return S.links.filter(l=>l[0]===id||l[1]===id).map(l=>l[0]===id?l[1]:l[0]); }
// элементы, живущие в паутине и в дереве заметок: все заметки + задачи, вышедшие из inbox
function inWeb(it){ return !it.deleted && (it.kind==="note" || it.status!=="inbox"); }
function childrenOf(id){ return S.items.filter(it=>it.parent===id); }
// свёрнутые узлы/области в списке (ключи: id узла или "area:"+id)
function isCollapsed(id){ const c=S.settings&&S.settings.collapsed; return !!(c&&c[id]); }
function toggleCollapse(id){ if(!S.settings.collapsed) S.settings.collapsed={}; if(S.settings.collapsed[id]) delete S.settings.collapsed[id]; else S.settings.collapsed[id]=true; persist(); }
function setParent(childId, parentId){
  const child=S.items.find(i=>i.id===childId);
  if(child){ child.parent=parentId; touch(child); persist(); }
}
function removeParent(childId){
  const child=S.items.find(i=>i.id===childId);
  if(child){ child.parent=null; touch(child); persist(); }
}
function noteParentChain(id){
  const chain=[]; let cur=id; const guard=new Set();
  while(cur && !guard.has(cur)){ guard.add(cur); chain.unshift(cur); const p=S.items.find(i=>i.id===cur); cur=p&&p.parent?p.parent:null; }
  return chain;
}
// Иерархия заметок ВЫВОДИТСЯ из графа: корень — область, направление — ОТ области наружу,
// независимо от того, в какую сторону тянули связь. Пишем результат в поле parent (кэш для списка/ридера/пружины графа).
function recomputeHierarchy(){
  // в иерархии участвуют заметки И задачи из паутины (вышедшие из inbox)
  const notes=S.items.filter(inWeb);
  const noteIds=new Set(notes.map(n=>n.id));
  const adj={};
  const addEdge=(x,y)=>{ (adj[x]||(adj[x]=new Set())).add(y); (adj[y]||(adj[y]=new Set())).add(x); };
  // ребро заметка↔область (членство)
  notes.forEach(n=>{ if(n.area) addEdge(n.id, "A:"+n.area); });
  // ручные связи между узлами паутины (заметки/задачи) и хабами-областями
  (S.links||[]).forEach(l=>{
    let a=l[0], b=l[1]; if(typeof a!=="string"||typeof b!=="string") return;
    const na=a.indexOf("hub_")===0?"A:"+a.slice(4):a;
    const nb=b.indexOf("hub_")===0?"A:"+b.slice(4):b;
    const ok=x=> x.indexOf("A:")===0 || noteIds.has(x);
    if(ok(na)&&ok(nb)) addEdge(na,nb);
  });
  // BFS одновременно от всех областей; предшественник = родитель в сторону области
  const dist={}, pred={}, q=[];
  S.areas.forEach(a=>{ const r="A:"+a.id; dist[r]=0; q.push(r); });
  for(let i=0;i<q.length;i++){ const cur=q[i]; const ns=adj[cur]; if(!ns) continue;
    ns.forEach(nb=>{ if(dist[nb]===undefined){ dist[nb]=dist[cur]+1; pred[nb]=cur; q.push(nb); } });
  }
  let changed=false;
  notes.forEach(n=>{
    const p=pred[n.id];
    // предшественник-область → верхний уровень (parent=null); предшественник-заметка → она родитель
    const np=(p && p.indexOf("A:")!==0) ? p : null;
    if((n.parent||null)!==(np||null)){ n.parent=np; changed=true; }
  });
  if(changed) persist();
}

/* ===========================================================
   RENDER
   =========================================================== */
const NAV=[
  ["today","ti-sun","Сегодня"],
  ["inbox","ti-inbox","Inbox"],
  ["tasks","ti-checklist","Задачи"],
  ["notes","ti-affiliate","Заметки"],
  ["cal","ti-calendar-month","Календарь"],
  ["board","ti-layout-kanban","Доска"],
  ["bin","ti-trash","Корзина"]
];

function counts(){
  let inbox=0, todayN=0, binN=0;
  S.items.forEach(it=>{
    if(it.deleted){ binN++; return; }
    if(it.status==="inbox") inbox++;
    if(it.kind==="task" && !it.done && it.due && parseYmd(it.due)<=today()) todayN++;
  });
  return {inbox, today:todayN, bin:binN};
}

function renderNav(){
  const c=counts();
  $("#nav").innerHTML = NAV.map(n=>{
    const badge = (n[0]==="inbox"&&c.inbox)?`<span class="badge">${c.inbox}</span>`
                : (n[0]==="today"&&c.today)?`<span class="badge">${c.today}</span>`
                : (n[0]==="bin"&&c.bin)?`<span class="badge">${c.bin}</span>`:"";
    return `<button class="navi ${view===n[0]?"on":""}" data-v="${n[0]}"><i class="ti ${n[1]}"></i>${n[2]}${badge}</button>`;
  }).join("");
  $("#areas").innerHTML = S.areas.map(a=>{
    const tasks=S.items.filter(it=>it.kind==="task"&&it.area===a.id&&!it.deleted);
    const n=tasks.filter(it=>!it.done&&it.status!=="note").length;
    const pct=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):null;
    const col=a.color?`style="color:${a.color}"`:"";
    return `<button class="areai ${areaFilter===a.id?"on":""}" data-area="${a.id}"><i class="ti ${a.icon}" ${col}></i>${esc(a.name)}<span class="cnt">${n||""}${pct!=null?" ("+pct+"%)":""}</span></button>`;
  }).join("");
}

function head(title, sub, actions){
  $("#main-title").textContent=title;
  $("#main-sub").innerHTML=sub||"";
  $("#head-actions").innerHTML=actions||"";
}

function taskCard(it, opts){
  opts=opts||{};
  const dl=dueLabel(it.due);
  const tags=(it.tags||[]).map(t=>`<span class="tag hash"><i class="ti ti-hash"></i>${esc(t)}</span>`).join("");
  return `<div class="card ${it.done?"done":""} pri-${it.priority||0}" data-id="${it.id}">
    <button class="chk ${it.done?"done":""}" data-chk="${it.id}"><i class="ti ti-check"></i></button>
    <div class="card-body">
      <div class="card-ttl">${esc(it.title)}</div>
      <div class="meta">
        ${it.area?`<span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
        ${it.repeat&&it.repeat!=="none"?`<span class="rep"><i class="ti ti-repeat"></i>${REPEAT[it.repeat]}</span>`:""}
        ${it.priority?`<span class="pri" style="color:${it.priority>=2?"var(--warn)":"var(--tx)"}"><i class="ti ti-flag-3"></i></span>`:""}
        ${tags}
      </div>
    </div>
    <div class="card-act">
      ${opts.today?`<button data-today="${it.id}" title="Перенести на сегодня"><i class="ti ti-target"></i></button>`:""}
      <button data-edit="${it.id}" title="Изменить"><i class="ti ti-pencil"></i></button>
      <button data-del="${it.id}" title="Удалить"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}
function emptyBox(icon,text){ return `<div class="empty"><i class="ti ${icon}"></i>${text}</div>`; }

function render(){
  renderNav();
  const v=$("#view");
  if(S.settings.view!==view){ S.settings.view=view; persist(); }   // не переписываем весь стейт при простой навигации
  v.classList.toggle("anim-in", _prevView!==view); _prevView=view; // плавный вход карточек только при смене вкладки
  // остановить анимацию графа, если уходим с вкладки «Заметки» (иначе rAF крутится на отсоединённых узлах)
  if(graph && view!=="notes"){ const g=graph; graph=null; g.destroy(); }
  if(view==="today") return renderToday(v);
  if(view==="inbox") return renderInbox(v);
  if(view==="tasks") return renderTasks(v);
  if(view==="notes") return renderNotes(v);
  if(view==="cal") return renderCal(v);
  if(view==="board") return renderBoard(v);
  if(view==="bin") return renderBin(v);
}

function renderToday(v){
  head("Сегодня", new Intl.DateTimeFormat("ru",{weekday:"long",day:"numeric",month:"long"}).format(new Date()),
    `<button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const T=today(), byPri=(a,b)=>(b.priority||0)-(a.priority||0), isT=it=>!it.deleted&&it.kind==="task";
  const over=S.items.filter(it=>isT(it)&&!it.done&&it.due&&parseYmd(it.due)<T).sort(byPri);
  const tod =S.items.filter(it=>isT(it)&&!it.done&&it.due&&ymd(parseYmd(it.due))===ymd(T)).sort(byPri);
  const todayAll=S.items.filter(it=>isT(it)&&it.due&&ymd(parseYmd(it.due))===ymd(T));   // запланировано на сегодня (done+undone)
  const doneT=todayAll.filter(it=>it.done).length, dayTotal=todayAll.length;
  const inb=S.items.filter(it=>!it.deleted&&it.status==="inbox").length;
  // умные «ближайшие»: ближайшие задачи с любым будущим сроком (не только 3 дня), до 6
  const upcoming=S.items.filter(it=>isT(it)&&!it.done&&it.due&&parseYmd(it.due)>T).sort((a,b)=>parseYmd(a.due)-parseYmd(b.due)).slice(0,6);
  const pct=dayTotal?Math.round(doneT/dayTotal*100):0;
  // шапка дня: прогресс-бар + пилюли (просрочено/инбокс)
  let h=`<div class="day-head">
    <div class="day-prog">
      <div class="day-prog-top"><span>${dayTotal?`Сделано ${doneT} из ${dayTotal} на сегодня`:"На сегодня ничего не запланировано"}</span>${dayTotal?`<span class="day-pct">${pct}%</span>`:""}</div>
      ${dayTotal?`<div class="day-bar"><div class="day-bar-fill" style="width:${pct}%"></div></div>`:""}
    </div>
    <div class="day-pills">
      ${over.length?`<span class="day-pill w"><i class="ti ti-alert-triangle"></i>${over.length} просрочено</span>`:""}
      ${inb?`<span class="day-pill" data-goto="inbox"><i class="ti ti-inbox"></i>${inb} в инбоксе</span>`:""}
    </div>
  </div>`;
  // области одним взглядом (клик → задачи области)
  if(S.areas.length){
    h+=`<div class="area-glance">`+S.areas.map(a=>{
      const tasks=S.items.filter(it=>isT(it)&&it.area===a.id);
      const open=tasks.filter(it=>!it.done).length;
      const p=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):0;
      const col=a.color?` style="color:${a.color}"`:"";
      return `<button class="area-card" data-area="${a.id}"><span class="ac-top"><i class="ti ${a.icon}"${col}></i><span class="ac-name">${esc(a.name)}</span></span><span class="ac-meta">${open} откр${tasks.length?` · ${p}%`:""}</span></button>`;
    }).join("")+`</div>`;
  }
  // повестка дня
  if(over.length) h+=`<div class="sec w"><i class="ti ti-alert-triangle"></i>Просрочено</div>`+over.map(it=>taskCard(it,{today:true})).join("");
  h+=`<div class="sec"><i class="ti ti-target"></i>На сегодня</div>`+(tod.length?tod.map(taskCard).join(""):emptyBox("ti-checks","На сегодня дел нет. Можно выдохнуть. Или нажми <b>N</b> — добавить задачу."));
  if(upcoming.length) h+=`<div class="sec"><i class="ti ti-calendar-event"></i>Ближайшие</div>`+upcoming.map(taskCard).join("");
  v.innerHTML=h;
}
function renderInbox(v){
  head("Inbox","Свалка мыслей — раскидай по областям, когда удобно",
    `<button class="btn" data-new="task"><i class="ti ti-plus"></i>Добавить</button>`);
  const arr=S.items.filter(it=>!it.deleted&&it.status==="inbox");
  v.innerHTML = arr.length?arr.map(taskCard).join(""):emptyBox("ti-inbox","Пусто. Брось мысль в поле сверху ↑ или нажми <b>/</b>");
}
function renderTasks(v){
  recomputeHierarchy();   // свежая иерархия из графа — подтягиваем её в задачи
  const f=areaFilter, T=today();
  const FILT={ all:()=>true, today:it=>it.due&&parseYmd(it.due)<=T, week:it=>it.due&&daysBetween(parseYmd(it.due),T)<=7, nodue:it=>!it.due };
  const isTask=it=>!it.deleted&&it.kind==="task"&&it.status!=="inbox";
  const doneCount=S.items.filter(it=>isTask(it)&&it.done).length;
  const filt=FILT[taskFilter]||FILT.all;
  // видимые задачи: фильтр срока + (done только при showDone)
  const visTasks=S.items.filter(it=>isTask(it) && (showDone||!it.done) && filt(it));
  // дерево из паутины (заметки+задачи), parent из графа; оставляем только задачи + их предков-структуру
  const nodes=S.items.filter(inWeb);
  const ids=new Set(nodes.map(n=>n.id));
  const hasParent=it=> it.parent && ids.has(it.parent);
  const keep=new Set();
  visTasks.forEach(t=> noteParentChain(t.id).forEach(id=>keep.add(id)) );
  head(f?areaName(f):"Задачи", f?"Фильтр по области · нажми ещё раз чтобы снять":"Иерархия из заметок · клик — открыть, чекбокс — выполнить",
    `${doneCount?`<button class="btn ghost" data-toggle="done"><i class="ti ${showDone?"ti-eye-off":"ti-checks"}"></i>Выполнено ${doneCount}</button>`:""}
     <button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const chips=`<div class="tf-chips">`+
    [["all","Все"],["today","Сегодня"],["week","Неделя"],["nodue","Без срока"]]
      .map(([k,l])=>`<button class="tf-chip ${taskFilter===k?"on":""}" data-tf="${k}">${l}</button>`).join("")+
  `</div>`;
  const kidsKept=id=>childrenOf(id).filter(k=>inWeb(k)&&keep.has(k.id)).sort((a,b)=>(a.updated||0)-(b.updated||0));
  const seen=new Set();
  function branch(it, depth){
    if(seen.has(it.id)) return ""; seen.add(it.id);
    const kk=kidsKept(it.id);
    // заметки → компактный контекст-заголовок (true), задачи → полная карточка с чекбоксом
    let hh=noteCard(it, depth, kk.length>0, true);
    if(isCollapsed(it.id) || !kk.length) return hh;
    return hh+`<div class="tree-branch">`+kk.map(k=>branch(k,depth+1)).join("")+`</div>`;
  }
  const group=roots=>`<div class="notes-tree">`+roots.sort((a,b)=>(b.updated||0)-(a.updated||0)).map(r=>branch(r,0)).join("")+`</div>`;
  const sec=(key,icon,name,count,colorStyle)=>{ const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`; };
  let body="";
  S.areas.forEach(a=>{
    if(f && a.id!==f) return;
    const roots=nodes.filter(it=>keep.has(it.id)&&!hasParent(it)&&it.area===a.id);
    if(!roots.length) return;
    const key="area:"+a.id;
    body+=sec(key, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed(key)) body+=group(roots);
  });
  if(!f){
    const noArea=nodes.filter(it=>keep.has(it.id)&&!hasParent(it)&&!it.area);
    if(noArea.length){ body+=sec("area:__none","ti-circle-dashed","Без области",noArea.length,""); if(!isCollapsed("area:__none")) body+=group(noArea); }
  }
  if(!body) body=emptyBox("ti-checklist", taskFilter==="all"?"Нет активных задач. Добавь первую — поле сверху или <b>N</b>":"По этому фильтру задач нет.");
  v.innerHTML=chips+body;
  // обработчики дерева (как в списке заметок)
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс — делегат #view
    if(e.target.closest("[data-collapse]")) return;  // каретка
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(it) openItemSmart(it);
  });
}
function renderCal(v){
  const base=new Date(); base.setDate(1); base.setMonth(base.getMonth()+calOffset);
  head("Календарь", new Intl.DateTimeFormat("ru",{month:"long",year:"numeric"}).format(base),
    `<div class="cal-nav">
       <button data-cal="-1" title="Предыдущий"><i class="ti ti-chevron-left"></i></button>
       <button class="btn ghost" data-cal="0" style="height:30px">Сегодня</button>
       <button data-cal="1" title="Следующий"><i class="ti ti-chevron-right"></i></button>
     </div>`);
  const y=base.getFullYear(), m=base.getMonth();
  const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  let cells=["пн","вт","ср","чт","пт","сб","вс"].map(d=>`<div class="cal-wd">${d}</div>`).join("");
  for(let i=0;i<start;i++) cells+=`<div class="cd dim"></div>`;
  const todayStr=ymd(today());
  for(let d=1;d<=days;d++){
    const ds=ymd(new Date(y,m,d));
    const ev=S.items.filter(it=>!it.deleted&&it.due===ds && it.kind==="task");
    cells+=`<div class="cd ${ds===todayStr?"tod":""}"><div class="cd-n">${d}</div>`+
      ev.map(it=>{ const over=parseYmd(ds)<today()&&!it.done; return `<div class="ev ${it.done?"done":""} ${over?"over":""}" data-edit="${it.id}" title="${esc(it.title)}">${esc(it.title)}</div>`; }).join("")+`</div>`;
  }
  v.innerHTML=`<div class="cal">${cells}</div>`;
}
const BOARD_KEYS=["inbox","todo","doing","done"];
function renderBoard(v){
  head("Доска","Перетаскивай карточки между колонками · двойной клик по заголовку = переименовать",
    `<button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  v.innerHTML=`<div class="kb">`+BOARD_KEYS.map(k=>{
    const arr=S.items.filter(it=>!it.deleted&&it.kind==="task"&&it.status===k);
    return `<div class="col" data-col="${k}"><div class="col-h"><span class="col-name" data-bk="${k}">${esc(boardLabel(k))}</span><span>${arr.length}</span></div>`+
      arr.map(it=>`<div class="kbc" draggable="true" data-id="${it.id}">
        <div class="kbc-area"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</div>${esc(it.title)}</div>`).join("")+`</div>`;
  }).join("")+`</div>`;
  wireBoard();
  $$(".col-name").forEach(sp=>sp.ondblclick=()=>{
    const k=sp.dataset.bk;
    const inp=document.createElement("input"); inp.value=boardLabel(k); inp.dataset.bk=k;
    sp.replaceWith(inp); inp.focus(); inp.select();
    const commit=()=>{ if(!S.settings.boardLabels) S.settings.boardLabels={}; S.settings.boardLabels[k]=inp.value.trim()||boardLabel(k); persist(); render(); };
    inp.onblur=commit; inp.onkeydown=e=>{ if(e.key==="Enter") commit(); if(e.key==="Escape") render(); };
  });
}
function wireBoard(){
  let dragId=null;
  $$(".kbc").forEach(c=>{
    c.addEventListener("dragstart",e=>{ dragId=c.dataset.id; c.classList.add("dragging"); e.dataTransfer.effectAllowed="move"; });
    c.addEventListener("dragend",()=>c.classList.remove("dragging"));
  });
  $$(".col").forEach(col=>{
    col.addEventListener("dragover",e=>{ e.preventDefault(); col.classList.add("drag"); });
    col.addEventListener("dragleave",()=>col.classList.remove("drag"));
    col.addEventListener("drop",e=>{ e.preventDefault(); col.classList.remove("drag");
      const it=S.items.find(x=>x.id===dragId); if(!it) return;
      const target=col.dataset.col;
      // в «Готово» — через toggleDone (повтор + done-логика как у чекбокса); иначе просто переносим
      if(target==="done" && !it.done){ toggleDone(it); render(); }
      else { it.status=target; it.done=false; touch(it); persist(); render(); }
    });
  });
}

function renderBin(v){
  head("Корзина","Удалённые элементы · можно восстановить или стереть навсегда",
    `<button class="btn ghost" data-toggle="clear"><i class="ti ti-trash"></i>Очистить всё</button>`);
  const arr=S.items.filter(it=>it.deleted).sort((a,b)=>(b.deletedAt||0)-(a.deletedAt||0));
  if(!arr.length){ v.innerHTML=emptyBox("ti-trash","Корзина пуста. Удалённые элементы появятся здесь."); return; }
  v.innerHTML=arr.map(it=>`<div class="card" data-id="${it.id}">
    <div class="card-body" style="flex:1">
      <div class="card-ttl">${esc(it.title)}</div>
      <div class="meta">
        ${it.area?`<span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        <span class="due"><i class="ti ti-calendar-event"></i>удалено ${it.deletedAt?new Date(it.deletedAt).toLocaleDateString("ru"):""}</span>
      </div>
    </div>
    <div class="card-act" style="opacity:1;display:flex;gap:4px;">
      <button data-restore="${it.id}" title="Восстановить"><i class="ti ti-arrow-back-up"></i></button>
      <button data-hard="${it.id}" title="Удалить навсегда" style="color:var(--warn)"><i class="ti ti-trash"></i></button>
    </div>
  </div>`).join("");
  $$("[data-restore]",v).forEach(b=>b.onclick=()=>{ restoreItem(b.dataset.restore); render(); toast("Восстановлено"); });
  $$("[data-hard]",v).forEach(b=>b.onclick=()=>{ if(confirm("Удалить навсегда? Это нельзя отменить.")){ hardDeleteItem(b.dataset.hard); render(); toast("Удалено навсегда"); } });
  // «Очистить всё» обрабатывает делегат #head-actions (data-toggle="clear") — без дубля здесь (был двойной confirm)
}

/* ===========================================================
   NOTES GRAPH
   =========================================================== */
let graph=null;
/* фон паутины «Точечное поле» (canvas): точки рисует Graph._drawBg() каждый кадр,
   привязано к настоящему пану/зуму (this.tx/ty/zoom), бесшовно по мировому индексу тайла. */
function renderNotes(v){
  recomputeHierarchy();   // иерархия всегда выводится от области (чинит и старые данные)
  head("Заметки", notesMode==="graph"?"Граф связей · тяни узлы · двойной клик = закрепить":"Все заметки карточками",
    `<div class="toggle" id="notes-toggle">
       <button data-nm="graph" class="${notesMode==="graph"?"on":""}"><i class="ti ti-affiliate"></i>Граф</button>
       <button data-nm="list" class="${notesMode==="list"?"on":""}"><i class="ti ti-layout-grid"></i>Список</button>
     </div>
     <button class="btn" data-new="note" style="margin-left:8px"><i class="ti ti-note"></i>Заметка</button>
     <button class="btn" data-new="flow"><i class="ti ti-sitemap"></i>Схема</button>`);
  if(notesMode==="list"){ if(graph){ const g=graph; graph=null; g.destroy(); } return renderNotesList(v); }
  v.innerHTML=`<div id="graph-wrap" style="height:calc(100vh - 210px);min-height:420px;">
    <canvas class="graph-bg-canvas"></canvas>
    <svg id="graph" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="graph-toolbar">
      <button class="btn ghost" id="g-zoom-out" title="Уменьшить"><i class="ti ti-zoom-out"></i></button>
      <button class="btn ghost" id="g-zoom-in" title="Увеличить"><i class="ti ti-zoom-in"></i></button>
      <button class="btn ghost" id="g-focus" title="Показать все ноды"><i class="ti ti-focus-2"></i></button>
      <button class="btn ghost" id="g-refit" title="Перераскладка"><i class="ti ti-arrows-shuffle"></i></button>
    </div>
    <div class="graph-legend">
      <span><span class="lg-dot hub"></span>область</span>
      <span><span class="lg-dot note"></span>заметка</span>
      <span><span class="lg-dot task"></span>задача</span>
    </div>
    <div class="graph-hint" id="g-hint">ПКМ — меню · двойной клик — открыть · клик по связи — убрать</div>
  </div>`;
  if(graph){ const g=graph; graph=null; g.destroy(); }
  graph=new Graph($("#graph"));
  graph.build();
  $("#g-refit").onclick=()=>graph.refit();
  $("#g-focus").onclick=()=>graph._fitView();
  $("#g-zoom-in").onclick=()=>{ if(graph._vraf){cancelAnimationFrame(graph._vraf);graph._vraf=null;} graph.zoom=Math.min(2.5,graph.zoom*1.25); graph._applyTransform(); };
  $("#g-zoom-out").onclick=()=>{ if(graph._vraf){cancelAnimationFrame(graph._vraf);graph._vraf=null;} graph.zoom=Math.max(0.4,graph.zoom/1.25); graph._applyTransform(); };
  wireNotesToggle();
}
// каретка-сворачиватель для узла, у которого есть дочерние (в наборе паутины)
function caretHTML(it, hasKids){
  // hasKids задан явно (для деревьев с обрезкой) — иначе считаем по всем web-детям
  const has = hasKids!==undefined ? hasKids : childrenOf(it.id).some(k=>inWeb(k));
  if(!has) return "";
  const col=isCollapsed(it.id);
  return `<button class="nc-caret" data-collapse="${it.id}" title="${col?'Развернуть':'Свернуть'}"><i class="ti ${col?'ti-chevron-right':'ti-chevron-down'}"></i></button>`;
}
function noteCard(it, depth=0, hasKids, compact){
  if(it.kind==="task") return treeTaskCard(it, depth, hasKids);
  const c=itemColor(it);
  const isChild = depth > 0;
  const border = isChild?'':'border-left-color:'+(c||'var(--acc)')+';';
  const kicn = it.kind==="flow"?"ti-sitemap":"ti-note";
  const showIcn = compact || it.kind==="flow";   // схему всегда помечаем иконкой, чтобы отличать от заметок
  const head=`<div class="nc-head">${caretHTML(it, hasKids)}${showIcn?`<i class="ti ${kicn} nc-icn"></i>`:''}<div class="nc-ttl">${esc(it.title)}</div></div>`;
  // compact: заметка как контекст-заголовок в дереве задач (без тела/футера)
  if(compact) return `<div class="note-card ctx ${isChild?'child':'root'}" data-nid="${it.id}" style="${border}">${head}</div>`;
  const conn=linksOf(it.id);
  const kids=childrenOf(it.id);
  return `<div class="note-card ${isChild?'child':'root'}" data-nid="${it.id}" style="${border}">
    ${head}
    <div class="nc-body">${esc(it.body||"")}</div>
    <div class="nc-foot">
      ${conn.length?`<span class="tag"><i class="ti ti-link"></i>${conn.length}</span>`:""}
      ${kids.length?`<span class="tag"><i class="ti ti-sitemap"></i>${kids.length}</span>`:""}
      ${(it.tags||[]).map(t=>`<span class="tag hash"><i class="ti ti-hash"></i>${esc(t)}</span>`).join("")}
    </div>
  </div>`;
}
// карточка задачи в дереве: чекбокс «выполнить» + компактные мета, чтобы не перегружать
function treeTaskCard(it, depth=0, hasKids){
  const conn=linksOf(it.id);
  const kids=childrenOf(it.id);
  const c=itemColor(it);
  const isChild = depth > 0;
  const dl=dueLabel(it.due);
  return `<div class="note-card task ${isChild?'child':'root'} ${it.done?'done':''}" data-tid="${it.id}" style="${isChild?'':'border-left-color:'+(c||'var(--acc)')+';'}">
    <div class="nc-head">
      ${caretHTML(it, hasKids)}
      <button class="chk ${it.done?'done':''}" data-chk="${it.id}" title="Выполнить"><i class="ti ti-check"></i></button>
      <div class="nc-ttl">${esc(it.title)}</div>
    </div>
    <div class="nc-foot">
      <span class="tag"><i class="ti ti-checklist"></i>задача</span>
      ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
      ${it.priority?`<span class="pri" style="color:${it.priority>=2?"var(--warn)":"var(--mut)"}"><i class="ti ti-flag-3"></i></span>`:""}
      ${conn.length?`<span class="tag"><i class="ti ti-link"></i>${conn.length}</span>`:""}
      ${kids.length?`<span class="tag"><i class="ti ti-sitemap"></i>${kids.length}</span>`:""}
    </div>
  </div>`;
}
function renderNotesList(v){
  const nodes=S.items.filter(inWeb);   // заметки + задачи из паутины
  if(!nodes.length){ v.innerHTML=emptyBox("ti-note","Пусто. Создай заметку (кнопка сверху или <b>N</b>) или задачу."); wireNotesToggle(); return; }
  const ids=new Set(nodes.map(n=>n.id));
  const hasParent=it=> it.parent && ids.has(it.parent);  // валидный родитель внутри набора
  const seen=new Set();                                   // защита от дублей и циклов в иерархии
  // рекурсивно: карточка + ВСЕ её потомки (заметки и задачи, вне зависимости от области)
  function branch(it, depth){
    if(seen.has(it.id)) return "";
    seen.add(it.id);
    let h=noteCard(it, depth);
    if(isCollapsed(it.id)) return h;   // свёрнут — детей не показываем
    const kids=childrenOf(it.id)
      .filter(k=>inWeb(k))
      .sort((a,b)=>(a.updated||0)-(b.updated||0));
    if(kids.length) h+=`<div class="tree-branch">`+kids.map(k=>branch(k, depth+1)).join("")+`</div>`;
    return h;
  }
  function group(roots){ return `<div class="notes-tree">`+roots.sort((a,b)=>(b.updated||0)-(a.updated||0)).map(r=>branch(r,0)).join("")+`</div>`; }
  function sec(key, icon, name, count, colorStyle){
    const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`;
  }
  let h="";
  // корни (без родителя) группируем по области корня; потомки вкладываются под корнем независимо от их области
  S.areas.forEach(a=>{
    const roots=nodes.filter(it=>it.area===a.id && !hasParent(it));
    if(!roots.length) return;
    const key="area:"+a.id;
    h+=sec(key, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed(key)) h+=group(roots);
  });
  const noArea=nodes.filter(it=>!it.area && !hasParent(it));
  if(noArea.length){
    h+=sec("area:__none", "ti-circle-dashed", "Без области", noArea.length, "");
    if(!isCollapsed("area:__none")) h+=group(noArea);
  }
  v.innerHTML=h;
  // свернуть/развернуть область или поддерево
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс обрабатывает делегат #view (toggleDone)
    if(e.target.closest("[data-collapse]")) return;  // каретка сворачивания
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(!it) return;
    openItemSmart(it);
  });
  wireNotesToggle();
}
function wireNotesToggle(){
  $$("#notes-toggle button").forEach(b=>b.onclick=()=>{ notesMode=b.dataset.nm; render(); });
}

class Graph{
  constructor(svg){
    this.svg=svg; this.W=svg.clientWidth||900; this.H=svg.clientHeight||500;
    this.nodes=[]; this.links=[]; this.byId={};
    this._lcId=null; this._lcT=0;
    this.alpha=1; this.drag=null; this.linkFrom=null; this.sel=null;
    this.zoom=1; this.tx=0; this.ty=0; this.panning=null;
    this.raf=null;
  }
  build(){
    const NS="http://www.w3.org/2000/svg";
    // отменяем прошлый цикл анимации, иначе каждый build() плодит новый rAF-цикл → лаги
    if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
    this.W=this.svg.clientWidth||900; this.H=this.svg.clientHeight||500;
    this.svg.setAttribute("viewBox",`0 0 ${this.W} ${this.H}`);
    // фон-canvas «точечное поле» за графом, привязан к пану/зуму
    this.bgCanvas=this.svg.parentNode?this.svg.parentNode.querySelector(".graph-bg-canvas"):null;
    this.bgCtx=this.bgCanvas?this.bgCanvas.getContext("2d"):null;
    this._bgReduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const cx=this.W/2, cy=this.H/2;
    // сохраняем текущие позиции узлов, чтобы при перестроении (смена цвета/связи) граф не «прыгал»
    const prev=this.byId||{};
    this.nodes=[]; this.links=[]; this.byId={};
    // area hubs (можно закреплять и таскать, позиция/пин хранятся на самой области)
    S.areas.forEach((a,i)=>{
      const ang=(i/S.areas.length)*Math.PI*2;
      const p=prev["hub_"+a.id];
      const x = a.x!=null?a.x : (p?p.x:cx+Math.cos(ang)*90);
      const y = a.y!=null?a.y : (p?p.y:cy+Math.sin(ang)*90);
      this.nodes.push({id:"hub_"+a.id, hubArea:a, label:a.name, type:"hub", r:11, fixed:!!a.pin, color:areaColor(a.id),
        x, y, vx:0, vy:0, _fresh:(a.x==null && !p)});
    });
    // items on the graph: all notes + tasks that left the inbox
    const onGraph=S.items.filter(it=> !it.deleted && (it.kind==="note" || it.status!=="inbox"));
    onGraph.forEach(it=>{
      const p=prev[it.id];
      const x = it.x!=null?it.x : (p?p.x:cx+(Math.random()-.5)*300);
      const y = it.y!=null?it.y : (p?p.y:cy+(Math.random()-.5)*220);
      const n={id:it.id, ref:it, label:it.title, type:it.kind, done:it.done, area:it.area, color:itemColor(it),
        r:7, x, y, vx:0, vy:0, fixed:!!it.pin, _fresh:(it.x==null && !p)};
      this.nodes.push(n);
    });
    this.nodes.forEach(n=>this.byId[n.id]=n);

    // manual links first, remember pairs to dedupe auto area-links
    const pairs=new Set();
    S.links.forEach(l=>{ if(this.byId[l[0]]&&this.byId[l[1]]){ this.links.push({a:l[0],b:l[1],L:108,manual:true}); pairs.add(l[0]+"|"+l[1]); pairs.add(l[1]+"|"+l[0]); } });
    onGraph.forEach(it=>{ const hub="hub_"+it.area; if(it.area && this.byId[hub] && !pairs.has(it.id+"|"+hub)) this.links.push({a:it.id,b:hub,L:78,manual:false}); });

    this.adj={}; this.nodes.forEach(n=>this.adj[n.id]=new Set());
    this.links.forEach(l=>{ this.adj[l.a].add(l.b); this.adj[l.b].add(l.a); });
    // размер узла по «популярности» (числу связей) — как в Obsidian: чем больше связей, тем крупнее
    this.nodes.forEach(n=>{
      const deg=this.adj[n.id].size;
      if(n.type==="hub"){ n.r=Math.min(11+deg*0.7, 22); }
      else { n.r=Math.min(6+Math.sqrt(deg)*3, 15); }
    });

    while(this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.root=document.createElementNS(NS,"g"); this.svg.appendChild(this.root);
    this.defs=document.createElementNS(NS,"defs"); this.root.appendChild(this.defs);
    this.linkG=document.createElementNS(NS,"g"); this.root.appendChild(this.linkG);
    this.nodeG=document.createElementNS(NS,"g"); this.root.appendChild(this.nodeG);
    this.tempLine=document.createElementNS(NS,"line"); this.tempLine.setAttribute("class","g-link temp"); this.tempLine.style.display="none"; this.linkG.appendChild(this.tempLine);

    // на каждую связь: прозрачная широкая линия-хитбокс + видимая линия сразу после неё
    // (порядок hit→link важен для селектора .g-hit:hover + .g-link; клики ловит только хитбокс)
    this.hitEls=[]; this.linkEls=[];
    this.links.forEach((l,i)=>{
      const hit=document.createElementNS(NS,"line"); hit.setAttribute("class","g-hit"); hit.dataset.li=i;
      this.linkG.appendChild(hit); this.hitEls.push(hit);
      const e=document.createElementNS(NS,"line"); e.setAttribute("class","g-link"+(l.manual?" manual":"")); e.dataset.li=i;
      const ca=this.byId[l.a].color, cb=this.byId[l.b].color;
      if(ca||cb){
        // хотя бы у одного есть явный цвет → цвет «перетекает»: второй конец = его цвет или нейтральный (белый)
        const NC=NEUTRAL(); const ea=ca||NC, eb=cb||NC;
        // inline style: presentation attrs lose to the stylesheet's .g-link rule
        if(ea!==eb){
          const gid="grad"+i; const grad=document.createElementNS(NS,"linearGradient");
          grad.setAttribute("id",gid); grad.setAttribute("gradientUnits","userSpaceOnUse");
          const s1=document.createElementNS(NS,"stop"); s1.setAttribute("offset","0%"); s1.setAttribute("stop-color",ea);
          const s2=document.createElementNS(NS,"stop"); s2.setAttribute("offset","100%"); s2.setAttribute("stop-color",eb);
          grad.appendChild(s1); grad.appendChild(s2); this.defs.appendChild(grad);
          e.style.stroke="url(#"+gid+")"; l._grad=grad;
        } else { e.style.stroke = ea; }
        e.style.strokeWidth = (l.manual?1.8:1.3); e.style.opacity = l.manual?0.95:0.55;
      }
      this.linkG.appendChild(e); this.linkEls.push(e);
    });

    this.nodeEls=this.nodes.map(n=>{
      const g=document.createElementNS(NS,"g"); g.setAttribute("class","g-node "+n.type+(n.done?" done":"")); g.dataset.id=n.id;
      let halo=null;
      if(n.type==="hub"){ halo=document.createElementNS(NS,"circle"); halo.setAttribute("class","g-halo"); halo.setAttribute("r",n.r+5); if(n.color)halo.style.stroke=n.color; g.appendChild(halo); }
      const shape = n.type==="task" ? this._rect(NS,n.r) : n.type==="flow" ? this._rrect(NS,n.r) : this._circle(NS,n.r);
      if(n.color){
        // inline style: presentation attrs lose to the stylesheet's .nd rules
        if(n.type==="hub"){ shape.style.fill=n.color; shape.style.stroke=n.color; }
        else if(n.type==="note"||n.type==="flow"){ shape.style.stroke=n.color; }
        else { shape.style.stroke=n.color; if(n.done) shape.style.fill=n.color; }
      }
      g.appendChild(shape);
      let check=null;
      if(n.type==="task" && n.done){ check=document.createElementNS(NS,"path"); check.setAttribute("class","g-check"); g.appendChild(check); }
      const pin=document.createElementNS(NS,"circle"); pin.setAttribute("class","g-pin"); pin.setAttribute("r",n.r+8); pin.style.display=n.fixed?"":"none";
      g.appendChild(pin);
      const t=document.createElementNS(NS,"text"); t.setAttribute("class","g-label"+(n.type==="hub"?" hub":"")); t.setAttribute("text-anchor","middle");
      t.textContent=n.label.length>22?n.label.slice(0,21)+"…":n.label;
      g.appendChild(t);
      this.nodeG.appendChild(g);
      return {g, shape, halo, check, pin, t, n};
    });
    this._wire();
    // первичная раскладка — полный «разогрев»; перестроение (цвет/связь) — лёгкое, чтобы граф не прыгал
    // плавный старт: позиции уже сохранены → не дёргаем (alpha 0); новые узлы мягко вписываются (0.12);
    // совсем новый граф — умеренный разогрев (0.4). Скорость клампится в _tick (плавный глайд без рывков),
    // а осевшая раскладка сохраняется (см. _moved) → следующее открытие статично, без повторного «взрыва».
    const freshN=this.nodes.filter(n=>n._fresh).length, placedN=this.nodes.length-freshN;
    this.alpha = placedN>0 ? (freshN>0 ? 0.12 : 0) : (this.nodes.length>1 ? 0.4 : 0);
    this._tick();
  }
  _circle(NS,r){ const c=document.createElementNS(NS,"circle"); c.setAttribute("class","nd"); c.setAttribute("r",r); return c; }
  _rect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",2.5); return s; }
  _rrect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",r*0.55); return s; }   // нода-схема: скруглённый квадрат

  _pt(e){
    // точное преобразование экранных координат в координаты графа через матрицу самого SVG
    // (учитывает viewBox, preserveAspectRatio, зум и пан) — иначе курсор «не совпадает» с точкой
    const m=this.root.getScreenCTM();
    if(m){ const pt=this.svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY; const p=pt.matrixTransform(m.inverse()); return {x:p.x, y:p.y}; }
    const rc=this.svg.getBoundingClientRect();
    const x=(e.clientX-rc.left)/rc.width*this.W, y=(e.clientY-rc.top)/rc.height*this.H;
    return { x:(x-this.tx)/this.zoom, y:(y-this.ty)/this.zoom };
  }
  _wire(){
    const svg=this.svg;
    svg.onpointerdown=(e)=>{
      if(e.button!==0) return;   // только ЛКМ тянет/панорамирует; ПКМ обрабатывает oncontextmenu
      if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; }   // прервать переезд камеры при ручном действии
      const g=e.target.closest(".g-node");
      if(g){
        const n=this.byId[g.dataset.id];
        if(this.linkFrom){ this._finishLink(n); return; }
        // НЕ будим симуляцию на простой клик — иначе вся паутина дёргается; alpha поднимаем только при реальном перетаскивании
        this.drag=n; n._moved=false; svg.setPointerCapture(e.pointerId);
        return;
      }
      const lk=e.target.closest(".g-hit");
      if(lk && !this.linkFrom){ this._openLinkPop(this.links[+lk.dataset.li], e); return; }
      this.panning={x:e.clientX,y:e.clientY,tx:this.tx,ty:this.ty}; svg.setPointerCapture(e.pointerId);
      this._closePop();
    };
    svg.onpointermove=(e)=>{
      if(this.drag){ const p=this._pt(e); this.drag.x=p.x; this.drag.y=p.y; this.drag.vx=0; this.drag.vy=0; this.drag._moved=true; this.alpha=Math.max(this.alpha,.4); return; }
      if(this.panning){ const rc=svg.getBoundingClientRect(); this.tx=this.panning.tx+(e.clientX-this.panning.x)/rc.width*this.W; this.ty=this.panning.ty+(e.clientY-this.panning.y)/rc.height*this.H; this._applyTransform(); return; }
      if(this.linkFrom){ const p=this._pt(e); const f=this.byId[this.linkFrom]; this.tempLine.style.display=""; this.tempLine.setAttribute("x1",f.x); this.tempLine.setAttribute("y1",f.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y); return; }
      const g=e.target.closest(".g-node"); this._hover(g?g.dataset.id:null);
    };
    svg.onpointerup=(e)=>{
      if(this.drag){
        const n=this.drag;
        if(n.ref){ n.ref.x=n.x; n.ref.y=n.y; persist(); }
        else if(n.hubArea){ n.hubArea.x=n.x; n.hubArea.y=n.y; persist(); }   // позиция области
        if(!n._moved){
          // ручное определение двойного клика (надёжнее нативного dblclick при pointer capture)
          const now=Date.now();
          if(this._lcId===n.id && (now-this._lcT)<350){ this._lcId=null; this._lcT=0; this._openNode(n); }
          else { this._lcId=n.id; this._lcT=now; }
        }
        this.drag=null;
      }
      this.panning=null;
    };
    // ПКМ — меню настроек узла
    svg.oncontextmenu=(e)=>{
      e.preventDefault();
      if(this.linkFrom){ this.cancelLink(); return; }
      const g=e.target.closest(".g-node");
      if(g){ this._openPop(this.byId[g.dataset.id], e); return; }
      const lk=e.target.closest(".g-hit");
      if(lk){ this._openLinkPop(this.links[+lk.dataset.li], e); return; }
      this._closePop();
    };
    svg.onwheel=(e)=>{ e.preventDefault(); if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; } const rc=svg.getBoundingClientRect();
      const mx=(e.clientX-rc.left)/rc.width*this.W, my=(e.clientY-rc.top)/rc.height*this.H;
      const f=e.deltaY<0?1.12:0.89; const nz=Math.max(.4,Math.min(2.5,this.zoom*f));
      this.tx=mx-(mx-this.tx)*(nz/this.zoom); this.ty=my-(my-this.ty)*(nz/this.zoom); this.zoom=nz; this._applyTransform();
    };
  }
  _applyTransform(){
    this.root.setAttribute("transform",`translate(${this.tx},${this.ty}) scale(${this.zoom})`);
    // подписи гаснут при отдалении (как в Obsidian): крупные/«популярные» узлы держат подпись дольше
    const z=this.zoom;
    if(this.nodeEls){
      this.nodeEls.forEach(o=>{
        const big=o.n.r>=12;               // хаб или узел с многими связями
        const a=big?0.5:0.85, b=big?0.75:1.05;   // окно зума, в котором подпись проявляется
        o.t.style.opacity=Math.max(0,Math.min(1,(z-a)/(b-a)));
      });
    }
  }
  // фон «точечное поле»: точки на canvas, привязка пана/зума к this.tx/ty/zoom; бесшовно по мировому индексу тайла
  _drawBg(){
    const cv=this.bgCanvas, ctx=this.bgCtx; if(!cv||!ctx) return;
    const cw=cv.clientWidth, ch=cv.clientHeight; if(!cw||!ch) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){ cv.width=Math.round(cw*dpr); cv.height=Math.round(ch*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const w=cw, h=ch;
    ctx.clearRect(0,0,w,h);   // базу даёт var(--surf) на #graph-wrap → тема подхватывается сама
    const light=document.body.classList.contains("light");
    const dot=light?"0,0,0":"255,255,255";
    const ts=this._bgReduce?0:performance.now()*0.001;
    const z=this.zoom, panX=-this.tx, panY=-this.ty;
    const hash=(a,b)=>{ let n=(a*374761393+b*668265263)|0; n=(n^(n>>>13))*1274126177|0; return ((n>>>0)%100000)/100000; };
    // спрайт-«звезда»: радиальный градиент (яркий центр → мягкое затухание к краям).
    // строится один раз и кэшируется; пересобирается при смене темы (цвет точки меняется).
    if(!this._star || this._starLight!==light){
      const SS=64, sc=document.createElement("canvas"); sc.width=SS; sc.height=SS;
      const sg=sc.getContext("2d");
      const grd=sg.createRadialGradient(SS/2,SS/2,0,SS/2,SS/2,SS/2);
      grd.addColorStop(0,   "rgba("+dot+",1)");
      grd.addColorStop(0.16,"rgba("+dot+",0.82)");
      grd.addColorStop(0.45,"rgba("+dot+",0.20)");
      grd.addColorStop(1,   "rgba("+dot+",0)");
      sg.fillStyle=grd; sg.fillRect(0,0,SS,SS);
      this._star=sc; this._starLight=light;
    }
    const star=this._star;
    // 5 слоёв глубины: par=параллакс, sp=шаг, sz=полуразмер спрайта, a=яркость(низкая), zs=зум-эксп, wob=амплитуда собств. дрейфа
    const layers=[
      {par:0.06, sp:36,  sz:1.4, a:light?0.040:0.028, zs:0.40, wob:4 },
      {par:0.20, sp:50,  sz:2.0, a:light?0.060:0.045, zs:0.58, wob:7 },
      {par:0.42, sp:68,  sz:2.9, a:light?0.085:0.070, zs:0.78, wob:11},
      {par:0.68, sp:90,  sz:3.9, a:light?0.120:0.100, zs:0.95, wob:15},
      {par:1.00, sp:118, sz:5.4, a:light?0.175:0.150, zs:1.12, wob:20}
    ];
    for(let li=0;li<layers.length;li++){
      const L=layers[li], zl=Math.pow(z,L.zs), tile=L.sp*zl; if(tile<5) continue;
      const totX=panX*L.par, totY=panY*L.par;
      const offX=((totX)%tile+tile)%tile, offY=((totY)%tile+tile)%tile;
      const baseX=Math.floor(totX/tile), baseY=Math.floor(totY/tile);
      const cols=Math.ceil(w/tile)+2, rows=Math.ceil(h/tile)+2, dr=L.sz*zl, wobA=L.wob*zl;
      let drawn=0;
      for(let gy=-1; gy<rows; gy++){ for(let gx=-1; gx<cols; gx++){
        if(drawn>420) break;
        const ci=gx+baseX, cj=gy+baseY;
        const hx=hash(ci+li*131,cj+li*977), hy=hash(ci+li*491,cj+li*263), ho=hash(ci+li*53,cj+li*97);
        const jx=(hx-0.5)*tile*0.5, jy=(hy-0.5)*tile*0.5;
        // активный собственный дрейф (Lissajous, фаза из хеша) + медленное дыхание яркости (период ~35-40с)
        const wx=Math.sin(ts*0.16+hx*6.283)*wobA, wy=Math.cos(ts*0.13+hy*6.283)*wobA;
        const breathe=0.35+0.65*(0.5+0.5*Math.sin(ts*0.18+ho*6.283));
        const x=gx*tile-offX+jx+wx, y=gy*tile-offY+jy+wy;
        if(x<-dr-2||x>w+dr+2||y<-dr-2||y>h+dr+2) continue;
        ctx.globalAlpha=L.a*breathe;
        ctx.drawImage(star, x-dr, y-dr, dr*2, dr*2);
        drawn++;
      }}
    }
    ctx.globalAlpha=1;
  }
  _openNode(n){
    // двойной клик: область → фильтр задач; заметка → ридер; задача → редактор
    this._closePop();
    if(n.type==="hub"){ areaFilter=n.id.replace("hub_",""); view="tasks"; render(); return; }
    const it=n.ref; if(!it) return;
    openItemSmart(it);
  }
  _hover(id){
    this.nodeEls.forEach(o=>{ const on=!id||o.n.id===id||this.adj[id].has(o.n.id); o.g.classList.toggle("dim",!on); });
    this.linkEls.forEach((e,i)=>{ const l=this.links[i]; const on=!id||l.a===id||l.b===id; e.classList.toggle("dim",!on); });
  }
  startLink(id){ this.linkFrom=id; this.svg.classList.add("linking"); $("#g-hint").innerHTML="Режим связи: кликни по второму узлу. Esc — отмена."; this._closePop(); }
  cancelLink(){ this.linkFrom=null; this.svg.classList.remove("linking"); this.tempLine.style.display="none"; if($("#g-hint"))$("#g-hint").innerHTML="ПКМ — меню · двойной клик — открыть · клик по связи — убрать"; }
  _finishLink(n){
    const a=this.linkFrom;
    // связывать можно с чем угодно (заметка/задача/область), но не сам с собой и не область с областью
    const bothHubs = n.id.indexOf("hub_")===0 && a.indexOf("hub_")===0;
    if(n.id!==a && !bothHubs){
      if(addLink(a,n.id)){
        // иерархию не задаём вручную — она выводится от области (см. recomputeHierarchy)
        recomputeHierarchy();
        toast("Связь создана"); this.cancelLink(); this.build(); return;
      }
      toast("Уже связаны");
    }
    this.cancelLink();
  }
  refit(){
    // пере-раскладка: незакреплённые узлы расходятся заново, затем (когда остынет) обзор вписывается под всё дерево
    this.nodes.forEach(n=>{ if(!n.fixed){ if(n.ref){n.ref.x=null;n.ref.y=null;} n.x=this.W/2+(Math.random()-.5)*420; n.y=this.H/2+(Math.random()-.5)*320; }});
    this.alpha=1; this._needFit=true; persist();
  }
  _tick(){
    this._drawBg();
    const N=this.nodes, cx=this.W/2, cy=this.H/2;
    // даём симуляции полностью остыть, чтобы граф замирал и не дёргался; перетаскивание снова поднимает alpha
    this.alpha*=0.985; if(this.alpha<0.004)this.alpha=0;
    if(this.alpha>0.06) this._moved=true;   // была заметная активность → после остывания сохраним раскладку
    for(let i=0;i<N.length;i++){ const a=N[i];
      const adjA=this.adj[a.id];
      for(let j=i+1;j<N.length;j++){ const b=N[j];
        let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy||1, d=Math.sqrt(d2);
        // связанные узлы отталкиваются слабее, несвязанные — заметно сильнее (разлетаются дальше)
        const connected = adjA && adjA.has(b.id);
        const rep = connected ? 2400 : 7000;
        const f=(rep/d2)*this.alpha, fx=dx/d*f, fy=dy/d*f;
        a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
      }
      // слабее тянем к центру, чтобы несвязанные кластеры могли разойтись
      a.vx+=(cx-a.x)*0.0016*this.alpha; a.vy+=(cy-a.y)*0.0016*this.alpha;
    }
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b];
      let dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-l.L)*0.02*this.alpha, fx=dx/d*f, fy=dy/d*f;
      a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
    });
    // parent-child hierarchy spring — stronger pull
    N.forEach(n=>{
      if(n.ref && n.ref.parent && this.byId[n.ref.parent]){
        const p=this.byId[n.ref.parent];
        let dx=p.x-n.x, dy=p.y-n.y, d=Math.sqrt(dx*dx+dy*dy)||1;
        const f=(d-45)*0.06*this.alpha, fx=dx/d*f, fy=dy/d*f;
        n.vx+=fx; n.vy+=fy; p.vx-=fx; p.vy-=fy;
      }
    });
    const MX=6;   // кламп смещения за кадр → плавный глайд при оседании, без резких рывков/телепортов
    N.forEach(n=>{ if(n===this.drag||n.fixed){ n.vx=0; n.vy=0; return; }
      n.vx*=0.82; n.vy*=0.82;
      if(n.vx>MX)n.vx=MX; else if(n.vx<-MX)n.vx=-MX;
      if(n.vy>MX)n.vy=MX; else if(n.vy<-MX)n.vy=-MX;
      n.x+=n.vx; n.y+=n.vy;
    });
    // «дыхание» в покое — чтобы граф жил, не выглядел вкопанным
    const _it=performance.now()*0.001, AMP=4;
    N.forEach((n,i)=>{
      if(n===this.drag||n.fixed){ n._ix=0; n._iy=0; return; }
      n._ix=Math.sin(_it*0.5 + i*1.7)*AMP;
      n._iy=Math.cos(_it*0.43 + i*2.3)*AMP;
    });
    // связи — по позиции+idle (линии не «мерцают» от сдвига)
    const RX=n=>n.x+(n._ix||0), RY=n=>n.y+(n._iy||0);
    this.linkEls.forEach((e,i)=>{ const l=this.links[i], a=this.byId[l.a], b=this.byId[l.b];
      const ax=RX(a),ay=RY(a),bx=RX(b),by=RY(b);
      e.setAttribute("x1",ax); e.setAttribute("y1",ay); e.setAttribute("x2",bx); e.setAttribute("y2",by);
      const h=this.hitEls[i]; if(h){ h.setAttribute("x1",ax); h.setAttribute("y1",ay); h.setAttribute("x2",bx); h.setAttribute("y2",by); }
      if(l._grad){ l._grad.setAttribute("x1",ax); l._grad.setAttribute("y1",ay); l._grad.setAttribute("x2",bx); l._grad.setAttribute("y2",by); }
    });
    this.nodeEls.forEach(o=>{ const n=o.n, x=RX(n), y=RY(n);   // x/y — с idle: дрейфит фигура/ореол/пин/связи (вектор не мерцает)
      if(n.type==="task"||n.type==="flow"){ o.shape.setAttribute("x",x-n.r); o.shape.setAttribute("y",y-n.r);
        if(o.check) o.check.setAttribute("d",`M ${x-3.2} ${y+0.3} l 2.2 2.4 l 4.2 -5`); }
      else { o.shape.setAttribute("cx",x); o.shape.setAttribute("cy",y); }
      if(o.halo){ o.halo.setAttribute("cx",x); o.halo.setAttribute("cy",y); }
      o.pin.setAttribute("cx",x); o.pin.setAttribute("cy",y);
      // ПОДПИСЬ — на БАЗОВОЙ позиции n.x/n.y (idle её НЕ двигает): SVG-текст не ре-растеризуется → не «прыгает».
      // В покое n.x статичен → атрибуты подписи не меняются вообще.
      o.t.setAttribute("x",n.x); o.t.setAttribute("y",n.y+n.r+12);
    });
    // когда симуляция остыла и просили «уложить» — подгоняем обзор под всё дерево
    if(this.alpha===0 && this._needFit){ this._needFit=false; this._fitView(); }
    // авто-раскладка остыла после активности → сохраняем позиции один раз, чтобы следующее открытие было статичным
    if(this.alpha===0 && this._moved){ this._moved=false;
      this.nodes.forEach(n=>{ if(n.ref){ n.ref.x=n.x; n.ref.y=n.y; } else if(n.hubArea){ n.hubArea.x=n.x; n.hubArea.y=n.y; } });
      persist();
    }
    this.raf=requestAnimationFrame(()=>this._tick());
  }
  // вписать все узлы в видимую область (зум/пан), чтобы видеть дерево целиком
  _fitView(){
    if(!this.nodes.length) return;
    let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    this.nodes.forEach(n=>{ minx=Math.min(minx,n.x); miny=Math.min(miny,n.y); maxx=Math.max(maxx,n.x); maxy=Math.max(maxy,n.y); });
    const pad=70;
    const cw=Math.max(1,(maxx-minx)+pad*2), ch=Math.max(1,(maxy-miny)+pad*2);
    const z=Math.max(0.25, Math.min(1.6, Math.min(this.W/cw, this.H/ch)));
    const tx=(this.W - (minx+maxx)*z)/2, ty=(this.H - (miny+maxy)*z)/2;
    this._tweenView(z, tx, ty);   // плавный переезд камеры, а не телепорт
  }
  // плавный переезд камеры к (zoom,tx,ty) — ease-out, ~0.5с
  _tweenView(tz, ttx, tty){
    if(this._vraf) cancelAnimationFrame(this._vraf);
    const sz=this.zoom, sx=this.tx, sy=this.ty, t0=performance.now(), dur=520;
    const step=()=>{
      const k=Math.min(1,(performance.now()-t0)/dur), e=1-Math.pow(1-k,3);
      this.zoom=sz+(tz-sz)*e; this.tx=sx+(ttx-sx)*e; this.ty=sy+(tty-sy)*e;
      this._applyTransform();
      this._vraf = k<1 ? requestAnimationFrame(step) : null;
    };
    step();
  }
  _openPop(n,e){
    this._closePop();
    if(n.type==="hub"){
      this.sel=n.id;
      const a=areaById(n.id.replace("hub_",""));
      if(!a){ areaFilter=n.id.replace("hub_",""); view="tasks"; render(); return; }
      const pop=el("div"); pop.id="node-pop";
      pop.innerHTML=`
        <div class="np-ttl">${esc(a.name)}</div>
        <div class="np-meta"><span><i class="ti ${a.icon}"></i>область</span></div>
        <div class="swatches np-sw" style="margin-bottom:10px;">${swatchRow(a.color)}</div>
        <div class="np-row" style="margin-bottom:6px;">
          <button class="btn" data-pop="tasks"><i class="ti ti-checklist"></i>Задачи</button>
          <button class="btn" data-pop="link"><i class="ti ti-plus"></i>Связать</button>
        </div>
        <div class="np-row">
          <button class="btn" data-pop="pin"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i>${n.fixed?"Открепить":"Закрепить"}</button>
        </div>`;
      $("#graph-wrap").appendChild(pop);
      this._posPop(pop,n);
      $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>{ a.color=PALETTE[+b.dataset.ci]||null; persist(); this.build(); });
      pop.querySelector('[data-pop="tasks"]').onclick=()=>{ this._closePop(); areaFilter=a.id; view="tasks"; render(); };
      pop.querySelector('[data-pop="link"]').onclick=()=>{ this.startLink(n.id); };
      pop.querySelector('[data-pop="pin"]').onclick=()=>{
        n.fixed=!n.fixed; a.pin=n.fixed; if(n.fixed){ a.x=n.x; a.y=n.y; } persist();
        const o=this.nodeEls.find(x=>x.n===n); if(o)o.pin.style.display=n.fixed?"":"none";
        this._closePop();
      };
      return;
    }
    const it=n.ref; if(!it) return;
    this.sel=n.id;
    const pop=el("div"); pop.id="node-pop";
    const conn=linksOf(it.id);
    const km = it.kind==="flow"?{i:"ti-sitemap",n:"схема"} : it.kind==="note"?{i:"ti-note",n:"заметка"} : {i:"ti-checklist",n:"задача"};
    const hasOpen = (it.kind==="note" || it.kind==="flow");
    pop.innerHTML=`
      <div class="np-ttl">${esc(it.title)}</div>
      <div class="np-meta">
        <span><i class="ti ${km.i}"></i> ${km.n}</span>
        ${it.area?`<span><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${conn.length?`<span><i class="ti ti-link"></i>${conn.length}</span>`:""}
      </div>
      <div class="swatches np-sw" style="margin-bottom:10px;">${swatchRow(it.color)}</div>
      <div class="np-row" style="margin-bottom:6px;">
        ${hasOpen?`<button class="btn" data-pop="open"><i class="ti ${it.kind==="flow"?"ti-sitemap":"ti-eye"}"></i>Открыть</button>`
                :`<button class="btn ${it.done?"":"primary"}" data-pop="done"><i class="ti ${it.done?"ti-arrow-back-up":"ti-check"}"></i>${it.done?"Вернуть":"Готово"}</button>`}
        <button class="btn" data-pop="edit"><i class="ti ti-pencil"></i>Изменить</button>
        <button class="btn" data-pop="link"><i class="ti ti-plus"></i>Связать</button>
      </div>
      <div class="np-row">
        <button class="btn" data-pop="pin"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i>${n.fixed?"Открепить":"Закрепить"}</button>
        <button class="btn" data-pop="del"><i class="ti ti-trash"></i>Удалить</button>
      </div>`;
    $("#graph-wrap").appendChild(pop);
    this._posPop(pop,n);
    $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>{ it.color=PALETTE[+b.dataset.ci]||null; touch(it); persist(); this.build(); });
    if(pop.querySelector('[data-pop="open"]')) pop.querySelector('[data-pop="open"]').onclick=()=>{ this._closePop(); openItemSmart(it); };
    if(pop.querySelector('[data-pop="done"]')) pop.querySelector('[data-pop="done"]').onclick=()=>{ toggleDone(it); this._closePop(); this.build(); toast(it.done?"Выполнено":"Возвращено в работу"); };
    pop.querySelector('[data-pop="edit"]').onclick=()=>{ this._closePop(); openItemEditor(it); };
    pop.querySelector('[data-pop="link"]').onclick=()=>{ this.startLink(it.id); };
    pop.querySelector('[data-pop="pin"]').onclick=()=>{
      n.fixed=!n.fixed; if(n.ref){ n.ref.pin=n.fixed; persist(); }
      const o=this.nodeEls.find(x=>x.n===n); if(o)o.pin.style.display=n.fixed?"":"none";
      this._closePop();
    };
    pop.querySelector('[data-pop="del"]').onclick=()=>{ this._closePop(); const id=it.id; deleteItem(id); this.build(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }}); };
  }
  _posPop(pop,n){
    const rc=this.svg.getBoundingClientRect();
    const pw=pop.offsetWidth||240, ph=pop.offsetHeight||200;
    const nx=(n.x*this.zoom+this.tx)/this.W*rc.width, ny=(n.y*this.zoom+this.ty)/this.H*rc.height;
    // по умолчанию справа-снизу от узла; если не влезает — разворачиваем влево/вверх (а не прижимаем к краю)
    let px = (nx+14+pw <= rc.width-8) ? nx+14 : nx-14-pw;
    let py = (ny+14+ph <= rc.height-8) ? ny+14 : ny-14-ph;
    px=Math.max(8, Math.min(px, rc.width-pw-8));
    py=Math.max(8, Math.min(py, rc.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px";
  }
  _nodeLabel(id){ const n=this.byId[id]; return n?n.label:id; }
  _openLinkPop(l,e){
    this._closePop();
    const pop=el("div"); pop.id="node-pop";
    const auto=!l.manual;
    pop.innerHTML=`
      <div class="np-ttl"><i class="ti ti-link"></i> Связь</div>
      <div class="np-meta" style="line-height:1.6;">
        <span>${esc(this._nodeLabel(l.a))}</span><i class="ti ti-arrows-left-right" style="opacity:.5"></i><span>${esc(this._nodeLabel(l.b))}</span>
      </div>
      ${auto?`<div class="np-meta" style="opacity:.7;margin-bottom:8px;">Авто-связь с областью. Убрать = открепить от области.</div>`:""}
      <div class="np-row"><button class="btn" data-lp="del"><i class="ti ti-unlink"></i>${auto?"Открепить":"Убрать связь"}</button></div>`;
    const wrap=$("#graph-wrap"); wrap.appendChild(pop);
    const rc=this.svg.getBoundingClientRect();
    const pw=pop.offsetWidth||240, ph=pop.offsetHeight||140;
    const cx=e.clientX-rc.left, cy=e.clientY-rc.top;
    let px = (cx+12+pw <= rc.width-8) ? cx+12 : cx-12-pw;   // разворот влево у правого края
    let py = (cy+12+ph <= rc.height-8) ? cy+12 : cy-12-ph;  // разворот вверх у нижнего края
    px=Math.max(8, Math.min(px, rc.width-pw-8));
    py=Math.max(8, Math.min(py, rc.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px";
    pop.querySelector('[data-lp="del"]').onclick=()=>{
      if(l.manual){
        removeLink(l.a,l.b);
      }
      else { // auto area-link: detach the non-hub endpoint from its area
        const itemId = l.a.indexOf("hub_")===0 ? l.b : l.a;
        const it=S.items.find(x=>x.id===itemId); if(it){ it.area=null; touch(it); persist(); }
      }
      recomputeHierarchy();   // пересобрать иерархию от области
      this._closePop(); this.build(); toast("Связь убрана");
    };
  }
  _closePop(){ const p=$("#node-pop"); if(p)p.remove(); this.sel=null; }
  destroy(){ if(this.raf) cancelAnimationFrame(this.raf); if(this._vraf) cancelAnimationFrame(this._vraf); }
}

/* ===========================================================
   MODALS
   =========================================================== */
function restoreFocus(o){ if(o&&o.focus&&document.contains(o)){ try{o.focus();}catch(e){} } }
function overlay(node){
  const ov=el("div","overlay"); ov.appendChild(node);
  ov._opener=document.activeElement;   // вернём фокус сюда при закрытии (a11y)
  ov.addEventListener("mousedown",e=>{ if(e.target===ov){ const o=ov._opener; ov.remove(); restoreFocus(o); } });
  $("#overlay-root").appendChild(ov);
  return ov;
}
function closeOverlays(){ const root=$("#overlay-root"); const first=root.firstElementChild; const o=first&&first._opener; root.innerHTML=""; restoreFocus(o); }

function openItemEditor(existing, defaultKind){
  const isNew=!existing;
  const it = existing || {id:null, kind:defaultKind||"task", title:"", body:"", area:areaFilter||null, due:null, repeat:"none", priority:0, tags:[]};
  const m=el("div","modal");
  m.innerHTML=`
    <h3><i class="ti ${it.kind==="note"?"ti-note":"ti-checklist"}"></i>${isNew?"Новый элемент":"Изменить"}</h3>
    <div class="field"><label>Тип</label>
      <div class="seg" id="f-kind">
        <button data-k="task" class="${it.kind==="task"?"on":""}"><i class="ti ti-checklist"></i> Задача</button>
        <button data-k="note" class="${it.kind==="note"?"on":""}"><i class="ti ti-note"></i> Заметка</button>
      </div>
    </div>
    <div class="field"><label>Название</label><input type="text" id="f-title" value="${esc(it.title)}" placeholder="Что нужно сделать / о чём заметка"></div>
    <div class="field" id="wrap-body"><label>Заметка / детали</label><textarea id="f-body" placeholder="Текст, ссылки, мысли…">${esc(it.body||"")}</textarea></div>
    <div class="row2">
      <div class="field"><label>Область</label><select id="f-area">
        <option value="">— нет —</option>
        ${S.areas.map(a=>`<option value="${a.id}" ${it.area===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}
      </select></div>
      <div class="field" id="wrap-due"><label>Срок</label><input type="date" id="f-due" value="${it.due||""}"></div>
    </div>
    <div class="row2" id="wrap-task2">
      <div class="field"><label>Повтор</label><select id="f-rep">
        ${Object.entries(REPEAT).map(([k,vv])=>`<option value="${k}" ${it.repeat===k?"selected":""}>${k==="none"?"нет":vv}</option>`).join("")}
      </select></div>
      <div class="field"><label>Приоритет</label>
        <div class="seg" id="f-pri">
          ${[0,1,2,3].map(p=>`<button data-p="${p}" class="${(it.priority||0)===p?"on":""}">${["—","низкий","средний","высокий"][p]}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="field"><label>Цвет</label>
      <div class="swatches" id="f-color">${swatchRow(it.color)}</div>
    </div>
    <div class="field"><label>Теги (Enter чтобы добавить)</label>
      <input type="text" id="f-tagin" placeholder="например: видео, цвет, blender">
      <div class="chips" id="f-tags" style="margin-top:8px;"></div>
    </div>
    <div class="modal-foot">
      ${!isNew?`<button class="btn ghost" id="f-delete"><i class="ti ti-trash"></i>Удалить</button>`:""}
      <div class="right">
        <button class="btn ghost" id="f-cancel">Отмена</button>
        <button class="btn primary" id="f-save"><i class="ti ti-check"></i>Сохранить</button>
      </div>
    </div>`;
  const ov=overlay(m);
  m.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); $("#f-save",m).click(); } });  // Ctrl/Cmd+Enter = сохранить
  let kind=it.kind, priority=it.priority||0, tags=(it.tags||[]).slice(), color=it.color||null;
  $$("#f-color .swatch",m).forEach(b=>b.onclick=()=>{ color=PALETTE[+b.dataset.ci]||null; $$("#f-color .swatch",m).forEach(x=>x.classList.toggle("on",PALETTE[+x.dataset.ci]===color)); });

  const syncKind=()=>{
    $("#wrap-due",m).style.display = kind==="note"?"none":"";
    $("#wrap-task2",m).style.display = kind==="note"?"none":"flex";
    $$("#f-kind button",m).forEach(b=>b.classList.toggle("on",b.dataset.k===kind));
  };
  syncKind();
  $$("#f-kind button",m).forEach(b=>b.onclick=()=>{ kind=b.dataset.k; syncKind(); });
  $$("#f-pri button",m).forEach(b=>b.onclick=()=>{ priority=+b.dataset.p; $$("#f-pri button",m).forEach(x=>x.classList.toggle("on",x===b)); });

  const renderTags=()=>{ $("#f-tags",m).innerHTML=tags.map((t,i)=>`<span class="chip">${esc(t)}<button data-i="${i}"><i class="ti ti-x"></i></button></span>`).join("");
    $$("#f-tags button",m).forEach(b=>b.onclick=()=>{ tags.splice(+b.dataset.i,1); renderTags(); }); };
  renderTags();
  $("#f-tagin",m).addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); const v=e.target.value.trim().replace(/^#/,""); if(v&&!tags.includes(v)){tags.push(v);renderTags();} e.target.value=""; }});

  $("#f-cancel",m).onclick=()=>ov.remove();
  if($("#f-delete",m)) $("#f-delete",m).onclick=()=>{ const id=it.id; deleteItem(id); ov.remove(); render(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }}); };
  $("#f-save",m).onclick=()=>{
    const title=$("#f-title",m).value.trim(); if(!title){ $("#f-title",m).focus(); return; }
    const data={ kind, title, body:$("#f-body",m).value, area:$("#f-area",m).value||null,
      due: kind==="note"?null:($("#f-due",m).value||null), repeat: kind==="note"?"none":$("#f-rep",m).value,
      priority: kind==="note"?0:priority, tags, color };
    if(isNew){ addItem(data); }
    else {
      Object.assign(it,data);
      if(kind==="note"){ it.status="note"; it.done=false; }
      else {
        if(it.status==="note") it.status=it.due?"todo":"inbox";        // note → task
        if(it.status==="inbox" && (it.area||it.due)) it.status="todo";  // разобран из inbox → в задачи
      }
      touch(it); persist();
    }
    ov.remove(); render();
    toast(isNew?"Добавлено":"Сохранено");
  };
  setTimeout(()=>$("#f-title",m).focus(),30);
}

function openAreaManager(){
  const m=el("div","modal");
  const draw=()=>{
    m.innerHTML=`<h3><i class="ti ti-folders"></i>Области</h3>
      <div id="area-list">${S.areas.map(a=>`
        <div class="area-row" data-id="${a.id}"><i class="ti ${a.icon}"></i>
          <span class="nm">${esc(a.name)}</span>
          <button data-edit="${a.id}" title="Изменить"><i class="ti ti-pencil"></i></button>
          <button data-del="${a.id}" title="Удалить"><i class="ti ti-trash"></i></button>
        </div>`).join("")}</div>
      <div class="modal-foot"><div class="right">
        <button class="btn ghost" id="a-close">Закрыть</button>
        <button class="btn primary" id="a-add"><i class="ti ti-plus"></i>Новая область</button>
      </div></div>`;
    $("#a-close",m).onclick=()=>closeOverlays();
    $("#a-add",m).onclick=()=>openAreaEditor(null,draw);
    $$("[data-edit]",m).forEach(b=>b.onclick=()=>openAreaEditor(areaById(b.dataset.edit),draw));
    $$("[data-del]",m).forEach(b=>b.onclick=()=>{
      const id=b.dataset.del; const used=S.items.filter(i=>i.area===id).length;
      const msg = used ? `В области «${areaName(id)}» ${used} элем. Удалить область? Элементы останутся без области.`
                       : `Удалить область «${areaName(id)}»?`;
      if(!confirm(msg)) return;   // подтверждаем ВСЕГДА, даже для пустой области (нет soft-delete/undo)
      S.items.forEach(i=>{ if(i.area===id) i.area=null; });
      S.areas=S.areas.filter(a=>a.id!==id); if(areaFilter===id) areaFilter=null;
      S.links=S.links.filter(l=>l[0]!=="hub_"+id && l[1]!=="hub_"+id);     // убрать висячие связи с хабом области
      if(S.settings&&S.settings.collapsed) delete S.settings.collapsed["area:"+id];
      persist(); draw(); renderNav();
    });
  };
  overlay(m); draw();
}
function openAreaEditor(area, after){
  const isNew=!area; const a=area||{id:null,name:"",icon:"ti-folder"};
  const m=el("div","modal");
  m.innerHTML=`<h3><i class="ti ti-folder"></i>${isNew?"Новая область":"Область"}</h3>
    <div class="field"><label>Название</label><input type="text" id="ar-name" value="${esc(a.name)}" placeholder="Например: Личное, Клиент N, Учёба"></div>
    <div class="field"><label>Иконка</label><div class="icon-grid" id="ar-icons">
      ${ICONS.map(ic=>`<button data-ic="${ic}" class="${a.icon===ic?"on":""}"><i class="ti ${ic}"></i></button>`).join("")}
    </div></div>
    <div class="field"><label>Цвет</label><div class="swatches" id="ar-color">${swatchRow(a.color)}</div></div>
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="ar-cancel">Отмена</button>
      <button class="btn primary" id="ar-save"><i class="ti ti-check"></i>Сохранить</button>
    </div></div>`;
  const ov=overlay(m); let icon=a.icon; let aColor=a.color||null;
  $$("#ar-color .swatch",m).forEach(b=>b.onclick=()=>{ aColor=PALETTE[+b.dataset.ci]||null; $$("#ar-color .swatch",m).forEach(x=>x.classList.toggle("on",PALETTE[+x.dataset.ci]===aColor)); });
  $$("#ar-icons button",m).forEach(b=>b.onclick=()=>{ icon=b.dataset.ic; $$("#ar-icons button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  $("#ar-cancel",m).onclick=()=>ov.remove();
  $("#ar-save",m).onclick=()=>{
    const name=$("#ar-name",m).value.trim(); if(!name){ $("#ar-name",m).focus(); return; }
    if(isNew){ S.areas.push({id:"a_"+uid(),name,icon,color:aColor}); } else { a.name=name; a.icon=icon; a.color=aColor; }
    persist(); ov.remove(); renderNav(); if(after) after();
  };
  setTimeout(()=>$("#ar-name",m).focus(),30);
}

/* ===========================================================
   NOTE READER
   =========================================================== */
function openNoteReader(it){
  const m=el("div","modal");
  const conn=linksOf(it.id);
  const linked=conn.map(id=>{ const x=S.items.find(i=>i.id===id); if(x) return x; const a=S.areas.find(a=>"hub_"+a.id===id||a.id===id); if(a) return {id:a.id,kind:"area",title:a.name,icon:a.icon}; return null; }).filter(Boolean);
  const kids=childrenOf(it.id);
  const parent=it.parent ? S.items.find(i=>i.id===it.parent) : null;
  const parentChain=noteParentChain(it.id).slice(0,-1); // without self
  m.innerHTML=`
    <h3><i class="ti ti-note"></i>${esc(it.title)}</h3>
    ${it.area?`<div style="margin-bottom:10px;"><span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span></div>`:""}
    ${parentChain.length?`<div style="margin-bottom:10px;"><span class="tag"><i class="ti ti-sitemap"></i>Иерархия: ${parentChain.map(id=>{const p=S.items.find(i=>i.id===id);return p?esc(p.title):"";}).join(" → ")}</span></div>`:""}
    <div class="reader-body">${it.body?esc(it.body):`<span class="reader-empty">Пустая заметка — нажми «Изменить» чтобы добавить текст.</span>`}</div>
    ${linked.length?`<div class="field"><label>Связи (${linked.length})</label><div class="reader-links" id="rl-list">
      ${linked.map(x=>`<div class="rl-it" data-rl="${x.id}"><i class="ti ${x.kind==="area"?(x.icon||"ti-folder"):x.kind==="note"?"ti-note":"ti-checklist"}"></i>${esc(x.title)}</div>`).join("")}
    </div></div>`:""}
    ${parent?`<div class="field"><label>Родитель</label><div class="reader-links" id="par-list">
      <div class="rl-it" data-rl="${parent.id}"><i class="ti ti-note"></i>${esc(parent.title)}</div>
    </div></div>`:""}
    ${kids.length?`<div class="field"><label>Дочерние заметки (${kids.length})</label><div class="reader-links" id="kid-list">
      ${kids.map(k=>`<div class="rl-it" data-rl="${k.id}"><i class="ti ti-note"></i>${esc(k.title)}</div>`).join("")}
    </div></div>`:""}
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="nr-close">Закрыть</button>
      <button class="btn" id="nr-edit"><i class="ti ti-pencil"></i>Изменить</button>
    </div></div>`;
  const ov=overlay(m);
  setTimeout(()=>{ const c=$("#nr-close",m); if(c)c.focus(); },30);   // автофокус для клавиатуры
  $("#nr-close",m).onclick=()=>ov.remove();
  $("#nr-edit",m).onclick=()=>{ ov.remove(); openItemEditor(it); };
  $$(".rl-it",m).forEach(e=>e.onclick=()=>{
    const rid=e.dataset.rl;
    const ref=S.items.find(i=>i.id===rid);
    if(ref){ ov.remove(); openItemSmart(ref); }
  });
}

/* ===========================================================
   FLOW — блок-схема как вложенный редактор узла (kind:"flow")
   Свободный холст: таскаешь блоки, тянешь стрелки; рамки-контейнеры
   группируют блоки. Содержимое лежит в it.flow={blocks,edges,view}.
   =========================================================== */
const FLOW_TYPES={
  proc:    {name:"Блок",     icon:"ti-square",       w:160, h:64 },
  decision:{name:"Решение",  icon:"ti-help-hexagon", w:160, h:70 },
  terminal:{name:"Терминал", icon:"ti-circle-dot",   w:132, h:52 },
  comment: {name:"Коммент",  icon:"ti-message-2",    w:172, h:74 },
  frame:   {name:"Рамка",    icon:"ti-frame",        w:320, h:220}
};
const FLOW_ORDER=["proc","decision","terminal","comment","frame"];

// нормализация содержимого схемы (бэкилл/валидация — защита от битого json)
function ensureFlow(it){
  if(!it.flow || typeof it.flow!=="object") it.flow={blocks:[],edges:[],view:{tx:0,ty:0,zoom:1}};
  const f=it.flow;
  if(!Array.isArray(f.blocks)) f.blocks=[];
  if(!Array.isArray(f.edges))  f.edges=[];
  if(!f.view||typeof f.view!=="object") f.view={tx:0,ty:0,zoom:1};
  f.view.tx=+f.view.tx||0; f.view.ty=+f.view.ty||0; f.view.zoom=Math.max(0.3,Math.min(2.4,+f.view.zoom||1));
  const ids=new Set();
  f.blocks=f.blocks.filter(b=>b&&typeof b==="object").map(b=>{
    if(typeof b.id!=="string"||!b.id||ids.has(b.id)) b.id="b_"+uid(); ids.add(b.id);
    if(!FLOW_TYPES[b.type]) b.type="proc";
    b.text=String(b.text==null?"":b.text); b.note=String(b.note==null?"":b.note);
    b.x=Math.round(+b.x||0); b.y=Math.round(+b.y||0);
    b.w=Math.round(+b.w||FLOW_TYPES[b.type].w); b.h=Math.round(+b.h||FLOW_TYPES[b.type].h);
    if(typeof b.color!=="string"||!/^#[0-9a-fA-F]{3,8}$/.test(b.color||"")) b.color=null;
    if(b.parent && typeof b.parent!=="string") b.parent=null;
    return b;
  });
  f.blocks.forEach(b=>{ if(b.parent && !ids.has(b.parent)) b.parent=null; });   // висячий родитель
  const eids=new Set();
  f.edges=f.edges.filter(e=>e&&ids.has(e.from)&&ids.has(e.to)&&e.from!==e.to).map(e=>{
    if(typeof e.id!=="string"||!e.id||eids.has(e.id)) e.id="e_"+uid(); eids.add(e.id);
    e.label=String(e.label==null?"":e.label); return e;
  });
  return f;
}
// единая точка открытия элемента: заметка → ридер, схема → редактор схемы, иначе → редактор задачи
function openItemSmart(it){
  if(!it) return;
  if(it.kind==="note") openNoteReader(it);
  else if(it.kind==="flow") openFlowEditor(it);
  else openItemEditor(it);
}
function createNew(kind){
  if(kind==="flow"){ const it=addItem({kind:"flow", title:"Новая схема", area:areaFilter||null}); render(); openFlowEditor(it); }
  else openItemEditor(null, kind);
}

function openFlowEditor(it){ new FlowEditor(it).mount(); }

class FlowEditor{
  constructor(it){
    this.it=it; this.f=ensureFlow(it); this.view=this.f.view;
    this.sel=null; this.selEdge=null; this.elById={};
    this._eraf=null; this._needEdges=false;
  }
  _b(id){ return this.f.blocks.find(b=>b.id===id); }
  save(){ touch(this.it); persist(); }
  mount(){
    const NS="http://www.w3.org/2000/svg";
    const scr=el("div","flow-screen");
    scr.innerHTML=`
      <div class="flow-top">
        <button class="flow-ic flow-back" title="Назад к заметкам"><i class="ti ti-arrow-left"></i></button>
        <div class="flow-titlewrap"><i class="ti ti-sitemap"></i><span class="flow-name" contenteditable spellcheck="false" data-ph="название схемы">${esc(this.it.title||"")}</span></div>
        <div class="flow-tools">
          ${FLOW_ORDER.map(k=>`<button class="flow-ic" data-add="${k}" title="${FLOW_TYPES[k].name}"><i class="ti ${FLOW_TYPES[k].icon}"></i></button>`).join("")}
          <span class="flow-sep"></span>
          <button class="flow-ic" data-z="out" title="Уменьшить"><i class="ti ti-zoom-out"></i></button>
          <button class="flow-ic" data-z="in" title="Увеличить"><i class="ti ti-zoom-in"></i></button>
          <button class="flow-ic" data-z="fit" title="Показать всё"><i class="ti ti-focus-2"></i></button>
          <span class="flow-sep"></span>
          <button class="flow-ic wide" data-act="copy" title="Скопировать схему как текст"><i class="ti ti-clipboard-text"></i>Текст</button>
        </div>
        <button class="flow-ic flow-close" title="Закрыть (Esc)"><i class="ti ti-x"></i></button>
      </div>
      <div class="flow-stage">
        <div class="flow-world">
          <svg class="flow-edges"><defs>
            <marker id="fe-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L10,5 L0,10 Z"></path>
            </marker></defs>
            <g class="fe-g"></g>
            <path class="fe-temp" style="display:none"></path>
          </svg>
        </div>
        <div class="flow-hint">двойной клик по холсту — добавить блок · тяни ⊕ под блоком — стрелка · ПКМ по блоку — тип/цвет · Delete — удалить</div>
      </div>`;
    $("#overlay-root").appendChild(scr);
    this.screen=scr;
    this.stage=$(".flow-stage",scr); this.world=$(".flow-world",scr);
    this.svg=$(".flow-edges",scr); this.feG=$(".fe-g",scr); this.tempEdge=$(".fe-temp",scr);
    // верхняя панель
    $(".flow-back",scr).onclick=()=>this.close();
    $(".flow-close",scr).onclick=()=>this.close();
    const nameEl=$(".flow-name",scr);
    nameEl.addEventListener("input",()=>{ this.it.title=nameEl.innerText.replace(/\n/g," ").trim(); this.save(); });
    nameEl.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); nameEl.blur(); } });
    $$("[data-add]",scr).forEach(btn=>btn.onclick=()=>this.addBlockCenter(btn.dataset.add));
    $$("[data-z]",scr).forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.z; if(k==="fit") this.fit(); else this.zoomBy(k==="in"?1.2:1/1.2); });
    $('[data-act="copy"]',scr).onclick=()=>this.copyText();
    this._wireStage();
    // Esc внутри редактирования текста — снять фокус, не закрывать редактор
    scr.addEventListener("keydown",e=>{
      const ae=document.activeElement, editing=ae&&ae.isContentEditable&&scr.contains(ae);
      if(e.key==="Escape"&&editing){ ae.blur(); e.stopPropagation(); e.preventDefault(); return; }
      if((e.key==="Delete"||(e.key==="Backspace"&&!editing)) && !editing){ if(this.selEdge){ this.deleteEdge(this.selEdge); e.preventDefault(); } else if(this.sel){ this.deleteBlock(this.sel); e.preventDefault(); } }
    },true);
    this.applyView();
    // первый запуск пустой схемы — посеять стартовый блок, чтобы холст не пугал пустотой
    if(!this.f.blocks.length){ const r=this.stage.getBoundingClientRect(); const p=this.worldPt(r.left+r.width/2, r.top+r.height*0.32); const b=this._newBlock("terminal",p.x,p.y); b.text="Старт"; this.save(); }
    this.renderBlocks(); this.drawEdges();
  }
  close(){ if(this._eraf) cancelAnimationFrame(this._eraf); const o=this.screen&&this.screen._opener; this.screen.remove(); }
  /* ---- координаты ---- */
  worldPt(cx,cy){ const r=this.stage.getBoundingClientRect(); return {x:(cx-r.left-this.view.tx)/this.view.zoom, y:(cy-r.top-this.view.ty)/this.view.zoom}; }
  applyView(){
    const {tx,ty,zoom}=this.view;
    this.world.style.transform=`translate(${tx}px,${ty}px) scale(${zoom})`;
    this.stage.style.backgroundSize=`${24*zoom}px ${24*zoom}px`;
    this.stage.style.backgroundPosition=`${tx}px ${ty}px`;
  }
  zoomBy(f){ const r=this.stage.getBoundingClientRect(); this._zoomAt(r.width/2, r.height/2, f); }
  _zoomAt(mx,my,f){ const nz=Math.max(0.3,Math.min(2.4,this.view.zoom*f));
    this.view.tx=mx-(mx-this.view.tx)*(nz/this.view.zoom); this.view.ty=my-(my-this.view.ty)*(nz/this.view.zoom);
    this.view.zoom=nz; this.applyView(); persist(); }
  fit(){
    const bs=this.f.blocks; if(!bs.length){ this.view.tx=0;this.view.ty=0;this.view.zoom=1; this.applyView(); return; }
    let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    bs.forEach(b=>{ minx=Math.min(minx,b.x);miny=Math.min(miny,b.y);maxx=Math.max(maxx,b.x+b.w);maxy=Math.max(maxy,b.y+b.h); });
    const r=this.stage.getBoundingClientRect(), pad=60;
    const z=Math.max(0.3,Math.min(1.6,Math.min(r.width/(maxx-minx+pad*2), r.height/(maxy-miny+pad*2))));
    this.view.zoom=z; this.view.tx=(r.width-(minx+maxx)*z)/2; this.view.ty=(r.height-(miny+maxy)*z)/2;
    this.applyView(); persist();
  }
  /* ---- блоки ---- */
  _newBlock(type,x,y){ const t=FLOW_TYPES[type];
    const b={id:"b_"+uid(), type, text:"", note:"", x:Math.round(x-t.w/2), y:Math.round(y-t.h/2), w:t.w, h:t.h, color:null, parent:null};
    if(type!=="frame") b.parent=this._frameAt(x,y,b.id);
    this.f.blocks.push(b); return b;
  }
  addBlockCenter(type){ const r=this.stage.getBoundingClientRect(); const p=this.worldPt(r.left+r.width/2, r.top+r.height/2);
    // лёгкий каскад, чтобы новые блоки не падали точно друг на друга
    const n=this.f.blocks.length; const b=this._newBlock(type, p.x+(n%5)*14, p.y+(n%5)*14);
    this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id); this._focusTitle(b.id);
  }
  addBlockAt(type,wx,wy){ const b=this._newBlock(type,wx,wy); this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id); this._focusTitle(b.id); }
  _frameAt(x,y,exclude){ let best=null,bestA=Infinity;
    this.f.blocks.forEach(b=>{ if(b.type!=="frame"||b.id===exclude) return;
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){ const a=b.w*b.h; if(a<bestA){bestA=a;best=b.id;} } });
    return best;
  }
  _descendants(id){ return this.f.blocks.filter(b=>b.parent===id); }
  deleteBlock(id){ const b=this._b(id); if(!b) return;
    this.f.blocks.forEach(c=>{ if(c.parent===id) c.parent=null; });   // дети рамки — на верхний уровень
    this.f.blocks=this.f.blocks.filter(x=>x.id!==id);
    this.f.edges=this.f.edges.filter(e=>e.from!==id&&e.to!==id);
    if(this.sel===id) this.sel=null;
    this.renderBlocks(); this.drawEdges(); this.save();
  }
  _blockHTML(b){
    const t=FLOW_TYPES[b.type];
    const tag = b.type!=="proc" ? `<span class="fb-tag"><i class="ti ${t.icon}"></i></span>` : "";
    const note = (b.type==="proc"||b.type==="decision"||b.type==="terminal")
      ? `<div class="fb-note" contenteditable spellcheck="false" data-ph="комментарий…">${esc(b.note||"")}</div>` : "";
    const ph = b.type==="comment"?"комментарий…" : b.type==="frame"?"название рамки" : "текст блока";
    const port = b.type!=="frame" ? `<button class="fb-port" title="Потяни — стрелка"><i class="ti ti-arrow-down"></i></button>` : "";
    const rez  = b.type==="frame" ? `<div class="fb-resize" title="Размер рамки"></div>` : "";
    return `<div class="fb-grip"><i class="ti ti-grip-horizontal"></i></div>
      <div class="fb-main">${tag}<div class="fb-title" contenteditable spellcheck="false" data-ph="${ph}">${esc(b.text||"")}</div>${note}</div>
      ${port}${rez}<button class="fb-x" title="Удалить"><i class="ti ti-x"></i></button>`;
  }
  _buildBlock(b){
    const elx=el("div","flow-block fb-"+b.type+(this.sel===b.id?" sel":""));
    elx.dataset.id=b.id; if(b.color) elx.style.setProperty("--c",b.color);
    elx.innerHTML=this._blockHTML(b); this._pos(b,elx);
    // ввод текста — пишем в данные, без ре-рендера (иначе слетает каретка)
    const ttl=$(".fb-title",elx); if(ttl) ttl.addEventListener("input",()=>{ b.text=ttl.innerText.replace(/ /g," "); this.save(); });
    const nt=$(".fb-note",elx); if(nt) nt.addEventListener("input",()=>{ b.note=nt.innerText.replace(/ /g," "); this.save(); });
    const x=$(".fb-x",elx); if(x) x.onclick=(e)=>{ e.stopPropagation(); this.deleteBlock(b.id); };
    elx.addEventListener("contextmenu",e=>{ e.preventDefault(); e.stopPropagation(); this._blockPop(b,e); });
    this.world.appendChild(elx); this.elById[b.id]=elx; return elx;
  }
  _pos(b,elx){ elx=elx||this.elById[b.id]; if(!elx) return; elx.style.left=b.x+"px"; elx.style.top=b.y+"px"; elx.style.width=b.w+"px"; elx.style.height=b.h+"px"; }
  renderBlocks(){
    $$(".flow-block",this.world).forEach(n=>n.remove()); this.elById={};
    // рамки рисуем первыми (ниже), затем остальные — порядок в DOM + z-index в CSS
    const ord=this.f.blocks.slice().sort((a,b)=>(a.type==="frame"?0:1)-(b.type==="frame"?0:1));
    ord.forEach(b=>this._buildBlock(b));
  }
  _focusTitle(id){ const elx=this.elById[id]; if(!elx) return; const t=$(".fb-title",elx); if(t){ t.focus();
    const r=document.createRange(); r.selectNodeContents(t); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); } }
  _select(id){ if(this.sel===id&&!this.selEdge) return; this.sel=id; this.selEdge=null;
    $$(".flow-block",this.world).forEach(n=>n.classList.toggle("sel",n.dataset.id===id)); this.drawEdges(); }
  /* ---- стрелки ---- */
  _addEdge(from,to){ if(from===to) return; if(this.f.edges.some(e=>e.from===from&&e.to===to)){ toast("Уже соединено"); return; }
    this.f.edges.push({id:"e_"+uid(),from,to,label:""}); this.drawEdges(); this.save(); }
  deleteEdge(id){ this.f.edges=this.f.edges.filter(e=>e.id!==id); if(this.selEdge===id) this.selEdge=null; this.drawEdges(); this.save(); this._closeFlowPop(); }
  _edgePoint(b,tx,ty){ const cx=b.x+b.w/2, cy=b.y+b.h/2; let dx=tx-cx, dy=ty-cy; if(!dx&&!dy) return {x:cx,y:cy};
    const sx=dx?(b.w/2)/Math.abs(dx):Infinity, sy=dy?(b.h/2)/Math.abs(dy):Infinity, s=Math.min(sx,sy);
    return {x:cx+dx*s, y:cy+dy*s}; }
  _scheduleEdges(){ if(this._needEdges) return; this._needEdges=true; this._eraf=requestAnimationFrame(()=>{ this._needEdges=false; this.drawEdges(); }); }
  drawEdges(){
    const NS="http://www.w3.org/2000/svg"; const g=this.feG; while(g.firstChild) g.removeChild(g.firstChild);
    this.f.edges.forEach(e=>{
      const a=this._b(e.from), b=this._b(e.to); if(!a||!b) return;
      const pa=this._edgePoint(a, b.x+b.w/2, b.y+b.h/2), pb=this._edgePoint(b, a.x+a.w/2, a.y+a.h/2);
      const sel=this.selEdge===e.id;
      const hit=document.createElementNS(NS,"line"); hit.setAttribute("class","fe-hit"); hit.dataset.id=e.id;
      hit.setAttribute("x1",pa.x);hit.setAttribute("y1",pa.y);hit.setAttribute("x2",pb.x);hit.setAttribute("y2",pb.y); g.appendChild(hit);
      const ln=document.createElementNS(NS,"line"); ln.setAttribute("class","fe-line"+(sel?" sel":"")); ln.setAttribute("marker-end","url(#fe-arrow)");
      ln.setAttribute("x1",pa.x);ln.setAttribute("y1",pa.y);ln.setAttribute("x2",pb.x);ln.setAttribute("y2",pb.y); g.appendChild(ln);
      if(e.label){ const tx=(pa.x+pb.x)/2, ty=(pa.y+pb.y)/2; const t=document.createElementNS(NS,"text");
        t.setAttribute("class","fe-label"); t.setAttribute("x",tx); t.setAttribute("y",ty-3); t.setAttribute("text-anchor","middle");
        t.textContent=e.label.length>26?e.label.slice(0,25)+"…":e.label; g.appendChild(t); }
    });
  }
  _startConnect(id,e){ this.connecting=id; this.tempEdge.style.display=""; this._updateTemp(this.worldPt(e.clientX,e.clientY)); }
  _updateTemp(wp){ const a=this._b(this.connecting); if(!a) return; const pa=this._edgePoint(a,wp.x,wp.y);
    this.tempEdge.setAttribute("d",`M ${pa.x} ${pa.y} L ${wp.x} ${wp.y}`); }
  _endConnect(){ this.connecting=null; this.tempEdge.style.display="none"; this._hoverTarget(null); }
  _hoverTarget(id){ $$(".flow-block",this.world).forEach(n=>n.classList.toggle("tgt",!!id&&n.dataset.id===id)); }
  _selectEdge(id,e){ this.sel=null; this.selEdge=id; $$(".flow-block",this.world).forEach(n=>n.classList.remove("sel")); this.drawEdges(); this._edgePop(this._edgeById(id),e); }
  _edgeById(id){ return this.f.edges.find(e=>e.id===id); }
  /* ---- ввод указателя на холсте ---- */
  _wireStage(){
    const st=this.stage;
    st.onpointerdown=(e)=>{
      if(e.button!==0) return;
      const port=e.target.closest(".fb-port");
      if(port){ e.preventDefault(); this._startConnect(port.closest(".flow-block").dataset.id,e); st.setPointerCapture(e.pointerId); return; }
      const rez=e.target.closest(".fb-resize");
      if(rez){ const b=this._b(rez.closest(".flow-block").dataset.id); this.resizing={b,sx:e.clientX,sy:e.clientY,w:b.w,h:b.h}; st.setPointerCapture(e.pointerId); return; }
      if(e.target.closest(".fb-x")) return;
      if(e.target.closest("[contenteditable]")){ const be=e.target.closest(".flow-block"); if(be) this._select(be.dataset.id); return; }
      const be=e.target.closest(".flow-block");
      if(be){ const b=this._b(be.dataset.id); this._select(b.id); const wp=this.worldPt(e.clientX,e.clientY);
        this.dragBlock={b, ox:wp.x-b.x, oy:wp.y-b.y, moved:false, kids:b.type==="frame"?this._descendants(b.id):[]};
        st.setPointerCapture(e.pointerId); this._closeFlowPop(); return; }
      const he=e.target.closest(".fe-hit");
      if(he){ this._selectEdge(he.dataset.id,e); return; }
      // пусто → пан + снять выделение
      this._select(null); this.selEdge=null; this.drawEdges(); this._closeFlowPop();
      this.panning={x:e.clientX,y:e.clientY,tx:this.view.tx,ty:this.view.ty}; st.setPointerCapture(e.pointerId);
    };
    st.onpointermove=(e)=>{
      if(this.dragBlock){ const wp=this.worldPt(e.clientX,e.clientY), b=this.dragBlock.b;
        const nx=Math.round(wp.x-this.dragBlock.ox), ny=Math.round(wp.y-this.dragBlock.oy), dx=nx-b.x, dy=ny-b.y;
        b.x=nx; b.y=ny; this._pos(b); this.dragBlock.kids.forEach(k=>{ k.x+=dx; k.y+=dy; this._pos(k); });
        this.dragBlock.moved=true; this._scheduleEdges(); return; }
      if(this.resizing){ const z=this.view.zoom, b=this.resizing.b;
        b.w=Math.max(96,Math.round(this.resizing.w+(e.clientX-this.resizing.sx)/z));
        b.h=Math.max(48,Math.round(this.resizing.h+(e.clientY-this.resizing.sy)/z)); this._pos(b); this._scheduleEdges(); return; }
      if(this.connecting){ const wp=this.worldPt(e.clientX,e.clientY); this._updateTemp(wp);
        const elx=document.elementFromPoint(e.clientX,e.clientY); const over=elx&&elx.closest?elx.closest(".flow-block"):null;
        this._hoverTarget(over&&over.dataset.id!==this.connecting?over.dataset.id:null); return; }
      if(this.panning){ this.view.tx=this.panning.tx+(e.clientX-this.panning.x); this.view.ty=this.panning.ty+(e.clientY-this.panning.y); this.applyView(); return; }
    };
    st.onpointerup=(e)=>{
      if(this.dragBlock){ const b=this.dragBlock.b;
        if(b.type!=="frame") b.parent=this._frameAt(b.x+b.w/2,b.y+b.h/2,b.id);
        this.save(); this.dragBlock=null; return; }
      if(this.resizing){ this.resizing=null; this.save(); return; }
      if(this.connecting){ const elx=document.elementFromPoint(e.clientX,e.clientY); const over=elx&&elx.closest?elx.closest(".flow-block"):null;
        if(over) this._addEdge(this.connecting, over.dataset.id); this._endConnect(); return; }
      if(this.panning){ this.panning=null; persist(); return; }
    };
    st.ondblclick=(e)=>{ if(e.target.closest(".flow-block")||e.target.closest(".fe-hit")) return; const wp=this.worldPt(e.clientX,e.clientY); this.addBlockAt("proc",wp.x,wp.y); };
    st.onwheel=(e)=>{ e.preventDefault(); const r=st.getBoundingClientRect(); this._zoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY<0?1.12:1/1.12); };
    st.oncontextmenu=(e)=>{ if(!e.target.closest(".flow-block")) e.preventDefault(); };
  }
  /* ---- поповеры ---- */
  _closeFlowPop(){ const p=$(".flow-pop",this.screen); if(p) p.remove(); }
  _placePop(pop,e){ const r=this.stage.getBoundingClientRect(); const pw=pop.offsetWidth||240, ph=pop.offsetHeight||160;
    let px=e.clientX-r.left+10, py=e.clientY-r.top+10;
    px=Math.max(8,Math.min(px,r.width-pw-8)); py=Math.max(8,Math.min(py,r.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px"; }
  _blockPop(b,e){ this._closeFlowPop(); const pop=el("div","flow-pop");
    pop.innerHTML=`
      <div class="fp-row fp-types">${FLOW_ORDER.map(k=>`<button class="fp-t ${b.type===k?"on":""}" data-t="${k}" title="${FLOW_TYPES[k].name}"><i class="ti ${FLOW_TYPES[k].icon}"></i></button>`).join("")}</div>
      <div class="swatches fp-sw">${swatchRow(b.color)}</div>
      <div class="fp-row"><button class="btn" data-fp="del"><i class="ti ti-trash"></i>Удалить блок</button></div>`;
    this.stage.appendChild(pop); this._placePop(pop,e);
    $$(".fp-t",pop).forEach(btn=>btn.onclick=()=>{ b.type=btn.dataset.t;
      if(b.type==="frame"){ b.w=Math.max(b.w,FLOW_TYPES.frame.w); b.h=Math.max(b.h,FLOW_TYPES.frame.h); }
      this._closeFlowPop(); this.renderBlocks(); this.drawEdges(); this.save(); });
    $$(".fp-sw .swatch",pop).forEach(btn=>btn.onclick=()=>{ b.color=PALETTE[+btn.dataset.ci]||null;
      const elx=this.elById[b.id]; if(elx){ if(b.color) elx.style.setProperty("--c",b.color); else elx.style.removeProperty("--c"); }
      $$(".fp-sw .swatch",pop).forEach(x=>x.classList.toggle("on",(PALETTE[+x.dataset.ci]||null)===b.color)); this.save(); });
    pop.querySelector('[data-fp="del"]').onclick=()=>{ this._closeFlowPop(); this.deleteBlock(b.id); };
  }
  _edgePop(edge,e){ if(!edge) return; this._closeFlowPop(); const pop=el("div","flow-pop");
    pop.innerHTML=`
      <div class="fp-row"><input class="fp-lab" type="text" placeholder="подпись стрелки…" value="${esc(edge.label||"")}"></div>
      <div class="fp-row"><button class="btn" data-fp="del"><i class="ti ti-unlink"></i>Убрать стрелку</button></div>`;
    this.stage.appendChild(pop); this._placePop(pop,e);
    const inp=$(".fp-lab",pop); inp.addEventListener("input",()=>{ edge.label=inp.value; this.drawEdges(); this.save(); });
    inp.addEventListener("keydown",ev=>{ if(ev.key==="Enter"){ this._closeFlowPop(); } });
    pop.querySelector('[data-fp="del"]').onclick=()=>this.deleteEdge(edge.id);
    setTimeout(()=>inp.focus(),20);
  }
  /* ---- экспорт в текст (мост: донести структуру в чат) ---- */
  _serialize(){
    const f=this.f, byId=id=>f.blocks.find(b=>b.id===id);
    const lbl=b=>(b.text&&b.text.trim())?b.text.trim().replace(/\s+/g," "):"(без текста)";
    const TN={proc:"",decision:" [решение]",terminal:" [терминал]",comment:" [коммент]",frame:""};
    const out=["Схема: "+((this.it.title||"без названия")),""];
    const ord=arr=>arr.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    const line=(b,ind)=>{ const pad="  ".repeat(ind);
      out.push(pad+"• "+lbl(b)+TN[b.type]);
      if(b.note&&b.note.trim()) out.push(pad+"    — "+b.note.trim().replace(/\s+/g," "));
      f.edges.filter(e=>e.from===b.id).forEach(e=>{ const t=byId(e.to); if(t) out.push(pad+"    → "+lbl(t)+(e.label&&e.label.trim()?" ["+e.label.trim()+"]":"")); });
    };
    ord(f.blocks.filter(b=>b.type!=="frame"&&!b.parent)).forEach(b=>line(b,0));
    ord(f.blocks.filter(b=>b.type==="frame")).forEach(fr=>{ out.push("","▸ "+lbl(fr)+" (рамка)");
      const kids=ord(f.blocks.filter(b=>b.parent===fr.id)); if(!kids.length) out.push("    (пусто)"); kids.forEach(k=>line(k,1)); });
    return out.join("\n");
  }
  copyText(){
    const txt=this._serialize();
    const m=el("div","modal"); m.innerHTML=`
      <h3><i class="ti ti-clipboard-text"></i>Схема как текст</h3>
      <div class="field"><label>Можно вставить мне в чат — я пойму структуру</label>
        <textarea id="fc-txt" style="height:240px;font-family:ui-monospace,Consolas,monospace;font-size:12.5px;white-space:pre;">${esc(txt)}</textarea></div>
      <div class="modal-foot"><div class="right">
        <button class="btn ghost" id="fc-close">Закрыть</button>
        <button class="btn primary" id="fc-copy"><i class="ti ti-copy"></i>Скопировать</button>
      </div></div>`;
    // собственный оверлей внутри flow-screen (поверх холста), чтобы не уехать под него по z-index
    const ov=el("div","flow-modal-ov"); ov.appendChild(m); this.screen.appendChild(ov);
    ov.addEventListener("mousedown",ev=>{ if(ev.target===ov) ov.remove(); });
    const ta=$("#fc-txt",m);
    $("#fc-close",m).onclick=()=>ov.remove();
    $("#fc-copy",m).onclick=()=>{ ta.focus(); ta.select();
      const done=()=>toast("Скопировано",{icon:"ti-check"});
      try{ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(done,()=>{ document.execCommand("copy"); done(); }); } else { document.execCommand("copy"); done(); } }
      catch(_){ try{ document.execCommand("copy"); done(); }catch(e){ toast("Выдели и Ctrl+C"); } } };
    setTimeout(()=>{ ta.focus(); ta.select(); },30);
  }
}

/* ===========================================================
   COMMAND PALETTE
   =========================================================== */
function openPalette(){
  const box=el("div","pal-box");
  box.innerHTML=`<input class="pal-in" id="pal-in" placeholder="Поиск задач/заметок или команда…"><div class="pal-list" id="pal-list"></div>`;
  const wrap=el("div"); wrap.id="palette"; wrap.appendChild(box);
  wrap._opener=document.activeElement;   // вернём фокус при закрытии
  wrap.addEventListener("mousedown",e=>{ if(e.target===wrap) closeOverlays(); });
  $("#overlay-root").appendChild(wrap);
  const input=$("#pal-in",box), list=$("#pal-list",box);
  let sel=0, results=[];
  const commands=[
    {t:"Новая задача",i:"ti-plus",run:()=>{closeOverlays();openItemEditor(null);}},
    {t:"Новая заметка",i:"ti-note",run:()=>{closeOverlays();openItemEditor(null,"note");}},
    {t:"Новая блок-схема",i:"ti-sitemap",run:()=>{closeOverlays();createNew("flow");}},
    {t:"Перейти: Сегодня",i:"ti-sun",run:()=>go("today")},
    {t:"Перейти: Inbox",i:"ti-inbox",run:()=>go("inbox")},
    {t:"Перейти: Задачи",i:"ti-checklist",run:()=>go("tasks")},
    {t:"Перейти: Заметки",i:"ti-affiliate",run:()=>go("notes")},
    {t:"Перейти: Календарь",i:"ti-calendar-month",run:()=>go("cal")},
    {t:"Перейти: Доска",i:"ti-layout-kanban",run:()=>go("board")},
    {t:"Перейти: Корзина",i:"ti-trash",run:()=>go("bin")},
    {t:"Управление областями",i:"ti-folders",run:()=>{closeOverlays();openAreaManager();}},
    {t:"Сделать бэкап",i:"ti-shield-check",run:()=>{closeOverlays();doBackup();}},
    {t:"Переключить тему",i:"ti-sun",run:()=>{closeOverlays();toggleTheme();}}
  ];
  function go(v){ closeOverlays(); areaFilter=null; view=v; render(); }
  const itemRow=it=>({type:"item",t:it.title,i:it.kind==="note"?"ti-note":"ti-checklist",sub:areaName(it.area),run:()=>{closeOverlays();openItemEditor(it);}});
  function compute(q){
    q=q.trim().toLowerCase();
    const cmds=commands.filter(c=>!q||c.t.toLowerCase().includes(q)).map(c=>({type:"cmd",...c}));
    if(q){
      const items=S.items.filter(it=>!it.deleted&&(String(it.title||"").toLowerCase().includes(q)||String(it.body||"").toLowerCase().includes(q)))
        .slice(0,8).map(itemRow);
      results=[...items,...cmds];
    } else {
      // пустой запрос: сверху недавние — Ctrl+K как «вернуться к тому, что делал»
      const recents=S.items.filter(it=>!it.deleted).sort((a,b)=>(b.updated||0)-(a.updated||0)).slice(0,5).map(itemRow);
      results=[...recents,...cmds];
    }
    sel=0; draw();
  }
  function draw(){
    if(!results.length){ list.innerHTML=`<div class="pal-empty">Ничего не найдено</div>`; return; }
    list.innerHTML=results.map((r,i)=>`<div class="pal-it ${i===sel?"on":""}" data-i="${i}"><i class="ti ${r.i}"></i><span>${esc(r.t)}</span>${r.sub?`<span class="pal-sub">${esc(r.sub)}</span>`:""}</div>`).join("");
    $$(".pal-it",list).forEach(e=>{ e.onmousemove=()=>{sel=+e.dataset.i;drawSel();}; e.onclick=()=>results[+e.dataset.i].run(); });
  }
  function drawSel(){ $$(".pal-it",list).forEach((e,i)=>e.classList.toggle("on",i===sel)); }
  input.addEventListener("input",()=>compute(input.value));
  input.addEventListener("keydown",e=>{
    if(e.key==="ArrowDown"){e.preventDefault();sel=Math.min(results.length-1,sel+1);drawSel();}
    else if(e.key==="ArrowUp"){e.preventDefault();sel=Math.max(0,sel-1);drawSel();}
    else if(e.key==="Enter"){e.preventDefault();if(results[sel])results[sel].run();}
    else if(e.key==="Escape"){closeOverlays();}
  });
  compute(""); setTimeout(()=>input.focus(),30);
}

/* ===========================================================
   ACTIONS: theme / backup / export / import
   =========================================================== */
function applyTheme(){ document.body.classList.toggle("light", S.settings.theme==="light");
  const ic=$("#f-theme i"); if(ic) ic.className="ti "+(S.settings.theme==="light"?"ti-moon":"ti-sun"); }
function toggleTheme(){ S.settings.theme = S.settings.theme==="light"?"dark":"light"; applyTheme(); persist(); if(view==="notes") render(); }
async function doBackup(){ const p=await Store.backup(); toast("Бэкап сохранён",{icon:"ti-shield-check"}); }
async function doExport(){ const p=await Store.exportData(S); toast(p?"Экспортировано":"Экспорт отменён",{icon:p?"ti-download":"ti-x"}); }
async function doImport(){
  const data=await Store.importData(); if(!data){ return; }
  if(!Array.isArray(data.areas) || !Array.isArray(data.items)){ toast("Файл не похож на экспорт planner",{icon:"ti-alert-triangle"}); return; }
  if(!confirm("Импорт заменит текущие данные. Продолжить?")) return;
  S=sanitizeState(Object.assign(defaultState(),data));   // валидация + нормализация перед записью на диск
  areaFilter=null; view=S.settings.view||"today"; persist(); applyTheme(); render(); toast("Импортировано");
}

function openTimer(){
  const m=el("div","modal"); m.tabIndex=-1;
  let time=25*60, running=false, interval=null;
  m.innerHTML=`<h3><i class="ti ti-clock"></i>Таймер фокуса</h3>
    <div style="font-size:56px;text-align:center;font-weight:200;letter-spacing:3px;margin:24px 0;font-variant-numeric:tabular-nums;" id="tm-display">25:00</div>
    <div class="modal-foot" style="justify-content:center;"><div class="right">
      <button class="btn primary" id="tm-start"><i class="ti ti-player-play"></i>Старт</button>
      <button class="btn ghost" id="tm-stop"><i class="ti ti-player-pause"></i>Пауза</button>
      <button class="btn ghost" id="tm-reset"><i class="ti ti-refresh"></i>Сброс</button>
    </div></div>`;
  const ov=overlay(m);
  const disp=$("#tm-display",m);
  const stop=()=>{ if(interval){clearInterval(interval);interval=null;} running=false; };
  function fmt(){ const mm=Math.floor(time/60), ss=time%60; disp.textContent=`${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`; }
  $("#tm-start",m).onclick=()=>{ if(running)return; running=true; interval=setInterval(()=>{ if(time>0){time--;fmt();}else{stop();toast("Время вышло!",{icon:"ti-clock"});}},1000); };
  $("#tm-stop",m).onclick=stop;
  $("#tm-reset",m).onclick=()=>{ stop(); time=25*60; fmt(); };
  m.addEventListener("keydown",e=>{ if(e.code==="Space"){ e.preventDefault(); running?$("#tm-stop",m).click():$("#tm-start",m).click(); } });  // пробел = старт/пауза
  // ВАЖНО: чистим интервал при закрытии оверлея (фон/Esc), иначе таймер тикает на отсоединённом узле
  const mo=new MutationObserver(()=>{ if(!ov.isConnected){ stop(); mo.disconnect(); } });
  mo.observe($("#overlay-root"),{childList:true});
  setTimeout(()=>m.focus(),30);
}

/* ===========================================================
   GLOBAL EVENTS
   =========================================================== */
function wireGlobal(){
  // window controls
  $("#win-min").onclick=()=>HasPy()&&window.pywebview.api.win_min();
  $("#win-max").onclick=()=>HasPy()&&window.pywebview.api.win_max();
  $("#win-close").onclick=()=>HasPy()&&window.pywebview.api.win_close();

  // nav + areas + footer (delegated)
  $("#side").addEventListener("click",e=>{
    const nav=e.target.closest("[data-v]"); if(nav){ areaFilter=null; view=nav.dataset.v; render(); return; }
    const ar=e.target.closest("[data-area]"); if(ar){ const id=ar.dataset.area; areaFilter=(areaFilter===id?null:id); view="tasks"; render(); return; }
  });
  $("#add-area").onclick=(e)=>{ e.stopPropagation(); openAreaEditor(null,()=>renderNav()); };
  $("#f-backup").onclick=doBackup; $("#f-export").onclick=doExport; $("#f-import").onclick=doImport; $("#f-theme").onclick=toggleTheme; $("#f-timer").onclick=openTimer;

  // head-actions delegated (кнопки заголовка: +Задача/Заметка, навигация календаря, переключатели)
  $("#head-actions").addEventListener("click",e=>{
    const nw=e.target.closest("[data-new]"); if(nw){ createNew(nw.dataset.new); return; }
    const cal=e.target.closest("[data-cal]"); if(cal){ const v=+cal.dataset.cal; if(v===0) calOffset=0; else calOffset+=v; render(); return; }
    const tg=e.target.closest("[data-toggle]"); if(tg){ if(tg.dataset.toggle==="done") showDone=!showDone; else if(tg.dataset.toggle==="clear"){ if(!confirm("Очистить корзину? Все элементы будут удалены навсегда.")) return; S.items.filter(it=>it.deleted).forEach(it=>hardDeleteItem(it.id)); render(); toast("Корзина очищена"); return; } render(); return; }
  });

  // view delegated actions
  $("#view").addEventListener("click",e=>{
    const chk=e.target.closest("[data-chk]"); if(chk){ const it=S.items.find(i=>i.id===chk.dataset.chk); if(it){ toggleDone(it); render(); const b=document.querySelector(`[data-chk="${it.id}"]`); if(b&&it.done) b.classList.add("pop"); } return; }
    const tdy=e.target.closest("[data-today]"); if(tdy){ const it=S.items.find(i=>i.id===tdy.dataset.today); if(it){ it.due=ymd(today()); if(it.status==="inbox")it.status="todo"; touch(it); persist(); render(); toast("Перенесено на сегодня",{icon:"ti-target"}); } return; }
    const ed=e.target.closest("[data-edit]"); if(ed){ const it=S.items.find(i=>i.id===ed.dataset.edit); if(it)openItemEditor(it); return; }
    const del=e.target.closest("[data-del]"); if(del){ const it=S.items.find(i=>i.id===del.dataset.del); if(it){ const id=it.id; deleteItem(id); render(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }}); } return; }
    const tf=e.target.closest("[data-tf]"); if(tf){ taskFilter=tf.dataset.tf; render(); return; }
    const go=e.target.closest("[data-goto]"); if(go){ areaFilter=null; view=go.dataset.goto; render(); return; }
    const ga=e.target.closest("[data-area]"); if(ga){ areaFilter=ga.dataset.area; view="tasks"; render(); return; }
    const nw=e.target.closest("[data-new]"); if(nw){ createNew(nw.dataset.new); return; }
  });

  // capture
  const cap=$("#cap"), capPrev=$("#cap-preview");
  // живой предпросмотр распарсенного (область/срок/повтор/приоритет) — видно, что понял парсер
  const updatePreview=()=>{
    if(!capPrev) return;
    if(!cap.value.trim()){ capPrev.innerHTML=""; capPrev.classList.remove("show"); return; }
    const p=parseCapture(cap.value); const chips=[];
    if(p.area){ const a=areaById(p.area); if(a) chips.push(`<span class="cap-chip"><i class="ti ${esc(a.icon)}"></i>${esc(a.name)}</span>`); }
    if(p.due){ const dl=dueLabel(p.due); chips.push(`<span class="cap-chip"><i class="ti ti-calendar-event"></i>${esc(dl?dl.txt:p.due)}</span>`); }
    if(p.repeat&&p.repeat!=="none") chips.push(`<span class="cap-chip"><i class="ti ti-repeat"></i>${esc(REPEAT[p.repeat])}</span>`);
    if(p.priority) chips.push(`<span class="cap-chip"><i class="ti ti-flag-3"></i>${"!".repeat(p.priority)}</span>`);
    capPrev.innerHTML=chips.join(""); capPrev.classList.toggle("show", chips.length>0);
  };
  cap.addEventListener("input",updatePreview);
  cap.addEventListener("keydown",e=>{
    if(e.key==="Enter" && cap.value.trim()){
      const p=parseCapture(cap.value);
      if(!p.title){ cap.classList.add("shake"); setTimeout(()=>cap.classList.remove("shake"),420); return; }  // не плодим «(без названия)»
      const it=addItem({kind:"task", title:p.title, area:p.area, due:p.due, repeat:p.repeat, priority:p.priority});
      cap.value=""; if(capPrev){ capPrev.innerHTML=""; capPrev.classList.remove("show"); } render();
      toast("Добавлено — "+(it.status==="inbox"?"в Inbox":"в задачи"),{icon:"ti-check"});
    }
  });

  // keyboard — используем e.code (раскладко-независимо: работает и на русской)
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey) && e.code==="KeyK"){ e.preventDefault(); if(!$("#palette"))openPalette(); return; }
    if(e.key==="Escape"){ if(graph&&graph.linkFrom){graph.cancelLink();return;} closeOverlays(); return; }
    if(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if($("#overlay-root").children.length) return;
    if(e.code==="KeyN"){ e.preventDefault(); openItemEditor(null); }
    else if(e.code==="Slash"){ e.preventDefault(); $("#cap").focus(); }
    else if(/^Digit[1-7]$/.test(e.code)){ areaFilter=null; view=NAV[+e.code.slice(5)-1][0]; render(); }
  });
}
/* ===========================================================
   TOAST
   =========================================================== */
let toastT=null;
// toast(msg) или toast(msg,{icon,label,onAction}) — с действием показывается дольше и кликабелен (Undo)
function toast(msg, opt){
  const t=$("#toast"); opt=opt||{};
  const icon=opt.icon?`<i class="ti ${esc(opt.icon)}"></i>`:"";
  t.innerHTML=icon+`<span>${esc(msg)}</span>`+(opt.label?`<button class="toast-act">${esc(opt.label)}</button>`:"");
  t.classList.remove("show"); void t.offsetWidth;            // рестарт glow-анимации на каждый показ
  t.classList.add("show"); t.style.pointerEvents=opt.onAction?"auto":"none";
  clearTimeout(toastT);
  toastT=setTimeout(()=>t.classList.remove("show"), opt.onAction?5000:1800);
  if(opt.onAction){ const b=t.querySelector(".toast-act"); if(b) b.onclick=()=>{ clearTimeout(toastT); t.classList.remove("show"); opt.onAction(); }; }
}

/* ===========================================================
   BOOT
   =========================================================== */
async function boot(){
  const loaded=await Store.load();
  if(loaded && loaded.areas){ S=sanitizeState(Object.assign(defaultState(),loaded)); }
  else { seedDemo(); await Store.save(S); }
  view=S.settings.view||"today"; applyTheme(); wireGlobal(); render();
  setTimeout(()=>{ const c=$("#cap"); if(c && !$("#overlay-root").children.length) c.focus(); }, 120);  // готов печатать мысль сразу
  // напоминание при старте
  setTimeout(()=>{
    const overdue=S.items.filter(it=>!it.deleted&&it.kind==="task"&&!it.done&&it.due&&parseYmd(it.due)<today());
    if(overdue.length) toast("⚠️ Просрочено: "+overdue.length+" задач");
  }, 600);
}
function seedDemo(){
  const A=S.areas;
  const add=(o)=>addItem(o);
  add({kind:"task",title:"Сфоткать показания счётчиков",area:"a_other",due:ymd(today()),repeat:"monthly",priority:1,status:"todo"});
  add({kind:"task",title:"Оплатить интернет",area:"a_other",due:ymd(addDays(today(),-1)),repeat:"monthly",priority:2,status:"todo"});
  add({kind:"task",title:"Реклама кофейни: смонтировать драфт 1",area:"a_work",due:ymd(addDays(today(),1)),priority:2,status:"doing",tags:["видео"]});
  add({kind:"task",title:"Подобрать музыку под ролик автосалона",area:"a_work",due:ymd(addDays(today(),2)),priority:1,status:"todo",tags:["видео","аудио"]});
  add({kind:"task",title:"Light Mixer: режим соло по коллекциям",area:"a_addon",status:"doing",tags:["blender"]});
  const n1=add({kind:"note",title:"Идея: интро с кинетик-типографикой",area:"a_work",body:"Резко, ч/б, рваный монтаж под бит.",tags:["видео","идея"]});
  const n2=add({kind:"note",title:"Палитра Teal & Orange",area:"a_work",body:"Тёмный фон, тёплая кожа, бирюза в тенях.",tags:["цвет"]});
  const n3=add({kind:"note",title:"Реф цветокора — кофейня",area:"a_work",body:"Собрать 5 кадров настроения.",tags:["цвет","видео"]});
  add({kind:"task",title:"Записаться к стоматологу",area:"a_other",status:"inbox"});
  S.links.push([n1.id,n3.id]); S.links.push([n2.id,n3.id]); persist();
}

let booted=false;
function tryBoot(){ if(booted) return; booted=true; boot(); }
// pywebview fires this when the JS<->Python bridge is ready
window.addEventListener("pywebviewready", tryBoot, {once:true});
// robust against event-race: poll for the bridge, fall back to browser mode
(function poll(n){
  if(booted) return;
  if(HasPy()){ tryBoot(); return; }      // pywebview bridge appeared
  if(n<=0){ tryBoot(); return; }          // no bridge -> plain browser
  setTimeout(()=>poll(n-1), 80);
})(16);
