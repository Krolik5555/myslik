/* ============================================================================
   ЯЗЫК КОМАНД: пакет операций, который Мыслик умеет разобрать, показать и применить.

   Зачем. Сторонняя нейросеть не имеет доступа к приложению — но может ВЫДАТЬ ТЕКСТ. Даёшь ей
   промпт со снимком графа (cmdPrompt), она отвечает пакетом операций, ты вставляешь ответ в
   окно «Общение с нейросетью» и видишь, ЧТО именно будет сделано, прежде чем это случится.
   Тот же пакет потом сможет приносить и ИИ-агент программно — разбор, проверка и применение
   от источника не зависят.

   ПОЧЕМУ JSON, А НЕ ИСПОЛНЯЕМЫЙ КОД. Корзины в Мыслике нет, удаление сразу насовсем. Скрипт,
   который выполняется как код, может снести граф, и вернуть его будет нечем. Операции же
   проверяются по БЕЛОМУ СПИСКУ: сделать то, чего в списке нет, пакет физически не может, а
   каждое поле проходит через те же реестры, что и остальное приложение (KINDS, СТАТУСЫ,
   makeDate, PALETTE, ICONS). Плюс замерено на локальной модели: JSON по схеме надёжнее уговоров
   в промпте — потому весь ИИ в проекте и говорит с приложением через JSON.

   ЧТО ПАКЕТ НЕ ДЕЛАЕТ. Не трогает настройки, не переключает графы и не удаляет ничего без
   отдельного подтверждения человеком.

   ПОЛОТНО (op "draw") РИСУЕТСЯ НЕ ВЕНДОРСКИМ ФОРМАТОМ. Служебные поля элементов Excalidraw
   (seed, versionNonce, привязки стрелок) модель собирает плохо, и требовать их от неё нельзя.
   Поэтому пакет несёт КОМПАКТНЫЙ скелет — блоки и стрелки в клетках сетки, — а разворачивает
   его в настоящую сцену draw.js (drawBuildSpec), где и живут обходы граблей вендора.
   ============================================================================ */

const CMD_V = 1;
const CMD_MAX_OPS = 300;          // потолок на пакет: защита от «модель выдала простыню», не от человека
const CMD_SNAP_NODES = 400;       // сколько нод влезает в снимок для нейросети, дальше срезаем
const CMD_DRAW_BLOCKS = 120;      // блоков в одной операции draw: дальше схему всё равно не прочитать
const CMD_DRAW_EDGES = 200;
/* БЕЛЫЙ СПИСОК КОМАНД. Всё, чего здесь нет, отвергается на разборе с внятной ошибкой — пакет не
   может сделать ничего, что не перечислено. Сама обработка живёт одним проходом в cmdApply,
   чтобы порядок операций и общие локальные имена были видны в одном месте. */
const CMD_HANDLERS = {node:1, edit:1, link:1, unlink:1, field:1, done:1, area:1, delete:1, draw:1};

/* ---------- разбор ----------
   Модели почти всегда оборачивают ответ в ```json … ``` и добавляют пару слов от себя.
   Вырезаем сами, а не требуем чистоты: иначе половина ответов отвергалась бы из-за вежливости. */
function cmdExtractJson(text){
  let s = String(text == null ? "" : text).trim();
  if(!s) return "";
  const блок = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(блок) s = блок[1].trim();
  const первый = s.search(/[[{]/);
  if(первый < 0) return "";
  const открыт = s[первый];
  const последний = s.lastIndexOf(открыт === "[" ? "]" : "}");
  if(последний <= первый) return "";
  return s.slice(первый, последний + 1);
}

// значение как ссылка: локальное имя из "as" либо настоящий id ноды
function _cmdRefOk(x){ return typeof x === "string" && !!x.trim(); }
// нода по id В ЛЮБОМ графе: пакет умеет класть внутрь подграфов, а они отдельные графы
function cmdFindAny(id){
  if(!id) return null;
  for(const g of (S.graphs || [])){ const it = (g.items || []).find(i => i && i.id === id); if(it) return it; }
  return null;
}
// в каком графе лежит нода. Нужно и разбору (связь возможна только внутри одного графа),
// и применению (S.items/S.links — геттеры на АКТИВНЫЙ граф, см. graphBind)
function cmdGraphOf(id){
  if(!id) return null;
  for(const g of (S.graphs || [])){ if((g.items || []).some(i => i && i.id === id)) return g.id; }
  return null;
}

/* Разбор и проверка. Ничего не применяет и ничего не создаёт — на выходе только список
   нормализованных операций плюс ошибки и замечания по номерам. Ошибка = пакет не применяем
   вовсе: половина применённого пакета хуже, чем ни одного. */
function cmdParse(text){
  const errors = [], warns = [];
  const raw = cmdExtractJson(text);
  if(!raw) return {ops:[], errors:['Не нашёл JSON. В ответе нейросети должен быть объект {"ops":[…]} или массив операций.'], warns};
  let data;
  try { data = JSON.parse(raw); }
  catch(e){ return {ops:[], errors:["JSON не разобрался: " + e.message], warns}; }

  const список = Array.isArray(data) ? data
               : (data && typeof data === "object" && Array.isArray(data.ops)) ? data.ops : null;
  if(!список) return {ops:[], errors:['В пакете нет списка операций: ждал {"ops":[…]} или просто массив.'], warns};
  if(!список.length) return {ops:[], errors:["Пакет пустой — выполнять нечего."], warns};
  if(data && !Array.isArray(data) && data.v != null && +data.v !== CMD_V)
    warns.push("Пакет помечен версией " + data.v + ", приложение понимает " + CMD_V + " — разбираю как умею.");
  if(список.length > CMD_MAX_OPS)
    return {ops:[], errors:["Операций " + список.length + ", потолок " + CMD_MAX_OPS + ". Разбей на части."], warns};

  const псевдо = new Set();        // локальные имена, объявленные через "as" ВЫШЕ по списку
  const ops = [];
  /* ГДЕ ОКАЖЕТСЯ КАЖДАЯ НОДА — считаем ЗАРАНЕЕ, по ключу «контейнера». Связь физически живёт
     в links КОНКРЕТНОГО графа, и связать ноды из разных подграфов нельзя вовсе: для одного
     графа второй ноды просто не существует. Раньше такая связь молча уезжала в активный граф
     и не рисовалась нигде (ChatGPT прислал ровно такой пакет — «создал, но внутри не соединил»).
     Ключ строковый и сравнивается как есть: у нод без "in" это id текущего графа, у вложенных —
     имя контейнера, у существующих — граф, в котором они лежат. */
  const видПоИмени = {};           // as → kind (чтобы проверить, что "in" указывает на подграф)
  const контПоИмени = {};          // as → ключ контейнера
  const ключКонт = ref => {
    if(контПоИмени[ref] !== undefined) return контПоИмени[ref];
    return cmdGraphOf(ref) || "?";
  };
  // ключ графа, который создаст "in": у локального имени — само имя, у существующей ноды — её подграф
  const ключВнутри = ref => (контПоИмени[ref] !== undefined) ? ("in:" + ref) : subKey(ref);
  список.forEach((сырое, i) => {
    const н = i + 1;
    const бед = m => errors.push("Операция " + н + ": " + m);
    if(!сырое || typeof сырое !== "object" || Array.isArray(сырое)) { бед("это не объект операции."); return; }
    const op = String(сырое.op || "").trim();
    if(!CMD_HANDLERS[op]) { бед('неизвестная команда "' + (op || "—") + '". Есть: ' + Object.keys(CMD_HANDLERS).join(", ") + "."); return; }

    /* Ссылка на ноду: либо локальное имя, объявленное выше в этом же пакете, либо настоящий id
       существующей ноды. Проверяем СРАЗУ, а не при применении: пакет, который сломается на
       середине, уже успеет наделать половину дел. */
    const ссылка = (значение, поле, обяз) => {
      if(значение == null || значение === ""){ if(обяз) бед("не указано поле «" + поле + "»."); return null; }
      if(!_cmdRefOk(значение)){ бед("поле «" + поле + "» должно быть строкой."); return null; }
      const v = String(значение);
      if(псевдо.has(v) || cmdFindAny(v)) return v;
      бед('в поле «' + поле + '» нода "' + v + '" не найдена — ни среди созданных этим пакетом, ни в данных.');
      return null;
    };

    const o = {op, _n: н};
    let плохо = false;

    if(op === "node" || op === "edit"){
      if(op === "edit"){ o.id = ссылка(сырое.id != null ? сырое.id : сырое.node, "id", true); if(!o.id) плохо = true; }
      if(сырое.kind != null){
        const k = String(сырое.kind);
        if(!KINDS[k]) { бед('вид "' + k + '" не из списка: ' + Object.keys(KINDS).join(", ") + "."); плохо = true; }
        else o.kind = k;
      } else if(op === "node") o.kind = "task";
      if(сырое.title != null) o.title = String(сырое.title).slice(0, 300);
      if(сырое.body != null) o.body = String(сырое.body).slice(0, 20000);
      if(сырое.due != null && сырое.due !== ""){
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(сырое.due));
        if(!m || !makeDate(m[1], m[2], m[3])) { бед('срок "' + сырое.due + '" не дата вида ГГГГ-ММ-ДД.'); плохо = true; }
        else o.due = String(сырое.due);
      } else if(сырое.due === null || сырое.due === "") o.due = null;
      if(сырое.status != null){
        const st = String(сырое.status);
        const вид = o.kind || (op === "edit" ? ((cmdFindAny(o.id) || {}).kind || "task") : "task");
        if(!СТАТУСЫ[st]) { бед('статус "' + st + '" не из реестра.'); плохо = true; }
        else if(статусыДляВида(вид).indexOf(st) < 0) { бед('статус "' + st + '" виду «' + kindRu(вид) + '» не подходит.'); плохо = true; }
        else o.status = st;
      }
      if(сырое.priority != null){
        const p = +сырое.priority;
        if(!(p >= 0 && p <= 3)) { бед("приоритет только 0…3."); плохо = true; } else o.priority = Math.round(p);
      }
      if(сырое.repeat != null){
        const r = String(сырое.repeat);
        if(!REPEAT.hasOwnProperty(r)) { бед('повтор "' + r + '" не из списка: ' + Object.keys(REPEAT).join(", ") + "."); плохо = true; }
        else o.repeat = r;
      }
      if(сырое.tags != null){
        if(!Array.isArray(сырое.tags)) { бед("теги должны быть массивом строк."); плохо = true; }
        else o.tags = сырое.tags.map(x => String(x).replace(/^#/, "").trim()).filter(Boolean).slice(0, 20);
      }
      if(сырое.color != null && сырое.color !== ""){
        const c = String(сырое.color);
        if(!/^#[0-9a-fA-F]{3,8}$/.test(c)) { бед('цвет "' + c + '" не в виде #rrggbb.'); плохо = true; } else o.color = c;
      }
      if(сырое.x != null && isFinite(сырое.x)) o.x = Math.round(+сырое.x);
      if(сырое.y != null && isFinite(сырое.y)) o.y = Math.round(+сырое.y);
      if(сырое.area != null && сырое.area !== ""){
        const a = String(сырое.area);
        const нашли = (S.areas || []).find(x => x.id === a || x.name === a);
        if(!нашли && !псевдо.has(a)) { бед('область "' + a + '" не найдена.'); плохо = true; }
        else o.area = нашли ? нашли.id : a;
      }
      if(сырое.in != null && сырое.in !== ""){
        o.in = ссылка(сырое.in, "in", false);
        if(!o.in) плохо = true;
        else {
          /* «in» кладёт ноду ВНУТРЬ подграфа — значит цель обязана быть подграфом. Раньше
             не-подграф проваливался молча: нода уезжала в текущий граф, а предпросмотр при этом
             обещал «внутри такой-то». Тихо не туда — худший из возможных исходов. */
          const вид = (видПоИмени[o.in] !== undefined) ? видПоИмени[o.in] : ((cmdFindAny(o.in) || {}).kind);
          if(вид !== "sub"){
            бед('«in» указывает на ноду вида «' + kindRu(вид || "task") + '», а внутрь кладут только в подграф (kind "sub").');
            плохо = true;
          }
        }
      }
      if(op === "node" && сырое.as != null){
        const a = String(сырое.as).trim();
        if(!a) { бед("пустое имя в «as»."); плохо = true; }
        else if(псевдо.has(a)) { бед('имя "' + a + '" уже занято выше по пакету.'); плохо = true; }
        else { o.as = a; псевдо.add(a);
          видПоИмени[a] = o.kind || "task";
          контПоИмени[a] = o.in ? ключВнутри(o.in) : S.settings.graph; }
      }
      if(op === "node" && !(o.title || "").trim()) warns.push("Операция " + н + ": нода без названия — на графе её будет не опознать.");
    }
    else if(op === "link" || op === "unlink"){
      o.from = ссылка(сырое.from, "from", true);
      o.to   = ссылка(сырое.to, "to", true);
      if(!o.from || !o.to) плохо = true;
      else if(o.from === o.to) { бед("нельзя связать ноду саму с собой."); плохо = true; }
      else {
        /* СВЯЗЬ ЖИВЁТ В links КОНКРЕТНОГО ГРАФА. Ноды из разных подграфов связать нечем: для
           одного графа второй ноды не существует вовсе, и такая связь была бы записью в никуда. */
        const ка = ключКонт(o.from), кб = ключКонт(o.to);
        if(ка !== кб){
          бед("ноды лежат в разных графах — связать их нечем. Внутри подграфа связывай только его собственные ноды.");
          плохо = true;
        } else o._g = ка;
      }
      if(op === "link" && сырое.len != null){
        const L = +сырое.len;
        if(!(L >= 0.3 && L <= 3)) { бед("длина связи только 0.3…3."); плохо = true; } else o.len = L;
      }
    }
    else if(op === "field"){
      o.node = ссылка(сырое.node != null ? сырое.node : сырое.id, "node", true);
      if(!o.node) плохо = true;
      const t = String(сырое.type || "text");
      if(t !== "text" && t !== "image") { бед('поле бывает "text" или "image" (доску пакетом не заводим).'); плохо = true; }
      else o.type = t;
      o.name = String(сырое.name == null ? "" : сырое.name).slice(0, 80);
      if(o.type === "text") o.value = String(сырое.value == null ? "" : сырое.value).slice(0, 20000);
      if(o.type === "image"){
        const p = сырое.path != null ? String(сырое.path) : "";
        const d = сырое.data != null ? String(сырое.data) : "";
        if(d && /^data:image\//i.test(d)) o.data = d;
        else if(p) o.path = p;
        else { бед("картинке нужен «path» (файл на диске) или «data» (data:image/…)."); плохо = true; }
      }
    }
    else if(op === "done"){
      o.node = ссылка(сырое.node != null ? сырое.node : сырое.id, "node", true);
      if(!o.node) плохо = true;
      o.value = (сырое.value === undefined) ? true : !!сырое.value;
    }
    else if(op === "area"){
      const имя = String(сырое.name == null ? "" : сырое.name).trim();
      if(!имя) { бед("области нужно имя."); плохо = true; } else o.name = имя.slice(0, 60);
      if(сырое.icon != null){
        const ic = String(сырое.icon);
        if(!ICONS.includes(ic)) warns.push("Операция " + н + ': значка "' + ic + '" нет в наборе — поставлю обычную папку.');
        else o.icon = ic;
      }
      if(сырое.color != null && сырое.color !== ""){
        const c = String(сырое.color);
        if(/^#[0-9a-fA-F]{3,8}$/.test(c)) o.color = c;
        else warns.push("Операция " + н + ": цвет области отброшен, ждал #rrggbb.");
      }
      if(сырое.as != null){
        const a = String(сырое.as).trim();
        if(a && !псевдо.has(a)) { o.as = a; псевдо.add(a); }
      }
    }
    else if(op === "delete"){
      o.node = ссылка(сырое.node != null ? сырое.node : сырое.id, "node", true);
      if(!o.node) плохо = true;
    }
    else if(op === "draw"){
      o.node = ссылка(сырое.node != null ? сырое.node : сырое.id, "node", true);
      if(!o.node) плохо = true;
      else {
        /* Доска есть только у ПОЛОТНА (см. openFlowEditor): у задачи её негде показать, и
           запись ушла бы в никуда. Проверяем на разборе, как «in» проверяет подграф — тихо
           не туда худший из возможных исходов. */
        const вид = (видПоИмени[o.node] !== undefined) ? видПоИмени[o.node] : ((cmdFindAny(o.node) || {}).kind);
        if(вид !== "flow"){
          бед('рисовать можно только на полотне (kind "flow"), а «node» указывает на «' + kindRu(вид || "task") + '».');
          плохо = true;
        }
      }
      const реж = String(сырое.mode || "append");
      if(реж !== "append" && реж !== "replace"){ бед('«mode» бывает "append" (дорисовать) или "replace" (заменить).'); плохо = true; }
      else o.mode = реж;

      const цел = (v, мин, макс) => { const x = Math.round(+v); return (isFinite(x) && x >= мин && x <= макс) ? x : null; };
      const имена = new Set();
      const сб = Array.isArray(сырое.blocks) ? сырое.blocks : null;
      if(!сб || !сб.length){ бед("в «blocks» нужен хотя бы один блок."); плохо = true; }
      else if(сб.length > CMD_DRAW_BLOCKS){ бед("блоков " + сб.length + ", потолок " + CMD_DRAW_BLOCKS + ". Раздели схему."); плохо = true; }
      else {
        o.blocks = [];
        сб.forEach((b, j) => {
          const где = "блок " + (j + 1);
          if(!b || typeof b !== "object" || Array.isArray(b)){ бед(где + " — не объект."); плохо = true; return; }
          const id = String(b.id == null ? "" : b.id).trim();
          if(!id){ бед(где + " без «id» — на него ссылаются стрелки."); плохо = true; return; }
          if(имена.has(id)){ бед('id блока "' + id + '" повторяется.'); плохо = true; return; }
          имена.add(id);
          const t = String(b.type == null || b.type === "" ? "proc" : b.type);
          if(DRAW_BLOCK_TYPES.indexOf(t) < 0){
            бед(где + ': вид "' + t + '" не из списка: ' + DRAW_BLOCK_TYPES.join(", ") + ".");
            плохо = true; return;
          }
          const бл = {id: id, type: t, text: String(b.text == null ? "" : b.text).slice(0, 300)};
          if(b.color != null && b.color !== ""){
            const c = String(b.color);
            if(/^#[0-9a-fA-F]{3,8}$/.test(c)) бл.color = c;
            else warns.push("Операция " + н + ": цвет блока «" + id + "» отброшен, ждал #rrggbb.");
          }
          // клетки, а не пиксели: 0…200 по каждой оси хватает любой читаемой схеме
          if(b.col != null) бл.col = цел(b.col, 0, 200);
          if(b.row != null) бл.row = цел(b.row, 0, 200);
          бл.w = (b.w != null ? цел(b.w, 1, 12) : null) || 1;
          бл.h = (b.h != null ? цел(b.h, 1, 12) : null) || 1;
          if(b.parent != null && b.parent !== "") бл.parent = String(b.parent);
          o.blocks.push(бл);
        });
        (o.blocks || []).forEach(б => {
          if(б.parent && !имена.has(б.parent)) warns.push("Операция " + н + ": блок «" + б.id + "» указывает на рамку «" + б.parent + "», которой в пакете нет — ляжет сам по себе.");
        });
        /* Координаты либо у ВСЕХ блоков, либо ни у кого. Смешивать нельзя: заданные и
           вычисленные ложатся друг на друга, и это читается как поломка раскладки, а не как
           неполный ответ модели. Поэтому не ошибка, а замечание — и раскладываем всё сами. */
        const своих = (o.blocks || []).filter(б => б.col != null && б.row != null).length;
        if(своих && своих < (o.blocks || []).length)
          warns.push("Операция " + н + ": координаты есть не у всех блоков — раскладываю всю схему сам, по связям.");
      }

      const се = Array.isArray(сырое.edges) ? сырое.edges : [];
      if(се.length > CMD_DRAW_EDGES){ бед("стрелок " + се.length + ", потолок " + CMD_DRAW_EDGES + "."); плохо = true; }
      else {
        o.edges = [];
        се.forEach((e, j) => {
          const где = "стрелка " + (j + 1);
          if(!e || typeof e !== "object" || Array.isArray(e)){ бед(где + " — не объект."); плохо = true; return; }
          const от = String(e.from == null ? "" : e.from), к = String(e.to == null ? "" : e.to);
          if(!имена.has(от) || !имена.has(к)){
            бед(где + ': ведёт к блоку, которого нет в «blocks» ("' + от + '" → "' + к + '").');
            плохо = true; return;
          }
          if(от === к){ бед(где + ": блок сам на себя."); плохо = true; return; }
          const р = {from: от, to: к};
          if(e.label != null && e.label !== "") р.label = String(e.label).slice(0, 120);
          o.edges.push(р);
        });
      }

      /* ЗАМЕНА НЕПУСТОЙ ДОСКИ — ЭТО УДАЛЕНИЕ, и спрашивается отдельно: корзины нет, а рисунок
         человека пропал бы молча. Считаем прямо здесь, чтобы предпросмотр назвал число.
         У ноды, создаваемой этим же пакетом (локальное имя), стирать нечего по определению. */
      if(!плохо && o.mode === "replace"){
        const цель = cmdFindAny(o.node);
        const д = цель ? ((S.boards || {})[цель.id]) : null;
        o.wipes = (д && Array.isArray(д.elements)) ? д.elements.length : 0;
      }
    }

    if(!плохо) ops.push(o);
  });

  /* КОРЕНЬ КУСТА БЕЗ ОБЛАСТИ — ПРЕДУПРЕЖДАЕМ ДО ПРИМЕНЕНИЯ. Дерево основного графа считается от
     областей (recomputeHierarchy): куст, чей верх не привязан ни к области, ни к существующей
     ноде, ляжет плоско — parent у всех пустой, а снимок по root отдаст одну ноду (сквозная
     проверка 08.09.2026). Правило «area у корня» в cmdPrompt есть, но его нарушение обязано
     быть видно в preview, а не после apply. Одиночную ноду без детей не трогаем: ей дерево
     ни к чему, а человек такие заводит постоянно. */
  {
    const своиИмена = new Set(ops.filter(o => o.op === "node" && o.as).map(o => o.as));
    const вTo = new Set(ops.filter(o => o.op === "link").map(o => o.to));
    ops.forEach(o => {
      if(o.op !== "node" || o.in || o.area || !o.as || вTo.has(o.as)) return;
      const связи = ops.filter(l => l.op === "link" && (l.from === o.as || l.to === o.as));
      if(!связи.length) return;                                        // одиночка — не куст
      if(связи.some(l => !своиИмена.has(l.from) || !своиИмена.has(l.to))) return;   // держится за существующую ноду
      warns.push("Корень куста «" + (o.title || "").trim() + "» без area — в графе он останется без дерева (parent у всех пустой). Укажи область корню.");
    });
  }

  return {ops, errors, warns};
}

/* ---------- предпросмотр ----------
   Философия ИИ в проекте одна: предлагает, не перекраивает (см. docs/ИИ.md). Пакет не
   применяется, пока человек не увидел строчками, что именно случится. Удаления помечены
   отдельно — по ним ещё спросят. */
function cmdPreview(ops){
  const имя = x => {
    const it = cmdFindAny(x);
    if(it) return "«" + ((it.title || "").trim() || "без названия") + "»";
    return "«" + x + "» (создаётся здесь же)";
  };
  return (ops || []).map(o => {
    if(o.op === "node"){
      const хвост = [o.due ? "срок " + o.due : "", o.status ? СТАТУСЫ[o.status].имя.toLowerCase() : "",
                     (o.tags || []).length ? "#" + o.tags.join(" #") : "", o.in ? "внутри " + имя(o.in) : ""].filter(Boolean).join(", ");
      return {i: kindIcon(o.kind), t: "Создать " + kindRu(o.kind) + " «" + ((o.title || "").trim() || "без названия") + "»" + (хвост ? " · " + хвост : "")};
    }
    if(o.op === "edit"){
      const что = ["kind","title","body","due","status","priority","repeat","tags","color","area"].filter(k => o[k] !== undefined);
      return {i: "ti-pencil", t: "Изменить " + имя(o.id) + (что.length ? " · " + что.join(", ") : " · нечего менять")};
    }
    if(o.op === "link")   return {i: "ti-link", t: "Связать " + имя(o.from) + " и " + имя(o.to)};
    if(o.op === "unlink") return {i: "ti-unlink", t: "Развязать " + имя(o.from) + " и " + имя(o.to)};
    if(o.op === "field")  return {i: o.type === "image" ? "ti-photo" : "ti-align-left",
                                  t: "Поле " + (o.type === "image" ? "с картинкой" : "с текстом") + (o.name ? " «" + o.name + "»" : "") + " в " + имя(o.node)};
    if(o.op === "done")   return {i: o.value ? "ti-check" : "ti-rotate", t: (o.value ? "Завершить " : "Вернуть в работу ") + имя(o.node)};
    if(o.op === "area")   return {i: o.icon || "ti-folder", t: "Создать область «" + o.name + "»"};
    if(o.op === "delete") return {i: "ti-trash", t: "УДАЛИТЬ " + имя(o.node) + " со всем содержимым", danger: true};
    if(o.op === "draw"){
      const сколько = "блоков " + (o.blocks || []).length + ", стрелок " + (o.edges || []).length;
      // draw: сама операция — по ней окно рисует миниатюру будущей схемы (см. openCmdRunner)
      if(o.wipes) return {i: "ti-artboard", danger: true, draw: o,
        t: "ЗАМЕНИТЬ доску " + имя(o.node) + " · сотрётся элементов: " + o.wipes + " · " + сколько};
      return {i: "ti-artboard", draw: o, t: "Нарисовать на полотне " + имя(o.node) + " · " + сколько};
    }
    return {i: "ti-question-mark", t: o.op};
  });
}
/* Замена непустой доски идёт по той же дороге, что и удаление ноды: рисунок человека не
   вернуть ничем, кроме отката, и «ИИ так решил» тут не оправдание. */
const cmdHasDelete = ops => (ops || []).some(o => o.op === "delete" || (o.op === "draw" && o.wipes > 0));

/* ФОРМА ТОГО, ЧТО ПОСТРОИТСЯ. Плоский список операций отвечает на вопрос «что произойдёт», но
   не на главный — «как это будет выглядеть». А ошибаются как раз в форме: последовательные шаги
   вешают веером на общего родителя вместо цепочки, и по списку «Связать A и B» × 8 это не видно
   вовсе. Отступами видно сразу.
   Строим по связям ВНУТРИ пакета: узел, к которому никто не ведёт, — корень ветки. */
function cmdShape(ops){
  const узлы = {}, порядок = [];
  (ops || []).forEach(o => { if(o.op === "node" && o.as){ узлы[o.as] = o; порядок.push(o.as); } });
  if(порядок.length < 2) return [];
  const дети = {}, входящих = {};
  порядок.forEach(a => { дети[a] = []; входящих[a] = 0; });
  (ops || []).forEach(o => {
    if(o.op !== "link" || !узлы[o.from] || !узлы[o.to]) return;
    дети[o.from].push(o.to); входящих[o.to]++;
  });
  const корни = порядок.filter(a => !входящих[a]);
  if(!корни.length) return [];
  const строки = [], виден = new Set();
  const обойти = (a, гл) => {
    if(виден.has(a) || гл > 8) return;
    виден.add(a);
    const o = узлы[a];
    строки.push({d: гл, i: kindIcon(o.kind), t: (o.title || "").trim() || "без названия",
                 k: kindRu(o.kind), сколько: дети[a].length});
    дети[a].forEach(d => обойти(d, гл + 1));
  };
  корни.forEach(к => обойти(к, 0));
  // ноды, ни с чем не связанные в этом пакете, показываем в конце — иначе они просто исчезнут
  порядок.forEach(a => { if(!виден.has(a)) обойти(a, 0); });
  return строки;
}

/* ---------- картинки ----------
   Читаем файлы ДО применения и по одному: чтение идёт через мост в Python и может отказать
   (нет файла, не картинка, слишком большой). Отказ на середине применённого пакета оставил бы
   половину работы, поэтому сюда — всё, что умеет не получиться. */
async function cmdLoadImages(ops){
  const беды = [];
  for(const o of (ops || [])){
    if(o.op !== "field" || o.type !== "image" || o.data) continue;
    if(!HasPy() || !window.pywebview.api.read_image){ беды.push("Операция " + o._n + ": читать файлы с диска умеет только собранное приложение."); continue; }
    let url = "";
    try { url = await window.pywebview.api.read_image(o.path); } catch(e){ url = ""; }
    if(!url){ беды.push("Операция " + o._n + ': не смог прочитать картинку "' + o.path + '".'); continue; }
    // ужимаем той же дорогой, что и вставка руками: снимок с телефона — это мегабайты в planner.json
    try { o.data = (typeof fieldShrink === "function") ? await fieldShrink(url, "image/jpeg") : url; }
    catch(e){ o.data = url; }
  }
  return беды;
}

/* ---------- полотно ----------
   Сцену собираем ДО применения и по той же причине, что и картинки: вендор доски грузится
   лениво, а его фабрика умеет бросить на непредусмотренном сочетании фигур — отказ на середине
   применённого пакета оставил бы половину работы. Собранное кладём на саму операцию (`_els`):
   токен предпросмотра унесёт его с собой, и второй раз ничего не собирается. */
function _cmdBuildOps(рисуют, беды){
  рисуют.forEach(o => {
    if(o._els) return;                       // уже собрано (повторный предпросмотр того же пакета)
    try { o._els = drawBuildSpec(o); }
    catch(e){ беды.push("Операция " + o._n + ": схема не собралась — " + String((e && e.message) || e)); }
  });
  return беды;
}
// в окне ждать загрузку можно: обработчик кнопки асинхронный, как и у чтения картинок
async function cmdBuildBoards(ops){
  const беды = [], рисуют = (ops || []).filter(o => o.op === "draw");
  if(!рисуют.length) return беды;
  if(typeof drawLibReady !== "function" || !(await drawLibReady())){
    беды.push("Доска не загрузилась — рисовать нечем. Проверь ui/vendor/excalidraw/.");
    return беды;
  }
  return _cmdBuildOps(рисуют, беды);
}
/* У АГЕНТА ЖДАТЬ НЕЧЕМ: cmdAgent синхронен целиком. Загрузку вендора дожидается Python
   (app.py: _agent_prepare опрашивает метод "drawlib"), сюда пакет приходит уже к готовой
   библиотеке — а если нет, честный отказ ДО применения. */
function cmdBuildBoardsSync(ops){
  const беды = [], рисуют = (ops || []).filter(o => o.op === "draw");
  if(!рисуют.length) return беды;
  const сост = (typeof drawLibState === "function") ? drawLibState() : {lib: false};
  if(!сост.lib){ беды.push("Доска ещё загружается — повтори запрос через пару секунд."); return беды; }
  return _cmdBuildOps(рисуют, беды);
}

/* ---------- применение ----------
   ОДИН шаг истории на весь пакет (txBegin/txEnd в core.js): внутри addItem и addLink зовут
   persist десятки раз, и без транзакции Ctrl+Z пришлось бы жать по разу на команду.
   Шаг — транзакционный, со снимком ВСЕХ графов: пакет умеет класть ноды внутрь подграфов,
   а обычный снимок сериализует только активный граф. */
function cmdApply(ops){
  if(!Array.isArray(ops) || !ops.length) return null;
  const alias = {};                       // локальное имя → настоящий id
  const счёт = {создано:0, изменено:0, связей:0, развязано:0, полей:0, завершено:0, областей:0, удалено:0, нарисовано:0};
  const созданные = [];
  const рез = x => (x == null ? null : (alias[x] != null ? alias[x] : String(x)));
  const нода = x => cmdFindAny(рез(x));

  /* Новые ноды кладём СПРАВА ОТ ВСЕГО, что уже стоит, сеткой по пять в столбце. Иначе план от
     нейросети приземлялся бы поверх существующего дерева, и разбирать эту кашу пришлось бы
     руками. Координат в пакете нет — значит место выбирает приложение, а не случай. */
  let основаX = 0, основаY = 0;
  { let n = 0; (S.items || []).forEach(it => { if(it.x != null){ основаX = Math.max(основаX, it.x); основаY += it.y || 0; n++; } });
    основаX = n ? основаX + 240 : 0; основаY = n ? Math.round(основаY / n) - 150 : 0; }
  /* Счётчик мест — СВОЙ У КАЖДОГО ГРАФА: у подграфа своя система координат и обычно пустой
     холст, а общий счётчик уводил бы его первую ноду в десятый столбец «сетки» соседнего. */
  const счётчики = new Map();
  const место = gid => {
    const к = gid || "";
    const i = счётчики.get(к) || 0; счётчики.set(к, i + 1);
    const bx = gid ? 0 : основаX, by = gid ? 0 : основаY;
    return {x: bx + Math.floor(i / 5) * 210, y: by + (i % 5) * 150};
  };

  /* Внутрь подграфа пишем ВРЕМЕННОЙ подменой активного графа: S.items — геттер на активный
     (см. graphBind), и это единственный способ дать addItem положить ноду в соседний граф,
     не переписывая его. Возврат обязателен в finally: исключение посреди пакета иначе оставило
     бы приложение смотрящим в чужой граф. */
  /* Какие графы пакет тронул. Иерархию (recomputeHierarchy) считают ПО АКТИВНОМУ графу, поэтому
     в конце её надо пересчитать в каждом задетом: без этого ноды, созданные внутри подграфа,
     остались бы без parent — то есть дерева внутри не появилось бы вовсе. */
  const затронутые = new Set();
  const затронут = gid => { затронутые.add(gid || S.settings.graph); };
  const вГрафе = (gid, fn) => {
    if(!gid || gid === S.settings.graph) return fn();
    const прежний = S.settings.graph;
    S.settings.graph = gid;
    try { return fn(); } finally { S.settings.graph = прежний; }
  };
  const графДля = o => {
    if(!o.in) return null;
    const вл = нода(o.in);
    if(!вл || вл.kind !== "sub") return null;
    const g = subEnsure(вл);
    return g ? g.id : null;
  };

  txBegin();
  try {
    ops.forEach(o => {
      if(o.op === "node"){
        const gid = графДля(o);
        вГрафе(gid, () => {
          const данные = {kind: o.kind || "task", title: o.title || "", body: o.body || ""};
          if(o.due !== undefined) данные.due = o.due;
          if(o.status) данные.status = o.status;
          if(o.priority !== undefined) данные.priority = o.priority;
          if(o.repeat) данные.repeat = o.repeat;
          if(o.tags) данные.tags = o.tags.slice();
          if(o.color) данные.color = o.color;
          // область внутри подграфа не живёт (см. SUB_PREFIX в core.js) — там её просто нет
          данные.area = gid ? null : (o.area ? (alias[o.area] || o.area) : null);
          const it = addItem(данные);
          const п = (o.x != null && o.y != null) ? {x: o.x, y: o.y} : место(gid);
          it.x = п.x; it.y = п.y;
          if(o.as) alias[o.as] = it.id;
          созданные.push(it.id); счёт.создано++;
        });
        затронут(gid);
      }
      else if(o.op === "edit"){
        const it = нода(o.id); if(!it) return;
        затронут(cmdGraphOf(it.id));
        if(o.kind && o.kind !== it.kind) applyKind(it, o.kind);
        if(o.title !== undefined) it.title = o.title;
        if(o.body !== undefined) it.body = o.body;
        if(o.due !== undefined && kindIsTask(it.kind)) it.due = o.due;
        if(o.priority !== undefined && kindIsTask(it.kind)) it.priority = o.priority;
        if(o.repeat && kindIsTask(it.kind)) it.repeat = o.repeat;
        if(o.tags) it.tags = o.tags.slice();
        if(o.color) it.color = o.color;
        if(o.area){ it.area = alias[o.area] || o.area; it.areaAuto = false; }
        // статус ставим ПОСЛЕ вида: он от вида и зависит (см. статусыДляВида)
        if(o.status && статусыДляВида(it.kind).indexOf(o.status) >= 0){ it.status = o.status; if(o.status !== "done") it.done = false; }
        touch(it); счёт.изменено++;
      }
      else if(o.op === "link"){
        const a = нода(o.from), b = нода(o.to); if(!a || !b) return;
        /* СВЯЗЬ ПИШЕМ В ГРАФ САМИХ НОД. S.links — геттер на активный граф, и без подмены связь
           между нодами подграфа уезжала в links основного: она создавалась, но не рисовалась
           нигде и никого не соединяла. Разбор уже проверил, что оба конца в одном графе. */
        const gid = cmdGraphOf(a.id);
        вГрафе(gid, () => {
          if(addLink(a.id, b.id)) счёт.связей++;
          if(o.len){ const l = (S.links || []).find(x => (x[0] === a.id && x[1] === b.id) || (x[0] === b.id && x[1] === a.id)); if(l) l[2] = o.len; }
        });
        затронут(gid);
      }
      else if(o.op === "unlink"){
        const a = нода(o.from), b = нода(o.to); if(!a || !b) return;
        const gid = cmdGraphOf(a.id);
        вГрафе(gid, () => removeLink(a.id, b.id));
        затронут(gid); счёт.развязано++;
      }
      else if(o.op === "field"){
        const it = нода(o.node); if(!it) return;
        const f = fieldMake(o.type, o.name);
        if(o.type === "text") f.value = o.value || "";
        else if(o.data) f.media = fieldMediaPut(o.data);
        if(!Array.isArray(it.fields)) it.fields = [];
        it.fields.push(f); touch(it); счёт.полей++;
        затронут(cmdGraphOf(it.id));
      }
      else if(o.op === "done"){
        const it = нода(o.node); if(!it || !kindIsTask(it.kind)) return;
        // toggleDone умеет породить следующий повтор — а addItem кладёт его в АКТИВНЫЙ граф
        const gid = cmdGraphOf(it.id);
        if(!!it.done !== !!o.value){ вГрафе(gid, () => toggleDone(it)); счёт.завершено++; }
        затронут(gid);
      }
      else if(o.op === "area"){
        const a = {id: "a_" + uid(), name: o.name, icon: o.icon || "ti-folder", color: o.color || null};
        S.areas.push(a); if(o.as) alias[o.as] = a.id; счёт.областей++;
        затронут(null);
      }
      else if(o.op === "delete"){
        const it = нода(o.node); if(!it) return;
        // deletePack ходит по S.items/S.links — то есть по активному графу; нода может быть в другом
        const gid = cmdGraphOf(it.id);
        вГрафе(gid, () => deletePack([it.id]));
        затронут(gid); счёт.удалено++;
      }
      else if(o.op === "draw"){
        const it = нода(o.node); if(!it || it.kind !== "flow") return;
        /* Подмена активного графа доске НЕ нужна: доски общие для всех графов и адресуются по
           id ноды (см. инвариант про S.boards). Полотно внутри подграфа пишется тем же ходом. */
        if(drawApplyBoard(it, o) != null) счёт.нарисовано++;
        затронут(cmdGraphOf(it.id));
      }
    });
    /* ВЕРХ КУСТА ВНУТРИ ПОДГРАФА ВЕШАЕМ НА КОРЕНЬ. Дерево там считается от корня подграфа
       (recomputeHierarchy, метка R), а корня агент не знает: в снимке его нет, id ему не выдают.
       Без связи с ним ветка, созданная пакетом внутри подграфа, оставалась плоской — parent у
       всех null, и проверка «иерархия внутри подграфа» не проходила с первого дня. Верх куста —
       созданная нода, которая в пакете ни разу не стоит в «to»: направление link в пакете и
       есть «родитель → ребёнок» (см. правила в cmdPrompt). Делается ВНУТРИ транзакции: откат
       пакета обязан унести и эти связи. */
    {
      const цели = new Set();
      ops.forEach(o => { if(o.op === "link"){ const b = нода(o.to); if(b) цели.add(b.id); } });
      затронутые.forEach(gid => вГрафе(gid, () => {
        const кор = subRootCur(); if(!кор) return;            // не подграф — корня нет
        созданные.forEach(id => {
          if(цели.has(id) || cmdGraphOf(id) !== gid) return;
          if(addLink(кор, id)) счёт.связей++;
        });
      }));
    }
  } finally { txEnd(); }

  // иерархию считаем В КАЖДОМ задетом графе: иначе дерево появится только в активном
  затронутые.forEach(gid => вГрафе(gid, () => recomputeHierarchy()));
  persist(); render();
  /* Выделяем созданное: пакет мог насыпать десяток нод, и без подсветки искать их пришлось бы
     глазами. Камеру не двигаем — решать, лететь туда или нет, человеку. */
  if(созданные.length && typeof graph !== "undefined" && graph){
    graph.selNodes = new Set(созданные.filter(id => graph.byId[id]));
    graph._paintSel();
  }
  /* `alias` отдаём наружу (имя из пакета → настоящий id): агент называет ноды сам («root», «e1»),
     а в ответ получал безымянный массив id в порядке создания и сопоставлял их на глаз. */
  return {счёт, созданные, alias};
}

/* ---------- снимок для нейросети ----------
   Без него модель умеет только создавать с нуля: дописать существующее она не может, потому что
   не знает id. Тело нод и содержимое полей НЕ отдаём — это и лишний объём, и лишняя приватность;
   для «что здесь есть» хватает названия, вида, статуса и связей.

   СНИМОК ЦЕЛИКОМ — РЕДКОСТЬ, А НЕ НОРМА. Замер 07.09.2026 (docs/ПЛАН-MCP.md): 424 ноды это
   74 КБ и 4 590 строк, такой ответ хост агенту уже не показывает, а сбрасывает в файл на диск —
   и пять ходов уходит на то, чтобы разобрать выгрузку обратно. Поэтому у снимка есть фильтры:
   ветка (`root`), область (`area`), соседний граф (`graph`), потолок (`limit`) и компактный
   формат. Нужна одна ветка — приезжает одна ветка, а не весь граф. */

/* Какой граф снимаем: по id, по имени или активный. Подграф тоже доступен — у него id вида
   gs_<id ноды-владельца>, и на снимок он ничем не отличается от обычного графа. */
function cmdGraphPick(x){
  if(!x) return graphCurrent();
  const s = String(x).trim().toLowerCase();
  return (S.graphs || []).find(g => g.id === x) ||
         (S.graphs || []).find(g => (g.name || "").trim().toLowerCase() === s) || null;
}
/* Набор полей ноды. `null` — отдаём всё (так зовут промпт и окно приложения), список — только
   перечисленное. `id` в наборе всегда: без него снимок бесполезен, ссылаться будет не на что. */
function cmdSnapFields(x){
  if(!x) return null;
  const s = new Set((Array.isArray(x) ? x : String(x).split(/[,\s]+/)).map(k => String(k).trim()).filter(Boolean));
  s.add("id");
  return s;
}
/* Дети ВНУТРИ выборки: родитель, оставшийся снаружи, делает ноду корнем — по этому же признаку
   считаются и глубина, и порядок веток, поэтому карта одна на оба места. Корни лежат под "". */
function cmdSnapKids(список){
  const свои = new Set(список.map(it => it.id)), дети = new Map();
  список.forEach(it => { const к = (it.parent && свои.has(it.parent)) ? it.parent : "";
                         if(!дети.has(к)) дети.set(к, []); дети.get(к).push(it); });
  return дети;
}
/* Обход в ширину от заданных корней с потолком по уровню (1 — только сами корни). */
function cmdSnapDepth(список, корни, предел){
  const дети = cmdSnapKids(список), собрано = [], видели = new Set();
  const очередь = (корни || []).filter(Boolean).map(it => [it, 1]);
  очередь.forEach(п => видели.add(п[0].id));
  while(очередь.length){
    const п = очередь.shift(), it = п[0], ур = п[1];
    собрано.push(it);
    if(ур >= предел) continue;
    (дети.get(it.id) || []).forEach(ch => { if(видели.has(ch.id)) return; видели.add(ch.id); очередь.push([ch, ур + 1]); });
  }
  return собрано;
}
function cmdSnapNode(it, поля){
  const надо = k => !поля || поля.has(k);
  const n = {id: it.id};
  if(надо("kind")) n.kind = it.kind;
  if(надо("title")) n.title = (it.title || "").slice(0, 200);
  if(надо("status") && it.status && it.status !== нейтральныйСтатус(it.kind)) n.status = it.status;
  if(надо("done") && it.done) n.done = true;
  if(надо("due") && it.due) n.due = it.due;
  if(надо("priority") && it.priority) n.priority = it.priority;
  if(надо("tags") && (it.tags || []).length) n.tags = it.tags.slice(0, 10);
  /* ОБЛАСТЬ ОТДАЁМ ТОЛЬКО СВОЮ (areaAuto!==true). Унаследованная стоит почти на каждой ноде
     ветки — её проставляет recomputeHierarchy, — и в снимке она выглядела бы так же, как
     заданная руками. Модель повторяла бы её у КАЖДОЙ созданной ноды, а это ребро к хабу
     области: дерево схлопнулось бы в один уровень, и вместо веток получился бы веер лучей
     из центра (тот же разбор — у addEdge в recomputeHierarchy). */
  if(надо("area") && it.area && it.areaAuto !== true) n.area = it.area;
  if(надо("parent") && it.parent) n.parent = it.parent;
  if(надо("tray") && it.x == null) n.tray = true;           // лежит в лотке, на холст ещё не вынесена
  /* ЕСТЬ ЛИ ТЕЛО — ДА, САМО ТЕЛО — НЕТ. `edit body` затирает текст ЦЕЛИКОМ, и не зная, пусто
     там или нет, дописывать в существующую ноду опасно вслепую: агент обходил `body` стороной
     и складывал пояснения в отдельные поля. Наружу уезжает один факт наличия, не текст. */
  if(надо("has_body") && (it.body || "").trim()) n.has_body = true;
  if(надо("inside") && it.kind === "sub"){ const g = subGraphOf(it.id); n.inside = g ? (g.items || []).length : 0; }
  return n;
}
/* КОМПАКТНЫЙ ВИД — строка на ноду, разделитель табуляция. Дерево читается глазами и не требует
   парсера, а отступы JSON на четырёхстах нодах весят больше самих данных. */
function cmdSnapCompact(s){
  const стр = ["graph: " + s.graph + " (" + s.graph_id + ")"];
  if((s.areas || []).length) стр.push("areas: " + s.areas.map(a => a.id + "=" + a.name).join(", "));
  стр.push("nodes: " + s.returned + " из " + s.graph_nodes + (s.total !== s.graph_nodes ? " (под фильтр подошло " + s.total + ")" : ""));
  if(s.truncated) стр.push("truncated: true, next_cursor: " + s.next_cursor);
  стр.push("cols: id, kind, status, parent, title, ещё — через табуляцию");
  (s.nodes || []).forEach(n => {
    const ещё = [];
    if(n.done) ещё.push("done");
    if(n.due) ещё.push("due=" + n.due);
    if(n.priority) ещё.push("!" + n.priority);
    if(n.area) ещё.push("area=" + n.area);
    if((n.tags || []).length) ещё.push(n.tags.map(x => "#" + x).join(" "));
    if(n.has_body) ещё.push("body");
    if(n.inside != null) ещё.push("inside=" + n.inside);
    if(n.tray) ещё.push("tray");
    // название чистим от переводов строк и табуляций: одна нода обязана остаться одной строкой
    const имя = (n.title || "").replace(/\s+/g, " ").trim();
    стр.push([n.id, n.kind || "", n.status || "-", n.parent || "-", имя, ещё.join(" ")].join("\t").replace(/\t+$/, ""));
  });
  if((s.links || []).length) стр.push("links: " + s.links.map(l => l[0] + ">" + l[1]).join(", "));
  return стр.join("\n");
}
function cmdSnapshot(opts){
  const o = opts || {};
  const гр = cmdGraphPick(o.graph);
  if(!гр) throw new Error("нет такого графа: " + o.graph);
  const все = (гр.items || []).filter(inWeb);
  let выбор = все;

  if(o.area){
    const ключ = String(o.area).trim().toLowerCase();
    // область принимаем и id, и именем: у агента на руках чаще имя, и лишний ход за id ни к чему
    const обл = (гр.areas || []).find(a => a.id === o.area) ||
                (гр.areas || []).find(a => (a.name || "").trim().toLowerCase() === ключ);
    if(!обл) throw new Error("нет такой области: " + o.area);
    выбор = выбор.filter(it => it.area === обл.id);
  }
  /* ВЕТКА — ЭТО ПОДДЕРЕВО ПО `parent`, а не обход связей в обе стороны. `parent` считает
     recomputeHierarchy, и ровно это дерево человек видит в приложении; обход по связям ушёл бы
     наверх, к родителю и его соседям, то есть отдал бы не ветку, а окрестность. */
  const предел = (o.depth == null || o.depth === "") ? Infinity : Math.max(1, parseInt(o.depth, 10) || 1);
  if(o.root){
    if(!выбор.some(it => it.id === o.root)) throw new Error("нет такой ноды в выборке: " + o.root);
    выбор = cmdSnapDepth(выбор, [выбор.find(it => it.id === o.root)], предел);
  }
  /* ГЛУБИНА РАБОТАЕТ И БЕЗ `root` — от корней выборки. Иначе `{area, depth:2}` молча отдавал всю
     область целиком (проверка КРОЛИКА 07.09.2026): параметр принимался и не делал ничего. */
  else if(предел !== Infinity){
    выбор = cmdSnapDepth(выбор, cmdSnapKids(выбор).get("") || [], предел);
  }

  /* ПОРЯДОК — ПО ВЕТКАМ, а не по хранению, и срез обрывается на ГРАНИЦЕ ветки. Раньше резалось
     `.slice(0,400)` по порядку `S.items`: срез приходился на середину дерева, и в снимок
     попадали ноды без своих корней. */
  const детиВ = cmdSnapKids(выбор);
  const порядок = [], границы = [], пройдено = new Set();
  // `пройдено` — не перестраховка: битый parent из чужих данных может замкнуться в кольцо
  const обход = it => { if(пройдено.has(it.id)) return; пройдено.add(it.id); порядок.push(it);
                        (детиВ.get(it.id) || []).forEach(обход); };
  (детиВ.get("") || []).forEach(r => { границы.push(порядок.length); обход(r); });
  выбор.forEach(it => { if(!пройдено.has(it.id)){ границы.push(порядок.length); обход(it); } });

  const лимит = Math.max(1, parseInt(o.limit, 10) || CMD_SNAP_NODES);
  const старт = Math.max(0, parseInt(o.cursor, 10) || 0);
  let конец = Math.max(0, Math.min(порядок.length - старт, лимит));
  if(старт + конец < порядок.length){
    const б = границы.filter(i => i > старт && i - старт <= конец);
    /* Обрыв на границе ветки — чтобы не рвать дерево посередине. НО не любой ценой: у КРОЛИКА
       `limit:100` отдавал 56 нод, потому что следующая ветка в 74 ноды целиком не влезала, и
       четверть порции уходила в пустоту. Если так теряется больше четверти запрошенного, режем
       ровно по лимиту: висячих ссылок это не создаёт (связи фильтруются по отданным нодам),
       а порция получается плотной, и остаток дочитывается курсором. */
    if(б.length && б[б.length - 1] - старт >= конец * 0.75) конец = б[б.length - 1] - старт;
  }
  const узлы = порядок.slice(старт, старт + конец);
  const отдано = new Set(узлы.map(it => it.id));
  const поля = cmdSnapFields(o.fields);
  const снимок = {
    graph: гр.name || "",
    graph_id: гр.id,
    graph_nodes: все.length,          // сколько всего в графе — считается ТАК ЖЕ, как в ping
    total: порядок.length,            // сколько подошло под фильтры
    returned: узлы.length,
    areas: (гр.areas || []).map(a => ({id: a.id, name: a.name})),
    nodes: узлы.map(it => cmdSnapNode(it, поля)),
    /* СВЯЗИ — ТОЛЬКО МЕЖДУ ОТДАННЫМИ НОДАМИ. Раньше `links` уезжали целиком, включая рёбра на
       срезанные ноды: снимок обещал ноды, которых в нём нет, и модель ссылалась на id, которого
       не видела. */
    links: (гр.links || []).filter(l => отдано.has(l[0]) && отдано.has(l[1])).map(l => [l[0], l[1]])
  };
  if(старт + узлы.length < порядок.length){
    /* МАШИННЫЕ ПОЛЯ, А НЕ ТОЛЬКО СТРОКА. `note` лежала рядом с `nodes` и терялась при разборе —
       агент прочитал 400 нод и решил, что в графе их 400 (было 424). Прозу оставили человеку,
       машине отвечают `truncated`/`total`/`returned`/`next_cursor`. */
    снимок.truncated = true;
    снимок.next_cursor = старт + узлы.length;
    снимок.note = "показаны ноды " + (старт + 1) + "–" + (старт + узлы.length) + " из " + порядок.length +
                  "; дальше — cursor:" + снимок.next_cursor;
  }
  return (String(o.format || "").toLowerCase() === "compact") ? cmdSnapCompact(снимок) : снимок;
}

/* ---------- чтение доски ----------
   Тот же принцип, что у снимка графа: отдаём то, по чему можно работать, и НЕ отдаём объём.
   Картинки не выходят наружу вовсе (см. drawSpecFromScene), а число блоков режется потолком —
   доска на две сотни фигур в ответ агента всё равно не влезет. */
const CMD_BOARD_BLOCKS = 200;
function cmdBoard(it, opts){
  const o = opts || {};
  const д = (S.boards || {})[it.id] || null;
  const сцена = (typeof drawSpecFromScene === "function")
    ? drawSpecFromScene(д && д.elements) : {blocks:[], edges:[], skipped:{}};
  const предел = Math.max(1, Math.min(1000, Math.round(+o.limit || CMD_BOARD_BLOCKS)));
  const блоки = сцена.blocks.slice(0, предел);
  const взяты = new Set(блоки.map(b => b.id));
  // стрелка попадает в ответ, только если ОБА её конца отданы: иначе ребро ведёт в никуда
  const рёбра = сцена.edges.filter(e => (!e.from || взяты.has(e.from)) && (!e.to || взяты.has(e.to)));
  const рез = {node:it.id, title:it.title || "", blocks:блоки, edges:рёбра,
               total:сцена.blocks.length, returned:блоки.length};
  if(сцена.blocks.length > блоки.length) рез.truncated = true;
  if(Object.keys(сцена.skipped || {}).length) рез.skipped = сцена.skipped;
  return (String(o.format || "") === "compact") ? cmdBoardCompact(рез) : рез;
}
function cmdBoardCompact(b){
  const стр = ["board: " + b.title + " (" + b.node + ")",
               "blocks: " + b.returned + " из " + b.total + (b.truncated ? " (срезано)" : "")];
  if(b.skipped) стр.push("skipped: " + Object.keys(b.skipped).map(k => k + "=" + b.skipped[k]).join(", "));
  стр.push("cols: id, type, col, row, w, h, text — через табуляцию");
  (b.blocks || []).forEach(x => {
    // текст чистим от переводов строк: один блок обязан остаться одной строкой
    const т = String(x.text || "").replace(/\s+/g, " ").trim();
    стр.push([x.id, x.type, x.col, x.row, x.w, x.h, т].join("\t").replace(/\t+$/, ""));
  });
  if((b.edges || []).length)
    стр.push("edges: " + b.edges.map(e => (e.from || "?") + ">" + (e.to || "?") + (e.label ? "(" + e.label + ")" : "")).join(", "));
  return стр.join("\n");
}

/* ---------- промпт ----------
   Это ДАННЫЕ, а не код: текст уезжает в чужую нейросеть целиком. Держим его коротким и
   конкретным — длинные объяснения модели читают хуже, чем примеры.

   `opts.snapshot === false` — ПРАВИЛА БЕЗ СНИМКА. Правила весят около 8 КБ и меняются раз в
   полгода, снимок целого графа — под 70 КБ и меняется каждую минуту; склеенные в один ответ,
   они заставляли агента тянуть весь граф первым же ходом. Человеку в буфер по-прежнему уезжает
   всё вместе: он несёт текст в чужой чат, где второго вызова взять неоткуда. */
function cmdPrompt(opts){
  const o = opts || {};
  const виды = Object.keys(KINDS).map(k => k + " — " + kindRu(k)).join(", ");
  const статусы = Object.keys(СТАТУСЫ).map(k => k + " (" + СТАТУСЫ[k].имя.toLowerCase() + ")").join(", ");
  // виды блоков доски — из ТОГО ЖЕ реестра, что рисует сцену (draw.js), второго списка тут быть не должно
  const видыБлоков = (typeof DRAW_BLOCK_TYPES !== "undefined") ? DRAW_BLOCK_TYPES.join(", ") : "proc, terminal, decision, comment, frame, text";
  const текст = [
"Ты помогаешь работать с «Мысликом» — личным планером, где мысли живут графом: ноды и связи между ними.",
"Отвечай ПАКЕТОМ КОМАНД в JSON. Ничего, кроме пакета, писать не надо — приложение выполнит его как есть.",
"",
"Формат: {\"v\":1,\"ops\":[ …операции… ]}",
"",
"Операции:",
'  {"op":"node","as":"a","kind":"task","title":"…","body":"…","due":"ГГГГ-ММ-ДД","status":"…","priority":0-3,"repeat":"none|daily|weekly|monthly","tags":["…"],"in":"b"}',
'  {"op":"edit","id":"<id ноды>","title":"…"}            — менять можно те же поля',
'  {"op":"link","from":"a","to":"b"}                      — связать',
'  {"op":"unlink","from":"a","to":"b"}                    — развязать',
'  {"op":"field","node":"a","type":"text","name":"…","value":"…"}   — поле внутри ноды',
'  {"op":"done","node":"a","value":true}                  — завершить или вернуть в работу',
'  {"op":"area","as":"z","name":"…"}                      — создать область',
'  {"op":"delete","node":"a"}                             — удалить (спросят отдельно)',
'  {"op":"draw","node":"a","blocks":[…],"edges":[…]}      — нарисовать схему на полотне',
"",
"Правила:",
/* «из снимка» — БЕЗ «ниже»: правила уезжают и отдельно от снимка (myslik_rules), и там никакого
   «ниже» нет — агент шёл искать несуществующий кусок текста (КРОЛИК, проверка 07.09.2026). */
'  • "as" даёт ноде временное имя, чтобы сослаться на неё в этом же пакете. Ссылаться можно и на настоящий id ноды из снимка графа.',
'  • Виды нод: ' + виды + ".",
'  • Подграф (sub) — нода, внутри которой ОТДЕЛЬНЫЙ граф. "in" кладёт ноду внутрь него и работает ТОЛЬКО с подграфом: на задачу или заметку так сослаться нельзя. Верх куста, созданного внутри подграфа, приложение само свяжет с корнем подграфа — это его верхний уровень; глубже строй связями как обычно.',
'  • СВЯЗЫВАТЬ МОЖНО ТОЛЬКО НОДЫ ОДНОГО ГРАФА. Ноды из разных подграфов (и нода снаружи с нодой внутри) не связываются никак — для одного графа второй просто не существует. Нужна связь между этапами — держи их в одном месте, а подграфы заводи только там, где содержимое действительно живёт отдельно.',
'  • Не увлекайся подграфами: обычная ветка из связанных нод видна целиком, а каждый подграф прячет содержимое за двойным кликом. Раздел плана — это чаще всего просто нода с детьми, а не подграф.',
'  • Статусы: ' + статусы + '. Заметке и полотну «done» не ставится, у них своего завершения нет.',
"  • Даты только в виде ГГГГ-ММ-ДД. Сегодня " + ymd(today()) + ".",
"  • Координаты не указывай — приложение разложит само.",
'  • "area" указывай ТОЛЬКО у корня ветки. Остальные ноды получат область от него сами по связям; проставишь её каждой — дерево схлопнется в один уровень.',
"  • Строй ветку связями: корень → узлы второго уровня → их подзадачи. Родителя отдельным полем не задают, его выводят из связей.",
"",
"  ПОРЯДОК ШАГОВ ВЫРАЖАЕТСЯ ФОРМОЙ ВЕТКИ — это важно, здесь чаще всего ошибаются:",
'  • ПОСЛЕДОВАТЕЛЬНЫЕ шаги (один нельзя начать, пока не сделан предыдущий) — ЦЕПОЧКОЙ, каждый следующий цепляется к предыдущему, а не к общему родителю:',
'      {"op":"link","from":"этап","to":"блокинг"},{"op":"link","from":"блокинг","to":"сплайн"},{"op":"link","from":"сплайн","to":"полиш"}',
'  • ПАРАЛЛЕЛЬНЫЕ и независимые (свет, звук, справочная заметка — их можно делать в любом порядке) — веером от общего родителя:',
'      {"op":"link","from":"этап","to":"свет"},{"op":"link","from":"этап","to":"звук"}',
"  • Повесить последовательные шаги веером — значит соврать про порядок: по такой ветке не видно, что за чем идёт.",
'  • НЕ НУМЕРУЙ названия («01 — Блокинг», «Этап 2»). Порядок уже выражен связями, а номер в заголовке дублирует его и врёт, как только шаги переставят.',
"",
"  ЧТО ЗАДАЧА, А ЧТО ЗАМЕТКА — по этому виду отличают, а не по важности:",
'  • task — то, что ВЫПОЛНЯЮТ и закрывают галочкой: «Сборка», «Рендер», «Смонтировать».',
'  • note — то, что ЧИТАЮТ и помнят: справка, описание, ссылка на локацию, «не забыть — …». Заметке галочки не ставят, у неё нет своего завершения.',
'  • Раздел, у которого есть дети, — тоже обычная нода, а не что-то особое.',
"",
"  Пример хорошей ветки (проект → этапы, внутри этапа последовательность и заметка сбоку):",
'    {"op":"node","as":"pr","kind":"task","title":"Ролик для МТС","tags":["проект"],"area":"<id области>"}',
'    {"op":"node","as":"sh","kind":"task","title":"SH010","tags":["шот"]}',
'    {"op":"node","as":"bl","kind":"task","title":"Блокинг"}',
'    {"op":"node","as":"sp","kind":"task","title":"Сплайн"}',
'    {"op":"node","as":"po","kind":"task","title":"Полиш"}',
'    {"op":"node","as":"rf","kind":"note","title":"Референсы движения"}',
'    {"op":"link","from":"pr","to":"sh"},{"op":"link","from":"sh","to":"bl"},',
'    {"op":"link","from":"bl","to":"sp"},{"op":"link","from":"sp","to":"po"},{"op":"link","from":"sh","to":"rf"}',
"  Здесь блокинг → сплайн → полиш идут цепочкой, потому что это порядок работ, а референсы висят",
"  на шоте отдельно: их не «выполняют», они нужны на всём протяжении."
  ];
  /* ПРАВИЛА СХЕМЫ — ОТДЕЛЬНЫМ КУСКОМ. Это треть всего текста (2,4 КБ из 7), а нужна она только
     когда рисуют. Агент читает правила в каждой сессии первым ходом; MCP отдаёт их без схемы
     (draw:false) и одной строкой говорит, где взять остальное (topic:"draw"). Промпт для
     нейросети через буфер (метод prompt) по-прежнему уносит всё целиком. */
  const схема = [
'  СХЕМА НА ПОЛОТНЕ (op "draw") — для роадмапа, плана этапов, блок-схемы. Ветка графа отвечает на',
"  вопрос «что за чем», схема — на вопрос «как это устроено»; не дублируй одно другим.",
'  • Рисуют ТОЛЬКО на полотне — ноде вида "flow". Нет подходящей — создай её этим же пакетом и сошлись по "as".',
'  • Блок: {"id":"b1","type":"proc","text":"…","col":0,"row":0,"w":1,"h":1}. "id" — имя внутри ЭТОЙ операции, по нему цепляются стрелки.',
"  • Подпись блока — КОРОТКАЯ, три-шесть слов. Рисуется она крупно; длинную приложение уменьшит на ступень кегля, совсем длинную — растянет блок, но схема из абзацев всё равно не читается. Подробности держи в ноде, а не в блоке.",
"  • Виды блоков: " + видыБлоков + ". proc — обычный, terminal — начало и конец, decision — развилка, comment — сноска, frame — рамка вокруг группы, text — подпись без рамки.",
'  • Координаты — В КЛЕТКАХ, а не в пикселях: "col" — столбец, "row" — ряд, "w"/"h" — сколько клеток занимает блок. Целые от нуля.',
"",
"  РАСКЛАДКА — ТВОЯ РАБОТА, и это главное в схеме. Ставь col/row ВСЕМ блокам сразу (половине укажешь — остальные лягут друг на друга):",
"  • Основной ход — ОДНИМ столбцом сверху вниз, ряд за рядом. Схема читается сверху вниз, а не вширь.",
'  • Развилка: обе ветки в СЛЕДУЮЩЕМ ряду по разные стороны от неё — «да» левее, «нет» правее. Сам ромб оставь между ними.',
"  • Ветки, которые сходятся обратно в один блок, сведи в ряд НИЖЕ самой длинной из них.",
"  • СТРЕЛКИ НЕ ДОЛЖНЫ ПЕРЕСЕКАТЬСЯ И НЕ ДОЛЖНЫ ИДТИ СКВОЗЬ БЛОКИ. Это не пожелание: пересёкшиеся стрелки делают схему нечитаемой, а ради них лучше переставить блоки.",
"  • Возврат назад («нет — вернуться к шагу выше») веди по краю: держи крайний столбец слева от схемы пустым, тогда возврату есть где пройти.",
"  • Держись в пределах трёх-четырёх столбцов. Широкая плоская схема хуже длинной узкой.",
"  • ПЕРЕД ОТВЕТОМ ПРОВЕРЬ СЕБЯ: пройди по своим стрелкам и посмотри, какие пересекаются или задевают чужой блок. Нашёл — переставь блоки и проверь заново.",
"  • Координат не дал вовсе — приложение разложит само деревом, но без понимания смысла: где ветвление, а где продолжение, оно не знает.",
'  • Стрелка: {"from":"b1","to":"b2","label":"да"}. Концы — только id блоков этой же операции.',
'  • "mode":"append" (по умолчанию) дорисовывает ПОД тем, что на доске уже есть. "mode":"replace" стирает доску целиком — это удаление, его спросят отдельно; на чужой рисунок его не бери.',
'    {"op":"node","as":"map","kind":"flow","title":"Роадмап"},',
'    {"op":"draw","node":"map","blocks":[',
'      {"id":"a","type":"terminal","text":"Идея","col":1,"row":0},',
'      {"id":"b","type":"proc","text":"Прототип","col":1,"row":1},',
'      {"id":"c","type":"decision","text":"Годится?","col":1,"row":2},',
'      {"id":"d","type":"proc","text":"Выпустить","col":0,"row":3},',
'      {"id":"e","type":"proc","text":"Доработать","col":2,"row":3}],',
'     "edges":[{"from":"a","to":"b"},{"from":"b","to":"c"},',
'      {"from":"c","to":"d","label":"да"},{"from":"c","to":"e","label":"нет"}]}',
"  Здесь ход идёт столбцом 1 сверху вниз, а на развилке ветки расходятся в столбцы 0 и 2 —",
"  ни одна стрелка ничего не пересекает. Так и раскладывай."
  ];
  const хвост = [
"",
"  • Не выдумывай id: бери их из снимка. Нет подходящей ноды — создай новую.",
"  • Удаления добавляй, только если о них попросили прямо."
  ];
  if(o.topic === "draw")
    return схема.concat(["", "  • Что уже нарисовано, показывает myslik_board — спроси ПЕРЕД тем, как дорисовывать."]).join("\n");
  if(o.draw === false)
    текст.push("", '  • СХЕМА НА ПОЛОТНЕ (op "draw") описана отдельно — myslik_rules {topic:"draw"}. Собрался рисовать — сперва прочти.');
  else
    текст.push("", ...схема);
  текст.push(...хвост);
  if(o.snapshot === false){
    текст.push("",
      "Настоящие id спрашивай снимком — myslik_snapshot с `root` (одна ветка), `area` или `limit`.",
      "Весь граф целиком не тяни: он может весить десятки килобайт, и ответ уедет в файл вместо ответа.",
      "Что уже нарисовано на полотне, показывает myslik_board — спрашивай его ПЕРЕД тем, как дорисовывать.");
  } else {
    текст.push("", "Текущее состояние графа (id нод — настоящие, ими и ссылайся):", JSON.stringify(cmdSnapshot()));
  }
  return текст.join("\n");
}

/* ============================================================================
   ВХОД ДЛЯ ИИ-АГЕНТА. Тот же пакет команд, только принесённый программно: локальный HTTP в
   app.py зовёт эту функцию через evaluate_js и получает СТРОКУ с JSON-ответом.

   ВСЁ ЗДЕСЬ СИНХРОННО, И ЭТО НЕ СТИЛЬ, А ОГРАНИЧЕНИЕ: evaluate_js возвращает значение выражения,
   промис он не ждёт. Поэтому картинки с диска читает САМ Python и подставляет готовый data-URL
   ещё до вызова — файловая система остаётся на его стороне, где ей и место.

   Ответ всегда {ok:…}: агент не человек, ему нужен разбираемый результат, а не тост. Отказ —
   это тоже ответ, поэтому исключения ловим и возвращаем текстом, а не роняем мост. */

/* ТОКЕН ПРЕДПРОСМОТРА. Один и тот же пакет уезжал по мосту ДВАЖДЫ — сперва в `preview`, потом
   тем же текстом в `apply`; на пакете в 10 КБ это 10 лишних килобайт за правку. Теперь `preview`
   оставляет разобранный пакет у себя и возвращает короткий токен, а `apply` принимает его вместо
   `ops`. Токен ОДНОРАЗОВЫЙ: повтор `apply` иначе создал бы второй такой же куст.
   Подпись состояния проверяем при погашении — за минуту между вызовами человек мог сам что-то
   поменять, а предпросмотр обещал результат для ПРЕЖНЕГО графа. */
const CMD_TOKEN_TTL = 180000;                  // 3 минуты: столько живёт разобранный пакет
const CMD_PREVIEW_LINES = 20;                  // строк списка в ответе preview агенту (см. ниже)
const _cmdTokens = new Map();                  // токен → {ops, at, sig}
function cmdStateSig(){
  let нод = 0, связей = 0, правка = 0;
  (S.graphs || []).forEach(g => {
    нод += (g.items || []).length; связей += (g.links || []).length;
    (g.items || []).forEach(it => { if(it.updated > правка) правка = it.updated; });
  });
  return (S.settings.graph || "") + ":" + нод + ":" + связей + ":" + правка;
}
function cmdTokenMake(ops){
  const т = "pv_" + uid();
  const сейчас = Date.now();
  // протухшие подметаем здесь же: таймеру взяться неоткуда, а Map иначе растёт до перезапуска
  _cmdTokens.forEach((v, k) => { if(сейчас - v.at > CMD_TOKEN_TTL) _cmdTokens.delete(k); });
  _cmdTokens.set(т, {ops, at: сейчас, sig: cmdStateSig()});
  return т;
}
function cmdTokenTake(т){
  const з = _cmdTokens.get(т);
  if(!з) return {ok: false, error: "токен не найден — он одноразовый и живёт минуты; повтори preview"};
  _cmdTokens.delete(т);
  if(Date.now() - з.at > CMD_TOKEN_TTL) return {ok: false, error: "токен устарел; повтори preview"};
  if(з.sig !== cmdStateSig()) return {ok: false, error: "граф изменился после предпросмотра; повтори preview"};
  return {ok: true, ops: з.ops};
}
/* Считаем нод ОДИНАКОВО везде — в ping, в снимке и в ответе undo. Раньше ping брал
   `S.items.length`, а снимок фильтровал через `inWeb`, и числа расходились сами по себе:
   агент видел 409 против 383 и искал гонку там, где её не было. */
function cmdCounts(){
  const все = (S.items || []).length, вСети = (S.items || []).filter(inWeb).length;
  return {nodes: вСети, nodes_total: все, nodes_in_web: вСети};
}
function cmdAgent(method, paramsJson){
  const ответ = o => JSON.stringify(o);
  let p = {};
  try { p = paramsJson ? JSON.parse(paramsJson) : {}; }
  catch(e){ return ответ({ok:false, error:"параметры не разобрались: " + e.message}); }
  try {
    if(method === "ping")
      return ответ(Object.assign({ok:true, app:"Мыслик", version:"",   /* подставляет app.py: _agent_call */
                    graph:(graphCurrent() || {}).name || "", graph_id:(graphCurrent() || {}).id || ""}, cmdCounts()));
    if(method === "snapshot") return ответ({ok:true, snapshot:cmdSnapshot(p)});
    if(method === "prompt")   return ответ({ok:true, prompt:cmdPrompt(p)});
    // rules — без снимка и без правил схемы (их спрашивают topic:"draw"), см. cmdPrompt
    if(method === "rules")    return ответ({ok:true, rules:cmdPrompt({snapshot:false, draw:false, topic:p.topic})});
    if(method === "graphs")
      return ответ({ok:true, graphs:graphsTop().map(g => ({id:g.id, name:g.name,
        nodes:(g.items || []).length, active:g.id === S.settings.graph}))});
    /* ОТВЕЧАЕМ ЧИСЛАМИ ПОСЛЕ ОТКАТА, а не голым {ok:true}. `undoStep` синхронный, состояние к
       этой строке уже приведено — значит и счёт честный, и следующий вызов ping не нужен вовсе
       (агент звал его следом и видел расхождение, принимая за гонку разницу счётов). */
    if(method === "undo"){
      const ок = undoStep() === true;
      return ответ(Object.assign({ok:ок, graph:(graphCurrent() || {}).name || ""}, cmdCounts()));
    }
    /* ГОТОВА ЛИ ДОСКА. Вендор весит мегабайты и тянется лениво, при первом открытии полотна;
       без него схему не собрать. Метод отвечает синхронно и попутно запускает загрузку —
       ждать и опрашивать будет Python (_agent_prepare), где ожиданию и место. */
    if(method === "drawlib")
      return ответ(Object.assign({ok:true}, (typeof drawLibState === "function") ? drawLibState() : {lib:false, fonts:false}));
    if(method === "board"){
      const it = cmdFindAny(String(p.node || p.id || ""));
      if(!it) return ответ({ok:false, error:"ноды с таким id нет"});
      if(it.kind !== "flow") return ответ({ok:false, error:"доска есть только у полотна (kind \"flow\")"});
      return ответ({ok:true, board:cmdBoard(it, p)});
    }

    if(method === "preview" || method === "apply"){
      let ops = null, warns = [];
      if(method === "apply" && p.token && p.ops == null){
        const т = cmdTokenTake(String(p.token));
        if(!т.ok) return ответ({ok:false, error:т.error});
        ops = т.ops;                       // пакет уже разобран предпросмотром — второй раз не гоняем
      } else {
        /* Пакет принимаем и объектом, и строкой: агент может отдать разобранный JSON, а может —
           текст, который сам получил от модели. cmdParse умеет и то, и другое. */
        const текст = (typeof p.ops === "string") ? p.ops
                    : JSON.stringify(Array.isArray(p.ops) ? {v:CMD_V, ops:p.ops} : p);
        const р = cmdParse(текст);
        if(р.errors.length) return ответ({ok:false, errors:р.errors, warns:р.warns});
        ops = р.ops; warns = р.warns;
        // схемы полотна собираем ЗДЕСЬ, до применения: см. cmdBuildBoardsSync
        const беды = cmdBuildBoardsSync(ops);
        if(беды.length) return ответ({ok:false, errors:беды, warns:warns});
      }
      if(method === "preview"){
        /* СПИСОК РЕЖЕМ. Он пересказывает агенту его же пакет, и на сорока операциях это
           килобайты ответа впустую: что нужно агенту — числа в `will` и ошибки разбора.
           Первые строки оставляем как проверку, что id разрешились в те ноды (названия там
           настоящие). Опасные строки (удаления) не режутся никогда. */
        const всё = cmdPreview(ops);
        const превью = всё.slice(0, CMD_PREVIEW_LINES).map(s => (s.danger ? "! " : "") + s.t);
        const хвостОпасные = всё.slice(CMD_PREVIEW_LINES).filter(s => s.danger);
        хвостОпасные.forEach(s => превью.push("! " + s.t));
        const скрыто = всё.length - CMD_PREVIEW_LINES - хвостОпасные.length;
        if(скрыто > 0) превью.push("… и ещё " + скрыто + " операций (числа — в will)");
        /* СКОЛЬКО ЧЕГО ПОЯВИТСЯ — числом, а не только строками списка: расхождение с задуманным
           («ждал 41 ноду, в пакете 39») видно ДО применения, без пересчёта строк глазами. */
        const будет = {nodes:0, links:0, fields:0, edits:0, areas:0, unlinks:0, dones:0, deletes:0, draws:0};
        const поле = {node:"nodes", link:"links", field:"fields", edit:"edits", area:"areas",
                      unlink:"unlinks", done:"dones", delete:"deletes", draw:"draws"};
        ops.forEach(o => { const k = поле[o.op]; if(k) будет[k]++; });
        return ответ({ok:true, ops:ops.length, will:будет, preview:превью, warns,
                      deletes:cmdHasDelete(ops), token:cmdTokenMake(ops)});
      }
      /* УДАЛЕНИЯ ЧЕРЕЗ АГЕНТА ТРЕБУЮТ ЯВНОГО СОГЛАСИЯ В САМОМ ЗАПРОСЕ. В окне это спрашивают у
         человека, а тут спросить некого: корзины нет, и снесённое чужой командой не вернуть
         ничем, кроме отката. Флаг обязан прийти отдельным полем — «случайно» его не поставишь.
         Токен от этого не освобождает: согласие на удаление даётся в том же запросе, что и оно. */
      if(cmdHasDelete(ops) && p.allowDelete !== true)
        return ответ({ok:false, errors:['В пакете есть удаления (снос ноды либо замена непустой доски). Повтори запрос с allowDelete:true, если это осознанно.']});
      const итог = cmdApply(ops);
      const c = итог ? итог.счёт : {};
      /* Человек обязан УВИДЕТЬ, что в его планер что-то написали снаружи, и иметь возможность
         это снять одним нажатием — тем же тостом, что и при ручном применении. */
      toast("ИИ-агент · " + (Object.keys(c).filter(k => c[k]).map(k => k + ": " + c[k]).join(", ") || "без изменений"),
        {icon:"ti-robot", label:"Вернуть", onAction:() => { undoStep(); toast("Пакет агента отменён", {icon:"ti-arrow-back-up"}); }});
      /* СОЗДАННОЕ ОТДАЁМ ИМЕНАМИ ИЗ ПАКЕТА: {"root":"mtq6…","e1":"mtq6…"}. Массив id в порядке
         создания заставлял угадывать, какое `as` какому id досталось, — а следующий пакет
         ссылается именно на них. Ноды без `as` идут под своим id. */
      const создано = {};
      if(итог){
        const поId = {};
        Object.keys(итог.alias || {}).forEach(имя => { поId[итог.alias[имя]] = имя; });
        (итог.созданные || []).forEach(id => { создано[поId[id] || id] = id; });
        Object.keys(итог.alias || {}).forEach(имя => { if(!(имя in создано)) создано[имя] = итог.alias[имя]; });
      }
      return ответ({ok:true, applied:ops.length, result:c, created:создано});
    }
    return ответ({ok:false, error:"неизвестный метод: " + method});
  } catch(e){ return ответ({ok:false, error:String((e && e.message) || e)}); }
}

/* ПРОМПТ «ПОДКЛЮЧИ МЕНЯ». Человек не должен собирать конфиг MCP руками, знать, где лежит его
   установка, и разбираться, чем stdio отличается от http. Он жмёт одну кнопку, отдаёт текст
   агенту — и тот настраивает себя сам. Пути и ключ подставляет приложение: только оно и знает,
   куда себя положили (Мыслик портативный). */
function cmdAgentSetupPrompt(st){
  const блок = JSON.stringify({myslik: {command: st.command, args: st.args}}, null, 2)
    .replace(/^\{\n|\n\}$/g, "").replace(/^ {2}/gm, "");
  return [
"Подключи к себе MCP-сервер «Мыслик» — это мой личный планер, он уже запущен на этом компьютере.",
"",
"1. Добавь в мой конфиг MCP (файл .mcp.json в корне проекта либо настройки Claude Code; тот же",
"   блок подходит для claude_desktop_config.json и других MCP-клиентов) такой сервер:",
"",
блок,
"",
"2. Перезапусти подключение MCP и проверь связь инструментом myslik_ping.",
"",
"3. Дальше работай так: myslik_rules — формат пакета команд и правила, снимка там нет намеренно.",
"   Настоящие id бери myslik_snapshot и НЕ весь граф: root — одна ветка, area — одна область,",
"   limit — потолок, format:\"compact\" — короткий вид. Правки собирай пакетом, прогоняй через",
"   myslik_preview и применяй myslik_apply с токеном из предпросмотра — пакет не придётся слать",
"   дважды. Удаления делай только если я попросил прямо. Правила схем на полотне — отдельно,",
"   myslik_rules {topic:\"draw\"}: читай их перед тем, как рисовать.",
"",
"Если myslik_ping отвечает, что приложение не найдено, — скажи мне: значит, я забыл включить",
"«Доступ для ИИ-агента» в настройках Мыслика или закрыл само приложение.",
"",
"Сервер живёт внутри самого приложения, ставить ничего не нужно: ни Python, ни пакетов."
  ].join("\n");
}

/* ---------- буфер обмена ----------
   clipboard API в WebView2 бывает недоступен (нет разрешения, нет фокуса), поэтому запасной
   путь через скрытое поле обязателен: иначе кнопка «Скопировать» молча ничего не делает. */
async function cmdCopy(text){
  try { if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; } }
  catch(e){}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta); ta.select();
    const ок = document.execCommand("copy");
    ta.remove(); return ок;
  } catch(e){ return false; }
}

/* ---------- окно ---------- */
/* МИНИАТЮРА БУДУЩЕЙ СХЕМЫ. Числа в строке предпросмотра не отвечают на вопрос, ради которого
   предпросмотр и делают: схему видно только схемой. Снимок светлый в обеих темах — по той же
   причине, что и во врезке поля: тёмную доску Excalidraw делает фильтром поверх холста,
   а в SVG фильтра нет (см. fieldBoardPreview). */
function cmdDrawThumbs(out, строки){
  const места = out.querySelectorAll("[data-draw]");
  if(!места.length) return;
  const рисуют = [].map.call(места, м => ({м, o: строки[+м.dataset.draw] && строки[+м.dataset.draw].draw})).filter(x => x.o);
  if(!рисуют.length) return;
  cmdBuildBoards(рисуют.map(x => x.o)).then(беды => {
    рисуют.forEach(({м, o}) => {
      if(!м.isConnected) return;
      if(беды.length || !o._els || !window.ExcalidrawLib || !ExcalidrawLib.exportToSvg){
        м.innerHTML = `<div class="cmd-draw-none">${esc(беды[0] || "Схему показать не удалось")}</div>`;
        return;
      }
      ExcalidrawLib.exportToSvg({elements: o._els, files: {}, exportPadding: 8,
                                 appState: {exportBackground: false}})
        .then(svg => {
          if(!м.isConnected) return;
          svg.setAttribute("width", "100%"); svg.removeAttribute("height"); svg.style.display = "block";
          м.innerHTML = ""; м.appendChild(svg);
        }, () => {});
    });
  });
}

function openCmdRunner(){
  const m = el("div", "modal cmd-win");
  m.innerHTML = `
    <h3><i class="ti ti-sparkles"></i>ИИ и планер</h3>
    ${/* ДВА РАЗДЕЛА В ОДНОМ ОКНЕ (КРОЛИК, 07.09.2026): пакет от нейросети через буфер обмена и
         подключение агента по MCP. Это две дороги для ОДНОГО И ТОГО ЖЕ формата команд, и разводить
         их по разным местам интерфейса — значит делать вид, что это разные вещи. Агент вторым:
         его настраивают один раз, а пакеты вставляют постоянно. */""}
    <div class="cmd-hint">Скопируй промпт, отдай его любой нейросети вместе со своей просьбой,
      а её ответ вставь сюда. Приложение покажет, что именно будет сделано, — и сделает это только по кнопке.</div>
    <div class="cmd-bar">
      <button class="btn" id="cmd-copy"><i class="ti ti-clipboard-text"></i>Скопировать промпт</button>
      <button class="btn ghost" id="cmd-copy-snap"><i class="ti ti-topology-star-3"></i>Только снимок графа</button>
      <span class="cmd-size" id="cmd-size"></span>
    </div>
    <textarea class="cmd-in" id="cmd-in" spellcheck="false" placeholder='Вставь сюда ответ нейросети — {"v":1,"ops":[…]}'></textarea>
    <div class="cmd-out" id="cmd-out"></div>
    <div class="cmd-sec2"><i class="ti ti-robot"></i>ИИ-агент — управление планером снаружи</div>
    <div class="cmd-hint">Claude Code и другие агенты смогут читать граф и создавать ноды сами — через локальный порт, только на этом компьютере и только с ключом. Ставить ничего не нужно: сервер живёт внутри приложения.</div>
    <div class="cmd-bar">
      <span class="set-val" id="ag-status">…</span>
      <button class="btn ghost" id="ag-token"><i class="ti ti-refresh"></i>Новый ключ</button>
      <button class="btn" id="ag-toggle"><i class="ti ti-plug"></i>Включить</button>
      <button class="btn primary" id="ag-prompt" style="display:none"><i class="ti ti-robot"></i>Промпт для Claude</button>
    </div>
    <div class="modal-foot">
      <button class="btn ghost" id="cmd-cancel">Закрыть</button>
      <button class="btn primary" id="cmd-run" disabled><i class="ti ti-player-play"></i>Выполнить</button>
    </div>`;
  const ov = overlay(m);
  let разбор = {ops: [], errors: [], warns: []};

  const снимок = cmdSnapshot();
  $("#cmd-size", m).textContent = "в снимке нод: " + снимок.nodes.length + (снимок.note ? " (срезано)" : "");

  const покрасить = () => {
    const out = $("#cmd-out", m), кн = $("#cmd-run", m);
    const {ops, errors, warns} = разбор;
    if(!ops.length && !errors.length && !warns.length){ out.innerHTML = ""; кн.disabled = true; return; }
    const строки = cmdPreview(ops);
    const форма = cmdShape(ops);
    out.innerHTML =
      (errors.length ? `<div class="cmd-sec bad"><i class="ti ti-alert-triangle"></i>Ошибки — пакет не выполнится</div>` +
        errors.map(e => `<div class="cmd-row bad">${esc(e)}</div>`).join("") : "") +
      (warns.length ? warns.map(w => `<div class="cmd-row warn"><i class="ti ti-info-circle"></i>${esc(w)}</div>`).join("") : "") +
      /* Форма — ПЕРЕД списком операций: по ней видно то, чего в списке не разглядеть — где
         ветка идёт цепочкой, а где висит веером на одном родителе. */
      (форма.length ? `<div class="cmd-sec"><i class="ti ti-binary-tree"></i>Что получится</div>` +
        форма.map(s => `<div class="cmd-row cmd-tree" style="--d:${s.d}"><i class="ti ${s.i}"></i>${esc(s.t)}` +
          `<em>${esc(s.k)}${s.сколько ? " · ветвей: " + s.сколько : ""}</em></div>`).join("") : "") +
      (строки.length ? `<div class="cmd-sec"><i class="ti ti-list-check"></i>Будет сделано · ${строки.length}</div>` +
        /* У строки про полотно — место под миниатюру: «блоков 8, стрелок 7» не отвечает на
           главный вопрос «что получится», а схему видно только схемой. Рисуется отложенно:
           вендор доски грузится лениво, а покрасить() синхронна. */
        строки.map((s, i) => `<div class="cmd-row${s.danger ? " bad" : ""}"><i class="ti ${s.i}"></i>${esc(s.t)}</div>` +
          (s.draw ? `<div class="cmd-draw" data-draw="${i}"></div>` : "")).join("") : "");
    cmdDrawThumbs(out, строки);
    кн.disabled = !!errors.length || !ops.length;
    кн.innerHTML = `<i class="ti ti-player-play"></i>Выполнить${ops.length ? " · " + ops.length : ""}`;
    кн.classList.toggle("danger-txt", cmdHasDelete(ops));
  };

  let таймер = null;
  $("#cmd-in", m).addEventListener("input", () => {
    clearTimeout(таймер);
    таймер = setTimeout(() => { разбор = cmdParse($("#cmd-in", m).value); покрасить(); }, 250);
  });

  $("#cmd-copy", m).onclick = async () => {
    const ок = await cmdCopy(cmdPrompt());
    toast(ок ? "Промпт и снимок графа скопированы" : "Не удалось скопировать", {icon: ок ? "ti-clipboard-check" : "ti-alert-triangle"});
  };
  $("#cmd-copy-snap", m).onclick = async () => {
    const ок = await cmdCopy(JSON.stringify(cmdSnapshot(), null, 1));
    toast(ок ? "Снимок графа скопирован" : "Не удалось скопировать", {icon: ок ? "ti-clipboard-check" : "ti-alert-triangle"});
  };
  $("#cmd-cancel", m).onclick = () => ov.remove();

  /* Блок агента. Переключатель, ключ и одна кнопка — конфиг MCP человек не собирает руками:
     путь к своей установке знает только само приложение, оно портативное. */
  {
    const стат = $("#ag-status", m), кноп = $("#ag-toggle", m), промпт = $("#ag-prompt", m);
    let сост = null;
    const покрасить = () => {
      if(!сост){ стат.textContent = "доступно только в приложении"; кноп.disabled = true; $("#ag-token", m).disabled = true; промпт.style.display = "none"; return; }
      стат.textContent = сост.enabled ? ("включён · 127.0.0.1:" + сост.port) : (сост.configured ? "выключен · ключ создан" : "выключен");
      кноп.innerHTML = `<i class="ti ti-${сост.enabled ? "plug-off" : "plug"}"></i>` + (сост.enabled ? "Выключить" : "Включить");
      промпт.style.display = сост.enabled ? "" : "none";
    };
    const обновить = async () => {
      if(!HasPy() || !window.pywebview.api.agent_status){ сост = null; покрасить(); return; }
      try { сост = await window.pywebview.api.agent_status(); } catch(e){ сост = null; }
      покрасить();
    };
    обновить();
    кноп.onclick = async () => {
      if(!сост) return;
      кноп.disabled = true;
      try { await window.pywebview.api.agent_enable(!сост.enabled); } catch(e){}
      кноп.disabled = false; await обновить();
      toast(сост && сост.enabled ? "Агент подключён" : "Доступ для агента выключен", {icon: "ti-robot"});
    };
    $("#ag-token", m).onclick = async () => {
      if(!сост) return;
      const да = await uiConfirm("Прежний ключ перестанет работать — агенту придётся отдать новый конфиг.",
        {title: "Сменить ключ?", okLabel: "Сменить"});
      if(!да) return;
      try { await window.pywebview.api.agent_reset_token(); } catch(e){}
      await обновить(); toast("Ключ обновлён", {icon: "ti-key"});
    };
    промпт.onclick = async () => {
      if(!сост) return;
      const ок = await cmdCopy(cmdAgentSetupPrompt(сост));
      toast(ок ? "Промпт скопирован — вставь его Claude Code" : "Не удалось скопировать",
        {icon: ок ? "ti-clipboard-check" : "ti-alert-triangle"});
    };
  }

  $("#cmd-run", m).onclick = async () => {
    const кн = $("#cmd-run", m);
    if(кн.disabled) return;
    /* УДАЛЕНИЯ СПРАШИВАЕМ ОТДЕЛЬНО. Всё остальное вернёт Ctrl+Z, а снесённая нода уходит
       насовсем — корзины в приложении нет, и «ИИ так сказал» тут не оправдание. */
    const сносим = разбор.ops.filter(o => o.op === "delete");
    // замена непустой доски стирает рисунок так же насовсем, как снос ноды — спрашиваем вместе
    const стираем = разбор.ops.filter(o => o.op === "draw" && o.wipes > 0);
    if(сносим.length || стираем.length){
      const что = [сносим.length ? "удалит нод: " + сносим.length : "",
                   стираем.length ? "заменит досок: " + стираем.length + " (сотрётся элементов: " +
                     стираем.reduce((s, o) => s + o.wipes, 0) + ")" : ""].filter(Boolean).join(", ");
      const да = await uiConfirm("Пакет " + что + ". Вернуть можно будет только откатом (Ctrl+Z).",
        {danger: true, title: "В пакете есть удаления", okLabel: "Всё равно выполнить"});
      if(!да) return;
    }
    кн.disabled = true; кн.innerHTML = `<i class="ti ti-loader"></i>Выполняю…`;
    // всё, что умеет не получиться, — ДО применения: чтение картинок с диска и сборка схем
    const беды = (await cmdLoadImages(разбор.ops)).concat(await cmdBuildBoards(разбор.ops));
    if(беды.length){ разбор.errors = беды; покрасить(); return; }
    const итог = cmdApply(разбор.ops);
    ov.remove();
    const c = итог ? итог.счёт : {};
    const части = [c.создано ? "создано: " + c.создано : "", c.изменено ? "изменено: " + c.изменено : "",
                   c.связей ? "связей: " + c.связей : "", c.полей ? "полей: " + c.полей : "",
                   c.завершено ? "завершено: " + c.завершено : "", c.областей ? "областей: " + c.областей : "",
                   c.нарисовано ? "схем: " + c.нарисовано : "",
                   c.удалено ? "удалено: " + c.удалено : ""].filter(Boolean);
    /* «Вернуть» рядом с тостом — не роскошь: пакет мог наделать десяток дел, и искать Ctrl+Z
       после чужого решения человек не обязан. Откат транзакционный, вернёт всё разом. */
    toast("Выполнено · " + (части.join(", ") || "ничего не изменилось"),
      {icon: "ti-code", label: "Вернуть", onAction: () => { undoStep(); toast("Пакет отменён", {icon: "ti-arrow-back-up"}); }});
  };

  setTimeout(() => { const i = $("#cmd-in", m); if(i) i.focus(); }, 30);
  return ov;
}
