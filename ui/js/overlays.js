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

// стилизованное подтверждение вместо нативного confirm() — возвращает Promise<bool>
function uiConfirm(message, opts){
  opts=opts||{};
  return new Promise(resolve=>{
    const m=el("div","modal confirm-modal");
    m.innerHTML=`
      <h3><i class="ti ${opts.danger?"ti-alert-triangle":"ti-help-circle"}"></i>${esc(opts.title||"Подтверждение")}</h3>
      <div class="confirm-msg">${esc(message)}</div>
      <div class="modal-foot"><div class="right">
        <button class="btn ghost" id="cf-no">${esc(opts.cancelLabel||"Отмена")}</button>
        <button class="btn ${opts.danger?"danger":"primary"}" id="cf-yes"><i class="ti ${opts.danger?"ti-trash":"ti-check"}"></i>${esc(opts.okLabel||"ОК")}</button>
      </div></div>`;
    m.tabIndex=-1;
    const ov=overlay(m); const op=ov._opener; let done=false;
    const finish=(v)=>{ if(done) return; done=true; if(ov.isConnected) ov.remove(); restoreFocus(op); resolve(v); };
    $("#cf-no",m).onclick=()=>finish(false);
    $("#cf-yes",m).onclick=()=>finish(true);
    ov.addEventListener("mousedown",e=>{ if(e.target===ov) finish(false); });          // клик по фону = отмена
    m.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); finish(true); } else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); finish(false); } });
    setTimeout(()=>{ const y=$("#cf-yes",m); if(y) y.focus(); },30);
  });
}

/* Отчёт о проблеме → веб-приложение Google Apps Script (URL в app.py FEEDBACK_URL).
   Пользователю не нужны аккаунты. Данные пользователя НЕ уходят: только его текст,
   версия приложения и версия Windows — этого хватает для диагностики.
   draft={msg,contact} — восстановление черновика при повторе после неудачи. */
function openFeedback(draft){
  const m=el("div","modal");
  m.innerHTML=`
    <h3><i class="ti ti-message-report"></i>Сообщить о проблеме</h3>
    <div class="fb-note">Опиши, что пошло не так или чего не хватает. Уйдут только твой текст, версия Мыслика и версия Windows — заметки и задачи НЕ отправляются.</div>
    <div class="field"><label>Что случилось</label>
      <textarea id="fb-msg" placeholder="Например: нажимаю «Граф» — приложение зависает…"></textarea></div>
    <div class="field"><label>Контакт для ответа <span class="set-val">по желанию</span></label>
      <input type="text" id="fb-contact" placeholder="телеграм или почта — если хочешь ответ" autocomplete="off" spellcheck="false"></div>
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="fb-cancel">Отмена</button>
      <button class="btn primary" id="fb-send"><i class="ti ti-send"></i>Отправить</button>
    </div></div>`;
  m.tabIndex=-1;
  const ov=overlay(m), op=ov._opener;
  const close=()=>{ if(ov.isConnected) ov.remove(); restoreFocus(op); };
  $("#fb-cancel",m).onclick=close;
  m.addEventListener("keydown",e=>{ if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); close(); } });
  if(draft){ $("#fb-msg",m).value=draft.msg||""; $("#fb-contact",m).value=draft.contact||""; }
  const btn=$("#fb-send",m);
  btn.onclick=()=>{
    const msg=$("#fb-msg",m).value.trim();
    if(!msg){ toast("Напиши, что случилось",{icon:"ti-alert-triangle"}); $("#fb-msg",m).focus(); return; }
    if(!HasPy()){ toast("Отправка доступна только в приложении",{icon:"ti-message-report"}); return; }
    // Окно закрываем СРАЗУ, отправку ведём фоном: ответа Apps Script ждать 2-5 c, и всё это
    // время пялиться в застывшую модалку незачем. Но «отправлено» раньше времени НЕ говорим.
    close();
    sendFeedback(msg, $("#fb-contact",m).value);
  };
  setTimeout(()=>{ const t=$("#fb-msg",m); if(t) t.focus(); },30);
}

/* Отправка живёт отдельно от окна: окно уже закрыто, а запрос идёт. Результат сообщаем тостом
   честно — по факту ответа. Черновик при неудаче не теряем: он вернётся по «Повторить». */
async function sendFeedback(msg, contact){
  toast("Отправляю…",{icon:"ti-loader-2", hold:true, spin:true});
  let res; try{ res=await window.pywebview.api.send_feedback(msg, contact); }
  catch(e){ res={ok:false, error:"network"}; }
  if(res && res.ok){ toast("Отчёт отправлен — спасибо!",{icon:"ti-check"}); return; }
  if((res&&res.error)==="not_configured"){ toast("Отправка отчётов ещё не настроена автором",{icon:"ti-alert-triangle"}); return; }
  toast("Не удалось отправить — текст сохранён",
        {icon:"ti-alert-triangle", label:"Повторить", onAction:()=>openFeedback({msg, contact})});
}

function openItemEditor(existing, defaultKind, presetDue){
  const isNew=!existing;
  const it = existing || {id:null, kind:defaultKind||"task", title:"", body:"", area:areaFilter||null, due:presetDue||null, repeat:"none", priority:0, tags:[]};
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
    <div class="field"><label>Теги (Enter чтобы добавить) <button type="button" class="lbl-btn" id="f-tagmgr" title="Управление тегами и их стилем"><i class="ti ti-settings-2"></i> управление</button></label>
      <input type="text" id="f-tagin" placeholder="например: видео, цвет, blender">
      <div class="tag-sugg" id="f-tagsugg"></div>
      <div class="chips" id="f-tags" style="margin-top:8px;"></div>
    </div>
    <div class="field"><label>Папка на ПК <span class="set-val">быстрый доступ к файлам</span></label>
      <div class="folder-row" id="f-folder-row"></div></div>
    <div class="modal-foot">
      ${!isNew?`<button class="btn ghost" id="f-delete"><i class="ti ti-trash"></i>Удалить</button>`:""}
      <div class="right">
        <button class="btn ghost" id="f-cancel">Отмена</button>
        <button class="btn primary" id="f-save"><i class="ti ti-check"></i>Сохранить</button>
      </div>
    </div>`;
  const ov=overlay(m);
  m.addEventListener("keydown",e=>{ if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); $("#f-save",m).click(); } });  // Ctrl/Cmd+Enter = сохранить
  let kind=it.kind, priority=it.priority||0, tags=(it.tags||[]).slice(), color=it.color||null, folder=it.folder||null;
  $$("#f-color .swatch",m).forEach(b=>b.onclick=()=>{ color=PALETTE[+b.dataset.ci]||null; $$("#f-color .swatch",m).forEach(x=>x.classList.toggle("on",PALETTE[+x.dataset.ci]===color)); });

  const syncKind=()=>{
    $("#wrap-due",m).style.display = kind==="note"?"none":"";
    $("#wrap-task2",m).style.display = kind==="note"?"none":"flex";
    $$("#f-kind button",m).forEach(b=>b.classList.toggle("on",b.dataset.k===kind));
  };
  syncKind();
  $$("#f-kind button",m).forEach(b=>b.onclick=()=>{ kind=b.dataset.k; syncKind(); });
  $$("#f-pri button",m).forEach(b=>b.onclick=()=>{ priority=+b.dataset.p; $$("#f-pri button",m).forEach(x=>x.classList.toggle("on",x===b)); });

  // чип тега показывает стиль зарегистрированного тега (иконка + цвет) — нагляднее
  const tagChip=(t,i)=>{ const ts=tagStyle(t), ic=(ts&&ts.icon)?ts.icon:"ti-hash", col=(ts&&ts.color)?`style="border-color:${ts.color};color:${ts.color}"`:"";
    return `<span class="chip${ts?" styled":""}" ${col}><i class="ti ${ic}"></i>${esc(t)}<button data-i="${i}"><i class="ti ti-x"></i></button></span>`; };
  const renderTags=()=>{ $("#f-tags",m).innerHTML=tags.map(tagChip).join("");
    $$("#f-tags button",m).forEach(b=>b.onclick=()=>{ tags.splice(+b.dataset.i,1); renderTags(); renderSugg($("#f-tagin",m).value); }); };
  // подсказки: зарегистрированные теги, которых ещё нет на элементе (с фильтром по вводу) — клик добавляет
  const renderSugg=(q)=>{ const box=$("#f-tagsugg",m); if(!box) return; q=(q||"").trim().toLowerCase().replace(/^#/,"");
    const avail=(S.tags||[]).filter(t=>!tags.includes(t.name) && (!q || t.name.toLowerCase().includes(q)));
    if(!avail.length){ box.innerHTML=""; box.classList.remove("show"); return; }
    box.classList.add("show");
    box.innerHTML=`<span class="sugg-lbl">Доступные:</span>`+avail.map(t=>`<button type="button" class="sugg-chip" data-add="${esc(t.name)}" ${t.color?`style="border-color:${t.color};color:${t.color}"`:""}><i class="ti ${t.icon||"ti-hash"}"></i>${esc(t.name)}</button>`).join("");
    $$("[data-add]",box).forEach(b=>b.onclick=()=>{ const nm=b.dataset.add; if(!tags.includes(nm)){ tags.push(nm); renderTags(); } renderSugg($("#f-tagin",m).value); $("#f-tagin",m).focus(); });
  };
  renderTags(); renderSugg("");
  $("#f-tagin",m).addEventListener("input",e=>renderSugg(e.target.value));
  $("#f-tagin",m).addEventListener("focus",e=>renderSugg(e.target.value));
  $("#f-tagin",m).addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); const v=e.target.value.trim().replace(/^#/,""); if(v&&!tags.includes(v)){tags.push(v);renderTags();} e.target.value=""; renderSugg(""); }});
  $("#f-tagmgr",m).onclick=()=>openTagManager();   // управление тегами прямо отсюда (не в настройках)

  // поле «Папка на ПК»: выбрать (системный диалог), открыть в проводнике, убрать. Папка пишется в it.folder при сохранении.
  const folderRow=$("#f-folder-row",m);
  const redrawFolder=()=>{
    folderRow.innerHTML=`<i class="ti ti-folder"></i>`+
      (folder?`<span class="folder-path" title="${esc(folder)}">${esc(folder)}</span>`:`<span class="folder-path folder-empty">не привязана</span>`)+
      (folder?`<button type="button" class="folder-btn" data-ff="open" title="Открыть в проводнике"><i class="ti ti-external-link"></i></button>`:``)+
      `<button type="button" class="folder-btn" data-ff="pick" title="${folder?"Сменить папку":"Выбрать папку"}"><i class="ti ti-folder-search"></i></button>`+
      (folder?`<button type="button" class="folder-btn" data-ff="clear" title="Убрать"><i class="ti ti-x"></i></button>`:``);
    $$("[data-ff]",folderRow).forEach(b=>b.onclick=()=>{ const a=b.dataset.ff;
      if(a==="pick"){ if(!HasPy()){ toast("Привязка папки — только в приложении",{icon:"ti-folder"}); return; }
        Promise.resolve(window.pywebview.api.pick_folder()).then(p=>{ if(p){ folder=p; redrawFolder(); } },()=>toast("Не удалось выбрать папку")); }
      else if(a==="open"){ openItemFolder({folder}); }
      else if(a==="clear"){ folder=null; redrawFolder(); } });
  };
  redrawFolder();

  $("#f-cancel",m).onclick=()=>ov.remove();
  if($("#f-delete",m)) $("#f-delete",m).onclick=()=>{ const id=it.id; deleteItem(id); ov.remove(); render(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }}); };
  $("#f-save",m).onclick=()=>{
    const title=$("#f-title",m).value.trim(); if(!title){ $("#f-title",m).focus(); return; }
    const data={ kind, title, body:$("#f-body",m).value, area:$("#f-area",m).value||null,
      due: kind==="note"?null:($("#f-due",m).value||null), repeat: kind==="note"?"none":$("#f-rep",m).value,
      priority: kind==="note"?0:priority, tags, color, folder: folder||null };
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
    $$("[data-del]",m).forEach(b=>b.onclick=async()=>{
      const id=b.dataset.del; const used=S.items.filter(i=>i.area===id).length;
      const msg = used ? `В области «${areaName(id)}» ${used} элем. Удалить область? Элементы останутся без области.`
                       : `Удалить область «${areaName(id)}»?`;
      if(!(await uiConfirm(msg,{danger:true,title:"Удалить область",okLabel:"Удалить"}))) return;   // подтверждаем ВСЕГДА (нет soft-delete/undo)
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
    ${it.folder?`<div style="margin-bottom:10px;"><button class="tag folder-tag" id="nr-folder" title="${esc(it.folder)}"><i class="ti ti-folder"></i>Открыть папку</button></div>`:""}
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
  { const nf=$("#nr-folder",m); if(nf) nf.onclick=()=>openItemFolder(it); }
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
  frame:   {name:"Рамка",    icon:"ti-frame",        w:320, h:220},
  image:   {name:"Картинка", icon:"ti-photo",        w:240, h:160},  // не в FLOW_ORDER — отдельная кнопка/перетаскивание/вставка
  video:   {name:"Видео",    icon:"ti-movie",        w:280, h:170}
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
    if(b.refId!=null && typeof b.refId!=="string") b.refId=null;   // привязка блока к элементу
    if(b.type==="image"||b.type==="video"){ b.src=typeof b.src==="string"?b.src:""; b.refId=null;   // медиа: data-URL/файл внутри, без привязки/текста
      b.nw=Math.max(1,Math.round(+b.nw||b.w||FLOW_TYPES.image.w)); b.nh=Math.max(1,Math.round(+b.nh||b.h||FLOW_TYPES.image.h));   // натуральный размер источника
      // crop={cx,cy,cw,ch} — прямоугольник источника (в ПИКСЕЛЯХ nw×nh), который показан в рамке. Дефолт = весь кадр.
      let c=(b.crop&&typeof b.crop==="object")?b.crop:null;
      if(!c && b.fit && typeof b.fit==="object"){   // миграция старого cover-fit → crop-прямоугольник (видимое окно cover)
        const fit=b.fit, s=Math.max(1,+fit.scale||1), ar=b.nw/b.nh, fr=b.w/(b.h||1);
        let vw,vh; if(ar>fr){ vh=b.nh/s; vw=vh*fr; } else { vw=b.nw/s; vh=vw/fr; }
        vw=Math.min(b.nw,vw); vh=Math.min(b.nh,vh);
        const ox=Math.max(-1,Math.min(1,+fit.ox||0)), oy=Math.max(-1,Math.min(1,+fit.oy||0));
        c={ cx:(b.nw-vw)/2 + ox*(b.nw-vw)/2, cy:(b.nh-vh)/2 + oy*(b.nh-vh)/2, cw:vw, ch:vh };
      }
      if(!c) c={cx:0,cy:0,cw:b.nw,ch:b.nh};
      let cw=Math.max(8,Math.min(b.nw,+c.cw||b.nw)), ch=Math.max(8,Math.min(b.nh,+c.ch||b.nh));
      let cx=Math.max(0,Math.min(b.nw-cw,+c.cx||0)), cy=Math.max(0,Math.min(b.nh-ch,+c.cy||0));
      b.crop={cx,cy,cw,ch};
      if(b.fit) delete b.fit;   // старый формат больше не используется
    }
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
  if(kind==="flow"){ const it=addItem({kind:"flow", title:"Новое полотно", area:areaFilter||null}); render(); openFlowEditor(it); }
  else openItemEditor(null, kind);
}

function openFlowEditor(it){ new FlowEditor(it).mount(); }

/* ===========================================================
   СТИЛИЗОВАННЫЕ ТЕГИ (проекты/важное — гибко, на любой вкус)
   =========================================================== */
const TAG_SHAPE_RU={circle:"круг",square:"квадрат",diamond:"ромб",hexagon:"шестиуг."};
function openTagManager(){
  const m=el("div","modal");
  const draw=()=>{
    m.innerHTML=`<h3><i class="ti ti-tags"></i>Теги со стилем</h3>
      <div class="tag-hint">Готовь теги заранее и вешай на заметки/задачи/схемы. Нода со стилизованным тегом крупнее, в цвете тега, со своей иконкой и формой. «Проект» = тег с большим размером и иконкой.</div>
      <div id="tag-list">${(S.tags||[]).length? S.tags.map(t=>`
        <div class="area-row" data-name="${esc(t.name)}">
          <span class="tag-prev" style="${t.color?`color:${t.color};border-color:${t.color};`:""}"><i class="ti ${t.icon||"ti-hash"}"></i></span>
          <span class="nm">${esc(t.name)}</span>
          <span class="tag-badges">${t.size?`<span class="tag-bdg">×${t.size}</span>`:""}${t.shape?`<span class="tag-bdg">${TAG_SHAPE_RU[t.shape]||t.shape}</span>`:""}</span>
          <button data-edit="${esc(t.name)}" title="Изменить"><i class="ti ti-pencil"></i></button>
          <button data-del="${esc(t.name)}" title="Удалить"><i class="ti ti-trash"></i></button>
        </div>`).join("") : `<div class="empty" style="padding:20px"><i class="ti ti-tags-off"></i>Пока нет тегов. Создай первый.</div>`}</div>
      <div class="modal-foot"><div class="right">
        <button class="btn ghost" id="tg-close">Закрыть</button>
        <button class="btn primary" id="tg-add"><i class="ti ti-plus"></i>Новый тег</button>
      </div></div>`;
    $("#tg-close",m).onclick=()=>ov.remove();   // закрыть только менеджер (мог быть открыт поверх редактора элемента)
    $("#tg-add",m).onclick=()=>openTagEditor(null,draw);
    $$("[data-edit]",m).forEach(b=>b.onclick=()=>openTagEditor(tagStyle(b.dataset.edit),draw));
    $$("[data-del]",m).forEach(b=>b.onclick=async()=>{ const nm=b.dataset.del;
      if(!(await uiConfirm("Удалить тег «"+nm+"»? На заметках он останется обычным текстовым тегом, но потеряет стиль.",{danger:true,title:"Удалить тег",okLabel:"Удалить"}))) return;
      S.tags=S.tags.filter(t=>t.name!==nm); persist(); draw(); if(view==="notes") render();
    });
  };
  const ov=overlay(m); draw();
}
function openTagEditor(tag, after){
  const isNew=!tag;
  let name=tag?tag.name:"", icon=tag?tag.icon:null, color=tag?tag.color:null, size=tag?tag.size:null, shape=tag?tag.shape:null;
  const SHAPES=[["","нет"],["circle","круг"],["square","квадрат"],["diamond","ромб"],["hexagon","шестиуг."]];
  const m=el("div","modal");
  m.innerHTML=`<h3><i class="ti ti-tag"></i>${isNew?"Новый тег":"Тег"}</h3>
    <div class="field"><label>Название</label><input type="text" id="tg-name" value="${esc(name)}" placeholder="например: проект, важное, идея"></div>
    <div class="field"><label>Иконка <span class="set-val">опционально</span></label>
      <div class="icon-grid" id="tg-icons">
        <button data-ic="" class="${!icon?"on":""}" title="без иконки"><i class="ti ti-ban"></i></button>
        ${ICONS.map(ic=>`<button data-ic="${ic}" class="${icon===ic?"on":""}"><i class="ti ${ic}"></i></button>`).join("")}
      </div></div>
    <div class="field"><label>Цвет <span class="set-val">опционально</span></label><div class="swatches" id="tg-color">${swatchRow(color)}</div></div>
    <div class="field"><label>Размер ноды <span class="set-val" id="tg-szval">${size?size+"×":"нет"}</span></label>
      <div class="seg" style="margin-bottom:8px;"><button id="tg-sztoggle">${size?"Выключить":"Включить"}</button></div>
      <input type="range" id="tg-size" min="0.5" max="3" step="0.1" value="${size||1.6}" ${size?"":"disabled"}></div>
    <div class="field"><label>Форма ноды <span class="set-val">опционально</span></label>
      <div class="seg" id="tg-shape">${SHAPES.map(([v,l])=>`<button data-sh="${v}" class="${(shape||"")===v?"on":""}">${l}</button>`).join("")}</div></div>
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="tg-cancel">Отмена</button>
      <button class="btn primary" id="tg-save"><i class="ti ti-check"></i>Сохранить</button>
    </div></div>`;
  const ov=overlay(m);
  $$("#tg-icons button",m).forEach(b=>b.onclick=()=>{ icon=b.dataset.ic||null; $$("#tg-icons button",m).forEach(x=>x.classList.toggle("on",(x.dataset.ic||null)===icon)); });
  $$("#tg-color .swatch",m).forEach(b=>b.onclick=()=>{ color=PALETTE[+b.dataset.ci]||null; $$("#tg-color .swatch",m).forEach(x=>x.classList.toggle("on",(PALETTE[+x.dataset.ci]||null)===color)); });
  $$("#tg-shape button",m).forEach(b=>b.onclick=()=>{ shape=b.dataset.sh||null; $$("#tg-shape button",m).forEach(x=>x.classList.toggle("on",(x.dataset.sh||"")===(shape||""))); });
  const szIn=$("#tg-size",m), szToggle=$("#tg-sztoggle",m), szVal=$("#tg-szval",m);
  const syncSize=()=>{ szIn.disabled=!size; szVal.textContent=size?size+"×":"нет"; szToggle.textContent=size?"Выключить":"Включить"; };
  szToggle.onclick=()=>{ size = size? null : (+szIn.value||1.6); syncSize(); };
  szIn.oninput=()=>{ size=+szIn.value; syncSize(); };
  $("#tg-cancel",m).onclick=()=>ov.remove();
  $("#tg-save",m).onclick=()=>{
    const nm=$("#tg-name",m).value.trim().replace(/^#/,""); if(!nm){ $("#tg-name",m).focus(); return; }
    if((isNew || nm!==name) && tagStyle(nm)){ toast("Тег с таким именем уже есть"); return; }
    if(isNew){ S.tags.push({name:nm, icon:icon||null, color:color||null, size:size||null, shape:shape||null}); }
    else { const old=name; if(nm!==old) S.items.forEach(it=>{ if(it.tags) it.tags=it.tags.map(x=>x===old?nm:x); });   // переименование — обновить на айтемах
      tag.name=nm; tag.icon=icon||null; tag.color=color||null; tag.size=size||null; tag.shape=shape||null; }
    persist(); ov.remove(); if(after) after(); if(view==="notes") render();
  };
  setTimeout(()=>$("#tg-name",m).focus(),30);
}

/* ===========================================================
   ШПАРГАЛКА ГОРЯЧИХ КЛАВИШ
   =========================================================== */
function openShortcuts(){
  const rows=arr=>arr.map(([k,d])=>`<div class="sc-row"><span class="sc-keys">${k}</span><span class="sc-desc">${esc(d)}</span></div>`).join("");
  const m=el("div","modal sc-modal");
  m.innerHTML=`
    <h3><i class="ti ti-keyboard"></i>Горячие клавиши и жесты</h3>
    <div class="sc-sec">Везде</div>${rows([
      ["<kbd>Ctrl</kbd><kbd>K</kbd>","Поиск и команды"],
      ["<kbd>N</kbd>","Новая задача"],
      ["<kbd>/</kbd>","Фокус в поле захвата"],
      ["<kbd>1</kbd>…<kbd>7</kbd>","Переключение видов"],
      ["<kbd>Esc</kbd>","Закрыть окно / отменить"],
    ])}
    <div class="sc-sec">Граф заметок</div>${rows([
      ["ЛКМ-тащи по пустому","Рамка выделения нод"],
      ["Средняя кнопка","Двигать холст (пан)"],
      ["Alt + тащи от ноды","Связь · на пустое — новая связанная заметка"],
      ["ПКМ по пустому","Меню «Создать» (заметка/задача/полотно)"],
      ["ПКМ по ноде / связи","Настройки ноды / связи"],
      ["Shift + клик","Добавить ноду в выделение"],
      ["<kbd>Delete</kbd>","Удалить выделенные ноды"],
      ["<kbd>Ctrl</kbd><kbd>C</kbd> · <kbd>Ctrl</kbd><kbd>V</kbd>","Копировать · вставить ноды"],
      ["Тяни за край / угол окна","Изменить размер окна"],
    ])}
    <div class="sc-sec">Полотно (редактор)</div>${rows([
      ["2× клик по холсту","Новый блок"],
      ["Тяни ⊕ под блоком","Стрелка к другому блоку"],
      ["Тащи по пустому","Рамка выделения"],
      ["Пробел / средняя кнопка","Двигать холст"],
      ["ПКМ по блоку","Тип · цвет"],
      ["<kbd>Ctrl</kbd><kbd>C/V/D</kbd>","Копировать · вставить · дублировать"],
      ["<kbd>Delete</kbd>","Удалить выделенное"],
    ])}
    <div class="modal-foot"><div class="right"><button class="btn primary" id="sc-close"><i class="ti ti-check"></i>Понятно</button></div></div>`;
  const ov=overlay(m); $("#sc-close",m).onclick=()=>ov.remove();
  setTimeout(()=>{ const b=$("#sc-close",m); if(b) b.focus(); },30);
}

/* ===========================================================
   НАСТРОЙКИ (саморегулируемые параметры — п.1 KROLIK)
   =========================================================== */
function openSettings(){
  const s=S.settings, def=defaultState().settings;
  const gd=()=> s.graphDrift!=null?s.graphDrift:def.graphDrift, gs=()=> s.graphSpread!=null?s.graphSpread:def.graphSpread,
        gl=()=> s.graphLinkLen!=null?s.graphLinkLen:def.graphLinkLen, gn=()=> s.graphNodeSize!=null?s.graphNodeSize:def.graphNodeSize,
        gds=()=> s.graphDegScale!=null?s.graphDegScale:def.graphDegScale,
        gdn=()=> s.graphDoneScale!=null?s.graphDoneScale:def.graphDoneScale,
        gdb=()=> s.graphLinkBright!=null?s.graphLinkBright:def.graphLinkBright,
        gdl=()=> s.graphDoneLinkLen!=null?s.graphDoneLinkLen:def.graphDoneLinkLen,
        gfb=()=> s.graphFadedBright!=null?s.graphFadedBright:def.graphFadedBright,
        dgr=()=> s.graphDoingGlowRadius!=null?s.graphDoingGlowRadius:def.graphDoingGlowRadius,
        dgb=()=> s.graphDoingGlowBright!=null?s.graphDoingGlowBright:def.graphDoingGlowBright,
        dgbl=()=> s.graphDoingGlowBlur!=null?s.graphDoingGlowBlur:def.graphDoingGlowBlur;
  const m=el("div","modal"); m.innerHTML=`
    <h3><i class="ti ti-settings"></i>Настройки</h3>
    <div class="set-tabs" id="set-tabs">
      <button class="set-tab on" data-tab="view"><i class="ti ti-palette"></i>Вид</button>
      <button class="set-tab" data-tab="graph"><i class="ti ti-affiliate"></i>Граф</button>
      <button class="set-tab" data-tab="done"><i class="ti ti-checks"></i>Завершённые</button>
      <button class="set-tab" data-tab="data"><i class="ti ti-database"></i>Данные</button>
    </div>
    <div class="set-panel" data-panel="view">
      <div class="field"><label>Тема</label>
        <div class="seg" id="set-theme">
          <button data-v="dark" class="${s.theme!=="light"?"on":""}"><i class="ti ti-moon"></i> Тёмная</button>
          <button data-v="light" class="${s.theme==="light"?"on":""}"><i class="ti ti-sun"></i> Светлая</button>
        </div></div>
      <div class="field"><label>Свечение</label>
        <div class="seg" id="set-glow">${[["0","Выкл"],["1","Обычное"],["1.6","Сильное"]].map(([v,l])=>`<button data-v="${v}" class="${(+s.glow||0)===+v?"on":""}">${l}</button>`).join("")}</div></div>
      <div class="field"><label>Фон «звёздное поле»</label>
        <div class="seg" id="set-bg">
          <button data-v="1" class="${s.graphBg!==false?"on":""}">Вкл</button>
          <button data-v="0" class="${s.graphBg===false?"on":""}">Выкл</button>
        </div></div>
    </div>
    <div class="set-panel" data-panel="graph" hidden>
      <div class="field"><label>Размер нод <span class="set-val" id="val-nsz">${gn()}×</span></label>
        <input type="range" id="set-nsz" min="0.6" max="1.8" step="0.1" value="${gn()}"></div>
      <div class="field"><label>Размер от числа связей <span class="set-val" id="val-deg">${gds()}×</span></label>
        <input type="range" id="set-deg" min="0" max="2.5" step="0.1" value="${gds()}"></div>
      <div class="field"><label>Дрейф нод <span class="set-val" id="val-drift">${gd()}</span></label>
        <input type="range" id="set-drift" min="0" max="10" step="0.5" value="${gd()}"></div>
      <div class="field"><label>Разлёт нод <span class="set-val" id="val-spread">${gs()}×</span></label>
        <input type="range" id="set-spread" min="0.5" max="2" step="0.1" value="${gs()}"></div>
      <div class="field"><label>Длина связей <span class="set-val" id="val-len">${gl()}×</span></label>
        <input type="range" id="set-len" min="0.5" max="2" step="0.1" value="${gl()}"></div>
      <div class="field"><label>Яркость связей <span class="set-val" id="val-lbright">${gdb()}×</span></label>
        <input type="range" id="set-lbright" min="0.4" max="1.5" step="0.1" value="${gdb()}"></div>
      <div class="set-hint" style="margin-top:14px;">Подсветка «в работе» — вокруг помеченной ноды её цветом; свет соседних смешивается.</div>
      <div class="field"><label>Свечение вокруг ноды</label>
        <div class="seg" id="set-doglow">
          <button data-v="1" class="${s.graphDoingGlow!==false?"on":""}">Вкл</button>
          <button data-v="0" class="${s.graphDoingGlow===false?"on":""}">Выкл</button>
        </div></div>
      <div class="field"><label>Радиус <span class="set-val" id="val-dgr">${dgr()}</span></label>
        <input type="range" id="set-dgr" min="40" max="220" step="5" value="${dgr()}"></div>
      <div class="field"><label>Яркость свечения <span class="set-val" id="val-dgb">${dgb()}</span></label>
        <input type="range" id="set-dgb" min="0.05" max="1" step="0.05" value="${dgb()}"></div>
      <div class="field"><label>Размытие <span class="set-val" id="val-dgbl">${dgbl()}</span></label>
        <input type="range" id="set-dgbl" min="0" max="60" step="2" value="${dgbl()}"></div>
    </div>
    <div class="set-panel" data-panel="done" hidden>
      <div class="set-hint">Как выглядят завершённые задачи и их ветки в графе (тухнут, ужимаются, подтягиваются).</div>
      <div class="field"><label>Масштаб нод <span class="set-val" id="val-done">${gdn()}×</span></label>
        <input type="range" id="set-done" min="0.3" max="1" step="0.05" value="${gdn()}"></div>
      <div class="field"><label>Длина связей <span class="set-val" id="val-donelen">${gdl()}×</span></label>
        <input type="range" id="set-donelen" min="0.3" max="1" step="0.05" value="${gdl()}"></div>
      <div class="field"><label>Яркость потухших связей <span class="set-val" id="val-fbright">${gfb()}×</span></label>
        <input type="range" id="set-fbright" min="0.1" max="1" step="0.05" value="${gfb()}"></div>
    </div>
    <div class="set-panel" data-panel="data" hidden>
      <div class="set-sec">Резервная копия</div>
      <div class="set-row">
        <span class="set-val">Резервная копия текущих данных</span>
        <div class="right"><button class="btn ghost" id="set-backup"><i class="ti ti-shield-check"></i>Сделать бэкап</button></div>
      </div>
      <div class="set-sec">Telegram — захват заметок с телефона</div>
      <div class="field"><label>Токен бота (от @BotFather)</label>
        <input type="password" id="tg-token" placeholder="123456:ABC-Def…" autocomplete="off" spellcheck="false"></div>
      <div class="set-row">
        <span class="set-val" id="tg-status">…</span>
        <div class="right">
          <button class="btn ghost" id="tg-clear"><i class="ti ti-unlink"></i>Отвязать</button>
          <button class="btn primary" id="tg-save"><i class="ti ti-check"></i>Сохранить</button>
        </div>
      </div>
      <div class="set-sec">Обновления</div>
      <div class="set-row">
        <span class="set-val" id="upd-status">Версия…</span>
        <div class="right">
          <button class="btn ghost" id="upd-check"><i class="ti ti-refresh"></i>Проверить обновления</button>
          <button class="btn primary" id="upd-apply" style="display:none"><i class="ti ti-download"></i>Обновить</button>
        </div>
      </div>
      <div id="upd-notes" class="upd-notes" style="display:none"></div>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="set-reset"><i class="ti ti-refresh"></i>Сбросить</button>
      <div class="right"><button class="btn primary" id="set-close"><i class="ti ti-check"></i>Готово</button></div>
    </div>`;
  const ov=overlay(m);
  $("#set-backup",m).onclick=doBackup;
  // Telegram: статус подтягиваем асинхронно (не блокируем открытие модалки IPC-round-trip'ом)
  const tgStatus=$("#tg-status",m), tgToken=$("#tg-token",m), tgClear=$("#tg-clear",m);
  const renderTgStatus=async()=>{
    if(!HasPy()){ tgStatus.textContent="доступно только в приложении"; tgClear.disabled=true; return; }
    try{ const st=await window.pywebview.api.telegram_status();
      tgStatus.textContent=!st.configured?"не настроен":st.linked?"настроен · привязан к чату":"настроен · жду первое сообщение боту";
      tgClear.disabled=!st.configured;
    }catch(e){ tgStatus.textContent="ошибка проверки статуса"; }
  };
  renderTgStatus();
  $("#tg-save",m).onclick=async()=>{
    if(!HasPy()){ toast("Telegram доступен только в приложении",{icon:"ti-brand-telegram"}); return; }
    const v=tgToken.value.trim(); if(!v){ toast("Введи токен бота",{icon:"ti-brand-telegram"}); return; }
    const ok=await window.pywebview.api.telegram_set_token(v);
    tgToken.value=""; toast(ok?"Токен сохранён":"Не удалось сохранить токен",{icon:ok?"ti-check":"ti-alert-triangle"}); renderTgStatus();
  };
  tgClear.onclick=async()=>{ await window.pywebview.api.telegram_clear(); toast("Бот отвязан",{icon:"ti-unlink"}); renderTgStatus(); };
  $$("#set-theme button",m).forEach(b=>b.onclick=()=>{ s.theme=b.dataset.v; persist(); applySettings(); $$("#set-theme button",m).forEach(x=>x.classList.toggle("on",x===b)); if(view==="notes") render(); });
  $$("#set-glow button",m).forEach(b=>b.onclick=()=>{ s.glow=+b.dataset.v; persist(); applySettings(); $$("#set-glow button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  $$("#set-bg button",m).forEach(b=>b.onclick=()=>{ s.graphBg=b.dataset.v==="1"; persist(); $$("#set-bg button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  const drift=$("#set-drift",m); drift.oninput=()=>{ s.graphDrift=+drift.value; $("#val-drift",m).textContent=drift.value; persist(); };   // граф читает S.settings каждый кадр → применяется вживую
  const spread=$("#set-spread",m); spread.oninput=()=>{ s.graphSpread=+spread.value; $("#val-spread",m).textContent=spread.value+"×"; persist(); if(graph) graph.alpha=Math.max(graph.alpha,0.4); };
  const len=$("#set-len",m); len.oninput=()=>{ s.graphLinkLen=+len.value; $("#val-len",m).textContent=len.value+"×"; persist(); if(graph) graph.alpha=Math.max(graph.alpha,0.4); };   // будим симуляцию → связи переезжают к новой длине вживую
  const nsz=$("#set-nsz",m); nsz.oninput=()=>{ s.graphNodeSize=+nsz.value; $("#val-nsz",m).textContent=nsz.value+"×"; persist(); }; nsz.onchange=()=>{ if(graph) graph.build(); };   // размер r считается в build → пересобираем при отпускании
  const deg=$("#set-deg",m); deg.oninput=()=>{ s.graphDegScale=+deg.value; $("#val-deg",m).textContent=deg.value+"×"; persist(); }; deg.onchange=()=>{ if(graph) graph.build(); };   // 0× = все ноды одного размера; больше = сильнее зависит от связей
  const done=$("#set-done",m); done.oninput=()=>{ s.graphDoneScale=+done.value; $("#val-done",m).textContent=done.value+"×"; persist(); }; done.onchange=()=>{ if(graph) graph.build(); };   // насколько ужимать завершённые ветки
  const lbr=$("#set-lbright",m); lbr.oninput=()=>{ s.graphLinkBright=+lbr.value; $("#val-lbright",m).textContent=lbr.value+"×"; persist(); if(graph) graph.build(); };   // яркость обычных связей
  const dlen=$("#set-donelen",m); dlen.oninput=()=>{ s.graphDoneLinkLen=+dlen.value; $("#val-donelen",m).textContent=dlen.value+"×"; persist(); if(graph){ graph.build(); graph.alpha=Math.max(graph.alpha,0.4); } };   // длина связей завершённых → будим симуляцию
  const fbr=$("#set-fbright",m); fbr.oninput=()=>{ s.graphFadedBright=+fbr.value; $("#val-fbright",m).textContent=fbr.value+"×"; persist(); if(graph) graph.build(); };   // яркость потухших связей
  // подсветка «в работе» — рисуется каждый кадр, поэтому применяется вживую без пересборки
  $$("#set-doglow button",m).forEach(b=>b.onclick=()=>{ s.graphDoingGlow=b.dataset.v==="1"; persist(); $$("#set-doglow button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  const elDgr=$("#set-dgr",m); elDgr.oninput=()=>{ s.graphDoingGlowRadius=+elDgr.value; $("#val-dgr",m).textContent=elDgr.value; persist(); };
  const elDgb=$("#set-dgb",m); elDgb.oninput=()=>{ s.graphDoingGlowBright=+elDgb.value; $("#val-dgb",m).textContent=elDgb.value; persist(); };
  const elDgbl=$("#set-dgbl",m); elDgbl.oninput=()=>{ s.graphDoingGlowBlur=+elDgbl.value; $("#val-dgbl",m).textContent=elDgbl.value; persist(); };
  $$(".set-tab",m).forEach(t=>t.onclick=()=>{ $$(".set-tab",m).forEach(x=>x.classList.toggle("on",x===t)); $$(".set-panel",m).forEach(p=>p.hidden=p.dataset.panel!==t.dataset.tab); });   // вкладки настроек
  $("#set-reset",m).onclick=()=>{ ["theme","glow","graphBg","graphDrift","graphSpread","graphLinkLen","graphNodeSize","graphDegScale","graphDoneScale","graphDoneLinkLen","graphLinkBright","graphFadedBright","graphDoingGlow","graphDoingGlowRadius","graphDoingGlowBright","graphDoingGlowBlur"].forEach(k=>s[k]=def[k]); persist(); applySettings(); ov.remove(); openSettings(); if(graph) graph.build(); if(view==="notes") render(); };
  // ---- обновления ----
  const updStatus=$("#upd-status",m), updCheck=$("#upd-check",m), updApply=$("#upd-apply",m), updNotes=$("#upd-notes",m);
  let updAsset=null;
  (async()=>{
    if(!HasPy()){ updStatus.textContent="Обновление — только в приложении"; updCheck.disabled=true; return; }
    try{ updStatus.textContent="Версия "+(await window.pywebview.api.app_version()); }catch(e){ updStatus.textContent="Версия ?"; }
  })();
  updCheck.onclick=async()=>{
    if(!HasPy()){ toast("Обновление доступно только в приложении",{icon:"ti-refresh"}); return; }
    updCheck.classList.add("spin"); updStatus.textContent="Проверяю GitHub…"; updApply.style.display="none"; updNotes.style.display="none";
    let r; try{ r=await window.pywebview.api.check_update(); }catch(e){ r={ok:false,error:"network"}; }
    updCheck.classList.remove("spin");
    if(!r.ok){
      updStatus.textContent = r.error==="not_configured" ? "Канал обновлений ещё не настроен"
        : r.error==="network" ? "Нет связи с GitHub" : "Не удалось проверить";
      if(r.current) updStatus.textContent += " · версия "+r.current;
      return;
    }
    if(r.hasUpdate){
      updStatus.textContent="Доступна версия "+r.latest+" (у тебя "+r.current+")";
      updAsset=r.asset; updApply.style.display="";
      updApply.innerHTML='<i class="ti ti-download"></i>Обновить';
      if(r.notes){ updNotes.textContent=r.notes; updNotes.style.display=""; }
    } else {
      updStatus.textContent="У тебя последняя версия ("+r.current+")";
    }
  };
  updApply.onclick=async()=>{
    if(!updAsset || updApply.disabled) return;   // одна кнопка, без подтверждения — сразу качаем
    updApply.classList.add("spin"); updApply.disabled=true; updStatus.textContent="Скачиваю обновление…";
    let r; try{ r=await window.pywebview.api.apply_update(updAsset); }catch(e){ r={ok:false,error:"network"}; }
    if(!r || !r.ok){ updApply.classList.remove("spin"); updApply.disabled=false; updApply.innerHTML='<i class="ti ti-download"></i>Обновить'; updStatus.textContent="Не удалось обновить ("+((r&&r.error)||"?")+")"; }
    // при успехе приложение закроется само через ~1с и запустит хелпер
  };
  $("#set-close",m).onclick=()=>ov.remove();
}

// «Одинокие ноды» — предметы без области И без связей (висят в графе сами по себе, по ним трудно попасть).
// Показываем списком с удалением — чтобы убрать «непонятные кружки», не целясь мышкой в мелкую ноду.
function openLonelyNodes(){
  const m=el("div","modal");
  const looseList=()=>{ const linked=new Set(); (S.links||[]).forEach(l=>{ linked.add(l[0]); linked.add(l[1]); });
    return S.items.filter(it=>!it.deleted && (it.kind==="note"||it.kind==="task"||it.kind==="flow") && !it.area && !linked.has(it.id)); };
  const rowHtml=it=>{ const ic=it.kind==="flow"?"ti-artboard":it.kind==="note"?"ti-note":"ti-checklist";
    const ttl=(it.title||"").trim()||"(без названия)", body=(it.body||"").trim();
    return `<div class="ln-row" data-id="${it.id}"><i class="ti ${ic} ln-ic"></i><span class="ln-ttl">${esc(ttl)}${body?` — <span class="ln-sub">${esc(body.slice(0,44))}</span>`:""}</span><button class="btn ghost ln-del" data-del="${it.id}" title="Удалить"><i class="ti ti-trash"></i></button></div>`; };
  const paint=()=>{ const items=looseList();
    $(".ln-list",m).innerHTML = items.length ? items.map(rowHtml).join("") : '<div class="set-hint">Одиноких нод нет.</div>';
    $$(".ln-del",m).forEach(b=>b.onclick=()=>{ const id=b.dataset.del; deleteItem(id);
      if(typeof graph!=="undefined" && graph) graph.build();
      toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); if(typeof graph!=="undefined"&&graph) graph.build(); }}); paint(); }); };
  m.innerHTML=`<h3><i class="ti ti-circle-dashed"></i>Одинокие ноды</h3>
    <div class="set-hint">Ноды без области и без связей — «висят» в графе сами по себе. Вот они — удали лишнее.</div>
    <div class="ln-list"></div>
    <div class="modal-foot"><div class="right"><button class="btn primary" id="ln-close"><i class="ti ti-check"></i>Готово</button></div></div>`;
  const ov=overlay(m); paint();
  $("#ln-close",m).onclick=()=>ov.remove();
}

class FlowEditor{
  constructor(it){
    this.it=it; this.f=ensureFlow(it); this.view=this.f.view;
    this.selSet=new Set(); this.selEdge=null; this.elById={};
    this._eraf=null; this._needEdges=false; this._clip=null; this._space=false;
    this.GRID=24; this.snap=!!this.view.snap;
    this.ortho = this.view.edgeStyle ? this.view.edgeStyle==="ortho" : true;   // по умолчанию уголком (Houdini/Resolve)
    this.view.edgeStyle=this.ortho?"ortho":"direct";
  }
  _b(id){ return this.f.blocks.find(b=>b.id===id); }
  save(){ touch(this.it); persist(); }
  mount(){
    const NS="http://www.w3.org/2000/svg";
    const scr=el("div","flow-screen");
    scr.innerHTML=`
      <div class="flow-top">
        <button class="flow-ic flow-back" title="Назад к заметкам"><i class="ti ti-arrow-left"></i></button>
        <div class="flow-titlewrap"><i class="ti ti-artboard"></i><span class="flow-name" contenteditable spellcheck="false" data-ph="название полотна">${esc(this.it.title||"")}</span></div>
        <div class="flow-tools">
          ${FLOW_ORDER.map(k=>`<button class="flow-ic" data-add="${k}" title="${FLOW_TYPES[k].name}"><i class="ti ${FLOW_TYPES[k].icon}"></i></button>`).join("")}
          <button class="flow-ic" data-add-img title="Картинка (или перетащи файл / Ctrl+V)"><i class="ti ti-photo"></i></button>
          <button class="flow-ic" data-add-vid title="Видео (короткий клип / перетащи файл)"><i class="ti ti-movie"></i></button>
          <span class="flow-sep"></span>
          <button class="flow-ic ${this.snap?"on":""}" data-tg="snap" title="Привязка к сетке"><i class="ti ti-grid-dots"></i></button>
          <button class="flow-ic ${this.ortho?"on":""}" data-tg="ortho" title="Стрелки: уголком / напрямую"><i class="ti ti-vector"></i></button>
          <span class="flow-sep"></span>
          <button class="flow-ic" data-z="out" title="Уменьшить"><i class="ti ti-zoom-out"></i></button>
          <button class="flow-ic" data-z="in" title="Увеличить"><i class="ti ti-zoom-in"></i></button>
          <button class="flow-ic" data-z="fit" title="Показать всё"><i class="ti ti-focus-2"></i></button>
          <span class="flow-sep"></span>
          <button class="flow-ic wide" data-act="copy" title="Скопировать полотно как текст"><i class="ti ti-clipboard-text"></i>Текст</button>
        </div>
        <button class="flow-ic flow-close" title="Закрыть (Esc)"><i class="ti ti-x"></i></button>
      </div>
      <div class="flow-stage">
        <div class="flow-world">
          <svg class="flow-edges"><defs>
            <marker id="fe-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0 L10,5 L0,10 Z"></path>
            </marker></defs>
            <g class="fe-guides"></g>
            <g class="fe-g"></g>
            <path class="fe-temp" style="display:none"></path>
          </svg>
        </div>
        <div class="flow-marquee" style="display:none"></div>
        <div class="flow-hint">блоки — кнопки сверху или ПКМ по пустому · тащи блок — двигать · 2× по блоку — переименовать · тяни ⊕ — стрелка · пробел/средняя — холст · ПКМ по блоку — тип/цвет · Delete</div>
      </div>`;
    $("#overlay-root").appendChild(scr);
    this.screen=scr;
    this.stage=$(".flow-stage",scr); this.world=$(".flow-world",scr);
    this.svg=$(".flow-edges",scr); this.feG=$(".fe-g",scr); this.guideG=$(".fe-guides",scr); this.tempEdge=$(".fe-temp",scr); this.marqueeEl=$(".flow-marquee",scr); this.hintEl=$(".flow-hint",scr);
    // верхняя панель
    $(".flow-back",scr).onclick=()=>this.close();
    $(".flow-close",scr).onclick=()=>this.close();
    const nameEl=$(".flow-name",scr);
    nameEl.addEventListener("input",()=>{ this.it.title=nameEl.innerText.replace(/\n/g," ").trim(); this.save(); });
    nameEl.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); nameEl.blur(); } });
    $$("[data-add]",scr).forEach(btn=>btn.onclick=()=>this.addBlockCenter(btn.dataset.add));
    $('[data-add-img]',scr).onclick=()=>this._pickImage();
    $('[data-add-vid]',scr).onclick=()=>this._pickVideo();
    const finp=el("input"); finp.type="file"; finp.accept="image/*,video/*"; finp.multiple=true; finp.style.display="none";
    scr.appendChild(finp); this._fileInput=finp;
    finp.addEventListener("change",()=>{
      const files=[...(finp.files||[])]; if(!files.length) return;
      if(this._replaceTarget){ const b=this._b(this._replaceTarget); this._replaceTarget=null;
        if(b) this._imageFromFile(files[0],0,0,(url,w,h,nw,nh)=>{ b.src=url; b.w=w; b.h=h; b.nw=nw; b.nh=nh; b.crop={cx:0,cy:0,cw:nw,ch:nh}; b.parent=this._frameAt(b.x+b.w/2,b.y+b.h/2,b.id); this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id); });
        finp.value=""; return; }
      const at=this._dropAt||this._viewCenterWorld(); this._dropAt=null;
      files.forEach((f,i)=>this._mediaFromFile(f, at.x+i*18, at.y+i*18)); finp.value="";
    });
    $$("[data-z]",scr).forEach(btn=>btn.onclick=()=>{ const k=btn.dataset.z; if(k==="fit") this.fit(); else this.zoomBy(k==="in"?1.2:1/1.2); });
    $$("[data-tg]",scr).forEach(btn=>btn.onclick=()=>this._toggle(btn.dataset.tg,btn));
    $('[data-act="copy"]',scr).onclick=()=>this.copyText();
    this._wireStage();
    // Esc внутри редактирования текста — снять фокус, не закрывать редактор
    scr.addEventListener("keydown",e=>{
      const ae=document.activeElement, editing=ae&&scr.contains(ae)&&(ae.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
      if(e.key==="Escape"&&editing){ ae.blur(); e.stopPropagation(); e.preventDefault(); }
    },true);
    // горячие клавиши на document — фокус часто ВНЕ scr (после клика по блоку body не внутри scr),
    // поэтому слушатель на самом scr не ловил Delete (был баг «выделить+Delete не работает»)
    this._onKey=(e)=>{
      if(!this.screen||!this.screen.isConnected){ this._unkey(); return; }   // экран закрыли (в т.ч. Esc/closeOverlays) → снять слушатели
      const ae=document.activeElement, editing=ae&&this.screen.contains(ae)&&(ae.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));   // настоящие input/textarea (подпись стрелки, «текст») — тоже текст: не перехватывать клавиши
      if(this.cropping && !editing && (e.key==="Enter"||e.key==="Escape")){ this._exitCrop(); e.preventDefault(); e.stopPropagation(); return; }   // выйти из кадрирования
      if(e.code==="Space" && !editing){ this._space=true; this.stage.classList.add("panmode"); e.preventDefault(); return; }
      if(editing) return;   // в тексте — всё нативно (Ctrl+C/V, Delete по символам)
      const cmd=e.ctrlKey||e.metaKey;
      if(e.key==="Delete"||e.key==="Backspace"){ if(this.selEdge) this.deleteEdge(this.selEdge); else if(this.selSet.size) this.deleteSelection(); e.preventDefault(); }
      else if(cmd && e.code==="KeyC"){ this.copySelection(); e.preventDefault(); }
      // Ctrl+V не трогаем в keydown — пусть сработает нативное событие paste (ловим картинку ИЛИ блоки в _onPaste)
      else if(cmd && e.code==="KeyD"){ this.copySelection(); this.pasteClip(); e.preventDefault(); }
      else if(cmd && e.code==="KeyA"){ this._selectMany(this.f.blocks.map(b=>b.id),false); e.preventDefault(); }
      else if((e.key==="Enter"||e.key==="F2") && !cmd && this.selSet.size===1){ const b=this._b([...this.selSet][0]); if(b&&b.type!=="image"&&b.type!=="video"){ e.preventDefault(); this._focusTitle(b.id); } }   // Enter/F2 — переименовать выделенный блок
    };
    this._onKeyUp=(e)=>{ if(e.code==="Space"){ this._space=false; this.stage.classList.remove("panmode"); } };
    // вставка из буфера: картинка/скрин (Ctrl+V) → блок-картинка; иначе — скопированные блоки полотна
    this._onPaste=(e)=>{
      if(!this.screen||!this.screen.isConnected){ document.removeEventListener("paste",this._onPaste,true); return; }
      const ae=document.activeElement, editing=ae&&this.screen.contains(ae)&&(ae.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
      if(editing) return;   // в тексте блока — нативная вставка текста
      const dt=e.clipboardData; if(!dt) return;
      const imgItems=[...(dt.items||[])].filter(it=>it.kind==="file" && /^image\//.test(it.type));
      if(imgItems.length){ e.preventDefault(); const at=this._viewCenterWorld(); const files=imgItems.map(it=>it.getAsFile()).filter(Boolean);
        if(files.length){ files.forEach((f,i)=>this._imageFromFile(f, at.x+i*18, at.y+i*18)); toast("Картинка вставлена",{icon:"ti-photo"}); }
        else toast("Не удалось получить картинку из буфера");
        return; }
      if(this._clip && this._clip.blocks.length){ e.preventDefault(); this.pasteClip(); }
    };
    document.addEventListener("keydown",this._onKey,true);
    document.addEventListener("keyup",this._onKeyUp,true);
    document.addEventListener("paste",this._onPaste,true);
    this.applyView();
    // первый запуск пустой схемы — посеять стартовый блок, чтобы холст не пугал пустотой
    if(!this.f.blocks.length){ const r=this.stage.getBoundingClientRect(); const p=this.worldPt(r.left+r.width/2, r.top+r.height*0.32); const b=this._newBlock("terminal",p.x,p.y); b.text="Старт"; this.save(); }
    this.renderBlocks(); this.drawEdges();
  }
  _unkey(){ document.removeEventListener("keydown",this._onKey,true); document.removeEventListener("keyup",this._onKeyUp,true); document.removeEventListener("paste",this._onPaste,true); }
  close(){ if(this._eraf) cancelAnimationFrame(this._eraf); this._unkey(); this.screen.remove(); }
  _toggle(which,btn){
    if(which==="snap"){ this.snap=!this.snap; this.view.snap=this.snap; if(this.snap){ this._snapAll(); this.renderBlocks(); this.drawEdges(); } }
    else if(which==="ortho"){ this.ortho=!this.ortho; this.view.edgeStyle=this.ortho?"ortho":"direct"; this.drawEdges(); }
    btn.classList.toggle("on"); persist();
  }
  _snap(v){ return this.snap ? Math.round(v/this.GRID)*this.GRID : Math.round(v); }
  // снап позиции по ЦЕНТРУ блока: блоки разной ширины/высоты, а стрелки идут центр→центр —
  // выравнивать надо ЦЕНТРЫ, иначе связи «ломаются» даже когда блоки выглядят выровненными по краю.
  _snapCenter(x,y,w,h){ if(!this.snap) return {x:Math.round(x),y:Math.round(y)};
    const cx=Math.round((x+w/2)/this.GRID)*this.GRID, cy=Math.round((y+h/2)/this.GRID)*this.GRID;
    return {x:cx-w/2, y:cy-h/2}; }
  _snapAll(){ this.f.blocks.forEach(b=>{
    // размер снапим ПЕРВЫМ (только у текстовых блоков — у медиа это ломает пропорции кадра), потом центр
    if(b.type!=="image"&&b.type!=="video"){ b.w=Math.max(this.GRID*2,this._snap(b.w)); b.h=Math.max(this.GRID*2,this._snap(b.h)); }
    const s=this._snapCenter(b.x,b.y,b.w,b.h); b.x=s.x; b.y=s.y;
  }); }
  // магнитное выравнивание при перетаскивании: центр перетаскиваемого блока притягивается к центрам
  // ДРУГИХ блоков (тогда связь между ними строго прямая) — с гайд-линиями; иначе центр ложится на сетку.
  _alignDrag(anchor, raw){
    if(!this.snap){ this._showGuides(null,null); return {x:Math.round(raw.x), y:Math.round(raw.y)}; }
    const w=anchor.w, h=anchor.h, cx=raw.x+w/2, cy=raw.y+h/2, TH=8/this.view.zoom;   // порог в мировых px (учитываем зум)
    const gids=new Set((this.dragBlock?this.dragBlock.group:[anchor]).map(b=>b.id));
    let ncx=cx, ncy=cy, gx=null, gy=null, bx=TH, by=TH;
    this.f.blocks.forEach(o=>{ if(gids.has(o.id)||o.type==="frame") return; const ocx=o.x+o.w/2, ocy=o.y+o.h/2;   // к центру рамки-контейнера не примагничиваемся
      const dxx=Math.abs(cx-ocx); if(dxx<bx){ bx=dxx; ncx=ocx; gx=ocx; }
      const dyy=Math.abs(cy-ocy); if(dyy<by){ by=dyy; ncy=ocy; gy=ocy; } });
    if(gx===null) ncx=Math.round(cx/this.GRID)*this.GRID;   // не примагнитились к блоку → центр на сетку
    if(gy===null) ncy=Math.round(cy/this.GRID)*this.GRID;
    this._showGuides(gx,gy);
    return {x:ncx-w/2, y:ncy-h/2};
  }
  _showGuides(gx,gy){ const g=this.guideG; if(!g) return; while(g.firstChild) g.removeChild(g.firstChild);
    if(gx==null&&gy==null) return; const NS="http://www.w3.org/2000/svg";
    const r=this.stage.getBoundingClientRect(), tl=this.worldPt(r.left,r.top), br=this.worldPt(r.right,r.bottom);
    const mk=(x1,y1,x2,y2)=>{ const l=document.createElementNS(NS,"line"); l.setAttribute("class","fe-guide");
      l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2); g.appendChild(l); };
    if(gx!=null) mk(gx,tl.y,gx,br.y);
    if(gy!=null) mk(tl.x,gy,br.x,gy);
  }
  /* ---- координаты ---- */
  worldPt(cx,cy){ const r=this.stage.getBoundingClientRect(); return {x:(cx-r.left-this.view.tx)/this.view.zoom, y:(cy-r.top-this.view.ty)/this.view.zoom}; }
  applyView(){
    const {tx,ty,zoom}=this.view;
    this.world.style.transform=`translate(${tx}px,${ty}px) scale(${zoom})`;
    this.world.style.setProperty("--z", zoom);   // ручки контр-масштабируются на 1/z → постоянный экранный размер при любом зуме
    this.stage.style.backgroundSize=`${this.GRID*zoom}px ${this.GRID*zoom}px`;
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
    const s=this._snapCenter(Math.round(x-t.w/2), Math.round(y-t.h/2), t.w, t.h);
    const b={id:"b_"+uid(), type, text:"", note:"", x:s.x, y:s.y, w:t.w, h:t.h, color:null, parent:null};
    if(type!=="frame") b.parent=this._frameAt(x,y,b.id);
    this.f.blocks.push(b); return b;
  }
  addBlockCenter(type){ const r=this.stage.getBoundingClientRect(); const p=this.worldPt(r.left+r.width/2, r.top+r.height/2);
    // лёгкий каскад, чтобы новые блоки не падали точно друг на друга
    const n=this.f.blocks.length; const b=this._newBlock(type, p.x+(n%5)*14, p.y+(n%5)*14);
    this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id); this._focusTitle(b.id);
  }
  addBlockAt(type,wx,wy){ const b=this._newBlock(type,wx,wy); this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id); this._focusTitle(b.id); }
  /* ---- картинки (Полотно v2) ---- */
  _viewCenterWorld(){ const r=this.stage.getBoundingClientRect(); return this.worldPt(r.left+r.width/2, r.top+r.height/2); }
  _addMedia(type,src,wx,wy,w,h,nw,nh){
    const D=FLOW_TYPES[type]||FLOW_TYPES.image, W=w||D.w, H=h||D.h, NW=Math.round(nw||W), NH=Math.round(nh||H);
    const sp=this._snapCenter(Math.round(wx-W/2), Math.round(wy-H/2), Math.round(W), Math.round(H));
    const b={id:"b_"+uid(), type, text:"", note:"", src:src||"",
      x:sp.x, y:sp.y, w:Math.round(W), h:Math.round(H),
      nw:NW, nh:NH, crop:{cx:0,cy:0,cw:NW,ch:NH}, color:null, parent:null};
    b.parent=this._frameAt(wx,wy,b.id);
    this.f.blocks.push(b); this.renderBlocks(); this.drawEdges(); this.save(); this._select(b.id);
    return b;
  }
  _addImage(src,wx,wy,w,h,nw,nh){ return this._addMedia("image",src,wx,wy,w,h,nw,nh); }
  // картинка из файла → data-URL (даунскейл крупных); cb(url,w,h,nw,nh) — для замены без вставки нового
  _imageFromFile(file,wx,wy,cb){
    if(!file || !/^image\//.test(file.type)){ toast("Это не картинка"); return; }
    const r=new FileReader();
    r.onerror=()=>toast("Не удалось прочитать файл");
    r.onload=()=>{ const raw=String(r.result||""); const im=new Image();
      im.onload=()=>{ let NW=im.naturalWidth||FLOW_TYPES.image.w, NH=im.naturalHeight||FLOW_TYPES.image.h, url=raw;
        const STORE=1400;   // не храним оригиналы в полном разрешении — данные (json/localStorage) раздуваются
        if(NW>STORE||NH>STORE){ const k=STORE/Math.max(NW,NH), sw=Math.round(NW*k), sh=Math.round(NH*k);
          try{ const cv=document.createElement("canvas"); cv.width=sw; cv.height=sh; cv.getContext("2d").drawImage(im,0,0,sw,sh);
            url=cv.toDataURL("image/jpeg",0.85); NW=sw; NH=sh; }catch(_){} }
        let w=NW, h=NH; const MAX=360; if(w>MAX||h>MAX){ const k=MAX/Math.max(w,h); w=Math.round(w*k); h=Math.round(h*k); }
        cb ? cb(url,w,h,NW,NH) : this._addMedia("image",url,wx,wy,w,h,NW,NH); };
      im.onerror=()=>{ const D=FLOW_TYPES.image; cb ? cb(raw,D.w,D.h,D.w,D.h) : this._addMedia("image",raw,wx,wy,D.w,D.h,D.w,D.h); };
      im.src=raw; };
    r.readAsDataURL(file);
  }
  // видео из файла → data-URL (короткие клипы; хранение файлом в data/media — следующий шаг)
  _videoFromFile(file,wx,wy){
    if(!file || !/^video\//.test(file.type)){ toast("Это не видео"); return; }
    const CAP=18*1024*1024;
    if(file.size>CAP){ toast("Видео крупнее 18 МБ — пока только короткие клипы"); return; }
    const r=new FileReader();
    r.onerror=()=>toast("Не удалось прочитать видео");
    r.onload=()=>{ const url=String(r.result||""); const v=document.createElement("video"); v.preload="metadata";
      v.onloadedmetadata=()=>{ let NW=v.videoWidth||320, NH=v.videoHeight||180, w=NW, h=NH;
        const MAX=360; if(w>MAX||h>MAX){ const k=MAX/Math.max(w,h); w=Math.round(w*k); h=Math.round(h*k); }
        this._addMedia("video",url,wx,wy,w,h,NW,NH); };
      v.onerror=()=>{ const D=FLOW_TYPES.video; this._addMedia("video",url,wx,wy,D.w,D.h,16,9); };
      v.src=url; };
    r.readAsDataURL(file);
  }
  _mediaFromFile(file,wx,wy){ if(file&&/^video\//.test(file.type)) this._videoFromFile(file,wx,wy); else this._imageFromFile(file,wx,wy); }
  _pickImage(){ if(!this._fileInput) return; this._replaceTarget=null; this._dropAt=this._viewCenterWorld(); this._fileInput.accept="image/*"; this._fileInput.value=""; this._fileInput.click(); }
  _pickVideo(){ if(!this._fileInput) return; this._replaceTarget=null; this._dropAt=this._viewCenterWorld(); this._fileInput.accept="video/*"; this._fileInput.value=""; this._fileInput.click(); }
  _replaceImage(b){ if(!this._fileInput) return; this._replaceTarget=b.id; this._fileInput.accept="image/*"; this._fileInput.value=""; this._fileInput.click(); }
  _fullCrop(b){ return {cx:0,cy:0,cw:b.nw,ch:b.nh}; }
  _isCropped(b){ const c=b.crop; return !!(c && (c.cx>0.5 || c.cy>0.5 || c.cw<b.nw-0.5 || c.ch<b.nh-0.5)); }
  // прямоугольник источника crop={cx,cy,cw,ch} растягивается на рамку w×h (sx,sy независимы → ресайз делает шире/выше, не перекадрирует)
  _applyImg(b,elx){ elx=elx||this.elById[b.id]; if(!elx) return; const m=$(".fb-img",elx)||$(".fb-vid",elx); if(!m) return;
    if(this.cropping===b.id && this._cropAnchor){ const A=this._cropAnchor;   // кадрирование: картинка зафиксирована, рамка ездит — яркую копию выравниваем по фону
      m.style.width=(b.nw*A.Sx)+"px"; m.style.height=(b.nh*A.Sy)+"px"; m.style.left=(A.imgX-b.x)+"px"; m.style.top=(A.imgY-b.y)+"px"; return; }
    const c=b.crop||this._fullCrop(b), sx=b.w/(c.cw||1), sy=b.h/(c.ch||1);
    m.style.width=(b.nw*sx)+"px"; m.style.height=(b.nh*sy)+"px"; m.style.left=(-c.cx*sx)+"px"; m.style.top=(-c.cy*sy)+"px"; }
  _uncrop(b){ const c=b.crop||this._fullCrop(b), sx=b.w/(c.cw||1), sy=b.h/(c.ch||1);   // рамка РАСТЁТ до полного кадра при текущем масштабе → проявляется всё изображение, видимая часть остаётся на месте
    b.x=Math.round(b.x - c.cx*sx); b.y=Math.round(b.y - c.cy*sy);
    b.w=Math.max(this.GRID, Math.round(b.nw*sx)); b.h=Math.max(this.GRID, Math.round(b.nh*sy));
    b.crop=this._fullCrop(b); b.parent=this._frameAt(b.x+b.w/2,b.y+b.h/2,b.id);
    this.renderBlocks(); this.drawEdges(); this.save(); }
  // КАДРИРОВАНИЕ НА МЕСТЕ: картинка ЗАФИКСИРОВАНА (дим-фон), двигаешь/ресайзишь РАМКУ выделения поверх неё
  _enterCrop(b){ if(b.type!=="image"&&b.type!=="video") return; this._closeFlowPop();
    const c=b.crop||this._fullCrop(b), Sx=b.w/c.cw, Sy=b.h/c.ch;
    this._cropAnchor={ Sx, Sy, imgX:b.x - c.cx*Sx, imgY:b.y - c.cy*Sy };   // фикс. положение/масштаб картинки на время кадрирования
    this.cropping=b.id; this.renderBlocks(); this.drawEdges();
    toast("Кадрирование: тащи рамку · углы/края — размер · колесо — зум · Enter — готово",{icon:"ti-crop"}); }
  _exitCrop(){ if(!this.cropping) return; this.cropping=null; this._cropAnchor=null;
    $$(".fb-cropbg",this.world).forEach(n=>n.remove()); this.renderBlocks(); this.drawEdges(); this.save(); }
  // листенеры кадрирования: картинка зафиксирована (фон .fb-cropbg), двигаем/ресайзим РАМКУ (блок) поверх; crop выводим из положения рамки
  _wireCrop(b,elx){
    const A=this._cropAnchor; if(!A) return;
    const imgW=b.nw*A.Sx, imgH=b.nh*A.Sy, MINW=Math.max(this.GRID,16*A.Sx), MINH=Math.max(this.GRID,16*A.Sy);
    const derive=()=>{ const c=b.crop;
      c.cx=Math.max(0,Math.min(b.nw,(b.x-A.imgX)/A.Sx)); c.cy=Math.max(0,Math.min(b.nh,(b.y-A.imgY)/A.Sy));
      c.cw=Math.max(1,Math.min(b.nw-c.cx,b.w/A.Sx)); c.ch=Math.max(1,Math.min(b.nh-c.cy,b.h/A.Sy)); };
    let act=null;
    elx.addEventListener("pointerdown",(e)=>{ if(e.target.closest(".fb-cropdone")) return;
      e.preventDefault(); e.stopPropagation(); const hz=e.target.closest("[data-rz]");
      act={ mode:hz?"rz":"pan", rz:hz?hz.dataset.rz:"", x0:b.x, y0:b.y, w0:b.w, h0:b.h, mx:e.clientX, my:e.clientY };
      try{ elx.setPointerCapture(e.pointerId); }catch(_){} });
    elx.addEventListener("pointermove",(e)=>{ if(!act) return; const zz=this.view.zoom||1;
      const dwx=(e.clientX-act.mx)/zz, dwy=(e.clientY-act.my)/zz;
      if(act.mode==="pan"){   // двигаем рамку, не выходя за границы картинки
        b.x=Math.round(Math.max(A.imgX, Math.min(A.imgX+imgW-b.w, act.x0+dwx)));
        b.y=Math.round(Math.max(A.imgY, Math.min(A.imgY+imgH-b.h, act.y0+dwy)));
      } else {
        const rz=act.rz; let x=act.x0,y=act.y0,w=act.w0,h=act.h0;
        if(rz.indexOf("e")>=0){ w=Math.max(MINW, Math.min(A.imgX+imgW-x, act.w0+dwx)); }
        if(rz.indexOf("w")>=0){ const nx=Math.max(A.imgX, Math.min(act.x0+act.w0-MINW, act.x0+dwx)); w=act.w0+(act.x0-nx); x=nx; }
        if(rz.indexOf("s")>=0){ h=Math.max(MINH, Math.min(A.imgY+imgH-y, act.h0+dwy)); }
        if(rz.indexOf("n")>=0){ const ny=Math.max(A.imgY, Math.min(act.y0+act.h0-MINH, act.y0+dwy)); h=act.h0+(act.y0-ny); y=ny; }
        b.x=Math.round(x); b.y=Math.round(y); b.w=Math.round(w); b.h=Math.round(h);
      }
      derive(); this._pos(b,elx); this._scheduleEdges(); this._applyImg(b,elx); });
    elx.addEventListener("pointerup",()=>{ if(act){ act=null; this._recomputeMembership(); this.save(); } });
    elx.addEventListener("wheel",(e)=>{ e.preventDefault(); e.stopPropagation();   // зум рамки вокруг её центра (меньше рамка = плотнее обрезка)
      const k=e.deltaY<0?1/1.12:1.12, nw_=Math.max(MINW, Math.min(imgW, b.w*k)), nh_=Math.max(MINH, Math.min(imgH, b.h*k));
      let nx=b.x+b.w/2-nw_/2, ny=b.y+b.h/2-nh_/2;
      nx=Math.max(A.imgX, Math.min(A.imgX+imgW-nw_, nx)); ny=Math.max(A.imgY, Math.min(A.imgY+imgH-nh_, ny));
      b.x=Math.round(nx); b.y=Math.round(ny); b.w=Math.round(nw_); b.h=Math.round(nh_);
      derive(); this._pos(b,elx); this._scheduleEdges(); this._applyImg(b,elx); this.save(); },{passive:false});
  }
  _frameAt(x,y,exclude){ let best=null,bestA=Infinity;
    this.f.blocks.forEach(b=>{ if(b.type!=="frame"||b.id===exclude) return;
      if(x>=b.x&&x<=b.x+b.w&&y>=b.y&&y<=b.y+b.h){ const a=b.w*b.h; if(a<bestA){bestA=a;best=b.id;} } });
    return best;
  }
  _descendants(id){ return this.f.blocks.filter(b=>b.parent===id); }
  // членство в рамках выводим из геометрии: не-рамочный блок принадлежит наименьшей накрывающей рамке
  _recomputeMembership(){ this.f.blocks.forEach(b=>{ if(b.type==="frame") return; b.parent=this._frameAt(b.x+b.w/2,b.y+b.h/2,b.id); }); }
  deleteBlock(id){ const b=this._b(id); if(!b) return;
    this.f.blocks.forEach(c=>{ if(c.parent===id) c.parent=null; });   // дети рамки — на верхний уровень
    this.f.blocks=this.f.blocks.filter(x=>x.id!==id);
    this.f.edges=this.f.edges.filter(e=>e.from!==id&&e.to!==id);
    this.selSet.delete(id);
    this.renderBlocks(); this.drawEdges(); this.save();
  }
  deleteSelection(){ const ids=new Set(this.selSet); if(!ids.size) return;
    this.f.blocks.forEach(c=>{ if(ids.has(c.parent)) c.parent=null; });
    this.f.blocks=this.f.blocks.filter(b=>!ids.has(b.id));
    this.f.edges=this.f.edges.filter(e=>!ids.has(e.from)&&!ids.has(e.to));
    this.selSet.clear(); this.renderBlocks(); this.drawEdges(); this.save();
  }
  _blockHTML(b){
    if(b.type==="image"||b.type==="video"){
      const cropping=this.cropping===b.id;
      const media=b.type==="video"
        ? `<video class="fb-vid" src="${esc(b.src||"")}" ${cropping?"":"controls"} preload="metadata" playsinline></video>`
        : `<img class="fb-img" src="${esc(b.src||"")}" draggable="false" alt="">`;
      const handles=`<span class="fb-rz nw" data-rz="nw"></span><span class="fb-rz ne" data-rz="ne"></span><span class="fb-rz sw" data-rz="sw"></span><span class="fb-rz se" data-rz="se"></span>
         <span class="fb-edge n" data-rz="n"></span><span class="fb-edge s" data-rz="s"></span><span class="fb-edge w" data-rz="w"></span><span class="fb-edge e" data-rz="e"></span>`;
      const cropBtn=cropping?"":`<button class="fb-crop" title="Кадрировать (2× клик)"><i class="ti ti-crop"></i></button>`;
      const cropUI=cropping?`<div class="fb-cropframe"></div><button class="fb-cropdone" title="Готово (Enter)"><i class="ti ti-check"></i>Готово</button>`:"";
      return `${media}
        <div class="fb-grip"><i class="ti ti-grip-horizontal"></i></div>
        ${handles}${cropBtn}${cropUI}
        <button class="fb-x" title="Удалить"><i class="ti ti-x"></i></button>`;
    }
    const t=FLOW_TYPES[b.type];
    const tag = b.type!=="proc" ? `<span class="fb-tag"><i class="ti ${t.icon}"></i></span>` : "";
    const note = "";   // поле «комментарий» убрано по просьбе KROLIK — лишнее в блоке
    const ph = b.type==="comment"?"комментарий…" : b.type==="frame"?"название рамки" : "текст блока";
    const port = b.type!=="frame" ? `<button class="fb-port" title="Потяни — стрелка"><i class="ti ti-arrow-down"></i></button>` : "";
    // привязка блока к реальной заметке/задаче/схеме (клик открывает её)
    let ref="";
    if(b.type!=="frame" && b.refId){ const r=S.items.find(i=>i.id===b.refId);
      if(r) ref=`<div class="fb-ref" title="Открыть «${esc(r.title||"")}»"><i class="ti ${r.kind==="flow"?"ti-artboard":r.kind==="note"?"ti-note":"ti-checklist"}"></i><span>${esc(r.title||"(без названия)")}</span></div>`; }
    return `<div class="fb-grip"><i class="ti ti-grip-horizontal"></i></div>
      <div class="fb-main">${tag}<div class="fb-title" contenteditable="false" spellcheck="false" data-ph="${ph}">${esc(b.text||"")}</div>${note}${ref}</div>
      ${port}<span class="fb-edge n" data-rz="n"></span><span class="fb-edge s" data-rz="s"></span><span class="fb-edge w" data-rz="w"></span><span class="fb-edge e" data-rz="e"></span><div class="fb-resize" title="Размер"></div><button class="fb-x" title="Удалить"><i class="ti ti-x"></i></button>`;
  }
  _buildBlock(b){
    const elx=el("div","flow-block fb-"+b.type+(this.selSet.has(b.id)?" sel":"")+(this.cropping===b.id?" fb-cropping":"")+(b.color?" fb-colored":""));
    elx.dataset.id=b.id; if(b.color) elx.style.setProperty("--c",b.color);
    elx.innerHTML=this._blockHTML(b); this._pos(b,elx);
    // ввод текста — пишем в данные, без ре-рендера (иначе слетает каретка)
    const ttl=$(".fb-title",elx); if(ttl) ttl.addEventListener("input",()=>{ b.text=ttl.innerText.replace(/ /g," "); this.save(); });
    const nt=$(".fb-note",elx); if(nt) nt.addEventListener("input",()=>{ b.note=nt.innerText.replace(/ /g," "); this.save(); });
    if(ttl){ ttl.addEventListener("keydown",e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); ttl.blur(); } });   // Enter завершает переименование (как у названия полотна); Shift+Enter — перенос
      ttl.addEventListener("blur",()=>ttl.setAttribute("contenteditable","false")); }   // вышли из правки → снова не-editable, чтобы блок тащился с текста
    const x=$(".fb-x",elx); if(x) x.onclick=(e)=>{ e.stopPropagation(); this.deleteBlock(b.id); };
    const rf=$(".fb-ref",elx); if(rf) rf.onclick=(e)=>{ e.stopPropagation(); const r=S.items.find(i=>i.id===b.refId); if(r) openItemSmart(r); };
    const cropBtn=$(".fb-crop",elx); if(cropBtn) cropBtn.onclick=(e)=>{ e.stopPropagation(); this._enterCrop(b); };
    const cropDone=$(".fb-cropdone",elx); if(cropDone) cropDone.onclick=(e)=>{ e.stopPropagation(); this._exitCrop(); };
    if(this.cropping===b.id) this._wireCrop(b,elx);   // режим кадрирования: панорама перетаскиванием + зум колесом
    elx.addEventListener("input",()=>this._autoGrow(b,elx));   // авто-рост высоты под текст (input всплывает из contenteditable)
    elx.addEventListener("contextmenu",e=>{ e.preventDefault(); e.stopPropagation(); this._blockPop(b,e); });
    this.world.appendChild(elx); this.elById[b.id]=elx; if(b.type==="image"||b.type==="video") this._applyImg(b,elx); this._autoGrow(b,elx); return elx;
  }
  // высота под текст: растёт под контент, и УЖИМАЕТСЯ обратно при удалении текста (до дефолтной мин-высоты типа).
  // если блок ресайзили вручную (b.fixedH) — только растим, не ужимаем (уважаем заданную высоту).
  _autoGrow(b,elx){ elx=elx||this.elById[b.id]; if(!elx||b.type==="frame"||b.type==="image"||b.type==="video") return;
    const main=$(".fb-main",elx), grip=$(".fb-grip",elx); if(!main) return;
    const need=Math.ceil((grip?grip.offsetHeight:0)+main.scrollHeight+2);
    const minH=Math.max(this.GRID*2,(FLOW_TYPES[b.type]||{}).h||this.GRID*2);
    let nh = b.fixedH ? Math.max(b.h,need) : Math.max(minH,need);
    if(this.snap) nh=Math.ceil(nh/this.GRID)*this.GRID;
    if(nh!==b.h){ b.h=nh; this._pos(b,elx); this._scheduleEdges(); }
  }
  _pos(b,elx){ elx=elx||this.elById[b.id]; if(!elx) return; elx.style.left=b.x+"px"; elx.style.top=b.y+"px"; elx.style.width=b.w+"px"; elx.style.height=b.h+"px"; if(b.type==="image"||b.type==="video") this._applyImg(b,elx); }
  renderBlocks(){
    $$(".flow-block",this.world).forEach(n=>n.remove()); $$(".fb-cropbg",this.world).forEach(n=>n.remove()); this.elById={};
    // рамки рисуем первыми (ниже), затем остальные — порядок в DOM + z-index в CSS
    const ord=this.f.blocks.slice().sort((a,b)=>(a.type==="frame"?0:1)-(b.type==="frame"?0:1));
    ord.forEach(b=>this._buildBlock(b));
    if(this.cropping && this._cropAnchor){ const cb=this._b(this.cropping); if(cb) this._buildCropBg(cb); }   // зафиксированное (дим) изображение под рамкой кадра
    if(this.hintEl) this.hintEl.style.display=this.f.blocks.length?"none":"";   // подсказка только на пустом холсте (иначе перекрывает нижние блоки)
  }
  _buildCropBg(b){ const A=this._cropAnchor; const bg=el("div","fb-cropbg");
    bg.innerHTML = b.type==="video" ? `<video src="${esc(b.src||"")}" muted preload="auto" playsinline></video>` : `<img src="${esc(b.src||"")}" draggable="false" alt="">`;
    bg.style.left=A.imgX+"px"; bg.style.top=A.imgY+"px"; bg.style.width=(b.nw*A.Sx)+"px"; bg.style.height=(b.nh*A.Sy)+"px";
    this.world.appendChild(bg);
  }
  // войти в правку текста: делаем заголовок редактируемым (иначе он не editable — чтобы блок тащился с любого места), фокус + выделение
  _focusTitle(id){ const elx=this.elById[id]; if(!elx) return; const t=$(".fb-title",elx); if(t){ t.setAttribute("contenteditable","true"); t.focus();
    const r=document.createRange(); r.selectNodeContents(t); r.collapse(false); const s=getSelection(); s.removeAllRanges(); s.addRange(r); } }
  /* ---- выделение (мультивыбор) ---- */
  _select(id,additive){
    if(additive){ if(this.selSet.has(id)) this.selSet.delete(id); else if(id) this.selSet.add(id); }
    else { this.selSet.clear(); if(id) this.selSet.add(id); }
    this.selEdge=null; this._paintSel();
  }
  _selectMany(ids,additive){ if(!additive) this.selSet.clear(); ids.forEach(i=>this.selSet.add(i)); this.selEdge=null; this._paintSel(); }
  _clearSel(){ this.selSet.clear(); this.selEdge=null; this._paintSel(); }
  _paintSel(){ $$(".flow-block",this.world).forEach(n=>n.classList.toggle("sel",this.selSet.has(n.dataset.id))); this.drawEdges(); }
  // что двигать/копировать вместе: выбранные блоки + потомки выбранных рамок
  _dragGroup(){ const ids=new Set(this.selSet);
    this.selSet.forEach(id=>{ const b=this._b(id); if(b&&b.type==="frame") this._descendants(id).forEach(k=>ids.add(k.id)); });
    return [...ids].map(id=>this._b(id)).filter(Boolean);
  }
  copySelection(){ if(!this.selSet.size) return;
    const ids=new Set(this._dragGroup().map(b=>b.id));
    const blocks=this.f.blocks.filter(b=>ids.has(b.id)).map(b=>{ const c=Object.assign({},b); if(c.crop) c.crop=Object.assign({},c.crop); return c; });
    const edges=this.f.edges.filter(e=>ids.has(e.from)&&ids.has(e.to)).map(e=>Object.assign({},e));
    this._clip={blocks,edges}; toast("Скопировано: "+blocks.length,{icon:"ti-copy"});
  }
  pasteClip(){ const clip=this._clip; if(!clip||!clip.blocks.length) return;
    const off=this.snap?this.GRID:18, map={};
    const nb=clip.blocks.map(b=>{ const id="b_"+uid(); map[b.id]=id; const k=Object.assign({},b,{id, x:b.x+off, y:b.y+off}); if(k.crop) k.crop=Object.assign({},k.crop); return k; });
    nb.forEach(b=>{ b.parent=(b.parent&&map[b.parent])?map[b.parent]:null; });   // связь с рамкой — только если рамку тоже копировали
    const ne=clip.edges.map(e=>({id:"e_"+uid(), from:map[e.from], to:map[e.to], label:e.label||""}));
    this.f.blocks.push(...nb); this.f.edges.push(...ne);
    this.renderBlocks(); this.drawEdges(); this.save(); this._selectMany(nb.map(b=>b.id),false);
  }
  /* ---- стрелки ---- */
  _addEdge(from,to){ if(from===to) return; if(this.f.edges.some(e=>e.from===from&&e.to===to)){ toast("Уже соединено"); return; }
    this.f.edges.push({id:"e_"+uid(),from,to,label:""}); this.drawEdges(); this.save(); }
  deleteEdge(id){ this.f.edges=this.f.edges.filter(e=>e.id!==id); if(this.selEdge===id) this.selEdge=null; this.drawEdges(); this.save(); this._closeFlowPop(); }
  _edgePoint(b,tx,ty){ const cx=b.x+b.w/2, cy=b.y+b.h/2; let dx=tx-cx, dy=ty-cy; if(!dx&&!dy) return {x:cx,y:cy};
    const sx=dx?(b.w/2)/Math.abs(dx):Infinity, sy=dy?(b.h/2)/Math.abs(dy):Infinity, s=Math.min(sx,sy);
    return {x:cx+dx*s, y:cy+dy*s}; }
  _scheduleEdges(){ if(this._needEdges) return; this._needEdges=true; this._eraf=requestAnimationFrame(()=>{ this._needEdges=false; this.drawEdges(); }); }
  // маршрут стрелки: напрямую (2 точки) или уголком H/V (4 точки)
  _directPts(a,b){ return [this._edgePoint(a,b.x+b.w/2,b.y+b.h/2), this._edgePoint(b,a.x+a.w/2,a.y+a.h/2)]; }
  // ortho-маршрут: выход из ЦЕНТРА стороны блока (стрелки из одной точки, как и хотел КРОЛИК).
  // off — сдвиг только среднего КОРИДОРА, чтобы совпадающие коридоры разных рёбер не ложились в жирную линию.
  _orthoPts(a,b,off){ off=off||0; const ac={x:a.x+a.w/2,y:a.y+a.h/2}, bc={x:b.x+b.w/2,y:b.y+b.h/2}, dx=bc.x-ac.x, dy=bc.y-ac.y;
    if(Math.abs(dy)>=Math.abs(dx)){ const sy=dy>=0?a.y+a.h:a.y, ey=dy>=0?b.y:b.y+b.h, my=(sy+ey)/2+off;
      return [{x:ac.x,y:sy},{x:ac.x,y:my},{x:bc.x,y:my},{x:bc.x,y:ey}]; }
    const sx=dx>=0?a.x+a.w:a.x, ex=dx>=0?b.x:b.x+b.w, mx=(sx+ex)/2+off;
    return [{x:sx,y:ac.y},{x:mx,y:ac.y},{x:mx,y:bc.y},{x:ex,y:bc.y}]; }
  // путь по точкам со СКРУГЛЁННЫМИ углами (мягкий «локоть», а не резкий прямой угол)
  _ptsToPath(p){ if(!p.length) return "";
    if(p.length<3) return "M "+p[0].x.toFixed(1)+" "+p[0].y.toFixed(1)+(p[1]?" L "+p[1].x.toFixed(1)+" "+p[1].y.toFixed(1):"");
    const R=12; let d="M "+p[0].x.toFixed(1)+" "+p[0].y.toFixed(1);
    for(let i=1;i<p.length-1;i++){ const a=p[i-1], c=p[i], b=p[i+1];
      const l1=Math.hypot(c.x-a.x,c.y-a.y)||1, l2=Math.hypot(b.x-c.x,b.y-c.y)||1, r=Math.min(R,l1/2,l2/2);
      const p1={x:c.x-(c.x-a.x)/l1*r, y:c.y-(c.y-a.y)/l1*r}, p2={x:c.x+(b.x-c.x)/l2*r, y:c.y+(b.y-c.y)/l2*r};
      d+=" L "+p1.x.toFixed(1)+" "+p1.y.toFixed(1)+" Q "+c.x.toFixed(1)+" "+c.y.toFixed(1)+" "+p2.x.toFixed(1)+" "+p2.y.toFixed(1); }
    const e=p[p.length-1]; d+=" L "+e.x.toFixed(1)+" "+e.y.toFixed(1); return d; }
  drawEdges(){
    const NS="http://www.w3.org/2000/svg"; const g=this.feG; while(g.firstChild) g.removeChild(g.firstChild);
    // разводим только СОВПАДАЮЩИЕ коридоры (ось + позиция коридора ~совпали) → две стрелки не ложатся жирной линией.
    // Точки выхода при этом остаются в центре стороны (стрелки из одной точки).
    const info=this.f.edges.map(e=>{ const a=this._b(e.from), b=this._b(e.to); if(!a||!b) return null;
      const dx=(b.x+b.w/2)-(a.x+a.w/2), dy=(b.y+b.h/2)-(a.y+a.h/2), vert=Math.abs(dy)>=Math.abs(dx);
      const base=vert ? ((dy>=0?a.y+a.h:a.y)+(dy>=0?b.y:b.y+b.h))/2 : ((dx>=0?a.x+a.w:a.x)+(dx>=0?b.x:b.x+b.w))/2;
      return {id:e.id, key:(vert?"V":"H")+"|"+Math.round(base/6)}; }).filter(Boolean);
    const gr={}; info.forEach(it=>(gr[it.key]||(gr[it.key]=[])).push(it.id));
    const off={}; Object.keys(gr).forEach(k=>{ const arr=gr[k], n=arr.length; arr.forEach((id,i)=>{ off[id]= n>1?(i-(n-1)/2)*12:0; }); });
    this.f.edges.forEach(e=>{
      const a=this._b(e.from), b=this._b(e.to); if(!a||!b) return;
      const pts=this.ortho?this._orthoPts(a,b,off[e.id]||0):this._directPts(a,b), d=this._ptsToPath(pts), sel=this.selEdge===e.id;
      const hit=document.createElementNS(NS,"path"); hit.setAttribute("class","fe-hit"); hit.dataset.id=e.id; hit.setAttribute("d",d); g.appendChild(hit);
      const ln=document.createElementNS(NS,"path"); ln.setAttribute("class","fe-line"+(sel?" sel":"")); ln.setAttribute("marker-end","url(#fe-arrow)"); ln.setAttribute("d",d); g.appendChild(ln);
      if(e.label){ const mx=(pts[0].x+pts[pts.length-1].x)/2, my=(pts[0].y+pts[pts.length-1].y)/2; const t=document.createElementNS(NS,"text");
        t.setAttribute("class","fe-label"); t.setAttribute("x",mx); t.setAttribute("y",my-3); t.setAttribute("text-anchor","middle");
        t.textContent=e.label.length>26?e.label.slice(0,25)+"…":e.label; g.appendChild(t); }
    });
  }
  _startConnect(id,e){ this.connecting=id; this.tempEdge.style.display=""; this._updateTemp(this.worldPt(e.clientX,e.clientY)); }
  _updateTemp(wp){ const a=this._b(this.connecting); if(!a) return; const pa=this._edgePoint(a,wp.x,wp.y);
    this.tempEdge.setAttribute("d",`M ${pa.x} ${pa.y} L ${wp.x} ${wp.y}`); }
  _endConnect(){ this.connecting=null; this.tempEdge.style.display="none"; this._hoverTarget(null); }
  _hoverTarget(id){ $$(".flow-block",this.world).forEach(n=>n.classList.toggle("tgt",!!id&&n.dataset.id===id)); }
  _selectEdge(id,e){ this.selSet.clear(); this.selEdge=id; this._paintSel(); this._edgePop(this._edgeById(id),e); }
  _edgeById(id){ return this.f.edges.find(e=>e.id===id); }
  /* ---- ввод указателя на холсте ---- */
  _wireStage(){
    const st=this.stage;
    st.onpointerdown=(e)=>{
      if(e.target.closest(".flow-pop")) return;   // клики по поповеру обрабатывает он сам (был баг «кнопки не работают»)
      if(this.cropping){ if(e.target.closest(".flow-block.fb-cropping")) return; this._exitCrop(); return; }   // клик вне кадрируемого — выйти из режима
      // пан: средняя кнопка ИЛИ пробел+ЛКМ
      if(e.button===1 || (e.button===0 && this._space)){ e.preventDefault(); this._closeFlowPop();
        this.panning={x:e.clientX,y:e.clientY,tx:this.view.tx,ty:this.view.ty}; st.setPointerCapture(e.pointerId); return; }
      if(e.button!==0) return;
      const port=e.target.closest(".fb-port");
      if(port){ e.preventDefault(); this._startConnect(port.closest(".flow-block").dataset.id,e); st.setPointerCapture(e.pointerId); return; }
      const hz=e.target.closest("[data-rz]");   // ручка медиа: углы (nw/ne/sw/se) — пропорция, края (n/s/w/e) — одна ось
      if(hz){ const b=this._b(hz.closest(".flow-block").dataset.id); if(b){ const rz=hz.dataset.rz;
          this.resizing={ b, rz, corner:rz.length===2,
            ax: rz.indexOf("w")>=0?b.x+b.w:b.x, ay: rz.indexOf("n")>=0?b.y+b.h:b.y,
            asp: b.h?b.w/b.h:1, img:(b.type==="image"||b.type==="video") }; }   // медиа — с пропорцией/кадром; текст/рамка — свободный ресайз за край
        st.setPointerCapture(e.pointerId); return; }
      const rez=e.target.closest(".fb-resize");
      if(rez){ const b=this._b(rez.closest(".flow-block").dataset.id); this.resizing={b,sx:e.clientX,sy:e.clientY,w:b.w,h:b.h}; st.setPointerCapture(e.pointerId); return; }
      if(e.target.closest(".fb-x")||e.target.closest(".fb-ref")||e.target.closest(".fb-crop")||e.target.closest(".fb-cropdone")) return;
      if(e.target.tagName==="VIDEO"){ const be=e.target.closest(".flow-block"); if(be && !this.selSet.has(be.dataset.id)) this._select(be.dataset.id); return; }   // нативные контролы видео — блок не тащим
      if(e.target.closest('[contenteditable="true"]')){ const be=e.target.closest(".flow-block"); if(be && !this.selSet.has(be.dataset.id)) this._select(be.dataset.id); return; }   // тащить блок можно откуда угодно; текст перехватываем ТОЛЬКО когда уже редактируем (2× клик)
      const be=e.target.closest(".flow-block");
      if(be){ const id=be.dataset.id;
        // Двойной клик → правка текста. Детектим ВРУЧНУЮ: нативный dblclick в WebView2 не приходит
        // после setPointerCapture на первом клике, поэтому на него не полагаемся.
        if(this._lastTap && this._lastTap.id===id && (e.timeStamp-this._lastTap.t)<400 && !e.target.closest('[contenteditable="true"]')){
          this._lastTap=null; e.preventDefault(); this._select(id); this._focusTitle(id); return; }
        this._lastTap={id, t:e.timeStamp};
        if(e.shiftKey){ this._select(id,true); return; }              // shift+клик — в выделение, без перетаскивания
        if(!this.selSet.has(id)) this._select(id);                     // не выделен → выделяем соло
        const wp=this.worldPt(e.clientX,e.clientY), anchor=this._b(id);
        this.dragBlock={anchor, ox:wp.x-anchor.x, oy:wp.y-anchor.y, moved:false, group:this._dragGroup()};
        st.setPointerCapture(e.pointerId); this._closeFlowPop(); return; }
      const he=e.target.closest(".fe-hit");
      if(he){ this._selectEdge(he.dataset.id,e); return; }
      // пусто → рамка выделения (тащи) либо снять выделение (клик)
      this._closeFlowPop(); if(!e.shiftKey) this._clearSel();
      const r=st.getBoundingClientRect();
      this.marquee={x0:e.clientX,y0:e.clientY,add:e.shiftKey,base:new Set(this.selSet)};
      this.marqueeEl.style.display=""; this.marqueeEl.style.left=(e.clientX-r.left)+"px"; this.marqueeEl.style.top=(e.clientY-r.top)+"px";
      this.marqueeEl.style.width="0px"; this.marqueeEl.style.height="0px";
      st.setPointerCapture(e.pointerId);
    };
    st.onpointermove=(e)=>{
      if(this.dragBlock){ const wp=this.worldPt(e.clientX,e.clientY), d=this.dragBlock;
        const sn=this._alignDrag(d.anchor, {x:wp.x-d.ox, y:wp.y-d.oy}), dx=sn.x-d.anchor.x, dy=sn.y-d.anchor.y;
        if(dx||dy){ d.group.forEach(b=>{ b.x+=dx; b.y+=dy; this._pos(b); }); d.moved=true; this._scheduleEdges(); }
        return; }
      if(this.resizing && this.resizing.img){ const R=this.resizing, b=R.b, wp=this.worldPt(e.clientX,e.clientY), MIN=this.GRID;
        if(e.shiftKey){   // Shift (любая ручка) — пропорционально, с ВОЗВРАТОМ к исходному соотношению сторон кадра (cw/ch)
          const c=b.crop||this._fullCrop(b), natAsp=(c.cw||1)/(c.ch||1);
          if(R.corner || R.rz==="w" || R.rz==="e"){   // ширина-ведущая
            let W=Math.abs(wp.x-R.ax); if(R.corner) W=Math.max(W, Math.abs(wp.y-R.ay)*natAsp);
            W=Math.max(MIN, this._snap(W)); const H=Math.max(1, Math.round(W/natAsp));
            b.w=W; b.h=H; b.x=R.rz.indexOf("w")>=0?R.ax-W:R.ax; b.y=R.rz.indexOf("n")>=0?R.ay-H:R.ay;
          } else {   // высота-ведущая (края n/s)
            const H=Math.max(MIN, this._snap(Math.abs(wp.y-R.ay))), W=Math.max(1, Math.round(H*natAsp));
            b.h=H; b.w=W; b.y=R.rz.indexOf("n")>=0?R.ay-H:R.ay; b.x=R.rz.indexOf("w")>=0?R.ax-W:R.ax;
          }
        }
        else if(R.corner){ const dw=Math.abs(wp.x-R.ax), dh=Math.abs(wp.y-R.ay);
          let W=Math.max(dw, dh*R.asp); W=Math.max(MIN, this._snap(W)); const H=Math.max(1, Math.round(W/R.asp));
          b.w=W; b.h=H; b.x=R.rz.indexOf("w")>=0?R.ax-W:R.ax; b.y=R.rz.indexOf("n")>=0?R.ay-H:R.ay; }
        else if(R.rz==="w"||R.rz==="e"){ const W=Math.max(MIN, this._snap(Math.abs(wp.x-R.ax))); b.w=W; b.x=R.rz==="w"?R.ax-W:R.ax; }
        else { const H=Math.max(MIN, this._snap(Math.abs(wp.y-R.ay))); b.h=H; b.y=R.rz==="n"?R.ay-H:R.ay; }
        this._pos(b); this._scheduleEdges(); return; }
      if(this.resizing && this.resizing.rz){ const R=this.resizing, b=R.b, wp=this.worldPt(e.clientX,e.clientY), MIN=this.GRID*2;   // текст/рамка — тянем за любой край/угол (без пропорции)
        const hasW=R.rz.indexOf("w")>=0, hasE=R.rz.indexOf("e")>=0, hasN=R.rz.indexOf("n")>=0, hasS=R.rz.indexOf("s")>=0;
        if(hasW||hasE){ const W=Math.max(MIN,this._snap(Math.abs(wp.x-R.ax))); b.w=W; b.x=hasW?R.ax-W:R.ax; }
        if(hasN||hasS){ const H=Math.max(MIN,this._snap(Math.abs(wp.y-R.ay))); b.h=H; b.y=hasN?R.ay-H:R.ay; b.fixedH=true; }   // ручная высота — авто-рост больше не ужимает
        this._pos(b); this._scheduleEdges(); return; }
      if(this.resizing){ const z=this.view.zoom, b=this.resizing.b;
        b.w=Math.max(this.GRID*2, this._snap(this.resizing.w+(e.clientX-this.resizing.sx)/z));
        b.h=Math.max(this.GRID*2, this._snap(this.resizing.h+(e.clientY-this.resizing.sy)/z)); b.fixedH=true;   // угловая ручка .fb-resize (правый-нижний) — свободно w+h
        this._pos(b); this._scheduleEdges(); return; }
      if(this.connecting){ const wp=this.worldPt(e.clientX,e.clientY); this._updateTemp(wp);
        const elx=document.elementFromPoint(e.clientX,e.clientY); const over=elx&&elx.closest?elx.closest(".flow-block"):null;
        this._hoverTarget(over&&over.dataset.id!==this.connecting?over.dataset.id:null); return; }
      if(this.marquee){ const m=this.marquee, r=st.getBoundingClientRect();
        const x1=Math.min(m.x0,e.clientX), y1=Math.min(m.y0,e.clientY), x2=Math.max(m.x0,e.clientX), y2=Math.max(m.y0,e.clientY);
        this.marqueeEl.style.left=(x1-r.left)+"px"; this.marqueeEl.style.top=(y1-r.top)+"px"; this.marqueeEl.style.width=(x2-x1)+"px"; this.marqueeEl.style.height=(y2-y1)+"px";
        const w1=this.worldPt(x1,y1), w2=this.worldPt(x2,y2);
        const hit=this.f.blocks.filter(b=> b.x<w2.x && b.x+b.w>w1.x && b.y<w2.y && b.y+b.h>w1.y).map(b=>b.id);
        this.selSet=new Set(m.add?[...m.base,...hit]:hit); this._paintSel(); return; }
      if(this.panning){ this.view.tx=this.panning.tx+(e.clientX-this.panning.x); this.view.ty=this.panning.ty+(e.clientY-this.panning.y); this.applyView(); return; }
    };
    st.onpointerup=(e)=>{
      if(this.dragBlock){ if(this.dragBlock.moved) this._recomputeMembership(); this._showGuides(null,null); this.save(); this.dragBlock=null; return; }
      if(this.resizing){ this._recomputeMembership(); this.resizing=null; this.save(); return; }
      if(this.connecting){ const elx=document.elementFromPoint(e.clientX,e.clientY); const over=elx&&elx.closest?elx.closest(".flow-block"):null;
        if(over) this._addEdge(this.connecting, over.dataset.id); this._endConnect(); return; }
      if(this.marquee){ this.marquee=null; this.marqueeEl.style.display="none"; return; }
      if(this.panning){ this.panning=null; persist(); return; }
    };
    // прерванный жест (потеря фокуса окна, системное меню) — сбрасываем всё, чтобы блок не «прилип» к курсору и гайды не залипли
    st.onpointercancel=()=>{ if(this.connecting) this._endConnect();
      this.dragBlock=null; this.resizing=null; this.marquee=null; if(this.marqueeEl) this.marqueeEl.style.display="none"; this.panning=null; this._showGuides(null,null); };
    st.ondblclick=(e)=>{
      const _ce=e.target.closest('[contenteditable="true"]');
      if(_ce && _ce===document.activeElement) return;   // уже РЕДАКТИРУЕМ этот текст (в фокусе) — не мешаем нативному выделению слова; «залипший» editable без фокуса пропускаем дальше
      const be=e.target.closest(".flow-block");
      if(be){ const b=this._b(be.dataset.id); if(!b) return;
        if(b.type==="image"||b.type==="video"){ this._enterCrop(b); return; }
        this._select(b.id); this._focusTitle(b.id); return; }   // 2× клик по блоку — переименование (фокус + выделение текста)
      // 2× клик по пустому месту — НИЧЕГО не создаём (блоки добавляются кнопками на панели). Раньше плодило лишние ноды.
    };
    st.onwheel=(e)=>{ e.preventDefault(); const r=st.getBoundingClientRect(); this._zoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY<0?1.12:1/1.12); };
    st.oncontextmenu=(e)=>{ if(e.target.closest(".flow-block")||e.target.closest(".flow-pop")) return; e.preventDefault(); this._emptyPop(e); };   // ПКМ по пустому — меню создания блока в точке курсора
    // перетаскивание файлов-картинок на холст (как в Figma)
    st.addEventListener("dragover",(e)=>{ const dt=e.dataTransfer; if(dt && [...(dt.items||[])].some(it=>it.kind==="file")){ e.preventDefault(); dt.dropEffect="copy"; st.classList.add("dropping"); } });
    st.addEventListener("dragleave",(e)=>{ if(e.target===st) st.classList.remove("dropping"); });
    st.addEventListener("drop",(e)=>{ st.classList.remove("dropping");
      const files=[...((e.dataTransfer&&e.dataTransfer.files)||[])].filter(f=>/^(image|video)\//.test(f.type));
      if(!files.length) return; e.preventDefault();
      if(this.cropping) this._exitCrop();   // дроп во время кадрирования — выйти из режима, иначе новый блок уедет под затемнение
      const wp=this.worldPt(e.clientX,e.clientY);
      files.forEach((f,i)=>this._mediaFromFile(f, wp.x+i*18, wp.y+i*18));
    });
  }
  /* ---- поповеры ---- */
  _closeFlowPop(){ const p=$(".flow-pop",this.screen); if(p) p.remove(); }
  _placePop(pop,e){ const r=this.stage.getBoundingClientRect(); const pw=pop.offsetWidth||240, ph=pop.offsetHeight||160;
    let px=e.clientX-r.left+10, py=e.clientY-r.top+10;
    px=Math.max(8,Math.min(px,r.width-pw-8)); py=Math.max(8,Math.min(py,r.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px"; }
  _emptyPop(e){ this._closeFlowPop();   // ПКМ по пустому холсту → создать блок в точке курсора
    const wp=this.worldPt(e.clientX, e.clientY);
    const pop=el("div","flow-pop");
    pop.innerHTML=`<div class="fp-note">Новый блок</div>
      <div class="fp-row fp-types">${FLOW_ORDER.map(k=>`<button class="fp-t" data-t="${k}" title="${FLOW_TYPES[k].name}"><i class="ti ${FLOW_TYPES[k].icon}"></i></button>`).join("")}</div>`;
    this.stage.appendChild(pop); this._placePop(pop,e);
    $$(".fp-t",pop).forEach(btn=>btn.onclick=()=>{ const tp=btn.dataset.t; this._closeFlowPop(); this.addBlockAt(tp, wp.x, wp.y); });
  }
  _blockPop(b,e){ this._closeFlowPop();
    if((b.type==="image"||b.type==="video") && !(this.selSet.has(b.id)&&this.selSet.size>1)){   // медиа: своё короткое меню
      const cropped=this._isCropped(b);
      const ipop=el("div","flow-pop");
      ipop.innerHTML=`<div class="fp-row"><button class="btn" data-fp="crop"><i class="ti ti-crop"></i>Кадрировать</button>${cropped?`<button class="btn" data-fp="uncrop" title="Сбросить кадрирование"><i class="ti ti-aspect-ratio"></i></button>`:""}</div>
        ${b.type==="image"?`<div class="fp-row"><button class="btn" data-fp="replace"><i class="ti ti-photo"></i>Заменить</button></div>`:""}
        <div class="fp-row"><button class="btn" data-fp="del"><i class="ti ti-trash"></i>Удалить</button></div>`;
      this.stage.appendChild(ipop); this._placePop(ipop,e);
      ipop.querySelector('[data-fp="crop"]').onclick=()=>{ this._closeFlowPop(); this._enterCrop(b); };
      const unc=ipop.querySelector('[data-fp="uncrop"]'); if(unc) unc.onclick=()=>{ this._closeFlowPop(); this._uncrop(b); };
      const rep=ipop.querySelector('[data-fp="replace"]'); if(rep) rep.onclick=()=>{ this._closeFlowPop(); this._replaceImage(b); };
      ipop.querySelector('[data-fp="del"]').onclick=()=>{ this._closeFlowPop(); this.deleteBlock(b.id); };
      return;
    }
    const pop=el("div","flow-pop");
    // кликнули по одному из нескольких выбранных → тип/цвет/удаление применяем ко ВСЕМ выбранным
    const targets=(this.selSet.has(b.id)&&this.selSet.size>1)?[...this.selSet].map(id=>this._b(id)).filter(Boolean):[b];
    const multi=targets.length>1;
    pop.innerHTML=`
      ${multi?`<div class="fp-note">${targets.length} блоков</div>`:""}
      <div class="fp-row fp-types">${FLOW_ORDER.map(k=>`<button class="fp-t ${b.type===k?"on":""}" data-t="${k}" title="${FLOW_TYPES[k].name}"><i class="ti ${FLOW_TYPES[k].icon}"></i></button>`).join("")}</div>
      <div class="swatches fp-sw">${swatchRow(b.color)}</div>
      ${(!multi&&b.type!=="frame")?`<div class="fp-row">${b.refId?`<button class="btn" data-fp="refopen"><i class="ti ti-external-link"></i>Открыть</button><button class="btn" data-fp="refdel"><i class="ti ti-unlink"></i>Отвязать</button>`:`<button class="btn" data-fp="reflink"><i class="ti ti-link"></i>Привязать к заметке/задаче</button>`}</div>`:""}
      <div class="fp-row"><button class="btn" data-fp="del"><i class="ti ti-trash"></i>${multi?"Удалить ("+targets.length+")":"Удалить блок"}</button></div>`;
    this.stage.appendChild(pop); this._placePop(pop,e);
    $$(".fp-t",pop).forEach(btn=>btn.onclick=()=>{ const tp=btn.dataset.t;
      targets.forEach(t=>{ t.type=tp; if(tp==="frame"){ t.w=Math.max(t.w,FLOW_TYPES.frame.w); t.h=Math.max(t.h,FLOW_TYPES.frame.h); } });
      this._closeFlowPop(); this.renderBlocks(); this.drawEdges(); this.save(); });
    $$(".fp-sw .swatch",pop).forEach(btn=>btn.onclick=()=>{ const col=PALETTE[+btn.dataset.ci]||null;
      targets.forEach(t=>{ t.color=col; const elx=this.elById[t.id]; if(elx){ elx.classList.toggle("fb-colored",!!col);   // БЕЗ этого класс не появлялся → цвет не был виден до полного ре-рендера
        if(col) elx.style.setProperty("--c",col); else elx.style.removeProperty("--c"); } });
      $$(".fp-sw .swatch",pop).forEach(x=>x.classList.toggle("on",(PALETTE[+x.dataset.ci]||null)===col)); this.save(); });
    if(pop.querySelector('[data-fp="reflink"]')) pop.querySelector('[data-fp="reflink"]').onclick=()=>{ this._closeFlowPop(); this._pickItem(id=>{ b.refId=id; this.renderBlocks(); this.drawEdges(); this.save(); }); };
    if(pop.querySelector('[data-fp="refopen"]')) pop.querySelector('[data-fp="refopen"]').onclick=()=>{ this._closeFlowPop(); const r=S.items.find(i=>i.id===b.refId); if(r) openItemSmart(r); };
    if(pop.querySelector('[data-fp="refdel"]')) pop.querySelector('[data-fp="refdel"]').onclick=()=>{ b.refId=null; this._closeFlowPop(); this.renderBlocks(); this.drawEdges(); this.save(); };
    pop.querySelector('[data-fp="del"]').onclick=()=>{ this._closeFlowPop(); if(multi) this.deleteSelection(); else this.deleteBlock(b.id); };
  }
  // выбор реального элемента (заметка/задача/схема) для привязки блока — модалка с поиском внутри flow-screen
  _pickItem(cb){
    const items=S.items.filter(it=>!it.deleted && (it.kind==="note"||it.kind==="task"||it.kind==="flow"));
    const ic=it=>it.kind==="flow"?"ti-artboard":it.kind==="note"?"ti-note":"ti-checklist";
    const m=el("div","modal"); m.innerHTML=`
      <h3><i class="ti ti-link"></i>Привязать к…</h3>
      <div class="field"><input type="text" id="pk-q" placeholder="Поиск заметки / задачи / полотна…"></div>
      <div class="pk-list" id="pk-list"></div>
      <div class="modal-foot"><div class="right"><button class="btn ghost" id="pk-cancel">Отмена</button></div></div>`;
    const ov=el("div","flow-modal-ov"); ov.appendChild(m); this.screen.appendChild(ov);
    ov.addEventListener("mousedown",ev=>{ if(ev.target===ov) ov.remove(); });
    const q=$("#pk-q",m), list=$("#pk-list",m);
    const draw=()=>{ const s=q.value.trim().toLowerCase();
      const arr=items.filter(it=>!s||(it.title||"").toLowerCase().includes(s)).slice(0,50);
      list.innerHTML=arr.length?arr.map(it=>`<div class="pk-it" data-id="${it.id}"><i class="ti ${ic(it)}"></i><span class="pk-ttl">${esc(it.title||"(без названия)")}</span><span class="pk-area">${esc(areaName(it.area))}</span></div>`).join(""):`<div class="pal-empty">Ничего не найдено</div>`;
      $$(".pk-it",list).forEach(e=>e.onclick=()=>{ ov.remove(); cb(e.dataset.id); }); };
    q.addEventListener("input",draw); draw();
    $("#pk-cancel",m).onclick=()=>ov.remove();
    setTimeout(()=>q.focus(),30);
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
    const lbl=b=>b.type==="image"?"🖼 картинка":((b.text&&b.text.trim())?b.text.trim().replace(/\s+/g," "):"(без текста)");
    const TN={proc:"",decision:" [решение]",terminal:" [терминал]",comment:" [коммент]",frame:"",image:""};
    const out=["Полотно: "+((this.it.title||"без названия")),""];
    const ord=arr=>arr.slice().sort((a,b)=>(a.y-b.y)||(a.x-b.x));
    const line=(b,ind)=>{ const pad="  ".repeat(ind);
      out.push(pad+"• "+lbl(b)+TN[b.type]);
      if(b.refId){ const r=S.items.find(i=>i.id===b.refId); if(r) out.push(pad+"    ↪ привязано: "+(r.title||"(без названия)")); }
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
      <h3><i class="ti ti-clipboard-text"></i>Полотно как текст</h3>
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
