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

   ЧТО ПАКЕТ НЕ ДЕЛАЕТ. Не трогает настройки, не переключает графы, не лезет в доски полотна
   (вендорский формат Excalidraw модель собирает плохо) и не удаляет ничего без отдельного
   подтверждения человеком. ============================================================= */

const CMD_V = 1;
const CMD_MAX_OPS = 300;          // потолок на пакет: защита от «модель выдала простыню», не от человека
const CMD_SNAP_NODES = 400;       // сколько нод влезает в снимок для нейросети, дальше срезаем
/* БЕЛЫЙ СПИСОК КОМАНД. Всё, чего здесь нет, отвергается на разборе с внятной ошибкой — пакет не
   может сделать ничего, что не перечислено. Сама обработка живёт одним проходом в cmdApply,
   чтобы порядок операций и общие локальные имена были видны в одном месте. */
const CMD_HANDLERS = {node:1, edit:1, link:1, unlink:1, field:1, done:1, area:1, delete:1};

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

    if(!плохо) ops.push(o);
  });

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
    return {i: "ti-question-mark", t: o.op};
  });
}
const cmdHasDelete = ops => (ops || []).some(o => o.op === "delete");

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

/* ---------- применение ----------
   ОДИН шаг истории на весь пакет (txBegin/txEnd в core.js): внутри addItem и addLink зовут
   persist десятки раз, и без транзакции Ctrl+Z пришлось бы жать по разу на команду.
   Шаг — транзакционный, со снимком ВСЕХ графов: пакет умеет класть ноды внутрь подграфов,
   а обычный снимок сериализует только активный граф. */
function cmdApply(ops){
  if(!Array.isArray(ops) || !ops.length) return null;
  const alias = {};                       // локальное имя → настоящий id
  const счёт = {создано:0, изменено:0, связей:0, развязано:0, полей:0, завершено:0, областей:0, удалено:0};
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
    });
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
  return {счёт, созданные};
}

/* ---------- снимок для нейросети ----------
   Без него модель умеет только создавать с нуля: дописать существующее она не может, потому что
   не знает id. Тело нод и содержимое полей НЕ отдаём — это и лишний объём, и лишняя приватность;
   для «что здесь есть» хватает названия, вида, статуса и связей. */
function cmdSnapshot(){
  const гр = graphCurrent();
  const узлы = (S.items || []).filter(inWeb).slice(0, CMD_SNAP_NODES);
  const срезано = Math.max(0, (S.items || []).filter(inWeb).length - узлы.length);
  const снимок = {
    graph: гр ? гр.name : "",
    areas: (S.areas || []).map(a => ({id: a.id, name: a.name})),
    nodes: узлы.map(it => {
      const n = {id: it.id, kind: it.kind, title: (it.title || "").slice(0, 200)};
      if(it.status && it.status !== нейтральныйСтатус(it.kind)) n.status = it.status;
      if(it.done) n.done = true;
      if(it.due) n.due = it.due;
      if(it.priority) n.priority = it.priority;
      if((it.tags || []).length) n.tags = it.tags.slice(0, 10);
      /* ОБЛАСТЬ ОТДАЁМ ТОЛЬКО СВОЮ (areaAuto!==true). Унаследованная стоит почти на каждой ноде
         ветки — её проставляет recomputeHierarchy, — и в снимке она выглядела бы так же, как
         заданная руками. Модель повторяла бы её у КАЖДОЙ созданной ноды, а это ребро к хабу
         области: дерево схлопнулось бы в один уровень, и вместо веток получился бы веер лучей
         из центра (тот же разбор — у addEdge в recomputeHierarchy). */
      if(it.area && it.areaAuto !== true) n.area = it.area;
      if(it.parent) n.parent = it.parent;
      if(it.x == null) n.tray = true;                       // лежит в лотке, на холст ещё не вынесена
      if(it.kind === "sub"){ const g = subGraphOf(it.id); n.inside = g ? (g.items || []).length : 0; }
      return n;
    }),
    links: (S.links || []).filter(l => !isHubId(l[0]) && !isHubId(l[1])).map(l => [l[0], l[1]])
  };
  if(срезано) снимок.note = "показаны первые " + узлы.length + " нод из " + (узлы.length + срезано);
  return снимок;
}

/* ---------- промпт ----------
   Это ДАННЫЕ, а не код: текст уезжает в чужую нейросеть целиком. Держим его коротким и
   конкретным — длинные объяснения модели читают хуже, чем примеры. */
function cmdPrompt(){
  const виды = Object.keys(KINDS).map(k => k + " — " + kindRu(k)).join(", ");
  const статусы = Object.keys(СТАТУСЫ).map(k => k + " (" + СТАТУСЫ[k].имя.toLowerCase() + ")").join(", ");
  return [
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
"",
"Правила:",
'  • "as" даёт ноде временное имя, чтобы сослаться на неё в этом же пакете. Ссылаться можно и на настоящий id из снимка ниже.',
'  • Виды нод: ' + виды + ".",
'  • Подграф (sub) — нода, внутри которой ОТДЕЛЬНЫЙ граф. "in" кладёт ноду внутрь него и работает ТОЛЬКО с подграфом: на задачу или заметку так сослаться нельзя.',
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
"  • Не выдумывай id: бери их из снимка. Нет подходящей ноды — создай новую.",
"  • Удаления добавляй, только если о них попросили прямо.",
"",
"Текущее состояние графа (id нод — настоящие, ими и ссылайся):",
JSON.stringify(cmdSnapshot())
  ].join("\n");
}

/* ============================================================================
   ВХОД ДЛЯ ИИ-АГЕНТА. Тот же пакет команд, только принесённый программно: локальный HTTP в
   app.py зовёт эту функцию через evaluate_js и получает СТРОКУ с JSON-ответом.

   ВСЁ ЗДЕСЬ СИНХРОННО, И ЭТО НЕ СТИЛЬ, А ОГРАНИЧЕНИЕ: evaluate_js возвращает значение выражения,
   промис он не ждёт. Поэтому картинки с диска читает САМ Python и подставляет готовый data-URL
   ещё до вызова — файловая система остаётся на его стороне, где ей и место.

   Ответ всегда {ok:…}: агент не человек, ему нужен разбираемый результат, а не тост. Отказ —
   это тоже ответ, поэтому исключения ловим и возвращаем текстом, а не роняем мост. */
function cmdAgent(method, paramsJson){
  const ответ = o => JSON.stringify(o);
  let p = {};
  try { p = paramsJson ? JSON.parse(paramsJson) : {}; }
  catch(e){ return ответ({ok:false, error:"параметры не разобрались: " + e.message}); }
  try {
    if(method === "ping")
      return ответ({ok:true, app:"Мыслик", version:(typeof APP_VER !== "undefined" ? APP_VER : ""),
                    graph:(graphCurrent() || {}).name || "", nodes:(S.items || []).length});
    if(method === "snapshot") return ответ({ok:true, snapshot:cmdSnapshot()});
    if(method === "prompt")   return ответ({ok:true, prompt:cmdPrompt()});
    if(method === "graphs")
      return ответ({ok:true, graphs:graphsTop().map(g => ({id:g.id, name:g.name,
        nodes:(g.items || []).length, active:g.id === S.settings.graph}))});
    if(method === "undo")     return ответ({ok:undoStep() === true});

    if(method === "preview" || method === "apply"){
      /* Пакет принимаем и объектом, и строкой: агент может отдать разобранный JSON, а может —
         текст, который сам получил от модели. cmdParse умеет и то, и другое. */
      const текст = (typeof p.ops === "string") ? p.ops
                  : JSON.stringify(Array.isArray(p.ops) ? {v:CMD_V, ops:p.ops} : p);
      const р = cmdParse(текст);
      if(р.errors.length) return ответ({ok:false, errors:р.errors, warns:р.warns});
      const превью = cmdPreview(р.ops).map(s => (s.danger ? "! " : "") + s.t);
      if(method === "preview")
        return ответ({ok:true, ops:р.ops.length, preview:превью, warns:р.warns, deletes:cmdHasDelete(р.ops)});
      /* УДАЛЕНИЯ ЧЕРЕЗ АГЕНТА ТРЕБУЮТ ЯВНОГО СОГЛАСИЯ В САМОМ ЗАПРОСЕ. В окне это спрашивают у
         человека, а тут спросить некого: корзины нет, и снесённое чужой командой не вернуть
         ничем, кроме отката. Флаг обязан прийти отдельным полем — «случайно» его не поставишь. */
      if(cmdHasDelete(р.ops) && p.allowDelete !== true)
        return ответ({ok:false, errors:['В пакете есть удаления. Повтори запрос с allowDelete:true, если это осознанно.']});
      const итог = cmdApply(р.ops);
      const c = итог ? итог.счёт : {};
      /* Человек обязан УВИДЕТЬ, что в его планер что-то написали снаружи, и иметь возможность
         это снять одним нажатием — тем же тостом, что и при ручном применении. */
      toast("ИИ-агент · " + (Object.keys(c).filter(k => c[k]).map(k => k + ": " + c[k]).join(", ") || "без изменений"),
        {icon:"ti-robot", label:"Вернуть", onAction:() => { undoStep(); toast("Пакет агента отменён", {icon:"ti-arrow-back-up"}); }});
      return ответ({ok:true, applied:р.ops.length, result:c, created:итог ? итог.созданные : []});
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
"1. Добавь в мой конфиг MCP (файл .mcp.json в корне проекта либо настройки Claude Code) такой сервер:",
"",
блок,
"",
"2. Перезапусти подключение MCP и проверь связь инструментом myslik_ping.",
"",
"3. Дальше работай так: ПЕРВЫМ делом зови myslik_format — он вернёт формат пакета команд и снимок",
"   моего графа с настоящими id. Правки собирай пакетом и прогоняй через myslik_preview, прежде",
"   чем применять myslik_apply. Удаления делай только если я попросил прямо.",
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
function openCmdRunner(){
  const m = el("div", "modal cmd-win");
  m.innerHTML = `
    <h3><i class="ti ti-code"></i>Общение с нейросетью</h3>
    <div class="cmd-hint">Скопируй промпт, отдай его любой нейросети вместе со своей просьбой,
      а её ответ вставь сюда. Приложение покажет, что именно будет сделано, — и сделает это только по кнопке.</div>
    <div class="cmd-bar">
      <button class="btn" id="cmd-copy"><i class="ti ti-clipboard-text"></i>Скопировать промпт</button>
      <button class="btn ghost" id="cmd-copy-snap"><i class="ti ti-topology-star-3"></i>Только снимок графа</button>
      <span class="cmd-size" id="cmd-size"></span>
    </div>
    <textarea class="cmd-in" id="cmd-in" spellcheck="false" placeholder='Вставь сюда ответ нейросети — {"v":1,"ops":[…]}'></textarea>
    <div class="cmd-out" id="cmd-out"></div>
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
    out.innerHTML =
      (errors.length ? `<div class="cmd-sec bad"><i class="ti ti-alert-triangle"></i>Ошибки — пакет не выполнится</div>` +
        errors.map(e => `<div class="cmd-row bad">${esc(e)}</div>`).join("") : "") +
      (warns.length ? warns.map(w => `<div class="cmd-row warn"><i class="ti ti-info-circle"></i>${esc(w)}</div>`).join("") : "") +
      (строки.length ? `<div class="cmd-sec"><i class="ti ti-list-check"></i>Будет сделано · ${строки.length}</div>` +
        строки.map(s => `<div class="cmd-row${s.danger ? " bad" : ""}"><i class="ti ${s.i}"></i>${esc(s.t)}</div>`).join("") : "");
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

  $("#cmd-run", m).onclick = async () => {
    const кн = $("#cmd-run", m);
    if(кн.disabled) return;
    /* УДАЛЕНИЯ СПРАШИВАЕМ ОТДЕЛЬНО. Всё остальное вернёт Ctrl+Z, а снесённая нода уходит
       насовсем — корзины в приложении нет, и «ИИ так сказал» тут не оправдание. */
    const сносим = разбор.ops.filter(o => o.op === "delete");
    if(сносим.length){
      const да = await uiConfirm("Пакет удалит нод: " + сносим.length + ". Вернуть можно будет только откатом (Ctrl+Z).",
        {danger: true, title: "В пакете есть удаления", okLabel: "Всё равно выполнить"});
      if(!да) return;
    }
    кн.disabled = true; кн.innerHTML = `<i class="ti ti-loader"></i>Выполняю…`;
    const беды = await cmdLoadImages(разбор.ops);
    if(беды.length){ разбор.errors = беды; покрасить(); return; }
    const итог = cmdApply(разбор.ops);
    ov.remove();
    const c = итог ? итог.счёт : {};
    const части = [c.создано ? "создано: " + c.создано : "", c.изменено ? "изменено: " + c.изменено : "",
                   c.связей ? "связей: " + c.связей : "", c.полей ? "полей: " + c.полей : "",
                   c.завершено ? "завершено: " + c.завершено : "", c.областей ? "областей: " + c.областей : "",
                   c.удалено ? "удалено: " + c.удалено : ""].filter(Boolean);
    /* «Вернуть» рядом с тостом — не роскошь: пакет мог наделать десяток дел, и искать Ctrl+Z
       после чужого решения человек не обязан. Откат транзакционный, вернёт всё разом. */
    toast("Выполнено · " + (части.join(", ") || "ничего не изменилось"),
      {icon: "ti-code", label: "Вернуть", onAction: () => { undoStep(); toast("Пакет отменён", {icon: "ti-arrow-back-up"}); }});
  };

  setTimeout(() => { const i = $("#cmd-in", m); if(i) i.focus(); }, 30);
  return ov;
}
