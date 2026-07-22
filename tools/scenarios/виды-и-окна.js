// Вкладки, окна и отчёт: то, что должно просто открываться и закрываться.
// Проверка отчёта тут не случайно: он однажды перестал существовать целиком, и заметил это
// не разработчик, а владелец приложения.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const ошибки = [];
const прежний = console.error;
console.error = (...a) => { ошибки.push(a.join(" ")); прежний(...a); };

for (const v of ["today", "tasks", "notes", "board", "cal", "bin"]){
  let ок = true, факт = "";
  try { view = v; render(); await ж(60); }
  catch(e){ ок = false; факт = e.message; }
  t.push({имя:"вкладка " + v + " рисуется", ок, факт});
}

view = "notes"; render(); await ж(120);
t.push({имя:"граф создаётся на вкладке заметок", ок: !!graph, факт: graph ? graph.nodes.length + " узлов" : ""});

const заметка = S.items.find(i => i.kind === "note");
const окна = [
  ["ридер заметки", () => openNoteReader(заметка)],
  ["редактор элемента", () => openItemEditor(заметка)],
  ["настройки", () => openSettings()],
  ["таймер", () => openTimer()],
  ["области", () => openAreaManager()],
  ["палитра команд", () => openPalette()],
  ["горячие клавиши", () => openShortcuts()],
];
for (const [имя, откр] of окна){
  let ок = true, факт = "";
  try { откр(); await ж(90); ок = document.querySelector("#overlay-root").children.length > 0;
        closeOverlays(); await ж(50);
        if (document.querySelector("#overlay-root").children.length) { ок = false; факт = "не закрылось"; } }
  catch(e){ ок = false; факт = e.message; }
  t.push({имя: имя + " открывается и закрывается", ок, факт});
}

// правка тела заметки сохраняется при закрытии по фону/Esc, а не только по blur
const былоТело = заметка.body;
openNoteReader(заметка); await ж(90);
const тело = document.querySelector("#nr-body");
тело.click(); тело.textContent = "правка из проверки"; await ж(40);
closeOverlays(); await ж(90);
t.push({имя:"правка заметки не теряется при закрытии", ок: заметка.body === "правка из проверки",
        факт:"стало: «" + заметка.body + "»"});
заметка.body = былоТело;

// подтверждение всегда отвечает, даже если окно снесли не кнопкой
let ответ = "висит";
uiConfirm("проверка").then(v => ответ = "ответ: " + v);
await ж(60); closeOverlays(); await ж(60);
t.push({имя:"подтверждение не зависает при закрытии", ок: ответ !== "висит", факт: ответ});

// отчёт
const выбор = S.items.filter(i => !i.deleted).slice(0, 4);
let текст = "";
try { текст = buildReportText(выбор) || ""; } catch(e){ текст = "ошибка: " + e.message; }
t.push({имя:"отчёт собирается", ок: текст.length > 20 && !текст.startsWith("ошибка"),
        факт: текст.slice(0, 60).replace(/\n/g, " ⏎ ")});
try { openReportModal(выбор); await ж(120);
      t.push({имя:"окно отчёта открывается", ок: !!document.querySelector("#rep-out"), факт:""});
      closeOverlays(); }
catch(e){ t.push({имя:"окно отчёта открывается", ок:false, факт:e.message}); }

console.error = прежний;
t.push({имя:"консоль чистая", ок: ошибки.length === 0, факт: ошибки.slice(0, 2).join(" | ")});
return t;
