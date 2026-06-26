"use strict";
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
