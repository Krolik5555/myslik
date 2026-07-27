/* Доска — Excalidraw внутри Мыслика.

   Вендор лежит в ui/vendor/excalidraw/ одним классическим скриптом: приложение грузится
   по file://, где ES-модули блокируются CORS (см. инвариант в CLAUDE.md). Собран он
   одноразово через esbuild, node в проекте не нужен. Внутренности вендора не правятся —
   вся своя логика живёт здесь.

   Доска открывается НА ВЕСЬ ЭКРАН, как полотно (.flow-screen). Причина не в красоте:
   Excalidraw сам решает, показать десктопный интерфейс или телефонный, и решает по размеру
   СВОЕГО контейнера — isMobile = ширина < 730 || (высота < 500 && ширина < 1000).
   Врезка внутри вкладки при окне 1200x800 даёт ~937x493 — семи пикселей не хватало, и
   вместо нормального тулбара приезжала мобильная раскладка с плашкой внизу. На весь экран
   порог недостижим при любом разумном размере окна (минимум окна — 920x640). */

const DRAW_ASSETS = "vendor/excalidraw/";
let drawRoot = null;        // корень React — живёт, пока открыта доска
let drawApi = null;         // excalidrawAPI: чтение и правка сцены снаружи
let drawSaveTimer = null;
let drawLoading = null;     // промис загрузки вендора, чтобы не тянуть файл дважды
let drawBack = "today";     // куда возвращает кнопка «Назад»
let drawHints = null;       // наблюдатель за строкой подсказок (дочищает непереведённое)

function drawLoadLib(){
  if(window.ExcalidrawLib) return Promise.resolve(true);
  if(drawLoading) return drawLoading;
  drawLoading = new Promise(res=>{
    // Путь к шрифтам уходит внутри библиотеки в new URL(), которому относительная строка
    // не годится («Invalid base URL»), — разворачиваем в абсолютный адрес.
    window.EXCALIDRAW_ASSET_PATH = new URL(DRAW_ASSETS, document.baseURI).href;
    const css = document.createElement("link");
    css.rel = "stylesheet"; css.href = DRAW_ASSETS + "excalidraw.css";
    css.dataset.draw = "1";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = DRAW_ASSETS + "excalidraw.js";
    s.dataset.draw = "1";
    const провал = ()=>{
      /* Отпускаем промис И забываем о попытке: файл мог быть занят антивирусом ровно в этот
         момент. Иначе вкладка показывала бы «не загрузилось» до перезапуска приложения. */
      drawLoading = null;
      document.querySelectorAll('[data-draw="1"]').forEach(n=>n.remove());
      res(false);
    };
    s.onload = ()=>{ if(window.ExcalidrawLib) res(true); else провал(); };
    s.onerror = провал;
    document.body.appendChild(s);
  });
  return drawLoading;
}

/* ---------- хранение сцены ---------- */

/* Что из appState переживает уход с доски. Голых scrollX/scrollY/zoom мало: без остального
   человек, настроивший красный тонкий карандаш и сетку, возвращался к чёрному толстому без
   сетки. Список — «пользовательские настройки инструмента», всё остальное (выделение,
   курсоры, открытые панели) намеренно не храним: это состояние момента, а не настройка. */
const DRAW_STATE_KEYS = [
  "scrollX","scrollY","zoom","viewBackgroundColor",
  "currentItemStrokeColor","currentItemBackgroundColor","currentItemFillStyle",
  "currentItemStrokeWidth","currentItemStrokeStyle","currentItemRoughness",
  "currentItemOpacity","currentItemFontFamily","currentItemFontSize",
  "currentItemTextAlign","currentItemRoundness","currentItemArrowType",
  "currentItemStartArrowhead","currentItemEndArrowhead",
  "gridSize","gridModeEnabled","objectsSnapModeEnabled","zenModeEnabled"
];

// Сцена лежит в S.draw и уезжает на диск общей воронкой persist(). Отдельного файла нет
// намеренно: экспорт, импорт и бэкапы Мыслика тогда забирают доску сами собой.
function drawScene(){
  const d = (S.draw && typeof S.draw==="object") ? S.draw : {};
  const был = d.appState && d.appState.scrollX != null;
  const ap = Object.assign({}, d.appState||{});
  /* Фон холста НЕ подкрашиваем под тему приложения. Тёмную тему Excalidraw делает фильтром
     invert(93%) поверх холста: тёмный цвет под инверсией превращается в светлый — ровно та
     «серая простыня», из-за которой доска выглядела чужеродной. Правильный фон в обеих темах
     светлый, тёмным его делает сам фильтр. Заодно чиним данные прежней версии. */
  if(!ap.viewBackgroundColor || ap.viewBackgroundColor==="#1b1b1b") ap.viewBackgroundColor="#ffffff";
  return {
    elements: Array.isArray(d.elements) ? d.elements : [],
    files: (d.files && typeof d.files==="object") ? d.files : {},
    appState: ap,
    scrollToContent: !был   // положение холста помним между заходами; в первый раз — по содержимому
  };
}

function drawStash(){
  if(!drawApi) return false;
  try{
    // Элементы Excalidraw отдаёт замороженными и переиспользует между кадрами — в S кладём
    // копию, иначе следующая же правка молча меняла бы то, что считается сохранённым.
    const els = JSON.parse(JSON.stringify(drawApi.getSceneElements()));
    /* Картинки прибираем сами: getFiles() отдаёт ВЕСЬ внутренний словарь и никогда его не
       чистит — сборку мусора в родном Excalidraw делает обвязка приложения. Без этого
       удалённое фото навсегда оставалось бы в planner.json мегабайтами base64, и весь этот
       объём гонялся бы через мост при каждой правке любой задачи. */
    const нужны = new Set(els.filter(e=>e.fileId).map(e=>e.fileId));
    const было = drawApi.getFiles() || {}, files = {};
    Object.keys(было).forEach(k=>{ if(нужны.has(k)) files[k] = было[k]; });

    const st = drawApi.getAppState(), ap = {};
    DRAW_STATE_KEYS.forEach(k=>{ if(st[k] !== undefined) ap[k] = st[k]; });
    if(st.zoom) ap.zoom = { value: st.zoom.value || 1 };

    S.draw = { elements: els, files: files, appState: ap };
    persist(true);   // тихо: у доски своя история отмены, глобальный Ctrl+Z сюда не годится
    return true;
  }catch(e){ return false; }
}

// onChange у Excalidraw срабатывает на каждое движение мыши — записываем не чаще раза в секунду.
function drawTouch(){
  clearTimeout(drawSaveTimer);
  drawSaveTimer = setTimeout(()=>{ drawSaveTimer=null; drawStash(); }, 900);
}

/* Дожать несохранённое НЕМЕДЛЕННО. Нужен при закрытии окна: между последним штрихом и
   крестиком лежат два дебаунса (900 мс у доски + 250 мс у persist), и без этого вызова
   линия, проведённая за полсекунды до закрытия, на диск не попадала. */
function drawFlush(){
  if(drawSaveTimer){ clearTimeout(drawSaveTimer); drawSaveTimer = null; }
  return drawStash();
}

/* ---------- интерфейс ---------- */

// Строка подсказок вендора переведена не полностью: часть ключей в ru-RU отсутствует и
// показывается по-английски. Вендор не трогаем — дочищаем видимый текст на месте.
const DRAW_HINTS_RU = {
  "Hold Ctrl and Arrow key to create a flowchart": "Ctrl + стрелка — построить блок-схему",
  "Hold Cmd and Arrow key to create a flowchart": "Cmd + стрелка — построить блок-схему",
  "Click to start multiple points, drag for single line": "Клик — ломаная по точкам, протяжка — одна линия",
  "Press Escape to dismiss search": "Escape — закрыть поиск",
  "Double-click or press Enter to edit the crop": "Двойной клик или Enter — обрезать",
  "Press Escape or Enter to finish cropping": "Escape или Enter — закончить обрезку"
};

function drawFixHints(корень){
  const чинить = узел=>{
    const t = (узел.textContent||"").trim();
    if(!t) return;
    for(const англ in DRAW_HINTS_RU){
      if(t === англ || t.startsWith(англ)){
        const рус = DRAW_HINTS_RU[англ] + t.slice(англ.length);
        if(узел.textContent !== рус) узел.textContent = рус;   // без этой сверки наблюдатель зациклится
        return;
      }
    }
  };
  const это_подсказка = у => !!(у && у.closest && у.closest(".HintViewer"));
  drawHints = new MutationObserver(записи=>{
    записи.forEach(з=>{
      const цель = з.target.nodeType===3 ? з.target.parentElement : з.target;
      if(это_подсказка(цель)) чинить(цель);
    });
  });
  drawHints.observe(корень, {childList:true, subtree:true, characterData:true});
  корень.querySelectorAll(".HintViewer, .HintViewer span").forEach(чинить);
}

function drawMenu(){
  /* Своё меню вместо вендорского: в дефолтном лежат ссылки на сайт Excalidraw, Discord и
     соцсети, а также «открыть/сохранить файл сцены» — в личном планере это чужое, да ещё и
     по-английски. Оставляем то, что человеку тут реально нужно. */
  const I = ExcalidrawLib.MainMenu.DefaultItems;
  return React.createElement(ExcalidrawLib.MainMenu, null,
    React.createElement(I.SaveAsImage),
    React.createElement(I.ChangeCanvasBackground),
    React.createElement(I.ClearCanvas),
    React.createElement(I.Help)
  );
}

function drawProps(){
  return {
    theme: S.settings.theme === "light" ? "light" : "dark",
    langCode: "ru-RU",
    initialData: drawScene(),
    excalidrawAPI: api=>{ drawApi = api; },
    onChange: drawTouch,
    UIOptions: {
      // библиотека пристыковывается сбоку, а не всплывает поверх рисунка
      dockedSidebarBreakpoint: 730,
      canvasActions: {
        loadScene: false,        // сцена живёт в planner.json; «открыть файл» затирало бы её молча
        saveToActiveFile: false,
        export: false,
        saveAsImage: true,
        changeViewBackgroundColor: true,
        clearCanvas: true,
        toggleTheme: false       // темой правит сам Мыслик, отдельный переключатель путал бы
      }
    }
  };
}

function drawMount(host){
  drawRoot = ReactDOM.createRoot(host);
  drawRoot.render(React.createElement(ExcalidrawLib.Excalidraw, drawProps(), drawMenu()));
}

// Смена темы приложения на открытой доске: перерисовываем корень с новым пропом, а не
// пересобираем всё заново — initialData читается один раз, сцена и история остаются целы.
function drawRetheme(){
  if(!drawRoot) return false;
  drawRoot.render(React.createElement(ExcalidrawLib.Excalidraw, drawProps(), drawMenu()));
  return true;
}

function drawDestroy(){
  if(drawSaveTimer){ clearTimeout(drawSaveTimer); drawSaveTimer = null; }
  drawStash();                      // порядок важен: сцену снимаем, пока API ещё жив
  if(drawHints){ drawHints.disconnect(); drawHints = null; }
  if(drawRoot){
    const r = drawRoot; drawRoot = null; drawApi = null;
    try{ r.unmount(); }catch(e){}
  }
  const слой = $("#draw-screen");
  if(слой) слой.remove();
}

function drawClose(){
  drawDestroy();
  view = (drawBack && drawBack !== "draw") ? drawBack : "today";
  render();
}

function drawOpen(){
  if($("#draw-screen")) return;     // уже открыта: повторный render() не должен пересобирать доску
  const слой = el("div", "draw-screen");
  слой.id = "draw-screen";
  слой.innerHTML = `
    <div class="draw-top">
      <button class="btn ghost" id="draw-back" title="Вернуться (сохраняется само)"><i class="ti ti-arrow-left"></i>Назад</button>
      <div class="draw-title"><i class="ti ti-pencil"></i>Доска</div>
    </div>
    <div id="draw-wrap"><div id="draw-host"></div></div>`;
  $("#overlay-root").appendChild(слой);
  $("#draw-back").onclick = drawClose;

  const wrap = $("#draw-wrap");
  /* Щит от глобальных хоткеев Мыслика: у Excalidraw свои буквы под инструменты, а у нас на
     тех же буквах создание задач и заметок. Особенно опасен Ctrl+Z — глобальный откат
     подменяет весь S, а доска ведёт свою историю сама.
     ВАЖНО: слушатель стоит на ВСПЛЫТИИ и на обёртке, а не на самом хосте в capture-фазе.
     React 18 делегирует события на корневой контейнер (#draw-host), поэтому перехват
     «сверху вниз» глушил бы клавиши самого Excalidraw: инструменты, Delete, стрелки. */
  wrap.addEventListener("keydown", e=>{ e.stopPropagation(); });
  // Ctrl+K оставляем поиску Мыслика: у Excalidraw на нём «вставить ссылку», и без явного
  // разбора срабатывали бы оба сразу.
  wrap.addEventListener("keydown", e=>{
    if((e.ctrlKey||e.metaKey) && e.code==="KeyK"){
      e.preventDefault(); e.stopPropagation();
      // палитра не лезет поверх другого открытого окна — тем же правилом живёт main.js
      if($("#overlay-root").children.length === 1) openPalette();
    }
  }, true);

  const host = $("#draw-host");
  drawLoadLib().then(ok=>{
    if(!$("#draw-screen")) return;          // успели закрыть, пока грузился вендор
    if(!ok || !window.ExcalidrawLib){
      host.innerHTML = emptyBox("ti-pencil-off", "Доска не загрузилась: нет файлов в <b>ui/vendor/excalidraw/</b>.");
      return;
    }
    drawMount(host);
    drawFixHints(host);
  });
}

function renderDraw(v){
  head("Доска", "Рисуй от руки: фигуры, стрелки, подписи. Сохраняется само.", "");
  v.innerHTML = "";                 // сама доска живёт слоем поверх, во вкладке рисовать нечего
  if(_prevView && _prevView !== "draw") drawBack = _prevView;
  drawOpen();
}
