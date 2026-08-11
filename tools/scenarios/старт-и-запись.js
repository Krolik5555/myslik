// Мост к бэкенду и запись на диск — самый дорогой класс багов: тут теряются заметки.
// Проверки повторяют то, на чём приложение однажды затирало planner.json демо-данными и
// теряло последнее действие при закрытии окна.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));

// --- мост считается готовым только когда есть РАБОЧИЙ метод, а не пустой объект.
// pywebview создаёт window.pywebview.api пустым и навешивает методы вторым скриптом;
// в этот зазор приложение либо стартовало в мёртвое окно, либо решало «это браузер».
const былоPy = window.pywebview;
window.pywebview = {api: {}};
t.push({имя:"мост с пустым api не считается готовым", ок: HasPy() === false, факт:"HasPy: " + HasPy()});

const журнал = [];
window.pywebview.api.load = async () => ({areas: S.areas, items: S.items, links: S.links, settings: S.settings});
window.pywebview.api.save = async (s) => { журнал.push("save(" + s.items.length + ")"); return true; };
window.pywebview.api.backup = async () => "копия.json";
window.pywebview.api.win_close = () => журнал.push("win_close");
t.push({имя:"мост с методами считается готовым", ок: HasPy() === true, факт:"HasPy: " + HasPy()});

// --- последнее действие обязано доехать до диска ДО закрытия окна:
// запись отложена дебаунсом на 250 мс, а окно рвалось немедленно.
журнал.length = 0;
addItem({kind:"task", title:"Мысль перед закрытием"});
// кнопки в разметке нет: полоса заголовка нативная, и она зовёт appRequestClose
await window.appRequestClose();
await ж(400);
const порядок = журнал.join(" → ");
t.push({имя:"запись уходит раньше закрытия окна",
        ок: /save\(\d+\)\s*→\s*win_close/.test(порядок), факт: порядок || "ничего не произошло"});

// --- отказ диска должен быть ВИДЕН, а не выглядеть успехом
журнал.length = 0;
window.pywebview.api.save = async () => false;          // бэкенд честно говорит «не смог»
const ок = await writeNow();
t.push({имя:"отказ записи распознаётся", ок: ок === false && saveBroken() === true,
        факт:"writeNow вернул " + ок + ", флаг сбоя: " + saveBroken()});
const тост = document.querySelector("#toast");
t.push({имя:"о сбое записи сообщают человеку",
        ок: тост.classList.contains("show") && /не удалось|сорвалось|памяти/i.test(тост.textContent),
        факт: тост.textContent.slice(0, 70)});

// --- восстановление: как только диск снова пишет, приложение об этом говорит
window.pywebview.api.save = async () => true;
const ок2 = await writeNow();
t.push({имя:"после починки диска запись восстанавливается", ок: ок2 === true && saveBroken() === false,
        факт:"флаг сбоя: " + saveBroken()});

// --- бэкап рапортует по факту, а не всегда «сохранён»
window.pywebview.api.backup = async () => "";           // копия не удалась
await makeBackup();
const пусто = await Store.backup();
t.push({имя:"неудавшийся бэкап не выдаётся за успешный", ок: !пусто, факт:"вернулось: «" + пусто + "»"});

// --- чужой/битый файл при импорте не должен обрушивать состояние
const целых = S.items.length;
let упало = false;
try { sanitizeState({areas:[null, {id:"a1", name:"Тест"}], items:[null, 42, {id:"i1", title:"ок"}],
                     links:[["i1","i1"]], settings:{}}); }
catch(e){ упало = true; }
t.push({имя:"мусор в импортируемом файле не роняет разбор", ок: !упало, факт: упало ? "исключение" : ""});
t.push({имя:"состояние приложения не пострадало", ок: S.items.length === целых,
        факт: S.items.length + " элементов"});

/* УДАЛЕНИЕ БЕЗ КОРЗИНЫ. Удалили — удалено сразу, второй раз подтверждать нечего. Но вернуть
   обязано вернуть ВСЁ: ноду, её связи и тяжёлое содержимое (доску полотна, картинки полей),
   которое лежит вне ноды и в снимок отката не входит. */
{
  const PNG1="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const сосед = addItem({kind:"note", title:"сосед"});
  const жертва = addItem({kind:"note", title:"жертва"});
  жертва.fields=[fieldMake("image","Скрин"), fieldMake("board","Набросок")];
  жертва.fields[0].media=fieldMediaPut(PNG1);
  S.boards[fieldBoardKey(жертва.fields[1].id)]={elements:[{type:"rectangle", id:"r1"}], files:{}, appState:{}};
  S.boards[жертва.id]={elements:[{type:"ellipse", id:"e1"}], files:{}, appState:{}};
  addLink(сосед.id, жертва.id);
  persist(); undoPush();
  const ключК=жертва.fields[0].media, ключД=fieldBoardKey(жертва.fields[1].id), ид=жертва.id;

  const пакет = deletePack([ид]);
  t.push({имя:"удаление сносит ноду сразу, без корзины",
          ок: !S.items.some(i=>i.id===ид) && !S.links.some(l=>l[0]===ид||l[1]===ид)
              && !S.media[ключК] && !S.boards[ключД],
          факт: "нода в списке: "+S.items.some(i=>i.id===ид)+", картинка: "+!!S.media[ключК]});

  restorePack(пакет);
  t.push({имя:"«Вернуть» в тосте возвращает ноду, связи и содержимое",
          ок: S.items.some(i=>i.id===ид) && S.links.some(l=>(l[0]===ид||l[1]===ид))
              && S.media[ключК]===PNG1 && !!S.boards[ключД] && !!S.boards[ид],
          факт: "связь: "+S.links.some(l=>l[0]===ид||l[1]===ид)+
                ", картинка: "+(S.media[ключК]===PNG1)+", доска поля: "+!!S.boards[ключД]});

  /* И то же самое откатом (Ctrl+Z): содержимое достаётся из кармана удалённых.
     Окно склейки правок закрываем ЯВНО (flushSave), иначе удаление попало бы в то же
     «одно действие», что и возврат выше, и откат вернул бы состояние на шаг раньше. */
  await flushSave();
  deletePack([ид]); persist();
  const вернулось = undoStep();
  await ж(150);
  t.push({имя:"Ctrl+Z возвращает удалённую ноду вместе с картинками и досками",
          ок: вернулось && S.items.some(i=>i.id===ид) && S.media[ключК]===PNG1
              && !!S.boards[ключД] && !!S.boards[ид],
          факт: "нода: "+S.items.some(i=>i.id===ид)+", картинка: "+(S.media[ключК]===PNG1)+
                ", доска ноды: "+!!S.boards[ид]});

  // старые данные с корзиной: помеченные удалёнными ноды сносятся при чистке насовсем
  const чищено = sanitizeState({items:[{id:"i1", kind:"note", title:"живая"},
                                       {id:"i2", kind:"note", title:"из корзины", deleted:true}]});
  t.push({имя:"старые «удалённые» ноды не остаются висеть в файле",
          ок: чищено.items.length===1 && чищено.items[0].id==="i1",
          факт: "осталось нод: "+чищено.items.length});

  [сосед.id, ид].forEach(x=>hardDeleteItem(x));
}

/* СТАРТ НЕ ИМЕЕТ ПРАВА ЗАТИРАТЬ СОХРАНЁННОЕ. Проверка «файл есть» когда-то смотрела на один
   ключ areas; после перехода на графы ноды переехали внутрь graphs, верхнего areas в файле не
   стало — и живой файл был объявлен чужим, а поверх него записались демо-данные. Проверяем
   ровно это: состояние в НОВОМ формате распознаётся, и демо не подсовывается. */
{
  const новый = {v:2, graphs:[{id:"g_main", name:"Мой граф",
      items:[{id:"i_живая", kind:"note", title:"живая нода"}], areas:[{id:"a1", name:"Область", icon:"ti-home"}], links:[]}],
    boards:{}, media:{}, templates:[], tags:[], settings:{theme:"dark", view:"notes"}};
  t.push({имя:"файл в новом формате (только graphs) считается сохранённым",
          ок: жилойФайл(новый)===true, факт:"признан живым: "+жилойФайл(новый)});
  t.push({имя:"старый формат (areas/items наверху) тоже считается сохранённым",
          ок: жилойФайл({areas:[], items:[], settings:{}})===true, факт:""});
  t.push({имя:"пустота и мусор за сохранённое НЕ принимаются",
          ок: !жилойФайл(null) && !жилойФайл(undefined) && !жилойФайл([]) && !жилойФайл("строка") && !жилойФайл({}),
          факт:"null/[]/строка/{} → демо законно"});
  // и содержимое такого файла доезжает до состояния целиком
  const s2 = sanitizeState(Object.assign(defaultState(), JSON.parse(JSON.stringify(новый))));
  t.push({имя:"ноды из файла нового формата доезжают до приложения",
          ок: s2.items.length===1 && s2.items[0].title==="живая нода" && s2.areas.length===1,
          факт:"нод: "+s2.items.length+", областей: "+s2.areas.length});
}

/* ОБНОВЛЕНИЕ НЕ ИМЕЕТ ПРАВА ТЕРЯТЬ ГРАФ. У всех, кто обновится, файл лежит в СТАРОМ формате
   (items/areas/links на верхнем уровне) — он обязан переехать в первый граф целиком, вместе
   с досками, картинками, тегами и настройками. Единственное, что уходит намеренно, — корзина:
   её больше нет как понятия. */
{
  const PNG2="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const старый = {
    v:2,
    areas:[{id:"a_w", name:"Работа", icon:"ti-video"}, {id:"a_h", name:"Дом", icon:"ti-home"}],
    items:[
      {id:"n1", kind:"note", title:"живая заметка", area:"a_w", x:10, y:10,
       fields:[{id:"f1", type:"image", name:"скрин", media:"m_1"}, {id:"f2", type:"board", name:"доска"}]},
      {id:"n2", kind:"task", title:"живая задача", area:"a_h", x:20, y:20, status:"doing"},
      {id:"n3", kind:"flow", title:"полотно", x:30, y:30},
      {id:"n4", kind:"note", title:"из корзины", deleted:true}
    ],
    links:[["n1","n2"],["n1","n4"]],
    boards:{"n3":{elements:[{type:"rectangle", id:"r1"}]}, "fld_f2":{elements:[{type:"ellipse", id:"e1"}]}},
    media:{"m_1":PNG2},
    tags:[{name:"важное", color:"#e0625a"}],
    templates:[{id:"tpl_1", name:"Разбор", kind:"note", fields:[{type:"text", name:"Что"}]}],
    settings:{theme:"light", view:"notes", asideW:500}
  };
  const s3 = sanitizeState(Object.assign(defaultState(), JSON.parse(JSON.stringify(старый))));

  t.push({имя:"старый файл переезжает в первый граф целиком",
          ок: s3.graphs.length===1 && s3.items.length===3 && s3.areas.length===2 && s3.links.length===1,
          факт: "нод "+s3.items.length+" (было 3 живых + 1 в корзине), областей "+s3.areas.length+
                ", связей "+s3.links.length});
  t.push({имя:"содержимое нод переезжает вместе с ними",
          ок: s3.media["m_1"]===PNG2 && !!s3.boards["n3"] && !!s3.boards["fld_f2"],
          факт: "картинка: "+(s3.media["m_1"]===PNG2)+", доска полотна: "+!!s3.boards["n3"]+
                ", доска поля: "+!!s3.boards["fld_f2"]});
  t.push({имя:"теги, шаблоны и настройки не теряются при переезде",
          ок: s3.tags.length===1 && s3.templates.length===1 && s3.settings.theme==="light"
              && s3.settings.asideW===500,
          факт: "тегов "+s3.tags.length+", шаблонов "+s3.templates.length+", тема "+s3.settings.theme});
  t.push({имя:"ноды из корзины уходят, живые остаются",
          ок: !s3.items.some(i=>i.title==="из корзины")
              && ["живая заметка","живая задача","полотно"].every(n=>s3.items.some(i=>i.title===n)),
          факт: s3.items.map(i=>i.title).join(", ")});
  // и повторная чистка (каждая загрузка) ничего больше не отъедает
  const s4 = sanitizeState(JSON.parse(JSON.stringify(s3)));
  t.push({имя:"повторная загрузка не отъедает данные",
          ок: s4.items.length===s3.items.length && s4.graphs.length===1
              && Object.keys(s4.boards).length===Object.keys(s3.boards).length,
          факт: "нод "+s4.items.length+", досок "+Object.keys(s4.boards).length});
}

/* ДЕФОЛТ НАСТРОЙКИ НЕ ПЕРЕЕЗЖАЕТ ПОВЕРХ УЖЕ СОХРАНЁННОГО ВЫБОРА. sanitizeState сливает дефолт
   с файлом через Object.assign({}, defaultState().settings, s.settings||{}) — явное значение
   в файле всегда побеждает. Смена дефолта в коде (пример: graphRender на canvas, 2026-08-11)
   обязана трогать ТОЛЬКО совсем новые файлы (ключа ещё не было вовсе), а не тех, кто уже
   сохранялся при старом дефолте — иначе обновление тихо переключило бы вид всем разом. */
{
  const своё = sanitizeState(Object.assign(defaultState(), {settings:{graphRender:"svg"}}));
  t.push({имя:"явно сохранённый режим отрисовки графа переживает смену дефолта в коде",
          ок: своё.settings.graphRender==="svg",
          факт: "ждали svg (записан явно), получили "+своё.settings.graphRender});
  const новый = sanitizeState(Object.assign(defaultState(), {settings:{}}));
  t.push({имя:"у совсем нового файла (ключа нет) подхватывается ТЕКУЩИЙ дефолт приложения",
          ок: новый.settings.graphRender===defaultState().settings.graphRender,
          факт: "дефолт сейчас "+defaultState().settings.graphRender+", получили "+новый.settings.graphRender});
}

/* ДОСКИ ЧЕРЕЗ МОСТ — ТОЛЬКО КОГДА РЕАЛЬНО ПОМЕНЯЛИСЬ. На живых данных доски — 3.5+ из 4+ МБ
   файла, и раньше мост нёс их ПОЛНОСТЬЮ на каждый save(), даже когда правили чек-бокс задачи.
   boardSet/boardDelete — ЕДИНСТВЕННЫЙ путь мутации S.boards (см. core.js) — бьют счётчик
   _boardsVer, и Store.save шлёт доски только когда он разошёлся с версией последней удачной
   отправки. Дев-режим этого не проверяет сам по себе (там HasPy()===false, доски шлются
   всегда, см. Store.save) — мост подменяем здесь тем же приёмом, что и выше в этом файле. */
{
  const слал = [];
  // СНИМОК, а не ссылка: s.boards — это тот же живой объект S.boards (не копия), и следующий
  // же boardDelete задним числом стёр бы ключ во всех уже отправленных «записях журнала».
  window.pywebview.api.save = async (s) => { слал.push(s.boards ? JSON.parse(JSON.stringify(s.boards)) : s.boards); return true; };

  await writeNow();                          // зафиксировать текущую версию, какой бы она ни была
  слал.length = 0;

  await writeNow();                          // ничего в досках не менялось
  const безИзменений = слал[слал.length - 1];

  const ключ = "тест_доска_" + Date.now();
  boardSet(ключ, {elements: []});
  await writeNow();                          // доски изменились — обязаны прийти
  const послеBoardSet = слал[слал.length - 1];

  await writeNow();                          // снова ничего не менялось
  const ещёРаз = слал[слал.length - 1];

  boardDelete(ключ);
  await writeNow();                          // удаление — тоже изменение, обязаны прийти
  const послеBoardDelete = слал[слал.length - 1];

  t.push({имя: "мост несёт доски только когда они реально изменились",
          ок: безИзменений === null && послеBoardSet !== null && !!послеBoardSet[ключ]
              && ещёРаз === null && послеBoardDelete !== null && !послеBoardDelete[ключ],
          факт: "без изменений: " + JSON.stringify(безИзменений)
              + "; после boardSet: " + (послеBoardSet ? "пришли, есть ключ: " + !!послеBoardSet[ключ] : "null")
              + "; повторно без изменений: " + JSON.stringify(ещёРаз)
              + "; после boardDelete: " + (послеBoardDelete ? "пришли, ключа нет: " + !послеBoardDelete[ключ] : "null")});

  слал.length = 0;
  boardDelete("несуществующий_ключ_" + Date.now());   // удаление ОТСУТСТВУЮЩЕГО ключа — не изменение
  await writeNow();
  t.push({имя: "boardDelete несуществующего ключа не считается изменением",
          ок: слал[0] === null, факт: JSON.stringify(слал[0])});
}

// убираем мост за собой
if (былоPy === undefined) delete window.pywebview; else window.pywebview = былоPy;
const мусор = S.items.find(i => i.title === "Мысль перед закрытием");
if (мусор) hardDeleteItem(мусор.id);
render();
return t;
