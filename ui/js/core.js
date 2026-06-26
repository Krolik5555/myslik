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
