// Все модули фронта читаются целиком.
// Ловит поломку, из-за которой файл молча перестаёт исполняться и его функции исчезают —
// именно так однажды умер report.js: в строку попал настоящий перевод строки.
const t = [];
const файлы = ["core.js","model.js","views.js","graph.js","overlays.js","draw.js","fields.js","ai.js","report.js","main.js"];
for (const f of файлы){
  let src = "";
  try { src = await fetch("js/" + f + "?x=" + Date.now()).then(r=>r.text()); }
  catch(e){ t.push({имя:"читается " + f, ок:false, факт:"не скачался: " + e}); continue; }
  try { new Function(src); t.push({имя:"читается " + f, ок:true, факт:Math.round(src.length/1024)+" КБ"}); }
  catch(e){ t.push({имя:"читается " + f, ок:false, факт:e.message}); }
}
// точки входа каждого модуля должны существовать в глобальной области
const точки = {"core.js":"persist","model.js":"parseCapture","views.js":"render","graph.js":"renderNotes",
  "overlays.js":"openNoteReader","draw.js":"openBoard","fields.js":"fieldsPanel",
  "ai.js":"aiToggle","report.js":"repOpen","main.js":"boot"};
for (const [f, fn] of Object.entries(точки)){
  t.push({имя:"загружен " + f, ок: typeof window[fn] === "function", факт: fn + ": " + typeof window[fn]});
}
return t;
