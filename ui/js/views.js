"use strict";
/* ===========================================================
   RENDER
   =========================================================== */
/* В полосе слева пока только «Заметки»: остальные виды ждут переработки и до неё из меню
   убраны. Сами виды живы — открываются из палитры (Ctrl+K) и цифрами.
   Корзины нет вовсе: удалённое не откладывается «на потом», а сносится сразу, вернуть можно
   откатом (Ctrl+Z) или кнопкой в тосте. */
const NAV=[
  ["notes","ti-affiliate","Заметки"]
];
// виды, которых нет в полосе, но которые по-прежнему рисуются
const VIEWS_ALL=["today","tasks","notes","board","cal"];

// Неразобранное = мысль, которую ещё не поставили на холст (нет координат). Считаем ради
// бейджа на «Заметках»: лоток живёт внутри графа, и, не заходя туда, про накопившееся
// (например, пачку из Telegram) человек бы не узнал вовсе.
function counts(){
  // корзины больше нет: удалённое не хранится вовсе, считать нечего
  let unsorted=0, todayN=0;
  S.items.forEach(it=>{
    if(it.x==null) unsorted++;
    if(it.kind==="task" && !it.done && it.due && parseYmd(it.due)<=today()) todayN++;
  });
  return {unsorted, today:todayN};
}

/* Левая панель — всегда полоса иконок; кнопка внизу сворачивает её до кромки и обратно.
   Полного режима с подписями нет намеренно: место дороже, а подписи даёт всплывающая
   подсказка. Состояние живёт в настройках, поэтому переживает перезапуск. */
function applySide(){
  const s=$("#side"), b=$("#side-toggle"), w=$("#side-wide");
  if(!s) return;
  // кнопки «задвинуть» больше нет — если флаг остался с прошлых версий, снимаем его,
  // иначе панель осталась бы скрытой навсегда
  if(S.settings.sideHidden){ S.settings.sideHidden=false; persist(); }
  const скрыта = false;
  const широкая = S.settings.sideWide === true;   // с подписями: чтобы читать названия областей
  s.classList.toggle("slim", !широкая);
  s.classList.toggle("side-off", скрыта);
  if(w){
    w.title = широкая ? "Свернуть до значков" : "Показать названия";
    w.innerHTML = `<i class="ti ti-${широкая?"layout-sidebar-left-collapse":"layout-sidebar-left-expand"}"></i>`;
    w.onclick = ()=>{ S.settings.sideWide = !широкая; persist(); applySide(); if(graph) graph._onResize(); };
  }
  if(b){
    b.title = скрыта ? "Показать панель" : "Скрыть панель";
    b.innerHTML = `<i class="ti ti-chevron-${скрыта?"right":"left"}"></i>`;
    b.onclick = ()=>{ S.settings.sideHidden = !скрыта; persist(); applySide(); if(graph) graph._onResize(); };
  }
}

function renderNav(){
  const c=counts();
  applySide();
  $("#nav").innerHTML = NAV.map(n=>{
    const badge = (n[0]==="notes"&&c.unsorted)?`<span class="badge">${c.unsorted}</span>`
                : (n[0]==="today"&&c.today)?`<span class="badge">${c.today}</span>`
                : "";
    // подпись дублируем в title: в свёрнутой полосе виден только значок
    return `<button class="navi ${view===n[0]?"on":""}" data-v="${n[0]}" title="${esc(n[2])}"><i class="ti ${n[1]}"></i><span>${n[2]}</span>${badge}</button>`;
  }).join("");
  /* Список графов. Показываем даже когда он один: иначе кнопка «новый граф» висела бы над
     пустотой и было бы непонятно, к чему она. Число нод — чтобы отличать графы, у которых
     похожие названия. */
  const списокГрафов=$("#graphs");
  if(списокГрафов) списокГрафов.innerHTML = (S.graphs||[]).map(g=>{
    const свой = g.id===S.settings.graph;
    const подпись = g.name + " · нод: " + (g.items||[]).length + " · правая кнопка — значок, имя, удалить";
    /* Цвет графа задаёт и значок, и полоску активного: полоска акцентного цвета рядом с
       цветным значком читалась как чужая метка, а не как «этот граф сейчас открыт». */
    const цв = g.color ? ` style="--gc:${g.color}"` : "";
    return `<button class="areai grafi ${свой?"on":""}" data-graph="${esc(g.id)}" title="${esc(подпись)}"${цв}>`+
      `<i class="ti ${esc(g.icon||GRAPH_ICON_DEF)}"></i><span class="nm">${esc(g.name)}</span>`+
      `<span class="cnt">${(g.items||[]).length||""}</span></button>`;
  }).join("");
  $("#areas").innerHTML = S.areas.map(a=>{
    const tasks=S.items.filter(it=>it.kind==="task"&&it.area===a.id&&!it.deleted);
    const n=tasks.filter(it=>!it.done&&it.status!=="note").length;
    const pct=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):null;
    const col=a.color?`style="color:${a.color}"`:"";
    const подпись = a.name + (n?` · ${n} задач`:"") + (pct!=null?` · ${pct}%`:"");
    return `<button class="areai ${areaFilter===a.id?"on":""}" data-area="${a.id}" title="${esc(подпись)}"><i class="ti ${a.icon}" ${col}></i><span class="nm">${esc(a.name)}</span><span class="cnt">${n||""}${pct!=null?" ("+pct+"%)":""}</span></button>`;
  }).join("");
}

/* ===== правая панель: выбранный элемент ===== */

// Выбрать элемент в панель. Клик по ноде графа и по карточке ведёт сюда, а не в модалку:
// смысл сплита в том, чтобы читать и править, не закрывая обзор.
function asideSelect(id){
  asideId = id || null;
  asideGroup = null;
  // выделение сменилось — собранный отчёт был про ДРУГИЕ ноды, держать его в панели нельзя
  if(typeof repReset==="function") repReset();
  if(asideId && !S.settings.asideOn){ S.settings.asideOn = true; persist(); }
  renderAside();
}

/* Смена типа ноды. Нарисованное и написанное не трогаем: доска полотна лежит в S.boards,
   текст — в body, и при возврате прежнего типа всё оказывается на месте. Правим только поля,
   которые у нового типа обязаны быть согласованы. Одна функция на одиночную и групповую смену. */
function applyKind(it, kind){
  if(!it || it.kind===kind) return false;
  it.kind = kind;
  if(kind==="task"){ if(it.status==="note") it.status = it.done ? "done" : "todo"; }
  else { it.status="note"; it.done=false; it.doneAt=null; it.due=null; it.repeat="none"; it.priority=0; }
  touch(it);
  return true;
}

/* Поле описания подгоняется под текст. Иначе длинную заметку приходилось читать через щёлочку
   в 120 px и тянуть уголок руками — поверх живого графа это и тяжело, и дёргано.
   Высоту сначала сбрасываем: без этого scrollHeight помнит прежнюю, и поле только росло бы.
   Потолок — из max-height в CSS, дальше textarea прокручивается сама. */
function asideAutoGrow(ta){
  if(!ta) return;
  ta.style.height="auto";
  const потолок=Math.round(window.innerHeight*0.55);
  ta.style.height=Math.min(ta.scrollHeight+2, потолок)+"px";
}

/* Путь папки для панели: показываем ХВОСТ, а не начало. Начало у всех путей одинаковое
   («Moviestudio Dropbox\3D\Current projects\…»), а что за папка — говорят последние сегменты
   («…\Astra\renders\final»). Обрезаем в коде, а не многоточием CSS: тот режет с конца, то есть
   ровно самое нужное. Полный путь остаётся подсказкой. */
function asidePathShort(p, n){
  const s = (typeof shortFolder==="function") ? shortFolder(p) : (p||"");
  const parts = s.split(/[\\/]+/).filter(Boolean);
  const хвост = n || 3;
  return parts.length>хвост ? "…\\"+parts.slice(-хвост).join("\\") : s;
}

/* Список нод ДЕРЕВОМ: у КРОЛИКА ноды всегда живут иерархией (персонаж → рендер/анимация/свет),
   и плоский перечень терял главное — кто чей. Корнем считаем ноду, чьего родителя в наборе нет:
   иначе ветка повисла бы без начала. `seen` защищает от циклов parent, `limit` — от простыни. */
function asideTreeRows(nodes, limit){
  const set=new Set(nodes.map(n=>n.id));
  const kids={}; const roots=[];
  nodes.forEach(n=>{ if(n.parent && set.has(n.parent)) (kids[n.parent]=kids[n.parent]||[]).push(n); else roots.push(n); });
  const rows=[], seen=new Set();
  const walk=(n, lvl)=>{
    if(seen.has(n.id) || rows.length>=(limit||999)) return;
    seen.add(n.id); rows.push({n, lvl});
    (kids[n.id]||[]).forEach(k=>walk(k, lvl+1));
  };
  roots.forEach(r=>walk(r,0));
  return rows;
}

// строка ноды в панели: отступ по уровню + роль. Уровень уезжает в CSS-переменную --lvl.
function asideNodeRow(n, lvl, role){
  const икона = n.kind==="flow"?"ti-artboard":n.kind==="note"?"ti-note":"ti-checkbox";
  const имя = (n.title||"").trim();
  const пусто = n.kind==="flow"?"полотно без названия":n.kind==="note"?"заметка без названия":"задача без названия";
  return `<button class="as-link${lvl?" as-sub":""}" style="--lvl:${lvl||0}" data-go="${esc(n.id)}"><i class="ti ${икона}"></i>
    <span${имя?"":' class="as-dim"'}>${esc(имя||пусто)}</span>
    ${role?`<em class="as-role">${role}</em>`:""}</button>`;
}

// Выделили рамкой несколько нод — показываем сводку, а не пустоту: сколько и чего выбрано,
// с быстрым переходом к любой из них.
function asideMany(ids){
  asideGroup = (ids||[]).slice();
  asideId = null;
  if(typeof repReset==="function") repReset();   // см. asideSelect
  if(!S.settings.asideOn){ S.settings.asideOn = true; persist(); }
  renderAside();
}

/* Ниже этой ширины Excalidraw показывает телефонный интерфейс (его порог — 730 px по
   контейнеру). Поэтому под доску панель раздвигается сама, а если места в окне нет —
   доска в панель не встраивается вовсе, вместо неё кнопка «на весь экран». */
/* 730 — порог самого Excalidraw, плюс внутренние отступы панели и рамка врезки (около 40 px
   в сумме, плюс запас на полосу прокрутки): считать надо по ХОЛСТУ, а не по ширине панели.
   С 748 холст выходил 700 px и приезжала мобильная раскладка. */
const BOARD_MIN = 790;

// Тот же предел, что и в asideApplyWidth: панели нельзя занять последние 420 px — там живёт
// левая часть. Если и в этом пределе доска не помещается, врезку не показываем вовсе.
const asideMaxW = ()=> Math.max(320, window.innerWidth - 420);
function asideBoardFits(){ return asideMaxW() >= BOARD_MIN; }

function asideApplyWidth(){
  const a=$("#aside"), sp=$("#splitter");
  if(!a||!sp) return;
  const вкл = S.settings.asideOn !== false;
  a.classList.toggle("off", !вкл);
  sp.classList.toggle("off", !вкл);
  /* Ширину храним ДОЛЕЙ от окна, а не в пикселях: после работы в полный экран панель шириной
     в 800 px открывалась в маленьком окне и занимала его целиком. Старое значение в пикселях
     переводим в долю один раз. */
  if(S.settings.asideFrac==null){
    S.settings.asideFrac = Math.min(0.6, Math.max(0.2, (+S.settings.asideW || 420) / Math.max(600, window.innerWidth)));
    persist();
  }
  const макс = asideMaxW();
  let w = Math.min(макс, Math.max(300, Math.round(window.innerWidth * S.settings.asideFrac)));
  const it = asideId ? liveById(asideId) : null;
  if(it && it.kind==="flow" && asideBoardFits()) w = Math.min(макс, Math.max(w, BOARD_MIN));
  a.style.width = w + "px";
}

function renderAside(){
  const a=$("#aside");
  if(!a) return;
  // живая доска в поле уедет вместе с разметкой — снимаем её ДО перерисовки, иначе React-корень
  // остался бы в оторванном DOM (та же болезнь, что у графа и врезки полотна)
  if(typeof fieldsStopIn==="function") fieldsStopIn(a);
  asideApplyWidth();
  if(S.settings.asideOn === false) return;
  // сводка по выделенной группе — вместо карточки одной ноды
  if(asideGroup && asideGroup.length>1){
    if(drawRoot && !$("#draw-screen")) drawDestroy();
    const ноды = asideGroup.map(liveById).filter(Boolean);
    const счёт = k => ноды.filter(n=>n.kind===k).length;
    a.innerHTML = `<div class="as-head"><h2 class="as-title">Выделено: ${ноды.length}</h2></div>
      <div class="as-rows">
        <div class="as-row"><span class="as-k">Задачи</span><span class="as-ico"><i class="ti ti-checkbox"></i></span><span class="as-v">${счёт("task")}</span></div>
        <div class="as-row"><span class="as-k">Заметки</span><span class="as-ico"><i class="ti ti-note"></i></span><span class="as-v">${счёт("note")}</span></div>
        <div class="as-row"><span class="as-k">Полотна</span><span class="as-ico"><i class="ti ti-artboard"></i></span><span class="as-v">${счёт("flow")}</span></div>
      </div>
      <div class="as-sec">Изменить всё сразу</div>
      <div class="as-rows">
        <div class="as-row"><span class="as-k">Тип</span><span class="as-ico"></span><span class="as-v">
          <select class="as-sel" data-all="kind">
            <option value="">— оставить —</option>
            <option value="task">Задача</option>
            <option value="note">Заметка</option>
            <option value="flow">Полотно</option>
          </select></span></div>
        <div class="as-row"><span class="as-k">Область</span><span class="as-ico"></span><span class="as-v">
          <select class="as-sel" data-all="area">
            <option value="">— оставить —</option>
            <option value="__none__">Без области</option>
            ${S.areas.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join("")}
          </select></span></div>
      </div>
      <div class="as-sec">Ноды</div>
      <div class="as-links">${asideTreeRows(ноды, 30).map(r=>asideNodeRow(r.n, r.lvl, "")).join("")}</div>
      ${(typeof repActive==="function" && repActive()) ? "" :
        `<button class="as-wide" data-report="1"><i class="ti ti-file-text"></i>Собрать отчёт</button>`}
      ${(typeof repPanelHtml==="function") ? repPanelHtml() : ""}`;
    const кнОтчёт = a.querySelector("[data-report]");
    if(кнОтчёт) кнОтчёт.onclick = ()=>{ if(typeof repOpen==="function") repOpen(ноды); };
    if(typeof repPanelWire==="function") repPanelWire(a);
    a.querySelectorAll("[data-go]").forEach(el=>{ el.onclick=()=>{ asideSelect(el.dataset.go); if(graph) graph.focusNode(el.dataset.go); }; });

    // групповые правки: меняем у всех разом и сразу перерисовываем паутину
    a.querySelectorAll("[data-all]").forEach(поле=>{
      поле.onchange = ()=>{
        const v = поле.value; if(!v) return;
        let тронуто = 0;
        if(поле.dataset.all==="kind") ноды.forEach(n=>{ if(applyKind(n, v)) тронуто++; });
        else{
          const area = v==="__none__" ? null : v;
          ноды.forEach(n=>{ n.area=area; if(area) n.areaAuto=false; else delete n.areaAuto; touch(n); тронуто++; });
          recomputeHierarchy();
        }
        persist(); renderNav(); if(graph) graph.build();
        renderAside();
        toast("Изменено нод: "+тронуто, {icon:"ti-checks"});
      };
    });
    // Кнопки «удалить выделенные» тут нет намеренно: она висела одна в пустом ряду, а удаление
    // группы и так делает Delete на графе (Graph.deleteSelected) — с тем же откатом по тосту.
    return;
  }
  const it = asideId ? liveById(asideId) : null;
  /* Доска в панели пересборку не переживает: перезапись innerHTML оставила бы React-корень
     в отсоединённом DOM. Пока открыта доска той же ноды — панель не трогаем вовсе. */
  if(it && it.kind==="flow" && drawRoot && drawItem && drawItem.id===it.id && a.querySelector("#as-board-host canvas")) return;
  if(drawRoot && (!it || it.kind!=="flow" || (drawItem && drawItem.id!==it.id)) && !$("#draw-screen")) drawDestroy();
  if(!it){
    /* Отчёт показываем и здесь: его собирают по выделению в графе, а выделение рамкой
       карточку не открывает — без этой ветки кнопка «Отчёт» срабатывала бы в пустоту. */
    const отчёт = (typeof repPanelHtml==="function") ? repPanelHtml() : "";
    a.innerHTML = отчёт
      ? отчёт
      : `<div class="aside-empty"><i class="ti ti-click"></i>Выбери ноду — здесь откроется её содержимое</div>`;
    if(отчёт && typeof repPanelWire==="function") repPanelWire(a);
    return;
  }
  a.innerHTML = asideCard(it) + ((typeof repPanelHtml==="function") ? repPanelHtml() : "");
  wireAside(it);
  if(typeof repPanelWire==="function") repPanelWire(a);
  const хост = a.querySelector("#as-board-host");
  if(хост) openBoardIn(it, хост);
}

/* Карточка элемента в панели. Правится прямо здесь: смысл сплита в том, чтобы менять поля,
   не открывая окно поверх графа. Окно осталось только для того, чего в панели нет
   (цвет ноды, привязка папки) — по кнопке-карандашу. */
function asideCard(it){
  /* linksOfLive отдаёт СТРОКИ-id, а не элементы, и среди них попадаются хабы областей
     (hub_*) — из-за этого в списке висели пустые строки «без названия». Разворачиваем
     в настоящие элементы, хабы выбрасываем: область и так показана отдельной строкой. */
  const дети = childrenOfLive(it.id);
  const связи = linksOfLive(it.id).filter(x=>!/^hub_/.test(x)).map(liveById).filter(Boolean);
  const родитель = it.parent ? liveById(it.parent) : null;
  const тип = it.kind==="flow" ? "Полотно" : it.kind==="note" ? "Заметка" : "Задача";
  // строка панели: подпись | слот иконки (может быть пустым) | значение
  const строка = (имя, икона, значение)=>
    `<div class="as-row"><span class="as-k">${имя}</span>
      <span class="as-ico">${икона ? `<i class="ti ${икона[0]}" ${икона[1]?`style="color:${икона[1]}"`:""}></i>` : ""}</span>
      <span class="as-v">${значение}</span></div>`;

  const выборТипа = `<select class="as-sel" data-f="kind">
       <option value="task" ${it.kind==="task"?"selected":""}>Задача</option>
       <option value="note" ${it.kind==="note"?"selected":""}>Заметка</option>
       <option value="flow" ${it.kind==="flow"?"selected":""}>Полотно</option>
     </select>`;
  const стр = [];
  // у полотна тип уезжает в шапку, к названию: строк не остаётся вовсе, и доска берёт их высоту
  if(it.kind!=="flow") стр.push(строка("Тип", null, выборТипа));
  /* У ПОЛОТНА в панели только название и тип. Область, папка и теги ему не нужны — полотно
     это холст, а не карточка задачи, — а каждая лишняя строка отъедала высоту у самой доски,
     ради которой панель и открывают. Поля никуда не делись: они доступны в окне правки. */
  const холст = it.kind==="flow";
  if(!холст) стр.push(строка("Область", [areaIcon(it.area), areaColor(it.area)],
    `<select class="as-sel" data-f="area">
       <option value="">Без области</option>
       ${S.areas.map(a=>`<option value="${esc(a.id)}" ${it.area===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}
     </select>${it.areaAuto ? `<span class="as-note" title="Область взята у родительской ноды">наследуется</span>` : ""}`));
  if(it.kind==="task"){
    const ст = it.done ? "done" : (it.status==="doing" ? "doing" : (it.status==="paused" ? "paused" : "todo"));
    стр.push(строка("Статус", ["ti-circle-dot"],
      `<select class="as-sel" data-f="status">
         <option value="todo"  ${ст==="todo" ?"selected":""}>Не начато</option>
         <option value="doing" ${ст==="doing"?"selected":""}>В работе</option>
         <option value="paused" ${ст==="paused"?"selected":""}>На паузе</option>
         <option value="done"  ${ст==="done" ?"selected":""}>Готово</option>
       </select>`));
    стр.push(строка("Срок", ["ti-calendar"],
      `<input class="as-inp" type="date" data-f="due" value="${esc(it.due||"")}">
       ${it.due?`<button class="as-x" data-clear="due" title="Убрать срок"><i class="ti ti-x"></i></button>`:""}`));
    стр.push(строка("Приоритет", ["ti-flag"],
      `<select class="as-sel" data-f="priority">
         ${["—","низкий","средний","высокий"].map((n,p)=>`<option value="${p}" ${(it.priority||0)===p?"selected":""}>${n}</option>`).join("")}
       </select>`));
    стр.push(строка("Повтор", ["ti-repeat"],
      `<select class="as-sel" data-f="repeat">
         ${Object.entries(REPEAT).map(([k,v])=>`<option value="${k}" ${(it.repeat||"none")===k?"selected":""}>${k==="none"?"не повторяется":v}</option>`).join("")}
       </select>`));
  }
  /* Папка ноды — здесь, а не только в окне правки: путь нужен по ходу работы (открыть рендеры,
     скопировать для смежника), а ради этого открывать окно поверх графа — лишний шаг.
     Показываем УКОРОЧЕННЫЙ путь (см. shortFolder): полный не влезает в панель и всё равно
     начинается с локального «E:\_Dropbox\», который никому, кроме этого ПК, не нужен. */
  /* Сам путь — КНОПКА «открыть»: открывают папку по десять раз на дню, и гнать курсор к мелкой
     иконке у правого края панели ради самого частого действия — лишняя работа. Иконки рядом
     остаются для редких: скопировать, сменить, отвязать. */
  if(!холст) стр.push(строка("Папка", ["ti-folder"], it.folder
    ? `<button class="as-path" data-folder="open" title="Открыть в проводнике:\n${esc(it.folder)}">${esc(asidePathShort(it.folder))}</button>
       <button class="as-x" data-folder="copy" title="Скопировать путь для передачи (без локального начала)"><i class="ti ti-copy"></i></button>
       <button class="as-x" data-folder="pick" title="Сменить папку"><i class="ti ti-folder-cog"></i></button>
       <button class="as-x" data-folder="clear" title="Отвязать папку"><i class="ti ti-x"></i></button>`
    : `<button class="as-link as-thin" data-folder="pick"><i class="ti ti-folder-search"></i><span>Привязать папку</span></button>`));

  if(!холст) стр.push(строка("Теги", null,
    `<span class="as-tags">${(it.tags||[]).map(t=>{
        const ст = tagStyle(t);
        return `<span class="as-chip as-tag" ${ст&&ст.color?`style="color:${ст.color};border-color:${ст.color}"`:""}>
          ${ст&&ст.icon?`<i class="ti ${esc(ст.icon)}"></i>`:""}${esc(t)}<button data-untag="${esc(t)}" title="Убрать"><i class="ti ti-x"></i></button></span>`;
      }).join("")}
      <button class="as-chip as-add" data-addtag="1" title="Добавить тег"><i class="ti ti-plus"></i></button>
      <button class="as-chip as-add" data-tagmgr="1" title="Теги со стилем: цвет, иконка, размер"><i class="ti ti-settings"></i></button></span>`));

  const тело = it.kind==="flow"
    ? (asideBoardFits()
        ? `<div class="as-board"><div class="as-board-bar">
             <span class="as-board-t"><i class="ti ti-artboard"></i>Доска</span>
             <button class="as-ic" data-full="1" title="На весь экран"><i class="ti ti-maximize"></i></button>
           </div><div id="as-board-wrap"><div id="as-board-host"></div></div></div>`
        : `<div class="as-note as-narrow">Панель уже 730 px — Excalidraw показал бы телефонный интерфейс.
             Расширь панель или открой доску целиком.</div>
           <button class="btn primary as-open" data-open="1"><i class="ti ti-artboard"></i>Открыть доску</button>`)
    // именованные поля идут под описанием и правятся прямо здесь (панель из fields.js)
    : `<textarea class="as-area" data-f="body" placeholder="Описание…">${esc(it.body||"")}</textarea>
       <div class="flds aside-flds" id="as-fields"></div>`;

  /* Связанные ноды показываем ИЕРАРХИЕЙ, а не свалкой: родитель сверху, под ним сама нода
     (приглушённо, как «ты здесь»), под ней — вложенные. Плоский список не давал понять, где
     нода стоит в дереве, — а у КРОЛИКА дерево и есть основная структура. Боковые связи
     (не родитель и не ребёнок) идут отдельным блоком: иерархии в них нет, и мешать их
     с деревом значило бы соврать про вложенность.
     Дедуп по id: одна и та же нода бывает и ребёнком, и связью — в списке нужна один раз. */
  const детиLive = дети.filter(n=>n.id!==it.id);
  const вДереве = new Set([родитель, ...детиLive].filter(Boolean).map(n=>n.id));
  const боковые = [...new Map(связи.filter(n=>n && n.id!==it.id && !вДереве.has(n.id)).map(n=>[n.id,n])).values()];
  const рядом = вДереве.size + боковые.length;

  const ветка = [];
  if(родитель) ветка.push(asideNodeRow(родитель, 0, "родитель"));
  const свой = родитель ? 1 : 0;
  ветка.push(`<div class="as-link as-self" style="--lvl:${свой}"><i class="ti ${it.kind==="flow"?"ti-artboard":it.kind==="note"?"ti-note":"ti-checkbox"}"></i>
    <span>${esc((it.title||"").trim()||"эта нода")}</span><em class="as-role">эта</em></div>`);
  детиLive.slice(0,20).forEach(n=>ветка.push(asideNodeRow(n, свой+1, "вложена")));

  const связанные = рядом ? `<div class="as-sec">Связанные ноды<span class="as-cnt">${рядом}</span></div>
    <div class="as-links">${ветка.join("")}</div>
    ${боковые.length?`<div class="as-sec as-sec2">Связаны без вложенности</div>
      <div class="as-links">${боковые.slice(0,20).map(n=>asideNodeRow(n,0,"")).join("")}</div>`:""}` : "";

  /* Внизу панели осталось ОДНО действие — отчёт, и оно подписано словами. Дубль и удаление
     ушли: обе кнопки были мелкими иконками рядом, и удаление ловилось промахом по дублю.
     Обе живут там, где их и ищут: удалить — в окне правки и по ПКМ в графе, дубль — Ctrl+C /
     Ctrl+V в графе (он там же и раскладывает копию). */
  // кнопка та же и такая же, как в сводке по нескольким нодам (.as-wide) — одно действие, одна форма
  const действия = `<div class="as-foot">
      <button class="as-wide" data-report="1" title="Собрать отчёт по этой ноде и её дереву"><i class="ti ti-file-text"></i>Собрать отчёт</button>
    </div>`;

  return `<div class="as-head"><h2 class="as-title" contenteditable="plaintext-only" data-ph="без названия">${esc(it.title||"")}</h2>
      ${холст?`<span class="as-kind">${выборТипа}</span>`:""}
      <div class="as-acts">
        ${(typeof aiEnabled==="function" && aiEnabled())
          ? `<button class="as-ic" data-airefine="1" title="ИИ: причесать заголовок и поля — как при вводе мысли в строку захвата"><i class="ti ti-sparkles"></i></button>` : ""}
        <button class="as-ic" data-edit="1" title="Править"><i class="ti ti-pencil"></i></button>
        <button class="as-ic" data-close="1" title="Закрыть панель"><i class="ti ti-x"></i></button>
      </div></div>
    ${стр.length?`<div class="as-rows${холст?" compact":""}">${стр.join("")}</div>`:""}
    ${тело}
    ${связанные}
    ${действия}`;
}

function wireAside(it){
  const a=$("#aside");
  const b=(sel,fn)=>{ const el=a.querySelector(sel); if(el) el.onclick=fn; };
  b("[data-close]", ()=>{ S.settings.asideOn=false; persist(); asideApplyWidth(); });
  /* У ПОЛОТНА карандаш открывает окно ПРАВКИ, а не доску на весь экран. Раньше он звал
     openItemSmart, и для полотна это был разворот доски — а поля (область, папка, теги) из
     панели убраны и жить им больше негде. Развернуть доску есть чем: кнопка в её шапке. */
  b("[data-edit]",  ()=> it.kind==="flow" ? openItemEditor(it) : openItemSmart(it));
  /* Тот же самый разбор, что и при вводе мысли в строку захвата, только запущенный руками:
     нода уже создана, поэтому «сырьём» отдаём её название плюс описание. Без этой кнопки
     причесать можно было только то, что вводилось через верхнюю строку. */
  b("[data-airefine]", ()=>{
    const raw=((it.title||"").trim()+"\n"+(it.body||"").trim()).trim();
    if(!raw){ toast("Сначала впиши мысль — ИИ нечего читать",{icon:"ti-sparkles"}); return; }
    if(typeof aiRefineCapture==="function") aiRefineCapture(it, raw);
  });
  b("[data-report]", ()=>{ if(typeof repOpen==="function") repOpen([it]); });
  // папка ноды: выбор и открытие идут через core.js (там же тосты и запись), убрать — тут
  a.querySelectorAll("[data-folder]").forEach(кн=>кн.onclick=async()=>{
    const что=кн.dataset.folder;
    if(что==="pick") pickItemFolder(it, ()=>renderAside());
    else if(что==="open") openItemFolder(it);
    else if(что==="copy"){
      // копируем ИМЕННО укороченный путь: его отдают другому человеку, а локальное начало
      // (E:\_Dropbox\…) у него своё — см. shortFolder в core.js
      const путь=(typeof shortFolder==="function")?shortFolder(it.folder):it.folder;
      const ок=(typeof _repCopy==="function") ? await _repCopy(путь) : false;
      toast(ок?"Путь скопирован":"Не удалось скопировать",{icon:ок?"ti-copy":"ti-alert-triangle"});
    }
    else { it.folder=undefined; touch(it); persist(); renderAside(); toast("Папка отвязана",{icon:"ti-folder-off"}); }
  });
  b("[data-open]",  ()=>openBoard(it));
  b("[data-full]",  ()=>openBoard(it));   // из врезки — развернуть ту же доску на весь экран
  // переход по связанной ноде не только меняет карточку, но и выделяет её в паутине
  a.querySelectorAll("[data-go]").forEach(el=>{
    el.onclick=()=>{ asideSelect(el.dataset.go); if(graph) graph.focusNode(el.dataset.go); };
  });

  /* После правки НЕ зовём render(): на вкладке «Заметки» он пересобирает граф с нуля и сбрасывает
     камеру — человек правил бы поле и каждый раз терял место, куда смотрел. Обновляем точечно. */
  const обновить = (панель=true)=>{
    touch(it); persist();
    renderNav();                        // счётчики видов и проценты областей
    if(graph) graph.build();            // подписи, цвета и форма ноды в графе
    else if(view!=="notes") render();   // на списочных вкладках перерисовать нечего беречь
    if(панель) renderAside();
  };

  a.querySelectorAll("[data-f]").forEach(поле=>{
    const f = поле.dataset.f;
    if(f==="body" || f==="title") return;   // текстовые — ниже, со своим дебаунсом
    поле.onchange = ()=>{
      const v = поле.value;
      // выбор руками перебивает наследование от родителя (и обратно: «Без области» =
      // вернуть ноду к наследованию, если она к кому-то привязана)
      if(f==="area"){ it.area = v || null; if(v) it.areaAuto=false; else delete it.areaAuto; recomputeHierarchy(); }
      else if(f==="kind") applyKind(it, v);
      else if(f==="priority") it.priority = +v || 0;
      else if(f==="repeat") it.repeat = v || "none";
      else if(f==="due") it.due = v || null;
      else if(f==="status"){
        // «Готово» проводим через toggleDone: он ставит дату выполнения и порождает следующий
        // повтор. Прямое it.done=true всё это потеряло бы.
        if(v==="done" && !it.done) toggleDone(it);
        else if(v!=="done" && it.done){ it.done=false; it.status=v; it.doneAt=null; }
        else it.status = v;
      }
      обновить();
    };
  });

  b("[data-clear=due]", ()=>{ it.due=null; обновить(); });

  // теги: снять крестиком, добавить плюсом
  a.querySelectorAll("[data-untag]").forEach(el=>{
    el.onclick = ()=>{ it.tags = (it.tags||[]).filter(t=>t!==el.dataset.untag); обновить(); };
  });
  // Ввод тега прямо в строке: модалка ради одного слова — перебор, да и панель для того и есть.
  b("[data-tagmgr]", ()=>openTagManager());
  b("[data-addtag]", ()=>{
    const кнопка = a.querySelector("[data-addtag]");
    const поле = el("input","as-chip as-taginp");
    поле.placeholder = "тег";
    /* Подсказываем уже существующие теги: и те, что со стилем, и просто встречавшиеся на
       других нодах. Без этого один и тот же тег легко завести дважды в разном написании. */
    const все = new Set((S.tags||[]).map(t=>t.name));
    S.items.forEach(i=>(i.tags||[]).forEach(t=>все.add(t)));
    (it.tags||[]).forEach(t=>все.delete(t));
    const список = el("datalist"); список.id = "as-taglist";
    список.innerHTML = [...все].sort().map(t=>`<option value="${esc(t)}"></option>`).join("");
    поле.setAttribute("list","as-taglist");
    кнопка.replaceWith(поле);
    поле.after(список);
    поле.focus();
    const принять = ()=>{
      const t = поле.value.trim().replace(/^#/,"");
      поле.onblur = null;
      if(t){
        if(!it.tags) it.tags=[];
        if(!it.tags.includes(t)) it.tags.push(t);
        обновить();
      } else renderAside();
    };
    поле.onblur = принять;
    поле.onkeydown = e=>{
      if(e.key==="Enter"){ e.preventDefault(); принять(); }
      if(e.key==="Escape"){ e.preventDefault(); поле.onblur=null; renderAside(); }
    };
  });

  // Заголовок и текст — с дебаунсом и БЕЗ перерисовки панели: иначе курсор прыгал бы на первый
  // символ после каждой буквы.
  let таймер=null;
  const позже = fn=>{ clearTimeout(таймер); таймер=setTimeout(fn, 400); };
  const загл = a.querySelector(".as-title");
  if(загл){
    загл.oninput = ()=>позже(()=>{ it.title = загл.textContent.trim(); обновить(false); });
    загл.onkeydown = e=>{ if(e.key==="Enter"){ e.preventDefault(); загл.blur(); } };
  }
  const тело = a.querySelector('[data-f="body"]');
  if(тело){
    asideAutoGrow(тело);                                   // открыли ноду — сразу видно весь текст
    тело.oninput = ()=>{ asideAutoGrow(тело); позже(()=>{ it.body = тело.value; обновить(false); }); };
    fieldsCopyOnRight(тело, ()=>тело.value);               // ПКМ копирует описание — как у полей
  }
  /* Поля ноды. Панель перерисовывает себя сама, поэтому renderAside отсюда НЕ зовём:
     иначе панель сносила бы собственный узел прямо в обработчике. */
  const поля = a.querySelector("#as-fields");
  if(поля) fieldsPanel(поля, fieldsOf(it), {item:it, attach:true, save:()=>обновить(false)});
}

// Разделитель. Тянем мышью, ширину пишем в настройки — но только по отпусканию,
// иначе каждое движение мыши гнало бы весь файл через мост.
function wireSplitter(){
  const sp=$("#splitter");
  if(!sp || sp.dataset.wired) return;
  sp.dataset.wired="1";
  sp.addEventListener("pointerdown", e=>{
    e.preventDefault();
    const a=$("#aside"), старт=e.clientX, была=a.getBoundingClientRect().width;
    sp.classList.add("drag");
    sp.setPointerCapture(e.pointerId);
    const двигать = ev=>{
      const макс = asideMaxW();
      const w = Math.min(макс, Math.max(300, была + (старт - ev.clientX)));
      S.settings.asideW = w;                                  // для совместимости со старыми данными
      S.settings.asideFrac = w / Math.max(600, window.innerWidth);   // тянем долю, её и запоминаем
      a.style.width = w + "px";
    };
    const кончить = ()=>{
      sp.classList.remove("drag");
      sp.removeEventListener("pointermove", двигать);
      sp.removeEventListener("pointerup", кончить);
      persist();
      if(graph) graph._onResize();   // граф пересчитывает свой холст под новую ширину
    };
    sp.addEventListener("pointermove", двигать);
    sp.addEventListener("pointerup", кончить);
  });
  window.addEventListener("resize", asideApplyWidth);
}

function head(title, sub, actions){
  // подпись вида убрана из разметки (место в верхней полосе дороже), но вызовы head() её
  // по-прежнему передают — молча игнорируем, чтобы не переписывать все виды
  const t=$("#main-title"); if(t) t.textContent=title;
  const s=$("#main-sub");   if(s) s.innerHTML=sub||"";
  const a=$("#head-actions"); if(a) a.innerHTML=actions||"";
}

function taskCard(it, opts){
  opts=opts||{};
  const dl=dueBadge(it);
  const tags=(it.tags||[]).map(t=>{ const ts=tagStyle(t); return `<span class="tag hash" data-tag="${esc(t)}" title="Фильтр по тегу" ${ts&&ts.color?`style="border-color:${ts.color};color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(t)}</span>`; }).join("");
  return `<div class="card ${it.done?"done":""} pri-${it.priority||0}" data-id="${it.id}">
    <button class="chk ${it.done?"done":""}" data-chk="${it.id}"><i class="ti ti-check"></i></button>
    <div class="card-body">
      <div class="card-ttl">${esc(it.title)}</div>
      <div class="meta">
        ${it.area?`<span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
        ${it.repeat&&it.repeat!=="none"?`<span class="rep"><i class="ti ti-repeat"></i>${REPEAT[it.repeat]}</span>`:""}
        ${it.priority?`<span class="pri"><i class="ti ti-flag-3"></i></span>`:""}
        ${tags}
        ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
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
// текстовый фильтр списков (#list-filter): ввод → перерендер → вернуть фокус и каретку (иначе теряются при innerHTML)
function wireListFilter(v){
  const lf=$("#list-filter",v); if(!lf) return;
  // каретку НЕ трогаем: её положение снимает и возвращает render() (см. _viewSnapshot).
  // Раньше здесь стояло setSelectionRange(в конец) — и правка середины слова была невозможна.
  lf.oninput=()=>{ listQuery=lf.value; render(); const nf=$("#list-filter"); if(nf && document.activeElement!==nf) nf.focus(); };
  lf.onkeydown=e=>{ if(e.key==="Escape" && lf.value){ e.stopPropagation(); listQuery=""; render(); const nf=$("#list-filter"); if(nf) nf.focus(); } };
}

/* render() перерисовывает вид целиком через innerHTML — это просто и надёжно, но вместе с
   разметкой стирается ЭФЕМЕРНОЕ состояние DOM: положение прокрутки и позиция каретки в поле
   фильтра. Раньше каждое действие в длинном списке (галочка, перенос на сегодня) отбрасывало
   человека в начало, а фильтр после каждой буквы ставил каретку в конец — править середину
   слова было невозможно. Снимаем это состояние ДО перерисовки и возвращаем после; при смене
   вкладки, наоборот, честно начинаем сверху. */
function _viewSnapshot(){
  const v=$("#view"); if(!v) return null;
  const ae=document.activeElement;
  const inField = ae && v.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
  const scroller = v.scrollTop ? v : (v.querySelector(".list, .tree, .cards") || v);
  return {
    top: scroller===v ? v.scrollTop : scroller.scrollTop,
    sameView: _prevView===view,
    focusId: inField ? (ae.id||null) : null,
    selStart: inField ? ae.selectionStart : null,
    selEnd: inField ? ae.selectionEnd : null
  };
}
function _viewRestore(sn){
  const v=$("#view"); if(!v) return;
  if(!sn || !sn.sameView){ v.scrollTop=0; return; }   // сменили вкладку — начинаем сверху, а не с середины прошлой
  if(sn.top){ const scroller=(v.scrollHeight>v.clientHeight) ? v : (v.querySelector(".list, .tree, .cards")||v); scroller.scrollTop=sn.top; }
  if(sn.focusId){
    const f=document.getElementById(sn.focusId);
    if(f && typeof f.setSelectionRange==="function"){
      f.focus();
      const n=f.value.length;
      try{ f.setSelectionRange(Math.min(sn.selStart,n), Math.min(sn.selEnd,n)); }catch(e){}
    }
  }
}
function render(){
  // сверяем со ВСЕМИ видами, а не с полосой: «Задачи» и «Календарь» из меню убраны,
  // но открываются палитрой и цифрами — сбрасывать их на «Заметки» нельзя
  if(!VIEWS_ALL.includes(view)) view="notes";
  const _sn=_viewSnapshot();
  renderNav();
  const v=$("#view");
  if(S.settings.view!==view){ S.settings.view=view; persist(); }   // не переписываем весь стейт при простой навигации
  v.classList.toggle("anim-in", _prevView!==view);
  if(_prevView!==view) listQuery="";                               // фильтр списка не «протекает» между вкладками
  _prevView=view;                                                  // плавный вход карточек только при смене вкладки
  // остановить анимацию графа, если уходим с вкладки «Заметки» (иначе rAF крутится на отсоединённых узлах)
  if(graph && view!=="notes"){ const g=graph; graph=null; g.destroy(); }
  /* Доску ноды НЕ трогаем: она живёт слоем поверх приложения и закрывается своей кнопкой.
     render() зовут и навигация, и откат, и сохранение области — снос отсюда закрывал бы
     открытое полотно на ровном месте (так же ведёт себя любой оверлей). */
  if(view==="today") renderToday(v);
  else if(view==="tasks") renderTasks(v);
  else if(view==="notes") renderNotes(v);
  else if(view==="board") renderFolders(v);
  else if(view==="cal") renderCal(v);
  renderAside();                       // правая часть живёт своей жизнью, но перерисовывается вместе
  _viewRestore(_sn);
}

function plural(n,one,few,many){ n=Math.abs(n)%100; const n1=n%10; if(n>10&&n<20) return many; if(n1>1&&n1<5) return few; if(n1===1) return one; return many; }
function ringSVG(pct){ const r=46, c=2*Math.PI*r, off=(c*(1-pct/100)).toFixed(1), glow=pct/100;
  return `<svg class="day-ring" viewBox="0 0 110 110"><circle class="ring-bg" cx="55" cy="55" r="${r}"></circle><circle class="ring-fg" cx="55" cy="55" r="${r}" style="stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${off};filter:drop-shadow(0 0 ${(2+glow*8).toFixed(1)}px var(--glow))"></circle></svg>`; }
function sparkSVG(wk){ const w=190,h=46,max=Math.max(1,...wk),pad=5;
  const X=i=>(i/(Math.max(1,wk.length-1))*(w-pad*2)+pad).toFixed(1), Y=v=>(h-pad-(v/max)*(h-pad*2)).toFixed(1);
  const pts=wk.map((v,i)=>`${X(i)},${Y(v)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon class="spark-area" points="${pad},${h} ${pts} ${w-pad},${h}"></polygon><polyline class="spark-line" points="${pts}"></polyline><circle class="spark-dot" cx="${X(wk.length-1)}" cy="${Y(wk[wk.length-1])}" r="3.2"></circle></svg>`; }
// домашняя «Пульс ритма»: кольцо дня + стрик/угольки + спарклайн недели + баланс областей + фокус (синтез агентов)
function renderToday(v){
  head("Сегодня", new Intl.DateTimeFormat("ru",{weekday:"long",day:"numeric",month:"long"}).format(new Date()),
    `<button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const T=today(), ymdT=ymd(T), isT=it=>!it.deleted&&it.kind==="task";
  const todayAll=S.items.filter(it=>isT(it)&&it.due&&ymd(parseYmd(it.due))===ymdT);
  const doneT=todayAll.filter(it=>it.done).length, dayTotal=todayAll.length, pct=dayTotal?Math.round(doneT/dayTotal*100):0;
  const over=S.items.filter(it=>isT(it)&&!it.done&&it.due&&parseYmd(it.due)<T).sort((a,b)=>(b.priority||0)-(a.priority||0));
  const inb=S.items.filter(it=>!it.deleted&&it.x==null).length;   // неразобранное = ещё не на холсте
  // ритм по дням выполнения (doneAt)
  const byDay={}; S.items.forEach(it=>{ if(isT(it)&&it.done&&it.doneAt){ const k=ymd(new Date(it.doneAt)); byDay[k]=(byDay[k]||0)+1; } });
  const has=k=>!!byDay[k];
  let streak=0; { let d=new Date(T); if(!has(ymd(d))) d=addDays(d,-1); while(has(ymd(d))){ streak++; d=addDays(d,-1); } }
  let record=0; { const ds=Object.keys(byDay).sort(); let run=0,prev=null; ds.forEach(k=>{ run=(prev&&daysBetween(parseYmd(k),parseYmd(prev))===1)?run+1:1; prev=k; if(run>record)record=run; }); }
  const embers=[]; for(let i=13;i>=0;i--){ const k=ymd(addDays(T,-i)); embers.push({k,n:byDay[k]||0,today:i===0}); }
  const maxE=Math.max(1,...embers.map(e=>e.n));
  const wk=[]; for(let i=6;i>=0;i--) wk.push(byDay[ymd(addDays(T,-i))]||0);
  const wkSum=wk.reduce((a,b)=>a+b,0);
  let prevSum=0; for(let i=13;i>=7;i--) prevSum+=byDay[ymd(addDays(T,-i))]||0;
  const trend=prevSum?Math.round((wkSum-prevSum)/prevSum*100):null, hasHist=Object.keys(byDay).length>0;
  const hr=new Date().getHours(), greet=hr<5?"Доброй ночи":hr<12?"Доброе утро":hr<18?"Добрый день":"Добрый вечер";
  const phrase = dayTotal===0?"На сегодня ничего не запланировано — чистый лист.":doneT===0?"С чего начнём?":doneT<dayTotal?`${doneT} позади, осталось ${dayTotal-doneT} — и день твой.`:"Сегодня всё сделано. Можно выдохнуть.";
  const areaBars=S.areas.map(a=>{ const tasks=S.items.filter(it=>isT(it)&&it.area===a.id); const open=tasks.filter(it=>!it.done).length; const p=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):0;
    return `<div class="area-bar${tasks.length&&p>=80?' lead':''}" data-area="${a.id}"><i class="ti ${a.icon}" ${a.color?`style="color:${a.color}"`:''}></i><span class="ab-name">${esc(a.name)}</span><span class="ab-track"><span class="ab-fill" style="width:${p}%${a.color?`;background:${a.color}`:''}"></span></span><span class="ab-meta">${open} · ${tasks.length?p+'%':'—'}</span></div>`; }).join("");
  const lag=S.areas.map(a=>{ const tasks=S.items.filter(it=>isT(it)&&it.area===a.id); const open=tasks.filter(it=>!it.done).length; const p=tasks.length?tasks.filter(it=>it.done).length/tasks.length:1; return {a,open,p}; }).filter(x=>x.open>0).sort((x,y)=>x.p-y.p).slice(0,2).map(x=>x.a.name);
  const focus=[...over.map(it=>({it,o:true})), ...todayAll.filter(it=>!it.done).map(it=>({it,o:false}))].sort((a,b)=>(b.it.priority||0)-(a.it.priority||0)).slice(0,6);
  const focusHtml=focus.length?focus.map(f=>taskCard(f.it,{today:f.o})).join(""):emptyBox("ti-checks","На сегодня дел нет. Выдохни ✨");
  v.innerHTML=`<div class="home">
    <div class="home-head"><div class="hh-greet">${greet}, КРОЛИК</div>${streak>0?`<div class="hh-streak"><i class="ti ti-flame"></i>${streak} ${plural(streak,"день","дня","дней")} подряд</div>`:""}</div>
    <div class="hh-phrase">${esc(phrase)}</div>
    <div class="home-grid g2">
      <div class="card home-card ring-card">${ringSVG(pct)}
        <div class="ring-side">
          <div class="ring-big">${pct}<span>%</span></div>
          <div class="ring-sub">${dayTotal?`${doneT} из ${dayTotal} на сегодня`:"на сегодня нет задач"}</div>
          <div class="ring-stat">${over.length?`<span class="rs-warn" data-goto="tasks"><i class="ti ti-alert-triangle"></i>${over.length} просрочено</span> · <span class="rs-link" data-overtoday="1" title="Перенести всю просрочку на сегодня"><i class="ti ti-target"></i>всё на сегодня</span>`:`<span class="rs-ok"><i class="ti ti-check"></i>без долгов</span>`}${inb?` · <span class="rs-link" data-goto="notes">${inb} не разобрано</span>`:""}</div>
        </div>
      </div>
      <div class="card home-card spark-card">
        <div class="hc-title">Эта неделя</div>${sparkSVG(wk)}
        <div class="spark-foot">${hasHist?`<b>${wkSum}</b> закрыто${trend!=null?` · <span class="${trend>=0?'tr-up':'tr-down'}">${trend>=0?'+':''}${trend}%</span> к прошлой`:''}`:"копим статистику…"}</div>
      </div>
    </div>
    <div class="card home-card embers-card">
      <div class="hc-title">Ритм · 14 дней</div>
      <div class="embers">${embers.map(e=>`<span class="ember${e.today?' today':''}${e.n?' lit':''}" style="--lit:${(e.n/maxE).toFixed(2)}" title="${e.k}: ${e.n}"></span>`).join("")}</div>
      <div class="embers-foot">${streak>0?`🔥 серия ${streak}${record>streak?` · рекорд ${record}`:''}`:hasHist?"серия прервалась — зажги новый уголёк":"закрой задачу — зажги первый уголёк"}</div>
    </div>
    <div class="home-grid g2">
      <div class="card home-card areas-card">
        <div class="hc-title">Области</div>
        ${S.areas.length?areaBars:emptyBox("ti-folder","Областей нет")}
        ${lag.length?`<div class="areas-insight"><i class="ti ti-bulb"></i>${esc(lag.join(" и "))} отста${lag.length>1?'ют':'ёт'} — загляни?</div>`:""}
      </div>
      <div class="card home-card focus-card">
        <div class="hc-title"><i class="ti ti-target"></i> Фокус дня</div>
        ${focusHtml}
      </div>
    </div>
    ${(over.length||inb)?`<button class="home-foot" data-goto="${over.length?'tasks':'notes'}"><i class="ti ti-moon"></i>${[over.length?`${over.length} просрочено`:'',inb?`${inb} не разобрано`:''].filter(Boolean).join(' · ')} — когда будут силы</button>`:""}
  </div>`;
}
function renderTasks(v){
  recomputeHierarchy();   // свежая иерархия из графа — подтягиваем её в задачи
  const f=areaFilter, T=today();
  const FILT={ all:()=>true, today:it=>it.due&&parseYmd(it.due)<=T, week:it=>it.due&&daysBetween(parseYmd(it.due),T)<=7, nodue:it=>!it.due };
  // Раньше тут отсекался status==="inbox" — вкладка Inbox прятала свои задачи от «Задач».
  // Теперь такого статуса нет: задача есть задача, даже если её ещё не поставили на холст.
  // Корни без области подхватит секция «Без области» ниже — ничего не теряется.
  const isTask=it=>!it.deleted&&it.kind==="task";
  const doneCount=S.items.filter(it=>isTask(it)&&it.done).length;
  const filt=FILT[taskFilter]||FILT.all;
  // видимые задачи: фильтр срока + (done только при showDone) + фильтр по тегу + текстовый фильтр
  const q=listQuery.trim().toLowerCase();
  const qhit=it=>!q || (it.title||"").toLowerCase().includes(q) || (it.body||"").toLowerCase().includes(q) || fieldsText(it).toLowerCase().includes(q);
  const visTasks=S.items.filter(it=>isTask(it) && (showDone||!it.done) && filt(it) && (!tagFilter||(it.tags||[]).includes(tagFilter)) && qhit(it));
  // дерево из паутины (заметки+задачи), parent из графа; оставляем только задачи + их предков-структуру
  const nodes=S.items.filter(inWeb);
  const ids=new Set(nodes.map(n=>n.id));
  const hasParent=it=> it.parent && ids.has(it.parent);
  const keep=new Set();
  visTasks.forEach(t=> noteParentChain(t.id).forEach(id=>keep.add(id)) );
  head(f?areaName(f):"Задачи", f?"Фильтр по области · нажми ещё раз чтобы снять":"Иерархия из заметок · клик — открыть, чекбокс — выполнить",
    `${doneCount?`<button class="btn ghost" data-toggle="done"><i class="ti ${showDone?"ti-eye-off":"ti-checks"}"></i>Выполнено ${doneCount}</button>`:""}
     <button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const ts=tagFilter?tagStyle(tagFilter):null;
  const chips=`<div class="tf-chips">`+
    (tagFilter?`<button class="tf-chip on tf-tag" data-cleartag="1" title="Снять фильтр по тегу" ${ts&&ts.color?`style="border-color:${ts.color};color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(tagFilter)}<i class="ti ti-x" style="font-size:13px;margin-left:2px;"></i></button>`:"")+
    [["all","Все"],["today","Сегодня"],["week","Неделя"],["nodue","Без срока"]]
      .map(([k,l])=>`<button class="tf-chip ${taskFilter===k?"on":""}" data-tf="${k}">${l}</button>`).join("")+
    `<span class="list-find"><i class="ti ti-search"></i><input id="list-filter" type="text" placeholder="Фильтр…" value="${esc(listQuery)}" spellcheck="false"></span>`+
  `</div>`;
  // в «Задачах» всегда сортировка по ДАТЕ: срок по возрастанию (просрочка/ближайшее сверху), без срока — в конец; затем приоритет, затем свежесть
  const byDue=(a,b)=>{ const ad=a.due?parseYmd(a.due):Infinity, bd=b.due?parseYmd(b.due):Infinity; return ad-bd || (b.priority||0)-(a.priority||0) || (b.updated||0)-(a.updated||0); };
  const kidsKept=id=>childrenOf(id).filter(k=>inWeb(k)&&keep.has(k.id)).sort(byDue);
  const seen=new Set();
  function branch(it, depth){
    if(seen.has(it.id)) return ""; seen.add(it.id);
    const kk=kidsKept(it.id);
    // заметки → компактный контекст-заголовок (true), задачи → полная карточка с чекбоксом
    let hh=noteCard(it, depth, kk.length>0, true);
    if(isCollapsed(it.id) || !kk.length) return hh;
    return hh+`<div class="tree-branch">`+kk.map(k=>branch(k,depth+1)).join("")+`</div>`;
  }
  const group=roots=>`<div class="notes-tree">`+roots.slice().sort(byDue).map(r=>branch(r,0)).join("")+`</div>`;
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
  if(!body) body=emptyBox("ti-checklist", q?"Ничего не нашлось по фильтру «"+esc(listQuery.trim())+"».":taskFilter==="all"?"Нет активных задач. Добавь первую — поле сверху или <b>N</b>":"По этому фильтру задач нет.");
  v.innerHTML=chips+body;
  wireListFilter(v);
  // обработчики дерева (как в списке заметок)
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс — делегат #view
    if(e.target.closest("[data-tag]")) return;       // клик по тегу — фильтр (делегат #view), не открываем карточку
    if(e.target.closest("[data-collapse]")) return;  // каретка
    if(e.target.closest("[data-openfolder]")) return; // кнопка папки — делегат #view
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(it) openItemSmart(it);
  });
}
/* ===========================================================
   ПАПКИ (вкладка «board»): дерево только тех нод, у кого есть папка
   на ПК, + их предки для контекста (keep-набор, как в «Задачах»).
   Нода-с-папкой → строка-цель с «открыть папку»; предок-без-папки →
   приглушённый контекст с бейджем «N папок внутри».
   =========================================================== */
function renderFolders(v){
  recomputeHierarchy();
  const f=areaFilter;
  const nodes=S.items.filter(inWeb);
  const ids=new Set(nodes.map(n=>n.id));
  const byId=id=>S.items.find(i=>i.id===id);
  const hasFld=it=>typeof it.folder==="string"&&!!it.folder;
  const isDone=it=>it.kind==="task" && it.done;
  // архивация решается ТОЛЬКО на уровне корня ветки (нода без родителя): архивен, если сам done.
  // У дочерней ноды свой собственный done НЕ имеет значения — она наследует статус родителя.
  // Так подзадача (VFX/Light) с папкой не улетает в «Завершённые» сама по себе — её папка ещё
  // может быть нужна, пока не закрыта родительская задача-проект (Breach); когда та закрывается,
  // архивируется вся ветка разом, вне зависимости от того, когда были закрыты подзадачи.
  const archMemo=new Map();
  const isArchived=it=>{
    if(archMemo.has(it.id)) return archMemo.get(it.id);
    archMemo.set(it.id,false);   // защита от циклов на случай кривых данных
    const pid=(it.parent&&ids.has(it.parent))?it.parent:null;
    const res = pid ? isArchived(byId(pid)) : isDone(it);
    archMemo.set(it.id,res); return res;
  };
  // делим ноды-с-папкой + их предков-по-пути на «активные»/«архив» — каждая нода своим статусом.
  const keepActive=new Set(), keepDone=new Set();
  nodes.filter(hasFld).forEach(fn=>{
    let cur=fn, g=new Set();
    while(cur && !g.has(cur.id)){ g.add(cur.id); (isArchived(cur)?keepDone:keepActive).add(cur.id);
      const pid=(cur.parent&&ids.has(cur.parent))?cur.parent:null; cur=pid?byId(pid):null; }
  });
  // активные сверху по ДЕДЛАЙНУ (срок ↑, без срока — по алфавиту)
  const byDeadline=(a,b)=>{ const ad=a.due?parseYmd(a.due):Infinity, bd=b.due?parseYmd(b.due):Infinity; return ad-bd || (a.title||"").localeCompare(b.title||"","ru"); };
  const basename=p=>{ const s=String(p).replace(/[\\/]+$/,""); const parts=s.split(/[\\/]/); return parts[parts.length-1]||s; };
  const fldRow=(it,card)=>`<div class="fld-row has-folder${it.done?" done":""}">${card}<span class="nc-path" title="${esc(it.folder)}"><i class="ti ti-folder"></i>${esc(basename(it.folder))}</span><div class="nc-foot-acts"><button class="nc-folder dim" data-opennode="${it.id}" title="Открыть ноду"><i class="ti ti-note"></i></button><button class="nc-folder dim" data-foldpick="${it.id}" title="Сменить папку"><i class="ti ti-folder-cog"></i></button></div></div>`;
  const foldersUnder=(id,keep)=>{ let n=0; childrenOf(id).filter(k=>inWeb(k)&&keep.has(k.id)).forEach(k=>{ if(hasFld(k))n++; n+=foldersUnder(k.id,keep); }); return n; };
  head("Папки", f?areaName(f)+" · папки на ПК":"Папки проектов и ассетов · клик по строке — открыть папку · кнопки — открыть ноду / сменить", "");
  function branch(it,keep,seen){
    if(seen.has(it.id)) return ""; seen.add(it.id);
    const kk=childrenOf(it.id).filter(k=>inWeb(k)&&keep.has(k.id)).sort(byDeadline);
    const card=folderRowCard(it, kk.length>0);
    const h = hasFld(it)
      ? fldRow(it, card)
      : `<div class="fld-row ctx-only">${card}${foldersUnder(it.id,keep)?`<span class="fld-cnt"><i class="ti ti-folder"></i>${foldersUnder(it.id,keep)}</span>`:""}</div>`;
    if(isCollapsed(it.id)||!kk.length) return h;
    return h+`<div class="tree-branch">`+kk.map(k=>branch(k,keep,seen)).join("")+`</div>`;
  }
  const sec=(key,icon,name,count,colorStyle)=>{ const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`; };
  const group=(roots,keep)=>{ const seen=new Set(); return `<div class="notes-tree">`+roots.slice().sort(byDeadline).map(r=>branch(r,keep,seen)).join("")+`</div>`; };
  // корни keep-набора = ноды без родителя в том же наборе
  const rootsOf=keep=>nodes.filter(it=>keep.has(it.id) && !(it.parent&&keep.has(it.parent)));
  let body="";
  const activeRoots=rootsOf(keepActive);
  S.areas.forEach(a=>{ if(f&&a.id!==f) return;
    const roots=activeRoots.filter(it=>(it.area||null)===a.id);
    if(!roots.length) return;
    body+=sec("area:"+a.id, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed("area:"+a.id)) body+=group(roots,keepActive);
  });
  if(!f){ const noArea=activeRoots.filter(it=>!it.area);
    if(noArea.length){ body+=sec("area:__none","ti-circle-dashed","Без области",noArea.length,""); if(!isCollapsed("area:__none")) body+=group(noArea,keepActive); } }
  // ЗАВЕРШЁННЫЕ: завершённый проект уезжает сюда ЦЕЛИКОМ со своим поддеревом
  // (активные ассеты вложены под ним), чтобы не мозолить глаз в активном дереве.
  const doneRoots=rootsOf(keepDone).filter(it=>!f||(it.area||null)===f).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  if(doneRoots.length){ const key="fld:done", c=isCollapsed(key);
    body+=`<div class="sec sec-collapse fld-done-sec" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ti-checks"></i>Завершённые<span class="sec-cnt">${doneRoots.length}</span></div>`;
    if(!c) body+=group(doneRoots,keepDone);
  }
  const anyFolder=nodes.some(it=>hasFld(it));
  if(!anyFolder) body=emptyBox("ti-folders","Здесь появятся ноды с привязанной папкой на ПК. Открой ноту/задачу (или ноду в графе) и нажми «Привязать папку» — потом откроешь папку проекта в проводнике одним кликом отсюда.<br>Напр.: «МТС Арена» → папка проекта; «Ассеты» → подноты, у каждой своя.");
  else if(!body) body=emptyBox("ti-folder-off","В этой области нет нод с папкой — сними фильтр области.");
  v.innerHTML=body;
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=e=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$("[data-opennode]",v).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const it=S.items.find(i=>i.id===b.dataset.opennode); if(it) openItemSmart(it); });
  $$("[data-foldpick]",v).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const it=S.items.find(i=>i.id===b.dataset.foldpick); if(it) pickItemFolder(it,()=>render()); });
  $$(".note-card",v).forEach(card=>card.onclick=e=>{
    if(e.target.closest("[data-collapse]")||e.target.closest("[data-opennode]")||e.target.closest("[data-foldpick]")||e.target.closest("[data-tag]")) return;
    const id=card.dataset.nid||card.dataset.tid; const it=S.items.find(i=>i.id===id); if(!it) return;
    if(it.folder) openItemFolder(it); else openItemSmart(it);   // клик по строке-с-папкой = открыть папку; контекст-предок = открыть ноду
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
  // призраки повторов: активная повторяющаяся задача проецируется на будущие даты видимого месяца
  const mStart=startOfDay(first), mEnd=startOfDay(new Date(y,m+1,0));
  const ghosts={};
  S.items.forEach(it=>{
    if(it.deleted||it.kind!=="task"||it.done||!it.due||!it.repeat||it.repeat==="none") return;
    let d=nextRepeat(it.due,it.repeat), i=0;
    while(d && i++<370 && parseYmd(d)<=mEnd){ if(parseYmd(d)>=mStart) (ghosts[d]||(ghosts[d]=[])).push(it); d=nextRepeat(d,it.repeat); }
  });
  let cells=["пн","вт","ср","чт","пт","сб","вс"].map(d=>`<div class="cal-wd">${d}</div>`).join("");
  for(let i=0;i<start;i++) cells+=`<div class="cd dim"></div>`;
  const todayStr=ymd(today());
  for(let d=1;d<=days;d++){
    const ds=ymd(new Date(y,m,d));
    const ev=S.items.filter(it=>!it.deleted&&it.due===ds && it.kind==="task");
    cells+=`<div class="cd ${ds===todayStr?"tod":""}" data-day="${ds}" title="Добавить задачу на этот день">`+`<div class="cd-n">${d}</div>`+
      ev.map(it=>{ const over=parseYmd(ds)<today()&&!it.done; return `<div class="ev ${it.done?"done":""} ${over?"over":""}" draggable="true" data-ev="${it.id}" data-edit="${it.id}" title="${esc(it.title)} · тащи на другой день">${esc(it.title)}</div>`; }).join("")+
      (ghosts[ds]?ghosts[ds].map(it=>`<div class="ev ghost" data-edit="${it.id}" title="Повтор: ${esc(it.title)} (${REPEAT[it.repeat]})"><i class="ti ti-repeat"></i>${esc(it.title)}</div>`).join(""):"")+`</div>`;
  }
  v.innerHTML=`<div class="cal">${cells}</div>`;
  // drag-and-drop: перетащить задачу на другой день = перенести срок
  $$(".ev[data-ev]",v).forEach(el=>{ el.ondragstart=e=>{ e.dataTransfer.setData("text/plain", el.dataset.ev); e.dataTransfer.effectAllowed="move"; }; });
  $$(".cd[data-day]",v).forEach(cell=>{
    cell.ondragover=e=>{ e.preventDefault(); cell.classList.add("drop"); };
    cell.ondragleave=()=>cell.classList.remove("drop");
    cell.ondrop=e=>{ e.preventDefault(); cell.classList.remove("drop");
      const it=S.items.find(i=>i.id===e.dataTransfer.getData("text/plain")); if(!it||it.due===cell.dataset.day) return;
      it.due=cell.dataset.day; touch(it); persist(); render();
      toast("Перенесено: "+((dueLabel(it.due)||{}).txt||it.due),{icon:"ti-calendar-event"});
    };
  });
}

