/* ТУР «ЧТО НОВОГО» — показывается РОВНО ОДИН РАЗ на версию, после обновления.
   Цена ошибки тут выше обычного: тур всплывает поверх интерфейса на старте, и если отметка
   о просмотре не встанет, он будет встречать человека каждый запуск. Второй способ ошибиться —
   показать его тому, кто ставит приложение впервые: рассказывать «что изменилось» человеку,
   который прежней версии не видел, незачем. Проверяем оба конца.

   Проверки идут ПО ПОРЯДКУ шагов и не зашиты на номера версий: состав тура меняется каждый
   выпуск (глубина — два релиза, docs/СБОРКА-И-РЕЛИЗ.md), и сценарий, привязанный к цифрам,
   рассыпался бы при каждом. Что здесь всё-таки закреплено — связь шкалы точек со списком
   шагов, наличие версии у каждого шага и глубина не больше двух версий. */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const _былаОтметка = S.settings.tourSeen;
// анимации доводим до конца руками: окно сценариев рисует кадры, но ждать переходы дорого
const доиграть = () => document.querySelectorAll(".tour-pop").forEach(n => n.getAnimations().forEach(a => a.finish()));

view = "notes"; notesMode = "graph"; render(); await ж(300);

// ================== ПОСЛЕ ОБНОВЛЕНИЯ: СНАЧАЛА ПРЕДЛОЖЕНИЕ ==================
/* Порядок продуманный, и проверка стережёт именно его: обновился → короткая плашка в углу
   «обновился, вот что нового, посмотреть?» → и только по кнопке большая демонстрация.
   Открывать демонстрацию сразу нельзя: человек запустил приложение работать, а ему поперёк
   экрана окно, которого он не просил. */
S.settings.tourSeen = null;
turBanner(); await ж(150);
{
  const пл = document.querySelector("#tour-banner");
  t.push({имя: "после обновления встречает плашка, а не демонстрация",
          ок: !!пл && !document.querySelector("#tour-pop"),
          факт: пл ? "плашка: «" + пл.querySelector("b").textContent + "»; демонстрация закрыта: " +
                     !document.querySelector("#tour-pop") : "плашки нет"});
  // версию проверяем ОТДЕЛЬНО: она подставляется в шаблон, и подстановка уже ломалась молча
  t.push({имя: "в плашке стоит номер версии, а не undefined",
          ок: !!пл && пл.querySelector("b").textContent.includes(ТУР_ID),
          факт: "заголовок: «" + (пл ? пл.querySelector("b").textContent : "—") + "»"});
  t.push({имя: "в плашке коротко сказано, что нового, и есть кнопка",
          // подпись теперь собирается из непоказанных шагов (см. turBanner), поэтому проверяем
          // не конкретную фразу — она меняется каждый релиз, — а что она есть и не пустая
          ок: !!пл && (пл.querySelector(".tb-sub").textContent || "").trim().length > 10 && !!document.querySelector("#tb-go"),
          факт: пл ? "«" + пл.querySelector(".tb-sub").textContent.slice(0, 60) + "…» + кнопка «" +
                     document.querySelector("#tb-go").textContent + "»" : "—"});
  /* МЕСТО ПЛАШКИ — снизу по центру, а не в углу: в правом нижнем её закрывали правая панель и
     лоток «неразобранного». Заодно следим, чтобы она не села на тост — он живёт у самого низа. */
  {
    const r = пл.getBoundingClientRect();
    const тост = document.querySelector("#toast");
    const низТоста = тост ? тост.getBoundingClientRect() : null;
    t.push({имя: "плашка стоит снизу по центру",
            ок: Math.abs((r.left + r.width / 2) - innerWidth / 2) < 4 && innerHeight - r.bottom < 120 && r.top > innerHeight / 2,
            факт: "центр по X " + Math.round(r.left + r.width / 2) + " при центре окна " +
                  Math.round(innerWidth / 2) + ", до низа окна " + Math.round(innerHeight - r.bottom) + " px"});
    t.push({имя: "плашка не наезжает на тост", ок: !низТоста || r.bottom <= низТоста.top + 1,
            факт: низТоста ? "низ плашки " + Math.round(r.bottom) + ", верх тоста " + Math.round(низТоста.top) : "тоста нет"});
  }
  t.push({имя: "плашка отмечается сразу — второй раз не предложим",
          ок: S.settings.tourSeen === ТУР_ID && turMaybeShow() === false,
          факт: "в настройках " + JSON.stringify(S.settings.tourSeen)});
}
// кнопка «Что нового» убирает плашку и открывает демонстрацию
document.querySelector("#tb-go").click(); await ж(200); доиграть();
t.push({имя: "кнопка открывает демонстрацию и убирает плашку",
        ок: !!document.querySelector("#tour-pop") && !document.querySelector("#tour-banner"),
        факт: "демонстрация: " + !!document.querySelector("#tour-pop") +
              ", плашка убрана: " + !document.querySelector("#tour-banner")});

// ================== ШАГ 0: БЕЗ ЦЕЛИ, ПО ЦЕНТРУ ==================
const p0 = document.querySelector("#tour-pop");
/* Число шагов НЕ зашиваем: глубина тура — два релиза, состав меняется каждый выпуск, и
   проверка «их ровно семь» падала бы при каждом релизе, ничего не защищая. Сторожим связь
   шкалы точек с самим списком — вот это ломается молча. */
t.push({имя: "тур открывается, и точек в шкале столько же, сколько шагов",
        ок: !!p0 && p0.querySelectorAll(".tour-dots i").length === ТУР.length && ТУР.length > 0,
        факт: p0 ? "шагов " + ТУР.length + ", точек " + p0.querySelectorAll(".tour-dots i").length +
                   ", заголовок «" + p0.querySelector(".tour-head b").textContent + "»" : "выноски нет"});
{
  const r = p0.getBoundingClientRect();
  t.push({имя: "шаг без цели встаёт по центру окна",
          ок: Math.abs((r.left + r.width / 2) - innerWidth / 2) < 3 && r.left >= 0 && r.right <= innerWidth,
          факт: "центр выноски " + Math.round(r.left + r.width / 2) + " при центре окна " + Math.round(innerWidth / 2)});
}
/* Все шаги обязаны иметь версию: по ней тур фильтруется под того, кто обновился (turNewSteps).
   Шаг без `v` виден всем и каждый раз — то есть тур перестаёт быть слоёным. */
t.push({имя: "у каждого шага проставлена версия",
        ок: ТУР.every(ш => !!ш.v), факт: ТУР.map(ш => ш.v || "—").join(", ")});
/* Глубина — два релиза (docs/СБОРКА-И-РЕЛИЗ.md): шаги позапрошлой версии удаляют при выпуске
   новой. Проверяем не конкретные номера, а что разных версий в туре не больше двух. */
t.push({имя: "в туре не больше двух версий — глубина соблюдена",
        ок: new Set(ТУР.map(ш => ш.v)).size <= 2,
        факт: "версии: " + [...new Set(ТУР.map(ш => ш.v))].join(", ")});
/* Стрелка-хвостик ЖИВЁТ ВНЕ прокручиваемого слоя (.tour-pop-inner) — если её случайно вернут
   внутрь при правке разметки, overflow:auto там же снова обрежет её молча (баг, из-за которого
   КРОЛИК прислал скриншот шага «что горит» без стрелки вовсе). */
t.push({имя: "хвостик-стрелка не внутри прокручиваемого слоя (иначе снова обрежется)",
        ок: !!p0.querySelector(":scope > .tour-tail"),
        факт: "прямой потомок .tour-pop: " + !!p0.querySelector(":scope > .tour-tail")});
/* ОТМЕТКА ОБЯЗАНА ВСТАТЬ УЖЕ НА ПОКАЗЕ, а не при закрытии изнутри: самый обычный исход —
   человек увидел и закрыл ОКНО, не нажимая ничего. Поймано на живой сборке: подсказка открыта,
   а в файле лежит tourSeen: null, и следующий запуск встречал бы тем же самым. */
t.push({имя: "отметка встаёт сразу при показе, не дожидаясь закрытия", ок: S.settings.tourSeen === ТУР_ID,
        факт: "показ идёт, в настройках " + JSON.stringify(S.settings.tourSeen)});

/* ================== ШАГ 1: ПОДГРАФ, БЕЗ ЦЕЛИ ==================
   Состав тура меняется каждый релиз (глубина — два выпуска, см. docs/СБОРКА-И-РЕЛИЗ.md), и
   проверки идут ПО ПОРЯДКУ шагов, а не по номерам версий: так их правят вместе с самим туром,
   а не ищут потом, почему сценарий рассыпался. */
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop");
  t.push({имя: "второй шаг — про подграф, с иллюстрацией «нода → её содержимое»",
          ок: /подграф/i.test(p.querySelector(".tour-head b").textContent) && !!p.querySelector(".tm-sub-hex"),
          факт: "заголовок «" + p.querySelector(".tour-head b").textContent + "», шестиугольник: " + !!p.querySelector(".tm-sub-hex")});
}

/* ================== ШАГ 2: СТРЕЛКА НА КНОПКУ ИИ ==================
   Единственный шаг релиза с целью. Он же ловит целый класс поломок: цель ищется сразу после
   before(), и если узел ещё не в DOM — выноска молча уезжает в центр экрана и показывает
   «непонятно куда» (КРОЛИК прислал снимок именно этого шага). */
document.querySelector("#tour-next").click(); await ж(240); доиграть();
{
  const p = document.querySelector("#tour-pop"), ц = document.querySelector("#g-ai");
  t.push({имя: "кнопка ИИ есть на холсте графа", ок: !!ц, факт: ц ? "#g-ai найдена" : "#g-ai НЕТ в DOM"});
  t.push({имя: "шаг про нейросети подсвечивает саму кнопку", ок: !!ц && ц.classList.contains("tour-lit"),
          факт: ц ? "подсвечена: " + ц.classList.contains("tour-lit") : "кнопки нет на экране"});
  t.push({имя: "выноска не по центру — цель нашлась", ок: !p.classList.contains("mid"),
          факт: "класс mid: " + p.classList.contains("mid")});
  if (ц) {
    const rc = ц.getBoundingClientRect(), rp = p.getBoundingClientRect();
    const хв = p.querySelector(".tour-tail").getBoundingClientRect();
    t.push({имя: "стрелка смотрит ровно на кнопку",
            ок: Math.abs((хв.left + хв.width / 2) - (rc.left + rc.width / 2)) < 4,
            факт: "хвост " + Math.round(хв.left + хв.width / 2) + ", центр кнопки " + Math.round(rc.left + rc.width / 2)});
    /* «Рядом» требуем, только если карточка вообще помещается: на низком окне выноска выше
       самого экрана прижимается к кромке, и требовать от неё соседства с целью бессмысленно.
       Зато «не вылезает за окно» обязательно всегда — ради этого ограничение и заведено. */
    const влезает = rp.height + 40 < innerHeight;
    /* Проверяем ДВА свойства, которые ломаются молча: выноска видна целиком и стоит вплотную
       к цели — сверху или снизу, это решает наличие места и обе стороны законны. Требовать
       именно «снизу» нельзя: у цели под самой кромкой окна места там нет. */
    const рядом = Math.min(Math.abs(rp.top - rc.bottom), Math.abs(rc.top - rp.bottom)) < 40;
    t.push({имя: "выноска целиком в окне и вплотную к цели",
            ок: rp.left >= 0 && rp.right <= innerWidth && rp.top >= 0 && rp.bottom <= innerHeight && рядом,
            факт: "снизу " + Math.round(rp.top - rc.bottom) + ", сверху " + Math.round(rc.top - rp.bottom) +
                  ", выноска " + Math.round(rp.top) + ".." + Math.round(rp.bottom) + " при окне " + innerHeight});
  }
  /* НЕВИДИМАЯ ЦЕЛЬ — НЕ ЦЕЛЬ. Узел может НАЙТИСЬ и при этом ничего не значить для человека:
     скрыт, нулевого размера или уехал за кромку окна. Прямоугольник тогда из нулей, и выноска
     вставала «вплотную» к точке (0,0) — стрелкой в угол, где ничего нет. Прячем кнопку и
     требуем, чтобы тур честно перешёл в режим «без цели»: по центру и без хвостика. */
  if (ц) {
    const было = ц.style.display;
    ц.style.display = "none";
    turPlace();
    const rp = p.getBoundingClientRect();
    const хвост = p.querySelector(".tour-tail");
    t.push({имя: "скрытая цель не уводит выноску в угол — встаёт по центру",
            ок: p.classList.contains("mid") && Math.abs((rp.left + rp.width / 2) - innerWidth / 2) < 3 &&
                getComputedStyle(хвост).display === "none",
            факт: "mid: " + p.classList.contains("mid") + ", центр выноски " + Math.round(rp.left + rp.width / 2) +
                  " при центре окна " + Math.round(innerWidth / 2) + ", хвостик " + getComputedStyle(хвост).display});
    ц.style.display = было;
    turPlace();
  }
}

// ================== ШАГ 3: СХЕМА НА ПОЛОТНЕ ОТ НЕЙРОСЕТИ ==================
// Своя новинка релиза (операция draw), а не подстрочник к шагу про нейросети: у неё свой
// результат на экране — схема на доске, — и в заметках к релизу она отдельным разделом.
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop");
  t.push({имя: "шаг про схему на полотне — с иллюстрацией «нейросеть → схема»",
          ок: /схем/i.test(p.querySelector(".tour-head b").textContent) && !!p.querySelector(".tm-ag-box") &&
              !!p.querySelector(".tour-mock svg polygon"),
          факт: "заголовок «" + p.querySelector(".tour-head b").textContent + "», блоки схемы: " +
                p.querySelectorAll(".tour-mock svg rect").length + ", развилка: " + !!p.querySelector(".tour-mock svg polygon")});
}

/* ================== ШАГ 4: ИИ-АГЕНТ ==================
   Отдельный шаг, а не строка в шаге про нейросети: агент — своя дорога (MCP, доступ по ключу,
   правки без копипаста), и в заметках к релизу он тоже отдельным разделом. */
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop");
  t.push({имя: "шаг про ИИ-агента со схемой «агент ↔ граф»",
          ок: /агент/i.test(p.querySelector(".tour-head b").textContent) && !!p.querySelector(".tm-ag-box"),
          факт: "заголовок «" + p.querySelector(".tour-head b").textContent + "», схема: " + !!p.querySelector(".tm-ag-box")});
}

// ================== ШАГ 5: УПОРЯДОЧИВАНИЕ, СРАВНЕНИЕ «БЫЛО — СТАЛО» ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop");
  t.push({имя: "шаг про упорядочивание показывает сравнение до/после",
          ок: /упорядоч/i.test(p.querySelector(".tour-head b").textContent) &&
              p.querySelectorAll(".tm-tidy-one").length === 2,
          факт: "заголовок «" + p.querySelector(".tour-head b").textContent + "», половин сравнения: " +
                p.querySelectorAll(".tm-tidy-one").length});
}

// ================== ШАГ 6: ОТКАТ РАСКЛАДКИ, ПОСЛЕДНИЙ ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
const последняя = document.querySelector("#tour-pop #tour-next").textContent;
t.push({имя: "последний шаг — про откат раскладки, кнопка «Понятно»",
        ок: /ctrl\+z|раскладк/i.test(document.querySelector(".tour-head b").textContent) && последняя === "Понятно",
        факт: "заголовок «" + document.querySelector(".tour-head b").textContent + "», кнопка «" + последняя + "»"});
document.querySelector("#tour-next").click(); await ж(150);
t.push({имя: "«Понятно» закрывает тур", ок: последняя === "Понятно" && !document.querySelector("#tour-pop"),
        факт: "кнопка «" + последняя + "», выноска убрана: " + !document.querySelector("#tour-pop")});
t.push({имя: "подсветка кнопки снимается вместе с туром", ок: document.querySelectorAll(".tour-lit").length === 0,
        факт: "подсвеченных узлов осталось " + document.querySelectorAll(".tour-lit").length});
t.push({имя: "тур помечает себя просмотренным", ок: S.settings.tourSeen === ТУР_ID,
        факт: "в настройках " + JSON.stringify(S.settings.tourSeen)});
t.push({имя: "и больше не показывается", ок: turMaybeShow() === false,
        факт: "повторный вызов вернул отказ"});

// ================== ЗАКРЫТИЕ КРЕСТИКОМ ТОЖЕ СЧИТАЕТСЯ ==================
/* Иначе тур встречал бы человека каждый запуск: закрыть его крестиком — самый вероятный
   способ, и он обязан значить «понял, больше не показывай», а не «покажи ещё раз завтра». */
S.settings.tourSeen = null;
turStep(0); await ж(150);
document.querySelector("#tour-x").click(); await ж(100);
t.push({имя: "крестик закрывает и запоминает", ок: S.settings.tourSeen === ТУР_ID && !document.querySelector("#tour-pop"),
        факт: "отметка " + JSON.stringify(S.settings.tourSeen)});

// ================== ESC ==================
S.settings.tourSeen = null;
turStep(0); await ж(150);
document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape", bubbles: true, cancelable: true}));
await ж(100);
t.push({имя: "Escape закрывает и запоминает", ок: S.settings.tourSeen === ТУР_ID && !document.querySelector("#tour-pop"),
        факт: "отметка " + JSON.stringify(S.settings.tourSeen)});

// ================== ОТКРЫТЬ ЗАНОВО РУКАМИ ==================
/* Тур сам показывается ОДИН раз, и без этого пункта посмотреть его второй раз можно было
   только правкой файла данных — на это КРОЛИК и наткнулся сразу же. */
{
  turDone();
  document.querySelector("#g-more").click(); await ж(80);
  const пункт = document.querySelector("#g-tour");
  t.push({имя: "в меню «Ещё» есть пункт открыть тур", ок: !!пункт,
          факт: пункт ? "«" + пункт.textContent.trim() + "»" : "пункта нет"});
  if (пункт) { пункт.click(); await ж(200); }
  t.push({имя: "пункт открывает тур с первого шага",
          ок: !!document.querySelector("#tour-pop") &&
              document.querySelector(".tour-head b").textContent === ТУР[0].ttl,
          факт: "выноска: " + !!document.querySelector("#tour-pop") + ", заголовок: «" +
                (document.querySelector(".tour-head b") || {}).textContent + "»"});
  t.push({имя: "и меню при этом закрывается",
          ок: document.querySelector("#g-more-menu").style.display === "none",
          факт: "меню: " + (document.querySelector("#g-more-menu").style.display || "видно")});
}

/* ================== СЛОЁНЫЙ ТУР ==================
   Обновившийся с прошлой версии не должен заново листать то, что уже читал, а пришедший
   с более старой — обязан увидеть всё. Отдельно держим сравнение версий: строкой "2.0.10"
   меньше "2.0.9", и на десятом патче тур молча перестал бы показываться. */
{
  turDone();
  const всего = ТУР.length, новых = ТУР.filter(ш => ш.v === ТУР_ID).length;

  // «прошлая версия» — та, что реально лежит в туре, а не зашитый номер: состав меняется
  // каждый релиз, и проверка на конкретных цифрах падала бы при каждом выпуске
  S.settings.tourSeen = [...new Set(ТУР.map(ш => ш.v))].filter(v => v !== ТУР_ID)[0] || ТУР_ID;
  const сПрошлой = turNewSteps();
  t.push({имя:"обновился с прошлой версии — только новые шаги",
          ок: сПрошлой.length === новых && сПрошлой.every(ш => ш.v === ТУР_ID),
          факт: "показали " + сПрошлой.length + " из " + всего + " (новых в релизе " + новых + ")"});

  S.settings.tourSeen = "2.0.4";
  t.push({имя:"обновился с более старой — тур целиком",
          ок: turNewSteps().length === всего,
          факт: "показали " + turNewSteps().length + " из " + всего});

  S.settings.tourSeen = ТУР_ID;
  t.push({имя:"уже видел эту версию — плашка молчит",
          ок: turNewSteps().length === 0 && turMaybeShow() === false,
          факт: "новых шагов " + turNewSteps().length});

  t.push({имя:"версии сравниваются числами, а не строками",
          ок: turVerNewer("2.0.10","2.0.9") && !turVerNewer("2.0.9","2.0.10")
              && turVerNewer("2.0.5.1","2.0.5") && !turVerNewer("2.0.5","2.0.5.1")
              && turVerNewer("2.0.5", null),
          факт: '"2.0.10">"2.0.9": ' + turVerNewer("2.0.10","2.0.9")
              + ', "2.0.5.1">"2.0.5": ' + turVerNewer("2.0.5.1","2.0.5")});

  // из меню «Что нового» человек лезет сам — там тур обязан быть полным, даже если отметка свежая
  /* ЖИВОЙ ПУТЬ, а не только фильтр: плашка → кнопка. Плашка ставит отметку в момент показа,
     поэтому список новых обязан замереть ДО этого — иначе к клику новых уже ноль, и тур
     показывает всё подряд. Ровно так оно и сломалось при первой проверке КРОЛИКОМ. */
  // ПОРЯДОК: turDone сам ставит отметку «просмотрено», поэтому убираемся ДО того, как задать её
  turDone(); document.querySelectorAll("#tour-banner").forEach(n => n.remove());
  // «прошлая версия» — та, что реально лежит в туре, а не зашитый номер: состав меняется
  // каждый релиз, и проверка на конкретных цифрах падала бы при каждом выпуске
  S.settings.tourSeen = [...new Set(ТУР.map(ш => ш.v))].filter(v => v !== ТУР_ID)[0] || ТУР_ID;
  turBanner(); await ж(120);
  document.querySelector("#tb-go").click(); await ж(200); доиграть();
  const точекПослеПлашки = document.querySelectorAll(".tour-dots i").length;
  const заголовок = (document.querySelector(".tour-head b") || {}).textContent || "";
  turDone();
  t.push({имя:"плашка → кнопка: показан только новый шаг, а не весь тур",
          ок: точекПослеПлашки === новых &&
              заголовок === (ТУР.find(ш => ш.v === ТУР_ID) || {}).ttl,
          факт: "шагов в туре " + точекПослеПлашки + " (ждали " + новых + "), заголовок «" + заголовок + "»"});

  S.settings.tourSeen = ТУР_ID;
  turOpen(true);
  const точек = document.querySelectorAll(".tour-dots i").length;
  turDone();
  t.push({имя:"меню «Что нового» открывает весь тур, а не только новинки",
          ок: точек === всего, факт: "точек в шкале " + точек + " из " + всего});
}

/* ================== ЦЕЛИ ШАГОВ СУЩЕСТВУЮТ ==================
   Шаг с `цель` подсвечивает живой узел и показывает на него выноской. Не нашёлся селектор —
   выноска молча падает в центр экрана и указывает «непонятно куда» (КРОЛИК, снимок шага про
   нейросети). Проверяем не текст, а факт: подготовили шаг его же before() и ищем цель.  */
{
  const сЦелью = ТУР.filter(ш => ш.цель);
  t.push({имя: "в туре есть шаги с целью", ок: сЦелью.length > 0, факт: "шагов с целью: " + сЦелью.length});
  for (const ш of сЦелью) {
    if (ш.before) { try { ш.before(); } catch (e) {} }
    await ж(120);
    const узел = document.querySelector(ш.цель);
    t.push({имя: "цель шага «" + ш.ttl + "» есть на экране", ок: !!узел, факт: ш.цель});
    if (узел) {
      const r = узел.getBoundingClientRect();
      t.push({имя: "у цели «" + ш.цель + "» ненулевой размер", ок: r.width > 0 && r.height > 0,
              факт: Math.round(r.width) + "x" + Math.round(r.height) + " в (" + Math.round(r.left) + "," + Math.round(r.top) + ")"});
    }
  }
}

// ================== УБОРКА ==================
turDone();
S.settings.tourSeen = _былаОтметка || ТУР_ID;   // не оставляем тур «непоказанным» соседним сценариям
render(); await ж(150);
return t;
