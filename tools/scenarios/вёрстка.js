/* ВЁРСТКА — линейка, а не вкусовщина.
   Проверяем то, что можно ИЗМЕРИТЬ и что человек видит как «криво»: содержимое, вылезшее за свой
   контейнер, обрезанный без многоточия текст, наложение кнопок, поля одной строки разной высоты.
   Вкусовые вопросы (отступ 12 против 14) здесь не живут — их ловит глаз, а не сценарий.

   Ширину окна НЕ подменяем: #topbar и #body позиционируются от окна, и сужение #app давало
   ложные «уехало за край» на каждой вкладке. Узкие раскладки проверяем тем, чем их сужает
   человек, — разделителем правой панели.

   У полей ввода прокрутка законна (курсор внутри длинного текста), поэтому input/textarea/select
   из проверки переполнения исключены — иначе линейка ругалась бы на нормальный ввод. */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const пр = n => n.getBoundingClientRect();
const имяУзла = n => n.tagName.toLowerCase() + (n.id ? "#" + n.id : "") +
  (n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
const пропустить = n => n.closest(".excalidraw") || ["CANVAS","SVG","INPUT","TEXTAREA","SELECT"].includes(n.tagName);

/* Содержимое шире своего блока. НАМЕРЕННУЮ обрезку (overflow:hidden + многоточие) не считаем
   дефектом: у такого элемента scrollWidth больше clientWidth по определению — это и есть
   работающее многоточие, а не поломка. Дефект — когда блок раздувается САМ и ломает соседей. */
const переполнения = корень => [...корень.querySelectorAll("*")].filter(n => {
  if (пропустить(n)) return false;
  const c = getComputedStyle(n);
  if (c.display === "none" || c.overflowX === "auto" || c.overflowX === "scroll") return false;
  if (c.textOverflow === "ellipsis" && c.overflowX === "hidden") return false;
  return n.scrollWidth - n.clientWidth > 2 && n.clientWidth > 0;
});
// текст, обрезанный БЕЗ многоточия: человек видит обрубок и не понимает, что дальше
const обрубки = корень => [...корень.querySelectorAll("*")].filter(n => {
  if (пропустить(n) || n.children.length || !(n.textContent || "").trim()) return false;
  const c = getComputedStyle(n);
  if (c.display === "none" || c.textOverflow === "ellipsis" || c.overflow === "auto") return false;
  if (c.whiteSpace !== "nowrap") return false;
  return n.scrollWidth - n.clientWidth > 2;
});
/* Вылез за границы СВОЕГО контейнера — то есть лёг поверх соседей. Меряем от блока с обрезкой
   или прокруткой (ближайший «хозяин» области), а не от окна: попапы и модалки живут по своим
   правилам и от окна законно отсчитываются сами. */
const вылезло = (корень, хозяин) => {
  const r0 = пр(хозяин);
  return [...корень.querySelectorAll("*")].filter(n => {
    if (пропустить(n)) return false;
    const c = getComputedStyle(n);
    if (c.display === "none" || c.visibility === "hidden" || c.position === "fixed" || c.position === "absolute") return false;
    const r = пр(n);
    if (!r.width || !r.height) return false;
    return r.right > r0.right + 2 || r.left < r0.left - 2;
  });
};
// наложение кнопок: клик уходит не туда, куда целятся
const наложения = корень => {
  const кн = [...корень.querySelectorAll("button")].filter(b => {
    const c = getComputedStyle(b); const r = пр(b);
    return c.display !== "none" && c.visibility !== "hidden" && r.width > 4 && r.height > 4;
  });
  const пары = [];
  for (let i = 0; i < кн.length; i++) for (let j = i + 1; j < кн.length; j++) {
    if (кн[i].contains(кн[j]) || кн[j].contains(кн[i])) continue;
    const a = пр(кн[i]), b = пр(кн[j]);
    if (Math.min(a.right,b.right) - Math.max(a.left,b.left) > 2 &&
        Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top) > 2) пары.push(имяУзла(кн[i]) + " ↔ " + имяУзла(кн[j]));
  }
  return пары;
};

const проверить = (имя, корень, хозяин) => {
  const п = переполнения(корень), о = обрубки(корень), в = вылезло(корень, хозяин || корень), н = наложения(корень);
  t.push({имя: имя + ": содержимое не шире своего блока", ок: п.length === 0,
          факт: п.length ? п.slice(0, 4).map(n => имяУзла(n) + " (+" + (n.scrollWidth - n.clientWidth) + "px)").join(", ") : "переполнений нет"});
  t.push({имя: имя + ": нет текста, обрезанного без многоточия", ок: о.length === 0,
          факт: о.length ? о.slice(0, 4).map(n => имяУзла(n) + " «" + n.textContent.trim().slice(0, 24) + "»").join("; ") : "обрубков нет"});
  t.push({имя: имя + ": ничего не вылезло за границы контейнера", ок: в.length === 0,
          факт: в.length ? в.slice(0, 4).map(имяУзла).join(", ") : "всё внутри"});
  t.push({имя: имя + ": кнопки не налезают друг на друга", ок: н.length === 0,
          факт: н.length ? н.slice(0, 3).join("; ") : "наложений нет"});
};

/* ---------- длинные данные: именно на них ломается вёрстка ---------- */
const длинное = "Очень длинное название задачи ЧтобыПроверитьПоведениеОченьДлинногоСловаБезПробелов";
const жирная = addItem({kind:"task", title: длинное, due:"2026-09-15", priority:3,
                        body:"Описание с длинным словом ОченьДлинноеСловоКотороеНеПереносится и обычным текстом.",
                        tags:["первыйтег","второйтег","третийтегподлиннее","четвёртый","пятый","шестой"]});
жирная.folder = "E:\\_Dropbox\\Проекты\\Очень\\Глубокая\\Вложенность\\Папок\\Для\\Проверки\\Переноса";
const мелкие = [];
for (let i = 0; i < 12; i++) мелкие.push(addItem({kind:"task", title:"Задача дня " + i, due: ymd(today())}));
persist();

/* ---------- вкладки ---------- */
for (const [вид, имя] of [["today","Сегодня"], ["tasks","Задачи"], ["notes","Заметки"], ["cal","Календарь"]]) {
  view = вид; render(); await ж(вид === "notes" ? 600 : 300);
  const главное = document.querySelector("#main");
  проверить("вкладка «" + имя + "»", главное, главное);
}

/* ---------- окна ---------- */
closeOverlays();
openItemEditor(жирная); await ж(400);
{
  const м = document.querySelector(".modal");
  проверить("окно правки", м, м);
  t.push({имя:"окно правки помещается в высоту экрана", ок: пр(м).height <= innerHeight - 8,
          факт: Math.round(пр(м).height) + " px при экране " + innerHeight});
  const кривые = [...м.querySelectorAll(".row2")].filter(с => {
    const поля = [...с.querySelectorAll(".field > input, .field > select, .field > .seg, .field > .date-ctl")];
    if (поля.length < 2) return false;
    const в = поля.map(p => Math.round(пр(p).height));
    return Math.max(...в) - Math.min(...в) > 2;
  });
  t.push({имя:"поля в одной строке окна одной высоты", ок: кривые.length === 0,
          факт: кривые.length ? кривые.map(с => [...с.querySelectorAll(".field > *:not(label)")].map(p => Math.round(пр(p).height)).join("/")).join("; ") : "все ровные"});
}
closeOverlays(); await ж(150);

openNoteReader(жирная); await ж(400);
{ const м = document.querySelector(".modal"); проверить("окно чтения", м, м); }
closeOverlays(); await ж(150);

/* ---------- правая панель: узкая (её сужают разделителем) и широкая ---------- */
view = "notes"; render(); await ж(500);
asideSelect(жирная.id); await ж(350);
for (const w of [300, 900]) {
  const a = document.querySelector("#aside");
  a.style.width = w + "px"; await ж(300);
  проверить("правая панель " + w + " px", a, a);
  a.style.width = "";
}
await ж(150);

/* ---------- убираем за собой ---------- */
hardDeleteItem(жирная.id);
мелкие.forEach(i => hardDeleteItem(i.id));
recomputeHierarchy(); render(); await ж(200);
return t;
