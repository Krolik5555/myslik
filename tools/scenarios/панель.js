// Правая панель и разделитель: рабочая область делится на две части, справа — выбранный элемент.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

view = "notes"; render(); await ж(600);
const шир = el => Math.round(document.getElementById(el).getBoundingClientRect().width);

t.push({имя:"панель и разделитель на месте",
        ок: !!document.getElementById("aside") && !!document.getElementById("splitter"),
        факт:"панель " + шир("aside") + " px, вид " + шир("view") + " px"});
t.push({имя:"без выбора панель подсказывает", ок: !!document.querySelector(".aside-empty"), факт:""});

const нота = addItem({kind:"note", title:"Нота для панели", body:"Текст заметки"});
asideSelect(нота.id); await ж(200);
t.push({имя:"выбранный элемент виден в панели",
        ок: (document.querySelector(".as-title")||{}).textContent === "Нота для панели",
        факт: (document.querySelector(".as-title")||{}).textContent || "пусто"});
t.push({имя:"текст заметки в редактируемом поле",
        ок: (document.querySelector('#aside [data-f="body"]')||{}).value === "Текст заметки",
        факт: (document.querySelector('#aside [data-f="body"]')||{}).value || "поля нет"});

// ===== левая полоса иконок =====
{
  const s = document.getElementById("side");
  t.push({имя:"левая панель — полоса иконок", ок: s.classList.contains("slim") && шир("side") <= 70,
          факт: "ширина " + шир("side") + " px"});
  t.push({имя:"подписи видов скрыты, но есть в подсказке",
          ок: getComputedStyle(document.querySelector(".navi span:not(.badge)")).display === "none"
              && !!document.querySelector(".navi").title,
          факт: "подсказка: " + document.querySelector(".navi").title});
  // счётчик показывается точкой в углу значка — проверяем на корзине, чтобы не зависеть от данных
  const мусор = addItem({kind:"note", title:"Для корзины"});
  deleteItem(мусор.id); renderNav(); await ж(120);
  t.push({имя:"счётчик виден точкой на значке", ок: !!document.querySelector('.navi[data-v="bin"] .badge'),
          факт: "бейдж корзины: " + ((document.querySelector('.navi[data-v="bin"] .badge')||{}).textContent || "нет")});
  hardDeleteItem(мусор.id); renderNav();

  t.push({имя:"в полосе только «Заметки» и «Корзина»", ок: document.querySelectorAll(".navi").length === 2,
          факт: [...document.querySelectorAll(".navi")].map(b=>b.title).join(", ")});

  const былаШирина = шир("side");
  document.getElementById("side-toggle").click(); await ж(200);
  {
    const к = document.getElementById("side-toggle").getBoundingClientRect();
    t.push({имя:"панель сворачивается до кромки, кнопка возврата видна",
            ок: s.classList.contains("side-off") && шир("side") >= 12 && шир("side") < 30 && к.width > 0 && к.height > 0,
            факт: былаШирина + " → " + шир("side") + " px, кнопка " + Math.round(к.width) + "x" + Math.round(к.height)});
  }
  t.push({имя:"свёрнутость записана в настройки", ок: S.settings.sideHidden === true, факт:""});
  document.getElementById("side-toggle").click(); await ж(200);
  t.push({имя:"панель возвращается", ок: !s.classList.contains("side-off") && шир("side") === былаШирина,
          факт: "ширина " + шир("side") + " px"});

  // разворот подписей: кнопка «показать названия»
  document.getElementById("side-wide").click(); await ж(200);
  t.push({имя:"подписи разворачиваются кнопкой",
          ок: !s.classList.contains("slim") && шир("side") > 120
              && getComputedStyle(document.querySelector(".areai .nm")).display !== "none",
          факт: "ширина " + шир("side") + " px"});
  document.getElementById("side-wide").click(); await ж(200);
  t.push({имя:"и сворачиваются обратно", ок: s.classList.contains("slim") && шир("side") === былаШирина,
          факт: "ширина " + шир("side") + " px"});

  // нижние кнопки должны быть попадаемыми
  const фб = document.querySelector(".foot-btn").getBoundingClientRect();
  t.push({имя:"кнопки экспорта и настроек крупные", ок: фб.height >= 36 && фб.width >= 36,
          факт: Math.round(фб.width) + "x" + Math.round(фб.height)});
}

// ===== разделитель: ручка вместо полосы =====
{
  const sp = document.getElementById("splitter");
  const линия = getComputedStyle(sp, ":before");
  t.push({имя:"у разделителя есть ручка", ок: parseFloat(линия.height) >= 30 && parseFloat(линия.width) <= 8,
          факт: "ручка " + линия.width + " x " + линия.height});
}

// ===== правка прямо в панели =====
const зад = addItem({kind:"task", title:"Задача для панели", area:null, priority:0});
asideSelect(зад.id); await ж(200);
const поле = f => document.querySelector(`#aside [data-f="${f}"]`);
const сменить = (f, v) => { const p = поле(f); p.value = v; p.dispatchEvent(new Event("change", {bubbles:true})); };

сменить("priority", "3"); await ж(150);
t.push({имя:"приоритет меняется из панели", ок: зад.priority === 3, факт: "priority: " + зад.priority});

сменить("due", "2026-08-15"); await ж(150);
t.push({имя:"срок ставится из панели", ок: зад.due === "2026-08-15", факт: "due: " + зад.due});

asideSelect(зад.id); await ж(150);
document.querySelector('#aside [data-clear="due"]').click(); await ж(150);
t.push({имя:"срок снимается крестиком", ок: зад.due === null, факт: "due: " + зад.due});

asideSelect(зад.id); await ж(150);
сменить("status", "doing"); await ж(150);
t.push({имя:"статус «в работе» из панели", ок: зад.status === "doing" && !зад.done, факт: "status: " + зад.status});

asideSelect(зад.id); await ж(150);
сменить("repeat", "daily"); await ж(150);
const былоЗадач = S.items.filter(i => i.kind === "task" && !i.deleted).length;
asideSelect(зад.id); await ж(150);
сменить("status", "done"); await ж(250);
t.push({имя:"«Готово» ставит дату выполнения", ок: зад.done && !!зад.doneAt, факт: "doneAt: " + (зад.doneAt ? "есть" : "нет")});
t.push({имя:"повтор порождает следующую задачу",
        ок: S.items.filter(i => i.kind === "task" && !i.deleted).length === былоЗадач + 1,
        факт: "задач было " + былоЗадач + ", стало " + S.items.filter(i => i.kind === "task" && !i.deleted).length});

// теги
asideSelect(зад.id); await ж(150);
document.querySelector("#aside [data-addtag]").click(); await ж(100);
const вводТега = document.querySelector("#aside .as-taginp");
вводТега.value = "#проверка";
вводТега.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));
await ж(200);
t.push({имя:"тег добавляется из панели", ок: (зад.tags||[]).includes("проверка"), факт: "теги: " + (зад.tags||[]).join(", ")});
document.querySelector('#aside [data-untag="проверка"]').click(); await ж(200);
t.push({имя:"тег снимается крестиком", ок: !(зад.tags||[]).includes("проверка"), факт: "теги: " + ((зад.tags||[]).join(", ") || "нет")});

// заголовок и текст — с дебаунсом, панель при этом не перерисовывается
asideSelect(зад.id); await ж(150);
const загл = document.querySelector("#aside .as-title");
загл.textContent = "Переименована из панели";
загл.dispatchEvent(new Event("input", {bubbles:true}));
await ж(600);
t.push({имя:"заголовок правится на месте", ок: зад.title === "Переименована из панели", факт: зад.title});
t.push({имя:"панель не перерисовалась под курсором", ок: document.querySelector("#aside .as-title") === загл,
        факт: document.querySelector("#aside .as-title") === загл ? "тот же узел" : "узел заменён"});

const обл = document.querySelector('#aside [data-f="body"]');
обл.value = "Описание из панели";
обл.dispatchEvent(new Event("input", {bubbles:true}));
await ж(600);
t.push({имя:"описание правится на месте", ок: зад.body === "Описание из панели", факт: зад.body});

// строки панели выровнены в одну сетку: подпись, слот иконки, значение
asideSelect(зад.id); await ж(150);
{
  const левые = [...document.querySelectorAll("#aside .as-row .as-v")].map(v => Math.round(v.getBoundingClientRect().left));
  t.push({имя:"значения полей стоят одной колонкой", ок: new Set(левые).size === 1,
          факт: "левых краёв: " + [...new Set(левые)].join(", ")});
  // правые края полей тоже должны совпадать: иначе стрелки выпадающих списков идут лесенкой
  const правые = [...document.querySelectorAll("#aside .as-sel, #aside .as-inp")].map(v => Math.round(v.getBoundingClientRect().right));
  t.push({имя:"поля одной ширины (стрелки в столбик)", ок: new Set(правые).size === 1,
          факт: "правых краёв: " + [...new Set(правые)].join(", ")});
}

// ===== смена типа ноды прямо в панели =====
{
  asideSelect(зад.id); await ж(150);
  сменить("kind", "note"); await ж(200);
  t.push({имя:"тип меняется из панели", ок: зад.kind === "note" && зад.status === "note",
          факт: "kind: " + зад.kind + ", status: " + зад.status});
  asideSelect(зад.id); await ж(150);
  t.push({имя:"у заметки нет полей задачи", ок: !document.querySelector('#aside [data-f="due"]'),
          факт: "полей: " + [...document.querySelectorAll("#aside [data-f]")].map(e=>e.dataset.f).join(",")});
  сменить("kind", "task"); await ж(200);
  t.push({имя:"обратно в задачу — поля вернулись", ок: зад.kind === "task" && зад.status !== "note",
          факт: "kind: " + зад.kind + ", status: " + зад.status});
}

// ===== действия внизу карточки =====
{
  asideSelect(зад.id); await ж(150);
  t.push({имя:"ряд действий на месте", ок: document.querySelectorAll("#aside .as-act").length === 3,
          факт: "кнопок: " + document.querySelectorAll("#aside .as-act").length});

  const былоНод = S.items.filter(i => !i.deleted).length;
  document.querySelector("#aside [data-dup]").click(); await ж(300);
  const дубль = S.items.find(i => (i.title||"").indexOf("— копия") >= 0 && !i.deleted);
  t.push({имя:"дубликат создаётся и открывается в панели",
          ок: !!дубль && asideId === дубль.id && S.items.filter(i => !i.deleted).length === былоНод + 1,
          факт: дубль ? дубль.title : "не создан"});
  if (дубль) hardDeleteItem(дубль.id);

  asideSelect(зад.id); await ж(150);
  document.querySelector("#aside [data-del]").click(); await ж(300);
  t.push({имя:"удаление из панели мягкое и панель очищается",
          ок: зад.deleted === true && !!document.querySelector(".aside-empty"),
          факт: "deleted: " + зад.deleted});
  restoreItem(зад.id);
}

hardDeleteItem(зад.id);
S.items.filter(i => (i.title||"").indexOf("Задача для панели") === 0).forEach(i => hardDeleteItem(i.id));

// ===== наследование области по ветке =====
{
  const обл = S.areas[0].id;
  const корень = addItem({kind:"note", title:"Корень ветки"});
  корень.area = обл; корень.areaAuto = false;
  const сын = addItem({kind:"note", title:"Сын"});
  const внук = addItem({kind:"note", title:"Внук"});
  [корень, сын, внук].forEach(n => { n.x = 0; n.y = 0; });
  S.links.push([корень.id, сын.id, 1], [сын.id, внук.id, 1]);
  recomputeHierarchy();
  t.push({имя:"область наследуется дочерней нодой", ок: сын.area === обл && сын.areaAuto === true,
          факт: "у сына: " + сын.area + (сын.areaAuto ? " (наследует)" : "")});
  t.push({имя:"наследуется и через уровень", ок: внук.area === обл && внук.areaAuto === true,
          факт: "у внука: " + внук.area});
  t.push({имя:"иерархия не схлопнулась в область", ок: сын.parent === корень.id && внук.parent === сын.id,
          факт: "родитель внука: " + (внук.parent === сын.id ? "сын" : внук.parent)});

  // своя область руками не перебивается наследованием
  const своя = S.areas[1] ? S.areas[1].id : обл;
  внук.area = своя; внук.areaAuto = false;
  recomputeHierarchy();
  t.push({имя:"выбранная руками область держится", ок: внук.area === своя,
          факт: "у внука: " + внук.area});

  [корень, сын, внук].forEach(n => hardDeleteItem(n.id));
}

// ===== список связанных нод =====
{
  const центр = addItem({kind:"note", title:"Центр связей"});
  const сосед = addItem({kind:"note", title:"Сосед"});
  const безымянный = addItem({kind:"flow", title:""});
  const обл = S.areas[0].id;
  центр.area = обл; центр.areaAuto = false;
  S.links.push([центр.id, сосед.id, 1], [центр.id, безымянный.id, 1], [центр.id, "hub_"+обл, 1]);
  recomputeHierarchy();
  asideSelect(центр.id); await ж(200);
  const строки = [...document.querySelectorAll("#aside .as-link span")].map(s => s.textContent.trim());
  t.push({имя:"в связанных нодах нет пустых строк", ок: строки.every(s => s.length > 0),
          факт: строки.join(" | ")});
  t.push({имя:"хаб области не попадает в список", ок: !строки.some(s => s === "" || s === "без названия"),
          факт: "строк: " + строки.length});
  t.push({имя:"безымянная нода подписана типом", ок: строки.some(s => s.indexOf("полотно без названия") >= 0),
          факт: строки.join(" | ")});
  t.push({имя:"нода не ссылается сама на себя", ок: !строки.some(s => s === "Центр связей"), факт:""});
  [центр, сосед, безымянный].forEach(n => hardDeleteItem(n.id));
}

// ===== доска полотна прямо в панели =====
const пол = addItem({kind:"flow", title:"Полотно для панели"});
asideSelect(пол.id);
{
  let n = 0;
  while (n < 25000 && !document.querySelector("#as-board-host canvas")) { await ж(200); n += 200; }
  await ж(400);
  const хост = document.querySelector("#as-board-host");
  const кор = document.querySelector("#as-board-host .excalidraw");
  t.push({имя:"доска встроена в панель", ок: !!кор && !!хост.querySelector("canvas"),
          факт: кор ? Math.round(кор.getBoundingClientRect().width) + "x" + Math.round(кор.getBoundingClientRect().height) : "не поднялась"});
  if (кор) {
    {
      const r = кор.getBoundingClientRect();
      t.push({имя:"панель раздвинулась под доску (не мобильный вид)",
              ок: !кор.classList.contains("excalidraw--mobile"),
              факт: Math.round(r.width) + "x" + Math.round(r.height) +
                    " (порог: ширина≥730 или высота≥500), классы: " + кор.className});
    }
    t.push({имя:"доска знает свою ноду", ок: !!drawItem && drawItem.id === пол.id, факт: (drawItem||{}).title || "нет"});

    // рисуем и проверяем, что сохраняется именно в эту ноду
    drawApi.updateScene({elements: ExcalidrawLib.convertToExcalidrawElements([{type:"rectangle", x:60, y:60, width:120, height:80}])});
    await ж(1400);
    t.push({имя:"нарисованное во врезке пишется в ноду", ок: ((S.boards[пол.id]||{}).elements||[]).length >= 1,
            факт: "элементов: " + ((S.boards[пол.id]||{}).elements||[]).length});

    // выбор другой ноды снимает доску
    asideSelect(нота.id); await ж(500);
    t.push({имя:"уход с полотна снимает доску", ок: !drawRoot && !document.querySelector("#as-board-host"),
            факт: drawRoot ? "корень жив" : "снята"});

    // возврат — доска поднимается заново с тем же рисунком
    asideSelect(пол.id);
    n = 0;
    while (n < 25000 && !document.querySelector("#as-board-host canvas")) { await ж(200); n += 200; }
    await ж(400);
    t.push({имя:"возврат к полотну поднимает доску с рисунком",
            ок: !!drawApi && drawApi.getSceneElements().length >= 1,
            факт: drawApi ? "элементов: " + drawApi.getSceneElements().length : "не поднялась"});

    // разворот на весь экран
    document.querySelector("[data-full]").click();
    await ж(900);
    t.push({имя:"кнопка разворота открывает доску на весь экран", ок: !!document.getElementById("draw-screen"),
            факт: document.getElementById("draw-screen") ? "слой открыт" : "слоя нет"});
    if (document.getElementById("draw-back")) { document.getElementById("draw-back").click(); await ж(500); }
  }
}

// разделитель тянется и ширина запоминается.
// Проверяем НЕ на полотне: под доску панель раздвинута до предела и тянуть уже некуда.
asideSelect(нота.id); await ж(300);
const было = шир("aside");
const sp = document.getElementById("splitter"), r = sp.getBoundingClientRect();
sp.setPointerCapture = () => {}; sp.releasePointerCapture = () => {};
const соб = (тип, x) => new PointerEvent(тип, {clientX:x, clientY:r.top+40, bubbles:true, cancelable:true, pointerId:1, button:0, buttons:1});
sp.dispatchEvent(соб("pointerdown", r.left+3)); await ж(50);
sp.dispatchEvent(соб("pointermove", r.left-120)); await ж(50);
sp.dispatchEvent(соб("pointerup", r.left-120)); await ж(150);
t.push({имя:"разделитель тянется", ок: шир("aside") > было + 60, факт: было + " → " + шир("aside")});
t.push({имя:"ширина записана в настройки", ок: Math.abs(S.settings.asideW - шир("aside")) < 3,
        факт:"в настройках " + Math.round(S.settings.asideW)});

// панель прячется и это переживает перерисовку
S.settings.asideOn = false; renderAside(); await ж(100);
t.push({имя:"панель прячется", ок: document.getElementById("aside").classList.contains("off"), факт:""});
S.settings.asideOn = true; renderAside();

// удалённый элемент не должен висеть в панели
asideSelect(нота.id); await ж(100);
hardDeleteItem(нота.id); renderAside(); await ж(100);
t.push({имя:"удалённый элемент уходит из панели", ок: !!document.querySelector(".aside-empty"),
        факт: document.querySelector(".as-title") ? "остался" : "панель пуста"});

hardDeleteItem(пол.id); asideId = null; render();
return t;
