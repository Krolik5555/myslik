"use strict";
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
