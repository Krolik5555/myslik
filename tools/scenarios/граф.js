// Граф-паутина: сборка, кадры, камера, лоток, уход с вкладки.
// Главная проверка тут — «ровно один запланированный кадр»: изменение размера окна однажды
// добавляло ещё один вечный цикл отрисовки поверх существующего, и граф считал физику
// в несколько потоков сразу.
const t = [];
// Alt+протяжка на пустое место спрашивает тип новой ноды (раньше молча рождалась заметка)
const _спросТипа = () => {
  const g = graph; if (!g) return null;
  const было = S.items.length;
  g._askKind({clientX: 300, clientY: 300}, k => g._quickAdd(k, 100, 100, null));
  const меню = document.querySelector("#node-pop");
  const кнопок = меню ? меню.querySelectorAll("[data-k]").length : 0;
  if (меню) { const b = меню.querySelector('[data-k="task"]'); if (b) b.click(); }
  return {кнопок, создано: S.items.length - было,
          тип: S.items.length > было ? S.items[S.items.length-1].kind : null};
};
const ж = ms => new Promise(r => setTimeout(r, ms));

/* ФАЙЛ ПИСАЛСЯ, КОГДА SVG БЫЛ ДЕФОЛТОМ ПРИЛОЖЕНИЯ, и подавляющее большинство проверок читают
   геометрию/классы через SVG-DOM (nodeEls/linkEls, getAttribute("d"), classList) — это их
   ИНСТРУМЕНТ измерения, а не предмет проверки. Дефолт приложения сменился на canvas
   (2026-08-11, core.js), и ambient-режим теста обязан остаться "svg" НЕЗАВИСИМО от дефолта —
   иначе половина файла тихо перестаёт проверять то, что должна (пример: строка ~392 раньше
   просто пропускала замер при el===undefined, не падая и не жалуясь). Отдельные секции,
   которые проверяют ИМЕННО canvas-режим, сами явно переключаются на него и возвращают SVG
   обратно (см. "холст: SVG-элементы узлов и связей не создаются" ниже) — их не трогаем. */
S.settings.graphRender = "svg";

view = "notes"; render(); await ж(300);
t.push({имя:"граф создаётся", ок: !!graph && graph.nodes.length > 0,
        факт: graph ? graph.nodes.length + " узлов, " + graph.links.length + " связей" : "графа нет"});
if (!graph) return t;

// узлы паутины = неудалённые элементы + хабы областей
const живых = S.items.filter(i => !i.deleted).length;
t.push({имя:"в паутине только живые элементы",
        ок: graph.nodes.filter(n => n.type !== "hub").length <= живых,
        факт: graph.nodes.filter(n => n.type !== "hub").length + " из " + живых});

/* ФИЗИКА НЕ ПАДАЕТ НА ПУСТОМ ГРАФЕ. Центр притяжения пучков (см. _tick) когда-то завели как
   `let cx=mx,cy=my` ВНУТРИ того же блока if(alpha>0), где этажом выше уже читался «внешний»
   cx=this.W/2 (запасное значение при нуле узлов) — одинаковое имя поймало временную мёртвую
   зону: обращение к внешнему cx падало ReferenceError на КАЖДОМ кадре, но только когда узлов
   ровно ноль, поэтому ни один из сценариев с реальными узлами это не ловил. КРОЛИК заметил
   косвенно — «даже на пустом графе низкий фпс» (это было не видеокарта, а тихое исключение,
   рвущее весь _tick до отрисовки на каждом кадре). Гоняем несколько «живых» кадров на
   принудительно пустом графе и возвращаем обратно через build(). */
{
  // опустошаем САМ граф (items/areas/links), а не только graph.nodes/links — иначе byId,
  // _группа, _родитель и сетка соседства остаются от прежнего графа и ловят другую, свою
  // ошибку несоответствия, а не ту временную мёртвую зону, что была у КРОЛИКА
  const активГраф = S.graphs.find(g => g.id === S.settings.graph);
  const снимок = {items: активГраф.items, areas: активГраф.areas, links: активГраф.links};
  активГраф.items = []; активГраф.areas = []; активГраф.links = [];
  render();
  let ошибка = null;
  if (graph) { graph.alpha = 1;
    try { for (let i = 0; i < 30; i++) graph._tick(true); } catch (e) { ошибка = String(e); } }
  активГраф.items = снимок.items; активГраф.areas = снимок.areas; активГраф.links = снимок.links;
  render();
  t.push({имя:"физика не бросает исключение на графе без единого узла", ок: !ошибка,
          факт: ошибка || "30 кадров без ошибок"});
}

// ОДИН кадр в очереди при любом числе изменений размера
const RAF = window.requestAnimationFrame, CAF = window.cancelAnimationFrame;
let запрошено = 0, отменено = 0;
window.requestAnimationFrame = cb => { запрошено++; return RAF(cb); };
window.cancelAnimationFrame = id => { отменено++; return CAF(id); };
for (let i = 0; i < 5; i++){ graph.W = 0; graph.H = 0; graph._onResize(); }
window.requestAnimationFrame = RAF; window.cancelAnimationFrame = CAF;
t.push({имя:"изменение размера не плодит циклы отрисовки", ок: запрошено === отменено,
        факт:"запрошено " + запрошено + ", отменено " + отменено});

// камера: зум меняет масштаб и держится в пределах
const з0 = graph.zoom;
graph.svg.dispatchEvent(new WheelEvent("wheel", {clientX:400, clientY:300, deltaY:-120, bubbles:true, cancelable:true}));
await ж(60);
t.push({имя:"зум колесом работает", ок: graph.zoom !== з0, факт: з0.toFixed(2) + " → " + graph.zoom.toFixed(2)});
t.push({имя:"зум остаётся в разумных пределах", ок: graph.zoom > 0.05 && graph.zoom < 6,
        факт: graph.zoom.toFixed(2)});

/* ПЛАВНОСТЬ ЗУМА. Колесо задаёт цель, камера едет к ней в кадрах, поэтому проверяем три вещи:
   один щелчок не отрабатывается мгновенно (иначе это снова ступенька), доезжает до цели целиком,
   и точка под курсором стоит на месте ВЕСЬ доезд — она пересчитывается на каждом кадре, а не один
   раз в событии, и ошибка здесь читалась бы как уползание графа из-под курсора. */
{
  const кx = 400, кy = 300;
  const rc0 = graph.svg.getBoundingClientRect();
  const вМире = () => { const mx = (кx-rc0.left)/rc0.width*graph.W, my = (кy-rc0.top)/rc0.height*graph.H;
    return {x:(mx-graph.tx)/graph.zoom, y:(my-graph.ty)/graph.zoom, mx, my}; };
  const точка = вМире();
  const z0 = graph.zoom;
  graph.svg.dispatchEvent(new WheelEvent("wheel", {clientX:кx, clientY:кy, deltaY:-100, bubbles:true, cancelable:true}));
  const цель = graph._zoomTo;
  graph._tick(true);
  const послеКадра = graph.zoom;
  let максСнос = 0;
  for (let i = 0; i < 40; i++) {
    graph._tick(true);
    const эx = точка.x*graph.zoom + graph.tx, эy = точка.y*graph.zoom + graph.ty;
    максСнос = Math.max(максСнос, Math.hypot(эx - точка.mx, эy - точка.my));
  }
  t.push({имя:"один щелчок колеса не прыгает, а доезжает за несколько кадров",
          ок: цель != null && Math.abs(послеКадра - z0) < Math.abs(цель - z0) * 0.8,
          факт: "цель " + (цель != null ? цель.toFixed(3) : "нет") + ", за первый кадр " + z0.toFixed(3) + " → " + послеКадра.toFixed(3)});
  t.push({имя:"зум доезжает до цели ровно", ок: цель != null && Math.abs(graph.zoom - цель) < 0.002,
          факт: "остановился на " + graph.zoom.toFixed(4) + " при цели " + (цель != null ? цель.toFixed(4) : "—")});
  t.push({имя:"точка под курсором не уползает во время зума", ок: максСнос < 1,
          факт: "макс. снос " + максСнос.toFixed(2) + " px"});
  // шаг зависит от величины delta: у тачпада события мелкие, и зум должен идти мельче
  const zA = graph.zoom;
  graph.svg.dispatchEvent(new WheelEvent("wheel", {clientX:кx, clientY:кy, deltaY:-8, bubbles:true, cancelable:true}));
  const мелкийШаг = Math.abs(graph._zoomTo - zA);
  graph._zoomTo = null;
  const zB = graph.zoom;
  graph.svg.dispatchEvent(new WheelEvent("wheel", {clientX:кx, clientY:кy, deltaY:-100, bubbles:true, cancelable:true}));
  const обычныйШаг = Math.abs(graph._zoomTo - zB);
  graph._zoomTo = null;
  t.push({имя:"шаг зума считается от величины delta, а не фиксированный",
          ок: мелкийШаг > 0 && мелкийШаг < обычныйШаг * 0.25,
          факт: "delta 8 → " + мелкийШаг.toFixed(4) + ", delta 100 → " + обычныйШаг.toFixed(4)});
}

/* ЗУМ ПРИ ЗАЖАТОЙ СРЕДНЕЙ КНОПКЕ. Симптом (КРОЛИК, 2026-07-30): держишь колесо нажатым и крутишь —
   граф кидает. Пан считался абсолютно от точки нажатия и затирал tx/ty, которые зум правит каждый
   кадр, чтобы точка под курсором стояла на месте. Проверяем два требования по отдельности:
   при неподвижном курсоре зум держит точку, а движение мыши сдвигает граф РОВНО на путь курсора. */
{
  const svg = graph.svg, rc = svg.getBoundingClientRect();
  const кx = rc.left + rc.width*0.45, кy = rc.top + rc.height*0.45;
  const вМир = (эx, эy) => ({x:((эx-rc.left)/rc.width*graph.W - graph.tx)/graph.zoom,
                             y:((эy-rc.top)/rc.height*graph.H - graph.ty)/graph.zoom});
  const наЭкран = м => ({x:(м.x*graph.zoom + graph.tx)/graph.W*rc.width + rc.left,
                         y:(м.y*graph.zoom + graph.ty)/graph.H*rc.height + rc.top});
  graph._zoomTo = null;
  svg.dispatchEvent(new PointerEvent("pointerdown", {button:1, clientX:кx, clientY:кy, bubbles:true, cancelable:true}));
  const держим = !!graph.panning;
  const точка = вМир(кx, кy);
  // 1) крутим колесо, курсор стоит: точка под ним не должна уезжать
  svg.dispatchEvent(new WheelEvent("wheel", {clientX:кx, clientY:кy, deltaY:-100, bubbles:true, cancelable:true}));
  let сносПриЗуме = 0;
  for (let i = 0; i < 12; i++) { graph._tick(true);
    const э = наЭкран(точка); сносПриЗуме = Math.max(сносПриЗуме, Math.hypot(э.x-кx, э.y-кy)); }
  // 2) теперь двигаем мышь на 40x25: граф обязан сдвинуться ровно на это, без добавки от зума
  const доСдвига = наЭкран(точка);
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons:4, clientX:кx+40, clientY:кy+25, bubbles:true, cancelable:true}));
  graph._tick(true);
  const послеСдвига = наЭкран(точка);
  const лишнее = Math.hypot((послеСдвига.x-доСдвига.x)-40, (послеСдвига.y-доСдвига.y)-25);
  svg.dispatchEvent(new PointerEvent("pointerup", {button:1, clientX:кx+40, clientY:кy+25, bubbles:true, cancelable:true}));
  t.push({имя:"средняя кнопка включает пан", ок: держим, факт: держим ? "panning есть" : "panning не выставлен"});
  t.push({имя:"зум при зажатой средней кнопке держит точку под курсором", ок: сносПриЗуме < 1.5,
          факт: "снос " + сносПриЗуме.toFixed(2) + " px за доезд"});
  t.push({имя:"пан во время зума сдвигает граф ровно на путь курсора", ок: лишнее < 1.5,
          факт: "лишний сдвиг " + лишнее.toFixed(2) + " px (ждали ровно 40x25)"});
  t.push({имя:"пан отпускается", ок: !graph.panning, факт: graph.panning ? "panning остался" : "снят"});
  graph._zoomTo = null;
}

// лоток: мысль без координат ждёт, пока её поставят на холст
const мысль = addItem({kind:"note", title:"Неразобранная мысль"});
graph.build(); await ж(80);
const вЛотке = !!document.querySelector(`#g-tray [data-id="${мысль.id}"], .g-tray [data-id="${мысль.id}"]`);
const наХолсте = !!graph.byId[мысль.id];
t.push({имя:"мысль без координат не попадает на холст", ок: !наХолсте,
        факт: наХолсте ? "оказалась на холсте" : (вЛотке ? "лежит в лотке" : "ждёт разбора")});

// связи: добавление связи отражается в графе
const цель = S.items.find(i => !i.deleted && i.id !== мысль.id && i.x != null);
if (цель){
  const былоСвязей = graph.links.length;
  addLink(цель.id, мысль.id);
  мысль.x = цель.x + 60; мысль.y = цель.y + 60;
  recomputeHierarchy(); graph.build(); await ж(80);
  t.push({имя:"новая связь появляется в графе", ок: graph.links.length > былоСвязей,
          факт: былоСвязей + " → " + graph.links.length});
}

// уход с вкладки убивает граф целиком: иначе кадры продолжают считаться на отсоединённых узлах
const был = graph;
view = "today"; render(); await ж(150);
t.push({имя:"уход с вкладки уничтожает граф", ок: graph === null && был._paused === true && !был.raf,
        факт:"graph: " + graph + ", кадр: " + был.raf});

// возврат восстанавливает
view = "notes"; render(); await ж(250);
t.push({имя:"возврат на вкладку пересобирает граф", ок: !!graph && graph.nodes.length > 0,
        факт: graph ? graph.nodes.length + " узлов" : "нет"});

// Alt+протяжка на пустое место: сначала спрашивает тип, потом создаёт
{
  const р = _спросТипа();
  await ж(200);
  if (р) {
    t.push({имя:"Alt-протяжка предлагает выбрать тип", ок: р.кнопок === 3, факт: "вариантов: " + р.кнопок});
    t.push({имя:"создаётся выбранный тип, а не всегда заметка", ок: р.создано === 1 && р.тип === "task",
            факт: "создано " + р.создано + ", тип " + р.тип});
    S.items.filter(i => i.kind === "task" && !i.title && i.x === 100).forEach(i => hardDeleteItem(i.id));
  }
}

// ===== физика: ноды не лежат на связях и граф не уезжает при пробуждении =====
{
  const цм = () => { let x=0,y=0; graph.nodes.forEach(n=>{x+=n.x;y+=n.y}); return {x:x/graph.nodes.length, y:y/graph.nodes.length}; };

  /* Захват ноды поднимает alpha с нуля. Раньше вместе с физикой включалось притяжение к
     ФИКСИРОВАННОЙ точке вьюпорта, и разросшееся дерево целиком уезжало «к центру». */
  graph.nodes.forEach(n => { n.x += 2500; n.y += 1200; n.vx = 0; n.vy = 0; });
  const до = цм();
  graph.alpha = 0.4;
  for (let i = 0; i < 90; i++) graph._tick(true);
  const после = цм();
  const снос = Math.hypot(после.x - до.x, после.y - до.y);
  t.push({имя:"граф не уезжает при пробуждении физики", ок: снос < 40,
          факт: "центр масс сместился на " + Math.round(снос) + " px (вьюпорт в " + Math.round(graph.W/2) + "," + Math.round(graph.H/2) + ")"});

  // нода, положенная ровно на чужую связь, должна с неё сойти
  const св = graph.links[1];
  if (св) {
    const A = graph.byId[св.a], B = graph.byId[св.b];
    const чужая = graph.nodes.find(n => n !== A && n !== B && !n.fixed);
    if (A && B && чужая) {
      чужая.x = (A.x + B.x) / 2; чужая.y = (A.y + B.y) / 2; чужая.vx = 0; чужая.vy = 0;
      const дист = () => { const ex=B.x-A.x, ey=B.y-A.y, L2=ex*ex+ey*ey||1;
        let к=((чужая.x-A.x)*ex+(чужая.y-A.y)*ey)/L2; к=Math.max(0,Math.min(1,к));
        return Math.hypot(чужая.x-(A.x+ex*к), чужая.y-(A.y+ey*к)); };
      graph.alpha = 0.5;
      for (let i = 0; i < 150; i++) graph._tick(true);
      t.push({имя:"нода отталкивается от связи", ок: дист() >= чужая.r + 13,
              факт: "ушла на " + Math.round(дист()) + " px, нужно от " + Math.round(чужая.r + 13)});
    }
  }
}

/* ===== наезд связью на ноду во время перетаскивания =====
   Человек тащит ноду так, что её связь ложится на чужую. Раньше узел метался: физика его
   выталкивает, рука давит снова. Отталкивание при этом отключать нельзя — иначе ноды просто
   лежали бы на линиях, — поэтому во время драга оно мягче, а после отпускания работает в полную. */
{
  const A = addItem({kind:"task", title:"наездА"}); A.x = 5200; A.y = 5000;
  const B = addItem({kind:"task", title:"наездБ"}); B.x = 5600; B.y = 5000;
  const Р = addItem({kind:"task", title:"наездРодитель"}); Р.x = 5400; Р.y = 5220;
  const Ж = addItem({kind:"task", title:"наездЖертва"}); Ж.x = 5400; Ж.y = 5130;
  S.links.push([A.id, B.id, 1], [Р.id, Ж.id, 1]);
  recomputeHierarchy(); graph.build();

  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && у(Ж.id)) {
    const а = у(A.id), б = у(B.id), ж = у(Ж.id);
    а.fixed = true; у(Р.id).fixed = true;
    а.x = 5200; а.y = 5000; б.x = 5600; б.y = 5000; у(Р.id).x = 5400; у(Р.id).y = 5220; ж.x = 5400; ж.y = 5130;
    const св = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const дист = () => { const ex = б.x-а.x, ey = б.y-а.y, L2 = ex*ex+ey*ey || 1;
      let к = ((ж.x-а.x)*ex + (ж.y-а.y)*ey) / L2; к = Math.max(0, Math.min(1, к));
      return Math.hypot(ж.x-(а.x+ex*к), ж.y-(а.y+ey*к)); };

    // рука водит ноду туда-сюда около жертвы
    graph.drag = б;
    const прогибы = [], игреки = [];
    for (let i = 0; i < 240; i++) {
      б.y = 5000 + 120 + Math.sin(i*0.35)*28; б.vx = 0; б.vy = 0;
      graph.alpha = Math.max(graph.alpha, 0.4);
      graph._tick(true);
      прогибы.push(св && св._bendC ? Math.hypot(св._bendC.ox, св._bendC.oy) : 0);
      игреки.push(ж.y);
    }
    graph.drag = null;

    let миганий = 0;
    for (let i = 1; i < прогибы.length; i++) if ((прогибы[i-1] === 0) !== (прогибы[i] === 0)) миганий++;
    let разворотов = 0;
    for (let i = 2; i < игреки.length; i++) { const d1 = игреки[i-1]-игреки[i-2], d2 = игреки[i]-игреки[i-1];
      if (d1*d2 < 0 && Math.abs(d2) > 0.3) разворотов++; }
    t.push({имя:"под курсором нода не мечется", ок: разворотов === 0, факт:"разворотов " + разворотов});
    t.push({имя:"дуга не мигает у границы зазора", ок: миганий <= 2, факт:"переключений " + миганий});

    // отпустили — отталкивание снова в полную силу и уводит ноду с линии
    graph.alpha = 0.4;
    for (let i = 0; i < 250; i++) graph._tick(true);
    t.push({имя:"после отпускания нода уходит с линии", ок: дист() >= ж.r + 18,
            факт:"дистанция " + дист().toFixed(0) + " при зазоре " + (ж.r+18).toFixed(0)});
    /* Диагностика дрожи (дрожь() в консоли DevTools). Сама она баг не лечит, но если она молча
       упадёт или начнёт печатать при выключенном выключателе — замер у КРОЛИКА не состоится,
       а другого способа поймать этот баг у нас нет: в стенде кадры идут синхронно, дрейфа нет. */
    const логи = [], _лог = console.log;
    console.log = (...a) => { логи.push(a.map(x => String(x)).join(" ")); };
    let сбой = null, послеВыкл = 0;
    const водить = () => { graph.drag = б;
      for (let i = 0; i < 65; i++) { б.y = 5000 + 120 + Math.sin(i*0.35)*28; б.vx = 0; б.vy = 0;
        graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
      graph.drag = null; graph._tick(true); };            // отпустили — печатается итоговый отчёт
    try {
      дрожь(true); водить();
      дрожь(false); const было = логи.length; водить(); послеВыкл = логи.length - было;
    } catch (e) { сбой = (e && e.message) || String(e); }
    дрожь(false); console.log = _лог;
    const отчёт = логи.find(s => s.indexOf("[дрожь]") === 0) || "";
    t.push({имя:"диагностика дрожи печатает замер", ок: !сбой && !!отчёт,
            факт: сбой ? "ошибка: " + сбой : "строк " + логи.length + " · " + отчёт.slice(0, 90)});
    t.push({имя:"выключенная диагностика молчит", ок: !сбой && послеВыкл === 0,
            факт: "лишних строк " + послеВыкл});
    /* Путь «ЖЕРТВА» — нода, к которой ближе зазора подошла связь ТАЩИМОЙ ноды. Кладём жертву прямо
       на линию и проверяем, что замер называет её так: в отчёте от 15:27 жертва в блок не попадала
       вовсе (ранжирование по разворотам выносило наверх хабы с шагом 0.2 px), и разбор ушёл в
       сторону. Печать пропускаем — здесь важен сам факт опознания. */
    дрожь(true);
    а.x = 5200; а.y = 5000; б.x = 5600; б.y = 5000; ж.x = 5400; ж.y = 5000; ж.vx = 0; ж.vy = 0;
    graph.drag = б; graph.alpha = 0.4;
    const _лог3 = console.log; console.log = () => {};
    for (let i = 0; i < 3; i++) graph._tick(true);
    console.log = _лог3;
    const зж = graph._dbg && graph._dbg.по.get(Ж.id);
    graph.drag = null; дрожь(false);
    t.push({имя:"замер называет жертву связи руки", ок: !!(зж && зж.жертваКадров > 0),
            факт: зж ? "кадров жертвой " + зж.жертваКадров + ", связь «" + зж.жертваСвязь + "»" : "записи нет"});

    /* Тот же отчёт, но в ФАЙЛ через мост (так работает debug-дрожь.bat: панель разработчика
       КРОЛИКУ открывать не нужно). В стенде моста нет — подставляем заглушку ровно на время
       замера и снимаем сразу: HasPy() смотрит на api.load, а через него идёт вся запись данных. */
    const вФайл = [], _пв = window.pywebview;
    window.pywebview = {api:{load:()=>null, shake_log:(s)=>{ вФайл.push(s); return true; }}};
    const _лог2 = console.log; console.log = () => {};
    let сбой2 = null;
    try { дрожь(true, true); водить(); } catch (e) { сбой2 = (e && e.message) || String(e); }
    дрожь(false); console.log = _лог2; window.pywebview = _пв;
    t.push({имя:"отчёт дрожи уходит в файл через мост",
            ок: !сбой2 && вФайл.length > 0 && вФайл.join("").indexOf("[дрожь]") >= 0,
            факт: сбой2 ? "ошибка: " + сбой2 : "вызовов моста " + вФайл.length});
    graph.nodes.forEach(n => n.fixed = false);
  }
  [A, B, Р, Ж].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== нода РОВНО на линии: сила не меняет знак и не растёт на порядок =====
   Замер у КРОЛИКА (дрожь-отчёт.txt, 2026-07-30): в 75 окнах из 107 «проникновение по базовым»
   было около −220 px, то есть каждый раз срабатывала ветка «нода ровно на линии», где d
   подменяется ДЛИНОЙ связи. Это же d идёт дальше в силу: (need−d)/need даёт −9.9 вместо +1 —
   отталкивание меняет знак и растёт на порядок. Проверяем ровно это: один кадр физики с нодой
   в точности на линии против такого же кадра в полупикселе от неё. Силы должны быть похожи
   и смотреть в одну сторону. Дрейф и реальное время тут не нужны — баг чисто геометрический. */
{
  const A = addItem({kind:"task", title:"наЛинииА"});    A.x = -9000; A.y = -9000;
  const B = addItem({kind:"task", title:"наЛинииБ"});    B.x = -8700; B.y = -9000;
  const Н = addItem({kind:"task", title:"наЛинииНода"}); Н.x = -8850; Н.y = -9000;
  const Р = addItem({kind:"task", title:"наЛинииРука"}); Р.x = -8850; Р.y = -8600;
  S.links.push([A.id, B.id, 1]);
  recomputeHierarchy(); graph.build();
  const а = graph.byId[A.id], б = graph.byId[B.id], н = graph.byId[Н.id], р = graph.byId[Р.id];
  if (а && б && н && р) {
    /* Мерим не скорость ноды, а САМУ силу от линии — её отдельно считает диагностика дрожи.
       По скорости не выходит: тестовая сцена стоит далеко от остального графа, стяжка к центру
       масс даёт 6 px за кадр и упирается в кламп, а на его фоне разница сил не видна вовсе. */
    const силаЛинии = (отступ) => {
      а.x = -9000; а.y = -9000; а.vx = 0; а.vy = 0;
      б.x = -8700; б.y = -9000; б.vx = 0; б.vy = 0;
      р.x = -8850; р.y = -8600; р.vx = 0; р.vy = 0;
      н.x = -8850; н.y = -9000 + отступ; н.vx = 0; н.vy = 0;
      дрожь(true);                            // свежие накопители замера на один кадр
      graph.alpha = 0.4; graph.drag = р;      // рука держит соседнюю ноду — те же коэффициенты, что у КРОЛИКА
      graph._tick(true);
      graph.drag = null;
      const r = graph._dbg && graph._dbg.по.get(н.id);
      const итог = {сила: (r && r.силы["линия"]) || 0, зазор: r ? r.зБазМин : null};
      дрожь(false);
      return итог;
    };
    const наЛинии = силаЛинии(0), рядом = силаЛинии(0.5);
    t.push({имя:"нода ровно на линии: отталкивание не растёт на порядок",
            ок: наЛинии.сила <= рядом.сила * 1.3 + 0.001,
            факт: "на линии " + наЛинии.сила.toFixed(3) + " против " + рядом.сила.toFixed(3) + " в полупикселе"});
    t.push({имя:"нода ровно на линии: зазор считается от линии, а не от длины связи",
            ок: наЛинии.зазор != null && наЛинии.зазор > 0,
            факт: "проникновение " + (наЛинии.зазор != null ? наЛинии.зазор.toFixed(1) + " px" : "не замерено")});
  }
  [A, B, Н, Р].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== свечение стирается РОВНО под связью, даже когда ноды едут =====
   Симптом (КРОЛИК, 2026-07-30): «при привязке папки ломается свечение». Слой свечения рисовался
   ПЕРВОЙ строкой кадра, то есть по позициям прошлого кадра, а SVG уже показывал новые — вырез,
   которым свечение стирается из-под связи, отставал на кадр и уезжал от линии на её шаг (до 6 px).
   Мерим по пикселям: под линией свечения быть не должно, рядом — должно. */
{
  // Замер читает геометрию через SVG-элемент связи (getTotalLength) — в canvas-режиме
  // (дефолт с 2026-08-11) graph.linkEls пуст, el===undefined, len=0, и весь замер тихо
  // пропускался бы (len>8 ниже не проходит), а не падал — не баг, но дыра в покрытии.
  const был = view, режимДоТеста = S.settings.graphRender;
  S.settings.graphRender = "svg";
  view = "notes"; render(); await ж(200);
  const g = graph;
  if (g && g.links.length && g.glowCtx) {
    const l = g.links.find(x => g.byId[x.a] && g.byId[x.b]);
    const a = g.byId[l.a], b = g.byId[l.b];
    a.doing = true;                                  // светится конец связи — как «в работе» у КРОЛИКА
    const cv = g.glowCanvas, cw = cv.clientWidth, ch = cv.clientHeight;
    g.zoom = 1; g.tx = cw/2 - (a.x+b.x)/2; g.ty = ch/2 - (a.y+b.y)/2;   // связь — в середину канваса
    /* САМО ОТСТАВАНИЕ НА КАДР стенд показать не может, и это надо знать, читая проверку: кадры
       тут синхронные, между ними ничего не происходит, поэтому слой, нарисованный в начале кадра,
       видит те же позиции, что и SVG в конце. Отставание проявляется только на живых кадрах, где
       позиции меняет физика и дыхание — там оно и было замерено (дев-превью: под линией 20 из 42,
       после переноса вызова — 0). Здесь проверяем то, что стенду доступно: геометрию выреза. */
    g.alpha = 0.4;
    for (let i = 0; i < 10; i++) g._tick(true);
    const i = g.links.indexOf(l), el = g.linkEls[i];
    const len = el ? el.getTotalLength() : 0;
    if (len > 8) {
      // масштаб слоя свечения спрашиваем у самого графа: на большом дереве он рисуется в
      // половинном разрешении (пятна размытые, разницы не видно), и зашитая формула тут врала бы
      const dpr = g.glowScale || Math.min(window.devicePixelRatio || 1, 2), ctx = g.glowCtx;
      const экр = p => ({x: p.x*g.zoom + g.tx, y: p.y*g.zoom + g.ty});
      const P = экр(el.getPointAtLength(len*0.5));
      const P1 = экр(el.getPointAtLength(len*0.5 - 3)), P2 = экр(el.getPointAtLength(len*0.5 + 3));
      const L = Math.hypot(P2.x-P1.x, P2.y-P1.y) || 1, nx = -(P2.y-P1.y)/L, ny = (P2.x-P1.x)/L;
      const проф = [];
      for (let k = -6; k <= 6; k++)
        проф.push(ctx.getImageData(Math.round((P.x+nx*k)*dpr), Math.round((P.y+ny*k)*dpr), 1, 1).data[3]);
      // «под линией» = минимум в пределах пикселя от неё: точка замера округляется до физического
      // пикселя, и требовать попадания ровно в центр выреза значило бы мерить своё округление.
      const подЛинией = Math.min(проф[5], проф[6], проф[7]), рядом = Math.max(...проф);
      t.push({имя:"свечение вообще нарисовано (иначе замер ниже пустой)", ок: рядом > 0,
              факт:"макс альфа рядом со связью " + рядом});
      // Порог, а не строгий ноль: вырез шириной 2.5 px со сглаженными краями, а точка замера
      // округляется до физического пикселя — единица остатка нормальна. Отставание на кадр давало
      // под линией примерно ПОЛОВИНУ свечения (замер в дев-превью: 20 из 42), это ловится с запасом.
      t.push({имя:"свечение стёрто ровно под связью, а не рядом",
              ок: рядом > 0 && подЛинией <= Math.max(1, рядом*0.15),
              факт:"под линией " + подЛинией + " из " + рядом + ", профиль " + проф.join(",")});
    }
    a.doing = false;
  }
  view = был;
  S.settings.graphRender = режимДоТеста;
}

/* ===== плотная паутина не дрожит, пока держат ноду =====
   Симптом (КРОЛИК, 2026-07-30): держишь ноду мышью — соседняя жёстко дрожит, пока связь не отвести.
   Виновник — расплетение перекрестий: сила постоянной величины с жёсткой границей «есть крест / нет»
   работала как реле, нода перелетала чужую линию и возвращалась пружинами (см. РЕШЕНИЯ.md).
   Сцена: хаб с десятью детьми плюс хорды между несоседними — именно хорды дают перекрестья, в
   разреженной сцене их не бывает вовсе, и четыре прежние попытки воспроизвести баг мимо этого
   прошли. Рука НЕПОДВИЖНА: с шевелением руки замер мерил слежение хаба за жестом (развороты шли в
   такт синусу), а не дрожь физики. */
{
  /* Сцену ставим В ЦЕНТР МАСС графа и вешаем на область. Иначе замер мерит не то: вдали от центра
     масс стяжка к нему даёт 9.8 px за кадр и тащит кластер к остальному графу вечно (первая версия
     пробы так и не осела), а без области BFS не назначает родителей — и пружина к родителю,
     самая громкая сила в замере КРОЛИКА, вообще не участвует. */
  const цм = graph.nodes.reduce((s,n)=>({x:s.x+n.x/graph.nodes.length, y:s.y+n.y/graph.nodes.length}), {x:0,y:0});
  /* Сцена гоняет тысячу кадров физики и растаскивает ВЕСЬ демо-граф, а он общий для сценариев:
     без возврата позиций следующая проверка («связи расплетаются») стартовала с чужой раскладки
     и краснела — я успел списать это на свою правку физики, пока не сверился с базой. */
  const снимокДемо = S.items.filter(i=>i.x!=null).map(i=>({i, x:i.x, y:i.y}));
  const обл = S.areas[0] ? S.areas[0].id : null;
  const ц = addItem({kind:"task", title:"дрХаб"}); ц.x = цм.x; ц.y = цм.y;
  if (обл) { ц.area = обл; ц.areaAuto = false; }
  const дети = [];
  for (let i = 0; i < 10; i++) { const d = addItem({kind:"task", title:"дрД"+i});
    const a = i/10*Math.PI*2, R = 200 + i*18;
    d.x = цм.x + Math.cos(a)*R; d.y = цм.y + Math.sin(a)*R;
    S.links.push([ц.id, d.id, 1]); дети.push(d); }
  for (let i = 0; i < 10; i++) S.links.push([дети[i].id, дети[(i+4)%10].id, 1]);   // хорды → перекрестья
  recomputeHierarchy(); graph.build();
  const н = graph.byId[ц.id], дн = дети.map(d => graph.byId[d.id]).filter(Boolean);
  if (н && дн.length === 10) {
    graph.alpha = 1;                                   // даём сцене осесть, как оседает живой граф
    for (let i = 0; i < 900 && graph.alpha > 0; i++) graph._tick(true);
    const рука = дн[0], р0 = {x: рука.x, y: рука.y};
    дрожь(true); graph.drag = рука;
    const _л = console.log; console.log = () => {};
    for (let i = 0; i < 55; i++) { рука.x = р0.x; рука.y = р0.y; рука.vx = 0; рука.vy = 0;
      graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    console.log = _л;
    let худшая = null;
    if (graph._dbg) graph._dbg.по.forEach(з => {
      if (з.кадров > 2 && (!худшая || з.разворотов > худшая.разворотов)) худшая = з; });
    graph.drag = null; дрожь(false);
    /* СКОЛЬКО ПЕРЕКРЕСТИЙ ОСТАЛОСЬ, здесь НЕ проверяем, и это осознанно. Сцена стоит в центре масс
       живого демо-графа, физика хаотична, и остаток гулял от 5 до 13 от прогона к прогону: сначала
       порог в 9 покраснел посреди релиза, потом «стало меньше, чем было» покраснело на прогоне, где
       расплетать было уже нечего (5 и 5). Шаткая проверка хуже отсутствующей — она даёт ложные
       тревоги там, где свойство и так закрыто: за расплетение отвечают «связи расплетаются» и
       «ветвистое дерево: связи не пересекаются», обе на маленьких детерминированных сценах.
       Здесь мерим только то, что здесь стабильно: дрожь под неподвижной рукой. */
    t.push({имя:"плотная паутина не дрожит под неподвижной рукой", ок: !!худшая && худшая.разворотов <= 8,
            факт: худшая ? ("худшая «" + худшая.имя + "»: разворотов " + худшая.разворотов + " за " +
                  худшая.кадров + ", шаг средн " + (худшая.сумма/худшая.кадров).toFixed(2) + " px") : "нет записи"});
  }
  [ц, ...дети].forEach(n => hardDeleteItem(n.id));
  снимокДемо.forEach(п => { п.i.x = п.x; п.i.y = п.y; });   // вернуть демо-граф как было
  recomputeHierarchy(); graph.build();
}

/* ===== пауза графа не двигает ноды =====
   Симптом (КРОЛИК, 2026-07-30): при привязке папки ноды чуть дёргаются. Причина не в самой
   привязке: системный диалог выбора папки уводит фокус, слушатель blur зовёт graph.pause(),
   кадры встают. Дыхание считалось прямо от performance.now(), поэтому по возвращении build()
   пересчитывал фазу на новое время — и все ноды разом прыгали (замер в дев-превью: 6.7 px при
   амплитуде 4, потолок — два размаха). Свои часы дыхания идут только по отрисованным кадрам. */
{
  const был = view; view = "notes"; render(); await ж(200);
  if (graph) {
    graph.alpha = 0; graph._tick(true);
    const до = graph.nodes.map(n => ({id:n.id, ix:n._ix||0, iy:n._iy||0, x:n.x, y:n.y}));
    graph.pause();
    await ж(1200);                       // «диалог открыт»: настоящее время идёт, кадры стоят
    graph._paused = false; graph.build();  // вернулись — привязка папки зовёт именно build()
    const м = {}; graph.nodes.forEach(n => м[n.id] = n);
    let скачок = 0, база = 0;
    до.forEach(n => { const b = м[n.id]; if (!b) return;
      скачок = Math.max(скачок, Math.hypot((b._ix||0)-n.ix, (b._iy||0)-n.iy));
      база = Math.max(база, Math.hypot(b.x-n.x, b.y-n.y)); });
    t.push({имя:"после паузы дыхание продолжается, а не прыгает", ок: скачок < 1,
            факт:"скачок дрейфа " + скачок.toFixed(2) + " px за 1.2 с паузы (амплитуда " +
                 (S.settings.graphDrift!=null?S.settings.graphDrift:4) + ")"});
    t.push({имя:"пауза не сдвигает базовые позиции", ок: база < 0.01,
            факт:"сдвиг " + база.toFixed(3) + " px"});

    /* Те же часы ведут дрейф и мерцание звёзд фона, поэтому проверка выше держит и фон:
       «фон чуть дёргается при привязке папки» — это тот же скачок времени.
       А вот СДВИГ ПАРАЛЛАКСА жил на экземпляре Graph и обнулялся на каждый render() (его зовёт
       привязка папки из списка папок, создание ноды, правка области) — звёздное поле съезжало
       на весь накопленный пан. Теперь хранится на уровне модуля, как камера. */
    // сдвиг ставим напрямую: пан средней кнопкой в стенде не эмулируем, проверяем само переживание
    graph.bgPanX = 137; graph.bgPanY = -92;
    if (typeof graphBgPan === "object") { graphBgPan.x = 137; graphBgPan.y = -92; }
    render(); await ж(120);
    t.push({имя:"фон не съезжает при перерисовке графа",
            ок: !!graph && Math.abs(graph.bgPanX-137) < 0.01 && Math.abs(graph.bgPanY+92) < 0.01,
            факт: graph ? "параллакс после render(): " + graph.bgPanX + "," + graph.bgPanY : "графа нет"});
    if (typeof graphBgPan === "object") { graphBgPan.x = 0; graphBgPan.y = 0; }   // не тащим сдвиг в следующие сцены
  }
  view = был;
}

/* ===== крупный узел не дёргается под курсором, но вне драга ездит свободно =====
   Водишь нодой вдоль луча хаба — обратные силы приходят на его конец и складываются, и хаб
   мечется. Предел шага для тяжёлых узлов включается ТОЛЬКО на время перетаскивания: постоянное
   ограничение мешало хабу доехать до равновесия, пока физика не остыла. */
{
  const создать = () => {
    const ц = addItem({kind:"task", title:"хабЦентр"}); ц.x = 8000; ц.y = 8000;
    const ветки = [];
    for (let i = 0; i < 10; i++) { const в = addItem({kind:"task", title:"хабВ"+i});
      const a = i/10*Math.PI*2; в.x = 8000 + Math.cos(a)*260; в.y = 8000 + Math.sin(a)*260;
      S.links.push([ц.id, в.id, 1]); ветки.push(в); }
    const Ж = addItem({kind:"task", title:"хабЖертва"}); Ж.x = 8000; Ж.y = 7850;
    recomputeHierarchy(); graph.build();
    const у = id => graph.byId[id];
    ветки.forEach(в => { if (у(в.id)) у(в.id).fixed = true; });
    return {ц: у(ц.id), Ж: у(Ж.id), ветки: ветки.map(в => у(в.id)), все: [ц, ...ветки, Ж]};
  };

  const с1 = создать();
  if (с1.ц && с1.Ж && с1.ветки[2]) {
    const {ц, Ж} = с1, в = с1.ветки[2];
    graph.drag = Ж;
    const ряд = [];
    for (let i = 0; i < 300; i++) {
      const u = 0.35 + 0.3*Math.sin(i*0.5);
      Ж.x = ц.x + (в.x-ц.x)*u + 3; Ж.y = ц.y + (в.y-ц.y)*u + 3; Ж.vx = 0; Ж.vy = 0;
      graph.alpha = Math.max(graph.alpha, 0.4);
      graph._tick(true);
      ряд.push({x: ц.x, y: ц.y});
    }
    graph.drag = null;
    let максШаг = 0;
    for (let i = 1; i < ряд.length; i++) максШаг = Math.max(максШаг, Math.hypot(ряд[i].x-ряд[i-1].x, ряд[i].y-ряд[i-1].y));
    t.push({имя:"крупный узел не дёргается под курсором", ок: максШаг < 3.5,
            факт:"макс. шаг " + максШаг.toFixed(2) + " px за кадр"});
  }
  с1.все.forEach(n => hardDeleteItem(n.id));

  const с2 = создать();
  if (с2.ц) {
    const g = с2.ц;
    g.x += 800; g.y += 700; g.vx = 0; g.vy = 0;
    graph.alpha = 1;
    for (let i = 0; i < 1500; i++) { graph._tick(true); if (graph.alpha === 0) break; }
    let x = 0, y = 0, n = 0;
    graph.nodes.forEach(v => { if (v !== g && с2.ветки.indexOf(v) >= 0) { x += v.x; y += v.y; n++; } });
    const до = n ? Math.hypot(g.x - x/n, g.y - y/n) : 999;
    t.push({имя:"вне драга тяжёлый узел доезжает до равновесия", ок: до < 60,
            факт:"остановился в " + до.toFixed(0) + " px от центра своих веток"});
  }
  с2.все.forEach(n => hardDeleteItem(n.id));

  /* Главный случай: тащат СОСЕДНЮЮ ноду и давят ею на связь, которая крепится к крупному узлу.
     Толчки приходят на дальний конец каждый кадр, и хаб мелко трясётся — шаг маленький, но
     направление меняется десятки раз. Гасится вязкостью, которая включается только при драге. */
  const с3 = создать();
  if (с3.ц && с3.Ж && с3.ветки[1]) {
    const {ц, Ж} = с3, в = с3.ветки[1];
    const Р = addItem({kind:"task", title:"хабРодительСоседа"}); Р.x = 8300; Р.y = 7750;
    S.links.push([Р.id, Ж.ref.id, 1]);          // у соседа появляется своя связь
    recomputeHierarchy(); graph.build();
    const у = id => graph.byId[id];
    const ц2 = у(ц.ref.id), Ж2 = у(Ж.ref.id), в2 = у(в.ref.id);
    if (ц2 && Ж2 && в2) {
      с3.ветки.forEach(x => { const n = у(x.ref.id); if (n) n.fixed = true; });
      if (у(Р.id)) у(Р.id).fixed = true;
      graph.drag = Ж2;
      const ряд = [];
      for (let i = 0; i < 300; i++) {
        const u = 0.4 + 0.25*Math.sin(i*0.45);
        Ж2.x = ц2.x + (в2.x-ц2.x)*u + 4; Ж2.y = ц2.y + (в2.y-ц2.y)*u + 4; Ж2.vx = 0; Ж2.vy = 0;
        graph.alpha = Math.max(graph.alpha, 0.4);
        graph._tick(true);
        ряд.push({x: ц2.x, y: ц2.y});
      }
      graph.drag = null;
      let макс = 0;
      for (let i = 1; i < ряд.length; i++) макс = Math.max(макс, Math.hypot(ряд[i].x-ряд[i-1].x, ряд[i].y-ряд[i-1].y));
      // до вязкости тот же прогон давал 7.4 px за кадр — порог ловит возврат к дрожи
      t.push({имя:"давят соседней нодой — хаб почти не шевелится", ок: макс < 2.5,
              факт:"макс. шаг " + макс.toFixed(2) + " px за кадр"});
      graph.nodes.forEach(n => n.fixed = false);
    }
    hardDeleteItem(Р.id);
  }
  с3.все.forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== копия ноды не прицепляется к области сама =====
   Флаг «область унаследована» (areaAuto) при копировании терялся, и вставленная нода получала
   область как СВОЮ — а значит и отдельный луч к хабу, которого у оригинала не было. */
{
  const обл = S.areas[0] && S.areas[0].id;
  if (обл) {
    const Р = addItem({kind:"task", title:"копР"}); Р.x = 9000; Р.y = 9000; Р.area = обл; Р.areaAuto = false;
    const Д = addItem({kind:"task", title:"копД"}); Д.x = 9120; Д.y = 9080;
    S.links.push([Р.id, Д.id, 1]);
    recomputeHierarchy(); graph.build();
    const лучей = () => graph.links.filter(l => !l.manual).length;

    // копируем ТОЛЬКО ребёнка, который область наследует
    const было = лучей();
    graph.selNodes = new Set([Д.id]);
    graph.copySelection(); graph.pasteClip();
    recomputeHierarchy();
    const копия = S.items.filter(i => !i.deleted && i.title === "копД" && i.id !== Д.id)[0];
    t.push({имя:"копия унаследованной ноды не липнет к области",
            ок: !!копия && копия.areaAuto !== false && лучей() === было,
            факт:"лучей к хабу было " + было + ", стало " + лучей()});

    // копия ветки целиком: у копии родителя область СВОЯ, у копии ребёнка — унаследованная
    const было2 = лучей();
    graph.selNodes = new Set([Р.id, Д.id]);
    graph.copySelection(); graph.pasteClip();
    recomputeHierarchy();
    const копР = S.items.filter(i => !i.deleted && i.title === "копР" && i.id !== Р.id)[0];
    const копД = S.items.filter(i => !i.deleted && i.title === "копД" && i.id !== Д.id && i.id !== (копия||{}).id)[0];
    t.push({имя:"копия ветки сохраняет, кому область своя, а кому наследуется",
            ок: !!копР && копР.areaAuto !== true && !!копД && копД.areaAuto === true && лучей() === было2 + 1,
            факт:"лучей " + было2 + " -> " + лучей()});

    S.items.filter(i => !i.deleted && /^коп[РД]$/.test(i.title || "")).forEach(i => hardDeleteItem(i.id));
    recomputeHierarchy(); graph.build();
  }
}

/* ===== много выделенных — свечение снимается =====
   У выделенной ноды ДВА drop-shadow, а ноды дрейфуют: браузер пересчитывает размытия каждый
   кадр, и на большом выделении граф ощутимо подлагивал. Заметность даёт геометрия — обводка. */
{
  const свои = [];
  for (let i = 0; i < 32; i++) { const n = addItem({kind:"task", title:"выдел"+i});
    n.x = 12000 + (i%8)*70; n.y = 12000 + Math.floor(i/8)*70; свои.push(n); }
  recomputeHierarchy(); graph.build();
  const тени = () => { const nd = document.querySelector("#graph .g-node.sel .nd");
    return nd ? (getComputedStyle(nd).filter.match(/drop-shadow/g) || []).length : -1; };
  const ids = свои.map(n => n.id).filter(id => graph.byId[id]);
  if (ids.length >= 30) {
    graph.selNodes = new Set(ids.slice(0, 5)); graph._paintSel();
    const мало = тени();
    graph.selNodes = new Set(ids.slice(0, 30)); graph._paintSel();
    const много = тени();
    t.push({имя:"свечение выделения гаснет на большом выделении", ок: мало === 2 && много === 0,
            факт:"теней при 5 выделенных " + мало + ", при 30 — " + много});
  } else {
    t.push({имя:"свечение выделения гаснет на большом выделении", ок:false,
            факт:"ноды не попали в граф: " + ids.length});
  }
  graph.selNodes = new Set(); graph._paintSel();
  свои.forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== камера переживает перезапуск, и у КАЖДОГО графа она СВОЯ =====
   graphCam живёт только в памяти вкладки, поэтому после перезапуска приложения граф открывался
   в стороне от нод. Пишем камеру в настройки (с задержкой — _applyTransform зовётся на каждый
   кадр пана) и поднимаем её при создании графа — СЛОВАРЁМ по id графа (КРОЛИК, 2026-08-12):
   раньше камера была одна на всё приложение, и переключение на другой граф приносило с собой
   чужую камеру — человек видел пустоту или чужой угол дерева, пока не находил, куда делись ноды. */
{
  const было = {tx: graph.tx, ty: graph.ty, zoom: graph.zoom};
  const текГраф = S.settings.graph;
  graph.tx = -1234; graph.ty = 567; graph.zoom = 0.75; graph._applyTransform();
  /* Ждём отложенную запись. Задержка НАРОЧНО длинная (3 с, см. _applyTransform): отправка
     состояния через мост держит поток десятки миллисекунд, и на короткой задержке она прилетала
     ровно тогда, когда человек снова брался за камеру, — тот самый рывок «постоял, двинул». */
  await ж(4300);
  const вНастройках = S.settings.graphCam && S.settings.graphCam[текГраф];
  t.push({имя:"камера графа пишется в настройки, под ключом СВОЕГО графа",
          ок: !!вНастройках && Math.abs(вНастройках.tx + 1234) < 1 && Math.abs(вНастройках.zoom - 0.75) < 0.01,
          факт: JSON.stringify(вНастройках) + " (граф " + текГраф + ")"});

  graphCam = {};                                  // как после перезапуска: память вкладки пуста
  const свежий = new Graph(document.querySelector("#graph"));
  t.push({имя:"камера поднимается при создании графа",
          ок: Math.abs(свежий.tx + 1234) < 1 && Math.abs(свежий.ty - 567) < 1 && Math.abs(свежий.zoom - 0.75) < 0.01,
          факт: "tx " + Math.round(свежий.tx) + ", ty " + Math.round(свежий.ty) + ", zoom " + свежий.zoom.toFixed(2)});
  свежий.destroy();

  /* СУТЬ БАГА: чужая камера в словаре не обязана просачиваться в СВОЙ граф. Кладём заведомо
     другую точку под ЧУЖИМ id (как будто на другом графе раньше стояли в другом месте) и
     проверяем, что граф текГраф её не подхватывает — читает СВОЙ ключ, не чей попало. */
  graphCam["g_тест_чужая_камера"] = {tx: 9999, ty: 9999, zoom: 0.4};
  const свойГраф = new Graph(document.querySelector("#graph"));   // S.settings.graph всё ещё текГраф
  t.push({имя:"у другого графа СВОЯ камера, а не чужая",
          ок: Math.abs(свойГраф.tx + 1234) < 1 && Math.abs(свойГраф.ty - 567) < 1,
          факт: "tx " + Math.round(свойГраф.tx) + ", ty " + Math.round(свойГраф.ty) + " (ждали camera графа " + текГраф + ", не 9999/9999)"});
  свойГраф.destroy();
  delete graphCam["g_тест_чужая_камера"];

  graph.tx = было.tx; graph.ty = было.ty; graph.zoom = было.zoom; graph._applyTransform();
}

// ===== связи стараются не пересекаться =====
{
  const пл = (p,q,r) => (q.x-p.x)*(r.y-p.y) - (q.y-p.y)*(r.x-p.x);
  const крестов = () => { let c = 0;
    for (let i = 0; i < graph.links.length; i++) {
      const a = graph.byId[graph.links[i].a], b = graph.byId[graph.links[i].b]; if (!a || !b) continue;
      for (let j = i+1; j < graph.links.length; j++) {
        const x = graph.byId[graph.links[j].a], y = graph.byId[graph.links[j].b]; if (!x || !y) continue;
        if (a===x || a===y || b===x || b===y) continue;
        if ((пл(x,y,a)>0) !== (пл(x,y,b)>0) && (пл(a,b,x)>0) !== (пл(a,b,y)>0)) c++;
      } }
    return c; };

  // заведомое перекрестье: две связи крест-накрест
  const A = addItem({kind:"note", title:"крестA"}), B = addItem({kind:"note", title:"крестB"});
  const C = addItem({kind:"note", title:"крестC"}), D = addItem({kind:"note", title:"крестD"});
  /* Координаты нужны ДВАЖДЫ. Элементам — до build: мысль без x/y считается неразобранной,
     уходит в лоток и в граф не попадает вовсе. Узлам графа — после build: там своя раскладка,
     и заданное перекрестье до физики иначе не доживает. */
  /* Ставим крест РЯДОМ с графом, а не в стороне: предыдущая проверка уводит граф на +2500,
     и далёкий крест сильнее тянуло бы к центру масс, чем расплетало. Меряем силу расплетения,
     а не борьбу с притяжением. */
  let цx = 0, цy = 0;
  graph.nodes.forEach(n => { цx += n.x; цy += n.y; });
  цx = цx / (graph.nodes.length || 1) + 700; цy = цy / (graph.nodes.length || 1) + 700;
  A.x = цx;       A.y = цy;       B.x = цx + 200; B.y = цy + 200;
  C.x = цx;       C.y = цy + 200; D.x = цx + 200; D.y = цy;
  S.links.push([A.id,B.id,1],[C.id,D.id,1]);
  recomputeHierarchy(); graph.build();
  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && у(C.id) && у(D.id)) {
    у(A.id).x=цx;     у(A.id).y=цy;     у(B.id).x=цx+200; у(B.id).y=цy+200;
    у(C.id).x=цx;     у(C.id).y=цy+200; у(D.id).x=цx+200; у(D.id).y=цy;
    [A,B,C,D].forEach(n => { у(n.id).vx=0; у(n.id).vy=0; });
  }
  const до = крестов();
  graph.alpha = 0.8;
  for (let i = 0; i < 300; i++) graph._tick(true);
  const после = крестов();
  t.push({имя:"связи расплетаются", ок: после < до, факт:"пересечений было " + до + ", стало " + после});
  [A,B,C,D].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== стресс: ветвистое дерево раскладывается без каши =====
   Проблема вылезла именно на разросшемся графе: у узла с десятком детей место было такое же,
   как у листа, дети толпились вплотную к соседним веткам и лезли на чужие линии. Держим здесь
   реальную форму (центр → 6 веток → по 4 листа) и меряем ДВЕ вещи: пересечения связей и ноды,
   лежащие на чужих линиях. */
{
  const созданы = [];
  const центр = addItem({kind:"task", title:"стрессЦентр"}); центр.x = 4000; центр.y = 4000; созданы.push(центр);
  for (let b = 0; b < 6; b++) {
    const ветка = addItem({kind:"task", title:"стрессВетка"+b});
    ветка.x = 4000 + Math.cos(b)*120; ветка.y = 4000 + Math.sin(b)*120; ветка.parent = центр.id;
    S.links.push([центр.id, ветка.id, 1]); созданы.push(ветка);
    for (let k = 0; k < 4; k++) {
      const лист = addItem({kind:"task", title:"стрессЛист"+b+"_"+k});
      лист.x = ветка.x + Math.cos(k)*40; лист.y = ветка.y + Math.sin(k)*40; лист.parent = ветка.id;
      S.links.push([ветка.id, лист.id, 1]); созданы.push(лист);
    }
  }
  recomputeHierarchy(); graph.build();

  /* Меряем ТОЛЬКО своё дерево: на холсте живут ещё демо-ноды и следы прошлых проверок,
     и общий счёт приписывал бы стресс-тесту чужие перекрестья. */
  const свои = new Set(созданы.map(n => n.id));
  const пл = (p,q,r) => (q.x-p.x)*(r.y-p.y) - (q.y-p.y)*(r.x-p.x);
  const метрики = () => {
    const св = graph.links.filter(l => свои.has(l.a) && свои.has(l.b));
    const уз = graph.nodes.filter(n => свои.has(n.id));
    let крестов = 0, наЛинии = 0;
    for (let i = 0; i < св.length; i++) {
      const a = graph.byId[св[i].a], b = graph.byId[св[i].b]; if (!a || !b) continue;
      for (let j = i+1; j < св.length; j++) {
        const x = graph.byId[св[j].a], y = graph.byId[св[j].b]; if (!x || !y) continue;
        if (a===x || a===y || b===x || b===y) continue;
        if ((пл(x,y,a)>0) !== (пл(x,y,b)>0) && (пл(a,b,x)>0) !== (пл(a,b,y)>0)) крестов++;
      }
      уз.forEach(n => { if (n===a || n===b) return;
        const ex = b.x-a.x, ey = b.y-a.y, L2 = ex*ex+ey*ey || 1;
        let t = ((n.x-a.x)*ex + (n.y-a.y)*ey) / L2; t = Math.max(0, Math.min(1, t));
        // допуск 2 px: узел асимптотически подходит к границе зазора, упираясь в пружины
        if (Math.hypot(n.x-(a.x+ex*t), n.y-(a.y+ey*t)) < n.r + 16) наЛинии++;
      });
    }
    return {крестов, наЛинии};
  };

  const до = метрики();
  graph.alpha = 1;
  for (let i = 0; i < 600; i++) graph._tick(true);
  const после = метрики();
  t.push({имя:"ветвистое дерево: связи не пересекаются", ок: после.крестов === 0,
          факт: "перекрестий было " + до.крестов + ", стало " + после.крестов});
  t.push({имя:"ветвистое дерево: ноды сходят с чужих связей", ок: после.наЛинии === 0,
          факт: "на линиях было " + до.наЛинии + ", стало " + после.наЛинии});

  // раскладка не должна разлетаться: 31 нода в разумных пределах
  const мои = graph.nodes.filter(n => свои.has(n.id));
  const xs = мои.map(n => n.x), ys = мои.map(n => n.y);
  const охват = Math.max(Math.max(...xs)-Math.min(...xs), Math.max(...ys)-Math.min(...ys));
  t.push({имя:"раскладка не разлетается", ок: охват < 4000, факт: "охват " + Math.round(охват) + " px"});

  созданы.forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== мягкая связь: линия обходит ноду, которая на ней лежит =====
   Физика разводит узлы, только пока не остыла, и на плотном дереве часть случаев ей не по силам.
   Прогиб — подстраховка: он виден сразу, ни одной ноды не двигает и тает по мере ухода помехи. */
{
  // Проверка читает геометрию через SVG-элемент связи (getTotalLength/getPointAtLength) —
  // в canvas-режиме (дефолт с 2026-08-11) graph.linkEls пуст вовсе, элементов не создаётся.
  // Сама математика прогиба (_recalcBends/_bendC) от режима рендера не зависит — заставляем
  // SVG только ради инструмента измерения, дефолт приложения этим не проверяем и не меняем.
  const режимДоТеста = S.settings.graphRender;
  S.settings.graphRender = "svg";
  const A = addItem({kind:"task", title:"дугаA"}); A.x = -3300; A.y = -3000;
  const B = addItem({kind:"task", title:"дугаB"}); B.x = -2700; B.y = -3000;
  const П = addItem({kind:"task", title:"дугаПомеха"}); П.x = -3000; П.y = -2994;
  S.links.push([A.id, B.id, 1]);
  recomputeHierarchy(); graph.build();

  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && у(П.id)) {
    graph.nodes.forEach(n => n.fixed = true);          // проверяем ОТРИСОВКУ, не физику
    у(A.id).x = -3300; у(A.id).y = -3000; у(B.id).x = -2700; у(B.id).y = -3000;
    const св = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const эл = graph.linkEls[graph.links.indexOf(св)];
    const доКривой = (px, py) => { const L = эл.getTotalLength(); let m = 1e9;
      for (let i = 0; i <= 60; i++) { const p = эл.getPointAtLength(L*i/60); m = Math.min(m, Math.hypot(p.x-px, p.y-py)); }
      return m; };

    /* Прогиб инерционный (см. _easeBends), поэтому и появляется, и тает не мгновенно —
       прокручиваем кадры, а заодно меряем, нет ли рывков. */
    const прокрутить = n => { const шаги = [];
      for (let i = 0; i < n; i++) { graph._recalcBends(); graph._tick(true);
        шаги.push(св._bendC ? св._bendC.oy : 0); }
      let макс = 0;
      for (let i = 1; i < шаги.length; i++) макс = Math.max(макс, Math.abs(шаги[i] - шаги[i-1]));
      return макс; };

    у(П.id).x = -3000; у(П.id).y = -2994;              // почти на линии
    graph.alpha = 0;
    const рывокПоявления = прокрутить(60);
    const зазор = у(П.id).r + 16;
    t.push({имя:"связь обходит лежащую на ней ноду",
            ок: доКривой(у(П.id).x, у(П.id).y) >= зазор && /Q/.test(эл.getAttribute("d")),
            факт:"до кривой " + доКривой(у(П.id).x, у(П.id).y).toFixed(1) + " при зазоре " + зазор.toFixed(1)});
    t.push({имя:"прогиб нарастает без рывков", ок: рывокПоявления < 6,
            факт:"макс. шаг " + рывокПоявления.toFixed(2) + " px за кадр"});

    /* Дуга обязана считаться по ТЕМ ЖЕ координатам, по которым рисуется (с дрейфом). Пока это
       было не так, расстояние от НЕПОДВИЖНОЙ ноды до линии гуляло на 10 px — в тесном месте
       читалось как дрожание. Ноды тут зафиксированы, значит двигаться может только дрейф. */
    const ряд = [];
    for (let i = 0; i < 120; i++) { graph._tick(true);
      const L = эл.getTotalLength(); let m = 1e9;
      const nx = у(П.id).x + (у(П.id)._ix || 0), ny = у(П.id).y + (у(П.id)._iy || 0);
      for (let k = 0; k <= 30; k++) { const p = эл.getPointAtLength(L*k/30); m = Math.min(m, Math.hypot(p.x-nx, p.y-ny)); }
      ряд.push(m); }
    const размах = Math.max(...ряд) - Math.min(...ряд);
    t.push({имя:"дуга не гуляет от дрейфа", ок: размах < 1.5,
            факт:"размах расстояния до линии " + размах.toFixed(2) + " px"});

    у(П.id).y = -2940;                                  // помеха ушла
    const рывокУхода = прокрутить(80);
    t.push({имя:"без помехи связь снова прямая",
            ок: /L/.test(эл.getAttribute("d")) && !св._bendC, факт: эл.getAttribute("d")});
    t.push({имя:"прогиб тает без рывков", ок: рывокУхода < 6,
            факт:"макс. шаг " + рывокУхода.toFixed(2) + " px за кадр"});

    /* Перестроение графа (смена статуса задачи, цвета, новая связь) не должно распрямлять дуги:
       массив связей пересоздаётся целиком, и накопленный прогиб терялся — все линии отрастали
       заново, что читалось как рывок. Проверяем ПОСЛЕДНЕЙ: build() делает прежние ссылки на
       связь и её элемент недействительными. */
    у(П.id).y = -2994;                                  // помеха вернулась, дуга отросла
    прокрутить(60);
    const доBuild = св._bendC ? св._bendC.oy : 0;
    graph.build();
    const св2 = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const послеBuild = (св2 && св2._bendC) ? св2._bendC.oy : 0;
    t.push({имя:"перестроение не распрямляет дуги",
            ок: Math.abs(доBuild) > 1 && Math.abs(доBuild - послеBuild) < 2,
            факт:"прогиб " + доBuild.toFixed(1) + " -> " + послеBuild.toFixed(1)});
    graph.nodes.forEach(n => n.fixed = false);
  }
  [A, B, П].forEach(n => hardDeleteItem(n.id));
  S.settings.graphRender = режимДоТеста;
  recomputeHierarchy(); graph.build();
}

/* ===== свечение «в работе» вырезается по ФОРМЕ связи, включая прогиб =====
   Свечение стирается из-под линий, чтобы те не просвечивали. Пока вырез шёл по прямой, а связь
   гнулась, на светящейся ноде оставалась тёмная полоса по хорде: свечение стёрто, а линии там нет. */
{
  const A = addItem({kind:"task", title:"свечА", status:"doing"}); A.x = 260; A.y = 280;
  const B = addItem({kind:"task", title:"свечБ"}); B.x = 420; B.y = 280;   // коротко: связь внутри радиуса свечения
  const П = addItem({kind:"task", title:"свечП"}); П.x = 340; П.y = 284;
  S.links.push([A.id, B.id, 1]);
  recomputeHierarchy(); graph.build();

  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && graph.glowCtx) {
    graph.nodes.forEach(n => n.fixed = true);
    у(A.id).x = 260; у(A.id).y = 280; у(B.id).x = 420; у(B.id).y = 280; у(П.id).x = 340; у(П.id).y = 284;
    graph.alpha = 0; graph.tx = 0; graph.ty = 0; graph.zoom = 1;
    for (let i = 0; i < 80; i++) graph._tick(true);
    graph._drawGlow();

    const cv = graph.glowCanvas, ctx = graph.glowCtx, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const альфа = (wx, wy) => { const x = Math.round(wx*dpr), y = Math.round(wy*dpr);
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return -1;
      return ctx.getImageData(x, y, 1, 1).data[3]; };
    const св = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const bd = св && св._bendC;
    if (bd) {
      const px = 260 + 160*bd.t, cx = px + bd.ox*2, cy = 280 + bd.oy*2;
      const вершина = {x: (260 + 2*cx + 420)/4, y: (280 + 2*cy + 280)/4};
      t.push({имя:"свечение вырезано ПОД дугой, а не под хордой",
              ок: альфа(вершина.x, вершина.y) === 0 && альфа(вершина.x, 280) > 0,
              факт:"на дуге " + альфа(вершина.x, вершина.y) + ", на хорде " + альфа(вершина.x, 280)});
    } else {
      t.push({имя:"свечение вырезано ПОД дугой, а не под хордой", ок:false, факт:"связь не прогнулась"});
    }
    graph.nodes.forEach(n => n.fixed = false);
  }
  [A, B, П].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

// ===== поиск: связи гаснут вместе с нодами и возвращают свою яркость =====
{
  const цель = S.items.filter(i => !i.deleted && i.kind !== "flow")[0];
  const было = цель.title;
  цель.title = "ЛовушкаПоиска"; graph.build();
  const база = [...document.querySelectorAll("#graph-wrap .g-link")].map(e => e.style.opacity);
  graph.search("ЛовушкаПоиска");
  const приПоиске = [...document.querySelectorAll("#graph-wrap .g-link")].map(e => +e.style.opacity);
  /* Яркость связи задана ИНЛАЙНОМ (из настроек), а инлайн сильнее класса — поэтому .g-link.dim
     сам по себе ничего не гасил, и линии оставались яркими поверх приглушённых нод. */
  t.push({имя:"при поиске гаснут и связи", ок: приПоиске.every(o => o <= 0.15),
          факт: "прозрачности: " + [...new Set(приПоиске)].join(", ")});
  t.push({имя:"найденное подсвечено", ок: document.querySelectorAll("#graph-wrap .g-node.hit").length === 1,
          факт: "подсвечено: " + document.querySelectorAll("#graph-wrap .g-node.hit").length});
  /* Наведение мышью НЕ должно стирать гашение поиска: при курсоре вне ноды _hover получает
     id=null и раньше снимал dim со всех нод разом — граф «загорался» от движения мышью. */
  graph._hover(null);
  t.push({имя:"наведение не стирает гашение поиска",
          ок: document.querySelectorAll("#graph-wrap .g-node.dim").length > 0,
          факт: "погашено нод: " + document.querySelectorAll("#graph-wrap .g-node.dim").length});

  graph.closeSearch();
  graph._hover(null);
  t.push({имя:"после поиска подсветка наведением снова работает",
          ок: document.querySelectorAll("#graph-wrap .g-node.dim").length === 0, факт:""});
  const после = [...document.querySelectorAll("#graph-wrap .g-link")].map(e => e.style.opacity);
  t.push({имя:"после поиска возвращается ЗАДАННАЯ яркость связей",
          ок: JSON.stringify(база) === JSON.stringify(после),
          факт: "было " + [...new Set(база)].join(",") + " стало " + [...new Set(после)].join(",")});
  цель.title = было; graph.build();
}

/* СТАТУСЫ «в работе» и «на паузе» ставятся на ВСЁ выделение — как цвет: тыкать по одной ноде
   грустно. Кликнутая нода не в выделении — меняется только она (ПКМ выделения не трогает).
   «На паузе» — третье состояние: видно, но читается как остановленное, а не как активное. */
{
  const а=addItem({kind:"task", title:"ст-А"}), б=addItem({kind:"task", title:"ст-Б"}),
        в=addItem({kind:"task", title:"ст-В"}), г=addItem({kind:"task", title:"ст-Г"});
  [а,б,в,г].forEach((it,i)=>{ it.x=260+i*70; it.y=260; });
  persist(); render(); await ж(600);
  const узел=id=>graph.nodes.find(n=>n.id===id);

  graph.selNodes=new Set([а.id,б.id,в.id]);
  graph._setStatus(узел(а.id),"doing"); await ж(400);
  t.push({имя:"«в работу» применяется ко всему выделению",
          ок: а.status==="doing" && б.status==="doing" && в.status==="doing" && г.status!=="doing",
          факт:[а,б,в,г].map(x=>x.title+":"+x.status).join(" ")});

  // клик по ноде ВНЕ выделения меняет только её
  graph._setStatus(узел(г.id),"paused"); await ж(400);
  t.push({имя:"нода вне выделения меняет статус одна",
          ок: г.status==="paused" && а.status==="doing" && б.status==="doing",
          факт:[а,б,г].map(x=>x.title+":"+x.status).join(" ")});

  graph.selNodes=new Set([а.id,б.id]);
  graph._setStatus(узел(а.id),"paused"); await ж(400);
  t.push({имя:"«на паузу» тоже идёт на всё выделение",
          ок: а.status==="paused" && б.status==="paused" && в.status==="doing",
          факт:[а,б,в].map(x=>x.title+":"+x.status).join(" ")});

  const эл=id=>document.querySelector('.g-node[data-id="'+id+'"]');
  // выделение снимаем: у выделенной ноды свой контур (толстый, сплошной), и пунктир паузы
  // под ним не виден — проверять надо обычный вид, а не подсвеченный
  graph.selNodes=new Set(); graph._paintSel(); await ж(200);
  const пауза=эл(а.id);
  {
    const кл=пауза?пауза.getAttribute("class"):"";
    const усл={
      естьУзел: !!пауза,
      классПаузы: /paused/.test(кл),
      кольцо: !!(пауза&&пауза.querySelector(".g-halo-pause")),
      тусклее: пауза ? +getComputedStyle(пауза).opacity < 1 : false,
      ярчеЗавершённой: пауза ? +getComputedStyle(пауза).opacity > 0.5 : false,
      пунктир: пауза&&пауза.querySelector(".nd")
               ? getComputedStyle(пауза.querySelector(".nd")).strokeDasharray!=="none" : false
    };
    t.push({имя:"нода на паузе видна, но не как активная",
            ок: Object.values(усл).every(Boolean),
            факт: Object.keys(усл).map(k=>k+":"+усл[k]).join(", ")});
  }

  /* ТУМБЛЕРА БОЛЬШЕ НЕТ (2026-09-01). Раньше повторное нажатие снимало статус, и это ломалось
     на выделении: «был» читался с кликнутой ноды, поэтому клик по уже работающей ноде уводил
     ВСЮ пачку в «не начато». Теперь это выбор из списка: повторный клик ничего не меняет,
     а снимает статус явный клик по нейтрали (она же первая в ряду иконок). */
  graph.selNodes=new Set();
  graph._setStatus(узел(в.id),"doing"); await ж(300);
  t.push({имя:"повторное нажатие статус НЕ снимает", ок: в.status==="doing", факт:"ст-В: "+в.status});
  graph._setStatus(узел(в.id),"__neutral__"); await ж(300);
  t.push({имя:"нейтраль снимает статус задачи в «не начато»", ок: в.status==="todo", факт:"ст-В: "+в.status});

  /* ПАЧКА НЕ УЛЕТАЕТ В НЕЙТРАЛЬ. Тот самый случай, ради которого тумблер и убрали: кликаем по
     ноде, которая УЖЕ в нужном статусе, и ждём, что вся пачка встанет в него же. */
  а.status="doing"; б.status="paused"; в.status="todo"; persist(); render(); await ж(300);
  graph.selNodes=new Set([а.id,б.id,в.id]);
  graph._setStatus(узел(а.id),"doing"); await ж(400);
  t.push({имя:"клик по уже активному статусу не сбрасывает пачку",
          ок: а.status==="doing" && б.status==="doing" && в.status==="doing",
          факт:[а,б,в].map(x=>x.title+":"+x.status).join(" ")});

  /* ЗАВЕРШЁННУЮ ВОЗВРАЩАЕТ ЛЮБОЙ СТАТУС. В ряду иконок нет кнопки «Вернуть» — есть активная
     «Готово», поэтому клик по другому значению обязан сам снять завершённость: иначе на пачку
     из десяти закрытых рендеров ушло бы двадцать кликов вместо десяти. */
  toggleDone(г); persist(); render(); await ж(400);
  graph.selNodes=new Set();
  graph._setStatus(узел(г.id),"doing"); await ж(400);
  t.push({имя:"клик по статусу снимает завершённость одним движением",
          ок: !г.done && г.status==="doing" && г.doneAt==null,
          факт:"ст-Г: done="+г.done+", статус "+г.status+", doneAt="+г.doneAt});
  toggleDone(г); persist(); render(); await ж(300);   // возвращаем в «готово» для проверок ниже
  // и сама завершённая не носит признаков работы: ни паузы, ни «в работе» (иначе тухнет и светится разом)
  {
    const уГ=graph.nodes.find(n=>n.id===г.id);
    t.push({имя:"завершённая нода не считается ни работой, ни паузой",
            ок: !!уГ && !уГ.paused && !уГ.doing,
            факт: уГ ? ("done="+уГ.done+", doing="+уГ.doing+", paused="+уГ.paused) : "узла нет"});
  }

  /* ЗАВЕРШЁННАЯ ВЕТКА НЕ СВЕТИТСЯ ПАУЗОЙ ИЗНУТРИ (КРОЛИК, 2026-08-21: «если задача завершена,
     она не может оставаться на паузе», «свечение вижу»). Своя завершённость есть только у задачи,
     а заметка тухнет ОТ РОДИТЕЛЯ — и продолжала носить собственный статус «на паузе»: серый блоб
     в слое свечения, кольцо и пунктир внутри закрытого проекта. Статус в данных при этом обязан
     остаться: вернут задачу в работу — вернётся и пауза. */
  {
    // область у проекта — СВОЯ: без неё BFS не назначает родителей, и заметка не потухнет вовсе
    const обл=S.areas[0] ? S.areas[0].id : null;
    const пр=addItem({kind:"task", title:"пауза-проект"}); пр.x=520; пр.y=520;
    if(обл){ пр.area=обл; пр.areaAuto=false; }
    const зам=addItem({kind:"note", title:"пауза-заметка"}); зам.x=600; зам.y=600;
    addLink(пр.id, зам.id); зам.status="paused";
    recomputeHierarchy(); persist(); render(); await ж(400);
    const уз=()=>graph.nodes.find(n=>n.id===зам.id);
    const наПаузе=()=>{ const у=уз(); return !!(у && у.paused); };
    const доЗавершения=наПаузе();
    toggleDone(пр); recomputeHierarchy(); render(); await ж(400);
    const послеЗавершения=наПаузе(), потухла=!!(уз() && уз().archived);
    const вСвечении=graph.nodes.filter(n=>n.paused).some(n=>n.id===зам.id);
    toggleDone(пр); recomputeHierarchy(); render(); await ж(400);
    t.push({имя:"заметка в завершённой ветке не светится паузой",
            ок: доЗавершения && потухла && !послеЗавершения && !вСвечении,
            факт:"до завершения пауза "+доЗавершения+", после — "+послеЗавершения+
                 " (потухла "+потухла+", в слое свечения "+вСвечении+")"});
    t.push({имя:"статус при этом сохранён и возвращается вместе с веткой",
            ок: зам.status==="paused" && наПаузе(),
            факт:"в данных "+зам.status+", на узле "+наПаузе()});
    [пр,зам].forEach(x=>hardDeleteItem(x.id));
    recomputeHierarchy(); render(); await ж(200);
  }

  /* НОВЫЕ СТАТУСЫ И ЗАМЕТКА «В РАБОТЕ» (2026-09-01). Заметке статусы ставились всегда (кнопка
     «На паузу» есть у любого вида, а групповая смена пишет во всё выделение), но показывался
     только `paused`: условие «в работе» требовало kind==="task". Отсюда живой перекос — четыре
     заметки «в работе» на графе были невидимы. Проверяем, что признаки считаются одинаково. */
  {
    const зд=addItem({kind:"task", title:"ждёт-ферму"}); зд.x=340; зд.y=420;
    const оч=addItem({kind:"task", title:"на-очереди"}); оч.x=420; оч.y=420;
    const зам=addItem({kind:"note", title:"заметка-в-работе"}); зам.x=500; зам.y=420;
    зд.status="waiting"; оч.status="next"; зам.status="doing";
    persist(); render(); await ж(400);
    const у=id=>graph.nodes.find(n=>n.id===id)||{};
    t.push({имя:"«ждёт» и «на очереди» дают свои флаги узла",
            ок: у(зд.id).waiting===true && у(оч.id).next===true,
            факт:"ждёт="+у(зд.id).waiting+", очередь="+у(оч.id).next});
    t.push({имя:"заметка «в работе» показывается на графе, как и «на паузе»",
            ок: у(зам.id).doing===true,
            факт:"doing у заметки="+у(зам.id).doing});
    /* НЕЙТРАЛЬ ЗАВИСИТ ОТ ВИДА. Раньше сброс был зашит литералом "todo" для любого вида, и
       заметка становилась «не начатой» задачей — так в живом файле набралось 15 таких нод. */
    graph.selNodes=new Set();
    graph._setStatus(у(зам.id),"__neutral__"); await ж(300);
    t.push({имя:"нейтраль заметки — «заметка», а не «не начато»",
            ок: зам.status==="note", факт:"статус заметки: "+зам.status});
    [зд,оч,зам].forEach(x=>hardDeleteItem(x.id));
    render(); await ж(200);
  }

  /* СРОК И ЖАР НА НОДЕ. Число дней считает build (в кадре разбирать строку даты — 245 вызовов
     parseYmd на кадр), горящие отбираются там же с двумя защитами: порогом и проверкой на
     вырожденность (иначе на импорте без сроков подсветятся пять случайных нод). */
  {
    const гор=addItem({kind:"task", title:"горящая"}); гор.x=360; гор.y=520;
    гор.due=ymd(addDays(today(),-4)); гор.priority=3; гор.status="doing";
    const тих=addItem({kind:"task", title:"тихая"}); тих.x=440; тих.y=520;
    persist(); render(); await ж(400);
    const у=id=>graph.nodes.find(n=>n.id===id)||{};
    t.push({имя:"узел несёт число дней до срока", ок: у(гор.id).дней===-4, факт:"дней="+у(гор.id).дней});
    t.push({имя:"просроченная и важная задача попадает в горящие",
            ок: !!у(гор.id).жар && у(гор.id).ранг===1,
            факт:"жар="+у(гор.id).жар+", ранг="+у(гор.id).ранг});
    t.push({имя:"свежая пустая задача не горит", ок: !у(тих.id).жар, факт:"жар="+у(тих.id).жар});
    // вырожденный отбор: десяток одинаковых пустых задач не даёт ни одной горящей
    const пусто=[]; for(let i=0;i<10;i++) пусто.push({kind:"task", status:"todo", updated:Date.now()});
    t.push({имя:"одинаковые пустые задачи не дают горящих",
            ок: отобратьГорящие(пусто,8).length===0, факт:"их "+отобратьГорящие(пусто,8).length});
    [гор,тих].forEach(x=>hardDeleteItem(x.id));
    render(); await ж(200);
  }

  [а,б,в,г].forEach(x=>hardDeleteItem(x.id));
  graph.selNodes=new Set(); render(); await ж(300);
}

/* ALT-ПРОТЯЖКА — ЖЕСТ ПРО СВЯЗЬ, А НЕ ПРО ОБЛАСТЬ. Стоило один раз щёлкнуть по области в
   полосе слева (это включает фильтр), и каждая нода, вытянутая Alt-ом от родителя, молча
   приписывалась к той области — а дети наследовали это дальше по ветке. С пустого же места
   холста фильтр работать обязан: человек смотрит область, туда и кладёт. */
{
  const обл={id:"a_жест", name:"Жестовая", icon:"ti-home"};
  S.areas.push(обл); persist(); renderNav(); await ж(200);
  /* Фильтр включаем ТЕМ ЖЕ ПУТЁМ, что и человек — кликом по области в полосе. Присваивать
     areaFilter из сценария бесполезно: это let модуля, а не свойство window. */
  const кнопкаОбл=[...document.querySelectorAll("#areas .areai")].find(b=>b.dataset.area==="a_жест");
  if(кнопкаОбл) кнопкаОбл.click();
  await ж(400);

  const закрытьВвод=async()=>{ const inp=document.querySelector(".g-inline");
    if(inp){ inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})); } await ж(150); };
  /* Созданную ноду находим по НОВОМУ id: по координатам нельзя (физика графа сдвигает ноду
     сразу после build), по «последней в списке» — тоже, порядок в S.items не гарантирован. */
  const новая=async(вызов)=>{ const было=new Set(S.items.map(i=>i.id)); вызов(); await ж(250);
    await закрытьВвод(); return S.items.find(i=>!было.has(i.id))||{}; };
  const сПустогоМеста=await новая(()=>graph._quickAdd("note", 520, 360, null));
  t.push({имя:"нода с пустого места попадает в выделенную область",
          ок: сПустогоМеста.area==="a_жест", факт:"область: "+(сПустогоМеста.area||"нет")});

  // а вот протяжка Alt от ноды область назначать не должна
  const свободная=addItem({kind:"note", title:"родитель без области"});
  свободная.x=300; свободная.y=300; свободная.area=null; persist();
  const дочерняя=await новая(()=>graph._quickAdd("note", 380, 340, свободная.id));
  t.push({имя:"Alt-протяжка от ноды не приписывает область из фильтра",
          ок: !дочерняя.area,
          факт:"область у дочерней: "+(дочерняя.area||"нет")+" (фильтр стоял на «Жестовой»)"});
  t.push({имя:"связь с родителем при этом создаётся",
          ок: S.links.some(l=>(l[0]===свободная.id&&l[1]===дочерняя.id)||(l[1]===свободная.id&&l[0]===дочерняя.id)),
          факт:"связей всего: "+S.links.length});

  if(кнопкаОбл) { const снова=[...document.querySelectorAll("#areas .areai")].find(b=>b.dataset.area==="a_жест"); if(снова) снова.click(); }
  await ж(200);
  [сПустогоМеста.id, свободная.id, дочерняя.id].filter(Boolean).forEach(id=>hardDeleteItem(id));
  S.areas=S.areas.filter(x=>x.id!=="a_жест"); persist(); render(); await ж(200);
}

/* ПЕРЕНОС ВЕТКИ. Тянешь ноду — за ней должна идти вся её ветка, но ФИЗИКОЙ: ближние догоняют
   почти сразу, дальние провисают. Жёсткая привязка (ветка приклеена к руке) выглядела мёртвой,
   а без неё связи растягивались через пол-экрана и дети ползли секундами. Область тянет свои
   ноды по тому же правилу: у хаба своих детей в остове нет, ветку ему собирают по членству. */
{
  S.areas.push({id:"a_ветка", name:"Веточная", icon:"ti-home"});
  const корень=addItem({kind:"note", title:"корень ветки", area:"a_ветка"});
  корень.x=0; корень.y=0;
  let слой=[корень], всего=0;
  while(всего<12){ const нов=[];
    for(const p of слой){ for(let i=0;i<3 && всего<12;i++){
      const n=addItem({kind:"note", title:"в"+всего, area:"a_ветка"});
      n.x=p.x+60+i*30; n.y=p.y+60; addLink(p.id,n.id); нов.push(n); всего++; }}
    слой=нов; }
  persist(); recomputeHierarchy(); render(); await ж(600);

  const узел=graph.byId[корень.id];
  const ветка=graph._ветка(узел);
  t.push({имя:"у ноды находится её ветка", ок: ветка.length>=6,
          факт:"нод в ветке: "+ветка.length});

  /* Ветку тащат ФИЗИКОЙ, а не жёсткой привязкой: КРОЛИК отверг и приклеенную ветку («топорно»),
     и отдельные пружины шлейфа. Осталось одно правило — дети держат расстояние до родителя,
     и держат его ЖЁСТЧЕ прежнего. Значит хвост обязан заметно идти следом, но отставать. */
  /* ЧТО ИМЕННО ЗДЕСЬ МЕРИТСЯ (переписано 2026-08-20). Раньше проверка требовала, чтобы хвост
     прошёл 12–98% пути руки ПРЯМО ВО ВРЕМЯ протяжки, и она проходила — но не потому, что ветку
     тянули пружины. До островов (см. build/_остров) вся раскладка сжималась к ОДНОМУ центру масс,
     и хвост ехал вместе со всем графом: замер в этой самой сцене — хвост +111 px, а посторонние
     ноды −63 px, то есть НАВСТРЕЧУ ему, обе стороны просто сходились. В изолированной сцене
     догон был 0% и до правки, и после — пружины во время протяжки хвост почти не двигают, его
     держат вязкость и предел шага под рукой (см. MX в _tick).
     Настоящее свойство физики другое: отпустил — ветка стягивается к уехавшей ноде (замер:
     340 → 175 px). Его и проверяем, плюс что под рукой ветка ОТСТАЁТ, а не приклеена. */
  const хвост=ветка[ветка.length-1].n, х0=хвост.x, у0=узел.x;
  const дист=()=>Math.hypot(хвост.x-узел.x, хвост.y-узел.y);
  graph.drag=узел;
  for(let i=0;i<40;i++){ узел.x+=12; graph.alpha=Math.max(graph.alpha,.4); graph._tick(true); }
  const догон=(хвост.x-х0)/(узел.x-у0);
  graph.drag=null;
  const растянуто=дист();
  for(let i=0;i<300;i++){ graph.alpha=Math.max(graph.alpha,.4); graph._tick(true); }
  const собралось=дист();
  t.push({имя:"под рукой ветка отстаёт, а не приклеена",
          ок: догон<0.5, факт:"хвост прошёл "+Math.round(догон*100)+"% пути ноды"});
  t.push({имя:"после отпускания ветка стягивается к уехавшей ноде",
          ок: собралось < растянуто*0.8,
          факт:"хвост↔нода "+Math.round(растянуто)+" → "+Math.round(собралось)+" px"});

  // область: хаб тянет ноды своей области
  const хаб=graph.nodes.find(n=>n.hubArea && n.hubArea.id==="a_ветка");
  if(хаб){
    const вх=graph._ветка(хаб);
    t.push({имя:"у области ветка — её ноды", ок: вх.length>=12, факт:"нод: "+вх.length});
    // мерим тем же способом, что и ветку ноды выше: под рукой отставание, после отпускания — сбор
    const проба=вх[0].n;
    const дистО=()=>Math.hypot(проба.x-хаб.x, проба.y-хаб.y);
    graph.drag=хаб;
    for(let i=0;i<40;i++){ хаб.x+=12; graph.alpha=Math.max(graph.alpha,.4); graph._tick(true); }
    graph.drag=null;
    const растянутоО=дистО();
    for(let i=0;i<300;i++){ graph.alpha=Math.max(graph.alpha,.4); graph._tick(true); }
    t.push({имя:"после отпускания ноды подтягиваются за областью",
            ок: дистО() < растянутоО*0.8,
            факт:"нода↔область "+Math.round(растянутоО)+" → "+Math.round(дистО())+" px"});
  }

  // вес ветки: крупная получает больше места, чем мелкая
  /* Вес корня обязан быть заметно больше веса листа: на этом держится длина связей — крупная
     ветка отъезжает от хаба дальше и не толкается с соседями. */
  {
    const весКорня=graph._вес[корень.id]||0;
    const весЛиста=graph._вес[ветка[ветка.length-1].n.id]||0;
    t.push({имя:"вес ветки растёт с её величиной",
            ок: весКорня>весЛиста && весКорня>=6,
            факт:"корень: "+весКорня+", лист: "+весЛиста});
  }

  [корень.id, ...ветка.map(z=>z.n.id)].forEach(id=>hardDeleteItem(id));
  S.areas=S.areas.filter(a=>a.id!=="a_ветка"); persist(); render(); await ж(200);
}

/* РЕЖИМ ОТРИСОВКИ НА ХОЛСТЕ. Проверяем ровно то, ради чего он заводился: SVG-элементы не
   создаются, модель графа при этом целая, на холсте что-то нарисовано, и возврат к SVG всё
   возвращает. Щупаем МОДЕЛЬ и пиксели, а не разметку, — иначе проверка годилась бы только
   для одного из двух рендеров. */
{
  const былРежим = S.settings.graphRender;
  S.settings.graphRender = "canvas"; render(); await ж(300);
  /* Камеру ставим руками, а не через _fitView: тот переезжает плавно, кадрами requestAnimationFrame,
     а здесь кадры синхронные — камера осталась бы там, куда её увели проверки выше, и холст
     оказался бы честно пустым (узлы вне кадра). */
  {
    // центрируем на КОНКРЕТНОМ узле, а не на центре масс: проверки выше разбрасывали узлы за
    // тысячи пикселей, и середина облака оказывается там, где нет никого
    const n0 = graph.nodes[0];
    graph.zoom = 1; graph.tx = graph.W/2 - n0.x; graph.ty = graph.H/2 - n0.y;
  }
  graph._tick(true); await ж(60); graph._tick(true);

  t.push({имя:"холст: SVG-элементы узлов и связей не создаются",
          ок: graph.canvasMode === true && graph.nodeEls.length === 0 && graph.linkEls.length === 0,
          факт: "режим " + (graph.canvasMode ? "холст" : "svg") + ", узлов в DOM " + graph.nodeEls.length
              + ", связей в DOM " + graph.linkEls.length});
  t.push({имя:"холст: модель графа осталась целой",
          ок: graph.nodes.length > 0 && graph.links.length > 0 && !!graph.byId[graph.nodes[0].id],
          факт: graph.nodes.length + " узлов, " + graph.links.length + " связей"});

  // на холсте должны быть непрозрачные пиксели: узлы и линии где-то нарисованы
  let закрашено = 0;
  if (graph.mainCanvas && graph.mainCtx){
    const cv = graph.mainCanvas, d = graph.mainCtx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 8) закрашено++;   // с шагом: полный обход дорог
  }
  t.push({имя:"холст: граф на нём нарисован", ок: закрашено > 0,
          факт: "непрозрачных проб " + закрашено
              + " | холст " + (graph.mainCanvas ? graph.mainCanvas.width + "×" + graph.mainCanvas.height
                                                 + " (css " + graph.mainCanvas.clientWidth + "×" + graph.mainCanvas.clientHeight + ")"
                                                : "нет")
              + ", граф " + graph.W + "×" + graph.H + ", зум " + graph.zoom.toFixed(2)
              + ", первый узел на " + Math.round(graph.nodes[0].x*graph.zoom+graph.tx) + ","
              + Math.round(graph.nodes[0].y*graph.zoom+graph.ty)});

  /* ЖЕСТЫ НА ХОЛСТЕ. Элементов нет, значит попадание считается по координатам — проверяем именно
     это: клик по узлу его выделяет, клик по пустому месту не выделяет никого, протяжка двигает
     узел, а связь находится по своей линии. Без этих проверок холст выглядел бы рабочим ровно
     до первого клика. */
  {
    const svg = graph.svg, rc = svg.getBoundingClientRect();
    const n = graph.nodes.find(x => x.id.indexOf("hub_") !== 0) || graph.nodes[0];
    graph.zoom = 1; graph.tx = graph.W/2 - n.x; graph.ty = graph.H/2 - n.y; graph._tick(true);
    const экр = (wx, wy) => ({x: rc.left + (wx*graph.zoom + graph.tx)/graph.W*rc.width,
                              y: rc.top  + (wy*graph.zoom + graph.ty)/graph.H*rc.height});
    const p = экр(n.x, n.y);

    /* Заодно ловит расхождение координат: рисование идёт по камере (tx/ty/zoom), а попадание
       раньше считалось по матрице SVG-группы — на холсте она пустая и от камеры отстаёт, отчего
       клик по узлу приходился в пустоту за полторы тысячи пикселей. */
    const мир = graph._pt({clientX:p.x, clientY:p.y});
    t.push({имя:"холст: узел находится под курсором по координатам",
            ок: graph._хитУзел({clientX:p.x, clientY:p.y}) === n.id,
            факт: "нашли " + (graph._хитУзел({clientX:p.x, clientY:p.y}) || "никого")
                + ", курсор в мире " + Math.round(мир.x) + "," + Math.round(мир.y)
                + " при узле " + Math.round(n.x) + "," + Math.round(n.y)});

    graph.selNodes.clear();
    svg.dispatchEvent(new PointerEvent("pointerdown", {button:0, clientX:p.x, clientY:p.y, bubbles:true, cancelable:true}));
    svg.dispatchEvent(new PointerEvent("pointerup", {button:0, clientX:p.x, clientY:p.y, bubbles:true, cancelable:true}));
    t.push({имя:"холст: клик по узлу его выделяет", ок: graph.selNodes.has(n.id),
            факт: "выделено " + graph.selNodes.size});

    // протяжка: от центра узла на 60 px вправо — узел обязан уехать за курсором
    const x0 = n.x;
    svg.dispatchEvent(new PointerEvent("pointerdown", {button:0, clientX:p.x, clientY:p.y, bubbles:true, cancelable:true}));
    svg.dispatchEvent(new PointerEvent("pointermove", {buttons:1, clientX:p.x+60, clientY:p.y, bubbles:true, cancelable:true}));
    const сдвиг = n.x - x0;
    svg.dispatchEvent(new PointerEvent("pointerup", {button:0, clientX:p.x+60, clientY:p.y, bubbles:true, cancelable:true}));
    t.push({имя:"холст: узел тянется мышью", ок: сдвиг > 30,
            факт: "уехал на " + Math.round(сдвиг) + " px"});

    // клик по пустому месту (далеко от всех узлов) выделение снимает, а не хватает соседа
    const пусто = экр(n.x + 4000, n.y + 4000);
    svg.dispatchEvent(new PointerEvent("pointerdown", {button:0, clientX:пусто.x, clientY:пусто.y, bubbles:true, cancelable:true}));
    svg.dispatchEvent(new PointerEvent("pointerup", {button:0, clientX:пусто.x, clientY:пусто.y, bubbles:true, cancelable:true}));
    graph._finishMarquee();
    t.push({имя:"холст: клик по пустому месту никого не хватает", ок: graph.selNodes.size === 0,
            факт: "выделено " + graph.selNodes.size});

    // связь ищется по своей линии: берём середину первой связи с обоими концами
    const св = graph.links.findIndex(l => graph.byId[l.a] && graph.byId[l.b]);
    if (св >= 0){
      const a = graph.byId[graph.links[св].a], b = graph.byId[graph.links[св].b];
      const м = экр((a.x+b.x)/2, (a.y+b.y)/2);
      t.push({имя:"холст: связь находится по своей линии", ок: graph._хитСвязь({clientX:м.x, clientY:м.y}) >= 0,
              факт: "индекс " + graph._хитСвязь({clientX:м.x, clientY:м.y})});
    }
    /* ГАШЕНИЕ ИДЁТ ОТ ВЫДЕЛЕНИЯ, А НЕ ОТ НАВЕДЕНИЯ — иначе экран мигает, пока ведёшь мышь через
       плотный граф. И переход обязан быть плавным: скачок на большом дереве читается как вспышка. */
    {
      graph.selNodes.clear(); graph._hover(null); graph._prГаш = null; graph._прГаш = null;
      graph._tick(true);
      const безВыделения = graph._прГаш;
      graph._hover(n.id); graph._tick(true);          // навели мышь — картинка меняться не должна
      const отНаведения = graph._прГаш;
      graph.selNodes = new Set([n.id]); graph._paintSel(); graph._tick(true);
      const первыйКадр = graph._прГаш;
      for (let i = 0; i < 40; i++) graph._tick(true); // за несколько кадров доходит до конца
      const доехало = graph._прГаш;
      t.push({имя:"холст: наведение мышью граф не гасит", ок: отНаведения === безВыделения && отНаведения === 0,
              факт: "без выделения " + безВыделения + ", после наведения " + отНаведения});
      // …но сам узел под курсором подрастает — это подсказка «сюда можно нажать»
      {
        graph._hover(n.id);
        const было = n._нав || 0;
        for (let i = 0; i < 20; i++) graph._tick(true);
        const стало = n._нав;
        graph._hover(null); for (let i = 0; i < 20; i++) graph._tick(true);
        t.push({имя:"холст: узел под курсором подрастает и возвращается", ок: стало === 1 && n._нав === 0,
                факт: "при наведении " + было.toFixed(2) + " → " + стало + ", после ухода " + n._нав});
        /* ОСТЫВАНИЕ ИДЁТ ПОЛНЫМИ КАДРАМИ. Уход курсора обнуляет _hovId, и условие покоя в _tick
           выполнялось В ТОТ ЖЕ КАДР: остаток затухания доигрывал на шести кадрах в секунду и
           гас рывками, тогда как разгорание (курсор на ноде = занятость) было плавным. Кадры
           здесь БЕЗ force — именно так их и планирует цикл. */
        {
          /* Мерим НА НЕДЫШАЩЕМ дереве: у КРОЛИКА больше 350 узлов, дыхание там выключено, и
             покойный кадр рисует ТОЛЬКО фон — _drawMain не зовётся вовсе, подсветка застывает.
             На дышащем дереве покойный кадр всё-таки полный, и баг из-под него не видно:
             первая версия этой проверки прошла бы и на сломанном коде. graphDrift=0 выключает
             дыхание при любом размере графа — то же условие, что у большого дерева. */
          const дрифт = S.settings.graphDrift;
          S.settings.graphDrift = 0;
          graph.selNodes.clear();
          graph._hover(n.id); for (let i = 0; i < 20; i++) graph._tick(true);
          graph.alpha = 0;
          graph._навЕдет = false;                         // подсветка доехала — признак движения снят
          graph._hover(null);                             // курсор ушёл: цель сменилась, кадры нужны полные
          const до = n._нав;
          graph._tick();                                  // обычный кадр, не принудительный
          const после = n._нав;
          t.push({имя:"холст: подсветка остывает полными кадрами, а не в покое",
                  ок: до === 1 && после < до,
                  факт: "за один обычный кадр " + до + " → " + после.toFixed(2)});
          for (let i = 0; i < 30; i++) graph._tick();     // тоже обычные кадры: остывание не должно требовать force
          t.push({имя:"остыв до конца, граф снова уходит в покой",
                  ок: n._нав === 0 && graph._навЕдет === false,
                  факт: "подсветка " + n._нав + ", признак движения: " + graph._навЕдет});
          S.settings.graphDrift = дрифт;
        }
        /* Курсор УШЁЛ С ХОЛСТА (в правую панель, за окно) — подсветку обязан снять уход
           указателя: pointermove за пределами холста не приходит вовсе, и нода оставалась бы
           гореть, а граф — считать себя занятым и крутить полные кадры без конца. */
        {
          graph._hover(n.id); graph._tick(true);
          const горела = graph._hovId === n.id;
          graph.svg.dispatchEvent(new PointerEvent("pointerleave",{bubbles:false, pointerId:1}));
          t.push({имя:"уход курсора с холста снимает подсветку",
                  ок: горела && graph._hovId === null,
                  факт: "под курсором было " + (горела ? "да" : "нет") + ", стало " + (graph._hovId || "никого")});
          // …но посреди жеста подсветку не снимаем: курсор законно уходит за край при перетаскивании
          graph._hover(n.id); graph.panning = {x:0, y:0};
          graph.svg.dispatchEvent(new PointerEvent("pointerleave",{bubbles:false, pointerId:1}));
          const выжила = graph._hovId === n.id;
          graph.panning = null; graph._hover(null);
          t.push({имя:"во время жеста уход курсора за край подсветку не сбрасывает",
                  ок: выжила, факт: "после ухода при пане: " + (выжила ? "подсветка на месте" : "сброшена")});
        }
        // …и его родня отзывается вместе с ним, только слабее — видно, с чем узел связан
        {
          const соседи = [...(graph.adj[n.id] || [])].map(id => graph.byId[id]).filter(Boolean);
          graph._hover(n.id); for (let i = 0; i < 20; i++) graph._tick(true);
          const отклик = соседи.filter(с => с._нав > 0 && с._нав < 1).length;
          const сила = соседи[0] ? соседи[0]._нав : 0;      // снимаем ДО ухода курсора, иначе там уже ноль
          graph._hover(null); for (let i = 0; i < 20; i++) graph._tick(true);
          const после = соседи.filter(с => с._нав > 0).length;
          t.push({имя:"холст: соседи наведённого узла тоже отзываются, но слабее",
                  ок: соседи.length > 0 && отклик === соседи.length && после === 0,
                  факт: "соседей " + соседи.length + ", откликнулось " + отклик
                      + " (сила " + сила + " против 1 у самого)"});
        }
      }
      t.push({имя:"холст: выделение гасит непричастное, но плавно",
              ок: первыйКадр > 0 && первыйКадр < 0.5 && доехало === 1,
              факт: "за первый кадр " + первыйКадр.toFixed(2) + ", через 40 кадров " + доехало});
    }
    /* Подсветка считается для ВСЕХ выделенных сразу: выделив две ноды, видишь окружение обеих. */
    {
      const вторая = graph.nodes.find(x => x.id !== n.id && x.id.indexOf("hub_") !== 0);
      graph.selNodes = new Set([n.id, вторая.id]); graph._paintSel(); graph._tick(true);
      const ждём = new Set([n.id, вторая.id]);
      [n.id, вторая.id].forEach(id => { const с = graph.adj[id]; if (с) с.forEach(x => ждём.add(x)); });
      t.push({имя:"холст: подсвечивается окружение всех выделенных", ок: ждём.size >= 2,
              факт: "выделено 2, в подсветке " + ждём.size + " узлов"});
    }
    graph.selNodes.clear(); graph._hover(null); graph.alpha = 0;
  }

  S.settings.graphRender = былРежим || "svg"; render(); await ж(300);
  t.push({имя:"возврат к SVG воссоздаёт элементы",
          ок: !graph.canvasMode && graph.nodeEls.length > 0 && graph.linkEls.length > 0,
          факт: "узлов в DOM " + graph.nodeEls.length + ", связей " + graph.linkEls.length});
}

/* НАВЕДЕНИЕ НЕ ПЕРЕБИРАЕТ ГРАФ НА КАЖДОЕ ДВИЖЕНИЕ МЫШИ. _hover зовётся из onpointermove, а мышь
   шлёт события чаще, чем идут кадры; внутри он проходит по всем узлам и связям. Пока цель та же,
   работы быть не должно — иначе водить курсором по большому графу дороже, чем считать физику. */
{
  const узел = graph.nodes.find(n => n.id.indexOf("hub_") !== 0);
  const ориг = graph.nodeEls;
  let проходов = 0;
  graph.nodeEls = {forEach: f => { проходов++; ориг.forEach(f); }};
  graph._hovId = null;
  graph._hover(узел.id);                       // первое наведение — работа нужна
  const первое = проходов;
  for (let i = 0; i < 20; i++) graph._hover(узел.id);   // мышь ходит внутри той же ноды
  const повторы = проходов - первое;
  graph._hover(null);                          // ушли на пустое место — снять подсветку
  const снятие = проходов - первое - повторы;
  graph.nodeEls = ориг;
  t.push({имя:"наведение на ту же ноду не перебирает граф заново",
          ок: первое === 1 && повторы === 0 && снятие === 1,
          факт: "первое " + первое + ", 20 повторов " + повторы + ", снятие " + снятие});
}

/* СВЯЗЬ В ПОКОЕ НЕ ДОЛЖНА БЫТЬ ТОЛСТОЙ. Баг был ровно тут: ширина «своя/погашенная» выбиралась
   предикатом свояСвязь(l), а он возвращает true для ЛЮБОЙ связи, когда выделения нет вовсе —
   весь граф в покое рисовался утолщённым пакетом, и добавка для луча «область → пустышка»
   терялась на общем фоне. Измеряем пикселями толщину одной и той же связи в покое и при
   выделении: в покое обязана быть базовой, при выделении — заметно толще. */
{
  const обл = S.areas[0];
  /* Проверяем именно АВТО-луч «нода → хаб» (manual:false) — тот самый путь, что чинили. Первая
     версия этого теста по ошибке мерила РУЧНУЮ связь (addLink), у которой ширина и так постоянна
     и с багом никак не связана — оба замера совпали, тест был бы зелёным независимо от фикса.
     own-area (areaAuto=false) без единой ручной связи даёт ровно авто-луч к хабу. */
  const C = addItem({kind:"note", title:"толщ-нода", area:обл.id, x:0, y:0});
  C.areaAuto = false;
  const былРежим = S.settings.graphRender;
  S.settings.graphRender = "canvas"; render(); await ж(150);
  const hub = graph.byId["hub_" + обл.id];
  // далеко в стороне от всего остального графа: рядом никого нет, значит линия точно ПРЯМАЯ
  // (иначе случайно оказавшийся рядом узел прогнёт её, и прямая перпендикулярная выборка
  // промахнётся мимо кривой — первая версия так и попала в 0.00 на обоих замерах)
  hub.x = 20300; hub.y = 20005;
  graph.byId[C.id].x = 20000; graph.byId[C.id].y = 20000;
  graph.selNodes.clear();
  // камера крупным планом (зум ×3): разница 1.5 против 2 px на зуме ×1 тонет в сглаживании,
  // на увеличенной картинке та же разница в пикселях кратно заметнее
  graph.zoom = 3; graph.tx = graph.W/2 - 20150*3; graph.ty = graph.H/2 - 20002.5*3; graph.alpha = 0;
  graph._tick(true);

  const cv = graph.mainCanvas, ctx = graph.mainCtx;
  // мера — ИНТЕГРАЛ альфы поперёк линии (сумма, не порог): при пороге разница в 0.5 px после
  // сглаживания округляется до одного и того же числа шагов; сумма альфы монотонна по ширине
  // штриха и не квантуется так грубо.
  // МАКСИМУМ ПО НЕСКОЛЬКИМ ТОЧКАМ ВДОЛЬ ЛИНИИ, не одна ровно посередине: единственная точка
  // изредка попадала точно на границу пиксельной сетки при округлении экранных координат и
  // давала 0.00 там, где линия честно нарисована на соседнем пикселе (замечено: 1 прогон из 4
  // ложно давал «в покое 0.00» при корректном коде). Несколько точек вдоль убирают этот шум.
  const толщинаСвязи = (id1, id2) => {
    const a = graph.byId[id1], b = graph.byId[id2];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    const пиксель = (wx, wy) => ({x: Math.round((wx * graph.zoom + graph.tx) * (cv.width / graph.W)),
                                  y: Math.round((wy * graph.zoom + graph.ty) * (cv.height / graph.H))});
    let максимум = 0;
    for (const доля of [0.3, 0.4, 0.5, 0.6, 0.7]) {
      const px0 = a.x + dx * доля, py0 = a.y + dy * доля;
      let сумма = 0;
      for (let t = -10; t <= 10; t += 0.2) {
        const p = пиксель(px0 + nx * t, py0 + ny * t);
        сумма += ctx.getImageData(p.x, p.y, 1, 1).data[3] / 255;
      }
      if (сумма > максимум) максимум = сумма;
    }
    return максимум;
  };
  const лНоды = () => graph.links.find(l => !l.manual && ((l.a === C.id && l.b === hub.id) || (l.b === C.id && l.a === hub.id)));
  /* Замер иногда попадает в кадр, где холст ещё не перерисован после смены координат (redraw —
     побочный эффект requestAnimationFrame, а не гарантия синхронного вызова) — тогда все пять
     точек читают пустоту. Это дефект СТЕНДА, не проверяемого кода: настоящая поломка держится
     на повторных попытках так же стабильно, как и на первой. Три попытки с перерисовкой между
     ними отличают такой сбой от настоящего нуля. */
  const измеритьНадёжно = (id1, id2) => {
    let в = 0;
    for (let попытка = 0; попытка < 3 && в <= 1; попытка++){ graph._tick(true); в = толщинаСвязи(id1, id2); }
    return в;
  };
  const вПокое = измеритьНадёжно(C.id, hub.id);

  // выделяем ноду — хаб входит в активные автоматически (соседство по авто-лучу, см. _drawMain)
  graph.selNodes = new Set([C.id]);
  const приВыделении = измеритьНадёжно(C.id, hub.id);

  t.push({имя:"связь без выделения рисуется базовой толщиной, а не утолщённой",
          // нижний порог на вПокое — чтобы вырожденный «0.00» не проходил ложно через одно
          // только отношение (0 < X*1.15 истинно при любом X>0, это и маскировало промах)
          ок: !!лНоды() && вПокое > 1 && приВыделении > вПокое * 1.15,
          факт: "интеграл альфы: в покое " + вПокое.toFixed(2) + ", при выделении " + приВыделении.toFixed(2)
              + " (ждали рост минимум на 15% — ширина 1.5→2 px)"});

  graph.selNodes.clear();
  S.settings.graphRender = былРежим || "svg";
  hardDeleteItem(C.id);
  recomputeHierarchy(); render(); await ж(120);
}

/* ДЛИНА НИТИ ДО ОБЛАСТИ — такая же настройка, как у связи между нодами, только храниться ей
   негде: связь «нода → хаб области» в S.links не лежит вовсе, граф строит её из it.area на
   КАЖДОЙ сборке. Поэтому множитель живёт в самой ноде (it.arealen) — положи его в связь, и
   настройка исчезала бы при первой же правке графа. */
{
  const обл = S.areas[0];
  const N = addItem({kind:"note", title:"нить-до-области", area:обл.id, x:0, y:0});
  N.areaAuto = false;
  recomputeHierarchy(); render(); await ж(150);
  const луч = () => graph.links.find(l => !l.manual && l.a === N.id && l.b === "hub_" + обл.id);
  t.push({имя:"у нити до области есть множитель длины, по умолчанию единица",
          ок: !!луч() && (луч().lenMul || 1) === 1, факт: "множитель: " + (луч() ? луч().lenMul : "луча нет")});

  N.arealen = 1.8;
  graph.build();                                   // ровно то, что случается от любой правки графа
  t.push({имя:"заданная длина нити до области переживает пересборку графа",
          ок: !!луч() && Math.abs(луч().lenMul - 1.8) < 0.001,
          факт: "после build множитель " + (луч() ? луч().lenMul : "луча нет")});

  // и доезжает до физики: та берёт lenMul одинаково для ручных связей и для нитей к области
  const дл = (l) => l.L * (S.settings.graphLinkLen != null ? S.settings.graphLinkLen : 1) * (l.lenMul || 1);
  t.push({имя:"длина нити до области идёт в физику так же, как у обычной связи",
          ок: !!луч() && дл(луч()) > луч().L * 1.5,
          факт: "покой связи " + (луч() ? Math.round(дл(луч())) : "?") + " px против базовых " + (луч() ? луч().L : "?")});

  const чисто = sanitizeState({items:[{id:"i_al", kind:"note", arealen:1.8},
                                      {id:"i_ед", kind:"note", arealen:1},
                                      {id:"i_бр", kind:"note", arealen:99}], areas:[], links:[]});
  t.push({имя:"множитель нити переживает чистку, а единица и мусор из данных уходят",
          ок: чисто.items[0].arealen === 1.8 && чисто.items[1].arealen === undefined
              && чисто.items[2].arealen === undefined,
          факт: "1.8 → " + чисто.items[0].arealen + ", 1 → " + чисто.items[1].arealen +
                ", 99 → " + чисто.items[2].arealen});
  hardDeleteItem(N.id); recomputeHierarchy(); render(); await ж(120);
}

/* ЗВЁЗДЫ РАСХОДЯТСЯ. Физика знает не только про пары узлов, но и про пучки: узел с детьми плюс
   его листья — одна звезда, и звёзды обязаны разъезжаться целиком. Без этого силы внутри
   наложения гасят друг друга, и на большом дереве соседние пучки проезжают насквозь — та самая
   каша, которую нельзя распутать ни зумом, ни перераскладкой. Проверяем на дереве из 25 звёзд:
   доля налегающих пар должна упасть почти до нуля. */
{
  const было = S.items.length;
  const корень = addItem({kind:"note", title:"пучок-корень", x:0, y:0});
  const центры = [];
  // 12 звёзд по 5 листьев — та же форма, что у КРОЛИКА в тестовом графе: проект, его шоты,
  // у каждого шота свои задачи. Двадцать пять веток от одного узла — случай, которого в жизни нет
  for (let i = 0; i < 12; i++){
    const c = addItem({kind:"note", title:"звезда"+i, x:(i%4)*40-60, y:Math.floor(i/4)*40-60});
    S.links.push([корень.id, c.id, 1]); центры.push(c);
    for (let k = 0; k < 5; k++){
      const л = addItem({kind:"task", title:"лист"+i+"_"+k, x:c.x+(k-2)*8, y:c.y+8});
      S.links.push([c.id, л.id, 1]);
    }
  }
  recomputeHierarchy(); render(); await ж(200);

  t.push({имя:"пучки размечены: лист относится к звезде своего родителя",
          ок: (() => { const c = центры[0]; const дети = graph._дети.get(c.id) || [];
                       return дети.length > 0 && дети.every(id => graph._группа[id] === c.id); })(),
          факт: "узлов " + graph.nodes.length + ", звёзд " + new Set(Object.values(graph._группа)).size});

  /* Каша — это когда узел визуально принадлежит не своей звезде. Круги пучков для этого мерить
     нельзя: один улетевший лист раздувает круг, и «налегание» показывается там, где глазу всё
     понятно. Считаем честнее: у скольких узлов ЧУЖОЙ центр оказался ближе своего. */
  const чужие = () => {
    const п = new Map();
    graph.nodes.forEach(n => { const g = graph._группа[n.id]; if (g == null) return;
      let о = п.get(g); if (!о){ о = {x:0, y:0, к:0}; п.set(g, о); }
      о.x += n.x; о.y += n.y; о.к++; });
    п.forEach(о => { о.x /= о.к; о.y /= о.к; });
    let сбитых = 0, всего = 0;
    graph.nodes.forEach(n => {
      const свой = п.get(graph._группа[n.id]); if (!свой) return;
      всего++;
      const своё = Math.hypot(n.x-свой.x, n.y-свой.y);
      let ближе = false;
      п.forEach((о, g) => { if (g === graph._группа[n.id] || ближе) return;
        if (Math.hypot(n.x-о.x, n.y-о.y) < своё) ближе = true; });
      if (ближе) сбитых++;
    });
    const xs = graph.nodes.map(n => n.x), ys = graph.nodes.map(n => n.y);
    return {сбитых, всего, звёзд: п.size,
            охват: Math.round(Math.max(...xs)-Math.min(...xs)) + "×" + Math.round(Math.max(...ys)-Math.min(...ys))};
  };
  const налегают = чужие;

  const до = налегают();
  graph.alpha = 1;                                  // разогрев один раз — дальше физика остывает сама, как в жизни
  for (let i = 0; i < 600; i++) graph._tick(true);
  const после = налегают();
  /* Порог — «не хуже, чем было». На синтетическом дереве узлы и так держатся своих звёзд (5–6
     сбитых из 90 и до раскладки), поэтому проверка тут сторожевая: она ловит не улучшение, а
     поломку — если однажды силы пучков начнут перемешивать звёзды, это станет видно сразу. */
  /* Порог с запасом на шум: начальные позиции случайны, и от прогона к прогону число сбитых
     гуляет на два-три. Ловить надо не это, а настоящую поломку — когда силы начинают
     растаскивать звёзды (при слишком сильном веере выходило 18 из 90). */
  t.push({имя:"после раскладки узлы держатся своей звезды, а не чужой",
          ок: после.сбитых <= Math.max(до.сбитых + 3, Math.round(после.всего * 0.10)),
          факт: "узлов у чужой звезды " + до.сбитых + " → " + после.сбитых + " из " + после.всего
              + " | звёзд " + после.звёзд + ", охват " + до.охват + " → " + после.охват});

  /* ВЕЕР ДЕТЕЙ. Пружины задают расстояние, но не направление, и дети сбивались на одну сторону,
     а ветки заворачивались к центру дерева. Меряем два признака: насколько равномерно дети
     расставлены вокруг родителя (минимальный угловой зазор между соседями) и растёт ли ветка
     НАРУЖУ — угол между направлением «дед → родитель» и «родитель → ребёнок». */
  {
    const веер = () => {
      let зазоры = [], наружу = [];
      graph._дети.forEach((спис, pid) => {
        const p = graph.byId[pid]; if (!p || спис.length < 3) return;
        const углы = спис.map(id => graph.byId[id]).filter(Boolean)
          .map(n => Math.atan2(n.y - p.y, n.x - p.x)).sort((a, b) => a - b);
        if (углы.length < 3) return;
        let мин = Infinity;
        for (let i = 0; i < углы.length; i++){
          const сл = (i + 1) % углы.length;
          let d = углы[сл] - углы[i]; if (d < 0) d += 6.283185307;
          if (d < мин) мин = d;
        }
        зазоры.push(мин);
        const дед = graph._родитель[pid] && graph.byId[graph._родитель[pid]];
        if (дед){
          const b = Math.atan2(p.y - дед.y, p.x - дед.x);
          спис.map(id => graph.byId[id]).filter(Boolean).forEach(n => {
            let d = Math.atan2(n.y - p.y, n.x - p.x) - b;
            while (d > Math.PI) d -= 6.283185307;
            while (d < -Math.PI) d += 6.283185307;
            наружу.push(Math.abs(d));
          });
        }
      });
      const ср = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
      return {зазор: +(ср(зазоры) * 57.3).toFixed(1), отклон: +(ср(наружу) * 57.3).toFixed(1), родителей: зазоры.length};
    };
    const дв = веер();
    graph.alpha = 1;
    for (let i = 0; i < 500; i++) graph._tick(true);
    const пв = веер();
    /* Мерим ИМЕННО то, что делает веер: направление ветки. Минимальный зазор между соседними
       детьми пробовал — метрика шумная (от прогона к прогону 15°, 19°, 26° при одинаковом коде,
       потому что стартовые позиции случайны, а минимум определяется одним худшим родителем).
       Отклонение от направления ветки, наоборот, улучшается стабильно: 97→71, 91→68, 44→40. */
    t.push({имя:"ветка растёт наружу, а не заворачивается к центру",
            ок: пв.отклон <= 90 && пв.отклон <= дв.отклон + 5,
            факт: "среднее отклонение от направления ветки " + дв.отклон + "° → " + пв.отклон
                + "° (родителей с 3+ детьми: " + пв.родителей + ", зазор " + дв.зазор + "° → " + пв.зазор + "°)"});
  }

  // Разметка веток остаётся в модели (она нужна будущей раскладке по веткам), поэтому проверяем,
  // что она хотя бы считается: у каждого узла есть своя ветка верхнего уровня и свой корень
  t.push({имя:"ветки и корни размечены", ок: (() => {
            const л = graph.nodes.filter(n => graph._ветвь && graph._ветвь[n.id]);
            return л.length > 0 && л.every(n => !!graph._корень[n.id]); })(),
          факт: "узлов с веткой " + graph.nodes.filter(n => graph._ветвь && graph._ветвь[n.id]).length
              + " из " + graph.nodes.length});

  S.items.slice(было).map(i => i.id).forEach(id => hardDeleteItem(id));
  render(); await ж(150);
}

/* ДАЛЁКИЕ ПУЧКИ НЕ СТЯГИВАЮТСЯ К ОБЩЕМУ ЦЕНТРУ. Общее притяжение (к центру масс всего графа)
   одно на все узлы и линейно по расстоянию, а отталкивание между пучками падает как 1/d² — на
   большом удалении общее притяжение всегда побеждало, и раздельные пучки медленно ехали друг к
   другу, сколько их ни разводи (КРОЛИК: «все хотят собираться в кучу»). Лечение — резать эту
   силу для листьев (у них уже есть локальный якорь пучка, вчетверо сильнее) и оставлять в
   полную силу только центрам пучков, которых на порядок меньше.
   Строим ДВА НЕСВЯЗАННЫХ дерева далеко друг от друга (4000 px — за пределами дальнего поля
   отталкивания) и смотрим, насколько сблизятся их центры масс за время активной раскладки. */
{
  const было = S.items.length;
  const строимКластер = (база, метка) => {
    const центр = addItem({kind:"note", title:метка, x:база.x, y:база.y});
    const листья = [];
    for (let i = 0; i < 40; i++){
      const л = addItem({kind:"task", title:метка+"_л"+i, x:база.x+(Math.random()-0.5)*20, y:база.y+(Math.random()-0.5)*20});
      S.links.push([центр.id, л.id, 1]); листья.push(л);
    }
    return {центр, листья};
  };
  const А = строимКластер({x:0, y:0}, "кластерА");
  const Б = строимКластер({x:4000, y:0}, "кластерБ");
  recomputeHierarchy(); render(); await ж(200);

  const центроид = (кл) => {
    const узлы = [кл.центр, ...кл.листья].map(i => graph.byId[i.id]).filter(Boolean);
    let x = 0, y = 0; узлы.forEach(n => { x += n.x; y += n.y; });
    return {x: x / узлы.length, y: y / узлы.length};
  };
  const расстояние = () => { const а = центроид(А), б = центроид(Б); return Math.hypot(б.x - а.x, б.y - а.y); };
  const до = расстояние();

  graph.alpha = 1;
  for (let i = 0; i < 300; i++){ graph.alpha = 1; graph._tick(true); }   // держим горячей — иначе за 300 кадров успеет остыть и встать
  const после = расстояние();

  t.push({имя:"далёкие несвязанные пучки не стягиваются к общему центру",
          ок: после >= до * 0.6,
          факт: "расстояние между кластерами " + до.toFixed(0) + " → " + после.toFixed(0)
              + " px (осталось " + (после / до * 100).toFixed(0) + "%), узлов в графе " + graph.nodes.length});

  /* ПЕРЕТАСКИВАНИЕ НЕ СНОСИТ ВЕСЬ ГРАФ (КРОЛИК: «беру ноду в руку — все ноды плывут вниз»).
     Баг: сила притяжения к центру масс режется для листьев (см. выше), а сумма сил остаётся
     нулевой, только пока коэффициент ОДИНАКОВ у всех узлов — как только коэффициент разный,
     (mx−x) больше не гасится в сумме, и центр масс всего графа едет каждый кадр. Живой замер до
     фикса: +45 px за 300 кадров на 108 узлах. Держим ноду в руке и смотрим на среднюю позицию
     ВСЕХ узлов графа — не должна убегать в одну сторону. */
  {
    const средняя = () => { let sx = 0, sy = 0;
      graph.nodes.forEach(n => { sx += n.x; sy += n.y; });
      return {x: sx / graph.nodes.length, y: sy / graph.nodes.length}; };
    const доСредняя = средняя();
    const жертва = graph.nodes.find(n => n.type === "task");
    graph.drag = жертва; graph.alpha = 1;
    for (let i = 0; i < 300; i++){ graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    graph.drag = null; graph.alpha = 0;
    const послеСредняя = средняя();
    const снос = Math.hypot(послеСредняя.x - доСредняя.x, послеСредняя.y - доСредняя.y);
    // порог с запасом: легитимная усадка (веер доводит детей до целевого угла) даёт единицы px,
    // настоящий баг — по 45 px за такой же прогон. 20 отделяет одно от другого с большим запасом
    t.push({имя:"перетаскивание ноды не сносит весь граф в сторону", ок: снос < 20,
            факт: "средняя позиция всех узлов сместилась на " + снос.toFixed(1) + " px за 300 кадров"});
  }

  [А.центр, ...А.листья, Б.центр, ...Б.листья].forEach(i => hardDeleteItem(i.id));
  recomputeHierarchy(); render(); await ж(150);
}

/* ПУСТЫШКА разгружает лучи области. Нода со СВОЕЙ областью тянет от хаба луч принадлежности;
   прицепив её к пустышке той же области, мы переводим область в унаследованную — принадлежность
   остаётся (приходит через пустышку), а луч исчезает. Проверяем именно это: область сохранилась,
   ребро к хабу пропало, чужая область не тронута. */
{
  const было = S.items.length;
  const обл = S.areas[0];
  // координаты обязательны: узел без них лежит в лотке неразобранного, а не на холсте
  const пуст = addItem({kind:"note", title:"Узел", area:обл.id, x:400, y:300});
  пуст.hollow = true; пуст.areaAuto = false;   // область СВОЯ: она точка входа наследования
  const нода = addItem({kind:"note", title:"переезжает", area:обл.id, x:480, y:340});
  нода.areaAuto = false;                       // область назначена руками — значит луч от хаба есть
  recomputeHierarchy(); render(); await ж(150);

  // луч принадлежности этой ноды: авто-связь (не manual) с хабом или пустышкой
  const лучНоды = () => {
    const l = graph.links.find(x => !x.manual && (x.a === нода.id || x.b === нода.id));
    return l ? (l.a === нода.id ? l.b : l.a) : null;
  };
  const доЛуча = лучНоды();

  graph._linkTo(пуст.id, нода.id);
  recomputeHierarchy(); graph.build();
  const свежая = S.items.find(x => x.id === нода.id);
  /* ОБЛАСТЬ СТАНОВИТСЯ СВОЕЙ, А НЕ УНАСЛЕДОВАННОЙ (переиграно). Раньше прикрепление к пустышке
     уводило area в «унаследовано» (areaAuto=true) и намертво приклеивало ручной связью к ЭТОЙ
     ОДНОЙ пустышке — нода выпадала из автовыбора по расстоянию навсегда. Теперь ведёт себя как
     прикрепление к хабу: область своя, нода остаётся участником автовыбора и получает АВТО-луч
     (не пропадает — просто больше не manual). См. «прикрепление к пустышке делает область
     СВОЕЙ» и «может перескочить на другую» ниже — там же и объяснение, откуда взялся баг. */
  t.push({имя:"пустышка делает область своей, а не уводит её в унаследованную",
          ок: свежая.area === обл.id && свежая.areaAuto === false,
          факт: "область " + (свежая.area === обл.id ? "та же" : "СМЕНИЛАСЬ") + ", своя: " + (свежая.areaAuto === false)});
  t.push({имя:"у прицепленной ноды луч принадлежности указывает на пустышку",
          ок: лучНоды() === пуст.id,
          факт: "луч был к " + (доЛуча || "никому") + ", стал " + (лучНоды() || "снят")});
  t.push({имя:"пустышка видна графу как пустышка",
          ок: !!(graph.byId[пуст.id] && graph.byId[пуст.id].hollow),
          факт: graph.byId[пуст.id] ? ("hollow: " + graph.byId[пуст.id].hollow) : "узла нет"});

  /* Пустышка — продолжение области, а не своя сущность: цвет берёт у области (даже если ей
     назначили свой), а наведение на неё подсвечивает всю область, как наведение на хаб. */
  const былЦвет = обл.color;
  обл.color = "#3fa9f5";                                      // без цвета области проверка была бы пустой
  S.items.find(x => x.id === пуст.id).color = "#ff00ff";      // назначаем свой — он не должен победить
  graph.build();
  t.push({имя:"пустышка красится цветом области, а не своим",
          ок: graph.byId[пуст.id].color === areaColor(обл.id),
          факт: "цвет узла " + graph.byId[пуст.id].color + ", у области " + areaColor(обл.id)});
  /* РОДНЯ ПУСТЫШКИ — её РЕАЛЬНЫЕ связи (adj), и только они. Пробовал объединять пустышку со
     связями её хаба — навёл на пустышку, а зажигалась вся область целиком, хотя часть узлов к
     пустышке отношения не имеет. Правильно — как у обычного узла. У ХАБА, наоборот, родня
     специально РАСШИРЕНА до его пустышек (проверка «наведение на хаб достаёт узлы через его
     пустышки» ниже по файлу) — это разные роли: хаб представляет ВСЮ область, пустышка — только
     свою развилку. */
  t.push({имя:"родня пустышки — только её СВОИ связи, без подмешивания связей хаба",
          ок: (() => { const р = graph._родня(пуст.id);
                       if (р !== graph.adj[пуст.id]) return false;    // тот же объект — не пересобранная копия
                       return р.has(нода.id);                         // прицепленная нода в родне есть
                     })(),
          факт: "родня пустышки = adj пустышки: " + (graph._родня(пуст.id) === graph.adj[пуст.id])
              + ", размер " + (graph.adj[пуст.id] ? graph.adj[пуст.id].size : "нет")});

  /* _отЖивогоУзла — ТЕПЕРЬ ПУТЬ ТОЛЬКО ДЛЯ СТАРЫХ ДАННЫХ: новые прикрепления (см. выше) уже не
     создают ручную связь, отцеплять через неё нечего. Но у КРОЛИКА уже есть файл, сохранённый
     ДО этой правки, — там нода могла быть привязана ИМЕННО старым способом (areaAuto=true +
     ручная связь с пустышкой), и открепление такой ноды обязано продолжать работать. Симулируем
     это состояние руками, а не через _linkTo (он больше так не делает), чтобы проверить именно
     обратную совместимость, а не текущий путь создания. */
  {
    нода.areaAuto = true;                              // как было бы в файле, сохранённом до правки
    addLink(пуст.id, нода.id);                          // старая ручная связь
    recomputeHierarchy(); graph.build();
    graph._отЖивогоУзла(пуст.id, нода.id);
    removeLink(пуст.id, нода.id);
    recomputeHierarchy(); graph.build();
    const вернулась = S.items.find(x => x.id === нода.id);
    t.push({имя:"открепление СТАРОЙ ручной связи с пустышкой возвращает область своей",
            ок: вернулась.area === обл.id && вернулась.areaAuto === false && лучНоды() === пуст.id,
            факт: "область " + (вернулась.area === обл.id ? "та же" : "потеряна")
                + ", своя: " + (вернулась.areaAuto === false) + ", луч к " + (лучНоды() || "никому")});
  }

  /* АВТОВЫБОР ТОЧКИ КРЕПЛЕНИЯ. Луч принадлежности идёт к тому, кто ближе — к хабу области или
     к её пустышке. Ставим ноду вплотную к пустышке (хаб далеко) и ждём, что луч переедет на
     пустышку; потом уводим её к хабу — луч обязан вернуться. Гистерезис в 15% при таких
     расстояниях не мешает: разница кратная. */
  {
    const дальняя = addItem({kind:"note", title:"выбирает", area:обл.id, x:410, y:305});
    дальняя.areaAuto = false;
    recomputeHierarchy();
    const хабУзел = () => graph.byId["hub_" + обл.id];
    graph.build();
    if (хабУзел()){
      // рядом с пустышкой (400,300), хаб отодвигаем далеко
      хабУзел().x = 2000; хабУзел().y = 2000;
      graph._якорь = {}; graph.build();
      const кПустышке = graph._якорь[дальняя.id];
      // теперь наоборот: нода уезжает к хабу
      graph.byId[дальняя.id].x = 1990; graph.byId[дальняя.id].y = 1990;
      graph._якорь = {}; graph.build();
      const кХабу = graph._якорь[дальняя.id];
      t.push({имя:"нода сама выбирает ближайшую точку крепления: хаб или пустышку",
              ок: кПустышке === пуст.id && кХабу === "hub_" + обл.id,
              факт: "рядом с пустышкой → " + (кПустышке === пуст.id ? "пустышка" : кПустышке)
                  + ", рядом с хабом → " + (кХабу === "hub_" + обл.id ? "хаб" : кХабу)});
    }
    hardDeleteItem(дальняя.id);
  }

  /* СВЯЗЬ «ОБЛАСТЬ → ПУСТЫШКА» ПОМЕЧЕНА ОСОБО (hubLink), холст рисует её толще. Помечать должна
     только эта одна связь — луч узла к пустышке или к хабу остаётся обычным. */
  t.push({имя:"луч хаба к пустышке помечен для утолщённой отрисовки",
          ок: (() => { const л = graph.links.find(l => l.a === пуст.id && l.b === "hub_" + обл.id);
                       return !!л && л.hubLink === true; })(),
          факт: (() => { const л = graph.links.find(l => l.a === пуст.id && l.b === "hub_" + обл.id);
                         return л ? ("hubLink: " + л.hubLink) : "связь не найдена"; })()});
  t.push({имя:"обычный луч узла к пустышке НЕ помечен как hubLink",
          ок: (() => { const л = graph.links.find(l => l.a === нода.id && l.b === пуст.id);
                       return !л || л.hubLink !== true; })(),
          факт: "проверено на связи узел→пустышка"});

  /* ПОПАДАНИЕ В МЕНЮ ПУСТЫШКИ. Открываем его так же, как это делает ПКМ, и проверяем: кнопка
     «Ещё пустышка» создаёт вторую пустышку БЕЗ входа в режим связывания (КРОЛИК прямо просил
     убрать навязанный startLink — теперь ноды находят точку крепления сами по расстоянию). */
  {
    const узелПуст = graph.byId[пуст.id];
    graph._openPop(узелПуст, {clientX: 400, clientY: 300});
    const pop = document.querySelector("#node-pop");
    const естьКнопка = !!(pop && pop.querySelector('[data-pop="hollow2"]'));
    const былоПустышек = S.items.filter(i => i.hollow && !i.deleted).length;
    if (pop) pop.querySelector('[data-pop="hollow2"]').click();
    const сталоПустышек = S.items.filter(i => i.hollow && !i.deleted).length;
    t.push({имя:"в меню пустышки есть кнопка «Ещё пустышка»", ок: естьКнопка,
            факт: естьКнопка ? "кнопка на месте" : "кнопки нет"});
    t.push({имя:"«Ещё пустышка» создаёт новую и НЕ включает режим связывания",
            ок: сталоПустышек === былоПустышек + 1 && graph.linkFrom == null,
            факт: "пустышек " + былоПустышек + " → " + сталоПустышек + ", linkFrom: " + graph.linkFrom});
    // прибрать вторую пустышку, дальше проверяем удаление первой отдельно
    const вторая = S.items.find(i => i.hollow && i.id !== пуст.id && !i.deleted);
    if (вторая) hardDeleteItem(вторая.id);
    graph.cancelLink(); closeOverlays(); recomputeHierarchy(); graph.build();
  }

  /* ПЕРЕОЦЕНКА ЯКОРЕЙ ПРИ ПЕРЕТАСКИВАНИИ. Пока пустышку тащат рукой, ноды обязаны понимать,
     что её унесли, и переключаться на хаб (или другую пустышку) — а не тянуться следом
     пружиной до бесконечности. Это и есть требование КРОЛИКА: «ноды должны понимать, что я её
     перемещаю, и им лучше привязаться к другой ноде». */
  {
    const свежая = S.items.find(x => x.id === нода.id);
    свежая.areaAuto = false;                          // луч должен существовать, чтобы было что переключать
    recomputeHierarchy(); graph.build();
    // нода почти на пустышке — якорь обязан указывать на неё
    {
      // ставим ноду впритык к пустышке ДО билда — build() пересоздаёт узлы заново, поэтому
      // ссылки на живые объекты берём ПОСЛЕ него, а не до (иначе двигаешь уже отсоединённую копию)
      const н0 = graph.byId[нода.id], п0 = graph.byId[пуст.id];
      н0.x = п0.x + 5; н0.y = п0.y + 5;
    }
    graph._якорь = {}; graph.build();
    const якорьДо = graph._якорь[нода.id];
    const н = graph.byId[нода.id], п = graph.byId[пуст.id], хабУзел2 = graph.byId["hub_" + обл.id];
    // пустышку «хватают рукой» и уносят на другой конец графа — далеко от хаба тоже,
    // чтобы новой целью гарантированно оказался хаб, а не иная точка
    graph.drag = п;
    п.x = хабУзел2.x + 6000; п.y = хабУзел2.y + 6000;
    for (let i = 0; i < 10; i++) graph._tick(true);
    graph.drag = null;
    const якорьПосле = graph._якорь[нода.id];
    const связьЕсть = !!graph.links.find(l => !l.manual && l.a === нода.id && l.b === якорьПосле);
    t.push({имя:"нода переключает якорь, когда пустышку уносят рукой",
            ок: якорьДо === пуст.id && якорьПосле !== пуст.id && связьЕсть,
            факт: "якорь был " + якорьДо + ", стал " + якорьПосле + ", связь на новую цель: " + связьЕсть});
  }

  /* РУЧНОЕ ПРИКРЕПЛЕНИЕ К ПУСТЫШКЕ БОЛЬШЕ НЕ НАМЕРТВО. Раньше _linkTo(пустышка, нода) уводил
     область в «унаследованную» (areaAuto=true) и создавал РУЧНУЮ связь с ЭТОЙ ОДНОЙ пустышкой —
     нода выпадала из автовыбора по расстоянию навсегда: подвинь пустышку — нода тянется следом,
     хотя рядом мог быть хаб или другая пустышка ближе (КРОЛИК: «не может перескакивать на
     другую пустышку»). Теперь прикрепление делает область СВОЕЙ, как у хаба, — нода остаётся
     равноправным участником автовыбора и может позже перескочить куда угодно. */
  {
    const пуст2 = addItem({kind:"note", title:"Узел", area:обл.id, x:600, y:600});
    пуст2.hollow = true; пуст2.areaAuto = false;
    const другаяПустышка = addItem({kind:"note", title:"Узел", area:обл.id, x:900, y:600});
    другаяПустышка.hollow = true; другаяПустышка.areaAuto = false;
    const своб = addItem({kind:"note", title:"свободно крепится", area:null, x:605, y:605});
    recomputeHierarchy(); graph.build();

    const сообщение = graph._linkTo(пуст2.id, своб.id);
    recomputeHierarchy(); graph.build();
    const послеПрикрепления = S.items.find(x => x.id === своб.id);
    t.push({имя:"прикрепление к пустышке делает область СВОЕЙ, а не унаследованной",
            ок: послеПрикрепления.area === обл.id && послеПрикрепления.areaAuto === false,
            факт: "область " + послеПрикрепления.area + ", своя: " + (послеПрикрепления.areaAuto === false)
                + ", сообщение: " + сообщение});
    t.push({имя:"прикрепление к пустышке не создаёт постоянную ручную связь",
            ок: !graph.links.find(l => l.manual && ((l.a === пуст2.id && l.b === своб.id) || (l.b === пуст2.id && l.a === своб.id))),
            факт: "ручных связей узел↔пустышка: "
                + graph.links.filter(l => l.manual && (l.a === своб.id || l.b === своб.id)).length});

    // подвигаем ноду вплотную к ДРУГОЙ пустышке и даём физике переоценить — раньше застряла бы навсегда
    graph.byId[своб.id].x = другаяПустышка.x + 5; graph.byId[своб.id].y = другаяПустышка.y + 5;
    graph._якорь = {}; graph.build();
    for (let i = 0; i < 5; i++) graph._tick(true);
    t.push({имя:"нода, прикреплённая к пустышке, может перескочить на другую",
            ок: graph._якорь[своб.id] === другаяПустышка.id,
            факт: "якорь: " + graph._якорь[своб.id] + " (ждали " + другаяПустышка.id + ")"});

    [пуст2.id, другаяПустышка.id, своб.id].forEach(id => hardDeleteItem(id));
    recomputeHierarchy(); graph.build();
  }

  /* ЦЕПОЧКА ПУСТЫШЕК: «Ещё пустышка», нажатая ИЗ ПОПАПА ДРУГОЙ ПУСТЫШКИ, обязана цепляться к
     НЕЙ, а не идти напрямую к хабу («жму ПКМ по пустышке и добавляю ещё, крепится не к этой
     пустышке, а к ноде области»). */
  {
    const базовая = graph.byId[пуст.id];
    const дочерняя = graph._создатьПустышку(обл.id, базовая);
    recomputeHierarchy(); graph.build();
    const свежая = S.items.find(x => x.id === дочерняя.id);
    const л = graph.links.find(x => x.a === дочерняя.id);
    t.push({имя:"пустышка из попапа другой пустышки хранит явного родителя",
            ок: свежая.hollowParent === пуст.id, факт: "hollowParent: " + свежая.hollowParent});
    t.push({имя:"и цепляется линией именно к ней, а не к хабу",
            ок: !!л && л.b === пуст.id && л.hubLink === true,
            факт: л ? ("связь к " + л.b + ", hubLink: " + л.hubLink) : "связь не найдена"});
    // родителя снесли — цепочка не рвётся, дочерняя откатывается на хаб
    hardDeleteItem(пуст.id); recomputeHierarchy(); graph.build();
    const л2 = graph.links.find(x => x.a === дочерняя.id);
    t.push({имя:"после удаления родителя дочерняя пустышка откатывается на хаб",
            ок: !!л2 && л2.b === "hub_" + обл.id,
            факт: л2 ? ("связь теперь к " + л2.b) : "связь не найдена"});
    hardDeleteItem(дочерняя.id); recomputeHierarchy(); graph.build();
  }

  /* ПРОТЯЖКА (Alt-тащи) МЕЖДУ ДВУМЯ ПУСТЫШКАМИ ТОЖЕ ЦЕПЛЯЕТ ИХ, а не молчит. Раньше обе стороны
     «хаб или пустышка» отсекались одной строкой (`обА!=null && обБ!=null → null`), и жест
     между уже существующими пустышками не делал ничего — ни тоста, ни связи, просто тишина.
     КРОЛИК прислал скриншот с тонкой линией пустышка↔пустышка и решил, что это баг отрисовки;
     похоже на след именно этого молчания. «От» становится ребёнком «того, куда тянули». */
  {
    const пустA = addItem({kind:"note", title:"Узел", area:обл.id, x:1800, y:1800});
    пустA.hollow = true; пустA.areaAuto = false;
    const пустB = addItem({kind:"note", title:"Узел", area:обл.id, x:1900, y:1800});
    пустB.hollow = true; пустB.areaAuto = false;
    recomputeHierarchy(); graph.build();

    const сообщение = graph._linkTo(пустA.id, пустB.id);
    recomputeHierarchy(); graph.build();
    const свежаяA = S.items.find(x => x.id === пустA.id);
    const лA = graph.links.find(l => l.a === пустA.id);
    t.push({имя:"протяжка пустышка→пустышка ставит явного родителя",
            ок: свежаяA.hollowParent === пустB.id,
            факт: "hollowParent: " + свежаяA.hollowParent + ", сообщение: " + сообщение});
    t.push({имя:"и связь идёт к ней, магистралью, а не молчит",
            ок: !!лA && лA.b === пустB.id && лA.hubLink === true,
            факт: лA ? ("связь к " + лA.b + ", hubLink: " + лA.hubLink) : "связи нет вовсе"});

    // потянули дочернюю ОБРАТНО на хаб — цепочка снимается явно, а не только при удалении родителя
    const хабId = "hub_" + обл.id;
    graph._linkTo(пустA.id, хабId);
    recomputeHierarchy(); graph.build();
    const послеОбратно = S.items.find(x => x.id === пустA.id);
    const лA2 = graph.links.find(l => l.a === пустA.id);
    t.push({имя:"протяжка на хаб снимает цепочку явно",
            ок: !послеОбратно.hollowParent && !!лA2 && лA2.b === хабId,
            факт: "hollowParent: " + послеОбратно.hollowParent + ", связь к " + (лA2 && лA2.b)});

    [пустA.id, пустB.id].forEach(id => hardDeleteItem(id));
    recomputeHierarchy(); graph.build();
  }

  /* НАВЕДЕНИЕ НА ХАБ ПОКАЗЫВАЕТ И ТО, ЧТО ВИСИТ НА ЕГО ПУСТЫШКАХ — не только тех, кто зацепился
     напрямую («…должны подсвечиваться ноды, которые соединены непосредственно с этой областью
     И ПУСТЫШКАМИ в этой области»). Родня самой пустышки при этом ПО-ПРЕЖНЕМУ только её
     собственные связи — расширение работает лишь в одну сторону, от хаба. */
  {
    const пуст3 = addItem({kind:"note", title:"Узел", area:обл.id, x:1200, y:1200});
    пуст3.hollow = true; пуст3.areaAuto = false;
    const лист = addItem({kind:"note", title:"лист-через-пустышку", area:обл.id, x:1205, y:1205});
    recomputeHierarchy(); graph.build();
    const родняХаба = graph._родня("hub_" + обл.id);
    const родняПустышки = graph._родня(пуст3.id);
    t.push({имя:"наведение на хаб достаёт узлы через его пустышки",
            ок: !!родняХаба && родняХаба.has(лист.id) && родняХаба.has(пуст3.id),
            факт: "в родне хаба: пустышка " + (родняХаба && родняХаба.has(пуст3.id)) + ", лист через неё " + (родняХаба && родняХаба.has(лист.id))});
    t.push({имя:"а родня самой пустышки — по-прежнему только её собственные связи",
            ок: родняПустышки === graph.adj[пуст3.id],
            факт: "совпадает с adj: " + (родняПустышки === graph.adj[пуст3.id])});
    [пуст3.id, лист.id].forEach(id => hardDeleteItem(id));
    recomputeHierarchy(); graph.build();
  }

  /* СВЕЧЕНИЕ СВЯЗИ ПРИ НАВЕДЕНИИ НА ХАБ ОБЯЗАНО ДОХОДИТЬ ДО ЛИСТА ЧЕРЕЗ ПУСТЫШКУ, А НЕ
     ОБРЫВАТЬСЯ НА НЕЙ. Родня хаба уже включает лист (проверено выше), но старая проверка
     «связь касается hovId» смотрела только на ПРЯМОЕ касание — лист↔пустышка хаб не касается
     вовсе, и связь оставалась тусклой, хотя сам лист уже подрос и засветился (КРОЛИК прислал
     скриншот именно с этим разрывом: узел яркий, линия до него — нет). Проверяем пикселями —
     через перехват реальных вызовов отрисовки холста, как и в проверке толщины магистрали. */
  {
    const былРежим6 = S.settings.graphRender;
    S.settings.graphRender = "canvas";
    const пуст6 = addItem({kind:"note", title:"Узел", area:обл.id, x:2500, y:1200});
    пуст6.hollow = true; пуст6.areaAuto = false;
    const лист6 = addItem({kind:"note", title:"лист-через-пустышку-6", area:обл.id, x:2560, y:1200});
    лист6.areaAuto = false;      // СВОЯ: без реальной связи в S.links inherited-статус recomputeHierarchy обнулил бы область
    recomputeHierarchy(); render();

    const хабУзел6 = graph.byId["hub_" + обл.id];
    // камера — на середину лист↔пустышка: иначе отсечение по кадру пропустит связь как
    // «вне видимой области», раз камера могла остаться от прошлого блока где-то далеко
    graph.zoom = 1.5; graph.alpha = 0; graph.selNodes.clear();
    graph.tx = graph.W/2 - 2530*graph.zoom; graph.ty = graph.H/2 - 1200*graph.zoom;
    const ждГлоу = Math.max(0.75, 2.4 * graph.zoom);      // та же формула толщ(2.4), что в самой отрисовке

    const цикл = () => {
      const ctx = graph.mainCtx, журнал = [];
      const orig = ctx.stroke.bind(ctx);
      ctx.stroke = function(){ журнал.push(+ctx.lineWidth.toFixed(2)); return orig(); };
      graph._tick(true);
      ctx.stroke = orig;
      return журнал.filter(w => Math.abs(w - ждГлоу) < 0.01).length;
    };

    graph._hover(null); const безНаведения = цикл();
    graph._hover(хабУзел6.id); const приНаведенииНаХаб = цикл();

    t.push({имя:"свечение при наведении на хаб доходит до листа через пустышку",
            ок: приНаведенииНаХаб > безНаведения,
            факт: "штрихов шириной свечения (" + ждГлоу.toFixed(2) + " px): без наведения " + безНаведения
                + ", при наведении на хаб " + приНаведенииНаХаб});

    graph._hover(null);
    S.settings.graphRender = былРежим6 || "svg";
    [пуст6.id, лист6.id].forEach(id => hardDeleteItem(id));
    recomputeHierarchy(); render(); await ж(120);
  }

  /* МАГИСТРАЛЬ (hubLink) ОБЯЗАНА ОБХОДИТЬ ПРЕПЯТСТВИЕ И РАСТАЛКИВАТЬ УЗЛЫ — на большом дереве
     (>350 узлов), где включается порог экономии. Правило «связь, касающаяся хаба, дуг не
     получает и не отталкивает» писалось ДО пустышек, когда таких связей были СОТНИ (рядовой
     луч принадлежности каждой ноды); теперь их единицы (по одной на пустышку), и это как раз
     САМАЯ заметная линия графа — КРОЛИК прислал скриншот, где магистраль идёт прямо сквозь
     чужие ветки. Строим больше 350 узлов (заполнитель, не участвует в проверке), хаб и
     пустышку на известном расстоянии, помеху — ровно на линии между ними. */
  {
    const было7 = S.items.length;
    for (let i = 0; i < 360; i++) addItem({kind:"note", title:"заполнитель"+i, x:9000+i*4, y:9000});
    const пуст7 = addItem({kind:"note", title:"Узел", area:обл.id, x:0, y:0});
    пуст7.hollow = true; пуст7.areaAuto = false;
    recomputeHierarchy(); render(); await ж(200);

    const хабУзел7 = graph.byId["hub_" + обл.id], п7 = graph.byId[пуст7.id];
    хабУзел7.x = 0; хабУзел7.y = 300; п7.x = 0; п7.y = 0;    // короткая магистраль по вертикали
    // без области и связей вовсе — иначе у неё был бы СВОЙ авто-якорь, и тест проверял бы уже
    // не «отталкивание от магистрали», а смесь сил вперемешку
    const помеха7 = addItem({kind:"task", title:"помеха-магистрали", x:0, y:150});
    recomputeHierarchy(); graph.build();

    const лМагистраль = () => graph.links.find(l => l.hubLink && ((l.a===пуст7.id&&l.b===хабУзел7.id)||(l.b===пуст7.id&&l.a===хабУзел7.id)));

    /* КАМЕРА НАРОЧНО ДАЛЕКО от магистрали. Раньше «связь вне кадра» пропускала расчёт дуги
       ЛЮБОЙ связи без исключений — и магистраль, ни разу не попавшая в кадр за время остывания
       раскладки, осталась бы прямой НАВСЕГДА: панорама и зум сами физику не будят (см.
       _двигались в _tick — там только alpha/drag/дыхание), а больше ничего пересчёт не просит. */
    graph.zoom = 1; graph.tx = -100000; graph.ty = -100000; graph.alpha = 0;
    graph._recalcBends();
    const л7вне = лМагистраль();
    t.push({имя:"магистраль огибает помеху, даже если камера сейчас далеко от неё",
            ок: !!л7вне && !!л7вне._bendT,
            факт: л7вне ? ("_bendT: " + JSON.stringify(л7вне._bendT)) : "магистраль не найдена"});

    // камера — на саму магистраль: и _recalcBends, и отталкивание отсекают связи «вне кадра»
    // по ТЕКУЩЕЙ камере (см. вид.x1/x2 в _recalcBends), а она могла остаться от прошлого теста
    graph.zoom = 1; graph.tx = graph.W/2; graph.ty = graph.H/2 - 150;
    graph.alpha = 0; graph._recalcBends(); graph._tick(true);
    const л7 = лМагистраль();
    t.push({имя:"магистраль теперь обходит лежащую на ней ноду (>350 узлов)",
            ок: !!л7 && !!л7._bendT,
            факт: (л7 ? ("_bendT: " + JSON.stringify(л7._bendT) + ", hubLink:" + л7.hubLink) : "магистраль не найдена")
                + " | узлов " + graph.nodes.length + " | хаб(" + хабУзел7.x + "," + хабУзел7.y + ") пуст(" + п7.x + "," + п7.y + ") помеха(" + graph.byId[помеха7.id].x + "," + graph.byId[помеха7.id].y + ")"});

    // отталкивание: помеха стоит ровно на линии — после нескольких кадров физики обязана отъехать
    const наЛинии = () => { const dx=хабУзел7.x-п7.x, dy=хабУзел7.y-п7.y, L2=dx*dx+dy*dy||1;
      const н=graph.byId[помеха7.id];
      let t=((н.x-п7.x)*dx+(н.y-п7.y)*dy)/L2; t=Math.max(0,Math.min(1,t));
      return Math.hypot(н.x-(п7.x+dx*t), н.y-(п7.y+dy*t)); };
    const доОтталкивания = наЛинии();
    graph.alpha = 0.6;
    for (let i = 0; i < 150; i++) graph._tick(true);
    const послеОтталкивания = наЛинии();
    t.push({имя:"и отталкивает от себя лежащую на ней ноду (>350 узлов)",
            ок: послеОтталкивания > доОтталкивания + 5,
            факт: "расстояние до магистрали " + доОтталкивания.toFixed(1) + " → " + послеОтталкивания.toFixed(1) + " px"});

    S.items.slice(было7).map(i => i.id).forEach(id => hardDeleteItem(id));
    recomputeHierarchy(); render(); await ж(150);
  }

  /* ПОДПИСЬ ПУСТЫШКИ — ЖИВОЕ ИМЯ ОБЛАСТИ, копирует его буквально: переименовали область —
     подпись на графе обязана поменяться сама, а не остаться со старым именем.
     СВОЯ пустышка для этого теста: исходная `пуст` к этому месту файла уже снесена в блоке
     «цепочка пустышек» (там нарочно проверяли откат осиротевшей дочерней на хаб) — опора на
     чужой, уже мёртвый узел один раз и дала «label: undefined» вместо настоящей проверки. */
  {
    const пуст4 = addItem({kind:"note", title:"Узел", area:обл.id, x:1500, y:1500});
    пуст4.hollow = true; пуст4.areaAuto = false;
    const старНазв = обл.name;
    обл.name = "Замер-имя-области";
    recomputeHierarchy(); graph.build();
    const узелПуст = graph.byId[пуст4.id];
    t.push({имя:"подпись пустышки — это имя её области",
            ок: !!узелПуст && узелПуст.label === "Замер-имя-области",
            факт: "label узла: " + (узелПуст && узелПуст.label)});
    обл.name = старНазв;
    hardDeleteItem(пуст4.id); recomputeHierarchy(); graph.build();
  }

  /* DELETE ПО ВЫДЕЛЕННОМУ ХАБУ УДАЛЯЕТ ОБЛАСТЬ — тем же путём и с тем же подтверждением, что
     кнопка в поп-апе. Подтверждение подменяем на автоматическое «да», как и мост pywebview
     в других проверках этого файла. */
  {
    const тестОбл = {id: "a_тест_" + uid(), name: "Область для удаления", icon: "ti-circle", color: null};
    S.areas.push(тестОбл);
    const узелВОбласти = addItem({kind:"note", title:"остаётся без области", area: тестОбл.id, x:2000, y:2000});
    recomputeHierarchy(); graph.build();
    const хабId = "hub_" + тестОбл.id;
    graph.selNodes = new Set([хабId]);

    const _origConfirm = uiConfirm;
    uiConfirm = async () => true;
    let сбой = null;
    try { await graph.deleteSelected(); } catch (e) { сбой = (e && e.message) || String(e); }
    uiConfirm = _origConfirm;

    t.push({имя:"Delete по выделенной области удаляет её (с подтверждением)",
            ок: !сбой && !S.areas.find(x => x.id === тестОбл.id),
            факт: сбой ? "ошибка: " + сбой : "область " + (S.areas.find(x => x.id === тестОбл.id) ? "осталась" : "удалена")});
    const узелПосле = S.items.find(x => x.id === узелВОбласти.id);
    t.push({имя:"ноды области при этом остаются, просто теряют область",
            ок: !!узелПосле && !узелПосле.deleted && узелПосле.area == null,
            факт: узелПосле ? ("жива: true, область: " + узелПосле.area) : "нода пропала"});

    hardDeleteItem(узелВОбласти.id);
    recomputeHierarchy(); render(); await ж(120);
  }

  /* УНАСЛЕДОВАННАЯ ОБЛАСТЬ НЕ ДОЛЖНА ДАВАТЬ УЗЛУ СВОЙ ЦВЕТ В ОБХОД РОДИТЕЛЯ. Баг с фото
     КРОЛИКА: лиловая нода посреди оранжевого дерева — она унаследовала область (areaAuto=true)
     через recomputeHierarchy, а область эта резолвится не по видимому дереву, а по числу шагов
     в графе связей, и может оказаться ДРУГОЙ, чем у родителя рядом. Раньше это давало ей цвет
     ОБЛАСТИ напрямую, теперь — только для узла, которому область назначена ЯВНО (areaAuto=false);
     унаследованный узел остаётся без цвета на этом шаге и берёт его у ближайшего цветного
     соседа по цепочке (обычно это и есть родитель). Строим ровно такой узел руками: родитель
     свой (own color, оранжевый), сам узел — унаследованная область ДРУГОГО, лилового цвета. */
  {
    const обл2 = {id: "a_лилов_" + uid(), name: "Другая", icon: "ti-circle", color: "#b090ff"};
    S.areas.push(обл2);
    const родитель = addItem({kind:"note", title:"родитель", color:"#ff8a3c", x:2500, y:2500});
    const узел = addItem({kind:"note", title:"наследник", area:обл2.id, x:2560, y:2500});
    узел.areaAuto = true;                    // как после recomputeHierarchy: область не своя, а найдена по BFS
    S.links.push([родитель.id, узел.id, 1]);
    recomputeHierarchy(); render(); await ж(150);

    const цветУзла = graph.byId[узел.id] && graph.byId[узел.id].color;
    t.push({имя:"узел с унаследованной областью берёт цвет родителя, а не своей области",
            ок: цветУзла === "#ff8a3c",
            факт: "цвет узла " + цветУзла + " (родителя #ff8a3c, чужой области " + обл2.color + ")"});

    // а вот узлу, которому область назначена ЯВНО, цвет области принадлежит по праву
    const прямойВладелец = addItem({kind:"note", title:"хозяин области", area:обл2.id, x:2700, y:2700});
    прямойВладелец.areaAuto = false;
    recomputeHierarchy(); render(); await ж(120);
    const цветВладельца = graph.byId[прямойВладелец.id] && graph.byId[прямойВладелец.id].color;
    t.push({имя:"а узел со СВОЕЙ областью цвет области получает",
            ок: цветВладельца === обл2.color,
            факт: "цвет узла " + цветВладельца + " (ждали цвет области " + обл2.color + ")"});

    [родитель.id, узел.id, прямойВладелец.id].forEach(id => hardDeleteItem(id));
    S.areas = S.areas.filter(x => x.id !== обл2.id);
    recomputeHierarchy(); render(); await ж(120);
  }

  обл.color = былЦвет;
  S.items.slice(было).map(i => i.id).forEach(id => hardDeleteItem(id));
  recomputeHierarchy(); render(); await ж(120);
}

/* «ГОТОВО» ПРИМЕНЯЕТСЯ КО ВСЕМУ ВЫДЕЛЕНИЮ — как цвет и статусы. Закрывают задачи пачками (сдал
   шот — готовы все его задачи), а до этого завершать приходилось по одной. Проверяем и обратный
   ход: если кликнутая нода уже выполнена, всё выделение возвращается в работу. */
{
  const было = S.items.length;
  const з = [];
  for (let i = 0; i < 3; i++) з.push(addItem({kind:"task", title:"пачка"+i, x:i*40, y:0}));
  const чужая = addItem({kind:"task", title:"вне выделения", x:200, y:0});
  render(); await ж(150);

  graph.selNodes = new Set(з.map(i => graph.byId[i.id] ? i.id : null).filter(Boolean));
  graph._setDone(graph.byId[з[0].id]);
  const готовы = з.filter(i => S.items.find(x => x.id === i.id).done).length;
  const чужаяЦела = !S.items.find(x => x.id === чужая.id).done;
  t.push({имя:"«Готово» применяется ко всему выделению", ок: готовы === 3 && чужаяЦела,
          факт: "завершено " + готовы + " из 3, невыделенная " + (чужаяЦела ? "не тронута" : "ЗАДЕТА")});

  graph.selNodes = new Set(з.map(i => i.id));
  graph._setDone(graph.byId[з[0].id]);
  const вернулись = з.filter(i => !S.items.find(x => x.id === i.id).done).length;
  t.push({имя:"повторное «Готово» возвращает в работу всё выделение", ок: вернулись === 3,
          факт: "возвращено " + вернулись + " из 3"});

  // одиночная нода вне выделения меняется одна — выделение при этом не при чём
  graph.selNodes = new Set(з.map(i => i.id));
  graph._setDone(graph.byId[чужая.id]);
  t.push({имя:"нода вне выделения завершается одна",
          ок: S.items.find(x => x.id === чужая.id).done && з.every(i => !S.items.find(x => x.id === i.id).done),
          факт: "выделенных задето " + з.filter(i => S.items.find(x => x.id === i.id).done).length});

  graph.selNodes.clear();
  S.items.slice(было).map(i => i.id).forEach(id => hardDeleteItem(id));
  render(); await ж(120);
}

/* ДВОЙНОЙ КЛИК ОТКРЫВАЕТ ПАПКУ, если она привязана: за нодой у КРОЛИКА стоит шот или проект, и
   «открыть» для него — попасть в рендеры, а не прочитать описание. Без папки поведение прежнее
   (ридер или редактор). Мост в стенде подставляем заглушкой, как в замере дрожи. */
{
  const сПапкой = addItem({kind:"note", title:"нода с папкой", x:0, y:0, folder:"E:\\проект\\шот"});
  const безПапки = addItem({kind:"note", title:"нода без папки", x:60, y:0});
  render(); await ж(150);
  const путь = [], _пв = window.pywebview;
  window.pywebview = {api:{load:()=>null, open_path:(p)=>{ путь.push(p); return true; }}};
  const узел = graph.byId[сПапкой.id];
  if (узел) graph._openNode(узел);
  const открылась = путь.length === 1 && путь[0] === "E:\\проект\\шот";

  // без папки — прежний путь: открывается содержимое ноды, а не проводник
  const оверлеевДо = document.querySelector("#overlay-root").children.length;
  const у2 = graph.byId[безПапки.id];
  if (у2) graph._openNode(у2);
  const оверлеевПосле = document.querySelector("#overlay-root").children.length;
  window.pywebview = _пв;
  closeOverlays();

  t.push({имя:"двойной клик по ноде с папкой открывает её на ПК", ок: открылась,
          факт: путь.length ? "мосту передан путь " + путь[0] : "мост не вызван"});
  t.push({имя:"нода без папки открывается по-прежнему содержимым",
          ок: путь.length === 1 && оверлеевПосле > оверлеевДо,
          факт: "лишних вызовов моста " + (путь.length - 1) + ", окон открылось " + (оверлеевПосле - оверлеевДо)});

  hardDeleteItem(сПапкой.id); hardDeleteItem(безПапки.id); render(); await ж(120);
}

/* РАМКА С SHIFT — ПЕРЕКЛЮЧАТЕЛЬ. Обвёл лишнее с зажатым Shift — оно из выделения ушло; без
   Shift рамка по-прежнему только добавляет. Жест общий для обоих рендеров: он считается по
   координатам узлов, а не по разметке. */
{
  const svg = graph.svg, rc = svg.getBoundingClientRect();
  const узлы = graph.nodes.filter(n => n.id.indexOf("hub_") !== 0).slice(0, 2);
  const экр = (wx, wy) => ({x: rc.left + (wx*graph.zoom + graph.tx)/graph.W*rc.width,
                            y: rc.top  + (wy*graph.zoom + graph.ty)/graph.H*rc.height});
  // рамка вокруг обоих узлов: считаем углы по их координатам с запасом
  const x1 = Math.min(...узлы.map(n => n.x)) - 40, y1 = Math.min(...узлы.map(n => n.y)) - 40;
  const x2 = Math.max(...узлы.map(n => n.x)) + 40, y2 = Math.max(...узлы.map(n => n.y)) + 40;
  const A = экр(x1, y1), B = экр(x2, y2);

  graph.selNodes = new Set(узлы.map(n => n.id)); graph._paintSel();
  svg.dispatchEvent(new PointerEvent("pointerdown", {button:0, shiftKey:true, clientX:A.x, clientY:A.y, bubbles:true, cancelable:true}));
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons:1, shiftKey:true, clientX:B.x, clientY:B.y, bubbles:true, cancelable:true}));
  const послеShift = new Set(graph.selNodes);
  svg.dispatchEvent(new PointerEvent("pointerup", {button:0, clientX:B.x, clientY:B.y, bubbles:true, cancelable:true}));
  t.push({имя:"рамка с Shift снимает выделение с уже выделенных",
          ок: узлы.every(n => !послеShift.has(n.id)),
          факт: "было " + узлы.length + ", осталось " + узлы.filter(n => послеShift.has(n.id)).length});

  graph.selNodes.clear(); graph._paintSel();
  svg.dispatchEvent(new PointerEvent("pointerdown", {button:0, clientX:A.x, clientY:A.y, bubbles:true, cancelable:true}));
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons:1, clientX:B.x, clientY:B.y, bubbles:true, cancelable:true}));
  const безShift = new Set(graph.selNodes);
  svg.dispatchEvent(new PointerEvent("pointerup", {button:0, clientX:B.x, clientY:B.y, bubbles:true, cancelable:true}));
  t.push({имя:"рамка без Shift по-прежнему выделяет", ок: узлы.every(n => безShift.has(n.id)),
          факт: "выделено " + узлы.filter(n => безShift.has(n.id)).length + " из " + узлы.length});
  graph.selNodes.clear(); graph._paintSel();
}

/* ПОКОЙ НЕ ЖЖЁТ ВИДЕОКАРТУ. Раньше «покой» лишь пропускал КАЖДЫЙ ВТОРОЙ кадр — то есть граф,
   ничего не меняя на экране, вечно перерисовывал ТРИ полноэкранных слоя тридцать раз в секунду:
   фон (WebGL), холст графа и холст свечения (там shadowBlur — самое дорогое в canvas2d). Для
   композитора это три текстуры во весь размер окна, заново заливаемые 30 раз в секунду, — вот
   откуда «граф жрёт видеокарту» при полностью статичной картинке.
   Теперь в покое частота падает вшестеро, а на большом дереве (>350 узлов — дыхание нод там и так
   выключено) трогается ТОЛЬКО фон: у графа и свечения пиксели кадр в кадр те же. Любая активность
   обязана покой снимать, иначе граф замрёт на экране — это проверяем отдельно. */
{
  const былоП = S.items.length;
  for (let i = 0; i < 380; i++) addItem({kind:"note", title:"покой"+i, x:(i%20)*90, y:Math.floor(i/20)*90});
  recomputeHierarchy(); render(); await ж(200);
  const былРежимП = S.settings.graphRender;
  S.settings.graphRender = "canvas"; render(); await ж(60);

  // считаем, сколько из N кадров РЕАЛЬНО что-то рисуют, по каждому слою отдельно
  const счёт = (n, до) => {
    const c = {фон:0, граф:0, свечение:0};
    const о1 = graph._drawBg.bind(graph), о2 = graph._drawMain.bind(graph), о3 = graph._drawGlow.bind(graph);
    graph._drawBg = function(){ c.фон++; return о1(); };
    graph._drawMain = function(){ c.граф++; return о2(); };
    graph._drawGlow = function(){ c.свечение++; return о3(); };
    for (let i = 0; i < n; i++){ if (до) до(i); graph._tick(); }   // force=false — как в живом цикле
    graph._drawBg = о1; graph._drawMain = о2; graph._drawGlow = о3;
    return c;
  };

  graph.alpha = 1; for (let i = 0; i < 300; i++) graph._tick(true);   // разложить
  graph.alpha = 0; graph._hovId = null; graph.drag = null;
  for (let i = 0; i < 60; i++) graph._tick();                         // дать дугам доехать
  const впокое = счёт(100);
  t.push({имя:"в покое на большом дереве граф и свечение не перерисовываются вовсе",
          ок: впокое.граф === 0 && впокое.свечение === 0 && впокое.фон > 0,
          факт: "на 100 кадров: фон " + впокое.фон + ", граф " + впокое.граф
              + ", свечение " + впокое.свечение + " (узлов " + graph.nodes.length + ")"});

  /* А РЕДКОСТЬ КАДРОВ ТЕПЕРЬ МЕРИТСЯ ВРЕМЕНЕМ, а не счётчиком пропусков. Раньше покой пропускал
     9 кадров из 10 — то есть поток всё равно будили с частотой монитора (у КРОЛИКА 165 Гц), чтобы
     159 раз в секунду выйти из _tick сразу же. Теперь цикл СПИТ таймером (ПОКОЙ_МС), и проверять
     это синхронными вызовами _tick бессмысленно: время между ними не идёт. */
  const позв = async (мс) => {
    let n = 0;
    const о = graph._tick.bind(graph);
    graph._tick = function(f){ n++; return о(f); };
    graph._wake();
    await ж(мс);
    delete graph._tick;
    return n;
  };
  const впокоеЗаСек = await позв(1000);
  t.push({имя:"в покое цикл спит, а не крутится с частотой монитора",
          ок: впокоеЗаСек >= 1 && впокоеЗаСек <= 14,
          факт: "кадров за секунду покоя: " + впокоеЗаСек + " (ждали около 6)"});

  /* ПОТОЛОК ЧАСТОТЫ. На 165-герцевом мониторе без него кадров втрое больше задуманного: вся
     плавность в кадре (зум 0.28, остывание 0.985, дуги) считалась под 60, а видеокарта разгонялась
     с 210 до 2000 МГц — 42.6 Вт против 19.6 при том же самом изображении. */
  const былПот = S.settings.graphFpsCap;
  S.settings.graphFpsCap = 60;
  graph.alpha = 1;
  const сПотолком = await позв(1000);
  graph.alpha = 0;
  S.settings.graphFpsCap = былПот;
  t.push({имя:"потолок частоты держит заданные кадры в секунду",
          ок: сПотолком >= 30 && сПотолком <= 85,
          факт: "кадров за секунду при потолке 60: " + сПотолком});

  /* ЗУМ ГОТОВОЙ КАРТИНКОЙ. Пока крутят колесо, граф не перерисовывается, а выводится снимком со
     сдвигом и масштабом (замер: честный кадр 0.641 мс против 0.001 мс картинкой). Проверяем три
     вещи: честных кадров становится в разы меньше, картинка при этом НЕ пустая, и выключатель
     возвращает прежнее поведение. */
  /* Камеру ставим руками на центр дерева. `_fitView` тут не годится: он увозит камеру ПЛАВНО,
     своими кадрами через requestAnimationFrame, а мы гоняем _tick синхронным циклом — эти кадры
     не успевают случиться, и замер шёл по пустому участку холста. */
  const наЦентр = (масштаб) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of graph.nodes){ if (n.x < x1) x1 = n.x; if (n.x > x2) x2 = n.x;
                                  if (n.y < y1) y1 = n.y; if (n.y > y2) y2 = n.y; }
    graph.zoom = масштаб || Math.min(graph.W / Math.max(1, x2 - x1 + 120),
                                     graph.H / Math.max(1, y2 - y1 + 120));
    /* С заданным масштабом целимся в САМУ ноду, а не в середину габарита: в середине дерева
       бывает пусто (ветки расходятся кольцом), и проба показывала бы чистый холст. */
    const ц = масштаб ? graph.nodes[0] : {x:(x1 + x2) / 2, y:(y1 + y2) / 2};
    graph.tx = graph.W / 2 - ц.x * graph.zoom;
    graph.ty = graph.H / 2 - ц.y * graph.zoom;
    graph._tick(true);
  };
  const зумКадры = async (быстро, кадров) => {
    S.settings.graphFastZoom = быстро;
    graph._сн = null; graph.alpha = 0; graph._hovId = null; graph.drag = null;
    наЦентр();
    let честных = 0;
    const о = graph._drawMain.bind(graph);
    graph._drawMain = function(){ честных++; return о(); };
    for (let i = 0; i < кадров; i++){
      graph._zoomTo = graph.zoom * 1.02;
      graph._zoomAt = {x: graph.W / 2, y: graph.H / 2};
      graph._tick(true);
    }
    graph._drawMain = о;
    graph._zoomTo = null;
    return честных;
  };
  // сколько на холсте непрозрачных точек: пустой холст = снимок не лёг или лёг мимо экрана
  const точек = () => {
    try {
      const хв = graph.mainCanvas, д = хв.getContext("2d").getImageData(0, 0, хв.width, хв.height).data;
      let n = 0;
      for (let i = 3; i < д.length; i += 16) if (д[i] > 8) n++;   // каждая четвёртая точка — хватает
      return n;
    } catch (e) { return -1; }
  };
  const медленных = await зумКадры(false, 24);
  const тЧестно = точек();
  const быстрых = await зумКадры(true, 24);
  const тБыстро = точек();
  S.settings.graphFastZoom = true;
  t.push({имя:"зум картинкой: честных перерисовок в разы меньше",
          ок: быстрых > 0 && быстрых <= медленных / 2,
          факт: "на 24 кадра зума: с картинкой " + быстрых + " честных, без неё " + медленных});
  const хв = graph.mainCanvas;
  /* Полосу допуска держим широкой намеренно: масштабированная картинка мылит кромки, и
     полупрозрачных точек у неё ВСЕГДА заметно больше, чем у честной отрисовки. Проверяем не
     попиксельное совпадение, а что изображение есть и оно того же порядка. */
  t.push({имя:"зум картинкой: на экране то же изображение, а не пустота",
          ок: тЧестно > 100 && тБыстро > тЧестно * 0.4 && тБыстро < тЧестно * 3.5,
          факт: "непрозрачных точек: картинкой " + тБыстро + ", честной отрисовкой " + тЧестно
              + " | холст " + (хв ? хв.width + "x" + хв.height : "нет")
              + ", W/H " + graph.W + "x" + graph.H + ", зум " + graph.zoom.toFixed(2)
              + ", снимок " + (graph._сн ? graph._сн.cv.width + "x" + graph._сн.cv.height : "нет")});

  graph._hovId = graph.nodes[5].id;
  const нав = счёт(40);
  graph._hovId = null;
  t.push({имя:"курсор на ноде покой снимает — кадры снова полные",
          ок: нав.граф >= 40 && нав.свечение >= 40,
          факт: "на 40 кадров: граф " + нав.граф + ", свечение " + нав.свечение});

  const пан = счёт(30, () => { graph.tx += 1; });
  t.push({имя:"панорама покой снимает тоже",
          ок: пан.граф >= 30,
          факт: "на 30 кадров: граф " + пан.граф});

  S.settings.graphRender = былРежимП || "svg";
  S.items.slice(былоП).map(i => i.id).forEach(id => hardDeleteItem(id));
  /* Убираем ЗА СОБОЙ выделение и правую панель. Сценарии идут друг за другом в одной странице,
     и брошенное выделение переживает смену сценария: панель показывала сводку по группе вместо
     подсказки «выбери ноду», и падал уже сценарий «панель», а не этот. */
  graph.selNodes.clear(); graph._paintSel(); asideSelect(null);
  recomputeHierarchy(); render(); await ж(150);
}

/* СЧЁТЧИК КАДРОВ (Ctrl+Shift+F). Он существует ради того, чтобы КРОЛИК мерил плавность в своём
   файле, а не по чужому стенду, — значит он обязан работать и показывать разбивку кадра, а не
   просто появляться. Проверяем: панель поднимается, в ней есть числа по всем трём статьям,
   выключение её убирает, а выключенный счётчик ничего не считает. */
{
  S.settings.graphFps = true;
  graph.alpha = 1;
  const t0 = performance.now();
  while (performance.now() - t0 < 700) graph._tick(true);      // панель обновляется раз в 500 мс
  const box = document.querySelector("#g-fps");
  const текст = box ? box.textContent : "";
  t.push({имя:"счётчик кадров показывает панель", ок: !!box && /кадров\/с\s+\d/.test(текст),
          факт: текст ? текст.split("\n")[0] : "панели нет"});
  t.push({имя:"счётчик разбирает кадр по статьям",
          ок: /физика\s+[\d.]+/.test(текст) && /свечение\s+[\d.]+/.test(текст) && /прочее\s+[\d.]+/.test(текст),
          факт: текст ? текст.split("\n")[1] : "—"});

  S.settings.graphFps = false;
  graph._tick(true);
  t.push({имя:"счётчик выключается вместе с настройкой", ок: !document.querySelector("#g-fps"),
          факт: document.querySelector("#g-fps") ? "панель осталась" : "панель снята"});
  graph.alpha = 0;
}

/* ===== аудит производительности (2026-08-09): 4 находки, 4 проверки ===== */

/* 1. Ctrl+Z ИГНОРИРУЕТ АВТОПОВТОР ОС. Держат клавишу — Windows шлёт keydown 20-30 раз в
   секунду, и раньше каждый шаг синхронно писал на диск весь файл через мост. Один физический
   нажим обязан сработать, автоповтор — нет. */
{
  let вызовов = 0;
  const оригU = undoStep, оригR = redoStep;
  window.undoStep = function(...a){ вызовов++; return оригU.apply(this,a); };
  window.redoStep = function(...a){ вызовов++; return оригR.apply(this,a); };
  const ае=document.activeElement; if(ае && ае.blur) ае.blur();   // страж полей ввода не должен сработать раньше нужного
  document.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyZ",ctrlKey:true,repeat:true,bubbles:true,cancelable:true}));
  const отПовтора=вызовов;
  document.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyZ",ctrlKey:true,repeat:false,bubbles:true,cancelable:true}));
  const отОбычного=вызовов;
  window.undoStep=оригU; window.redoStep=оригR;
  t.push({имя:"Ctrl+Z игнорирует автоповтор ОС, но не обычное нажатие",
          ок: отПовтора===0 && отОбычного===1,
          факт:"вызовов после repeat:true — "+отПовтора+", после обычного нажатия — "+отОбычного});
}

/* 2. ШАГ ОТКАТА ПИШЕТ НА ДИСК ОТЛОЖЕННО, А НЕ СИНХРОННО. _undoApply раньше в конце ВСЕГДА
   немедленно звала writeNow() в обход дебаунса — теперь через тот же _scheduleWrite, что и
   обычная правка (общая переменная saveTimer). */
{
  const тест = addItem({kind:"note", title:"тест-отката-запись"});
  recomputeHierarchy(); persist(); await ж(300);
  const очередьПуста = saveTimer===null;

  тест.title = "тест-отката-запись·правка";
  persist(); await ж(300);   // дать дебаунсу закрыться — это и есть шаг, который сейчас откатим

  const откатился = undoStep();
  const сразуЗапланирована = saveTimer!==null;
  await ж(400);
  const сработалаПослеОжидания = saveTimer===null;

  t.push({имя:"откат планирует запись отложенно (не пишет синхронно)",
          ок: очередьПуста && откатился && сразуЗапланирована && сработалаПослеОжидания,
          факт:"очередь пуста до теста: "+очередьПуста+"; откат применился: "+откатился
              +"; сразу после undoStep таймер "+(сразуЗапланирована?"запланирован":"ПУСТ (писало бы синхронно)")
              +"; после ожидания "+(сработалаПослеОжидания?"сработал":"всё ещё висит")});

  hardDeleteItem(тест.id); recomputeHierarchy(); persist(true); await ж(300);
}

/* 3. ПРАВКА ЗАГОЛОВКА/ОПИСАНИЯ НЕ ГОНЯЕТ ПОЛНУЮ ПЕРЕСБОРКУ ГРАФА. build() красит всё дерево
   BFS'ом и пересчитывает точки крепления КАЖДОЙ ноды — от текста одной ноды это не зависит.
   Заголовок правит graph._patchLabel точечно, описание графа вообще не касается. */
{
  const тест = addItem({kind:"note", title:"было", x:400, y:400});
  recomputeHierarchy(); graph.build(); await ж(60);
  asideSelect(тест.id);
  const панель=document.querySelector("#aside");
  const загл=панель?панель.querySelector(".as-title"):null;
  const тело=панель?панель.querySelector('[data-f="body"]'):null;
  if(загл && тело){
    let построек=0; const оригB=graph.build.bind(graph);
    graph.build=function(...a){ построек++; return оригB(...a); };

    загл.textContent="стало"; загл.dispatchEvent(new Event("input",{bubbles:true}));
    await ж(500);
    const построекПослеЗаголовка=построек;
    const меткаОбновилась = graph.byId[тест.id] && graph.byId[тест.id].label==="стало";

    тело.value="текст описания"; тело.dispatchEvent(new Event("input",{bubbles:true}));
    await ж(500);
    const построекПослеТела=построек;
    graph.build=оригB;

    t.push({имя:"правка заголовка ноды не зовёт build(), подпись меняется точечно",
            ок: построекПослеЗаголовка===0 && меткаОбновилась,
            факт:"build() вызван "+построекПослеЗаголовка+" раз(а) на правку заголовка; подпись узла: \""
                +(graph.byId[тест.id]?graph.byId[тест.id].label:"нет узла")+"\""});
    t.push({имя:"правка описания графа вообще не касается",
            ок: построекПослеТела===построекПослеЗаголовка,
            факт:"build() до правки тела "+построекПослеЗаголовка+", после "+построекПослеТела});
  } else {
    t.push({имя:"правка заголовка ноды не зовёт build()", ок:false,
            факт:"панель/поля не найдены: заголовок "+(!!загл)+", тело "+(!!тело)});
  }
  asideSelect(null);
  hardDeleteItem(тест.id); recomputeHierarchy(); graph.build();
}

/* 4. ПОИСК ПО ГРАФУ — С ЗАДЕРЖКОЙ. Раньше каждая буква сразу гоняла полный скан узлов и
   перекраску классов dim/hit по всем nodeEls/linkEls. */
{
  graph.openSearch();
  const box=document.querySelector("#g-search-box");
  const inp=box?box.querySelector("input"):null;
  if(inp){
    let вызовов=0; const оригS=graph.search.bind(graph);
    graph.search=function(...a){ вызовов++; return оригS(...a); };
    inp.value="п"; inp.dispatchEvent(new Event("input",{bubbles:true}));
    const сразу=вызовов;
    await ж(80);
    const через80=вызовов;
    await ж(200);
    const через280=вызовов;
    graph.search=оригS; graph.closeSearch();
    t.push({имя:"поиск по графу срабатывает с задержкой, а не на каждую букву",
            ок: сразу===0 && через80===0 && через280===1,
            факт:"вызовов сразу "+сразу+", через 80мс "+через80+", через 280мс "+через280});
  } else {
    t.push({имя:"поиск по графу срабатывает с задержкой, а не на каждую букву", ок:false,
            факт:"строка поиска не найдена"});
    graph.closeSearch();
  }
}

/* 5. НАСТРОЙКИ ГРАФА ПИШУТ ТИХО. Ползунки/переключатели вида меняют только S.settings — в
   снимок отката это не входит, обычный persist() в конце дебаунса всё равно гонял бы две
   полные сериализации данных ради сравнения, которое ничего не найдёт. */
{
  openSettings("graph"); await ж(60);
  const btn=document.querySelector('#set-bg button[data-v="0"]');
  if(btn){
    let вызовов=0, последнийQuiet=null; const оригP=persist;
    window.persist=function(q){ вызовов++; последнийQuiet=q; return оригP(q); };
    const было=S.settings.graphBg;
    btn.click();
    window.persist=оригP;
    S.settings.graphBg=было; persist(true);
    t.push({имя:"переключатель настроек графа пишет тихо (persist(true))",
            ок: вызовов===1 && последнийQuiet===true,
            факт:"persist вызван "+вызовов+" раз(а), quiet="+последнийQuiet});
  } else {
    t.push({имя:"переключатель настроек графа пишет тихо (persist(true))", ок:false,
            факт:"кнопка #set-bg не найдена — вкладка «Граф» не открылась?"});
  }
  closeOverlays();
}

/* ===== несвязанные деревья не съезжаются к общей куче =====
   Симптом (КРОЛИК, 2026-08-20): два дерева, не связанных ничем (разные области), всё равно
   едут друг к другу, и развести их руками невозможно. Причина не в отталкивании, а в стяжке:
   притяжение к ОБЩЕМУ центру масс линейно по расстоянию, то есть сжимает всё поле графа к одной
   точке — расстояние между любыми двумя кусками тает на k·alpha каждый кадр, сколько их ни
   разноси. Лечится тем, что точка притяжения считается по СВОЕМУ ОСТРОВУ (build/_остров).
   Сцена стоит далеко от демо-графа: рядом с ним замер мерил бы общий переезд к чужой куче. */
{
  const дерево = (имя, x, y) => {
    const к = addItem({kind:"task", title:имя+"корень"}); к.x = x; к.y = y;
    const дети = [];
    for (let i = 0; i < 4; i++) { const д = addItem({kind:"task", title:имя+i});
      const a = i/4*Math.PI*2; д.x = x + Math.cos(a)*120; д.y = y + Math.sin(a)*120;
      S.links.push([к.id, д.id, 1]); дети.push(д); }
    return [к, ...дети];
  };
  const A = дерево("островA", 30000, 30000), B = дерево("островB", 33000, 30000);
  recomputeHierarchy(); graph.build();
  const цм = список => { let x = 0, y = 0, n = 0;
    список.forEach(it => { const у = graph.byId[it.id]; if (у) { x += у.x; y += у.y; n++; } });
    return n ? {x:x/n, y:y/n, n} : null; };
  const цA = цм(A), цB = цм(B);
  if (цA && цB && цA.n === 5 && цB.n === 5) {
    const остр = graph._остров || {};
    t.push({имя:"несвязанные деревья — разные острова",
            ок: остр[A[0].id] != null && остр[A[0].id] !== остр[B[0].id],
            факт:"островов на графе " + graph._островов + ", A=" + остр[A[0].id] + ", B=" + остр[B[0].id]});
    const до = Math.hypot(цB.x - цA.x, цB.y - цA.y);
    for (let i = 0; i < 400; i++) { graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    const пA = цм(A), пB = цм(B);
    const после = Math.hypot(пB.x - пA.x, пB.y - пA.y);
    // до правки те же 400 кадров съедали около четверти расстояния между деревьями
    t.push({имя:"несвязанные деревья не съезжаются к общему центру", ок: после >= до*0.98,
            факт:"между деревьями было " + Math.round(до) + " px, стало " + Math.round(после)});
    /* ...но и НЕ РАЗЛЕТАЮТСЯ. Отталкивание — единственная сила без предела дальности: стоило
       убрать общую стяжку, как разведённые деревья поехали друг от друга без остановки. За
       порогом соседства сила чужого острова гаснет в ноль, поэтому здесь ждём почти ровный ноль. */
    t.push({имя:"и не разлетаются бесконечно", ок: после <= до*1.02,
            факт:"расстояние выросло на " + Math.round(после - до) + " px за 400 кадров"});
    /* ТО ЖЕ НА ОБЫЧНОМ, А НЕ ТЕПЛИЧНОМ РАССТОЯНИИ. Три тысячи пикселей — это «через полграфа», там
       молчит вообще всё. Настоящая жалоба была про деревья, которые стоят рядом и всё равно
       ползут врозь (КРОЛИК: «на норм расстоянии и медленно пытаются отдаляться»): порог тогда
       брался круглым числом 450 px, а между ближайшими нодами было около 320 — то есть внутри
       порога. Ставим деревья так же и требуем НОЛЬ прироста. */
    B.forEach(it => { const у = graph.byId[it.id]; if (у) { у.x -= 2300; у.vx = 0; у.vy = 0; } });
    for (let i = 0; i < 600; i++) { graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    const рядомДо = Math.hypot(цм(B).x - цм(A).x, цм(B).y - цм(A).y);
    for (let i = 0; i < 600; i++) { graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    const рядомПосле = Math.hypot(цм(B).x - цм(A).x, цм(B).y - цм(A).y);
    // между ближайшими нодами тут сотни пикселей — деревья друг друга чувствовать не должны вовсе
    t.push({имя:"рядом стоящие деревья не ползут врозь",
            ок: рядомПосле - рядомДо < 2,
            факт:"на " + Math.round(рядомДо) + " px прирост за 600 кадров " +
                 (рядомПосле - рядомДо).toFixed(1) + " px"});
    /* А поставленные ВПЛОТНУЮ обязаны разъехаться и остановиться: рядом сила работает (деревья
       не налезают друг на друга), но разъезд должен кончиться, а не стать вечным. */
    // ставим центры в 150 px друг от друга — деревья заведомо налезают
    {
      const сдвиг = цм(B).x - цм(A).x - 150;
      B.forEach(it => { const у = graph.byId[it.id]; if (у) { у.x -= сдвиг; у.vx = 0; у.vy = 0; } });
    }
    const рядомБыло = Math.hypot(цм(B).x - цм(A).x, цм(B).y - цм(A).y);
    // даём разъезду закончиться: расходятся они до порога соседства и там встают
    for (let i = 0; i < 2500; i++) { graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    const развели = Math.hypot(цм(B).x - цм(A).x, цм(B).y - цм(A).y);
    for (let i = 0; i < 500; i++) { graph.alpha = Math.max(graph.alpha, 0.4); graph._tick(true); }
    const ещё = Math.hypot(цм(B).x - цм(A).x, цм(B).y - цм(A).y) - развели;
    t.push({имя:"поставленные вплотную деревья расталкиваются и останавливаются",
            ок: развели > рядомБыло + 20 && развели < 1400 && ещё < 15,
            факт:"было " + Math.round(рядомБыло) + " → " + Math.round(развели) +
                 " px, дальше за 500 кадров + " + Math.round(ещё) + " px"});
  } else {
    t.push({имя:"несвязанные деревья не съезжаются к общему центру", ок:false,
            факт:"сцена не собралась: A=" + (цA?цA.n:0) + ", B=" + (цB?цB.n:0)});
  }
  [...A, ...B].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ЗАХВАТ НОДЫ НЕ ПЕРЕРИСОВЫВАЕТ ПРАВУЮ ПАНЕЛЬ. Две жалобы КРОЛИКА с одной причиной: «ноду
   хватаю, микрофризы ощущаются» и «иногда мышка слетает, когда тяну ноду». asideSelect стоял
   прямо в pointerdown, то есть панель собиралась синхронно в самом начале жеста — а если она
   была закрыта, то ещё и ОТКРЫВАЛАСЬ, сужая холст с 1178 до 711 px. Точка под курсором
   уезжала на 233 px, и нода выпрыгивала из-под руки (замер). При открытой панели ширина не
   менялась — отсюда «иногда».
   Проверяем причину, а не следствие: считаем вызовы renderAside по фазам жеста. Порог по
   миллисекундам был бы машинозависимым, а счётчик вызовов — нет. */
{
  S.settings.graphRender = "canvas";
  view = "notes"; notesMode = "graph"; render(); await ж(250);
  const g = graph, svg = g.svg;
  S.settings.asideOn = false; asideSelect(null); renderAside(); g._onResize(); await ж(120);
  const узел = g.nodes.find(n => n.ref);
  g.zoom = 1; g.tx = g.W / 2 - узел.x; g.ty = g.H / 2 - узел.y; g._tick(true);
  const rc = () => svg.getBoundingClientRect();
  // экранную точку ноды считаем ТАК ЖЕ, как её рисует граф
  const экр = () => ({x: rc().left + (узел.x * g.zoom + g.tx) / g.W * rc().width,
                      y: rc().top + (узел.y * g.zoom + g.ty) / g.H * rc().height});
  const p = экр();
  const родной = renderAside;
  let наЗахвате = 0, наОтпускании = 0, фаза = "захват";
  renderAside = function (...а) { if (фаза === "захват") наЗахвате++; else наОтпускании++; return родной.apply(this, а); };
  try {
    svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true}));
    const скачок = Math.hypot(экр().x - p.x, экр().y - p.y);
    let слёт = 0;
    for (let i = 1; i <= 30; i++) { const e = {clientX: p.x + i * 6, clientY: p.y + i * 2};
      svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, ...e, bubbles: true, cancelable: true}));
      g._tick(true);
      слёт = Math.max(слёт, Math.hypot(экр().x - e.clientX, экр().y - e.clientY)); }
    фаза = "отпускание";
    svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: p.x + 180, clientY: p.y + 60, bubbles: true, cancelable: true}));
    const встык = наОтпускании;          // сразу после отпускания панель ещё не должна собираться
    await ж(220);                        // ...а через паузу — обязана (см. _syncAsideПотом)
    t.push({имя: "жест не собирает правую панель", ок: наЗахвате === 0 && встык === 0 && наОтпускании > 0,
            факт: "renderAside: на нажатии " + наЗахвате + ", встык к отпусканию " + встык +
                  ", через паузу " + наОтпускании});
    t.push({имя: "нода не выпрыгивает из-под курсора при захвате", ок: скачок < 3,
            факт: "скачок " + скачок.toFixed(1) + " px (панель открывалась: холст стал " + Math.round(rc().width) + " px)"});
    t.push({имя: "нода держится под курсором всю протяжку", ок: слёт < 3,
            факт: "макс расхождение " + слёт.toFixed(1) + " px"});
    t.push({имя: "после отпускания панель показывает эту ноду", ок: asideId === узел.ref.id,
            факт: "в панели " + (asideId === узел.ref.id ? "она" : String(asideId))});
    /* СЕРИЯ ЖЕСТОВ ПО ОДНОЙ НОДЕ — ровно то, на чём КРОЛИК ловил фриз: «тащу, отпускаю, сразу
       снова хватаю». Панель уже показывает эту ноду, значит пересобирать её нечего ни разу. */
    наОтпускании = 0;
    for (let к = 0; к < 4; к++) {
      // позицию берём ЗАНОВО: между жестами ноду уводит физика, и клик по старым координатам
      // попал бы в пустоту — то есть в рамку выделения, а она панель как раз сбрасывает
      const т = экр();
      svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: т.x, clientY: т.y, bubbles: true, cancelable: true}));
      svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: т.x + 60, clientY: т.y + 30, bubbles: true, cancelable: true}));
      svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: т.x + 60, clientY: т.y + 30, bubbles: true, cancelable: true}));
      await ж(40);
    }
    await ж(220);
    t.push({имя: "повторные жесты по той же ноде панель не пересобирают", ок: наОтпускании === 0,
            факт: "четыре жеста подряд — renderAside " + наОтпускании + " раз"});
    /* ЗАПИСЬ НА ДИСК НЕ ДОЛЖНА ПАДАТЬ В ПРОМЕЖУТОК МЕЖДУ ЖЕСТАМИ. Одна запись гонит через мост
       весь граф целиком, и на прежних 250 мс она приходилась ровно на момент, когда рука уже
       хватает ноду снова. Здесь, в деве, запись идёт в localStorage и стоит копейки — поэтому
       проверяем не цену, а МОМЕНТ: сразу после жеста записи быть не должно, после паузы — должна. */
    {
      const былWriteNow = window.writeNow;
      let записей = 0;
      window.writeNow = function (...а) { записей++; return былWriteNow.apply(this, а); };
      try {
        const т = экр();
        svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: т.x, clientY: т.y, bubbles: true, cancelable: true}));
        svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: т.x + 70, clientY: т.y + 20, bubbles: true, cancelable: true}));
        svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: т.x + 70, clientY: т.y + 20, bubbles: true, cancelable: true}));
        await ж(400);
        const сразу = записей;
        /* Дожидаться полутора секунд не станем — сценарий и так у потолка в 60 с. Зовём flushSave:
           он и есть тот путь, которым запись уходит при закрытии окна, то есть проверка заодно
           отвечает на главный вопрос отложенной записи — не теряются ли данные. */
        await flushSave();
        t.push({имя: "перетаскивание не пишет на диск встык к жесту", ок: сразу === 0 && записей > 0,
                факт: "записей за 400 мс после жеста " + сразу + ", после flushSave " + записей});
      } finally { window.writeNow = былWriteNow; }
    }
  } finally {
    renderAside = родной;
    /* Прибираем ЗА СОБОЙ: сборка панели теперь отложенная, и оставленный таймер сработал бы уже
       посреди следующего сценария, подменив ему выделение (на этом «панель» и падала). */
    clearTimeout(g._asideT); g._asideT = null;
    g.selNodes.clear(); g._paintSel(); asideSelect(null);
  }
}

/* ПАУЗА ГЛУШИТ САМОХОДНЫЙ ЦИКЛ, НО НЕ ЖЕСТ. Окно потеряло фокус — граф встаёт на паузу, чтобы
   не жечь процессор в фоне. Но `_schedule` при этом не планировал НИЧЕГО, поэтому колесо над
   неактивным окном меняло камеру втихую: КРОЛИК крутил зум, ничего не менялось, и картинка
   догоняла только после клика по окну. Проверяем обе половины сразу — иначе починка одной
   тихо ломает другую: жест на паузе обязан дать кадр, но НЕ обязан завести вечный цикл. */
{
  const g = graph, svg = g.svg, rc = svg.getBoundingClientRect();
  let кадров = 0;
  const род = g._tick.bind(g);
  g._tick = function (f) { кадров++; return род(f); };
  try {
    g.pause();
    await ж(150);
    const вПокое = кадров;                       // на паузе без жестов кадров быть не должно
    const зумБыл = g.zoom;
    svg.dispatchEvent(new WheelEvent("wheel", {clientX: rc.left + rc.width / 2, clientY: rc.top + rc.height / 2,
                                               deltaY: -120, bubbles: true, cancelable: true}));
    await ж(150);
    const послеЖеста = кадров;
    await ж(250);                                // и убеждаемся, что цикл не завёлся сам
    const потом = кадров;
    t.push({имя: "на паузе жест рисует кадр", ок: послеЖеста > вПокое && g.zoom !== зумБыл,
            факт: "кадров после колеса " + (послеЖеста - вПокое) + ", зум " + зумБыл.toFixed(2) + " → " + g.zoom.toFixed(2)});
    t.push({имя: "но вечный цикл на паузе не заводится", ок: потом - послеЖеста <= 1,
            факт: "за 250 мс после жеста ещё " + (потом - послеЖеста) + " кадр(ов)"});
    // один кадр допустим: он мог быть запланирован ДО паузы и уже стоять в очереди rAF.
    // Ловим мы цикл, а не единичный хвост — при живом цикле за 150 мс их были бы десятки.
    t.push({имя: "и без жестов пауза молчит", ок: вПокое <= 1,
            факт: "кадров за 150 мс паузы: " + вПокое});
  } finally { g._tick = род; g.resume(); }
}

hardDeleteItem(мысль.id); render();
return t;
