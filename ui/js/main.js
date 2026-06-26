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
  const P=new URLSearchParams(location.search);
  // DEV-режим (только в браузере, по ?dev): каждый запуск — свежие демо-данные,
  // чтобы граф/виды всегда были наполнены для превью; ?view=graph|tasks|notes|... прыгает в вид.
  if(P.has("dev") && !HasPy()){
    S=defaultState(); seedDemo();
    const v=P.get("view"); if(v) S.settings.view=v;
    if(P.has("light")) S.settings.theme="light";
    view=S.settings.view||"today"; applyTheme(); wireGlobal(); render();
    console.log("[dev] preview mode: fresh demo, view="+view);
    return;
  }
  const loaded=await Store.load();
  if(loaded && loaded.areas){ S=sanitizeState(Object.assign(defaultState(),loaded)); }
  else { seedDemo(); await Store.save(S); }
  const v=P.get("view"); if(v) S.settings.view=v;   // ?view= работает и в реальном аппе
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
