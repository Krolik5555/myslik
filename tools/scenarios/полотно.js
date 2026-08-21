// Полотно = доска Excalidraw внутри ноды. Каждая проверка — след от реального дефекта:
// мобильная раскладка из-за размера контейнера, светло-серый холст из-за фона под инверсией,
// мёртвые горячие клавиши из-за перехвата в capture-фазе, потеря штриха при закрытии окна,
// затирание нарисованного повторной конвертацией старой схемы.
//
// Чего сценарий НЕ проверяет: рисование настоящей мышью. Excalidraw игнорирует синтетические
// PointerEvent (проверено — ни на interactive-холсте, ни через window ничего не создаётся),
// поэтому жесты проверяются руками, а здесь — API и клавиатура.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const живо = () => typeof drawApi !== "undefined" && !!drawApi && !!document.querySelector("#draw-host canvas");
const ждать = async (усл, предел=25000) => { let n=0; while(n<предел && !усл()){ await ж(200); n+=200; } return n; };

// нода со СТАРОЙ схемой: проверяем заодно перенос блоков на доску
const схема = addItem({kind:"flow", title:"Проверка полотна"});
схема.flow = {
  blocks:[
    {id:"b1", type:"terminal", text:"Старт",  note:"", x:100, y:100, w:132, h:52, color:null, parent:null},
    {id:"b2", type:"proc",     text:"Шаг",    note:"", x:100, y:220, w:160, h:64, color:"#d67fb0", parent:null},
    {id:"b3", type:"decision", text:"Решение", note:"", x:100, y:340, w:192, h:72, color:null, parent:null}
  ],
  edges:[{id:"e1", from:"b1", to:"b2", label:""}, {id:"e2", from:"b2", to:"b3", label:"да"}],
  view:{tx:0, ty:0, zoom:1, edgeStyle:"ortho"}
};

openItemSmart(схема);
await ждать(живо);
await ж(500);

t.push({имя:"полотно открывает доску", ок: живо() && !!document.getElementById("draw-screen"),
        факт: "холстов: " + document.querySelectorAll("#draw-host canvas").length});
if (!живо()) { hardDeleteItem(схема.id); render(); return t; }

const кор = document.querySelector("#draw-host .excalidraw");
const рект = кор.getBoundingClientRect();
const st = () => drawApi.getAppState();

t.push({имя:"в шапке имя ноды", ок: ($("#draw-name").textContent||"").indexOf("Проверка полотна") >= 0,
        факт: $("#draw-name").textContent});

// перенос старой схемы: 3 блока + 2 стрелки + подписи внутри фигур
const элементы = drawApi.getSceneElements();
t.push({имя:"старая схема перенесена на доску", ок: элементы.filter(e=>e.type==="rectangle").length === 3,
        факт: "прямоугольников: " + элементы.filter(e=>e.type==="rectangle").length + ", стрелок: " + элементы.filter(e=>e.type==="arrow").length});
t.push({имя:"подписи блоков не потерялись",
        ок: элементы.filter(e=>e.type==="text").map(e=>e.text).join("|").indexOf("Старт") >= 0,
        факт: элементы.filter(e=>e.type==="text").map(e=>e.text).join(", ")});
t.push({имя:"стрелки привязаны к фигурам",
        ок: элементы.filter(e=>e.type==="arrow" && e.startBinding && e.endBinding).length === 2,
        факт: "привязанных: " + элементы.filter(e=>e.type==="arrow" && e.startBinding && e.endBinding).length});
t.push({имя:"цвет блока ушёл в обводку, а не в заливку",
        ок: элементы.some(e=>e.type==="rectangle" && String(e.strokeColor).toLowerCase()==="#d67fb0"),
        факт: элементы.filter(e=>e.type==="rectangle").map(e=>e.strokeColor).join(", ")});
t.push({имя:"исходная схема осталась в ноде как страховка",
        ок: (схема.flow.blocks || []).length === 3, факт: "блоков в it.flow: " + (схема.flow.blocks||[]).length});
t.push({имя:"доска записана в S.boards, а не в ноду",
        ок: !!(S.boards && S.boards[схема.id]) && схема.draw === undefined,
        факт: "элементов в S.boards: " + ((S.boards[схема.id]||{}).elements||[]).length});

// раскладка и фон
t.push({имя:"раскладка десктопная, не мобильная",
        ок: !кор.classList.contains("excalidraw--mobile")
            && document.querySelectorAll(".App-toolbar--mobile, .App-bottom-bar, .mobile-misc-tools-container").length === 0,
        факт: Math.round(рект.width) + "x" + Math.round(рект.height)});
t.push({имя:"фон холста не уходит в серую простыню", ок: st().viewBackgroundColor !== "#1b1b1b",
        факт: "фон: " + st().viewBackgroundColor + ", тема: " + st().theme});

// горячие клавиши доски живы, но не утекают в глобальные
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"r", code:"KeyR", bubbles:true, cancelable:true}));
await ж(150);
const инстр1 = st().activeTool.type;
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"o", code:"KeyO", bubbles:true, cancelable:true}));
await ж(150);
t.push({имя:"горячие клавиши доски работают", ок: инстр1 === "rectangle" && st().activeTool.type === "ellipse",
        факт: "r → " + инстр1 + ", o → " + st().activeTool.type});
/* ТЕ ЖЕ КЛАВИШИ НА РУССКОЙ РАСКЛАДКЕ. Вендор ищет букву в e.key, и с русской раскладки ему
   приходит «к» вместо «r» — ни один инструмент не совпадает, клавиши мертвы. Подменяет событие
   мост раскладки в draw.js (по e.code, он от раскладки не зависит). */
drawApi.setActiveTool({type:"selection"});
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"к", code:"KeyR", bubbles:true, cancelable:true}));
await ж(150);
const рус1 = st().activeTool.type;
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"щ", code:"KeyO", bubbles:true, cancelable:true}));
await ж(150);
t.push({имя:"горячие клавиши доски работают и на русской раскладке",
        ок: рус1 === "rectangle" && st().activeTool.type === "ellipse",
        факт: "к → " + рус1 + ", щ → " + st().activeTool.type});
// а вот в поле ввода подмены быть не должно: там клавиша — это буква, а не команда
{
  const поле = document.createElement("input"); кор.appendChild(поле); поле.focus();
  let подменено = false;
  const шпион = e => { if (e.key === "r") подменено = true; };
  поле.addEventListener("keydown", шпион);
  поле.dispatchEvent(new KeyboardEvent("keydown", {key:"к", code:"KeyR", bubbles:true, cancelable:true}));
  await ж(60);
  поле.removeEventListener("keydown", шпион); поле.remove();
  t.push({имя:"в поле ввода буква остаётся буквой", ок: !подменено,
          факт: подменено ? "«к» подменилась на «r»" : "подмены нет"});
}
let утекло = false;
const шпион = () => { утекло = true; };
document.addEventListener("keydown", шпион);
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"z", code:"KeyZ", ctrlKey:true, bubbles:true, cancelable:true}));
await ж(60);
document.removeEventListener("keydown", шпион);
t.push({имя:"Ctrl+Z не утекает в глобальную отмену", ок: !утекло,
        факт: утекло ? "дошло до document" : "погашено на доске"});

// дорисовываем и проверяем сохранение
drawApi.setActiveTool({type:"selection"});
drawApi.updateScene({elements: drawApi.getSceneElements().concat(
  ExcalidrawLib.convertToExcalidrawElements([{type:"ellipse", x:420, y:120, width:140, height:140}])),
  appState:{currentItemStrokeColor:"#e03131", currentItemStrokeWidth:4}});
await ж(1400);   // дебаунс записи доски — 900 мс
const всего = drawApi.getSceneElements().length;
t.push({имя:"дорисованное сохраняется в доску ноды",
        ок: (S.boards[схема.id].elements || []).length === всего,
        факт: "в S.boards: " + (S.boards[схема.id].elements||[]).length + ", на доске: " + всего});

// повторный render() не должен пересобирать доску и не должен её закрывать
const корень1 = drawRoot, холст1 = document.querySelector("#draw-host canvas");
render(); await ж(300);
t.push({имя:"render() не закрывает и не пересобирает доску",
        ок: !!document.getElementById("draw-screen") && drawRoot === корень1
            && document.querySelector("#draw-host canvas") === холст1,
        факт: document.getElementById("draw-screen") ? "жива" : "закрылась"});

// смена темы на открытой доске
const темаБыла = S.settings.theme;
toggleTheme(); await ж(500);
t.push({имя:"смена темы доходит до доски", ок: st().theme === (темаБыла === "light" ? "dark" : "light"),
        факт: "тема доски: " + st().theme});
toggleTheme(); await ж(400);

// мгновенное дожатие записи (как при закрытии окна)
drawApi.updateScene({elements: drawApi.getSceneElements().concat(
  ExcalidrawLib.convertToExcalidrawElements([{type:"text", x:120, y:520, text:"перед закрытием", fontSize:18}]))});
const сразу = drawFlush();
t.push({имя:"drawFlush дожимает запись мгновенно",
        ок: сразу && (S.boards[схема.id].elements||[]).length === drawApi.getSceneElements().length,
        факт: "в S.boards: " + (S.boards[схема.id].elements||[]).length});

// картинка без элемента не должна оседать в файле
drawApi.addFiles([{id:"файл-сирота", dataURL:"data:image/png;base64,iVBORw0KGgo=", mimeType:"image/png", created:1}]);
await ж(200); drawFlush();
t.push({имя:"картинка без элемента не оседает в ноде",
        ок: !((S.boards[схема.id].files||{})["файл-сирота"]),
        факт: "файлов: " + Object.keys(S.boards[схема.id].files||{}).length});

// закрытие и повторное открытие: рисунок на месте, старая схема НЕ конвертируется заново
const былоЭлементов = drawApi.getSceneElements().length;
$("#draw-back").click(); await ж(400);
t.push({имя:"«Назад» закрывает доску", ок: !document.getElementById("draw-screen"),
        факт: "слой: " + (document.getElementById("draw-screen") ? "остался" : "снят")});

openItemSmart(схема);
await ждать(живо);
await ж(500);
t.push({имя:"после возврата рисунок на месте (повторной конвертации нет)",
        ок: живо() && drawApi.getSceneElements().length === былоЭлементов,
        факт: живо() ? "элементов: " + drawApi.getSceneElements().length + " (было " + былоЭлементов + ")" : "доска не открылась"});
t.push({имя:"настройки пера пережили закрытие", ок: st().currentItemStrokeColor === "#e03131",
        факт: "цвет " + st().currentItemStrokeColor + ", толщина " + st().currentItemStrokeWidth});

// вторая нода открывает СВОЮ доску, а не чужую
const пустое = addItem({kind:"flow", title:"Второе полотно"});
openItemSmart(пустое);
await ждать(()=> живо() && drawItem && drawItem.id === пустое.id);
await ж(600);
t.push({имя:"у каждой ноды своя доска",
        ок: живо() && drawApi.getSceneElements().length === 0,
        факт: "элементов на второй доске: " + (живо() ? drawApi.getSceneElements().length : -1)});

// удаление ноды уносит её доску
$("#draw-back").click(); await ж(300);
hardDeleteItem(пустое.id);
t.push({имя:"удаление ноды уносит доску", ок: !(S.boards||{})[пустое.id],
        факт: "ключей в S.boards: " + Object.keys(S.boards||{}).length});

// мусор из чужого файла не должен валить доску
const битая = sanitizeState({items:[], boards:{x:{elements:[null, 42, "текст", {type:"rectangle", id:"ok1"}], files:null, appState:7}}});
t.push({имя:"мусорная сцена отсеивается при загрузке",
        ок: битая.boards.x.elements.length === 1 && typeof битая.boards.x.files === "object",
        факт: "осталось элементов: " + битая.boards.x.elements.length});

// убираем за собой
hardDeleteItem(схема.id);
render();
return t;
