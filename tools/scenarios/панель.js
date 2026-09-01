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
  /* Счётчик показывается точкой в углу значка. Проверяем на «Заметках»: бейдж там считает
     неразобранное — ноды, ещё не поставленные на холст. Корзины больше нет вовсе. */
  const вЛотке = addItem({kind:"note", title:"Ещё не на холсте"});
  вЛотке.x=null; вЛотке.y=null; renderNav(); await ж(120);
  t.push({имя:"счётчик виден точкой на значке", ок: !!document.querySelector('.navi[data-v="notes"] .badge'),
          факт: "бейдж заметок: " + ((document.querySelector('.navi[data-v="notes"] .badge')||{}).textContent || "нет")});
  hardDeleteItem(вЛотке.id); renderNav();

  t.push({имя:"в полосе только «Заметки», корзины нет", ок: document.querySelectorAll(".navi").length === 1
            && !document.querySelector('.navi[data-v="bin"]'),
          факт: [...document.querySelectorAll(".navi")].map(b=>b.title).join(", ")});

  /* ГРАФЫ. Панель поделена надвое: сверху графы, снизу области ТЕКУЩЕГО графа. Графы не
     пересекаются: свои ноды, свои области, свои связи. */
  {
    const свой=addItem({kind:"note", title:"нода первого"});
    renderNav(); await ж(120);
    const строки=()=>[...document.querySelectorAll("#graphs .grafi")];
    t.push({имя:"список графов есть в панели, активный отмечен",
            ок: строки().length>=1 && строки().some(b=>b.classList.contains("on")),
            факт: строки().map(b=>b.textContent.trim()).join(" | ")});
    t.push({имя:"графы стоят ВЫШЕ областей",
            ок: !!(document.querySelector("#graphs").compareDocumentPosition(document.querySelector("#areas"))
                   & Node.DOCUMENT_POSITION_FOLLOWING),
            факт: "порядок в разметке"});
    /* Разделы обязаны РАЗЛИЧАТЬСЯ: в свёрнутой полосе подписей не видно, и две кнопки «+»
       подряд читались как одна. Значок раздела виден всегда, а области отделены линией. */
    {
      const шапки=[...document.querySelectorAll("#side .side-h")];
      const значки=шапки.map(h=>((h.querySelector(".side-h-ic")||{}).className||"").split(" ")[1]||"");
      const областиШапка=document.querySelector(".side-h.sh-areas");
      t.push({имя:"у разделов свои значки и они не одинаковые",
              ок: значки.length>=2 && значки[0] && значки[1] && значки[0]!==значки[1],
              факт: значки.join(" / ")});
      t.push({имя:"области отделены от графов линией",
              ок: parseFloat(getComputedStyle(областиШапка).borderTopWidth)>0,
              факт: "линия: "+getComputedStyle(областиШапка).borderTopWidth});
      t.push({имя:"кнопки «+» подписаны по-разному",
              ок: document.querySelector("#add-graph").title!==document.querySelector("#add-area").title
                  && /граф/i.test(document.querySelector("#add-graph").title)
                  && /област/i.test(document.querySelector("#add-area").title),
              факт: document.querySelector("#add-graph").title+" | "+document.querySelector("#add-area").title});
    }

    const второй=graphAdd("Проверочный"); renderNav(); await ж(120);
    /* Значок графа НЕ должен совпадать со значком вида «Заметки» в той же полосе: два
       одинаковых кружка подряд читались как дубль одного и того же. */
    {
      const свой=[...document.querySelectorAll("#graphs .grafi i")].map(i=>(i.className.split(" ")[1]||""));
      const вид=(document.querySelector('.navi[data-v="notes"] i').className.split(" ")[1]||"");
      t.push({имя:"значок графа свой, а не тот же, что у вида «Заметки»",
              ок: свой.length>0 && свой.every(x=>x && x!==вид),
              факт: "графы: "+свой.join(",")+"; вид: "+вид});
      // и его можно сменить: значок хранится у графа и переживает чистку данных
      второй.icon="ti-heart"; второй.color="#e0625a"; persist(); renderNav(); await ж(80);
      const кн=[...document.querySelectorAll("#graphs .grafi")].find(b=>b.dataset.graph===второй.id);
      const чищено=sanitizeState(JSON.parse(JSON.stringify(S)));
      t.push({имя:"значок и цвет графа сохраняются",
              ок: /ti-heart/.test(кн.innerHTML) && (чищено.graphs.find(x=>x.id===второй.id)||{}).icon==="ti-heart",
              факт: "в разметке: "+/ti-heart/.test(кн.innerHTML)+
                    ", после чистки: "+((чищено.graphs.find(x=>x.id===второй.id)||{}).icon||"—")});
    }
    const кнопка=строки().find(b=>b.dataset.graph===второй.id);
    кнопка.click(); await ж(400);
    t.push({имя:"клик по графу переключает на него",
            ок: S.settings.graph===второй.id, факт:"активный: "+S.settings.graph});
    t.push({имя:"новый граф пустой: ни нод, ни областей чужого графа",
            ок: S.items.length===0 && S.areas.length===0
                && !document.querySelector("#areas .areai"),
            факт: "нод "+S.items.length+", областей "+S.areas.length});

    // в новом графе своя жизнь, и она не течёт в соседний
    const чужая=addItem({kind:"note", title:"нода второго"});
    S.areas.push({id:"a_второй", name:"Область второго", icon:"ti-star"});
    persist(); renderNav(); await ж(120);
    const первый=S.graphs[0].id;
    [...document.querySelectorAll("#graphs .grafi")].find(b=>b.dataset.graph===первый).click();
    await ж(400);
    t.push({имя:"графы не видят содержимого друг друга",
            ок: S.items.some(i=>i.id===свой.id) && !S.items.some(i=>i.id===чужая.id)
                && !S.areas.some(a=>a.id==="a_второй") && S.areas.length>0,
            факт: "в первом нод "+S.items.length+", областей "+S.areas.length});

    // в файл уезжают графы, а не дубль items
    const файл=JSON.parse(JSON.stringify(S));
    t.push({имя:"в файл пишутся графы, без дубля списков",
            ок: Array.isArray(файл.graphs) && файл.graphs.length>=2
                && !Object.prototype.hasOwnProperty.call(файл,"items"),
            факт: "графов в файле: "+(файл.graphs||[]).length+
                  ", отдельный items: "+Object.prototype.hasOwnProperty.call(файл,"items")});

    // удаление графа уносит его содержимое целиком
    const былоНод=S.graphs.find(g=>g.id===второй.id).items.length;
    graphDelete(второй.id); renderNav(); await ж(120);
    t.push({имя:"удаление графа уносит его ноды",
            ок: !S.graphs.some(g=>g.id===второй.id) && !S.items.some(i=>i.id===чужая.id),
            факт: "было нод во втором: "+былоНод+", графов осталось: "+S.graphs.length});
    t.push({имя:"последний граф удалить нельзя",
            ок: S.graphs.length===1 ? graphDelete(S.graphs[0].id)===false : true,
            факт: "графов: "+S.graphs.length});

    hardDeleteItem(свой.id); renderNav();
  }

  const былаШирина = шир("side");
  // разворот подписей: кнопка «показать названия»
  document.getElementById("side-wide").click(); await ж(200);
  t.push({имя:"подписи разворачиваются кнопкой",
          ок: !s.classList.contains("slim") && шир("side") > 120
              && getComputedStyle(document.querySelector(".areai .nm")).display !== "none",
          факт: "ширина " + шир("side") + " px"});
  document.getElementById("side-wide").click(); await ж(200);
  t.push({имя:"и сворачиваются обратно", ок: s.classList.contains("slim") && шир("side") === былаШирина,
          факт: "ширина " + шир("side") + " px"});

  // кнопка разворота не должна прыгать при смене ширины панели
  {
    const до = document.getElementById("side-wide").getBoundingClientRect();
    document.getElementById("side-wide").click(); await ж(200);
    const после = document.getElementById("side-wide").getBoundingClientRect();
    t.push({имя:"кнопка разворота остаётся на месте",
            ок: Math.abs(до.left - после.left) <= 2 && Math.abs(до.top - после.top) <= 2,
            факт: `${Math.round(до.left)},${Math.round(до.top)} → ${Math.round(после.left)},${Math.round(после.top)}`});
    document.getElementById("side-wide").click(); await ж(200);
  }

  // нижние кнопки должны быть попадаемыми
  const фб = document.querySelector(".foot-btn").getBoundingClientRect();
  t.push({имя:"кнопки экспорта и настроек крупные", ок: фб.height >= 36 && фб.width >= 36,
          факт: Math.round(фб.width) + "x" + Math.round(фб.height)});
}

// ===== выделение в графе ведёт панель =====
{
  view = "notes"; render(); await ж(700);
  if (graph) {
    const узлы = graph.nodes.filter(n => n.type !== "hub" && n.ref).slice(0, 3);
    if (узлы.length >= 2) {
      // одна выделенная нода — её карточка
      graph.selNodes = new Set([узлы[0].id]); graph._paintSel(); graph._syncAside(); await ж(250);
      t.push({имя:"одна выделенная нода открывается в панели",
              ок: asideId === узлы[0].id && !!document.querySelector("#aside .as-title"),
              факт: (document.querySelector("#aside .as-title")||{}).textContent || "пусто"});

      // несколько — сводка
      graph.selNodes = new Set(узлы.map(n => n.id)); graph._paintSel(); graph._syncAside(); await ж(250);
      t.push({имя:"для нескольких нод панель показывает сводку",
              ок: ((document.querySelector("#aside .as-title")||{}).textContent||"").indexOf("Выделено") === 0,
              факт: (document.querySelector("#aside .as-title")||{}).textContent || "пусто"});
      t.push({имя:"в сводке есть переходы к нодам",
              ок: document.querySelectorAll("#aside .as-link").length >= 2,
              факт: "ссылок: " + document.querySelectorAll("#aside .as-link").length});

      // групповые правки из сводки: тип у всех разом
      {
        const свои = узлы.map(n => n.ref).filter(Boolean);
        graph.selNodes = new Set(свои.map(n => n.id)); graph._paintSel(); graph._syncAside(); await ж(250);
        const поле = document.querySelector('#aside [data-all="kind"]');
        if (поле) {
          поле.value = "note"; поле.dispatchEvent(new Event("change", {bubbles:true}));
          await ж(400);
          t.push({имя:"тип меняется у всех выделенных сразу",
                  ок: свои.every(n => n.kind === "note"),
                  факт: свои.map(n => n.kind).join(", ")});
          const поле2 = document.querySelector('#aside [data-all="kind"]');
          поле2.value = "task"; поле2.dispatchEvent(new Event("change", {bubbles:true}));
          await ж(400);
          t.push({имя:"и обратно в задачи", ок: свои.every(n => n.kind === "task" && n.status !== "note"),
                  факт: свои.map(n => n.kind).join(", ")});
        }
        graph.selNodes = new Set(); graph._paintSel();
      }

      // клик по связанной ноде выделяет её в графе
      graph.selNodes = new Set(); graph._paintSel();
      asideSelect(узлы[0].id); await ж(200);
      const ссылка = document.querySelector("#aside .as-link[data-go]");
      if (ссылка) {
        const цель = ссылка.dataset.go;
        ссылка.click(); await ж(400);
        t.push({имя:"переход по связанной ноде выделяет её в графе",
                ок: graph.selNodes.has(цель) && asideId === цель,
                факт: graph.selNodes.has(цель) ? "выделена" : "не выделена"});
      }
      graph.selNodes = new Set(); graph._paintSel();
    }
  }
  // подсказка по управлению закрывается и возвращается
  if (document.getElementById("g-hint-x")) {
    document.getElementById("g-hint-x").click(); await ж(150);
    t.push({имя:"подсказка графа закрывается", ок: document.getElementById("g-hint").classList.contains("off")
            && S.settings.graphHint === false, факт:""});
    document.getElementById("g-hint-on").click(); await ж(150);
    t.push({имя:"и возвращается из меню", ок: !document.getElementById("g-hint").classList.contains("off"), факт:""});
  }
}

// левая и правая половины должны кончаться на одной линии
{
  view = "notes"; render(); await ж(700);
  const л = document.getElementById("graph-wrap").getBoundingClientRect();
  const п = document.getElementById("aside").getBoundingClientRect();
  t.push({имя:"половины одинаковой высоты", ок: Math.abs(л.bottom - п.bottom) <= 2 && Math.abs(л.top - п.top) <= 2,
          факт: `граф ${Math.round(л.top)}–${Math.round(л.bottom)}, панель ${Math.round(п.top)}–${Math.round(п.bottom)}`});
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
// крестик живёт ВНУТРИ кнопки срока: в узкой строке панели отдельная кнопка съедала бы место
document.querySelector('#aside [data-dateclear]').click(); await ж(150);
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
  /* СРОК — ТАКАЯ ЖЕ СТРОКА, А НЕ ПЛАШКА. Своя кнопка живёт среди чужих правил, и одно из них
     («.empty i» — кружок 62×62 для заглушек пустого состояния) уже раздувало её втрое: строка
     срока вылезала на 88 px и читалась как здоровая панель посреди списка полей. Меряем высоту
     против соседнего списка — так ловится любое чужое правило, а не только это. */
  const срок = document.querySelector("#aside .date-ctl [data-datepick]");
  const статус = document.querySelector('#aside [data-f="status"]');
  const hс = срок ? срок.getBoundingClientRect().height : 0;
  const hст = статус ? статус.getBoundingClientRect().height : 0;
  t.push({имя:"поле срока — строка той же высоты, что соседние поля",
          ок: !!срок && !!статус && Math.abs(hс - hст) <= 2 && Math.round(hс) <= 34,
          факт: "срок " + Math.round(hс) + " px против статуса " + Math.round(hст) + " px"});
  t.push({имя:"кнопка срока не ловит чужой стиль пустого состояния",
          ок: !!срок && !срок.classList.contains("empty")
              && Math.round((срок.querySelector("i")||{getBoundingClientRect:()=>({height:0})}).getBoundingClientRect().height) <= 24,
          факт: "классы: " + (срок ? срок.className : "нет кнопки")});
}

// ===== смена типа ноды прямо в панели =====
{
  /* СМЕНА ВИДА БОЛЬШЕ НЕ ГАСИТ СОВМЕСТИМЫЙ СТАТУС (2026-09-01). Раньше задача, ставшая заметкой,
     безусловно получала "note" — и «в работе» слетало от одного движения селектом. Теперь
     переставляется только несовместимое: «Готово» заметке нельзя, а «в работе» и «ждёт» — можно
     (у КРОЛИКА заметками живут целые этапы, и статус на них осмысленный). */
  asideSelect(зад.id); await ж(150);
  сменить("status", "waiting"); await ж(150);
  сменить("kind", "note"); await ж(200);
  t.push({имя:"заметка сохраняет совместимый статус при смене вида",
          ок: зад.kind === "note" && зад.status === "waiting",
          факт: "kind: " + зад.kind + ", status: " + зад.status});
  asideSelect(зад.id); await ж(150);
  t.push({имя:"у заметки нет полей задачи, но строка статуса есть",
          ок: !document.querySelector('#aside [data-f="due"]') && !!document.querySelector('#aside [data-f="status"]'),
          факт: "полей: " + [...document.querySelectorAll("#aside [data-f]")].map(e=>e.dataset.f).join(",")});
  t.push({имя:"в списке статусов заметки нет «Готово»",
          ок: ![...document.querySelectorAll('#aside [data-f="status"] option')].some(o=>o.value==="done"),
          факт: [...document.querySelectorAll('#aside [data-f="status"] option')].map(o=>o.value).join(",")});
  сменить("kind", "task"); await ж(200);
  t.push({имя:"обратно в задачу — поля вернулись", ок: зад.kind === "task" && зад.status !== "note",
          факт: "kind: " + зад.kind + ", status: " + зад.status});
  /* ГРУППОВАЯ СМЕНА СТАТУСА. Закрывают и переводят работу пачками (сдал шот — десять его
     рендеров меняются разом), а до этого группой можно было сменить только вид и область. */
  {
    const б1=addItem({kind:"task", title:"пачка-1"}), б2=addItem({kind:"task", title:"пачка-2"});
    asideMany([б1.id, б2.id]); await ж(200);
    const сел=document.querySelector('#aside [data-all="status"]');
    if(сел){ сел.value="waiting"; сел.dispatchEvent(new Event("change")); }
    await ж(250);
    t.push({имя:"статус меняется на всю пачку из панели",
            ок: !!сел && б1.status==="waiting" && б2.status==="waiting",
            факт: сел ? (б1.status+", "+б2.status) : "селекта нет"});
    /* Срок на пачку: дедлайн у шота общий для всех его этапов. Проверяем и простановку, и
       снятие — «×» рядом с кнопками, чтобы не открывать календарь ради пустого значения. */
    asideMany([б1.id, б2.id]); await ж(200);
    const пт=document.querySelector('#aside [data-alldue="пт"]');
    if(пт) пт.click(); await ж(200);
    const деньПт = б1.due ? parseYmd(б1.due).getDay() : null;
    t.push({имя:"срок «пятница» ставится на всю пачку и это правда пятница",
            ок: !!пт && б1.due===б2.due && деньПт===5,
            факт: "б1="+б1.due+", б2="+б2.due+", день недели "+деньПт});
    asideMany([б1.id, б2.id]); await ж(200);
    const снять=document.querySelector('#aside [data-alldue="__none__"]');
    if(снять) снять.click(); await ж(200);
    t.push({имя:"срок снимается у всей пачки", ок: б1.due===null && б2.due===null,
            факт: "б1="+б1.due+", б2="+б2.due});
    [б1,б2].forEach(x=>hardDeleteItem(x.id)); render(); await ж(150);
  }
}

// ===== действия внизу карточки =====
{
  asideSelect(зад.id); await ж(150);
  /* Действие внизу карточки ОДНО — отчёт, и оно подписано словами. Дубль и удаление убраны:
     две мелкие иконки стояли рядом, и удаление ловилось промахом по дублю. Удаляют в окне
     правки и по ПКМ в графе, дублируют там же копипастом. */
  const низ = document.querySelectorAll("#aside .as-foot button");
  t.push({имя:"внизу карточки одно действие — отчёт",
          ок: низ.length===1 && !!document.querySelector('#aside .as-foot [data-report]')
              && !document.querySelector("#aside [data-dup], #aside [data-del]"),
          факт: "кнопок: " + [...низ].map(b=>b.textContent.trim()).join(", ")});
  t.push({имя:"кнопка отчёта во всю ширину панели",
          ок: (()=>{ const к=document.querySelector('#aside .as-foot [data-report]'), п=document.querySelector("#aside");
                     return к && (к.getBoundingClientRect().width > п.getBoundingClientRect().width*0.8); })(),
          факт: Math.round((document.querySelector('#aside .as-foot [data-report]')||{getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)+" px"});
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
  /* У ПОЛОТНА в панели только название и тип: область, папка и теги ему не нужны, а каждая
     строка отъедала высоту у самой доски, ради которой панель и открывают. */
  {
    const пол = addItem({kind:"flow", title:"полотноПанель"}); пол.x = 400; пол.y = 400;
    recomputeHierarchy(); if (graph) graph.build();
    asideSelect(пол.id); await ж(150);
    const поля = [...document.querySelectorAll("#aside .as-row .as-k")].map(s => s.textContent.trim());
    t.push({имя:"у полотна нет строк полей вовсе", ок: поля.length === 0,
            факт: "поля: " + (поля.join(", ") || "нет")});
    t.push({имя:"тип полотна переехал в шапку, к названию",
            ок: !!document.querySelector("#aside .as-head .as-kind select[data-f=kind]"), факт:""});
    // карандаш у полотна открывает ПРАВКУ, а не разворот доски: полей в панели больше нет
    const кар = document.querySelector("#aside .as-head [data-edit]");
    if (кар) { кар.click(); await ж(200);
      const окно = document.querySelector("#overlay-root .modal h3");
      t.push({имя:"карандаш полотна открывает окно правки",
              ок: !!окно && !document.querySelector("#draw-screen"),
              факт: окно ? окно.textContent.trim() : "окно не открылось"});
      closeOverlays(); await ж(120); }
    hardDeleteItem(пол.id); recomputeHierarchy(); if (graph) graph.build();
    asideSelect(центр.id); await ж(150);      // вернуть панель на ноду, которую проверяют ниже
  }

  /* Сама нода в списке ЕСТЬ — строкой «эта», чтобы было видно её место в иерархии, но она
     не кнопка: переходить на самого себя некуда. Проверяем именно это. */
  const ссылки = [...document.querySelectorAll("#aside .as-link[data-go] span")].map(s => s.textContent.trim());
  t.push({имя:"на саму себя ссылки нет", ок: !ссылки.some(s => s === "Центр связей"), факт: ссылки.join(" | ")});
  t.push({имя:"своё место в дереве показано", ок: !!document.querySelector("#aside .as-self"), факт:""});
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
    /* Панель БОЛЬШЕ НЕ раздвигается под доску принудительно (КРОЛИК, 2026-08-11) — переключение
       между узкой карточкой и полотном не должно прыгать по ширине. Значит доска в панели
       МОЖЕТ оказаться в мобильной раскладке Excalidraw (ширина<730) — это ожидаемо и не
       критично, пока сама доска работает: рисует, сохраняет, поднимается заново. Именно это
       проверяют следующие пункты, а не класс excalidraw--mobile. */
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
// ширина хранится долей от окна: иначе панель, растянутая в полный экран, в маленьком окне
// занимала бы его целиком
{
  const доля = S.settings.asideFrac;
  t.push({имя:"ширина панели хранится долей от окна",
          ок: доля > 0.1 && доля < 0.7 && Math.abs(доля * window.innerWidth - шир("aside")) < 6,
          факт: "доля " + доля.toFixed(3) + " → " + шир("aside") + " px при окне " + window.innerWidth});
  /* Имитируем открытие в маленьком окне: панель должна ужаться. Проверяем СМЫСЛ, а не круглое
     число: рядом с панелью обязаны поместиться левая полоса, разделитель, её правый отступ и
     минимум левой части (280 px у #view). Раньше здесь стояла константа 420, посчитанная под
     СВЁРНУТУЮ полосу, — с подписями (188 px) панель, растянутая до упора, вылезала за правый
     край окна ровно на разницу, и проверка этого не замечала. */
  const хвост = ()=> шир("side") + 14 + 18 + 280;
  S.settings.asideFrac = 0.75;   // как будто тянули в полный экран
  asideApplyWidth();
  t.push({имя:"панель не съедает окно целиком", ок: шир("aside") + хвост() <= window.innerWidth + 2,
          факт: шир("aside") + " px панели + " + хвост() + " px остального при окне " + window.innerWidth});

  // …и то же самое с РАЗВЁРНУТОЙ полосой: она шире свёрнутой на 132 px, и предел обязан это учесть
  const былаШирокой = S.settings.sideWide;
  S.settings.sideWide = true; applySide(); await ж(150);
  S.settings.asideFrac = 0.75; asideApplyWidth(); await ж(100);
  t.push({имя:"с подписями в левой полосе панель тоже помещается",
          ок: шир("aside") + хвост() <= window.innerWidth + 2,
          факт: "полоса " + шир("side") + ", панель " + шир("aside") + ", окно " + window.innerWidth});
  S.settings.sideWide = былаШирокой; applySide(); await ж(150);
  S.settings.asideFrac = доля; asideApplyWidth();
}

/* ПАНЕЛЬ НЕ ПРЫГАЕТ ПРИ ПЕРЕКЛЮЧЕНИИ НА ПОЛОТНО (КРОЛИК, 2026-08-11). Раньше открытие
   ноды-полотна принудительно раздвигало панель минимум до BOARD_MIN (790 px) — уход с неё
   возвращал обычную ширину, и панель прыгала при каждом переключении между узкой карточкой
   и полотном. Узкая доска и так умеет показать себя статично (сообщение + кнопка «Открыть
   доску» в renderAside) — этого достаточно, принудительно раздвигать панель не нужно. */
{
  const доляУзкая = S.settings.asideFrac;
  S.settings.asideFrac = 0.25;   // заведомо меньше (BOARD_MIN=790)/окно — иначе не отличить от «просто широкое»
  const обычная = addItem({kind:"task", title:"тест-ширина-обычная"});
  const полотно = addItem({kind:"flow", title:"тест-ширина-полотна"});
  recomputeHierarchy();

  asideSelect(обычная.id); await ж(150);
  const базовая = шир("aside");
  asideSelect(полотно.id); await ж(150);
  const наПолотне = шир("aside");
  t.push({имя:"открытие полотна не раздвигает панель принудительно",
          ок: Math.abs(наПолотне - базовая) < 3 && наПолотне < BOARD_MIN,
          факт:"на обычной карточке " + базовая + " px, на полотне " + наПолотне + " px (BOARD_MIN " + BOARD_MIN + ")"});
  asideSelect(обычная.id); await ж(150);
  t.push({имя:"уход с полотна не меняет ширину (не прыгает обратно)",
          ок: шир("aside") === базовая, факт: шир("aside") + " px, было " + базовая + " px"});

  [обычная, полотно].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); asideSelect(null);
  S.settings.asideFrac = доляУзкая; asideApplyWidth();
}

// панель прячется и это переживает перерисовку
S.settings.asideOn = false; renderAside(); await ж(100);
t.push({имя:"панель прячется", ок: document.getElementById("aside").classList.contains("off"), факт:""});
S.settings.asideOn = true; renderAside();

// удалённый элемент не должен висеть в панели
asideSelect(нота.id); await ж(100);
hardDeleteItem(нота.id); renderAside(); await ж(100);
t.push({имя:"удалённый элемент уходит из панели", ок: !!document.querySelector(".aside-empty"),
        факт: document.querySelector(".as-title") ? "остался" : "панель пуста"});

/* ===== папка броском из проводника =====
   Жест держится на трёх звеньях сразу: подсветка цели, отправка FileList в WebView2 и
   забор пути мостом. Отвалиться любое из них может молча — бросок просто «не сработает»,
   и человек решит, что промахнулся. Подставляем мост приложения и проверяем всю цепочку. */
{
  const зад = addItem({kind:"task", title:"Нода для броска папки"});
  asideSelect(зад.id); await ж(200);

  const бросок = (тип) => {
    const кн = document.querySelector('#aside [data-folder]');
    const строка = кн && кн.closest(".as-row");
    if (!строка) return null;
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "кадр.exr"));
    строка.dispatchEvent(new DragEvent(тип, {bubbles:true, cancelable:true, dataTransfer:dt}));
    return строка;
  };

  const строка = бросок("dragover");
  t.push({имя:"строка папки подсвечивается под брошенным файлом",
          ок: !!строка && строка.classList.contains("fdrop"),
          факт: строка ? строка.className : "строки папки нет"});
  строка.dispatchEvent(new DragEvent("dragleave", {bubbles:true, cancelable:true, dataTransfer:new DataTransfer()}));
  t.push({имя:"подсветка снимается, когда курсор ушёл",
          ок: !строка.classList.contains("fdrop"), факт: строка.className});

  // подставной мост: chrome.webview принимает FileList, python отдаёт путь
  const былоPy = window.pywebview, былоChrome = window.chrome;
  let послано = null;
  window.chrome = {webview: {postMessageWithAdditionalObjects: (m, f) => { послано = m + ":" + f.length; }}};
  window.pywebview = {api: {load: () => {}, take_drop_folder: async () => послано ? "E:\\Проект\\SQ01\\SH010" : ""}};

  бросок("drop"); await ж(500);
  t.push({имя:"брошенная папка привязывается к ноде",
          ок: послано === "FilesDropped:1" && зад.folder === "E:\\Проект\\SQ01\\SH010",
          факт: "в WebView2 ушло «" + послано + "», в ноде: " + (зад.folder || "пусто")});
  t.push({имя:"привязанный путь сразу виден в панели",
          ок: /SH010/.test((document.querySelector("#aside .as-path") || {}).textContent || ""),
          факт: (document.querySelector("#aside .as-path") || {}).textContent || "пути в панели нет"});

  // мимо приложения (браузер) жест обязан ЧЕСТНО отказать, а не молча съесть бросок
  зад.folder = undefined; renderAside(); await ж(150);
  window.chrome = былоChrome; window.pywebview = былоPy;
  бросок("drop"); await ж(300);
  t.push({имя:"без моста приложения бросок не выдумывает путь",
          ок: !зад.folder, факт: "в ноде: " + (зад.folder || "пусто")});

  if (былоPy === undefined) delete window.pywebview; else window.pywebview = былоPy;
  if (былоChrome === undefined) delete window.chrome; else window.chrome = былоChrome;
  hardDeleteItem(зад.id); asideSelect(null); await ж(100);
}

hardDeleteItem(пол.id); asideId = null; render();
return t;
