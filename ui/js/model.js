"use strict";
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
