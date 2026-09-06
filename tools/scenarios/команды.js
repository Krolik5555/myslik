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
  t.push({имя:"связь легла в links ПОДГРАФА, а не активного графа",
          ок: !!вн && (вн.links || []).length === 1 && S.links.length === былоСвязей,
          факт: вн ? ("внутри: " + вн.links.length + ", снаружи прибавилось: " + (S.links.length - былоСвязей)) : "подграфа нет"});
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
}

render(); await ж(120);
console.error = прежний;
t.push({имя:"консоль чистая", ок: ошибки.length === 0, факт: ошибки.slice(0, 2).join(" | ")});
return t;
