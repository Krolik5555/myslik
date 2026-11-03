/* ===========================================================
   ТАБЛИЦА — рабочий взгляд на граф рядом с «Графом» (аудит 2.1, Р2).
   Заменила «Список» в переключателе вида. Задача у неё одна: на БОЛЬШОМ графе (сотни нод)
   вычленить то, над чем идёт работа, и показать, что важнее. Отсюда:
   • подборки — «В работе», «Срочное», «Все задачи», «Заметки», «Дети узла» (пайплайн шотов
     с колонками подзадач);
   • важность — та же urgency(), что подсвечивает «что горит» на графе: граф и таблица обязаны
     говорить одно и то же, второй формулы важности здесь нет намеренно;
   • путь у каждой строки (SQ02 › SH030) — на большом графе одинаковые «Рендер» иначе не
     различить;
   • строка целиком кликабельна, двойной клик и Enter — показать на графе.
   Своих данных нет: статус пишется tableSetStatus тем же путём, что правой панелью.
   =========================================================== */

let tableRoot = null;             // для «Дети узла»: id узла, "area:<id>" или null — выбрать самому
let tablePreset = "work";         // work | hot | tasks | notes | kids
let tableQuery = "";              // поиск по названию, тегу и пути
let tableArea = "";               // "" — все области
let tableShowDone = false;
let tableSort = {k:"imp", dir:-1};
let tableLimit = 150;             // порция строк: на тысяче нод вся таблица разом — лишние мс на клик

const TABLE_PRESETS = [
  {k:"work",  n:"В работе",   i:"ti-player-play",  t:"В работе, на очереди, на проверке, ждут — и всё, у чего срок сегодня или прошёл"},
  {k:"hot",   n:"Срочное",    i:"ti-flame",        t:"То же, что «Что горит» на графе: срок, приоритет, застой, незакрытые подзадачи"},
  {k:"tasks", n:"Все задачи", i:"ti-checklist",    t:"Все задачи графа"},
  {k:"notes", n:"Заметки",    i:"ti-note",         t:"Заметки и полотна"},
  {k:"kids",  n:"Дети узла",  i:"ti-hierarchy-2",  t:"Дети выбранного узла строками, их подзадачи — колонками (пайплайн шотов)"},
];
// цвет статуса — из переменных темы, что и граф с панелью: светлая тема подхватится сама
const TABLE_ST_COLOR = {todo:"var(--st-mark)", next:"var(--st-next)", doing:"var(--pri2)", waiting:"var(--st-wait)",
                        review:"var(--st-review)", paused:"var(--mut2)", done:"var(--pri1)", note:"var(--mut)"};
// порядок статусов при равной важности: то, что движется, — выше
const TABLE_ST_ORDER = {doing:0, review:1, waiting:2, next:3, todo:4, paused:5, note:6, done:7};
const TABLE_WORK = new Set(["doing", "next", "review", "waiting"]);

const tableHasKids = it => childrenOfLive(it.id).length > 0;

function tableStatusOf(it){
  if(kindIsTask(it.kind) && it.done) return "done";
  return СТАТУСЫ[it.status] ? it.status : нейтральныйСтатус(it.kind);
}

/* Всё, что считается по графу целиком, — ОДНИМ проходом: детей у каждой ноды и путь к корню.
   urgency() просит число незакрытых детей снаружи именно затем, чтобы не ходить по S.items на
   каждую ноду (O(n²) на тысяче нод — миллион проходов). */
function tableIndex(){
  const поId = new Map(), детиЗадачи = {}, дети = {};
  S.items.forEach(it => { if(inWeb(it)) поId.set(it.id, it); });
  S.items.forEach(it => {
    if(!inWeb(it) || !it.parent) return;
    (дети[it.parent] = дети[it.parent] || []).push(it);
    if(kindIsTask(it.kind) && !it.done) детиЗадачи[it.parent] = (детиЗадачи[it.parent] || 0) + 1;
  });
  const путь = it => { const o = []; let p = it.parent && поId.get(it.parent), n = 0;
    while(p && n++ < 12){ o.unshift(p.title || "…"); p = p.parent && поId.get(p.parent); } return o; };
  return {поId, дети, детиЗадачи, путь};
}

function tableAutoRoot(){
  const it = asideId && S.items.find(x => x.id === asideId);
  if(it){
    if(tableHasKids(it)) return it.id;
    if(it.parent && S.items.some(x => x.id === it.parent)) return it.parent;
  }
  let лучшая = null, n = 0;
  (S.areas || []).forEach(a => {
    const k = S.items.filter(x => inWeb(x) && x.area === a.id && !x.parent).length;
    if(k > n){ n = k; лучшая = a.id; }
  });
  return лучшая ? "area:" + лучшая : null;
}
function tableRootName(root){
  if(!root) return "Весь граф";
  if(root.startsWith("area:")){ const a = areaById(root.slice(5)); return a ? a.name : "Область"; }
  const it = S.items.find(x => x.id === root); return it ? (it.title || "без названия") : "—";
}

function tableDue(it){
  if(!it.due || (kindIsTask(it.kind) && it.done)) return {t:"—", cls:"mut", n:null};
  const d = parseYmd(it.due); if(!d) return {t:"—", cls:"mut", n:null};
  const n = Math.round((d - today()) / 864e5);
  const дата = d.getDate() + "." + String(d.getMonth() + 1).padStart(2, "0");
  if(n < 0) return {t:"−" + (-n) + " дн.", cls:"over", n};      // коротко и красным: «просрочено N дн.» распирал колонку
  if(n === 0) return {t:"сегодня", cls:"soon", n};
  if(n === 1) return {t:"завтра", cls:"soon", n};
  const дн = ["вс","пн","вт","ср","чт","пт","сб"];
  return {t:n < 7 ? дн[d.getDay()] + ", " + дата : дата, cls:"", n};
}

// строки выбранной подборки — до фильтров поиска и области
function tablePick(ix, root){
  const все = S.items.filter(inWeb);
  if(tablePreset === "kids"){
    if(!root) return все.filter(x => !x.parent);
    if(root.startsWith("area:")){ const a = root.slice(5); return все.filter(x => x.area === a && !x.parent); }
    return ix.дети[root] || [];
  }
  if(tablePreset === "notes") return все.filter(x => !kindIsTask(x.kind));
  const задачи = все.filter(x => kindIsTask(x.kind));
  if(tablePreset === "tasks") return tableShowDone ? задачи : задачи.filter(x => tableStatusOf(x) !== "done");
  if(tablePreset === "hot") return задачи.filter(x => urgency(x, ix.детиЗадачи[x.id] || 0) >= СРОЧНОСТЬ_ПОРОГ);
  // «В работе»: рабочие статусы плюс то, что по сроку должно быть сделано уже сегодня
  return задачи.filter(x => { const s = tableStatusOf(x); if(s === "done" || s === "paused") return false;
    if(TABLE_WORK.has(s)) return true; const d = tableDue(x); return d.n !== null && d.n <= 0; });
}

function tablePill(it){
  const k = tableStatusOf(it), s = СТАТУСЫ[k] || СТАТУСЫ.todo;
  return `<button class="tb-pill" data-tbst="${esc(it.id)}" style="--sc:${TABLE_ST_COLOR[k] || "var(--mut)"}" title="Сменить статус">`+
    `<i class="ti ${s.иконка}"></i>${esc(s.имя)}</button>`;
}

/* Статус пишем ТЕМ ЖЕ путём, что правая панель (views.js, поле status): «Готово» — через
   toggleDone, иначе потеряется дата выполнения и следующий повтор. persist() кладёт шаг отката. */
function tableSetStatus(it, v){
  if(!it) return;
  if(v === "done" && !it.done) toggleDone(it);
  else if(v !== "done" && it.done){ it.done = false; it.status = v; it.doneAt = null; }
  else it.status = v;
  touch(it); persist(); render();
}

function tableSortRows(строки, ix){
  const {k, dir} = tableSort;
  const imp = new Map(строки.map(r => [r.id, kindIsTask(r.kind) ? urgency(r, ix.детиЗадачи[r.id] || 0) : -1]));
  const ст = r => TABLE_ST_ORDER[tableStatusOf(r)] ?? 9;
  const срок = r => { const d = tableDue(r); return d.n === null ? 1e9 : d.n; };
  const имя = r => (r.title || "");
  const по = {
    imp:  (a, b) => (imp.get(a.id) - imp.get(b.id)) || (ст(b) - ст(a)) || (срок(b) - срок(a)),
    name: (a, b) => имя(a).localeCompare(имя(b), "ru", {numeric:true}),
    st:   (a, b) => ст(a) - ст(b),
    due:  (a, b) => срок(a) - срок(b),
    pri:  (a, b) => (a.priority || 0) - (b.priority || 0),
    area: (a, b) => (areaName(a.area) || "").localeCompare(areaName(b.area) || "", "ru"),
  }[k] || (() => 0);
  return строки.slice().sort((a, b) => dir * по(a, b) || имя(a).localeCompare(имя(b), "ru", {numeric:true}));
}

function renderNotesTable(v){
  if(tableRoot && !tableRoot.startsWith("area:") && !S.items.some(x => x.id === tableRoot && inWeb(x))) tableRoot = null;
  const ix = tableIndex();
  const root = tablePreset === "kids" ? (tableRoot || tableAutoRoot()) : null;
  const q = tableQuery.trim().toLowerCase();
  let строки = tablePick(ix, root).filter(r => {
    if(tableArea && r.area !== tableArea) return false;
    if(!q) return true;
    return ((r.title || "") + " " + (r.tags || []).join(" ") + " " + ix.путь(r).join(" ")).toLowerCase().indexOf(q) >= 0;
  });
  // «Дети узла» читаются как пайплайн — по номерам (SH010, SH020…), остальные — по важности
  строки = (tablePreset === "kids" && tableSort.k === "imp") ? tableSortRows(строки, ix).sort((a, b) =>
    (a.title || "").localeCompare(b.title || "", "ru", {numeric:true})) : tableSortRows(строки, ix);
  const всего = строки.length, показ = строки.slice(0, tableLimit);

  // колонки подзадач — только в «Детях узла»: в остальных подборках строки из разных веток
  let колонки = [];
  if(tablePreset === "kids"){
    const частота = new Map();
    строки.forEach(r => (ix.дети[r.id] || []).forEach(k => { const t = (k.title || "").trim(); if(t) частота.set(t, (частота.get(t) || 0) + 1); }));
    колонки = [...частота.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru")).slice(0, 8).map(x => x[0]);
  }

  const вкладки = TABLE_PRESETS.map(p => `<button class="${tablePreset === p.k ? "on" : ""}" data-tbpreset="${p.k}" title="${esc(p.t)}"><i class="ti ${p.i}"></i>${p.n}</button>`).join("");
  const областиОпц = `<option value="">Все области</option>` + (S.areas || []).map(a => `<option value="${esc(a.id)}" ${tableArea === a.id ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  let корень = "";
  if(tablePreset === "kids"){
    const узлы = S.items.filter(x => inWeb(x) && (ix.дети[x.id] || []).length)
      .sort((a, b) => (a.title || "").localeCompare(b.title || "", "ru", {numeric:true}));
    корень = `<label class="tb-root"><span>Строки — дети</span><select id="tb-root"><option value="">Весь граф (корни)</option>`+
      (S.areas || []).map(a => `<option value="area:${esc(a.id)}" ${root === "area:" + a.id ? "selected" : ""}>Область · ${esc(a.name)}</option>`).join("")+
      узлы.map(x => `<option value="${esc(x.id)}" ${root === x.id ? "selected" : ""}>${esc(x.title || "без названия")} · ${(ix.дети[x.id] || []).length}</option>`).join("")+
      `</select></label>`;
  }
  const head = `<div class="tb-head">
      <div class="tb-tabs">${вкладки}</div>
      <div class="tb-tools">
        <label class="tb-search"><i class="ti ti-search"></i><input id="tb-q" placeholder="Название, тег или путь" value="${esc(tableQuery)}"></label>
        <select id="tb-area" title="Область">${областиОпц}</select>
        ${tablePreset === "tasks" ? `<label class="tb-chk"><input type="checkbox" id="tb-done" ${tableShowDone ? "checked" : ""}>готовые</label>` : ""}
        ${корень}
        <span class="tb-count">${tablePreset === "kids" ? esc(tableRootName(root)) + " · " : ""}${всего} ${всего === 1 ? "строка" : (всего % 10 >= 2 && всего % 10 <= 4 && (всего % 100 < 10 || всего % 100 >= 20)) ? "строки" : "строк"}</span>
      </div>
    </div>`;
  if(!всего){
    const пусто = q || tableArea ? "По фильтру ничего не нашлось — сними поиск или область."
      : tablePreset === "work" ? "Сейчас ничего не в работе и ничего не горит по сроку. Поставь статус «В работе» тому, чем занимаешься, — оно окажется здесь."
      : tablePreset === "hot" ? "Ничего не горит: ни сроков, ни высоких приоритетов, ни застрявших задач."
      : tablePreset === "kids" ? "Здесь пусто. Выбери узел, у которого есть дочерние ноды, — например секвенцию с шотами."
      : "Здесь пусто.";
    v.innerHTML = head + `<div class="tb-empty"><i class="ti ti-table-off"></i>${пусто}</div>`;
    tableWire(v); return;
  }
  /* Пустые колонки не показываем: «Подзадачи», где их нет ни у одной строки, и «Область», когда
     область и так выбрана фильтром, — иначе в узком окне таблица уезжала вбок и прятала справа
     кнопки «на графе». */
  const колПодзадачи = tablePreset === "kids" || показ.some(r => (ix.дети[r.id] || []).some(k => kindIsTask(k.kind)));
  const колОбласть = tablePreset !== "kids" && !tableArea;
  const сорт = (k, n) => `<th class="tb-sort ${tableSort.k === k ? "on" : ""}" data-tbsort="${k}">${n}${tableSort.k === k ? (tableSort.dir < 0 ? ' <i class="ti ti-arrow-down"></i>' : ' <i class="ti ti-arrow-up"></i>') : ""}</th>`;
  const тело = показ.map(r => {
    const дети = ix.дети[r.id] || [], задачи = дети.filter(k => kindIsTask(k.kind));
    // готовность — по тому же правилу, что пилюля: у части данных «Готово» лежит только в status
    const сд = задачи.filter(k => tableStatusOf(k) === "done").length, срок = tableDue(r);
    const u = kindIsTask(r.kind) ? urgency(r, ix.детиЗадачи[r.id] || 0) : null;
    const ур = u === null ? 0 : u >= 0.45 ? 3 : u >= 0.30 ? 2 : u >= СРОЧНОСТЬ_ПОРОГ ? 1 : 0;
    const путь = ix.путь(r), обл = r.area ? areaById(r.area) : null;
    const яч = колонки.map(t => { const k = дети.find(x => (x.title || "").trim() === t); return `<td>${k ? tablePill(k) : '<span class="tb-none">—</span>'}</td>`; }).join("");
    return `<tr class="${r.id === asideId ? "sel" : ""}" data-tbrow="${esc(r.id)}">
      <td class="tb-imp" title="${u === null ? "у заметки нет срочности" : "Срочность " + Math.round(u * 100) + "%"}">${u === null ? '<span class="tb-none">—</span>' : `<span class="tb-u l${ур}"><i style="width:${Math.max(4, Math.round(u * 100))}%"></i></span>`}</td>
      <td class="tb-name"><span class="tb-nm"><i class="ti ${kindIcon(r.kind)}"></i><b>${esc(r.title || "без названия")}</b></span>${путь.length ? `<span class="tb-path">${esc(путь.slice(-3).join(" › "))}</span>` : ""}</td>
      <td>${tablePill(r)}</td>${яч}
      <td class="tb-due ${срок.cls}">${esc(срок.t)}</td>
      <td>${r.priority ? `<span class="tb-pri p${r.priority}" title="${["", "низкий", "средний", "высокий"][r.priority]}"><i class="ti ti-flag-3"></i></span>` : '<span class="tb-none">—</span>'}</td>
      ${колОбласть ? `<td class="tb-area">${обл ? `<i class="ti ${esc(обл.icon)}" style="color:${esc(обл.color || "var(--mut)")}"></i>${esc(обл.name)}` : '<span class="tb-none">—</span>'}</td>` : ""}
      ${колПодзадачи ? `<td class="tb-prog">${задачи.length ? `<span class="tb-bar"><i style="width:${Math.round(сд / задачи.length * 100)}%"></i></span>${сд}/${задачи.length}` : '<span class="tb-none">—</span>'}</td>` : ""}
      <td class="tb-act">${дети.length ? `<button data-tbroot="${esc(r.id)}" title="Показать детей строками"><i class="ti ti-hierarchy-2"></i></button>` : ""}<button data-tbgraph="${esc(r.id)}" title="Показать на графе (двойной клик, Enter)"><i class="ti ti-affiliate"></i></button></td>
    </tr>`;
  }).join("");
  const ещё = всего > показ.length ? `<button class="tb-more" data-tbmore="1">Показать ещё ${Math.min(150, всего - показ.length)} · всего ${всего}</button>` : "";
  v.innerHTML = head + `<div class="tb-wrap"><table class="tb"><thead><tr>${сорт("imp", "Важность")}${сорт("name", "Название")}${сорт("st", "Статус")}`+
    колонки.map(t => `<th>${esc(t)}</th>`).join("") + `${сорт("due", "Срок")}${сорт("pri", "Приор.")}${колОбласть ? сорт("area", "Область") : ""}${колПодзадачи ? "<th>Подзадачи</th>" : ""}<th></th></tr></thead><tbody>${тело}</tbody></table>${ещё}</div>`;
  tableWire(v);
}

/* Выбор строки — БЕЗ перерисовки таблицы: на сотнях строк полный render() на каждый клик дал
   бы рывок, а меняется только подсветка и правая панель. */
function tableSelect(id, v){
  if(!id) return;
  asideSelect(id);
  (v || $("#view")).querySelectorAll(".tb tr.sel").forEach(tr => tr.classList.remove("sel"));
  const tr = (v || $("#view")).querySelector(`.tb tr[data-tbrow="${CSS.escape(id)}"]`);
  if(tr){ tr.classList.add("sel"); tr.scrollIntoView({block:"nearest"}); }
}
// показать ноду на графе: переключиться, выделить и долететь камерой
function tableShowOnGraph(id){
  notesMode = "graph"; render();
  setTimeout(() => {
    if(typeof graph === "undefined" || !graph) return;
    if(graph.byId && graph.byId[id]){ graph.selNodes = new Set([id]); graph._paintSel(); graph.focusNode(id); }
    asideSelect(id);
  }, 60);
}

function tableWire(v){
  if(typeof wireNotesToggle === "function") wireNotesToggle();   // «Граф / Таблица»: без этого с таблицы было не уйти
  const q = v.querySelector("#tb-q");
  if(q){ q.oninput = () => { tableQuery = q.value; tableLimit = 150; const pos = q.selectionStart; render();
    const q2 = $("#tb-q"); if(q2){ q2.focus(); try{ q2.setSelectionRange(pos, pos); }catch(e){} } }; }
  const ar = v.querySelector("#tb-area"); if(ar) ar.onchange = () => { tableArea = ar.value; tableLimit = 150; render(); };
  const dn = v.querySelector("#tb-done"); if(dn) dn.onchange = () => { tableShowDone = dn.checked; render(); };
  const sel = v.querySelector("#tb-root"); if(sel) sel.onchange = () => { tableRoot = sel.value || null; render(); };
  v.onclick = e => {
    const pr = e.target.closest("[data-tbpreset]");
    if(pr){ tablePreset = pr.dataset.tbpreset; tableLimit = 150; if(tablePreset === "kids") tableSort = {k:"imp", dir:-1}; render(); return; }
    const so = e.target.closest("[data-tbsort]");
    if(so){ const k = so.dataset.tbsort; tableSort = tableSort.k === k ? {k, dir:-tableSort.dir} : {k, dir:(k === "imp" || k === "pri") ? -1 : 1}; render(); return; }
    if(e.target.closest("[data-tbmore]")){ tableLimit += 150; render(); return; }
    const st = e.target.closest("[data-tbst]"); if(st){ tableStatusMenu(st); return; }
    const gr = e.target.closest("[data-tbgraph]"); if(gr){ tableShowOnGraph(gr.dataset.tbgraph); return; }
    const rt = e.target.closest("[data-tbroot]"); if(rt){ tablePreset = "kids"; tableRoot = rt.dataset.tbroot; tableSort = {k:"imp", dir:-1}; render(); return; }
    const row = e.target.closest("[data-tbrow]"); if(row) tableSelect(row.dataset.tbrow, v);   // вся строка — выбор
  };
  v.ondblclick = e => {
    if(e.target.closest("button,input,select")) return;
    const row = e.target.closest("[data-tbrow]"); if(row) tableShowOnGraph(row.dataset.tbrow);
  };
  v.onkeydown = null;
}

/* ↑/↓ — по строкам, Enter — на граф. Слушатель один на документ и сам проверяет, что открыта
   таблица и фокус не в поле ввода: вешать на #view нельзя — div фокус не держит. */
let _tableKeysWired = false;
function tableWireKeys(){
  if(_tableKeysWired) return; _tableKeysWired = true;
  document.addEventListener("keydown", e => {
    if(view !== "notes" || notesMode !== "table") return;
    if(e.target.closest && e.target.closest("input,textarea,select,[contenteditable=true]")) return;
    if(document.querySelector(".tb-menu,.modal,.cv-menu")) return;
    const строки = [...document.querySelectorAll(".tb tbody tr[data-tbrow]")]; if(!строки.length) return;
    const i = строки.findIndex(tr => tr.classList.contains("sel"));
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      const j = i < 0 ? 0 : Math.max(0, Math.min(строки.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      tableSelect(строки[j].dataset.tbrow);
    } else if(e.key === "Enter" && i >= 0){ e.preventDefault(); tableShowOnGraph(строки[i].dataset.tbrow); }
  });
}
tableWireKeys();

function tableMenuClose(){ document.querySelectorAll(".tb-menu").forEach(m => m.remove()); }
function tableStatusMenu(btn){
  tableMenuClose();
  const it = S.items.find(x => x.id === btn.dataset.tbst); if(!it) return;
  const сейчас = tableStatusOf(it);
  const m = document.createElement("div"); m.className = "tb-menu";
  m.innerHTML = статусыДляВида(it.kind).map(k => `<button data-v="${k}" class="${k === сейчас ? "on" : ""}" style="--sc:${TABLE_ST_COLOR[k] || "var(--mut)"}">`+
    `${statusMat(k)}${esc(СТАТУСЫ[k].имя)}${k === сейчас ? '<i class="ti ti-check tb-ok"></i>' : ""}</button>`).join("");
  document.body.appendChild(m);
  const r = btn.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - m.offsetWidth - 8) + "px";
  m.style.top = (r.bottom + 6 + m.offsetHeight > innerHeight ? r.top - m.offsetHeight - 6 : r.bottom + 6) + "px";
  m.onclick = e => { const b = e.target.closest("[data-v]"); if(!b) return; tableMenuClose(); tableSetStatus(it, b.dataset.v); };
  setTimeout(() => document.addEventListener("mousedown", function закрыть(e){ if(!m.contains(e.target)){ tableMenuClose(); document.removeEventListener("mousedown", закрыть, true); } }, true), 0);
}
