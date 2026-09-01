// Отчёт по выделенному: папки нод и укорачивание пути до общей части Dropbox.
// Путь отдают ДРУГОМУ человеку, у которого корень Dropbox лежит в своём месте, поэтому
// локальное начало обязано отрезаться, а всё остальное — остаться дословно.
const t = [];

const дропбокс = "E:\\_Dropbox\\Moviestudio Dropbox\\3D\\Current projects\\057_GK_CUP_2026\\02_sequences\\Team_Presentation\\Astra\\renders\\final\\astra_compositing";
const ждём = "Moviestudio Dropbox\\3D\\Current projects\\057_GK_CUP_2026\\02_sequences\\Team_Presentation\\Astra\\renders\\final\\astra_compositing";
t.push({имя:"путь Dropbox режется по корню команды", ок: shortFolder(дропбокс) === ждём, факт: shortFolder(дропбокс)});

// личный Dropbox: корень называется просто «Dropbox»
const личный = "C:\\Users\\KROLIK\\Dropbox\\Проекты\\кадр";
t.push({имя:"личный Dropbox тоже режется", ок: shortFolder(личный) === "Dropbox\\Проекты\\кадр", факт: shortFolder(личный)});

// мимо Dropbox резать нечего — общего начала у людей нет, путь отдаётся целиком
const локальный = "D:\\Work\\Anim\\shot010";
t.push({имя:"не-Dropbox путь не трогается", ок: shortFolder(локальный) === локальный, факт: shortFolder(локальный)});

// вложенная папка со словом Dropbox в НАЧАЛЕ имени не должна выигрывать у корня
const ловушка = "E:\\_Dropbox\\Moviestudio Dropbox\\3D\\Dropbox links\\x";
t.push({имя:"«Dropbox links» внутри не сбивает корень",
        ок: shortFolder(ловушка) === "Moviestudio Dropbox\\3D\\Dropbox links\\x", факт: shortFolder(ловушка)});

t.push({имя:"пустая папка не роняет", ок: shortFolder(null) === "" && shortFolder("") === "", факт:""});

// сам отчёт: папки — по выключателю, не всегда (в обычном отчёте длинные пути только мешают)
const ноды = [
  {id:"a", kind:"task", title:"Рендер с альфа каналом", status:"todo", folder: дропбокс},
  {id:"b", kind:"note", title:"Без папки", body:"тело"}
];
const обычный = buildReportText(ноды);
t.push({имя:"без выключателя папок в отчёте НЕТ",
        ок: !обычный.includes("Папка:") && !обычный.includes("Папок:"),
        факт: обычный.split("\n").find(s => s.includes("Папк")) || "чисто"});
t.push({имя:"названия нод на месте и без папок",
        ок: обычный.includes("Рендер с альфа каналом") && обычный.includes("Без папки"), факт:""});

/* МАРКЕРЫ И СВОДКА — ИЗ ОБЩЕГО РЕЕСТРА (2026-09-01). Раньше и то, и другое было выписано в
   report.js руками, четырьмя парами if, и каждый новый статус требовал правки в четырёх местах
   одного файла. Проверяем, что новые значения доходят до текста, а не молча становятся «○». */
{
  const см = [
    {id:"s1", kind:"task", title:"ждёт ферму", status:"waiting"},
    {id:"s2", kind:"task", title:"взято на заход", status:"next"},
    {id:"s3", kind:"task", title:"в работе", status:"doing"},
    {id:"s4", kind:"task", title:"отложено", status:"paused"},
    {id:"s5", kind:"note", title:"просто заметка", status:"note"},
  ];
  const тс = buildReportText(см);
  const сводка = тс.split("\n").find(s => s.startsWith("Задачи:")) || "";
  t.push({имя:"в сводке отчёта есть «ждёт» и «на очереди»",
          ок: сводка.includes("ждёт") && сводка.includes("на очереди"), факт: сводка});
  t.push({имя:"у каждого статуса свой маркер, заметка идёт буллетом",
          ок: тс.includes(СТАТУСЫ.waiting.маркер + " ждёт ферму")
           && тс.includes(СТАТУСЫ.next.маркер + " взято на заход")
           && тс.includes("• просто заметка"),
          факт: тс.split("\n").filter(s => /ждёт ферму|взято на заход|просто заметка/.test(s)).join(" | ")});
}

const текст = buildReportText(ноды, {folders:true});
t.push({имя:"с выключателем — укороченная папка в отчёте", ок: текст.includes("Папка: " + ждём), факт: текст.split("\n").find(s => s.includes("Папка:")) || "строки нет"});
t.push({имя:"локальное начало пути в отчёт НЕ попало", ок: !текст.includes("_Dropbox"), факт: текст.includes("_Dropbox") ? "в тексте есть E:\\_Dropbox" : "чисто"});
t.push({имя:"в шапке счётчик папок", ок: текст.includes("Папок: 1"), факт: текст.split("\n").slice(0,4).join(" | ")});

// сверка ответа ИИ: путь прошёл через модель, и укороченный ею путь у получателя не откроется
const эталоны = [ждём, "D:\\Work\\Anim\\shot010"];
t.push({имя:"целый путь в ответе ИИ претензий не вызывает",
        ок: _repBadPaths("Astra, рендер — " + ждём, эталоны).length === 0, факт:""});
t.push({имя:"обрезанный моделью путь пойман",
        ок: _repBadPaths("Astra, рендер — Moviestudio Dropbox\\3D\\final", эталоны).length === 1,
        факт: JSON.stringify(_repBadPaths("Astra, рендер — Moviestudio Dropbox\\3D\\final", эталоны))});
t.push({имя:"строки без путей не считаются битыми",
        ок: _repBadPaths("Подходящих папок нет", эталоны).length === 0, факт:""});
t.push({имя:"без эталонов сверка молчит (папки выключены)",
        ок: _repBadPaths("что-то\\с\\слэшем", []).length === 0, факт:""});

// формат списка наводит КОД: запись одной строкой, между записями пустая
const сырой = "Astra, рендер — " + ждём + "\nViper, рендер — D:\\Work\\Anim\\shot010";
const красиво = _repFormatList(сырой);
t.push({имя:"запись остаётся одной строкой",
        ок: красиво.split("\n")[0] === "Astra, рендер — " + ждём,
        факт: красиво.split("\n")[0]});
t.push({имя:"между записями пустая строка",
        ок: красиво.split("\n")[1] === "" && красиво.split("\n")[2] === "Viper, рендер — D:\\Work\\Anim\\shot010",
        факт: JSON.stringify(красиво.split("\n"))});
t.push({имя:"строка без пути не разбивается",
        ок: _repFormatList("Подходящих папок нет") === "Подходящих папок нет", факт:""});

// молчание про пропуски — то, из-за чего «нет Neon» выглядело ошибкой модели
const выделение = [
  {id:"p", kind:"task", title:"Neon"},
  {id:"c", kind:"task", title:"Рендер с альфа каналом", parent:"p"},
  {id:"d", kind:"task", title:"Свет", parent:"p", folder:"E:\\_Dropbox\\Moviestudio Dropbox\\Neon\\light"}
];
const сводка = _repMissing(выделение, "Neon, свет — Moviestudio Dropbox\\Neon\\light", ["Moviestudio Dropbox\\Neon\\light"]);
t.push({имя:"нода без папки названа вместе с владельцем",
        ок: сводка.some(s => s.includes("Neon → Рендер с альфа каналом")), факт: JSON.stringify(сводка)});
t.push({имя:"счётчик показывает, сколько папок вошло",
        ок: сводка.some(s => s.includes("Папок в выделении: 1, в списке: 1")), факт: JSON.stringify(сводка)});

return t;
