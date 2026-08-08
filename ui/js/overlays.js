"use strict";
/* ===========================================================
   MODALS
   =========================================================== */
function restoreFocus(o){ if(o&&o.focus&&document.contains(o)){ try{o.focus();}catch(e){} } }
/* ЗАКРЫТИЕ ОКНА — СОБЫТИЕ, А НЕ ПРОСТО УДАЛЕНИЕ УЗЛА.
   Раньше окно исчезало тремя разными способами (ov.remove() по кнопке, клик по фону,
   closeOverlays() по Esc/переходу), и все три рвали DOM молча. Владельцы окон вешали важную
   работу на побочные эффекты: ридер сохранял текст по blur (которого при удалении узла не
   бывает), uiConfirm резолвил промис только по кнопке, настройки останавливали опрос по ответу
   бэкенда. Теперь у оверлея есть список дел «на закрытие»: onOverlayClose(ov, fn). Он
   выполняется ровно один раз, ДО удаления узла из DOM. */
function onOverlayClose(ov, fn){ if(!ov) return; (ov._teardown||(ov._teardown=[])).push(fn); }
function runTeardown(ov){
  if(!ov || ov._teardownDone) return;
  ov._teardownDone=true;
  (ov._teardown||[]).forEach(fn=>{ try{ fn(); }catch(e){ console.error("overlay teardown:",e); } });
}
function closeOverlay(ov){ if(!ov) return; const o=ov._opener; runTeardown(ov); if(ov.isConnected) ov.remove(); restoreFocus(o); }
function overlay(node){
  const ov=el("div","overlay"); ov.appendChild(node);
  ov._opener=document.activeElement;   // вернём фокус сюда при закрытии (a11y)
  ov.addEventListener("mousedown",e=>{ if(e.target===ov) closeOverlay(ov); });
  // прямой ov.remove() из старого кода тоже обязан отработать teardown
  const rm=ov.remove.bind(ov);
  ov.remove=()=>{ runTeardown(ov); rm(); };
  $("#overlay-root").appendChild(ov);
  return ov;
}
function closeOverlays(){
  const root=$("#overlay-root"); const first=root.firstElementChild; const o=first&&first._opener;
  Array.from(root.children).forEach(runTeardown);
  root.innerHTML=""; restoreFocus(o);
}

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
    // Промис обязан резолвиться при ЛЮБОМ закрытии. Иначе окно, снесённое не кнопкой
    // (Esc через closeOverlays, палитра Ctrl+K поверх), оставляло await висеть навсегда:
    // «Импорт заменит данные. Продолжить?» молча не продолжался ничем.
    onOverlayClose(ov, ()=>finish(false));
    $("#cf-no",m).onclick=()=>finish(false);
    $("#cf-yes",m).onclick=()=>finish(true);
    ov.addEventListener("mousedown",e=>{ if(e.target===ov) finish(false); });          // клик по фону = отмена
    m.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); finish(true); } else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); finish(false); } });
    setTimeout(()=>{ const y=$("#cf-yes",m); if(y) y.focus(); },30);
  });
}

/* Ввод одной строки — тот же uiConfirm, но с полем. Нужен там, где заводить целое окно ради
   названия избыточно (граф, например). Возвращает строку, null при отмене или "__удалить__",
   если нажали дополнительную кнопку: у графа правка и удаление живут в одном месте. */
function uiPrompt(message, opts){
  opts=opts||{};
  return new Promise(resolve=>{
    const m=el("div","modal confirm-modal");
    m.innerHTML=`
      <h3><i class="ti ti-pencil"></i>${esc(opts.title||"Название")}</h3>
      <div class="confirm-msg">${esc(message)}</div>
      <div class="field"><input type="text" id="pr-in" value="${esc(opts.value||"")}" maxlength="40" placeholder="${esc(opts.placeholder||"")}"></div>
      <div class="modal-foot">
        ${opts.extraLabel?`<button class="btn ghost danger-txt" id="pr-extra"><i class="ti ti-trash"></i>${esc(opts.extraLabel)}</button>`:""}
        <div class="right">
        <button class="btn ghost" id="pr-no">${esc(opts.cancelLabel||"Отмена")}</button>
        <button class="btn primary" id="pr-yes"><i class="ti ti-check"></i>${esc(opts.okLabel||"ОК")}</button>
      </div></div>`;
    m.tabIndex=-1;
    const ov=overlay(m); const op=ov._opener; let done=false;
    const finish=(v)=>{ if(done) return; done=true; if(ov.isConnected) ov.remove(); restoreFocus(op); resolve(v); };
    onOverlayClose(ov, ()=>finish(null));
    const взять=()=>{ const v=($("#pr-in",m).value||"").trim(); finish(v||null); };
    $("#pr-no",m).onclick=()=>finish(null);
    $("#pr-yes",m).onclick=взять;
    const ex=$("#pr-extra",m); if(ex) ex.onclick=()=>finish("__удалить__");
    ov.addEventListener("mousedown",e=>{ if(e.target===ov) finish(null); });
    m.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); взять(); }
      else if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); finish(null); } });
    setTimeout(()=>{ const i=$("#pr-in",m); if(i){ i.focus(); i.select(); } },30);
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

function openItemEditor(existing, defaultKind, presetDue, seed){
  const isNew=!existing;
  const it = existing || {id:null, kind:defaultKind||"task", title:"", body:"", area:areaFilter||null, due:presetDue||null, repeat:"none", priority:0, tags:[]};
  /* Заготовка по шаблону (см. fields.js). Тип из шаблона берём только тогда, когда его не
     назвали явно кнопкой «Новая задача/заметка»: иначе шаблон-заметка молча превращал бы
     нажатую задачу в заметку. */
  if(isNew && seed){
    if(!defaultKind && seed.kind) it.kind=seed.kind;
    if(seed.tags && seed.tags.length) it.tags=seed.tags.slice();
  }
  /* Поля правятся ЧЕРНОВИКОМ: «Отмена» обязана отменять и их. Содержимое картинок и досок
     лежит вне ноды и остаётся в S до следующей загрузки — там его подметёт санитайзер. */
  const fields = (isNew && seed && seed.fields) ? seed.fields : JSON.parse(JSON.stringify(fieldsOf(it)));
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
    <div class="field" id="wrap-fields" ${it.kind==="flow"?`style="display:none"`:""}><label>Поля</label>
      <div class="flds" id="f-fields"></div></div>
    <div class="row2" id="wrap-due">
      <div class="field"><label>Срок</label><input type="date" id="f-due" value="${it.due||""}"></div>
      <div class="field"><label>Повтор</label><select id="f-rep">
        ${Object.entries(REPEAT).map(([k,vv])=>`<option value="${k}" ${it.repeat===k?"selected":""}>${k==="none"?"нет":vv}</option>`).join("")}
      </select></div>
    </div>
    <div class="row2" id="wrap-task2">
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
  /* Есть поле-доска — окно правки открываем ШИРЕ обычного. Не ради простора: рисовать во врезке
     можно только начиная с 1000 px (см. fieldBoardFits в fields.js), а в штатных 520 доску
     приходилось бы каждый раз разворачивать на весь экран. */
  if(fields.some(f=>f.type==="board")) m.style.width="min(1120px, 94vw)";
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

  /* Поля ноды. Панель одна и та же во всех трёх местах (окно правки, ридер, правая панель) —
     здесь она без save: правки уезжают в ноду по «Сохранить» вместе с остальными. */
  fieldsPanel($("#f-fields",m), fields, {item:it});
  onOverlayClose(ov, ()=>fieldsStopIn(m));   // живая доска в поле обязана сняться вместе с окном
  fieldsCopyOnRight($("#f-body",m), ()=>$("#f-body",m).value);   // ПКМ копирует описание — как у полей

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
  if($("#f-delete",m)) $("#f-delete",m).onclick=()=>{ const пакет=deletePack([it.id]); ov.remove(); render(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restorePack(пакет); render(); }}); };
  $("#f-save",m).onclick=()=>{
    const title=$("#f-title",m).value.trim(); if(!title){ $("#f-title",m).focus(); return; }
    // area здесь НЕТ намеренно: область назначается только в графе (бросок на неё, см. _linkTo).
    // Ключ именно отсутствует, а не area:undefined — Object.assign ниже копирует и undefined,
    // то есть затёр бы уже проставленную область.
    const data={ kind, title, body:$("#f-body",m).value,
      due: kind==="note"?null:($("#f-due",m).value||null), repeat: kind==="note"?"none":$("#f-rep",m).value,
      priority: kind==="note"?0:priority, tags, color, folder: folder||null };
    /* Поля, убранные в черновике, уносят с собой картинку и доску — но только СЕЙЧАС, когда
       правка принята. Считаем по id: сравнивать сами объекты нельзя, черновик их скопировал. */
    { const остались=new Set(fields.map(f=>f.id));
      fieldsOf(it).forEach(f=>{ if(!остались.has(f.id)) fieldDrop(f); }); }
    if(fields.length) data.fields=fields;
    if(isNew){ addItem(data); }
    else {
      Object.assign(it,data);
      if(!fields.length) delete it.fields;   // все поля убрали — не оставлять пустой массив в ноде
      if(kind==="note"){ it.status="note"; it.done=false; }
      else {
        if(it.status==="note") it.status="todo";        // заметку переключили в задачу
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
      // render(), а не renderNav(): изменились ДАННЫЕ (у элементов слетела область, исчезли
      // связи с хабом). Из сайдбара область пропадала, а список/граф под модалкой продолжали
      // показывать её элементы сгруппированными — до следующего случайного перерисовывания.
      persist(); draw(); render();
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
    persist(); ov.remove(); render(); if(after) after();   // render() сам зовёт renderNav()
  };
  setTimeout(()=>$("#ar-name",m).focus(),30);
}

/* Граф правится своим окном, а не строкой ввода: у него есть ЗНАЧОК, и выбирать его надо
   глазами. Значок обязателен ещё и потому, что без него все графы в свёрнутой полосе выглядели
   одинаковыми кружками — и сливались с иконкой вида «Заметки». */
function openGraphEditor(гр, after){
  const isNew=!гр;
  const g=гр||{id:null, name:"", icon:GRAPH_ICON_DEF, color:null};
  const m=el("div","modal");
  m.innerHTML=`<h3><i class="ti ${esc(g.icon||GRAPH_ICON_DEF)}"></i>${isNew?"Новый граф":"Граф"}</h3>
    <div class="set-hint">У графа своя паутина: свои ноды, области и связи. Графы не пересекаются.</div>
    <div class="field"><label>Название</label><input type="text" id="gr-name" value="${esc(g.name)}" placeholder="Например: Работа, Личное, Учёба"></div>
    <div class="field"><label>Значок</label><div class="icon-grid" id="gr-icons">
      ${ICONS.map(ic=>`<button data-ic="${ic}" class="${(g.icon||GRAPH_ICON_DEF)===ic?"on":""}"><i class="ti ${ic}"></i></button>`).join("")}
    </div></div>
    <div class="field"><label>Цвет</label><div class="swatches" id="gr-color">${swatchRow(g.color)}</div></div>
    <div class="modal-foot">
      ${(!isNew && (S.graphs||[]).length>1)?`<button class="btn ghost danger-txt" id="gr-del"><i class="ti ti-trash"></i>Удалить граф</button>`:""}
      <div class="right">
      <button class="btn ghost" id="gr-cancel">Отмена</button>
      <button class="btn primary" id="gr-save"><i class="ti ti-check"></i>${isNew?"Создать":"Сохранить"}</button>
    </div></div>`;
  const ov=overlay(m); let icon=g.icon||GRAPH_ICON_DEF, color=g.color||null;
  $$("#gr-color .swatch",m).forEach(b=>b.onclick=()=>{ color=PALETTE[+b.dataset.ci]||null;
    $$("#gr-color .swatch",m).forEach(x=>x.classList.toggle("on",PALETTE[+x.dataset.ci]===color)); });
  $$("#gr-icons button",m).forEach(b=>b.onclick=()=>{ icon=b.dataset.ic;
    $$("#gr-icons button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  $("#gr-cancel",m).onclick=()=>ov.remove();
  const del=$("#gr-del",m);
  if(del) del.onclick=async()=>{
    const n=(g.items||[]).length;
    if(!(await uiConfirm("Граф «"+g.name+"» и всё, что в нём есть"+(n?" — "+n+" нод с их досками и картинками":"")+
        " — будут удалены навсегда.",{danger:true, title:"Удалить граф?", okLabel:"Удалить"}))) return;
    graphDelete(g.id); ov.remove(); render(); toast("Граф удалён",{icon:"ti-trash"});
  };
  $("#gr-save",m).onclick=()=>{
    const name=$("#gr-name",m).value.trim(); if(!name){ $("#gr-name",m).focus(); return; }
    if(isNew){
      const нов=graphAdd(name); нов.icon=icon; нов.color=color;
      graphSwitch(нов.id); view="notes";
      ov.remove(); render(); toast("Граф «"+name+"» создан",{icon:icon});
    }else{
      g.name=name; g.icon=icon; g.color=color; persist();
      ov.remove(); render(); toast("Сохранено",{icon:icon});
    }
    if(after) after();
  };
  setTimeout(()=>$("#gr-name",m).focus(),30);
}

/* ===========================================================
   NOTE READER
   =========================================================== */
function openNoteReader(it){
  const m=el("div","modal reader-win");   // reader-win: окно можно двигать за заголовок и тянуть за угол
  const kids=childrenOfLive(it.id);       // из корзины детей не показываем: список кликабелен
  const parentChain=noteParentChain(it.id).slice(0,-1); // without self
  m.innerHTML=`
    <h3><i class="ti ${it.kind==="task"?"ti-checklist":"ti-note"}"></i>${esc(it.title)}</h3>
    ${it.area?`<div style="margin-bottom:10px;"><span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span></div>`:""}
    ${it.folder?`<div style="margin-bottom:10px;"><button class="tag folder-tag" id="nr-folder" title="${esc(it.folder)}"><i class="ti ti-folder"></i>Открыть папку</button></div>`:""}
    ${parentChain.length?`<div style="margin-bottom:10px;"><span class="tag"><i class="ti ti-sitemap"></i>Иерархия: ${parentChain.map(id=>{const p=S.items.find(i=>i.id===id);return p?esc(p.title):"";}).join(" → ")}</span></div>`:""}
    <div class="reader-body" id="nr-body" title="Кликни, чтобы править прямо здесь">${it.body?esc(it.body):`<span class="reader-empty">Пока пусто — кликни, чтобы написать.</span>`}</div>
    <div class="flds reader-flds" id="nr-fields"></div>
    ${kids.length?`<div class="field"><label>Дочерние заметки (${kids.length})</label><div class="reader-links" id="kid-list">
      ${kids.map(k=>`<div class="rl-it" data-rl="${k.id}"><i class="ti ti-note"></i>${esc(k.title)}</div>`).join("")}
    </div></div>`:""}
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="nr-close">Закрыть</button>
      <button class="btn" id="nr-edit"><i class="ti ti-pencil"></i>Изменить</button>
    </div></div>`;
  /* Есть поле-доска — открываем окно ШИРЕ обычного. Не ради красоты: живая доска во врезке
     возможна только начиная с 1000 px (см. fieldBoardFits), а в стандартных 520 px пришлось бы
     каждый раз разворачивать её на весь экран. Ширину дальше человек тянет сам за угол. */
  if(fieldsOf(it).some(f=>f.type==="board")) m.style.width="min(1080px, 92vw)";
  const ov=overlay(m);
  setTimeout(()=>{ const c=$("#nr-close",m); if(c)c.focus(); },30);   // автофокус для клавиатуры
  $("#nr-close",m).onclick=()=>ov.remove();
  $("#nr-edit",m).onclick=()=>{ ov.remove(); openItemEditor(it); };

  /* Правка текста на месте: ради одной строки в длинной заметке лезть в форму правки —
     перебор. Сохраняем по уходу фокуса, а не на каждую букву. */
  { const nb=$("#nr-body",m);
    nb.onclick=()=>{
      if(nb.isContentEditable) return;
      if(!it.body) nb.textContent="";                  // убрать плашку «пока пусто»
      nb.contentEditable="true"; nb.classList.add("editing"); nb.focus();
    };
    /* Запись вынесена из обработчика blur: закрытие по Esc или кликом по фону сносит узел
       вместе с фокусом, blur при этом не приходит — набранный текст просто исчезал.
       Теперь commitBody зовётся и по blur, и по закрытию окна (см. onOverlayClose ниже). */
    const commitBody=()=>{
      if(!nb.isContentEditable) return false;
      nb.contentEditable="false"; nb.classList.remove("editing");
      const t=nb.innerText.replace(/ /g," ").replace(/\s+$/,"");
      const changed = t!==(it.body||"");
      if(changed){ it.body=t; touch(it); persist(); if(graph) graph.build(); }
      if(!t) nb.innerHTML=`<span class="reader-empty">Пока пусто — кликни, чтобы написать.</span>`;
      return changed;
    };
    nb.addEventListener("blur",commitBody);
    onOverlayClose(ov, ()=>{ if(commitBody()) render(); });
    fieldsCopyOnRight(nb, ()=>it.body||"");   // ПКМ копирует описание — как у полей
  }

  /* Именованные поля — сразу под описанием. Здесь панель работает ВЖИВУЮ (есть save): ридер
     тем и хорош, что правишь на месте, и лезть ради строчки в окно правки незачем. */
  fieldsPanel($("#nr-fields",m), fieldsOf(it), {item:it, attach:true,
    save:()=>{ touch(it); persist(); if(graph) graph.build(); }});
  onOverlayClose(ov, ()=>fieldsStopIn(m));   // живая доска в поле обязана сняться вместе с окном

  /* Окно двигаем за заголовок (размер тянется за угол — resize в CSS у .reader-win).
     Сдвиг держим в transform: overlay центрует окно флексом, трогать left/top нельзя. */
  { const h=$("h3",m); let on=false, sx=0, sy=0, ox=0, oy=0;
    h.addEventListener("pointerdown",e=>{
      if(e.button!==0) return;
      const t=/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(m.style.transform||"");
      ox=t?+t[1]:0; oy=t?+t[2]:0; sx=e.clientX; sy=e.clientY; on=true;
      try{ h.setPointerCapture(e.pointerId); }catch(_){}
      e.preventDefault();
    });
    h.addEventListener("pointermove",e=>{ if(on) m.style.transform=`translate(${ox+e.clientX-sx}px, ${oy+e.clientY-sy}px)`; });
    h.addEventListener("pointerup",()=>{ on=false; });
    h.addEventListener("pointercancel",()=>{ on=false; });
  }
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
  // шаблон по умолчанию (если выбран) заводит ноду сразу с нужными полями; не выбран — как раньше
  else openItemEditor(null, kind, null, templateSeed(templateDefault(), kind));
}

/* Полотно = доска Excalidraw (ui/js/draw.js). Прежний самописный редактор блок-схем удалён:
   ради его отлаженности и стиля и брали Excalidraw. Старые схемы не выбрасываются — они
   остаются в it.flow и один раз переносятся на доску при первом открытии ноды. */
function openFlowEditor(it){ openBoard(it); }

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
    <div class="sc-sec">Полотно (доска)</div>${rows([
      ["<kbd>1</kbd>…<kbd>0</kbd>","Инструменты: выделение, фигуры, стрелка, перо, текст"],
      ["<kbd>V</kbd> · <kbd>R</kbd> · <kbd>O</kbd> · <kbd>A</kbd> · <kbd>T</kbd>","Выделение · прямоугольник · овал · стрелка · текст"],
      ["2× клик по фигуре","Подпись внутри фигуры"],
      ["Пробел / средняя кнопка / колесо","Двигать холст"],
      ["<kbd>Ctrl</kbd>+колесо","Зум"],
      ["<kbd>Ctrl</kbd><kbd>Z</kbd> · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd>","Отмена · возврат (своя история доски)"],
      ["<kbd>Delete</kbd>","Удалить выделенное"],
    ])}
    <div class="modal-foot"><div class="right"><button class="btn primary" id="sc-close"><i class="ti ti-check"></i>Понятно</button></div></div>`;
  const ov=overlay(m); $("#sc-close",m).onclick=()=>ov.remove();
  setTimeout(()=>{ const b=$("#sc-close",m); if(b) b.focus(); },30);
}

/* ===========================================================
   НАСТРОЙКИ (саморегулируемые параметры — п.1 KROLIK)
   =========================================================== */
// openSettings("data") — открыть сразу на нужной вкладке. Без этого тост «Вышла новая версия»
// открывал «Вид», а блок обновлений оставался в скрытой панели: человек видел тему и свечение
// и не понимал, при чём тут обновление.
function openSettings(tab){
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
      <button class="set-tab" data-tab="ai"><i class="ti ti-sparkles"></i>ИИ</button>
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
      <!-- Чем рисуется граф. SVG — прежний путь со всеми возможностями; холст рисует дерево целиком
           и не создаёт элементов вовсе (на 650 узлах это 38 мс кадра из 47). Переключается на лету,
           данные не трогает: не понравилось — вернул обратно. -->
      <div class="field"><label>Отрисовка графа</label>
        <div class="seg" id="set-render">
          <button data-v="svg" class="${s.graphRender!=="canvas"?"on":""}">SVG</button>
          <button data-v="canvas" class="${s.graphRender==="canvas"?"on":""}">Холст</button>
        </div></div>
      <div class="set-hint" style="margin-bottom:10px;">Холст пока рисует узлы и связи; подписи, формы по тегам и клики по нодам — на подходе.</div>
      <!-- Потолок кадров. Без него граф рисует со скоростью монитора: на 165-герцевом это вчетверо
           больше нагрузки на видеокарту при том же самом изображении (замер: 42.6 Вт против 19.6). -->
      <div class="field"><label>Плавность графа</label>
        <div class="seg" id="set-maxfps">${[["30","30"],["60","60"],["120","120"],["0","Как монитор"]]
          .map(([v,l])=>`<button data-v="${v}" class="${(+(s.graphFpsCap!=null?s.graphFpsCap:0))===+v?"on":""}">${l}</button>`).join("")}</div></div>
      <div class="set-hint" style="margin-bottom:10px;">Кадров в секунду. Меньше кадров — меньше ватт на видеокарте (на 165 Гц вчетверо), но процент её занятости в диспетчере задач от этого почти не меняется.</div>
      <!-- Зум и пан картинкой: замер на 946 узлах — честный кадр 0.641 мс, кадр картинкой 0.001 мс. -->
      <div class="field"><label>Зум и пан готовой картинкой</label>
        <div class="seg" id="set-fastzoom">
          <button data-v="1" class="${s.graphFastZoom!==false?"on":""}">Вкл</button>
          <button data-v="0" class="${s.graphFastZoom===false?"on":""}">Выкл</button>
        </div></div>
      <div class="set-hint" style="margin-bottom:10px;">Пока крутят колесо или тащат холст, граф не перерисовывается заново, а выводится готовой картинкой. Работает на деревьях больше 350 узлов; при сильном приближении картинка на мгновение мягче.</div>
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
    <div class="set-panel" data-panel="ai" hidden id="set-ai-panel"></div>
    <div class="modal-foot">
      <button class="btn ghost" id="set-reset"><i class="ti ti-refresh"></i>Сбросить</button>
      <div class="right"><button class="btn primary" id="set-close"><i class="ti ti-check"></i>Готово</button></div>
    </div>`;
  const ov=overlay(m);
  if(typeof aiRenderSettings==="function") aiRenderSettings($("#set-ai-panel",m));   // вкладка «ИИ» — вся начинка в ai.js (вырезаемо)
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
  /* ВСЕ настройки вида и графа ниже пишутся ТИХО (persist(true)). Настройки в снимок отката не
     входят (см. core.js) — обычный persist() всё равно ничего туда не кладёт (undoPush сверяет
     _undoKey и видит, что данные те же), НО в конце каждого дебаунса он безусловно пересчитывает
     _undoSnap()+_undoKey() — две полные сериализации items/links/areas/tags — ради сравнения,
     которое и так ничего не найдёт. На протяжке ползунка (десятки oninput подряд) это лишняя
     работа на каждое отпускание. Тот же класс бага, что уже чинили для камеры графа. */
  $$("#set-theme button",m).forEach(b=>b.onclick=()=>{ s.theme=b.dataset.v; persist(true); applySettings(); $$("#set-theme button",m).forEach(x=>x.classList.toggle("on",x===b)); if(view==="notes") render(); });
  $$("#set-glow button",m).forEach(b=>b.onclick=()=>{ s.glow=+b.dataset.v; persist(true); applySettings(); $$("#set-glow button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  $$("#set-bg button",m).forEach(b=>b.onclick=()=>{ s.graphBg=b.dataset.v==="1"; persist(true); $$("#set-bg button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  const drift=$("#set-drift",m); drift.oninput=()=>{ s.graphDrift=+drift.value; $("#val-drift",m).textContent=drift.value; persist(true); };   // граф читает S.settings каждый кадр → применяется вживую
  const spread=$("#set-spread",m); spread.oninput=()=>{ s.graphSpread=+spread.value; $("#val-spread",m).textContent=spread.value+"×"; persist(true); if(graph) graph.alpha=Math.max(graph.alpha,0.4); };
  const len=$("#set-len",m); len.oninput=()=>{ s.graphLinkLen=+len.value; $("#val-len",m).textContent=len.value+"×"; persist(true); if(graph) graph.alpha=Math.max(graph.alpha,0.4); };   // будим симуляцию → связи переезжают к новой длине вживую
  const nsz=$("#set-nsz",m); nsz.oninput=()=>{ s.graphNodeSize=+nsz.value; $("#val-nsz",m).textContent=nsz.value+"×"; persist(true); }; nsz.onchange=()=>{ if(graph) graph.build(); };   // размер r считается в build → пересобираем при отпускании
  const deg=$("#set-deg",m); deg.oninput=()=>{ s.graphDegScale=+deg.value; $("#val-deg",m).textContent=deg.value+"×"; persist(true); }; deg.onchange=()=>{ if(graph) graph.build(); };   // 0× = все ноды одного размера; больше = сильнее зависит от связей
  const done=$("#set-done",m); done.oninput=()=>{ s.graphDoneScale=+done.value; $("#val-done",m).textContent=done.value+"×"; persist(true); }; done.onchange=()=>{ if(graph) graph.build(); };   // насколько ужимать завершённые ветки
  const lbr=$("#set-lbright",m); lbr.oninput=()=>{ s.graphLinkBright=+lbr.value; $("#val-lbright",m).textContent=lbr.value+"×"; persist(true); if(graph) graph.build(); };   // яркость обычных связей
  const dlen=$("#set-donelen",m); dlen.oninput=()=>{ s.graphDoneLinkLen=+dlen.value; $("#val-donelen",m).textContent=dlen.value+"×"; persist(true); if(graph){ graph.build(); graph.alpha=Math.max(graph.alpha,0.4); } };   // длина связей завершённых → будим симуляцию
  const fbr=$("#set-fbright",m); fbr.oninput=()=>{ s.graphFadedBright=+fbr.value; $("#val-fbright",m).textContent=fbr.value+"×"; persist(true); if(graph) graph.build(); };   // яркость потухших связей
  // подсветка «в работе» — рисуется каждый кадр, поэтому применяется вживую без пересборки
  /* Переключение рендера пересобирает вид целиком: Graph решает, создавать ли SVG-элементы,
     в build(), и на лету это не меняется. render() снимает старый граф и строит новый — данные
     при этом не трогаются вовсе. */
  $$("#set-render button",m).forEach(b=>b.onclick=()=>{ s.graphRender=b.dataset.v; persist(true);
    $$("#set-render button",m).forEach(x=>x.classList.toggle("on",x===b));
    if(view==="notes") render(); });
  // потолок кадров применяется на лету: _schedule читает настройку перед каждым кадром
  $$("#set-maxfps button",m).forEach(b=>b.onclick=()=>{ s.graphFpsCap=+b.dataset.v; persist(true);
    $$("#set-maxfps button",m).forEach(x=>x.classList.toggle("on",x===b));
    if(graph) graph._wake(); });
  $$("#set-fastzoom button",m).forEach(b=>b.onclick=()=>{ s.graphFastZoom=b.dataset.v==="1"; persist(true);
    $$("#set-fastzoom button",m).forEach(x=>x.classList.toggle("on",x===b));
    if(graph){ graph._сн=null; graph._wake(); } });
  $$("#set-doglow button",m).forEach(b=>b.onclick=()=>{ s.graphDoingGlow=b.dataset.v==="1"; persist(true); $$("#set-doglow button",m).forEach(x=>x.classList.toggle("on",x===b)); });
  const elDgr=$("#set-dgr",m); elDgr.oninput=()=>{ s.graphDoingGlowRadius=+elDgr.value; $("#val-dgr",m).textContent=elDgr.value; persist(true); };
  const elDgb=$("#set-dgb",m); elDgb.oninput=()=>{ s.graphDoingGlowBright=+elDgb.value; $("#val-dgb",m).textContent=elDgb.value; persist(true); };
  const elDgbl=$("#set-dgbl",m); elDgbl.oninput=()=>{ s.graphDoingGlowBlur=+elDgbl.value; $("#val-dgbl",m).textContent=elDgbl.value; persist(true); };
  const showTab=(name)=>{ const t=$(`.set-tab[data-tab="${name}"]`,m); if(!t) return;
    $$(".set-tab",m).forEach(x=>x.classList.toggle("on",x===t));
    $$(".set-panel",m).forEach(p=>p.hidden=p.dataset.panel!==name); };
  $$(".set-tab",m).forEach(t=>t.onclick=()=>showTab(t.dataset.tab));   // вкладки настроек
  if(tab) showTab(tab);
  // Сброс необратим — вернуть подкрученные ползунки нечем, поэтому спрашиваем.
  // Заодно возвращаемся на ту же вкладку, а не выкидываем на «Вид».
  $("#set-reset",m).onclick=async()=>{
    if(!(await uiConfirm("Настройки вида и графа вернутся к значениям по умолчанию. Заметки, задачи и схемы не пострадают.",
        {danger:true, title:"Сбросить настройки?", okLabel:"Сбросить"}))) return;
    const cur=$(".set-tab.on",m), back=cur?cur.dataset.tab:null;
    ["theme","glow","graphBg","graphDrift","graphSpread","graphLinkLen","graphNodeSize","graphDegScale","graphDoneScale","graphDoneLinkLen","graphLinkBright","graphFadedBright","graphDoingGlow","graphDoingGlowRadius","graphDoingGlowBright","graphDoingGlowBlur","graphFpsCap","graphFastZoom"].forEach(k=>s[k]=def[k]);
    persist(); applySettings(); ov.remove(); openSettings(back); if(graph) graph.build(); if(view==="notes") render();
  };
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
    $$(".ln-del",m).forEach(b=>b.onclick=()=>{ const пакет=deletePack([b.dataset.del]);
      if(typeof graph!=="undefined" && graph) graph.build();
      toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restorePack(пакет);
        if(typeof graph!=="undefined"&&graph) graph.build(); paint(); }}); paint(); }); };
  m.innerHTML=`<h3><i class="ti ti-circle-dashed"></i>Одинокие ноды</h3>
    <div class="set-hint">Ноды без области и без связей — «висят» в графе сами по себе. Вот они — удали лишнее.</div>
    <div class="ln-list"></div>
    <div class="modal-foot"><div class="right"><button class="btn primary" id="ln-close"><i class="ti ti-check"></i>Готово</button></div></div>`;
  const ov=overlay(m); paint();
  $("#ln-close",m).onclick=()=>ov.remove();
}
