/* Доска — Excalidraw внутри ноды-полотна.

   Вендор лежит в ui/vendor/excalidraw/ одним классическим скриптом: приложение грузится
   по file://, где ES-модули блокируются CORS (см. инвариант в CLAUDE.md). Собран он
   одноразово через esbuild, node в проекте не нужен. Внутренности вендора не правятся —
   вся своя логика живёт здесь.

   У КАЖДОЙ ноды kind:"flow" своя доска. Сцены лежат в S.boards[id ноды], а НЕ внутри самой
   ноды: снимок отката (_undoSnap в core.js) сериализует S.items целиком, и доски с рисунками
   раздували бы историю отмены до мегабайтов на каждый шаг.

   Доска открывается НА ВЕСЬ ЭКРАН, как раньше полотно. Причина не в красоте: Excalidraw сам
   решает, показать десктопный интерфейс или телефонный, по размеру СВОЕГО контейнера —
   isMobile = ширина < 730 || (высота < 500 && ширина < 1000). Врезка внутри вкладки давала
   937x493, и вместо нормального тулбара приезжала мобильная плашка. */

const DRAW_ASSETS = "vendor/excalidraw/";
let drawRoot = null;        // корень React — живёт, пока открыта доска
let drawApi = null;         // excalidrawAPI: чтение и правка сцены снаружи
let drawItem = null;        // нода, чья доска сейчас открыта
let drawSaveTimer = null;
let drawLoading = null;     // промис загрузки вендора, чтобы не тянуть файл дважды
let drawHints = null;       // наблюдатель за строкой подсказок (дочищает непереведённое)
let drawSeen = "";          // отпечаток сохранённого состояния — против холостых записей

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
         момент. Иначе нода показывала бы «не загрузилось» до перезапуска приложения. */
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

/* ---------- хранение ---------- */

/* Что из appState переживает закрытие доски. Голых scrollX/scrollY/zoom мало: без остального
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

function boardOf(id){
  if(!S.boards || typeof S.boards!=="object") S.boards = {};
  const b = S.boards[id];
  return (b && typeof b==="object") ? b : null;
}

function drawSceneOf(id){
  const d = boardOf(id) || {};
  const был = d.appState && d.appState.scrollX != null;
  const ap = Object.assign({}, d.appState||{});
  /* Фон холста НЕ подкрашиваем под тему приложения. Тёмную тему Excalidraw делает фильтром
     invert(93%) поверх холста: тёмный цвет под инверсией превращается в светлый — та самая
     «серая простыня». Правильный фон в обеих темах светлый, тёмным его делает сам фильтр. */
  if(!ap.viewBackgroundColor || ap.viewBackgroundColor==="#1b1b1b") ap.viewBackgroundColor="#ffffff";
  return {
    elements: Array.isArray(d.elements) ? d.elements : [],
    files: (d.files && typeof d.files==="object") ? d.files : {},
    appState: ap,
    scrollToContent: !был   // положение холста помним между заходами; в первый раз — по содержимому
  };
}

// Отпечаток: версия сцены + сохраняемый срез настроек. Excalidraw дёргает onChange даже когда
// человек просто ведёт мышью, и без этой сверки каждая такая дрожь гнала бы весь planner.json
// через мост pywebview.
function drawFingerprint(){
  const st = drawApi.getAppState(), ap = {};
  DRAW_STATE_KEYS.forEach(k=>{ if(st[k]!==undefined) ap[k] = (k==="zoom" ? (st.zoom&&st.zoom.value) : st[k]); });
  return ExcalidrawLib.getSceneVersion(drawApi.getSceneElements()) + "|" + JSON.stringify(ap);
}

function drawStash(){
  if(!drawApi || !drawItem) return false;
  try{
    const отпечаток = drawFingerprint();
    if(отпечаток === drawSeen) return true;      // ничего не изменилось — не трогаем S вовсе
    // Элементы Excalidraw отдаёт замороженными и переиспользует между кадрами — в S кладём
    // копию, иначе следующая же правка молча меняла бы то, что считается сохранённым.
    const els = JSON.parse(JSON.stringify(drawApi.getSceneElements()));
    /* Картинки прибираем сами: getFiles() отдаёт ВЕСЬ внутренний словарь и никогда его не
       чистит — сборку мусора в родном Excalidraw делает обвязка приложения. Без этого
       удалённое фото навсегда оставалось бы в planner.json мегабайтами base64. */
    const нужны = new Set(els.filter(e=>e.fileId).map(e=>e.fileId));
    const было = drawApi.getFiles() || {}, files = {};
    Object.keys(было).forEach(k=>{ if(нужны.has(k)) files[k] = было[k]; });

    const st = drawApi.getAppState(), ap = {};
    DRAW_STATE_KEYS.forEach(k=>{ if(st[k] !== undefined) ap[k] = st[k]; });
    if(st.zoom) ap.zoom = { value: st.zoom.value || 1 };

    const прежняя = boardOf(drawItem.id) || {};
    boardSet(drawItem.id, { elements: els, files: files, appState: ap, fromFlow: !!прежняя.fromFlow });
    drawSeen = отпечаток;
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

/* ---------- перенос старых схем ---------- */

/* Блок-схемы, нарисованные прежним редактором, лежат в it.flow и остаются там НЕТРОНУТЫМИ:
   это страховка на случай, если перенос выйдет неудачным. Конвертация одноразовая, при первом
   открытии ноды, и только после загрузки вендора — раньше ExcalidrawLib просто не существует.

   Все блоки становятся ПРЯМОУГОЛЬНИКАМИ, а не ромбами/эллипсами: в прежнем полотне все типы
   рисовались скруглёнными прямоугольниками, а у ромба полезная ширина вдвое меньше — текстовые
   блоки (а они у КРОЛИКА до 147 символов) раздуло бы вдвое против оригинала. Тип различаем
   так же, как различало полотно: скруглением, пунктиром и цветом рамки. */
const DRAW_FLOW_STYLE = {
  proc:     { roundness:{type:3} },
  terminal: { roundness:{type:3}, strokeWidth:2 },
  decision: { roundness:{type:3}, strokeStyle:"solid", strokeWidth:2 },
  comment:  { roundness:{type:3}, strokeStyle:"dashed" },
  frame:    { roundness:null, strokeStyle:"dotted" }
};

function flowToExcalidraw(flow){
  const blocks = (flow && Array.isArray(flow.blocks)) ? flow.blocks : [];
  const edges  = (flow && Array.isArray(flow.edges))  ? flow.edges  : [];
  const скелет = [], годен = new Set();

  blocks.forEach(b=>{
    const w = Math.abs(Math.round(+b.w||160)) || 160;
    const h = Math.abs(Math.round(+b.h||64))  || 64;
    const общее = { x: Math.round(+b.x||0), y: Math.round(+b.y||0), width: w, height: h, id: b.id };
    const текст = String(b.text||"").trim();

    if(b.type==="image" || b.type==="video"){
      /* Картинку переносим настоящим image-элементом, видео переносить некуда — в Excalidraw
         такого типа нет вовсе. Вместо тихой пропажи оставляем рамку с подписью, чтобы человек
         увидел, что здесь было видео (сам файл остаётся в it.flow). */
      if(b.type==="image" && typeof b.src==="string" && b.src.startsWith("data:")){
        скелет.push(Object.assign({ type:"image", fileId:"f_"+b.id }, общее));
        годен.add(b.id);
      }else{
        скелет.push(Object.assign({ type:"rectangle", strokeStyle:"dashed", strokeColor:"#868e96",
          label:{ text: b.type==="video" ? "▶ видео (осталось в старой схеме)" : "картинка", fontSize:16 } }, общее));
        годен.add(b.id);
      }
      return;
    }
    if(b.type==="frame"){
      // рамка Excalidraw не принимает подпись через label — имя задаётся полем name
      скелет.push(Object.assign({ type:"frame", name: текст || "Рамка",
        children: blocks.filter(x=>x.parent===b.id).map(x=>x.id) }, общее));
      годен.add(b.id);
      return;
    }
    const ст = DRAW_FLOW_STYLE[b.type] || DRAW_FLOW_STYLE.proc;
    const эл = Object.assign({ type:"rectangle" }, ст, общее);
    /* Цвет блока в полотне красил РАМКУ и давал лёгкую подложку. Прямой backgroundColor дал бы
       сплошную заливку и другой рисунок схемы, поэтому цвет уходит в обводку. */
    if(b.color){ эл.strokeColor = b.color; эл.backgroundColor = "transparent"; }
    if(b.type==="comment" && !b.color) эл.strokeColor = "#868e96";
    // 14 против вендорских 20 по умолчанию: в полотне подпись была 13.5 px, и на крупном кегле
    // длинные тексты КРОЛИКА (до 147 символов) не влезали бы в исходный размер блока
    if(текст) эл.label = { text: текст, fontSize: 14 };
    // ссылка на элемент Мыслика (в полотне это был refId) — сохраняем, чтобы не потерять связь
    if(b.refId) эл.customData = { refId: b.refId };
    скелет.push(эл);
    годен.add(b.id);
  });

  // Рамкам нужны только реально доехавшие дети: чужой id внутри children роняет конвертер.
  скелет.forEach(э=>{ if(э.type==="frame") э.children = (э.children||[]).filter(id=>годен.has(id)); });

  const формы = new Map(скелет.map(э=>[э.id, э.type]));
  const поБлоку = new Map(blocks.map(b=>[b.id, b]));
  /* Точка, где линия «центр → центр» выходит из прямоугольника, плюс небольшой зазор.
     Считаем сами: привязка Excalidraw подтягивает концы только при перетаскивании, а сразу
     после загрузки сцены стрелки шли бы сквозь блоки. Уголковый режим (elbowed) не берём —
     без ручной раскладки сегментов он всё равно рисует ту же диагональ. */
  const край = (п, dx, dy, зазор)=>{
    const w = (Math.abs(Math.round(+п.w||160))||160)/2, h = (Math.abs(Math.round(+п.h||64))||64)/2;
    const cx = Math.round(+п.x||0) + w, cy = Math.round(+п.y||0) + h;
    if(!dx && !dy) return {x:cx, y:cy};
    const t = Math.min(dx ? Math.abs(w/dx) : Infinity, dy ? Math.abs(h/dy) : Infinity);
    const д = Math.hypot(dx, dy) || 1;
    return { x: cx + dx*t + dx/д*зазор, y: cy + dy*t + dy/д*зазор };
  };
  edges.forEach(e=>{
    if(!e || !годен.has(e.from) || !годен.has(e.to)) return;
    const a = поБлоку.get(e.from), b = поБлоку.get(e.to);
    const цx = п => Math.round(+п.x||0) + (Math.abs(Math.round(+п.w||160))||160)/2;
    const цy = п => Math.round(+п.y||0) + (Math.abs(Math.round(+п.h||64))||64)/2;
    const dx = цx(b) - цx(a), dy = цy(b) - цy(a);
    const н = край(a, dx, dy, 4), к = край(b, -dx, -dy, 4);
    const стрелка = { type:"arrow", x: Math.round(н.x), y: Math.round(н.y),
                      width: Math.round(к.x - н.x), height: Math.round(к.y - н.y) };
    /* Привязку даём только к прямоугольникам: для image/frame внутренняя фабрика вендора не
       имеет ветки и падает с TypeError, унося всю сцену — доска открылась бы пустой. */
    if(формы.get(e.from)==="rectangle") стрелка.start = { id: e.from };
    if(формы.get(e.to)==="rectangle")   стрелка.end   = { id: e.to };
    if(e.label) стрелка.label = { text: String(e.label), fontSize: 14 };
    скелет.push(стрелка);
  });

  // regenerateIds:false — сохраняем id блоков. Так и стрелки привязываются к своим фигурам,
  // и габариты рамок можно вернуть на место (см. ниже).
  const элементы = ExcalidrawLib.convertToExcalidrawElements(скелет, {regenerateIds:false});
  /* Габариты рамок дописываем вручную: внутри вендора рамка берёт x/y через `||`, и координата
     0 (сетка полотна кратна 20, ноль там обычен) молча заменялась бы на bbox детей. */
  const поId = new Map(blocks.map(b=>[b.id, b]));
  элементы.forEach(э=>{
    if(э.type!=="frame") return;
    const b = поId.get(э.id);
    if(!b) return;
    э.x = Math.round(+b.x||0); э.y = Math.round(+b.y||0);
    э.width = Math.abs(Math.round(+b.w||320)) || 320;
    э.height = Math.abs(Math.round(+b.h||220)) || 220;
  });
  return элементы;
}

// картинки старой схемы: data-URL блока → файл сцены
function flowFiles(flow){
  const files = {};
  ((flow && flow.blocks) || []).forEach(b=>{
    if(b.type==="image" && typeof b.src==="string" && b.src.startsWith("data:")){
      const мим = (b.src.match(/^data:([^;,]+)/)||[])[1] || "image/png";
      files["f_"+b.id] = { mimeType: мим, id: "f_"+b.id, dataURL: b.src, created: Date.now(), lastRetrieved: Date.now() };
    }
  });
  return files;
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
    initialData: drawSceneOf(drawItem.id),
    excalidrawAPI: api=>{ drawApi = api; },
    onChange: drawTouch,
    // клик по фигуре, перенесённой из старой схемы с привязкой к элементу, открывает этот элемент
    onLinkOpen: (эл, ev)=>{
      const ref = эл && эл.customData && эл.customData.refId;
      if(!ref) return;
      ev.preventDefault();
      const it = liveById(ref);
      if(it){ drawClose(); openItemSmart(it); }
      else toast("Элемент, на который ссылалась фигура, удалён", {icon:"ti-unlink"});
    },
    UIOptions: {
      dockedSidebarBreakpoint: 730,   // библиотека пристыковывается сбоку, а не всплывает поверх
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
  if(!drawRoot || !drawItem) return false;
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
  drawItem = null; drawSeen = "";
  const слой = $("#draw-screen");
  if(слой) слой.remove();
}

function drawClose(){
  drawDestroy();
  render();       // вернуться к тому виду, откуда открывали
}

/* Ждём шрифты доски. Excalidraw при конвертации сам разбивает подпись на строки и подгоняет
   высоту фигуры — по МЕТРИКАМ шрифта. Если Excalifont ещё не загрузился, замер идёт по чужой
   гарнитуре, и текст вылезает за края блока. Ждём не дольше двух секунд: не дождались —
   переносим как есть, кривой перенос строк лучше зависшего открытия. */
function drawFontsReady(){
  const готовы = ()=>{ try{ return document.fonts.check('16px Excalifont'); }catch(e){ return true; } };
  if(готовы()) return Promise.resolve(true);
  return new Promise(res=>{
    const край = setTimeout(()=>res(false), 2000);
    Promise.resolve(document.fonts.ready).then(()=>{ clearTimeout(край); res(готовы()); }).catch(()=>{ clearTimeout(край); res(false); });
  });
}

/* Первое открытие ноды: если доски ещё нет, а старая схема есть — переносим её.
   Метку fromFlow ставим и записываем СРАЗУ: без неё следующее открытие сконвертировало бы
   it.flow заново и затёрло всё, что человек успел дорисовать. */
function drawSeedFromFlow(it){
  if(boardOf(it.id)) return false;
  const f = it.flow;
  const есть = f && ((f.blocks||[]).length || (f.edges||[]).length);
  if(!есть){
    boardSet(it.id, { elements:[], files:{}, appState:{}, fromFlow:false });
    return false;
  }
  try{
    boardSet(it.id, {
      elements: flowToExcalidraw(f),
      files: flowFiles(f),
      appState: {},
      fromFlow: true
    });
  }catch(e){
    // не смогли перенести — заводим пустую доску, старая схема остаётся в it.flow нетронутой
    boardSet(it.id, { elements:[], files:{}, appState:{}, fromFlow:false });
    toast("Старую схему перенести не удалось, доска открыта пустой", {icon:"ti-alert-triangle"});
    return false;
  }
  persist(true);
  return true;
}

/* Мост раскладки. Вендор ловит буквы инструментов по e.key (v, r, o, a, t, d, l, e…), и на
   русской раскладке приходит «м», «к», «щ» — ни одна буква не совпадает, клавиши мертвы.
   Править вендор нельзя, поэтому подменяем событие в capture-фазе: физическая клавиша известна
   из e.code (KeyR от раскладки не зависит), собираем такое же событие с латинской буквой и
   шлём в ту же цель. Оригинал глушим stopPropagation, но БЕЗ preventDefault: отмена по умолчанию
   отняла бы у браузера родные Ctrl+C/Ctrl+V/Ctrl+X, которые он делает сам, мимо вендора.
   Гасить оригинал обязательно — иначе вендор получил бы клавишу дважды: Z и Y он умеет читать
   и по e.code (свой обход раскладки), и второй заход дал бы двойную отмену.
   Набор текста не трогаем вовсе: в подписи на холсте стоит настоящая textarea, и подмена
   события ломала бы ввод по-русски. */
function drawLayoutBridge(wrap){
  wrap.addEventListener("keydown", e=>{
    if(e.defaultPrevented) return;                 // разобрано щитом выше (Ctrl+K)
    const м = /^Key([A-Z])$/.exec(e.code || "");
    if(!м) return;                                 // цифры, стрелки, Delete — раскладке не подвластны
    if(e.key.length !== 1 || /^[a-zA-Z]$/.test(e.key)) return;   // латиница и Dead/Unidentified — мимо
    const цель = e.target;
    if(!цель || drawIsTextTarget(цель)) return;
    e.stopPropagation();
    const буква = e.shiftKey ? м[1] : м[1].toLowerCase();
    цель.dispatchEvent(new KeyboardEvent("keydown", {
      key: буква, code: e.code, keyCode: м[1].charCodeAt(0), which: м[1].charCodeAt(0),
      ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      repeat: e.repeat, bubbles: true, cancelable: true, composed: true
    }));
  }, true);
}
// поле ввода или редактируемый узел — там клавиша это буква, а не команда
function drawIsTextTarget(el){
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || "");
}

/* Монтаж доски в произвольный контейнер. Общая часть двух режимов: полноэкранного слоя
   и врезки в правую панель. Возвращает промис — вызвавшему бывает нужно знать, поднялось ли. */
function drawInto(it, host){
  drawItem = it;
  /* Щит от глобальных хоткеев Мыслика: у Excalidraw свои буквы под инструменты, а у нас на
     тех же буквах создание задач и заметок. Особенно опасен Ctrl+Z — глобальный откат
     подменяет весь S, а доска ведёт свою историю сама.
     ВАЖНО: слушатель на ВСПЛЫТИИ и на обёртке, а не на самом хосте в capture-фазе. React 18
     делегирует события на корневой контейнер, поэтому перехват «сверху вниз» глушил бы
     клавиши самого Excalidraw: инструменты, Delete, стрелки. */
  const wrap = host.parentElement || host;
  if(!wrap.dataset.drawShield){
    wrap.dataset.drawShield = "1";
    wrap.addEventListener("keydown", e=>{ e.stopPropagation(); });
    wrap.addEventListener("keydown", e=>{
      if((e.ctrlKey||e.metaKey) && e.code==="KeyK"){
        e.preventDefault(); e.stopPropagation();
        if($("#overlay-root").children.length === 0) openPalette();
      }
    }, true);
    drawLayoutBridge(wrap);
  }
  return drawLoadLib().then(ok=>{
    if(drawItem !== it || !host.isConnected) return false;   // успели закрыть или переключиться
    if(!ok || !window.ExcalidrawLib){
      host.innerHTML = emptyBox("ti-pencil-off", "Доска не загрузилась: нет файлов в <b>ui/vendor/excalidraw/</b>.");
      return false;
    }
    // перенос старой схемы — только после шрифтов, иначе подписи не влезут в блоки
    const дальше = boardOf(it.id) ? Promise.resolve(false)
                                  : drawFontsReady().then(()=>drawSeedFromFlow(it));
    return дальше.then(перенесли=>{
      if(drawItem !== it || !host.isConnected) return false;
      drawMount(host);
      drawFixHints(host);
      if(перенесли) toast("Старая схема перенесена на доску", {icon:"ti-arrow-move-right"});
      return true;
    });
  });
}

// Доска ноды прямо в правой панели. Ширину гарантирует asideApplyWidth: уже 730 px
// Excalidraw показывает телефонный интерфейс.
/* Колесо над врезанной доской НЕ должно прокручивать правую панель. Excalidraw сам ловит wheel
   (пан и зум холста), но нативную прокрутку ближайшего скроллящегося предка это не отменяет —
   и панель уезжала под курсором: шапка карточки с названием, типом и тегами скачком исчезала,
   стоило поводить по холсту. Гасим в фазе ВСПЛЫТИЯ: вендор свою обработку к этому моменту уже
   сделал, отнимать у него событие нельзя (см. правило про щит клавиш в CLAUDE.md). */
function drawLockPanelScroll(wrap){
  if(!wrap || wrap._scrollLocked) return;
  wrap._scrollLocked = true;
  wrap.addEventListener("wheel", e=>{ e.preventDefault(); }, {passive:false});
}

function openBoardIn(it, host){
  drawLockPanelScroll(host && host.parentElement);
  if(drawRoot && drawItem && drawItem.id===it.id && host.querySelector("canvas")) return Promise.resolve(true);
  drawDestroy();
  return drawInto(it, host);
}

// Открыть доску ноды-полотна на весь экран. Зовётся из openFlowEditor и кнопкой разворота.
function openBoard(it){
  if(!it) return;
  if($("#draw-screen")){
    if(drawItem && drawItem.id === it.id) return;   // уже открыта эта же доска
    drawDestroy();                                   // между досками — только полный ремонтаж
  } else if(drawRoot) drawDestroy();                 // доска висела во врезке панели — снять
  const слой = el("div", "draw-screen");
  слой.id = "draw-screen";
  слой.innerHTML = `
    <div class="draw-top">
      <button class="btn ghost" id="draw-back" title="Вернуться (сохраняется само)"><i class="ti ti-arrow-left"></i>Назад</button>
      <div class="draw-title"><i class="ti ti-artboard"></i><span id="draw-name"></span></div>
    </div>
    <div id="draw-wrap"><div id="draw-host"></div></div>`;
  $("#overlay-root").appendChild(слой);
  $("#draw-name").textContent = it.title || "Полотно";
  $("#draw-back").onclick = drawClose;
  drawInto(it, $("#draw-host"));
}
