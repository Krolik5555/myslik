/* ТУР «ЧТО НОВОГО» — показывается РОВНО ОДИН РАЗ на версию, после обновления.
   Цена ошибки тут выше обычного: тур всплывает поверх интерфейса на старте, и если отметка
   о просмотре не встанет, он будет встречать человека каждый запуск. Второй способ ошибиться —
   показать его тому, кто ставит приложение впервые: рассказывать «что изменилось» человеку,
   который прежней версии не видел, незачем. Проверяем оба конца. */
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
          ок: !!пл && /Держать раскладку/.test(пл.textContent) && !!document.querySelector("#tb-go"),
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

// ================== ПОКАЗ И ШАГИ ==================
const p0 = document.querySelector("#tour-pop");
t.push({имя: "тур открывается и знает свои шаги", ок: !!p0 && p0.querySelectorAll(".tour-dots i").length === ТУР.length,
        факт: p0 ? "шагов " + ТУР.length + ", заголовок «" + p0.querySelector(".tour-head b").textContent + "»" : "выноски нет"});
{
  const r = p0.getBoundingClientRect();
  t.push({имя: "шаг без цели встаёт по центру окна",
          ок: Math.abs((r.left + r.width / 2) - innerWidth / 2) < 3 && r.left >= 0 && r.right <= innerWidth,
          факт: "центр выноски " + Math.round(r.left + r.width / 2) + " при центре окна " + Math.round(innerWidth / 2)});
}
/* СРАВНЕНИЕ — две НАСТОЯЩИЕ записи графа. Проверяем не «есть ли разметка», а то, от чего
   зависит смысл: клипы разные, они реально ИДУТ (без autoplay/muted Chromium их не запустит,
   и человек увидит два стоп-кадра), и окошки не ужаты до почтовых марок. */
{
  const окошки = p0.querySelectorAll(".tour-demo .td-one");
  const видео = [...p0.querySelectorAll(".tour-demo video")];
  t.push({имя: "в подсказке два окошка со сравнением", ок: окошки.length === 2,
          факт: "окошек " + окошки.length + ", подписи: " +
                [...p0.querySelectorAll(".td-lbl")].map(n => "«" + n.textContent + "»").join(" и ")});
  t.push({имя: "в окошках разные записи", ок: видео.length === 2 &&
            видео[0].getAttribute("src") !== видео[1].getAttribute("src"),
          факт: видео.map(v => v.getAttribute("src")).join(" и ")});
  t.push({имя: "записи зациклены и без звука (иначе автозапуск не сработает)",
          ок: видео.every(v => v.loop && v.muted && v.autoplay),
          факт: видео.map(v => "loop=" + v.loop + " muted=" + v.muted + " autoplay=" + v.autoplay).join(" · ")});
  // даём кадрам пойти и смотрим, что время реально идёт, а не стоит на нуле
  await ж(900);
  const идут = видео.filter(v => v.currentTime > 0 && !v.error).length;
  t.push({имя: "записи играют, а не висят стоп-кадром", ок: идут === 2,
          факт: видео.map(v => v.error ? "ОШИБКА " + v.error.code : v.currentTime.toFixed(2) + " с").join(" и ")});
  const сцена1 = окошки[0].getBoundingClientRect(), окно = p0.getBoundingClientRect();
  /* Порог не от балды: при 208 px отдельные ноды в записи было не разглядеть (КРОЛИК прислал
     снимок с «окошко больше надо»). 300 — та ширина, на которой подписи нод уже читаются. */
  t.push({имя: "окошки не ужаты", ок: сцена1.width >= 300 && сцена1.height >= 200,
          факт: "окошко " + Math.round(сцена1.width) + "×" + Math.round(сцена1.height) +
                " в подсказке шириной " + Math.round(окно.width)});
  t.push({имя: "сравнение не трогает граф человека", ок: p0.querySelectorAll("#graph").length === 0,
          факт: "внутри подсказки узлов настоящего графа нет"});
}

/* ОТМЕТКА ОБЯЗАНА ВСТАТЬ УЖЕ НА ПОКАЗЕ, а не при закрытии изнутри: самый обычный исход —
   человек увидел и закрыл ОКНО, не нажимая ничего. Поймано на живой сборке: подсказка открыта,
   а в файле лежит tourSeen: null, и следующий запуск встречал бы тем же самым. */
t.push({имя: "отметка встаёт сразу при показе, не дожидаясь закрытия", ок: S.settings.tourSeen === ТУР_ID,
        факт: "показ идёт, в настройках " + JSON.stringify(S.settings.tourSeen)});

// ================== ШАГ СО СТРЕЛКОЙ НА ДОМИК ==================
document.querySelector("#tour-next").click(); await ж(200); доиграть();
{
  const p = document.querySelector("#tour-pop"), ц = document.querySelector("#g-home");
  const rc = ц ? ц.getBoundingClientRect() : null, rp = p.getBoundingClientRect();
  const хв = p.querySelector(".tour-tail").getBoundingClientRect();
  t.push({имя: "шаг про дом подсвечивает саму кнопку", ок: !!ц && ц.classList.contains("tour-lit"),
          факт: ц ? "кнопка #g-home подсвечена: " + ц.classList.contains("tour-lit") : "кнопки нет на экране"});
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
}

// ================== ЗАВЕРШЕНИЕ И ОТМЕТКА ==================
const последняя = document.querySelector("#tour-pop #tour-next").textContent;
t.push({имя: "на шаге про кнопку есть «Включить сейчас»", ок: !!document.querySelector("#tour-do"),
        факт: "кнопка действия: " + (document.querySelector("#tour-do") || {}).textContent});
document.querySelector("#tour-next").click(); await ж(150);
t.push({имя: "последний шаг закрывает тур", ок: последняя === "Понятно" && !document.querySelector("#tour-pop"),
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
          ок: !!document.querySelector("#tour-pop") && !!document.querySelector(".tour-demo"),
          факт: "выноска: " + !!document.querySelector("#tour-pop") + ", сравнение на месте: " + !!document.querySelector(".tour-demo")});
  t.push({имя: "и меню при этом закрывается",
          ок: document.querySelector("#g-more-menu").style.display === "none",
          факт: "меню: " + (document.querySelector("#g-more-menu").style.display || "видно")});
}

// ================== УБОРКА ==================
turDone();
S.settings.tourSeen = _былаОтметка || ТУР_ID;   // не оставляем тур «непоказанным» соседним сценариям
render(); await ж(150);
return t;
