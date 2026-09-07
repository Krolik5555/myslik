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

/* ---------- сетка для пакета команд ----------
   Нейросеть ставит блоки В КЛЕТКАХ (col/row/w/h целыми), а не в пикселях: пиксели она
   раскладывает вразнобой, а клетки читаются как таблица и почти не дают ошибок. Реестр видов
   блоков — тот же DRAW_FLOW_STYLE, второго не заводим: cmdPrompt перечисляет модели ровно его
   ключи, как перечисляет KINDS и СТАТУСЫ. Плюс "text" — подпись без рамки, заголовок раздела. */
/* КЕГЛЬ ПОДПИСЕЙ — «L» по шкале самого Excalidraw (S 16, M 20, L 28, XL 36). На доску смотрят
   издалека и целиком, и мелкий текст в блоке читается плохо (КРОЛИК, 07.09.2026).
   Клетка под него подобрана, а не оставлена прежней: на 28 px строка вроде «Разбор по белому
   списку» занимает около 300 px, и в блоке 200×80 её рвало бы на три строки с вылезанием.
   ПЕРЕНОС СТАРЫХ СХЕМ кегль не трогает (там остаётся 14): у их блоков свои габариты, снятые
   с прежнего полотна, и крупный текст в них просто не поместится. */
const DRAW_FONT = 28;
const DRAW_GRID = {x:360, y:200, w:320, h:140};  // шаг клетки и размер блока в ней; разница — зазор
const DRAW_BLOCK_TYPES = Object.keys(DRAW_FLOW_STYLE).concat("text");

/* КЕГЛЬ ПОДБИРАЕТСЯ ПОД ТЕКСТ, а не текст ломается под кегль. Длинная подпись на L не влезает
   в блок, и рвать её на пять строк с вылезанием хуже, чем нарисовать кеглем поменьше. Шаги — те
   же, что в самом Excalidraw: L 28, M 20, S 16; ниже S не опускаемся, там уже не прочитать.
   Меряем НАСТОЯЩИМ измерителем браузера и той же гарнитурой, которой вендор потом рисует:
   считать по числу символов значит разойтись с отрисовкой на первом же длинном слове. */
const DRAW_FONT_STEPS = [28, 20, 16];
const DRAW_TEXT_PAD = 10;                        // отступ подписи внутри фигуры, как у вендора
const DRAW_MAX_CELLS = 4;                        // выше четырёх клеток блок не растим — это уже не схема
let _drawMeter = null;
// сколько строк займёт подпись при этом кегле и влезает ли она по ширине вообще
function drawTextLines(текст, шир, кегль){
  const с = String(текст == null ? "" : текст).trim();
  if(!с) return {строк:0, влезло:true};
  if(!_drawMeter){ try{ _drawMeter = document.createElement("canvas").getContext("2d"); }catch(e){ _drawMeter = null; } }
  if(!_drawMeter) return {строк:1, влезло:true};
  _drawMeter.font = кегль + "px Excalifont";
  const пробел = _drawMeter.measureText(" ").width;
  let строк = 1, длина = 0, влезло = true;
  с.split(/\s+/).forEach(сл=>{
    const ш = _drawMeter.measureText(сл).width;
    if(ш > шир) влезло = false;                  // одно слово шире блока — переносом не спасти
    if(длина && длина + пробел + ш > шир){ строк++; длина = ш; }
    else длина += (длина ? пробел : 0) + ш;
  });
  return {строк, влезло};
}
function drawTextFits(текст, w, h, кегль){
  const р = drawTextLines(текст, Math.max(20, (+w || 0) - DRAW_TEXT_PAD), кегль);
  return р.влезло && р.строк * кегль * 1.25 <= Math.max(20, (+h || 0) - DRAW_TEXT_PAD);
}
function drawFitFont(текст, w, h){
  if(!String(текст == null ? "" : текст).trim()) return DRAW_FONT;
  for(const кегль of DRAW_FONT_STEPS) if(drawTextFits(текст, w, h, кегль)) return кегль;
  return DRAW_FONT_STEPS[DRAW_FONT_STEPS.length - 1];
}
/* Столбец бывает ДРОБНЫМ, и это не оплошность: родитель встаёт ровно посередине между двумя
   ветками, то есть на половине клетки. Округляем не номер клетки, а готовый пиксель. */
const drawGridBox = (col, row, w, h) => ({
  x: Math.round((+col || 0) * DRAW_GRID.x),
  y: Math.round((+row || 0) * DRAW_GRID.y),
  w: Math.max(1, Math.round(w)) * DRAW_GRID.x - (DRAW_GRID.x - DRAW_GRID.w),
  h: Math.max(1, Math.round(h)) * DRAW_GRID.y - (DRAW_GRID.y - DRAW_GRID.h)
});

/* РАСКЛАДКА ПО СВЯЗЯМ, когда координат не дали. Раскладываем ДЕРЕВОМ, как блок-схему рисуют
   руками: ширина поддерева = сумма ширин веток, родитель встаёт ПО ЦЕНТРУ своего поддерева.
   Тогда от развилки ветки расходятся симметрично — «да» влево, «нет» вправо.

   Первая версия клала детей подряд от нулевого столбца, и вилка читалась как цепочка, сбоку от
   которой что-то висит: по такой схеме не видно, где ветвление, а где продолжение (КРОЛИК,
   снимок 07.09.2026). Алгоритм смысла не знает и знать не может — зато обязан не врать формой.

   Граф бывает не деревом (ветки сходятся обратно). Ряд считаем по САМОМУ ДЛИННОМУ пути от
   корня, иначе место схождения оказалось бы в одном ряду со своей же веткой; дерево строим по
   первому родителю сверху, а место схождения в конце подтягиваем под середину его родителей. */
const DRAW_AUTO_ROWS = 64;
function drawAutoGrid(blocks, edges){
  if(!blocks.length) return blocks;
  const по = new Map(blocks.map(b=>[b.id, b]));
  const своя = b => Math.max(1, Math.round(+b.w || 1));
  const дети = new Map(), родители = new Map();
  blocks.forEach(b=>{ дети.set(b.id, []); родители.set(b.id, []); });
  (edges||[]).forEach(e=>{
    if(!по.has(e.from) || !по.has(e.to) || e.from === e.to) return;
    дети.get(e.from).push(e.to); родители.get(e.to).push(e.from);
  });

  // ряд = самый длинный путь от корня; корень — тот, в кого не ведёт ни одна стрелка
  const ряд = new Map(), очередь = [];
  blocks.forEach(b=>{ if(!родители.get(b.id).length){ ряд.set(b.id, 0); очередь.push(b.id); } });
  if(!очередь.length){ ряд.set(blocks[0].id, 0); очередь.push(blocks[0].id); }   // связи кольцом
  const предел = blocks.length * DRAW_AUTO_ROWS;
  for(let i=0; i<очередь.length && i<предел; i++){
    const a = очередь[i], р = ряд.get(a) + 1;
    if(р > DRAW_AUTO_ROWS) continue;
    дети.get(a).forEach(x=>{
      if(ряд.has(x) && ряд.get(x) >= р) return;      // уже стоит не выше — трогать незачем
      ряд.set(x, р); очередь.push(x);
    });
  }
  blocks.forEach(b=>{ if(!ряд.has(b.id)) ряд.set(b.id, 0); });   // до кого не добрались вовсе

  // дерево раскладки: родитель — первый, кто стоит ВЫШЕ по ряду (связи вбок и назад не считаем)
  const тдети = new Map(), корни = [];
  blocks.forEach(b=>{ тдети.set(b.id, []); });
  blocks.forEach(b=>{
    const св = родители.get(b.id).filter(x => ряд.get(x) < ряд.get(b.id));
    if(св.length) тдети.get(св[0]).push(b.id); else корни.push(b.id);
  });

  const шир = new Map();
  const ширина = id => {
    if(шир.has(id)) return шир.get(id);
    const б = по.get(id), с = тдети.get(id);
    шир.set(id, своя(б));                                  // страховка, если связи всё же закольцевались
    const w = с.length ? Math.max(своя(б), с.reduce((s, x) => s + ширина(x), 0)) : своя(б);
    шир.set(id, w); return w;
  };
  const поставить = (id, лево) => {
    let x = лево;
    тдети.get(id).forEach(д => { поставить(д, x); x += ширина(д); });
    const б = по.get(id);
    б.row = ряд.get(id);
    б.col = лево + (ширина(id) - своя(б)) / 2;              // ровно посередине своего поддерева
  };
  let край = 0;
  корни.forEach(к => { поставить(к, край); край += ширина(к) + 1; });

  // схождение веток: тянем под середину родителей, но только если в ряду свободно
  const вРяду = new Map();
  blocks.forEach(б => { const с = вРяду.get(б.row) || []; с.push(б); вРяду.set(б.row, с); });
  blocks.forEach(б => {
    const св = родители.get(б.id).filter(x => ряд.get(x) < б.row);
    if(св.length < 2) return;
    const центр = св.reduce((s, x) => { const p = по.get(x); return s + p.col + своя(p) / 2; }, 0) / св.length;
    const цель = центр - своя(б) / 2;
    const мешает = (вРяду.get(б.row) || []).some(x => x !== б &&
      цель < x.col + своя(x) && x.col < цель + своя(б));
    if(!мешает) б.col = цель;
  });

  // сдвигаем всё к нулю: отрицательные столбцы законны, но по холсту схема должна начинаться слева
  const мин = blocks.reduce((m, б) => Math.min(m, б.col), Infinity);
  if(isFinite(мин) && мин) blocks.forEach(б => { б.col -= мин; });
  return blocks;
}

/* ОБЩИЙ СТРОИТЕЛЬ СЦЕНЫ. Принимает компактное {blocks, edges} в ПИКСЕЛЯХ и отдаёт готовые
   элементы Excalidraw. Два входа, один слой: перенос старых схем (flowToExcalidraw ниже) и
   рисование пакетом команд от нейросети (cmd.js). Второй такой же слой заводить нельзя — здесь
   обойдены грабли вендора (привязка стрелок, габариты рамок), и в двух местах они разъедутся
   молча. Служебных полей вендора (seed, versionNonce, версии) на входе не ждём: их дописывает
   сам convertToExcalidrawElements. */
function drawBuild(blocks, edges){
  blocks = Array.isArray(blocks) ? blocks : [];
  edges  = Array.isArray(edges)  ? edges  : [];
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
    if(b.type==="text"){
      /* Подпись без рамки — заголовок раздела на доске. Габариты НЕ задаём: вендор считает их
         сам по метрикам шрифта, а навязанная ширина ломает перенос строк. */
      const т = { type:"text", id:b.id, x:общее.x, y:общее.y, text: текст || " ",
                  fontSize: Math.max(16, Math.round(+b.fontSize) || 20) };
      if(b.color) т.strokeColor = b.color;
      скелет.push(т);
      годен.add(b.id);
      return;
    }
    const ст = DRAW_FLOW_STYLE[b.type] || DRAW_FLOW_STYLE.proc;
    const эл = Object.assign({ type:"rectangle" }, ст, общее);
    /* Цвет блока в полотне красил РАМКУ и давал лёгкую подложку. Прямой backgroundColor дал бы
       сплошную заливку и другой рисунок схемы, поэтому цвет уходит в обводку. */
    if(b.color){ эл.strokeColor = b.color; эл.backgroundColor = "transparent"; }
    if(b.type==="comment" && !b.color) эл.strokeColor = "#868e96";
    /* Кегль берём ИЗ БЛОКА, а по умолчанию 14. Это размер для ПЕРЕНОСА СТАРЫХ СХЕМ: там подпись
       была 13.5 px, а габариты блоков сняты с прежнего полотна, и крупный кегль в них не влезет.
       Схемы от нейросети приходят со своим кеглем — его подбирает drawFitFont. */
    if(текст) эл.label = { text: текст, fontSize: Math.round(+b.fontSize) || 14 };
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
    /* ТОЧКИ ЗАДАЁМ ЯВНО, а не через width/height. Внутри вендора стрелка берёт габариты через
       `||` (`o.width||дефолт`), и у СТРОГО ВЕРТИКАЛЬНОЙ стрелки ширина ровно 0 молча
       заменяется дефолтной: точки строятся по подменённой, потом габариты пересчитываются
       по точкам — и стрелка уезжает вправо на сотню пикселей (КРОЛИК, снимок 07.09.2026).
       Свои `points` вендор берёт как есть, потому что спред нашего объекта идёт ПОСЛЕ них.
       Та же грабля с `||`, что у рамки ниже. */
    const дл = Math.round(к.x - н.x), дв = Math.round(к.y - н.y);
    const стрелка = { type:"arrow", x: Math.round(н.x), y: Math.round(н.y),
                      width: дл, height: дв, points: [[0, 0], [дл, дв]] };
    /* Привязку даём только к прямоугольникам: для image/frame внутренняя фабрика вендора не
       имеет ветки и падает с TypeError, унося всю сцену — доска открылась бы пустой. */
    if(формы.get(e.from)==="rectangle") стрелка.start = { id: e.from };
    if(формы.get(e.to)==="rectangle")   стрелка.end   = { id: e.to };
    if(e.label) стрелка.label = { text: String(e.label), fontSize: Math.round(+e.fontSize) || 14 };
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

// Перенос старой схемы — тонкий переходник: формат it.flow это те же {blocks, edges} в пикселях.
function flowToExcalidraw(flow){
  return drawBuild(flow && flow.blocks, flow && flow.edges);
}

/* СЦЕНА ИЗМЕНИЛАСЬ СНАРУЖИ — обновить то, что человек видит прямо сейчас. Зовут пакет команд
   и откат: разойтись с картинкой на экране нельзя, а сама доска в S не заглядывает.
   Живая доска в приложении одна, и её ключ — ВСЕГДА drawItem.id: у полотна это id ноды, у врезки
   поля fieldBoardItem подсовывает искусственную ноду с id, равным ключу доски. Чужой ключ —
   выходим молча, при следующем открытии сцена прочитается из S сама. */
function drawSyncFrom(key){
  if(!drawApi || !drawItem || drawItem.id !== key) return false;
  const d = boardOf(key) || {elements:[], files:{}};
  /* Отложенную запись снимаем и объявляем живую сцену «уже сохранённой». Иначе незаписанный
     штрих (дебаунс 900 мс) лёг бы поверх того, что мы кладём: он относится к сцене, которую
     как раз и заменяют. Отпечаток при этом НЕ обнуляем — вендор применяет updateScene своим
     чередом, и обнулённый отпечаток дал бы запись старой сцены как новой. */
  if(drawSaveTimer){ clearTimeout(drawSaveTimer); drawSaveTimer = null; }
  try{ drawSeen = drawFingerprint(); }catch(e){}
  try{
    /* Порядок обязателен: публичный updateScene не принимает files, и картинки, пришедшие
       снаружи, иначе просто не отрисовались бы. */
    /* Отдаём КОПИИ верхнего слоя, а не сами объекты из S. Вендор нормализует пришедшее и
       дописывает элементам служебные поля (version, versionNonce, updated) — а на эти же
       объекты ссылается шаг отката, который держит прежние сцены ссылкой (см. txBoardMark).
       Копия мелкая и дешёвая: тяжёлое (base64 картинок, points стрелок) остаётся общим. */
    const ф = d.files || {};
    const список = Object.keys(ф).map(k=>ф[k]).filter(Boolean).map(x=>Object.assign({}, x));
    if(список.length && drawApi.addFiles) drawApi.addFiles(список);
    drawApi.updateScene({elements: (Array.isArray(d.elements) ? d.elements : []).map(э=>Object.assign({}, э))});
    return true;
  }catch(e){
    /* Не вышло — полный ремонтаж: он дороже, но между «медленно» и «человек смотрит на рисунок,
       которого в данных нет» выбора нет. Отпечаток выше уже снят, поэтому drawStash внутри
       drawDestroy ничего не затрёт. Врезку в панели пересоберёт ближайший render(). */
    const it = drawItem, полный = !!$("#draw-screen");
    drawDestroy();
    if(полный) openBoard(it);
    return false;
  }
}

/* ---------- рисование пакетом команд ----------
   Всё, что знает про формат сцены и грабли вендора, живёт ЗДЕСЬ, а не в cmd.js: там язык
   команд — разбор, белый список, предпросмотр. */

/* Готовность собирать сцену: библиотека вендора грузится лениво, и ШРИФТЫ — не мелочь. Вендор
   считает перенос строк по метрикам шрифта, и без Excalifont подписи вылезают за края блоков
   (та же грабля, что у переноса старых схем, см. drawFontsReady). */
function drawLibReady(){
  return drawLoadLib().then(ок=>{
    if(!ок || !window.ExcalidrawLib) return false;
    return drawFontsReady().then(()=>true);   // не дождались шрифтов — рисуем как есть, это лучше зависания
  });
}
/* Тот же вопрос, но СИНХРОННО — для агента: cmdAgent синхронен целиком (evaluate_js не ждёт
   промиса), и ждать загрузку ему нечем. Поэтому ответ «пока нет» плюс запуск загрузки, а ждёт
   и опрашивает Python (app.py: _agent_prepare), где этому и место. */
function drawLibState(){
  const lib = !!(window.ExcalidrawLib && ExcalidrawLib.convertToExcalidrawElements);
  let fonts = true;
  try{ fonts = document.fonts.check('16px Excalifont'); }catch(e){ fonts = true; }
  if(!lib) drawLoadLib();
  /* Шрифт ПРОСИМ, а не ждём. document.fonts.ready дожидается только уже начатых загрузок, и если
     доску в этой сессии не открывали, гарнитуру никто не запрашивал — check() остался бы ложным
     навсегда, а агент ждал бы впустую до самого предела. load() загрузку начинает. */
  else if(!fonts){ try{ document.fonts.load('16px Excalifont'); }catch(e){} }
  return {lib, fonts};
}

/* Спецификация от нейросети → готовые элементы. Сдвига «под уже нарисованное» здесь НЕТ: между
   предпросмотром и применением доска могла измениться, поэтому сдвиг считает drawApplyBoard в
   момент записи. */
function drawBuildSpec(оп){
  const блоки = (оп.blocks || []).map(b=>Object.assign({}, b));
  // координаты дали не всем — раскладываем сами, иначе безымянные лягут друг на друга в углу
  if(блоки.some(b=>b.col == null || b.row == null)) drawAutoGrid(блоки, оп.edges);
  /* СВОИ id БЛОКОВ В СЦЕНУ НЕЛЬЗЯ. convertToExcalidrawElements зовём с regenerateIds:false
     (иначе развалятся привязки стрелок), и второй пакет с теми же "b1"/"b2" дал бы на доске
     два элемента с одним id — вендор от этого ломается. Отсюда свой префикс у каждой операции. */
  const пр = "ai" + uid() + "_";
  /* Кегль и высота подбираются ВМЕСТЕ: сперва пробуем уместить подпись в блок ступенями кегля,
     а если не влезло и на самом мелком — растим блок клетками. Текст, вылезающий за рамку,
     читается как поломка; высокий блок — нет. */
  блоки.forEach(b=>{
    b.h = Math.max(1, Math.round(+b.h || 1));
    let г = drawGridBox(0, 0, b.w || 1, b.h);
    b.fontSize = drawFitFont(b.text, г.w, г.h);
    while(b.h < DRAW_MAX_CELLS && !drawTextFits(b.text, г.w, г.h, b.fontSize)){
      b.h++;
      г = drawGridBox(0, 0, b.w || 1, b.h);
      b.fontSize = drawFitFont(b.text, г.w, г.h);   // стало выше — может влезть и кегль покрупнее
    }
  });
  /* ВЫСОТА РЯДА — по самому высокому блоку в нём, а не жёсткий шаг сетки: блок в две клетки
     иначе налез бы на следующий ряд. Верх ряда считаем накоплением сверху вниз. */
  const высРяда = new Map();
  блоки.forEach(b=>{ const р = Math.round(+b.row || 0);
    высРяда.set(р, Math.max(высРяда.get(р) || 1, b.h)); });
  const верх = new Map();
  let нак = 0;
  Array.from(высРяда.keys()).sort((a, б) => a - б).forEach(р=>{ верх.set(р, нак); нак += высРяда.get(р); });

  const впикселях = блоки.map(b=>{
    const г = drawGridBox(b.col || 0, верх.get(Math.round(+b.row || 0)) || 0, b.w || 1, b.h);
    const н = {id: пр+b.id, type: b.type, text: b.text, x: г.x, y: г.y, w: г.w, h: г.h,
               fontSize: b.fontSize};
    if(b.color) н.color = b.color;
    if(b.parent) н.parent = пр + b.parent;
    return н;
  });
  // подпись стрелки — короткая («да», «нет»), подбирать ей кегль не по чему: даём тот же L
  const рёбра = (оп.edges || []).map(e=>({from: пр+e.from, to: пр+e.to, label: e.label, fontSize: DRAW_FONT}));
  return drawBuild(впикселях, рёбра);
}

/* Запись собранной сцены в доску ноды. Возвращает, сколько элементов добавлено. */
function drawApplyBoard(it, оп){
  /* Незаписанный штрих дожимаем ПЕРЕД чтением доски. Между штрихом человека и применением
     лежит дебаунс 900 мс: без этого отложенный drawStash сработал бы ПОСЛЕ нас и вернул доску
     к виду до пакета. Та же болезнь и то же лечение, что у раскладки графа (flushLayout). */
  if(drawItem && drawItem.id === it.id) drawFlush();
  /* Пометка — СРАЗУ ПОСЛЕ дожатия и ДО всякой записи. После дожатия, потому что штрих человека
     сделан ДО пакета и обязан вернуться откатом; до записи — потому что дальше прежней сцены
     уже не будет. И до переноса схемы ниже: иначе шаг запомнил бы «была сконвертированная
     доска» вместо честного «доски не было вовсе». */
  txBoardMark(it.id);
  /* Нода со старой схемой, которую ни разу не открывали: доски ещё нет, а it.flow есть. Запиши
     мы сцену напрямую — boardOf перестал бы быть пустым, и схема не перенеслась бы уже НИКОГДА
     (drawSeedFromFlow выходит сразу, если доска есть). Поэтому сперва перенос, потом дорисовка. */
  if(!boardOf(it.id)) drawSeedFromFlow(it);
  const прежняя = boardOf(it.id) || {};
  const было = (оп.mode === "replace") ? [] : (Array.isArray(прежняя.elements) ? прежняя.elements : []);
  const новые = (оп._els || []).map(э=>Object.assign({}, э));
  /* Дорисовка не должна ложиться ПОВЕРХ нарисованного: сдвигаем новое под нижний край того, что
     уже есть, с выравниванием по клетке. Тот же приём, которым cmdApply кладёт новые ноды
     справа от всего дерева. Сдвиг общий и по одной оси — так у стрелок и подписей, привязанных
     к фигурам, не разъезжаются координаты. */
  let низ = -Infinity;
  было.forEach(э=>{ if(э && !э.isDeleted && isFinite(э.y)) низ = Math.max(низ, (+э.y||0) + (+э.height||0)); });
  const сдвиг = isFinite(низ) ? Math.ceil((низ + DRAW_GRID.y) / DRAW_GRID.y) * DRAW_GRID.y : 0;
  if(сдвиг) новые.forEach(э=>{ э.y = (+э.y||0) + сдвиг; });
  boardSet(it.id, {
    elements: было.concat(новые),
    // при замене уходят и картинки: на них больше некому ссылаться, а это мегабайты base64
    files: (оп.mode === "replace") ? {} : (прежняя.files || {}),
    appState: прежняя.appState || {},
    fromFlow: !!прежняя.fromFlow
  });
  drawSyncFrom(it.id);                // доска открыта — обновить то, что человек видит сейчас
  return новые.length;
}

/* СЦЕНА → КОМПАКТНЫЙ ВИД, обратное drawBuildSpec. Без этого агент умеет только рисовать с нуля:
   дописать существующую схему он не может, потому что не знает, что на ней.

   Картинки не отдаются НИКОГДА — ни целиком, ни кусками: это мегабайты base64 и чужие
   фотографии, у них наружу выходит только место и размер. Вид блока определяется ПРИБЛИЗИТЕЛЬНО
   (в сцене от стиля осталась только обводка), и это честно сказано в описании инструмента.
   Чего не разобрали — считаем в skipped: модель обязана знать, что видит не всё, иначе
   «заменить доску» сотрёт то, чего ей не показали. */
function drawSpecFromScene(elements){
  const els = (Array.isArray(elements) ? elements : []).filter(э=>э && !э.isDeleted);
  const подписи = {};       // containerId → текст: подпись сливается в свой блок, отдельной не выезжает
  els.forEach(э=>{ if(э.type==="text" && э.containerId) подписи[э.containerId] = String(э.text||""); });
  const блоки = [], рёбра = [], пропущено = {};
  const мимо = к => { пропущено[к] = (пропущено[к]||0) + 1; };
  const кл = (v, шаг) => Math.round((+v||0)/шаг);
  const разм = (v, шаг) => Math.max(1, Math.round((+v||0)/шаг));
  els.forEach(э=>{
    const общее = () => ({id:э.id, col:кл(э.x, DRAW_GRID.x), row:кл(э.y, DRAW_GRID.y),
                          w:разм(э.width, DRAW_GRID.x), h:разм(э.height, DRAW_GRID.y)});
    if(э.type==="text"){
      if(э.containerId) return;                       // ушла в свой блок или в подпись стрелки
      блоки.push(Object.assign(общее(), {type:"text", text:String(э.text||"")}));
      return;
    }
    if(э.type==="arrow"){
      const от = (э.startBinding && э.startBinding.elementId) || null;
      const к  = (э.endBinding   && э.endBinding.elementId)   || null;
      if(!от && !к) мимо("свободные стрелки");
      const р = {from:от, to:к};
      if(подписи[э.id]) р.label = подписи[э.id];
      рёбра.push(р);
      return;
    }
    if(э.type==="frame" || э.type==="magicframe"){
      блоки.push(Object.assign(общее(), {type:"frame", text:String(э.name||"")}));
      return;
    }
    if(э.type==="image"){
      блоки.push(Object.assign(общее(), {type:"image", text:""}));
      return;
    }
    if(э.type==="rectangle" || э.type==="ellipse" || э.type==="diamond"){
      блоки.push(Object.assign(общее(), {type: э.strokeStyle==="dashed" ? "comment" : "proc",
                                         text: подписи[э.id] || ""}));
      return;
    }
    мимо(э.type || "прочее");
  });
  return {blocks:блоки, edges:рёбра, skipped:пропущено};
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
    const край = setTimeout(()=>res(false), 3000);
    /* Шрифт ПРОСИМ загрузиться, а не ждём у моря погоды. document.fonts.ready дожидается только
       уже НАЧАТЫХ загрузок: если доску в этой сессии не открывали, гарнитуру никто не запрашивал,
       ready резолвится мгновенно, а check() остаётся ложным. Тогда перенос строк считался по
       подменной гарнитуре, и подписи вылезали за края блоков (КРОЛИК, снимок 07.09.2026).
       load() загрузку начинает и ждёт по-настоящему. */
    let ждём;
    try{ ждём = document.fonts.load('16px Excalifont'); }catch(e){ ждём = null; }
    Promise.all([Promise.resolve(ждём), Promise.resolve(document.fonts.ready)])
      .then(()=>{ clearTimeout(край); res(готовы()); })
      .catch(()=>{ clearTimeout(край); res(готовы()); });
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
