"use strict";
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
