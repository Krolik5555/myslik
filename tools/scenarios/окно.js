// Перетаскивание окна за титлбар и кнопки окна.
// Цель — Aero Snap (разворот при перетаскивании к верху). Сам Snap рисует Windows и руками
// его тут не проверить, но можно проверить ЛОГИКУ, чтобы правка ничего не сломала:
// движение за порог запускает нативный move-loop, а клик по кнопке и дабл-клик — нет.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

// перехватываем вызовы к мосту, не трогая настоящее окно
const журнал = [];
const прежний = window.pywebview;
// load обязателен: HasPy() проверяет именно его, а обработчики окна зовут мост только при HasPy()
window.pywebview = {api: {
  load:          async () => null,
  save:          async () => true,
  win_startdrag: () => { журнал.push("startdrag"); return true; },
  win_max:       () => { журнал.push("max"); return true; },
  win_min:       () => { журнал.push("min"); return true; },
}};

const tb = document.querySelector("#titlebar");
const жест = (эл, тип, x, y, доп={}) => эл.dispatchEvent(new PointerEvent(тип,
  {clientX:x, clientY:y, bubbles:true, cancelable:true, pointerId:1, button:0, buttons:1, ...доп}));

t.push({имя:"титлбар больше не pywebview-drag-region (ручной драг без Snap выключен)",
        ок: !tb.classList.contains("pywebview-drag-region"), факт: tb.className || "без классов"});

// перетаскивание за порог → нативный move-loop
журнал.length = 0;
жест(tb, "pointerdown", 300, 12); await ж(20);
жест(tb, "pointermove", 340, 12); await ж(20);       // 40px вправо — заведомо за порог
жест(tb, "pointerup", 340, 12);
t.push({имя:"перетаскивание титлбара запускает нативный move-loop",
        ок: журнал.filter(x => x === "startdrag").length === 1,
        факт: "startdrag ×" + журнал.filter(x => x === "startdrag").length});

// микродвижение в пределах порога → НЕ драг (иначе клик не отличить от перетаскивания)
журнал.length = 0;
жест(tb, "pointerdown", 300, 12); await ж(20);
жест(tb, "pointermove", 302, 13); await ж(20);       // 2px — дрожание руки при клике
жест(tb, "pointerup", 302, 13);
t.push({имя:"клик по титлбару в пределах порога не тащит окно",
        ок: !журнал.includes("startdrag"), факт: журнал.join(",") || "ничего"});

// дабл-клик по титлбару → разворот, а не move-loop
журнал.length = 0;
жест(tb, "pointerdown", 300, 12); жест(tb, "pointerup", 300, 12);
жест(tb, "pointerdown", 300, 12); жест(tb, "pointerup", 300, 12);
tb.dispatchEvent(new MouseEvent("dblclick", {clientX:300, clientY:12, bubbles:true, cancelable:true}));
await ж(30);
t.push({имя:"дабл-клик по титлбару разворачивает окно, а не тащит",
        ок: журнал.includes("max") && !журнал.includes("startdrag"),
        факт: журнал.join(",") || "ничего"});

// клик по кнопке «Развернуть» → max, и НЕ move-loop
журнал.length = 0;
const btnMax = document.querySelector("#win-max");
жест(btnMax, "pointerdown", 0, 0); жест(btnMax, "pointermove", 30, 0);   // даже с движением по кнопке
btnMax.click(); await ж(20);
t.push({имя:"кнопка «Развернуть» не запускает перетаскивание",
        ок: журнал.includes("max") && !журнал.includes("startdrag"),
        факт: журнал.join(",") || "ничего"});

// кнопка «Свернуть» работает
журнал.length = 0;
document.querySelector("#win-min").click(); await ж(20);
t.push({имя:"кнопка «Свернуть» работает", ок: журнал.includes("min"), факт: журнал.join(",")});

if (прежний === undefined) delete window.pywebview; else window.pywebview = прежний;
return t;
