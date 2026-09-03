/* ТУР «ЧТО НОВОГО» — показывается РОВНО ОДИН РАЗ на версию, после обновления.
   Цена ошибки тут выше обычного: тур всплывает поверх интерфейса на старте, и если отметка
   о просмотре не встанет, он будет встречать человека каждый запуск. Второй способ ошибиться —
   показать его тому, кто ставит приложение впервые: рассказывать «что изменилось» человеку,
   который прежней версии не видел, незачем. Проверяем оба конца.

   Сценарий переписан под 2.0.5 (четыре шага: статусы/срок/приоритет, «что горит»,
   напоминание, тост) — старый был жёстко завязан на «Держать раскладку» (текст плашки,
   цель #g-home, демо-сравнение из двух видео). В этом релизе демо нет — готовых записей не
   было, см. main.js — поэтому блок про .tour-demo из старого сценария убран целиком, а не
   адаптирован под пустоту. */
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

// ================== ШАГ 0: СТАТУСЫ, БЕЗ ЦЕЛИ, ПО ЦЕНТРУ ==================
const p0 = document.querySelector("#tour-pop");
t.push({имя: "тур открывается и знает свои шаги (их семь)",
        ок: !!p0 && p0.querySelectorAll(".tour-dots i").length === ТУР.length && ТУР.length === 7,
        факт: p0 ? "шагов " + ТУР.length + ", заголовок «" + p0.querySelector(".tour-head b").textContent + "»" : "выноски нет"});
{
  const r = p0.getBoundingClientRect();
  t.push({имя: "шаг без цели встаёт по центру окна",
          ок: Math.abs((r.left + r.width / 2) - innerWidth / 2) < 3 && r.left >= 0 && r.right <= innerWidth,
          факт: "центр выноски " + Math.round(r.left + r.width / 2) + " при центре окна " + Math.round(innerWidth / 2)});
}
/* Все СЕМЬ статусов (КРОЛИК: «отдельно», «без обмана») — цвет и иконка иду теми же CSS-
   переменными, что и на настоящем графе (--st-wait/--st-next/--st-review), поэтому просто
   проверяем количество кружков и что цвета взяты из переменных, а не с потолка. */
t.push({имя: "первый шаг — про статусы, все семь, с мини-нодой вместо видео",
        ок: !p0.querySelector(".tour-demo") && !p0.classList.contains("wide") &&
            p0.classList.contains("big") && p0.querySelectorAll(".tm-st").length === 7,
        факт: "заголовок «" + p0.querySelector(".tour-head b").textContent + "», .tour-demo: " +
              !!p0.querySelector(".tour-demo") + ", .big: " + p0.classList.contains("big") +
              ", кружков статусов: " + p0.querySelectorAll(".tm-st").length});
/* «Без обмана» проверяем буквально: цвета в разметке — ссылки на var(--st-*), а не подобранные
   на глаз hex-числа. Три статуса со своим цветом — next/wait/review. */
t.push({имя: "цвета статусов — ссылки на переменные темы (--st-next/--st-wait/--st-review), не хардкод",
        ок: p0.innerHTML.includes("var(--st-next)") && p0.innerHTML.includes("var(--st-wait)") &&
            p0.innerHTML.includes("var(--st-review)"),
        факт: "var(--st-next): " + p0.innerHTML.includes("var(--st-next)") +
              ", var(--st-wait): " + p0.innerHTML.includes("var(--st-wait)") +
              ", var(--st-review): " + p0.innerHTML.includes("var(--st-review)")});
/* Стрелка-хвостик ЖИВЁТ ВНЕ прокручиваемого слоя (.tour-pop-inner) — если её случайно вернут
   внутрь при правке разметки, overflow:auto там же снова обрежет её молча (баг, из-за которого
   КРОЛИК прислал скриншот шага «что горит» без стрелки вовсе). Проверяем структуру прямо тут,
   на шаге без цели, где сам хвостик skрыт (.mid), — достаточно того, что он НЕ внутри inner. */
t.push({имя: "хвостик-стрелка не внутри прокручиваемого слоя (иначе снова обрежется)",
        ок: !!p0.querySelector(":scope > .tour-tail"),
        факт: "прямой потомок .tour-pop: " + !!p0.querySelector(":scope > .tour-tail")});

/* ОТМЕТКА ОБЯЗАНА ВСТАТЬ УЖЕ НА ПОКАЗЕ, а не при закрытии изнутри: самый обычный исход —
   человек увидел и закрыл ОКНО, не нажимая ничего. Поймано на живой сборке: подсказка открыта,
   а в файле лежит tourSeen: null, и следующий запуск встречал бы тем же самым. */
t.push({имя: "отметка встаёт сразу при показе, не дожидаясь закрытия", ок: S.settings.tourSeen === ТУР_ID,
        факт: "показ идёт, в настройках " + JSON.stringify(S.settings.tourSeen)});

// ================== ШАГ 1: СРОК И ПРИОРИТЕТ, БЕЗ ЦЕЛИ ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop");
  t.push({имя: "второй шаг — про срок и приоритет, с мини-нодой (дужка+цифра)",
          ок: p.classList.contains("mid") && p.classList.contains("big") && !!p.querySelector(".tm-node .tm-arc"),
          факт: "заголовок «" + p.querySelector(".tour-head b").textContent + "», дужка: " + !!p.querySelector(".tm-arc")});
}

// ================== ШАГ 2: СТРЕЛКА НА «ЧТО ГОРИТ» ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop"), ц = document.querySelector("#g-heat");
  const rc = ц ? ц.getBoundingClientRect() : null, rp = p.getBoundingClientRect();
  const хв = p.querySelector(".tour-tail").getBoundingClientRect();
  t.push({имя: "шаг про «что горит» подсвечивает саму кнопку", ок: !!ц && ц.classList.contains("tour-lit"),
          факт: ц ? "кнопка #g-heat подсвечена: " + ц.classList.contains("tour-lit") : "кнопки нет на экране"});
  /* Хвостик — это и есть «стрелочка показывает на кнопку». Мимо он смотрел, пока выноска
     позиционировалась через transform: доигрывающий перевод складывался с новой позицией. */
  t.push({имя: "стрелка смотрит ровно на кнопку",
          ок: !!rc && Math.abs((хв.left + хв.width / 2) - (rc.left + rc.width / 2)) < 4,
          факт: rc ? "хвост " + Math.round(хв.left + хв.width / 2) + ", центр кнопки " + Math.round(rc.left + rc.width / 2) : "—"});
  t.push({имя: "выноска стоит под кнопкой и не вылезает за окно",
          ок: !!rc && rp.top > rc.bottom && rp.top - rc.bottom < 30 &&
              rp.left >= 0 && rp.right <= innerWidth && rp.bottom <= innerHeight,
          факт: rc ? "зазор " + Math.round(rp.top - rc.bottom) + " px, в окне: " +
                     (rp.left >= 0 && rp.right <= innerWidth && rp.bottom <= innerHeight) : "—"});
  t.push({имя: "на шаге про «что горит» — три уровня двойного контура", ок: p.querySelectorAll(".tm-heat-one").length === 3,
          факт: "уровней жара в иллюстрации: " + p.querySelectorAll(".tm-heat-one").length});
  // текст упоминает номер очереди — КРОЛИК заметил, что раньше это не было видно на самой картинке
  t.push({имя: "номер очереди виден на самой иллюстрации, не только в тексте", ок: !!p.querySelector(".tm-heat-rank"),
          факт: "плашка ранга: " + (p.querySelector(".tm-heat-rank") || {}).textContent});
}

// ================== ШАГ 3: СТРЕЛКА НА КНОПКУ НАПОМИНАНИЯ ==================
/* Цель — кнопка внутри правой панели (.event-ctl [data-eventpick]), а не тулбара: у нее нет
   готового id, панель появляется только когда что-то выбрано — ровно это и делает before()
   у самого шага (см. ТУР в main.js), здесь просто проверяем итог. */
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop"), ц = document.querySelector(".event-ctl [data-eventpick]");
  t.push({имя: "шаг про напоминание находит и подсвечивает кнопку в панели", ок: !!ц && ц.classList.contains("tour-lit"),
          факт: ц ? "кнопка напоминания на экране, подсвечена: " + ц.classList.contains("tour-lit") : "кнопки нет — before() не выбрал ноду?"});
  t.push({имя: "выноска не по центру — цель нашлась", ок: !p.classList.contains("mid"),
          факт: "класс mid: " + p.classList.contains("mid")});
}

// ================== ШАГ 4: ТОСТ, БЕЗ ЦЕЛИ ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
t.push({имя: "шаг про тост несёт копию тоста вместо видео",
        ок: /уведомлен/i.test(document.querySelector(".tour-head b").textContent) &&
            !!document.querySelector("#tour-pop .tm-toast-card") &&
            document.querySelector("#tour-pop #tour-next").textContent === "Дальше",
        факт: "заголовок «" + document.querySelector(".tour-head b").textContent + "», копия тоста: " +
              !!document.querySelector("#tour-pop .tm-toast-card")});

// ================== ШАГ 5: ГРУППОВОЕ ПЕРЕТАСКИВАНИЕ ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
t.push({имя: "шаг про перетаскивание группы на месте",
        ок: /тащи всё|перетаск/i.test(document.querySelector(".tour-head b").textContent),
        факт: "заголовок «" + document.querySelector(".tour-head b").textContent + "»"});

// ================== ШАГ 6: КОПИЯ ЖЕСТОМ, ПОСЛЕДНИЙ ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
const последняя = document.querySelector("#tour-pop #tour-next").textContent;
t.push({имя: "последний шаг — про копию жестом, кнопка «Понятно»",
        ок: /копи/i.test(document.querySelector(".tour-head b").textContent) && последняя === "Понятно",
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

  S.settings.tourSeen = "2.0.5.1";
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
  S.settings.tourSeen = "2.0.5.1";
  turBanner(); await ж(120);
  document.querySelector("#tb-go").click(); await ж(200); доиграть();
  const точекПослеПлашки = document.querySelectorAll(".tour-dots i").length;
  const заголовок = (document.querySelector(".tour-head b") || {}).textContent || "";
  turDone();
  t.push({имя:"плашка → кнопка: показан только новый шаг, а не весь тур",
          ок: точекПослеПлашки === новых && /копи/i.test(заголовок),
          факт: "шагов в туре " + точекПослеПлашки + " (ждали " + новых + "), заголовок «" + заголовок + "»"});

  S.settings.tourSeen = ТУР_ID;
  turOpen(true);
  const точек = document.querySelectorAll(".tour-dots i").length;
  turDone();
  t.push({имя:"меню «Что нового» открывает весь тур, а не только новинки",
          ок: точек === всего, факт: "точек в шкале " + точек + " из " + всего});
}

// ================== УБОРКА ==================
turDone();
S.settings.tourSeen = _былаОтметка || ТУР_ID;   // не оставляем тур «непоказанным» соседним сценариям
render(); await ж(150);
return t;
