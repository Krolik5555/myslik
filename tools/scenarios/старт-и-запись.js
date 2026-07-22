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
document.querySelector("#win-close").click();
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

// убираем мост за собой
if (былоPy === undefined) delete window.pywebview; else window.pywebview = былоPy;
const мусор = S.items.find(i => i.title === "Мысль перед закрытием");
if (мусор) hardDeleteItem(мусор.id);
render();
return t;
