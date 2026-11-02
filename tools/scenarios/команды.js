// ЯЗЫК КОМАНД (ui/js/cmd.js): пакет операций от сторонней нейросети.
// Проверяем ровно то, на чём стоит безопасность: разбор не пускает мусор, ошибка отменяет ВЕСЬ
// пакет, а применённое возвращается одним откатом. Половина применённого пакета хуже, чем ни
// одного, — поэтому больше всего проверок именно на отказ.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const ошибки = [];
const прежний = console.error;
console.error = (...a) => { ошибки.push(a.join(" ")); прежний(...a); };

view = "notes"; render(); await ж(140);
const былоНод = S.items.length;

// ---------- разбор ----------
{
  const п = cmdParse('```json\n{"v":1,"ops":[{"op":"node","kind":"task","title":"Из блока кода"}]}\n```');
  t.push({имя:"JSON достаётся из ```-блока и болтовни вокруг", ок: п.errors.length === 0 && п.ops.length === 1,
          факт: п.errors.join(" | ")});
}
{
  const п = cmdParse('[{"op":"node","title":"Голым массивом"}]');
  t.push({имя:"голый массив операций тоже принимается", ок: п.errors.length === 0 && п.ops.length === 1, факт: п.errors.join(" | ")});
}
{
  const п = cmdParse("совсем не json");
  t.push({имя:"текст без JSON даёт внятную ошибку, а не падение", ок: п.errors.length === 1 && !п.ops.length, факт: п.errors[0] || ""});
}
{
  const п = cmdParse('{"ops":[{"op":"drop_database"}]}');
  t.push({имя:"команда не из белого списка отвергается", ок: п.errors.length === 1 && !п.ops.length, факт: п.errors[0] || ""});
}
{
  const п = cmdParse('{"ops":[{"op":"node","title":"а","due":"31.12.2026"}]}');
  t.push({имя:"дата не того формата — ошибка", ок: п.errors.length === 1, факт: п.errors[0] || ""});
}
{
  const п = cmdParse('{"ops":[{"op":"node","kind":"note","title":"а","status":"done"}]}');
  t.push({имя:"статус, которого у вида нет, отвергается", ок: п.errors.length === 1, факт: п.errors[0] || ""});
}
{
  const п = cmdParse('{"ops":[{"op":"link","from":"нет-такой","to":"и-такой"}]}');
  t.push({имя:"ссылка на несуществующую ноду отвергается", ок: п.errors.length >= 1 && !п.ops.length, факт: п.errors[0] || ""});
}
{
  // ссылаться на созданное ЭТИМ ЖЕ пакетом можно, но только на объявленное ВЫШЕ
  const хорошо = cmdParse('{"ops":[{"op":"node","as":"a","title":"раз"},{"op":"node","as":"b","title":"два"},{"op":"link","from":"a","to":"b"}]}');
  const плохо  = cmdParse('{"ops":[{"op":"link","from":"a","to":"b"},{"op":"node","as":"a","title":"раз"}]}');
  t.push({имя:"локальные имена (as) связывают созданное в пакете", ок: хорошо.errors.length === 0 && хорошо.ops.length === 3,
          факт: хорошо.errors.join(" | ")});
  t.push({имя:"ссылка на имя, объявленное НИЖЕ, отвергается", ок: плохо.errors.length >= 1, факт: плохо.errors[0] || ""});
}

/* ---------- графы и связи ----------
   Пакет от ChatGPT вскрыл это на живых данных: он нагенерил подграфов и связал ноды из разных.
   Связь живёт в links КОНКРЕТНОГО графа, поэтому такая пара — запись в никуда: раньше она молча
   уезжала в активный граф и не соединяла ничего. Теперь отвергается на разборе. */
{
  const п = cmdParse('{"ops":[{"op":"node","as":"p1","kind":"sub","title":"П1"},{"op":"node","as":"p2","kind":"sub","title":"П2"},' +
                     '{"op":"node","as":"a","title":"внутри П1","in":"p1"},{"op":"node","as":"b","title":"внутри П2","in":"p2"},' +
                     '{"op":"link","from":"a","to":"b"}]}');
  t.push({имя:"связь между нодами РАЗНЫХ подграфов отвергается", ок: п.errors.length === 1, факт: п.errors[0] || "прошла!"});
}
{
  const п = cmdParse('{"ops":[{"op":"node","as":"p","kind":"sub","title":"П"},{"op":"node","as":"x","title":"внутри","in":"p"},{"op":"link","from":"p","to":"x"}]}');
  t.push({имя:"связь снаружи с нодой ВНУТРИ подграфа тоже отвергается", ок: п.errors.length === 1, факт: п.errors[0] || "прошла!"});
}
{
  const п = cmdParse('{"ops":[{"op":"node","as":"p","kind":"sub","title":"П"},{"op":"node","as":"a","title":"раз","in":"p"},' +
                     '{"op":"node","as":"b","title":"два","in":"p"},{"op":"link","from":"a","to":"b"}]}');
  t.push({имя:"связь ВНУТРИ одного подграфа проходит", ок: п.errors.length === 0 && п.ops.length === 4, факт: п.errors.join(" | ")});
}
{
  const заметка = S.items.find(i => i.kind === "note");
  const п = cmdParse('{"ops":[{"op":"node","title":"куда-то","in":"' + (заметка ? заметка.id : "нет") + '"}]}');
  t.push({имя:'"in" на ноду, которая не подграф, отвергается', ок: п.errors.length === 1, факт: п.errors[0] || "прошла!"});
}
{
  // связи ВНУТРИ подграфа обязаны попасть в links самого подграфа, а не активного графа
  const п = cmdParse('{"ops":[{"op":"node","as":"p","kind":"sub","title":"КОМ-графтест"},' +
                     '{"op":"node","as":"a","title":"КОМ-раз","in":"p"},{"op":"node","as":"b","title":"КОМ-два","in":"p"},' +
                     '{"op":"link","from":"a","to":"b"}]}');
  const былоСвязей = S.links.length;
  cmdApply(п.ops); await ж(160);
  const прж = S.items.find(i => i.title === "КОМ-графтест");
  const вн = прж ? subGraphOf(прж.id) : null;
  // связи между нодами считаем без корневой: верх куста приложение само вешает на корень подграфа (cmdApply)
  const межНод = вн ? (вн.links || []).filter(l => !isRootId(l[0]) && !isRootId(l[1])) : [];
  t.push({имя:"связь легла в links ПОДГРАФА, а не активного графа",
          ок: !!вн && межНод.length === 1 && S.links.length === былоСвязей,
          факт: вн ? ("внутри: " + межНод.length + ", снаружи прибавилось: " + (S.links.length - былоСвязей)) : "подграфа нет"});
  { const верх = вн ? (вн.items || []).find(i => i.title === "КОМ-раз") : null;
    const кКорню = вн ? (вн.links || []).filter(l => isRootId(l[0]) || isRootId(l[1])) : [];
    t.push({имя:"верх куста привязан к корню подграфа, низ — нет",
            ок: !!верх && кКорню.length === 1 && кКорню[0].indexOf(верх.id) >= 0,
            факт: "связей с корнем: " + кКорню.length + (верх ? " · верх " + верх.id : "")}); }
  t.push({имя:"иерархия внутри подграфа пересчиталась",
          ок: !!вн && (вн.items || []).some(i => i.parent), факт: вн ? вн.items.map(i => i.title + ":" + i.parent).join(" ") : ""});
  undoStep(); await ж(160);
}

// ---------- предпросмотр ----------
{
  const п = cmdParse('{"ops":[{"op":"node","as":"a","title":"Проверка предпросмотра"},{"op":"delete","node":"' + (S.items[0] || {}).id + '"}]}');
  const стр = cmdPreview(п.ops);
  t.push({имя:"предпросмотр описывает каждую операцию", ок: стр.length === п.ops.length, факт: стр.map(s => s.t).join(" · ").slice(0, 80)});
  t.push({имя:"удаление помечено как опасное", ок: стр.some(s => s.danger) && cmdHasDelete(п.ops) === true, факт: ""});
}

// ---------- применение и откат ----------
{
  const пакет = {v:1, ops:[
    {op:"node", as:"проект", kind:"sub", title:"КОМ-проверка проект"},
    {op:"node", as:"зад", kind:"task", title:"КОМ-проверка задача", due:"2026-12-31", status:"doing", priority:2, tags:["ком"]},
    {op:"link", from:"проект", to:"зад"},
    {op:"field", node:"зад", type:"text", name:"Детали", value:"текст поля"},
    {op:"node", kind:"note", title:"КОМ-внутри подграфа", in:"проект"}
  ]};
  const п = cmdParse(JSON.stringify(пакет));
  t.push({имя:"боевой пакет разбирается без ошибок", ок: п.errors.length === 0 && п.ops.length === 5, факт: п.errors.join(" | ")});

  const итог = cmdApply(п.ops);
  await ж(160);
  const зад = S.items.find(i => i.title === "КОМ-проверка задача");
  const прж = S.items.find(i => i.title === "КОМ-проверка проект");
  t.push({имя:"ноды созданы", ок: !!зад && !!прж && итог.счёт.создано === 3, факт: "создано: " + (итог ? итог.счёт.создано : "—")});
  t.push({имя:"поля ноды применились", ок: !!зад && зад.due === "2026-12-31" && зад.status === "doing" && зад.priority === 2 && (зад.tags || []).includes("ком"),
          факт: зад ? (зад.due + " / " + зад.status + " / " + зад.priority) : ""});
  t.push({имя:"новые ноды встали НА ХОЛСТ, а не в лоток", ок: !!зад && зад.x != null && зад.y != null,
          факт: зад ? (зад.x + "," + зад.y) : ""});
  t.push({имя:"связь создана", ок: !!зад && !!прж && linkExists(прж.id, зад.id), факт: ""});
  t.push({имя:"именованное поле заведено", ок: !!зад && (зад.fields || []).some(f => f.name === "Детали" && f.value === "текст поля"), факт: ""});
  {
    const вн = прж ? subGraphOf(прж.id) : null;
    t.push({имя:'операция с "in" положила ноду ВНУТРЬ подграфа',
            ок: !!вн && (вн.items || []).some(i => i.title === "КОМ-внутри подграфа"),
            факт: вн ? (вн.items || []).length + " нод внутри" : "подграфа нет"});
  }

  // ВЕСЬ пакет — один шаг истории, включая ноду, попавшую в соседний граф
  undoStep(); await ж(180);
  t.push({имя:"Ctrl+Z снимает пакет ЦЕЛИКОМ одним шагом",
          ок: !S.items.some(i => /^КОМ-/.test(i.title || "")) && S.items.length === былоНод,
          факт: "нод: " + S.items.length + " (было " + былоНод + ")"});
  t.push({имя:"вместе с пакетом ушёл и его подграф",
          ок: !(S.graphs || []).some(g => (g.items || []).some(i => /^КОМ-/.test(i.title || ""))), факт: ""});
}

// ---------- снимок и промпт для нейросети ----------
{
  const с = cmdSnapshot();
  t.push({имя:"снимок графа собирается", ок: !!с && Array.isArray(с.nodes) && Array.isArray(с.links),
          факт: (с.nodes || []).length + " нод, " + (с.links || []).length + " связей"});
  t.push({имя:"снимок не тащит тело нод (объём и приватность)",
          ок: (с.nodes || []).every(n => n.body === undefined), факт: ""});
  /* Унаследованная область в снимке — ловушка: модель повторит её у каждой созданной ноды,
     и дерево схлопнется в веер лучей от хаба (см. cmdSnapshot). Отдаём только СВОЮ. */
  {
    const наслед = (S.items || []).filter(it => inWeb(it) && it.area && it.areaAuto === true).map(it => it.id);
    const протекло = (с.nodes || []).filter(n => наслед.includes(n.id) && n.area !== undefined).length;
    t.push({имя:"снимок отдаёт только СВОЮ область, не унаследованную",
            ок: протекло === 0, факт: "унаследованных: " + наслед.length + ", протекло: " + протекло});
  }
  const p = cmdPrompt();
  t.push({имя:"промпт содержит формат и снимок", ок: p.indexOf('"op":"node"') > 0 && p.indexOf('"nodes"') > 0,
          факт: Math.round(p.length / 1024) + " КБ"});
  const пр = cmdPrompt({snapshot: false});
  t.push({имя:"правила без снимка не тащат ни одного id ноды",
          ок: пр.indexOf('"op":"node"') > 0 && пр.indexOf('"nodes"') < 0 && пр.length < 10240,
          факт: Math.round(пр.length / 1024) + " КБ"});
}

/* ---------- снимок с фильтрами ----------
   Снимок целого графа хост агенту не показывает, а сбрасывает в файл (замер — docs/ПЛАН-MCP.md:
   424 ноды = 74 КБ). Всё, что ниже, держит обещание «приезжает ровно нужный кусок»: ветка,
   область, потолок, курсор, компактный вид — и связи, не ссылающиеся в пустоту. */
{
  const всего = (S.items || []).filter(inWeb).length;
  const корень = (S.items || []).filter(inWeb).find(it => (S.items || []).some(x => x.parent === it.id));
  if(корень){
    const в = cmdSnapshot({root: корень.id});
    const свои = new Set(в.nodes.map(n => n.id));
    t.push({имя:"снимок по root отдаёт ТОЛЬКО ветку", ок: свои.has(корень.id) && в.nodes.length >= 2 && в.nodes.length < всего,
            факт: в.nodes.length + " из " + всего});
    t.push({имя:"в ветке нет связей на ноды вне её", ок: (в.links || []).every(l => свои.has(l[0]) && свои.has(l[1])), факт: ""});
    const гл = cmdSnapshot({root: корень.id, depth: 1});
    t.push({имя:"depth:1 отдаёт один корень", ок: гл.nodes.length === 1 && гл.nodes[0].id === корень.id, факт: гл.nodes.length + " нод"});
  }
  const ср = cmdSnapshot({limit: 3});
  t.push({имя:"срез помечен МАШИННЫМИ полями, а не прозой",
          ок: ср.truncated === true && ср.total === всего && ср.returned === ср.nodes.length && typeof ср.next_cursor === "number",
          факт: "returned " + ср.returned + " из " + ср.total + ", next_cursor " + ср.next_cursor});
  {
    const свои = new Set(ср.nodes.map(n => n.id));
    t.push({имя:"в срезе НЕТ связей на срезанные ноды", ок: (ср.links || []).every(l => свои.has(l[0]) && свои.has(l[1])), факт: ""});
    const дальше = cmdSnapshot({limit: 3, cursor: ср.next_cursor});
    const повторов = дальше.nodes.filter(n => свои.has(n.id)).length;
    t.push({имя:"cursor продолжает снимок, а не повторяет его", ок: дальше.nodes.length > 0 && повторов === 0, факт: "повторов: " + повторов});
  }
  {
    const о = cmdSnapshot({limit: 5}), c = cmdSnapshot({limit: 5, format: "compact"});
    const строк = String(c).split("\n").filter(s => s.indexOf("\t") > 0);
    t.push({имя:"compact — одна строка на ноду, через табуляцию",
            ок: typeof c === "string" && строк.length === о.returned && c.indexOf("nodes: ") >= 0,
            факт: строк.length + " строк против " + о.returned + " нод"});
  }
  {
    const обл = (S.areas || [])[0];
    if(обл){
      const в = cmdSnapshot({area: обл.id});
      const ждём = (S.items || []).filter(it => inWeb(it) && it.area === обл.id).length;
      t.push({имя:"снимок по area отдаёт только её ноды", ок: в.nodes.length === ждём,
              факт: в.nodes.length + " из " + ждём + " в области «" + обл.name + "»"});
      /* depth БЕЗ root: принимался и не делал ничего — {area, depth:2} отдавал всю область
         (КРОЛИК, проверка 07.09.2026). Теперь глубина считается от корней выборки. */
      const свои = new Set(в.nodes.map(n => n.id));
      const сДетьми = в.nodes.some(n => n.parent && свои.has(n.parent));
      const гл = cmdSnapshot({area: обл.id, depth: 1});
      t.push({имя:"depth работает и без root — от корней выборки",
              ок: сДетьми ? гл.nodes.length < в.nodes.length : гл.nodes.length === в.nodes.length,
              факт: "depth:1 — " + гл.nodes.length + " нод против " + в.nodes.length + " без глубины"});
    }
  }
  {
    /* ПЛОТНОСТЬ ПОРЦИИ. Обрыв на границе ветки не должен съедать пол-лимита: limit:100 отдавал
       56 нод, потому что следующая ветка целиком не влезала. */
    const всего = (S.items || []).filter(inWeb).length;
    if(всего > 12){
      const п = cmdSnapshot({limit: 12});
      t.push({имя:"срез добирает порцию, а не рвётся на первой же ветке", ок: п.returned >= 9,
              факт: п.returned + " нод из запрошенных 12"});
    }
  }
  {
    const в = cmdSnapshot({fields: "id,title"});
    t.push({имя:"fields выбрасывает лишние поля", ок: в.nodes.every(n => n.kind === undefined && n.parent === undefined && n.id), факт: ""});
  }
  {
    // тело в снимок не уезжало и раньше; новое — что видно САМ ФАКТ его наличия
    const сТелом = (S.items || []).filter(inWeb).find(it => (it.body || "").trim());
    const в = cmdSnapshot();
    const n = сТелом ? в.nodes.find(x => x.id === сТелом.id) : null;
    t.push({имя:"has_body показывает наличие тела, но не текст",
            ок: (!сТелом || (n && n.has_body === true)) && в.nodes.every(x => x.body === undefined),
            факт: сТелом ? "нода с телом: " + (сТелом.title || "") : "нод с телом в демо нет"});
  }
}

/* ---------- мост агента: токен, created, счёт нод ----------
   Проверяем ровно то, ради чего мост правился: пакет уезжает ОДИН раз, ответ называет созданное
   именами из пакета, а число нод после отката не приходится переспрашивать. */
{
  const пакет = JSON.stringify({v:1, ops:[
    {op:"node", as:"корень", kind:"task", title:"КОМ-токен корень"},
    {op:"node", as:"лист", kind:"task", title:"КОМ-токен лист"},
    {op:"link", from:"корень", to:"лист"}]});
  const пв = JSON.parse(cmdAgent("preview", JSON.stringify({ops: пакет})));
  t.push({имя:"preview считает, сколько появится нод и связей",
          ок: пв.ok === true && !!пв.will && пв.will.nodes === 2 && пв.will.links === 1, факт: JSON.stringify(пв.will || {})});
  t.push({имя:"preview отдаёт токен", ок: typeof пв.token === "string" && пв.token.length > 3, факт: пв.token || "нет"});

  const пр = JSON.parse(cmdAgent("apply", JSON.stringify({token: пв.token})));
  await ж(180);
  const созд = S.items.find(i => i.title === "КОМ-токен корень");
  t.push({имя:"apply по токену применяет пакет без повторной пересылки",
          ок: пр.ok === true && пр.applied === 3 && !!созд, факт: JSON.stringify(пр.result || {})});
  t.push({имя:"created называет созданное именами из пакета",
          ок: !!пр.created && !Array.isArray(пр.created) && !!созд && пр.created["корень"] === созд.id,
          факт: JSON.stringify(пр.created || {})});
  const повтор = JSON.parse(cmdAgent("apply", JSON.stringify({token: пв.token})));
  t.push({имя:"токен ОДНОРАЗОВЫЙ — второй apply отвергается", ок: повтор.ok === false, факт: повтор.error || "применился дважды!"});

  const до = (S.items || []).filter(inWeb).length;
  const отк = JSON.parse(cmdAgent("undo", "{}"));
  await ж(180);
  const пинг = JSON.parse(cmdAgent("ping", "{}"));
  t.push({имя:"undo отвечает числом нод уже ПОСЛЕ отката",
          ок: отк.ok === true && отк.nodes === (S.items || []).filter(inWeb).length && отк.nodes < до,
          факт: "было " + до + ", стало " + отк.nodes});
  t.push({имя:"ping и снимок считают ноды ОДИНАКОВО",
          ок: пинг.nodes === cmdSnapshot().graph_nodes && пинг.nodes_in_web === пинг.nodes,
          факт: пинг.nodes + " у ping против " + cmdSnapshot().graph_nodes + " у снимка"});
  t.push({имя:"пакет агента снялся целиком", ок: !S.items.some(i => /^КОМ-токен/.test(i.title || "")), факт: ""});
}

/* ---------- папка из пакета: только полный путь к ПАПКЕ (аудит 2.1, П0-1) ----------
   Кнопка «открыть папку» зовёт os.startfile: путь к программе из чужого пакета был бы запуском
   по клику. Разбор такое не пускает, а предпросмотр обязан назвать папку, а не «нечего менять». */
{
  const пап = f => cmdParse(JSON.stringify({ops:[{op:"node", title:"КОМ-папка", folder:f}]}));
  const отн = пап("проекты\\SQ02");
  t.push({имя:"папка без диска и сервера отвергается", ок: отн.errors.length === 1, факт: отн.errors[0] || "пропустил"});
  const прог = пап("C:\\Users\\me\\Downloads\\setup.exe");
  t.push({имя:"путь к программе (.exe) вместо папки отвергается", ок: прог.errors.length === 1, факт: прог.errors[0] || "пропустил"});
  const ярл = пап("C:\\Users\\me\\Desktop\\почта.lnk");
  t.push({имя:"ярлык (.lnk) вместо папки отвергается", ок: ярл.errors.length === 1, факт: ярл.errors[0] || "пропустил"});
  const сеть = пап("\\\\studio-nas\\projects\\SQ02");
  t.push({имя:"сетевая папка проходит, но с предупреждением",
          ок: сеть.errors.length === 0 && сеть.warns.some(w => /сетев/.test(w)), факт: сеть.errors.concat(сеть.warns).join(" | ")});
  const диск = пап("E:\\Проекты\\SFC_2026\\02_sequences\\SQ02");
  t.push({имя:"полный путь к папке на диске проходит", ок: диск.errors.length === 0 && диск.ops[0].folder === "E:\\Проекты\\SFC_2026\\02_sequences\\SQ02",
          факт: диск.errors.join(" | ")});
  const цель = S.items.find(i => inWeb(i));
  if(цель){
    const пр = cmdParse(JSON.stringify({ops:[{op:"edit", id:цель.id, folder:"D:\\Работа\\Шоты"}]}));
    const строка = (cmdPreview(пр.ops)[0] || {}).t || "";
    t.push({имя:"предпросмотр правки называет папку целиком, а не «нечего менять»",
            ок: пр.errors.length === 0 && строка.indexOf("папка D:\\Работа\\Шоты") >= 0 && строка.indexOf("нечего менять") < 0, факт: строка});
  }
}

/* ---------- откат агента: только СВОЙ пакет (аудит 2.1, П0-2) ----------
   Прежде myslik_undo звал голый undoStep(): правка человека после пакета откатывалась агентом,
   а созданная человеком нода сносилась без allowDelete. */
{
  const пакет = н => JSON.stringify({ops: JSON.stringify({v:1, ops:[{op:"node", kind:"task", title:н}]})});
  const а1 = JSON.parse(cmdAgent("apply", пакет("КОМ-откат первый")));
  await ж(120);
  t.push({имя:"apply отдаёт метку пакета tx", ок: а1.ok === true && typeof а1.tx === "string" && а1.tx.length > 3, факт: а1.tx || "нет"});

  // правка человека поверх пакета агента — тем же путём, что окно «Выполнить» (без метки агента)
  cmdApply(cmdParse(JSON.stringify({ops:[{op:"node", kind:"task", title:"КОМ-откат человек"}]})).ops);
  await ж(120);
  const отказ = JSON.parse(cmdAgent("undo", "{}"));
  t.push({имя:"агент НЕ откатывает правку человека, сделанную после его пакета",
          ок: отказ.ok === false && S.items.some(i => i.title === "КОМ-откат человек"), факт: отказ.error || "откатил!"});
  undoStep(); await ж(120);             // человек снимает своё сам

  const а2 = JSON.parse(cmdAgent("apply", пакет("КОМ-откат второй")));
  await ж(120);
  const чужойTx = JSON.parse(cmdAgent("undo", JSON.stringify({tx: а1.tx})));
  t.push({имя:"undo с tx старого пакета отказывает, если после него был другой",
          ок: чужойTx.ok === false && S.items.some(i => i.title === "КОМ-откат второй"), факт: чужойTx.error || "откатил!"});
  const свой = JSON.parse(cmdAgent("undo", JSON.stringify({tx: а2.tx})));
  await ж(120);
  t.push({имя:"undo с tx своего последнего пакета откатывает его",
          ок: свой.ok === true && свой.undone === а2.tx && !S.items.some(i => i.title === "КОМ-откат второй"), факт: JSON.stringify(свой)});
  const первый = JSON.parse(cmdAgent("undo", "{}"));
  await ж(120);
  t.push({имя:"после этого снимается и первый пакет — он снова последний",
          ок: первый.ok === true && !S.items.some(i => /^КОМ-откат/.test(i.title || "")), факт: JSON.stringify(первый)});
}

// ---------- полотно: схема пакетом ----------
// Доска лежит ВНЕ ноды (S.boards), и в обычный снимок отката не входит — поэтому здесь больше
// всего проверок именно на откат: обещание «весь пакет отменяется одним Ctrl+Z» дано в туре.
{
  /* Форма схемы — на чистой функции, без доски и вендора. Первая версия раскладки клала детей
     развилки подряд от нулевого столбца: получалась цепочка, сбоку от которой что-то висит,
     и по схеме было не видно, где ветвление (КРОЛИК, снимок 07.09.2026). */
  {
    const бл = [{id:"r", w:1}, {id:"y", w:1}, {id:"n", w:1}];
    drawAutoGrid(бл, [{from:"r", to:"y"}, {from:"r", to:"n"}]);
    const [r, y, n] = бл;
    t.push({имя:"развилка расходится симметрично: родитель по центру между ветками",
            ок: y.row === 1 && n.row === 1 && y.col !== n.col && Math.abs((y.col + n.col) / 2 - r.col) < 0.01,
            факт: "родитель " + r.col + ", ветки " + y.col + " и " + n.col});
  }
  {
    const бл = [{id:"r", w:1}, {id:"y", w:1}, {id:"n", w:1}, {id:"m", w:1}];
    drawAutoGrid(бл, [{from:"r", to:"y"}, {from:"r", to:"n"}, {from:"y", to:"m"}, {from:"n", to:"m"}]);
    const r = бл[0], m = бл[3];
    t.push({имя:"схождение веток встало под их середину, а не под одну из них",
            ок: m.row === 2 && Math.abs(m.col - r.col) < 0.01,
            факт: "схождение " + m.col + ", развилка " + r.col});
  }
  {
    /* Схема от ChatGPT: схождение веток на ряд ниже соседнего блока. Подтяжка «под середину
       родителей» ставила его ровно под тот блок, который стрелке надо обойти, — и стрелка шла
       СКВОЗЬ него, а подпись ветки ложилась поверх чужого текста (КРОЛИК, снимок 07.09.2026). */
    const бл = [{id:"d", w:1}, {id:"k", w:1}, {id:"s", w:1}, {id:"i", w:1}];
    drawAutoGrid(бл, [{from:"d", to:"k"}, {from:"d", to:"s"}, {from:"k", to:"s"}, {from:"s", to:"i"}]);
    const d = бл[0], k = бл[1], s = бл[2];
    // где стрелка d→s пересекает ряд, в котором стоит k
    const доля = (k.row - d.row) / (s.row - d.row);
    const цx = (d.col + 0.5) + ((s.col + 0.5) - (d.col + 0.5)) * доля;
    t.push({имя:"стрелка через ряд не идёт сквозь чужой блок",
            ок: s.row > k.row && (цx <= k.col || цx >= k.col + 1),
            факт: "блок " + k.col + "…" + (k.col + 1) + ", стрелка пересекает ряд в " + цx.toFixed(2)});
  }

  const готова = (typeof drawLibReady === "function") ? await drawLibReady() : false;
  t.push({имя:"вендор доски загрузился (без него схему не собрать)", ок: готова === true, факт: String(готова)});
  if(готова){
    const пол = addItem({kind:"flow", title:"КОМ-полотно"});
    const зад = addItem({kind:"task", title:"КОМ-задача"});
    render(); await ж(90);
    const сц = () => (((S.boards || {})[пол.id]) || {}).elements || [];
    const шт = вид => сц().filter(э => э.type === вид).length;

    {
      const п = cmdParse(JSON.stringify({ops:[{op:"draw", node:зад.id, blocks:[{id:"b1", text:"а"}]}]}));
      t.push({имя:"рисовать на задаче нельзя — ошибка разбора", ок: п.errors.length === 1 && !п.ops.length, факт: п.errors[0] || ""});
    }
    {
      const п = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:[{id:"b1", type:"пирамида", text:"а"}]}]}));
      t.push({имя:"вид блока не из реестра — ошибка", ок: п.errors.length === 1, факт: п.errors[0] || ""});
    }
    {
      const п = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:[{id:"b1", text:"а"}], edges:[{from:"b1", to:"b9"}]}]}));
      t.push({имя:"стрелка на несуществующий блок — ошибка", ок: п.errors.length === 1, факт: п.errors[0] || ""});
    }
    {
      const много = []; for(let i = 0; i <= CMD_DRAW_BLOCKS; i++) много.push({id:"b" + i, text:"x"});
      const п = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:много}]}));
      t.push({имя:"блоков больше потолка — ошибка", ок: п.errors.length === 1, факт: п.errors[0] || ""});
    }

    // применение: четыре блока цепочкой, координат в пакете нет — раскладывает приложение
    const р = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:[
        {id:"a", type:"terminal", text:"Идея"}, {id:"b", type:"proc", text:"Прототип"},
        {id:"c", type:"decision", text:"Годится?"}, {id:"d", type:"comment", text:"замеры"}],
      edges:[{from:"a", to:"b"}, {from:"b", to:"c"}, {from:"c", to:"d", label:"нет"}]}]}));
    const беды = await cmdBuildBoards(р.ops);
    t.push({имя:"схема собралась без ошибок", ок: !р.errors.length && !беды.length, факт: р.errors.concat(беды).join(" | ")});
    cmdApply(р.ops); await ж(140);
    t.push({имя:"на доске появились блоки и стрелки", ок: шт("rectangle") === 4 && шт("arrow") === 3,
            факт: "прямоугольников " + шт("rectangle") + ", стрелок " + шт("arrow")});
    t.push({имя:"подписи блоков не потерялись",
            ок: сц().filter(э => э.type === "text").map(э => э.text).join("|").indexOf("Прототип") >= 0,
            факт: сц().filter(э => э.type === "text").map(э => э.text).join(", ")});
    t.push({имя:"без координат схема разложена по связям, а не в одну точку",
            ок: new Set(сц().filter(э => э.type === "rectangle").map(э => э.y)).size >= 3,
            факт: "рядов: " + new Set(сц().filter(э => э.type === "rectangle").map(э => э.y)).size});
    /* Цепочка идёт одним столбцом — значит все три стрелки строго вертикальные. Вендор у стрелки
       берёт габариты через `||`, и ширину 0 подменял дефолтной: стрелки уезжали вправо на сотню
       пикселей и втыкались в правый край следующего блока (КРОЛИК, снимок 07.09.2026). */
    /* Возврат назад («нет → вернуться») в блок-схемах обычен, и такие стрелки идут в обход.
       Первая версия вела все обходы по одному краю, и две стрелки ложились друг на друга вместе
       с подписями (КРОЛИК, снимок 07.09.2026). */
    {
      const кб = (id, y) => ({id: id, type:"proc", text: id, x: 0, y: y, w: 320, h: 140});
      const эл = drawBuild([кб("A", 0), кб("B", 200), кб("C", 400), кб("D", 600)],
                           [{from:"C", to:"A"}, {from:"D", to:"A"}]);
      const полосы = эл.filter(э => э.type === "arrow" && (э.points || []).length >= 4)
                       .map(э => Math.round((+э.x || 0) + (э.points[1][0] || 0)));
      t.push({имя:"два обхода не ложатся друг на друга: у каждого своя полоса",
              ок: полосы.length === 2 && полосы[0] !== полосы[1],
              факт: "обходов " + полосы.length + ", полосы: " + полосы.join(", ")});
    }
    /* Промпт велит модели раскладывать схему самой и не давать стрелкам пересекаться. Проверяем
       на ЕГО ЖЕ примере: если рекомендованная раскладка сама требует обходов, значит промпт
       советует то, что не работает (КРОЛИК: «если попрошу без пересечений — он сделает»). */
    {
      const р = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:[
        {id:"a", type:"terminal", text:"Идея", col:1, row:0},
        {id:"b", type:"proc", text:"Прототип", col:1, row:1},
        {id:"c", type:"decision", text:"Годится?", col:1, row:2},
        {id:"d", type:"proc", text:"Выпустить", col:0, row:3},
        {id:"e", type:"proc", text:"Доработать", col:2, row:3}],
        edges:[{from:"a", to:"b"}, {from:"b", to:"c"},
               {from:"c", to:"d", label:"да"}, {from:"c", to:"e", label:"нет"}]}]}));
      await cmdBuildBoards(р.ops);
      const эл = (р.ops[0] || {})._els || [];
      const стрелок = эл.filter(э => э.type === "arrow").length;
      const обходы = эл.filter(э => э.type === "arrow" && (э.points || []).length > 2).length;
      t.push({имя:"пример раскладки из промпта рисуется без единого обхода",
              ок: !р.errors.length && стрелок === 4 && обходы === 0,
              факт: "стрелок " + стрелок + ", из них в обход " + обходы + " · " + р.errors.join(" | ")});
    }
    {
      const косые = сц().filter(э => э.type === "arrow" && Math.abs(+э.width || 0) > 2);
      t.push({имя:"вертикальные стрелки остались вертикальными, а не уехали вбок",
              ок: косые.length === 0,
              факт: "стрелок с уходом вбок: " + косые.length + " · ширины: " +
                    сц().filter(э => э.type === "arrow").map(э => Math.round(+э.width || 0)).join(", ")});
    }
    t.push({имя:"доска записана в S.boards, а не в ноду", ок: пол.elements === undefined && сц().length > 0, факт: "элементов: " + сц().length});

    // дорисовка: старое на месте, новое ниже
    const былоЭл = сц().length, низПрежних = Math.max.apply(null, сц().map(э => (+э.y || 0) + (+э.height || 0)));
    const р2 = cmdParse(JSON.stringify({ops:[{op:"draw", node:пол.id, blocks:[{id:"z", text:"Дописано"}]}]}));
    await cmdBuildBoards(р2.ops);
    cmdApply(р2.ops); await ж(140);
    t.push({имя:"append дорисовывает, а не стирает", ок: сц().length === былоЭл + 2,
            факт: "было " + былоЭл + ", стало " + сц().length});
    t.push({имя:"дописанное легло НИЖЕ прежнего, а не поверх",
            ок: Math.min.apply(null, сц().slice(былоЭл).map(э => +э.y || 0)) >= низПрежних,
            факт: "низ прежних " + низПрежних + ", верх нового " + Math.min.apply(null, сц().slice(былоЭл).map(э => +э.y || 0))});

    // замена непустой доски = удаление: агент без согласия её не делает
    {
      const пакет = JSON.stringify({ops:[{op:"draw", node:пол.id, mode:"replace", blocks:[{id:"q", text:"Замена"}]}]});
      const отк = JSON.parse(cmdAgent("apply", JSON.stringify({ops: пакет})));
      t.push({имя:"замена непустой доски требует allowDelete", ок: отк.ok === false && сц().length === былоЭл + 2,
              факт: (отк.errors || [отк.error]).join(" | ")});
    }

    // откат и повтор
    const отпечаток = () => JSON.stringify(сц().map(э => [э.type, Math.round(+э.x || 0), Math.round(+э.y || 0)]));
    const послеПакета = отпечаток();
    undoStep(); await ж(180);
    t.push({имя:"Ctrl+Z вернул доску к виду до пакета", ок: сц().length === былоЭл,
            факт: "элементов " + сц().length + ", ждали " + былоЭл});
    redoStep(); await ж(180);
    t.push({имя:"повтор вернул дорисованное", ок: отпечаток() === послеПакета,
            факт: "элементов " + сц().length + ", ждали " + (былоЭл + 2)});

    // полотно, созданное этим же пакетом: откат обязан унести и ноду, и её доску
    {
      const р3 = cmdParse(JSON.stringify({ops:[
        {op:"node", as:"m", kind:"flow", title:"КОМ-новое полотно"},
        {op:"draw", node:"m", blocks:[{id:"x", text:"раз"}, {id:"y", text:"два"}], edges:[{from:"x", to:"y"}]}]}));
      await cmdBuildBoards(р3.ops);
      const итог = cmdApply(р3.ops); await ж(140);
      const нов = итог && итог.alias && итог.alias["m"];
      t.push({имя:"полотно и схема создаются одним пакетом",
              ок: !!нов && ((((S.boards || {})[нов]) || {}).elements || []).length > 0, факт: "id " + нов});
      undoStep(); await ж(180);
      t.push({имя:"откат унёс и ноду, и её доску",
              ок: !!нов && !cmdFindAny(нов) && !((S.boards || {})[нов]),
              факт: нов ? ("нода " + (cmdFindAny(нов) ? "жива" : "снята") + ", доска " + (((S.boards || {})[нов]) ? "осталась" : "снята")) : "не создалась"});
    }

    // чтение доски агентом
    {
      const д = JSON.parse(cmdAgent("board", JSON.stringify({node: пол.id})));
      const b = д.board || {};
      t.push({имя:"агент читает доску блоками и стрелками",
              ок: д.ok === true && (b.blocks || []).length >= 4 && (b.edges || []).length >= 3,
              факт: "блоков " + (b.blocks || []).length + ", стрелок " + (b.edges || []).length});
      t.push({имя:"в ответе нет base64 картинок", ок: JSON.stringify(д).indexOf("data:") < 0,
              факт: "длина ответа " + JSON.stringify(д).length});
      const пл = JSON.parse(cmdAgent("board", JSON.stringify({node: зад.id})));
      t.push({имя:"доски у задачи нет — честный отказ", ок: пл.ok === false, факт: пл.error || ""});
    }

    hardDeleteItem(пол.id); hardDeleteItem(зад.id); render(); await ж(80);
  }
}

render(); await ж(120);
console.error = прежний;
t.push({имя:"консоль чистая", ок: ошибки.length === 0, факт: ошибки.slice(0, 2).join(" | ")});
return t;
