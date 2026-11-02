// ТАБЛИЦА (ui/js/table.js): строки — дети выбранного узла, колонки — подзадачи.
// Проверяем то, ради чего она заведена: пайплайн шотов читается без обхода графа глазами,
// статус меняется тем же путём, что в панели, и снимается одним откатом.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const ошибки = [];
const прежний = console.error;
console.error = (...a) => { ошибки.push(a.join(" ")); прежний(...a); };

view = "notes"; notesMode = "graph"; render(); await ж(140);
t.push({имя:"в переключателе вида есть «Таблица», «Списка» нет",
        ок: !!document.querySelector('#notes-toggle [data-nm="table"]') && !document.querySelector('#notes-toggle [data-nm="list"]'), факт: ""});

// секвенция из трёх шотов, у каждого «Рендер» и «Сборка»
// корню нужна область: дерево основного графа считается от областей, без неё parent у всех пустой
const ops = [{op:"node", as:"sq", kind:"task", title:"ТАБ-SQ", area:(S.areas[0] || {}).id}];
["ТАБ-SH010", "ТАБ-SH020", "ТАБ-SH030"].forEach((s, i) => {
  ops.push({op:"node", as:"s" + i, kind:"task", title:s, status: i === 1 ? "doing" : "todo"});
  ops.push({op:"link", from:"sq", to:"s" + i});
  ["Рендер", "Сборка"].forEach((п, j) => {
    ops.push({op:"node", as:"s" + i + "_" + j, kind:"task", title:п, status: (i === 0 || (i === 1 && j === 0)) ? "done" : "todo"});
    ops.push({op:"link", from:"s" + i, to:"s" + i + "_" + j});
  });
});
const р = cmdParse(JSON.stringify({ops}));
const итог = р.errors.length ? null : cmdApply(р.ops);
await ж(120);
t.push({имя:"пакет шотов разобрался и применился", ок: !!итог, факт: р.errors.join(" | ")});

if(итог){
  tablePreset = "kids"; tableRoot = итог.alias.sq; tableQuery = ""; tableArea = ""; notesMode = "table"; render(); await ж(160);
  const шапка = [...document.querySelectorAll(".tb th")].map(x => x.textContent);
  const строки = [...document.querySelectorAll(".tb tbody tr")];
  t.push({имя:"строки — дети выбранного узла, по номерам", ок: строки.length === 3 &&
          строки[0].textContent.indexOf("ТАБ-SH010") >= 0 && строки[2].textContent.indexOf("ТАБ-SH030") >= 0, факт: строки.length + " строк"});
  t.push({имя:"подзадачи стали колонками", ок: шапка.indexOf("Рендер") > 0 && шапка.indexOf("Сборка") > 0, факт: шапка.join(", ")});
  const прог = [...document.querySelectorAll(".tb-prog")].map(x => x.textContent.trim());
  t.push({имя:"прогресс подзадач считается по статусу «Готово»", ок: прог.join(",") === "2/2,1/2,0/2", факт: прог.join(",")});

  // смена статуса подзадачи из таблицы и откат
  const шот3 = S.items.find(x => x.title === "ТАБ-SH030");
  const рендер3 = childrenOfLive(шот3.id).find(x => x.title === "Рендер");
  tableSetStatus(рендер3, "doing"); await ж(160);
  t.push({имя:"статус подзадачи меняется из таблицы", ок: рендер3.status === "doing", факт: рендер3.status});
  // правки быстрее ЗАПИСЬ_ЖЕСТ_МС (1.5 с) схлопываются в один шаг отката — так задумано (core.js:
  // persist), поэтому вторую правку делаем после окна, как человек, а не через 160 мс
  await ж(1700);
  tableSetStatus(рендер3, "done"); await ж(160);
  t.push({имя:"«Готово» проходит через toggleDone (done и дата выполнения)", ок: рендер3.done === true && !!рендер3.doneAt, факт: "done=" + рендер3.done});
  undoStep(); await ж(160);
  const рендер3б = S.items.find(x => x.id === рендер3.id);
  t.push({имя:"Ctrl+Z снимает смену статуса", ок: !!рендер3б && !рендер3б.done && рендер3б.status === "doing", факт: рендер3б ? (рендер3б.status + " done=" + рендер3б.done) : "нода пропала"});

  // меню статуса открывается по клику и предлагает статусы вида
  const пил = document.querySelector('.tb tbody tr .tb-pill');
  if(пил){ пил.click(); await ж(80); }
  const пункты = document.querySelectorAll(".tb-menu button").length;
  t.push({имя:"клик по статусу открывает меню статусов", ок: пункты >= 5, факт: пункты + " пунктов"});
  tableMenuClose();

  // корень без детей — честная пустота, а не падение
  tableRoot = рендер3.id; render(); await ж(120);
  t.push({имя:"узел без детей — понятная пустая таблица", ок: !!document.querySelector(".tb-empty"), факт: ""});

  /* ---------- рабочие подборки (КРОЛИК, 03.11.2026: «вычленить, над чем сейчас работа, и что
     важнее») ---------- */
  tablePreset = "work"; render(); await ж(120);
  const вРаботе = [...document.querySelectorAll(".tb tbody tr")].map(tr => S.items.find(x => x.id === tr.dataset.tbrow)).filter(Boolean);
  t.push({имя:"«В работе» — только рабочие статусы или горящий срок, без готовых и пауз",
          ок: вРаботе.length > 0 && вРаботе.every(x => { const s = tableStatusOf(x); return s !== "done" && s !== "paused" && (TABLE_WORK.has(s) || (tableDue(x).n !== null && tableDue(x).n <= 0)); }),
          факт: вРаботе.length + " строк"});
  t.push({имя:"шот «В работе» попал в подборку", ок: вРаботе.some(x => x.title === "ТАБ-SH020"), факт: ""});
  t.push({имя:"у строки виден путь к ней", ок: [...document.querySelectorAll(".tb-path")].some(x => x.textContent.indexOf("ТАБ-SQ") >= 0), факт: ""});
  tablePreset = "tasks"; tableQuery = "ТАБ-SH03"; render(); await ж(120);
  // поиск идёт и по ПУТИ: «SH03» находит сам шот и его подзадачи (их путь «… › ТАБ-SH030»), а
  // соседние шоты — нет. Так задумано: на большом графе ищут ветку, а не одно слово
  const найдено = [...document.querySelectorAll(".tb tbody tr")].map(tr => S.items.find(x => x.id === tr.dataset.tbrow)).filter(Boolean);
  t.push({имя:"поиск сужает строки до ветки (по названию и пути)",
          ок: найдено.some(x => x.title === "ТАБ-SH030") && !найдено.some(x => x.title === "ТАБ-SH010" || x.title === "ТАБ-SH020"), факт: найдено.length + " строк"});
  tableQuery = ""; render(); await ж(120);

  // выбор кликом по ЛЮБОМУ месту строки, а не только по названию
  const стр = document.querySelector(".tb tbody tr");
  const ячейка = стр && стр.querySelector(".tb-due");
  if(ячейка) ячейка.click(); await ж(160);
  t.push({имя:"клик по строке (не по названию) открывает её в панели",
          ок: !!стр && asideId === стр.dataset.tbrow && !!document.querySelector(".tb tr.sel"), факт: "asideId=" + asideId});
  // «Граф / Таблица»: с таблицы обязано переключаться обратно
  const кГрафу = document.querySelector('#notes-toggle [data-nm="graph"]');
  if(кГрафу) кГрафу.click(); await ж(300);
  t.push({имя:"с таблицы переключается обратно на граф", ок: notesMode === "graph" && !!document.querySelector("#graph-wrap"), факт: notesMode});
  // двойной клик по строке — показать на графе с выделением
  notesMode = "table"; render(); await ж(160);
  const стр2 = document.querySelector(".tb tbody tr"), ид = стр2 && стр2.dataset.tbrow;
  if(стр2) стр2.dispatchEvent(new MouseEvent("dblclick", {bubbles:true})); await ж(500);
  t.push({имя:"двойной клик по строке — нода выделена на графе",
          ок: notesMode === "graph" && typeof graph !== "undefined" && !!graph && graph.selNodes.has(ид), факт: notesMode});

  // уборка: возвращаем вид и снимаем пакет целиком
  tableRoot = null; tablePreset = "work"; notesMode = "graph"; render(); await ж(120);
  while(S.items.some(x => /^ТАБ-/.test(x.title || "")) && undoStep()) await ж(60);
  t.push({имя:"пакет снят, вид вернулся на граф", ок: !S.items.some(x => /^ТАБ-/.test(x.title || "")) && notesMode === "graph", факт: ""});
}

render(); await ж(120);
console.error = прежний;
t.push({имя:"консоль чистая", ок: ошибки.length === 0, факт: ошибки.slice(0, 2).join(" | ")});
return t;
