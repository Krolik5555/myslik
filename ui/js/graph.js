"use strict";
/* ===========================================================
   NOTES GRAPH
   =========================================================== */
let graph=null;
/* Камера — СЛОВАРЬ по id графа (переживает пересоздание Graph при каждом render() → нет рывка
   вьюпорта при создании ноды/связи), а не одна на всё приложение: иначе переключение графов
   уносило бы камеру графа A на граф B, и человек терял ноды из вида (см. Graph.constructor). */
let graphCam={};
let graphClip=null;  // буфер копирования нод (Ctrl+C/V в графе)
/* ВЫКЛЮЧАТЕЛЬ ДИАГНОСТИКИ ДРОЖИ. Живёт на уровне модуля, а не на объекте графа: Graph
   пересоздаётся на каждый render(), и флаг на экземпляре гас бы от любого перехода по вкладкам
   ровно в тот момент, когда замер идёт. Включать из консоли DevTools (debug.bat): дрожь().
   По умолчанию выключен — замер стоит вызова функции на каждую силу каждой ноды. */
/* Часы «дыхания» нод: идут только пока граф рисует кадры (см. _tick). На уровне модуля, потому
   что Graph пересоздаётся на каждый render(), а дыхание должно продолжаться, а не начинаться
   заново — иначе ноды прыгают при каждой перерисовке. */
let graphDriftClock=0, graphDriftStamp=null;
let graphBgPan={x:0, y:0};   // сдвиг параллакса звёздного поля — тоже переживает пересоздание Graph
/* Пауза между кадрами в ПОКОЕ (мс) — те же ~6 кадров/с, что были раньше через счётчик пропусков.
   Теперь это настоящий сон таймером, а не «проснуться и ничего не сделать»: на 165-герцевом
   мониторе прежний счётчик будил поток 165 раз в секунду, чтобы 159 раз выйти сразу же. */
const ПОКОЙ_МС=160;
/* ОХЛАЖДЕНИЕ КАМЕРЫ (мс) — правка по жалобе КРОЛИКА: «двигаюсь мелкими прерывистыми скачками —
   фризы; непрерывно держу кнопку — гладко». Причина в том, что у панорамы, в отличие от драга
   ноды (поднимает alpha, остывает секундами) и зума (едет по инерции ещё ~6 кадров после щелчка,
   см. _zoomTo), НЕТ вообще никакого запаса: tx/ty идут 1:1 за курсором, camMoving гаснет в тот же
   кадр, когда курсор перестал двигаться, и условие покоя ниже срабатывает буквально на следующем
   тике. При мелких скачках это холодный старт полного кадра на КАЖДУЮ протяжку, а не продолжение
   уже разогретого цикла — отсюда и «фриз» именно на прерывистом жесте. Задаёт метку _applyTransform
   (общая точка и для пана, и для доезда зума), проверяет — условие покоя в _tick. */
const КАМЕРА_ОСТЫВАНИЕ_МС=250;
let _дрожьВкл=false;
/* Второй режим — писать отчёт в ФАЙЛ рядом с приложением (`дрожь-отчёт.txt`). Он и есть
   основной: панель разработчика с консолью — лишний барьер, а замер нужен целиком и текстом.
   Включается сам при старте, если запущен debug-дрожь.bat (см. shake_mode в app.py). */
let _дрожьВФайл=false;
window.дрожь=(on, вФайл)=>{
  _дрожьВкл = (on===undefined) ? !_дрожьВкл : !!on;
  if(вФайл!==undefined) _дрожьВФайл=!!вФайл;
  if(!_дрожьВкл) _дрожьВФайл=false;
  if(graph) graph._dbg = _дрожьВкл ? graph._dbgNew() : null;
  return _дрожьВкл
    ? "Диагностика дрожи ВКЛЮЧЕНА"+(_дрожьВФайл?" (отчёт идёт и в файл дрожь-отчёт.txt)":"")+". Возьми ноду мышью и подведи её связь к другой ноде — отчёт печатается раз в секунду, пока держишь, и ещё раз при отпускании. Выключить: дрожь()"
    : "Диагностика дрожи выключена.";
};
/* Фаза «дыхания» ноды — детерминированно из её id, число в [0,1). FNV-1a + финальное
   лавинное перемешивание (fmix32 из murmur3). Перемешивание тут не украшение: все id
   вида Date.now()+random (core.js) делят общий 8-символьный префикс-таймстамп, и хеш
   без него дал бы соседним нодам близкие фазы — граф задышал бы синхронно, а не вразнобой.
   Math.imul обязателен: обычное умножение уйдёт в double и потеряет младшие биты. */
/* Запас области захвата ноды, мировые единицы. Прибавляется к габариту формы, поэтому у ноды
   любого размера кайма одинаково широкая — доля от размера оставляла мелкие ноды (0.4×)
   непопадаемыми, то есть не помогала там, где нужнее всего.
   Больше ~8 не ставить: каймы соседних нод начнут перекрываться, а связь у самого конца
   станет некликабельной (её собственный хитбокс — 14 px по толщине). */
/* ДОМ НОДЫ («Держать раскладку», S.settings.graphHome). Три числа, все три — про физику,
   поэтому лежат вместе, а не разбросаны по _tick:
     ДОМ_СИЛА  — жёсткость домашней пружины. 0.02 при трении 0.74 даёт КРИТИЧЕСКОЕ демпфирование
                 дискретной пружины: подход к дому без перелёта, постоянная времени ~13 кадров.
                 Выше — звон, ниже — нода не доезжает за время остывания alpha.
     ДОМ_ПОРОГ — с какого отклонения кадр считается занятым (px). Полпикселя на экране не видно,
                 а держать ради него цикл кадров живым — плата в три полноэкранных слоя.
     ДОМ_ALPHA — нижняя планка alpha, пока ноды ЕЩЁ ЕДУТ домой. Домашняя пружина живёт только
                 при alpha>0, а alpha остывает за ~6 с — без планки нода замирала бы на полпути.
   ЧТО ПРОБОВАЛ ВМЕСТО ЭТОГО И ОТКАТИЛ (2026-08-25) — не повторять без просьбы КРОЛИКА.
   Пружина БЕЗ множителя alpha (k=0.05…2.0) плюс возврат всех раскладочных сил нодам с домом.
   Замыслом было оживить дерево: раскладочные силы гаснут с alpha, дом — нет, значит последнее
   слово всё равно за домом. По числам выходило хорошо (перетекание 87 кадров, свобода графа
   две трети от эталона, невязка не копится), а вживую КРОЛИК получил обратное тому, что нужно:
   сперва «дёргаются как приклеенные и весь граф напрягается», затем — на мягкой пружине —
   «тяну ноду, всё шароебится и плавает сильно». Причина видна из той же арифметики: при мягкой
   пружине отклонение под нагрузкой равно сила/k, то есть десятки пикселей на КАЖДУЮ ноду разом.
   Форма, которая плавает на десятки пикселей, пока ведёшь рукой, — не форма. */
const ДОМ_СИЛА=0.02, ДОМ_ПОРОГ=0.5, ДОМ_ALPHA=0.12;
const HIT_PAD=5;
const _phase=s=>{ let h=2166136261>>>0;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  h^=h>>>15; h=Math.imul(h,2246822507)>>>0; h^=h>>>13; h=Math.imul(h,3266489909)>>>0; h^=h>>>16;
  return (h>>>0)/4294967296; };
/* фон паутины «Точечное поле» (canvas): точки рисует Graph._drawBg() каждый кадр,
   привязано к настоящему пану/зуму (this.tx/ty/zoom), бесшовно по мировому индексу тайла. */
/* ХЛЕБНЫЕ КРОШКИ ПОДГРАФА: «‹ Мой граф › Проект › Этап». Рисуются только внутри подграфа —
   на обычном графе крошка из одного корня ничего не сообщала бы, а место в тулбаре заняла.
   Путь считает graphChain (core.js): он же знает, какая нода в какой граф ведёт. */
function subCrumbsHtml(){
  const цепь=(typeof graphChain==="function")?graphChain():[];
  if(цепь.length<2) return "";
  const шаги=цепь.map((ш,i)=>{
    const последний=(i===цепь.length-1);
    const имя=(ш.item ? (ш.item.title||"").trim() : (ш.graph.name||"").trim()) || (ш.item?"без названия":"граф");
    const зн=ш.item ? kindIcon("sub") : (ш.graph.icon||GRAPH_ICON_DEF);
    return `<button class="g-crumb${последний?" on":""}" ${последний?"disabled":`data-crumb="${esc(ш.graph.id)}"`} title="${esc(имя)}">`+
      `<i class="ti ${esc(зн)}"></i><span>${esc(имя)}</span></button>`;
  }).join(`<i class="ti ti-chevron-right g-crumb-sep"></i>`);
  return `<div class="g-crumbs" id="g-crumbs">`+
    `<button class="btn ghost g-crumb-up" id="g-crumb-up" title="На уровень вверх"><i class="ti ti-corner-left-up"></i></button>`+
    шаги+`</div>`;
}
function subCrumbsWire(){
  const up=$("#g-crumb-up");
  if(up) up.onclick=()=>{ if(subLeave()) render(); };
  /* Клик по крошке — прыжок СРАЗУ на её уровень, а не по одному вверх: из подграфа третьего
     уровня выбираются в корень одним движением. Переход тем же graphSwitch, что и всё
     остальное, — у каждого уровня своя история отката и своя камера. */
  $$("[data-crumb]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.crumb;
    /* Возвращаясь наружу, показываем в панели ноду, ЧЕРЕЗ КОТОРУЮ уходили вглубь: иначе
       выныриваешь в большой граф без единой подсказки, где ты только что был. */
    const цепь=graphChain(); const i=цепь.findIndex(ш=>ш.graph.id===id);
    const метка=(i>=0 && цепь[i+1]) ? (цепь[i+1].item||{}).id : null;
    if(!graphSwitch(id)) return;
    if(метка) asideId=метка;
    render();
  });
}
/* ЛЕГЕНДА СО СЧЁТЧИКАМИ (эталон demo_дизайн.html, вариант A): «Задачи 26 · Заметки 1 · Области 3».
   Голый список видов ничего не сообщал, а счёт отвечает на вопрос «много ли тут всего». Виды,
   которых в графе нет, не показываем. Внутри подграфа областей нет — там залитый кружок это
   КОРЕНЬ, и легенда не обещает «область», которой в этом графе не бывает. */
function graphLegendHtml(){
  const живые = (S.items||[]).filter(it=>!it.deleted && inWeb(it));
  const счёт = k => живые.filter(it=>it.kind===k).length;
  const пункты = [
    ["hub", inSubGraph() ? "Корень" : "Области", inSubGraph() ? 1 : (S.areas||[]).length],
    ["task", "Задачи", счёт("task")], ["note", "Заметки", счёт("note")],
    ["flow", "Полотна", счёт("flow")], ["sub", "Подграфы", счёт("sub")],
  ].filter(п=>п[2] > 0);
  return пункты.map(([к, имя, n])=>`<span><span class="lg-dot ${к}"></span>${имя}<b>${n}</b></span>`).join("");
}
function renderNotes(v){
  recomputeHierarchy();   // иерархия всегда выводится от области (чинит и старые данные)
  head("Заметки", notesMode==="graph"?"Граф связей · тяни узлы · двойной клик = закрепить":"Все заметки карточками",
    // Кнопки Telegram здесь больше нет: функция пока не прижилась и место занимала зря.
    // Сам приём сообщений жив — он в настройках и в палитре команд.
    `<div class="toggle" id="notes-toggle">
       <button data-nm="graph" class="${notesMode==="graph"?"on":""}"><i class="ti ti-affiliate"></i>Граф</button>
       <button data-nm="table" class="${notesMode==="table"?"on":""}"><i class="ti ti-table"></i>Таблица</button>
     </div>`);   // кнопки «Заметка»/«Полотно» убраны — создаём через ПКМ по холсту
  /* «Список» в переключателе заменила ТАБЛИЦА (table.js, аудит 2.1): списком не пользовались.
     Сам список жив — renderNotesList остаётся для notesMode==="list", кнопки к нему нет. */
  if(notesMode==="table"){ if(graph){ const g=graph; graph=null; g.destroy(); } return renderNotesTable(v); }
  if(notesMode==="list"){ if(graph){ const g=graph; graph=null; g.destroy(); } return renderNotesList(v); }
  v.innerHTML=`<div id="graph-wrap">
    <canvas class="graph-bg-canvas"></canvas>
    <canvas class="graph-glow-canvas"></canvas>
    <!-- холст графа: работает вместо SVG-элементов, когда включён режим «canvas» (настройки → Граф) -->
    <canvas class="graph-main-canvas"></canvas>
    <svg id="graph" preserveAspectRatio="xMidYMid meet"></svg>
    <div class="graph-toolbar">
      ${/* ХЛЕБНЫЕ КРОШКИ ПОДГРАФА. Внутри подграфа холст выглядит как обычный граф, и без
           указателя «где я» человек оказывается в пустой паутине, не понимая, куда делись его
           ноды. Крошки стоят В ТУЛБАРЕ, а не отдельной полосой: своя полоса отъела бы высоту
           у холста на КАЖДОМ графе ради состояния, которое бывает не всегда. Наружу — клик по
           любой крошке слева от текущей (стрелка = на уровень вверх). */""}
      ${subCrumbsHtml()}
      <button class="btn ghost" id="g-search" title="Найти ноду (название или #тег)"><i class="ti ti-search"></i></button>
      <button class="btn ghost" id="g-focus" title="Показать все ноды"><i class="ti ti-focus-2"></i></button>
      <!-- «Держать раскладку»: у каждой ноды появляется дом, к которому её мягко тянет.
           Состояние читается видом кнопки — подписи в тулбаре нет и заводить её негде. -->
      <button class="btn ghost${S.settings.graphHome?" on":""}" id="g-home" title="Держать раскладку"><i class="ti ti-home"></i></button>
      ${/* КНОПКА «ЧТО ГОРИТ» (2026-09-01). До этого режим включался ТОЛЬКО клавишей Ctrl+G —
           без единого видимого следа в интерфейсе. КРОЛИК опробовал двойной контур и номер
           очереди у горящих нод, но без кнопки их физически не с чем было увидеть: клавиша
           нигде не подписана, кроме тоста, который уже успевает скрыться. Кнопка живёт в том же
           тулбаре, тем же приёмом, что «Держать раскладку», — состояние читается видом. */""}
      <button class="btn ghost${S.settings.graphShowHeat?" on":""}" id="g-heat" title="Что горит (Ctrl+G) — двойной контур и номер очереди у самых срочных"><i class="ti ti-flame"></i></button>
      <button class="btn ghost" id="g-more" title="Ещё: перераскладка, теги"><i class="ti ti-dots"></i></button>
    </div>
    <div class="graph-more" id="g-more-menu" style="display:none">
      <button class="gm-it" id="g-refit"><i class="ti ti-arrows-shuffle"></i>Перераскладка</button>
      <button class="gm-it" id="g-tags"><i class="ti ti-tags"></i>Теги со стилем</button>
      <!-- поток работы по связям (см. _drawMain, «ПОТОК»): русло и течение выключаются по отдельности -->
      <button class="gm-it" id="g-flow"><i class="ti ti-ripple"></i>${S.settings.graphFlow===false?"Показать поток работы":"Скрыть поток работы"}</button>
      <button class="gm-it" id="g-flow-anim"${S.settings.graphFlow===false?' style="display:none"':""}><i class="ti ti-player-${S.settings.graphFlowAnim===false?"play":"pause"}"></i>${S.settings.graphFlowAnim===false?"Включить течение":"Остановить течение"}</button>
      <button class="gm-it" id="g-hint-on"><i class="ti ti-help-circle"></i>Показать подсказку</button>
      <!-- Тур показывается сам ОДИН раз после обновления. Отсюда его можно открыть снова:
           иначе посмотреть второй раз можно было только правкой файла данных.
           Подпись НЕ называет конкретную фичу (раньше было «Что нового: дом» — осталось от
           релиза 2.0.4.1 и тихо устарело, когда тур переписали под 2.0.5, КРОЛИК заметил).
           Общий пункт меню не требует правки на каждый релиз. -->
      <button class="gm-it" id="g-tour"><i class="ti ti-speakerphone"></i>Что нового</button>
      <!-- счётчик кадров пунктом меню, а не только клавишей: горячее сочетание может забрать
           себе системная утилита (у КРОЛИКА так делал PowerToys с Shift-сочетаниями) -->
      <button class="gm-it" id="g-fps-on"><i class="ti ti-activity"></i>${S.settings.graphFps?"Скрыть счётчик кадров":"Счётчик кадров"}</button>
    </div>
    <div class="graph-search" id="g-search-box" style="display:none">
      <i class="ti ti-search"></i><input type="text" placeholder="Найти по названию или #тегу…" spellcheck="false"><span class="gs-count"></span><button class="gs-close" title="Закрыть (Esc)"><i class="ti ti-x"></i></button>
    </div>
    <div class="graph-legend">${graphLegendHtml()}</div>
    ${/* ИИ — СВОЯ КНОПКА В УГЛУ, а не пункт в меню «…» (КРОЛИК, 07.09.2026). Пунктом она стояла
         в одном ряду с перераскладкой и счётчиком кадров — среди редких служебных действий, тогда
         как работа с нейросетью это отдельный вход, к которому возвращаются постоянно. Правый
         верхний угол свободен и симметричен тулбару слева. */""}
    <button class="graph-ai" id="g-ai" title="ИИ: пакеты команд от нейросети и подключение агента"><i class="ti ti-sparkles"></i></button>
    <!-- подсказку можно закрыть: висеть постоянно ей незачем, а вернуть — из меню «…» -->
    <div class="graph-hint${S.settings.graphHint===false?" off":""}" id="g-hint"><span>Alt+тащи от ноды — связь/заметка · Ctrl+тащи — копия выделенного · ПКМ — меню / создать · ЛКМ-рамка — выделить · двойной клик — открыть (подграф — войти внутрь) · средняя кнопка — двигать · колесо — зум · Delete — удалить</span><button id="g-hint-x" title="Скрыть подсказку"><i class="ti ti-x"></i></button></div>
    <!-- только счётчик: кнопка «Отчёт» уехала в правую панель, где отчёт и собирается -->
    <div class="graph-selbar" id="g-selbar" style="display:none">
      <span class="gsb-n"></span>
      <!-- разложить выделенное дерево домами: ноды доедут сами, форму потом доводят руками -->
      <button class="gsb-btn" id="g-tidy" title="Упорядочить выделенное: разложить деревом, без наложений и пересечений"><i class="ti ti-layout-grid"></i></button>
    </div>
    <div class="graph-tray" id="g-tray" style="display:none">
      <button class="gt-tab" id="gt-tab" title="Неразобранные мысли"><i class="ti ti-inbox"></i><span class="gt-n"></span></button>
      <div class="gt-body">
        <div class="gt-head"><span class="gt-ttl">Неразобранное</span><span class="gt-sub">тяни на холст</span></div>
        <div class="gt-list"></div>
      </div>
    </div>
  </div>`;
  if(graph){ const g=graph; graph=null; g.destroy(); }
  graph=new Graph($("#graph"));
  graph.build();
  subCrumbsWire();
  $("#g-search").onclick=()=>{ const box=$("#g-search-box"); if(box && box.style.display!=="none") graph.closeSearch(); else graph.openSearch(); };
  $("#g-focus").onclick=()=>graph._fitView();
  if($("#g-home")) $("#g-home").onclick=()=>graph.toggleHome();
  if($("#g-heat")) $("#g-heat").onclick=()=>graph.toggleHeat();
  // меню «Ещё»: редко используемые действия убраны из тулбара, чтобы не перегружать (зум — колесом)
  const moreMenu=$("#g-more-menu");
  function onDocMore(ev){ if(!document.body.contains(moreMenu)){ document.removeEventListener("pointerdown",onDocMore,true); return; }   // граф пересоздан — снять висячий слушатель
    if(!ev.target.closest("#g-more-menu") && !ev.target.closest("#g-more")) closeMore(); }
  function closeMore(){ if(moreMenu) moreMenu.style.display="none"; document.removeEventListener("pointerdown",onDocMore,true); }
  $("#g-more").onclick=(ev)=>{ ev.stopPropagation(); if(!moreMenu) return;
    if(moreMenu.style.display!=="none"){ closeMore(); }
    else { moreMenu.style.display="flex"; document.addEventListener("pointerdown",onDocMore,true); } };
  /* ПЕРЕРАСКЛАДКА ПРОТИВ ЗАДАННОЙ ФОРМЫ. Кнопка раскидывает ноды заново, а дома тянут их
     обратно — молча стереть форму, которую человек расставил руками, нельзя, но и жест без
     результата хуже отказа. Поэтому спрашиваем и, согласившись, забываем дома целиком И
     выключаем тумблер: раскладку дальше ведёт физика, как до появления домов. Понравилось —
     человек жмёт домик снова, и дома назначаются по новым местам. Ctrl+Z возвращает прежнюю
     форму: hx/hy лежат в самих нодах, а снимок отката сериализует items целиком. */
  $("#g-refit").onclick=async ()=>{ closeMore();
    /* Точка «до» — ДО вопроса и до сноса домов: диалог обещает, что прежняя форма вернётся по
       Ctrl+Z, и с тех пор как раскладка перестала попадать в обычный шаг истории (см. _noXY),
       держать это обещание может только свой шаг. */
    const формаБыла=graph?graph.layoutSnap():null;
    if(S.settings.graphHome){
      /* Формулировка проверена жестом: Ctrl+Z возвращает hx/hy (они лежат в items и уезжают в
         снимок отката), но НЕ тумблер — настройки в снимок не входят. Поэтому обещаем ровно
         два шага, а не «Вернуть — Ctrl+Z»: иначе человек нажмёт откат, увидит прежний
         разлёт и решит, что откат сломан. */
      const да=await uiConfirm("Ноды разлетятся заново, а «Держать раскладку» выключится. Прежняя форма вернётся: Ctrl+Z и снова домик.",
        {title:"Раскидать заново?", okLabel:"Раскидать", danger:true});
      if(!да) return;
      S.items.forEach(it=>{ delete it.hx; delete it.hy; });
      S.settings.graphHome=false; persist();
      if($("#g-home")) $("#g-home").classList.remove("on");
    }
    if(формаБыла) undoPushLayout(формаБыла);
    graph.refit(); };
  $("#g-tags").onclick=()=>{ closeMore(); openTagManager(); };
  if($("#g-ai")) $("#g-ai").onclick=()=>openCmdRunner();
  // подсказка по управлению: закрывается крестиком, возвращается отсюда
  if($("#g-hint-x")) $("#g-hint-x").onclick=()=>{ S.settings.graphHint=false; persist(); $("#g-hint").classList.add("off"); };
  $("#g-hint-on").onclick=()=>{ closeMore(); S.settings.graphHint=true; persist(); $("#g-hint").classList.remove("off"); };
  // тур живёт в main.js и грузится последним — к моменту клика он на месте
  // из меню открываем ВЕСЬ тур (turOpen(true)), а не только новые шаги: сюда человек лезет сам
  if($("#g-tour")) $("#g-tour").onclick=()=>{ closeMore(); if(typeof turOpen==="function") turOpen(true); else if(typeof turStep==="function") turStep(0); };
  /* Счётчик кадров: показывает цену кадра в ЖИВОМ приложении и на своих данных. Замерочный
     стенд всегда мягче — в нём нет ни движений мыши, ни правой панели, ни моста на диск. */
  if($("#g-fps-on")) $("#g-fps-on").onclick=()=>{ closeMore();
    S.settings.graphFps=!S.settings.graphFps; persist();
    $("#g-fps-on").innerHTML='<i class="ti ti-activity"></i>'+(S.settings.graphFps?"Скрыть счётчик кадров":"Счётчик кадров");
    graph._wake(); graph._tick(true); };
  // поток работы: русло целиком и отдельно течение (анимация — единственное, что стоит кадров)
  const потокПодписи=()=>{ const ф=$("#g-flow"), а=$("#g-flow-anim");
    if(ф) ф.innerHTML='<i class="ti ti-ripple"></i>'+(S.settings.graphFlow===false?"Показать поток работы":"Скрыть поток работы");
    if(а){ а.style.display=S.settings.graphFlow===false?"none":"";
      а.innerHTML='<i class="ti ti-player-'+(S.settings.graphFlowAnim===false?"play":"pause")+'"></i>'+(S.settings.graphFlowAnim===false?"Включить течение":"Остановить течение"); } };
  if($("#g-flow")) $("#g-flow").onclick=()=>{ closeMore(); S.settings.graphFlow=S.settings.graphFlow===false; persist(); потокПодписи(); graph._wake(); graph._tick(true); };
  if($("#g-flow-anim")) $("#g-flow-anim").onclick=()=>{ closeMore(); S.settings.graphFlowAnim=S.settings.graphFlowAnim===false; persist(); потокПодписи(); graph._wake(); graph._tick(true); };
  wireNotesToggle();
}
// каретка-сворачиватель для узла, у которого есть дочерние (в наборе паутины)
function caretHTML(it, hasKids){
  // hasKids задан явно (для деревьев с обрезкой) — иначе считаем по всем web-детям
  const has = hasKids!==undefined ? hasKids : childrenOfLive(it.id).length>0;
  if(!has) return "";
  const col=isCollapsed(it.id);
  return `<button class="nc-caret" data-collapse="${it.id}" title="${col?'Развернуть':'Свернуть'}"><i class="ti ${col?'ti-chevron-right':'ti-chevron-down'}"></i></button>`;
}
function noteCard(it, depth=0, hasKids, compact){
  // подграф идёт карточкой ЗАДАЧИ: у него есть своё «готово», срок и приоритет (см. kindIsTask)
  if(kindIsTask(it.kind)) return treeTaskCard(it, depth, hasKids);
  const c=itemColor(it);
  const isChild = depth > 0;
  const border = isChild?'':'border-left-color:'+(c||'var(--acc)')+';';
  const kicn = kindIcon(it.kind);
  const showIcn = compact || it.kind==="flow";   // схему всегда помечаем иконкой, чтобы отличать от заметок
  const head=`<div class="nc-head">${caretHTML(it, hasKids)}${showIcn?`<i class="ti ${kicn} nc-icn"></i>`:''}<div class="nc-ttl">${esc(it.title)}</div></div>`;
  // compact: заметка как контекст-заголовок в дереве задач (без тела/футера)
  if(compact) return `<div class="note-card ctx ${isChild?'child':'root'}" data-nid="${it.id}" style="${border}">${head}</div>`;
  const conn=linksOfLive(it.id);
  const kids=childrenOfLive(it.id);
  return `<div class="note-card ${isChild?'child':'root'}" data-nid="${it.id}" style="${border}">
    ${head}
    <div class="nc-body">${esc(it.body||"")}</div>
    <div class="nc-foot">
      ${/* Статус заметки — тем же значком, что у задачи: у КРОЛИКА заметками живут целые этапы
           («Анимация» под шотом), и в живом файле 20 из 55 заметок носят рабочий статус. */""}
      ${(СТАТУСЫ[it.status] && it.status!=="note")
         ? `<span class="tag st-${it.status}"><i class="ti ${СТАТУСЫ[it.status].иконка}"></i>${esc(СТАТУСЫ[it.status].имя)}</span>` : ""}
      ${conn.length?`<span class="tag"><i class="ti ti-link"></i>${conn.length}</span>`:""}
      ${kids.length?`<span class="tag"><i class="ti ti-sitemap"></i>${kids.length}</span>`:""}
      ${(it.tags||[]).map(t=>{ const ts=tagStyle(t); return `<span class="tag hash" data-tag="${esc(t)}" title="Фильтр по тегу" ${ts&&ts.color?tagInk(ts.color):""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(t)}</span>`; }).join("")}
      ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
    </div>
  </div>`;
}
// карточка задачи в дереве: чекбокс «выполнить» + компактные мета, чтобы не перегружать
function treeTaskCard(it, depth=0, hasKids){
  const conn=linksOfLive(it.id);
  const kids=childrenOfLive(it.id);
  const isChild = depth > 0;
  const dl=dueBadge(it);
  // полоска слева + флажок = СРОЧНОСТЬ (приоритет): pri-3 красный · pri-2 жёлтый · pri-1 зелёный · pri-0 нейтральный
  // дочерние получают тот же цвет, но приглушённый (см. CSS .note-card.task.child.pri-N)
  return `<div class="note-card task ${isChild?'child':'root'} ${it.done?'done':''} pri-${it.priority||0}" data-tid="${it.id}">
    <div class="nc-head">
      ${caretHTML(it, hasKids)}
      <button class="chk ${it.done?'done':''}" data-chk="${it.id}" title="Выполнить"><i class="ti ti-check"></i></button>
      <div class="nc-ttl">${esc(it.title)}</div>
    </div>
    <div class="nc-foot">
      ${/* Подпись вида берём из реестра KINDS: сюда noteCard перебрасывает и задачу, и подграф
           (у обоих своё «готово»), и жёсткое «задача» соврало бы про второй. */""}
      <span class="tag"><i class="ti ${kindIcon(it.kind)}"></i>${esc(kindRu(it.kind))}</span>
      ${/* СТАТУС В СПИСКАХ. Раньше карточка показывала только выполненность, и во вкладках
           «Задачи» и «Заметки» семь задач «в работе» и шесть «на паузе» были неотличимы от
           двадцати одной «не начато» — статус жил исключительно на графе. Одна эта карточка
           обслуживает оба дерева сразу (noteCard перебрасывает сюда любую задачу). */""}
      ${(!it.done && СТАТУСЫ[it.status] && it.status!=="todo" && it.status!=="note")
         ? `<span class="tag st-${it.status}"><i class="ti ${СТАТУСЫ[it.status].иконка}"></i>${esc(СТАТУСЫ[it.status].имя)}</span>` : ""}
      ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
      ${it.priority?`<span class="pri"><i class="ti ti-flag-3"></i></span>`:""}
      ${conn.length?`<span class="tag"><i class="ti ti-link"></i>${conn.length}</span>`:""}
      ${kids.length?`<span class="tag"><i class="ti ti-sitemap"></i>${kids.length}</span>`:""}
      ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
    </div>
  </div>`;
}
// сортировка дерева: срочные задачи вперёд (приоритет ↓), затем по сроку, затем свежесть; заметки (приоритет 0) — в конце
function byUrgency(a,b){ return (b.priority||0)-(a.priority||0) || ((a.due?parseYmd(a.due):Infinity)-(b.due?parseYmd(b.due):Infinity)) || (b.updated||0)-(a.updated||0); }
// компактная строка для вкладки «Папки»: каретка + иконка типа + заголовок. Полоска слева = цвет ноды (itemColor);
// задача-с-папкой со срочностью показывает флажок справа (как в списке заметок).
function folderRowCard(it, hasKids){
  const ki=kindIcon(it.kind);
  const col=itemColor(it);
  const flag=(kindIsTask(it.kind) && it.priority && it.folder)?`<span class="pri" style="color:${it.priority>=3?"var(--pri3)":it.priority===2?"var(--pri2)":"var(--pri1)"}"><i class="ti ti-flag-3"></i></span>`:"";
  return `<div class="note-card ctx ${it.done?'done':''}" data-nid="${it.id}" ${col?`style="border-left-color:${col}"`:""}><div class="nc-head">${caretHTML(it,hasKids)}<i class="ti ${ki} nc-icn"></i><div class="nc-ttl">${esc(it.title)}</div>${flag}</div></div>`;
}
function renderNotesList(v){
  const nodes=S.items.filter(inWeb);   // заметки + задачи из паутины
  if(!nodes.length){ v.innerHTML=emptyBox("ti-note","Пусто. Создай заметку (кнопка сверху или <b>N</b>) или задачу."); wireNotesToggle(); return; }
  const ids=new Set(nodes.map(n=>n.id));
  const byId=id=>S.items.find(i=>i.id===id);
  const isDone=it=>kindIsTask(it.kind) && it.done;
  // архивна ли нода: она сама done-задача, ИЛИ архивен её ближайший родитель (рекурсивно вниз по дереву).
  // выполненные задачи и их поддерево «улетают» в «Завершённые», как во вкладке «Папки»;
  // активный узел НЕ утягивается в архив статусом своего потомка (только предка).
  const archMemo=new Map();
  const isArchived=it=>{
    if(archMemo.has(it.id)) return archMemo.get(it.id);
    archMemo.set(it.id,false);
    const pid=(it.parent&&ids.has(it.parent))?it.parent:null;
    const res = isDone(it) || (pid ? isArchived(byId(pid)) : false);
    archMemo.set(it.id,res); return res;
  };
  // текстовый фильтр: совпавшие по названию/телу/тегам + их предки (контекст ветки)
  const q=listQuery.trim().toLowerCase();
  let shown=nodes;
  if(q){
    const hit=n=>(n.title||"").toLowerCase().includes(q)||(n.body||"").toLowerCase().includes(q)||(n.tags||[]).some(t=>String(t).toLowerCase().includes(q))||fieldsText(n).toLowerCase().includes(q);
    const keep=new Set();
    nodes.filter(hit).forEach(n=>{ let cur=n,g=new Set(); while(cur&&!g.has(cur.id)){ g.add(cur.id); keep.add(cur.id); const pid=(cur.parent&&ids.has(cur.parent))?cur.parent:null; cur=pid?byId(pid):null; } });
    shown=nodes.filter(n=>keep.has(n.id));
  }
  const activeSet=new Set(), doneSet=new Set();
  shown.forEach(n=>{ (isArchived(n)?doneSet:activeSet).add(n.id); });
  const hasParentIn=(it,set)=> it.parent && set.has(it.parent);
  const seen=new Set();                                   // защита от дублей и циклов в иерархии
  // рекурсивно: карточка + ВСЕ её потомки из того же набора (активные/архив)
  function branch(it, depth, set){
    if(seen.has(it.id)) return "";
    seen.add(it.id);
    let h=noteCard(it, depth);
    if(isCollapsed(it.id)) return h;   // свёрнут — детей не показываем
    const kids=childrenOf(it.id)
      .filter(k=>set.has(k.id))
      .sort(byUrgency);
    if(kids.length) h+=`<div class="tree-branch">`+kids.map(k=>branch(k, depth+1, set)).join("")+`</div>`;
    return h;
  }
  function group(roots, set, sortFn){ return `<div class="notes-tree">`+roots.slice().sort(sortFn||byUrgency).map(r=>branch(r,0,set)).join("")+`</div>`; }
  function sec(key, icon, name, count, colorStyle){
    const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`;
  }
  let h=`<div class="tf-chips"><span class="list-find"><i class="ti ti-search"></i><input id="list-filter" type="text" placeholder="Фильтр…" value="${esc(listQuery)}" spellcheck="false"></span></div>`;
  if(q && !shown.length) h+=emptyBox("ti-search","Ничего не нашлось по фильтру «"+esc(listQuery.trim())+"».");
  // корни (без родителя В ТОМ ЖЕ наборе) группируем по области корня; потомки вкладываются под корнем независимо от их области
  S.areas.forEach(a=>{
    const roots=nodes.filter(it=>activeSet.has(it.id) && it.area===a.id && !hasParentIn(it,activeSet));
    if(!roots.length) return;
    const key="area:"+a.id;
    h+=sec(key, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed(key)) h+=group(roots,activeSet);
  });
  const noArea=nodes.filter(it=>activeSet.has(it.id) && !it.area && !hasParentIn(it,activeSet));
  if(noArea.length){
    h+=sec("area:__none", "ti-circle-dashed", "Без области", noArea.length, "");
    if(!isCollapsed("area:__none")) h+=group(noArea,activeSet);
  }
  // ЗАВЕРШЁННЫЕ: выполненная задача (и её активные потомки) уезжают сюда целиком, свежие сверху
  const doneRoots=nodes.filter(it=>doneSet.has(it.id) && !hasParentIn(it,doneSet));
  if(doneRoots.length){
    const key="notes:done", c=isCollapsed(key);
    h+=`<div class="sec sec-collapse fld-done-sec" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ti-checks"></i>Завершённые<span class="sec-cnt">${doneRoots.length}</span></div>`;
    if(!c) h+=group(doneRoots, doneSet, (a,b)=>(b.doneAt||0)-(a.doneAt||0));
  }
  v.innerHTML=h;
  // свернуть/развернуть область или поддерево
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс обрабатывает делегат #view (toggleDone)
    if(e.target.closest("[data-tag]")) return;       // клик по тегу — фильтр (делегат #view)
    if(e.target.closest("[data-collapse]")) return;  // каретка сворачивания
    if(e.target.closest("[data-openfolder]")) return; // кнопка папки — делегат #view
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(!it) return;
    openItemSmart(it);
  });
  wireListFilter(v);
  wireNotesToggle();
}
function wireNotesToggle(){
  $$("#notes-toggle button").forEach(b=>b.onclick=()=>{ notesMode=b.dataset.nm; render(); });
}

class Graph{
  constructor(svg){
    this.svg=svg; this.W=svg.clientWidth||900; this.H=svg.clientHeight||500;
    this.nodes=[]; this.links=[]; this.byId={};
    this._lcId=null; this._lcT=0;
    this.alpha=1; this.drag=null; this.dragMates=null; this._dragHollowAreas=null; this.copyDrag=false; this.linkFrom=null; this.sel=null;
    // режим «что горит» переживает и пересборку вида, и перезапуск приложения — состояние в S.settings, не на экземпляре
    this._показатьЖар=!!S.settings.graphShowHeat;
    this._dbg = _дрожьВкл ? this._dbgNew() : null;   // диагностика дрожи — только по выключателю (см. дрожь())
    this.zoom=1; this.tx=0; this.ty=0; this.panning=null;
    /* СВОЙ id графа — запоминаем ОДИН РАЗ здесь, а не читаем S.settings.graph по требованию
       дальше (build(), отложенная запись камеры): экземпляр Graph никогда не переживает смену
       графа — render() его сносит и создаёт новый (см. renderNotes) — а вот ОТЛОЖЕННАЯ запись
       камеры (_applyTransform → _camSave, до 1900 мс) вполне может дожить до момента, когда
       S.settings.graph уже указывает на СЛЕДУЮЩИЙ граф. Читать его тогда — значит подписать
       камеру старого графа именем нового. */
    this._графID=S.settings.graph;
    /* Камера с прошлого запуска — СВОЯ у каждого графа (см. graphCam выше и миграцию в
       sanitizeState). graphCam живёт только в памяти вкладки, поэтому после перезапуска
       приложения вид открывался в стороне от графа. Числа проверяем: битая настройка не
       должна утащить вьюпорт в пустоту. */
    if(!graphCam[this._графID]){
      const кам=S.settings.graphCam && S.settings.graphCam[this._графID];
      if(кам && isFinite(кам.tx) && isFinite(кам.ty) && isFinite(кам.zoom) && кам.zoom>0.05 && кам.zoom<4){
        graphCam[this._графID]={tx:+кам.tx, ty:+кам.ty, zoom:+кам.zoom};
      }
    }
    if(graphCam[this._графID]){
      // ставим и на сам граф: build() тоже её поднимет, но до первого build камера уже верная
      this.tx=graphCam[this._графID].tx; this.ty=graphCam[this._графID].ty; this.zoom=graphCam[this._графID].zoom;
    }
    /* Мировой сдвиг фон-параллакса: копится ТОЛЬКО от пана (не от зума/фита) → зум читается чисто.
       Берём его из модульного хранилища, как камеру: Graph пересоздаётся на каждый render(), и с
       нуля звёздное поле съезжало на весь накопленный пан — «фон перерисовывается» при любом
       действии, которое зовёт render() (привязка папки из списка папок, создание ноды, правка области). */
    this.bgPanX=graphBgPan.x; this.bgPanY=graphBgPan.y;
    this.raf=null;
    this.selNodes=new Set(); this.marq=null;   // выделение нод (клик/shift-клик/рамка) + удаление по Delete
    this._watchResize();
  }
  /* РАЗМЕР ОКНА. W/H и viewBox раньше ставились ТОЛЬКО в build(), а окно меняет размер и без него
     (фулскрин, разворот, тяга за край). Тогда слои разъезжались: SVG со старым viewBox браузер
     просто РАСТЯГИВАЛ на новый размер, а свечение и фон рисуются канвасом в его СЕГОДНЯШНИХ
     пикселях (см. _drawGlow) — и свет уезжал от своих нод тем сильнее, чем больше стало окно.
     Камеру правим так, чтобы мировая точка в центре экрана осталась в центре: иначе при каждом
     развороте окна граф прыгал бы вбок. */
  _watchResize(){
    if(typeof ResizeObserver==="function"){ this._ro=new ResizeObserver(()=>this._onResize()); this._ro.observe(this.svg); }
    this._onWinResize=()=>this._onResize();   // подстраховка: ResizeObserver не доставляется, пока окно скрыто
    window.addEventListener("resize", this._onWinResize);
  }
  /* ЕДИНСТВЕННАЯ точка планирования кадра. Раньше requestAnimationFrame звался из четырёх мест,
     и в _onResize (в отличие от build/resume) забыли проверить, что кадр уже запланирован:
     каждое изменение размера окна добавляло ЕЩЁ ОДИН вечный цикл _tick поверх существующего.
     Развернул окно, свернул, растянул — и граф считает физику в три-четыре параллельных потока
     кадров, каждый со своим this.raf; отменить можно только последний. Здесь инвариант «ровно
     один запланированный кадр» держится конструкцией, а не внимательностью. */
  /* ПОТОЛОК ЧАСТОТЫ. requestAnimationFrame идёт со скоростью МОНИТОРА, а у КРОЛИКА он 165 Гц —
     то есть граф по умолчанию рисовал в 2.75 раза больше кадров, чем задумано (все постоянные
     плавности в кадре — зум 0.28, остывание 0.985, дуги 0.16 — считались под 60).
     Замер (944 ноды, окно 2560×1369, зум колесом туда-сюда):
       165 кадр/с — карта на 2031 МГц, 42.6 Вт;   60 кадр/с — 616 МГц, 19.6 Вт;  покой — 15 Вт.
     Ватты и частоты падают ВЧЕТВЕРО, а «процент загрузки» в диспетчере при этом не меняется:
     он считает ВРЕМЯ занятости, а не работу, и на редких кадрах карта просто не разгоняется.
     Мерить надо ватты (nvidia-smi), проценты тут врут.
     Ждать между кадрами приходится таймером: rAF сам по себе умеет только «каждый кадр экрана»,
     и пропуск кадра счётчиком всё равно будил бы поток 165 раз в секунду. */
  _schedule(пауза){
    if(this._paused){ this.raf=null; return; }
    this._idle=false;
    this._cancelFrame();
    const пот=(S.settings && S.settings.graphFpsCap!=null) ? +S.settings.graphFpsCap : 0;
    const мин=(пот>0) ? 1000/пот : 0;
    const ждать=Math.max(пауза||0, мин ? мин-(performance.now()-(this._прКадр||0)) : 0);
    if(ждать>1.5){
      this._кадрТаймер=setTimeout(()=>{ this._кадрТаймер=null;
        this.raf=requestAnimationFrame(()=>{ this.raf=null; this._tick(); }); }, ждать);
      return;
    }
    this.raf=requestAnimationFrame(()=>{ this.raf=null; this._tick(); });
  }
  // «кадр запланирован» — это ЛИБО rAF, ЛИБО таймер ожидания. Проверять одно this.raf больше
  // нельзя: пока идёт пауза между кадрами, он пуст, и старая проверка завела бы второй цикл.
  _frameWaiting(){ return !!(this.raf || this._кадрТаймер); }
  _cancelFrame(){ if(this.raf){ cancelAnimationFrame(this.raf); this.raf=null; }
                if(this._кадрТаймер){ clearTimeout(this._кадрТаймер); this._кадрТаймер=null; } }
  /* Разбудить цикл, если он остановился в покое. Зовут все, кто меняет картинку: жесты,
     зум, выделение, перестройка. Дешевле, чем крутить пустые кадры «на всякий случай».
     Если цикл дремлет в покое (таймер на 160 мс), пробуждение обязано этот сон оборвать —
     иначе жест ждал бы до шестой доли секунды. */
  _wake(){
    /* НА ПАУЗЕ (окно неактивно) САМОХОДНЫЙ ЦИКЛ НЕ ЗАВОДИМ, НО КАДР ПО ЖЕСТУ РИСУЕМ. Пауза
       заведена против фонового жора: неактивное окно не должно крутить физику и дыхание. Но
       она глушила и жесты — `_schedule` при `_paused` выходит, ничего не запланировав, поэтому
       колесо над неактивным окном меняло камеру втихую, и зум становился виден только после
       клика по окну (КРОЛИК: «зум применится, когда кликну»). То же было с подсветкой наведения.
       Разовый кадр на жест фонового жора не создаёт: пока мышь не трогают, кадров нет вовсе.
       Планируем через requestAnimationFrame, а не рисуем сразу: колесо шлёт события пачками, и
       синхронный кадр на каждое стоил бы дороже самой анимации. Цикл при этом не самозаведётся —
       _tick в конце зовёт _schedule, а тот на паузе по-прежнему выходит ни с чем. */
    if(this._paused){
      if(!this.raf) this.raf=requestAnimationFrame(()=>{ this.raf=null; this._tick(true); });
      return;
    }
    if(this._кадрТаймер || !this.raf) this._schedule();
  }
  _onResize(){
    const w=this.svg.clientWidth, h=this.svg.clientHeight;
    if(!w || !h || (w===this.W && h===this.H)) return false;
    const wx=(this.W/2-this.tx)/this.zoom, wy=(this.H/2-this.ty)/this.zoom;   // мировая точка в центре экрана
    this.W=w; this.H=h;
    this.svg.setAttribute("viewBox",`0 0 ${w} ${h}`);
    this.tx=w/2-wx*this.zoom; this.ty=h/2-wy*this.zoom;                       // она же остаётся в центре
    this._applyTransform();
    if(!this._paused){ this._cancelFrame(); this._tick(true); }   // перерисовать сразу: в покое кадр мог бы быть пропущен
    return true;
  }
  _paintSel(){
    if(this.canvasMode) this._wake();   // кольца выделения рисует кадр — разбудить цикл
    if(this.nodeEls) this.nodeEls.forEach(o=>o.g.classList.toggle("sel",this.selNodes.has(o.n.id)));
    // порог, за которым свечение выделения снимается (см. #graph.many-sel в стилях)
    if(this.svg) this.svg.classList.toggle("many-sel", this.selNodes.size>25);
    this._renderSelBar();
  }

  /* Правая панель следует за выделением: одна нода — её карточка, несколько — сводка.
     Зовётся ПОСЛЕ жеста (клик, рамка), а не из _paintSel: тот дёргается на каждом кадре
     протяжки, и панель перерисовывалась бы десятки раз за секунду. */
  /* Маленькое меню «что создать» в точке отпускания. Живёт до выбора или клика мимо;
     Escape тоже закрывает — иначе оно висело бы поверх графа. */
  _askKind(e, then){
    this._closePop();
    const wrap=$("#graph-wrap"); if(!wrap) return then("note");
    const rc=wrap.getBoundingClientRect();
    const pop=el("div","g-ctx"); pop.id="node-pop";
    pop.innerHTML=`<div class="np-ttl"><i class="ti ti-plus"></i> Связать с новой</div>
      <div class="np-col">
        <button class="btn" data-k="note"><i class="ti ${kindIcon("note")}"></i>Заметка</button>
        <button class="btn" data-k="task"><i class="ti ${kindIcon("task")}"></i>Задача</button>
        <button class="btn" data-k="flow"><i class="ti ${kindIcon("flow")}"></i>Полотно</button>
        <button class="btn" data-k="sub"><i class="ti ${kindIcon("sub")}"></i>Подграф</button>
      </div>`;
    wrap.appendChild(pop);
    const pw=pop.offsetWidth||180, ph=pop.offsetHeight||150;
    pop.style.left=Math.min(Math.max(6,e.clientX-rc.left+6), rc.width-pw-6)+"px";
    pop.style.top =Math.min(Math.max(6,e.clientY-rc.top+6),  rc.height-ph-6)+"px";
    const закрыть=()=>{ this._closePop(); document.removeEventListener("pointerdown",мимо,true); document.removeEventListener("keydown",клавиша,true); };
    const мимо=ev=>{ if(!ev.target.closest("#node-pop")) закрыть(); };
    const клавиша=ev=>{ if(ev.key==="Escape"){ ev.preventDefault(); закрыть(); } };
    setTimeout(()=>{ document.addEventListener("pointerdown",мимо,true); document.addEventListener("keydown",клавиша,true); },0);
    $$("[data-k]",pop).forEach(b=>b.onclick=()=>{ const k=b.dataset.k; закрыть(); then(k); });
  }

  // Выделить ноду снаружи (клик по связанной ноде в правой панели) и подвести к ней камеру.
  focusNode(id){
    const n=this.byId[id];
    if(!n) return false;
    this._flyTo(n);
    return true;
  }

  _syncAside(){
    /* ЭКЗЕМПЛЯР МОГ УМЕРЕТЬ, ПОКА ЖДАЛ ТАЙМЕР. Панель догоняет выделение с задержкой 140 мс
       (см. _syncAsideLater), а за это время граф успевает пересобраться: вход в подграф и
       переключение графа зовут render() прямо из обработчика жеста. У мёртвого экземпляра
       selNodes указывает на ноды ДРУГОГО графа — панель показала бы пустоту вместо карточки. */
    if(typeof graph!=="undefined" && graph!==this) return;
    const ids=[...this.selNodes].filter(id=>!isHubId(id));
    /* ВЫДЕЛЕНИЕ НЕ ИЗМЕНИЛОСЬ — ПАНЕЛЬ НЕ ТРОГАЕМ. Одну и ту же ноду человек хватает подряд
       десятки раз («тащу, отпускаю, снова хватаю»), и собирать ей ту же карточку заново на
       каждый жест незачем: на ноде с полями, картинками и доской это самая дорогая работа во
       всём жесте. Сброс отчёта тут тоже не нужен — он про те же ноды, что и был. */
    if(ids.length===1 && ids[0]===asideId && !asideGroup) return;
    if(ids.length===1) asideSelect(ids[0]);
    else if(ids.length>1) asideMany(ids);
    else asideSelect(null);
  }
  /* Панель собирается НЕ В САМОМ ЖЕСТЕ, а через паузу после него. Отпускание и следующее
     нажатие идут подряд, и сборка панели, поставленная встык к отпусканию, попадает ровно в тот
     момент, когда человек уже тянет снова (КРОЛИК: «отпускаю и сразу беру ноду — фриз»). Таймер
     сбрасывается каждым новым жестом, поэтому за всю серию панель соберётся ОДИН раз, в конце.
     Пока жест идёт, сборку откладываем дальше: в панель всё равно не смотрят, пока тянут. */
  _syncAsideLater(){
    clearTimeout(this._asideT);
    this._asideT=setTimeout(()=>{ this._asideT=null;
      if(this.drag || this.marq || this.connectDrag){ this._syncAsideLater(); return; }
      this._syncAside();
    }, 140);
  }

  /* Выделить всю область: клик по ней в полосе слева подсвечивает её ноды прямо в паутине.
     Берём и унаследованную область — ветка целиком и есть «область» глазами человека. */
  selectArea(id){
    this.selNodes.clear();
    if(id){
      this.nodes.forEach(n=>{ if(n.ref && n.ref.area===id) this.selNodes.add(n.id); });
      const hub="hub_"+id; if(this.byId[hub]) this.selNodes.add(hub);
    }
    this._paintSel();
  }
  // счётчик выделенного над графом; собрать отчёт — кнопкой в правой панели, там же он и живёт
  _renderSelBar(){
    const wrap=this.svg.parentNode; if(!wrap) return;
    const bar=wrap.querySelector("#g-selbar"); if(!bar) return;
    const ids=[...this.selNodes].filter(id=>this.byId[id]&&this.byId[id].ref);
    if(!ids.length){ bar.style.display="none"; return; }
    bar.style.display="";
    const nEl=bar.querySelector(".gsb-n"); if(nEl) nEl.textContent="Выделено: "+ids.length;
    const tidy=bar.querySelector("#g-tidy");
    if(tidy){ tidy.style.display=ids.length>2?"":"none"; tidy.onclick=()=>this._tidySelection(); }
  }
  // ноды выделения — для кнопки «Отчёт» в правой панели
  selectedItems(){ return [...this.selNodes].map(id=>this.byId[id]&&this.byId[id].ref).filter(Boolean); }
  _startMarquee(e){ const wrap=this.svg.parentNode; let el=wrap.querySelector(".graph-marquee");
    if(!el){ el=document.createElement("div"); el.className="graph-marquee"; wrap.appendChild(el); }
    this._marqEl=el; const rc=wrap.getBoundingClientRect();
    // Shift запоминаем на СТАРТЕ жеста: клавишу отпускают посреди протяжки, и решать по
    // текущему состоянию значило бы менять правило прямо во время рамки.
    this.marq={x0:e.clientX,y0:e.clientY,rc,base:new Set(this.selNodes),shift:!!e.shiftKey};
    el.style.display=""; el.style.left=(e.clientX-rc.left)+"px"; el.style.top=(e.clientY-rc.top)+"px"; el.style.width="0px"; el.style.height="0px";
  }
  _updateMarquee(e){ const m=this.marq, rc=m.rc;
    const x1=Math.min(m.x0,e.clientX),y1=Math.min(m.y0,e.clientY),x2=Math.max(m.x0,e.clientX),y2=Math.max(m.y0,e.clientY);
    this._marqEl.style.left=(x1-rc.left)+"px"; this._marqEl.style.top=(y1-rc.top)+"px"; this._marqEl.style.width=(x2-x1)+"px"; this._marqEl.style.height=(y2-y1)+"px";
    const w1=this._pt({clientX:x1,clientY:y1}), w2=this._pt({clientX:x2,clientY:y2});
    // hit-тест по ВИДИМОЙ позиции (с idle-дрейфом), как рисуется нода — иначе у краёв рамки промахи
    const hit=this.nodes.filter(n=>{ const nx=n.x+(n._ix||0), ny=n.y+(n._iy||0); return nx>=w1.x && nx<=w2.x && ny>=w1.y && ny<=w2.y; }).map(n=>n.id);
    /* Рамка с SHIFT только ДОБАВЛЯЕТ и никогда не снимает (правка 03.09.2026, КРОЛИК).
       Была переключателем — и в этом была беда: обводя пачку, почти всегда захватываешь и уже
       выделенное, и новое, а переключатель на одном и том же жесте одних добавлял, других
       выкидывал. Набрать выделение в несколько заходов становилось лотереей: каждый следующий
       обвод разбирал предыдущий. Снять лишнее по-прежнему можно shift-кликом по самой ноде —
       там переключатель уместен, потому что цель одна и человек её видит. */
    const итог=new Set(m.base);
    hit.forEach(id=>итог.add(id));
    this.selNodes=итог; this._paintSel();
  }
  _finishMarquee(){ this.marq=null; if(this._marqEl) this._marqEl.style.display="none"; this._syncAside(); }
  /* ---- поиск ноды по названию + перелёт камеры ---- */
  openSearch(){ const box=$("#g-search-box"); if(!box) return; this._searchBox=box; box.style.display="flex";
    const inp=$("input",box), cnt=$(".gs-count",box), cl=$(".gs-close",box); inp.value=""; this._searchMatches=[]; this._searchIdx=0;
    if(cl) cl.onclick=()=>this.closeSearch();
    /* ЗАДЕРЖКА НА ПОИСК. Без нее каждая буква гоняла полный скан всех узлов (label+теги+тело+
       именованные поля+папка) плюс перекраску классов dim/hit по ВСЕМ nodeEls и linkEls — на
       944 узлах заметная работа на каждое нажатие при быстром наборе. Тот же приём, что уже
       есть у _hover в этом файле, только сравнивать тут не с чем: буквы разные почти всегда,
       поэтому просто откладываем, а не сверяем с прошлым запросом. */
    const запуск=()=>{ clearTimeout(this._searchT); this._searchT=null;
      const n=this.search(inp.value); cnt.textContent=inp.value.trim()?(n?(this._searchIdx+1)+"/"+n:"0"):""; };
    inp.oninput=()=>{ clearTimeout(this._searchT); this._searchT=setTimeout(запуск,150); };
    inp.onkeydown=(e)=>{ e.stopPropagation();
      if(e.key==="Enter"){ e.preventDefault();
        // ждёт отложенный поиск — досрочно выполняем его (текст мог не соответствовать
        // «Далее» по прошлому запросу), иначе Enter — обычное «следующее совпадение»
        if(this._searchT){ запуск(); return; }
        this.searchNext(); cnt.textContent=this._searchMatches.length?(this._searchIdx+1)+"/"+this._searchMatches.length:"0"; }
      else if(e.key==="Escape"){ e.preventDefault(); this.closeSearch(); } };
    setTimeout(()=>inp.focus(),20);
  }
  /* Ищем по названию, тегам, описанию и привязанной папке: «где я про это писал» чаще
     вспоминается словом из текста, чем точным заголовком. Хаб области сюда не попадает —
     у него нет ref. Совпавшие не просто «не погашены», а подсвечены (класс hit): на большой
     паутине гашение остальных теряется, а искомое надо видеть с одного взгляда. */
  search(q){ q=(q||"").trim().toLowerCase().replace(/^#/,"");
    if(!q){ this._searchMatches=[]; this._clearSearchDim(); return 0; }
    const подходит=n=>{
      if((n.label||"").toLowerCase().includes(q)) return true;
      const it=n.ref; if(!it) return false;
      if((it.tags||[]).some(t=>String(t).toLowerCase().includes(q))) return true;
      if((it.body||"").toLowerCase().includes(q)) return true;
      if(fieldsText(it).toLowerCase().includes(q)) return true;   // написанное в именованном поле тоже надо находить
      if((it.folder||"").toLowerCase().includes(q)) return true;
      return false;
    };
    const matches=this.nodes.filter(подходит);
    this._searchMatches=matches; this._searchIdx=0;
    const ids=new Set(matches.map(n=>n.id));
    if(this.canvasMode) this._wake();   // на холсте гашение несовпавших рисует кадр (см. _drawMain)
    this.nodeEls.forEach(o=>{
      o.g.classList.toggle("dim", matches.length>0 && !ids.has(o.n.id));   // гасим несовпадающие
      o.g.classList.toggle("hit", ids.has(o.n.id));                        // и подсвечиваем найденное
    });
    // связь между двумя найденными остаётся видимой — иначе кластер совпадений рассыпается на точки
    this.linkEls.forEach((e,i)=>{
      const l=this.links[i], оба=l && ids.has(l.a) && ids.has(l.b);
      e.classList.toggle("dim", matches.length>0 && !оба);
      const base=+(e._baseOp!=null?e._baseOp:1) || 1;
      e.style.opacity = matches.length>0 ? (оба ? base : base*0.12) : base;
    });
    if(matches.length) this._flyTo(matches[0]);
    return matches.length;
  }
  searchNext(){ const m=this._searchMatches; if(!m||!m.length) return; this._searchIdx=(this._searchIdx+1)%m.length; this._flyTo(m[this._searchIdx]); }
  _flyTo(n){ this.selNodes=new Set([n.id]); this._paintSel();
    const z=Math.max(this.zoom,0.9); this._tweenView(z, this.W/2-n.x*z, this.H/2-n.y*z); }
  /* РЕЖИМ «ЧТО ГОРИТ». Главная причина «не вижу срочное» — не оформление ноды, а то, что она за
     кадром: на 245 нодах в кадр попадает малая часть. Поэтому режим делает две вещи сразу:
     гасит непричастное (см. _drawMain) и по повторному нажатию перелетает к следующей горящей
     ноде — тем же _flyTo, что у поиска, чтобы камера вела себя одинаково. */
  toggleHeat(){
    const включаем=!this._показатьЖар;
    this._показатьЖар=включаем;
    this._жарИдx=-1;
    this.build();
    const n=(this._горящие||[]).length;
    if(включаем && !n){ this._показатьЖар=false; this._heatPanel(); }   // включить было нечего — остаёмся выключенными
    S.settings.graphShowHeat=this._показатьЖар; persist();   // переживает перезапуск — см. конструктор
    /* РАЗБУДИТЬ ЦИКЛ КАДРОВ — этой строки не хватало (правка по разбору бага КРОЛИКА: «на
       большой ноде не видно обводки приоритета»). Без неё build() рисует РОВНО ОДИН кадр и
       уходит в покой: если граф уже стоял неподвижно (частый случай — включили режим сразу
       после захода в «Заметки»), этот единственный кадр мог поймать переходный момент — узел
       вошёл в число горящих только что, и что-то из его отрисовки ещё не устаканилось. Дальше
       кадр больше не перерисовывался НИКОГДА, пока что-то другое не будило граф (наведение,
       панорама) — незавершённая дужка так и висела. `toggleHome` рядом уже делает ровно это. */
    this.alpha=Math.max(this.alpha,0.3); this._wake();
    // кнопка в тулбаре — та же логика, что у «Держать раскладку»: вид читает состояние
    const b=$("#g-heat"); if(b) b.classList.toggle("on",this._показатьЖар);
    if(включаем && !n){ toast("Сейчас ничего не горит",{icon:"ti-flame-off"}); return; }
    toast(this._показатьЖар ? ("Горит: "+n+" · Ctrl+Shift+G — к следующей") : "Показываю всё",
          {icon:this._показатьЖар?"ti-flame":"ti-eye"});
  }
  /* ПАНЕЛЬ «ЧТО ГОРИТ» (стиль A, шаг 3.4). Номер очереди на ноде говорит «куда», но не «почему»,
     а горящая за кадром нода видна только стрелкой на краю. Панель — список очереди целиком:
     номер цветом жара, название и причины (urgencyReasons — те же слагаемые, что считают балл).
     Клик по строке подводит камеру к ноде (_flyTo — как поиск и Ctrl+Shift+G), наведение
     подсвечивает её на графе. Перестраивается только в build(), не в кадре: строк максимум восемь. */
  _heatPanel(){
    const wrap=$("#graph-wrap"); if(!wrap) return;
    let п=wrap.querySelector("#heat-panel");
    const m=this._показатьЖар ? (this._горящие||[]) : [];
    if(!m.length){ if(п) п.remove(); return; }
    if(!п){ п=document.createElement("div"); п.id="heat-panel"; wrap.appendChild(п); }
    const свёрнута=!!S.settings.heatPanelMin;
    п.classList.toggle("min", свёрнута);
    п.innerHTML=`<div class="hp-head"><i class="ti ti-flame"></i><span>Что горит</span><b>${m.length}</b>
        <button class="hp-btn" data-hp="min" title="${свёрнута?"Развернуть":"Свернуть"}"><i class="ti ti-chevron-${свёрнута?"up":"down"}"></i></button>
        <button class="hp-btn" data-hp="off" title="Выключить режим (Ctrl+G)"><i class="ti ti-x"></i></button></div>`
      +(свёрнута?"":`<div class="hp-list">${m.map(у=>`<button class="hp-row" data-hp-id="${esc(у.id)}">
        <span class="hp-n l${Math.max(1,Math.min(3,у.жар||1))}">${у.ранг}</span>
        <span class="hp-t"><span class="hp-name">${esc(у.label||"(без названия)")}</span>
        <span class="hp-why">${esc((у._почему||[]).join(" · "))}</span></span></button>`).join("")}</div>`);
    п.onclick=e=>{
      const б=e.target.closest("[data-hp]");
      if(б){ e.stopPropagation();
        if(б.dataset.hp==="off") this.toggleHeat();
        else { S.settings.heatPanelMin=!S.settings.heatPanelMin; persist(); this._heatPanel(); }
        return; }
      const стр=e.target.closest(".hp-row"); if(!стр) return;
      const n=this.byId[стр.dataset.hpId]; if(!n) return;
      this._жарИдx=m.indexOf(n); this._flyTo(n);
      if(typeof asideSelect==="function") asideSelect(n.id);
    };
    п.onmouseover=e=>{ const стр=e.target.closest(".hp-row"); const id=стр?стр.dataset.hpId:null;
      if(id!==this._hovId){ this._hovId=id; this._wake(); } };
    п.onmouseleave=()=>{ this._hovId=null; this._wake(); };
    // колесо и жесты над панелью — её собственные, граф под ней не крутится
    п.onwheel=e=>e.stopPropagation(); п.onmousedown=e=>e.stopPropagation();
  }
  /* ПОТОК РАБОТЫ (аудит 2.1, «Поток 2.0» из demo_статусы-A.html, выбор КРОЛИКА 03.11.2026).
     Граф читается как речная система: связь — русло, по которому идёт работа. Здесь — счёт
     «ниже по течению» для каждой ноды: сколько незакрытых задач в её ветке, есть ли там работа
     и просрочка. Раз на сборку, а не в кадре: статус меняют через build(). Задача засчитывается
     себе и всем предкам по ref.parent (подъём ограничен — битый parent может замкнуться). */
  _flowStats(){
    const по=this.byId; let макс=1;
    this.nodes.forEach(n=>{ n._поток=null; });
    const стат=n=>n._поток||(n._поток={open:0, doing:false, over:false});
    this.nodes.forEach(c=>{
      if(!c.ref || c.type==="hub") return;
      const открыта=kindIsTask(c.type) && !c.done && c.ref.status!=="done" && !c.archived;
      const идёт=!!c.doing && !c.archived, горит=открыта && c.дней!=null && c.дней<0;
      const добавить=у=>{ if(открыта) у.open++; if(идёт) у.doing=true; if(горит) у.over=true; };
      добавить(стат(c));
      for(let p=c.ref.parent, k=0; p && по[p] && k<40; k++){ добавить(стат(по[p])); const у=по[p]; p=у.ref && у.ref.parent; }
    });
    this.nodes.forEach(n=>{ if(n._поток && n._поток.open>макс) макс=n._поток.open; });
    this._flowMax=макс;
    /* «спит» — на паузе сама нода или кто-то из её предков: связи в такую ветку гаснут.
       Решает БЛИЖАЙШИЙ явный статус снизу вверх: нода «в работе» (или с работающим предком
       ближе паузы) не спит, даже если выше по ветке пауза. Иначе взятая в работу задача под
       отложенным шотом рисовалась серым пунктиром со свечением работы (снимок КРОЛИКА, 03.11.2026). */
    this.nodes.forEach(n=>{ let спит=false;
      for(let у=n, k=0; у && k<40; k++){
        if(у.doing){ break; } if(у.paused){ спит=true; break; }
        const p=у.ref && у.ref.parent; у=p ? по[p] : null; }
      n._спит=спит; });
    /* КАКИЕ СВЯЗИ РИСУЕТ ПОТОК — решается здесь, раз на сборку, а не в кадре: обычные проходы
       _drawMain такие связи ПРОПУСКАЮТ (l._пот), и каждая ложится на холст одной линией. Прежде
       поток рисовал поверх уже нарисованной связи, стирая её destination-out чуть шире — и вырезал
       вместе с ней подсветку наведения и свечение ручных связей: у связей и пунктиров выходила
       чёрная обводка (КРОЛИК, 03.11.2026). Ребёнок — тот конец, чей родитель другой конец (или кто
       держится за хаб области): от родителя к нему течёт пунктир. */
    for(const l of this.links){ l._пот=null;
      const a=по[l.a], b=по[l.b]; if(!a||!b) continue;
      const реб = (a.ref && a.ref.parent===l.b) || b.type==="hub" ? a : (b.ref && b.ref.parent===l.a) || a.type==="hub" ? b : null;
      if(!реб || !реб._поток || реб.archived) continue;
      const ст=реб._поток;
      if(реб._спит) l._пот={вид:"спит", реб};
      else if(реб.waiting && !ст.doing) l._пот={вид:"ждёт", реб};
      else if(ст.open) l._пот={вид:"русло", реб, ст, ш:Math.round((1.2+4.6*Math.sqrt(ст.open/макс))*2)/2};   // шаг 0.5 px — иначе пачек столько же, сколько связей
    }
  }
  /* ТОПОГРАФИЯ РАБОТЫ — рельеф, где высота = открытая работа. Не сумма гауссиан по каждой
     клетке (на 950 нодах это сотни миллионов операций), а размазка нод в сетку мира с шагом
     24 и три прохода прямоугольного размытия по осям — то же гауссово пятно за O(клеток).
     Затем «бегущие квадраты» на восьми уровнях — отрезки складываются в Path2D по уровню.
     Вес: открытая задача 1, «в работе» 1.6; закрытое и спящее (пауза в ветке) — 0.3: низкие
     холмы, на которых сходятся только нижние, самые тусклые уровни. Равнина под закрытыми
     деревьями оставляла на холсте дыры без рельефа (КРОЛИК, 03.11.2026). */
  _topoBuild(){
    // все ноды, кроме служебных: дерево заметок без единой задачи тоже не должно быть дырой
    const ноды=this.nodes.filter(n=>n.ref && n.type!=="hub");
    const вес=n=>(!kindIsTask(n.type) || n.done||n.archived||n._спит) ? 0.3 : n.doing ? 1.6 : 1;
    this._topo={src:this.links, at:performance.now(), пути:[]};
    if(!ноды.length) return;
    const ШАГ=24, ЗАП=320;
    let x0=Infinity, y0=Infinity, x1=-Infinity, y1=-Infinity;
    ноды.forEach(n=>{ if(n.x<x0) x0=n.x; if(n.y<y0) y0=n.y; if(n.x>x1) x1=n.x; if(n.y>y1) y1=n.y; });
    x0-=ЗАП; y0-=ЗАП; x1+=ЗАП; y1+=ЗАП;
    const W=Math.min(600, Math.ceil((x1-x0)/ШАГ)+1), H=Math.min(600, Math.ceil((y1-y0)/ШАГ)+1);
    let П=new Float32Array(W*H), Б=new Float32Array(W*H);
    ноды.forEach(n=>{ const i=Math.round((n.x-x0)/ШАГ), j=Math.round((n.y-y0)/ШАГ);
      if(i>=0&&i<W&&j>=0&&j<H) П[j*W+i]+=вес(n); });
    const R=4;                                     // три прохода окна 2R+1 ≈ гаусс σ≈90 мировых единиц
    for(let проход=0; проход<3; проход++){
      for(let j=0;j<H;j++){ let с=0; for(let i=-R;i<W+R;i++){ if(i+R<W) с+=П[j*W+i+R]; if(i-R-1>=0) с-=П[j*W+i-R-1]; if(i>=0&&i<W) Б[j*W+i]=с; } }
      for(let i=0;i<W;i++){ let с=0; for(let j=-R;j<H+R;j++){ if(j+R<H) с+=Б[(j+R)*W+i]; if(j-R-1>=0) с-=Б[(j-R-1)*W+i]; if(j>=0&&j<H) П[j*W+i]=с; } }
    }
    let макс=0; for(let k=0;k<П.length;k++) if(П[k]>макс) макс=П[k];
    if(!макс) return;
    const УР=8;
    for(let у=1; у<=УР; у++){
      const lv=макс*(у/(УР+1)), путь=new Path2D();
      for(let j=0;j<H-1;j++) for(let i=0;i<W-1;i++){
        const a=П[j*W+i], b=П[j*W+i+1], c=П[(j+1)*W+i+1], d=П[(j+1)*W+i];
        const к=(a>lv?8:0)|(b>lv?4:0)|(c>lv?2:0)|(d>lv?1:0); if(!к || к===15) continue;
        const x=x0+i*ШАГ, y=y0+j*ШАГ;
        const t1=[x+ШАГ*(lv-a)/(b-a), y], t2=[x+ШАГ, y+ШАГ*(lv-b)/(c-b)], t3=[x+ШАГ*(lv-d)/(c-d), y+ШАГ], t4=[x, y+ШАГ*(lv-a)/(d-a)];
        const сег={1:[t3,t4],2:[t2,t3],3:[t2,t4],4:[t1,t2],5:[t1,t4],6:[t1,t3],7:[t1,t4],8:[t1,t4],9:[t1,t3],10:[t1,t2],11:[t1,t2],12:[t2,t4],13:[t2,t3],14:[t3,t4]}[к];
        if(сег){ путь.moveTo(сег[0][0], сег[0][1]); путь.lineTo(сег[1][0], сег[1][1]); }
      }
      this._topo.пути.push(путь);
    }
  }
  heatNext(){
    const m=this._горящие; if(!m||!m.length) return;
    this._жарИдx=((this._жарИдx==null?-1:this._жарИдx)+1)%m.length;
    const у=m[this._жарИдx]; if(у) this._flyTo(у);
  }
  _clearSearchDim(){
    this._searchMatches=[];   // поиска больше нет — подсветка при наведении снова работает (см. _hover)
    this._hovId=null;         // классы только что сняты мимо _hover: без сброса он счёл бы работу сделанной
    if(this.nodeEls) this.nodeEls.forEach(o=>{ o.g.classList.remove("dim"); o.g.classList.remove("hit"); });
    // возвращаем ИМЕННО базовую яркость из настроек, а не «1»: иначе поиск незаметно делал бы
    // все связи ярче, чем человек выставил ползунком
    if(this.linkEls) this.linkEls.forEach(e=>{ e.classList.remove("dim"); if(e._baseOp!=null) e.style.opacity=e._baseOp; });
  }
  closeSearch(){ clearTimeout(this._searchT); this._searchT=null;
    if(this._searchBox) this._searchBox.style.display="none"; this._clearSearchDim(); }
  copySelection(){
    const ids=[...this.selNodes].filter(id=>this.byId[id]&&this.byId[id].ref); if(!ids.length) return;
    const idset=new Set(ids);
    const items=ids.map(id=>{ const it=this.byId[id].ref, n=this.byId[id];
      /* areaAuto копируем ВМЕСТЕ с областью. Без него вставленная нода получала область как
         СВОЮ, хотя в оригинале она унаследована от родителя, — и тут же прицеплялась к хабу
         области отдельным лучом (см. build: нить к хабу тянется только от нод со своей областью). */
      return {_old:id, kind:it.kind, title:it.title, body:it.body, area:it.area, areaAuto:it.areaAuto===true,
        color:it.color||null, size:it.size||null,
        tags:(it.tags||[]).slice(), status:it.status, done:!!it.done, doneAt:it.doneAt||null, due:it.due||null, repeat:it.repeat||"none", priority:it.priority||0,
        flow:it.kind==="flow"?JSON.parse(JSON.stringify(it.flow||{})):null,
        // доска полотна живёт в S.boards, а не в самой ноде — копируем её отдельно,
        // иначе дубликат приезжал бы с пустым холстом
        board:it.kind==="flow"&&S.boards&&S.boards[it.id]?JSON.parse(JSON.stringify(S.boards[it.id])):null,
        // внутренний граф подграфа лежит в S.graphs по ключу от id ноды — у копии ключ будет
        // свой, поэтому содержимое переносим отдельно (новые id нодам выдаст subUnpack)
        sub:subPack(it.id),
        // поля ноды вместе с их содержимым: новые ключи выдаст fieldsUnpack при вставке
        pack:fieldsPack(it),
        // дом переносим смещением, как он и хранится; куда его приложить — решает pasteClip
        hx:it.hx, hy:it.hy,
        x:n.x, y:n.y }; });
    const links=(S.links||[]).filter(l=>idset.has(l[0])&&idset.has(l[1])).map(l=>[l[0],l[1],+l[2]||1]);
    graphClip={items,links}; toast("Скопировано: "+ids.length,{icon:"ti-copy"});
  }
  /* off — на сколько сдвинуть копии от оригиналов (Ctrl+V ставит рядом, 28 px; жест Ctrl+тащи
     просит 0: копия рождается ПОВЕРХ оригинала и сразу уезжает за рукой).
     тихо — не показывать тост: у жеста результат и так виден, а тост перебивал бы чужие.
     Возвращает {map, newIds}: жесту нужно знать, какая копия соответствует схваченной ноде. */
  /* КУДА КЛАСТЬ ВСТАВКУ. Ctrl+V раньше возвращал копии туда же, где лежали оригиналы (плюс
     28 px) — и если скопировал ветку в одном углу графа, а работаешь в другом, приходилось
     лететь обратно и тащить копии через полкарты (КРОЛИК, 07.09.2026).
     Теперь целимся под КУРСОР, а если его над холстом нет (вставили с клавиатуры, мышь ушла
     на панель) — в центр видимой области. Обе точки человек видит глазами, и копии появляются
     там, куда он смотрит. */
  _pasteAim(){
    const rc=this.svg.getBoundingClientRect();
    const с=this._hovScr;
    const внутри = с && с.x>=rc.left && с.x<=rc.right && с.y>=rc.top && с.y<=rc.bottom;
    /* _hovScr хранится как {x,y}, а _pt читает clientX/clientY — передать его как есть значило
       получить NaN и вставить копию в никуда (нода создавалась, тост врал «вставлено»). */
    return this._pt(внутри ? {clientX:с.x, clientY:с.y}
                           : {clientX:rc.left+rc.width/2, clientY:rc.top+rc.height/2});
  }
  pasteClip(off, тихо){
    if(!graphClip||!graphClip.items.length) return null; const map={}, newIds=[], пары=[];
    /* Смещение: заданное число — как есть (жест Ctrl+тащи просит 0, копия обязана родиться
       поверх оригинала и уехать за рукой). Не задано — это Ctrl+V, и тогда сдвигаем набор
       так, чтобы его СЕРЕДИНА оказалась в целевой точке: с краю набор ложился бы мимо. */
    let сдвиг={x:off||0, y:off||0};
    if(off==null){
      let sx=0, sy=0, n=0;
      graphClip.items.forEach(d=>{ if(d.x!=null){ sx+=d.x; sy+=d.y||0; n++; } });
      if(n){ const цель=this._pasteAim();
        сдвиг={x:Math.round(цель.x-sx/n), y:Math.round(цель.y-sy/n)}; }
      else сдвиг={x:28, y:28};
      off=0;
    }
    graphClip.items.forEach(d=>{
      const it=addItem({kind:d.kind,title:d.title,body:d.body,area:d.area,color:d.color,tags:(d.tags||[]).slice(),status:d.status,due:d.due,repeat:d.repeat,priority:d.priority});
      if(d.size) it.size=d.size;
      // область была унаследована — пусть такой и остаётся, иначе копия сама прицепится к хабу
      if(d.areaAuto===true) it.areaAuto=true;
      // согласуем done/status/doneAt (иначе вставленная выполненная задача = status:done но done:false)
      it.done=!!d.done;
      if(it.done){ it.status="done"; it.doneAt=d.doneAt||Date.now(); }
      else if(it.status==="done"){ it.status="todo"; it.doneAt=null; }
      if(d.kind==="flow"&&d.flow){ it.flow=JSON.parse(JSON.stringify(d.flow)); ensureFlow(it); }
      if(d.kind==="flow"&&d.board){ boardSet(it.id, JSON.parse(JSON.stringify(d.board))); }
      if(d.sub){ subUnpack(it.id, d.sub); }
      if(d.pack){ const поля=fieldsUnpack(d.pack); if(поля) it.fields=поля; }
      it.x=(d.x||0)+сдвиг.x; it.y=(d.y||0)+сдвиг.y;
      map[d._old]=it.id; newIds.push(it.id); пары.push({d,it});
    });
    graphClip.links.forEach(l=>{ const a=map[l[0]], b=map[l[1]]; if(a&&b) S.links.push([a,b,l[2]||1]); });
    persist(); recomputeHierarchy();
    /* ДОМ КОПИИ — СТРОГО ПОСЛЕ ПЕРЕСЧЁТА ИЕРАРХИИ, и поэтому не при создании ноды выше: до
       recomputeHierarchy у копии нет ни родителя, ни унаследованной области, и пересчёт домов
       внутри неё принял бы владельца ОРИГИНАЛА за прежнего — то есть аккуратно вернул бы копию
       на место оригинала, ровно поверх него.
       Владелец тоже попал в копию → смещение верно как есть, и вся ветка переезжает формой,
       сдвинутая на те же 28 px. Владельца в копии не было (скопировали одного ребёнка, или
       владелец — общий с оригиналом хаб области) → смещение указывало бы на чужого хозяина,
       и копия села бы оригиналу на голову. Тогда дом задаёт сам жест вставки — там, где копия
       и оказалась, как при создании ноды на холсте. */
    { const свои=new Set(newIds);
      пары.forEach(({d,it})=>{
        if(d.hx!=null && d.hy!=null && it.parent && свои.has(it.parent)){ it.hx=d.hx; it.hy=d.hy; }
        else if(S.settings.graphHome) this._homeFromDrag(it);
      }); }
    this.selNodes=new Set(newIds); this.build(); this._paintSel();
    if(!тихо) toast("Вставлено: "+newIds.length,{icon:"ti-clipboard-check"});
    return {map, newIds};
  }
  /* КОПИЯ ПРЯМО ЖЕСТОМ: Ctrl+тащи по выделенному — копии рождаются под рукой и едут за ней,
     оригиналы остаются на месте. Раньше размножить куст можно было только через Ctrl+C, Ctrl+V
     и отдельное перетаскивание пачки на место.
     Зовётся НЕ на нажатии, а при первом движении за порогом (см. onpointermove): создавать копию
     на клике значило бы плодить невидимые дубликаты поверх оригиналов у каждого, кто промахнулся
     мимо Ctrl. Буфер Ctrl+C на время жеста сохраняем и возвращаем: человек копировал в него
     своё, и жест не имеет права это стирать. */
  _startCopyDrag(){
    const вед=this.drag; if(!вед||!вед.ref) return false;
    const ids=(this.selNodes.has(вед.id) && this.selNodes.size>1) ? [...this.selNodes] : [вед.id];
    const былБуфер=graphClip;
    this.selNodes=new Set(ids); this.copySelection();
    const рез=this.pasteClip(0, true);        // 0 — копия точно поверх оригинала, тост не нужен
    graphClip=былБуфер;
    const нов=рез && рез.map ? this.byId[рез.map[вед.id]] : null;
    if(!нов){ return false; }                 // не получилось — жест продолжится с оригиналом
    // хват переносим на копии: старые объекты узлов только что пересоздал build внутри pasteClip
    вед._grabbed=false;
    if(this.dragMates) this.dragMates.forEach(м=>{ м.n._grabbed=false; });
    this.drag=нов; нов._moved=true; нов._grabbed=true;
    const мест=[];
    рез.newIds.forEach(id=>{ const m=this.byId[id];
      if(m && m!==нов){ m._grabbed=true; мест.push({n:m, dx:m.x-нов.x, dy:m.y-нов.y}); } });
    this.dragMates=мест.length?мест:null;
    this._dragHollowAreas=null;
    toast("Копия: "+рез.newIds.length,{icon:"ti-copy"});
    return true;
  }
  _startConnectDrag(n,e){ this.connectDrag=n.id; this._closePop(); const p=this._pt(e);
    this.tempLine.style.display=""; this.tempLine.setAttribute("x1",n.x); this.tempLine.setAttribute("y1",n.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y); }
  // быстрое создание ноды (kind: note/task/flow) в точке (wx,wy); fromId!=null → сразу связать;
  // note/task → инлайн-ввод названия (поток мысли не рвётся), flow → открываем редактор схемы
  _quickAdd(kind,wx,wy,fromId){
    // Область родителя НЕ наследуем: Alt от ноды, которая сама лежит в области, молча приписывал
    // новую мысль туда же — а человек всего лишь тянул связь, про область речи не было.
    // Область — отдельное решение: бросить ноду на её кружок (см. _linkTo).
    // Цвет тоже не копируем: новая нода сразу связана с родителем, а значит подхватит его цвет
    // вычислением в build() — и будет подхватывать дальше, пока человек не назначит свой.
    /* Фильтр области подставляем ТОЛЬКО когда ноду заводят саму по себе (пустое место холста):
       человек смотрит область — туда и кладём. При протяжке ОТ НОДЫ (Alt) область не назначаем
       вовсе: жест про связь с родителем, про область речи не было. Раньше фильтр действовал и
       здесь — стоило один раз щёлкнуть по области в полосе, и каждая новая мысль молча
       приписывалась к ней, а дети наследовали это дальше по ветке. */
    const data={kind, title:"", area:(fromId ? null : (areaFilter||null))};
    if(kindIsTask(kind)) data.status="todo";
    // шаблон по умолчанию: нода рождается сразу с нужными полями (название человек впишет сам).
    // Шаблоны бывают только задачные и заметочные — полотну и подграфу подставлять нечего.
    if(kind==="note"||kind==="task"){ const з=templateSeed(templateDefault(), kind); if(з && з.fields.length) data.fields=з.fields; }
    const it=addItem(data);
    it.x=Math.round(wx); it.y=Math.round(wy); persist();
    if(fromId) addLink(fromId, it.id);
    recomputeHierarchy();
    /* Дом там, где создали. Считаем ПОСЛЕ пересчёта иерархии: до него у новой ноды нет ни
       родителя, ни унаследованной области — то есть нет владельца, от которого меряется дом. */
    if(S.settings.graphHome && this._homeFromDrag(it)) persist();
    this.build();
    // полотно тоже сразу переименовывается на месте, а не выдёргивает в фулскрин доски —
    // доска открывается только по явному открытию ноды (двойной клик и т.п.)
    this._inlineRename(it.id);
  }
  // меню «Создать» по ПКМ на пустом месте холста — заметка / задача / схема в точке клика
  _openCreateMenu(e){
    this._closePop(); const wrap=$("#graph-wrap"); if(!wrap) return; const rc=this.svg.getBoundingClientRect(); const wp=this._pt(e);
    const pop=el("div","g-ctx"); pop.id="node-pop";
    pop.innerHTML=`
      <div class="np-ttl"><i class="ti ti-plus"></i> Создать здесь</div>
      <div class="np-col">
        <button class="btn" data-mk="note"><i class="ti ${kindIcon("note")}"></i>Заметка</button>
        <button class="btn" data-mk="task"><i class="ti ${kindIcon("task")}"></i>Задача</button>
        <button class="btn" data-mk="flow"><i class="ti ${kindIcon("flow")}"></i>Полотно</button>
        <button class="btn" data-mk="sub"><i class="ti ${kindIcon("sub")}"></i>Подграф</button>
        ${/* Внутри подграфа областей нет (см. SUB_PREFIX в core.js) — и кнопки тоже: пункт
             меню, который отказывает после нажатия, хуже отсутствующего. */""}
        ${inSubGraph()?"":`<button class="btn" data-mk="area"><i class="ti ti-circle-dot"></i>Область</button>`}
      </div>`;
    wrap.appendChild(pop);
    const pw=pop.offsetWidth||180, ph=pop.offsetHeight||170;
    let px=e.clientX-rc.left+6, py=e.clientY-rc.top+6;
    px=Math.max(8,Math.min(px,rc.width-pw-8)); py=Math.max(8,Math.min(py,rc.height-ph-8));
    pop.style.left=px+"px"; pop.style.top=py+"px";
    $$("[data-mk]",pop).forEach(b=>b.onclick=()=>{
      const k=b.dataset.mk; this._closePop();
      // область — не нода паутины, а её хаб: заводим через тот же редактор, что и в полосе слева
      if(k==="area"){ openAreaEditor(null, ()=>{ renderNav(); this.build(); }); return; }
      this._quickAdd(k,wp.x,wp.y,null);
    });
  }
  _inlineRename(id){
    const n=this.byId[id]; if(!n) return; const wrap=$("#graph-wrap"); if(!wrap) return;
    const old=wrap.querySelector(".g-inline"); if(old) old.remove();
    /* Корень подграфа переименовывается ТОЙ ЖЕ строкой на холсте, но пишет в ноду-владельца
       (она в соседнем графе — своего названия у корня нет, он берёт живое, см. build). */
    const цель = n.ref || n.subOwner || null; if(!цель) return;
    const inp=document.createElement("input"); inp.className="g-inline"; inp.value=цель.title||""; inp.placeholder="Название…";
    wrap.appendChild(inp);
    const m=this.root.getScreenCTM(); if(m){ const pt=this.svg.createSVGPoint(); pt.x=n.x; pt.y=n.y; const sp=pt.matrixTransform(m); const rc=wrap.getBoundingClientRect(); inp.style.left=(sp.x-rc.left)+"px"; inp.style.top=(sp.y-rc.top)+"px"; }
    const commit=(save)=>{ if(inp._done) return; inp._done=true; const v=inp.value.trim();
      if(save){ if(n.ref){ n.ref.title=v||"Новая заметка"; touch(n.ref); persist();
        /* Умный захват жил только на верхней строке, а нода с графа проходила мимо него.
           По настройке разбираем и её — сырьё то же самое, введённое название. Пустое имя
           не отдаём: разбирать «Новая заметка» бессмысленно, модель придумает чушь. */
        if(v && S.settings.aiGraphSuggest===true && typeof aiRefineCapture==="function") aiRefineCapture(n.ref, v);
      }
      /* Переименование КОРНЯ пишет в ноду-владельца, лежащую в соседнем графе, и потому идёт
         своей веткой: ИИ-разбор ей не нужен (это не новая мысль, а имя раздела), а пустое имя
         не превращаем в «Новую заметку» — у подграфа остаётся имя его графа (см. build). */
      else if(n.subOwner){ n.subOwner.title=v; touch(n.subOwner); if(n.subRoot) n.subRoot.name=v||n.subRoot.name; persist();
        // крошки рисует renderNotes, а build их не трогает — правим последнюю на месте
        const кр=$("#g-crumbs .g-crumb.on span"); if(кр) кр.textContent=v||"без названия"; } }
      else if(n.ref && !(n.ref.title||"").trim()){ hardDeleteItem(n.ref.id); recomputeHierarchy(); }   // Escape по только что созданной пустой → убрать ноду-сироту (и связь)
      inp.remove(); this.build(); };
    inp.onkeydown=(ev)=>{ ev.stopPropagation(); if(ev.key==="Enter"){ ev.preventDefault(); commit(true); } else if(ev.key==="Escape"){ ev.preventDefault(); commit(false); } };
    inp.onblur=()=>commit(true);
    setTimeout(()=>{ inp.focus(); inp.select(); },20);
  }
  /* Удаление области — ОДНА точка входа для кнопки в поп-апе хаба и для Delete по выделенному
     хабу: подтверждение то же самое, поведение не должно разъезжаться по тому, откуда позвали. */
  async _deleteArea(a){
    const занято=S.items.filter(i=>i.area===a.id && !i.deleted).length;
    const ок=await uiConfirm(занято
      ? `Удалить область «${a.name}»? Ноды (${занято}) останутся, но потеряют область.`
      : `Удалить область «${a.name}»?`, {danger:true, title:"Удаление области", okLabel:"Удалить"});
    if(!ок) return false;
    S.items.forEach(i=>{ if(i.area===a.id){ i.area=null; delete i.areaAuto; } });
    S.areas=S.areas.filter(x=>x.id!==a.id);
    if(areaFilter===a.id) areaFilter=null;
    recomputeHierarchy(); persist(); renderNav(); this.build();
    toast("Область удалена",{icon:"ti-trash"});
    return true;
  }
  async deleteSelected(){
    const выбор=[...this.selNodes];
    const ids=выбор.filter(id=>this.byId[id] && this.byId[id].ref);      // заметки/задачи/схемы
    /* ХАБЫ — ОТДЕЛЬНО, тем же путём, что кнопка «Удалить область» в поп-апе (с тем же
       подтверждением: снос области — не то действие, которое можно отменить тостом «Вернуть»,
       как обычная нода, поэтому спрашиваем явно, а не удаляем молча по одной клавише). */
    /* КОРЕНЬ ПОДГРАФА НЕ УДАЛЯЕТСЯ — и не «запрещён кнопкой», а физически: его нет в S.items,
       удалять нечего. Молча пропустить его тоже нельзя: выделил рамкой всё, нажал Delete —
       и надо понимать, почему один узел остался. */
    const корни=выбор.filter(id=>isRootId(id) && this.byId[id]);
    if(корни.length){ корни.forEach(id=>this.selNodes.delete(id)); this._paintSel();
      if(выбор.length===корни.length){ toast("Корень подграфа удалить нельзя — он и есть сам подграф",{icon:"ti-lock"}); return; } }
    const хабы=выбор.filter(id=>id.indexOf("hub_")===0 && this.byId[id]);
    for(const hid of хабы){
      const a=areaById(hid.slice(4)); if(!a) continue;
      this.selNodes.delete(hid);
      await this._deleteArea(a);
    }
    if(!ids.length) return;
    /* ПОДГРАФ С СОДЕРЖИМЫМ СПРАШИВАЕТ ЯВНО. Обычную ноду видно целиком, и клавиша Delete с
       тостом «Вернуть» — честный размен. У подграфа за одной шестиугольной точкой стоит целый
       граф, которого на экране в этот момент НЕ ВИДНО: без вопроса человек сносит десятки нод
       одним нажатием, не подозревая об этом. Вернуть по-прежнему можно — и тостом, и Ctrl+Z
       (внутренний граф уезжает в карман удалённых, см. trashKeep). */
    { const тяжёлые=ids.map(id=>this.byId[id].ref)
        .filter(it=>it && it.kind==="sub" && ((subGraphOf(it.id)||{items:[]}).items||[]).length);
      if(тяжёлые.length){
        const нод=тяжёлые.reduce((s,it)=>s+((subGraphOf(it.id)||{items:[]}).items||[]).length,0);
        const ок=await uiConfirm(тяжёлые.length===1
          ? `Внутри подграфа «${(тяжёлые[0].title||"без названия").trim()}» — нод: ${нод}. Они удалятся вместе с ним.`
          : `В выделении подграфов: ${тяжёлые.length}, внутри них нод: ${нод}. Они удалятся вместе с ними.`,
          {danger:true, title:"Удалить вместе с содержимым?", okLabel:"Удалить"});
        if(!ок) return;
      } }
    // снимаем ноды ВМЕСТЕ СО СВЯЗЯМИ: иначе «Вернуть» отдало бы их висящими в пустоте
    const пакет=deletePack(ids); this.selNodes.clear(); recomputeHierarchy(); this.build();
    toast(ids.length>1?ids.length+" удалено":"Удалено",{icon:"ti-trash",label:"Вернуть",
      onAction:()=>{ restorePack(пакет); render(); }});
  }
  build(){
    const NS="http://www.w3.org/2000/svg";
    // отменяем прошлый цикл анимации, иначе каждый build() плодит новый rAF-цикл → лаги
    this._cancelFrame();
    this._hovId=null;   // элементы пересоздаются, классов наведения на них нет (см. _hover)
    this.W=this.svg.clientWidth||900; this.H=this.svg.clientHeight||500;
    this.svg.setAttribute("viewBox",`0 0 ${this.W} ${this.H}`);
    // фон-canvas «точечное поле» за графом, привязан к пану/зуму
    this.bgCanvas=this.svg.parentNode?this.svg.parentNode.querySelector(".graph-bg-canvas"):null;
    // ФОН — ЧЕРЕЗ WEBGL. Замерено: canvas2d линейно упирается в ЧИСЛО вызовов отрисовки
    // (~0.73 мкс на drawImage), поэтому 6 000 звёзд стоили 4.1 мс кадра, 12 000 — 11.25 мс, и
    // приложение сыпалось, когда GPU занят другой программой. В WebGL всё поле слоя рисуется
    // ОДНИМ вызовом, а дрейф/мерцание считает шейдер: 0.008 мс на 6 000 звёзд (и столько же на
    // 30 000). Микрооптимизации 2d-пути (alpha, масштаб, тригонометрия) давали лишь 7-9% — дело
    // было именно в количестве вызовов. Нет WebGL — откатываемся на прежний путь canvas2d.
    /* GL-состояние живёт вместе с canvas, а НЕ с вызовом build(). build() дёргается на каждую
       правку ноды, связь и движение ползунка — а _initBgGL компилирует два шейдера, линкует
       программу, заливает буфер на 20 000 вершин и делает самопроверку с синхронным readPixels.
       getContext на том же canvas возвращает ТОТ ЖЕ контекст, поэтому прежняя программа и буфер
       не освобождались, а копились в драйвере. Теперь инициализация одна на canvas. */
    this.bgGL=null;
    if(this.bgCanvas){
      const c=this._glCache;
      if(c && c.cv===this.bgCanvas && c.st && !c.st.gl.isContextLost()){ this.bgGL=c.st; }
      else{
        try{ this.bgGL=this._initBgGL(this.bgCanvas); }
        catch(e){ this.bgGL=null; console.warn("[graph] WebGL недоступен — фон графа отключён:", e); }
        this._glCache={cv:this.bgCanvas, st:this.bgGL};
      }
    }
    this.glowCanvas=this.svg.parentNode?this.svg.parentNode.querySelector(".graph-glow-canvas"):null;   // слой цветной подсветки «в работе»
    this.glowCtx=this.glowCanvas?this.glowCanvas.getContext("2d"):null;
    /* РЕЖИМ ОТРИСОВКИ. «svg» — как было всегда, «canvas» — узлы и связи рисуются на холсте, а
       SVG-элементы не создаются вовсе. Замер на тестовом графе КРОЛИКА (654 узла): кадр 47 мс,
       из них наш код 9, остальные 38 — пересчёт стилей и раскладки для четырёх с лишним тысяч
       SVG-элементов. Убрать эти 38 мс можно только одним способом — не создавая элементы.
       Настройка переключается на лету и ничего не меняет в данных: откат — та же галочка. */
    this.canvasMode = (S.settings.graphRender==="canvas");
    this.mainCanvas=this.svg.parentNode?this.svg.parentNode.querySelector(".graph-main-canvas"):null;
    this.mainCtx=this.mainCanvas?this.mainCanvas.getContext("2d"):null;
    if(this.mainCanvas) this.mainCanvas.style.display=this.canvasMode?"block":"none";
    this._пал=null;   // палитра из CSS перечитывается на каждую сборку: тема могла смениться
    this._bgReduce=!!(window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if(graphCam[this._графID]){ this.tx=graphCam[this._графID].tx; this.ty=graphCam[this._графID].ty; this.zoom=graphCam[this._графID].zoom; }   // восстановить камеру ДО размещения (для центра вида)
    const cx=this.W/2, cy=this.H/2;
    // сохраняем текущие позиции узлов, чтобы при перестроении (смена цвета/связи) граф не «прыгал»
    const prev=this.byId||{};
    /* Прогибы связей тоже переживают перестроение. Массив связей пересоздаётся целиком, и вместе
       с ним терялось накопленное состояние дуг: любое build() (смена статуса задачи, цвета,
       новая связь) распрямляло все линии и заставляло их отрастать заново — это читалось как
       рывок. Переносим по паре концов; сменился порядок концов — просто начнём с нуля. */
    const прежниеДуги={};
    (this.links||[]).forEach(l=>{ if(l._bendC) прежниеДуги[l.a+"|"+l.b]=l._bendC; });
    this.nodes=[]; this.links=[]; this.byId={};
    // area hubs (можно закреплять и таскать, позиция/пин хранятся на самой области)
    S.areas.forEach((a,i)=>{
      const ang=(i/S.areas.length)*Math.PI*2;
      // ЖИВАЯ позиция (prev) важнее сохранённой. Раньше было наоборот, и это ломало граф:
      // перетаскивание поднимает alpha, физика раскладывает узлы, а на диск они попадают только
      // когда симуляция ОСТЫНЕТ (~5 с, см. _tick). Любой build() в это окно — создал ноду, удалил
      // ноду — откатывал ВЕСЬ граф к последним сохранённым координатам. Сохранённая нужна только
      // как запасной вариант: при первой сборке и после перезапуска prev пуст.
      const p=prev["hub_"+a.id];
      const x = p ? p.x : (a.x!=null?a.x:cx+Math.cos(ang)*90);
      const y = p ? p.y : (a.y!=null?a.y:cy+Math.sin(ang)*90);
      this.nodes.push({id:"hub_"+a.id, hubArea:a, label:a.name, type:"hub", r:11, fixed:!!a.pin, color:areaColor(a.id),
        x, y, vx:0, vy:0, _fresh:(a.x==null && !p)});
    });
    /* КОРЕНЬ ПОДГРАФА — один служебный узел, которого нет в S.items (см. ROOT_PREFIX в core.js).
       Удалить его нечем физически: удалять просто нечего. Имя берёт ЖИВОЕ, у самой ноды-владельца
       (как пустышка берёт имя области) — переименовал подграф снаружи, и корень тут же подхватил.
       Крупнее хаба области (13 против 11): он один на весь холст и отвечает на вопрос «где я». */
    const _влГраф=graphCurrent(), _вл=graphOwnerOf(_влГраф);
    if(_вл){
      const rid=subRootId(_вл.item.id);
      const p=prev[rid];
      const x = p ? p.x : (_влГраф.x!=null ? _влГраф.x : cx);
      const y = p ? p.y : (_влГраф.y!=null ? _влГраф.y : cy);
      /* МЕСТО КОРНЯ ЗАКРЕПЛЯЕМ СРАЗУ, а не когда его первый раз потянут рукой. Дом служебного
         узла — это его собственные x/y в данных (см. _tick), и пока их нет, дома у корня нет
         тоже: физика таскала его за первой же прицепленной нодой, будто он рядовой узел
         (КРОЛИК, 06.09.2026). У хаба области это терпимо — их много и они равноправны, — а
         корень подграфа один и он точка отсчёта: ему стоять положено с первой секунды. */
      if(_влГраф.x==null || _влГраф.y==null){ _влГраф.x=Math.round(x); _влГраф.y=Math.round(y); persist(true); }
      this.nodes.push({id:rid, subRoot:_влГраф, subOwner:_вл.item,
        label:(_вл.item.title||"").trim()||_влГраф.name||"Подграф",
        type:"hub", r:13, fixed:!!_влГраф.pin, color:_вл.item.color||_влГраф.color||null,
        x, y, vx:0, vy:0, _fresh:(_влГраф.x==null && !p)});
    }
    // На холсте — только РАЗМЕЩЁННЫЕ ноды. Нет координат (x==null) = мысль ещё не разобрана:
    // она лежит в лотке и ждёт, пока её вытянут на холст (см. _renderTray). Это не новое поле —
    // элемент и так рождается без координат (model.js), раньше граф просто выдумывал их за человека,
    // сажая ноду в центр вида. Ставит координаты только сам человек, бросив ноду из лотка.
    // Важно: неразмещённые не попадают в this.nodes, поэтому _tick до них не дотянется и не
    // запишет им позицию при остывании раскладки — метка «в лотке» не сотрётся сама собой.
    const onGraph=S.items.filter(it=>inWeb(it) && it.x!=null);
    // потухание: ЗАДАЧА тухнет по своему done (незавершённая подзадача остаётся яркой).
    // ЗАМЕТКА/СХЕМА статуса не имеют → наследуют завершённость от родителя (тухнут в завершённой ветке).
    const _onIds=new Set(onGraph.map(i=>i.id));
    const _byIdIt=id=>S.items.find(i=>i.id===id);
    const _fMemo=new Map();
    const _isFaded=it=>{
      if(_fMemo.has(it.id)) return _fMemo.get(it.id);
      _fMemo.set(it.id,false);   // защита от циклов в иерархии
      let res;
      if(kindIsTask(it.kind)) res=!!it.done;
      else { const pid=(it.parent&&_onIds.has(it.parent))?it.parent:null; res=pid?_isFaded(_byIdIt(pid)):false; }
      _fMemo.set(it.id,res); return res;
    };
    const _todayT=(typeof today==="function")?+today():0;
    onGraph.forEach(it=>{
      // Живая позиция важнее сохранённой — см. коммент у хабов выше. Сюда доходят только
      // размещённые (it.x!=null), поэтому запасной вариант — просто it.x, без выдумывания места.
      const p=prev[it.id];
      const x = p ? p.x : it.x, y = p ? p.y : it.y;
      const ts=itemTagStyle(it);
      const arch=_isFaded(it);
      /* ПОТУХШЕЕ НЕ БЫВАЕТ НИ «В РАБОТЕ», НИ «НА ПАУЗЕ» (`!arch`, 2026-08-21). Своя завершённость
         есть только у задачи, а заметка и полотно тухнут ОТ РОДИТЕЛЯ (`_isFaded`), собственный
         статус при этом остаётся в данных. Из-за этого завершённый проект продолжал светиться
         серым паузным блобом изнутри (КРОЛИК: «если задача завершена, она не может оставаться
         на паузе» — «свечение вижу»). Статус в данных НЕ трогаем: вернут ветку в работу — вернётся
         и прежняя картина; гасим только признаки живой работы. */
      /* ПРИЗНАКИ ЖИВОЙ РАБОТЫ СЧИТАЮТСЯ ОДИНАКОВО ДЛЯ ЛЮБОГО ВИДА (2026-09-01). Раньше «в работе»
         требовало kind==="task", а «на паузе» — нет, и это давало живой перекос: в файле КРОЛИКА
         четыре заметки со статусом «в работе» не показывались на графе НИКАК, а одна заметка «на
         паузе» показывалась. Статусы заметке ставились и ставятся (кнопка «На паузу» есть у
         любого вида, а групповая смена статуса пишет во всё выделение) — значит и показывать их
         надо одинаково. Условие !arch общее: потухшее не бывает ни в работе, ни в ожидании. */
      const рабочий = !it.done && !arch && !!(СТАТУСЫ[it.status]||{}).рабочий;
      const doing   = рабочий && it.status==="doing";
      const paused  = рабочий && it.status==="paused";
      const waiting = рабочий && it.status==="waiting";   // ждём не себя: ферма считает, супервайзер смотрит
      const next    = рабочий && it.status==="next";      // взято на ближайший заход
      const review  = рабочий && it.status==="review";    // сдано, ждёт приёмки — может вернуться с правками
      /* Число дней до срока считаем ЗДЕСЬ, а не в кадре: parseYmd+daysBetween на 245 нод — копейки
         раз в пересборку, но те же вызовы 60 раз в секунду уже статья расхода кадра. */
      const дней = (kindIsTask(it.kind) && !it.done && it.due) ? daysBetween(parseYmd(it.due), today()) : null;
      /* ПОДПИСЬ ПУСТЫШКИ — ВСЕГДА ЖИВОЕ ИМЯ ОБЛАСТИ, а не застывший title. Пустышка это та же
         область, просто другая точка входа — переименуй область, и все её пустышки обязаны
         подхватить новое имя сразу, а не остаться со старым и не выглядеть осиротевшими. */
      const n={id:it.id, ref:it, label:it.hollow?(areaName(it.area)||it.title):it.title, type:it.kind, done:it.done, area:it.area,
        hollow:!!it.hollow,                       // пустышка: узел-развилка без содержимого
        archived:arch, doing:doing, paused:paused, waiting:waiting, next:next, review:review, status:it.status, дней:дней,
        /* У ПУСТЫШКИ ЦВЕТ ВСЕГДА ОТ ОБЛАСТИ. Она вспомогательная, а не самостоятельная нода:
           свой цвет сделал бы её ещё одной сущностью в глазах, тогда как её задача — быть
           продолжением области. Поэтому собственный цвет и цвет тега для неё не в счёт.
           ОБЫЧНЫЙ УЗЕЛ БЕРЁТ ЦВЕТ ОБЛАСТИ, ТОЛЬКО ЕСЛИ ОНА СВОЯ (areaAuto===false) — то есть
           это тот самый узел, которому область назначили явно (перетащили на хаб/пустышку).
           УНАСЛЕДОВАННУЮ область (areaAuto===true) сюда не пускаем: после recomputeHierarchy
           она стоит почти у КАЖДОГО узла ветки (наследуется от ближайшего предка по графу
           связей, а не по видимому дереву), и если разрешить ей давать цвет напрямую, каждый
           узел независимо пересчитывает «моя область — значит мой цвет», а не «спроси у
           соседа» — целая веточка внутри чужого по цвету дерева вдруг красится в цвет СВОЕЙ,
           отдельно найденной области, игнорируя цвет родителя, который стоит рядом и уже
           покрашен (КРОЛИК прислал скриншот: одна лиловая нода посреди оранжевого дерева).
           Унаследованный узел теперь остаётся БЕЗ цвета на этом шаге и получает его ниже —
           по цепочке от ближайшего цветного соседа (обычно это и есть родитель). */
        color: it.hollow ? (it.area?areaColor(it.area):null)
                         : (it.color || (ts&&ts.color) || (it.area&&it.areaAuto===false?areaColor(it.area):null) || null),
        tagStyle:ts,
        // пустышка почти с хаб размером (11): она про область целиком, а не про одну мысль,
        // и должна читаться сразу, а не теряться среди обычных листьев (r:7)
        r:(it.hollow?10:7), x, y, vx:0, vy:0, fixed:!!it.pin, _fresh:false};   // элемент на холсте всегда размещён (иначе он в лотке) — «свежих» среди них не бывает
      this.nodes.push(n);
    });
    // Фаза «дыхания» — от ID, а НЕ от индекса в массиве. Раньше было Math.sin(t + i*1.7): при
    // добавлении/удалении ноды build() пересобирает this.nodes, индексы съезжают (addItem кладёт
    // элемент в НАЧАЛО, model.js), у всех меняется фаза — и весь граф разом дёргался на 6-7 px.
    // Хеш от id даёт ту же фазу всегда: между build(), сессиями и перезапусками. Считаем здесь,
    // один раз за build, а не в _tick — иначе хеш строки × все ноды × 60 кадров в секунду.
    // Для Y — ОТДЕЛЬНЫЙ хеш: с одной фазой на обе оси все ноды пошли бы по одинаковой траектории.
    this.nodes.forEach(n=>{ this.byId[n.id]=n;
      n._ph=_phase(n.id)*Math.PI*2; n._ph2=_phase(n.id+"~y")*Math.PI*2; });

    // manual links first, remember pairs to dedupe auto area-links
    const pairs=new Set();
    S.links.forEach(l=>{ if(this.byId[l[0]]&&this.byId[l[1]]){ this.links.push({a:l[0],b:l[1],L:108,manual:true,lenMul:(+l[2]||1),src:l}); pairs.add(l[0]+"|"+l[1]); pairs.add(l[1]+"|"+l[0]); } });
    /* Нить к хабу области тянем только от нод с СОБСТВЕННОЙ областью. Унаследованная
       (areaAuto) нить не даёт — иначе вся ветка притягивалась бы к хабу лучами, и вместо
       дерева получался бы веер из центра. */
    /* ЛУЧ ИДЁТ К БЛИЖАЙШЕЙ ТОЧКЕ ОБЛАСТИ — к её хабу или к любой её ПУСТЫШКЕ. Пустышка для того
       и заводится, чтобы часть нод крепилась не через полграфа к центру, а к ближней развилке;
       заставлять человека перецеплять каждую ноду руками — работа, которую машина делает лучше.
       Принадлежность от этого не меняется: пустышка живёт в той же области.
       ГИСТЕРЕЗИС обязателен: узлы дрейфуют, и без него луч мигал бы между хабом и пустышкой на
       каждом кадре у всех, кто оказался ровно посередине. Прежний выбор держим, пока новый не
       окажется ближе на 15% (та же логика, что у прогиба связей). */
    const пустышки={};
    this.nodes.forEach(n=>{ if(n.hollow && n.area) (пустышки[n.area]=пустышки[n.area]||[]).push(n); });
    const прежний=this._якорь||{}; const якорь={};
    onGraph.forEach(it=>{
      const hub="hub_"+it.area;
      if(!(it.area && it.areaAuto!==true && this.byId[hub])) return;
      if(pairs.has(it.id+"|"+hub)) return;                       // ручная связь с хабом уже есть
      const я=this.byId[it.id]; if(!я || я.hollow===true){
        /* Пустышка крепится к ХАБУ, если только не создана явно ИЗ ДРУГОЙ ПУСТЫШКИ (см.
           _createHollow — hollowParent) — тогда цепляется К НЕЙ, образуя цепочку. Это
           ЯВНОЕ поле, не выбор по расстоянию: решение принято человеком в момент создания и
           не должно съезжать оттого, что облако узлов вокруг чуть сдвинулось физикой.
           Родитель мог исчезнуть (удалили) — тогда откатываемся на хаб, как раньше.
           hubLink — эта связь толще прочих (см. _drawMain): она держит на себе целую ветку
           узлов, и должна читаться иначе, чем нить к рядовому листу — не важно, до хаба она
           идёт или до родительской пустышки, роль та же. */
        const родПуст=it.hollowParent && this.byId[it.hollowParent];
        const цельПуст=(родПуст && родПуст.hollow && родПуст.area===it.area) ? it.hollowParent : hub;
        this.links.push({a:it.id,b:цельПуст,L:78,manual:false,hubLink:true,lenMul:(+it.arealen||1)}); якорь[it.id]=цельПуст; return; }
      const дист=(м)=>{ const dx=я.x-м.x, dy=я.y-м.y; return Math.sqrt(dx*dx+dy*dy); };
      let цель=hub, лучшее=дист(this.byId[hub]);
      (пустышки[it.area]||[]).forEach(p=>{ if(p.id===it.id) return;
        const d=дист(p); if(d<лучшее){ лучшее=d; цель=p.id; } });
      const был=прежний[it.id];
      if(был && был!==цель && this.byId[был] && дист(this.byId[был])<=лучшее*1.15) цель=был;
      if(pairs.has(it.id+"|"+цель)) { якорь[it.id]=цель; return; }  // с этой пустышкой уже связаны руками
      // длина нити до области — своя у каждой ноды (см. it.arealen в санитайзере core.js)
      this.links.push({a:it.id, b:цель, L:78, manual:false, lenMul:(+it.arealen||1)});
      якорь[it.id]=цель;
    });
    this._якорь=якорь;
    /* КОГО ДЕРЖИТ КОРЕНЬ ПОДГРАФА — множество считаем ЗДЕСЬ, один раз на сборку, а не в кадре:
       правило то же, что в subRootHolds (связан руками), но там оно стоит перебором связей, а
       в _tick этот вопрос задают каждой ноде каждый кадр. Связи меняются только через build. */
    { const rid=_вл?subRootId(_вл.item.id):null;
      this._уКорня = rid ? new Set((S.links||[]).filter(l=>Array.isArray(l)&&(l[0]===rid||l[1]===rid))
                                                .map(l=>l[0]===rid?l[1]:l[0])) : null; }
    /* Сохраняем то, чем пользуется живая переоценка якорей (_reevaluateAnchors) между сборками:
       список пустышек по областям, ручные пары (чтобы не спорить с явной связью человека) и
       флаг «есть ли вообще пустышки» — без него _tick тратил бы время на проверку каждый кадр
       на графах, где эта возможность не используется вовсе. */
    this._пустышкиПоОбласти=пустышки;
    this._ручныеПары=pairs;
    this._естьПустышки=Object.keys(пустышки).length>0;

    // вернуть накопленные прогибы: связь та же — пусть дуга продолжается, а не отрастает заново
    this.links.forEach(l=>{ const с=прежниеДуги[l.a+"|"+l.b]; if(с) l._bendC=с; });

    this.adj={}; this.nodes.forEach(n=>this.adj[n.id]=new Set());
    this.links.forEach(l=>{ this.adj[l.a].add(l.b); this.adj[l.b].add(l.a); });

    /* ОСТРОВА — куски графа, не связанные между собой ничем. Дерево одной области — остров
       (её узлы сходятся к хабу лучами), дерево другой — отдельный остров, одинокая нода —
       остров из себя одной. Нужны физике: стягивание к центру считается ПО ОСТРОВУ, а не по
       всему графу (см. _tick), иначе два никак не связанных дерева медленно ехали друг к другу
       и слипались в кучу, сколько их ни разводи руками.
       Пересчитываем в build, а не каждый кадр: между сборками состав связей не меняется —
       живая переоценка якорей (_reevaluateAnchors) только перецепляет узел с хаба на пустышку
       ТОЙ ЖЕ области, то есть внутри своего острова. */
    const остров={}; let островов=0;
    for(let i=0;i<this.nodes.length;i++){
      const старт=this.nodes[i].id; if(остров[старт]!=null) continue;
      остров[старт]=островов;
      const стек=[старт];
      while(стек.length){
        const c=this.adj[стек.pop()]; if(!c) continue;
        c.forEach(сосед=>{ if(остров[сосед]==null){ остров[сосед]=островов; стек.push(сосед); } });
      }
      островов++;
    }
    this._остров=остров; this._островов=островов;

    /* ЦВЕТ ОТ СОСЕДА. Нода без своего цвета (и без тега/области) берёт цвет соседа — заново при
       каждой отрисовке, пока человек не назначит ей свой. Поэтому в палитре у неё честно горит
       прочерк: цвет одолжен, а не присвоен.
       Цвет идёт ПО ЦЕПОЧКЕ: одолживший красит следующего, тот — следующего, и так до конца ветки.
       Раздаём слоями (поиск в ширину от цветных нод), поэтому:
       - цвет достаётся от БЛИЖАЙШЕГО источника, а не от случайного;
       - циклы не зациклят: уже покрашенных не трогаем;
       Правило: побеждает БЛИЖАЙШИЙ источник, а при ничьей — смесь ничейных (mixColors, OKLab).
       То есть цепочка, висящая на красной ноде, красная целиком, а нода, стоящая ровно МЕЖДУ
       красной и синей, — промежуточная. Раздаём слоями, поэтому ближайший находится сам собой.
       Пробовал «смесь всех источников с весом 1/расстояние²» — не годится: на больших дистанциях
       веса сближаются (1/16 против 1/25 — это 61% на 39%), и источник в пяти шагах перекрашивал
       чужую ветку в розовый. А ограничение радиуса давало разрыв: нода за границей резко
       становилась чистого цвета.
       Область цвет НЕ одалживает и НЕ проводит сквозь себя: она источник, а не получатель.
       Иначе одна цветная заметка красила свою область снизу вверх, а та разносила этот цвет
       всем остальным своим детям — то есть работала мостом между несвязанными ветками.
       Хаб не красим — значит он не попадёт в слой, значит и дальше ничего не передаст. */
    const rcv=id=>{ const n=this.byId[id]; return n && n.type!=="hub"; };
    const paint=new Map();
    this.nodes.forEach(n=>{ if(n.color) paint.set(n.id,n.color); });   // источники: свой цвет / тег / область
    let layer=new Set(paint.keys());
    while(layer.size){
      const next=new Map();
      const add=(id,c)=>{ const a=next.get(id); if(a) a.push(c); else next.set(id,[c]); };
      this.links.forEach(l=>{
        if(layer.has(l.a) && !paint.has(l.b) && rcv(l.b)) add(l.b, paint.get(l.a));
        if(layer.has(l.b) && !paint.has(l.a) && rcv(l.a)) add(l.a, paint.get(l.b));
      });
      next.forEach((cols,id)=>paint.set(id, mixColors(cols)));   // пришло несколько с одного расстояния — смешиваем
      layer=new Set(next.keys());
    }
    this.nodes.forEach(n=>{ if(!n.color) n.color=paint.get(n.id)||null; });
    // размер узла по «популярности» (числу связей) — как в Obsidian: чем больше связей, тем крупнее
    this.nodes.forEach(n=>{
      const deg=this.adj[n.id].size;
      const nsz=(S.settings.graphNodeSize!=null?S.settings.graphNodeSize:1);    // глобальный множитель размера
      const dsc=(S.settings.graphDegScale!=null?S.settings.graphDegScale:1);    // насколько размер зависит от числа связей
      const tsz=(n.tagStyle&&n.tagStyle.size)?n.tagStyle.size:1;                 // множитель размера из тега
      const psz=(n.ref&&+n.ref.size?+n.ref.size:1)*tsz;                          // индивидуальный (it.size) × тег
      // корень подграфа стартует крупнее хаба области: он один на весь холст и отвечает «где я»
      if(n.type==="hub"){ n.r=((n.subRoot?14:11)+Math.min(deg*0.7*dsc,11))*nsz; }
      else { n.r=(6+Math.min(Math.sqrt(deg)*3*dsc,9))*nsz*psz; }
      if(n.type==="task"||n.type==="flow") n.r*=0.86;   // квадрат/ромб визуально крупнее круга той же r → ужимаем, чтобы размер отражал именно связи
      /* Приоритет виден и в паутине, а не только в списках: невыполненная важная задача
         крупнее обычной. Готовые не раздуваем — их важность уже в прошлом. */
      if(n.type==="task" && n.ref && !n.ref.done && n.ref.priority) n.r*=1+Math.min(+n.ref.priority,3)*0.13;
    });
    // завершённые уходят на второй план: сами ноды меньше, а связи ВНУТРИ ветки (оба конца потухли)
    // — короче (тот же множитель длины) и тусклее. Так дерево реально ужимается, а не только точки.
    const _doneScale=(S.settings.graphDoneScale!=null?S.settings.graphDoneScale:0.6);
    const _doneLen=(S.settings.graphDoneLinkLen!=null?S.settings.graphDoneLinkLen:0.6);
    if(_doneScale!==1) this.nodes.forEach(n=>{ if(n.archived) n.r*=_doneScale; });
    this.links.forEach(l=>{ const na=this.byId[l.a], nb=this.byId[l.b];
      const fa=na&&na.archived, fb=nb&&nb.archived, hubLink=(na&&na.type==="hub")||(nb&&nb.type==="hub");
      l.faded = !!(fa && fb);                              // оба конца потухли → тусклая связь целиком
      l.doneMul = ((fa||fb) && !hubLink) ? _doneLen : 1;   // короче при потухшем конце, НО связь с областью (hub) не трогаем
    });

    /* ЧТО ГОРИТ. Срочность вычисляется (urgency в core.js), а не берётся из поля: приоритет
       проставлен у 9 живых задач из 34, срок — у 2. Отбор здесь, в пересборке, а не в кадре.
       Потухшие исключаем до отбора: завершённая ветка гореть не может по определению. */
    const живые=S.items.filter(it=>{ const у=this.byId[it.id]; return kindIsTask(it.kind) && !it.deleted && !it.done && !(у&&у.archived); });
    const горящие=(typeof отобратьГорящие==="function") ? отобратьГорящие(живые, СРОЧНОСТЬ_ПРЕДЕЛ) : [];
    this._горящие=[];
    горящие.forEach((it,i)=>{
      const у=this.byId[it.id]; if(!у) return;
      у.жар=urgencyLevel(it, живые.filter(x=>x.parent===it.id).length) || 1;   // уровень 0 сюда не попадает: отбор уже отсёк
      у.ранг=i+1;                                                             // номер в очереди захода
      у._почему=urgencyReasons(it, живые.filter(x=>x.parent===it.id).length).slice(0,3).map(р=>р.т);
      this._горящие.push(у);
    });
    this._heatPanel();
    { const лг=$("#graph-wrap .graph-legend"); if(лг) лг.innerHTML=graphLegendHtml(); }   // счёт живёт вместе с графом
    this._flowStats();

    while(this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    this.root=document.createElementNS(NS,"g"); this.svg.appendChild(this.root);
    this.defs=document.createElementNS(NS,"defs"); this.root.appendChild(this.defs);
    this.linkG=document.createElementNS(NS,"g"); this.root.appendChild(this.linkG);
    this.nodeG=document.createElementNS(NS,"g"); this.root.appendChild(this.nodeG);
    this.tempLine=document.createElementNS(NS,"line"); this.tempLine.setAttribute("class","g-link temp"); this.tempLine.style.display="none"; this.linkG.appendChild(this.tempLine);

    // на каждую связь: прозрачная широкая линия-хитбокс + видимая линия сразу после неё
    // (порядок hit→link важен для селектора .g-hit:hover + .g-link; клики ловит только хитбокс)
    this.hitEls=[]; this.linkEls=[];
    const DIMC=getComputedStyle(document.body).getPropertyValue("--bd2").trim()||"#3a3a3a";   // цвет «потухшего» конца связи
    // в режиме canvas SVG-элементы не создаются вовсе — в этом и весь смысл режима
    if(!this.canvasMode) this.links.forEach((l,i)=>{
      const hit=document.createElementNS(NS,"path"); hit.setAttribute("class","g-hit"); hit.dataset.li=i;
      this.linkG.appendChild(hit); this.hitEls.push(hit);
      const e=document.createElementNS(NS,"path"); e.setAttribute("class","g-link"+(l.manual?" manual":"")+(l.faded?" faded":"")); e.dataset.li=i;
      const na=this.byId[l.a], nb=this.byId[l.b];
      // потухший конец связи «перетекает» в тусклый цвет (как потухшие ноды); яркий конец — свой цвет/белый
      const ea = na.archived ? DIMC : na.color;
      const eb = nb.archived ? DIMC : nb.color;
      if(l.faded){ /* оба конца потухли — целиком тусклая нейтральная линия (.g-link.faded) */ }
      else if(ea||eb){
        const NC=NEUTRAL(); const fea=ea||NC, feb=eb||NC;
        // inline style: presentation attrs lose to the stylesheet's .g-link rule
        if(fea!==feb){
          const gid="grad"+i; const grad=document.createElementNS(NS,"linearGradient");
          grad.setAttribute("id",gid); grad.setAttribute("gradientUnits","userSpaceOnUse");
          const s1=document.createElementNS(NS,"stop"); s1.setAttribute("offset","0%"); s1.setAttribute("stop-color",fea);
          const s2=document.createElementNS(NS,"stop"); s2.setAttribute("offset","100%"); s2.setAttribute("stop-color",feb);
          grad.appendChild(s1); grad.appendChild(s2); this.defs.appendChild(grad);
          e.style.stroke="url(#"+gid+")"; l._grad=grad;
        } else { e.style.stroke = fea; }
      }
      if(!l.faded){ const lb=(S.settings.graphLinkBright!=null?S.settings.graphLinkBright:1);   // яркость обычных связей
        e.style.strokeWidth=(l.manual?1.8:1.3); e.style.opacity=Math.min(1,(l.manual?1:0.8)*lb); }
      else { e.style.opacity=(S.settings.graphFadedBright!=null?S.settings.graphFadedBright:0.5); }   // яркость потухших связей
      /* Яркость связи задана ИНЛАЙНОМ (она из настроек), а инлайн сильнее любого класса —
         поэтому .g-link.dim при поиске ничего не гасил, и линии оставались яркими поверх
         приглушённых нод. Запоминаем базу: поиск гасит от неё и ею же возвращает. */
      e._baseOp = e.style.opacity;
      this.linkG.appendChild(e); this.linkEls.push(e);
    });

    this.nodeEls=this.canvasMode?[]:this.nodes.map(n=>{
      /* Приоритет невыполненной задачи виден не только размером, но и цветом обводки:
         зелёный — низкий, жёлтый — средний, красный — высокий. Свечение при этом остаётся
         цветом ноды, поэтому принадлежность к области не теряется. */
      const пр = (n.type==="task" && n.ref && !n.ref.done && n.ref.priority) ? " pri"+Math.min(+n.ref.priority,3) : "";
      const g=document.createElementNS(NS,"g"); g.setAttribute("class","g-node "+n.type+(n.hollow?" hollow":"")+(n.done?" done":"")+(n.archived?" faded":"")+(n.doing?" doing":"")+(n.paused?" paused":"")+пр); g.dataset.id=n.id;
      if(n.color) g.style.setProperty("--nc", n.color);   // цвет ноды в CSS-переменную (для заливки «в работе» её же тоном и для подсветки)
      let halo=null;
      if(n.type==="hub"){ halo=document.createElementNS(NS,"circle"); halo.setAttribute("class","g-halo"); halo.setAttribute("r",n.r+5); if(n.color)halo.style.stroke=n.color; g.appendChild(halo); }
      /* Кольцо «на паузе» — ровное, серое, БЕЗ свечения: свечение занято нодами в работе, и
         второе светящееся состояние спорило бы с ним за внимание. Рисуем до фигуры, чтобы
         оно шло каймой, а не поверх содержимого. */
      if(n.paused){ const кп=document.createElementNS(NS,"circle"); кп.setAttribute("class","g-halo-pause");
        кп.setAttribute("r", (n.type==="square"||n.type==="task") ? n.r*1.41+4 : n.r+4); g.appendChild(кп); }
      // форма: из тега (если задана), иначе по типу ноды
      const shapeKind = this._shape(n);
      // Невидимый круг вокруг ноды — попадать мышкой в кружок радиусом 7 px неудобно.
      // Кладём ПОД фигуру: по центру события ловит сама фигура, по кайме — этот круг, и оба
      // всё равно всплывают до .g-node.
      // Запас — ПОСТОЯННЫЙ в мировых единицах, а не в долях от размера: доля давала мизерную
      // прибавку мелким нодам (размер настраивается от 0.4×), то есть ровно там, где промахи
      // и случаются. Считаем от дальней точки формы — у квадрата и ромба это угол (r*1.41),
      // у круга и шестиугольника сам радиус, — иначе у квадрата углы торчали бы за каймой.
      // дальняя точка формы: у квадрата и ромба это угол, у круга и шестиугольника — радиус
      const far = (shapeKind==="square"||shapeKind==="diamond") ? n.r*1.41 : n.r;
      let hit=null;
      if(n.type!=="hub"){
        hit=document.createElementNS(NS,"circle"); hit.setAttribute("class","g-nhit");
        hit.setAttribute("r", (far+HIT_PAD).toFixed(1));
        g.appendChild(hit);
      }
      /* Кольцо приоритета — ОТДЕЛЬНАЯ фигура чуть большего размера и тонкой линией: цвет
         самой ноды остаётся за областью, а срочность читается как ободок вокруг.
         Зелёный — низкий, жёлтый — средний, красный — высокий. */
      /* ШАПОЧКА приоритета — метка над нодой, повторяющая верхнюю часть её контура. Полное
         кольцо спорило с формой, точка читалась как посторонний объект, а шапочка выглядит
         частью самой ноды и растёт вместе с ней при наведении (см. .g-pri в styles.css). */
      let pri=null;
      if(пр){
        pri=document.createElementNS(NS,"path");
        pri.setAttribute("class","g-pri");
        g.appendChild(pri);
      }
      const shape = this._shapeEl(NS, shapeKind, n.r);
      shape.classList.add("sh-"+shapeKind);   // ромб поворачивается через CSS (см. .sh-diamond) — атрибут transform конфликтует с масштабом при наведении
      if(n.color && !n.archived){
        // inline style: presentation attrs lose to the stylesheet's .nd rules
        if(n.type==="hub"){ shape.style.fill=n.color; shape.style.stroke=n.color; }
        else if(n.type==="note"||n.type==="flow"){ shape.style.stroke=n.color; }
        else { shape.style.stroke=n.color; if(n.done) shape.style.fill=n.color; }
      }
      g.appendChild(shape);
      let check=null;
      if(kindIsTask(n.type) && n.done){ check=document.createElementNS(NS,"path"); check.setAttribute("class","g-check"); g.appendChild(check); }
      const pin=document.createElementNS(NS,"circle"); pin.setAttribute("class","g-pin"); pin.setAttribute("r",n.r+8); pin.style.display=n.fixed?"":"none";
      g.appendChild(pin);
      // иконка тега прямо в ноде (глиф шрифта Tabler)
      /* У ПОДГРАФА БЕЗ ТЕГА внутри стоит ЕГО значок: одной формы мало, чтобы понять, что за
         этой нодой прячется целый граф, — а именно это и надо знать, глядя на паутину.
         Тег важнее (постоянная классификация), завершённому подграфу глиф не ставим —
         там уже стоит галочка. */
      let ticon=null, ticonG=null;
      const глифНоды=(n.tagStyle&&n.tagStyle.icon) ? n.tagStyle.icon
                    : n.subRoot ? kindIcon("sub")                       // корень подграфа помечен тем же значком, что и сама нода снаружи
                    : (n.type==="sub" && !n.done) ? kindIcon("sub") : null;
      if(глифНоды){ const gl=iconGlyph(глифНоды);
        /* Глиф кладём в СВОЮ группу и двигаем её трансформацией, а сам текст стоит в нуле.
           Если менять x/y самого текста, браузер растеризует глиф заново на каждой позиции —
           отсюда дрожь при дрейфе и рывки при перетаскивании. Трансформация группы этого не
           вызывает, поэтому координаты можно оставить дробными и движение остаётся плавным. */
        if(gl){ ticonG=document.createElementNS(NS,"g"); ticonG.setAttribute("class","g-ticon-wrap");
          ticon=document.createElementNS(NS,"text"); ticon.setAttribute("class","g-ticon");
          ticon.setAttribute("text-anchor","middle"); ticon.setAttribute("x",0); ticon.setAttribute("y",0);
          ticon.textContent=gl;
          if(n.color && n.type!=="hub") ticon.style.fill=n.color;
          ticonG.appendChild(ticon); g.appendChild(ticonG); } }
      const t=document.createElementNS(NS,"text"); t.setAttribute("class","g-label"+(n.type==="hub"?" hub":"")); t.setAttribute("text-anchor","middle");
      const _lbl=(n.type!=="hub" && !(n.label||"").trim()) ? "(без названия)" : n.label;   // пустые ноды видимо подписываем, чтобы их можно было опознать и удалить
      t.textContent=_lbl.length>22?_lbl.slice(0,21)+"…":_lbl;
      if(_lbl==="(без названия)") t.classList.add("g-label-empty");
      g.appendChild(t);
      this.nodeG.appendChild(g);
      return {g, shape, pri, halo, check, pin, t, ticon, ticonG, hit, shapeKind, n};
    });
    this._wire();
    this._paintSel();   // вернуть подсветку выделения после перестроения
    if(graphCam[this._графID]){ this.tx=graphCam[this._графID].tx; this.ty=graphCam[this._графID].ty; this.zoom=graphCam[this._графID].zoom; }   // восстановить камеру → вьюпорт не прыгает при ребилде
    this._applyTransform();   // сразу ставим трансформу на новый корень (иначе кадр рисуется в (0,0) до первого пана)
    // первичная раскладка — полный «разогрев»; перестроение (цвет/связь) — лёгкое, чтобы граф не прыгал
    // плавный старт: позиции уже сохранены → не дёргаем (alpha 0); новые узлы мягко вписываются (0.12);
    // совсем новый граф — умеренный разогрев (0.4). Скорость клампится в _tick (плавный глайд без рывков),
    // а осевшая раскладка сохраняется (см. _moved) → следующее открытие статично, без повторного «взрыва».
    const freshN=this.nodes.filter(n=>n._fresh).length, placedN=this.nodes.length-freshN;
    this.alpha = placedN>0 ? (freshN>0 ? 0.12 : 0) : (this.nodes.length>1 ? 0.4 : 0);
    this._recalcWeight();  // вес веток — от него зависит длина связей (см. физику)
    this._recalcBends();  // сразу знаем, каким связям гнуться: иначе первый кадр рисует их прямыми
    this._renderTray();   // лоток всегда в такт с холстом: нода ушла на холст — исчезла из лотка
    this._tick(true);     // ОБЯЗАТЕЛЬНО рисуем: фигуры выше созданы без координат, пропуск кадра оставил бы граф пустым
  }
  /* ТОЧЕЧНАЯ ПРАВКА ПОДПИСИ — без полного build(). Раньше любая правка заголовка ноды в правой
     панели (после 400 мс дебаунса) гоняла build() целиком: тот заново пересобирает МАССИВЫ узлов
     и связей, красит всё дерево BFS'ом по соседям (_цвет от соседа) и пересчитывает точки
     крепления КАЖДОЙ ноды к пустышкам её области — хотя из всего этого от текста заголовка
     зависит только сама подпись. На 944 узлах это заметная лишняя работа на каждую паузу печати.
     Формула подписи — ТА ЖЕ, что в build() (см. выше, "label:it.hollow?..."): пустышка
     показывает имя области, а не свой title, поэтому правка title у пустышки может не изменить
     видимую подпись вовсе — это ожидаемо, а не баг патча. */
  _patchLabel(id, it){
    const n=this.byId[id]; if(!n) return false;   // ноды нет на холсте (в лотке) — патчить нечего
    n.label = n.hollow ? (areaName(n.area)||it.title) : it.title;
    if(!this.canvasMode && this.nodeEls){
      const o=this.nodeEls.find(x=>x.n.id===id);
      if(o && o.t){
        const _lbl=(n.type!=="hub" && !(n.label||"").trim()) ? "(без названия)" : n.label;
        o.t.textContent=_lbl.length>22?_lbl.slice(0,21)+"…":_lbl;
        o.t.classList.toggle("g-label-empty", _lbl==="(без названия)");
      }
    }
    this._wake();   // canvas-режим читает n.label прямо в кадре — будим цикл, чтобы кадр случился
    return true;
  }
  _circle(NS,r){ const c=document.createElementNS(NS,"circle"); c.setAttribute("class","nd"); c.setAttribute("r",r); return c; }
  _rect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",2.5); return s; }
  _rrect(NS,r){ const s=document.createElementNS(NS,"rect"); s.setAttribute("class","nd"); s.setAttribute("width",r*2); s.setAttribute("height",r*2); s.setAttribute("rx",r*0.55); return s; }   // нода-схема: скруглённый квадрат
  _hexagon(NS,r){ const p=document.createElementNS(NS,"polygon"); p.setAttribute("class","nd"); return p; }   // точки ставятся в _tick
  _shapeEl(NS,kind,r){ return kind==="square"?this._rect(NS,r) : kind==="diamond"?this._rrect(NS,r) : kind==="hexagon"?this._hexagon(NS,r) : this._circle(NS,r); }
  _hexPts(x,y,r){ let s=""; for(let i=0;i<6;i++){ const a=Math.PI/180*(60*i-90); s+=(x+r*Math.cos(a)).toFixed(1)+","+(y+r*Math.sin(a)).toFixed(1)+" "; } return s.trim(); }

  /* Путь ШАПОЧКИ — повтор верхней части контура ноды: у квадрата прямая черта над гранью,
     у шестиугольника два верхних ребра, у ромба его верхний угол, у круга дуга. Дуга
     окружности поверх квадрата смотрелась чужой: шапочка должна читаться как та же обводка. */
  _priPath(sk,x,y,r){
    const f=v=>v.toFixed(1);
    const зазор=5.5;                 // отступ метки от контура ноды
    const R=r+зазор;
    /* У квадрата метка — отдельная черта над гранью: по ширине вровень с ней (чуть уже),
       а не по описанной окружности, иначе линия торчала бы за края. */
    if(sk==="square"){ const w=r*0.92, t=y-r-зазор;
      return `M ${f(x-w)} ${f(t)} L ${f(x+w)} ${f(t)}`; }
    if(sk==="diamond"){
      // ромб — повёрнутый квадрат: верхняя вершина и по куску каждой из сходящихся граней
      const D=R*1.41, t=0.55;
      return `M ${f(x-D*t)} ${f(y-D*(1-t))} L ${f(x)} ${f(y-D)} L ${f(x+D*t)} ${f(y-D*(1-t))}`;
    }
    if(sk==="hexagon"){
      const p=deg=>{ const a=Math.PI/180*deg; return [x+R*Math.cos(a), y+R*Math.sin(a)]; };
      const A=p(-150), B=p(-90), C=p(-30);
      return `M ${f(A[0])} ${f(A[1])} L ${f(B[0])} ${f(B[1])} L ${f(C[0])} ${f(C[1])}`;
    }
    const a1=-Math.PI*0.8, a2=-Math.PI*0.2;
    return `M ${f(x+R*Math.cos(a1))} ${f(y+R*Math.sin(a1))} A ${f(R)} ${f(R)} 0 0 1 ${f(x+R*Math.cos(a2))} ${f(y+R*Math.sin(a2))}`;
  }

  _pt(e){
    /* НА ХОЛСТЕ КООРДИНАТЫ СЧИТАЕМ ПО КАМЕРЕ, а не по матрице SVG. Матрица живёт на корневой
       группе и обновляется в _applyTransform ради SVG-режима; на холсте эта группа пуста, и
       достаточно один раз изменить камеру мимо _applyTransform, чтобы попадание мышью уехало
       на сотни пикселей (так и вышло: клик по узлу приходился в пустоту за полторы тысячи px).
       Рисование холста идёт по tx/ty/zoom — попадание обязано считаться по ним же. */
    if(this.canvasMode){
      const rc=this.svg.getBoundingClientRect();
      const x=(e.clientX-rc.left)/rc.width*this.W, y=(e.clientY-rc.top)/rc.height*this.H;
      return { x:(x-this.tx)/this.zoom, y:(y-this.ty)/this.zoom };
    }
    // точное преобразование экранных координат в координаты графа через матрицу самого SVG
    // (учитывает viewBox, preserveAspectRatio, зум и пан) — иначе курсор «не совпадает» с точкой
    const m=this.root.getScreenCTM();
    if(m){ const pt=this.svg.createSVGPoint(); pt.x=e.clientX; pt.y=e.clientY; const p=pt.matrixTransform(m.inverse()); return {x:p.x, y:p.y}; }
    const rc=this.svg.getBoundingClientRect();
    const x=(e.clientX-rc.left)/rc.width*this.W, y=(e.clientY-rc.top)/rc.height*this.H;
    return { x:(x-this.tx)/this.zoom, y:(y-this.ty)/this.zoom };
  }
  _wire(){
    const svg=this.svg;
    svg.onpointerdown=(e)=>{
      this._wake();                      // цикл мог стоять в покое — жест обязан его разбудить
      if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; }   // прервать переезд камеры при ручном действии
      // средняя кнопка — пан. Запоминаем только ПРЕДЫДУЩЕЕ положение курсора: tx/ty и параллакс
      // двигаются приращениями (см. onpointermove), иначе зум колесом во время пана спорит с ним.
      if(e.button===1){ e.preventDefault(); this.panning={x:e.clientX,y:e.clientY}; svg.setPointerCapture(e.pointerId); this._closePop(); return; }
      if(e.button!==0) return;   // ПКМ обрабатывает oncontextmenu
      // кого схватили — спрашиваем у графа, а не у DOM: на холсте элементов нет (см. _hitNode)
      const попал=this._hitNode(e);
      if(попал){
        const n=this.byId[попал];
        if(this.linkFrom){ this._finishLink(n); return; }
        // Alt+тащи — связь / новая связанная заметка. От области тоже: бросок на ноду
        // назначает ей эту область, и тянуть связь оттуда так же естественно, как от ноды.
        if(e.altKey){ this._startConnectDrag(n,e); svg.setPointerCapture(e.pointerId); return; }
        if(e.shiftKey){ if(this.selNodes.has(n.id)) this.selNodes.delete(n.id); else this.selNodes.add(n.id); this._paintSel(); this._syncAside(); return; }   // shift-клик — в выделение
        if(!this.selNodes.has(n.id)){ this.selNodes.clear(); this.selNodes.add(n.id); this._paintSel(); }   // обычный клик по ноде — выделить
        /* ПРАВУЮ ПАНЕЛЬ ОБНОВЛЯЕТ ОТПУСКАНИЕ, А НЕ НАЖАТИЕ (см. pointerup). Раньше asideSelect
           стоял здесь, и на нём висели обе жалобы КРОЛИКА — «ноду хватаю, микрофризы» и
           «иногда мышка слетает, когда тяну ноду». ЗАМЕР обеих:
             • нажатие вместе с перерисовкой панели стоило 3.3 мс на ДЕМО с почти пустой
               панелью; на живой ноде с полями, картинками и досками это кратно дороже, и
               платится оно синхронно, в самом начале жеста — то есть ровно там, где заметно;
             • если панель была закрыта, клик по ноде её ОТКРЫВАЛ, холст сужался с 1178 до
               711 px прямо внутри обработчика, и точка под курсором уезжала на 233 px —
               нода выпрыгивала из-под руки. При уже открытой панели ширина не менялась и
               слёта не было, отсюда и «иногда».
           Ждать отпускания правильно и по смыслу: пока ноду тянут, в панель не смотрят. */
        // Смещение захвата: за какую точку ноды взялись. Без него нода при старте
        // перетаскивания прыгала центром под курсор — схватил за край, а она дёрнулась.
        this.drag=n; n._moved=false; this._dragFrom={x:e.clientX,y:e.clientY};
        { const p0=this._pt(e); this._grab={dx:n.x-p0.x, dy:n.y-p0.y}; }
        /* ГРУППОВОЙ ХВАТ: схватили одну из выделенных — едут все выделенные. Смещения снимаем
           ОДИН раз здесь, чтобы в кадре осталось только сложение: перебирать selNodes на каждое
           движение мыши значило бы платить за выделение из 50 нод на каждом кадре жеста.
           Клик по уже выделенной ноде выделение НЕ чистит (условие выше), поэтому группа
           доживает до pointerdown в целости.
           Признак хвата держим ФЛАГОМ НА НОДЕ (`_grabbed`, у ведущей тоже): физика в двух местах
           спрашивает «эта нода в руке?», и сравнения `n===this.drag` ей больше не хватает. */
        // Ctrl — тащим КОПИЮ. Само копирование отложено до первого движения (см. onpointermove):
        // на нажатии оно плодило бы дубликаты поверх оригиналов при простом Ctrl+клике
        this.copyDrag=e.ctrlKey && !e.altKey && !e.shiftKey;
        if(this.copyDrag) svg.style.cursor="copy";
        this.dragMates=null; n._grabbed=true;
        if(this.selNodes.size>1 && this.selNodes.has(n.id)){
          const мест=[];
          this.selNodes.forEach(id=>{ const m=this.byId[id];
            if(m && m!==n){ m._grabbed=true; мест.push({n:m, dx:m.x-n.x, dy:m.y-n.y}); } });
          if(мест.length) this.dragMates=мест;
        }
        /* Области пустышек, которые сейчас в руке: якоря им переоцениваются каждый кадр
           (см. _tick). Список собираем на старте — в кадре перебирать всю группу незачем. */
        this._dragHollowAreas=null;
        { const обл=new Set(); if(n.hollow) обл.add(n.area);
          if(this.dragMates) this.dragMates.forEach(m=>{ if(m.n.hollow) обл.add(m.n.area); });
          if(обл.size) this._dragHollowAreas=[...обл]; }
        svg.setPointerCapture(e.pointerId);
        return;
      }
      const li=this.canvasMode ? this._hitLink(e)
                               : (e.target.closest(".g-hit") ? +e.target.closest(".g-hit").dataset.li : -1);
      if(li>=0 && !this.linkFrom){ this._openLinkPop(this.links[li], e); return; }
      // ЛКМ по пустому — рамка выделения (пан теперь средней кнопкой)
      if(!e.shiftKey){ this.selNodes.clear(); this._paintSel(); }
      this._startMarquee(e); svg.setPointerCapture(e.pointerId); this._closePop();
    };
    /* КАЖДЫЙ ЖЕСТ, МЕНЯЮЩИЙ КАРТИНКУ, ОБЯЗАН БУДИТЬ ЦИКЛ. «Спящий» граф — это не остановленный
       цикл, а кадр, ОТЛОЖЕННЫЙ на ПОКОЙ_МС (160 мс) через setTimeout; досрочно его прерывает
       только _wake. Ветки ниже картинку меняют, но _wake не звали — они держались на том, что
       цикл разбудило нажатие. Держится это ровно до первого случая, когда цикл успел уснуть
       между событиями: тогда первое движение показывается с задержкой до шестой доли секунды,
       а потом нагоняет разом. Ровно то, что видно как «фриз, а потом телепорт».
       Ставим пробуждение ТОЛЬКО в ветки, которые реально что-то меняют: вести мышь по пустому
       холсту по-прежнему цикл не будит, иначе граф не уснёт никогда. */
    svg.onpointermove=(e)=>{
      /* ГДЕ КУРСОР — запоминаем ЭКРАННЫЕ координаты, а в мировые переводим только когда
         понадобятся (вставка). Перевод идёт через getScreenCTM, и звать его на каждое движение
         мыши ради пары чисел незачем: два присваивания стоят ничего. */
      this._hovScr={x:e.clientX, y:e.clientY};
      if(this.connectDrag){ const f=this.byId[this.connectDrag], p=this._pt(e);
        this.tempLine.setAttribute("x1",f.x); this.tempLine.setAttribute("y1",f.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y);
        const цель=this._hitNode(e); this._hover(цель&&цель!==this.connectDrag?цель:null); this._wake(); return; }
      if(this.marq){ this._updateMarquee(e); this._wake(); return; }
      if(this.drag){
        // Порог 4 px (системная константа Windows SM_CXDRAG): пока мышь не ушла дальше — это КЛИК,
        // ноду не двигаем. Без порога любая дрожь в 1 px считалась перетаскиванием: нода уезжала
        // (при отдалении — на несколько мировых px, т.к. мир = экран/zoom), а клик и двойной клик
        // не засчитывались вовсе. Отсюда же «двойной клик срабатывает через раз».
        if(!this.drag._moved){
          const f=this._dragFrom;
          if(f && Math.hypot(e.clientX-f.x, e.clientY-f.y) < 4) return;
          this.drag._moved=true;
          /* ТОЧКА «ДО» ДЛЯ ОТКАТА снимается ровно здесь — на пороге настоящей протяжки, пока
             нода ещё не сдвинулась (координаты меняются строкой ниже). Раньше по клику снимать
             нельзя: клик протяжкой не становится, и история заполнялась бы пустыми шагами. */
          this._layoutBefore=this.layoutSnap();
          /* Порог пройден — значит это настоящая протяжка, и копию создавать не рано.
             Шаг раскладки для копирования не нужен и мешает: копии рождаются вместе со своими
             координатами, их снимет обычный откат создания, а лишний шаг заставил бы жать
             Ctrl+Z дважды — сперва «копии прыгнули на место оригиналов», потом «исчезли». */
          if(this.copyDrag){ this.copyDrag=false; this._startCopyDrag(); this._layoutBefore=null; }
        }
        // тянем за ТУ ЖЕ точку, за которую взялись (см. _grab) — нода не прыгает центром под курсор
        const p=this._pt(e), g=this._grab||{dx:0,dy:0};
        this.drag.x=p.x+g.dx; this.drag.y=p.y+g.dy; this.drag.vx=0; this.drag.vy=0;
        /* Пассажиры едут ЖЁСТКО за ведущей, а не тянутся резинкой: группа держит форму, и по ней
           видно, куда её кладут. Стоимость кадра — одно сложение на ноду поверх готовых смещений;
           координаты в DOM/холст пишет тот же цикл _tick, что и всегда, поэтому плавность
           одиночного перетаскивания не меняется. */
        const М=this.dragMates;
        if(М) for(let i=0;i<М.length;i++){ const м=М[i], q=м.n;
          q.x=this.drag.x+м.dx; q.y=this.drag.y+м.dy; q.vx=0; q.vy=0; }
        this.alpha=Math.max(this.alpha,.4); this._wake(); return;
      }
      /* ПАН СЧИТАЕТСЯ ПРИРАЩЕНИЯМИ, а не от точки нажатия. Раньше tx/ty каждый раз пересчитывались
         абсолютно (`панинг.tx + весь путь курсора`), и стоило крутнуть колесо с зажатой средней
         кнопкой, как граф начинало кидать: зум меняет tx/ty каждый кадр, чтобы точка под курсором
         стояла на месте, а следующее же движение мыши затирало это своим абсолютным значением от
         устаревшей точки отсчёта. У полей появлялось два хозяина. Приращение просто складывается
         с чем угодно, поэтому зум и пан больше не спорят.
         Параллакс фона тоже стал приращением: раньше весь накопленный путь делился на ТЕКУЩИЙ зум,
         и смена зума посреди пана пересчитывала уже пройденное по новому масштабу. */
      if(this.panning){ const rc=svg.getBoundingClientRect();
        const dx=(e.clientX-this.panning.x)/rc.width*this.W, dy=(e.clientY-this.panning.y)/rc.height*this.H;
        this.panning.x=e.clientX; this.panning.y=e.clientY;
        this.tx+=dx; this.ty+=dy;
        this.bgPanX+=dx/this.zoom; this.bgPanY+=dy/this.zoom;   // пан двигает параллакс (в мировых ед.); зум — нет
        graphBgPan.x=this.bgPanX; graphBgPan.y=this.bgPanY;     // переживёт пересоздание графа (см. конструктор)
        this._applyTransform(); this._wake(); return; }
      if(this.linkFrom){ const p=this._pt(e); const f=this.byId[this.linkFrom]; this.tempLine.style.display=""; this.tempLine.setAttribute("x1",f.x); this.tempLine.setAttribute("y1",f.y); this.tempLine.setAttribute("x2",p.x); this.tempLine.setAttribute("y2",p.y); return; }
      const наведено=this._hitNode(e);
      this._hover(наведено);
      // курсор-рука над узлом: на SVG это делал CSS по .g-node, на холсте курсор ставим сами
      if(this.canvasMode) svg.style.cursor = наведено ? "pointer" : "default";
    };
    /* КУРСОР УШЁЛ С ХОЛСТА — снимаем наведение сами. Подсветку гасил только pointermove, а он
       за пределами холста не приходит вовсе: уводишь мышь в правую панель или за окно — нода
       остаётся гореть, а граф считает себя занятым (условие покоя смотрит на _hovId) и крутит
       полные кадры без конца, разогревая карту на пустом месте.
       Жесты не трогаем: во время перетаскивания, пана и рамки курсор законно уходит за край, а
       события продолжают идти через захват указателя. */
    svg.onpointerleave=()=>{
      if(this.drag||this.panning||this.marq||this.connectDrag||this.linkFrom) return;
      this._hover(null);
      if(this.canvasMode) svg.style.cursor="default";
    };
    svg.onpointerup=(e)=>{
      if(this.connectDrag){ const from=this.connectDrag; this.connectDrag=null; this.tempLine.style.display="none"; this._hover(null);
        const цель=this._hitNode(e);
        if(цель){ const msg=this._linkTo(from, цель); if(msg){ recomputeHierarchy(); this.build(); toast(msg); } }   // бросок на область назначает её (см. _linkTo)
        else {
          // отпустил на пустом → новая заметка + связь. Но ТОЛЬКО если отпустил над холстом:
          // курсор, уехавший за окно графа (на сайдбар, за край экрана), раньше всё равно
          // создавал безымянную ноду — в точке, которой не видно, и с полем переименования,
          // нарисованным мимо экрана. Найти её потом можно было только через «Одинокие ноды».
          const rc=svg.getBoundingClientRect();
          const inside = e.clientX>=rc.left && e.clientX<=rc.right && e.clientY>=rc.top && e.clientY<=rc.bottom;
          // Тип спрашиваем, а не додумываем: раньше всегда рождалась заметка, и задачу или
          // полотно приходилось переделывать вручную сразу после создания.
          if(inside){ const p=this._pt(e); this._askKind(e, k=>this._quickAdd(k,p.x,p.y,from)); }
        }
        return; }
      if(this.marq){ this._finishMarquee(); return; }
      if(this.drag){
        const n=this.drag;
        if(n._moved){   // позиции пишем ТОЛЬКО после настоящего перетаскивания — клик не должен трогать файл
          // соседи разъезжаются физикой и сохранятся, когда раскладка остынет (см. _tick)
          /* ГРУППА ЗАПИСЫВАЕТСЯ В ДВА ПРОХОДА, и порядок здесь принципиален. Дом ребёнка —
             СМЕЩЕНИЕ ОТ ВЛАДЕЛЬЦА (см. _homeFromDrag), поэтому сперва на диск уезжают позиции всей
             группы и только потом считаются дома: если владелец ехал в той же группе, дом,
             посчитанный до его записи, промахнулся бы ровно на длину жеста. */
          const группа=[n]; if(this.dragMates) this.dragMates.forEach(м=>группа.push(м.n));
          группа.forEach(q=>{
            if(q.ref){ q.ref.x=q.x; q.ref.y=q.y; }
            else if(q.hubArea){ q.hubArea.x=q.x; q.hubArea.y=q.y; }                      // позиция области
            else if(q.subRoot){ q.subRoot.x=q.x; q.subRoot.y=q.y; }                      // позиция корня подграфа (лежит во внутреннем графе)
          });
          /* ЖЕСТ ЗАДАЁТ ДОМ — и это единственное место, где дом переписывается после протяжки.
             Физика дом не пишет никогда, поэтому соседи, которых сейчас растолкало, вернутся
             на свои места сами: их дома не тронуты.
             Хабу области дом не нужен вовсе: его x/y И ЕСТЬ дом, а дома детей — смещения от
             него, и за хабом они едут сами, без единой дополнительной строки. */
          if(S.settings.graphHome) группа.forEach(q=>{ if(q.ref) this._homeFromDrag(q.ref); });
          /* ЖЕСТ — ОДИН ШАГ ИСТОРИИ. Кладём его ПЕРЕД persist: тот откроет окно дебаунса и снимет
             свой, обычный шаг, а раскладка в него не входит (см. _noXY в core.js). Без этой
             строки Ctrl+Z после перетаскивания не возвращал ничего. */
          if(this._layoutBefore){ undoPushLayout(this._layoutBefore); this._layoutBefore=null; }
          // с БОЛЬШИМ дебаунсом: серия «тащу — отпускаю — снова тащу» обязана уехать на диск
          // одной записью после того, как рука остановилась (разбор — у ЗАПИСЬ_ЖЕСТ_МС в core.js)
          persist(false, ЗАПИСЬ_ЖЕСТ_МС);
        } else {
          // ручное определение двойного клика (надёжнее нативного dblclick при pointer capture)
          // Два РАЗНЫХ окна, их нельзя мерить одним числом:
          //   350 мс — сколько ждём второй клик (двойной клик должен ловиться уверенно);
          //   170 мс — через сколько показать превью (отклик на одиночный клик).
          // Раньше это было одно число: чтобы двойной клик не промахивался, превью ждало
          // все 350 мс и ощущалось вязким. Теперь превью успевает показаться, а если второй
          // клик всё же пришёл — _openNode его закроет (он зовёт _closePop) и откроет ридер.
          /* Всплывающей карточки по клику больше нет: содержимое ноды показывает правая
             панель, а поповер поверх графа перекрывал соседей и требовал лишнего закрытия.
             Одиночный клик только выделяет (выделение уже сделано выше), двойной — открывает
             ноду целиком: ридер заметки или доску полотна. */
          const now=Date.now();
          if(this._lcId===n.id && (now-this._lcT)<350){
            this._lcId=null; this._lcT=0;
            this._openNode(n);
          } else {
            this._lcId=n.id; this._lcT=now;
          }
        }
        /* Панель догоняет выделение ПОСЛЕ жеста, а не в его начале (разбор у pointerdown) и
           не встык к отпусканию (разбор у _syncAsideLater). Зовём и после протяжки, и после
           клика: выделение сменилось в обоих случаях. Хаб своей карточки не имеет —
           _syncAside его отфильтрует сам. */
        this._syncAsideLater();
        /* Признак хвата снимаем СО ВСЕЙ группы. Забыть его на пассажире — значит навсегда
           выключить для него физику: в _tick такая нода вечно стоит с нулевой скоростью. */
        // хват снимаем с ТЕКУЩЕЙ ведущей: при Ctrl+тащи ею стала копия, а не та нода, за которую взялись
        if(this.drag) this.drag._grabbed=false;
        n._grabbed=false;
        if(this.dragMates){ this.dragMates.forEach(м=>{ м.n._grabbed=false; }); this.dragMates=null; }
        this._dragHollowAreas=null; this.copyDrag=false; svg.style.cursor="";
        this.drag=null;
      }
      this.panning=null;
    };
    // ПКМ — меню настроек узла
    svg.oncontextmenu=(e)=>{
      e.preventDefault();
      if(this.linkFrom){ this.cancelLink(); return; }
      const попал=this._hitNode(e);
      if(попал){ this._openPop(this.byId[попал], e); return; }
      const li=this.canvasMode ? this._hitLink(e)
                               : (e.target.closest(".g-hit") ? +e.target.closest(".g-hit").dataset.li : -1);
      if(li>=0){ this._openLinkPop(this.links[li], e); return; }
      this._openCreateMenu(e);   // ПКМ по пустому — меню «Создать» (заметка/задача/схема), вместо двойного клика
    };
    /* ЗУМ КОЛЕСОМ: событие задаёт ЦЕЛЬ, а к ней камера едет в кадрах (см. _tick). Раньше каждое
       событие применялось на месте и умножало зум на 1.12 или 0.89 — отсюда ступеньки: щелчок
       мыши давал скачок в 12% за один кадр, а тачпад, который сыплет десятки мелких событий,
       разгонял зум рывками, потому что величина delta вообще не учитывалась.
       Шаг теперь пропорционален настоящему delta: у мыши это ±100 пикселей на щелчок (deltaMode 0),
       и множитель выходит тот же ~1.12, что и раньше; у тачпада приходят единицы — и зум идёт
       непрерывно. Строки и страницы (deltaMode 1 и 2) переводим в пиксели, иначе на мыши с
       построчной прокруткой шаг был бы мизерным. Ограничение ±240 на событие — страховка от
       «инерционных» пачек с огромным delta, которые иначе перебрасывали бы зум через весь предел. */
    svg.onwheel=(e)=>{ e.preventDefault(); this._wake();
      if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; }   // прервать переезд камеры
      const rc=svg.getBoundingClientRect();
      let d=e.deltaY;
      if(e.deltaMode===1) d*=16; else if(e.deltaMode===2) d*=this.H;
      if(d>240) d=240; else if(d<-240) d=-240;
      const шаг=Math.exp(-d*0.00113);                                        // 100 px → ×1.12, как было
      const от=(this._zoomTo!=null)?this._zoomTo:this.zoom;                  // копим от ЦЕЛИ, иначе быстрые щелчки теряются
      this._zoomTo=Math.max(.12,Math.min(2.5, от*шаг));                      // нижний предел 0.12: большой граф должен уместиться целиком
      // точку под курсором держим неподвижной весь доезд, поэтому запоминаем её вместе с целью
      this._zoomAt={x:(e.clientX-rc.left)/rc.width*this.W, y:(e.clientY-rc.top)/rc.height*this.H};
    };
  }
  _applyTransform(){
    this._wake();                        // камера поехала — нужен кадр
    this._камОстылоДо=performance.now()+КАМЕРА_ОСТЫВАНИЕ_МС;   // см. КАМЕРА_ОСТЫВАНИЕ_МС — не даёт покою съесть паузу между рывками пана
    graphCam[this._графID]={tx:this.tx,ty:this.ty,zoom:this.zoom};   // запоминаем камеру ЭТОГО графа для следующего пересоздания
    /* И НА ДИСК тоже — иначе после перезапуска граф открывался «где-то в ебенях»: камера жила
       только в памяти вкладки. Пишем с задержкой: _applyTransform зовётся на каждый кадр пана
       и зума, а persist гонит весь файл через мост.
       ЗАДЕРЖКА ДЛИННАЯ И ЗАПИСЬ ТИХАЯ — это лечение рывка «постоял, начал двигать». Замер на
       живом файле (4.2 МБ): сама отправка состояния через мост держит поток 32 мс, и при
       задержке в 700 мс она прилетала ровно в тот момент, когда человек снова берётся за
       камеру. Любое движение камеры таймер сбрасывает, поэтому теперь запись случается только
       в настоящей паузе. Тихая (persist(true)) — потому что пан и зум это ВИД, а не правка:
       обычный persist открывал на них окно отката и снимал снимок состояния впустую. */
    if(this._camSave) clearTimeout(this._camSave);
    let спокойно=0;
    const записать=()=>{
      this._camSave=null;
      // жест ещё идёт (доезжает зум, тянут холст, не остыла раскладка) — откладываем, не к спеху
      if(this._zoomTo!=null || this.panning || this.drag || this.alpha>0){
        спокойно=0; this._camSave=setTimeout(записать, 1500); return; }
      // ДВЕ спокойные проверки подряд: жест мог начаться ровно в тот миг, когда сработал таймер,
      // и тогда рывок от записи пришёлся бы на первое же движение — то, ради чего всё это
      if(++спокойно<2){ this._camSave=setTimeout(записать, 400); return; }
      // this._графID — не S.settings.graph: к моменту срабатывания (до 1900 мс) человек мог
      // уже переключиться на другой граф, и текущее значение указывало бы не туда (см. конструктор)
      if(!S.settings.graphCam || typeof S.settings.graphCam!=="object") S.settings.graphCam={};
      S.settings.graphCam[this._графID]={tx:this.tx, ty:this.ty, zoom:this.zoom};
      persist(true);
    };
    this._camSave=setTimeout(записать, 3000);
    this.root.setAttribute("transform",`translate(${this.tx},${this.ty}) scale(${this.zoom})`);
    // подписи гаснут при отдалении (как в Obsidian): крупные/«популярные» узлы держат подпись дольше
    const z=this.zoom;
    if(this.nodeEls){
      this.nodeEls.forEach(o=>{
        const big=o.n.r>=12;               // хаб или узел с многими связями
        const a=big?0.5:0.85, b=big?0.75:1.05;   // окно зума, в котором подпись проявляется
        o.t.style.opacity=Math.max(0,Math.min(1,(z-a)/(b-a)));
      });
    }
    // Когда окно НЕактивно, браузер замораживает requestAnimationFrame, а _tick (который рисует
    // фон-canvas) вместе с ним. Тогда зум/пан колесом двигает SVG, но звёздный фон отстаёт —
    // «фон слетает». Пока фокуса нет, перерисовываем фон СРАЗУ здесь (когда фокус есть — рисует _tick).
    if(!document.hasFocus()){
      try{ this._drawBg(); this._drawGlow(); }catch(e){}
    }
  }
  // фон «звёздное поле»: 5 слоёв глубины с параллаксом (par) + собственный дрейф/мерцание точек.
  // ZOOM-масштаб слоёв = чистый z (zs=1) — при зуме звёзды масштабируются ВМЕСТЕ с миром и не «плывут»,
  // а параллакс (par) остаётся на ПАНЕ — тот самый эффект глубины, ради которого всё делалось.
  /* Слои поля: sp — шаг сетки, sz — полуразмер звезды, a/aL — яркость (тёмная/светлая тема),
     wob — амплитуда собственного дрейфа, par — параллакс от пана. Общие для WebGL и canvas2d. */
  /* ВИД ФОНА (настройки → «Фон холста», S.settings.graphBgKind; КРОЛИК 03.11.2026 выбрал из
     demo_ноды-и-фон.html): clean — чистый тон без точек (по умолчанию), stars — звёздное поле,
     dust — мелкая пыль с параллаксом, grid — сетка-чертёж по миру, topo — топография работы
     (её рисует холст графа, см. _topoBuild). Старый выключатель graphBg=false = чистый тон.
     Туманность областей отвергнута на этапе макета: облако на каждую ноду — дорогой фон. */
  _bgKind(){ const s=S.settings||{}; if(s.graphBg===false) return "clean";
    return ["clean","stars","dust","grid","topo"].indexOf(s.graphBgKind)>=0 ? s.graphBgKind : "clean"; }
  /* Слои точечного фона. sp — ЭКРАННЫЙ шаг ячейки (px), sz — экранный размер точки (px), sharp —
     доля чёткого ядра против мягкого ореола. Всё в экранных пикселях намеренно: в мировых точки
     при приближении раздувались в размытые пятна до 64 px, а при отдалении слои выпадали целиком
     (КРОЛИК, 03.11.2026). Как держится плотность на любом зуме — см. ОКТАВЫ в _drawBgGL.
     Сетка и топография рисуются холстом графа (_drawMain), здесь у них слоёв нет. */
  _bgLayers(){
    const вид=this._bgKind();
    // пыль: густая мелкая взвесь с разбросом по глубине — фактура без ярких звёзд
    if(вид==="dust") return [
      // scat:1 — точка где угодно в своей ячейке, иначе узор решётки читается как плитка (КРОЛИК)
      {par:0.10, sp:23, sz:1.3, a:0.15, aL:0.13, wob:3, sharp:1, scat:1},
      {par:0.30, sp:31, sz:1.5, a:0.19, aL:0.16, wob:5, sharp:1, scat:1},
      {par:0.60, sp:43, sz:1.8, a:0.24, aL:0.20, wob:7, sharp:1, scat:1},
      {par:0.95, sp:59, sz:2.1, a:0.30, aL:0.24, wob:9, sharp:1, scat:1}
    ];
    if(вид!=="stars") return [];
    return [
      {par:0.06, sp:34,  sz:1.6, a:0.14, aL:0.11, wob:2, sharp:0.8},
      {par:0.20, sp:52,  sz:2.0, a:0.20, aL:0.15, wob:3, sharp:0.8},
      {par:0.42, sp:76,  sz:2.4, a:0.27, aL:0.20, wob:4, sharp:0.8},
      {par:0.68, sp:110, sz:2.9, a:0.35, aL:0.25, wob:5, sharp:0.8},
      {par:1.00, sp:150, sz:3.4, a:0.45, aL:0.30, wob:6, sharp:0.8}
    ];
  }
  // Компиляция шейдеров + буфер индексов ячеек. Позицию, дрейф и мерцание каждой звезды считает
  // видеокарта из номера ячейки — на CPU остаётся лишь пяток uniform'ов на кадр.
  _initBgGL(cv){
    // premultipliedAlpha ПО УМОЛЧАНИЮ (true) — это каноничный, максимально совместимый путь.
    // С premultipliedAlpha:false некоторые композиторы (в т.ч. WebView2) выводят слой неверно,
    // вплоть до полностью невидимого — на этом фон и пропал у КРОЛИКа.
    const opt={alpha:true,antialias:false,depth:false,stencil:false,failIfMajorPerformanceCaveat:false};
    const gl=cv.getContext("webgl",opt) || cv.getContext("experimental-webgl",opt);
    if(!gl) return null;
    const VS=[
      "attribute float aIdx;",
      "uniform vec2 uRes; uniform vec2 uOff; uniform vec2 uBase;",
      "uniform float uCols; uniform float uTile; uniform float uT;",
      "uniform float uWob; uniform float uSize; uniform float uAlpha; uniform float uScat;",
      "varying float vA;",
      "float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }",
      "void main(){",
      "  float gx = mod(aIdx, uCols) - 1.0;",          // -1 — та же кромка в одну ячейку, что и в 2d
      "  float gy = floor(aIdx / uCols) - 1.0;",
      "  vec2 cell = vec2(gx,gy) + uBase;",
      "  float hx=h(cell), hy=h(cell+vec2(37.0,17.0)), ho=h(cell+vec2(91.0,53.0));",
      "  vec2 jit=(vec2(hx,hy)-0.5)*uTile*uScat;",   // разброс в ячейке: 0.5 — звёзды, 1 — пыль (вся ячейка, без решётки)
      "  vec2 wob=vec2(sin(uT*0.16+hx*6.283), cos(uT*0.13+hy*6.283))*uWob;",
      "  vec2 pos=vec2(gx,gy)*uTile - uOff + jit + wob;",
      "  vec2 nd=pos/uRes*2.0-1.0;",
      "  gl_Position=vec4(nd.x, -nd.y, 0.0, 1.0);",
      "  float hs=h(cell+vec2(13.0,71.0));",
      "  gl_PointSize=uSize*mix(1.0, 0.45+1.1*hs, clamp(uScat*2.0-1.0, 0.0, 1.0));",   // у пыли размер гуляет
      "  vA=uAlpha*(0.35+0.65*(0.5+0.5*sin(uT*0.18+ho*6.283)));",   // «дыхание» яркости
      "}"
    ].join("\n");
    const FS=[
      "precision mediump float;",
      "varying float vA; uniform vec3 uColor; uniform float uSharp;",
      "void main(){",
      "  vec2 d=gl_PointCoord-vec2(0.5);",
      "  float r=length(d)*2.0;",
      "  if(r>1.0) discard;",
      "  float soft=pow(1.0-r, 2.2);",                 // мягкий профиль прежнего спрайта-градиента
      "  float crisp=(1.0-smoothstep(0.45,0.85,r))*0.85+soft*0.25;",   // чёткое ядро + слабый ореол
      "  float a=min(1.0, mix(soft, crisp, uSharp)*vA);",
      "  gl_FragColor=vec4(uColor*a, a);",            // PREMULTIPLIED: цвет уже умножен на альфу
      "}"
    ].join("\n");
    const mk=(t,src)=>{ const s=gl.createShader(t); gl.shaderSource(s,src); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog=gl.createProgram();
    gl.attachShader(prog,mk(gl.VERTEX_SHADER,VS)); gl.attachShader(prog,mk(gl.FRAGMENT_SHADER,FS));
    gl.linkProgram(prog);
    if(!gl.getProgramParameter(prog,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const MAX=60000;                                   // потолок ячеек на слой: мелкая октава пыли на 4K — ~45 тысяч
    const idx=new Float32Array(MAX); for(let i=0;i<MAX;i++) idx[i]=i;
    const buf=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buf); gl.bufferData(gl.ARRAY_BUFFER,idx,gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(prog,"aIdx");
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc,1,gl.FLOAT,false,0,0);
    gl.enable(gl.BLEND);
    // Смешивание для PREMULTIPLIED-цвета: источник уже умножен на альфу в шейдере.
    // (С обычным SRC_ALPHA альфа умножалась бы сама на себя и поле было бы в ~7 раз бледнее.)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0,0,0,0);
    const U=n=>gl.getUniformLocation(prog,n);
    const st={ gl, prog, buf, max:MAX, u:{ res:U("uRes"), cols:U("uCols"), tile:U("uTile"), off:U("uOff"),
      base:U("uBase"), t:U("uT"), wob:U("uWob"), size:U("uSize"), alpha:U("uAlpha"), color:U("uColor"), scat:U("uScat"), sharp:U("uSharp") } };
    // САМОПРОВЕРКА: убеждаемся, что путь РЕАЛЬНО даёт пиксели именно в этом окружении. Драйвер
    // или встроенный браузер могут молча не выводить слой (так фон и пропал целиком). Не дал
    // пикселей — возвращаем null и спокойно работаем на canvas2d.
    if(!this._glSelfTest(st, cv)){
      try{ const e=gl.getExtension("WEBGL_lose_context"); if(e) e.loseContext(); }catch(_){}
      return null;
    }
    /* Потеря контекста (сон, смена GPU, перегруз): перестаём использовать GL, чтобы не рисовать
       в пустоту. preventDefault имеет смысл ТОЛЬКО в паре с восстановлением — он и просит браузер
       прислать webglcontextrestored. Без парного слушателя (и с {once:true} у обоих) фон после
       первого же засыпания машины оставался бы чёрным до перезапуска приложения. */
    if(!cv._glHooked){
      cv._glHooked=true;
      cv.addEventListener("webglcontextlost", (e)=>{ e.preventDefault(); this.bgGL=null; this._glCache=null; });
      cv.addEventListener("webglcontextrestored", ()=>{
        this._glCache=null;
        try{ this.bgGL=this._initBgGL(cv); this._glCache={cv, st:this.bgGL}; }
        catch(e){ this.bgGL=null; }
      });
    }
    return st;
  }
  // Рисуем несколько заведомо ярких точек в маленький буфер и проверяем, что они там есть.
  _glSelfTest(G, cv){
    const gl=G.gl;
    try{
      const w=64,h=64, ow=cv.width, oh=cv.height;
      cv.width=w; cv.height=h;
      gl.viewport(0,0,w,h);
      gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(G.prog);
      gl.uniform2f(G.u.res,w,h); gl.uniform1f(G.u.t,0); gl.uniform3f(G.u.color,1,1,1);
      gl.uniform1f(G.u.cols,4); gl.uniform1f(G.u.tile,16);
      gl.uniform2f(G.u.off,0,0); gl.uniform2f(G.u.base,0,0);
      gl.uniform1f(G.u.wob,0); gl.uniform1f(G.u.size,24); gl.uniform1f(G.u.alpha,1); gl.uniform1f(G.u.scat,0.5); gl.uniform1f(G.u.sharp,0);
      gl.drawArrays(gl.POINTS,0,16);
      const px=new Uint8Array(4*w*h);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
      let lit=0; for(let i=3;i<px.length;i+=4) if(px[i]>0) lit++;
      cv.width=ow||1; cv.height=oh||1;
      return lit>0 && !gl.isContextLost() && gl.getError()===0;
    }catch(e){ return false; }
  }
  // Кадр: 5 слоёв = 5 вызовов отрисовки. Вся геометрия и анимация — на видеокарте.
  _drawBgGL(){
    const G=this.bgGL, cv=this.bgCanvas; if(!G||!cv) return;
    const gl=G.gl;
    const cw=cv.clientWidth, ch=cv.clientHeight; if(!cw||!ch) return;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const W=Math.round(cw*dpr), H=Math.round(ch*dpr);
    if(cv.width!==W||cv.height!==H){ cv.width=W; cv.height=H; }
    gl.viewport(0,0,W,H);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const layers=this._bgLayers();
    if(!layers.length) return;   // точек нет: чистый тон — сам фон холста, сетку и топографию рисует _drawMain
    const light=document.body.classList.contains("light");
    // время — по часам анимаций графа (см. _tick), не по системным: иначе после паузы (диалог
    // выбора папки, уход с вкладки) звёзды разом пересчитываются на новое время и поле дёргается
    const ts=this._bgReduce?0:graphDriftClock;
    const z=this.zoom, w=cw, h=ch;
    gl.useProgram(G.prog);
    gl.uniform2f(G.u.res, w, h);
    gl.uniform1f(G.u.t, ts);
    gl.uniform3f(G.u.color, light?0:1, light?0:1, light?0:1);
    // Общий множитель яркости: подобран замером так, чтобы суммарная «краска» кадра совпадала
    // с прежней canvas2d-отрисовкой (иначе поле выглядит бледнее оригинала).
    const BG_GAIN=1.15;
    /* ОКТАВЫ: поле держит одну и ту же экранную плотность на любом зуме. Шаг слоя в мире —
       sp·2^-n, где n = floor(log2 z): внутри октавы точки приклеены к миру и плавно расходятся
       при приближении, а на смене октавы их место занимает вдвое более частый ряд. Рисуются две
       соседние октавы, крупная гаснет по мере роста, мелкая разгорается (вес f и 1-f) — поэтому
       переход без скачка. Номер октавы входит в хеш ячейки, и ряд, ставший «крупным», остаётся
       ТЕМИ ЖЕ точками, что были «мелким». Размер точки от зума почти не зависит (z^0.2 в узкой
       вилке): приблизился — звёзд не становится меньше, и они не раздуваются в пятна. */
    const l2=Math.log2(Math.max(1e-4, z)), n0=Math.floor(l2), f=l2-n0;
    const zf=Math.max(0.8, Math.min(1.25, Math.pow(z, 0.2)));
    for(let li=0; li<layers.length; li++){
      const L=layers[li];
      gl.uniform1f(G.u.sharp, L.sharp||0);
      gl.uniform1f(G.u.scat, L.scat||0.5);
      for(const [n, вес] of [[n0, 1-f], [n0+1, f]]){
        if(вес<0.02) continue;
        let tile=L.sp*Math.pow(2, l2-n);                 // экранный шаг этой октавы: sp…2sp у крупной, sp/2…sp у мелкой
        let cols=Math.ceil(w/tile)+2, rows=Math.ceil(h/tile)+2;
        if((cols+1)*(rows+1)>G.max){                     // страховка от переполнения буфера
          tile*=Math.sqrt((cols+1)*(rows+1)/G.max);
          cols=Math.ceil(w/tile)+2; rows=Math.ceil(h/tile)+2;
        }
        const loX=-this.bgPanX*(1-L.par), loY=-this.bgPanY*(1-L.par);
        const totX=-(this.tx+loX*z), totY=-(this.ty+loY*z);
        gl.uniform1f(G.u.cols, cols+1);
        gl.uniform1f(G.u.tile, tile);
        gl.uniform2f(G.u.off, ((totX)%tile+tile)%tile, ((totY)%tile+tile)%tile);
        gl.uniform2f(G.u.base, Math.floor(totX/tile)+n*131.0, Math.floor(totY/tile)+n*71.0);
        gl.uniform1f(G.u.wob, L.wob*tile/L.sp);
        // Точка меньше ~2 px гаснет в ноль: на неё приходится один фрагмент. Поэтому держим
        // минимальный размер и компенсируем яркость по площади — «энергия» точки сохраняется.
        const want=L.sz*1.5*zf*dpr, MINPX=2*dpr;
        const size=Math.max(MINPX, Math.min(24, want));
        const comp=want<MINPX ? (want/MINPX)*(want/MINPX) : 1;
        gl.uniform1f(G.u.size, size);
        gl.uniform1f(G.u.alpha, (light?L.aL:L.a)*comp*BG_GAIN*вес);
        gl.drawArrays(gl.POINTS, 0, Math.min(G.max,(cols+1)*(rows+1)));
      }
    }
  }
  /* Фон рисует ТОЛЬКО WebGL. Прежний путь canvas2d удалён намеренно: он стоил 9-14 мс на кадр
     (тысячи вызовов drawImage) и был причиной лагов, когда GPU занят другим приложением. Держать
     заведомо медленный запасной путь — значит гарантировать те же лаги всем, у кого нет WebGL.
     Фон декоративный: нет GPU-пути (старый драйвер, софтверный рендер) — просто нет фона,
     приложение при этом полностью работоспособно. */
  _drawBg(){
    if(this.bgGL) this._drawBgGL();
  }
  /* СПРАЙТ СВЕЧЕНИЯ — кэш готовых заблюренных кружков вместо gradient+blur() на каждый блоб
     каждый кадр (правка по замеру КРОЛИКА: на соседнем графе без свечения/приоритета/жара
     панорама держит фпс ровно, с ними — фризы при движении). Блюр в Canvas2D считается на
     КАЖДЫЙ вызов отрисовки, а не один раз на слой, — а во время панорамы кадр перерисовывается
     целиком заново (камера едет, картинка не кэшируется), значит цена блюра множится на число
     светящихся узлов КАЖДЫЙ кадр панорамы. Ключ кэша — цвет и радиус: во время панорамы зум не
     меняется, а радиус блоба зависит только от зума и множителя состояния — значит он стабилен
     кадр к кадру, и спрайт печётся РОВНО ОДИН РАЗ, дальше только `drawImage()`.
     Радиус округляется до 3 px в ключе — иначе плавный зум пёк бы новый спрайт почти на каждый
     кадр, а на глаз разница в 1-2 px радиуса на мягком блюре не видна.
     Силу (альфу) в спрайт не печём — она своя у каждого состояния и меняется live-настройкой
     (`graphDoingGlowBright`) — просто `ctx.globalAlpha` при отрисовке, иначе спрайтов
     понадобилось бы в разы больше. Смена темы или блюра сама даёт новый ключ (цвет/blur в него
     входят) — старые записи просто перестают запрашиваться, отдельной инвалидации не нужно. */
  _glowSprite(rgb, R, blur){
    if(!this._спрайтыСвета) this._спрайтыСвета=new Map();
    const ключ=rgb.join(",")+"|"+Math.round(R/3)*3+"|"+blur;
    let c=this._спрайтыСвета.get(ключ);
    if(c) return c;
    const зап=blur+2, размер=Math.max(2,Math.ceil((R+зап)*2));
    c=document.createElement("canvas"); c.width=c.height=размер;
    const cx=c.getContext("2d");
    if(blur>0) cx.filter="blur("+blur+"px)";
    const grd=cx.createRadialGradient(размер/2,размер/2,0, размер/2,размер/2,R);
    grd.addColorStop(0,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
    grd.addColorStop(1,`rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    cx.fillStyle=grd; cx.beginPath(); cx.arc(размер/2,размер/2,R,0,6.283); cx.fill();
    this._спрайтыСвета.set(ключ,c);
    return c;
  }
  // цветная подсветка «в работе»: каждая doing-нода светит СВОИМ цветом (радиальный градиент),
  // блобы накладываются → свет соседних doing-нод смешивается. Слой между звёздами и нодами.
  _drawGlow(){
    const cv=this.glowCanvas, ctx=this.glowCtx; if(!cv||!ctx) return;
    /* РАЗМЕРЫ БЕРЁМ У ГРАФА, А НЕ У ХОЛСТА. Чтение clientWidth — это запрос геометрии, и браузер
       обязан ради него НЕМЕДЛЕННО пересчитать раскладку. А зовётся свечение в конце кадра, сразу
       после записи координат всех узлов и связей, — то есть именно этот безобидный на вид read
       и оплачивал пересчёт всего SVG: замер на тестовом графе (654 узла, светящихся нод НЕТ
       вовсе) приписывал _drawGlow 15 мс из 25 мс кадра, хотя рисовать ему было нечего.
       W/H — те же CSS-пиксели: холст растянут на #graph-wrap, а их обновляет _onResize. */
    const cw=this.W||cv.clientWidth, ch=this.H||cv.clientHeight; if(!cw||!ch) return;
    /* РАЗРЕШЕНИЕ СЛОЯ. Свечение — это размытые пятна (blur 30 px), и рисовать их в полном
       разрешении экрана незачем: на большом дереве замер показал 14.6 мс из 24 мс кадра —
       больше, чем вся физика. Пятно в половинном масштабе после растяжки выглядит так же
       (его край и так размыт), а пикселей вчетверо меньше. Порог тот же, что у остальных
       послаблений на больших деревьях, — малый граф считается по-прежнему.
       Масштаб храним на графе: по нему проверки читают пиксели слоя, иначе им пришлось бы
       знать эту формулу наизусть. */
    const dpr=Math.min(window.devicePixelRatio||1,2)*(this.nodes.length>350?0.5:1);
    this.glowScale=dpr;
    if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){ cv.width=Math.round(cw*dpr); cv.height=Math.round(ch*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cw,ch);
    const s=S.settings;
    if(s.graphDoingGlow===false) return;
    // цвет НЕ обязателен: в палитре первый кружок = null («по умолчанию», рисуется белым),
    // такие ноды тоже должны светиться — берём им нейтральный цвет темы, как и заливка в CSS
    // (там фолбэк var(--nc, var(--acc))). Иначе белая doing-нода оставалась без свечения.
    const doing=this.nodes.filter(n=>n.doing);
    /* «На паузе» светится тоже — иначе на большом графе отложенную область глазом не найти.
       Но СЕРЫМ и слабее: цветной свет занят работой, и второе яркое состояние спорило бы
       с ним за внимание. Свет здесь показывает не ноду, а ОБЛАСТЬ, которая стоит. */
    const paused=this.nodes.filter(n=>n.paused);
    /* «ЖДЁТ» И «НА ПРОВЕРКЕ» СВЕТЯТСЯ ТОЖЕ (по просьбе КРОЛИКА) — по образцу паузы, но своими
       цветами: тёмно-синий у ожидания, тёмно-красный у проверки. Смысл тот же, что у паузы:
       найти глазом ветку, которая стоит НЕ по твоей вине, не приближаясь к ней. Слабее работы:
       цветной свет занят тем, чем занят человек, и два одинаково ярких состояния спорили бы. */
    const waiting=this.nodes.filter(n=>n.waiting);
    const review=this.nodes.filter(n=>n.review);
    /* ПРИОРИТЕТ — те же условия, что у дужки в _drawMain (n.type==="task" && n.ref &&
       !n.ref.done && n.ref.priority && !n.done && !n.archived), просто вынесены сюда: дужка
       рисуется на любом зуме, и её нельзя было греть shadowBlur на каждый кадр (см. ниже). */
    const приорГлоу=this.nodes.filter(n=>n.type==="task" && n.ref && !n.ref.done && n.ref.priority && !n.done && !n.archived)
      .map(n=>({x:n.x, y:n.y, _ix:n._ix, _iy:n._iy, ур:Math.min(+n.ref.priority,3)}));
    // «что горит» — тёплый свет у горящих нод (стиль A): в режиме он и есть главный признак, а не второй контур
    const жарГлоу=(this._показатьЖар && this._горящие) ? this._горящие : [];
    if(!doing.length && !paused.length && !waiting.length && !review.length && !приорГлоу.length && !жарГлоу.length) return;
    /* ЦВЕТА ТЕМЫ — ИЗ КЭША, а не getComputedStyle на каждом кадре (аудит 2.1, Ц4): до шести вызовов
       за кадр, и когда стили «грязные» (правая панель только что перестроилась), каждый оплачивал
       пересчёт стилей прямо внутри кадра — та же грабля, что была с clientWidth. Ключ кэша —
       класс body: тема меняется только им. */
    const тема=document.body.className;
    if(!this._glowCss || this._glowCss.тема!==тема){
      const cs=getComputedStyle(document.documentElement), bs=getComputedStyle(document.body);
      const в=k=>(bs.getPropertyValue(k)||cs.getPropertyValue(k));
      this._glowCss={тема, mut:в("--mut"), wait:в("--st-wait-glow"), review:в("--st-review-glow"),
        pri:[в("--pri1"), в("--pri2"), в("--pri3")], ur:[в("--ur1"), в("--ur2"), в("--ur3")]};
    }
    const css=this._glowCss;
    const z=this.zoom, tx=this.tx, ty=this.ty;
    const R=(s.graphDoingGlowRadius!=null?s.graphDoingGlowRadius:110)*z;
    const inten=(s.graphDoingGlowBright!=null?s.graphDoingGlowBright:0.3);
    const blur=(s.graphDoingGlowBlur!=null?s.graphDoingGlowBlur:30);
    const rgbOf=(c)=>{ c=(c||"").trim(); if(c[0]==="#"){ let h=c.slice(1); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2]; const n=parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; } const m=c.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); return m?[+m[1],+m[2],+m[3]]:null; };
    const neutral=NEUTRAL();   // --acc: тот же «белый по умолчанию», которым нода и рисуется
    ctx.save();
    let блобов=0;
    const блоб=(n, rgb, сила, радиус)=>{
      const x=(n.x+(n._ix||0))*z+tx, y=(n.y+(n._iy||0))*z+ty;   // мир → экран (та же трансформа, что у корня графа)
      if(x<-радиус-blur||x>cw+радиус+blur||y<-радиус-blur||y>ch+радиус+blur) return;
      блобов++;
      // спрайт вместо gradient+blur() на каждый блоб — см. _glowSprite
      const спрайт=this._glowSprite(rgb, радиус, blur);
      ctx.globalAlpha=сила;
      ctx.drawImage(спрайт, x-спрайт.width/2, y-спрайт.height/2);
    };
    doing.forEach(n=>{ const rgb=rgbOf(n.color||neutral); if(rgb) блоб(n, rgb, inten, R); });
    /* Пауза светит СЕРЫМ и втрое слабее: свет нужен, чтобы отложенная область находилась
       глазом на большом графе, но перебивать работу он не должен. Цвет ноды здесь не берём
       намеренно — по цвету свечения и отличают «в работе» от «на паузе». */
    if(paused.length){
      const сер=rgbOf(css.mut)||[150,150,150];
      // ярче прежнего (0.38 → 0.52): отложенную ветку надо НАХОДИТЬ глазом на большом графе,
      // а прежний свет терялся рядом с работающими нодами
      paused.forEach(n=>блоб(n, сер, inten*0.52, R*0.9));
    }
    /* Свет ожидания и проверки — той же силы, что пауза, и тем же приёмом: цвет берём из
       переменной темы, а не из цвета ноды. По цвету свечения эти три состояния и различаются
       на расстоянии, когда сам глиф внутри ноды уже не читается. */
    if(waiting.length){
      const син=rgbOf(css.wait)||[63,95,143];
      waiting.forEach(n=>блоб(n, син, inten*0.5, R*0.9));
    }
    if(review.length){
      const крас=rgbOf(css.review)||[143,63,66];
      review.forEach(n=>блоб(n, крас, inten*0.5, R*0.9));
    }
    /* ПРИОРИТЕТ — СВЕЧЕНИЕ ЧЕРЕЗ ЭТОТ ЖЕ СЛОЙ, А НЕ shadowBlur НА ХОЛСТЕ (правка 2026-09-01
       по жалобе КРОЛИКА «просел FPS с новыми статусами»). Первая версия ставила `ctx.shadowBlur`
       на КАЖДЫЙ stroke() дужки приоритета — а дужка теперь рисуется на любом зуме, без порога
       деталей, то есть тень пересчитывалась каждый кадр на каждой приоритетной ноде, не только
       при наведении или выделении, как везде остальные тени в файле. Ровно тот случай, о
       котором предупреждает комментарий выше про SVG: «тень пересчитывалась бы каждый кадр,
       ради чего всё и затевалось». Слой свечения даёт тот же эффект спрайтом из кэша
       (см. `_glowSprite`) вместо gradient+blur на каждом кадре — тем же приёмом, что уже
       работает для doing/paused/waiting/review. */
    if(приорГлоу.length){
      const при=[rgbOf(css.pri[0])||[95,185,142], rgbOf(css.pri[1])||[232,161,75], rgbOf(css.pri[2])||[224,98,90]];
      const сила=[0.35,0.5,0.68];
      // в режиме «что горит» свет приоритета гасим: тёплый свет горящих должен читаться один
      if(!жарГлоу.length) for(const п of приорГлоу){
        const rgb=при[п.ур-1]||при[0];
        блоб(п, rgb, inten*сила[п.ур-1], R*0.55);
      }
    }
    // горящие: свет цвета уровня жара, сильнее у верхних — первым взгляд цепляет №1
    if(жарГлоу.length){
      const жар=[rgbOf(css.ur[0])||[185,160,106], rgbOf(css.ur[1])||[217,139,70], rgbOf(css.ur[2])||[224,98,90]];
      for(const у of жарГлоу){ const ур=Math.max(1, Math.min(3, у.жар||1));
        блоб(у, жар[ур-1], inten*(0.55+0.2*ур), R*(0.6+0.12*ур)); }
    }
    ctx.restore();
    // Ни одно пятно не попало в кадр — стирать не из чего, а обход всех связей стоит своего.
    if(!блобов) return;
    // связи не должны «просвечивать» свечением: стираем свечение ровно из-под линий связей.
    // «дырки» невидимы — они всегда закрыты либо самой связью, либо нодой сверху (endpoints в центрах нод).
    /* ШИРИНА ВЫРЕЗА — ОТ ШИРИНЫ САМОЙ ЛИНИИ. Общие 2.5 px были втрое шире тонкой связи «спит»
       (0.6 px): по её краям оставалась пустота без свечения, и через светящуюся ноду связь шла с
       чёрной обводкой (КРОЛИК, 03.11.2026). У «спит» вырез ровно по линии; у остальных — не уже
       1.5 px: на тонком вырезе сглаживание оставляет под линией половину свечения, и отставание
       выреза на кадр (проверка в граф.js) перестаёт отличаться от нормы. Под пунктиром «ждёт» не
       вырезаем вовсе — иначе тёмными стали бы промежутки между штрихами. Пакетами (шаг 0.5). */
    const поток=S.settings.graphFlow!==false, тл=w=>Math.max(1.5, w*z);
    const ширина=(l)=>{ const п=поток&&l._пот;
      if(п) return п.вид==="ждёт" ? 0 : п.вид==="спит" ? Math.max(0.6, 0.45*z) : тл(п.ш);
      return l.manual ? тл(1.8) : l.hubLink ? Math.max(1.5, 2.6*z) : тл(1.2); };
    const вырезы=new Map();
    ctx.save(); ctx.globalCompositeOperation="destination-out"; ctx.strokeStyle="#000"; ctx.lineCap="round";
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) return;
      const ax=(a.x+(a._ix||0))*z+tx, ay=(a.y+(a._iy||0))*z+ty, bx=(b.x+(b._ix||0))*z+tx, by=(b.y+(b._iy||0))*z+ty;
      /* Вырезаем только под связями В КАДРЕ: путь строится по всем 652 связям дерева, а видно
         из них меньше половины. Запас в 40 px — на толщину линии и прогиб. */
      if((ax<-40&&bx<-40)||(ax>cw+40&&bx>cw+40)||(ay<-40&&by<-40)||(ay>ch+40&&by>ch+40)) return;
      const ш=Math.round(ширина(l)*2)/2; if(ш<=0) return;
      let путь=вырезы.get(ш); if(!путь){ путь=new Path2D(); вырезы.set(ш, путь); }
      путь.moveTo(ax,ay);
      /* Вырез повторяет ФОРМУ связи, включая прогиб (см. _linkPath). Пока он всегда шёл по
         прямой, а связь гнулась, вырез оставался на хорде: свечение там стёрто, а линии нет —
         и по светящейся ноде тянулась тёмная полоса. Смещение прогиба живёт в мировых
         координатах, поэтому на экране его надо умножить на зум. */
      const bd=l._bendC;
      if(bd){ const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t;
        путь.quadraticCurveTo(px+bd.ox*2*z, py+bd.oy*2*z, bx, by); }
      else путь.lineTo(bx,by);
    });
    вырезы.forEach((путь,ш)=>{ ctx.lineWidth=ш; ctx.stroke(путь); });
    ctx.restore();
  }
  /* Превью по одиночному клику: заглянуть внутрь, не открывая. Показывается через 350 мс —
     ждём, не будет ли второго клика (тогда открывается ридер, а превью отменяется).
     Переиспользуем id="node-pop": позиционирование и закрытие по клику мимо уже работают на нём. */

  // наведение на ноду (Obsidian-стиль): узел+соседи+связи между ними ПОДСВЕЧИВАЮТСЯ (.hl),
  // всё остальное гаснет (.dim). Плавно (transition в CSS). id=null — снять.
  /* МЯГКАЯ СВЯЗЬ. По умолчанию линия прямая — постоянные дуги отвергнуты, они читаются как
     жёсткие арки. Но если на линии лежит ЧУЖАЯ нода, связь прогибается ровно в этом месте и
     обходит её, а на остальной длине остаётся прямой. Это подстраховка к физике: та разводит
     узлы, только пока не остыла, и на плотном дереве часть случаев ей не по силам (узел зажат
     между своими связями). Прогиб же виден сразу и не двигает ни одной ноды.
     Глубина прогиба равна тому, насколько нода залезла в зазор: чуть задела — почти прямая,
     легла серединой — заметная дуга. Поэтому линия не «щёлкает» между двумя состояниями. */
  /* Считаем по ТЕМ ЖЕ координатам, по которым рисуем, — то есть с дрейфом (RX/RY), а не по
     базовым. Иначе дуга строится для одного положения, а линия рисуется для другого: при
     замере расстояние от неподвижной ноды до линии гуляло на 10 px только из-за дрейфа, и в
     тесном месте это читалось как дрожание. Дрейфуют и нода-помеха, и оба конца связи —
     ошибки складываются, поэтому учитывать надо всех троих. */
  /* ОСТОВ ПАУТИНЫ. Иерархия (it.parent) в данных есть далеко не всегда — связи люди тянут
     как угодно, а области членство задают полем. Поэтому направление «вниз по ветке» выводим
     сами: обход в ширину от хабов областей, затем от оставшихся узлов. Получаем родителя
     обхода и список детей — на них держатся и вес ветки, и перенос ветки целиком.
     Считаем ОДИН раз за перестройку: в кадре это было бы дороже всей физики. */
  _skeleton(){
    const родитель={}, дети=new Map(), видели=new Set();
    /* Соседство считаем ТОЛЬКО по связям между нодами. Хаб области связан со ВСЕМИ её нодами
       (членство рисуется лучом), и если пустить обход через него, вся область окажется его
       прямыми детьми — структура проектов исчезнет, а вес каждой ветки станет единицей.
       Хабы остаются корнями обхода, но детей набирают уже через настоящие связи. */
    const сосед={};
    this.nodes.forEach(n=>{ сосед[n.id]=[]; });
    this.links.forEach(l=>{
      if(isHubId(l.a) || isHubId(l.b)) return;
      if(сосед[l.a]) сосед[l.a].push(l.b);
      if(сосед[l.b]) сосед[l.b].push(l.a);
    });
    const очередь=[];
    /* Корни берём ПО ОЧЕРЕДИ, а не все сразу: сперва хабы областей, затем самые связные из
       ещё не охваченных. Если пометить корнями всех, ни у кого не окажется непосещённых
       соседей — дерево выйдет плоским, без детей (на этом я один раз уже споткнулся). */
    const кандидаты=this.nodes.slice().sort((a,b)=>{
      // корнями берём самые связные узлы: у них больше шансов быть «корнем проекта».
      // хабы в корни не годятся — через них обход не идёт (см. выше)
      return (сосед[b.id]?сосед[b.id].length:0)-(сосед[a.id]?сосед[a.id].length:0);
    });
    let ci=0, qi=0;
    while(qi<очередь.length || ci<кандидаты.length){
      if(qi>=очередь.length){                                     // очередь опустела — новый корень
        const n=кандидаты[ci++]; if(!n || видели.has(n.id)) continue;
        видели.add(n.id); родитель[n.id]=null; очередь.push(n.id);
      }
      const id=очередь[qi++], соседи=сосед[id];
      if(!соседи) continue;
      соседи.forEach(sid=>{ if(видели.has(sid)) return; видели.add(sid);
        родитель[sid]=id; очередь.push(sid);
        const с=дети.get(id); if(с) с.push(sid); else дети.set(id,[sid]); });
    }
    this._дети=дети; this._родитель=родитель; this._порядок=очередь;
  }
  /* ВЕС ВЕТКИ — сколько узлов висит на этом узле вниз по остову, включая его самого. Нужен,
     чтобы длина связи зависела от величины проекта: у области с десятком веток все они раньше
     отходили на одну длину, и крупные лезли друг на друга — в центре была толкучка. */
  _recalcWeight(){
    this._skeleton();
    const вес={}; this.nodes.forEach(n=>{ вес[n.id]=1; });
    const порядок=this._порядок||[];
    for(let i=порядок.length-1;i>=0;i--){
      const id=порядок[i], с=this._дети.get(id); if(!с) continue;
      let сумма=1; for(const k of с) сумма+=(вес[k]||1); вес[id]=сумма;
    }
    this._вес=вес;
    /* ПУЧКИ («звёзды»): узел, у которого есть свои дети, — центр пучка, лист приписывается к
       пучку своего родителя. Именно так граф и читается глазом: шот со своими «Рендер / VFX /
       Сборка / Анимация» — одна звезда, следующий шот — другая. Физике это нужно, чтобы
       удерживать звезду вместе и разводить звёзды между собой (см. _tick): до сих пор силы
       знали только про пары узлов, и соседние пучки спокойно проезжали друг сквозь друга. */
    const группа={};
    this.nodes.forEach(n=>{
      const свои=this._дети.get(n.id);
      if(свои && свои.length){ группа[n.id]=n.id; return; }
      const р=this._родитель[n.id];
      группа[n.id]=(р!=null && р!==undefined) ? р : n.id;
    });
    this._группа=группа;
    /* СЕКТОРЫ ВЕТОК. Каждая ветка первого уровня получает свой угол вокруг корня, пропорционально
       своему весу: ветка из двухсот узлов — широкий сектор, ветка из трёх — узкий. Дальше физика
       мягко держит узлы внутри их сектора (см. _tick), и ветки перестают заходить друг к другу,
       а лучи от корня — пересекать чужую территорию. Это то, чем радиальная раскладка добивается
       читаемости, только без замораживания позиций: физика остаётся живой.
       Порядок секторов берём по ТЕКУЩЕМУ расположению веток, иначе назначение перетасовало бы
       дерево на каждой перестройке и граф крутился бы волчком. */
    const ветвь={}, корни={};
    const обход=this._порядок||[];   // тот же BFS-порядок: родитель всегда обработан раньше ребёнка
    for(let i=0;i<обход.length;i++){
      const id=обход[i], p=this._родитель[id];
      корни[id]=(p==null||p===undefined) ? id : корни[p];
      ветвь[id]=(p==null||p===undefined) ? null : (ветвь[p]==null ? id : ветвь[p]);
    }
    this._ветвь=ветвь; this._корень=корни;
    this._recalcSectors();
  }
  /* Ширина и место сектора зависят от того, ГДЕ ветка сейчас лежит и насколько разрослась,
     поэтому считать их один раз при сборке нельзя: в этот момент узлы ещё свалены в кучу.
     Пересчитываем по ходу раскладки — это один проход по узлам, дешевле любой силы в кадре. */
  _recalcSectors(){
    const ветвь=this._ветвь, корни=this._корень, вес=this._вес||{};
    if(!ветвь||!корни) return;
    const по={};                                    // корень → список его веток
    Object.keys(ветвь).forEach(id=>{ if(ветвь[id]!==id) return;   // сам себе ветка = ребёнок корня
      const к=корни[id]; (по[к]=по[к]||[]).push(id); });
    const серединаВетки={};
    Object.keys(ветвь).forEach(id=>{ const b=ветвь[id]; if(!b) return;
      const n=this.byId[id]; if(!n) return;
      const о=серединаВетки[b]||(серединаВетки[b]={x:0,y:0,к:0,узлы:[]});
      о.x+=n.x; о.y+=n.y; о.к++; о.узлы.push(n); });
    const сектор={};
    Object.keys(по).forEach(к=>{
      const узК=this.byId[к]; if(!узК) return;
      const список=по[к];
      const суммаВеса=список.reduce((s,b)=>s+((вес[b]||1)),0)||1;
      /* ШИРИНА СЕКТОРА — не только по весу, но и по МЕСТУ, которое ветка занимает на своём
         удалении. Ветка из шести узлов может висеть широким веером: сектор по весу выходил уже
         её собственного углового размера, и половина узлов оказывалась «вне сектора» просто
         потому, что поместиться там было нельзя (замер: 39 узлов из 77 вне своего угла).
         Берём большее из двух и нормируем, чтобы в сумме вышел полный круг. */
      const нужно={};
      let суммаНужд=0;
      список.forEach(b=>{
        const о=серединаВетки[b];
        let своё=2*Math.PI*((вес[b]||1)/суммаВеса);
        if(о && о.к){
          const цx=о.x/о.к, цy=о.y/о.к;
          const R=Math.max(60, Math.hypot(цx-узК.x, цy-узК.y));
          let разброс=0;
          for(let q=0;q<о.узлы.length;q++){ const n=о.узлы[q];
            const d=Math.hypot(n.x-цx, n.y-цy)+n.r; if(d>разброс) разброс=d; }
          const надо=2*Math.atan(разброс/R)+0.06;   // угловой размер ветки плюс просвет
          if(надо>своё) своё=надо;
        }
        нужно[b]=своё; суммаНужд+=своё;
      });
      const масштаб=(суммаНужд>0) ? (2*Math.PI/суммаНужд) : 1;
      // порядок — по нынешнему углу ветки относительно корня: так дерево не перекручивается
      список.sort((a,b)=>{
        const оа=серединаВетки[a], об=серединаВетки[b];
        const уа=оа?Math.atan2(оа.y/оа.к-узК.y, оа.x/оа.к-узК.x):0;
        const уб=об?Math.atan2(об.y/об.к-узК.y, об.x/об.к-узК.x):0;
        return уа-уб;
      });
      let угол=(()=>{ const о=серединаВетки[список[0]];
        return о?Math.atan2(о.y/о.к-узК.y, о.x/о.к-узК.x):-Math.PI; })();
      // первую ветку ставим туда, где она уже есть, а её сектор начинаем от её левого края
      угол-=нужно[список[0]]*масштаб/2;
      список.forEach(b=>{
        const ширина=нужно[b]*масштаб;
        сектор[b]={корень:к, центр:угол+ширина/2, полу:ширина/2};
        угол+=ширина;
      });
    });
    this._сектор=сектор;
  }
  /* Ветка узла с ГЛУБИНОЙ каждого потомка. Глубина нужна, чтобы шлейф двигался живо: ближние
     догоняют руку почти сразу, дальние тянутся следом.
     У ХАБА ОБЛАСТИ своих детей в остове нет (через хаб обход не идёт, иначе вся область
     оказалась бы его прямыми детьми) — поэтому веткой области считаем её ноды: сперва те, что
     сами лежат в области, а следом их поддеревья. Без этого область уезжала одна, растягивая
     лучи через пол-экрана, а ноды не двигались вовсе. */
  _branch(узел){
    const out=[], видели=new Set([узел.id]);
    const добавить=(n,гл)=>{ if(!n || видели.has(n.id)) return; видели.add(n.id); out.push({n, гл}); };
    let корни=[];
    if(узел.hubArea){
      const aid=узел.hubArea.id;
      this.nodes.forEach(n=>{ if(n.ref && n.ref.area===aid){ добавить(n,1); корни.push(n); } });
    } else {
      корни=[узел];
    }
    let слой=корни.map(n=>({n, гл:узел.hubArea?1:0}));
    let шаг=0;
    while(слой.length && out.length<4000 && шаг<200){
      const след=[];
      for(const z of слой){
        const дети=(this._дети && this._дети.get(z.n.id))||[];
        for(const id of дети){ const n=this.byId[id]; if(!n || видели.has(id)) continue;
          добавить(n, z.гл+1); след.push({n, гл:z.гл+1}); }
      }
      слой=след; шаг++;
    }
    return out;
  }
  /* Поддерево узла по остову — всё, что висит на нём ниже. Ветку тащат целиком. */
  _subtree(id){
    const out=[], дети=this._дети;
    if(!дети) return out;
    let слой=(дети.get(id)||[]).slice(), seen=new Set([id]);
    while(слой.length && out.length<4000){
      const след=[];
      for(const nid of слой){ if(seen.has(nid)) continue; seen.add(nid);
        const n=this.byId[nid]; if(n) out.push(n);
        const с=дети.get(nid); if(с) for(const k of с) след.push(k); }
      слой=след;
    }
    return out;
  }
  /* Сетка соседства: ноды разложены по ячейкам, чтобы «кто рядом» находилось за постоянное
     время. Ею пользуются и физика, и расчёт прогибов — оба раньше перебирали ВСЕ ноды на
     каждую связь (877×876 = 768 тысяч проверок за кадр). */
  _grid(rx, ry, cell){
    const CELL=cell||460, m=new Map(), N=this.nodes;
    for(let i=0;i<N.length;i++){
      const k=Math.floor(rx(N[i])/CELL)+","+Math.floor(ry(N[i])/CELL);
      const я=m.get(k); if(я) я.push(i); else m.set(k,[i]);
    }
    return {CELL, m};
  }
  // индексы нод в ячейках, покрывающих прямоугольник (с запасом)
  _near(сетка, minx, miny, maxx, maxy, pad){
    const out=[], C=сетка.CELL;
    const x1=Math.floor((minx-pad)/C), x2=Math.floor((maxx+pad)/C);
    const y1=Math.floor((miny-pad)/C), y2=Math.floor((maxy+pad)/C);
    for(let gx=x1; gx<=x2; gx++) for(let gy=y1; gy<=y2; gy++){
      const я=сетка.m.get(gx+","+gy); if(я) for(let q=0;q<я.length;q++) out.push(я[q]);
    }
    return out;
  }
  _recalcBends(RX, RY){
    const rx=RX||(n=>n.x+(n._ix||0)), ry=RY||(n=>n.y+(n._iy||0));
    const N=this.nodes, PAD=16, MAXH=70;
    const сетка=this._grid(rx, ry);
    /* Считаем прогибы только для связей В КАДРЕ — но лишь на БОЛЬШОМ дереве, где это главный
       расход кадра. На малом графе считаем всё подряд: там это доли миллисекунды, зато дуги
       готовы ещё до того, как камера на них наведётся (на этом спотыкались проверки). */
    const кадром=this.nodes.length>350;
    const z=this.zoom||1, зап=250;
    const вид={ x1:(-this.tx-зап)/z, y1:(-this.ty-зап)/z,
                x2:(this.W-this.tx+зап)/z, y2:(this.H-this.ty+зап)/z };
    for(let li=0; li<this.links.length; li++){
      const l=this.links[li], a=this.byId[l.a], b=this.byId[l.b];
      if(!a||!b){ l._bendT=null; continue; }
      const ax=rx(a), ay=ry(a), bx=rx(b), by=ry(b);
      const ex=bx-ax, ey=by-ay, L2=ex*ex+ey*ey;
      if(L2<1){ l._bendT=null; continue; }
      const minx=Math.min(ax,bx), maxx=Math.max(ax,bx), miny=Math.min(ay,by), maxy=Math.max(ay,by);
      /* «Вне кадра» НЕ трогает hubLink. Этот continue не обнуляет _bendT — старое значение просто
         остаётся, а пересчёт запускается лишь когда что-то ДВИГАЛОСЬ (this.alpha>0 || this.drag,
         см. _двигались в _tick — панорама и зум в это число не входят, камера физику не будит).
         Магистраль, ни разу не попавшая в кадр за время остывания раскладки, так и осталась бы
         прямой навсегда: подвинуть камеру к ней потом — не повод для пересчёта. Обычных рядовых
         лучей это не касается (их сотни, и они не хабLink — экономия ниже не пострадает), а
         единицы магистралей чужой камере всё равно проверять дёшево. */
      if(кадром && !l.hubLink && (maxx<вид.x1 || minx>вид.x2 || maxy<вид.y1 || miny>вид.y2)) continue;   // связь вне кадра
      /* Рядовые лучи принадлежности (лист → хаб напрямую) на большом дереве дуг не получают.
         Их столько же, сколько нод без своей пустышки рядом (членство рисуется лучом от хаба),
         они тянутся через пол-графа, и их рамка накрывает сотни нод — на 880 нодах это 58 мс из
         кадра, больше всей остальной физики вместе взятой. Обход помехи важен для связей между
         нодами, а не для фонового луча.
         МАГИСТРАЛИ (hubLink: хаб↔пустышка, пустышка↔пустышка) — ИСКЛЮЧЕНИЕ из исключения. Их
         не сотни, а единицы (по одной на пустышку), и это правило писалось до пустышек, когда
         единственными «hub_»-связями были как раз массовые рядовые лучи. Теперь толстая
         магистраль — самая заметная линия на графе, и обходить узлы на своём пути ей нужнее,
         чем кому-либо ещё (КРОЛИК прислал скриншот: магистраль идёт прямо сквозь чужие ветки). */
      if(кадром && !l.hubLink && (isHubId(l.a) || isHubId(l.b))){ l._bendT=null; continue; }
      /* Очень длинная связь дуг тоже не получает: её рамка накрывает пол-графа, то есть сотни
         кандидатов на каждую проверку, а обход помехи на таком пролёте глазом не читается. */
      if(кадром && L2>1440000){ l._bendT=null; continue; }
      let худший=null;
      /* ГИСТЕРЕЗИС: отпускаем позже, чем захватываем. Нода у границы зазора качается — физика
         её выталкивает, пружина к родителю возвращает — и прогиб мигал «есть/нет» по нескольку
         раз за секунду. Пока дуга жива, держим её до зазора + запас.
         ЗАПАС ОБЯЗАН ПЕРЕКРЫВАТЬ РАЗМАХ ДЫХАНИЯ. Ноды дышат (амплитуда graphDrift, по умолчанию
         4 px, то есть 8 px от края до края), и прежние 7 px этот размах не покрывали: нода,
         замершая ровно на границе зазора, мигала дугой В ТАКТ ДЫХАНИЮ, ничего не делая. Раньше
         это пряталось за общей стяжкой к центру — она сдвигала такие ноды с границы за пару
         кадров; с островами (см. build/_остров) граф стоит на месте, и пограничный случай стал
         обычным делом. */
      const _дых=(S.settings.graphDrift!=null?S.settings.graphDrift:4);
      const запас=l._bendT ? 7+2*_дых : 0;
      const рядом=this._near(сетка, minx, miny, maxx, maxy, 90);
      for(let ci=0; ci<рядом.length; ci++){
        const n=N[рядом[ci]]; if(n===a||n===b) continue;
        const nx=rx(n), ny=ry(n), need=n.r+PAD, порог=need+запас;
        if(nx<minx-порог || nx>maxx+порог || ny<miny-порог || ny>maxy+порог) continue;
        let t=((nx-ax)*ex+(ny-ay)*ey)/L2;
        if(t<=0.02 || t>=0.98) continue;                       // у самых концов не гнём: там нода — сосед
        const dx=nx-(ax+ex*t), dy=ny-(ay+ey*t), d2=dx*dx+dy*dy;
        if(d2>=порог*порог) continue;
        const d=Math.sqrt(d2), глуб=Math.max(0, need-d);        // в зоне гистерезиса глубина уже нулевая
        if(!худший || глуб>худший.глуб) худший={t, d, dx, dy, глуб};
      }
      if(!худший){ l._bendT=null; continue; }
      // уводим линию ПРОЧЬ от ноды; легла ровно на линию — уводим по нормали
      let ux, uy;
      if(худший.d>0.01){ ux=-худший.dx/худший.d; uy=-худший.dy/худший.d; }
      else { const L=Math.sqrt(L2); ux=-ey/L; uy=ex/L; }
      const h=Math.min(MAXH, худший.глуб+4);
      /* СТОРОНУ ОБХОДА НЕ ПЕРЕКИДЫВАЕМ. Когда нода лежит почти ровно на линии, направление
         считается от крошечного вектора, и от дрейфа в пару пикселей знак прыгал — дуга
         перебрасывалась через линию туда-сюда. Пока прогиб жив, держим прежнюю сторону. */
      const пред=l._bendT;
      if(пред && (пред.ox*ux + пред.oy*uy) < 0){ ux=-ux; uy=-uy; }
      l._bendT={t:худший.t, ox:ux*h, oy:uy*h};
    }
  }
  /* Прогиб ПЕРЕТЕКАЕТ к цели, а не прыгает на неё. Цель меняется скачками по своей природе:
     помеха сменилась на соседнюю, пересчёт идёт не каждый кадр, нода вышла из зазора. Без
     инерции каждый такой скачок был бы виден как рывок линии. */
  /* ==== ДИАГНОСТИКА ДРОЖИ (под выключателем дрожь(), по умолчанию молчит) ====
     Стенд эту дрожь замерить не может: в тестах кадры физики идут синхронно, поэтому дрейф нод
     (считается от performance.now) в них практически не меняется, а он и есть половина видимого
     движения. Поэтому мерим у живого приложения: пока ноду тащат, раз в секунду печатаем, какая
     нода дрожит сильнее всех, какова амплитуда и какая сила в ней преобладает.
     Все накопители — на объекте замера, а не на нодах: build() пересобирает this.nodes, и поля
     на нодах терялись бы посреди замера. */
  // Связать два узла. Связывать можно с чем угодно (заметка/задача/область), но не сам с собой
  // и не область с областью. ОБЛАСТЬ — ОСОБЫЙ СЛУЧАЙ: членство в области это поле it.area, а не
  // связь — линию элемент↔область граф рисует сам (см. build). Поэтому конец в хабе означает
  // «назначить область», а не addLink: хранимая связь заслонила бы авто-связь (pairs в build),
  // и «Открепить» в поп-апе связи перестало бы снимать область.
  // Возвращает текст тоста, либо null если связывать нечего.
  /* ЛОТОК неразобранного: мысли, брошенные в строку захвата, ждут тут, пока их не поставят на холст.
     Пусто — лотка не видно совсем: разбирать нечего, нечего и мозолить глаза.
     Свёрнутость живёт в настройках, а не в поле класса: разметка графа пересоздаётся на каждый
     render(), и поле обнулялось бы при каждом возврате на вкладку. */
  /* Тянем мысль из лотка на холст. Бросил на пустое место — она там и встала (это и есть «разобрал»).
     Бросил на ноду — встала и привязалась к ней (через _linkTo, поэтому бросок на область назначит область).
     Подсветку цели дёргаем ТОЛЬКО при её смене: на каждый mousemove она перекрашивала бы весь граф. */
  /* Покрасить ноду — и всё выделение заодно, если кликнутая нода в нём (тыкать по одной грустно).
     Если НЕ в нём — красим только её: ПКМ выделения не трогает, и покрасить невидимые «те пять
     из прошлой рамки» вместо той, по которой ткнули, было бы сюрпризом.
     persist/build — ОДИН раз в конце: в цикле это N записей на диск и N полных перестроений SVG.
     Рамка выделения хватает и области — у них цвет живёт на самой области, а не на элементе,
     и тянет за собой все ноды, что этот цвет наследуют. Поэтому в тосте считаем их отдельно. */
  /* Статус — как цвет: жмут по одной ноде, а применяется ко ВСЕМУ выделению, если кликнутая
     в нём. Не в нём — только к ней: ПКМ выделения не трогает, и менять статус невидимым «тем
     пяти из прошлой рамки» было бы сюрпризом. Повторное нажатие снимает статус.
     persist/build — ОДИН раз в конце: в цикле это N записей на диск и N перестроений SVG. */
  /* force=true — нарисовать кадр ОБЯЗАТЕЛЬНО, не пропуская. Так зовёт build(): фигуры он создаёт
     БЕЗ координат (их ставит этот метод), поэтому пропуск первого же кадра оставлял бы весь граф
     невидимым. Раньше это и происходило: пропуск ниже работает через раз, а если окно не в фокусе
     (например, открыт системный диалог выбора папки), то кадр не только пропускался, но и следующий
     не планировался — raf=null. Ноды исчезали до первого клика или движения графа. */
  /* Превью по одиночному клику: заглянуть внутрь, не открывая. Показывается через 350 мс —
     ждём, не будет ли второго клика (тогда открывается ридер, а превью отменяется).
     Переиспользуем id="node-pop": позиционирование и закрытие по клику мимо уже работают на нём. */
  _openPreview(n){
    if(!this.svg || !this.svg.isConnected) return;   // граф уже снесён (ушли на другую вкладку) — рисовать некуда
    this._closePop();
    const it=n.ref; if(!it) return;
    this.sel=n.id;
    const km = {i:kindIcon(it.kind), n:kindRu(it.kind)};
    const conn=linksOf(it.id);
    // в превью идёт и описание, и именованные поля: заглянуть внутрь — значит увидеть всё,
    // что в ноде написано, а не только общий блок
    const body=((it.body||"").trim()+"\n"+fieldsText(it)).trim();
    const pv=el("div"); pv.id="node-pop"; pv.className="node-preview";
    pv.innerHTML=`
      <div class="np-ttl">${esc(it.title)||"<i>без названия</i>"}</div>
      <div class="np-meta">
        <span><i class="ti ${km.i}"></i> ${km.n}</span>
        ${/* читаем флаги УЗЛА, а не сырой статус: у потухшей ноды работа и пауза погашены (см. build) */""}
        ${it.done?`<span><i class="ti ti-check"></i>готово</span>`:(n.doing?`<span><i class="ti ti-player-play"></i>в работе</span>`:(n.paused?`<span><i class="ti ti-player-pause"></i>на паузе</span>`:""))}
        ${it.area?`<span><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${conn.length?`<span><i class="ti ti-link"></i>${conn.length}</span>`:""}
      </div>
      <div class="pv-body">${it.kind==="flow" ? "<i>схема на полотне</i>"
        : (it.kind==="sub" && !body) ? `<i>внутри нод: ${((subGraphOf(it.id)||{items:[]}).items||[]).length}</i>`
        : (body?esc(body):"<i>пусто</i>")}</div>
      <div class="np-row"><button class="btn" data-pv="open"><i class="ti ${it.kind==="flow"||it.kind==="sub"?kindIcon(it.kind):"ti-eye"}"></i>Открыть</button></div>`;
    $("#graph-wrap").appendChild(pv);
    this._posPop(pv,n);
    // «Открыть» ведёт в ЧИТАЛЬНЫЙ вид, а не в редактор: из превью человек хочет прочитать
    // подробности, а не править поля. Задачи раньше открывались формой правки (Тип/Повтор/
    // Приоритет…) — она выглядит как настройки и к чтению отношения не имеет.
    // Полотно — исключение: у него нет текста, только своя схема.
    pv.querySelector('[data-pv="open"]').onclick=()=>{
      this._closePop();
      // подграф «открыть» = войти внутрь: читать в нём нечего, содержимое — это его граф
      if(it.kind==="sub") this._openNode(n);
      else if(it.kind==="flow") openFlowEditor(it); else openNoteReader(it);
    };
  }

  _openNode(n){
    // двойной клик: область → фильтр задач; заметка → ридер; задача → редактор
    this._closePop();
    /* ДВОЙНОЙ КЛИК ПО КОРНЮ — НАРУЖУ. Жест зеркалит вход: двойной клик по ноде-подграфу уводит
       внутрь, двойной клик по узлу, который этот подграф и обозначает, — обратно. Открывать в
       нём нечего: он не нода, а точка отсчёта. */
    if(n.subRoot){ if(subLeave()) render(); return; }
    if(n.type==="hub"){ areaFilter=n.id.replace("hub_",""); view="tasks"; render(); return; }
    const it=n.ref; if(!it) return;
    /* ПОДГРАФ ГЛАВНЕЕ ВСЕГО ОСТАЛЬНОГО. Двойной клик по нему — единственный жест входа внутрь,
       ради которого этот вид ноды и заведён; отдать его папке значило бы отобрать у подграфа
       его смысл (папку у такой ноды всё равно открывают кнопкой в панели). */
    if(it.kind==="sub"){
      if(subEnter(it)){ if(view!=="notes") view="notes"; render();
        toast("Подграф · "+((it.title||"").trim()||"без названия"),{icon:kindIcon("sub")}); }
      return;
    }
    /* ПАПКА ГЛАВНЕЕ РИДЕРА. Если к ноде привязана папка, двойной клик открывает её на ПК: у
       КРОЛИКА за нодой стоит шот или проект, и «открыть» для него значит попасть в рендеры и
       исходники, а не прочитать описание. Содержимое ноды никуда не девается — оно открывается
       правой панелью по одиночному клику и кнопкой в поп-апе. */
    if(it.folder){ openItemFolder(it); return; }
    openItemSmart(it);
  }
  // наведение на ноду (Obsidian-стиль): узел+соседи+связи между ними ПОДСВЕЧИВАЮТСЯ (.hl),
  // всё остальное гаснет (.dim). Плавно (transition в CSS). id=null — снять.
  _hover(id){
    /* Пока идёт поиск, гашением распоряжается ОН. Иначе достаточно было повести мышью по графу:
       курсор вне ноды даёт id=null, а тогда toggle("dim", false) снимал класс со ВСЕХ нод —
       и половина паутины снова загоралась поверх результатов поиска. */
    if(this._searchMatches && this._searchMatches.length) return;
    /* ПОВТОРНОЕ НАВЕДЕНИЕ НА ТУ ЖЕ НОДУ РАБОТЫ НЕ СТОИТ. Этот метод зовётся из onpointermove,
       то есть на КАЖДОЕ движение мыши — а мышь шлёт события чаще, чем идут кадры (125–1000 в
       секунду). Ниже перебираются все узлы и все связи: на тестовом графе КРОЛИКА это ~3600
       переключений классов на одно событие, и водить курсором по графу выходило дороже, чем
       считать физику. Цель наведения меняется редко (перешли на другую ноду или ушли на пустое
       место), поэтому сравнение с прошлым id убирает почти всю эту работу.
       Пометку сбрасывают те, кто меняет классы мимо этого метода: build() и уход поиска. */
    if(this._hovId===id) return;
    this._hovId=id;
    /* На холсте наведение НЕ гасит граф: от этого экран мигал, потому что курсор по дороге
       задевает узлы, и полграфа гасло и загоралось по нескольку раз в секунду. Гашением
       распоряжается выделение (см. _drawMain). Сам узел под курсором при этом подрастает и
       светится — кадр для этого разбудить надо. */
    if(this.canvasMode){
      /* ЦЕЛЬ ПОДСВЕТКИ СМЕНИЛАСЬ — значит она ПОЕДЕТ, и кадры нужны полные. Признак ставим
         ЗДЕСЬ, а не по факту движения в кадре: условие покоя проверяется РАНЬШЕ отрисовки, а
         к моменту ухода курсора прошлая анимация уже доехала и признак был снят. На большом
         дереве (дыхание выключено, >350 узлов) это роняло граф в ветку «рисуем только фон», и
         затухание двигалось лишь тогда, когда полный кадр случался по другой причине — скачками
         раз в 160 мс. Замер: 168 кадров/с под курсором против 6 кадров/с сразу после ухода. */
      this._навЕдет=true; this._wake(); return;
    }
    const родня=id?this._kin(id):null;   // у области и пустышки это вся их область (см. _kin)
    this.nodeEls.forEach(o=>{ const nid=o.n.id; const focus=!!id&&nid===id, nbr=!!id&&!!родня&&родня.has(nid);
      o.g.classList.toggle("dim", !!id && !focus && !nbr);
      o.g.classList.toggle("hl", focus||nbr);
      o.g.classList.toggle("hl-focus", focus);
    });
    this.linkEls.forEach((e,i)=>{ const l=this.links[i]; const on=!id||l.a===id||l.b===id;
      e.classList.toggle("dim", !!id && !on);
      e.classList.toggle("hl", !!id && on);
    });
  }
  /* МЯГКАЯ СВЯЗЬ. По умолчанию линия прямая — постоянные дуги отвергнуты, они читаются как
     жёсткие арки. Но если на линии лежит ЧУЖАЯ нода, связь прогибается ровно в этом месте и
     обходит её, а на остальной длине остаётся прямой. Это подстраховка к физике: та разводит
     узлы, только пока не остыла, и на плотном дереве часть случаев ей не по силам (узел зажат
     между своими связями). Прогиб же виден сразу и не двигает ни одной ноды.
     Глубина прогиба равна тому, насколько нода залезла в зазор: чуть задела — почти прямая,
     легла серединой — заметная дуга. Поэтому линия не «щёлкает» между двумя состояниями. */
  /* Считаем по ТЕМ ЖЕ координатам, по которым рисуем, — то есть с дрейфом (RX/RY), а не по
     базовым. Иначе дуга строится для одного положения, а линия рисуется для другого: при
     замере расстояние от неподвижной ноды до линии гуляло на 10 px только из-за дрейфа, и в
     тесном месте это читалось как дрожание. Дрейфуют и нода-помеха, и оба конца связи —
     ошибки складываются, поэтому учитывать надо всех троих. */
  /* Прогиб ПЕРЕТЕКАЕТ к цели, а не прыгает на неё. Цель меняется скачками по своей природе:
     помеха сменилась на соседнюю, пересчёт идёт не каждый кадр, нода вышла из зазора. Без
     инерции каждый такой скачок был бы виден как рывок линии. */
  _easeBends(){
    const K=0.14;
    let едут=false;
    for(let i=0;i<this.links.length;i++){
      const l=this.links[i], цель=l._bendT;
      let c=l._bendC;
      if(!цель && !c) continue;
      if(!c) c={t:цель.t, ox:0, oy:0};
      const tt=цель?цель.t:c.t, ox=цель?цель.ox:0, oy=цель?цель.oy:0;
      c.t+=(tt-c.t)*K; c.ox+=(ox-c.ox)*K; c.oy+=(oy-c.oy)*K;
      // дуга ещё едет к своей цели — это ДВИЖУЩАЯСЯ картинка, и уходить в покой нельзя
      // (см. _tick): иначе линия замерла бы на полпути к обходу помехи
      if(Math.abs(ox-c.ox)>0.2 || Math.abs(oy-c.oy)>0.2) едут=true;
      // цель ушла и остаток схлопнулся — снимаем прогиб совсем, чтобы путь снова стал прямым
      l._bendC=(!цель && Math.abs(c.ox)<0.3 && Math.abs(c.oy)<0.3) ? null : c;
    }
    this._дугиЕдут=едут;
  }
  /* ==== ДИАГНОСТИКА ДРОЖИ (под выключателем дрожь(), по умолчанию молчит) ====
     Стенд эту дрожь замерить не может: в тестах кадры физики идут синхронно, поэтому дрейф нод
     (считается от performance.now) в них практически не меняется, а он и есть половина видимого
     движения. Поэтому мерим у живого приложения: пока ноду тащат, раз в секунду печатаем, какая
     нода дрожит сильнее всех, какова амплитуда и какая сила в ней преобладает.
     Все накопители — на объекте замера, а не на нодах: build() пересобирает this.nodes, и поля
     на нодах терялись бы посреди замера. */
  _dbgNew(){
    const D={ кадров:0, по:new Map(), связи:new Map() };
    D.зап=n=>{ let r=D.по.get(n.id);
      if(!r){ r={ имя:n.label||n.id, кадров:0, разворотов:0, макс:0, сумма:0, физика:0, дрейф:0,
        минX:Infinity, максX:-Infinity, минY:Infinity, максY:-Infinity, силы:{},
        вЗоне:false, былВЗоне:false, вЗонеКадров:0, миганий:0, зБазМин:null, зБазМакс:null, зДрМин:null, зДрМакс:null,
        жертваКадров:0, жертваСвязь:"", жертваМин:null, жертваМакс:null, нетто:{},
        вКресте:false, былВКресте:false, крестКадров:0, крестМиганий:0 };
        D.по.set(n.id,r); }
      return r; };
    /* Пишем и МОДУЛЬ, и ВЕКТОРНУЮ СУММУ каждой силы. Модуль говорит, кто громче; сумма — что из
       этого доехало до ноды. Расхождение и есть диагноз: «родитель 30 по модулю, 0.4 в сумме» —
       это не виновник, а хаб с десятью детьми, чьи пружины гасят друг друга. Первая версия писала
       только модуль, и наверх лезли именно такие хабы. */
    D.сила=(n,ист,fx,fy)=>{ const r=D.зап(n);
      r.силы[ист]=(r.силы[ист]||0)+Math.hypot(fx,fy);
      const в=r.нетто[ист]||(r.нетто[ист]={x:0,y:0}); в.x+=fx; в.y+=fy; };
    /* ЖЕРТВА РУКИ — нода, к которой ближе зазора подошла связь ТАЩИМОЙ ноды. Это ровно то, что
       описывает КРОЛИК («держу ноду, её связь проходит близко к другой, та дрожит»), поэтому такую
       ноду отчёт печатает ВСЕГДА, не полагаясь на ранжирование: сортировка по разворотам выносила
       наверх ноды с шагом 0.2 px, а настоящую жертву прятала. */
    /* Расплетение перекрестий — единственная сила, которая либо есть целиком, либо её нет вовсе:
       величина постоянная (1.8·alpha), затухания по расстоянию нет. Перекрестье появилось на кадр
       и исчезло — нода получила полный толчок и осталась без него, то есть ровно тот «включился-
       выключился», из которого и получается дрожь. Поэтому считаем не только силу, но и МИГАНИЯ. */
    D.крест=n=>{ D.зап(n).вКресте=true; };
    D.жертва=(n,подпись,d)=>{ const r=D.зап(n); r.жертваКадров++; r.жертваСвязь=подпись;
      if(r.жертваМин==null||d<r.жертваМин) r.жертваМин=d;
      if(r.жертваМакс==null||d>r.жертваМакс) r.жертваМакс=d; };
    D.зазор=(n,баз,дрейф)=>{ const r=D.зап(n); r.вЗоне=true;
      if(r.зБазМин==null||баз<r.зБазМин) r.зБазМин=баз;
      if(r.зБазМакс==null||баз>r.зБазМакс) r.зБазМакс=баз;
      if(r.зДрМин==null||дрейф<r.зДрМин) r.зДрМин=дрейф;
      if(r.зДрМакс==null||дрейф>r.зДрМакс) r.зДрМакс=дрейф; };
    return D;
  }
  _dbgFrame(D){
    const тащим=this.drag;
    if(!тащим){                                    // отпустили — доложить итог и начать с чистого листа
      if(D.кадров>4) this._dbgPrint(D,"отпустили");
      else { D.кадров=0; D.по=new Map(); D.связи=new Map(); }
      return;
    }
    D.кадров++;
    for(const n of this.nodes){
      if(n===тащим || n._grabbed) continue;        // ноды в руке ведёт жест, а не физика — в замер дрожи они не идут
      const r=D.зап(n);
      const vx=n.x+(n._ix||0), vy=n.y+(n._iy||0);  // ВИДИМАЯ позиция: дрожь человек видит в ней
      if(r.пx!=null){
        const шx=vx-r.пx, шy=vy-r.пy, ш=Math.hypot(шx,шy);
        // разворот — шаг пошёл против предыдущего; порог 0.05 px отсекает шум округлений
        if(r.шx!=null && ш>0.05 && (шx*r.шx+шy*r.шy)<0) r.разворотов++;
        r.шx=шx; r.шy=шy;
        if(ш>r.макс) r.макс=ш;
        r.сумма+=ш; r.кадров++;
        r.физика+=Math.hypot(n.x-r.бx, n.y-r.бy);                    // сколько дала физика
        r.дрейф+=Math.hypot((n._ix||0)-r.дx, (n._iy||0)-r.дy);       // сколько дало «дыхание»
      }
      r.пx=vx; r.пy=vy; r.бx=n.x; r.бy=n.y; r.дx=n._ix||0; r.дy=n._iy||0;
      if(vx<r.минX) r.минX=vx; if(vx>r.максX) r.максX=vx;
      if(vy<r.минY) r.минY=vy; if(vy>r.максY) r.максY=vy;
      if(r.вЗоне) r.вЗонеКадров++;
      if(r.вЗоне!==r.былВЗоне){ r.миганий++; r.былВЗоне=r.вЗоне; }   // зона отталкивания включается/выключается
      r.вЗоне=false;                                                 // следующий кадр поставит заново, если сила придёт
      if(r.вКресте) r.крестКадров++;
      if(r.вКресте!==r.былВКресте){ r.крестМиганий++; r.былВКресте=r.вКресте; }
      r.вКресте=false;
    }
    /* Прогибы: «немного дёргается и сама линия» — мигания цели и шаг уже сглаженной дуги. Первый
       кадр НЕ считаем: запись создаётся с нуля, а у связи прогиб уже есть, и разница читалась как
       скачок на 25 px — из-за этого в прошлом отчёте у каждой линии стоял ровно один «мигание,
       макс шаг ~25 px», то есть артефакт замера, а не поведение графа. Смотрим только связи
       ТАЩИМОЙ ноды: остальные к симптому отношения не имеют. */
    for(let i=0;i<this.links.length;i++){
      const l=this.links[i];
      const a=this.byId[l.a], b=this.byId[l.b];
      if(a!==тащим && b!==тащим) continue;
      const c=l._bendC||{ox:0,oy:0};
      let s=D.связи.get(l);
      if(!s){ s={миганий:0, был:!!l._bendT, макс:0, пox:c.ox, пoy:c.oy,
                 чей:((a&&a.label)||l.a)+" → "+((b&&b.label)||l.b)}; D.связи.set(l,s); continue; }
      const есть=!!l._bendT;
      if(есть!==s.был){ s.миганий++; s.был=есть; }
      const ш=Math.hypot(c.ox-s.пox, c.oy-s.пoy);
      if(ш>s.макс) s.макс=ш;
      s.пox=c.ox; s.пoy=c.oy;
    }
    if(D.кадров>=60) this._dbgPrint(D,"60 кадров");
  }
  _dbgPrint(D, повод){
    const ч=v=>v==null?"—":v.toFixed(1);
    const т=this.drag;
    const живые=[...D.по.values()].filter(r=>r.кадров>2);
    /* РАНЖИРУЕМ ПО РАЗМАХУ ДРОЖИ (развороты × средний шаг), а не по одним разворотам. По
       разворотам наверх выходили ноды с шагом 0.18 px — формально самые «дёрганые», а глазом
       неподвижные; настоящая жертва с шагом 1.3 px оставалась за бортом отчёта. */
    const оценка=r=>r.разворотов*(r.сумма/r.кадров);
    const топ=живые.slice().sort((a,b)=>оценка(b)-оценка(a));
    const жертвы=живые.filter(r=>r.жертваКадров).sort((a,b)=>b.жертваКадров-a.жертваКадров);
    // Строки собираем, а не печатаем сразу: тот же текст уходит в файл одним вызовом моста
    // (по вызову на строку мост захлебнулся бы — отчёт печатается раз в секунду).
    const строки=[], п=s=>{ строки.push(s); console.log(s); };
    const блок=(r, метка)=>{
      const сум=Object.values(r.силы).reduce((s,v)=>s+v,0)||1;
      const силы=Object.entries(r.силы).sort((a,b)=>b[1]-a[1]).map(([k,v])=>{
        const в=r.нетто[k]||{x:0,y:0};
        return `${k} ${(v/r.кадров).toFixed(2)}→${(Math.hypot(в.x,в.y)/r.кадров).toFixed(2)} (${Math.round(v/сум*100)}%)`;
      }).join(" · ") || "нет";
      п(`  ${метка} «${r.имя}»: разворотов ${r.разворотов} за ${r.кадров}, шаг макс ${r.макс.toFixed(2)} / средн ${(r.сумма/r.кадров).toFixed(2)} px, размах ${Math.max(r.максX-r.минX, r.максY-r.минY).toFixed(1)} px`);
      п(`      физика ${(r.физика/r.кадров).toFixed(2)} px/кадр · дрейф ${(r.дрейф/r.кадров).toFixed(2)} px/кадр · оценка дрожи ${оценка(r).toFixed(2)}`);
      п(`      силы (модуль→сумма за кадр): ${силы}`);
      if(r.жертваКадров) п(`      связь руки «${r.жертваСвязь}»: ${r.жертваКадров} кадров ближе зазора, расстояние ${ч(r.жертваМин)}…${ч(r.жертваМакс)} px`);
      if(r.крестКадров) п(`      расплетение крестий: ${r.крестКадров} кадров из ${r.кадров}, миганий ${r.крестМиганий}`);
      п(r.вЗонеКадров
        ? `      зона связи: ${r.вЗонеКадров} кадров, миганий ${r.миганий}; проникновение по базовым ${ч(r.зБазМин)}…${ч(r.зБазМакс)} px, по дрейфующим ${ч(r.зДрМин)}…${ч(r.зДрМакс)} px`
        : `      рядом связей нет`);
    };
    п(`[дрожь] ${повод}: alpha ${this.alpha.toFixed(2)}, тащим «${т?(т.label||т.id):"—"}», нод ${this.nodes.length}, связей ${this.links.length}`);
    // Жертвы связи руки — ВСЕГДА, даже с нулём разворотов: их отсутствие тоже факт («связь ни к
    // кому не подошла ближе зазора»), и без него не понять, тот ли жест воспроизводился.
    if(жертвы.length) жертвы.slice(0,2).forEach(r=>блок(r,"ЖЕРТВА"));
    else п(`  ЖЕРТВ НЕТ: связи тащимой ноды ни к кому не подошли ближе зазора`);
    топ.filter(r=>!r.жертваКадров).slice(0,2).forEach((r,i)=>блок(r, i===0?"дрожит→":"дрожит "));
    const св=[...D.связи.values()].sort((a,b)=>(b.макс-a.макс)||(b.миганий-a.миганий))[0];
    if(св) п(`  прогиб связи руки «${св.чей}»: миганий ${св.миганий}, макс шаг ${св.макс.toFixed(2)} px`);
    if(_дрожьВФайл && HasPy() && window.pywebview.api.shake_log){
      const час=new Date().toLocaleTimeString("ru-RU");
      try{ window.pywebview.api.shake_log(час+"  "+строки.join("\n")+"\n"); }catch(e){}
    }
    D.кадров=0; D.по=new Map(); D.связи=new Map();
  }
  _linkPath(ax,ay,bx,by,l){
    const bd=l&&l._bendC;
    if(!bd) return `M ${ax.toFixed(1)} ${ay.toFixed(1)} L ${bx.toFixed(1)} ${by.toFixed(1)}`;
    /* Контрольная точка квадратичной кривой отводится на ДВОЙНОЕ смещение: сама кривая проходит
       примерно посередине между прямой и этой точкой. */
    const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t;
    const cx=px+bd.ox*2, cy=py+bd.oy*2;
    return `M ${ax.toFixed(1)} ${ay.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
  }
  startLink(id){ this.linkFrom=id; this.svg.classList.add("linking"); $("#g-hint").innerHTML="Режим связи: кликни по второму узлу. Esc — отмена."; this._closePop(); }
  cancelLink(){ this.linkFrom=null; this.svg.classList.remove("linking"); this.tempLine.style.display="none"; if($("#g-hint"))$("#g-hint").innerHTML="Alt+тащи от ноды — связь/заметка · Ctrl+тащи — копия выделенного · ПКМ — меню / создать · ЛКМ-рамка — выделить · средняя кнопка — двигать · Delete — удалить"; }
  // Связать два узла. Связывать можно с чем угодно (заметка/задача/область), но не сам с собой
  // и не область с областью. ОБЛАСТЬ — ОСОБЫЙ СЛУЧАЙ: членство в области это поле it.area, а не
  // связь — линию элемент↔область граф рисует сам (см. build). Поэтому конец в хабе означает
  // «назначить область», а не addLink: хранимая связь заслонила бы авто-связь (pairs в build),
  // и «Открепить» в поп-апе связи перестало бы снимать область.
  // Возвращает текст тоста, либо null если связывать нечего.
  /* Область узла, если КОНЕЦ связи — хаб или пустышка; иначе null. Обе точки означают одно
     и то же действие («сделать область своей»), и должны определяться ОДНИМ способом — иначе
     хаб и пустышка снова разъедутся в поведении, как уже было (см. историю ниже). */
  _endArea(id, it){
    if(id.indexOf("hub_")===0) return id.slice(4);
    return (it && it.hollow && it.area) ? it.area : null;
  }
  _linkTo(from, to){
    if(to===from) return null;
    const итA=S.items.find(x=>x.id===from), итB=S.items.find(x=>x.id===to);
    const обА=this._endArea(from,итA), обБ=this._endArea(to,итB);
    if(обА!=null && обБ!=null){
      /* ОБЕ СТОРОНЫ — ХАБ ИЛИ ПУСТЫШКА. Разных областей — точно не связываем (нет смысла).
         Внутри ОДНОЙ — тут ПУСТЫШКУ можно протяжкой прицепить к другой пустышке или к хабу,
         тем же результатом, что кнопка «Ещё пустышка» в её меню (hollowParent), только без
         похода в меню. Раньше это молча ничего не делало — Alt-тащи от одной пустышки на
         другую гасилось этой же строкой, и КРОЛИК получал на экране тонкую линию непонятно
         откуда (или вовсе ничего), а не то, что ожидал от жеста. Хаб с хабом — он один на
         область, цеплять некуда. */
      if(обА!==обБ) return null;
      const хабA=from.indexOf("hub_")===0, хабB=to.indexOf("hub_")===0;
      if(хабA && хабB) return null;
      // хаб с одной из сторон — пустышка это ДРУГАЯ сторона; если хаба нет вовсе (обе пустышки),
      // цепляется та, ОТКУДА тянули (from) — как и везде в этом жесте, «от» становится ребёнком
      const пуст=хабA?итB:(хабB?итA:итA);
      if(!пуст || !пуст.hollow) return null;   // хаб с хабом уже отсеян выше; тут — «пустышки вовсе нет»
      const цельId=пуст.id===from?to:from;
      if(цельId.indexOf("hub_")!==0){
        const цельIt=S.items.find(x=>x.id===цельId);
        if(!цельIt || !цельIt.hollow) return null;
        if(цельIt.id===пуст.hollowParent) return "Уже прицеплена";
        пуст.hollowParent=цельIt.id;
      } else {
        if(!пуст.hollowParent) return "Уже к хабу";
        delete пуст.hollowParent;                    // потянули на сам хаб — снять цепочку явно
      }
      touch(пуст); persist(); recomputeHierarchy();
      return "Пустышка прицеплена";
    }
    if(обА!=null || обБ!=null){
      const aid=обА!=null?обА:обБ, it=обА!=null?итB:итA;
      if(!it) return null;
      if(it.area===aid && it.areaAuto===false) return "Уже в области";
      /* ХАБ И ПУСТЫШКА — ОДНО ПРАВИЛО: область становится СВОЕЙ (areaAuto=false), а не
         привязывается постоянной ручной связью к ОДНОЙ конкретной точке. Раньше пустышка шла
         другим путём (addLink + areaAuto=true, «унаследовано») — нода намертво приклеивалась
         к ТОЙ САМОЙ пустышке и переставала участвовать в выборе по расстоянию: подвинь
         пустышку в сторону — нода всё равно тянулась следом, хотя рядом мог оказаться хаб или
         другая пустышка ближе (КРОЛИК: «не может перескакивать на другую пустышку»).
         own-area делает её равноправным участником автовыбора (см. build/_reevaluateAnchors) —
         эта точка ей достаётся потому, что она ближе СЕЙЧАС, а не потому что зашита навсегда. */
      it.area=aid; it.areaAuto=false;
      touch(it); persist();
      return "В области: "+areaName(aid);
    }
    // Цвет от соседа тут НЕ пишем: он ВЫЧИСЛЯЕТСЯ в build() при каждой отрисовке, пока
    // у ноды нет своего. Запись сделала бы наследование одноразовым и заморозила бы цвет.
    const ок=addLink(from,to);
    return ок ? "Связь создана" : "Уже связаны";
  }
  /* СОЗДАНИЕ ПУСТЫШКИ — общая точка для кнопки в меню хаба и в меню самой пустышки (пустышек
     в одной области можно заводить сколько нужно, каждая разгружает свой участок дерева).
     Область СВОЯ (areaAuto=false) — это не мелочь: наследование идёт по связям от того, у кого
     область задана руками, и унаследованная пустышка порвала бы цепочку до хаба (первая версия
     так и сделала, проверка поймала). Связывание НЕ включаем: ноды теперь сами находят
     ближайшую точку крепления по расстоянию (см. build/_reevaluateAnchors), и навязанный режим
     «клик по второй ноде» только мешал бы — КРОЛИК так и сказал.
     ЦЕПОЧКА ПУСТЫШЕК: если создали ИЗ ПОПАПА ДРУГОЙ ПУСТЫШКИ (рядом.hollow), новая крепится
     К НЕЙ, а не к хабу напрямую — «жму ПКМ по пустышке и добавляю ещё, она должна цепляться к
     этой пустышке, а не к ноде области». Хранится явным полем (hollowParent), а не выбором по
     расстоянию: это осознанное решение человека в момент создания, а не то, что физике решать
     заново каждый кадр — опору не должно сносить, стоит облаку узлов вокруг чуть сместиться.
     Название СРАЗУ ставим как у области: пустышка — это она и есть, просто другая точка входа,
     и должна читаться так с первого взгляда, а не значиться безликим «Узел». Подпись при этом
     живая (см. build(): label узла-пустышки берётся из areaName() каждый раз), это лишь
     стартовое значение title. */
  _createHollow(areaId, рядом){
    const обл=areaById(areaId);
    const пуст=addItem({kind:"note", title:(обл&&обл.name)||"Пустышка", area:areaId});
    пуст.hollow=true; пуст.areaAuto=false;
    if(рядом && рядом.hollow) пуст.hollowParent=рядом.id;
    пуст.x=(рядом?рядом.x:this.W/2)+90; пуст.y=(рядом?рядом.y:this.H/2)+20;
    touch(пуст); recomputeHierarchy(); persist(); this.build();
    toast("Пустышка создана — перетащи её ближе к нужным нодам, они прицепятся сами",{icon:"ti-circle-dashed"});
    return пуст;
  }
  /* Обратное действие: отцепили ноду от пустышки — вернуть ей область СВОЕЙ. Актуально для
     СТАРЫХ данных, где привязка к пустышке ещё шла ручной связью (areaAuto=true) — новые
     привязки идут через _linkTo и own-area сразу, отдельного «открепления» не просят вовсе.
     Без этого метода открепление старой связи оставляло бы ноду вовсе без области: сняли
     развилку — потеряли принадлежность. */
  _fromLiveNode(from, to){
    const a=S.items.find(x=>x.id===from), b=S.items.find(x=>x.id===to);
    if(!a||!b) return;
    for(const [пуст, нода] of [[a,b],[b,a]]){
      if(!пуст.hollow || нода.hollow) continue;
      if(нода.areaAuto===true && нода.area && нода.area===пуст.area){
        нода.areaAuto=false; touch(нода);
      }
    }
  }
  /* РОДНЯ УЗЛА для подсветки наведением — ОДНО правило на всех: кто РЕАЛЬНО СВЯЗАН, то есть
     чей луч принадлежности (или обычная связь) идёт именно к этому узлу. Для хаба это уже так:
     в adj лежат только те, кто выбрал его точкой крепления (см. build). Для пустышки — ровно
     то же самое, БЕЗ подмешивания связей хаба: я один раз попробовал объединить их («пустышка
     показывает то же, что хаб»), и это оказалось неверно — навёл на пустышку, а зажглась вся
     область целиком, включая тех, кто к пустышке не имеет отношения. У ПУСТЫШКИ родня — именно
     её собственные связи, она не особая.
     ХАБ — ИСКЛЮЧЕНИЕ, и намеренное: он представляет ВСЮ область, а не одну развилку, поэтому
     его наведение обязано показать не только тех, кто зацепился напрямую, но и тех, кто пришёл
     через её пустышки («…должны подсвечиваться ноды, которые соединены непосредственно с этой
     областью И ПУСТЫШКАМИ в этой области»). Уходить глубже (родня пустышек ИХ пустышек и так
     далее) не нужно: цепочки пустышка-от-пустышки — редкий, глубоко вложенный случай, а хаб
     должен показывать общую картину области, а не разворачивать её целиком до последнего листа. */
  _kin(id){
    const n=this.byId[id];
    if(n && n.type==="hub" && this._пустышкиПоОбласти){
      const обл=id.slice(4), s=new Set(this.adj[id]||[]);
      (this._пустышкиПоОбласти[обл]||[]).forEach(p=>{ s.add(p.id);
        (this.adj[p.id]||[]).forEach(x=>s.add(x)); });
      return s;
    }
    return this.adj[id]||null;
  }
  /* ПЕРЕОЦЕНКА ЯКОРЕЙ — та же логика выбора точки крепления, что в build(), но по ЖИВЫМ
     координатам и без пересборки всего графа. Нужна, чтобы нода понимала «пустышку, к которой
     я прицепилась, унесли рукой — пора выбрать другую точку», а не тянулась за ней пружиной
     до бесконечности. Область можно передать, чтобы пересчитать только её узлы (дёшево во время
     перетаскивания конкретной пустышки); без аргумента считается весь граф.
     Пустышки в пересчёте НЕ участвуют: они сами всегда крепятся к хабу — так задумано, чтобы
     дерево не расползалось на пустышки, цепляющиеся друг за друга. */
  _reevaluateAnchors(область){
    if(!this._якорь) return;
    const пустышки=this._пустышкиПоОбласти||{}, pairs=this._ручныеПары||new Set();
    for(const id in this._якорь){
      const я=this.byId[id]; if(!я || я.hollow) continue;
      if(область && я.area!==область) continue;
      const hub="hub_"+я.area, хабУзел=this.byId[hub]; if(!хабУзел) continue;
      const дист=(м)=>{ const dx=я.x-м.x, dy=я.y-м.y; return Math.sqrt(dx*dx+dy*dy); };
      let цель=hub, лучшее=дист(хабУзел);
      (пустышки[я.area]||[]).forEach(p=>{ if(p.id===id) return;
        const d=дист(p); if(d<лучшее){ лучшее=d; цель=p.id; } });
      const текущий=this._якорь[id];
      if(текущий===цель) continue;
      // гистерезис: прежний выбор держится, пока не отстал от лучшего больше чем на 15%
      if(this.byId[текущий] && дист(this.byId[текущий])<=лучшее*1.15) continue;
      if(pairs.has(id+"|"+цель)) continue;      // к новой цели уже есть РУЧНАЯ связь — авто-луч не нужен
      const л=this.links.find(x=>!x.manual && x.a===id && x.b===текущий);
      if(!л) continue;                          // связи почему-то нет — переключать нечего
      if(this.adj[текущий]) this.adj[текущий].delete(id);
      if(this.adj[id]) this.adj[id].delete(текущий);
      л.b=цель; л._bendC=null; л._bendT=null;    // прогиб был рассчитан для старой геометрии
      if(!this.adj[цель]) this.adj[цель]=new Set();
      this.adj[цель].add(id);
      if(this.adj[id]) this.adj[id].add(цель);
      this._якорь[id]=цель;
    }
  }
  /* Форма узла: задаётся стилем тега, иначе выводится из типа. Считают её и отрисовка, и
     попадание мышью, поэтому правило живёт в одном месте — разъехавшись, они дали бы «клик
     мимо угла квадрата». */
  /* Подграф — ШЕСТИУГОЛЬНИК: форма читается как «собранное из частей» и не путается ни с
     квадратом задачи, ни с ромбом полотна. Ужимать его, как квадрат и ромб (см. n.r*=0.86
     в build), не надо — вписанный шестиугольник по площади МЕНЬШЕ круга того же радиуса. */
  _shape(n){ return (n.tagStyle&&n.tagStyle.shape) ? n.tagStyle.shape
                  : (n.type==="task"?"square" : n.type==="flow"?"diamond" : n.type==="sub"?"hexagon" : "circle"); }
  _nodeAt(e){ return this._hitNode(e); }
  /* ПОПАДАНИЕ ПО КООРДИНАТАМ. На SVG за это отвечал сам браузер: у каждой ноды невидимый круг
     захвата (см. HIT_PAD), и хватало e.target.closest(".g-node"). На холсте элементов нет —
     ищем ближайший узел сами, по тем же правилам: та же кайма в мировых единицах и та же
     видимая позиция (с дрейфом), по которой узел нарисован, иначе у краёв пойдут промахи.
     Перебор идёт по всем узлам, но это одно сравнение на узел (на 654 узлах — сотые доли
     миллисекунды), и жест обязан отвечать точно, а не приблизительно.
     Ближайший, а не первый попавшийся: узлы перекрываются, и брать надо тот, что сверху. */
  _hitNode(e){
    if(!this.canvasMode){ const g=e.target&&e.target.closest?e.target.closest(".g-node"):null; return g?g.dataset.id:null; }
    const p=this._pt(e);
    let лучший=null, лучшее=Infinity;
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i], nx=n.x+(n._ix||0), ny=n.y+(n._iy||0);
      const ф=this._shape(n), far=(ф==="square"||ф==="diamond")?n.r*1.41:n.r;
      const R=far+(n.type==="hub"?0:HIT_PAD);
      const dx=p.x-nx, dy=p.y-ny, d2=dx*dx+dy*dy;
      if(d2>R*R) continue;
      if(d2<лучшее){ лучшее=d2; лучший=n.id; }
    }
    return лучший;
  }
  /* Попадание по СВЯЗИ — для меню связи по клику. Считаем расстояние до отрезка, порог берём
     в экранных пикселях (7 — половина прежнего SVG-хитбокса в 14): иначе на отдалённом графе
     линии стали бы неприлично «толстыми» для мыши, а вблизи — недосягаемыми. Ноды главнее:
     их проверяют до связей, поэтому здесь про перекрытие думать не нужно. */
  _hitLink(e){
    const p=this._pt(e), порог=7/(this.zoom||1);
    let лучший=-1, лучшее=порог*порог;
    for(let i=0;i<this.links.length;i++){
      const l=this.links[i], a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
      const ax=a.x+(a._ix||0), ay=a.y+(a._iy||0), bx=b.x+(b._ix||0), by=b.y+(b._iy||0);
      const ex=bx-ax, ey=by-ay, e2=ex*ex+ey*ey; if(e2<1) continue;
      let t=((p.x-ax)*ex+(p.y-ay)*ey)/e2; if(t<0)t=0; else if(t>1)t=1;
      const dx=p.x-(ax+ex*t), dy=p.y-(ay+ey*t), d2=dx*dx+dy*dy;
      if(d2<лучшее){ лучшее=d2; лучший=i; }
    }
    return лучший;
  }
  /* ЛОТОК неразобранного: мысли, брошенные в строку захвата, ждут тут, пока их не поставят на холст.
     Пусто — лотка не видно совсем: разбирать нечего, нечего и мозолить глаза.
     Свёрнутость живёт в настройках, а не в поле класса: разметка графа пересоздаётся на каждый
     render(), и поле обнулялось бы при каждом возврате на вкладку. */
  _renderTray(){
    const wrap=this.svg.parentNode; if(!wrap) return;
    const tray=wrap.querySelector("#g-tray"); if(!tray) return;
    const loose=S.items.filter(it=>inWeb(it) && it.x==null);
    if(!loose.length){ tray.style.display="none"; $(".gt-list",tray).innerHTML=""; return; }   // и список чистим, иначе в скрытом лотке остаются мёртвые строки
    tray.style.display="";
    const open=S.settings.trayOpen===true;   // по умолчанию свёрнут: бросил мысль — увидел цифру, а не раскрытую панель поперёк холста
    tray.classList.toggle("closed",!open);
    $(".gt-n",tray).textContent=loose.length;
    $(".gt-tab",tray).title=open?"Свернуть":"Неразобранных: "+loose.length;
    $(".gt-tab",tray).onclick=()=>{ S.settings.trayOpen=!open; persist(); this._renderTray(); };
    if(!open){ $(".gt-list",tray).innerHTML=""; return; }   // свёрнут — список не строим вовсе
    const ic=it=>kindIcon(it.kind);
    $(".gt-list",tray).innerHTML=loose.map(it=>{ const t=(it.title||"").trim()||"(без названия)";
      return `<div class="gt-it" data-tid="${it.id}" title="${esc(t)}"><i class="ti ${ic(it)}"></i><span>${esc(t)}</span><button class="gt-del" data-del="${it.id}" title="Удалить в корзину"><i class="ti ti-x"></i></button></div>`; }).join("");
    // тащить на холст — но не когда жмут на крестик удаления
    $$(".gt-it",tray).forEach(el=>{ el.onpointerdown=e=>{ if(e.button===0 && !e.target.closest(".gt-del")) this._trayGrab(e,el); }; });
    // удалить элемент из лотка — сразу насовсем, с возвратом по кнопке в тосте
    $$(".gt-del",tray).forEach(b=>{
      b.onpointerdown=e=>e.stopPropagation();   // не запускать перетаскивание
      b.onclick=e=>{ e.stopPropagation(); const id=b.dataset.del;
        const пакет=deletePack([id]); render();
        toast("Удалено",{icon:"ti-trash",label:"Вернуть",onAction:()=>{ restorePack(пакет); render(); }});
      };
    });
  }
  /* Тянем мысль из лотка на холст. Бросил на пустое место — она там и встала (это и есть «разобрал»).
     Бросил на ноду — встала и привязалась к ней (через _linkTo, поэтому бросок на область назначит область).
     Подсветку цели дёргаем ТОЛЬКО при её смене: на каждый mousemove она перекрашивала бы весь граф. */
  _trayGrab(e, el){
    const id=el.dataset.tid, it=S.items.find(x=>x.id===id); if(!it) return;
    e.preventDefault();
    const wrap=this.svg.parentNode, rc=wrap.getBoundingClientRect();
    const ghost=el.cloneNode(true); ghost.className="gt-ghost"; wrap.appendChild(ghost);
    const at=ev=>{ ghost.style.left=(ev.clientX-rc.left)+"px"; ghost.style.top=(ev.clientY-rc.top)+"px"; };
    at(e);
    let over=null;
    const move=ev=>{ at(ev); const t=this._nodeAt(ev); if(t!==over){ over=t; this._hover(t); } };
    const up=ev=>{
      el.removeEventListener("pointermove",move); el.removeEventListener("pointerup",up); el.removeEventListener("pointercancel",up);
      try{ el.releasePointerCapture(ev.pointerId); }catch(_){}
      ghost.remove(); this._hover(null);
      const target=this._nodeAt(ev);                       // ищем ДО перестроения, пока DOM ещё прежний
      const sr=this.svg.getBoundingClientRect();
      if(ev.clientX<sr.left||ev.clientX>sr.right||ev.clientY<sr.top||ev.clientY>sr.bottom) return;   // мимо холста — пусть лежит дальше
      const p=this._pt(ev);
      it.x=Math.round(p.x); it.y=Math.round(p.y); touch(it); persist();
      recomputeHierarchy(); this.build();                  // теперь нода есть в byId — можно связывать
      let msg=null;
      if(target && target!==id){ msg=this._linkTo(id,target);
        if(msg){ recomputeHierarchy(); this.build(); this.alpha=Math.max(this.alpha,0.12); } }   // бросил прямо на ноду — мягко разведём, чтобы не легли друг на друга
      /* Дом в точке, где отпустили. ПОСЛЕ _linkTo: бросок на ноду или на область как раз и
         назначает владельца, а до него смещение считалось бы не от того. */
      if(S.settings.graphHome && this._homeFromDrag(it)) persist();
      toast(msg||"На холсте",{icon:"ti-check"});
    };
    el.setPointerCapture(e.pointerId);
    el.addEventListener("pointermove",move); el.addEventListener("pointerup",up); el.addEventListener("pointercancel",up);
  }
  /* Покрасить ноду — и всё выделение заодно, если кликнутая нода в нём (тыкать по одной грустно).
     Если НЕ в нём — красим только её: ПКМ выделения не трогает, и покрасить невидимые «те пять
     из прошлой рамки» вместо той, по которой ткнули, было бы сюрпризом.
     persist/build — ОДИН раз в конце: в цикле это N записей на диск и N полных перестроений SVG.
     Рамка выделения хватает и области — у них цвет живёт на самой области, а не на элементе,
     и тянет за собой все ноды, что этот цвет наследуют. Поэтому в тосте считаем их отдельно. */
  _paintColor(n, col){
    const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
    const undo=[]; let nn=0, na=0;
    ids.forEach(id=>{
      /* У КОРНЯ ПОДГРАФА СВОЕГО ЦВЕТА НЕТ — он берёт цвет ноды-владельца, а она лежит в
         СОСЕДНЕМ графе. Красить её отсюда нельзя: снимок отката сериализует только активный
         граф, и Ctrl+Z вернул бы всё, кроме этой правки. Цвет подграфа меняют снаружи. */
      if(isRootId(id)) return;
      if(id.indexOf("hub_")===0){ const a=areaById(id.slice(4)); if(a){ undo.push([id,a.color||null]); a.color=col; na++; } }
      else { const it=S.items.find(x=>x.id===id); if(it){ undo.push([id,it.color||null]); it.color=col; touch(it); nn++; } }
    });
    if(!undo.length) return;
    persist(); this.build();
    // Перевесить отметку выбора: палитра рисуется ОДИН раз при открытии поп-апа и запоминает
    // цвет, который был тогда. Без этого кольцо остаётся на прежнем кружке — жмёшь оранжевый,
    // а обведён зелёный. Поп-ап build() не пересоздаёт, так что правим его на месте.
    const pop=$("#node-pop");
    if(pop) $$(".np-sw .swatch",pop).forEach(b=>b.classList.toggle("on",(PALETTE[+b.dataset.ci]||null)===col));
    if(undo.length<2) return;   // одну ноду красят перебором — тост на каждый кружок был бы шумом
    const back=()=>{ undo.forEach(([id,c])=>{
        if(isRootId(id)) return;
        if(id.indexOf("hub_")===0){ const a=areaById(id.slice(4)); if(a) a.color=c; }
        else { const it=S.items.find(x=>x.id===id); if(it){ it.color=c; touch(it); } } });
      persist(); this.build(); };
    toast("Цвет · "+[nn?"нод: "+nn:"", na?"областей: "+na:""].filter(Boolean).join(", "),
          {icon:"ti-palette", label:"Вернуть", onAction:back});
  }
  /* Статус — как цвет: жмут по одной ноде, а применяется ко ВСЕМУ выделению, если кликнутая
     в нём. Не в нём — только к ней: ПКМ выделения не трогает, и менять статус невидимым «тем
     пяти из прошлой рамки» было бы сюрпризом. Повторное нажатие снимает статус.
     persist/build — ОДИН раз в конце: в цикле это N записей на диск и N перестроений SVG. */
  _setStatus(n, статус){
    /* ТУМБЛЕРА БОЛЬШЕ НЕТ (2026-09-01). Раньше здесь стояло `был===статус ? "todo" : статус`,
       и это ломалось дважды. Во-первых, `был` читался с КЛИКНУТОЙ ноды: кликнул по той, что уже
       «в работе», целясь поставить «в работу» всей пачке — и все двадцать, включая паузные,
       улетали в «не начато»; человек нажал «В работу», а получил «Снято». Во-вторых, откат был
       зашит литералом "todo" для любого вида, и заметка после второго нажатия «На паузу»
       становилась «не начатой» задачей (в живом файле так набралось 15 заметок).
       Теперь это выбор из списка, а не два флажка: повторное нажатие ничего не делает, а снятие
       статуса — это явный клик по нейтрали, которая стоит в ряду первой. */
    const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
    const undo=[]; let nn=0;
    ids.forEach(id=>{
      if(isHubId(id)) return;                         // у области и у корня подграфа своего статуса нет
      const it=S.items.find(x=>x.id===id);
      const у=this.byId[id];
      /* Потухшее статусом не трогаем — но потухшей считается и своя завершённая задача (_isFaded),
         а её как раз надо уметь вернуть одним кликом. Поэтому пропускаем только то, что погасло
         ОТ РОДИТЕЛЯ: заметку в закрытой ветке. */
      if(!it || (у && у.archived && !it.done)) return;
      // нейтраль зависит от вида: задаче «не начато», заметке «заметка» (см. нейтральныйСтатус в core.js)
      const ставим = (статус==="__neutral__") ? нейтральныйСтатус(it.kind) : статус;
      if(статусыДляВида(it.kind).indexOf(ставим)<0) return;   // «Готово» заметке не ставим — done живёт на it.done
      /* ЗАВЕРШЁННУЮ ВОЗВРАЩАЕМ ОДНИМ ДВИЖЕНИЕМ. В ряду иконок кнопки «Вернуть» нет — есть
         активная «Готово»; значит клик по любому другому значению обязан сам снять завершённость,
         иначе на пачку из десяти закрытых рендеров ушло бы двадцать кликов вместо десяти.
         Ровно так это уже работает в правой панели (views.js, ветка селекта «Статус»). */
      undo.push([id, it.status, it.done, it.doneAt||null]);
      if(it.done && ставим!=="done"){ it.done=false; it.doneAt=null; }
      it.status=ставим; touch(it); nn++;
    });
    if(!nn) return;
    persist(); this._closePop(); this.build();
    const с=СТАТУСЫ[(S.items.find(x=>x.id===n.id)||{}).status]||{};
    const имя=с.имя||"Снято", ик=с.иконка||"ti-circle-dot";
    if(nn<2){ toast(имя,{icon:ик}); return; }
    const back=()=>{ undo.forEach(([id,s,d,da])=>{ const it=S.items.find(x=>x.id===id);
        if(it){ it.status=s; it.done=d; it.doneAt=da; touch(it); } });   // done тоже откатываем: статус мог снять завершённость
      persist(); this.build(); };
    toast(имя+" · нод: "+nn, {icon:ик, label:"Вернуть", onAction:back});
  }
  /* «ГОТОВО» — КО ВСЕМУ ВЫДЕЛЕНИЮ, как цвет и статусы. Цвет и «в работе» давно применялись
     пачкой, а завершить десяток задач можно было только по одной — при том что закрывают их
     как раз пачками (сдал шот — готовы все его задачи).
     Правило то же: кликнутая нода в выделении — идёт всё выделение, нет — только она.
     Направление берём по кликнутой ноде: была невыполненной — завершаем всех, была выполненной
     — возвращаем всех. Иначе пачка «перемигнула» бы половину задач в обратную сторону.
     Повторы (`repeat`) создаёт сам toggleDone — здесь их логику не дублируем. */
  _setDone(n){
    const кл=n.ref; if(!кл || !kindIsTask(кл.kind)) return;
    const завершаем=!кл.done;
    const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
    const undo=[]; let nn=0;
    ids.forEach(id=>{
      if(isHubId(id)) return;                           // у области и у корня подграфа выполненности нет
      const it=S.items.find(x=>x.id===id);
      if(!it || !kindIsTask(it.kind) || !!it.done===завершаем) return;   // уже в нужном состоянии
      undo.push([id, it.done, it.status, it.doneAt||null]);
      toggleDone(it); nn++;
    });
    if(!nn) return;
    persist(); this._closePop(); this.build();
    const имя=завершаем?"Выполнено":"Возвращено в работу";
    const ик=завершаем?"ti-check":"ti-arrow-back-up";
    if(nn<2){ toast(имя,{icon:ик}); return; }
    const back=()=>{ undo.forEach(([id,d,s,da])=>{ const it=S.items.find(x=>x.id===id);
        if(it){ it.done=d; it.status=s; it.doneAt=da; touch(it); } });
      persist(); this.build(); };
    toast(имя+" · задач: "+nn, {icon:ик, label:"Вернуть", onAction:back});
  }
  _finishLink(n){
    // иерархию не задаём вручную — она выводится от области (см. recomputeHierarchy)
    const msg=this._linkTo(this.linkFrom, n.id);
    if(msg){ recomputeHierarchy(); toast(msg); this.cancelLink(); this.build(); return; }
    this.cancelLink();
  }
  refit(){
    // пере-раскладка: незакреплённые узлы расходятся заново, затем (когда остынет) обзор вписывается под всё дерево.
    // it.x НЕ обнуляем: nullом теперь помечены ноды, которые лежат в лотке и на холст ещё не попали
    // (см. build), так что обнуление здесь сослало бы в лоток весь граф — да ещё и с записью на диск.
    // Оно тут и не нужно: позиции ниже ставятся на самих узлах, а на диск попадут, когда раскладка остынет.
    this.nodes.forEach(n=>{ if(!n.fixed){ n.x=this.W/2+(Math.random()-.5)*420; n.y=this.H/2+(Math.random()-.5)*320; }});
    this.alpha=1; this._needFit=true;
  }
  /* ЕДИНСТВЕННЫЙ ПИСАТЕЛЬ ДОМА. Зовут только жесты человека — протяжка, создание на холсте,
     вытягивание из лотка, вставка, включение тумблера. Физика сюда не заходит никогда, и
     ровно поэтому заданная форма не может уплыть сама.
     Владельца разбираем ТАК ЖЕ, как физика в _tick (родитель → хаб своей области), и берём его
     ЖИВОЙ узел, а не элемент из данных: на диск раскладка уезжает только по остыванию, поэтому
     в данных у владельца обычно лежит вчерашняя точка — дом, посчитанный от неё, встал бы в
     стороне от того места, куда ноду отпустила рука.
     Закреплённую ноду (pin) не трогаем вовсе: pin — «не шевелись», дом — «живи, но здесь»,
     два режима не смешиваются, и физика у закреплённой всё равно отключена. */
  _homeFromDrag(it){
    if(!it || it.pin || it.x==null) return false;
    // владельца разбирает _ownerNode — одна формула на жест, раскладку выделенного и физику
    const о = this._ownerNode(it);
    if(!о){ delete it.hx; delete it.hy; return false; }   // владельца нет — дому не от чего считаться
    it.hx=Math.round(it.x-о.x); it.hy=Math.round(it.y-о.y); return true;
  }
  /* ---------- УПОРЯДОЧИТЬ ВЫДЕЛЕННОЕ ----------
     Зачем. Дерево, насыпанное пакетом команд (а то и руками), приходится разбирать вручную:
     ноды лежат друг на друге, связи пересекаются, читать нечего. Физика тут не помощник — она
     разводит узлы «в среднем», а не строит дерево.

     ЧТО ДЕЛАЕМ. Раскладываем ТОЛЬКО выделенное и ТОЛЬКО домами: считаем целевые места и пишем
     их в hx/hy, а до места ноды доезжают сами, домашней пружиной. Так у человека остаётся всё,
     чем он привык доводить форму: сбросить дом одной ноде, подвинуть другую, откатить целиком
     (шаг раскладки, Ctrl+Z). Переставь мы x/y напрямую — физика тут же начала бы растаскивать
     наведённый порядок обратно.

     РАСКЛАДКА В ДВА ПРОХОДА, КАЖДАЯ НОДА — НА СВОЁМ МЕСТЕ. Проход 1 ставит ВЕТКИ и их лучи от
     корня: для ветки перебираются радиус и направление, годится положение, где оценка её куста
     (узкий веер наружу, посчитанный в своих координатах) не задевает ничего занятого — ни чужих
     нод холста, ни поставленных веток, ни их зарезервированных вееров, — а луч ничего не
     пересекает; берётся ближайшее к корню с поправкой за уход от нынешнего направления. Место
     под будущие листья РЕЗЕРВИРУЕТСЯ точками. Проход 2 ставит ЛИСТЬЯ и глубже — по кругу между
     ветками, по одному за раунд; каждому ищется своё место вокруг родителя без наложений, без
     пересечения связей и без ноды на чужой связи, и поставленный лист забирает у своей ветки
     одну точку резерва. Не нашлось места — ветка снимается и ставится заново с учётом всего,
     что лежит сейчас (ремонт). Так соседи по углу оказываются на разной дальности, кусты
     вкладываются друг в друга, а лучи находят коридоры — как в ручном референсе КРОЛИКА.

     КОРЕНЬ НЕ ДВИГАЕМ ВОВСЕ. «Дерево остаётся примерно там же» — это про него: ветки растут
     от той точки, где корень уже стоит, а не съезжают к центру экрана. Если у корня есть
     владелец снаружи выделения, дерево ещё и разворачивается В СТОРОНУ ОТ НЕГО — то есть туда,
     куда оно и росло.

     Поперечные связи (не вошедшие в остовное дерево) пересекаться могут — в общем графе это
     неизбежно, и обещать обратное было бы неправдой. */
  _tidySelection(){
    const ids=[...this.selNodes].filter(id=>!isHubId(id) && this.byId[id] && this.byId[id].ref);
    if(ids.length<3){ toast("Выдели хотя бы три ноды — раскладывать нечего",{icon:"ti-layout-grid"}); return false; }
    const набор=new Set(ids);
    // связи ВНУТРИ выделения: по ним и строим дерево
    const смеж={}; ids.forEach(id=>{ смеж[id]=[]; });
    (S.links||[]).forEach(l=>{ if(!Array.isArray(l)) return;
      if(набор.has(l[0]) && набор.has(l[1])){ смеж[l[0]].push(l[1]); смеж[l[1]].push(l[0]); } });

    /* Корни — те, чей владелец ВНЕ выделения: с них дерево и начинается. Не нашлось ни одного
       (выделили кольцо или кусок середины) — берём самую связную ноду: она центр этого куска. */
    let корни=ids.filter(id=>{ const it=this.byId[id].ref; return !(it.parent && набор.has(it.parent)); });
    if(!корни.length) корни=[ids.slice().sort((a,b)=>смеж[b].length-смеж[a].length)[0]];

    // остовное дерево обходом в ширину: поперечные рёбра в раскладке не участвуют
    const дети={}, порядок=[], виден=new Set();
    ids.forEach(id=>{ дети[id]=[]; });
    корни.forEach(к=>{
      if(виден.has(к)) return;
      виден.add(к); порядок.push(к);
      const очередь=[к];
      while(очередь.length){
        const c=очередь.shift();
        смеж[c].forEach(сос=>{ if(виден.has(сос)) return;
          виден.add(сос); дети[c].push(сос); порядок.push(сос); очередь.push(сос); });
      }
    });
    ids.forEach(id=>{ if(!виден.has(id)){ виден.add(id); корни.push(id); порядок.push(id); } });

    /* РАСКЛАДКА КУСТАМИ — ЧИСЛА СНЯТЫ С РУЧНОГО РЕФЕРЕНСА КРОЛИКА («Team Presentation», 07.09.2026).

       Версии до этой раскладывали листья по ОБЩЕМУ кольцу вокруг корня. Так получается доказуемое
       непересечение, но и всё, за что их забраковали: спицы по четыреста пикселей и дыра в
       середине. Строгой гарантии здесь нет намеренно — у самого референса её тоже нет, кусты там
       переплетены, но читается он чисто.

       Что именно я померил по референсу, чтобы не подбирать числа на глаз:
         • КУСТ — НЕ ШАР, А УЗКИЙ ВЕЕР НАРУЖУ. Листья Viper лежат в 107° вокруг своей ветки и
           вытянуты по радиусу (232..296 от центра при ветке на 196). От центра такой куст занимает
           всего 31–40°, поэтому их и влезает полтора десятка. Первая версия кустов брала конус
           206° — куст выходил «толстым» по углу, и соседи налезали друг на друга кашей.
         • ЛИСТ СИДИТ ВПЛОТНУЮ К СВОЕЙ ВЕТКЕ: 84–110 px, а не на общем кольце в четырёхстах.
         • ВЕТКИ СТОЯТ НА ТРЁХ РАЗНЫХ УДАЛЕНИЯХ — 116..386, разброс втрое. Это и есть главный
           приём: куст на ближнем кольце занимает много угла, на дальнем — мало, и вперемешку их
           помещается вдвое больше, чем на одно кольцо. Средний шаг между ветками у референса 28°
           при ширине куста 35–40°, то есть умеренное перекрытие по углу, погашенное радиусом. */
    /* ХРОНИКА ЗАБРАКОВАННЫХ ВЕРСИЙ — чтобы не изобрести их заново:
       • кольца множителями ×1/×1.55/×2.2 и «сжатие» угла втрое: 16 веток по четыре листа
         давали кусты радиусом ~124 на кольцах 237/367/521, соседи с разных колец расходились
         на 165 px при нужных 248 — перекрытие зашито в константы, множитель не знает размера
         кустов;
       • угол прибит, подбирается радиус: разойтись с занятым углом можно только «дальше»,
         каждая ветка уезжала дальше предыдущей — спицы по 700 px при кустах в 110;
       • честные кольца с ёмкостью по углу: без пересечений, но механично и вдвое просторнее
         ручного референса (край 484 против ~350), и чужие ноды холста не учитывались вовсе. */
    const ЛИСТ=27;        // половина места, которое занимает нода вместе с подписью
    /* ~52°: ОЦЕНКА куста для первого прохода — узкая радиальная полоса. Это не форма настоящих
       листьев (их ставит второй проход, куда свободно), а РЕЗЕРВ: внешние ветки его обходят, и
       последнему листу внутренней ветки остаётся место. При 69° резерв был веером, внешние
       кусты садились в его продолжение, и пятый лист ложился на чужой луч. Значение подобрано
       линейкой: 0.7 и 0.8 — снова листья на лучах, 1.0 — тоже, 1.2 — исходные два; 0.9 — ноль
       пересечений и ноль нод на чужих связях в обоих прогонах ценой дальней ноды 809 вместо 728. */
    const КОНУС=0.9;
    const ШАГЛ=46;        // место на ноду вдоль дуги куста
    const МИН_КУСТ=100;    // ближе листья к своей ветке не сажаем — связь перестаёт читаться
    /* ЦЕПОЧКА (звено за звеном по одному ребёнку) кладётся ЗМЕЙКОЙ: ряды по ЗМЕЙКА_В_РЯД звеньев
       поперёк направления «наружу», ШАГ_ЦЕПИ между звеньями, РЯД_ЦЕПИ между рядами. Лист за листом
       цепочка в четырнадцать звеньев уходила прямой на полтора экрана (снимок КРОЛИКА); изгиб не
       помогал — дуга упирается в соседние ветки и её выталкивает наружу (линейка: 652). Змейка
       из двенадцати звеньев — блок 210×180 рядом со своей веткой, связи по 60–70 px. */
    const ШАГ_ЦЕПИ=60, РЯД_ЦЕПИ=70, ЗМЕЙКА_В_РЯД=4;
    const МИН_ВЕТКА=170;  // ближе ветку к корню не сажаем: 100 → 115 → 170, КРОЛИК трижды просил просторнее и «отодвинуть от хаба»
    /* Просвет между КУСТАМИ — по референсу: чужие листья там стоят в 50–60 px друг от друга, и
       читается это чисто. Проба на дереве КРОЛИКА (16 веток по 5 листьев): при зазоре 70 с
       поправкой 1.5 по горизонтали во внутренний круг влезали четыре куста, остальные вылетали
       на 380–600 — дальняя нода в 746 px от корня. */
    /* Зазор — ПОД ПОДПИСЬ, не под квадратик ноды: при 40 px листья соседних веток становились
       кашей из подписей (КРОЛИК: «слишком компактно, почти каша»). По горизонтали шире:
       подпись тянется вбок на полторы сотни. */
    const ЗАЗОР_В=72, ГОР_В=1.4;    // 52 → 60 → 66 → 72; при МИН_ВЕТКА 115 72 давало лист на луче, при 170 — чисто (линейка): КРОЛИК дважды просил просторнее — «видно пустые места»
    const ХАБ_ПОРОГ=8;    // от стольких потомков узел раскладывает детей ветками, а не листьями
    const УГЛОВ=36;       // шаг перебора направления ветки — 10°
    /* Плата за уход с нынешнего направления — НЕБОЛЬШАЯ. При 120 px за радиан ветка предпочитала
       уехать на 280 по своему лучу, чем сесть на 100 в четверти оборота, — и дерево росло
       наружу ради порядка, которого человек всё равно не помнит. */
    const ЦЕНА_УГЛА=25;
    /* РАЗВОД ВЕТОК ПО УГЛУ. Плата за то, что ветка встаёт по углу ближе к уже поставленной, чем
       ровный шаг (2π / число веток). Без неё ветки держались прежних направлений, сбивались в
       одну сторону, а на холсте оставались пустые сектора (КРОЛИК: «видно пустые места, куда
       можно развести ветви»). Плата мягкая — компактность и чистота остаются главными. */
    const ЦЕНА_РАЗВОДА=100;
    /* ПЕРЕСЕЧЕНИЕ СВЯЗЕЙ И НОДА НА ЧУЖОЙ СВЯЗИ — ЗАПРЕТ, А НЕ ЦЕНА (КРОЛИК, 08.09.2026: «имеются
       пересечения» — про четыре луча сквозь чужие кусты). Ценой это не лечится: при любой плате
       находилось положение, где заплатить дешевле, чем отъехать, — лист садился в 5 px от чужого
       луча за 300 «условных пикселей». Запрет же не гонит ветку наружу, как гнал в прошлых
       версиях, потому что свобода теперь по обеим осям: линейка на дереве КРОЛИКА даёт ноль
       пересечений при дальней ноде ~550. Но запрет держится только на УЗКОМ веере куста
       (КОНУС ≈ 69°): при 109° листья расходятся вбок, коридоров между кустами не остаётся, и
       луч дальней ветки пересекает что-нибудь при любом положении. */
    const НА_ЛИНИИ=16;    // ближе этого нода лежит НА чужой связи; простая теснота — не помеха
    const ЯЧ=Math.ceil(ЗАЗОР_В*ГОР_В)+1;   // ячейка сетки занятых точек: не меньше дальности проверки
    /* ВНУТРИ СВОЕГО куста требования мягче: там ноды одной ветки, их близость читается как
       родство, а не как каша. Возьми мы здесь тот же зазор — куст раздулся бы вдвое, а с ним
       и всё дерево. По горизонтали просвет больше: подпись куда шире самой ноды, и слипаются
       на снимках именно подписи. */
    /* СВОЙ ЗАЗОР МЕНЬШЕ ЧУЖОГО — и в оценке куста, и при постановке настоящих листьев. У референса
       листья одной ветки стоят в 40–50 px, чужие — в 50–60: близость к своим читается как
       родство, а не как каша. Один зазор на всех раздувал лепесток куста до 250 px по радиусу,
       и внешние ветки уезжали за 600. */
    const ЗАЗОР_К=50, ГОР_К=1.1;
    const ШАГ_R=14, ШАГОВ_R=48;   // сетка подбора места ветки вокруг корня (и оценки куста)
    /* Сетка подбора места листа МЕЛЬЧЕ, чем у ветки: соседи стоят к резерву куста впритык, и при
       шаге в 10° и 10 px поиск промахивался мимо единственного свободного окна — все пять
       листьев ветки уходили в запасной ход и ложились в одну точку (линейка, 08.09.2026). */
    const ШАГ_Л=6, ШАГОВ_Л=50, УГЛОВ_Л=72;   // 60..354 px, шаг 5°
    const ЦЕНА_НАРУЖУ=50;         // px за радиан ухода листа от направления «наружу»
    const ДЫРА=0.7;       // сектор (рад), оставленный владельцу корня — чтобы ветка не росла назад

    /* ОДНА проверка на всё: и для ноды внутри куста, и для ветки вокруг корня. Метрика
       анизотропная — по горизонтали зазор во столько-то раз больше, потому что подпись шире ноды. */
    const бьётся=(точки, занято, гор, зазор)=>{
      const з2=зазор*зазор;
      for(let k=0;k<точки.length;k++)
        for(let m=0;m<занято.length;m++){
          const dx=(точки[k].x-занято[m].x)/гор, dy=точки[k].y-занято[m].y;
          if(dx*dx+dy*dy < з2) return true;
        }
      return false;
    };
    /* КУСТ СЧИТАЕМ В СВОИХ КООРДИНАТАХ: узел в (0,0), «наружу» — ось +X, поля те же x/y, что у
       мировых точек (тогда и проверка одна на оба случая). Поддерево так можно повернуть и
       поставить целиком, а соседние кусты сравнить ПО ТОЧКАМ. Разница не косметическая: куст —
       это лепесток НАРУЖУ, а описанная вокруг него окружность вдвое толще, и по ней ветки
       разъезжались там, где на деле помещались (отсюда и «спицы» у версий с общим кольцом).
       кустR остаётся, но теперь это радиус ПО ТОЧКАМ: им делится угол между ветками. */
    const пов=(точки, cs, sn, ox, oy)=>точки.map(p=>({id:p.id, x:ox+p.x*cs-p.y*sn, y:oy+p.x*sn+p.y*cs}));
    const десц={};
    for(let i=порядок.length-1;i>=0;i--){ const id=порядок[i]; десц[id]=(дети[id]||[]).reduce((s,c)=>s+1+десц[c],0); }
    /* Хаб — от ХАБ_ПОРОГ потомков И хотя бы двух детей. Звено ЦЕПОЧКИ (один ребёнок, у того один
       ребёнок…) потомков имеет много, а раскладывать ему нечего: как хаб оно ставило единственного
       ребёнка веткой на 170 px по лучу, и цепочка уходила прямой в никуда (снимок КРОЛИКА). */
    /* …и хотя бы у двух детей есть свои поддеревья: развилка «лист + хвост цепочки» потомков
       набирает за счёт хвоста, а раскладывать ей веером нечего — как хаб она ставила хвост
       веткой на 170 px (линейка: связь 310 в цепочке с развилкой). */
    const хаб=id=>десц[id]>=ХАБ_ПОРОГ && (дети[id]||[]).filter(c=>десц[c]>=2).length>=2;
    /* Длина ЧИСТОЙ цепочки под узлом (у каждого звена не больше одного ребёнка), иначе -1. */
    const цепьДлина={};
    for(let i=порядок.length-1;i>=0;i--){ const id=порядок[i], дд=дети[id]||[];
      цепьДлина[id]=!дд.length ? 0 : (дд.length===1 && цепьДлина[дд[0]]>=0 ? 1+цепьДлина[дд[0]] : -1); }
    // смещение i-го звена змейки (i от 1) в координатах головы: наружу — +X, ряды поперёк
    const змейка=i=>{ const r=Math.floor((i-1)/ЗМЕЙКА_В_РЯД), k=(i-1)%ЗМЕЙКА_В_РЯД;
      const kk=(r%2===0) ? k : ЗМЕЙКА_В_РЯД-1-k;
      return {x:РЯД_ЦЕПИ*(r+1), y:(kk-(ЗМЕЙКА_В_РЯД-1)/2)*ШАГ_ЦЕПИ}; };
    const кустТ={}, кустR={};
    for(let i=порядок.length-1;i>=0;i--){
      const id=порядок[i], дд=дети[id];
      const точки=[{id, x:0, y:0}];
      if(дд.length===1 && цепьДлина[id]>0){
        let c=дд[0], n=1;
        while(c){ const o=змейка(n); точки.push({id:c, x:o.x, y:o.y}); c=(дети[c]||[])[0]; n++; }
        кустТ[id]=точки; кустR[id]=точки.reduce((m,p)=>Math.max(m, Math.hypot(p.x, p.y)), ЛИСТ);
        continue;
      }
      /* ОЦЕНКА ХАБА — КОЛЬЦО ЕГО ДЕТЕЙ, а не всё поддерево веером. Хаб раскладывает детей сам,
         ветками с лучами, когда дойдёт его очередь; здесь его куст нужен лишь как заявка на
         место рядом с родителем. Полный веер из сотни нод не влезал никуда, хаб улетал в
         запасной ход на 758, а дом такой длины санитайзер снимает как невозможный — и целая
         ветка оставалась без домов (линейка «с владельцем», 08.09.2026). */
      if(дд.length && хаб(id)){
        дд.forEach((c,j)=>{ const a=-Math.PI/2+j*(Math.PI*2/дд.length); точки.push({id:c, x:Math.cos(a)*МИН_ВЕТКА, y:Math.sin(a)*МИН_ВЕТКА}); });
      } else if(дд.length){
        const сум=дд.reduce((s,c)=>s+кустR[c],0)||1;
        /* Стартовый радиус — МИНИМАЛЬНЫЙ, а не «сколько нужно всем детям на одной дуге»: место
           каждому ребёнку всё равно подбирается ниже, и лишний радиус на старте только раздувал
           куст (5 листьев на 142 px при 40–124 у референса). Растёт он лишь от детей с собственным
           кустом — тем действительно нужно место. */
        /* ЕДИНСТВЕННОМУ РЕБЁНКУ ВЕЕР НЕ НУЖЕН — ему шаг цепочки. Формула «размер кустов детей ÷
           ширина веера» делит угол между детьми; с одним ребёнком делить нечего, а она давала
           радиус в размер ВСЕГО его поддерева: цепочка с развилкой посередине (не «чистая», в
           змейку не попадает) получала звенья по 300–700 px, оценка взрывалась, а второй проход
           честно ставил звенья в зарезервированные точки (снимок КРОЛИКА, 09.09.2026). */
        /* Стартовый радиус для нескольких детей — по их ЧИСЛУ (каждый считается не больше двух
           листов), а не по размеру кустов: ребёнок с длинным хвостом иначе отодвигал и себя, и
           брата-лист на сотни пикселей. Раздвинуть настоящие кусты по точкам умеет подбор ниже. */
        const R0=дд.length===1 ? ШАГ_ЦЕПИ : Math.max(МИН_КУСТ, дд.reduce((s,c)=>s+Math.min(кустR[c], 2*ЛИСТ),0)/КОНУС);
        let a=-КОНУС/2;                          // один ребёнок получает весь конус → встаёт прямо
        /* Связи внутри куста: от узла к каждому поставленному ребёнку и связи их собственных
           кустов. Нужны для проверки «нода не легла на чужую связь» — при пяти листьях в узком
           веере соседний лист оказывался в 14 px от связи брата (линейка ловила это как
           «сквозь ноду»), а глазом это читается как нода НА линии. */
        const связиЛок=[];
        const наЛинии=(pts, segs, откуда)=>{
          for(let i=0;i<pts.length;i++) for(let j=0;j<segs.length;j++){
            const p=pts[i], s=segs[j]; if(s.a===p.id||s.b===p.id) continue;
            const dx=s.bx-s.ax, dy=s.by-s.ay, L2=dx*dx+dy*dy||1;
            const t=Math.max(0, Math.min(1, ((p.x-s.ax)*dx+(p.y-s.ay)*dy)/L2));
            const ex=s.ax+dx*t-p.x, ey=s.ay+dy*t-p.y;
            if(ex*ex+ey*ey<НА_ЛИНИИ*НА_ЛИНИИ) return true;
          }
          return false;
        };
        дд.forEach(c=>{
          const ш=КОНУС*(кустR[c]/сум), ac=a+ш/2, cs=Math.cos(ac), sn=Math.sin(ac);
          /* Место ребёнку ПОДБИРАЕТСЯ так же, как ветке у корня: отодвигаем по своему лучу, пока
             он со своим кустом не разойдётся с уже поставленными. Прежнее «каждый второй на 30%
             дальше» разводило вслепую и только соседей — подписи внутри куста всё равно
             налезали друг на друга (видно на снимке КРОЛИКА от 07.09.2026). */
          let точкиC=null;
          for(let шаг=0; шаг<ШАГОВ_R; шаг++){
            const Rc=R0+шаг*ШАГ_R;
            точкиC=пов(кустТ[c], cs, sn, cs*Rc, sn*Rc);
            if(бьётся(точкиC, точки, ГОР_К, ЗАЗОР_К)) continue;
            // связи кандидата: от узла к нему и внутри его куста; их точки — против наших связей
            const где={}; точкиC.forEach(p=>{ где[p.id]=p; });
            const св=[{ax:0, ay:0, bx:точкиC[0].x, by:точкиC[0].y, a:id, b:c}];
            точкиC.forEach(p=>{ (дети[p.id]||[]).forEach(cc=>{ const q=где[cc]; if(q) св.push({ax:p.x, ay:p.y, bx:q.x, by:q.y, a:p.id, b:cc}); }); });
            if(наЛинии(точкиC, связиЛок) || наЛинии(точки, св)) continue;
            св.forEach(x=>связиЛок.push(x));
            break;
          }
          точкиC.forEach(p=>точки.push(p));
          a+=ш;
        });
      }
      кустТ[id]=точки;
      кустR[id]=точки.reduce((m,p)=>Math.max(m, Math.hypot(p.x, p.y)), ЛИСТ);
    }

    const цель={};
    /* ЗАНЯТЫЕ МЕСТА — ВЕСЬ ХОЛСТ, А НЕ ТОЛЬКО ВЫДЕЛЕНИЕ (КРОЛИК, 08.09.2026: «ноды должны
       учитывать положение других нод, которые не участвуют в выделении, и не залезать на них»).
       Сперва сюда ложатся все чужие узлы, потом — свои кусты по мере постановки. Сетка ячейками
       не меньше дальности проверки: чужих узлов на холсте бывают сотни, а положений на ветку
       перебирается больше тысячи, и перебор «каждая с каждой» стоил бы десятков миллионов
       сравнений на одно нажатие. */
    const сетка=new Map();
    const ячейка=(x,y)=>Math.floor(x/ЯЧ)+","+Math.floor(y/ЯЧ);
    const занять=p=>{ const k=ячейка(p.x,p.y); let я=сетка.get(k); if(!я){ я=[]; сетка.set(k,я); } я.push(p); };
    // `своя` — ветка, к чьим нодам зазор свой, меньший (ЗАЗОР_К/ГОР_К); к остальным — переданный
    const бьётсяМир=(точки, гор, зазор, своя)=>{
      const з2=зазор*зазор, зк2=ЗАЗОР_К*ЗАЗОР_К;
      for(let i=0;i<точки.length;i++){
        const p=точки[i], cx=Math.floor(p.x/ЯЧ), cy=Math.floor(p.y/ЯЧ);
        for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
          const я=сетка.get((cx+dx)+","+(cy+dy)); if(!я) continue;
          for(let m=0;m<я.length;m++){
            const q=я[m], св=своя && q.ветка===своя;
            const ex=(p.x-q.x)/(св?ГОР_К:гор), ey=p.y-q.y;
            if(ex*ex+ey*ey<(св?зк2:з2)) return true;
          }
        }
      }
      return false;
    };
    this.nodes.forEach(n=>{ if(!набор.has(n.id) && n.x!=null && n.y!=null) занять({id:n.id, x:n.x, y:n.y}); });
    /* РЕЗЕРВ — место, которое ветка ЗАЙМЁТ листьями, но пока не заняла. В проходе 1 сюда ложится
       оценка куста (веер), и следующие ветки её обходят; в проходе 2 листья самой ветки резерв
       не видят (он их собственный), а чужой — видят. Без резерва шестнадцать веток слипались на
       радиусе 100, и 32 листа из 84 не находили места вовсе (линейка, 08.09.2026). */
    const резерв=new Map(), резервТ=[];
    const занятьРез=p=>{ const k=ячейка(p.x,p.y); let я=резерв.get(k); if(!я){ я=[]; резерв.set(k,я); } я.push(p); резервТ.push(p); };
    /* Резерв ТАЕТ ПОШТУЧНО: поставленный лист забирает у своей ветки одну зарезервированную
       точку — ближайшую к себе. Так остаток резерва всегда равен числу ещё не поставленных
       листьев, и соседи не займут больше, чем им положено. */
    const снятьРез=(ветка, x, y, id)=>{
      let лучш=-1, d0=Infinity;
      for(let i=0;i<резервТ.length;i++){ const p=резервТ[i]; if(p.ветка!==ветка) continue;
        if(id && p.id===id){ лучш=i; break; }                  // своя точка — её и гасим
        const d=(p.x-x)*(p.x-x)+(p.y-y)*(p.y-y); if(d<d0){ d0=d; лучш=i; } }
      if(лучш<0) return;
      const p=резервТ[лучш]; резервТ.splice(лучш,1);
      const k=ячейка(p.x,p.y), я=резерв.get(k); if(я){ const i=я.indexOf(p); if(i>=0) я.splice(i,1); if(!я.length) резерв.delete(k); }
    };
    const бьётсяРез=(точки, гор, зазор, кроме)=>{
      const з2=зазор*зазор;
      for(let i=0;i<точки.length;i++){
        const p=точки[i], cx=Math.floor(p.x/ЯЧ), cy=Math.floor(p.y/ЯЧ);
        for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
          const я=резерв.get((cx+dx)+","+(cy+dy)); if(!я) continue;
          for(let m=0;m<я.length;m++){
            const q=я[m]; if(q.ветка===кроме) continue;
            const ex=(p.x-q.x)/гор, ey=p.y-q.y;
            if(ex*ex+ey*ey<з2) return true;
          }
        }
      }
      return false;
    };
    const разн=(a,b)=>{ const d=Math.abs(a-b)%(Math.PI*2); return d>Math.PI ? Math.PI*2-d : d; };
    /* СВЯЗИ КАК ПРЕПЯТСТВИЕ. Сюда ложатся чужие связи холста (оба конца вне выделения), а
       потом — связи поставленных кустов. Кандидат платит за каждое пересечение его связей
       (луч от корня плюс связи внутри куста) с уже лежащими и за каждую занятую ноду, сквозь
       которую проходит его луч: связь, прошедшая по чужой ноде, читается как связь С НЕЙ. */
    const отрезки=[];
    /* Только РУЧНЫЕ связи. Автолучи к хабу области (manual:false) тянутся через всё поле от
       каждой чужой ноды, и с ними любое положение пересекало хоть что-то: штраф превращался в
       константу и переставал различать хорошие места от плохих (линейка: 13 из 15 чужих
       отрезков были лучами к хабу, цена каждой ветки начиналась с 1000). */
    /* Связь КОРНЯ выделения с его владельцем снаружи — тоже препятствие: оба конца неподвижны
       (корень не двигаем), а кусты ближних веток укладывались прямо на неё (снимок КРОЛИКА —
       Breach на линии 057_GK_CUP → Team Presentation). Прочие связи «свой ↔ чужой» не берём:
       свой конец ещё переедет. */
    const неподвижен=id=>!набор.has(id) || корни.indexOf(id)>=0;
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b];
      if(l.manual && a && b && неподвижен(l.a) && неподвижен(l.b) && !(набор.has(l.a) && набор.has(l.b)) && a.x!=null && b.x!=null)
        отрезки.push({ax:a.x, ay:a.y, bx:b.x, by:b.y, a:l.a, b:l.b}); });
    const пересек=(p,q)=>{
      if(p.a===q.a||p.a===q.b||p.b===q.a||p.b===q.b) return false;   // общий конец — не пересечение
      const o=(ax,ay,bx,by,cx,cy)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      const o1=o(p.ax,p.ay,p.bx,p.by,q.ax,q.ay), o2=o(p.ax,p.ay,p.bx,p.by,q.bx,q.by);
      const o3=o(q.ax,q.ay,q.bx,q.by,p.ax,p.ay), o4=o(q.ax,q.ay,q.bx,q.by,p.bx,p.by);
      return (o1>0)!==(o2>0) && (o3>0)!==(o4>0);
    };
    // сколько занятых нод лежит на отрезке ближе, чем на ЛИСТ (концы отрезка не считаются)
    const сквозь=(s)=>{
      const dx=s.bx-s.ax, dy=s.by-s.ay, L2=dx*dx+dy*dy||1; let n=0;
      const шагов=Math.max(1, Math.ceil(Math.hypot(dx,dy)/ЯЧ)), виденные=new Set();
      for(let i=0;i<=шагов;i++){
        const x=s.ax+dx*i/шагов, y=s.ay+dy*i/шагов, cx=Math.floor(x/ЯЧ), cy=Math.floor(y/ЯЧ);
        for(let ex=-1;ex<=1;ex++) for(let ey=-1;ey<=1;ey++){
          const k=(cx+ex)+","+(cy+ey); if(виденные.has(k)) continue; виденные.add(k);
          const я=сетка.get(k); if(!я) continue;
          for(let m=0;m<я.length;m++){
            const q=я[m]; if(q.id===s.a||q.id===s.b) continue;
            const t=Math.max(0, Math.min(1, ((q.x-s.ax)*dx+(q.y-s.ay)*dy)/L2));
            const px=s.ax+dx*t-q.x, py=s.ay+dy*t-q.y;
            if(px*px+py*py<НА_ЛИНИИ*НА_ЛИНИИ) n++;
          }
        }
      }
      return n;
    };
    // связи кандидата: луч от корня к ветке и связи внутри куста (по остовному дереву)
    const связиКуста=(корень, точки)=>{
      const где={}; точки.forEach(p=>{ где[p.id]=p; });
      const с=[{ax:корень.x, ay:корень.y, bx:точки[0].x, by:точки[0].y, a:корень.id, b:точки[0].id}];
      точки.forEach(p=>{ (дети[p.id]||[]).forEach(c=>{ const q=где[c]; if(q) с.push({ax:p.x, ay:p.y, bx:q.x, by:q.y, a:p.id, b:c}); }); });
      return с;
    };
    /* Обратная проверка: НОДЫ кандидата, севшие на уже лежащую чужую связь. Без неё ближний куст
       спокойно садился поперёк луча дальней ветки, поставленной раньше, — луч шёл сквозь его
       листья, и это были ровно те четыре пересечения, что КРОЛИК обвёл на снимке 08.09.2026:
       проверялся только луч кандидата против чужих нод, а не чужие лучи против его нод. */
    const наЧужих=(точки)=>{
      let n=0;
      for(let i=0;i<точки.length;i++){
        const p=точки[i];
        for(let j=0;j<отрезки.length;j++){
          const s=отрезки[j]; if(s.a===p.id||s.b===p.id) continue;
          const dx=s.bx-s.ax, dy=s.by-s.ay, L2=dx*dx+dy*dy||1;
          const t=Math.max(0, Math.min(1, ((p.x-s.ax)*dx+(p.y-s.ay)*dy)/L2));
          const ex=s.ax+dx*t-p.x, ey=s.ay+dy*t-p.y;
          if(ex*ex+ey*ey<НА_ЛИНИИ*НА_ЛИНИИ) n++;
        }
      }
      return n;
    };
    // есть ли помеха: пересечение с лежащей связью, чужая нода на связи куста, нода куста на чужой связи
    const помеха=(связи, точки)=>{
      for(let i=0;i<связи.length;i++){
        for(let j=0;j<отрезки.length;j++) if(пересек(связи[i], отрезки[j])) return true;
        if(сквозь(связи[i])) return true;
      }
      return наЧужих(точки)>0;
    };

    /* ХАБ — ЛЮБОЙ УЗЕЛ С БОЛЬШИМ ПОДДЕРЕВОМ, а не только корень выделения. Стоило выделить вместе
       с деревом его владельца (057_GK_CUP), как корнем становился он, «Team Presentation» —
       обычной веткой, а её шестнадцать агентов раскладывались как ЛИСТЬЯ: вплотную к родителю,
       без резерва под собственные кусты, без лучей и коридоров (снимок КРОЛИКА, 08.09.2026).
       Теперь узел с ХАБ_ПОРОГ и больше потомками раскладывает своих детей ветками — с тем же
       перебором радиуса и направления, резервом и ремонтом, — на какой бы глубине он ни стоял.
       Хабы обрабатываются по очереди, от корня вглубь: место под хаб уже занято его родителем. */
    const род={}; порядок.forEach(p=>{ (дети[p]||[]).forEach(c=>{ род[c]=p; }); });
    const хабы=[];
    корни.forEach(к=>{
      const у=this.byId[к];
      цель[к]={x:у.x, y:у.y};              // корень не двигаем: «дерево остаётся там же» — про него
      занять({id:к, x:у.x, y:у.y});
      хабы.push(к);
    });

    const разложитьХаб=(к)=>{
      const дд=дети[к]||[]; if(!дд.length) return;
      const центр=цель[к], жив=this.byId[к];
      // своя оценка куста больше не нужна: её место занимают настоящие дети
      while(резервТ.some(p=>p.ветка===к)) снятьРез(к, центр.x, центр.y);
      /* В сторону родителя ветки не растут: у корня это владелец, оставшийся снаружи выделения,
         у вложенного хаба — его родитель в дереве. Дерево росло ОТ него. */
      let кВладельцу=null;
      if(род[к] && цель[род[к]]){ const р=цель[род[к]]; кВладельцу=Math.atan2(р.y-центр.y, р.x-центр.x); }
      else { const вл=this._ownerNode(жив.ref); if(вл && вл.id!==к) кВладельцу=Math.atan2(вл.y-жив.y, вл.x-жив.x); }
      /* ЖЕЛАЕМОЕ НАПРАВЛЕНИЕ ВЕТКИ — ГДЕ ОНА СТОИТ СЕЙЧАС. «Дерево остаётся там же» — это не
         только про корень: ветка, что была справа, остаётся справа, и человек не ищет её заново
         по всему кругу. Отклониться она может, но за это платит радиусом (ЦЕНА_УГЛА). */
      const хочет={};
      дд.forEach(c=>{ const n=this.byId[c]; хочет[c]=Math.atan2(n.y-жив.y, n.x-жив.x); });
      /* КУСТЫ САДЯТСЯ КАК В РУЧНОМ РЕФЕРЕНСЕ КРОЛИКА (08.09.2026): не по кольцам, а каждый —
         на СВОЁМ удалении, ближайшем свободном, и кусты вкладываются друг в друга, потому что
         соседи по углу стоят на разной дальности. Для каждой ветки перебираются радиус и
         направление, а годится положение, где ни одна точка её куста не подходит к занятому —
         чужой ноде или уже поставленному кусту — ближе зазора, а луч и связи куста ничего не
         пересекают. Из годных берётся самое дешёвое: радиус плюс плата за отклонение от
         нынешнего направления.
         Обе прежние версии того же дня ошибались одинаково — фиксировали одну из осей. Кольца
         ставили радиус жёстко и давали механическую картинку вдвое просторнее референса; подбор
         радиуса при прибитом угле разгонял ветки спицами на 700 px. Свобода нужна по обеим осям
         сразу, иначе первая же занятая позиция гонит ветку туда, где место есть, а не туда,
         где оно рядом.
         Крупные кусты идут первыми: им нужнее место у корня, мелкие вставятся в промежутки. */
      const углыВеток=[];                         // направления уже поставленных веток этого хаба
      const шагУгла=Math.PI*2/Math.max(1,дд.length);
      const местоВетки=(c)=>{
        let лучш=null;
        for(let ш=0; ш<ШАГОВ_R; ш++){
          const R=МИН_ВЕТКА+ш*ШАГ_R;
          if(лучш && R>=лучш.цена) break;             // дальше только дороже — радиус уже перевесил
          for(let u=0; u<УГЛОВ; u++){
            const ac=хочет[c]+u*(Math.PI*2/УГЛОВ);
            if(кВладельцу!=null && разн(ac,кВладельцу)<ДЫРА/2) continue;
            let теснота=0; углыВеток.forEach(a=>{ const d=разн(ac,a); if(d<шагУгла) теснота=Math.max(теснота, шагУгла-d); });
            const цена=R+ЦЕНА_УГЛА*разн(ac,хочет[c])+ЦЕНА_РАЗВОДА*теснота;
            if(лучш && цена>=лучш.цена) continue;
            const cs=Math.cos(ac), sn=Math.sin(ac);
            const точки=пов(кустТ[c], cs, sn, центр.x+cs*R, центр.y+sn*R);
            if(бьётсяМир(точки, ГОР_В, ЗАЗОР_В) || бьётсяРез(точки, ГОР_В, ЗАЗОР_В, null)) continue;
            const связи=связиКуста({id:к, x:центр.x, y:центр.y}, точки);
            if(помеха(связи, точки)) continue;
            лучш={точки, связи, цена};
          }
        }
        if(!лучш){   // свободного места не нашлось нигде — ставим на своё направление в самый край
          const R=МИН_ВЕТКА+(ШАГОВ_R-1)*ШАГ_R, cs=Math.cos(хочет[c]), sn=Math.sin(хочет[c]);
          const точки=пов(кустТ[c], cs, sn, центр.x+cs*R, центр.y+sn*R);
          лучш={точки, связи:связиКуста({id:к, x:центр.x, y:центр.y}, точки), цена:R};
        }
        return лучш;
      };
      /* ПРОХОД 1 СТАВИТ ТОЛЬКО САМУ ВЕТКУ И ЕЁ ЛУЧ. Куст участвовал в проверке как оценка места,
         которое ветке понадобится, и это место РЕЗЕРВИРУЕТСЯ точками; листья по оценке НЕ пишутся —
         им ниже ищется своё место, каждому отдельно и с оглядкой на чужие лучи. Иначе кусты,
         поставленные жёстким веером, к двенадцатой ветке не оставляли лучу из корня ни одного
         коридора — последние четыре ветки улетали в запасной ход на 758 (линейка, 08.09.2026). */
      const поставитьВетку=(c, лучш)=>{
        const в=лучш.точки[0]; цель[c]={x:в.x, y:в.y}; занять({id:c, x:в.x, y:в.y, ветка:c});
        углыВеток.push(Math.atan2(в.y-центр.y, в.x-центр.x));
        отрезки.push(лучш.связи[0]);
        лучш.точки.slice(1).forEach(p=>занятьРез({x:p.x, y:p.y, ветка:c, id:p.id}));   // с id: лист потом ищет СВОЮ точку
      };
      // крупные кусты первыми: им нужнее место у корня, мелкие вставятся в промежутки
      дд.slice().sort((a,b)=>кустR[b]-кустR[a]).forEach(c=>поставитьВетку(c, местоВетки(c)));

      /* ПРОХОД 2: ЛИСТЬЯ И ГЛУБЖЕ. Каждой ноде — своё место вокруг родителя: перебор радиуса от
         МИН_КУСТ и направления по обе стороны от «наружу» (от деда к родителю), годится место без
         наложений, без пересечения связей и без чужой ноды на связи; из годных — ближайшее к
         родителю с небольшой платой за уход от «наружу». Так лист сам обходит чужой луч, а не
         ложится на него — референс КРОЛИКА именно так и разложен руками: листья там висят не
         симметричным веером, а там, где было свободно.
         ПО КРУГУ МЕЖДУ ВЕТКАМИ, а не ветка за веткой: за раунд каждая ветка ставит по одному листу.
         Ветка за веткой первая успевала занять всё вокруг себя, включая место, где должны были
         встать листья соседа.
         Ветка, которая сама хаб, листьев здесь не получает: её дети — ветки, и ставит их она
         сама, когда дойдёт очередь хабов. */
      const ожид={};
      дд.forEach(c=>{ ожид[c]=хаб(c) ? [] : (дети[c]||[]).slice(); if(хаб(c)) хабы.push(c); });
      /* Голова цепочки и номер звена: голова — первый узел, под которым чистая цепочка, а сам он
         в цепочку сверху не входит (у его родителя не один ребёнок либо он ветка). */
      const цепьГолова={}, цепьНомер={};
      порядок.forEach(p=>{ const дд=дети[p]||[]; if(дд.length!==1 || цепьДлина[p]<=0) return;
        const c=дд[0];
        if(цепьНомер[p]!=null){ цепьГолова[c]=цепьГолова[p]; цепьНомер[c]=цепьНомер[p]+1; }
        else { цепьГолова[c]=p; цепьНомер[c]=1; } });
      /* Куда «наружу», если у узла нет деда в выделении (он корень выделения) и нет желаемого
         угла (он сам хаб, а не его ветка): от владельца снаружи, а нет и его — вниз. Без этого
         получался NaN, звенья цепочки уезжали в никуда и ПРОПАДАЛИ с холста — КРОЛИК выделил
         одну цепочку и увидел два звена из четырнадцати (09.09.2026). */
      const наружуОт=(у, дед)=>{
        if(дед) return Math.atan2(цель[у].y-дед.y, цель[у].x-дед.x);
        if(хочет[у]!=null) return хочет[у];
        return кВладельцу!=null ? кВладельцу+Math.PI : -Math.PI/2;
      };
      /* Ячейка змейки занята — сдвигаем ВСЮ оставшуюся змейку на ряд наружу (сдвиг у головы
         только растёт), а не одно звено в сторону: иначе звено уходило обычным поиском, следующие
         возвращались в свои ячейки, и связь проходила через уже поставленные — змейка пересекала
         сама себя (линейка: лист15-2>15-3 × 15-8>15-9). */
      const цепьСдвиг={};
      const местоЗвена=(c, ветка)=>{
        const г=цепьГолова[c], гц=цель[г], дед=цель[род[г]]; if(!гц) return null;
        const наружу=наружуОт(г, дед);
        const cs=Math.cos(наружу), sn=Math.sin(наружу);
        const p=род[c], рп=цель[p];
        for(let d=(цепьСдвиг[г]||0); d<(цепьСдвиг[г]||0)+4; d++){
          const o=змейка(цепьНомер[c]); o.x+=d*РЯД_ЦЕПИ;
          const pt={id:c, x:гц.x+o.x*cs-o.y*sn, y:гц.y+o.x*sn+o.y*cs};
          if(бьётсяМир([pt], ГОР_В, ЗАЗОР_В, ветка) || бьётсяРез([pt], ГОР_В, ЗАЗОР_В, ветка)) continue;
          const св=[{ax:рп.x, ay:рп.y, bx:pt.x, by:pt.y, a:p, b:c}];
          if(помеха(св, [pt])) continue;
          цепьСдвиг[г]=d;
          return {pt, св, цена:Math.hypot(pt.x-рп.x, pt.y-рп.y)};
        }
        return null;
      };
      const местоЛиста=(c, ветка)=>{
        if(цепьГолова[c]){ const з=местоЗвена(c, ветка); if(з) return з; }   // не вышло — обычный поиск
        const p=род[c], рп=цель[p], дед=цель[род[p]]; if(!рп) return null;
        const наружу=наружуОт(p, дед);
        const старт=(дети[p]||[]).length===1 ? ШАГ_ЦЕПИ : МИН_КУСТ;
        let лучш=null;
        /* СНАЧАЛА — СВОЯ ЗАРЕЗЕРВИРОВАННАЯ ТОЧКА. Резерв — это план, который соседи уже уважали;
           лист, севший «поближе и вбок» мимо плана, сминал внутреннее кольцо, и последним листьям
           ветки места не оставалось (линейка: 5844 отказов по наложению из 10800 положений).
           Годится своя точка — берём её; нет — любую свою; и только потом поиск по сетке. */
        const годится=(q)=>{
          if(Math.hypot(q.x-рп.x, q.y-рп.y)<старт*0.8) return null;
          const pt={id:c, x:q.x, y:q.y};
          if(бьётсяМир([pt], ГОР_В, ЗАЗОР_В, ветка) || бьётсяРез([pt], ГОР_В, ЗАЗОР_В, ветка)) return null;
          const св=[{ax:рп.x, ay:рп.y, bx:pt.x, by:pt.y, a:p, b:c}];
          if(помеха(св, [pt])) return null;
          return {pt, св, цена:Math.hypot(q.x-рп.x, q.y-рп.y)};
        };
        const своя=резервТ.find(q=>q.ветка===ветка && q.id===c);
        if(своя){ const в=годится(своя); if(в) return в; }
        резервТ.filter(q=>q.ветка===ветка).sort((a,b)=>Math.hypot(a.x-рп.x,a.y-рп.y)-Math.hypot(b.x-рп.x,b.y-рп.y))
          .some(q=>{ const в=годится(q); if(в){ лучш=в; return true; } return false; });
        if(лучш) return лучш;
        // вторая попытка — с зазором в три четверти: тесно, но лучше, чем лист в запасном ходу
        for(let мягко=1; !лучш && мягко>=0.5; мягко-=0.25){   // 1 → 0.75 → 0.5: тесно к чужой ноде, но не на чужом луче
          for(let ш=0; ш<ШАГОВ_Л; ш++){
            const R=старт+ш*ШАГ_Л;
            if(лучш && R>=лучш.цена) break;
            for(let u=0; u<УГЛОВ_Л; u++){
              const ac=наружу+(u%2 ? -1 : 1)*Math.ceil(u/2)*(Math.PI*2/УГЛОВ_Л);
              const цена=R+ЦЕНА_НАРУЖУ*разн(ac,наружу);
              if(лучш && цена>=лучш.цена) continue;
              const pt={id:c, x:рп.x+Math.cos(ac)*R, y:рп.y+Math.sin(ac)*R};
              // смягчение — только к настоящим чужим нодам, НЕ к резерву: смягчённый лист соседа
              // садился в 31 px от точки, которую ждёт наш лист, и она становилась негодной
              if(бьётсяМир([pt], ГОР_В, ЗАЗОР_В*мягко, ветка) || бьётсяРез([pt], ГОР_В, ЗАЗОР_В, ветка)) continue;
              const св=[{ax:рп.x, ay:рп.y, bx:pt.x, by:pt.y, a:p, b:c}];
              if(помеха(св, [pt])) continue;
              лучш={pt, св, цена};
            }
          }
        }
        return лучш;
      };
      /* НАИМЕНЬШЕЕ ЗЛО вместо ремонта. Ремонт снимал ветку и ставил её заново «не ближе 50 px от
         старого места» — но к этому моменту всё вокруг уже занято настоящими листьями соседей,
         и место находилось только далеко: ветки улетали на 500–700 (линейка, 08.09.2026). Лист,
         которому негде встать чисто, встаёт РЯДОМ с родителем туда, где нарушений меньше всего:
         пересечение связи весит втрое дороже тесноты. Ветка при этом остаётся на месте. */
      const ближайшая=(pt)=>{
        let d2=Infinity; const cx=Math.floor(pt.x/ЯЧ), cy=Math.floor(pt.y/ЯЧ);
        for(let dx=-2;dx<=2;dx++) for(let dy=-2;dy<=2;dy++){ const я=сетка.get((cx+dx)+","+(cy+dy)); if(!я) continue;
          for(let m=0;m<я.length;m++){ const q=я[m], ex=pt.x-q.x, ey=pt.y-q.y, d=ex*ex+ey*ey; if(d<d2) d2=d; } }
        return Math.sqrt(d2);
      };
      const наименьшееЗло=(c, ветка)=>{
        const p=род[c], рп=цель[p], дед=цель[род[p]];
        const наружу=наружуОт(p, дед);
        let лучш=null;
        // во всю дальность поиска: чистое место в 300 px от родителя лучше, чем лист на чужом
        // луче в 80 — а половина дальности до чистого места не дотягивалась (снимок КРОЛИКА:
        // листья Gekko на луче к Yoru)
        for(let ш=0; ш<ШАГОВ_Л; ш++){
          const R=МИН_КУСТ+ш*ШАГ_Л;
          for(let u=0; u<УГЛОВ_Л; u++){
            const ac=наружу+(u%2 ? -1 : 1)*Math.ceil(u/2)*(Math.PI*2/УГЛОВ_Л);
            const pt={id:c, x:рп.x+Math.cos(ac)*R, y:рп.y+Math.sin(ac)*R};
            const св=[{ax:рп.x, ay:рп.y, bx:pt.x, by:pt.y, a:p, b:c}];
            let зло=0;
            // теснота — НЕПРЕРЫВНО: нода в 18 px от соседа и нода в 35 — обе «тесно», но первая лежит на нём
            const dmin=ближайшая(pt); if(dmin<ЗАЗОР_В) зло+=(ЗАЗОР_В-dmin)/ЗАЗОР_В*2;
            if(бьётсяРез([pt], ГОР_В, ЗАЗОР_В*0.7, ветка)) зло+=1;
            // связи ДОРОЖЕ ЛЮБОЙ тесноты: лист на чужом луче читается как связь с чужой веткой,
            // а теснота — как теснота (весит до 2 + резерв 1)
            for(let j=0;j<отрезки.length;j++) if(пересек(св[0], отрезки[j])){ зло+=12; break; }
            if(сквозь(св[0])) зло+=10;
            if(наЧужих([pt])>0) зло+=10;
            const цена=зло*1000+R+ЦЕНА_НАРУЖУ*разн(ac,наружу);
            if(!лучш || цена<лучш.цена) лучш={pt, св, цена};
          }
        }
        return лучш;
      };
      // по кругу — в том же порядке, что и проход 1: крупным кустам первое слово и здесь
      // (порядок «внутренние первыми» проверен линейкой — не меняет ничего)
      const кругом=дд.slice().sort((a,b)=>кустR[b]-кустR[a]);
      let есть=true;
      while(есть){
        есть=false;
        кругом.forEach(ветка=>{
          const c=ожид[ветка].shift(); if(!c) return; есть=true;
          let лучш=местоЛиста(c, ветка);
          if(!лучш) лучш=наименьшееЗло(c, ветка);
          if(!isFinite(лучш.pt.x) || !isFinite(лучш.pt.y)){ const рп=цель[род[c]]; лучш.pt.x=рп.x+ШАГ_ЦЕПИ; лучш.pt.y=рп.y; лучш.св[0].bx=лучш.pt.x; лучш.св[0].by=лучш.pt.y; }
          цель[c]={x:лучш.pt.x, y:лучш.pt.y}; занять({id:c, x:лучш.pt.x, y:лучш.pt.y, ветка}); отрезки.push(лучш.св[0]);
          снятьРез(ветка, лучш.pt.x, лучш.pt.y, c);
          // глубже: обычную ноду раскрываем здесь же, хаб — отдельной очередью, ветками
          /* Дети поставленного листа — В НАЧАЛО очереди своей ветки, а не в конец: в конце они
             доходили до постановки после всех листьев всех веток, когда место вокруг родителя
             уже разобрано соседями, — и всякий внук вызывал ремонт целой ветки (линейка). */
          if(хаб(c)) хабы.push(c); else (дети[c]||[]).slice().reverse().forEach(cc=>ожид[ветка].unshift(cc));
        });
      }
    };
    for(let i=0;i<хабы.length;i++) разложитьХаб(хабы[i]);
    /* Пишем ДОМАМИ. Смещение считается от ЦЕЛЕВОГО места владельца, если он тоже в выделении:
       иначе дом ребёнка мерился бы от точки, откуда владелец через секунду уедет. */
    const было=this.layoutSnap();
    let n=0;
    ids.forEach(id=>{
      const it=this.byId[id].ref, ц=цель[id]; if(!it || !ц || it.pin) return;
      const вл=this._ownerNode(it);
      const оп=вл ? (цель[вл.id] || {x:вл.x, y:вл.y}) : null;
      if(!оп) return;                                 // владельца нет — дому не от чего считаться
      it.hx=Math.round(ц.x-оп.x); it.hy=Math.round(ц.y-оп.y); n++;
    });
    if(!n){ toast("Не от чего считать дома: у выделенного нет владельцев",{icon:"ti-layout-grid"}); return false; }
    undoPushLayout(было);
    /* Без «Держать раскладку» дома не действуют вовсе, и наведённый порядок физика растащит
       за пару секунд. Поэтому режим включаем сами и говорим об этом — молча менять настройку
       нельзя, а спрашивать посреди жеста незачем: без неё действие просто не имеет смысла. */
    let включили=false;
    if(!S.settings.graphHome){ S.settings.graphHome=true; включили=true;
      const b=$("#g-home"); if(b) b.classList.add("on"); }
    persist();
    /* РАЗОГРЕВ — СТРОГО ПОСЛЕ build(). Тот не берёт максимум, а ПЕРЕЗАПИСЫВАЕТ alpha (см. его
       хвост: у размещённых нод она становится нулём — «позиции уже сохранены, не дёргаем»).
       Поднимешь до сборки — она затрётся, физика уснёт, и ноды поедут по новым домам только
       после первого жеста, который её разбудит (КРОЛИК: «двигает не сразу, а когда совершу
       какое-либо действие»). */
    this.build();
    this.alpha=Math.max(this.alpha,0.5); this._wake();
    toast("Упорядочено · нод: "+n+(включили?" · «Держать раскладку» включено":""),
      {icon:"ti-layout-grid", label:"Вернуть", onAction:()=>{ undoStep(); }});
    return true;
  }
  /* Владелец ноды как УЗЕЛ на холсте — та же формула, что у _homeFromDrag и физики в _tick.
     Держим её одной функцией: разъедься эти три места, дома поехали бы вразнобой. */
  _ownerNode(it){
    if(!it) return null;
    if(it.parent && this.byId[it.parent]) return this.byId[it.parent];
    if(it.area && this.byId["hub_"+it.area]) return this.byId["hub_"+it.area];
    if(subRootHolds(it)) return this.byId[subRootCur()||""] || null;
    return null;
  }
  /* СБРОС ДОМА — НА ВЫДЕЛЕНИЕ, как цвет и статус (2026-09-01).
     Зачем нужен: «Держать раскладку» назначает дом всем разом, и одна нода, которую однажды
     поставили не туда, держится за старое место навсегда — вернуть её в общий строй можно было
     только выключив режим целиком, то есть отпустив ВСЮ форму дерева.
     Что делает сброс: удаляет hx/hy. Дальше нода ведёт себя ровно так, будто дома у неё нет —
     подчиняется родителю и физике (в _tick ветка `if(it.hx==null||it.hy==null) continue`), а дом
     назначится сам, как только её первый раз потянут: это уже делает _homeFromDrag на отпускании.
     Правило выделения то же, что у статуса: кликнутая нода в выделении — идёт всё выделение,
     нет — только она. ПКМ выделения не трогает, и молча чинить «те пять из прошлой рамки» нельзя. */
  _resetHome(n){
    const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
    // сброс дома — это раскладка, а не содержимое: своим шагом (hx/hy из ключа истории выброшены)
    const было=this.layoutSnap();
    const undo=[]; let nn=0;
    ids.forEach(id=>{
      if(isHubId(id)) return;                         // у области и у корня подграфа дом абсолютный — это их собственные x/y
      const it=S.items.find(x=>x.id===id);
      if(!it || it.hx==null || it.hy==null) return;   // дома и так нет — сбрасывать нечего
      undo.push([id, it.hx, it.hy]);
      delete it.hx; delete it.hy; nn++;
    });
    if(!nn) return;
    undoPushLayout(было);
    persist(); this._closePop();
    /* Раскладку надо РАЗОГРЕТЬ: без этого нода останется стоять там же, где стояла, и человек
       решит, что кнопка не сработала. Физика доведёт её до места родителя за те же полсекунды,
       что и после любого другого изменения формы. */
    // разогрев ПОСЛЕ сборки: build перезаписывает alpha нулём, и поднятая до него затирается
    this.build(); this.alpha=Math.max(this.alpha,0.35); this._wake();
    const back=()=>{ undo.forEach(([id,hx,hy])=>{ const it=S.items.find(x=>x.id===id); if(it){ it.hx=hx; it.hy=hy; } });
      persist(); this.build(); this.alpha=Math.max(this.alpha,0.35); this._wake(); };
    toast(nn<2 ? "Дом сброшен · встанет по родителю" : ("Дом сброшен · нод: "+nn),
          {icon:"ti-home-off", label:"Вернуть", onAction:back});
  }
  /* «ДЕРЖАТЬ РАСКЛАДКУ» — включение и выключение.
     ВКЛЮЧЕНИЕ назначает дом только тем, у кого его ЕЩЁ НЕТ: у остальных форма уже задана
     человеком, и перезапись стёрла бы её при каждом случайном нажатии.
     ВЫКЛЮЧЕНИЕ не стирает ничего — физика просто перестаёт учитывать дома, поэтому повторное
     включение возвращает прежнюю форму: ноды сами разъедутся по своим местам.
     Живые координаты переносим в данные ПЕРЕД расчётом (на диск раскладка уезжает только по
     остыванию, см. _tick): дом считается от координат ВЛАДЕЛЬЦА, и если у хаба в данных лежит
     вчерашняя точка, всю его ветку прописали бы со сдвигом. */
  toggleHome(){
    const вкл=!S.settings.graphHome;
    S.settings.graphHome=вкл;
    if(вкл){
      this.nodes.forEach(n=>{ if(n.ref){ n.ref.x=Math.round(n.x); n.ref.y=Math.round(n.y); }
        else if(n.hubArea){ n.hubArea.x=Math.round(n.x); n.hubArea.y=Math.round(n.y); }
        else if(n.subRoot){ n.subRoot.x=Math.round(n.x); n.subRoot.y=Math.round(n.y); } });
      let назначено=0;
      this.nodes.forEach(n=>{ const it=n.ref; if(!it || (it.hx!=null && it.hy!=null)) return;
        if(this._homeFromDrag(it)) назначено++; });
      toast("Раскладка держится"+(назначено?" · домов: "+назначено:""),{icon:"ti-home"});
    } else toast("Раскладка свободна",{icon:"ti-home-off"});
    persist();
    const b=$("#g-home"); if(b) b.classList.toggle("on",вкл);
    this.alpha=Math.max(this.alpha,0.3); this._wake();
  }
  /* force=true — нарисовать кадр ОБЯЗАТЕЛЬНО, не пропуская. Так зовёт build(): фигуры он создаёт
     БЕЗ координат (их ставит этот метод), поэтому пропуск первого же кадра оставлял бы весь граф
     невидимым. Раньше это и происходило: пропуск ниже работает через раз, а если окно не в фокусе
     (например, открыт системный диалог выбора папки), то кадр не только пропускался, но и следующий
     не планировался — raf=null. Ноды исчезали до первого клика или движения графа. */
  _tick(force){
    this._прКадр=performance.now();   // от неё _schedule отсчитывает потолок частоты
    this._покойКадр=false;
    /* ЗАМЕР КАДРА — только когда счётчик включён (Ctrl+Shift+F). Три вызова performance.now()
       на кадр незачем платить всем и всегда, а КРОЛИКУ нужно видеть цену кадра в СВОЁМ файле и
       на своём железе: любой стенд мягче живой работы. */
    const _прФ=!!(S.settings && S.settings.graphFps), _пр0=_прФ?performance.now():0;
    let _прФиз=0, _прСвеч=0;
    /* ПОКОЙ. Цикл кадров НЕ останавливается никогда (в конце метода безусловный _schedule), и это
       правильно — но раньше «покой» лишь пропускал КАЖДЫЙ ВТОРОЙ кадр, то есть граф вечно, ничего
       не делая, перерисовывал ТРИ полноэкранных слоя тридцать раз в секунду: звёздный фон (WebGL),
       холст графа и холст свечения (а там shadowBlur — самая дорогая операция canvas2d). Для
       композитора Chromium это три текстуры во весь размер окна, заново заливаемые 30 раз в
       секунду — вот откуда «граф жрёт видеокарту», хотя на экране не меняется ни пикселя.
       В покое меняется РОВНО ОДНА вещь — мерцание звёзд, у него период 30–40 с. Значит:
         • 6 кадров/с вместо 30 (мерцанию с запасом хватает), и ждём их СНОМ (см. ПОКОЙ_МС),
           а не пропуском кадров: пропуск всё равно будит поток с частотой монитора;
         • и на этих кадрах трогаем ТОЛЬКО фон, если ноды не дышат (на дереве >350 узлов дыхание
           и так выключено — см. AMP ниже): граф и свечение кадр в кадр дают те же пиксели.
       Любая активность (alpha>0, пан/зум, драг, курсор на ноде, едущая дуга, недавнее движение
       камеры — см. КАМЕРА_ОСТЫВАНИЕ_МС) → полный кадр. */
    const camKey=this.tx.toFixed(2)+"|"+this.ty.toFixed(2)+"|"+this.zoom.toFixed(4);
    const camMoving=camKey!==this._camKey; this._camKey=camKey;
    // незакончившийся зум — тоже занятость: иначе доезд шёл бы через кадр и снова выглядел ступеньками
    const busy=this.drag||this.connectDrag||this.panning||this.marq||this.linkFrom||this._zoomTo!=null;
    // см. КАМЕРА_ОСТЫВАНИЕ_МС: короткая пауза между рывками пана — ещё не повод падать в покой
    const камОстывает=this._камОстылоДо && performance.now()<this._камОстылоДо;
    /* ТЕЧЕНИЕ ПОТОКА — тоже движение: пока в кадре есть связи к работе и анимация включена, граф
       в покой не уходит, но и не гонит кадры с частотой монитора — штрихам хватает ~30 к/с
       (см. _потокКадр в конце метода). Окно свёрнуто — не течёт. */
    const течёт = ((this._течёт && S.settings.graphFlow!==false) || this._вращ) && S.settings.graphFlowAnim!==false && !document.hidden;
    this._потокКадр = течёт && this.alpha===0 && !camMoving && !busy && !this._hovId && !this._навЕдет;
    if(!force && this.alpha===0 && !camMoving && !busy && !камОстывает && !this._hovId && !this._навЕдет && !течёт){
      // то же условие, что у AMP ниже: дышат ноды или нет — от этого зависит, нужен ли полный кадр
      const дышат = !(this.nodes.length>350) && (S.settings.graphDrift!=null?S.settings.graphDrift:4)>0;
      /* «Дуги едут» держит полную частоту ТОЛЬКО на недышащем дереве. Пока ноды дышат, цели
         прогибов шевелятся от самого дыхания и этот признак не гаснет никогда — а раз так, он
         обходил бы ограничитель частоты вечно (замер: 30 полных кадров из 100 вместо 10). */
      if(дышат || !this._дугиЕдут){
        // ноды не дышат и дуги стоят — из трёх слоёв меняется только фон, его одного и рисуем
        if(!дышат){ this._drawBg(); this._schedule(ПОКОЙ_МС); return; }
        // иначе рисуем полный кадр, но всё равно вшестеро реже (пауза ставится в конце кадра)
        this._покойКадр=true;
      }
      // дуги доезжают на недышащем дереве — полная частота, это переходный момент на пару секунд
    }
    /* ПЛАВНЫЙ ЗУМ: колесо задало цель (см. onwheel), здесь камера едет к ней — 28% остатка за кадр,
       то есть щелчок мыши отрабатывается за ~6 кадров (100 мс). Точка под курсором остаётся на
       месте весь доезд: смещение пересчитывается от неё на каждом шаге, а не один раз в событии. */
    if(this._zoomTo!=null){
      const цель=this._zoomTo, т=this._zoomAt||{x:this.W/2,y:this.H/2};
      let nz;
      if(Math.abs(цель-this.zoom)<0.0015){ nz=цель; this._zoomTo=null; }   // остаток меньше кадра — доезжаем сразу
      else nz=this.zoom+(цель-this.zoom)*0.28;
      if(nz!==this.zoom){
        this.tx=т.x-(т.x-this.tx)*(nz/this.zoom); this.ty=т.y-(т.y-this.ty)*(nz/this.zoom);
        this.zoom=nz; this._applyTransform();
      } else this._zoomTo=null;
    }
    /* ЧАСЫ АНИМАЦИЙ — ПЕРВЫМ ДЕЛОМ В КАДРЕ, до любой отрисовки: по ним идёт и дыхание нод, и
       собственный дрейф с мерцанием звёзд фона. Считать их от performance.now() нельзя — см.
       подробный разбор ниже, у дыхания. Фон болел тем же: пауза на диалоге выбора папки, часы
       тикают, кадры стоят, а на возврате звёзды пересчитываются на новое время и поле разом
       перерисовывается со сдвигом. */
    const _сейчас=performance.now()*0.001;
    let _дт=(graphDriftStamp==null) ? 0 : (_сейчас-graphDriftStamp);
    if(!(_дт>0)) _дт=0; else if(_дт>0.1) _дт=0.1;   // провал длиннее 100 мс не догоняем
    graphDriftStamp=_сейчас; graphDriftClock+=_дт;
    this._drawBg();   // фон зависит от камеры и часов анимаций; камера внутри кадра не меняется
    const N=this.nodes, cx=this.W/2, cy=this.H/2;
    // даём симуляции полностью остыть, чтобы граф замирал и не дёргался; перетаскивание снова поднимает alpha
    this.alpha*=0.985; if(this.alpha<0.004)this.alpha=0;
    if(this.alpha>0.06) this._moved=true;   // была заметная активность → после остывания сохраним раскладку
    const DBG=this._dbg, запиши=DBG?DBG.сила:null;   // null, пока диагностика выключена → в силах ровно одна проверка на ветку
    /* НОДЫ ПЕРЕСМАТРИВАЮТ, К ЧЕМУ КРЕПИТЬСЯ, А НЕ ПРОСТО ТЯНУТСЯ ЗА ЦЕЛЬЮ. Раньше выбор точки
       крепления (хаб или пустышка) считался только в build() — то есть один раз при пересборке,
       а не по ходу жеста. Пока пустышку тащат рукой, build() не зовётся вовсе, и прицепленные
       ноды просто ехали следом на пружине, как приклеенные — «стараются перетекать за ней»,
       а не понимают, что им лучше отцепиться и выбрать хаб или соседнюю пустышку.
       Решение — переоценка КАЖДЫЙ кадр, но только для области той пустышки, которую держат
       рукой (дёшево: узлов в одной области немного), и РЕЖЕ (раз в ~0.4 с) для всего графа —
       на случай, если пустышка отъехала физикой, а не рукой. */
    if(this._естьПустышки){
      // в руке может быть сразу несколько пустышек (групповой хват) — области собраны на старте жеста
      if(this._dragHollowAreas){ for(let i=0;i<this._dragHollowAreas.length;i++) this._reevaluateAnchors(this._dragHollowAreas[i]); }
      else if(this.drag && this.drag.hollow) this._reevaluateAnchors(this.drag.area);
      this._ппТик=((this._ппТик||0)+1)%24;
      if(this._ппТик===0) this._reevaluateAnchors();
    }
    const _физ0=_прФ?performance.now():0;
    if(this.alpha>0){   // физика раскладки — только пока не остыло (при alpha=0 все силы = 0, движения нет → пропускаем весь цикл)
    let mx=0, my=0;
    for(let i=0;i<N.length;i++){ mx+=N[i].x; my+=N[i].y; }
    if(N.length){ mx/=N.length; my/=N.length; } else { mx=cx; my=cy; }
    /* ДОМ НОДЫ. Цель кладём НА САМ УЗЕЛ (n._дом), а не в массив по индексу: её спрашивает и
       взвешивание точки притяжения, и сама пружина, и оба ходят по узлам.
       Цель считаем от ЖИВОЙ позиции владельца, а не от сохранённой в данных: иначе дети догоняли
       бы уезжающий хаб только после остывания раскладки, то есть через секунды после того, как
       его отпустили. Владельца разбираем ТАК ЖЕ, как _homeFromDrag (родитель → хаб своей области),
       но берём его УЗЕЛ. Родитель, лежащий в лотке, узла на холсте не имеет: дома у такой ноды
       в этом кадре просто нет, и она ведёт себя как раньше. Подмены владельца на хаб тут быть
       не должно — данные считают дом от родителя, и смещение указывало бы не туда. */
    const _домВкл=!!(S.settings && S.settings.graphHome);
    // узел корня подграфа ищем ОДИН раз на кадр, а не на каждую ноду: subRootCur ходит по S.graphs
    const _корУзел=this.byId[subRootCur()||""]||null;
    let _домМакс=0;
    for(let i=0;i<N.length;i++){ const a=N[i], it=a.ref;
      a._дом=null;
      if(!_домВкл || a.fixed) continue;                                        // закреплённая живёт по pin, дом ей не считаем
      /* У ОБЛАСТИ ДОМ АБСОЛЮТНЫЙ, И СВОИХ ПОЛЕЙ ЕЙ НЕ ЗАВОДИЛИ: её x/y И ЕСТЬ дом. Без этой
         ветки хаб оставался единственным, кого физика по-прежнему расставляет, — и вся его
         ветка ехала за ним, потому что дома детей от него и считаются (замер: нода «доезжала»
         до дома, промахиваясь на 46 px, ровно на снос хаба). Область без координат (никогда не
         стояла на холсте) дома не получает: держать её нечем и незачем. */
      // корень подграфа живёт по тому же правилу: его x/y и есть дом (лежат во внутреннем графе)
      if(!it){ const ar=a.hubArea||a.subRoot;
        if(ar && ar.x!=null && ar.y!=null) a._дом={x:ar.x, y:ar.y};
        continue; }
      if(it.hx==null || it.hy==null) continue;
      // внутри подграфа владелец ноды верхнего уровня — КОРЕНЬ подграфа (тот же расчёт, что homeOwner)
      const о = it.parent ? this.byId[it.parent]
              : it.area ? this.byId["hub_"+it.area]
              : ((this._уКорня && this._уКорня.has(it.id)) ? _корУзел : null);
      if(о) a._дом={x:о.x+it.hx, y:о.y+it.hy};
    }
    /* ОТТАЛКИВАНИЕ УЗЛОВ ДРУГ ОТ ДРУГА. На малом дереве считаем честно все пары: там это доли
       миллисекунды, и поведение остаётся ровно прежним. На большом (>350 узлов) пары в лоб —
       главная статья кадра: 654 узла дают 213 тысяч вычислений, а замер показал 28 мс физики
       из 29 мс кадра. Поэтому силу делим надвое:
         • БЛИЖНИЕ узлы (до 450 px) — точно, по сетке соседства;
         • ДАЛЬНИЕ — одним толчком от центра масс ячейки, сколько в ней узлов.
       Это тот же приём, которым graph view в Obsidian держит тысячи узлов (там дерево, у нас
       регулярная сетка — разница в точности на дальних дистанциях, где сила и так мизерная).
       Выбрасывать дальнее поле совсем НЕЛЬЗЯ: одиночная дальняя сила ничтожна (7000/600² =
       0.02), но таких узлов сотни, и именно их сумма держит соседние ветки разведёнными. */
    /* ЧУЖОЙ ОСТРОВ ОТТАЛКИВАЕТСЯ ТОЛЬКО ВБЛИЗИ. Отталкивание — единственная сила без предела
       дальности, и пока стяжка была общей на весь граф, она его уравновешивала. С островами
       (см. build/_остров) уравновешивать стало нечем: два несвязанных дерева, оттолкнувшись,
       разъезжались бесконечно — тихо, по крохе за кадр, зато без остановки (КРОЛИК: «теперь
       улетают друг от друга»). Поэтому между РАЗНЫМИ островами сила гаснет к нулю на пределе
       видимого соседства: рядом они по-прежнему расталкиваются и не налезают друг на друга, а
       разведённые — не чувствуют друг друга вовсе и стоят там, где их поставили. Внутри острова
       ничего не меняется: там дальнее поле по-прежнему держит соседние ветки разведёнными.
       Гасим ПЛАВНО: обрыв в ноль дал бы ноде, качающейся ровно на границе, толчок «есть/нет» —
       ту самую дрожь, которую мы лечим гистерезисом в других местах.
       ПОРОГ СЧИТАЕМ ОТ САМИХ НОД: их радиусы плюс просвет. Первая версия брала круглые 450 px
       (радиус ближнего поля) — и этого хватало, чтобы деревья, разведённые на вид далеко, всё
       равно медленно ползли врозь: между их ближайшими нодами было около 320 px, то есть ВНУТРИ
       порога (замер: +8 px за 600 кадров и дальше без остановки; КРОЛИК: «на норм расстоянии и
       медленно пытаются отдаляться»). Задача чужого острова — не налезать, а не держать дистанцию
       в пол-экрана.
       ПРОСВЕТ 200 — ЗАМЕР, А НЕ ВКУС. На 90 px чужие деревья начинали перемешиваться: в проверке
       «узлы держатся своей звезды» сбитых становилось 10 из 90 против 9 на прежнем коде. На 200
       сбитых 8, то есть НЕ ХУЖЕ прежнего, а ползучесть при этом уходит в ноль. */
    const _остр=this._остров||{};
    const ОСТ_ПРОСВЕТ=200, ОСТ_ПЛАВНО=60;
    const _чужиеОстрова=(a,b)=>_остр[a.id]!==_остр[b.id];
    const _затуханиеОстрова=(a,b,d)=>{ const порог=a.r+b.r+ОСТ_ПРОСВЕТ;
      return d>=порог ? 0 : (d<=порог-ОСТ_ПЛАВНО ? 1 : (порог-d)/ОСТ_ПЛАВНО); };
    const _многоНод=N.length>350;
    const SPREAD=(S.settings.graphSpread!=null?S.settings.graphSpread:1);
    // сетка строится ОДИН раз за кадр и служит ещё и отталкиванию от связей (см. ниже)
    this._сеткаК = _многоНод ? this._grid(n=>n.x, n=>n.y, 200) : null;
    if(!_многоНод){
      for(let i=0;i<N.length;i++){ const a=N[i];
        const adjA=this.adj[a.id];
        for(let j=i+1;j<N.length;j++){ const b=N[j];
          let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy||1, d=Math.sqrt(d2);
          // связанные узлы отталкиваются слабее, несвязанные — заметно сильнее (разлетаются дальше)
          const connected = adjA && adjA.has(b.id);
          const rep = (connected ? 2400 : 7000) * SPREAD;
          let f=(rep/d2)*this.alpha;
          if(_чужиеОстрова(a,b)){ const з=_затуханиеОстрова(a,b,d); if(з<=0) continue; f*=з; }
          const fx=dx/d*f, fy=dy/d*f;
          /* НОДУ С ДОМОМ РАСТАЛКИВАНИЕ НЕ ДВИГАЕТ. Это НЕ вкус, а условие того, что цикл кадров
             вообще уходит в покой. ЗАМЕР: дом ноды в 12 px от соседа — отталкивание (7000/d²)
             отшвыривает её, домашняя пружина ползёт обратно, и равновесия нет ни через 2500
             кадров (alpha упиралась в нижнюю планку, граф не засыпал, снос 96 px за 300 «покойных»
             кадров). Отталкивание — единственная сила, способная держать ноду вдали от дома
             БЕСКОНЕЧНО, а бесконечное удержание означает вечную перерисовку трёх полноэкранных
             слоёв — ровно та болезнь, от которой в _tick заведён покой.
             Место, куда ноды встали, выбрал человек: расталкивать их между собой означает
             переигрывать его решение. Реакция на ВТОРОЙ конец остаётся: нода БЕЗ дома, брошенная
             поверх выстроенной ветки, по-прежнему отъезжает — двигается тот, кого расставляет
             физика, а не тот, кого расставили руками. */
          if(!a._дом){ a.vx+=fx; a.vy+=fy; if(запиши) запиши(a,"ноды",fx,fy); }
          // знак у второго конца ОБРАТНЫЙ — как в самой физике строкой выше; иначе «сумма» врёт
          if(!b._дом){ b.vx-=fx; b.vy-=fy; if(запиши) запиши(b,"ноды",-fx,-fy); }
        }
      }
    } else {
      const БЛИЖ=450, БЛИЖ2=БЛИЖ*БЛИЖ, ЯЧ=450;
      /* Ячейки дальнего поля: центр масс и населённость. Считается за один проход по узлам,
         то есть стоит столько же, сколько сам обход. */
      /* Ячейки считаем ОТДЕЛЬНО ПО ОСТРОВАМ, и узел получает дальнее поле только своего острова:
         чужой остров дальше порога не отталкивает вовсе (см. выше), а в одной ячейке узлы разных
         островов лежать могут. Дороже это не выходит — наоборот: перебор идёт по ячейкам своего
         острова, а не по всем ячейкам графа. */
      const агр=new Map();
      for(let i=0;i<N.length;i++){ const n=N[i];
        const о=_остр[n.id];
        const k=о+"|"+Math.floor(n.x/ЯЧ)+","+Math.floor(n.y/ЯЧ);
        let я=агр.get(k); if(!я){ я={x:0,y:0,к:0,о}; агр.set(k,я); }
        я.x+=n.x; я.y+=n.y; я.к++;
      }
      const поОстрову=new Map();
      агр.forEach(я=>{ let сп=поОстрову.get(я.о); if(!сп){ сп=[]; поОстрову.set(я.о,сп); }
        сп.push({x:я.x/я.к, y:я.y/я.к, к:я.к}); });
      /* Пару считаем ДВАЖДЫ (для каждого её конца по разу) и прикладываем силу только к своему
         концу. Так не нужен обход «j больше i», который с сеткой невозможен, а результат тот же. */
      for(let i=0;i<N.length;i++){ const a=N[i];
        // ноду с домом расталкивание не двигает — ни ближним полем, ни дальним (разбор выше,
        // у честного перебора пар). В ЯЧЕЙКИ она при этом входит: чужие ноды от неё отъезжают.
        if(a._дом) continue;
        const adjA=this.adj[a.id];
        const рядом=this._near(this._сеткаК, a.x, a.y, a.x, a.y, БЛИЖ);
        for(let q=0;q<рядом.length;q++){ const b=N[рядом[q]]; if(b===a) continue;
          let dx=a.x-b.x, dy=a.y-b.y, d2=dx*dx+dy*dy||1;
          if(d2>БЛИЖ2) continue;                       // дальше радиуса — учтён полем ниже
          const d=Math.sqrt(d2);
          const connected = adjA && adjA.has(b.id);
          const rep = (connected ? 2400 : 7000) * SPREAD;
          let f=(rep/d2)*this.alpha;
          if(_чужиеОстрова(a,b)){ const з=_затуханиеОстрова(a,b,d); if(з<=0) continue; f*=з; }
          const fx=dx/d*f, fy=dy/d*f;
          a.vx+=fx; a.vy+=fy;
          if(запиши) запиши(a,"ноды",fx,fy);
        }
        const дальние=поОстрову.get(_остр[a.id])||[];
        for(let q=0;q<дальние.length;q++){ const я=дальние[q];
          let dx=a.x-я.x, dy=a.y-я.y, d2=dx*dx+dy*dy;
          // ячейку, чьи узлы уже сосчитаны точно, второй раз не учитываем (с запасом на её размер)
          if(d2<(БЛИЖ+ЯЧ)*(БЛИЖ+ЯЧ)) continue;
          const d=Math.sqrt(d2);
          const f=(7000*SPREAD*я.к/d2)*this.alpha, fx=dx/d*f, fy=dy/d*f;
          a.vx+=fx; a.vy+=fy;
          if(запиши) запиши(a,"ноды",fx,fy);
        }
      }
    }
    /* Стягиваем к ЦЕНТРУ МАСС СВОЕГО ОСТРОВА (см. ниже), а не к центру вьюпорта (W/2,H/2),
       как было раньше.
       Точка вьюпорта неподвижна, а разросшееся дерево живёт где угодно — и стоило схватить
       ноду (драг поднимает alpha с нуля), как ВСЕ ноды разом получали импульс в её сторону:
       граф целиком уезжал «куда-то к центру». К центру масс сумма этих сил равна нулю, так
       что граф только поджимается сам к себе и с места не трогается.
       ЛИСТЬЯМ ЭТУ СИЛУ РЕЖЕМ. Она одна на весь граф и линейна по расстоянию, а отталкивание
       между пучками (ниже) падает как 1/d² — на большом удалении общее притяжение всегда
       переигрывает локальную защиту, и отдельные пучки медленно едут друг к другу, сколько их
       ни разводи (КРОЛИК: «все хотят собираться в кучу»). У листа уже есть локальный якорь
       пучка (0.006, в четыре раза сильнее) — общий центр ему заменять нечем, только мешать.
       ЦЕНТРЫ ПУЧКОВ (у кого есть свои дети) держим на полной силе: их немного, они и так
       разведены отталкиванием пучков и веером, а полностью бесхозный узел (без области и
       родителя) вообще не имеет локального якоря — без общего центра он улетел бы в пустоту.
       На малом графе (≤60) пучков нет вовсе — оставляем как было.
       НАЙДЕННЫЙ ПОПУТНО БАГ (КРОЛИК: «беру ноду в руку — весь граф чуть плывёт вниз»): просто
       УМЕНЬШИТЬ k для листьев было НЕЛЬЗЯ — сумма сил по всем узлам держится в нуле, только
       пока коэффициент ОДИНАКОВ у всех (тогда (mx−x) просто суммируется в ноль, раз mx — их
       среднее). Как только коэффициент у части узлов другой, сумма перестаёт быть нулевой, и
       центр масс всего графа начинает СМЕЩАТЬСЯ каждый кадр — вся раскладка едет в сторону, а
       не «поджимается сама к себе», как задумано в комментарии выше. Проверено замером на 108
       узлах: разнородный коэффициент — снос +45 px за 300 кадров; вернуть коэффициент
       одинаковым — снос падает до шума (−13 px, это уже осадка после дрожи, не дрейф).
       ПРАВИЛЬНОЕ РЕШЕНИЕ — не гасить силу для листьев, а взвесить ТОЧКУ притяжения теми же
       коэффициентами: cx = Σ(k·x)/Σk. Тогда Σ k·(cx−x) = cx·Σk − Σ(k·x) = 0 АЛГЕБРАИЧЕСКИ,
       при любом соотношении коэффициентов — снос невозможен по построению, а не потому что
       коэффициенты подобраны удачно. Листья при этом всё равно тянутся к точке слабо (закон
       такой же), а сама точка — это в основном центр масс ЦЕНТРОВ пучков (у них k большой),
       что и было целью: не отдельный далёкий центр всего графа, а центр «скелета». */
    const _центрСила=0.0016;
    const _домСила=ДОМ_СИЛА;   // жёсткость домашней пружины (разбор — ниже, у самой силы)
    /* ОСЛАБЛЯТЬ ХВАТКУ ДОМА ПОД ЖЕСТОМ ПРОБОВАЛ И УБРАЛ — не повторять без новых замеров.
       Идея была: пока alpha высокая, дом отпускает, и граф движется свободно, как до дома.
       Замер на 412 узлах не увидел РАЗНИЦЫ ВООБЩЕ. Причина в интеграторе: пока ноду держат
       рукой, шаг любой ноды за кадр ограничен 4 px по оси (мх=6/масса), поэтому силы под рукой
       вообще не определяют картину — её определяет потолок. Проверено и на ровной руке, и на
       рваной (события через кадр, скачки 4…26 px): пик шага ребёнка 5.7 px во ВСЕХ вариантах,
       включая выключенный дом. */
    const _листВес=0.06;
    const _многоУзлов=N.length>60 && this._группа;
    /* НАЗВАНИЕ НАРОЧНО НЕ cx/cy: так уже зовётся центр экрана в начале _tick (строка ~2516,
       запасное значение mx/my при пустом графе). Оба — let/const в одном блоке if(alpha>0),
       и одинаковое имя тут же поймало временную мёртвую зону: на графе БЕЗ единого узла
       обращение к «внешнему» cx этажом выше падало ReferenceError на КАЖДОМ кадре (КРОЛИК:
       «даже на пустом графе низкий фпс» — это была не видеокарта, а исключение, тихо рвущее
       весь тик до отрисовки). */
    /* ТОЧКА ПРИТЯЖЕНИЯ У КАЖДОГО ОСТРОВА СВОЯ (список островов считает build). Одна общая точка
       на весь граф означала, что несвязанные деревья тянет друг к другу: отталкивание узлов
       падает как 1/d², а притяжение растёт линейно с расстоянием — на разлёте общий центр всегда
       перевешивает, и разведённые руками деревья сползались обратно (КРОЛИК: «они всё равно едут
       к общему центру»). По острову сумма сил внутри него по-прежнему равна нулю, то есть остров
       сам с места не трогается и только поджимается к себе; соседние острова больше ничем не
       связаны и держатся там, где их поставили. Остров из одной ноды притягивать не к чему —
       выходит ноль, и это правильно: держать её у чужого дерева было нечем и раньше, кроме
       общей кучи. */
    /* ДОМ НОДЫ. Цель считаем от ЖИВОЙ позиции владельца, а не от сохранённой в данных: иначе
       дети догоняли бы уезжающий хаб только после остывания раскладки — то есть через секунды
       после того, как его отпустили. Владелец разбирается как в model.js (homeOwner): родитель,
       а без него хаб своей области, — но берём его УЗЕЛ, а не элемент.
       Родитель, лежащий в лотке, узла на холсте не имеет: дома у такой ноды просто нет в этом
       кадре, и она ведёт себя как раньше. Подмены владельца на хаб тут быть не должно — данные
       считают дом от родителя, и смещение указывало бы не туда. */
    // _остр (номер острова по id) объявлен выше, у отталкивания — он же и здесь
    const _кол=Math.max(1, this._островов||1);
    const _цX=new Float64Array(_кол), _цY=new Float64Array(_кол), _цW=new Float64Array(_кол);
    const _ост=a=>{ const o=_остр[a.id]; return (o!=null && o<_кол)?o:0; };
    for(let i=0;i<N.length;i++){ const a=N[i];
      /* НОДА С ДОМОМ ВЫПАДАЕТ И ИЗ ТОЧКИ ПРИТЯЖЕНИЯ, А НЕ ТОЛЬКО ИЗ СИЛЫ. Это не мелочь и не
         оптимизация: точка притяжения обязана быть взвешена ТЕМИ ЖЕ коэффициентами, что и силы
         (см. разбор дрейфа выше). Оставить ноду в среднем, обнулив ей силу, — ровно тот случай
         «коэффициент у части узлов другой», от которого весь остров начинает уезжать в сторону
         по 45 px за 300 кадров. Вес ноль и в сумме, и в силе — тогда Σk·(c−x)=0 сохраняется. */
      const w=a._дом?0:((_многоУзлов && this._группа[a.id]!==a.id)?_листВес:1), о=_ост(a);
      if(w) { _цX[о]+=a.x*w; _цY[о]+=a.y*w; _цW[о]+=w; }
    }
    for(let о=0;о<_кол;о++){
      if(_цW[о]>0){ _цX[о]/=_цW[о]; _цY[о]/=_цW[о]; } else { _цX[о]=mx; _цY[о]=my; }
    }
    for(let i=0;i<N.length;i++){ const a=N[i];
      const дом=a._дом;
      if(дом){
        /* ДОМАШНЯЯ ПРУЖИНА ВМЕСТО РАСКЛАДОЧНЫХ СИЛ. Две тяги в одну ноду не складываются ни
           при каких условиях: у ноды с домом цель одна, и всё, что её РАССТАВЛЯЕТ, только
           спорило бы с ней. Инвариант «у каждого острова своя точка притяжения» цел — он просто
           перестал распространяться на тех, у кого есть своя цель.
           ЖЁСТКОСТЬ 0.02 — НЕ ВКУС, А ГРАНИЦА УСТОЙЧИВОСТИ. При трении 0.74 (см. интегратор)
           дискретная пружина критически задемпфирована ровно на k=0.02: подход к дому без
           перелёта, постоянная времени ~13 кадров. Выше — начинается звон (пара комплексных
           корней), а звон в паре с отталкиванием и есть та самая дрожь, что стоила проекту дня
           работы. Ниже — нода не доезжает: центростремительная 0.0016 за всё время остывания
           alpha закрывает лишь треть пути до цели.
           УМНОЖЕНИЕ НА ALPHA ЗДЕСЬ ОБЯЗАТЕЛЬНО, хотя из-за него дом и приходится защищать,
           снимая с ноды раскладочные силы. Пробовал наоборот — пружина постоянная, силы всем
           вернуть (разбор у ДОМ_СИЛА): арифметика та же, что у всех остальных сил, отклонение
           под нагрузкой = сила/k, и на мягкой пружине это десятки пикселей на каждую ноду
           разом — «тяну ноду, всё шароебится и плавает сильно». */
        const k=_домСила*this.alpha, dx=дом.x-a.x, dy=дом.y-a.y;
        a.vx+=dx*k; a.vy+=dy*k;
        const от=Math.abs(dx)>Math.abs(dy)?Math.abs(dx):Math.abs(dy);
        if(от>_домМакс) _домМакс=от;
        if(запиши) запиши(a,"дом",dx*k,dy*k);
        continue;
      }
      const лист=_многоУзлов && this._группа[a.id]!==a.id, о=_ост(a);
      const k=(лист?_центрСила*_листВес:_центрСила)*this.alpha;
      a.vx+=(_цX[о]-a.x)*k; a.vy+=(_цY[о]-a.y)*k;
      if(запиши) запиши(a,"центр",(_цX[о]-a.x)*k,(_цY[о]-a.y)*k);
    }
    /* КАДР «ЗАНЯТ», ПОКА НОДЫ ЕДУТ ДОМОЙ. Любая новая покадровая анимация обязана поднимать
       признак занятости В МОМЕНТ ЗАПУСКА (инвариант _tick) — иначе нода застынет на полпути:
       alpha остывает за ~6 с, а домашняя пружина живёт только пока alpha>0. Ровно тот класс
       бага, что был с подсветкой наведения.
       УСЛОВИЕ — НЕ «ОТКЛОНЕНИЕ БОЛЬШЕ ПОРОГА», А «ОТКЛОНЕНИЕ УМЕНЬШАЕТСЯ». Разница
       принципиальная: ноду, которую отталкивание соседа держит в стороне от дома, порог по
       расстоянию не отпустил бы НИКОГДА — граф не уснул бы вовсе, и мы получили бы три
       полноэкранных слоя, перерисовываемых вечно. Признак движения самозавершается: пришли
       в равновесие (любое) — сближение прекратилось, отпускаем.
       ПЕТЛИ ТУТ НЕТ ровно потому, что нода с домом не получает раскладочных сил (см. пружину
       выше). Когда их вернули, планка сама себя и подпитывала: отклонение уменьшалось потому,
       что остывала alpha, а планка её обратно поднимала — граф не засыпал ни через 2500 кадров.
       Две правки связаны намертво, менять их порознь нельзя. */
    if(_домВкл){
      const было=this._домОткл==null?Infinity:this._домОткл;
      this._домОткл=_домМакс;
      if(_домМакс>ДОМ_ПОРОГ && _домМакс<было-0.01 && this.alpha<ДОМ_ALPHA) this.alpha=ДОМ_ALPHA;
    } else this._домОткл=null;
    /* ПУЧКИ РАЗВОДЯТСЯ ЦЕЛИКОМ, А НЕ ПОУЗЛОВО. До сих пор физика знала только про пары узлов,
       и две соседние звёзды («шот со своими задачами») спокойно проезжали друг сквозь друга:
       силы отдельных узлов внутри наложения взаимно гасятся, разводить пучок как целое некому.
       Отсюда каша на большом дереве, которую невозможно распутать ни зумом, ни перераскладкой.
       Считаем для каждой звезды центр и охват, держим её узлы у своего центра и расталкиваем
       звёзды между собой, когда их круги налезают. Групп сотни, а не тысячи, поэтому стоит это
       доли миллисекунды: тяжёлый проход по узлам идёт только для реально пересекшихся пар.
       На малом графе не включаем: там всё и так читается, а поведение менять незачем. */
    if(N.length>60 && this._группа){
      const пучки=new Map();
      for(let i=0;i<N.length;i++){ const n=N[i], g=this._группа[n.id]; if(g==null) continue;
        let о=пучки.get(g); if(!о){ о={x:0,y:0,к:0,r:0,узлы:[],о:_остр[n.id]}; пучки.set(g,о); }
        о.x+=n.x; о.y+=n.y; о.к++; о.узлы.push(n);
      }
      const список=[], радиусы={};
      пучки.forEach((о,g)=>{ о.x/=о.к; о.y/=о.к;
        let r=0;
        for(let q=0;q<о.узлы.length;q++){ const n=о.узлы[q];
          const d=Math.hypot(n.x-о.x, n.y-о.y)+n.r; if(d>r) r=d; }
        о.r=r; радиусы[g]=r; список.push(о);
      });
      this._rПучка=радиусы;   // ими пружины считают, на каком расстоянии дети помещаются вокруг родителя
      /* Якорь звезды: слабая тяга к своему центру. Сильнее делать нельзя — она начнёт спорить
         с пружинами связей и стянет звезду в точку. */
      const ЯК=0.006*this.alpha;
      for(let i=0;i<список.length;i++){ const о=список[i];
        for(let q=0;q<о.узлы.length;q++){ const n=о.узлы[q];
          if(n._дом) continue;                     // у ноды с домом цель одна (см. домашнюю пружину)
          n.vx+=(о.x-n.x)*ЯК; n.vy+=(о.y-n.y)*ЯК;
          if(запиши) запиши(n,"пучок",(о.x-n.x)*ЯК,(о.y-n.y)*ЯК);
        }
      }
      const ЗАЗОР=46;                       // просвет между звёздами, чтобы читались как отдельные
      for(let i=0;i<список.length;i++){
        const A=список[i];
        for(let j=i+1;j<список.length;j++){
          const B=список[j];
          /* ЭТА СИЛА РАБОТАЕТ И МЕЖДУ ОСТРОВАМИ — намеренно, хотя стяжка между ними снята.
             Пробовал ограничить её своим островом: два несвязанных дерева, положенные друг на
             друга, тогда не расходятся, а ПЕРЕМЕШИВАЮТСЯ (замер: центры 150 px → 98, то есть
             они сползлись, а не разъехались) — отталкивание отдельных узлов внутри наложения
             гасится само, разводить пучок как целое некому. Дальнобойности тут нет: сила живёт
             только пока круги налезают, и с их расхождением гаснет сама. */
          let dx=B.x-A.x, dy=B.y-A.y, d2=dx*dx+dy*dy;
          const нужно=A.r+B.r+ЗАЗОР;
          if(d2>=нужно*нужно) continue;      // не налезают — дальше дешёвой проверки не идём
          const d=Math.sqrt(d2)||1, ux=dx/d, uy=dy/d;
          /* Сила подобрана замером, а не на глаз: при 0.85 звёзды почти не расходились (45
             налегающих пар из 666 превращались в 39) — пружина к родителю держит их крепче.
             Растащить пучок целиком должно быть заметно сильнее, чем удержать пару узлов. */
          const f=((нужно-d)/нужно)*2.6*this.alpha;
          // мелкая звезда уступает крупной: иначе пучок из трёх узлов таранил бы пучок из тридцати
          const мA=B.к/(A.к+B.к), мB=A.к/(A.к+B.к);
          // ноду с домом не двигает и разведение звёзд: у неё ровно одна сила — своя пружина
          for(let q=0;q<A.узлы.length;q++){ const n=A.узлы[q]; if(n._дом) continue; n.vx-=ux*f*мA; n.vy-=uy*f*мA; }
          for(let q=0;q<B.узлы.length;q++){ const n=B.узлы[q]; if(n._дом) continue; n.vx+=ux*f*мB; n.vy+=uy*f*мB; }
        }
      }
    }
    /* СЕКТОРЫ ВЕТОК КАК СИЛА — ПРОБОВАЛ И УБРАЛ (2026-08-06), не повторять без нового замысла.
       Каждой ветке раздавался свой угол вокруг корня (по весу и по её угловому размеру), а узлы,
       вышедшие за границу, получали толчок по касательной обратно. На дереве из двенадцати
       звёзд стало ХУЖЕ, чем без секторов: 67 узлов из 77 оказались в чужих углах против 52 до
       раскладки, и заодно рассыпались сами звёзды (6 сбитых узлов против 9).
       Причина в том, что границы приходится пересчитывать по ходу раскладки — ветки растут и
       переезжают, — а любой пересчёт меняет и порядок секторов, и их ширину. Узлы начинают
       догонять уезжающие границы, физика идёт вразнос. Разметка веток (_ветвь/_корень) осталась:
       она понадобится, когда за это возьмутся правильно — детерминированной раскладкой по
       команде «разложить», а не силой в каждом кадре. */
    /* ДЕТИ РАСХОДЯТСЯ ВЕЕРОМ ВОКРУГ РОДИТЕЛЯ, НАРУЖУ ОТ ВЕТКИ. Пружины задают расстояние, но не
       направление, поэтому дети сбивались на одну сторону, а ветки заворачивались обратно к
       центру дерева — отсюда длинные лучи через весь граф и переплетение соседних веток.
       Каждому ребёнку считается ЦЕЛЕВОЙ угол: середина веера смотрит наружу (от деда к
       родителю), дети раскладываются по обе стороны от неё в стабильном порядке остова. Толчок
       идёт по касательной — расстояние остаётся за пружиной.
       Почему это устойчиво, в отличие от секторов (см. выше): цель зависит только от структуры
       дерева и позиции родителя с дедом, но НЕ от того, где сейчас соседние узлы. Обратной
       связи нет, догонять уезжающую цель некому. */
    if(N.length>60 && this._дети && this._родитель){
      /* Сила мягкая намеренно: при 0.05 веер спорил с якорем пучка и растаскивал звёзды —
         сбитых узлов становилось 18 из 90 против 6 без него. Направление важно, но не ценой
         того, что узел уезжает от своей звезды. */
      const ЛУЧ=0.012*this.alpha;
      this._дети.forEach((спис,pid)=>{
        const p=this.byId[pid]; if(!p || спис.length<2) return;
        const дед=this._родитель[pid] && this.byId[this._родитель[pid]];
        // наружу — от деда к родителю; у корня деда нет, тогда веер полный и середина не важна
        const наружу=дед ? Math.atan2(p.y-дед.y, p.x-дед.x) : null;
        const k=спис.length;
        // чем больше детей, тем шире веер, но не больше почти полного круга; у корня — весь круг
        const ширина=наружу==null ? 6.283185307 : Math.min(5.0, 1.1+0.42*k);
        const шаг=ширина/k;
        for(let i=0;i<k;i++){
          const n=this.byId[спис[i]]; if(!n || n===this.drag || n._grabbed || n.fixed) continue;
          const dx=n.x-p.x, dy=n.y-p.y, r2=dx*dx+dy*dy; if(r2<400) continue;
          const r=Math.sqrt(r2);
          const серединаВеера=(наружу==null) ? Math.atan2(dy,dx)-(i-(k-1)/2)*шаг : наружу;
          const цель=серединаВеера+(i-(k-1)/2)*шаг;
          let d=Math.atan2(dy,dx)-цель;
          while(d>Math.PI) d-=6.283185307; while(d<-Math.PI) d+=6.283185307;
          if(Math.abs(d)<0.05) continue;                 // почти на месте — не дёргаем
          if(n._дом) continue;                           // угол ребёнку задал человек домом
          const ux=-dy/r, uy=dx/r;                        // касательная к окружности вокруг родителя
          const f=Math.max(-0.6,Math.min(0.6,d))*r*ЛУЧ;
          n.vx-=ux*f; n.vy-=uy*f;
          if(запиши) запиши(n,"веер",-ux*f,-uy*f);
        }
      });
    }
    this.links.forEach(l=>{ const a=this.byId[l.a], b=this.byId[l.b];
      /* Длина связи растёт с НАСЕЛЁННОСТЬЮ концов. Раньше она была одинаковой для всех, и
         узел с десятью детьми получал столько же места, сколько лист: его дети толпились
         вплотную к соседним веткам, лезли на чужие линии и плодили перекрестья. Чем больше
         степень концов — тем дальше они разъезжаются, освобождая место своим детям. Считаем от
         √(deg−1): у листа множитель ровно 1 (ничего не меняется), у хаба — плавный рост.
         Потолок 2.8, иначе крупные ветки улетали бы за экран. Настройка graphLinkLen остаётся
         сверху множителем, ползунок по-прежнему главный. */
      const dA=(this.adj[l.a]?this.adj[l.a].size:1), dB=(this.adj[l.b]?this.adj[l.b].size:1);
      /* Длина связи растёт не только от числа соседей, но и от ВЕСА ВЕТКИ — сколько нод висит
         дальше по этой связи. Раньше у области с десятком проектов все ветки отходили на одну
         длину: ветка из трёх нод и ветка из двухсот получали одинаковое место, отчего в центре
         была толкучка. Корень четвёртой степени — рост мягкий, без выброса за экран. */
      const вес=Math.max((this._вес&&this._вес[l.a])||1, (this._вес&&this._вес[l.b])||1);
      const тяжесть=Math.min(3.2, 1+0.55*(Math.pow(вес,0.25)-1));
      const простор=Math.min(2.8, 1+0.16*(Math.sqrt(Math.max(0,dA-1))+Math.sqrt(Math.max(0,dB-1))))*тяжесть;
      let restLen=l.L*(S.settings.graphLinkLen!=null?S.settings.graphLinkLen:1)*(l.lenMul||1)*(l.doneMul||1)*простор;   // глобальная × индивидуальная × сжатие завершённой ветки × простор по степени
      /* ДЕТИ ДОЛЖНЫ ПОМЕЩАТЬСЯ ВОКРУГ РОДИТЕЛЯ. Множители выше считают простор «на глазок» — от
         числа соседей и веса ветки, — и упираются в потолок. А задача геометрическая: если у
         родителя k детей, каждый со своей звездой радиуса r, то по окружности им нужно
         k·(2r+зазор), то есть радиус не меньше k·(2r+зазор)/2π. При меньшем расстоянии звёзды
         НЕ ПОМЕЩАЮТСЯ физически, и никакое расталкивание не поможет: пружина вернёт их обратно
         (замер: 45 налегающих пар из 666 при усилении расталкивания превращались в 40).
         Считаем только на больших деревьях — на малых прежняя раскладка и так читается. */
      if(N.length>60 && this._rПучка && this._родитель){
        const рA=this._родитель[l.a]===l.b, рB=this._родитель[l.b]===l.a;
        if(рA||рB){
          const рід=рA?l.b:l.a, дитя=рA?l.a:l.b;             // кто родитель, кто ребёнок по остову
          const k=(this._дети.get(рід)||[]).length;
          /* Радиус берём У СОБСТВЕННОЙ звезды ребёнка, и только если он сам центр. Сперва я брал
             this._rПучка[дитя] для любого ребёнка — а у листа группа это звезда РОДИТЕЛЯ, то есть
             связь удлинялась от размера той самой звезды, которую сама же и раздувала. Замер
             поймал: средний радиус звезды 27 → 136 за одну раскладку, при том что охват графа не
             вырос — звёзды просто расползались и потому налезали друг на друга. */
          const своиДети=(this._дети.get(дитя)||[]).length;
          const rД=своиДети ? (this._rПучка[дитя]||this.byId[дитя].r) : this.byId[дитя].r;
          if(k>1){
            const нужно=k*(2*rД+46)/6.283;
            // потолок оставляем щедрым: при k=9 шотах со звёздами радиуса ~130 нужно уже 440 px,
            // а вчетверо от базовой длины — всего 250, и звёзды не помещались
            if(нужно>restLen) restLen=Math.min(нужно, restLen*8);
          }
        }
      }
      let dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-restLen)*0.036*this.alpha, fx=dx/d*f, fy=dy/d*f;
      // конец с домом пружину не чувствует (разбор — у пружины родителя ниже); второй конец да
      if(!a._дом){ a.vx+=fx; a.vy+=fy; if(запиши) запиши(a,"пружина",fx,fy); }
      if(!b._дом){ b.vx-=fx; b.vy-=fy; if(запиши) запиши(b,"пружина",-fx,-fy); }
    });
    /* НОДЫ ОТТАЛКИВАЮТСЯ ОТ СВЯЗЕЙ. Раньше силы знали только про пары нод, поэтому на выросшем
       дереве узлы спокойно ложились ПОВЕРХ чужих линий: связь шла сквозь ноду, и глазом было
       не понять, что с чем соединено. Считаем расстояние до отрезка (связи прямые, см.
       _linkPath) и мягко разводим: ноду прочь от линии, концы связи — в обратную сторону
       с весом по месту касания, чтобы линия «прогибалась» естественно, а не дёргала узел.
       Инцидентные ноды пропускаем — они и есть концы. Дешёвый отсев по рамке ставит стоимость
       рядом с уже имеющимся O(N²), а не поверх него. */
    const EPAD=18;                       // зазор от края ноды до линии (замер: при 13 подпись ноды всё ещё задевала линию)
    for(let li=0; li<this.links.length; li++){
      const l=this.links[li], a=this.byId[l.a], b=this.byId[l.b];
      if(!a || !b) continue;
      /* На большом дереве ноды НЕ отталкиваются от РЯДОВЫХ лучей принадлежности (лист → хаб
         напрямую) — их столько же, сколько нод без своей пустышки рядом, и их рамки накрывают
         сотни соседей (10 fps на 880 нодах). Магистрали (hubLink) — исключение из исключения,
         тем же рассуждением, что и у обхода препятствий чуть выше: их считанные единицы, а не
         сотни, и именно они теперь толстые и заметные — узлы обязаны их обходить, а не наоборот. */
      if(_многоНод && !l.hubLink && (isHubId(l.a) || isHubId(l.b))) continue;
      const ex=b.x-a.x, ey=b.y-a.y, eL2=ex*ex+ey*ey; if(eL2<1) continue;
      /* Та же граница длины, что у _recalcBends (1440000 = 1200 px). У ОБЫЧНЫХ связей она не
         набегает — пружины держат их короткими, — а вот магистраль хаб↔дальняя пустышка может
         вытянуться через половину дерева. Без потолка её рамка накрывает сотни узлов из сетки
         КАЖДЫЙ кадр: то же самое «10 fps на 880 нодах», от которого спасает hub_-исключение выше,
         только теперь через длину, а не через префикс id. */
      if(_многоНод && eL2>1440000) continue;
      const minx=Math.min(a.x,b.x), maxx=Math.max(a.x,b.x), miny=Math.min(a.y,b.y), maxy=Math.max(a.y,b.y);
      /* Перебираем не ВСЕ ноды, а только те, что лежат в ячейках вдоль самой связи: нода за
         сотни пикселей от линии всё равно отсеивалась рамкой, но проверка стоила по разу на
         каждую связь — сотни тысяч сравнений за кадр. */
      // без сетки перебираем узлы напрямую, а не строим массив индексов: N.map на КАЖДУЮ связь
      // — это 652 временных массива по 654 элемента за кадр, одна только сборка мусора
      const кандидаты=(this._сеткаК)
        ? this._near(this._сеткаК, minx, miny, maxx, maxy, 90)
        : null;
      const _кол=кандидаты ? кандидаты.length : N.length;
      for(let ci=0; ci<_кол; ci++){
        const n=N[кандидаты ? кандидаты[ci] : ci]; if(n===a || n===b) continue;
        const need=n.r+EPAD;
        if(n.x<minx-need || n.x>maxx+need || n.y<miny-need || n.y>maxy+need) continue;   // мимо рамки связи
        let t=((n.x-a.x)*ex+(n.y-a.y)*ey)/eL2; if(t<0)t=0; else if(t>1)t=1;
        let dx=n.x-(a.x+ex*t), dy=n.y-(a.y+ey*t), d2=dx*dx+dy*dy;
        if(d2>need*need) continue;
        let d=Math.sqrt(d2);
        /* НОДА ЛЕГЛА ТОЧНО НА ЛИНИЮ — направление берём из нормали к связи, но длину нормали
           используем ТОЛЬКО для нормализации: расстояние до линии тут ноль, а не длина связи.
           Раньше тем же d подменялось расстояние, и это же d уходило в силу ниже:
           (need−d)/need давало около −10 вместо +1 — отталкивание МЕНЯЛО ЗНАК и на порядок
           усиливалось, то есть било ноду СКВОЗЬ линию. Оттуда её выталкивало обратно, и пока
           человек держит связь рядом, нода металась, а с ней дёргались и концы связи (обратная
           реакция считается от того же f). Это и была та самая дрожь: в замере КРОЛИКА
           (дрожь-отчёт.txt) 75 окон из 107 показали «проникновение по базовым» около −220 px,
           а в стенде сила на линии выходила 2.33 против 0.19 в полупикселе от неё. */
        let ux, uy;
        if(d<0.01){ const L=Math.sqrt(eL2)||1; ux=-ey/L; uy=ex/L; d=0; }
        else { ux=dx/d; uy=dy/d; }
        /* У самой границы зазора сила НЕ падает в ноль (0.35 остаётся): при чисто линейном
           затухании лист застревал в миллиметре от чужой линии — отталкивание там уже почти
           нулевое, а пружина к родителю тянет с прежней силой. За зазором сила и так не
           считается вовсе (выход по d>need выше), так что дрожания на границе это не даёт.
           ПОКА НОДУ ТАЩАТ — сила мягче и без ступеньки у края: человек давит связью на ноду,
           та отскакивает, он давит снова, и узел мечется под курсором. Отталкивание при этом
           НЕ отключается (иначе ноды лезли бы на линии), просто перестаёт спорить с рукой —
           а после отпускания физика доводит раскладку в полную силу. */
        const мягко=this.drag ? 0.45 : 1, край=this.drag ? 0 : 0.35;
        const f=(край+(1-край)*(need-d)/need)*1.1*мягко*this.alpha;
        // у ноды с домом ровно одна сила — своя пружина (разбор у расталкивания нод)
        if(!n._дом){ n.vx+=ux*f; n.vy+=uy*f; }
        /* Обратную реакцию делим на МАССУ конца — иначе крупный узел мотало. «Team Presentation»
           это конец десяти связей: водишь нодой вдоль любой из них, толчки приходят на хаб и
           складываются, и он мечется (замер: 43 разворота направления за проход, скачки до
           7.5 px за кадр). Массу берём от числа связей — тяжёлый узел двигается неохотно,
           лист по-прежнему легко. */
        const мA=1+(this.adj[a.id]?this.adj[a.id].size:0)*0.5;
        const мB=1+(this.adj[b.id]?this.adj[b.id].size:0)*0.5;
        if(!a._дом){ a.vx-=ux*f*(1-t)*0.5/мA; a.vy-=uy*f*(1-t)*0.5/мA; }
        if(!b._дом){ b.vx-=ux*f*t*0.5/мB;     b.vy-=uy*f*t*0.5/мB; }
        if(DBG){
          запиши(n,"линия",ux*f,uy*f);
          запиши(a,"линия",-ux*f*(1-t)*0.5/мA, -uy*f*(1-t)*0.5/мA);
          запиши(b,"линия",-ux*f*t*0.5/мB, -uy*f*t*0.5/мB);
          /* Тот же зазор, но посчитанный по ДРЕЙФУЮЩИМ координатам — по тем, что человек видит.
             Главная догадка (docs/РЕШЕНИЯ.md): сила считается по базовым, и у самой границы
             зазора физика может спорить с видимой картинкой. Здесь это видно числом: если
             базовое проникновение мигает вокруг нуля, а дрейфующее уходит в минус — догадка верна. */
          const aдx=a.x+(a._ix||0), aдy=a.y+(a._iy||0), bдx=b.x+(b._ix||0), bдy=b.y+(b._iy||0);
          const eдx=bдx-aдx, eдy=bдy-aдy, eдL2=eдx*eдx+eдy*eдy||1;
          const nдx=n.x+(n._ix||0), nдy=n.y+(n._iy||0);
          let tд=((nдx-aдx)*eдx+(nдy-aдy)*eдy)/eдL2; if(tд<0)tд=0; else if(tд>1)tд=1;
          const rдx=nдx-(aдx+eдx*tд), rдy=nдy-(aдy+eдy*tд);
          DBG.зазор(n, need-d, need-Math.sqrt(rдx*rдx+rдy*rдy));
          // связь ТАЩИМОЙ ноды прошла к этой ближе зазора — это и есть «жертва руки»
          if(a===this.drag || b===this.drag || a._grabbed || b._grabbed) DBG.жертва(n, (a.label||a.id)+" → "+(b.label||b.id), d);
        }
      }
    }
    /* СВЯЗИ СТАРАЮТСЯ НЕ ПЕРЕСЕКАТЬСЯ. Отрезки пересеклись — значит концы одной связи лежат
       по РАЗНЫЕ стороны от другой. Кратчайший путь убрать перекрестье: взять тот конец, что
       ближе к чужой линии, и перевести его на сторону своего напарника. Толкаем именно ближний
       (ему идти меньше всего) и слабо, чтобы раскладка расплеталась постепенно, а не выворачивала
       дерево рывком. Пары с общим узлом пропускаем: там пересечение — это сам узел.
       O(E²) с отсевом по рамкам: на сотне связей это тысячи дешёвых сравнений, рядом с уже
       имеющимся O(N²) по нодам. */
    const площ=(p,q,r)=>(q.x-p.x)*(r.y-p.y)-(q.y-p.y)*(r.x-p.x);   // знак = с какой стороны от pq лежит r
    const развести=(p,q,sp,sq,e1,e2)=>{
      let nx=-(e2.y-e1.y), ny=e2.x-e1.x;                            // нормаль чужой связи
      const nl=Math.hypot(nx,ny)||1; nx/=nl; ny/=nl;
      const кого = Math.abs(sp)<=Math.abs(sq) ? p : q;              // ближний к чужой линии — ему идти меньше
      const куда = Math.abs(sp)<=Math.abs(sq) ? Math.sign(sq) : Math.sign(sp);
      /* Коэффициент подобран замером, а не на глаз: при 0.35 крест не расплетался вовсе —
         alpha остывает за пару сотен кадров, и импульс оказывался на порядок меньше
         отталкивания нод (7000/d²), которое держит узлы на местах. */
      /* Толчок расплетения подняли вместе с жёсткостью пружин (1.8 → 3.0): пружины стали
         держать узлы крепче, и прежний импульс уже не выводил перекрестье из равновесия —
         проверка «связи расплетаются» показывала «было 1, стало 1». */
      const f=3.0*this.alpha;
      /* ПОКА НОДУ ДЕРЖАТ РУКОЙ, РАСПЛЕТЕНИЕ ПОЧТИ МОЛЧИТ — вот отчего нода дрожала, когда рядом
         держат связь. Величина толчка постоянная, а граница «есть перекрестье / нет» жёсткая, то
         есть это реле: нода переходит чужую линию, перекрестье исчезает, толчок пропадает, пружины
         (к родителю и по связям) возвращают её назад, перекрестье появляется — и снова полный
         толчок. Пока перекрестье расплетается, всё честно. Но если пружины сильнее, спор идёт
         БЕСКОНЕЧНО: нода мечется через линию, а перекрестье так и остаётся.
         Замер на плотной сцене (хорды между детьми хаба, рука НЕПОДВИЖНА): 22 разворота направления
         за 54 кадра при восьми нерасплетённых перекрестьях, а с выключенным расплетением — НОЛЬ
         разворотов. Значит сила своего не добивалась и всё равно трясла ноду.
         Решение — то же, что уже принято для отталкивания от связи (см. «мягко» выше): пока рука
         держит ноду, физика не спорит с рукой, а после отпускания доводит раскладку в полную силу.
         Расплетение при этом не отменяется: проверки «связи расплетаются» и «ветвистое дерево»
         работают вне драга и остаются зелёными, а плотная сцена после отпускания расплетается до
         тех же восьми перекрестий.
         Что пробовал до этого и почему не подошло (не повторять без новых замеров):
         затухание толчка у самой линии — дрожь убирало, но нода парковалась ровно на линии и
         перекрестья не расплетались (16 нерасплетённых против 8); удержание направления на 10 и
         на 60 кадров после расплетения — 16 и 22 разворота, то есть почти без толку; «усталость»
         пары по кадрам (сдаётся через 40) — ломала и расплетение креста из двух диагоналей, и
         увод ноды с линии после отпускания (11 px вместо 26); та же усталость по числу ВОЗВРАТОВ
         перекрестья — 10 разворотов вместо 22, половина дрожи оставалась. */
      const сила = f*(this.drag?0.15:1);
      // ноду с домом расплетение не двигает: у неё ровно одна сила — своя пружина (разбор
      // у расталкивания нод). Перекрестье расплетёт второй конец, если дома нет у него.
      if(кого._дом) return;
      кого.vx += nx*куда*сила; кого.vy += ny*куда*сила;
      if(запиши){ запиши(кого,"крестья",nx*куда*сила,ny*куда*сила); DBG.крест(кого); }   // пишем ПРИМЕНЁННУЮ силу
    };
    const LN=this.links.length;
    /* Расплетение перекрестий — O(E²) и на большом дереве съедает кадр целиком. Правило
       косметическое: раскладка читается и с парой пересечений, а семь кадров в секунду — нет. */
    if(LN<=260)
    for(let i=0;i<LN;i++){
      const a=this.byId[this.links[i].a], b=this.byId[this.links[i].b]; if(!a||!b) continue;
      const ax1=Math.min(a.x,b.x), ax2=Math.max(a.x,b.x), ay1=Math.min(a.y,b.y), ay2=Math.max(a.y,b.y);
      for(let j=i+1;j<LN;j++){
        const c=this.byId[this.links[j].a], d=this.byId[this.links[j].b]; if(!c||!d) continue;
        if(a===c||a===d||b===c||b===d) continue;                    // общий узел — не перекрестье
        if(ax2<Math.min(c.x,d.x) || ax1>Math.max(c.x,d.x)) continue;
        if(ay2<Math.min(c.y,d.y) || ay1>Math.max(c.y,d.y)) continue;
        const s1=площ(c,d,a), s2=площ(c,d,b), s3=площ(a,b,c), s4=площ(a,b,d);
        if(!((s1>0)!==(s2>0) && (s3>0)!==(s4>0))) continue;          // отрезки не пересеклись
        развести(a,b,s1,s2,c,d);
        развести(c,d,s3,s4,a,b);
      }
    }
    // parent-child hierarchy spring — stronger pull
    N.forEach(n=>{
      if(n.ref && n.ref.parent && this.byId[n.ref.parent]){
        const p=this.byId[n.ref.parent];
        let dx=p.x-n.x, dy=p.y-n.y, d=Math.sqrt(dx*dx+dy*dy)||1;
        /* Пружина к родителю ЖЁСТЧЕ прежней (0.06 → 0.10): «ноды очень медленно и долго плывут»
           было ровно про неё. Выше поднимать нельзя — на 0.13 крупный узел под курсором снова
           начинал дёргаться (проверка «крупный узел не дёргается» ловит это шагом за кадр). */
        const f=(d-45)*0.10*this.alpha, fx=dx/d*f, fy=dy/d*f;
        /* НОДА С ДОМОМ ЭТУ ПРУЖИНУ НЕ ЧУВСТВУЕТ — иначе дом не держится вовсе. ЗАМЕР: дом в
           65 px от родителя, а пружина тянет к 45 — нода вставала ровно посередине и замирала
           в 16 px от дома, сколько кадров ни дай. Поднять домашнюю до победы нельзя: жёсткость
           выше 0.02 при трении 0.74 даёт звон. Правильно не перекрикивать, а убрать вторую
           тягу: дом И ЕСТЬ «держись на таком смещении от родителя», только заданное человеком
           и точно, а не «в сорока пяти пикселях, направление на усмотрение физики».
           Реакция на РОДИТЕЛЯ остаётся — он-то раскладывается физикой, и нода с домом работает
           для него якорем, ровно как закреплённая (у той скорость обнуляет интегратор). */
        if(!n._дом){ n.vx+=fx; n.vy+=fy; if(запиши) запиши(n,"родитель",fx,fy); }
        if(!p._дом){ p.vx-=fx; p.vy-=fy; if(запиши) запиши(p,"родитель",-fx,-fy); }
      }
    });
    /* ПРЕДЕЛ СМЕЩЕНИЯ ЗА КАДР. Был 6 px — отсюда «ноды очень медленно и долго плывут»: рука
       уходит на сотни пикселей, а ветка догоняет по шесть. Подняли до 16 вместе с жёсткостью
       пружин и трением (см. ниже) — быстрее, но без рывков и без раскачки. */
    const MX=16;
    // `_grabbed` — вся группа в руке, а не одна ведущая нода (см. onpointerdown): позиции
    // пассажирам задаёт жест, и физике их двигать нельзя, иначе группа расползётся под рукой
    N.forEach(n=>{ if(n===this.drag||n._grabbed||n.fixed){ n.vx=0; n.vy=0; return; }
      /* Пока ноду тащат, соседи двигаются ВЯЗЧЕ, и тем сильнее, чем больше у них связей.
         Давишь соседней нодой на связь — крупный узел на её конце получает толчки каждый кадр
         и мелко трясётся: шаг маленький, но направление меняется десятки раз за проход.
         Вязкость гасит именно эту дрожь, не мешая узлу спокойно отъехать. */
      const вязко=this.drag
        ? Math.max(0.5, 0.82-0.06*Math.min(5, 1+(this.adj[n.id]?this.adj[n.id].size:0)*0.5))
        : 0.74;   // трение подняли вместе с жёсткостью пружин: жёсткая пружина при слабом трении качается
      n.vx*=вязко; n.vy*=вязко;
      /* ПОКА НОДУ ДЕРЖАТ, крупный узел ходит медленнее мелкого: водишь нодой вдоль луча
         «Team Presentation» — центр качается в такт руке и дёргается (замер: 42 разворота
         направления, скачки до 7.4 px за кадр; с ограничением — 2.1). Вне драга ограничения
         НЕТ: тяжёлый хаб иначе не успевал доехать до равновесия, пока alpha жива, и после
         большого сдвига замирал на полпути. Массу режем сверху, чтобы хаб не вставал намертво. */
      /* Нода из ведомой ветки едет БЫСТРЕЕ общего предела: рука уходит на сотни пикселей, а
         шесть пикселей за кадр — это «ноды очень медленно и долго плывут», ровно та жалоба.
         Предел всё же есть: без него шлейф телепортируется и снова выглядит приклеенным. */
      /* ПОД РУКОЙ предел прежний (6 px и меньше для тяжёлых узлов): поднятый до 16 давал
         крупному узлу шаг под пять пикселей за кадр — это видимая дрожь, её ловит проверка
         «крупный узел не дёргается». Свободный ход быстрее нужен ПОСЛЕ отпускания, когда
         ветка догоняет и раскладка оседает. */
      const мх=this.drag ? 6/Math.min(4, 1+(this.adj[n.id]?this.adj[n.id].size:0)*0.5) : MX;
      if(n.vx>мх)n.vx=мх; else if(n.vx<-мх)n.vx=-мх;
      if(n.vy>мх)n.vy=мх; else if(n.vy<-мх)n.vy=-мх;
      n.x+=n.vx; n.y+=n.vy;
    });
    }   // /if(alpha>0) — физика раскладки
    if(_прФ) _прФиз=performance.now()-_физ0;
    /* «дыхание» в покое — чтобы граф жил, не выглядел вкопанным (амплитуда из настроек).
       ЧАСЫ ЗДЕСЬ СВОИ (graphDriftClock, счёт идёт выше), а не performance.now(). Раньше фаза
       считалась прямо от системных часов, и любая пауза графа била по позициям: открыл системный
       диалог выбора папки — окно потеряло фокус, слушатель blur зовёт pause(), кадры встали,
       дрейф застыл. Пока диалог открыт, часы идут; вернулись — build() пересчитывает дыхание уже
       на новое время, и ВСЕ ноды разом прыгают (замер: 6.7 px при амплитуде 4, потолок — два
       размаха, 8 px). Отсюда «ноды при привязке папки чуть дёргаются». Свои часы стоят вместе с
       графом: копим только время ОТРИСОВАННЫХ кадров, а длинный провал обрезаем, чтобы после
       паузы дыхание продолжилось с того же места, а не догоняло реальное время.
       Часы живут на уровне модуля (как graphCam): Graph пересоздаётся на каждый render(), и на
       экземпляре они обнулялись бы при каждой перерисовке — то есть на том же прыжке. */
    /* «Дыхание» на большом дереве ОТКЛЮЧАЕТСЯ. Оно шевелит координаты каждый кадр, а значит
       заставляет переписывать весь SVG даже у остывшего графа: на 877 нодах это 72 мс на кадр
       ради шевеления в четыре пикселя, которого на таком масштабе всё равно не видно. */
    const _it=graphDriftClock;
    const AMP=(N.length>350) ? 0 : (S.settings.graphDrift!=null?S.settings.graphDrift:4);
    N.forEach(n=>{
      // Дрейф со СХВАЧЕННОЙ ноды не снимаем. Раньше тут было n===this.drag: на pointerdown
      // _ix/_iy мгновенно схлопывались в 0, и нода роняла себя из дрейфующей позиции в базовую
      // (до AMP px по оси), а pointerup возвращал дрейф и она прыгала обратно — вот этот «дёрг»
      // и ловился на обычном клике. Точку захвата дрейф не сбивает: _grab (см. onpointerdown)
      // считается от базовой n.x, а рисуем по n.x+_ix — разница постоянна и уже была на экране.
      if(n.fixed){ n._ix=0; n._iy=0; return; }
      n._ix=Math.sin(_it*0.5 + n._ph)*AMP;    // фаза от id, не от индекса (см. build)
      n._iy=Math.cos(_it*0.43 + n._ph2)*AMP;
    });
    // связи — по позиции+idle (линии не «мерцают» от сдвига)
    const RX=n=>n.x+(n._ix||0), RY=n=>n.y+(n._iy||0);
    /* Помехи считаем КАЖДЫЙ кадр и по дрейфующим координатам — тем же, по которым рисуем.
       Через кадр было дешевле (0.14 мс против 0.3 на сотне нод), но дуга отставала от линии:
       строилась для одного положения, рисовалась для другого, и в тесном месте это выглядело
       как дрожание. Точность тут важнее сэкономленной трети миллисекунды. */
    /* Прогибы пересчитываем ТОЛЬКО когда ноды двигались. При остывшей раскладке (и выключенном
       дыхании) координаты кадр в кадр те же, а расчёт стоил 10 мс — почти половину бюджета
       шестидесяти кадров в секунду. Панорама и зум ноды не двигают: они меняют камеру. */
    const _двигались = this.alpha>0 || this.drag || AMP>0 || this._bendsDirty;
    /* На большом дереве прогибы считаем НЕ каждый кадр: это пятая часть бюджета, а дуга живёт
       десятки кадров и от задержки в один-два не дёргается (на сотне нод пересчёт остаётся
       ежекадровым — там он стоит доли миллисекунды и точность важнее). */
    const _редко = this.nodes.length>350;
    this._bc=((this._bc||0)+1)%3;
    if(_двигались && (!_редко || this._bc===0)){ this._bendsDirty=false; this._recalcBends(RX, RY); }
    /* Сглаживание прогибов зовём ВСЕГДА: оно стоит доли миллисекунды, а дуга едет к своей цели
       десятки кадров и после остановки нод. Привязать его к «двигались» — значит заморозить
       дугу на полпути (проверки «связь обходит ноду» это и поймали). */
    this._easeBends();   // к цели всё равно идём плавно: помеха может смениться на соседнюю
    // Кадр диагностики снимаем ЗДЕСЬ: дрейф уже посчитан, прогибы уже обновлены — значит видно
    // ровно то, что через несколько строк уедет в атрибуты и попадёт человеку на экран.
    if(DBG) this._dbgFrame(DBG);
    /* Отсечение по кадру включаем ТОЛЬКО на большом дереве. На малом оно ничего не экономит,
       зато делает картинку зависимой от того, куда смотрит камера: элемент вне вида остаётся
       со старой геометрией, и всё, что её меряет, получает вчерашние числа. */
    const _крупно=this.nodes.length>350;
    const _z0=this.zoom||1, _зап0=200;
    const вид= _крупно
      ? { x1:(-this.tx-_зап0)/_z0, y1:(-this.ty-_зап0)/_z0,
          x2:(this.W-this.tx+_зап0)/_z0, y2:(this.H-this.ty+_зап0)/_z0 }
      : { x1:-Infinity, y1:-Infinity, x2:Infinity, y2:Infinity };
    // РЕЖИМ CANVAS: вместо записи атрибутов в тысячи SVG-элементов рисуем весь граф одним холстом
    if(this.canvasMode) this._drawCanvas();
    else this.linkEls.forEach((e,i)=>{ const l=this.links[i], a=this.byId[l.a], b=this.byId[l.b];
      const ax=RX(a),ay=RY(a),bx=RX(b),by=RY(b), d=this._linkPath(ax,ay,bx,by,l);
      /* Пишем в DOM, ТОЛЬКО если путь изменился. Панорама и зум двигают камеру одной
         трансформой корня, координаты в мире при этом те же — а раньше каждый кадр всё равно
         переписывались все d, hit-пути и градиенты. Это и была половина лага на большом графе. */
      /* Связь целиком за экраном — путь не переписываем. НО только если он уже был записан
         хоть раз: у нового элемента атрибута d нет вовсе, и всё, что меряет геометрию линии
         (стрелки, подписи, getPointAtLength), спотыкается о пустой путь. */
      if(e._d && (Math.max(ax,bx)<вид.x1 || Math.min(ax,bx)>вид.x2 ||
                  Math.max(ay,by)<вид.y1 || Math.min(ay,by)>вид.y2)) return;
      if(e._d!==d){ e._d=d; e.setAttribute("d",d);
        const h=this.hitEls[i]; if(h) h.setAttribute("d",d);
        if(l._grad){ l._grad.setAttribute("x1",ax); l._grad.setAttribute("y1",ay); l._grad.setAttribute("x2",bx); l._grad.setAttribute("y2",by); }
        return;
      }
    });
    /* ВИДИМАЯ ОБЛАСТЬ в мировых координатах: ноду за краем экрана двигать в DOM незачем —
       её всё равно не видно, а стоит это столько же, сколько видимую. Помечаем такие ноды
       «грязными», чтобы дописать координаты, когда они вернутся в кадр. */
    this.nodeEls.forEach(o=>{ const n=o.n, x=RX(n), y=RY(n), sk=o.shapeKind;   // x/y — с idle: дрейфит фигура/ореол/пин/связи (вектор не мерцает)
      if(o._px===x && o._py===y) return;    // нода не сдвинулась — в DOM писать нечего
      // та же оговорка, что и у связей: первый раз координаты пишем всегда
      if(o._px!=null && (x<вид.x1 || x>вид.x2 || y<вид.y1 || y>вид.y2)){ o._скрыта=true; return; }
      o._скрыта=false;
      o._px=x; o._py=y;
      if(sk==="square"||sk==="diamond"){ o.shape.setAttribute("x",x-n.r); o.shape.setAttribute("y",y-n.r); }   // ромб — тот же квадрат, поворот в CSS (.sh-diamond)
      else if(sk==="hexagon"){ o.shape.setAttribute("points", this._hexPts(x,y,n.r)); }
      else { o.shape.setAttribute("cx",x); o.shape.setAttribute("cy",y); }
      if(o.pri){
        o.pri.setAttribute("d", this._priPath(sk, x, y, n.r));
        o.pri.style.transformOrigin = x.toFixed(1)+"px "+y.toFixed(1)+"px";   // растём вместе с нодой, от её центра
      }
      if(o.hit){ o.hit.setAttribute("cx",x); o.hit.setAttribute("cy",y); }   // расширенная область захвата едет с нодой
      if(kindIsTask(n.type) && o.check) o.check.setAttribute("d",`M ${x-3.2} ${y+0.3} l 2.2 2.4 l 4.2 -5`);
      if(o.halo){ o.halo.setAttribute("cx",x); o.halo.setAttribute("cy",y); }
      o.pin.setAttribute("cx",x); o.pin.setAttribute("cy",y);
      // глиф тега двигаем ТРАНСФОРМАЦИЕЙ его группы — текст при этом не растеризуется заново
      if(o.ticonG){ o.ticonG.setAttribute("transform",`translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        o.ticon.setAttribute("font-size",Math.max(8,n.r*1.25)); }
      // ПОДПИСЬ — на БАЗОВОЙ позиции n.x/n.y (idle её НЕ двигает): SVG-текст не ре-растеризуется → не «прыгает».
      o.t.setAttribute("x",n.x); o.t.setAttribute("y",n.y+n.r+12);
    });
    /* СВЕЧЕНИЕ РИСУЕМ ЗДЕСЬ, ПОСЛЕ нод и связей. Раньше оно шло первой строкой кадра — то есть
       по позициям ПРОШЛОГО кадра, пока SVG уже показывал новые. Слой отставал ровно на кадр, а
       вместе с ним и «дырки», которыми свечение стирается из-под связей: линия уезжала, вырез
       оставался на прежнем месте, и рядом с ней тянулась тёмная полоса шириной со сдвиг за кадр
       (до 6 px — это кламп MX). Заметнее всего сразу после привязки папки: она зовёт build(),
       ноды трогаются с места, и «ломается свечение». Замер в дев-превью: у связей было
       «вырез на −3 px, под линией свечение 20 из 42», после переноса — «вырез на 0, под линией 0».
       Фон остаётся выше: он зависит только от камеры, а она внутри кадра неизменна. */
    { const _св0=_прФ?performance.now():0;
      this._drawGlow();
      if(_прФ) _прСвеч=performance.now()-_св0; }
    if(_прФ) this._fpsTick(performance.now()-_пр0, _прФиз, _прСвеч);
    else if(this._fpsBox){ this._fpsBox.remove(); this._fpsBox=null; }   // счётчик выключили
    // когда симуляция остыла и просили «уложить» — подгоняем обзор под всё дерево
    if(this.alpha===0 && this._needFit){ this._needFit=false; this._fitView(); }
    // авто-раскладка остыла после активности → сохраняем позиции один раз, чтобы следующее открытие было статичным
    if(this.alpha===0) this.flushLayout();
    this._schedule(this._покойКадр?ПОКОЙ_МС:(this._потокКадр?33:0));
  }
  /* ПАЛИТРА ИЗ CSS. Цвета узлов и связей заданы в styles.css и меняются вместе с темой, поэтому
     на холсте берём их оттуда же, а не зашиваем числами: иначе светлая тема осталась бы тёмной.
     Читаем один раз за сборку — getComputedStyle стоит дорого, а внутри кадра тема не меняется. */
  _palette(){
    if(this._пал) return this._пал;
    const cs=getComputedStyle(document.body), в=(имя,зап)=>(cs.getPropertyValue(имя).trim()||зап);
    this._пал={
      связь:  в("--bd3","#3a3a3a"),
      тусклая:в("--bd2","#2c2c2c"),
      узел:   в("--acc","#e6e6e6"),
      текст:  в("--tx","#f4f4f5"),
      подпись:в("--mut","#86868c"),
      подпись2:в("--mut2","#5b5b61"),
      фонУзла:в("--surf","#141414"),
      фон:    в("--bg","#0d0d0f"),
      сияние: в("--glow","rgba(255,255,255,.30)"),
      кольцо: в("--mut","#8a8a8a"),
      при:    [в("--pri1","#5fb98e"), в("--pri2","#e8a14b"), в("--pri3","#e0625a")],
      /* Метка статуса — тем же тоном, что подпись: она уточняет, а не кричит. «Ждёт» получает
         холодный синий НАМЕРЕННО вне шкалы приоритета, иначе читался бы как ещё один её уровень. */
      метка:  в("--st-mark","#86868c"),
      ждёт:   в("--st-wait","#7f9fbf"),
      /* «На очереди» — САМЫЙ КОНТРАСТНЫЙ из статусных цветов, почти цвет текста. Своего оттенка
         ему не даём намеренно: зелёный→красный занят приоритетом, холодный→горячий временем,
         жёлто-красный жаром, синий ожиданием — пятая цветовая шкала на ноде читаться уже не
         будет. Ему нужна не семантика цвета, а ЗАМЕТНОСТЬ: это то, за что человек сядет следующим. */
      очередь:в("--st-next","#dcdce2"),
      // «на проверке» — лавандовый: единственный тон, не занятый ни приоритетом (зелёный→красный),
      // ни временем (голубой→красный), ни жаром (жёлтый→красный), ни ожиданием (синий)
      проверка:в("--st-review","#a98fd0"),
      /* Шкала ВРЕМЕНИ отдельная от шкалы приоритета: две одинаковые зелёный→красный на одной ноде
         сделали бы нечитаемыми обе. Эта начинается холодным — там, где приоритета нет вовсе. */
      время:  {далеко:в("--tm-far","#5f7f9e"), неделя:в("--tm-week","#7b8794"), скоро:в("--tm-soon","#9a9a92"),
               завтра:в("--tm-near","#d8b04a"), сегодня:в("--tm-today","#e0873c"), просрочка:в("--tm-over","#e0625a")},
      // жар срочности: не зелёный вовсе — «горит или нет», спокойного состояния у него нет
      жар:    [в("--ur1","#b9a06a"), в("--ur2","#d98b46"), в("--ur3","#e0625a")],
      // поток работы (_drawMain): русло к работе — акцентом, штрихи течения — светлее него
      акцент: в("--accent","#e8a14b"), акцентСвет:в("--flow-hi","#ffd9a0"), жарСвет:в("--flow-hot","#ffb0a8"),
      // штриховка «ждёт» (материал «иней»): холодная светлая на тёмной теме, тёмно-синяя на светлой
      инейШтрих:в("--frost","rgba(188,212,240,.55)"),
    };
    return this._пал;
  }
  /* Разбор цвета и смешивание — на холсте нет ни color-mix, ни CSS-переменных внутри заливки,
     а «в работе» и «на паузе» это именно смеси (15% цвета ноды с фоном карточки). Считаем сами
     и запоминаем: цветов в графе десятки, а узлов тысячи. */
  _rgb(c){
    const кэш=this._кэшЦвета||(this._кэшЦвета=new Map());
    if(кэш.has(c)) return кэш.get(c);
    let r=[230,230,230]; const s=String(c||"").trim();
    if(s[0]==="#"){ let h=s.slice(1); if(h.length===3) h=h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
      const n=parseInt(h,16); if(!isNaN(n)) r=[(n>>16)&255,(n>>8)&255,n&255]; }
    else { const m=s.match(/(\d+)[,\s]+(\d+)[,\s]+(\d+)/); if(m) r=[+m[1],+m[2],+m[3]]; }
    кэш.set(c,r); return r;
  }
  _mix(a,b,доля){
    const A=this._rgb(a), B=this._rgb(b), k=доля;
    return "rgb("+Math.round(A[0]*k+B[0]*(1-k))+","+Math.round(A[1]*k+B[1]*(1-k))+","+Math.round(A[2]*k+B[2]*(1-k))+")";
  }
  // контур фигуры узла на холсте: круг, квадрат, ромб (тот же квадрат под 45°) и шестиугольник
  _shapePath(ctx, форма, x, y, r, уг){
    /* ПОВОРОТ — у ноды «в работе» (уг, радианы; см. МАТЕРИАЛ СТАТУСА). Вершины вращаются в самом
       пути, а не трансформом холста: группы нод собираются в один путь на много фигур. */
    if(уг && форма!=="circle"){
      const c=Math.cos(уг), s=Math.sin(уг), D=r*1.41;
      const в = форма==="square" ? [[-r,-r],[r,-r],[r,r],[-r,r]]
              : форма==="diamond" ? [[0,-D],[D,0],[0,D],[-D,0]]
              : форма==="hexagon" ? [0,1,2,3,4,5].map(i=>{ const a=Math.PI/180*(60*i-30); return [r*Math.cos(a), r*Math.sin(a)]; })
              : null;
      if(в){ в.forEach(([dx,dy],i)=>{ const px=x+dx*c-dy*s, py=y+dx*s+dy*c; if(i) ctx.lineTo(px,py); else ctx.moveTo(px,py); });
        ctx.closePath(); return; }
    }
    if(форма==="square"){ ctx.rect(x-r,y-r,r*2,r*2); return; }
    if(форма==="diamond"){ ctx.moveTo(x,y-r*1.41); ctx.lineTo(x+r*1.41,y); ctx.lineTo(x,y+r*1.41); ctx.lineTo(x-r*1.41,y); ctx.closePath(); return; }
    if(форма==="hexagon"){
      for(let i=0;i<6;i++){ const a=Math.PI/180*(60*i-30), px=x+r*Math.cos(a), py=y+r*Math.sin(a);
        if(i) ctx.lineTo(px,py); else ctx.moveTo(px,py); }
      ctx.closePath(); return;
    }
    ctx.moveTo(x+r,y); ctx.arc(x,y,r,0,6.283);
  }
  /* «УГОЛ» ФИГУРЫ — точка на её краю по диагонали (sx, sy = ±1), куда крепятся плашки срока и
     очереди и булавка (стиль A, шаг 3.4). У квадрата это сам угол, у круга — точка под 45°, у
     ромба и шестиугольника — середина диагональной грани. Плашка, приколотая к краю ФОРМЫ, читается
     как часть ноды; прежние метки на круге вокруг квадрата висели в воздухе отдельно от неё. */
  _cornerAt(форма, x, y, r, sx, sy){
    if(форма==="square") return [x+sx*r, y+sy*r];
    if(форма==="hexagon") return [x+sx*r*0.433, y+sy*r*0.75];
    const k=форма==="diamond" ? r*0.705 : r*0.707;
    return [x+sx*k, y+sy*k];
  }
  /* ПУТЬ «ПЛАШКИ» — полностью скруглённый прямоугольник, общий для всех залитых бейджей с
     текстом (просрочка, номер очереди у горящих). Радиус скругления — половина высоты, поэтому
     плашка на одну-две цифры выглядит капсулой, а не прямоугольником со скруглёнными углами. */
  _pillPath(ctx, bx, by, ww, hh){
    const rr=hh/2;
    ctx.beginPath();
    ctx.moveTo(bx-ww/2+rr, by-hh/2); ctx.lineTo(bx+ww/2-rr, by-hh/2);
    ctx.quadraticCurveTo(bx+ww/2, by-hh/2, bx+ww/2, by-hh/2+rr);
    ctx.lineTo(bx+ww/2, by+hh/2-rr); ctx.quadraticCurveTo(bx+ww/2, by+hh/2, bx+ww/2-rr, by+hh/2);
    ctx.lineTo(bx-ww/2+rr, by+hh/2); ctx.quadraticCurveTo(bx-ww/2, by+hh/2, bx-ww/2, by+hh/2-rr);
    ctx.lineTo(bx-ww/2, by-hh/2+rr); ctx.quadraticCurveTo(bx-ww/2, by-hh/2, bx-ww/2+rr, by-hh/2);
    ctx.closePath();
  }
  /* ОТРИСОВКА ГРАФА НА ХОЛСТЕ — замена SVG-элементам (режим «canvas»).
     Этап первый: связи с их прогибами и узлы кругами, с отсечением по кадру. Формы по тегам,
     подписи, приоритет, галочки и значки появятся следующими шагами — сейчас важно сравнить
     цену кадра с тем же деревом на SVG. Порядок слоёв прежний: фон → свечение → граф. */
  /* ЗУМ И ПАН — ГОТОВОЙ КАРТИНКОЙ, А НЕ ПЕРЕРИСОВКОЙ. Пока крутят колесо или тащат холст,
     мировая геометрия не меняется — меняется только камера. Значит граф можно нарисовать ОДИН
     раз в отдельный холст и дальше выводить его со сдвигом и масштабом: один drawImage вместо
     двух тысяч операций.
     Замер на живом графе (946 узлов, холст 1426×1290): честный кадр 0.641 мс, кадр картинкой
     0.001 мс. Для сравнения — спрайт на КАЖДУЮ ноду (то, с чего обычно начинают) даёт 0.593 мс
     против 0.100 мс у нынешних путей пакетами: вшестеро ХУЖЕ, потому что дорог сам вызов
     отрисовки, а пути и так собраны в 24 пакета. Выигрыш даёт только сокращение ЧИСЛА вызовов.
     Снимок берём с запасом в четверть экрана с каждой стороны, иначе при пане у краёв
     открывалась бы пустота. Пересниматься приходится, когда картинку растянули больше чем на
     четверть (иначе мылит), увели за край запаса, или сменилось то, что на ней нарисовано
     (курсор на ноде, выделение). Каждый пересъём — один честный кадр, то есть те же 0.641 мс. */
  _drawCanvas(){
    const s=S.settings||{};
    const годенРежим = (s.graphFastZoom!==false) && this.nodes.length>350;
    const жест = (this._zoomTo!=null) || !!this.panning;
    if(!годенРежим || !жест || this.alpha>0 || this.drag || this.marq || this.linkFrom){
      this._сн=null; this._drawMain(); return;
    }
    if(!this._canvasSnapValid()) this._takeCanvasSnap();
    const с=this._сн; if(!с){ this._drawMain(); return; }
    const cv=this.mainCanvas, ctx=this.mainCtx; if(!cv||!ctx) return;
    const dpr=Math.min(window.devicePixelRatio||1,2), k=this.zoom/с.zoom;
    if(cv.width!==Math.round(this.W*dpr)||cv.height!==Math.round(this.H*dpr)){
      cv.width=Math.round(this.W*dpr); cv.height=Math.round(this.H*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,this.W,this.H);
    ctx.drawImage(с.cv, this.tx-с.tx*k, this.ty-с.ty*k, с.W*k, с.H*k);
  }
  _canvasSnapValid(){
    const с=this._сн; if(!с || !с.cv.width) return false;
    if(с.hov!==this._hovId || с.выд!==(this.selNodes?this.selNodes.size:0)) return false;
    if(с.экрW!==this.W || с.экрH!==this.H) return false;         // окно поменяло размер
    const k=this.zoom/с.zoom;
    if(k<0.8 || k>1.25) return false;                            // растянули слишком — будет мыло
    const x=this.tx-с.tx*k, y=this.ty-с.ty*k;                    // куда легла картинка на экране
    return x<=0 && y<=0 && x+с.W*k>=this.W && y+с.H*k>=this.H;   // экран целиком внутри снимка
  }
  /* Честный кадр, но в СВОЙ холст и на увеличенный вьюпорт. Проще всего это сделать, временно
     подменив графу цель отрисовки и камеру: _drawMain и так берёт размеры из this.W/this.H и сам
     подгоняет размер холста — отдельной копии его кода заводить не надо. */
  _takeCanvasSnap(){
    const З=0.25;                                                 // запас за краем экрана
    if(!this.mainCanvas || !this.W || !this.H){ this._сн=null; return; }
    if(!this._снCv) this._снCv=document.createElement("canvas");
    const прW=this.W, прH=this.H, прTx=this.tx, прTy=this.ty, прCv=this.mainCanvas, прCtx=this.mainCtx;
    const w=Math.round(прW*(1+2*З)), h=Math.round(прH*(1+2*З));
    let ctx=null;
    try{ ctx=this._снCv.getContext("2d"); }catch(e){}
    if(!ctx){ this._сн=null; return; }
    this.mainCanvas=this._снCv; this.mainCtx=ctx;
    this.W=w; this.H=h; this.tx=прTx+прW*З; this.ty=прTy+прH*З;
    let сорвалось=false;
    try{ this._drawMain(); }
    catch(e){ сорвалось=true; }
    finally{
      const снимок={cv:this._снCv, zoom:this.zoom, tx:this.tx, ty:this.ty, W:w, H:h,
                    экрW:прW, экрH:прH, hov:this._hovId,
                    выд:this.selNodes?this.selNodes.size:0};
      this.mainCanvas=прCv; this.mainCtx=прCtx;
      this.W=прW; this.H=прH; this.tx=прTx; this.ty=прTy;
      this._сн=сорвалось?null:снимок;
    }
  }
  _drawMain(){
    const cv=this.mainCanvas, ctx=this.mainCtx; if(!cv||!ctx) return;
    const cw=this.W, ch=this.H; if(!cw||!ch) return;                 // размеры берём у графа: см. _drawGlow
    const dpr=Math.min(window.devicePixelRatio||1,2);
    if(cv.width!==Math.round(cw*dpr)||cv.height!==Math.round(ch*dpr)){ cv.width=Math.round(cw*dpr); cv.height=Math.round(ch*dpr); }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cw,ch);
    const пал=this._palette(), z=this.zoom, tx=this.tx, ty=this.ty;
    const зап=60;                                                     // запас за краем: линия видна раньше своего узла
    const вид={x1:-зап, y1:-зап, x2:cw+зап, y2:ch+зап};
    const эx=n=>(n.x+(n._ix||0))*z+tx, эy=n=>(n.y+(n._iy||0))*z+ty;
    /* ТОЛЩИНА ЛИНИЙ РАСТЁТ С ЗУМОМ. В SVG она задана в мировых единицах и масштабируется вместе
       с графом: приблизился — контуры плотнее. На холсте я сперва задал её в экранных пикселях,
       и на рабочем зуме узлы со связями вышли заметно бледнее и тоньше, чем были в SVG.
       Снизу ограничиваем, иначе на общем виде дерева линии пропали бы совсем. */
    const толщ=(w)=>Math.max(0.75, w*z);
    /* ПОДСВЕТКА ИДЁТ ОТ ВЫДЕЛЕНИЯ, А НЕ ОТ НАВЕДЕНИЯ. На SVG гасило наведение, и при движении
       мыши по плотному графу экран мигал: курсор задевает узлы по пути, полграфа гаснет и
       загорается по нескольку раз в секунду. Теперь «показать связанное» — осознанное действие:
       кликнул по узлам (можно нескольким, shift-кликом) и видишь их окружение. Наведение
       оставляет только курсор-руку.
       Соседи считаются для ВСЕХ выделенных сразу, а не для одного. */
    const поиск=(this._searchMatches&&this._searchMatches.length)?new Set(this._searchMatches.map(n=>n.id)):null;
    let активные=null;
    /* РЕЖИМ «ПОКАЗАТЬ ГОРЯЩЕЕ» — третий источник того же гашения, что у поиска и выделения.
       Своего слоя он не заводит намеренно: механизм уже написан ниже (заметен + множитель тень),
       он плавный и проверенный, а второй такой же спорил бы с ним за прозрачность узлов.
       Стоит выше выделения: включив режим, человек хочет видеть горящее, а не то, что выделил. */
    if(поиск) активные=поиск;
    else if(this._показатьЖар && this._горящие && this._горящие.length) активные=new Set(this._горящие.map(у=>у.id));
    else if(this.selNodes && this.selNodes.size){
      активные=new Set();
      this.selNodes.forEach(id=>{ активные.add(id);
        const рядом=this.adj[id]; if(рядом) рядом.forEach(с=>активные.add(с)); });
    }
    /* ПЛАВНОСТЬ. Гашение не щёлкает, а перетекает: у каждого узла и связи своя доля видимости,
       которая идёт к цели по 16% за кадр (~250 мс). Резкая смена на большом графе читается как
       вспышка — та же причина, по которой прогибы связей сделаны инерционными (см. _easeBends). */
    /* Насколько глушим непричастное к выделению. Путь этого числа: в SVG было 0.14 — «остальной
       граф выключили», терялся контекст; подняли до 0.35 — всё равно казалось, что фон гаснет
       заметно. КРОЛИК попросил сделать затухание совсем минимальным: выделенное едва заметно
       ярче окружения, а не «прожектор в темноте». Формула ниже (тень=1-(1-ГАСН)*доля) на 0.85
       оставляет непричастному 85% яркости — разница читается, но общий вид дерева не проваливается. */
    const ГАСН=0.85;
    {
      const цель=активные?1:0;
      const был=(this._прГаш==null)?цель:this._прГаш;
      const стал=был+(цель-был)*0.16;
      this._прГаш=(Math.abs(цель-стал)<0.004)?цель:стал;
    }
    const тень=1-(1-ГАСН)*this._прГаш;      // во сколько раз приглушено всё непричастное
    const заметен=(id)=>!активные||активные.has(id);
    /* ФОН «ТОПОГРАФИЯ РАБОТЫ» — изолинии под графом (см. _topoBuild). Пути готовы в мировых
       координатах: в кадре только смена трансформа и восемь stroke. Пересчёт — при пересборке
       и раз в полсекунды, пока раскладка движется (ноды едут — рельеф едет за ними). */
    /* ФОН «СЕТКА» — ЛИНИИ С ИЕРАРХИЕЙ, как бесконечная сетка 3D-редакторов. Точками в узлах она
       при приближении расползалась в редкие крапины и сеткой не читалась (КРОЛИК, 03.11.2026).
       Уровни идут через ×5 от шага 20 мира; яркость уровня зависит ТОЛЬКО от его экранного шага
       (гаснет к 8 px, полная с 36), поэтому смена зума плавная, без скачков. Линия старшего уровня
       лежит поверх младшей — крупные клетки ярче сами собой. Пиксельная привязка (+0.5) держит
       линию в один пиксель на любом зуме. Стоит четыре stroke на кадр. */
    if(this._bgKind()==="grid"){
      // тише точек: сетка — подложка, а не рисунок, и не должна тянуть на себя взгляд (КРОЛИК)
      const светлая=document.body.classList.contains("light"), A=светлая?0.04:0.028;
      const wx0=-tx/z, wx1=(cw-tx)/z, wy0=-ty/z, wy1=(ch-ty)/z;
      let шаг=20*Math.pow(5, Math.ceil(Math.log(8/(20*z))/Math.log(5)));
      ctx.save(); ctx.lineWidth=1; ctx.strokeStyle=светлая?"#000":"#fff";
      for(let ур=0; ур<4 && шаг*z<Math.max(cw,ch)*2; ур++, шаг*=5){
        const T=шаг*z, сила=Math.min(1, Math.max(0, (T-8)/28));
        if(сила>0){
          ctx.globalAlpha=A*сила*(3-2*сила); ctx.beginPath();
          for(let x=Math.ceil(wx0/шаг)*шаг; x<=wx1; x+=шаг){ const sx=Math.round(x*z+tx)+0.5; ctx.moveTo(sx,0); ctx.lineTo(sx,ch); }
          for(let y=Math.ceil(wy0/шаг)*шаг; y<=wy1; y+=шаг){ const sy=Math.round(y*z+ty)+0.5; ctx.moveTo(0,sy); ctx.lineTo(cw,sy); }
          ctx.stroke();
        }
      }
      ctx.restore(); ctx.globalAlpha=1;
    }
    if(this._bgKind()==="topo"){
      const сейчас=performance.now();
      if(!this._topo || this._topo.src!==this.links || (this.alpha>0 && сейчас-this._topo.at>500)) this._topoBuild();
      const т=this._topo;
      if(т && т.пути.length){
        ctx.save(); ctx.setTransform(dpr*z,0,0,dpr*z, dpr*tx, dpr*ty);
        /* На отдалении изолинии сбиваются в мелкий узор и тают — ярче и чуть толще к общему виду
           (КРОЛИК: «слишком тусклая при отдалении»); на рабочем зуме и ближе — как было. */
        const отд=Math.min(2.4, Math.max(1, 1/Math.sqrt(z)));
        ctx.lineWidth=Math.min(1.5, отд)/z; ctx.strokeStyle=пал.акцент; ctx.lineJoin="round";
        т.пути.forEach((п,i)=>{ ctx.globalAlpha=Math.min(0.5, (0.045+i*0.018)*отд); ctx.stroke(п); });
        ctx.restore(); ctx.globalAlpha=1;
      }
    }
    /* СВЯЗИ ОДНИМ ПУТЁМ. Каждая линия отдельным stroke() — это отдельный вызов отрисовки, а
       именно на их числе canvas и упирается (тот же урок, что и с фоном: 0.7 мкс на вызов).
       Поэтому копим все линии одного вида в один путь и обводим разом: тусклые отдельно от
       обычных, потому что у них своя прозрачность.
       ЦВЕТ СВЯЗИ — от её концов, как в SVG: настоящий градиент от цвета одной ноды к цвету
       другой. Он стоит отдельного stroke на связь (пакетом градиенты не собрать), и это плата
       осознанная — КРОЛИК просил именно градиент. Экономим на другом: одноцветные связи всё же
       идут пакетом, а разноцветные рисуются только в кадре.
       Потухшая ветка цвета не получает вовсе: она нарочно нейтральная и тусклая. */
    const яркость=(S.settings.graphLinkBright!=null?S.settings.graphLinkBright:1);
    const тускло=(S.settings.graphFadedBright!=null?S.settings.graphFadedBright:0.5);
    const цветКонца=(n)=>n.archived ? пал.тусклая : (n.color || пал.связь);
    const цветные=new Set();
    // связи, которые рисует проход потока (l._пот, см. _flowStats): обычные проходы их пропускают
    const мимоПотока=(l)=>!!l._пот && S.settings.graphFlow!==false;
    // связь «своя», когда ОБА её конца в подсветке: так подсвечивается окружение выделенного,
    // а не лучи, уходящие в погашенную часть графа (то же правило, что у поиска в SVG)
    const свояСвязь=(l)=>!активные || (активные.has(l.a) && активные.has(l.b));
    const одноцветные=[new Map(), new Map()];   // [погашенные, свои] — цвет → список путей
    const радуга=[[],[]];                       // разноцветные: каждой свой градиент
    for(let i=0;i<this.links.length;i++){
      const l=this.links[i]; if(l.faded) continue;                    // потухшие рисует общий проход ниже
      if(мимоПотока(l)) continue;
      if(l.manual) continue;                                          // ручные — своим проходом, они толще и светятся
      if(l.hubLink) continue;                                         // луч «область → пустышка» — тоже своим, ещё толще
      const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
      const ca=цветКонца(a), cb=цветКонца(b);
      if(ca===пал.связь && cb===пал.связь) continue;                  // оба конца без цвета — общий проход
      const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b);
      if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
      цветные.add(i);                                                 // общий проход эту связь пропустит
      const bd=l._bendC, отр=[ax,ay,bx,by, bd?bd.t:0, bd?bd.ox:0, bd?bd.oy:0];
      const к=свояСвязь(l)?1:0;
      if(ca===cb){ let с=одноцветные[к].get(ca); if(!с){ с=[]; одноцветные[к].set(ca,с); } с.push(отр); }
      else радуга[к].push({отр, ca, cb});
    }
    // путь связи на холсте: прямая или дуга вокруг помехи — та же геометрия, что в _linkPath
    const путьСвязи=(о)=>{
      ctx.moveTo(о[0],о[1]);
      if(о[4]){ const px=о[0]+(о[2]-о[0])*о[4], py=о[1]+(о[3]-о[1])*о[4];
        ctx.quadraticCurveTo(px+о[5]*2*z, py+о[6]*2*z, о[2], о[3]); }
      else ctx.lineTo(о[2],о[3]);
    };
    // сперва погашенные, следом причастные — чтобы подсвеченное лежало поверх, а не под
    for(let к=0;к<2;к++){
      if(!одноцветные[к].size && !радуга[к].length) continue;
      // толщина и прозрачность — ровно те же, что в SVG (сверено на живом графе): обычная линия
      // 1.3 при 0.8 прозрачности, ручная 1.8 при полной. Свои значения тут только развели бы
      // картинку с прежней
      /* СТИЛЬ A (эталон demo_холст.html): цвет связи — подсказка о ветке, а не главный рисунок.
         Плотные цветные линии 0.8 спорили с нодами и путём выбранной; в макете цвет ноды идёт
         на 0.3–0.45. Ползунок «яркость связей» по-прежнему множит. */
      ctx.lineWidth=толщ(1.2); ctx.lineCap="round";
      ctx.globalAlpha=Math.min(1,0.45*яркость)*(к?1:тень);
      одноцветные[к].forEach((пути,цвет)=>{
        ctx.strokeStyle=цвет; ctx.beginPath();
        for(const о of пути) путьСвязи(о);
        ctx.stroke();
      });
      /* Градиент — по одному на связь: объект градиента привязан к координатам, а они меняются
         каждый кадр, поэтому ни собрать в пакет, ни закэшировать его нельзя. Плата за красоту
         честная и измеренная — см. замер в РЕШЕНИЯ.md. */
      for(const с of радуга[к]){
        const о=с.отр, гр=ctx.createLinearGradient(о[0],о[1],о[2],о[3]);
        гр.addColorStop(0,с.ca); гр.addColorStop(1,с.cb);
        ctx.strokeStyle=гр; ctx.beginPath(); путьСвязи(о); ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
    /* Бесцветные связи — четырьмя пакетами: обычные и потухшие, каждые в двух состояниях
       (причастные к выделению и погашенные). Больше проходов не нужно: всё остальное различие
       уже учтено прозрачностью.
       БАГ, КОТОРЫЙ ТУТ БЫЛ: ширину пакета выбирали по свояСвязь(l), а она возвращает true для
       ЛЮБОЙ связи, когда выделения нет вовсе (см. её определение выше — !активные). В итоге весь
       граф в состоянии покоя рисовался «толстым» пакетом (ш:2), а тонкий (ш:1.5) не включался
       никогда — и добавка для луча «область → пустышка» терялась на фоне остальных. Утолщение
       обязано появляться ТОЛЬКО когда есть настоящее выделение или поиск и связь в него входит,
       поэтому здесь отдельная проверка на активные, а не просто свояСвязь. */
    const подсвеченаВыделением=(l)=>!!активные && свояСвязь(l);
    for(const круг of [{потух:false, цвет:пал.связь, оп:Math.min(1,0.6*яркость), ш:1.2, своя:false},
                       {потух:true,  цвет:пал.тусклая, оп:тускло, ш:0.9, своя:false},
                       {потух:false, цвет:пал.связь, оп:Math.min(1,0.8*яркость), ш:1.8, своя:true},
                       {потух:true,  цвет:пал.тусклая, оп:тускло, ш:0.9, своя:true}]){
      ctx.beginPath();
      let есть=false;
      for(let i=0;i<this.links.length;i++){
        const l=this.links[i];
        if(!!l.faded!==круг.потух) continue;
        if(l.manual && !l.faded) continue;                            // ручные рисует отдельный проход ниже
        if(l.hubLink && !l.faded) continue;                           // «область → пустышка» тоже отдельным проходом
        if(подсвеченаВыделением(l)!==круг.своя) continue;
        if(цветные.has(i)) continue;                                  // уже нарисована цветным проходом
        if(мимоПотока(l)) continue;
        const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
        const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b);
        if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
        ctx.moveTo(ax,ay);
        const bd=l._bendC;                                            // прогиб вокруг помехи — та же геометрия, что в _linkPath
        if(bd){ const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t;
          ctx.quadraticCurveTo(px+bd.ox*2*z, py+bd.oy*2*z, bx, by); }
        else ctx.lineTo(bx,by);
        есть=true;
      }
      // непричастные к выделению уходят на задний план — плавно, за несколько кадров
      if(есть){ ctx.globalAlpha=круг.оп*(круг.своя?1:тень); ctx.strokeStyle=круг.цвет; ctx.lineWidth=толщ(круг.ш); ctx.lineCap="round"; ctx.stroke(); }
    }
    ctx.globalAlpha=1;
    /* ЛУЧ «ОБЛАСТЬ → ПУСТЫШКА» — жирнее рядового луча. КРОЛИК попросил различать по толщине
       именно эту связь: она держит на себе целую ветку узлов, а не одну ноду, и должна читаться
       как магистраль, а не как ещё один тонкий отросток. Связи узел↔хаб и узел↔пустышка толщину
       не меняют — только сама связка хаба с его развилкой.
       СВОЙ, БОЛЕЕ ВЫСОКИЙ ПОЛ ТОЛЩИНЫ. Общий толщ() снизу ограничен 0.75 px — при сильном
       отдалении ЛЮБАЯ линия толще этого не бывает, и рядовая (1.5) с магистралью (2.6) обе
       упираются в один и тот же пол одновременно: разница пропадает целиком (КРОЛИК:
       «при отдалении жирность не заметна» — так и есть, ниже z≈0.29 обе стороны на полу).
       Магистраль держит СВОЙ пол повыше рядового — тогда на любом зуме она хотя бы на треть
       толще, а не сравнивается с обычной линией в ноль. */
    {
      ctx.lineWidth=Math.max(1.2, 2.6*z); ctx.lineCap="round";
      for(let i=0;i<this.links.length;i++){
        const l=this.links[i]; if(!l.hubLink || l.faded || мимоПотока(l)) continue;
        const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
        const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b);
        if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
        const цвет=цветКонца(a)!==пал.связь?цветКонца(a):цветКонца(b);
        ctx.globalAlpha=Math.min(1,0.6*яркость)*(свояСвязь(l)?1:тень);
        ctx.strokeStyle=цвет;
        const bd=l._bendC;
        ctx.beginPath(); ctx.moveTo(ax,ay);
        if(bd){ const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t; ctx.quadraticCurveTo(px+bd.ox*2*z, py+bd.oy*2*z, bx, by); }
        else ctx.lineTo(bx,by);
        ctx.stroke();
      }
      ctx.globalAlpha=1;
    }
    /* РУЧНЫЕ СВЯЗИ — те, что человек протянул сам. В SVG они толще (1.8 против 1.3), в полную
       яркость и со свечением (.g-link.manual с drop-shadow): своя связь должна быть видна среди
       автоматических. Рисуем их поштучно — свечение пакетом не собрать, — но их всегда немного. */
    {
      let ручных=0;
      for(let i=0;i<this.links.length;i++){
        const l=this.links[i]; if(!l.manual || l.faded || мимоПотока(l)) continue;
        const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
        const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b);
        if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
        if(!ручных){ ctx.save(); ctx.lineWidth=толщ(1.8); ctx.lineCap="round"; }
        ручных++;
        const ca=цветКонца(a), cb=цветКонца(b);
        if(ca===cb) ctx.strokeStyle=ca;
        else { const гр=ctx.createLinearGradient(ax,ay,bx,by); гр.addColorStop(0,ca); гр.addColorStop(1,cb); ctx.strokeStyle=гр; }
        ctx.globalAlpha=Math.min(1,0.75*яркость)*(свояСвязь(l)?1:тень);
        // свечение снимаем, когда ручных связей в кадре много: размытие считается на каждую линию
        ctx.shadowColor=пал.сияние; ctx.shadowBlur=(ручных<=150)?4:0;
        const bd=l._bendC;
        ctx.beginPath(); ctx.moveTo(ax,ay);
        if(bd){ const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t;
          ctx.quadraticCurveTo(px+bd.ox*2*z, py+bd.oy*2*z, bx, by); }
        else ctx.lineTo(bx,by);
        ctx.stroke();
      }
      if(ручных) ctx.restore();
      ctx.globalAlpha=1;
    }
    /* СВЯЗИ УЗЛА ПОД КУРСОРОМ — поверх остальных, плотнее и со свечением своего цвета. Свечение
       тут по карману: связей у одного узла единицы, а не тысяча, — то же правило, по которому
       светятся выделенные узлы. Так наведение показывает не только соседей, но и чем именно
       узел с ними связан.
       ПРОВЕРЯЕМ ПРИНАДЛЕЖНОСТЬ К РОДНЕ, А НЕ ПРЯМОЕ КАСАНИЕ hovId. Для обычного узла это одно
       и то же (его связи и есть его adj), но у ХАБА родня ШИРЕ — включает его пустышки И их
       узлы (см. _kin). Прежняя проверка «касается ли сам hovId» это не ловила: узел через
       пустышку подрастал и светился (родня), а связь ДО НЕГО (лист↔пустышка, не хаб↔что-то)
       оставалась тусклой — подсветка не совпадала с тем, что подросло (КРОЛИК прислал
       скриншот именно с этим разрывом). Правильно — обе стороны связи должны быть в одной
       «освещённой» сети: hovId сам плюс всё, что _kin для него вернула. */
    if(this._hovId){
      const родняКурсора=this._kin(this._hovId);
      const вСети=id=>id===this._hovId || (!!родняКурсора && родняКурсора.has(id));
      ctx.save(); ctx.lineWidth=толщ(2.4); ctx.lineCap="round"; ctx.globalAlpha=1;
      for(let i=0;i<this.links.length;i++){
        const l=this.links[i]; if(!вСети(l.a) || !вСети(l.b)) continue;
        const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
        const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b);
        if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
        const ca=цветКонца(a), cb=цветКонца(b);
        if(ca===cb) ctx.strokeStyle=ca;
        else { const гр=ctx.createLinearGradient(ax,ay,bx,by); гр.addColorStop(0,ca); гр.addColorStop(1,cb); ctx.strokeStyle=гр; }
        ctx.shadowColor=(ca===пал.связь?пал.узел:ca); ctx.shadowBlur=8;
        const bd=l._bendC;
        ctx.beginPath(); ctx.moveTo(ax,ay);
        if(bd){ const px=ax+(bx-ax)*bd.t, py=ay+(by-ay)*bd.t;
          ctx.quadraticCurveTo(px+bd.ox*2*z, py+bd.oy*2*z, bx, by); }
        else ctx.lineTo(bx,by);
        ctx.stroke();
      }
      ctx.restore();
    }
    /* ПОТОК РАБОТЫ ПО СВЯЗЯМ («Поток 2.0», см. _flowStats). Поверх обычных связей, под нодами.
       Какие связи его — решено в _flowStats (l._пот), обычные проходы их пропускают, поэтому
       каждая такая связь — ОДНА линия, без стирания и без подложек:
       • РУСЛО — сама связь, шире, чем больше незакрытой работы ниже по ветке (корень от √ доли,
         чтобы ствол не съедал экран); закрытая ветка русла не имеет — «пересохла». Полупрозрачная
         полоса поверх обычной линии читалась как ДВЕ линии (КРОЛИК, 03.11.2026);
       • цвет русла — цвета концов, как у обычной связи (градиент); только просрочка — красная;
       • ТЕЧЕНИЕ — к работе и к просрочке бегут зёрна от родителя к ребёнку: цвет русла, только
         светлее. Белые зёрна с тёмной подложкой выпрыгивали из линии (КРОЛИК, 03.11.2026);
       • ЖДЁТ — связь к ноде «ждёт» пунктиром цвета самой связи: работа по ней сейчас не идёт;
       • СПИТ — связи в ветку на паузе (ближайший явный статус — пауза) тонкие и тусклые.
       Обрыв связи у «ждёт» («плотина» из макета) снят: на живом графе он читался как сбой.
       Пакетами по цвету и ширине — на сотнях связей это десяток stroke, а не сотни.
       Выключается в меню «…» (S.settings.graphFlow), течение — отдельно (graphFlowAnim). */
    this._течёт=false;
    if(S.settings.graphFlow!==false){
      const пачки=new Map(), радугаП=[], течение=[], ждут=[], спят=[];
      const сейчас=performance.now(), анимация=S.settings.graphFlowAnim!==false;
      for(let i=0;i<this.links.length;i++){
        const l=this.links[i], п0=l._пот; if(!п0) continue;
        const a=this.byId[l.a], b=this.byId[l.b]; if(!a||!b) continue;
        const реб=п0.реб, род = реб===a ? b : a;
        const ax=эx(род), ay=эy(род), bx=эx(реб), by=эy(реб);
        if((ax<вид.x1&&bx<вид.x1)||(ax>вид.x2&&bx>вид.x2)||(ay<вид.y1&&by<вид.y1)||(ay>вид.y2&&by>вид.y2)) continue;
        /* ПУТЬ ИДЁТ ОТ РОДИТЕЛЯ К РЕБЁНКУ (так течёт пунктир), а прогиб связи задан от её начала
           l.a: доля t считается от a. Когда ребёнок — это a, путь развёрнут, и t нужно отразить
           (1-t), иначе контрольная точка дуги уезжала и рядом ложилась вторая линия со своим
           изгибом — «несколько связей друг на друге» (снимок КРОЛИКА, 03.11.2026). */
        const bd=l._bendC, отр=[ax,ay,bx,by, bd?(реб===a?1-bd.t:bd.t):0, bd?bd.ox:0, bd?bd.oy:0];
        const гас=свояСвязь(l)?1:тень;
        if(п0.вид==="спит"){ спят.push({отр, цвет:цветКонца(реб), гас}); continue; }
        if(п0.вид==="ждёт"){ ждут.push({отр, цвет:цветКонца(реб), гас}); continue; }
        const ст=п0.ст, ш=п0.ш;
        /* ЦВЕТ РУСЛА — ОТ КОНЦОВ, как у обычной связи: разноцветные ноды дают градиент. Единый
           акцент на всё, что ведёт к работе, перекрашивал ветки в оранжевый и стирал, чья это
           ветка (КРОЛИК, 03.11.2026). Своим цветом остаётся только просрочка — это тревога. */
        const ca = ст.over&&!ст.doing ? пал.время.просрочка : цветКонца(род);
        const cb = ст.over&&!ст.doing ? пал.время.просрочка : цветКонца(реб);
        const ярко=ст.doing||ст.over;
        if(ca===cb){
          const ключ=ca+"|"+ш+"|"+(ярко?1:0)+"|"+гас;
          let п=пачки.get(ключ); if(!п){ п={цвет:ca, ш, ярко, гас, отр:[]}; пачки.set(ключ, п); }
          п.отр.push(отр);
        } else радугаП.push({отр, ca, cb, ш, ярко, гас});
        if(анимация && ярко) течение.push({отр, ca, cb, ш, гас});
      }
      ctx.lineCap="round";
      /* «спит» — ТОНЬШЕ, а не темнее: тёмная линия той же толщины читалась как грязь (КРОЛИК);
         тонкая в своём цвете — как «ветка отложена». */
      if(спят.length){
        ctx.lineWidth=Math.max(0.6, 0.45*z);
        for(const с of спят){ ctx.globalAlpha=0.55*с.гас; ctx.strokeStyle=с.цвет; ctx.beginPath(); путьСвязи(с.отр); ctx.stroke(); }
        ctx.globalAlpha=1;
      }
      // «ждёт» — пунктир ЦВЕТОМ САМОЙ СВЯЗИ (КРОЛИК): чужой голубой выдёргивал связь из ветки
      if(ждут.length){
        const шл=толщ(1.4); ctx.setLineDash([Math.max(4, шл*2.6), Math.max(3, шл*2)]); ctx.lineCap="butt";
        ctx.lineWidth=шл;
        for(const ж of ждут){ ctx.globalAlpha=0.9*ж.гас; ctx.strokeStyle=ж.цвет; ctx.beginPath(); путьСвязи(ж.отр); ctx.stroke(); }
        ctx.setLineDash([]); ctx.globalAlpha=1; ctx.lineCap="round";
      }
      пачки.forEach(п=>{
        ctx.globalAlpha=(п.ярко?0.85:0.6)*п.гас; ctx.strokeStyle=п.цвет; ctx.lineWidth=толщ(п.ш); ctx.beginPath();
        for(const о of п.отр) путьСвязи(о);
        ctx.stroke();
      });
      // разноцветные — градиентом поштучно, как в общем проходе связей
      for(const р of радугаП){ const о=р.отр, гр=ctx.createLinearGradient(о[0],о[1],о[2],о[3]);
        гр.addColorStop(0,р.ca); гр.addColorStop(1,р.cb);
        ctx.globalAlpha=(р.ярко?0.85:0.6)*р.гас; ctx.strokeStyle=гр; ctx.lineWidth=толщ(р.ш); ctx.beginPath(); путьСвязи(о); ctx.stroke(); }
      ctx.globalAlpha=1;
      if(течение.length){
        this._течёт=true;
        // шаг штриха и скорость — от толщины и зума: в экранных пикселях при приближении штрихи
        // раздувались в «бусины», а течение на отдалении неслось быстрее самого графа
        const ск=Math.max(0.6, Math.min(2.5, z));
        const светлаяТема=document.body.classList.contains("light");
        const светлее=(ц)=>this._mix(ц, светлаяТема?"#000000":"#ffffff", светлаяТема?0.6:0.45);
        for(const т of течение){ const шт=Math.max(1.4, толщ(т.ш)*0.55);
          ctx.setLineDash([шт*1.4, шт*5]); ctx.lineDashOffset=-сейчас*0.04*ск;
          const о=т.отр; let цв=светлее(т.ca);
          if(т.ca!==т.cb){ цв=ctx.createLinearGradient(о[0],о[1],о[2],о[3]); цв.addColorStop(0,светлее(т.ca)); цв.addColorStop(1,светлее(т.cb)); }
          ctx.strokeStyle=цв; ctx.globalAlpha=т.гас; ctx.lineWidth=шт; ctx.beginPath(); путьСвязи(т.отр); ctx.stroke(); }
        ctx.setLineDash([]); ctx.lineDashOffset=0; ctx.globalAlpha=1;
      }
    }
    /* ПУТЬ К ВЫБРАННОЙ НОДЕ (стиль A, аудит 2.1, шаг 3.4): от неё вверх по дереву до области — её
       цветом, поверх остальных связей. На большом графе «где эта нода живёт» иначе приходилось
       выслеживать по линиям глазами. Дерево здесь — древесные связи build() ({a: нода, b: родитель
       или хаб}, не ручные), по одной на ноду; индекс строим раз на сборку, а не в каждом кадре.
       Свечение — широкой полупрозрачной линией под основной, без shadowBlur (см. ПЛАН-СПРАЙТЫ). */
    /* Родитель — из ДАННЫХ (ref.parent), а не из связей: пара «нода → родитель», протянутая
       руками или пакетом, лежит ручной связью, и древесной для неё build() не заводит (pairs).
       Корень ветки идёт к своей области — по древесной связи (она же знает про пустышку).
       Связь для рисования — любая между этой парой, ручная или древесная: от неё и прогиб. */
    const treeIndex=()=>{
      if(this._treeSrc===this.links) return;
      this._treeSrc=this.links; this._treeLinks=new Map(); this._pairLinks=new Map();
      for(let i=0;i<this.links.length;i++){ const l=this.links[i];
        if(!l.manual && !this._treeLinks.has(l.a)) this._treeLinks.set(l.a, l);
        this._pairLinks.set(l.a+"|"+l.b, l); this._pairLinks.set(l.b+"|"+l.a, l); }
    };
    const родитель=(id)=>{ const n=this.byId[id], p=n&&n.ref&&n.ref.parent;
      if(p && this.byId[p]) return p;
      const l=this._treeLinks.get(id); return (l && this.byId[l.b]) ? l.b : null; };
    if(this.selNodes && this.selNodes.size===1){
      treeIndex();
      const [начало]=this.selNodes, путь=[];
      let ид=начало;
      for(let шаг=0; шаг<16; шаг++){ const р=родитель(ид); if(!р) break; const l=this._pairLinks.get(ид+"|"+р); if(!l) break; путь.push(l); ид=р; }
      if(путь.length){
        /* ПУТЬ — ТЕМИ ЖЕ ЦВЕТАМИ, ЧТО У САМИХ СВЯЗЕЙ, ТОЛЬКО ТОЛЩЕ И ПЛОТНЕЕ. Чужой цвет (цвет
           выбранной ноды, янтарь, белый) перекрашивал связь области и читался как новый смысл —
           КРОЛИК трижды забраковал: «пусть становится жирнее и не меняет цвет». Цвет каждой
           связи — от её концов, как в общем проходе (одноцветная — цветом, разноцветная —
           градиентом). Связей в пути единицы, поштучный stroke тут по карману. */
        ctx.lineCap="round"; ctx.lineWidth=толщ(2.8); ctx.globalAlpha=1;
        for(const l of путь){
          const a=this.byId[l.a], b=this.byId[l.b], bd=l._bendC;
          const ax=эx(a), ay=эy(a), bx=эx(b), by=эy(b), ca=цветКонца(a), cb=цветКонца(b);
          if(ca===cb) ctx.strokeStyle=ca;
          else { const гр=ctx.createLinearGradient(ax,ay,bx,by); гр.addColorStop(0,ca); гр.addColorStop(1,cb); ctx.strokeStyle=гр; }
          ctx.beginPath(); путьСвязи([ax,ay,bx,by, bd?bd.t:0, bd?bd.ox:0, bd?bd.oy:0]); ctx.stroke();
        }
      }
    }
    /* УЗЛЫ. Вид повторяет правила styles.css — иначе переключение рендера меняло бы не скорость,
       а картинку. Группируем по ВИДУ (форма, заливка, обводка, толщина, пунктир, прозрачность):
       смена стиля рвёт пакет отрисовки, и тысяча узлов превратилась бы в тысячу вызовов.
       Мелочь (приоритет, сроки, галочки, булавки, значки, подписи) копим в списки
       и рисуем следом отдельными проходами — их всегда меньше, чем узлов. */
    const группы=new Map();
    // поворот нод «в работе» — по часам кадра; выключатель анимации общий с течением (меню «…»)
    const сейчасКадр=performance.now(), крутить=S.settings.graphFlowAnim!==false && !this._bgReduce;
    this._вращ=false;
    const приор=[], галочки=[], булавки=[], значки=[], подписи=[], выдел=[], навед=[];
    /* Новые признаки — своими списками и своими проходами: смена стиля внутри цикла узлов рвёт
       пакет отрисовки. Статусы «ждёт» и «на очереди» своего списка НЕ имеют — они рисуются
       глифом внутри ноды и едут общим проходом «значки», вместе со значками тегов. */
    const сроки=[], рангЖар=[], прогресс=[], материалы=[];
    /* ПРОГРЕСС ПОДЗАДАЧ (аудит 2.1, Р1): сколько детей-задач готово. Дети — по ДАННЫМ (ref.parent),
       как подсветка пути; «Готово» бывает и одним статусом без done (данные из пакета) — считаем,
       как таблица. Каждый кадр: на тысяче нод это сотые доли миллисекунды, зато статус, сменённый
       без пересборки, виден сразу. */
    // родители — у кого есть хоть какие-то дети: их подпись крупнее листьев (иерархия подписей)
    /* ПОТУХШИХ ДЕТЕЙ НЕ ВЫБРАСЫВАТЬ. Закрытая задача сама становится потухшей (archived), и
       прежний фильтр `!c.archived` выкидывал её из счёта: «0 из 3» после галки становилось
       «0 из 2», готовых всегда было ноль — и заливка прогресса не появлялась НИКОГДА (снимок
       КРОЛИКА, 03.11.2026). Потухший ребёнок — это и есть готовый ребёнок. */
    const подзВсего=new Map(), подзГотово=new Map(), родители=new Set();
    /* ПО ВСЕЙ ВЕТКЕ, А НЕ ПО ПРЯМЫМ ДЕТЯМ. Проект с двумя закрытыми подзадачами и нетронутой
       веткой «Разработка персонажа» (четыре задачи цепочкой) заливался почти доверху: прямых
       детей мало, и готовые среди них составляли большинство (снимок КРОЛИКА, 03.11.2026).
       Каждая задача засчитывается ВСЕМ своим предкам — заливка отвечает «сколько сделано
       в этой ветке целиком». Подъём ограничен глубиной: битый parent из чужих данных может
       замкнуться в кольцо. */
    for(let i=0;i<this.nodes.length;i++){
      const c=this.nodes[i], p=c.ref && c.ref.parent;
      if(p && this.byId[p]) родители.add(p);
      if(!p || !this.byId[p] || !kindIsTask(c.type)) continue;
      const готов=c.done || c.ref.status==="done";
      for(let пр=p, k=0; пр && this.byId[пр] && k<40; k++){
        подзВсего.set(пр, (подзВсего.get(пр)||0)+1);
        if(готов) подзГотово.set(пр, (подзГотово.get(пр)||0)+1);
        const у=this.byId[пр]; пр=у.ref && у.ref.parent;
      }
    }
    this._subTotal=подзВсего; this._subDone=подзГотово;   // для проверок (граф.js) — сам кадр их не читает
    /* УРОВНИ ДЕТАЛИЗАЦИИ. Мелкие узлы деталей не показывают: на общем виде дерева их всё равно
       не видно, а стоят они как крупные. Подписи — только когда узел различим глазом; в SVG они
       жили ВСЕГДА, и 651 текстовый элемент был одной из главных статей расхода. */
    const детали=(r)=>r>=4.5, подписьВидна=(r)=>r>=6.5 && z>=0.45;
    const соседиКурсора=this._hovId ? this._kin(this._hovId) : null;
    let навЕдет=false;                 // хоть у одной ноды подсветка не доехала до цели
    for(let i=0;i<this.nodes.length;i++){
      const n=this.nodes[i], x=эx(n), y=эy(n);
      /* УЗЕЛ ПОД КУРСОРОМ ПОДРАСТАЕТ — как .g-node:hover .nd{transform:scale(1.18)} в стилях, и
         вместе с ним отзывается ВСЯ его родня: соседи подрастают и светятся вполсилы. Так с
         одного взгляда видно, с чем узел связан, и для этого не нужно ничего нажимать.
         Рост плавный (четверть остатка за кадр, ~120 мс): мгновенный скачок читается как рывок,
         а курсор проходит по узлам часто. Гасить остальной граф наведение по-прежнему не смеет. */
      const целНав=(n.id===this._hovId) ? 1 : (соседиКурсора&&соседиКурсора.has(n.id) ? 0.55 : 0);
      const был=(n._нав==null)?целНав:n._нав, стал=был+(целНав-был)*0.25;
      n._нав=(Math.abs(целНав-стал)<0.01)?целНав:стал;
      /* Подсветка ещё едет — это ДВИЖУЩАЯСЯ картинка, и уходить в покой нельзя (см. _tick).
         Курсор ушёл с ноды → _hovId=null → условие покоя выполнялось В ТОТ ЖЕ КАДР, и остаток
         затухания доигрывался на шести кадрах в секунду: подсветка гасла рывками. Разгорание
         при этом было плавным (пока курсор на ноде, граф считается занятым) — отсюда и жалоба
         «нагревается нормально, остывает дёргано». */
      if(n._нав!==целНав) навЕдет=true;
      const r=n.r*z*(1+0.18*n._нав);
      if(x+r<вид.x1||x-r>вид.x2||y+r<вид.y1||y-r>вид.y2) continue;    // вне кадра — не рисуем вовсе
      const свой=n.color||пал.узел;
      const форма=this._shape(n);
      /* СТИЛЬ A (аудит 2.1, шаг 3.4): нода залита ТОНОМ своего цвета, а не фоном холста. Пустой
         контур на чёрном читался как дырка, и цвет ноды держала одна тонкая обводка. «В работе»
         при этом обязано остаться отличимым — у него тон вдвое плотнее (плюс своё свечение). */
      let зал=this._mix(свой, пал.фонУзла, 0.14), обв=свой, лw=1.7, пункт=false, альфа=1, уг=0;
      if(n.type==="hub"){ зал=свой; обв=свой; лw=1; }
      else if(n.done){ зал=свой; }                                    // выполненная задача — залита своим цветом
      if(n.doing) зал=this._mix(свой, пал.фонУзла, 0.30);           // «в работе»: тон заметно плотнее обычного
      /* «НА ПАУЗЕ» СОХРАНЯЕТ СВОЙ ЦВЕТ, но приглушённый. В SVG цвет уходил в серый целиком, и на
         цветном графе КРОЛИКА отложенные ветки переставали читаться как свои: «оставить им цвет,
         но приглушить, плюс пунктир и кольцо». Пунктир и серое кольцо (ниже) остаются признаком
         остановки — именно они отличают паузу от работы. */
      if(n.paused){ зал=this._mix(свой, пал.фонУзла, 0.16); обв=this._mix(свой, пал.кольцо, 0.55); лw=1.6; пункт=true; альфа=0.72; }
      /* МАТЕРИАЛ СТАТУСА (выбор КРОЛИКА из demo_ноды-и-фон.html, 03.11.2026). Статус — фактура
         самой формы, а не значок внутри: песочные часы, глаз и стрелка «выглядели слабо и визуально
         и концептуально». Не начато — КАРКАС (почти пустой контур); очередь — ЗАРЯЖЕНО (внутри
         лежит малая копия формы); в работе — форма ВРАЩАЕТСЯ, залитая тоном в 40% своего цвета;
         ждёт — ИНЕЙ (холодная штриховка); проверка — ПОЛОВИНА НА ПОЛОВИНУ (диагональ); пауза —
         ПЕПЕЛ (серая, пунктир) — только у самой ноды; готово — сплошная с галкой. Дети паузы свой
         вид не теряют: пепел по всей ветке читался как «у каждой ноды стоит пауза» (КРОЛИК,
         03.11.2026, «наследует от родителя — странновато»). Что ветка спит, говорят её связи (_спит).
         Фактуры, которым мало цвета группы (иней, диагональ, ядро), рисуются отдельным
         проходом после групп — таких нод в кадре единицы-десятки. */
      const спит=!n.archived && !n.done && n.paused;
      if(n.type!=="hub" && !n.hollow && !n.archived && !n.done){
        if(спит){ зал=this._mix(пал.кольцо, пал.фонУзла, 0.12); обв=this._mix(свой, пал.кольцо, 0.2); лw=1.4; пункт=true; альфа=0.5; }
        /* «В работе» — ФОРМА МЕДЛЕННО ВРАЩАЕТСЯ (вариант «Форма говорит» из demo_ноды-и-фон.html,
           КРОЛИК 03.11.2026): живое видно боковым зрением, а заливка — тон в 40% своего цвета, не
           сплошная. Сплошная с бликом была самым ярким пятном на графе и спорила с выделением.
           Круг вращать нечего — его держат тон и свечение. Значок тега не вращается: он читается. */
        else if(n.doing){ зал=this._mix(свой, пал.фонУзла, 0.4); обв=свой; лw=2;
          if(форма!=="circle" && крутить){ уг=(сейчасКадр%12000)/12000*Math.PI*2; this._вращ=true; } }
        // «ждёт» и «проверка» контур НЕ перекрашивают: статус несёт фактура внутри, а контур остаётся
        // цветом ноды — чужой голубой или сиреневый контур выдёргивал ноду из её ветки (КРОЛИК, 03.11.2026)
        else if(n.waiting){ зал=this._mix(свой, пал.фонУзла, 0.14); материалы.push({вид:"иней", x, y, r, форма}); }
        else if(n.review){ зал=this._mix(свой, пал.фонУзла, 0.14); материалы.push({вид:"весы", x, y, r, форма}); }
        else if(n.next){ зал=this._mix(свой, пал.фонУзла, 0.12); лw=1.8; материалы.push({вид:"заряд", x, y, r, форма, цвет:свой}); }
        else { зал=this._mix(свой, пал.фонУзла, 0.05); лw=1.5; }       // каркас
      }
      if(n.archived){ зал=n.done?пал.кольцо:пал.фонУзла; обв=пал.кольцо; лw=1.4; альфа=0.32; }
      /* ПУСТЫШКА — ЭТО ТА ЖЕ ОБЛАСТЬ, а не отдельная невзрачная нода: КРОЛИК прямо сказал, что
         пунктирный прозрачный контур терялся на графе и не читался как «часть области». Теперь
         залита цветом области ПОЧТИ как хаб (обв=свой, лw как у хаба) — с одного взгляда видно
         родство; тонкий пунктир вместо сплошной обводки и небольшая прозрачность остаются
         единственным отличием «это развилка, а не сам хаб». Значок области рисуется поверх
         ниже (см. «значки») — то же самое, что человек видит в её карточке и в панели слева. */
      if(n.hollow){ зал=this._mix(свой, пал.фонУзла, 0.62); обв=свой; лw=1.6; пункт=true; альфа=0.92; }
      if(!заметен(n.id)) альфа*=тень;                                 // непричастные к выделению или поиску
      else if(активные) лw=Math.max(лw,2.4);                          // окружение выделенного — контуром пожирнее
      /* ВЫДЕЛЕНИЕ — толстая обводка САМОЙ фигуры её цветом, как .g-node.sel .nd в стилях, а не
         кольцо вокруг: кольцо читалось как ещё один элемент, а не как «эта нода выбрана». */
      const выделен=this.selNodes&&this.selNodes.has(n.id);
      if(выделен){ обв=свой; лw=4.5; пункт=false; альфа=1; выдел.push({x, y, r, форма, уг, цвет:свой}); }
      // наведение светится своим цветом, но слабее выделения: подсказка «сюда можно нажать»
      else if(n._нав>0.02) навед.push({x, y, r, форма, уг, цвет:свой, сила:n._нав});
      const ключ=форма+"|"+зал+"|"+обв+"|"+лw+"|"+(пункт?1:0)+"|"+альфа.toFixed(2);
      let гр=группы.get(ключ);
      if(!гр){ гр={форма, зал, обв, лw, пункт, альфа, точки:[]}; группы.set(ключ,гр); }
      гр.точки.push(x,y,r,уг);
      /* ПРИОРИТЕТ СЧИТАЕМ ДО ПОРОГА ДЕТАЛЕЙ (правка по просьбе КРОЛИКА). Раньше дужка копилась
         ниже `if(!детали(r)) continue`, и на общем виде — там, где как раз и ищут «что важное» —
         она пропадала вместе с остальной мелочью. Это единственный признак, которому отдалять
         нельзя: он про важность, а не про подробности. Всё прочее (кольца, глифы, подписи)
         порогу по-прежнему подчиняется — иначе 245 нод дадут кашу. */
      if(n.type==="task" && n.ref && !n.ref.done && n.ref.priority && !n.done && !n.archived)
        приор.push({x, y, r, форма, уг, лw, альфа, ур:Math.min(+n.ref.priority,3)});
      /* ЖАР — ТОЖЕ ДО ПОРОГА ДЕТАЛЕЙ (правка по просьбе КРОЛИКА: «при сильном отдалении не видно
         номеров»). Тот же довод, что у приоритета: горящих не больше восьми (СРОЧНОСТЬ_ПРЕДЕЛ),
         и именно на общем виде — где всё остальное уже спрятал порог — нужно видеть, что вообще
         горит. Показываем ТОЛЬКО в режиме «что горит» (Ctrl+G). Сам жар — тёплым светом в слое
         свечения (_drawGlow); здесь только номер очереди плашкой. Второй контур вокруг ноды
         убран: вместе с кольцом прогресса и дужкой приоритета он давал три обводки на одной ноде. */
      if(n.жар && !n.archived && this._показатьЖар) рангЖар.push({x, y, r, форма, ранг:n.ранг, ур:n.жар, дней:n.дней, альфа});
      if(!детали(r)) continue;
      /* Ореола-кольца вокруг хаба и пустышки больше нет (стиль A, 03.11.2026): тонкий круг на
         зазоре от залитой ноды и был тем самым «кружком самим по себе», на который жаловался
         КРОЛИК. Область и так отличает заливка её цветом, размер и жирная подпись. */
      /* ЗАЛИВКА ПРОГРЕССА — снизу вверх внутри самой фигуры: нода «наполняется» по мере готовности
         детей. Прежнее кольцо вокруг ноды читалось как отдельный кружок поверх неё. */
      const вс=подзВсего.get(n.id);
      let верхЗаливки=null;                    // экранный y кромки заливки — значок ниже неё рисуется «вырезом»
      if(вс && n.type!=="hub" && !n.done && !n.archived && !n.hollow){
        const гот=подзГотово.get(n.id)||0;
        if(гот){ const rп=r-толщ(лw)*0.5, выс=форма==="diamond" ? rп*1.41 : rп;
          верхЗаливки=y+выс-2*выс*(гот/вс);
          прогресс.push({x, y, r:rп, форма, уг, альфа, доля:гот/вс, цвет:this._mix(свой, пал.фонУзла, n.doing?0.85:0.72)}); }
      }
      const доЗначка=значки.length;
      /* СТАТУС — ГЛИФОМ ВНУТРИ НОДЫ (правка по просьбе КРОЛИКА): песочные часы у «ждёт»,
         стрелка у «на очереди». Раньше это были кольцевые дуги и значок в углу — они читались
         как украшение: терялись среди других колец, а угловой значок ещё и отсекался порогом
         подписей, то есть на общем виде статуса не было видно вовсе. Глиф внутри виден сразу,
         говорит прямо, что это за состояние, и одинаково работает на любом размере ноды.
         Место внутри делит со значком тега, и уступает ТЕГ: тег — постоянная классификация,
         а статус — состояние прямо сейчас, ради которого на ноду и смотрят. Снимут статус —
         значок тега вернётся сам. Пустышке глиф не ставим: внутри у неё значок своей области. */
      /* Значков статуса больше нет — статус несёт МАТЕРИАЛ формы (см. выше). У «очереди», «ждёт» и
         «проверки» внутри своя фактура (ядро, иней, диагональ), и значок тега на ней спорил бы с
         ней: его там не рисуем. У «в работе» значок тёмный — на сплошной заливке своим цветом. */
      const статусГлиф = null;
      const безЗначка = !n.done && !n.archived && !спит && (n.next || n.waiting || n.review);
      // срок — плашкой на правом верхнем «углу» фигуры, булавка — значком на левом нижнем
      // у горящей ноды в «Что горит» срок уезжает в общую метку над ней (см. МЕТКА ЖАРА) — без дубля
      if(n.дней!=null && подписьВидна(r) && !(n.жар && !n.archived && this._показатьЖар)) сроки.push({x, y, r, форма, альфа, дней:n.дней});
      if(n.fixed) булавки.push({x, y, r, форма, альфа});
      if(kindIsTask(n.type) && n.done) галочки.push(x,y,r);
      if(статусГлиф){ const гл=iconGlyph(статусГлиф.и);
        if(гл) значки.push({x, y, гл, кегль:Math.max(8,r*1.15), цвет:статусГлиф.ц, альфа}); }
      else if(n.tagStyle && n.tagStyle.icon && !безЗначка){ const гл=iconGlyph(n.tagStyle.icon);
        if(гл) значки.push({x, y, гл, кегль:Math.max(8,r*1.25),
                            цвет: спит ? пал.кольцо : (n.color&&n.type!=="hub")?n.color:пал.текст, альфа}); }
      /* ЗНАЧОК ОБЛАСТИ ВНУТРИ ПУСТЫШКИ — тот же глиф, что в карточке области и в панели слева
         (a.icon). Не значок тега (у пустышки его и не бывает): цель тут не «какой это тип
         ноды», а «какой это области принадлежит», и без иконки заливка+пунктир читались бы
         как загадочный кружок, а не как узнаваемая метка области. */
      else if(n.hollow){ const обл=areaById(n.area), гл=обл&&iconGlyph(обл.icon);
        if(гл) значки.push({x, y, гл, кегль:Math.max(8,r*1.15), цвет:пал.текст, альфа}); }
      /* ЗНАЧОК ПОДГРАФА ВНУТРИ НОДЫ — тот же, что везде в интерфейсе (реестр KINDS). Формы
         одной мало: по шестиугольнику среди кругов и квадратов не прочитать, что за нодой
         прячется целый граф. Уступает и статусу, и тегу — они про «прямо сейчас», а вид ноды
         никуда не денется; завершённому глиф не ставим, там уже стоит галочка. */
      else if(n.type==="sub" && !n.done){ const гл=iconGlyph(kindIcon("sub"));
        if(гл) значки.push({x, y, гл, кегль:Math.max(8,r*1.0), цвет:(n.color||пал.текст), альфа}); }
      /* КОРЕНЬ ПОДГРАФА — тот же значок, но ЦВЕТОМ ФОНА: круг под ним залит акцентом (как у
         хаба области), и обычный тёмный глиф на нём не читался бы вовсе. Та же причина, по
         которой цветом фона рисуется галочка внутри выполненной задачи. */
      else if(n.subRoot){ const гл=iconGlyph(kindIcon("sub"));
        if(гл) значки.push({x, y, гл, кегль:Math.max(8,r*1.05), цвет:пал.фон, альфа}); }
      if(верхЗаливки!=null && значки.length>доЗначка) значки[значки.length-1].вз=верхЗаливки;
      if(подписьВидна(r)) подписи.push({n, x, y:y+r+12*z, альфа, ветка:родители.has(n.id)});
    }
    this._навЕдет=навЕдет;
    /* Свечение выделенных — ДО самих фигур, чтобы ореол не лёг поверх соседей. Порог 25 тот же,
       что у SVG (#graph.many-sel снимает тени): размытие считается на каждую фигуру, и на сотне
       выделенных это возвращает ровно ту нагрузку, ради ухода от которой всё и делается. */
    if(выдел.length && выдел.length<=25){
      ctx.save(); ctx.globalAlpha=1; ctx.lineWidth=толщ(4.5);
      for(const в of выдел){
        /* Свечение в два слоя, как два drop-shadow у .g-node.sel в стилях: ближний даёт плотность
           самой обводки, дальний — заметный ореол. Одним слоем выделение читалось слабее. */
        ctx.strokeStyle=в.цвет; ctx.shadowColor=в.цвет;
        ctx.shadowBlur=9;  ctx.beginPath(); this._shapePath(ctx, в.форма, в.x, в.y, в.r, в.уг); ctx.stroke();
        ctx.shadowBlur=22; ctx.beginPath(); this._shapePath(ctx, в.форма, в.x, в.y, в.r, в.уг); ctx.stroke();
      }
      ctx.restore();
    }
    /* Подсветка под курсором — тоже в два слоя, только чуть скромнее выделения: узел должен
       ясно отзываться на наведение, но не спорить с тем, что выбрано. */
    if(навед.length){
      ctx.save();
      for(const в of навед){
        ctx.globalAlpha=в.сила; ctx.lineWidth=толщ(3.2);
        ctx.strokeStyle=в.цвет; ctx.shadowColor=в.цвет;
        ctx.shadowBlur=8*в.сила;  ctx.beginPath(); this._shapePath(ctx, в.форма, в.x, в.y, в.r, в.уг); ctx.stroke();
        ctx.shadowBlur=20*в.сила; ctx.beginPath(); this._shapePath(ctx, в.форма, в.x, в.y, в.r, в.уг); ctx.stroke();
      }
      ctx.restore();
    }
    /* ВЕЕР ПРИОРИТЕТА (выбор КРОЛИКА из demo_приоритет-стопка.html, 03.11.2026). За нодой —
       один, два или три слоя той же формы цветом уровня, развёрнутые веером, как карты в руке.
       Прежние решения — дужка над нодой и кусок обводки сверху — были метками, положенными на
       форму, и на выделенной ноде спорили с белой обводкой; веер лежит ПОД нодой и с выделением
       не пересекается. Поворот вокруг точки НИЖЕ ноды, а не вокруг центра: так верх слоя уходит
       вбок, и веер виден у круга тоже (вокруг центра круг не меняется вовсе). Рисуется до групп,
       то есть под нодой; размер — от радиуса ноды, поэтому растёт вместе с ней на зуме. */
    if(приор.length){
      for(const п of приор){
        /* Вокруг ЦЕНТРА, как в макете: углы слоёв выглядывают со всех сторон. Точка опоры под нодой
           (первая версия) сваливала все слои вправо кучей — «не так, как показывал» (КРОЛИК). Круг
           вокруг центра не меняется, поэтому ему — опора ниже, слои выглядывают дугой сбоку. */
        const цв=пал.при[п.ур-1]||пал.при[0], круг=п.форма==="circle", шаг=0.22, р=п.r*1.1;   // ~12.5°
        const опора = круг ? п.r*2.4 : 0;
        ctx.lineWidth=толщ(1.3); ctx.strokeStyle=цв; ctx.lineJoin="round";
        for(let i=п.ур; i>=1; i--){
          ctx.save();
          ctx.translate(п.x, п.y+опора); ctx.rotate(i*шаг); ctx.translate(-п.x, -(п.y+опора));
          ctx.globalAlpha=п.альфа*(1-i*0.18);
          ctx.fillStyle=this._mix(цв, пал.фонУзла, 0.10+0.05*i);
          ctx.beginPath(); this._shapePath(ctx, п.форма, п.x, п.y, р, п.уг); ctx.fill(); ctx.stroke();
          ctx.restore();
        }
      }
      ctx.globalAlpha=1;
    }
    группы.forEach(гр=>{
      ctx.globalAlpha=гр.альфа; ctx.fillStyle=гр.зал; ctx.strokeStyle=гр.обв; ctx.lineWidth=толщ(гр.лw);
      /* пунктир — признак «на паузе». Шаг растёт вместе с толщиной линии: в экранных пикселях
         при приближении штрих становился короче толщины, и пунктир сливался в сплошную (КРОЛИК) */
      { const шл=толщ(гр.лw); ctx.setLineDash(гр.пункт?[Math.max(3.4, шл*2.4), Math.max(2.6, шл*1.8)]:[]); }
      ctx.beginPath();
      for(let k=0;k<гр.точки.length;k+=4) this._shapePath(ctx, гр.форма, гр.точки[k], гр.точки[k+1], гр.точки[k+2], гр.точки[k+3]);
      ctx.fill(); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.globalAlpha=1;
    /* ФАКТУРЫ МАТЕРИАЛА (см. «МАТЕРИАЛ СТАТУСА» в цикле узлов): иней ждущей,
       диагональ проверки, ядро очереди. Клип по форме на каждую — их в кадре единицы-десятки. */
    for(const м of материалы){
      if(м.r<4) continue;                                             // на общем виде фактура неразличима — хватает цвета
      ctx.save(); ctx.beginPath(); this._shapePath(ctx, м.форма, м.x, м.y, м.r); ctx.clip();
      if(м.вид==="иней"){
        const шаг=Math.max(2.6, м.r*0.3), D=м.r*1.6;
        ctx.strokeStyle=пал.инейШтрих; ctx.lineWidth=Math.max(0.8, м.r*0.07); ctx.beginPath();
        for(let k=-D*2; k<D*2; k+=шаг){ ctx.moveTo(м.x+k-D, м.y+D); ctx.lineTo(м.x+k+D, м.y-D); }
        ctx.stroke();
      } else if(м.вид==="весы"){
        ctx.globalAlpha=0.75; ctx.fillStyle=пал.проверка; ctx.beginPath();
        ctx.moveTo(м.x-м.r*2, м.y+м.r*2); ctx.lineTo(м.x+м.r*2, м.y-м.r*2); ctx.lineTo(м.x+м.r*2, м.y+м.r*2); ctx.closePath(); ctx.fill();
        ctx.globalAlpha=1;
      } else if(м.вид==="заряд"){
        ctx.globalAlpha=0.75; ctx.fillStyle=м.цвет; ctx.beginPath(); this._shapePath(ctx, м.форма, м.x, м.y, м.r*0.5); ctx.fill(); ctx.globalAlpha=1;
      }
      ctx.restore();
    }
    /* ЗАЛИВКА ПРОГРЕССА ПОДЗАДАЧ — снизу вверх внутри фигуры, по клипу её же контура (чуть внутрь,
       чтобы не залезть на обводку). Готовность шота или секвенции раньше считалась обходом детей
       глазами, потом — кольцом вокруг ноды; заливка не добавляет на граф ни одной новой линии.
       Клип на каждую такую ноду — save/restore, но их единицы-десятки в кадре, не тысячи. */
    if(прогресс.length){
      for(const п of прогресс){
        const выс=п.форма==="diamond" ? п.r*1.41 : п.r, верх=п.y+выс-2*выс*п.доля;
        ctx.save(); ctx.globalAlpha=п.альфа;
        ctx.beginPath(); this._shapePath(ctx, п.форма, п.x, п.y, п.r, п.уг); ctx.clip();
        ctx.fillStyle=п.цвет; ctx.fillRect(п.x-выс-1, верх, 2*выс+2, п.y+выс-верх+1);
        ctx.restore();
      }
      ctx.globalAlpha=1;
    }
    ctx.globalAlpha=1;
    /* «НА ПАУЗЕ» — только пунктир и приглушённый тон самой ноды (см. цикл узлов): серое кольцо
       вокруг убрано, оно было третьим контуром на ноде. Свет паузы — в _drawGlow. */
    /* ПРИОРИТЕТ — ВЕЕРОМ ПОД НОДОЙ: см. проход «ВЕЕР ПРИОРИТЕТА» перед группами нод. */
    /* СРОК — МЕТКОЙ НАД НОДОЙ (рисуется после приоритета, поверх обводки), тем же предметом, что метка жара (КРОЛИК 03.11.2026: угловая
       плашка «-40» выглядела слабо). Капсула по центру над формой: значок часов и срок словами
       («−40 дн.», «сегодня», «завтра»). Громкость растёт с близостью срока: далёкий — тихая тёмная
       капсула его цветом, ближайшие три дня — тонированная с обводкой, просрочка — сплошная заливка. */
    const срокСловами=д=> д==null ? "" : д<0 ? "−"+Math.min(99,-д)+" дн." : д===0 ? "сегодня" : д===1 ? "завтра" : д+" дн.";
    const шрифтМетки=" system-ui, -apple-system, Segoe UI, sans-serif";
    if(сроки.length){
      const часы=iconGlyph("clock");
      ctx.textBaseline="middle";
      for(const с of сроки){
        const д=с.дней, прос=д<0, близко=!прос && д<=3;
        const цв = прос?пал.время.просрочка : д===0?пал.время.сегодня : д===1?пал.время.завтра
                 : д<=3?пал.время.скоро : д<=7?пал.время.неделя : пал.время.далеко;
        const т=срокСловами(д), H=18, верх=(с.форма==="diamond"?с.r*1.41:с.r), cy=с.y-верх-H/2-6;
        ctx.font=(прос||близко?"700 ":"600 ")+"11px"+шрифтМетки;
        const W=ctx.measureText(т).width+(часы?30:16), x0=с.x-W/2;
        const зал = прос ? цв : близко ? this._mix(цв, пал.фонУзла, 0.22) : пал.фонУзла;
        const тк  = прос ? пал.фон : цв;
        ctx.globalAlpha=с.альфа;
        if(прос){ ctx.save(); ctx.shadowColor=цв; ctx.shadowBlur=8; }
        this._pillPath(ctx, с.x, cy, W, H); ctx.fillStyle=зал; ctx.fill();
        if(прос) ctx.restore();
        if(!прос){ ctx.lineWidth=1; ctx.strokeStyle=близко?цв:this._mix(цв, пал.фон, 0.4); ctx.stroke(); }
        ctx.fillStyle=тк; ctx.textAlign="left";
        let xx=x0+8;
        if(часы){ ctx.font='11px "tabler-icons"'; ctx.fillText(часы, xx, cy+0.5); xx+=15;
          ctx.font=(прос||близко?"700 ":"600 ")+"11px"+шрифтМетки; }
        ctx.fillText(т, xx, cy+0.5);
      }
      ctx.globalAlpha=1; ctx.textAlign="center";
    }
    /* НОМЕР В ОЧЕРЕДИ у горящих — плашкой на левом верхнем «углу» фигуры, зеркально сроку
       (стиль A: обе метки прикреплены к форме; прежде номер висел слева под 160°, чтобы не
       ложиться на дужку приоритета, — теперь приоритет идёт по самой обводке и места хватает).
       ПЛАШКА, А НЕ КРУЖОК (правка по замечанию КРОЛИКА). Кружок с текстом «№1» внутри либо
       давил цифры теснотой, либо раздувался пустым полем — круг плохо облегает текст переменной
       длины. Плашка (та же форма, что у просрочки) обтягивает текст ровно.
       РАЗМЕР — В ЭКРАННЫХ ПИКСЕЛЯХ, БЕЗ `*z` (правка по замечанию КРОЛИКА: «цифра и кружок
       скейлятся по-разному»). Раньше радиус кружка множился на зум, а шрифт — нет: на сильном
       приближении бейдж раздувался в disc, на отдалении сжимался в точку, и в обоих случаях
       переставал совпадать с текстом внутри. Кегль и плашка меряются от РЕАЛЬНОЙ ширины текста
       (`measureText`) — тем же приёмом, что у плашки просрочки, и остаются одного размера на
       любом масштабе, как подписи и все прочие метки-в-экранных-пикселях в этом файле.
       Префикс «№», а не голая цифра, — чтобы номер очереди не путался с цифрами срока: цвет
       верхнего жара (--ur3) совпадает с цветом просрочки (--tm-over) — совпадение палитр, не
       опечатка, — а «№1» от «−4» не отличить только не читая. */
    /* МЕТКА ЖАРА (КРОЛИК 03.11.2026: «просрочка и приоритет в режиме „что горит“ выглядят слабо»).
       Две мелкие красные плашки по углам — номер и срок — читались шумом и сливались друг с другом.
       Теперь это ОДНА метка над нодой: слева сегмент цветом уровня жара со значком огня и номером
       в очереди, справа — срок словами («−40 дн.», «сегодня»), просрочка красным. Под меткой —
       мягкое свечение её цвета: горящих не больше восьми, тень по карману. */
    if(рангЖар.length){
      const огонь=iconGlyph("flame"), шрифт=шрифтМетки;
      ctx.textBaseline="middle";
      for(const р of рангЖар){
        const цв=пал.жар[р.ур-1]||пал.жар[0], верх=(р.форма==="diamond"?р.r*1.41:р.r);
        const H=20, cx=р.x, cy=р.y-верх-H/2-7, номер=String(р.ранг), срок=срокСловами(р.дней);
        ctx.font="700 12px"+шрифт; const wN=ctx.measureText(номер).width;
        const wL=(огонь?15:0)+wN+15;
        ctx.font="600 11px"+шрифт; const wR=срок ? ctx.measureText(срок).width+16 : 0;
        const W=wL+wR, x0=cx-W/2;
        ctx.globalAlpha=р.альфа==null?1:р.альфа;
        ctx.save(); ctx.shadowColor=цв; ctx.shadowBlur=12; this._pillPath(ctx, cx, cy, W, H); ctx.fillStyle=пал.фонУзла; ctx.fill(); ctx.restore();
        ctx.save(); this._pillPath(ctx, cx, cy, W, H); ctx.clip(); ctx.fillStyle=цв; ctx.fillRect(x0, cy-H/2, wL, H); ctx.restore();
        this._pillPath(ctx, cx, cy, W, H); ctx.lineWidth=1; ctx.strokeStyle=цв; ctx.stroke();
        ctx.textAlign="left"; ctx.fillStyle=пал.фон;
        let xx=x0+8;
        if(огонь){ ctx.font='12px "tabler-icons"'; ctx.fillText(огонь, xx, cy+0.5); xx+=15; }
        ctx.font="700 12px"+шрифт; ctx.fillText(номер, xx, cy+0.5);
        if(срок){ ctx.font="600 11px"+шрифт; ctx.fillStyle=р.дней<0 ? пал.время.просрочка : пал.текст; ctx.fillText(срок, x0+wL+8, cy+0.5); }
      }
      ctx.globalAlpha=1; ctx.textAlign="center";
    }
    /* БУЛАВКА — глиф ti-pin на левом нижнем «углу» фигуры, с подложкой обводкой цвета фона (как
       подписи), а не пунктирное кольцо вокруг ноды: кольцо было ещё одним кругом поверх формы. */
    if(булавки.length){
      const гл=iconGlyph("pin");
      if(гл){
        ctx.textAlign="center"; ctx.textBaseline="middle"; ctx.font='11px "tabler-icons"';
        ctx.lineJoin="round"; ctx.lineWidth=3.5; ctx.strokeStyle=пал.фон; ctx.fillStyle=пал.текст;
        for(const б of булавки){
          const у=this._cornerAt(б.форма, б.x, б.y, б.r, -1, 1);
          ctx.globalAlpha=б.альфа; ctx.strokeText(гл, у[0]-1, у[1]+1); ctx.fillText(гл, у[0]-1, у[1]+1);
        }
        ctx.globalAlpha=1;
      }
    }
    // галочка внутри выполненной задачи — цветом фона, как в SVG (.g-check)
    if(галочки.length){
      ctx.strokeStyle=пал.фон; ctx.lineWidth=толщ(1.6); ctx.lineJoin="round"; ctx.beginPath();
      for(let k=0;k<галочки.length;k+=3){
        const x=галочки[k], y=галочки[k+1], s=z;
        ctx.moveTo(x-3.2*s, y+0.3*s); ctx.lineTo(x-1*s, y+2.7*s); ctx.lineTo(x+3.2*s, y-2.3*s);
      }
      ctx.stroke();
    }
    // значок тега — глиф шрифта Tabler, тем же шрифтом, что и в SVG
    if(значки.length){
      ctx.textAlign="center"; ctx.textBaseline="middle";
      /* ЗНАЧОК НА ЗАЛИВКЕ ПРОГРЕССА — «ВЫРЕЗОМ». Цветом ноды на заливке того же цвета он пропадал,
         а тёмная обводка вокруг (первая попытка) читалась как чужая чёрная рамка (КРОЛИК). Поэтому
         значок рисуется дважды под клипом: выше кромки заливки — своим цветом, ниже — тёмным, как
         будто вырезан в заливке. Таких значков в кадре единицы — по числу нод с прогрессом. */
      for(const з of значки){
        ctx.globalAlpha=з.альфа;
        ctx.font=з.кегль.toFixed(1)+'px "tabler-icons"';
        if(з.вз==null){ ctx.fillStyle=з.цвет; ctx.fillText(з.гл, з.x, з.y); continue; }
        const п=з.кегль, кр=Math.max(з.y-п, Math.min(з.y+п, з.вз));   // кромка в пределах значка
        ctx.save(); ctx.beginPath(); ctx.rect(з.x-п, з.y-п, п*2, кр-(з.y-п)); ctx.clip();
        ctx.fillStyle=з.цвет; ctx.fillText(з.гл, з.x, з.y); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(з.x-п, кр, п*2, з.y+п-кр); ctx.clip();
        ctx.fillStyle=пал.фонУзла; ctx.fillText(з.гл, з.x, з.y); ctx.restore();
      }
      ctx.globalAlpha=1;
    }
    /* ПОДПИСИ. Кегль в СВОИХ пикселях, а не в мировых: текст, уменьшенный вместе с зумом,
       читаться перестаёт задолго до того, как исчезнет, — а стоит столько же. */
    if(подписи.length){
      /* ЧИТАЕМОСТЬ. Кегль поднят против SVG (10.5 → 12, у областей 11.5 → 13.5) и цвет светлее:
         на холсте текст рисуется без сглаживания субпикселями, и прежний размер с приглушённым
         серым читался хуже, чем те же подписи в SVG. Под текстом — тёмная подложка тенью цвета
         фона: подпись часто ложится на связи, звёзды и свечение, и без неё сливалась. */
      /* ПРЕДЕЛ ЧИСЛА ПОДПИСЕЙ. На общем виде дерева их сотни, читать их всё равно невозможно —
         сплошная каша из мелкого текста, — а заливка текста самая дорогая часть кадра (замер:
         563 подписи стоили 97 кадров/с против 165 без них). Оставляем самые крупные узлы:
         области и хабы подписаны всегда, мелкие листья проявляются по мере приближения. */
      const ПРЕДЕЛ=200;
      if(подписи.length>ПРЕДЕЛ){
        подписи.sort((a,b)=>(b.n.r-a.n.r) || (b.n.type==="hub")-(a.n.type==="hub"));
        подписи.length=ПРЕДЕЛ;
      }
      ctx.textAlign="center"; ctx.textBaseline="top";
      /* ПОДЛОЖКА — ОБВОДКОЙ ТЕКСТА цветом фона, а не shadowBlur (аудит 2.1, Ц3 и стиль A). Размытие
         на каждой из двухсот подписей — двести проходов фильтра за кадр, а обводка — обычная
         заливка контура: дешевле и чётче, край подписи перестаёт расплываться на звёздах. */
      ctx.lineJoin="round"; ctx.lineWidth=4; ctx.strokeStyle=пал.фон;
      for(const п of подписи){
        const n=п.n, хаб=n.type==="hub";
        const пусто=!хаб && !(n.label||"").trim();
        let текст=пусто?"(без названия)":(n.label||"");
        if(текст.length>22) текст=текст.slice(0,21)+"…";
        const выделен=this.selNodes&&this.selNodes.has(n.id);
        ctx.globalAlpha=п.альфа*(пусто?0.7:1);
        /* ИЕРАРХИЯ ПОДПИСЕЙ (эталон demo_холст.html): листья — мельче и тише, узлы с детьми —
           полужирные и светлее, выбранная — белая и крупнее. Одинаковые подписи у шота и его
           «Рендер/Сборка» делали граф ровной кашей текста, где не видно, что тут главное. */
        const лист=!хаб && !п.ветка;
        ctx.fillStyle=(хаб||выделен) ? пал.текст
                    : n.paused ? this._mix(пал.подпись2, пал.текст, 0.55)
                    : лист ? this._mix(пал.подпись, пал.текст, 0.25)
                           : this._mix(пал.подпись, пал.текст, 0.85);
        ctx.font=(хаб?"600 13.5px ":выделен?"650 13px ":n.paused?(лист?"italic 10.5px ":"italic 600 12px "):(лист?"10.5px ":"600 12px "))+"system-ui, -apple-system, Segoe UI, sans-serif";
        ctx.strokeText(текст, п.x, п.y);
        ctx.fillText(текст, п.x, п.y);
        // второй строки «N из M» под подписью нет намеренно: КРОЛИК её снял — прогресс показывает
        // заливка формы, а цифры под каждым шотом были шумом
      }
      ctx.globalAlpha=1;
    }
    /* УКАЗАТЕЛИ НА КРАЮ КАДРА. Главная причина «не вижу срочное» — не оформление ноды, а то, что
       она ПРОСТО ЗА КАДРОМ: на 245 нодах в окно попадает малая часть, и любой ореол на невидимой
       ноде бесполезен. Стрелка на краю показывает направление, номер — порядок захода (Ctrl+Shift+G
       перелетает к следующей). Рисуем только в режиме «что горит» и только для горящих: их
       максимум восемь, поэтому проход дешёвый и в покое кадра ничего не меняет. */
    /* СТИЛЬ A: на краю — только стрелка и номер плашкой, тем же предметом, что на самой ноде.
       Названия переехали в панель «Что горит» (_heatPanel): подписи у края наезжали друг на
       друга, когда несколько горящих лежали в одной стороне. Плашки раздвигаются вдоль края. */
    if(this._показатьЖар && this._горящие && this._горящие.length){
      const поле=22, метки=[];
      /* У «стекла» панель лежит поверх графа — правый край кадра для человека проходит по её левой
         кромке, а не по краю окна: иначе указатель уходил под панель. Меряем только в этом режиме. */
      let cwR=cw;
      { const об=document.getElementById("aside-wrap");
        if(об && об.offsetWidth && getComputedStyle(об).position==="absolute"){
          // от #graph-wrap, а не от холста: при сдвиге колесом холст на время едет целиком, и метка
          // с края кадра «телепортировалась» в середину экрана и висела там (КРОЛИК)
          const обёртка=this.svg.parentNode||this.mainCanvas;
          const л=об.getBoundingClientRect().left-обёртка.getBoundingClientRect().left-8;
          if(л>поле*4) cwR=Math.min(cw, л); } }
      this._горящие.forEach(у=>{
        const x=эx(у), y=эy(у);
        if(x>=поле && x<=cwR-поле && y>=поле && y<=ch-поле) return;   // нода в кадре — стрелка не нужна
        метки.push({у, x, y, цx:Math.max(поле, Math.min(cwR-поле, x)), цy:Math.max(поле, Math.min(ch-поле, y))});
      });
      // раздвигаем: метки ближе 24 px друг к другу сдвигаем вдоль края (по y у боковых, по x у верхней и нижней)
      for(let i=1;i<метки.length;i++) for(let j=0;j<i;j++){
        const a=метки[i], b=метки[j];
        if(Math.abs(a.цx-b.цx)<24 && Math.abs(a.цy-b.цy)<24){
          if(a.цx<=поле || a.цx>=cwR-поле) a.цy=Math.min(ch-поле, b.цy+24); else a.цx=Math.min(cwR-поле, b.цx+28);
        }
      }
      ctx.save(); ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.font="600 10.5px system-ui, -apple-system, Segoe UI, sans-serif";
      for(const м of метки){
        const цв=пал.жар[(м.у.жар||1)-1]||пал.жар[0];
        ctx.save(); ctx.translate(м.цx, м.цy); ctx.rotate(Math.atan2(м.y-м.цy, м.x-м.цx));
        ctx.fillStyle=цв; ctx.beginPath(); ctx.moveTo(15,0); ctx.lineTo(9,-4.5); ctx.lineTo(9,4.5); ctx.closePath(); ctx.fill();
        ctx.restore();
        // тем же предметом, что метка жара над нодой: огонь и номер на заливке цветом уровня
        const огонь=iconGlyph("flame"), т=String(м.у.ранг), ww=Math.max(28, ctx.measureText(т).width+(огонь?26:12));
        this._pillPath(ctx, м.цx, м.цy, ww, 18); ctx.fillStyle=цв; ctx.fill();
        ctx.fillStyle=пал.фон;
        if(огонь){ ctx.font='11px "tabler-icons"'; ctx.fillText(огонь, м.цx-ww/2+10, м.цy+0.5);
          ctx.font="700 11px system-ui, -apple-system, Segoe UI, sans-serif"; ctx.fillText(т, м.цx+6, м.цy+0.5); }
        else ctx.fillText(т, м.цx, м.цy+0.5);
      }
      ctx.restore();
    }
  }
  /* ПАНЕЛЬ СЧЁТЧИКА. Показывает не только кадры в секунду, но и ИЗ ЧЕГО состоит кадр: физика,
     свечение, прочее (запись в DOM, фон, прогибы). Числа усредняются за полсекунды — мгновенные
     скачут так, что прочитать их нельзя. Показываем и худший кадр за окно: подлаг чувствуется
     именно им, а не средним. */
  _fpsTick(всего, физ, свеч){
    const a=this._fpsAcc || (this._fpsAcc={n:0, всего:0, физ:0, свеч:0, худ:0, t:performance.now()});
    a.n++; a.всего+=всего; a.физ+=физ; a.свеч+=свеч; if(всего>a.худ) a.худ=всего;
    const прошло=performance.now()-a.t;
    if(прошло<500 || !a.n) return;
    if(!this._fpsBox || !this._fpsBox.isConnected){
      const узел=el("div"); узел.id="g-fps";
      узел.style.cssText="position:absolute;left:12px;bottom:12px;z-index:7;pointer-events:none;"
        +"font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre;color:#fff;"
        +"background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:7px 10px";
      const обёртка=$("#graph-wrap"); if(!обёртка) return;
      обёртка.appendChild(узел); this._fpsBox=узел;
    }
    const кадров=a.n/(прошло/1000), сред=a.всего/a.n;
    this._fpsBox.textContent=
      "кадров/с "+кадров.toFixed(0)+"    кадр "+сред.toFixed(1)+" мс    худший "+a.худ.toFixed(1)+"\n"
      +"физика "+(a.физ/a.n).toFixed(1)+"    свечение "+(a.свеч/a.n).toFixed(1)
      +"    прочее "+Math.max(0,(a.всего-a.физ-a.свеч)/a.n).toFixed(1)+"\n"
      +"узлов "+this.nodes.length+", связей "+this.links.length
      +(this.alpha>0?", раскладка живая":", раскладка остыла");
    this._fpsAcc={n:0, всего:0, физ:0, свеч:0, худ:0, t:performance.now()};
  }
  // вписать все узлы в видимую область (зум/пан), чтобы видеть дерево целиком
  _fitView(){
    if(!this.nodes.length) return;
    let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    this.nodes.forEach(n=>{ minx=Math.min(minx,n.x); miny=Math.min(miny,n.y); maxx=Math.max(maxx,n.x); maxy=Math.max(maxy,n.y); });
    const pad=70;
    const cw=Math.max(1,(maxx-minx)+pad*2), ch=Math.max(1,(maxy-miny)+pad*2);
    const z=Math.max(0.12, Math.min(1.6, Math.min(this.W/cw, this.H/ch)));
    const tx=(this.W - (minx+maxx)*z)/2, ty=(this.H - (miny+maxy)*z)/2;
    this._tweenView(z, tx, ty);   // плавный переезд камеры, а не телепорт
  }
  // плавный переезд камеры к (zoom,tx,ty) — ease-out, ~0.5с
  _tweenView(tz, ttx, tty){
    if(this._vraf) cancelAnimationFrame(this._vraf);
    this._zoomTo=null;   // переезд камеры главнее незакончившегося зума колесом — иначе два хозяина у zoom
    const sz=this.zoom, sx=this.tx, sy=this.ty, t0=performance.now(), dur=520;
    const step=()=>{
      const k=Math.min(1,(performance.now()-t0)/dur), e=1-Math.pow(1-k,3);
      this.zoom=sz+(tz-sz)*e; this.tx=sx+(ttx-sx)*e; this.ty=sy+(tty-sy)*e;
      this._applyTransform();
      this._vraf = k<1 ? requestAnimationFrame(step) : null;
    };
    step();
  }
  _openPop(n,e){
    this._closePop();
    /* МЕНЮ ПУСТЫШКИ — отдельное от обычной ноды: она вспомогательная (см. _palette/цвет),
       и разговор с ней идёт не про содержимое, а про то, что она обслуживает область. Отсюда
       заголовок с иконкой пустышки и названием ОБЛАСТИ, а не только своим именем, — чтобы было
       наглядно видно, что это та же самая область, просто вынесенная точка крепления. */
    if(n.hollow){
      this.sel=n.id;
      const it=n.ref; if(!it) return;
      const a=areaById(it.area);
      const pop=el("div"); pop.id="node-pop";
      pop.innerHTML=`
        <div class="np-ttl"><i class="ti ti-circle-dashed"></i> ${esc(it.title)||"Пустышка"}</div>
        <div class="np-meta"><span><i class="ti ${a?a.icon:"ti-folder"}"></i>пустышка области «${esc(a?a.name:areaName(it.area))}»</span></div>
        <div class="np-row np-act">
          <button class="btn" data-pop="hollow2"><i class="ti ti-circle-dashed"></i>Ещё пустышка</button>
          <button class="btn" data-pop="link"><i class="ti ti-plus"></i>Связать</button>
        </div>
        <div class="np-row">
          <button class="btn danger" data-pop="hdel"><i class="ti ti-trash"></i>Удалить пустышку</button>
        </div>`;
      $("#graph-wrap").appendChild(pop);
      this._posPop(pop,n);
      pop.querySelector('[data-pop="link"]').onclick=()=>{ this.startLink(n.id); };
      pop.querySelector('[data-pop="hollow2"]').onclick=()=>{ this._closePop(); this._createHollow(it.area, n); };
      /* Удаление безопасно само по себе: принадлежность прицепленных нод хранится ПОЛЕМ area
         на них самих, а не ссылкой на эту пустышку — анкер к ней существует только в памяти
         графа. Снесли пустышку — на следующей сборке эти ноды сами найдут хаб или соседнюю
         пустышку (см. build), area у них не меняется вовсе. */
      pop.querySelector('[data-pop="hdel"]').onclick=async ()=>{
        this._closePop();
        const ок=await uiConfirm(`Удалить пустышку «${it.title||"Пустышка"}»? Прицепленные к ней ноды сами найдут другую точку крепления.`,
          {danger:true, title:"Удаление пустышки", okLabel:"Удалить"});
        if(!ок) return;
        hardDeleteItem(it.id); recomputeHierarchy(); persist(); this.build();
      };
      return;
    }
    /* МЕНЮ КОРНЯ ПОДГРАФА. Стоит ПЕРЕД веткой хаба намеренно: у корня тот же type "hub" —
       так он получает всю отрисовку хаба даром, — и разбирать их надо по subRoot, а не по типу.
       Действий три, и все три про сам подграф, а не про ноду: выйти наружу, потянуть от корня
       связь и закрепить его на месте. Удаления тут нет и быть не может — удалять нечего. */
    if(n.subRoot){
      this.sel=n.id;
      const вл=n.subOwner||{};
      const pop=el("div"); pop.id="node-pop";
      pop.innerHTML=`
        <div class="np-hd">
          <div class="np-ttl">${esc((вл.title||"").trim())||"Подграф"}</div>
          <button class="np-pin${n.fixed?" on":""}" data-pop="pin" title="${n.fixed?"Открепить":"Закрепить"}"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i></button>
        </div>
        <div class="np-meta">
          <span><i class="ti ${kindIcon("sub")}"></i>корень подграфа</span>
          <span><i class="ti ti-affiliate"></i>${S.items.length}</span>
        </div>
        <div class="np-row np-act">
          <button class="btn" data-pop="out"><i class="ti ti-corner-left-up"></i>Наружу</button>
          <button class="btn" data-pop="link"><i class="ti ti-plus"></i>Связать</button>
        </div>
        <div class="np-row">
          <button class="btn" data-pop="rename"><i class="ti ti-pencil"></i>Переименовать</button>
        </div>`;
      $("#graph-wrap").appendChild(pop);
      this._posPop(pop,n);
      pop.querySelector('[data-pop="out"]').onclick=()=>{ this._closePop(); if(subLeave()) render(); };
      pop.querySelector('[data-pop="link"]').onclick=()=>{ this._closePop(); this.startLink(n.id); };
      pop.querySelector('[data-pop="rename"]').onclick=()=>{ this._closePop(); this._inlineRename(n.id); };
      pop.querySelector('[data-pop="pin"]').onclick=()=>{
        n.fixed=!n.fixed; n.subRoot.pin=n.fixed; persist();
        const o=this.nodeEls&&this.nodeEls.find(x=>x.n.id===n.id); if(o&&o.pin) o.pin.style.display=n.fixed?"":"none";
        this._wake(); this._closePop();
      };
      return;
    }
    if(n.type==="hub"){
      this.sel=n.id;
      const a=areaById(n.id.replace("hub_",""));
      if(!a){ areaFilter=n.id.replace("hub_",""); view="tasks"; render(); return; }
      const pop=el("div"); pop.id="node-pop";
      pop.innerHTML=`
        <div class="np-ttl">${esc(a.name)}</div>
        <div class="np-meta"><span><i class="ti ${a.icon}"></i>область</span></div>
        <div class="swatches np-sw" style="margin-bottom:10px;">${swatchRow(a.color)}</div>
        <div class="np-row np-act">
          <button class="btn" data-pop="tasks"><i class="ti ti-checklist"></i>Задачи</button>
          <button class="btn" data-pop="link"><i class="ti ti-plus"></i>Связать</button>
        </div>
        <!-- пустышка: узел-развилка внутри области, к которому перецепляют часть нод, чтобы
             разгрузить лучи от хаба и само пространство графа -->
        <div class="np-row np-act">
          <button class="btn" data-pop="hollow"><i class="ti ti-circle-dashed"></i>Пустышка</button>
        </div>
        <div class="np-row np-act">
          <button class="btn" data-pop="pin"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i>${n.fixed?"Открепить":"Закрепить"}</button>
          <button class="btn" data-pop="arename"><i class="ti ti-pencil"></i>Изменить</button>
        </div>
        <div class="np-row">
          <button class="btn danger" data-pop="adel"><i class="ti ti-trash"></i>Удалить область</button>
        </div>`;
      $("#graph-wrap").appendChild(pop);
      this._posPop(pop,n);
      $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>this._paintColor(n, PALETTE[+b.dataset.ci]||null));
      pop.querySelector('[data-pop="tasks"]').onclick=()=>{ this._closePop(); areaFilter=a.id; view="tasks"; render(); };
      pop.querySelector('[data-pop="link"]').onclick=()=>{ this.startLink(n.id); };
      pop.querySelector('[data-pop="hollow"]').onclick=()=>{ this._closePop(); this._createHollow(a.id, n); };
      // область правится и удаляется прямо здесь — лезть за этим в полосу слева не нужно
      pop.querySelector('[data-pop="arename"]').onclick=()=>{
        this._closePop(); openAreaEditor(a, ()=>{ renderNav(); this.build(); });
      };
      // тот же путь, что и Delete по выделенному хабу (см. deleteSelected/_deleteArea) —
      // подтверждение и поведение не должны разъезжаться от того, откуда позвали
      pop.querySelector('[data-pop="adel"]').onclick=async ()=>{ this._closePop(); await this._deleteArea(a); };
      pop.querySelector('[data-pop="pin"]').onclick=()=>{
        /* Узел берём из ЖИВОГО реестра по id, а не из замыкания: build() пересоздаёт объекты
           узлов (любая правка ноды, новая связь, авто-раскладка), и открытый поп-ап держит
           ссылку на предыдущее поколение. Закрепление тогда писалось в объект-призрак:
           координаты уходили не те, а иконка «булавка» не находилась поиском по идентичности
           (x.n===n) и не переключалась. */
        const node=this.byId[n.id]||n;
        node.fixed=!node.fixed; a.pin=node.fixed; if(node.fixed){ a.x=node.x; a.y=node.y; } persist();
        const o=this.nodeEls.find(x=>x.n.id===node.id); if(o)o.pin.style.display=node.fixed?"":"none";
        this._closePop();
      };
      return;
    }
    const it=n.ref; if(!it) return;
    this.sel=n.id;
    const pop=el("div"); pop.id="node-pop";
    pop.style.setProperty("--c", it.color || areaColor(it.area) || "var(--accent)");
    const conn=linksOf(it.id);
    const km = {i:kindIcon(it.kind), n:kindRu(it.kind)};
    const hasOpen = (it.kind==="note" || it.kind==="flow" || it.kind==="sub");
    // Меню — только действия, которых больше негде взять. «Изменить», «Связать» и «Удалить»
    // убраны намеренно: они дублировали двойной клик, Alt+тащи и клавишу Delete — то есть
    // занимали половину окна, ничего не добавляя (всё это написано в подсказке графа).
    // «Закрепить» — иконкой в шапке: это переключатель состояния, ему не нужна целая строка.
    pop.innerHTML=`
      ${/* ШАПКА — как у правой панели (КРОЛИК: «панели на ПКМ нужен реворк»): плитка её цветом и
           значком тега, название, под ним чипы. Цвет ноды (--c) красит и выбранный статус ниже. */""}
      <div class="np-hd">
        <span class="np-tile"><i class="ti ${(n.tagStyle&&n.tagStyle.icon)||km.i}"></i></span>
        <div class="np-hmain">
          <div class="np-ttl">${esc(it.title)||"Без названия"}</div>
          <div class="np-meta">
            <span><i class="ti ${km.i}"></i>${km.n}</span>
            ${it.area?`<span><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
            ${conn.length?`<span><i class="ti ti-link"></i>${conn.length}</span>`:""}
          </div>
        </div>
        <button class="np-pin${n.fixed?" on":""}" data-pop="pin" title="${n.fixed?"Открепить":"Закрепить"}"><i class="ti ${n.fixed?"ti-pin-filled":"ti-pin"}"></i></button>
      </div>
      <div class="swatches np-sw">${swatchRow(it.color)}</div>
      ${hasOpen?`<div class="np-row np-act">
        <button class="btn" data-pop="open"><i class="ti ${(it.kind==="flow"||it.kind==="sub")?kindIcon(it.kind):"ti-eye"}"></i>${it.kind==="sub"?"Войти в подграф":"Открыть"}</button>
      </div>`:""}
      ${/* СТАТУС — РЯД ИКОНОК, а не две кнопки с подписями (2026-09-01).
           Окно шириной 288 px при padding 12 даёт 264 px полезных; с gap 5 это 39,8 px на кнопку
           при шести — только иконка. Подписи в такой ряд не влезают ни при какой вёрстке, зато
           39,8×30 крупнее свотчей цвета (24×24) в этом же окне, по которым попадают каждый день.
           Раньше набор был зашит в разметку тремя разными местами (подсветка primary у «Готово»
           перечисляла статусы ОТ ОБРАТНОГО), теперь ряд строится из реестра СТАТУСЫ в core.js.
           Потухшей ноде статус не предлагаем — сперва вернуть ветку в работу. НО собственная
           завершённость задачи тоже гасит ноду (_isFaded), а из «Готово» надо уметь вернуться:
           поэтому скрываем ряд только у того, что потухло ОТ РОДИТЕЛЯ, а не от своей галочки. */""}
      ${(n.archived && !it.done)?"":`
      <div class="np-stat-lbl">Статус<span>Alt+1…${статусыДляВида(it.kind).length}</span></div>
      <div class="np-row np-stat">
        ${статусыДляВида(it.kind).map(k=>{
            const с=СТАТУСЫ[k];
            const активен = (k==="done") ? !!it.done : (!it.done && it.status===k);
            const нейтраль = (k===нейтральныйСтатус(it.kind));
            return `<button class="btn ${активен?"primary":""}" data-st="${k}" title="${esc(с.имя)}${нейтраль?" — снять статус":""}">${statusMat(k)}<span>${esc(с.кратко||с.имя)}</span></button>`;
          }).join("")}
      </div>`}
      <div class="np-row np-act">
        ${it.folder
          ? `<div class="np-split">
               <button class="btn" data-pop="folder-open" title="${esc(it.folder)}"><i class="ti ti-folder"></i>Папка</button>
               <button class="btn np-side" data-pop="folder-pick" title="Сменить папку (или брось новую на это окошко)"><i class="ti ti-folder-cog"></i></button>
             </div>`
          : `<button class="btn" data-pop="folder-pick" title="Выбрать папку — или брось её сюда из проводника"><i class="ti ti-folder-search"></i>Привязать папку</button>`}
      </div>
      ${/* СБРОС ДОМА показываем только при включённой раскладке и только если дом реально есть:
           в свободном режиме кнопка ничего не значит, а у ноды без дома сбрасывать нечего —
           неактивная кнопка в окне из шести строк только занимала бы место. Считаем по ВСЕМУ
           выделению, потому что и действие идёт на него: выделил ветку, сбросил разом. */""}
      ${/* УПОРЯДОЧИТЬ — только когда выделено дерево, а не одна нода: раскладывать нечего,
           и кнопка без дела занимала бы строку в окне из шести пунктов. */""}
      ${(this.selNodes.has(n.id) && this.selNodes.size>2) ? `<div class="np-row np-act">
        <button class="btn" data-pop="tidy" title="Разложить выделенное деревом: без наложений и пересечений связей. Ноды доедут по домам, форму потом доводишь руками."><i class="ti ti-layout-grid"></i>Упорядочить · ${this.selNodes.size}</button>
      </div>` : ""}
      ${(()=>{
        if(!S.settings.graphHome) return "";
        const ids=(this.selNodes.has(n.id) && this.selNodes.size>1) ? [...this.selNodes] : [n.id];
        const сдомом=ids.filter(id=>{ const x=S.items.find(i=>i.id===id); return x && x.hx!=null && x.hy!=null; }).length;
        if(!сдомом) return "";
        return `<div class="np-row np-act">
          <button class="btn" data-pop="home-off" title="Нода перестанет держаться за своё место и встанет по родителю. Дом назначится заново, когда её потянут."><i class="ti ti-home-off"></i>Сбросить дом${сдомом>1?" · "+сдомом:""}</button>
        </div>`;
      })()}
      <div class="np-row np-size">
        <span class="np-sz-lbl">Размер ноды</span>
        <button class="np-sz-btn" data-pop="size-" title="Меньше"><i class="ti ti-minus"></i></button>
        <span class="np-sz-val">${(+it.size||1).toFixed(1)}×</span>
        <button class="np-sz-btn" data-pop="size+" title="Больше"><i class="ti ti-plus"></i></button>
      </div>`;
    $("#graph-wrap").appendChild(pop);
    this._posPop(pop,n);
    $$(".np-sw .swatch",pop).forEach(b=>b.onclick=()=>this._paintColor(n, PALETTE[+b.dataset.ci]||null));
    if(pop.querySelector('[data-pop="tidy"]')) pop.querySelector('[data-pop="tidy"]').onclick=()=>{ this._closePop(); this._tidySelection(); };
    // «Открыть» у подграфа = вход внутрь, тем же путём, что и двойной клик (см. _openNode)
    if(pop.querySelector('[data-pop="open"]')) pop.querySelector('[data-pop="open"]').onclick=()=>{
      if(it.kind==="sub"){ this._openNode(n); return; }
      this._closePop(); openItemSmart(it); };
    /* Ряд однороден на вид, но маршрут внутри разный, и это принципиально: «Готово» обязано идти
       через _setDone → toggleDone, потому что там ставится doneAt и рождается следующий повтор.
       Прямая запись status="done" всё это потеряла бы. Остальные значения — через _setStatus.
       Клик по уже активному статусу ничего не делает: это выбор из списка, а не тумблер. */
    $$('[data-st]', pop).forEach(b=>{
      const k=b.dataset.st;
      b.onclick=()=>{
        if(b.classList.contains("primary") && k!=="done") return;   // уже стоит — не трогаем
        if(k==="done") this._setDone(n);
        else this._setStatus(n, k===нейтральныйСтатус(it.kind) ? "__neutral__" : k);
      };
    });
    const setSize=(d)=>{ const cur=+it.size||1; it.size=Math.max(0.4,Math.min(3,+(cur+d).toFixed(2))); touch(it); persist(); this.build(); const v=$(".np-sz-val",pop); if(v) v.textContent=(+it.size).toFixed(1)+"×"; };
    if(pop.querySelector('[data-pop="size-"]')) pop.querySelector('[data-pop="size-"]').onclick=()=>setSize(-0.2);
    if(pop.querySelector('[data-pop="size+"]')) pop.querySelector('[data-pop="size+"]').onclick=()=>setSize(0.2);
    if(pop.querySelector('[data-pop="home-off"]')) pop.querySelector('[data-pop="home-off"]').onclick=()=>this._resetHome(n);
    if(pop.querySelector('[data-pop="folder-open"]')) pop.querySelector('[data-pop="folder-open"]').onclick=()=>openItemFolder(it);
    if(pop.querySelector('[data-pop="folder-pick"]')) pop.querySelector('[data-pop="folder-pick"]').onclick=()=>pickItemFolder(it, ()=>{ this._closePop(); this.build(); });
    // папку можно бросить прямо на попап ноды из проводника (см. wireFolderDrop в core.js)
    if(typeof wireFolderDrop==="function") wireFolderDrop(pop, p=>setItemFolder(it, p, ()=>{ this._closePop(); this.build(); }));
    pop.querySelector('[data-pop="pin"]').onclick=()=>{
      const node=this.byId[n.id]||n;   // после смены размера (build) n устаревает — берём живой узел по id
      node.fixed=!node.fixed; if(node.ref){ node.ref.pin=node.fixed; persist(); }
      const o=this.nodeEls.find(x=>x.n.id===n.id); if(o)o.pin.style.display=node.fixed?"":"none";
      this._closePop();
    };
  }
  _posPop(pop,n){
    const rc=this.svg.getBoundingClientRect();
    const pw=pop.offsetWidth||240, ph=pop.offsetHeight||200;
    const nx=(n.x*this.zoom+this.tx)/this.W*rc.width, ny=(n.y*this.zoom+this.ty)/this.H*rc.height;
    // по умолчанию справа-снизу от узла; если не влезает — разворачиваем влево/вверх (а не прижимаем к краю)
    let px = (nx+14+pw <= rc.width-8) ? nx+14 : nx-14-pw;
    let py = (ny+14+ph <= rc.height-8) ? ny+14 : ny-14-ph;
    /* В каркасе «холст» сверху лежат островки, а снизу док — они в слое ВЫШЕ графа, и меню у края
       окна уходило под логотип (КРОЛИК). Поля по вертикали — под островки, а не 8 px. */
    const холст=document.documentElement.classList.contains("canvas-ui");
    const верх=холст?60:8, низ=холст?64:8, лево=холст?62:8;   // слева — столбик областей
    px=Math.max(лево, Math.min(px, rc.width-pw-8));
    py=Math.max(верх, Math.min(py, rc.height-ph-низ));
    pop.style.left=px+"px"; pop.style.top=py+"px";
  }
  _nodeLabel(id){ const n=this.byId[id]; return n?n.label:id; }
  _openLinkPop(l,e){
    this._closePop();
    const pop=el("div"); pop.id="node-pop";
    const auto=!l.manual;
    pop.innerHTML=`
      <div class="np-ttl"><i class="ti ti-link"></i> Связь</div>
      <div class="np-meta" style="line-height:1.6;">
        <span>${esc(this._nodeLabel(l.a))}</span><i class="ti ti-arrows-left-right" style="opacity:.5"></i><span>${esc(this._nodeLabel(l.b))}</span>
      </div>
      ${auto?`<div class="np-meta" style="opacity:.7;margin-bottom:8px;">Авто-связь с областью. Убрать = открепить от области.</div>`:""}
      <div class="np-len"><span class="np-len-lbl">Длина</span><input class="np-len-in" type="range" min="0.4" max="2.5" step="0.1" value="${(l.lenMul||1)}"><span class="np-len-val">${(l.lenMul||1).toFixed(1)}×</span></div>
      <div class="np-row"><button class="btn" data-lp="del"><i class="ti ti-unlink"></i>${auto?"Открепить":"Убрать связь"}</button></div>`;
    const wrap=$("#graph-wrap"); wrap.appendChild(pop);
    const rc=this.svg.getBoundingClientRect();
    const pw=pop.offsetWidth||240, ph=pop.offsetHeight||140;
    const cx=e.clientX-rc.left, cy=e.clientY-rc.top;
    let px = (cx+12+pw <= rc.width-8) ? cx+12 : cx-12-pw;   // разворот влево у правого края
    let py = (cy+12+ph <= rc.height-8) ? cy+12 : cy-12-ph;  // разворот вверх у нижнего края
    /* В каркасе «холст» сверху лежат островки, а снизу док — они в слое ВЫШЕ графа, и меню у края
       окна уходило под логотип (КРОЛИК). Поля по вертикали — под островки, а не 8 px. */
    const холст=document.documentElement.classList.contains("canvas-ui");
    const верх=холст?60:8, низ=холст?64:8, лево=холст?62:8;   // слева — столбик областей
    px=Math.max(лево, Math.min(px, rc.width-pw-8));
    py=Math.max(верх, Math.min(py, rc.height-ph-низ));
    pop.style.left=px+"px"; pop.style.top=py+"px";
    const li=$(".np-len-in",pop);   // индивидуальная длина связи: пишем в lenMul (живо) + в данные, будим симуляцию
    if(li) li.oninput=()=>{
      const v=+li.value; l.lenMul=v;
      if(l.src) l.src[2]=v;         // ручная связь: длина живёт третьим элементом в S.links
      else{
        /* Нить к области в S.links не хранится — граф строит её из it.area на каждой сборке.
           Поэтому длину держит САМА НОДА: положи её в связь, и настройка исчезла бы при первом
           же build (а он случается от любой правки графа). */
        const itemId=isHubId(l.a)?l.b:l.a;
        const it=S.items.find(x=>x.id===itemId);
        if(it){ if(Math.abs(v-1)<0.001) delete it.arealen; else it.arealen=v; }
      }
      const vv=$(".np-len-val",pop); if(vv) vv.textContent=v.toFixed(1)+"×";
      this.alpha=Math.max(this.alpha,0.4); persist();
    };
    pop.querySelector('[data-lp="del"]').onclick=()=>{
      if(l.manual){
        /* Отцепили от пустышки — нода возвращается к области напрямую. Наследование шло через
           пустышку, и без этого нода осталась бы вовсе без области: сняли развилку — потеряли
           принадлежность. Возвращаем ту же область СВОЕЙ, и луч от хаба появляется снова. */
        this._fromLiveNode(l.a, l.b);
        removeLink(l.a,l.b);
      }
      else { // auto area-link: detach the non-hub endpoint from its area
        const itemId = isHubId(l.a) ? l.b : l.a;
        // сняли область руками — нода снова наследует её от родителя, если к кому-то привязана
        const it=S.items.find(x=>x.id===itemId); if(it){ it.area=null; delete it.areaAuto; touch(it); persist(); recomputeHierarchy(); }
      }
      recomputeHierarchy();   // пересобрать иерархию от области
      this._closePop(); this.build(); toast("Связь убрана");
    };
  }
  _closePop(){ const p=$("#node-pop"); if(p)p.remove(); this.sel=null; }
  // пауза/возобновление цикла анимации: когда окно не в фокусе/свёрнуто, останавливаем rAF,
  // чтобы приложение в фоне не жгло CPU (иначе «дыхание» графа крутится 60fps впустую).
  // отложенный показ превью ноды (170 мс после клика) обязан умирать вместе с графом:
  // иначе переход на другую вкладку в этом окне рисовал попап поверх уже другого экрана
  _killPreviewTimer(){ if(this._pvT){ clearTimeout(this._pvT); this._pvT=null; } }
  pause(){ this._paused=true; this._killPreviewTimer(); this._cancelFrame(); if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; } }
  resume(){ if(!this._paused) return; this._paused=false; if(!this._frameWaiting()) this._tick(); }

  // поля кадров ОБНУЛЯЕМ, а не только отменяем: во всём классе «raf пуст» означает «кадр не
  // запланирован» (на этом стоит и _schedule, и resume). Оставленный номер уже отменённого
  // кадра — ложь о состоянии, из-за которой цикл потом можно не запустить.
  /* ДОЖАТЬ РАСКЛАДКУ В ДАННЫЕ. Живые координаты узлов уезжают в S только по ОСТЫВАНИЮ симуляции
     (~6 с), а экземпляр графа умирает раньше: любой полный render() пересоздаёт его — смена
     вкладки, переключение графа, вход в подграф и выход обратно. Без этого шага возврат поднимал
     ПОСЛЕДНЮЮ СОХРАНЁННУЮ раскладку, то есть ту, что была за секунды до ухода, и дерево прыгало
     на прежние места. При включённом «Держать раскладку» это читалось как «ноды поехали по
     домам»: координаты старые, а дома уже новые — их _homeFromDrag пишет в момент жеста.
     Тот же приём и та же причина, что у drawFlush() для доски перед закрытием окна.
     Пишем ТОЛЬКО после заметной активности (_moved), иначе каждая перерисовка графа тащила бы
     на диск ту же самую раскладку. */
  /* СНИМОК РАСКЛАДКИ для шага отката (см. undoPushLayout в core.js). Берём ЖИВЫЕ координаты
     узлов, а не данные: в данные они уезжают только по остыванию физики, то есть на момент
     начала жеста там лежит вчерашняя картина. Снимаем ВСЕ узлы, а не схваченные: тем же
     движением физика растолкает соседей, и вернуть надо всю картину целиком. */
  layoutSnap(){
    const out=[];
    this.nodes.forEach(n=>{
      if(n.ref) out.push([n.id, n.x, n.y, n.ref.hx, n.ref.hy]);
      else if(n.hubArea || n.subRoot) out.push([n.id, n.x, n.y]);
    });
    return out;
  }
  flushLayout(){
    if(!this._moved) return false;
    this._moved=false;
    this.nodes.forEach(n=>{ if(n.ref){ n.ref.x=n.x; n.ref.y=n.y; }
      else if(n.hubArea){ n.hubArea.x=n.x; n.hubArea.y=n.y; }
      else if(n.subRoot){ n.subRoot.x=n.x; n.subRoot.y=n.y; } });
    persist(true);   // тихо: раскладка улеглась сама, человек ничего не делал — в историю отката это не шаг
    return true;
  }
  destroy(){ this.flushLayout();   // ПЕРЕД сносом: живая раскладка иначе умирает вместе с экземпляром
    this._paused=true; this._killPreviewTimer(); clearTimeout(this._asideT); this._asideT=null;
    clearTimeout(this._searchT); this._searchT=null;
    this._cancelFrame();
    if(this._vraf){ cancelAnimationFrame(this._vraf); this._vraf=null; }
    // граф пересоздаётся на каждый render — без этого наблюдатели и слушатели копились бы
    if(this._ro){ this._ro.disconnect(); this._ro=null; }
    if(this._onWinResize){ window.removeEventListener("resize", this._onWinResize); this._onWinResize=null; }
    // WebGL-контекст держит видеопамять, а браузер разрешает лишь ~16 штук: граф пересоздаётся
    // на каждый render, поэтому контекст надо отпускать явно, не дожидаясь сборщика мусора.
    if(this.bgGL && this.bgGL.gl){
      try{ const e=this.bgGL.gl.getExtension("WEBGL_lose_context"); if(e) e.loseContext(); }catch(_){}
      this.bgGL=null;
    }
  }
}
