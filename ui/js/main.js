"use strict";
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
    {t:"Новое полотно",i:"ti-artboard",run:()=>{closeOverlays();createNew("flow");}},
    {t:"Перейти: Сегодня",i:"ti-sun",run:()=>go("today")},
    {t:"Перейти: Задачи",i:"ti-checklist",run:()=>go("tasks")},
    {t:"Перейти: Заметки",i:"ti-affiliate",run:()=>go("notes")},
    {t:"Перейти: Папки",i:"ti-folders",run:()=>go("board")},
    {t:"Перейти: Календарь",i:"ti-calendar-month",run:()=>go("cal")},
    {t:"Перейти: Корзина",i:"ti-trash",run:()=>go("bin")},
    {t:"Управление областями",i:"ti-folders",run:()=>{closeOverlays();openAreaManager();}},
    {t:"Сделать бэкап",i:"ti-shield-check",run:()=>{closeOverlays();doBackup();}},
    {t:"Проверить Telegram",i:"ti-brand-telegram",run:()=>{closeOverlays();checkTelegram();}},
    {t:"Переключить тему",i:"ti-sun",run:()=>{closeOverlays();toggleTheme();}},
    {t:"Сообщить о проблеме",i:"ti-message-report",run:()=>{closeOverlays();openFeedback();}},
    {t:"Настройки",i:"ti-settings",run:()=>{closeOverlays();openSettings();}},
    {t:"Теги со стилем",i:"ti-tags",run:()=>{closeOverlays();openTagManager();}},
    {t:"Удалить пустые заметки",i:"ti-eraser",run:()=>{closeOverlays();cleanEmptyNotes();}},
    {t:"Одинокие ноды (найти/удалить)",i:"ti-circle-dashed",run:()=>{closeOverlays();openLonelyNodes();}},
    {t:"Умный захват (ИИ): вкл/выкл",i:"ti-sparkles",run:()=>{closeOverlays(); if(typeof aiToggle==="function") aiToggle();}},
    {t:"ИИ движок: CPU ⇄ GPU",i:"ti-cpu",run:()=>{closeOverlays(); if(typeof aiSwitchBackend==="function") aiSwitchBackend();}},
    {t:"Горячие клавиши",i:"ti-keyboard",run:()=>{closeOverlays();openShortcuts();}}
  ];
  function go(v){ closeOverlays(); areaFilter=null; view=v; render(); }
  const itemRow=it=>({type:"item",t:it.title,i:it.kind==="flow"?"ti-artboard":it.kind==="note"?"ti-note":"ti-checklist",sub:areaName(it.area),run:()=>{closeOverlays();openItemSmart(it);}});
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
function applyTheme(){ document.body.classList.toggle("light", S.settings.theme==="light"); }
// применить визуальные настройки (тема + сила свечения --glow поверх темовой базы)
function applySettings(){ applyTheme();
  const g=(S.settings.glow!=null?S.settings.glow:1), light=S.settings.theme==="light";
  const base=light?0.18:0.30, rgb=light?"0,0,0":"255,255,255";
  document.body.style.setProperty("--glow", `rgba(${rgb},${(base*g).toFixed(3)})`);
}
function toggleTheme(){ S.settings.theme = S.settings.theme==="light"?"dark":"light"; applySettings(); persist(); if(view==="notes") render(); }
// удалить безымянные «висячие» ноды: без названия И (без текста ИЛИ оторванные — нет связей и детей).
// ловит случайно созданные пустые кружки в графе, но НЕ трогает безымянные заметки, у которых есть текст и связи.
function cleanEmptyNotes(){
  const linked=new Set(); (S.links||[]).forEach(l=>{ linked.add(l[0]); linked.add(l[1]); });
  const hasKid=id=>S.items.some(x=>!x.deleted && x.parent===id);
  const empties=S.items.filter(it=>!it.deleted && (it.kind==="note"||it.kind==="task")
    && !(it.title||"").trim()
    && ( !(it.body||"").trim() || (!linked.has(it.id) && !hasKid(it.id)) ));
  if(!empties.length){ toast("Безымянных висячих нод не найдено",{icon:"ti-check"}); return; }
  const ids=empties.map(it=>it.id);
  ids.forEach(id=>deleteItem(id)); render();
  toast("Удалено: "+ids.length,{icon:"ti-eraser",label:"Вернуть",onAction:()=>{ ids.forEach(id=>restoreItem(id)); render(); }});
}
async function doBackup(){ const p=await Store.backup(); toast("Бэкап сохранён",{icon:"ti-shield-check"}); }
async function doExport(){ const p=await Store.exportData(S); toast(p?"Экспортировано":"Экспорт отменён",{icon:p?"ti-download":"ti-x"}); }
async function doImport(){
  const data=await Store.importData(); if(!data){ return; }
  if(!Array.isArray(data.areas) || !Array.isArray(data.items)){ toast("Файл не похож на экспорт Мыслика",{icon:"ti-alert-triangle"}); return; }
  if(!(await uiConfirm("Импорт заменит текущие данные. Продолжить?",{danger:true,title:"Импорт",okLabel:"Заменить"}))) return;
  S=sanitizeState(Object.assign(defaultState(),data));   // валидация + нормализация перед записью на диск
  areaFilter=null; view=S.settings.view||"today"; persist(); applySettings(); render(); toast("Импортировано");
}
// разовая проверка Telegram (по клику, БЕЗ фонового поллинга) — сообщения боту прогоняются
// через тот же captureText, что и поле быстрого захвата (#область/дата/!приоритет/*заметка работают одинаково)
async function checkTelegram(btn){
  if(!HasPy()){ toast("Telegram доступен только в приложении",{icon:"ti-brand-telegram"}); return; }
  const st=await window.pywebview.api.telegram_status();
  if(!st.configured){ openSettings(); toast("Сначала укажи токен бота в настройках",{icon:"ti-brand-telegram"}); return; }
  if(btn) btn.classList.add("spin");
  let res; try{ res=await window.pywebview.api.telegram_check(); } catch(e){ res={ok:false,error:"network"}; }
  if(btn) btn.classList.remove("spin");
  if(!res || !res.ok){ toast(res&&res.error==="no_token"?"Токен не настроен":"Не удалось связаться с Telegram",{icon:"ti-alert-triangle"}); return; }
  let n=0; (res.messages||[]).forEach(text=>{ if(captureText(text)) n++; });
  if(n){ persist(); render(); toast("Из Telegram: "+n,{icon:"ti-brand-telegram"}); }
  else toast("Новых сообщений нет",{icon:"ti-brand-telegram"});
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
  // Страховка от «съезда» вёрстки: если корневой documentElement/body всё же получил
  // прокрутку (WebView2 иногда прокручивает корень при возврате фокуса колесом) — тут же
  // возвращаем в 0. Внутренние скроллы (#view, списки, модалки) это не трогает.
  const pinRoot=()=>{ const de=document.documentElement, b=document.body;
    if(de.scrollTop||de.scrollLeft){ de.scrollTop=0; de.scrollLeft=0; }
    if(b.scrollTop||b.scrollLeft){ b.scrollTop=0; b.scrollLeft=0; } };
  window.addEventListener("scroll", pinRoot, true);   // capture: ловим до того, как корень уедет

  // window controls
  $("#win-min").onclick=()=>HasPy()&&window.pywebview.api.win_min();
  $("#win-max").onclick=()=>HasPy()&&window.pywebview.api.win_max();
  $("#win-close").onclick=()=>HasPy()&&window.pywebview.api.win_close();
  $("#titlebar").addEventListener("dblclick",e=>{ if(e.target.closest(".winbtns")) return; if(HasPy()) window.pywebview.api.win_max(); });   // дабл-клик по титлбару — развернуть/восстановить (привычно)
  const kh=$("#kbd-hint"); if(kh) kh.onclick=openShortcuts;

  // nav + areas + footer (delegated)
  $("#side").addEventListener("click",e=>{
    const nav=e.target.closest("[data-v]"); if(nav){ areaFilter=null; tagFilter=null; view=nav.dataset.v; render(); return; }
    const ar=e.target.closest("[data-area]"); if(ar){ const id=ar.dataset.area; areaFilter=(areaFilter===id?null:id); view="tasks"; render(); return; }
  });
  $("#add-area").onclick=(e)=>{ e.stopPropagation(); openAreaEditor(null,()=>renderNav()); };
  $("#manage-area").onclick=(e)=>{ e.stopPropagation(); openAreaManager(); };
  $("#f-export").onclick=doExport; $("#f-import").onclick=doImport; $("#f-timer").onclick=openTimer;
  $("#f-feedback").onclick=openFeedback;
  $("#f-settings").onclick=openSettings;

  // head-actions delegated (кнопки заголовка: +Задача/Заметка, навигация календаря, переключатели)
  $("#head-actions").addEventListener("click",async e=>{
    const nw=e.target.closest("[data-new]"); if(nw){ createNew(nw.dataset.new); return; }
    const cal=e.target.closest("[data-cal]"); if(cal){ const v=+cal.dataset.cal; if(v===0) calOffset=0; else calOffset+=v; render(); return; }
    const tg=e.target.closest("[data-toggle]"); if(tg){ if(tg.dataset.toggle==="done"){ showDone=!showDone; render(); } else if(tg.dataset.toggle==="clear"){ if(!(await uiConfirm("Все элементы корзины будут удалены навсегда. Это нельзя отменить.",{danger:true,title:"Очистить корзину?",okLabel:"Очистить"}))) return; S.items.filter(it=>it.deleted).forEach(it=>hardDeleteItem(it.id)); render(); toast("Корзина очищена"); } return; }
    const tgb=e.target.closest("[data-telegram]"); if(tgb){ checkTelegram(tgb); return; }
  });

  // view delegated actions
  $("#view").addEventListener("click",e=>{
    const ofo=e.target.closest("[data-openfolder]"); if(ofo){ const it=S.items.find(i=>i.id===ofo.dataset.openfolder); if(it) openItemFolder(it); return; }   // кнопка «открыть папку» в списках
    const chk=e.target.closest("[data-chk]"); if(chk){ const it=S.items.find(i=>i.id===chk.dataset.chk); if(it){ toggleDone(it); render(); const b=document.querySelector(`[data-chk="${it.id}"]`); if(b&&it.done) b.classList.add("pop"); } return; }
    const tdy=e.target.closest("[data-today]"); if(tdy){ const it=S.items.find(i=>i.id===tdy.dataset.today); if(it){ it.due=ymd(today()); touch(it); persist(); render(); toast("Перенесено на сегодня",{icon:"ti-target"}); } return; }
    const ot=e.target.closest("[data-overtoday]"); if(ot){ const T=today(), ds=ymd(T); let n=0; S.items.forEach(it=>{ if(!it.deleted&&it.kind==="task"&&!it.done&&it.due&&parseYmd(it.due)<T){ it.due=ds; touch(it); n++; } }); if(n){ persist(); render(); toast("Перенесено на сегодня: "+n,{icon:"ti-target"}); } return; }   // вся просрочка → сегодня
    const ed=e.target.closest("[data-edit]"); if(ed){ const it=S.items.find(i=>i.id===ed.dataset.edit); if(it)openItemEditor(it); return; }
    const day=e.target.closest("[data-day]"); if(day){ openItemEditor(null,"task",day.dataset.day); return; }   // клик по дню календаря — новая задача на эту дату
    const del=e.target.closest("[data-del]"); if(del){ const it=S.items.find(i=>i.id===del.dataset.del); if(it){ const id=it.id; deleteItem(id); render(); toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restoreItem(id); render(); }}); } return; }
    const ct=e.target.closest("[data-cleartag]"); if(ct){ tagFilter=null; render(); return; }
    const tg2=e.target.closest("[data-tag]"); if(tg2){ tagFilter=tg2.dataset.tag; areaFilter=null; view="tasks"; render(); return; }   // клик по тегу — фильтр по нему
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
    if(p.kind==="note") chips.push(`<span class="cap-chip"><i class="ti ti-note"></i>заметка</span>`);
    if(p.area){ const a=areaById(p.area); if(a) chips.push(`<span class="cap-chip"><i class="ti ${esc(a.icon)}"></i>${esc(a.name)}</span>`); }
    (p.tags||[]).forEach(t=>{ const ts=tagStyle(t); chips.push(`<span class="cap-chip" ${ts&&ts.color?`style="color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(t)}</span>`); });
    if(p.due){ const dl=dueLabel(p.due); chips.push(`<span class="cap-chip"><i class="ti ti-calendar-event"></i>${esc(dl?dl.txt:p.due)}</span>`); }
    if(p.repeat&&p.repeat!=="none") chips.push(`<span class="cap-chip"><i class="ti ti-repeat"></i>${esc(REPEAT[p.repeat])}</span>`);
    if(p.priority) chips.push(`<span class="cap-chip"><i class="ti ti-flag-3"></i>${"!".repeat(p.priority)}</span>`);
    capPrev.innerHTML=chips.join(""); capPrev.classList.toggle("show", chips.length>0);
  };
  cap.addEventListener("input",updatePreview);
  cap.addEventListener("keydown",e=>{
    if(e.key==="Enter" && cap.value.trim()){
      const raw=cap.value;
      const it=captureText(raw);
      if(!it){ cap.classList.add("shake"); setTimeout(()=>cap.classList.remove("shake"),420); return; }  // не плодим «(без названия)»
      cap.value=""; if(capPrev){ capPrev.innerHTML=""; capPrev.classList.remove("show"); } render();
      // мысль без координат ждёт в лотке графа, пока её не поставят на холст (см. Graph.build)
      toast("Добавлено — "+(it.x==null?"в лоток на графе":it.kind==="note"?"заметка":"в задачи"),{icon:"ti-check"});
      // умный захват (ai.js): тихо спросить локальную модель и предложить чистый вариант.
      // Нет ИИ → функция не определена / сама выходит, поведение не меняется.
      if(typeof aiRefineCapture==="function") aiRefineCapture(it, raw);
    }
  });

  // keyboard — используем e.code (раскладко-независимо: работает и на русской)
  document.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey) && e.code==="KeyK"){ e.preventDefault(); if(!$("#palette"))openPalette(); return; }
    if(e.key==="Escape"){ if(graph&&graph.linkFrom){graph.cancelLink();return;} closeOverlays(); return; }
    if(document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    if($("#overlay-root").children.length) return;
    // Ctrl+Z / Ctrl+Shift+Z — только ЗДЕСЬ, ниже двух стражей выше по функции: в полях ввода
    // работает нативный откат текста, а при открытом редакторе откат запрещён вовсе. Это не
    // лень: формы держат прямые ссылки на объекты внутри S, и подмена состояния под ними
    // заставила бы их молча писать в пустоту. Закрывать их перед откатом — хуже: окно чтения
    // сохраняет текст по уходу фокуса, то есть само закрытие записало бы правку в призрак.
    if((e.ctrlKey||e.metaKey) && e.code==="KeyZ"){
      e.preventDefault();
      const back=!e.shiftKey, ok=back?undoStep():redoStep();
      toast(ok ? (back?"Отменено":"Возвращено") : (back?"Отменять нечего":"Возвращать нечего"),
            {icon: back?"ti-arrow-back-up":"ti-arrow-forward-up"});
      return;
    }
    if((e.key==="Delete"||e.key==="Backspace") && view==="notes" && graph && graph.selNodes && graph.selNodes.size){ e.preventDefault(); graph.deleteSelected(); return; }
    if((e.ctrlKey||e.metaKey) && view==="notes" && graph){
      if(e.code==="KeyC" && graph.selNodes.size){ e.preventDefault(); graph.copySelection(); return; }
      if(e.code==="KeyV"){ e.preventDefault(); graph.pasteClip(); return; }
    }
    if(e.code==="KeyN"){ e.preventDefault(); openItemEditor(null); }
    else if(e.code==="Slash"){ e.preventDefault(); $("#cap").focus(); }
    else if(/^Digit[1-9]$/.test(e.code)){ const i=+e.code.slice(5)-1; if(NAV[i]){ areaFilter=null; tagFilter=null; view=NAV[i][0]; render(); } }
  });
  installSectionReorder();
  // в фоне приложение не должно жечь CPU: пауза анимации графа при потере фокуса/сворачивании.
  // graph существует только на вкладке «Заметки» (иначе null) — потому проверка через if(graph).
  const pauseGraph=()=>{ if(graph) graph.pause(); };
  // Вернулись к окну — будим граф и заодно спрашиваем про обновление. Дёргать autoCheckUpdate
  // на каждый фокус безопасно: в сеть она сходит не чаще раза в час (сторож _updNext).
  const onActive=()=>{ if(graph) graph.resume(); autoCheckUpdate(); };
  window.addEventListener("blur", pauseGraph);
  window.addEventListener("focus", onActive);
  document.addEventListener("visibilitychange", ()=>{ if(document.hidden) pauseGraph(); else onActive(); });
}
/* ===========================================================
   ПЕРЕТАСКИВАНИЕ СЕКЦИЙ-ОБЛАСТЕЙ прямо в списке («РАБОТА», «ПРОЧЕЕ» …):
   зажал ЛКМ ~0.5с по заголовку секихи → заголовок «поднимается» и едет
   за курсором, линия показывает куда встанет → отпустил. Переставляет
   S.areas (порядок наследуют «Задачи»/«Заметки»/«Папки» и сайдбар).
   Быстрый клик без удержания = свернуть/развернуть секцию (как раньше).
   =========================================================== */
function installSectionReorder(){
  const box=$("#view"); if(!box || box._secReorder) return; box._secReorder=true;
  const isAreaSec=el=>!!el && el.classList && el.classList.contains("sec") && /^area:/.test(el.dataset.collapse||"") && el.dataset.collapse!=="area:__none";
  const clearDrop=()=>box.querySelectorAll(".sec.drop-before,.sec.drop-after").forEach(s=>s.classList.remove("drop-before","drop-after"));
  let st=null;
  box.addEventListener("pointerdown",e=>{
    if(e.button!==0) return; const sec=e.target.closest(".sec"); if(!isAreaSec(sec)) return;
    st={sec, id:sec.dataset.collapse.slice(5), sx:e.clientX, sy:e.clientY, dragging:false, moved:false, pid:e.pointerId};
    st.timer=setTimeout(()=>{ if(!st) return; st.dragging=true; sec.classList.add("sec-drag"); document.body.classList.add("reordering"); try{sec.setPointerCapture(st.pid);}catch(_){} }, 480);
  });
  box.addEventListener("pointermove",e=>{
    if(!st) return;
    if(!st.dragging){ if(Math.abs(e.clientY-st.sy)>6||Math.abs(e.clientX-st.sx)>6){ clearTimeout(st.timer); st=null; } return; }  // дёрнулся до удержания — не drag, а скролл/клик
    st.moved=true; st.sec.style.transform=`translateY(${(e.clientY-st.sy).toFixed(0)}px)`;   // заголовок едет за курсором
    const secs=[...box.querySelectorAll(".sec")].filter(isAreaSec); let tgt=null, after=false;
    for(const s of secs){ if(s===st.sec) continue; const r=s.getBoundingClientRect();
      if(e.clientY < r.top + r.height/2){ tgt=s; after=false; break; }
      if(e.clientY < r.bottom){ tgt=s; after=true; break; } }
    if(!tgt && secs.length){ const last=secs[secs.length-1]; if(last!==st.sec && e.clientY>=last.getBoundingClientRect().bottom){ tgt=last; after=true; } }
    st.tgtId = tgt? tgt.dataset.collapse.slice(5) : null; st.after=after;
    clearDrop(); if(tgt) tgt.classList.add(after?"drop-after":"drop-before");
  });
  const finish=()=>{ if(!st) return; clearTimeout(st.timer);
    if(st.dragging){
      st.sec.style.transform=""; st.sec.classList.remove("sec-drag"); document.body.classList.remove("reordering"); clearDrop();
      if(st.moved){
        const dragged=S.areas.find(a=>a.id===st.id);
        if(dragged){ let arr=S.areas.filter(a=>a.id!==st.id);
          if(st.tgtId){ const ti=arr.findIndex(a=>a.id===st.tgtId); const idx=st.after?ti+1:ti; arr.splice(idx<0?arr.length:idx,0,dragged); }
          else arr.unshift(dragged);
          S.areas=arr; persist(); }
      }
      render();
      const sup=ev=>{ ev.stopPropagation(); ev.preventDefault(); document.removeEventListener("click",sup,true); };   // подавить клик-сворачивание после drop
      document.addEventListener("click",sup,true); setTimeout(()=>document.removeEventListener("click",sup,true),120);
    }
    st=null;
  };
  box.addEventListener("pointerup",finish);
  box.addEventListener("pointercancel",()=>{ if(st){ clearTimeout(st.timer); if(st.dragging){ st.sec.style.transform=""; st.sec.classList.remove("sec-drag"); document.body.classList.remove("reordering"); clearDrop(); render(); } st=null; } });
}
/* ===========================================================
   TOAST
   =========================================================== */
let toastT=null;
// toast(msg) или toast(msg,{icon,label,onAction,hold,spin}) — с действием показывается дольше и кликабелен (Undo).
// hold:true — висит, пока его не сменит следующий toast (для «Отправляю…»: ответ Google идёт дольше 1.8 c,
// иначе между «Отправляю…» и результатом получалась дыра без обратной связи).
// spin:true — крутить иконку: статичный ti-loader-2 читается как «зависло», а не «идёт работа».
function toast(msg, opt){
  const t=$("#toast"); opt=opt||{};
  const icon=opt.icon?`<i class="ti ${esc(opt.icon)}${opt.spin?" spinning":""}"></i>`:"";
  t.innerHTML=icon+`<span>${esc(msg)}</span>`+(opt.label?`<button class="toast-act">${esc(opt.label)}</button>`:"");
  t.classList.remove("show"); void t.offsetWidth;            // рестарт glow-анимации на каждый показ
  t.classList.add("show"); t.style.pointerEvents=opt.onAction?"auto":"none";
  clearTimeout(toastT);
  toastT=setTimeout(()=>t.classList.remove("show"), opt.hold?30000:(opt.onAction?5000:1800));
  if(opt.onAction){ const b=t.querySelector(".toast-act"); if(b) b.onclick=()=>{ clearTimeout(toastT); t.classList.remove("show"); opt.onAction(); }; }
}

/* ===========================================================
   РЕСАЙЗ БЕЗРАМОЧНОГО ОКНА (тянуть за края) — только в нативном аппе.
   WM_NCHITTEST до формы не доходит (перехватывает WebView2), поэтому
   ловим края сами и зовём win_drag, который двигает край к курсору.
   =========================================================== */
function installWindowResize(){
  if(!HasPy()) return;
  const EDGES=[
    ["t","ns-resize","top:0;left:10px;right:10px;height:5px;"],
    ["b","ns-resize","bottom:0;left:10px;right:10px;height:5px;"],
    ["l","ew-resize","left:0;top:10px;bottom:10px;width:5px;"],
    ["r","ew-resize","right:0;top:10px;bottom:10px;width:5px;"],
    ["tl","nwse-resize","top:0;left:0;width:8px;height:8px;"],
    ["tr","nesw-resize","top:0;right:0;width:8px;height:8px;"],
    ["bl","nesw-resize","bottom:0;left:0;width:8px;height:8px;"],
    ["br","nwse-resize","bottom:0;right:0;width:8px;height:8px;"]
  ];
  const root=el("div"); root.id="win-resize-layer";
  root.innerHTML=EDGES.map(([e,cur,pos])=>`<div class="win-rz" data-edge="${e}" style="cursor:${cur};${pos}"></div>`).join("");
  document.body.appendChild(root);
  let edge=null, raf=null, inflight=false;
  const tick=()=>{ raf=null; if(!edge||inflight) return; inflight=true;   // не больше 1 вызова за кадр; win_drag сам тянется к курсору
    Promise.resolve(window.pywebview.api.win_drag(edge)).then(()=>{inflight=false;},()=>{inflight=false;}); };
  $$(".win-rz",root).forEach(h=>{
    h.addEventListener("pointerdown",e=>{ if(e.button!==0) return; e.preventDefault(); edge=h.dataset.edge; try{h.setPointerCapture(e.pointerId);}catch(_){} });
    h.addEventListener("pointermove",()=>{ if(edge && !raf) raf=requestAnimationFrame(tick); });
    h.addEventListener("pointerup",()=>{ edge=null; });
    h.addEventListener("lostpointercapture",()=>{ edge=null; });
  });
}

/* ===========================================================
   BOOT
   =========================================================== */
async function boot(){
  const P=new URLSearchParams(location.search);
  // DEV-режим (только в браузере, по ?dev): каждый запуск — свежие демо-данные,
  // чтобы граф/виды всегда были наполнены для превью; ?view=graph|tasks|notes|... прыгает в вид.
  if(P.has("dev") && !HasPy()){
    S=defaultState(); seedDemo();
    const v=P.get("view"); if(v) S.settings.view=v;
    if(P.has("light")) S.settings.theme="light";
    undoInit();
    view=S.settings.view||"today"; applySettings(); wireGlobal(); render();
    console.log("[dev] preview mode: fresh demo, view="+view);
    return;
  }
  const loaded=await Store.load();
  if(loaded && loaded.areas){ S=sanitizeState(Object.assign(defaultState(),loaded)); }
  else { seedDemo(); await Store.save(S); }
  const v=P.get("view"); if(v) S.settings.view=v;   // ?view= работает и в реальном аппе
  undoInit();   // точка отсчёта истории — состояние, с которым приложение открылось
  view=S.settings.view||"today"; applySettings(); wireGlobal(); render();
  installWindowResize();   // ресайз безрамочного окна тянущим за края (только в нативном аппе)
  setTimeout(()=>{ const c=$("#cap"); if(c && !$("#overlay-root").children.length) c.focus(); }, 120);  // готов печатать мысль сразу
  // напоминание при старте
  setTimeout(()=>{
    const overdue=S.items.filter(it=>!it.deleted&&it.kind==="task"&&!it.done&&it.due&&parseYmd(it.due)<today());
    if(overdue.length) toast("⚠️ Просрочено: "+overdue.length+" задач");
  }, 600);
  // Авто-проверка обновлений (тихо; тост только если реально есть новее). При запуске — сразу,
  // дальше тик каждые 5 минут ТОЛЬКО сверяет часы: в сеть уходит не чаще раза в час и только
  // когда окно видно. Тик короткий не ради частоты, а ради точности: час отсчитывается от
  // последней удачной проверки, и длинный интервал промахивался бы мимо этого момента.
  autoCheckUpdate(true);
  setInterval(()=>autoCheckUpdate(), UPD_TICK);
}

/* Фоновая проверка обновлений: спрашивает у GitHub, не вышло ли новее. Ничего не качает —
   ~3 КБ на запрос. Про одну и ту же версию говорим ОДИН раз: иначе тост лез бы каждый час,
   пока человек не обновится. Ошибки глотаем молча — оффлайн не повод пугать.

   ЗАЧЕМ СТОРОЖ ПО ЧАСАМ, А НЕ ПРОСТО ТАЙМЕР. Раньше стоял setInterval на 6 часов: пока апп
   свёрнут, он тикал вхолостую, а вернувшись к аппу человек мог ждать новости до 6 часов.
   Теперь наоборот: триггеров МНОГО (фокус, показ окна, тик таймера), но решают не они, а
   _updNext. Сколько бы событий ни пришло — хоть двадцать alt-tab'ов подряд — в сеть уйдёт
   не больше одного запроса в час, потому что гейт по метке времени, а не по событию.
   Метку занимаем ДО await: иначе два триггера подряд успели бы проскочить оба.
   В фоне (document.hidden) не спрашиваем вообще — там запросов ровно ноль.
   Лимит GitHub — 60/час на КАЖДЫЙ IP, так что 1/час это ~2% бюджета; а если в него всё же
   упереться, check_update вернёт ok:false → просто «обновлений нет» и переспросим позже
   (сам zip качается с другого хоста и от лимита API не зависит). */
const UPD_EVERY = 60*60*1000;      // не чаще раза в час ходим в сеть
const UPD_RETRY = 5*60*1000;       // сеть отвалилась — переспросим скоро, не проедая целый час
const UPD_TICK  = 5*60*1000;       // тик только сверяет часы (сеть решает _updNext) — стоит ноль
let _updNotified = null;           // версия, о которой уже сообщили
let _updNext = 0;                  // раньше этого времени в сеть не идём

async function autoCheckUpdate(delayed){
  if(!HasPy()) return;                              // только в приложении
  if(document.hidden) return;                       // свёрнуты/скрыты — не наше время
  if(Date.now() < _updNext) return;                 // ещё не пора (см. коммент выше)
  _updNext = Date.now() + UPD_EVERY;                // окно занимаем СРАЗУ — параллельные триггеры отсекутся
  if(delayed) await new Promise(r=>setTimeout(r,1800));   // не мешаем старту/фокусу поля захвата
  let r; try{ r=await window.pywebview.api.check_update(); }catch(e){ _updNext=Date.now()+UPD_RETRY; return; }
  if(!r || !r.ok){ _updNext=Date.now()+UPD_RETRY; return; }   // сеть/лимит — не считаем за состоявшуюся проверку
  if(!r.hasUpdate) return;
  if(_updNotified===r.latest) return;               // уже говорили про эту версию
  _updNotified=r.latest;
  toast("Вышла новая версия "+r.latest, {icon:"ti-rocket", label:"Обновить",
        onAction:()=>applyUpdateNow(r.asset, r.latest)});
}

/* Обновление прямо из тоста, без похода в настройки. Приложение при этом СКАЧИВАЕТ ~20 МБ,
   закрывается и открывается заново (см. app.py apply_update) — поэтому на каждом шаге честно
   говорим, что происходит: молча захлопнувшееся окно читается как падение, а не как обновление.
   Путь через настройки остаётся — там список изменений, если хочется почитать перед обновлением. */
async function applyUpdateNow(asset, ver){
  if(!HasPy() || !asset) return;
  toast("Скачиваю обновление "+ver+"…", {icon:"ti-loader-2", hold:true, spin:true});
  let res; try{ res=await window.pywebview.api.apply_update(asset); }
  catch(e){ res={ok:false, error:"network"}; }
  if(res && res.ok){ toast("Обновление скачано — перезапускаю…", {icon:"ti-rocket", hold:true}); return; }
  const err=res&&res.error;
  toast(err==="not_frozen" ? "Обновление работает только в собранном приложении"
      : (err==="download"||err==="network") ? "Не удалось скачать — проверь интернет"
      : "Не удалось обновить",
      {icon:"ti-alert-triangle", label:"Подробнее", onAction:()=>openSettingsUpdates()});
}

/* Настройки сразу на вкладке обновлений, с уже запущенной проверкой. */
function openSettingsUpdates(){
  openSettings("data");
  setTimeout(()=>{
    const st=document.getElementById("upd-status"), b=document.getElementById("upd-check");
    if(st) st.scrollIntoView({block:"center"});
    if(b) b.click();
  }, 60);
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
  add({kind:"task",title:"Записаться к стоматологу",area:"a_other"});
  S.links.push([n1.id,n3.id]); S.links.push([n2.id,n3.id]);
  // Демо надо ПОСТАВИТЬ на холст: элемент без координат теперь считается неразобранным и лежит
  // в лотке графа (см. Graph.build) — иначе новый человек открыл бы пустую паутину и полный лоток.
  // Раскидываем по кругу, а области оставляем без координат: тогда build даст мягкий разогрев
  // (freshN>0 → alpha 0.12) и паутина сама уляжется, как и раньше.
  const live=S.items.filter(i=>!i.deleted);
  live.forEach((it,i)=>{ const a=(i/live.length)*Math.PI*2;
    it.x=Math.round(500+Math.cos(a)*230); it.y=Math.round(300+Math.sin(a)*170); });
  persist();
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
