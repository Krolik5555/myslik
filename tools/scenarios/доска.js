// Доска (Excalidraw). Каждая проверка здесь — след от реального дефекта, найденного разбором:
// мобильная раскладка из-за высоты контейнера, светло-серый холст из-за фона под инверсией,
// мёртвые горячие клавиши из-за перехвата в capture-фазе, потеря штриха при закрытии окна.
//
// Чего сценарий НЕ проверяет: рисование настоящей мышью. Excalidraw игнорирует синтетические
// PointerEvent (проверено — ни на interactive-холсте, ни через window ничего не создаётся),
// поэтому жесты проверяются руками, а здесь — API и клавиатура.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const живо = () => typeof drawApi !== "undefined" && !!drawApi && !!document.querySelector("#draw-host canvas");

const былВид = view;
const былаДоска = JSON.parse(JSON.stringify(S.draw || {}));

view = "draw"; render();
let ждём = 0;
while (ждём < 25000 && !живо()) { await ж(200); ждём += 200; }
await ж(400);

t.push({имя:"вкладка «Доска» есть в меню", ок: !!document.querySelector('.navi[data-v="draw"]'),
        факт: "кнопок в меню: " + document.querySelectorAll(".navi").length});
t.push({имя:"вендор подгрузился лениво", ок: !!window.ExcalidrawLib,
        факт: window.ExcalidrawLib ? "экспортов: " + Object.keys(window.ExcalidrawLib).length : "ExcalidrawLib не появился"});
t.push({имя:"доска смонтировалась", ок: живо(),
        факт: "холстов: " + document.querySelectorAll("#draw-host canvas").length + ", ждали " + ждём + " мс"});
if (!живо()) { view = былВид; render(); return t; }

const кор = document.querySelector("#draw-host .excalidraw");
const рект = кор.getBoundingClientRect();
const st = () => drawApi.getAppState();

// раскладка: телефонный интерфейс приезжает при ширине < 730 или высоте < 500 при ширине < 1000
t.push({имя:"раскладка десктопная, не мобильная",
        ок: !кор.classList.contains("excalidraw--mobile")
            && document.querySelectorAll(".App-toolbar--mobile, .App-bottom-bar, .mobile-misc-tools-container").length === 0,
        факт: Math.round(рект.width) + "x" + Math.round(рект.height)});
t.push({имя:"доска занимает весь экран", ок: рект.width >= window.innerWidth - 2 && рект.height >= window.innerHeight - 60,
        факт: "окно " + window.innerWidth + "x" + window.innerHeight});

// фон холста: тёмную тему Excalidraw делает инверсией, поэтому исходник обязан быть светлым
t.push({имя:"фон холста не уходит в серую простыню", ок: st().viewBackgroundColor !== "#1b1b1b",
        факт: "фон: " + st().viewBackgroundColor + ", тема: " + st().theme});

// горячие клавиши самой доски (ломались перехватом в capture-фазе — тогда были мертвы все)
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"r", code:"KeyR", bubbles:true, cancelable:true}));
await ж(150);
const инстр1 = st().activeTool.type;
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"o", code:"KeyO", bubbles:true, cancelable:true}));
await ж(150);
t.push({имя:"горячие клавиши доски работают", ок: инстр1 === "rectangle" && st().activeTool.type === "ellipse",
        факт: "r → " + инстр1 + ", o → " + st().activeTool.type});

// ...и при этом не утекают в глобальные хоткеи Мыслика
let утекло = false;
const шпион = () => { утекло = true; };
document.addEventListener("keydown", шпион);
кор.dispatchEvent(new KeyboardEvent("keydown", {key:"z", code:"KeyZ", ctrlKey:true, bubbles:true, cancelable:true}));
await ж(60);
document.removeEventListener("keydown", шпион);
t.push({имя:"Ctrl+Z не утекает в глобальную отмену", ок: !утекло,
        факт: утекло ? "дошло до document" : "погашено на доске"});

// сцена и настройки инструмента
drawApi.setActiveTool({type:"selection"});
drawApi.updateScene({elements: ExcalidrawLib.convertToExcalidrawElements([
  {type:"rectangle", x:100, y:100, width:220, height:120, label:{text:"Проверка"}},
  {type:"ellipse", x:400, y:140, width:140, height:140}
]), appState:{currentItemStrokeColor:"#e03131", currentItemStrokeWidth:4}});
await ж(1400);   // дебаунс записи доски — 900 мс
t.push({имя:"нарисованное попало в сцену", ок: drawApi.getSceneElements().length >= 2,
        факт: "элементов: " + drawApi.getSceneElements().length});
t.push({имя:"сцена сохранена в общий файл", ок: (S.draw.elements || []).length >= 2,
        факт: "в S.draw.elements: " + (S.draw.elements || []).length});

// повторный render() не должен пересобирать доску (иначе слетают инструмент и история)
const корень1 = drawRoot, холст1 = document.querySelector("#draw-host canvas");
render(); await ж(300);
t.push({имя:"повторный render() не пересобирает доску",
        ок: drawRoot === корень1 && document.querySelector("#draw-host canvas") === холст1,
        факт: drawRoot === корень1 ? "корень тот же" : "корень пересоздан"});

// уход с вкладки снимает слой целиком
view = "today"; render(); await ж(400);
t.push({имя:"уход с вкладки снимает доску",
        ок: !document.getElementById("draw-screen") && drawRoot === null,
        факт: "слой: " + (document.getElementById("draw-screen") ? "остался" : "снят")});

// возврат: сцена и настройки пера поднимаются из S.draw
view = "draw"; render();
ждём = 0; while (ждём < 20000 && !живо()) { await ж(200); ждём += 200; }
await ж(500);
t.push({имя:"после возврата рисунок на месте", ок: живо() && drawApi.getSceneElements().length >= 2,
        факт: живо() ? "элементов: " + drawApi.getSceneElements().length : "доска не поднялась"});
t.push({имя:"настройки пера переживают уход", ок: st().currentItemStrokeColor === "#e03131" && st().currentItemStrokeWidth === 4,
        факт: "цвет " + st().currentItemStrokeColor + ", толщина " + st().currentItemStrokeWidth});

// смена темы на открытой доске применяется без пересборки
const темаБыла = S.settings.theme;
toggleTheme(); await ж(500);
t.push({имя:"смена темы доходит до доски", ок: st().theme === (темаБыла === "light" ? "dark" : "light"),
        факт: "тема доски: " + st().theme});
toggleTheme(); await ж(400);

// закрытие окна: штрих, сделанный за миг до, обязан попасть в S без ожидания дебаунса
drawApi.updateScene({elements: drawApi.getSceneElements().concat(
  ExcalidrawLib.convertToExcalidrawElements([{type:"text", x:120, y:400, text:"перед закрытием", fontSize:18}]))});
const сразу = drawFlush();
t.push({имя:"drawFlush дожимает запись мгновенно",
        ок: сразу && (S.draw.elements || []).length === drawApi.getSceneElements().length,
        факт: "в S.draw: " + (S.draw.elements || []).length + ", на доске: " + drawApi.getSceneElements().length});

// картинки: неиспользуемые файлы не должны копиться в planner.json
drawApi.addFiles([{id:"файл-сирота", dataURL:"data:image/png;base64,iVBORw0KGgo=", mimeType:"image/png", created:1}]);
await ж(200); drawFlush();
t.push({имя:"картинка без элемента не оседает в файле",
        ок: !(S.draw.files || {})["файл-сирота"],
        факт: "файлов в S.draw: " + Object.keys(S.draw.files || {}).length});

// чужое меню вендора заменено своим
t.push({имя:"в меню нет чужих ссылок",
        ок: document.querySelectorAll('#draw-host a[href*="excalidraw.com"], #draw-host a[href*="discord"]').length === 0,
        факт: "чужих ссылок: " + document.querySelectorAll('#draw-host a[href*="excalidraw.com"], #draw-host a[href*="discord"]').length});

// мусор из чужого файла не должен валить вкладку
const битая = sanitizeState({draw:{elements:[null, 42, "текст", {type:"rectangle", id:"ok1"}], files:null, appState:7}});
t.push({имя:"мусорная сцена отсеивается при загрузке",
        ок: битая.draw.elements.length === 1 && typeof битая.draw.files === "object" && typeof битая.draw.appState === "object",
        факт: "осталось элементов: " + битая.draw.elements.length});

// кнопка «Назад» возвращает в приложение
drawBack = "today";
$("#draw-back").click(); await ж(400);
t.push({имя:"«Назад» закрывает доску и возвращает вид",
        ок: !document.getElementById("draw-screen") && view === "today",
        факт: "вид: " + view});

// убираем за собой
view = былВид;
S.draw = былаДоска.elements ? былаДоска : {elements:[], files:{}, appState:{}};
render();
return t;
