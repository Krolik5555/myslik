"use strict";
/* ===========================================================
   NOTES GRAPH
   =========================================================== */
let graph=null;
let graphCam=null;   // камера графа (tx/ty/zoom) переживает пересоздание Graph → нет рывка вьюпорта при создании ноды/связи
let graphClip=null;  // буфер копирования нод (Ctrl+C/V в графе)
/* Фаза «дыхания» ноды — детерминированно из её id, число в [0,1). FNV-1a + финальное
   лавинное перемешивание (fmix32 из murmur3). Перемешивание тут не украшение: все id
   вида Date.now()+random (core.js) делят общий 8-символьный префикс-таймстамп, и хеш
   без него дал бы соседним нодам близкие фазы — граф задышал бы синхронно, а не вразнобой.
   Math.imul обязателен: обычное умножение уйдёт в double и потеряет младшие биты. */
/* Запас области захвата ноды, мировые единицы. Прибавляется к габариту формы, поэтому у ноды
   любого размера кайма одинаково широкая — доля от размера оставляла мелкие ноды (0.4×)
   непопадаемыми, то есть не помогала там, где нужнее всего.
   Больше ~8 не ставить: каймы соседних нод начнут перекрываться, а связь у самого конца
   станет некликабельной (её собственный хитбокс — 14 px по толщине). */
const HIT_PAD=5;
const _phase=s=>{ let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  h^=h>>>15; h=Math.imul(h,2246822507)>>>0; h^=h>>>13; h=Math.imul(h,3266489909)>>>0; h^=h>>>16;
  return (h>>>0)/4294967296; };
/* фон паутины «Точечное поле» (canvas): точки рисует Graph._drawBg() каждый кадр,
   привязано к настоящему пану/зуму (this.tx/ty/zoom), бесшовно по мировому индексу тайла. */
function renderNotes(v){
  recomputeHierarchy();   // иерархия всегда выводится от области (чинит и старые данные)
  head("Заметки", notesMode==="graph"?"Граф связей · тяни узлы · двойной клик = закрепить":"Все заметки карточками",
    // Telegram переехал сюда со снесённой вкладки Inbox: мысли из бота приземляются в лоток,
    // а лоток живёт на этом же графе — значит и кнопка должна быть рядом с ним.
    `<button class="btn ghost" data-telegram="1" title="Забрать новые сообщения боту"><i class="ti ti-brand-telegram"></i>Telegram</button>
     <div class="toggle" id="notes-toggle">
       <button data-nm="graph" class="${notesMode==="graph"?"on":""}"><i class="ti ti-affiliate"></i>Граф</button>
       <button data-nm="list" class="${notesMode==="list"?"on":""}"><i class="ti ti-layout-grid"></i>Список</button>
     </div>`);   // кнопки «Заметка»/«Полотно» убраны — создаём через ПКМ по холсту
  if(notesMode==="list"){ if(graph){ const g=graph; graph=null; g.destroy(); } return renderNotesList(v); }
  v.innerHTML=`<div id="graph-wrap" style="height:calc(100vh - 210px);min-height:420px;">
    <canvas class="graph-bg-canvas"></canvas>
    <canvas class="graph-glow-canvas"></canvas>
    <svg id="graph" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="graph-toolbar">
      <button class="btn ghost" id="g-search" title="Найти ноду (название или #тег)"><i class="ti ti-search"></i></button>
      <button class="btn ghost" id="g-focus" title="Показать все ноды"><i class="ti ti-focus-2"></i></button>
      <button class="btn ghost" id="g-more" title="Ещё: перераскладка, теги"><i class="ti ti-dots"></i></button>
    </div>
    <div class="graph-more" id="g-more-menu" style="display:none">
      <button class="gm-it" id="g-refit"><i class="ti ti-arrows-shuffle"></i>Перераскладка</button>
      <button class="gm-it" id="g-tags"><i class="ti ti-tags"></i>Теги со стилем</button>
    </div>
    <div class="graph-search" id="g-search-box" style="display:none">
      <i class="ti ti-search"></i><input type="text" placeholder="Найти по названию или #тегу…" spellcheck="false"><span class="gs-count"></span><button class="gs-close" title="Закрыть (Esc)"><i class="ti ti-x"></i></button>
    </div>
    <div class="graph-legend">
      <span><span class="lg-dot hub"></span>область</span>
      <span><span class="lg-dot note"></span>заметка</span>
      <span><span class="lg-dot task"></span>задача</span>
      <span><span class="lg-dot flow"></span>полотно</span>
    </div>
    <div class="graph-hint" id="g-hint">Alt+тащи от ноды — связь/заметка · ПКМ — меню / создать · ЛКМ-рамка — выделить · средняя кнопка — двигать · колесо — зум · Delete — удалить</div>
    <div class="graph-selbar" id="g-selbar" style="display:none">
      <span class="gsb-n"></span>
      <button class="gsb-btn" id="gsb-report" title="Собрать отчёт по выделенному"><i class="ti ti-file-text"></i>Отчёт</button>
    </div>
    <div class="graph-tray" id="g-tray" style="display:none">
      <button class="gt-tab" id="gt-tab" title="Неразобранные мысли"><i class="ti ti-inbox"></i><span class="gt-n"></span></button>
      <div class="gt-body">
        <div class="gt-head"><span class="gt-ttl">Неразобранное</span><span class="gt-sub">тяни на холст</span></div>
        <div class="gt-list"></div>
      </div>
    </div>
  </div>`;
  if(graph){ const g=graph; graph=null; g.destroy(); }
  graph=new Graph($("#graph"));
  graph.build();
  $("#g-search").onclick=()=>{ const box=$("#g-search-box"); if(box && box.style.display!=="none") graph.closeSearch(); else graph.openSearch(); };
  $("#g-focus").onclick=()=>graph._fitView();
  // меню «Ещё»: редко используемые действия убраны из тулбара, чтобы не перегружать (зум — колесом)
  const moreMenu=$("#g-more-menu");
  function onDocMore(ev){ if(!document.body.contains(moreMenu)){ document.removeEventListener("pointerdown",onDocMore,true); return; }   // граф пересоздан — снять висячий слушатель
    if(!ev.target.closest("#g-more-menu") && !ev.target.closest("#g-more")) closeMore(); }
  function closeMore(){ if(moreMenu) moreMenu.style.display="none"; document.removeEventListener("pointerdown",onDocMore,true); }
  $("#g-more").onclick=(ev)=>{ ev.stopPropagation(); if(!moreMenu) return;
    if(moreMenu.style.display!=="none"){ closeMore(); }
    else { moreMenu.style.display="flex"; document.addEventListener("pointerdown",onDocMore,true); } };
  $("#g-refit").onclick=()=>{ closeMore(); graph.refit(); };
  $("#g-tags").onclick=()=>{ closeMore(); openTagManager(); };
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
  const kicn = it.kind==="flow"?"ti-artboard":"ti-note";
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
      ${(it.tags||[]).map(t=>{ const ts=tagStyle(t); return `<span class="tag hash" data-tag="${esc(t)}" title="Фильтр по тегу" ${ts&&ts.color?`style="border-color:${ts.color};color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(t)}</span>`; }).join("")}
      ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
    </div>
  </div>`;
}
// карточка задачи в дереве: чекбокс «выполнить» + компактные мета, чтобы не перегружать
function treeTaskCard(it, depth=0, hasKids){
  const conn=linksOf(it.id);
  const kids=childrenOf(it.id);
  const isChild = depth > 0;
  const dl=dueBadge(it);
  // полоска слева + флажок = СРОЧНОСТЬ (приоритет): pri-3 красный · pri-2 жёлтый · pri-1 зелёный · pri-0 нейтральный
  // дочерние получают тот же цвет, но приглушённый (см. CSS .note-card.task.child.pri-N)
  return `<div class="note-card task ${isChild?'child':'root'} ${it.done?'done':''} pri-${it.priority||0}" data-tid="${it.id}">
    <div class="nc-head">
      ${caretHTML(it, hasKids)}
      <button class="chk ${it.done?'done':''}" data-chk="${it.id}" title="Выполнить"><i class="ti ti-check"></i></button>
      <div class="nc-ttl">${esc(it.title)}</div>
    </div>
    <div class="nc-foot">
      <span class="tag"><i class="ti ti-checklist"></i>задача</span>
      ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
      ${it.priority?`<span class="pri"><i class="ti ti-flag-3"></i></span>`:""}
      ${conn.length?`<span class="tag"><i class="ti ti-link"></i>${conn.length}</span>`:""}
      ${kids.length?`<span class="tag"><i class="ti ti-sitemap"></i>${kids.length}</span>`:""}
      ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
    </div>
  </div>`;
}
// сортировка дерева: срочные задачи вперёд (приоритет ↓), затем по сроку, затем свежесть; заметки (приоритет 0) — в конце
function byUrgency(a,b){ return (b.priority||0)-(a.priority||0) || ((a.due?parseYmd(a.due):Infinity)-(b.due?parseYmd(b.due):Infinity)) || (b.updated||0)-(a.updated||0); }
// компактная строка для вкладки «Папки»: каретка + иконка типа + заголовок. Полоска слева = цвет ноды (itemColor);
// задача-с-папкой со срочностью показывает флажок справа (как в списке заметок).
function folderRowCard(it, hasKids){
  const ki=it.kind==="flow"?"ti-artboard":it.kind==="task"?"ti-checklist":"ti-note";
  const col=itemColor(it);
  const flag=(it.kind==="task" && it.priority && it.folder)?`<span class="pri" style="color:${it.priority>=3?"var(--pri3)":it.priority===2?"var(--pri2)":"var(--pri1)"}"><i class="ti ti-flag-3"></i></span>`:"";
  return `<div class="note-card ctx ${it.done?'done':''}" data-nid="${it.id}" ${col?`style="border-left-color:${col}"`:""}><div class="nc-head">${caretHTML(it,hasKids)}<i class="ti ${ki} nc-icn"></i><div class="nc-ttl">${esc(it.title)}</div>${flag}</div></div>`;
}
function renderNotesList(v){
  const nodes=S.items.filter(inWeb);   // заметки + задачи из паутины
  if(!nodes.length){ v.innerHTML=emptyBox("ti-note","Пусто. Создай заметку (кнопка сверху или <b>N</b>) или задачу."); wireNotesToggle(); return; }
  const ids=new Set(nodes.map(n=>n.id));
  const byId=id=>S.items.find(i=>i.id===id);
  const isDone=it=>it.kind==="task" && it.done;
  // архивна ли нода: она сама done-задача, ИЛИ архивен её ближайший родитель (рекурсивно вниз по дереву).
  // выполненные задачи и их поддерево «улетают» в «Завершённые», как во вкладке «Папки»;
  // активный узел НЕ утягивается в архив статусом своего потомка (только предка).
  const archMemo=new Map();
  const isArchived=it=>{
    if(archMemo.has(it.id)) return archMemo.get(it.id);
    archMemo.set(it.id,false);
    const pid=(it.parent&&ids.has(it.parent))?it.parent:null;
    const res = isDone(it) || (pid ? isArchived(byId(pid)) : false);
    archMemo.set(it.id,res); return res;
  };
  // текстовый фильтр: совпавшие по названию/телу/тегам + их предки (контекст ветки)
  const q=listQuery.trim().toLowerCase();
  let shown=nodes;
  if(q){
    const hit=n=>(n.title||"").toLowerCase().includes(q)||(n.body||"").toLowerCase().includes(q)||(n.tags||[]).some(t=>String(t).toLowerCase().includes(q));
    const keep=new Set();
    nodes.filter(hit).forEach(n=>{ let cur=n,g=new Set(); while(cur&&!g.has(cur.id)){ g.add(cur.id); keep.add(cur.id); const pid=(cur.parent&&ids.has(cur.parent))?cur.parent:null; cur=pid?byId(pid):null; } });
    shown=nodes.filter(n=>keep.has(n.id));
  }
  const activeSet=new Set(), doneSet=new Set();
  shown.forEach(n=>{ (isArchived(n)?doneSet:activeSet).add(n.id); });
  const hasParentIn=(it,set)=> it.parent && set.has(it.parent);
  const seen=new Set();                                   // защита от дублей и циклов в иерархии
  // рекурсивно: карточка + ВСЕ её потомки из того же набора (активные/архив)
  function branch(it, depth, set){
    if(seen.has(it.id)) return "";
    seen.add(it.id);
    let h=noteCard(it, depth);
    if(isCollapsed(it.id)) return h;   // свёрнут — детей не показываем
    const kids=childrenOf(it.id)
      .filter(k=>set.has(k.id))
      .sort(byUrgency);
    if(kids.length) h+=`<div class="tree-branch">`+kids.map(k=>branch(k, depth+1, set)).join("")+`</div>`;
    return h;
  }
  function group(roots, set, sortFn){ return `<div class="notes-tree">`+roots.slice().sort(sortFn||byUrgency).map(r=>branch(r,0,set)).join("")+`</div>`; }
  function sec(key, icon, name, count, colorStyle){
    const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`;
  }
  let h=`<div class="tf-chips"><span class="list-find"><i class="ti ti-search"></i><input id="list-filter" type="text" placeholder="Фильтр…" value="${esc(listQuery)}" spellcheck="false"></span></div>`;
  if(q && !shown.length) h+=emptyBox("ti-search","Ничего не нашлось по фильтру «"+esc(listQuery.trim())+"».");
  // корни (без родителя В ТОМ ЖЕ наборе) группируем по области корня; потомки вкладываются под корнем независимо от их области
  S.areas.forEach(a=>{
    const roots=nodes.filter(it=>activeSet.has(it.id) && it.area===a.id && !hasParentIn(it,activeSet));
    if(!roots.length) return;
    const key="area:"+a.id;
    h+=sec(key, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed(key)) h+=group(roots,activeSet);
  });
  const noArea=nodes.filter(it=>activeSet.has(it.id) && !it.area && !hasParentIn(it,activeSet));
  if(noArea.length){
    h+=sec("area:__none", "ti-circle-dashed", "Без области", noArea.length, "");
    if(!isCollapsed("area:__none")) h+=group(noArea,activeSet);
  }
  // ЗАВЕРШЁННЫЕ: выполненная задача (и её активные потомки) уезжают сюда целиком, свежие сверху
  const doneRoots=nodes.filter(it=>doneSet.has(it.id) && !hasParentIn(it,doneSet));
  if(doneRoots.length){
    const key="notes:done", c=isCollapsed(key);
    h+=`<div class="sec sec-collapse fld-done-sec" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ti-checks"></i>Завершённые<span class="sec-cnt">${doneRoots.length}</span></div>`;
    if(!c) h+=group(doneRoots, doneSet, (a,b)=>(b.doneAt||0)-(a.doneAt||0));
  }
  v.innerHTML=h;
  // свернуть/развернуть область или поддерево
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс обрабатывает делегат #view (toggleDone)
    if(e.target.closest("[data-tag]")) return;       // клик по тегу — фильтр (делегат #view)
    if(e.target.closest("[data-collapse]")) return;  // каретка сворачивания
    if(e.target.closest("[data-openfolder]")) return; // кнопка папки — делегат #view
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(!it) return;
    openItemSmart(it);
  });
  wireListFilter(v);
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
    this.bgPanX=0; this.bgPanY=0;   // мировой сдвиг фон-параллакса: копится ТОЛЬКО от пана (не от зума/фита) → зум читается чисто
    this.raf=null;
    this.selNodes=new Set(); this.marq=null;   // выделение нод (клик/shift-клик/рамка) + удаление по Delete
    this._watchResize();
  }
  /* РАЗМЕР ОКНА. W/H и viewBox раньше ставились ТОЛЬКО в build(), а окно меняет размер и без него
     (фулскрин, разворот, тяга за край). Тогда слои разъезжались: SVG со старым viewBox браузер
     просто РАСТЯГИВАЛ на новый размер, а свечение и фон рисуются канвасом в его СЕГОДНЯШНИХ
     пикселях (см. _drawGlow) — и свет уезжал от своих нод тем сильнее, чем больше стало окно.
     Камеру правим так, чтобы мировая точка в центре экрана осталась в центре: иначе при каждом
     развороте окна граф прыгал бы вбок. */
  _watchResize(){
    if(typeof ResizeObserver==="function"){ this._ro=new ResizeObserver(()=>this._onResize()); this._ro.observe(this.svg); }
    this._onWinResize=()=>this._onResize();   // подстраховка: ResizeObserver не доставляется, пока окно скрыто
    window.addEventListener("resize", this._onWinResize);
  }
  _onResize(){
    const w=this.svg.clientWidth, h=this.svg.clientHeight;
    if(!w || !h || (w===this.W && h===this.H)) return false;
    const wx=(this.W/2-this.tx)/this.zoom, wy=(this.H/2-this.ty)/this.zoom;   // мировая точка в центре экрана
    this.W=w; this.H=h;
    this.svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
    this.tx=w/2-wx*this.zoom; this.ty=h/2-wy*this.zoom;                       // она же остаётся в центре
    this._applyTransform();
    if(!this._paused) this._tick(true);   // перерисовать сразу: в покое кадр мог бы быть пропущен
    return true;
  }
  _paintSel(){ if(this.nodeEls) this.nodeEls.forEach(o=>o.g.classList.toggle("sel",this.selNodes.has(o.n.id))); this._renderSelBar(); }
  // панель действий над выделением (кнопка «Отчёт»); показывается когда выбран ≥1 реальный элемент
  _renderSelBar(){
    const wrap=this.svg.parentNode; if(!wrap) return;
    const bar=wrap.querySelector("#g-selbar"); if(!bar) return;
    const ids=[...this.selNodes].filter(id=>this.byId[id]&&this.byId[id].ref);
    if(!ids.length){ bar.style.display="none"; return; }
    bar.style.display="";
    const nEl=bar.querySelector(".gsb-n"); if(nEl) nEl.textContent="Выделено: "+ids.length;
    const rep=bar.querySelector("#gsb-report");
    if(rep && !rep._wired){ rep._wired=true; rep.onclick=()=>{
      const items=[...this.selNodes].map(id=>this.byId[id]&&this.byId[id].ref).filter(Boolean);
      if(typeof openReportModal==="function") openReportModal(items);
    }; }
  }
  _startMarquee(e){ const wrap=this.svg.parentNode; let el=wrap.querySelector(".graph-marquee");
    if(!el){ el=document.createElement("div"); el.className="graph-marquee"; wrap.appendChild(el); }
    this._marqEl=el; const rc=wrap.getBoundingClientRect();
    this.marq={x0:e.clientX,y0:e.clientY,rc,base:new Set(this.selNodes)};
    el.style.display=""; el.style.left=(e.clientX-rc.left)+"px"; el.style.top=(e.clientY-rc.top)+"px"; el.style.width="0px"; el.style.height="0px";
  }
  _updateMarquee(e){ const m=this.marq, rc=m.rc;
    const x1=Math.min(m.x0,e.clientX),y1=Math.min(m.y0,e.clientY),x2=Math.max(m.x0,e.clientX),y2=Math.max(m.y0,e.clientY);
    this._marqEl.style.left=(x1-rc.left)+"px"; this._marqEl.style.top=(y1-rc.top)+"px"; this._marqEl.style.width=(x2-x1)+"px"; this._marqEl.style.height=(y2-y1)+"px";
    const w1=this._pt({clientX:x1,clientY:y1}), w2=this._pt({clientX:x2,clientY:y2});
    // hit-тест по ВИДИМОЙ позиции (с idle-дрейфом), как рисуется нода — иначе у краёв рамки промахи
    const hit=this.nodes.filter(n=>{ const nx=n.x+(n._ix||0), ny=n.y+(n._iy||0); return nx>=w1.x && nx<=w2.x && ny>=w1.y && ny<=w2.y; }).map(n=>n.id);
    this.selNodes=new Set([...m.base,...hit]); this._paintSel();
  }
  _finishMarquee(){ this.marq=null; if(this._marqEl) this._marqEl.style.display="none"; }
  /* ---- поиск ноды по названию + перелёт камеры ---- */
  openSearch(){ const box=$("#g-search-box"); if(!box) return; this._searchBox=box; box.style.display="flex";
    const inp=$("input",box), cnt=$(".gs-count",box), cl=$(".gs-close",box); inp.value=""; this._searchMatches=[]; this._searchIdx=0;
    if(cl) cl.onclick=()=>this.closeSearch();
    inp.oninput=()=>{ const n=this.search(inp.value); cnt.textContent=inp.value.trim()?(n?(this._searchIdx+1)+"/"+n:"0"):""; };
    inp.onkeydown=(e)=>{ e.stopPropagation();
      if(e.key==="Enter"){ e.preventDefault(); this.searchNext(); cnt.textContent=this._searchMatches.length?(this._searchIdx+1)+"/"+this._searchMatches.length:"0"; }
      else if(e.key==="Escape"){ e.preventDefault(); this.closeSearch(); } };
    setTimeout(()=>inp.focus(),20);
  }
  search(q){ q=(q||"").trim().toLowerCase().replace(/^#/,"");
    if(!q){ this._searchMatches=[]; this._clearSearchDim(); return 0; }
    const matches=this.nodes.filter(n=>(n.label||"").toLowerCase().includes(q) || (n.ref && (n.ref.tags||[]).some(t=>String(t).toLowerCase().includes(q))));   // по названию ИЛИ тегу
    this._searchMatches=matches; this._searchIdx=0;
    const ids=new Set(matches.map(n=>n.id));
    this.nodeEls.forEach(o=>o.g.classList.toggle("dim", matches.length>0 && !ids.has(o.n.id)));   // гасим несовпадающие
    this.linkEls.forEach(e=>e.classList.toggle("dim", matches.length>0));
    if(matches.length) this._flyTo(matches[0]);
    return matches.length;
  }
  searchNext(){ const m=this._searchMatches; if(!m||!m.length) return; this._searchIdx=(this._searchIdx+1)%m.length; this._flyTo(m[this._searchIdx]); }
  _flyTo(n){ this.selNodes=new Set([n.id]); this._paintSel();
    const z=Math.max(this.zoom,0.9); this._tweenView(z, this.W/2-n.x*z, this.H/2-n.y*z); }
  _clearSearchDim(){ if(this.nodeEls) this.nodeEls.forEach(o=>o.g.classList.remove("dim")); if(this.linkEls) this.linkEls.forEach(e=>e.classList.remove("dim")); }
  closeSearch(){ if(this._searchBox) this._searchBox.style.display="none"; this._clearSearchDim(); }
  copySelection(){
    const ids=[...this.selNodes].filter(id=>this.byId[id]&&this.byId[id].ref); if(!ids.length) return;
    const idset=new Set(ids);
    const items=ids.map(id=>{ const it=this.byId[id].ref, n=this.byId[id];
      return {_old:id, kind:it.kind, title:it.title, body:it.body, area:it.area, color:it.color||null, size:it.size||null,
        tags:(it.tags||[]).slice(), status:it.status, done:!!it.done, doneAt:it.doneAt||null, due:it.due||null, repeat:it.repeat||"none", priority:it.priority||0,
        flow:it.kind==="flow"?JSON.parse(JSON.stringify(it.flow||{})):null, x:n.x, y:n.y }; });
    const links=(S.links||[]).filter(l=>idset.has(l[0])&&idset.has(l[1])).map(l=>[l[0],l[1],+l[2]||1]);
    graphClip={items,links}; toast("Скопировано: "+ids.length,{icon:"ti-copy"});
  }
  pasteClip(){
    if(!graphClip||!graphClip.items.length) return; const map={}, off=28, newIds=[];
    graphClip.items.forEach(d=>{
      const it=addItem({kind:d.kind,title:d.title,body:d.body,area:d.area,color:d.color,tags:(d.tags||[]).slice(),status:d.status,due:d.due,repeat:d.repeat,priority:d.priority});
      if(d.size) it.size=d.size;
      // согласуем done/status/doneAt (иначе вставленная выполненная задача = status:done но done:false)
      it.done=!!d.done;
      if(it.done){ it.status="done"; it.doneAt=d.doneAt||Date.now(); }
      else if(it.status==="done"){ it.status="todo"; it.doneAt=null; }
      if(d.kind==="flow"&&d.flow){ it.flow=JSON.parse(JSON.stringify(d.flow)); ensureFlow(it); }
      it.x=(d.x||0)+off; it.y=(d.y||0)+off;
      map[d._old]=it.id; newIds.push(it.id);
    });
    graphClip.links.forEach(l=>{ const a=map[l[0]], b=map[l[1]]; if(a&&b) S.links.push([a,b,l[2]||1]); });
    persist(); recomputeHierarchy(); this.selNodes=new Set(newIds); this.build(); this._paintSel();
    toast("Вставлено: "+newIds.length,{icon:"ti-clipboard-check"});
  }
  _startConnectDrag(n,e){ this.connectDrag=n.id; this._closePop(); const p=this._pt(e);
    this.tempLine.style.display=""; this.tempLine.setAttribute("x1",n.x); this.tempLine.setAttribute("y1",n.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y); }
  // быстрое создание ноды (kind: note/task/flow) в точке (wx,wy); fromId!=null → сразу связать;
  // note/task → инлайн-ввод названия (поток мысли не рвётся), flow → открываем редактор схемы
  _quickAdd(kind,wx,wy,fromId){
    // Область родителя НЕ наследуем: Alt от ноды, которая сама лежит в области, молча приписывал
    // новую мысль туда же — а человек всего лишь тянул связь, про область речи не было.
    // Область — отдельное решение: бросить ноду на её кружок (см. _linkTo).
    // Цвет тоже не копируем: новая нода сразу связана с родителем, а значит подхватит его цвет
    // вычислением в build() — и будет подхватывать дальше, пока человек не назначит свой.
    const data={kind, title:"", area:areaFilter||null};
    if(kind==="task") data.status="todo";
    const it=addItem(data);
    it.x=Math.round(wx); it.y=Math.round(wy); persist();
    if(fromId) addLink(fromId, it.id);
    recomputeHierarchy(); this.build();
    if(kind==="flow") openFlowEditor(it); else this._inlineRename(it.id);
  }
  // меню «Создать» по ПКМ на пустом месте холста — заметка / задача / схема в точке клика
  _openCreateMenu(e){
    this._closePop(); const wrap=$("#graph-wrap"); if(!wrap) return; const rc=this.svg.getBoundingClientRect(); const wp=this._pt(e);
    const pop=el("div","g-ctx"); pop.id="node-pop";
    pop.innerHTML=`
      <div class="np-ttl"><i class="ti ti-plus"></i> Создать здесь</div>
      <div class="np-col">
        <button class="btn" data-mk="note"><i class="ti ti-note"></i>Заметка</button>
        <button class="btn" data-mk="task"><i class="ti ti-checklist"></i>Задача</button>
        <button class="btn" data-mk="flow"><i class="ti ti-artboard"></i>Полотно</button>
      </div>`;
    wrap.appendChild(pop);
    const pw=pop.offsetWidth||180, ph=pop.offsetHeight||170;
    let px=e.clientX-rc.left+6, py=e.clientY-rc.top+6;
    px=Math.max(8,Math.min(px,rc.width-pw-8)); py=Math.max(8,Math.min(py,rc.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px";
    $$("[data-mk]",pop).forEach(b=>b.onclick=()=>{ const k=b.dataset.mk; this._closePop(); this._quickAdd(k,wp.x,wp.y,null); });
  }
  _inlineRename(id){
    const n=this.byId[id]; if(!n) return; const wrap=$("#graph-wrap"); if(!wrap) return;
    const old=wrap.querySelector(".g-inline"); if(old) old.remove();
    const inp=document.createElement("input"); inp.className="g-inline"; inp.value=n.ref?n.ref.title:""; inp.placeholder="Название…";
    wrap.appendChild(inp);
    const m=this.root.getScreenCTM(); if(m){ const pt=this.svg.createSVGPoint(); pt.x=n.x; pt.y=n.y; const sp=pt.matrixTransform(m); const rc=wrap.getBoundingClientRect(); inp.style.left=(sp.x-rc.left)+"px"; inp.style.top=(sp.y-rc.top)+"px"; }
    const commit=(save)=>{ if(inp._done) return; inp._done=true; const v=inp.value.trim();
      if(save){ if(n.ref){ n.ref.title=v||"Новая заметка"; touch(n.ref); persist(); } }
      else if(n.ref && !(n.ref.title||"").trim()){ hardDeleteItem(n.ref.id); recomputeHierarchy(); }   // Escape по только что созданной пустой → убрать ноду-сироту (и связь)
      inp.remove(); this.build(); };
    inp.onkeydown=(ev)=>{ ev.stopPropagation(); if(ev.key==="Enter"){ ev.preventDefault(); commit(true); } else if(ev.key==="Escape"){ ev.preventDefault(); commit(false); } };
    inp.onblur=()=>commit(true);
    setTimeout(()=>{ inp.focus(); inp.select(); },20);
  }
  deleteSelected(){
    const ids=[...this.selNodes].filter(id=>this.byId[id] && this.byId[id].ref);   // только заметки/задачи/схемы, не области-хабы
    if(!ids.length) return;
    const snap=ids.slice();
    ids.forEach(id=>deleteItem(id)); this.selNodes.clear(); recomputeHierarchy(); this.build();
    toast(ids.length>1?ids.length+" удалено":"Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ snap.forEach(id=>restoreItem(id)); recomputeHierarchy(); render(); }});
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
    this.glowCanvas=this.svg.parentNode?this.svg.parentNode.querySelector(".graph-glow-canvas"):null;   // слой цветной подсветки «в работе»
    this.glowCtx=this.glowCanvas?this.glowCanvas.getContext("2d"):null;
    this._bgReduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(graphCam){ this.tx=graphCam.tx; this.ty=graphCam.ty; this.zoom=graphCam.zoom; }   // восстановить камеру ДО размещения (для центра вида)
    const cx=this.W/2, cy=this.H/2;
    // сохраняем текущие позиции узлов, чтобы при перестроении (смена цвета/связи) граф не «прыгал»
    const prev=this.byId||{};
    this.nodes=[]; this.links=[]; this.byId={};
    // area hubs (можно закреплять и таскать, позиция/пин хранятся на самой области)
    S.areas.forEach((a,i)=>{
      const ang=(i/S.areas.length)*Math.PI*2;
      // ЖИВАЯ позиция (prev) важнее сохранённой. Раньше было наоборот, и это ломало граф:
      // перетаскивание поднимает alpha, физика раскладывает узлы, а на диск они попадают только
      // когда симуляция ОСТЫНЕТ (~5 с, см. _tick). Любой build() в это окно — создал ноду, удалил
      // ноду — откатывал ВЕСЬ граф к последним сохранённым координатам. Сохранённая нужна только
      // как запасной вариант: при первой сборке и после перезапуска prev пуст.
      const p=prev["hub_"+a.id];
      const x = p ? p.x : (a.x!=null?a.x:cx+Math.cos(ang)*90);
      const y = p ? p.y : (a.y!=null?a.y:cy+Math.sin(ang)*90);
      this.nodes.push({id:"hub_"+a.id, hubArea:a, label:a.name, type:"hub", r:11, fixed:!!a.pin, color:areaColor(a.id),
        x, y, vx:0, vy:0, _fresh:(a.x==null && !p)});
    });
    // На холсте — только РАЗМЕЩЁННЫЕ ноды. Нет координат (x==null) = мысль ещё не разобрана:
    // она лежит в лотке и ждёт, пока её вытянут на холст (см. _renderTray). Это не новое поле —
    // элемент и так рождается без координат (model.js), раньше граф просто выдумывал их за человека,
    // сажая ноду в центр вида. Ставит координаты только сам человек, бросив ноду из лотка.
    // Важно: неразмещённые не попадают в this.nodes, поэтому _tick до них не дотянется и не
    // запишет им позицию при остывании раскладки — метка «в лотке» не сотрётся сама собой.
    const onGraph=S.items.filter(it=>inWeb(it) && it.x!=null);
    // потухание: ЗАДАЧА тухнет по своему done (незавершённая подзадача остаётся яркой).
    // ЗАМЕТКА/СХЕМА статуса не имеют → наследуют завершённость от родителя (тухнут в завершённой ветке).
    const _onIds=new Set(onGraph.map(i=>i.id));
    const _byIdIt=id=>S.items.find(i=>i.id===id);
    const _fMemo=new Map();
    const _isFaded=it=>{
      if(_fMemo.has(it.id)) return _fMemo.get(it.id);
      _fMemo.set(it.id,false);   // защита от циклов в иерархии
      let res;
      if(it.kind==="task") res=!!it.done;
      else { const pid=(it.parent&&_onIds.has(it.parent))?it.parent:null; res=pid?_isFaded(_byIdIt(pid)):false; }
      _fMemo.set(it.id,res); return res;
    };
    const _todayT=(typeof today==="function")?+today():0;
    onGraph.forEach(it=>{
      // Живая позиция важнее сохранённой — см. коммент у хабов выше. Сюда доходят только
      // размещённые (it.x!=null), поэтому запасной вариант — просто it.x, без выдумывания места.
      const p=prev[it.id];
      const x = p ? p.x : it.x, y = p ? p.y : it.y;
      const ts=itemTagStyle(it);
      const arch=_isFaded(it);
      // «в работе» — ручная пометка (отдельный явный вид: заливка + цветное свечение).
      const doing = it.kind==="task" && !it.done && it.status==="doing";
      const n={id:it.id, ref:it, label:it.title, type:it.kind, done:it.done, area:it.area,
        archived:arch, doing:doing, status:it.status,
        color: it.color || (ts&&ts.color) || (it.area?areaColor(it.area):null) || null, tagStyle:ts,
        r:7, x, y, vx:0, vy:0, fixed:!!it.pin, _fresh:false};   // элемент на холсте всегда размещён (иначе он в лотке) — «свежих» среди них не бывает
      this.nodes.push(n);
    });
    // Фаза «дыхания» — от ID, а НЕ от индекса в массиве. Раньше было Math.sin(t + i*1.7): при
    // добавлении/удалении ноды build() пересобирает this.nodes, индексы съезжают (addItem кладёт
    // элемент в НАЧАЛО, model.js), у всех меняется фаза — и весь граф разом дёргался на 6-7 px.
    // Хеш от id даёт ту же фазу всегда: между build(), сессиями и перезапусками. Считаем здесь,
    // один раз за build, а не в _tick — иначе хеш строки × все ноды × 60 кадров в секунду.
    // Для Y — ОТДЕЛЬНЫЙ хеш: с одной фазой на обе оси все ноды пошли бы по одинаковой траектории.
    this.nodes.forEach(n=>{ this.byId[n.id]=n;
      n._ph=_phase(n.id)*Math.PI*2; n._ph2=_phase(n.id+"~y")*Math.PI*2; });

    // manual links first, remember pairs to dedupe auto area-links
    const pairs=new Set();
    S.links.forEach(l=>{ if(this.byId[l[0]]&&this.byId[l[1]]){ this.links.push({a:l[0],b:l[1],L:108,manual:true,lenMul:(+l[2]||1),src:l}); pairs.add(l[0]+"|"+l[1]); pairs.add(l[1]+"|"+l[0]); } });
    onGraph.forEach(it=>{ const hub="hub_"+it.area; if(it.area && this.byId[hub] && !pairs.has(it.id+"|"+hub)) this.links.push({a:it.id,b:hub,L:78,manual:false}); });

    this.adj={}; this.nodes.forEach(n=>this.adj[n.id]=new Set());
    this.links.forEach(l=>{ this.adj[l.a].add(l.b); this.adj[l.b].add(l.a); });

    /* ЦВЕТ ОТ СОСЕДА. Нода без своего цвета (и без тега/области) берёт цвет соседа — заново при
       каждой отрисовке, пока человек не назначит ей свой. Поэтому в палитре у неё честно горит
       прочерк: цвет одолжен, а не присвоен.
       Цвет идёт ПО ЦЕПОЧКЕ: одолживший красит следующего, тот — следующего, и так до конца ветки.
       Раздаём слоями (поиск в ширину от цветных нод), поэтому:
       - цвет достаётся от БЛИЖАЙШЕГО источника, а не от случайного;
       - циклы не зациклят: уже покрашенных не трогаем;
       Правило: побеждает БЛИЖАЙШИЙ источник, а при ничьей — смесь ничейных (mixColors, OKLab).
       То есть цепочка, висящая на красной ноде, красная целиком, а нода, стоящая ровно МЕЖДУ
       красной и синей, — промежуточная. Раздаём слоями, поэтому ближайший находится сам собой.
       Пробовал «смесь всех источников с весом 1/расстояние²» — не годится: на больших дистанциях
       веса сближаются (1/16 против 1/25 — это 61% на 39%), и источник в пяти шагах перекрашивал
       чужую ветку в розовый. А ограничение радиуса давало разрыв: нода за границей резко
       становилась чистого цвета.
       Область цвет НЕ одалживает и НЕ проводит сквозь себя: она источник, а не получатель.
       Иначе одна цветная заметка красила свою область снизу вверх, а та разносила этот цвет
       всем остальным своим детям — то есть работала мостом между несвязанными ветками.
       Хаб не красим — значит он не попадёт в слой, значит и дальше ничего не передаст. */
    const rcv=id=>{ const n=this.byId[id]; return n && n.type!=="hub"; };
    const paint=new Map();
    this.nodes.forEach(n=>{ if(n.color) paint.set(n.id,n.color); });   // источники: свой цвет / тег / область
    let layer=new Set(paint.keys());
    while(layer.size){
      const next=new Map();
      const add=(id,c)=>{ const a=next.get(id); if(a) a.push(c); else next.set(id,[c]); };
      this.links.forEach(l=>{
        if(layer.has(l.a) && !paint.has(l.b) && rcv(l.b)) add(l.b, paint.get(l.a));
        if(layer.has(l.b) && !paint.has(l.a) && rcv(l.a)) add(l.a, paint.get(l.b));
      });
      next.forEach((cols,id)=>paint.set(id, mixColors(cols)));   // пришло несколько с одного расстояния — смешиваем
      layer=new Set(next.keys());
    }
    this.nodes.forEach(n=>{ if(!n.color) n.color=paint.get(n.id)||null; });
    // размер узла по «популярности» (числу связей) — как в Obsidian: чем больше связей, тем крупнее
    this.nodes.forEach(n=>{
      const deg=this.adj[n.id].size;
      const nsz=(S.settings.graphNodeSize!=null?S.settings.graphNodeSize:1);    // глобальный множитель размера
      const dsc=(S.settings.graphDegScale!=null?S.settings.graphDegScale:1);    // насколько размер зависит от числа связей
      const tsz=(n.tagStyle&&n.tagStyle.size)?n.tagStyle.size:1;                 // множитель размера из тега
      const psz=(n.ref&&+n.ref.size?+n.ref.size:1)*tsz;                          // индивидуальный (it.size) × тег
      if(n.type==="hub"){ n.r=(11+Math.min(deg*0.7*dsc,11))*nsz; }
      else { n.r=(6+Math.min(Math.sqrt(deg)*3*dsc,9))*nsz*psz; }
      if(n.type==="task"||n.type==="flow") n.r*=0.86;   // квадрат/ромб визуально крупнее круга той же r → ужимаем, чтобы размер отражал именно связи
    });
    // завершённые уходят на второй план: сами ноды меньше, а связи ВНУТРИ ветки (оба конца потухли)
    // — короче (тот же множитель длины) и тусклее. Так дерево реально ужимается, а не только точки.
    const _doneScale=(S.settings.graphDoneScale!=null?S.settings.graphDoneScale:0.6);
    const _doneLen=(S.settings.graphDoneLinkLen!=null?S.settings.graphDoneLinkLen:0.6);
    if(_doneScale!==1) this.nodes.forEach(n=>{ if(n.archived) n.r*=_doneScale; });
    this.links.forEach(l=>{ const na=this.byId[l.a], nb=this.byId[l.b];
      const fa=na&&na.archived, fb=nb&&nb.archived, hubLink=(na&&na.type==="hub")||(nb&&nb.type==="hub");
      l.faded = !!(fa && fb);                              // оба конца потухли → тусклая связь целиком
      l.doneMul = ((fa||fb) && !hubLink) ? _doneLen : 1;   // короче при потухшем конце, НО связь с областью (hub) не трогаем
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
    const DIMC=getComputedStyle(document.body).getPropertyValue("--bd2").trim()||"#3a3a3a";   // цвет «потухшего» конца связи
    this.links.forEach((l,i)=>{
      const hit=document.createElementNS(NS,"path"); hit.setAttribute("class","g-hit"); hit.dataset.li=i;
      this.linkG.appendChild(hit); this.hitEls.push(hit);
      const e=document.createElementNS(NS,"path"); e.setAttribute("class","g-link"+(l.manual?" manual":"")+(l.faded?" faded":"")); e.dataset.li=i;
      const na=this.byId[l.a], nb=this.byId[l.b];
      // потухший конец связи «перетекает» в тусклый цвет (как потухшие ноды); яркий конец — свой цвет/белый
      const ea = na.archived ? DIMC : na.color;
      const eb = nb.archived ? DIMC : nb.color;
      if(l.faded){ /* оба конца потухли — целиком тусклая нейтральная линия (.g-link.faded) */ }
      else if(ea||eb){
        const NC=NEUTRAL(); const fea=ea||NC, feb=eb||NC;
        // inline style: presentation attrs lose to the stylesheet's .g-link rule
        if(fea!==feb){
          const gid="grad"+i; const grad=document.createElementNS(NS,"linearGradient");
          grad.setAttribute("id",gid); grad.setAttribute("gradientUnits","userSpaceOnUse");
          const s1=document.createElementNS(NS,"stop"); s1.setAttribute("offset","0%"); s1.setAttribute("stop-color",fea);
          const s2=document.createElementNS(NS,"stop"); s2.setAttribute("offset","100%"); s2.setAttribute("stop-color",feb);
          grad.appendChild(s1); grad.appendChild(s2); this.defs.appendChild(grad);
          e.style.stroke="url(#"+gid+")"; l._grad=grad;
        } else { e.style.stroke = fea; }
      }
      if(!l.faded){ const lb=(S.settings.graphLinkBright!=null?S.settings.graphLinkBright:1);   // яркость обычных связей
        e.style.strokeWidth=(l.manual?1.8:1.3); e.style.opacity=Math.min(1,(l.manual?1:0.8)*lb); }
      else { e.style.opacity=(S.settings.graphFadedBright!=null?S.settings.graphFadedBright:0.5); }   // яркость потухших связей
      this.linkG.appendChild(e); this.linkEls.push(e);
    });

    this.nodeEls=this.nodes.map(n=>{
      const g=document.createElementNS(NS,"g"); g.setAttribute("class","g-node "+n.type+(n.done?" done":"")+(n.archived?" faded":"")+(n.doing?" doing":"")); g.dataset.id=n.id;
      if(n.color) g.style.setProperty("--nc", n.color);   // цвет ноды в CSS-переменную (для заливки «в работе» её же тоном и для подсветки)
      let halo=null;
      if(n.type==="hub"){ halo=document.createElementNS(NS,"circle"); halo.setAttribute("class","g-halo"); halo.setAttribute("r",n.r+5); if(n.color)halo.style.stroke=n.color; g.appendChild(halo); }
      // форма: из тега (если задана), иначе по типу ноды
      const shapeKind = (n.tagStyle&&n.tagStyle.shape) ? n.tagStyle.shape : (n.type==="task"?"square":n.type==="flow"?"diamond":"circle");
      // Невидимый круг вокруг ноды — попадать мышкой в кружок радиусом 7 px неудобно.
      // Кладём ПОД фигуру: по центру события ловит сама фигура, по кайме — этот круг, и оба
      // всё равно всплывают до .g-node.
      // Запас — ПОСТОЯННЫЙ в мировых единицах, а не в долях от размера: доля давала мизерную
      // прибавку мелким нодам (размер настраивается от 0.4×), то есть ровно там, где промахи
      // и случаются. Считаем от дальней точки формы — у квадрата и ромба это угол (r*1.41),
      // у круга и шестиугольника сам радиус, — иначе у квадрата углы торчали бы за каймой.
      // дальняя точка формы: у квадрата и ромба это угол, у круга и шестиугольника — радиус
      const far = (shapeKind==="square"||shapeKind==="diamond") ? n.r*1.41 : n.r;
      let hit=null;
      if(n.type!=="hub"){
        hit=document.createElementNS(NS,"circle"); hit.setAttribute("class","g-nhit");
        hit.setAttribute("r", (far+HIT_PAD).toFixed(1));
        g.appendChild(hit);
      }
      const shape = this._shapeEl(NS, shapeKind, n.r);
      shape.classList.add("sh-"+shapeKind);   // ромб поворачивается через CSS (см. .sh-diamond) — атрибут transform конфликтует с масштабом при наведении
      if(n.color && !n.archived){
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
      // иконка тега прямо в ноде (глиф шрифта Tabler)
      let ticon=null;
      if(n.tagStyle&&n.tagStyle.icon){ const gl=iconGlyph(n.tagStyle.icon);
        if(gl){ ticon=document.createElementNS(NS,"text"); ticon.setAttribute("class","g-ticon"); ticon.setAttribute("text-anchor","middle"); ticon.textContent=gl;
          if(n.color && n.type!=="hub") ticon.style.fill=n.color; g.appendChild(ticon); } }
      const t=document.createElementNS(NS,"text"); t.setAttribute("class","g-label"+(n.type==="hub"?" hub":"")); t.setAttribute("text-anchor","middle");
      const _lbl=(n.type!=="hub" && !(n.label||"").trim()) ? "(без названия)" : n.label;   // пустые ноды видимо подписываем, чтобы их можно было опознать и удалить
      t.textContent=_lbl.length>22?_lbl.slice(0,21)+"…":_lbl;
      if(_lbl==="(без названия)") t.classList.add("g-label-empty");
      g.appendChild(t);
      this.nodeG.appendChild(g);
      return {g, shape, halo, check, pin, t, ticon, hit, shapeKind, n};
    });
    this._wire();
    this._paintSel();   // вернуть подсветку выделения после перестроения
    if(graphCam){ this.tx=graphCam.tx; this.ty=graphCam.ty; this.zoom=graphCam.zoom; }   // восстановить камеру → вьюпорт не прыгает при ребилде
    this._applyTransform();   // сразу ставим трансформу на новый корень (иначе кадр рисуется в (0,0) до первого пана)
    // первичная раскладка — полный «разогрев»; перестроение (цвет/связь) — лёгкое, чтобы граф не прыгал
    // плавный старт: позиции уже сохранены → не дёргаем (alpha 0); новые узлы мягко вписываются (0.12);
    // совсем новый граф — умеренный разогрев (0.4). Скорость клампится в _tick (плавный глайд без рывков),
    // а осевшая раскладка сохраняется (см. _moved) → следующее открытие статично, без повторного «взрыва».
    const freshN=this.nodes.filter(n=>n._fresh).length, placedN=this.nodes.length-freshN;
    this.alpha = placedN>0 ? (freshN>0 ? 0.12 : 0) : (this.nodes.length>1 ? 0.4 : 0);
    this._renderTray();   // лоток всегда в такт с холстом: нода ушла на холст — исчезла из лотка
    this._tick(true);     // ОБЯЗАТЕЛЬНО рисуем: фигуры выше созданы без координат, пропуск кадра оставил бы граф пустым
  }
  _circle(NS,r){ const c=document.createElementNS(NS,"circle"); c.setAttribute("class","nd"); c.setAttribute("r",r); return c; }
  _rect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",2.5); return s; }
  _rrect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",r*0.55); return s; }   // нода-схема: скруглённый квадрат
  _hexagon(NS,r){ const p=document.createElementNS(NS,"polygon"); p.setAttribute("class","nd"); return p; }   // точки ставятся в _tick
  _shapeEl(NS,kind,r){ return kind==="square"?this._rect(NS,r) : kind==="diamond"?this._rrect(NS,r) : kind==="hexagon"?this._hexagon(NS,r) : this._circle(NS,r); }
  _hexPts(x,y,r){ let s=""; for(let i=0;i<6;i++){ const a=Math.PI/180*(60*i-90); s+=(x+r*Math.cos(a)).toFixed(1)+","+(y+r*Math.sin(a)).toFixed(1)+" "; } return s.trim(); }

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
      if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; }   // прервать переезд камеры при ручном действии
      if(e.button===1){ e.preventDefault(); this.panning={x:e.clientX,y:e.clientY,tx:this.tx,ty:this.ty,bx:this.bgPanX,by:this.bgPanY}; svg.setPointerCapture(e.pointerId); this._closePop(); return; }   // средняя кнопка — пан
      if(e.button!==0) return;   // ПКМ обрабатывает oncontextmenu
      const g=e.target.closest(".g-node");
      if(g){
        const n=this.byId[g.dataset.id];
        if(this.linkFrom){ this._finishLink(n); return; }
        if(e.altKey && n.type!=="hub"){ this._startConnectDrag(n,e); svg.setPointerCapture(e.pointerId); return; }   // Alt+тащи от ноды — связь / новая связанная заметка
        if(e.shiftKey){ if(this.selNodes.has(n.id)) this.selNodes.delete(n.id); else this.selNodes.add(n.id); this._paintSel(); return; }   // shift-клик — в выделение
        if(!this.selNodes.has(n.id)){ this.selNodes.clear(); this.selNodes.add(n.id); this._paintSel(); }   // обычный клик по ноде — выделить
        // Смещение захвата: за какую точку ноды взялись. Без него нода при старте
        // перетаскивания прыгала центром под курсор — схватил за край, а она дёрнулась.
        this.drag=n; n._moved=false; this._dragFrom={x:e.clientX,y:e.clientY};
        { const p0=this._pt(e); this._grab={dx:n.x-p0.x, dy:n.y-p0.y}; }
        svg.setPointerCapture(e.pointerId);
        return;
      }
      const lk=e.target.closest(".g-hit");
      if(lk && !this.linkFrom){ this._openLinkPop(this.links[+lk.dataset.li], e); return; }
      // ЛКМ по пустому — рамка выделения (пан теперь средней кнопкой)
      if(!e.shiftKey){ this.selNodes.clear(); this._paintSel(); }
      this._startMarquee(e); svg.setPointerCapture(e.pointerId); this._closePop();
    };
    svg.onpointermove=(e)=>{
      if(this.connectDrag){ const f=this.byId[this.connectDrag], p=this._pt(e);
        this.tempLine.setAttribute("x1",f.x); this.tempLine.setAttribute("y1",f.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y);
        const elx=document.elementFromPoint(e.clientX,e.clientY), tg=elx&&elx.closest?elx.closest(".g-node"):null; this._hover(tg&&tg.dataset.id!==this.connectDrag?tg.dataset.id:null); return; }
      if(this.marq){ this._updateMarquee(e); return; }
      if(this.drag){
        // Порог 4 px (системная константа Windows SM_CXDRAG): пока мышь не ушла дальше — это КЛИК,
        // ноду не двигаем. Без порога любая дрожь в 1 px считалась перетаскиванием: нода уезжала
        // (при отдалении — на несколько мировых px, т.к. мир = экран/zoom), а клик и двойной клик
        // не засчитывались вовсе. Отсюда же «двойной клик срабатывает через раз».
        if(!this.drag._moved){
          const f=this._dragFrom;
          if(f && Math.hypot(e.clientX-f.x, e.clientY-f.y) < 4) return;
          this.drag._moved=true;
        }
        // тянем за ТУ ЖЕ точку, за которую взялись (см. _grab) — нода не прыгает центром под курсор
        const p=this._pt(e), g=this._grab||{dx:0,dy:0};
        this.drag.x=p.x+g.dx; this.drag.y=p.y+g.dy; this.drag.vx=0; this.drag.vy=0;
        this.alpha=Math.max(this.alpha,.4); return;
      }
      if(this.panning){ const rc=svg.getBoundingClientRect(); this.tx=this.panning.tx+(e.clientX-this.panning.x)/rc.width*this.W; this.ty=this.panning.ty+(e.clientY-this.panning.y)/rc.height*this.H;
        this.bgPanX=this.panning.bx+(this.tx-this.panning.tx)/this.zoom; this.bgPanY=this.panning.by+(this.ty-this.panning.ty)/this.zoom;   // пан двигает параллакс (в мировых ед.); зум — нет
        this._applyTransform(); return; }
      if(this.linkFrom){ const p=this._pt(e); const f=this.byId[this.linkFrom]; this.tempLine.style.display=""; this.tempLine.setAttribute("x1",f.x); this.tempLine.setAttribute("y1",f.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y); return; }
      const g=e.target.closest(".g-node"); this._hover(g?g.dataset.id:null);
    };
    svg.onpointerup=(e)=>{
      if(this.connectDrag){ const from=this.connectDrag; this.connectDrag=null; this.tempLine.style.display="none"; this._hover(null);
        const elx=document.elementFromPoint(e.clientX,e.clientY), g=elx&&elx.closest?elx.closest(".g-node"):null;
        if(g){ const msg=this._linkTo(from, g.dataset.id); if(msg){ recomputeHierarchy(); this.build(); toast(msg); } }   // бросок на область назначает её (см. _linkTo)
        else { const p=this._pt(e); this._quickAdd("note",p.x,p.y,from); }   // отпустил на пустом → новая заметка + связь
        return; }
      if(this.marq){ this._finishMarquee(); return; }
      if(this.drag){
        const n=this.drag;
        if(n._moved){   // позиции пишем ТОЛЬКО после настоящего перетаскивания — клик не должен трогать файл
          if(n.ref){ n.ref.x=n.x; n.ref.y=n.y; persist(); }
          else if(n.hubArea){ n.hubArea.x=n.x; n.hubArea.y=n.y; persist(); }   // позиция области
        } else {
          // ручное определение двойного клика (надёжнее нативного dblclick при pointer capture)
          // Два РАЗНЫХ окна, их нельзя мерить одним числом:
          //   350 мс — сколько ждём второй клик (двойной клик должен ловиться уверенно);
          //   170 мс — через сколько показать превью (отклик на одиночный клик).
          // Раньше это было одно число: чтобы двойной клик не промахивался, превью ждало
          // все 350 мс и ощущалось вязким. Теперь превью успевает показаться, а если второй
          // клик всё же пришёл — _openNode его закроет (он зовёт _closePop) и откроет ридер.
          const now=Date.now();
          if(this._lcId===n.id && (now-this._lcT)<350){
            this._lcId=null; this._lcT=0;
            clearTimeout(this._pvT); this._pvT=null;
            this._openNode(n);
          } else {
            this._lcId=n.id; this._lcT=now;
            clearTimeout(this._pvT);
            this._pvT=setTimeout(()=>{ this._pvT=null; this._openPreview(n); }, 170);
          }
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
      this._openCreateMenu(e);   // ПКМ по пустому — меню «Создать» (заметка/задача/схема), вместо двойного клика
    };
    svg.onwheel=(e)=>{ e.preventDefault(); if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; } const rc=svg.getBoundingClientRect();
      const mx=(e.clientX-rc.left)/rc.width*this.W, my=(e.clientY-rc.top)/rc.height*this.H;
      const f=e.deltaY<0?1.12:0.89; const nz=Math.max(.12,Math.min(2.5,this.zoom*f));   // нижний предел 0.12 — можно отдалиться сильно, чтобы уместить большой граф
      this.tx=mx-(mx-this.tx)*(nz/this.zoom); this.ty=my-(my-this.ty)*(nz/this.zoom); this.zoom=nz; this._applyTransform();
    };
  }
  _applyTransform(){
    graphCam={tx:this.tx,ty:this.ty,zoom:this.zoom};   // запоминаем камеру для следующего пересоздания графа
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
    // Когда окно НЕактивно, браузер замораживает requestAnimationFrame, а _tick (который рисует
    // фон-canvas) вместе с ним. Тогда зум/пан колесом двигает SVG, но звёздный фон отстаёт —
    // «фон слетает». Пока фокуса нет, перерисовываем фон СРАЗУ здесь (когда фокус есть — рисует _tick).
    if(!document.hasFocus()){
      try{ this._drawBg(); this._drawGlow(); }catch(e){}
    }
  }
  // фон «звёздное поле»: 5 слоёв глубины с параллаксом (par) + собственный дрейф/мерцание точек.
  // ZOOM-масштаб слоёв = чистый z (zs=1) — при зуме звёзды масштабируются ВМЕСТЕ с миром и не «плывут»,
  // а параллакс (par) остаётся на ПАНЕ — тот самый эффект глубины, ради которого всё делалось.
  _drawBg(){
    const cv=this.bgCanvas, ctx=this.bgCtx; if(!cv||!ctx) return;
    const cw=cv.clientWidth, ch=cv.clientHeight; if(!cw||!ch) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){ cv.width=Math.round(cw*dpr); cv.height=Math.round(ch*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const w=cw, h=ch;
    ctx.clearRect(0,0,w,h);   // базу даёт var(--surf) на #graph-wrap → тема подхватывается сама
    if(S.settings.graphBg===false) return;   // фон «звёздное поле» выключен в настройках
    const light=document.body.classList.contains("light");
    const dot=light?"0,0,0":"255,255,255";
    const ts=this._bgReduce?0:performance.now()*0.001;
    const z=this.zoom;
    const hash=(a,b)=>{ let n=(a*374761393+b*668265263)|0; n=(n^(n>>>13))*1274126177|0; return ((n>>>0)%100000)/100000; };
    // спрайт-«звезда»: радиальный градиент (яркий центр → мягкое затухание). Строится раз, пересобирается при смене темы.
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
    // 5 слоёв: par=параллакс пана, sp=шаг, sz=полуразмер спрайта, a=яркость, wob=амплитуда собств. дрейфа.
    // zs (зум-масштаб) у ВСЕХ = 1 → при зуме все слои масштабируются ровно как мир, не отрываясь по масштабу.
    const layers=[
      {par:0.06, sp:36,  sz:1.4, a:light?0.040:0.028, wob:4 },
      {par:0.20, sp:50,  sz:2.0, a:light?0.060:0.045, wob:7 },
      {par:0.42, sp:68,  sz:2.9, a:light?0.085:0.070, wob:11},
      {par:0.68, sp:90,  sz:3.9, a:light?0.120:0.100, wob:15},
      {par:1.00, sp:118, sz:5.4, a:light?0.175:0.150, wob:20}
    ];
    for(let li=0;li<layers.length;li++){
      const L=layers[li]; let tile=L.sp*z; if(tile<5) continue;
      // При сильном отдалении тайл мельчает → тайлов на экран становятся тысячи. Раньше стоял
      // жёсткий лимит в 420 звёзд, и он ОБРЫВАЛ отрисовку на верхних рядах — низ фона оставался
      // чёрным (обрезка). Теперь вместо обрыва РАЗРЕЖАЕМ тайл до бюджета: слой рисуется ЦЕЛИКОМ и
      // покрывает весь экран, просто реже. Бюджет ограничивает стоимость кадра.
      const _CAP=2600, _nt=(Math.ceil(w/tile)+2)*(Math.ceil(h/tile)+2);
      if(_nt>_CAP) tile*=Math.sqrt(_nt/_CAP);
      // мировой сдвиг слоя от параллакса: копится ТОЛЬКО от пана (bgPan). origin слоя = мировая точка,
      // умноженная на общий зум/сдвиг → при зуме слой масштабируется РОВНО как мир (курсор-точка неподвижна, чисто).
      const loX=-this.bgPanX*(1-L.par), loY=-this.bgPanY*(1-L.par);
      const totX=-(this.tx+loX*z), totY=-(this.ty+loY*z);
      const offX=((totX)%tile+tile)%tile, offY=((totY)%tile+tile)%tile;
      const baseX=Math.floor(totX/tile), baseY=Math.floor(totY/tile);
      const cols=Math.ceil(w/tile)+2, rows=Math.ceil(h/tile)+2, dr=L.sz*z, wobA=L.wob*z;
      for(let gy=-1; gy<rows; gy++){ for(let gx=-1; gx<cols; gx++){
        const ci=gx+baseX, cj=gy+baseY;
        const hx=hash(ci+li*131,cj+li*977), hy=hash(ci+li*491,cj+li*263), ho=hash(ci+li*53,cj+li*97);
        const jx=(hx-0.5)*tile*0.5, jy=(hy-0.5)*tile*0.5;
        // собственный дрейф (Lissajous, фаза из хеша) + медленное дыхание яркости
        const wx=Math.sin(ts*0.16+hx*6.283)*wobA, wy=Math.cos(ts*0.13+hy*6.283)*wobA;
        const breathe=0.35+0.65*(0.5+0.5*Math.sin(ts*0.18+ho*6.283));
        const x=gx*tile-offX+jx+wx, y=gy*tile-offY+jy+wy;
        if(x<-dr-2||x>w+dr+2||y<-dr-2||y>h+dr+2) continue;
        ctx.globalAlpha=L.a*breathe;
        ctx.drawImage(star, x-dr, y-dr, dr*2, dr*2);
      }}
    }
    ctx.globalAlpha=1;
  }
  // цветная подсветка «в работе»: каждая doing-нода светит СВОИМ цветом (радиальный градиент),
  // блобы накладываются → свет соседних doing-нод смешивается. Слой между звёздами и нодами.
  _drawGlow(){
    const cv=this.glowCanvas, ctx=this.glowCtx; if(!cv||!ctx) return;
    const cw=cv.clientWidth, ch=cv.clientHeight; if(!cw||!ch) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){ cv.width=Math.round(cw*dpr); cv.height=Math.round(ch*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cw,ch);
    const s=S.settings;
    if(s.graphDoingGlow===false) return;
    // цвет НЕ обязателен: в палитре первый кружок = null («по умолчанию», рисуется белым),
    // такие ноды тоже должны светиться — берём им нейтральный цвет темы, как и заливка в CSS
    // (там фолбэк var(--nc, var(--acc))). Иначе белая doing-нода оставалась без свечения.
    const doing=this.nodes.filter(n=>n.doing);
    if(!doing.length) return;
    const z=this.zoom, tx=this.tx, ty=this.ty;
    const R=(s.graphDoingGlowRadius!=null?s.graphDoingGlowRadius:110)*z;
    const inten=(s.graphDoingGlowBright!=null?s.graphDoingGlowBright:0.3);
    const blur=(s.graphDoingGlowBlur!=null?s.graphDoingGlowBlur:30);
    const rgbOf=(c)=>{ c=(c||"").trim(); if(c[0]==="#"){ let h=c.slice(1); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; const n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; } const m=c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m?[+m[1],+m[2],+m[3]]:null; };
    const neutral=NEUTRAL();   // --acc: тот же «белый по умолчанию», которым нода и рисуется
    ctx.save();
    if(blur>0) ctx.filter="blur("+blur+"px)";
    doing.forEach(n=>{
      const rgb=rgbOf(n.color||neutral); if(!rgb) return;
      const x=(n.x+(n._ix||0))*z+tx, y=(n.y+(n._iy||0))*z+ty;   // мир → экран (та же трансформа, что у корня графа)
      if(x<-R-blur||x>cw+R+blur||y<-R-blur||y>ch+R+blur) return;
      const grd=ctx.createRadialGradient(x,y,0,x,y,R);
      grd.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},${inten})`);
      grd.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(x,y,R,0,6.283); ctx.fill();
    });
    ctx.restore();
    // связи не должны «просвечивать» свечением: стираем свечение ровно из-под линий связей.
    // «дырки» невидимы — они всегда закрыты либо самой связью, либо нодой сверху (endpoints в центрах нод).
    ctx.save(); ctx.globalCompositeOperation="destination-out"; ctx.strokeStyle="#000"; ctx.lineWidth=2.5; ctx.lineCap="round"; ctx.beginPath();
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) return;
      const ax=(a.x+(a._ix||0))*z+tx, ay=(a.y+(a._iy||0))*z+ty, bx=(b.x+(b._ix||0))*z+tx, by=(b.y+(b._iy||0))*z+ty;
      ctx.moveTo(ax,ay); ctx.lineTo(bx,by);
    });
    ctx.stroke(); ctx.restore();
  }
  /* Превью по одиночному клику: заглянуть внутрь, не открывая. Показывается через 350 мс —
     ждём, не будет ли второго клика (тогда открывается ридер, а превью отменяется).
     Переиспользуем id="node-pop": позиционирование и закрытие по клику мимо уже работают на нём. */
  _openPreview(n){
    this._closePop();
    const it=n.ref; if(!it) return;
    this.sel=n.id;
    const km = it.kind==="flow"?{i:"ti-artboard",n:"полотно"} : it.kind==="note"?{i:"ti-note",n:"заметка"} : {i:"ti-checklist",n:"задача"};
    const conn=linksOf(it.id);
    const body=(it.body||"").trim();
    const pv=el("div"); pv.id="node-pop"; pv.className="node-preview";
    pv.innerHTML=`
      <div class="np-ttl">${esc(it.title)||"<i>без названия</i>"}</div>
      <div class="np-meta">
        <span><i class="ti ${km.i}"></i> ${km.n}</span>
        ${it.done?`<span><i class="ti ti-check"></i>готово</span>`:(it.status==="doing"?`<span><i class="ti ti-player-play"></i>в работе</span>`:"")}
        ${it.area?`<span><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${conn.length?`<span><i class="ti ti-link"></i>${conn.length}</span>`:""}
      </div>
      <div class="pv-body">${it.kind==="flow" ? "<i>схема на полотне</i>" : (body?esc(body):"<i>пусто</i>")}</div>
      <div class="np-row"><button class="btn" data-pv="open"><i class="ti ${it.kind==="flow"?"ti-artboard":"ti-eye"}"></i>Открыть</button></div>`;
    $("#graph-wrap").appendChild(pv);
    this._posPop(pv,n);
    // «Открыть» ведёт в ЧИТАЛЬНЫЙ вид, а не в редактор: из превью человек хочет прочитать
    // подробности, а не править поля. Задачи раньше открывались формой правки (Тип/Повтор/
    // Приоритет…) — она выглядит как настройки и к чтению отношения не имеет.
    // Полотно — исключение: у него нет текста, только своя схема.
    pv.querySelector('[data-pv="open"]').onclick=()=>{
      this._closePop();
      if(it.kind==="flow") openFlowEditor(it); else openNoteReader(it);
    };
  }

  _openNode(n){
    // двойной клик: область → фильтр задач; заметка → ридер; задача → редактор
    this._closePop();
    if(n.type==="hub"){ areaFilter=n.id.replace("hub_",""); view="tasks"; render(); return; }
    const it=n.ref; if(!it) return;
    openItemSmart(it);
  }
  // наведение на ноду (Obsidian-стиль): узел+соседи+связи между ними ПОДСВЕЧИВАЮТСЯ (.hl),
  // всё остальное гаснет (.dim). Плавно (transition в CSS). id=null — снять.
  _hover(id){
    this.nodeEls.forEach(o=>{ const nid=o.n.id; const focus=!!id&&nid===id, nbr=!!id&&this.adj[id].has(nid);
      o.g.classList.toggle("dim", !!id && !focus && !nbr);
      o.g.classList.toggle("hl", focus||nbr);
      o.g.classList.toggle("hl-focus", focus);
    });
    this.linkEls.forEach((e,i)=>{ const l=this.links[i]; const on=!id||l.a===id||l.b===id;
      e.classList.toggle("dim", !!id && !on);
      e.classList.toggle("hl", !!id && on);
    });
  }
  // путь связи — прямая линия (дуги отвергнуты: читались как жёсткие арки, а не «мягкие»)
  _linkPath(ax,ay,bx,by){ return `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`; }
  startLink(id){ this.linkFrom=id; this.svg.classList.add("linking"); $("#g-hint").innerHTML="Режим связи: кликни по второму узлу. Esc — отмена."; this._closePop(); }
  cancelLink(){ this.linkFrom=null; this.svg.classList.remove("linking"); this.tempLine.style.display="none"; if($("#g-hint"))$("#g-hint").innerHTML="Alt+тащи от ноды — связь/заметка · ПКМ — меню / создать · ЛКМ-рамка — выделить · средняя кнопка — двигать · Delete — удалить"; }
  // Связать два узла. Связывать можно с чем угодно (заметка/задача/область), но не сам с собой
  // и не область с областью. ОБЛАСТЬ — ОСОБЫЙ СЛУЧАЙ: членство в области это поле it.area, а не
  // связь — линию элемент↔область граф рисует сам (см. build). Поэтому конец в хабе означает
  // «назначить область», а не addLink: хранимая связь заслонила бы авто-связь (pairs в build),
  // и «Открепить» в поп-апе связи перестало бы снимать область.
  // Возвращает текст тоста, либо null если связывать нечего.
  _linkTo(from, to){
    if(to===from) return null;
    const fh=from.indexOf("hub_")===0, th=to.indexOf("hub_")===0;
    if(fh && th) return null;                        // область с областью не связываем
    if(fh || th){
      const it=S.items.find(x=>x.id===(fh?to:from));
      if(!it) return null;
      const aid=(fh?from:to).slice(4);
      if(it.area===aid) return "Уже в области";
      it.area=aid;
      touch(it); persist();
      return "В области: "+areaName(aid);
    }
    // Цвет от соседа тут НЕ пишем: он ВЫЧИСЛЯЕТСЯ в build() при каждой отрисовке, пока
    // у ноды нет своего. Запись сделала бы наследование одноразовым и заморозила бы цвет.
    return addLink(from,to) ? "Связь создана" : "Уже связаны";
  }
  _nodeAt(e){ const el=document.elementFromPoint(e.clientX,e.clientY); const g=el&&el.closest?el.closest(".g-node"):null; return g?g.dataset.id:null; }
  /* ЛОТОК неразобранного: мысли, брошенные в строку захвата, ждут тут, пока их не поставят на холст.
     Пусто — лотка не видно совсем: разбирать нечего, нечего и мозолить глаза.
     Свёрнутость живёт в настройках, а не в поле класса: разметка графа пересоздаётся на каждый
     render(), и поле обнулялось бы при каждом возврате на вкладку. */
  _renderTray(){
    const wrap=this.svg.parentNode; if(!wrap) return;
    const tray=wrap.querySelector("#g-tray"); if(!tray) return;
    const loose=S.items.filter(it=>inWeb(it) && it.x==null);
    if(!loose.length){ tray.style.display="none"; $(".gt-list",tray).innerHTML=""; return; }   // и список чистим, иначе в скрытом лотке остаются мёртвые строки
    tray.style.display="";
    const open=S.settings.trayOpen===true;   // по умолчанию свёрнут: бросил мысль — увидел цифру, а не раскрытую панель поперёк холста
    tray.classList.toggle("closed",!open);
    $(".gt-n",tray).textContent=loose.length;
    $(".gt-tab",tray).title=open?"Свернуть":"Неразобранных: "+loose.length;
    $(".gt-tab",tray).onclick=()=>{ S.settings.trayOpen=!open; persist(); this._renderTray(); };
    if(!open){ $(".gt-list",tray).innerHTML=""; return; }   // свёрнут — список не строим вовсе
    const ic=it=>it.kind==="flow"?"ti-artboard":it.kind==="note"?"ti-note":"ti-checklist";
    $(".gt-list",tray).innerHTML=loose.map(it=>{ const t=(it.title||"").trim()||"(без названия)";
      return `<div class="gt-it" data-tid="${it.id}" title="${esc(t)}"><i class="ti ${ic(it)}"></i><span>${esc(t)}</span><button class="gt-del" data-del="${it.id}" title="Удалить в корзину"><i class="ti ti-x"></i></button></div>`; }).join("");
    // тащить на холст — но не когда жмут на крестик удаления
    $$(".gt-it",tray).forEach(el=>{ el.onpointerdown=e=>{ if(e.button===0 && !e.target.closest(".gt-del")) this._trayGrab(e,el); }; });
    // удалить элемент из лотка (мягко, в Корзину, с отменой)
    $$(".gt-del",tray).forEach(b=>{
      b.onpointerdown=e=>e.stopPropagation();   // не запускать перетаскивание
      b.onclick=e=>{ e.stopPropagation(); const id=b.dataset.del;
        deleteItem(id); render();
        toast("Удалено в корзину",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }});
      };
    });
  }
  /* Тянем мысль из лотка на холст. Бросил на пустое место — она там и встала (это и есть «разобрал»).
     Бросил на ноду — встала и привязалась к ней (через _linkTo, поэтому бросок на область назначит область).
     Подсветку цели дёргаем ТОЛЬКО при её смене: на каждый mousemove она перекрашивала бы весь граф. */
  _trayGrab(e, el){
    const id=el.dataset.tid, it=S.items.find(x=>x.id===id); if(!it) return;
    e.preventDefault();
    const wrap=this.svg.parentNode, rc=wrap.getBoundingClientRect();
    const ghost=el.cloneNode(true); ghost.className="gt-ghost"; wrap.appendChild(ghost);
    const at=ev=>{ ghost.style.left=(ev.clientX-rc.left)+"px"; ghost.style.top=(ev.clientY-rc.top)+"px"; };
    at(e);
    let over=null;
    const move=ev=>{ at(ev); const t=this._nodeAt(ev); if(t!==over){ over=t; this._hover(t); } };
    const up=ev=>{
      el.removeEventListener("pointermove",move); el.removeEventListener("pointerup",up); el.removeEventListener("pointercancel",up);
      try{ el.releasePointerCapture(ev.pointerId); }catch(_){}
      ghost.remove(); this._hover(null);
      const target=this._nodeAt(ev);                       // ищем ДО перестроения, пока DOM ещё прежний
      const sr=this.svg.getBoundingClientRect();
      if(ev.clientX<sr.left||ev.clientX>sr.right||ev.clientY<sr.top||ev.clientY>sr.bottom) return;   // мимо холста — пусть лежит дальше
      const p=this._pt(ev);
      it.x=Math.round(p.x); it.y=Math.round(p.y); touch(it); persist();
      recomputeHierarchy(); this.build();                  // теперь нода есть в byId — можно связывать
      let msg=null;
      if(target && target!==id){ msg=this._linkTo(id,target);
        if(msg){ recomputeHierarchy(); this.build(); this.alpha=Math.max(this.alpha,0.12); } }   // бросил прямо на ноду — мягко разведём, чтобы не легли друг на друга
      toast(msg||"На холсте",{icon:"ti-check"});
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove",move); el.addEventListener("pointerup",up); el.addEventListener("pointercancel",up);
  }
  /* Покрасить ноду — и всё выделение заодно, если кликнутая нода в нём (тыкать по одной грустно).
     Если НЕ в нём — красим только её: ПКМ выделения не трогает, и покрасить невидимые «те пять
     из прошлой рамки» вместо той, по которой ткнули, было бы сюрпризом.
     persist/build — ОДИН раз в конце: в цикле это N записей на диск и N полных перестроений SVG.
     Рамка выделения хватает и области — у них цвет живёт на самой области, а не на элементе,
     и тянет за собой все ноды, что этот цвет наследуют. Поэтому в тосте считаем их отдельно. */
  _paintColor(n, col){
    const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
    const undo=[]; let nn=0, na=0;
    ids.forEach(id=>{
      if(id.indexOf("hub_")===0){ const a=areaById(id.slice(4)); if(a){ undo.push([id,a.color||null]); a.color=col; na++; } }
      else { const it=S.items.find(x=>x.id===id); if(it){ undo.push([id,it.color||null]); it.color=col; touch(it); nn++; } }
    });
    if(!undo.length) return;
    persist(); this.build();
    // Перевесить отметку выбора: палитра рисуется ОДИН раз при открытии поп-апа и запоминает
    // цвет, который был тогда. Без этого кольцо остаётся на прежнем кружке — жмёшь оранжевый,
    // а обведён зелёный. Поп-ап build() не пересоздаёт, так что правим его на месте.
    const pop=$("#node-pop");
    if(pop) $$(".np-sw .swatch",pop).forEach(b=>b.classList.toggle("on",(PALETTE[+b.dataset.ci]||null)===col));
    if(undo.length<2) return;   // одну ноду красят перебором — тост на каждый кружок был бы шумом
    const back=()=>{ undo.forEach(([id,c])=>{
        if(id.indexOf("hub_")===0){ const a=areaById(id.slice(4)); if(a) a.color=c; }
        else { const it=S.items.find(x=>x.id===id); if(it){ it.color=c; touch(it); } } });
      persist(); this.build(); };
    toast("Цвет · "+[nn?"нод: "+nn:"", na?"областей: "+na:""].filter(Boolean).join(", "),
          {icon:"ti-palette", label:"Вернуть", onAction:back});
  }
  _finishLink(n){
    // иерархию не задаём вручную — она выводится от области (см. recomputeHierarchy)
    const msg=this._linkTo(this.linkFrom, n.id);
    if(msg){ recomputeHierarchy(); toast(msg); this.cancelLink(); this.build(); return; }
    this.cancelLink();
  }
  refit(){
    // пере-раскладка: незакреплённые узлы расходятся заново, затем (когда остынет) обзор вписывается под всё дерево.
    // it.x НЕ обнуляем: nullом теперь помечены ноды, которые лежат в лотке и на холст ещё не попали
    // (см. build), так что обнуление здесь сослало бы в лоток весь граф — да ещё и с записью на диск.
    // Оно тут и не нужно: позиции ниже ставятся на самих узлах, а на диск попадут, когда раскладка остынет.
    this.nodes.forEach(n=>{ if(!n.fixed){ n.x=this.W/2+(Math.random()-.5)*420; n.y=this.H/2+(Math.random()-.5)*320; }});
    this.alpha=1; this._needFit=true;
  }
  /* force=true — нарисовать кадр ОБЯЗАТЕЛЬНО, не пропуская. Так зовёт build(): фигуры он создаёт
     БЕЗ координат (их ставит этот метод), поэтому пропуск первого же кадра оставлял бы весь граф
     невидимым. Раньше это и происходило: пропуск ниже работает через раз, а если окно не в фокусе
     (например, открыт системный диалог выбора папки), то кадр не только пропускался, но и следующий
     не планировался — raf=null. Ноды исчезали до первого клика или движения графа. */
  _tick(force){
    // ТРОТТЛИНГ В ПОКОЕ: когда симуляция успокоилась (alpha=0), камера статична и ничего не тащим —
    // «дыхание» узлов и мерцание фона медленные (период 30-40с), рисуем через кадр (~30fps вместо 60).
    // На глаз не отличить, а нагрузка кадра падает вдвое. Любая активность (alpha>0, пан/зум, драг) → полный 60fps.
    const camKey=this.tx.toFixed(2)+"|"+this.ty.toFixed(2)+"|"+this.zoom.toFixed(4);
    const camMoving=camKey!==this._camKey; this._camKey=camKey;
    const busy=this.drag||this.connectDrag||this.panning||this.marq||this.linkFrom;
    if(!force && this.alpha===0 && !camMoving && !busy){ this._sk=(this._sk||0)^1; if(this._sk){ this.raf=this._paused?null:requestAnimationFrame(()=>this._tick()); return; } }
    this._drawBg();
    this._drawGlow();
    const N=this.nodes, cx=this.W/2, cy=this.H/2;
    // даём симуляции полностью остыть, чтобы граф замирал и не дёргался; перетаскивание снова поднимает alpha
    this.alpha*=0.985; if(this.alpha<0.004)this.alpha=0;
    if(this.alpha>0.06) this._moved=true;   // была заметная активность → после остывания сохраним раскладку
    if(this.alpha>0){   // физика раскладки O(N²) — только пока не остыло (при alpha=0 все силы = 0, движения нет → пропускаем весь цикл)
    for(let i=0;i<N.length;i++){ const a=N[i];
      const adjA=this.adj[a.id];
      for(let j=i+1;j<N.length;j++){ const b=N[j];
        let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy||1, d=Math.sqrt(d2);
        // связанные узлы отталкиваются слабее, несвязанные — заметно сильнее (разлетаются дальше)
        const connected = adjA && adjA.has(b.id);
        const rep = (connected ? 2400 : 7000) * (S.settings.graphSpread!=null?S.settings.graphSpread:1);
        const f=(rep/d2)*this.alpha, fx=dx/d*f, fy=dy/d*f;
        a.vx+=fx; a.vy+=fy; b.vx-=fx; b.vy-=fy;
      }
      // слабее тянем к центру, чтобы несвязанные кластеры могли разойтись
      a.vx+=(cx-a.x)*0.0016*this.alpha; a.vy+=(cy-a.y)*0.0016*this.alpha;
    }
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b];
      const restLen=l.L*(S.settings.graphLinkLen!=null?S.settings.graphLinkLen:1)*(l.lenMul||1)*(l.doneMul||1);   // глобальная × индивидуальная × сжатие завершённой ветки
      let dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-restLen)*0.02*this.alpha, fx=dx/d*f, fy=dy/d*f;
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
    }   // /if(alpha>0) — физика раскладки
    // «дыхание» в покое — чтобы граф жил, не выглядел вкопанным (амплитуда из настроек)
    const _it=performance.now()*0.001, AMP=(S.settings.graphDrift!=null?S.settings.graphDrift:4);
    N.forEach(n=>{
      // Дрейф со СХВАЧЕННОЙ ноды не снимаем. Раньше тут было n===this.drag: на pointerdown
      // _ix/_iy мгновенно схлопывались в 0, и нода роняла себя из дрейфующей позиции в базовую
      // (до AMP px по оси), а pointerup возвращал дрейф и она прыгала обратно — вот этот «дёрг»
      // и ловился на обычном клике. Точку захвата дрейф не сбивает: _grab (см. onpointerdown)
      // считается от базовой n.x, а рисуем по n.x+_ix — разница постоянна и уже была на экране.
      if(n.fixed){ n._ix=0; n._iy=0; return; }
      n._ix=Math.sin(_it*0.5 + n._ph)*AMP;    // фаза от id, не от индекса (см. build)
      n._iy=Math.cos(_it*0.43 + n._ph2)*AMP;
    });
    // связи — по позиции+idle (линии не «мерцают» от сдвига)
    const RX=n=>n.x+(n._ix||0), RY=n=>n.y+(n._iy||0);
    this.linkEls.forEach((e,i)=>{ const l=this.links[i], a=this.byId[l.a], b=this.byId[l.b];
      const ax=RX(a),ay=RY(a),bx=RX(b),by=RY(b), d=this._linkPath(ax,ay,bx,by);
      e.setAttribute("d",d);
      const h=this.hitEls[i]; if(h) h.setAttribute("d",d);
      if(l._grad){ l._grad.setAttribute("x1",ax); l._grad.setAttribute("y1",ay); l._grad.setAttribute("x2",bx); l._grad.setAttribute("y2",by); }   // градиент — по концам (userSpaceOnUse)
    });
    this.nodeEls.forEach(o=>{ const n=o.n, x=RX(n), y=RY(n), sk=o.shapeKind;   // x/y — с idle: дрейфит фигура/ореол/пин/связи (вектор не мерцает)
      if(sk==="square"||sk==="diamond"){ o.shape.setAttribute("x",x-n.r); o.shape.setAttribute("y",y-n.r); }   // ромб — тот же квадрат, поворот в CSS (.sh-diamond)
      else if(sk==="hexagon"){ o.shape.setAttribute("points", this._hexPts(x,y,n.r)); }
      else { o.shape.setAttribute("cx",x); o.shape.setAttribute("cy",y); }
      if(o.hit){ o.hit.setAttribute("cx",x); o.hit.setAttribute("cy",y); }   // расширенная область захвата едет с нодой
      if(n.type==="task" && o.check) o.check.setAttribute("d",`M ${x-3.2} ${y+0.3} l 2.2 2.4 l 4.2 -5`);
      if(o.halo){ o.halo.setAttribute("cx",x); o.halo.setAttribute("cy",y); }
      o.pin.setAttribute("cx",x); o.pin.setAttribute("cy",y);
      if(o.ticon){ o.ticon.setAttribute("x",x); o.ticon.setAttribute("y",y); o.ticon.setAttribute("font-size",Math.max(8,n.r*1.25)); }   // глиф тега по центру ноды
      // ПОДПИСЬ — на БАЗОВОЙ позиции n.x/n.y (idle её НЕ двигает): SVG-текст не ре-растеризуется → не «прыгает».
      o.t.setAttribute("x",n.x); o.t.setAttribute("y",n.y+n.r+12);
    });
    // когда симуляция остыла и просили «уложить» — подгоняем обзор под всё дерево
    if(this.alpha===0 && this._needFit){ this._needFit=false; this._fitView(); }
    // авто-раскладка остыла после активности → сохраняем позиции один раз, чтобы следующее открытие было статичным
    if(this.alpha===0 && this._moved){ this._moved=false;
      this.nodes.forEach(n=>{ if(n.ref){ n.ref.x=n.x; n.ref.y=n.y; } else if(n.hubArea){ n.hubArea.x=n.x; n.hubArea.y=n.y; } });
      persist(true);   // тихо: раскладка улеглась сама, человек ничего не делал — в историю отката это не шаг
    }
    this.raf = this._paused ? null : requestAnimationFrame(()=>this._tick());
  }
  // вписать все узлы в видимую область (зум/пан), чтобы видеть дерево целиком
  _fitView(){
    if(!this.nodes.length) return;
    let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    this.nodes.forEach(n=>{ minx=Math.min(minx,n.x); miny=Math.min(miny,n.y); maxx=Math.max(maxx,n.x); maxy=Math.max(maxy,n.y); });
    const pad=70;
    const cw=Math.max(1,(maxx-minx)+pad*2), ch=Math.max(1,(maxy-miny)+pad*2);
    const z=Math.max(0.12, Math.min(1.6, Math.min(this.W/cw, this.H/ch)));
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
      $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>this._paintColor(n, PALETTE[+b.dataset.ci]||null));
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
    const km = it.kind==="flow"?{i:"ti-artboard",n:"полотно"} : it.kind==="note"?{i:"ti-note",n:"заметка"} : {i:"ti-checklist",n:"задача"};
    const hasOpen = (it.kind==="note" || it.kind==="flow");
    // Меню — только действия, которых больше негде взять. «Изменить», «Связать» и «Удалить»
    // убраны намеренно: они дублировали двойной клик, Alt+тащи и клавишу Delete — то есть
    // занимали половину окна, ничего не добавляя (всё это написано в подсказке графа).
    // «Закрепить» — иконкой в шапке: это переключатель состояния, ему не нужна целая строка.
    pop.innerHTML=`
      <div class="np-hd">
        <div class="np-ttl">${esc(it.title)}</div>
        <button class="np-pin${n.fixed?" on":""}" data-pop="pin" title="${n.fixed?"Открепить":"Закрепить"}"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i></button>
      </div>
      <div class="np-meta">
        <span><i class="ti ${km.i}"></i> ${km.n}</span>
        ${it.area?`<span><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${conn.length?`<span><i class="ti ti-link"></i>${conn.length}</span>`:""}
      </div>
      <div class="swatches np-sw" style="margin-bottom:10px;">${swatchRow(it.color)}</div>
      <div class="np-row" style="margin-bottom:6px;">
        ${hasOpen?`<button class="btn" data-pop="open"><i class="ti ${it.kind==="flow"?"ti-artboard":"ti-eye"}"></i>Открыть</button>`
                :`<button class="btn ${(!it.done&&it.status!=="doing")?"primary":""}" data-pop="done"><i class="ti ${it.done?"ti-arrow-back-up":"ti-check"}"></i>${it.done?"Вернуть":"Готово"}</button>${it.done?"":`<button class="btn ${it.status==="doing"?"primary":""}" data-pop="doing"><i class="ti ti-player-play"></i>${it.status==="doing"?"В работе":"В работу"}</button>`}`}
      </div>
      <div class="np-row" style="margin-bottom:6px;">
        ${it.folder
          ? `<div class="np-split">
               <button class="btn" data-pop="folder-open" title="${esc(it.folder)}"><i class="ti ti-folder"></i>Папка</button>
               <button class="btn np-side" data-pop="folder-pick" title="Сменить папку"><i class="ti ti-folder-cog"></i></button>
             </div>`
          : `<button class="btn" data-pop="folder-pick"><i class="ti ti-folder-search"></i>Привязать папку</button>`}
      </div>
      <div class="np-row np-size">
        <span class="np-sz-lbl">Размер ноды</span>
        <button class="np-sz-btn" data-pop="size-" title="Меньше"><i class="ti ti-minus"></i></button>
        <span class="np-sz-val">${(+it.size||1).toFixed(1)}×</span>
        <button class="np-sz-btn" data-pop="size+" title="Больше"><i class="ti ti-plus"></i></button>
      </div>`;
    $("#graph-wrap").appendChild(pop);
    this._posPop(pop,n);
    $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>this._paintColor(n, PALETTE[+b.dataset.ci]||null));
    if(pop.querySelector('[data-pop="open"]')) pop.querySelector('[data-pop="open"]').onclick=()=>{ this._closePop(); openItemSmart(it); };
    if(pop.querySelector('[data-pop="done"]')) pop.querySelector('[data-pop="done"]').onclick=()=>{ toggleDone(it); this._closePop(); this.build(); toast(it.done?"Выполнено":"Возвращено в работу"); };
    if(pop.querySelector('[data-pop="doing"]')) pop.querySelector('[data-pop="doing"]').onclick=()=>{ it.status = it.status==="doing" ? "todo" : "doing"; touch(it); persist(); this._closePop(); this.build(); toast(it.status==="doing"?"В работе":"Снято с работы",{icon:it.status==="doing"?"ti-player-play":"ti-player-pause"}); };
    const setSize=(d)=>{ const cur=+it.size||1; it.size=Math.max(0.4,Math.min(3,+(cur+d).toFixed(2))); touch(it); persist(); this.build(); const v=$(".np-sz-val",pop); if(v) v.textContent=(+it.size).toFixed(1)+"×"; };
    if(pop.querySelector('[data-pop="size-"]')) pop.querySelector('[data-pop="size-"]').onclick=()=>setSize(-0.2);
    if(pop.querySelector('[data-pop="size+"]')) pop.querySelector('[data-pop="size+"]').onclick=()=>setSize(0.2);
    if(pop.querySelector('[data-pop="folder-open"]')) pop.querySelector('[data-pop="folder-open"]').onclick=()=>openItemFolder(it);
    if(pop.querySelector('[data-pop="folder-pick"]')) pop.querySelector('[data-pop="folder-pick"]').onclick=()=>pickItemFolder(it, ()=>{ this._closePop(); this.build(); });
    pop.querySelector('[data-pop="pin"]').onclick=()=>{
      const node=this.byId[n.id]||n;   // после смены размера (build) n устаревает — берём живой узел по id
      node.fixed=!node.fixed; if(node.ref){ node.ref.pin=node.fixed; persist(); }
      const o=this.nodeEls.find(x=>x.n.id===n.id); if(o)o.pin.style.display=node.fixed?"":"none";
      this._closePop();
    };
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
      ${!auto?`<div class="np-len"><span class="np-len-lbl">Длина</span><input class="np-len-in" type="range" min="0.4" max="2.5" step="0.1" value="${(l.lenMul||1)}"><span class="np-len-val">${(l.lenMul||1).toFixed(1)}×</span></div>`:""}
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
    const li=$(".np-len-in",pop);   // индивидуальная длина связи: пишем в lenMul (живо) + в S.links[2], будим симуляцию
    if(li) li.oninput=()=>{ const v=+li.value; l.lenMul=v; if(l.src) l.src[2]=v; const vv=$(".np-len-val",pop); if(vv) vv.textContent=v.toFixed(1)+"×"; this.alpha=Math.max(this.alpha,0.4); persist(); };
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
  // пауза/возобновление цикла анимации: когда окно не в фокусе/свёрнуто, останавливаем rAF,
  // чтобы приложение в фоне не жгло CPU (иначе «дыхание» графа крутится 60fps впустую).
  pause(){ this._paused=true; if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; } if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; } }
  resume(){ if(!this._paused) return; this._paused=false; if(!this.raf) this._tick(); }
  destroy(){ this._paused=true; if(this.raf) cancelAnimationFrame(this.raf); if(this._vraf) cancelAnimationFrame(this._vraf);
    // граф пересоздаётся на каждый render — без этого наблюдатели и слушатели копились бы
    if(this._ro){ this._ro.disconnect(); this._ro=null; }
    if(this._onWinResize){ window.removeEventListener("resize", this._onWinResize); this._onWinResize=null; }
  }
}
