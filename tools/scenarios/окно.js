// Управление окном.
// Полоса заголовка теперь НАТИВНАЯ (рисуется Windows, см. _install_native_titlebar в app.py) —
// ради Aero Snap: пока браузер накрывал окно целиком, система не видела перетаскивания.
// Отсюда и проверки: в разметке титлбара быть не должно, а закрытие обязано идти через
// appRequestClose, иначе окно рвётся раньше, чем правка доедет до диска.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

t.push({имя:"HTML-титлбара нет (полоса нативная)", ок: !document.querySelector("#titlebar"),
        факт: document.querySelector("#titlebar") ? "элемент остался" : ""});
t.push({имя:"кнопок окна в разметке нет", ок: !document.querySelector(".winbtns"), факт:""});
t.push({имя:"вёрстка не сдвинута", ок: !!document.querySelector("#topbar") && !!document.querySelector("#body"),
        факт:"topbar и body на месте"});

// закрытие: сначала сохранение, потом win_close — иначе теряется последнее действие
const журнал = [];
const прежний = window.pywebview;
window.pywebview = {api: {
  load: async () => null,
  save: async (s) => { журнал.push("save"); return true; },
  win_close: () => { журнал.push("win_close"); return true; },
  set_titlebar_theme: (d) => { журнал.push("тема:" + (d ? "тёмная" : "светлая")); return true; },
}};

t.push({имя:"appRequestClose существует", ок: typeof window.appRequestClose === "function", факт:""});
if (typeof window.appRequestClose === "function"){
  addItem({kind:"task", title:"Мысль перед закрытием"});
  await window.appRequestClose();
  await ж(120);
  const п = журнал.join(" → ");
  t.push({имя:"закрытие сохраняет ДО того, как рвёт окно",
          ок: /save\s*→\s*win_close/.test(п), факт: п || "ничего не произошло"});
  const мусор = S.items.find(i => i.title === "Мысль перед закрытием");
  if (мусор) hardDeleteItem(мусор.id);
}

// тема: нативная полоса про CSS не знает, ей сообщают отдельно
журнал.length = 0;
const былаТема = S.settings.theme;
S.settings.theme = "light"; applySettings(); await ж(40);
t.push({имя:"светлая тема доходит до нативной полосы", ок: журнал.includes("тема:светлая"), факт: журнал.join(",")});
журнал.length = 0;
S.settings.theme = "dark"; applySettings(); await ж(40);
t.push({имя:"тёмная тема доходит до нативной полосы", ок: журнал.includes("тема:тёмная"), факт: журнал.join(",")});
S.settings.theme = былаТема; applySettings();

if (прежний === undefined) delete window.pywebview; else window.pywebview = прежний;
return t;
