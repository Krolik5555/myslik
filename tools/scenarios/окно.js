// Кнопки окна и перетаскивание титлбара.
// Перемещение окна делает встроенный механизм pywebview (класс .pywebview-drag-region,
// обработка внутри движка) — из JS его не инициировать, поэтому проверяем то, что можно:
// класс на месте (драг активен), кнопки и дабл-клик работают и не мешают друг другу.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

const журнал = [];
const прежний = window.pywebview;
// load обязателен: HasPy() проверяет именно его, а обработчики окна зовут мост только при HasPy()
window.pywebview = {api: {
  load:    async () => null,
  save:    async () => true,
  win_max: () => { журнал.push("max"); return true; },
  win_min: () => { журнал.push("min"); return true; },
}};

const tb = document.querySelector("#titlebar");
t.push({имя:"титлбар — область перетаскивания окна (pywebview-drag-region)",
        ок: tb.classList.contains("pywebview-drag-region"), факт: tb.className});

// дабл-клик по титлбару → развернуть/восстановить
журнал.length = 0;
tb.dispatchEvent(new MouseEvent("dblclick", {clientX:300, clientY:12, bubbles:true, cancelable:true}));
await ж(20);
t.push({имя:"дабл-клик по титлбару разворачивает окно", ок: журнал.includes("max"), факт: журнал.join(",") || "ничего"});

// дабл-клик по кнопкам окна НЕ должен разворачивать (иначе кнопка «развернуть» дважды переключает)
журнал.length = 0;
document.querySelector(".winbtns").dispatchEvent(new MouseEvent("dblclick", {clientX:0, clientY:0, bubbles:true, cancelable:true}));
await ж(20);
t.push({имя:"дабл-клик по зоне кнопок не разворачивает окно", ок: !журнал.includes("max"), факт: журнал.join(",") || "ничего"});

// кнопки
журнал.length = 0;
document.querySelector("#win-max").click(); await ж(10);
t.push({имя:"кнопка «Развернуть» работает", ок: журнал.includes("max"), факт: журнал.join(",")});
журнал.length = 0;
document.querySelector("#win-min").click(); await ж(10);
t.push({имя:"кнопка «Свернуть» работает", ок: журнал.includes("min"), факт: журнал.join(",")});

if (прежний === undefined) delete window.pywebview; else window.pywebview = прежний;
return t;
