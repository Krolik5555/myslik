/* РЕЖИМЫ СВЯЗЕЙ (LINK_MODES, _routeBuild/_routeTrace в graph.js). Главное правило: путь связи —
   ОДИН, и его читают отрисовка, провал, свечение и клик. Проверяем то, что разъехалось бы первым:
   путь проходит через центры обоих концов; клик в колено (далеко от хорды) попадает в связь;
   прямые углы и шина — только горизонтали и вертикали, метро — ещё и диагонали 45° (короткие
   кусочки скруглений колен не в счёт); мягкий режим маршрута не заводит вовсе; свой режим
   связи (4-й элемент S.links) перекрывает режим графа и переживает санитайзер. И замер: сборка
   маршрутов и кадр на дереве в 500+ нод, по каждому режиму. */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const был = {mode: S.settings.graphLinkMode, rend: S.settings.graphRender, home: S.settings.graphHome};
S.settings.graphRender = "canvas"; S.settings.graphHome = false;

const обл = S.areas[0] && S.areas[0].id;
if (!обл) { t.push({имя: "есть область для проверки", ок: false, факт: "в демо нет ни одной области"}); return t; }
// дерево вдали от демо-нод: родитель и четыре ребёнка справа на разной высоте, плюс ручная поперёк
const X0 = 6000, Y0 = 6000, мои = [];
const нода = (title, x, y) => { const it = addItem({kind: "note", title, area: обл}); it.x = x; it.y = y; мои.push(it.id); return it; };
const P = нода("связи-родитель", X0, Y0);
const дети = [[220, -160], [260, -40], [240, 70], [210, 190]].map(([dx, dy], i) => нода("связи-ребёнок-" + i, X0 + dx, Y0 + dy));
const Q = нода("связи-чужая", X0 - 40, Y0 + 260);
дети.forEach(c => addLink(P.id, c.id));
addLink(Q.id, дети[3].id);      // ребёнок с двумя связями: вторая — ручная не дерева
recomputeHierarchy(); persist();
view = "notes"; notesMode = "graph"; render(); await ж(300);
if (!graph) { t.push({имя: "граф создан", ок: false, факт: "графа нет"}); return t; }
graph.alpha = 0;

const связь = (a, b) => graph.links.find(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
// итоговая форма маршрута — без плавного перехода (_routeMorph): посреди перехода точки смешаны и идут наискось
const точки = l => { const o = [], ц = l._рт ? {a: l.a, b: l.b, _рт: Object.assign({}, l._рт, {мф: null})} : l;
  graph._routeTrace({moveTo: (x, y) => o.push([x, y]), lineTo: (x, y) => o.push([x, y])}, ц, false, 1, 0, 0); return o; };
const центр = n => [n.x + (n._ix || 0), n.y + (n._iy || 0)];
const экр = (wx, wy) => { const rc = graph.svg.getBoundingClientRect();
  return {clientX: rc.left + (wx * graph.zoom + graph.tx) / graph.W * rc.width, clientY: rc.top + (wy * graph.zoom + graph.ty) / graph.H * rc.height}; };
const моиСвязи = () => [...дети.map(c => связь(P.id, c.id)), связь(Q.id, дети[3].id)].filter(Boolean);

for (const m of LINK_MODES.map(x => x.id)) {
  graphSetLinkMode(m); graph._маршр = null; graph._routesFresh();
  const L = моиСвязи();
  if (m === "soft") {
    t.push({имя: "мягкая: маршрута нет, связь рисуется прежней геометрией", ок: L.length === 5 && L.every(l => !l._рт),
            факт: "связей " + L.length + ", с маршрутом " + L.filter(l => l._рт).length});
    continue;
  }
  t.push({имя: m + ": маршрут у всех связей", ок: L.length === 5 && L.every(l => l._рт), факт: "с маршрутом " + L.filter(l => l._рт).length + " из " + L.length});
  let концы = 0, кривых = [], всего = 0; const мимо = [];
  for (const l of L) { if (!l._рт) continue;
    const p = точки(l), a = центр(graph.byId[l.a]), b = центр(graph.byId[l.b]);
    const д0 = Math.hypot(p[0][0] - a[0], p[0][1] - a[1]), д1 = Math.hypot(p[p.length - 1][0] - b[0], p[p.length - 1][1] - b[1]);
    if (д0 < 0.5 && д1 < 0.5) концы++;
    else { const у = l._рт.умолч, в = у && graph._routeMem().варианты.get(l.a + "|" + l.b + "|" + у.m); мимо.push((graph.byId[l.b].label || "").slice(-2) + " " + д0.toFixed(1) + "/" + д1.toFixed(1) + " вар " + JSON.stringify(в || null)); }
    for (let k = 0; k < p.length - 1; k++) {
      const dx = Math.abs(p[k + 1][0] - p[k][0]), dy = Math.abs(p[k + 1][1] - p[k][1]);
      if (Math.hypot(dx, dy) <= 8) continue;     // кусочек скругления колена (радиус до 14, четыре куска)
      всего++;
      const осевой = dx < 0.01 || dy < 0.01, диаг = Math.abs(dx - dy) < 0.05 * Math.max(dx, dy);
      const годен = m === "metro" ? (осевой || диаг) : m === "bundle" ? true : осевой;
      if (!годен) кривых.push(dx.toFixed(1) + "×" + dy.toFixed(1));
    } }
  t.push({имя: m + ": путь проходит через центры обоих концов", ок: концы === L.length, факт: концы + " из " + L.length + (мимо.length ? "; мимо: " + мимо.join("; ") : "")});
  if (m !== "bundle")
    t.push({имя: m + (m === "metro" ? ": только горизонтали, вертикали и 45°" : ": только горизонтали и вертикали"),
            ок: кривых.length === 0 && всего > 0, факт: "длинных отрезков " + всего + ", не по правилу: " + (кривых.join(", ") || "нет")});
  // клик в колено: середина самого длинного отрезка, который дальше всего от хорды
  const l = связь(P.id, дети[0].id), p = точки(l), a = центр(graph.byId[l.a]), b = центр(graph.byId[l.b]);
  const отХорды = (x, y) => { const ex = b[0] - a[0], ey = b[1] - a[1]; return Math.abs((x - a[0]) * ey - (y - a[1]) * ex) / (Math.hypot(ex, ey) || 1); };
  let цель = null;
  for (let k = 0; k < p.length - 1; k++) { const mx = (p[k][0] + p[k + 1][0]) / 2, my = (p[k][1] + p[k + 1][1]) / 2, d = отХорды(mx, my);
    if (!цель || d > цель.d) цель = {x: mx, y: my, d}; }
  graph.zoom = 1; graph.tx = graph.W / 2 - цель.x; graph.ty = graph.H / 2 - цель.y;
  const i = graph._hitLink(экр(цель.x, цель.y));
  t.push({имя: m + ": клик в колено попадает в связь", ок: graph.links[i] === l,
          факт: "точка в " + цель.d.toFixed(0) + " px от хорды, попали в " + (i >= 0 ? graph.links[i].a + "–" + graph.links[i].b : "пустоту")});
  // провал по маршруту считается без ошибок
  let ошибка = "";
  try { graph._crossBuild(); } catch (e) { ошибка = String(e); }
  t.push({имя: m + ": провал на пересечениях считается по маршрутам", ок: !ошибка, факт: ошибка || "без ошибок"});
}

// ================== ПРЯМЫЕ УГЛЫ В ДВИЖЕНИИ (снимки КРОЛИКА 32–34, 04.11.2026) ==================
graphSetLinkMode("ortho");
{
  const l0 = связь(P.id, дети[0].id), ключ = l0.a + "|" + l0.b, ребёнок = graph.byId[дети[0].id], родитель = graph.byId[P.id];
  const поставить = (dx, dy) => { ребёнок.x = родитель.x + dx; ребёнок.y = родитель.y + dy; graph._маршр.at = -1e9; graph.alpha = 0.01; graph._routesFresh(); graph.alpha = 0; };
  // гистерезис: у диагонали ось не перескакивает от пикселя туда-сюда, а от явного перевеса — да
  поставить(300, -290); const ось0 = graph._routeMem().оси.get(ключ);
  const оси = [];
  for (const [dx, dy] of [[290, -300], [300, -290], [289, -300], [301, -288]]) { поставить(dx, dy); оси.push(graph._routeMem().оси.get(ключ)); }
  t.push({имя: "прямые углы: у диагонали колено не перескакивает", ок: ось0 === true && оси.every(h => h === ось0),
          факт: "ось по шагам: " + [ось0].concat(оси).map(h => h ? "гор" : "вер").join(", ")});
  поставить(150, -300);
  t.push({имя: "прямые углы: явный перевес другой оси колено переставляет", ок: graph._routeMem().оси.get(ключ) === false,
          факт: "dx 150, dy −300 → " + (graph._routeMem().оси.get(ключ) ? "гор" : "вер")});
  // скачок формы — плавным переходом, и он доезжает
  const l1 = связь(P.id, дети[0].id);
  t.push({имя: "прямые углы: смена колена идёт плавным переходом", ок: !!(l1._рт && l1._рт.мф), факт: l1._рт && l1._рт.мф ? "переход заведён" : "форма сменилась скачком"});
  // переход снимает сам обход маршрута — тот, что рисует кадр, а не «итоговая форма» из точки()
  await ж(240); graph._routeTrace({moveTo: () => {}, lineTo: () => {}}, l1, false, 1, 0, 0);
  t.push({имя: "прямые углы: переход доезжает и снимается", ок: !!l1._рт && !l1._рт.мф, факт: l1._рт && l1._рт.мф ? "переход висит" : "снят"});
  поставить(220, -160);
  // протяжка рукой: маршрут обязан быть свежим в ТОМ ЖЕ кадре, где сдвинулась нода
  graph.zoom = 1; graph.tx = graph.W / 2 - ребёнок.x; graph.ty = graph.H / 2 - ребёнок.y;
  const p0 = экр(ребёнок.x, ребёнок.y), svg = graph.svg;
  svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p0.clientX, clientY: p0.clientY, bubbles: true, cancelable: true}));
  let кадров = 0, свежих = 0, сМаршрутом = 0, прямых = [];
  for (let k = 1; k <= 8; k++) {
    const до = performance.now(), q = экр(ребёнок.x + 6 * k, ребёнок.y - 22 * k);
    svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: q.clientX, clientY: q.clientY, bubbles: true, cancelable: true}));
    graph._tick(true); кадров++;
    const l = связь(P.id, дети[0].id);
    if (graph._маршр && graph._маршр.at >= до) свежих++;
    if (l && l._рт) { сМаршрутом++;
      // цель маршрута (без перехода) — только горизонтали и вертикали, концы на центрах
      const цель = []; graph._routeTrace({moveTo: (x, y) => цель.push([x, y]), lineTo: (x, y) => цель.push([x, y])}, {a: l.a, b: l.b, _рт: Object.assign({}, l._рт, {мф: null})}, false, 1, 0, 0);
      for (let i = 0; i < цель.length - 1; i++) { const dx = Math.abs(цель[i + 1][0] - цель[i][0]), dy = Math.abs(цель[i + 1][1] - цель[i][1]);
        if (Math.hypot(dx, dy) > 8 && dx > 0.01 && dy > 0.01) прямых.push(k + ": " + dx.toFixed(0) + "×" + dy.toFixed(0)); } }
  }
  const qe = экр(ребёнок.x, ребёнок.y);
  svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: qe.clientX, clientY: qe.clientY, bubbles: true, cancelable: true}));
  t.push({имя: "протяжка: маршрут пересчитан в каждом кадре", ок: свежих === кадров, факт: "свежих " + свежих + " из " + кадров + " кадров"});
  t.push({имя: "протяжка: связь всё время под прямыми углами, без диагоналей", ок: сМаршрутом === кадров && прямых.length === 0,
          факт: "с маршрутом " + сМаршрутом + " из " + кадров + (прямых.length ? ", диагонали: " + прямых.join("; ") : "")});
  /* после броска ветку доводит ФИЗИКА, без руки: «обновляется раз в секунду» (КРОЛИК, 04.11.2026)
     было ровно отсюда — таймер 900 мс. Мерим: маршрут свежий в каждом кадре, колено едет с нодой */
  { graph.alpha = 0.4; let фкадров = 0, фсвежих = 0, сдвигов = 0, пред = null;
    for (let k = 0; k < 8; k++) {
      ребёнок.x += 7; ребёнок.y -= 5;                     // нода едет сама, как от сил
      const до = performance.now(); graph._tick(true); фкадров++;
      if (graph._маршр && graph._маршр.at >= до) фсвежих++;
      const l = связь(P.id, дети[0].id), п = l && l._рт ? точки(l) : null;
      const колено = п ? п.slice(1, -1).map(q => q[0].toFixed(1) + "," + q[1].toFixed(1)).join("|") : "";
      if (пред !== null && колено !== пред) сдвигов++; пред = колено; }
    graph.alpha = 0;
    t.push({имя: "физика без руки: маршрут пересчитан в каждом кадре", ок: фсвежих === фкадров, факт: "свежих " + фсвежих + " из " + фкадров});
    t.push({имя: "физика без руки: колено едет за нодой каждый кадр", ок: сдвигов === фкадров - 1, факт: "сдвигов " + сдвигов + " из " + (фкадров - 1)}); }
  t.push({имя: "маршруты собираются без ошибок", ок: !graph._маршрОш, факт: graph._маршрОш ? "сборка падала — см. консоль" : "без ошибок"});
}

// ================== МЕНЬШЕ ПЕРЕСЕЧЕНИЙ (снимки КРОЛИКА 37–38, 04.11.2026) ==================
/* Дерево SQ/SH со снимка: у SQ02 колено к SH030 (сначала вверх) резало колено к SH040 (сначала
   вправо). Подбор (_routeOptimize) обязан это развести. Считаем пересечения своих связей по вершинам
   колен до подбора и после, на прямых углах и на шине. */
{
  const X1 = -9000, Y1 = 6000, sq = [];
  const н = (title, x, y) => { const it = addItem({kind: "note", title, area: обл}); it.x = X1 + x; it.y = Y1 + y; мои.push(it.id); sq.push(it); return it; };
  const SQ = н("связи-SQ02", 0, 0);
  const места = {SH040: [230, -114], SH030: [172, -230], SH050: [230, 0], SH060: [172, 115], SH070: [57, 115], SH080: [-57, 115], SH020: [57, -210], SH010: [-57, -172]};
  const SH = {}; for (const k in места) { SH[k] = н("связи-" + k, места[k][0], места[k][1]); addLink(SQ.id, SH[k].id); }
  const S35 = н("связи-SH035", 172 - 57, -230 - 110), S36 = н("связи-SH036", 172 + 115, -230 - 110);
  addLink(SH.SH030.id, S35.id); addLink(SH.SH030.id, S36.id);
  recomputeHierarchy(); persist(); graph.build(); graph.alpha = 0;
  const ids = new Set(sq.map(x => x.id));
  const своиСв = () => graph.links.filter(l => l.manual && ids.has(l.a) && ids.has(l.b));
  const перес = () => { const L = своиСв(); let n = 0; const пары = [];
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const A = L[i], B = L[j]; if (!A._рт || !B._рт) continue;
      const ca = A._рт.c, cb = B._рт.c;
      for (let p = 0; p < ca.length - 2; p += 2) for (let q = 0; q < cb.length - 2; q += 2) {
        const x0 = ca[p], y0 = ca[p + 1], ex = ca[p + 2] - x0, ey = ca[p + 3] - y0, u0 = cb[q], v0 = cb[q + 1], fx = cb[q + 2] - u0, fy = cb[q + 3] - v0;
        const d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
        const s = ((u0 - x0) * fy - (v0 - y0) * fx) / d, t = ((u0 - x0) * ey - (v0 - y0) * ex) / d;
        if (s <= 0 || s >= 1 || t <= 0 || t >= 1) continue;
        const px = x0 + ex * s, py = y0 + ey * s;
        if ([A.a, A.b, B.a, B.b].some(id => { const m = graph.byId[id]; return Math.hypot(m.x - px, m.y - py) < (m.r || 8) + 6; })) continue;
        n++; пары.push(graph.byId[A.b].ref.title.slice(6) + "×" + graph.byId[B.b].ref.title.slice(6)); } }
    return {n, пары}; };
  const режет4030 = () => перес().пары.some(p => /SH040/.test(p) && /SH030/.test(p));
  for (const m of ["ortho", "bus"]) {
    graphSetLinkMode(m);
    const родной = graph._routeOptimize; graph._routeOptimize = () => 0;   // «до»: подбор выключен
    graph._routeMem(true); graph._маршр = null; graph._routesFresh();
    const до = перес(), былоРежет = режет4030();
    graph._routeOptimize = родной;
    graph._маршр = null; graph._routesFresh();                             // «после»: та же сборка с подбором
    const после = перес(), цена = graph._оптЦена || 0, ст = graph._оптСтат || {};
    const sq0 = graph.byId[SQ.id], отн = id => { const n = graph.byId[id]; return Math.round(n.x - sq0.x) + "," + Math.round(n.y - sq0.y); };
    t.push({имя: m + ": замер подбора (справка)", ок: true,
            факт: "связей " + ст.связей + ", до подбора: пересечений " + ст.пер + ", наездов " + ст.нав + ", слипаний " + ст.нал + "; единиц в очереди " + ст.единиц + ", проходов " + ст.проходов + ", оценок " + ст.оценок + ", смен " + ст.смен +
                  "; SH040 " + отн(SH.SH040.id) + ", SH030 " + отн(SH.SH030.id) + ", SH050 " + отн(SH.SH050.id) + ", SH060 " + отн(SH.SH060.id)});
    t.push({имя: m + ": подбор колен снижает пересечения на дереве SQ/SH", ок: после.n < до.n || (до.n === 0 && после.n === 0),
            факт: "до " + до.n + " (" + (до.пары.join(", ") || "—") + "), после " + после.n + " (" + (после.пары.join(", ") || "—") + "), подбор " + цена.toFixed(1) + " мс"});
    if (m === "ortho") t.push({имя: "ortho: колено к SH030 больше не режет связь к SH040", ок: !режет4030(),
            факт: (былоРежет ? "до подбора резало" : "до подбора не резало") + ", после — " + (режет4030() ? "режет" : "не режет")});
    /* Подбор обязан СХОДИТЬСЯ: каждая смена строго убавляет пересечения своей связи, поэтому повторные
       заходы (раз в 400 мс) доделывают начатое и затихают, а свои пересечения при этом не растут.
       Бюджет 15 мс на заход может не дать доделать за один раз — меряем, за сколько заходов тишина. */
    const смены = []; let тихо = false, хуже = false, пр = перес().n;
    for (let k = 0; k < 6 && !тихо; k++) { graph._маршр.at = -1e9; const n = graph._routeOptimize(); смены.push(n);
      if (n) graph._routeBuild(); else тихо = true; const сейч = перес().n; if (сейч > пр) хуже = true; пр = сейч; }
    t.push({имя: m + ": повторный подбор затихает, пересечения не растут", ок: тихо && !хуже,
            факт: "смен по заходам: " + смены.join(", ") + (хуже ? " — пересечения выросли" : "")});
  }
  // во время протяжки подбор не зовётся: рука получает быструю форму
  { const до = graph._оптимАт; graph.drag = {_moved: true}; graph._маршр.at = -1e9; graph._routesFresh(); graph.drag = null;
    t.push({имя: "подбор колен не идёт во время протяжки", ок: graph._оптимАт === до, факт: graph._оптимАт === до ? "не звался" : "звался"}); }
}

// ================== НИТЬ К ОБЛАСТИ (снимок КРОЛИКА 36, 04.11.2026) ==================
/* В S.links её нет — граф строит её из it.area, поэтому свой режим живёт в НОДЕ (it.areamode),
   как и длина (it.arealen). Проверяем: общий режим графа до неё доходит, свой у ноды сильнее
   общего, санитайзер срезает мусор и не трогает законное значение. */
{
  const нить = () => graph.links.find(l => !l.manual && (l.a === P.id || l.b === P.id));
  graphSetLinkMode("ortho"); graph.build(); graph._маршр = null; graph._routesFresh();
  const н0 = нить();
  t.push({имя: "нить к области: общий режим графа на неё действует", ок: !!(н0 && н0._рт),
          факт: н0 ? (н0._рт ? "маршрут есть (" + н0.a + " → " + н0.b + ")" : "маршрута нет") : "нити к области у ноды нет"});
  graphSetLinkMode("soft"); P.areamode = "metro"; graph.build(); graph._маршр = null; graph._routesFresh();
  const н1 = нить(), чужих = моиСвязи().filter(l => l._рт).length;
  t.push({имя: "нить к области: режим ноды сильнее режима графа", ок: !!(н1 && н1._рт && н1._рт.metro) && чужих === 0,
          факт: "нить " + (н1 && н1._рт ? (н1._рт.metro ? "метро" : "другой маршрут") : "без маршрута") + ", прочих с маршрутом " + чужих});
  const снимок = s => JSON.parse(JSON.stringify({graphs: s.graphs, settings: s.settings, boards: {}, media: {}, tags: s.tags, templates: s.templates}));
  const найти = s => { for (const g of s.graphs || []) { const x = (g.items || []).find(i => i.id === P.id); if (x) return x; } return null; };
  P.areamode = "мусор"; const чист1 = найти(sanitizeState(снимок(S)));
  P.areamode = "soft";  const чист2 = найти(sanitizeState(снимок(S)));
  t.push({имя: "нить к области: санитайзер срезает мусор и держит законный режим",
          ок: !!чист1 && !("areamode" in чист1) && !!чист2 && чист2.areamode === "soft",
          факт: "мусор → " + (чист1 ? JSON.stringify(чист1.areamode) : "нода не найдена") + ", soft → " + (чист2 ? JSON.stringify(чист2.areamode) : "нода не найдена")});
  delete P.areamode; graph.build();
}

// свой режим связи перекрывает режим графа и не теряется в санитайзере
graphSetLinkMode("soft");
const свой = S.links.find(x => (x[0] === Q.id && x[1] === дети[3].id) || (x[1] === Q.id && x[0] === дети[3].id));
if (свой) { свой[2] = +свой[2] || 1; свой[3] = "ortho"; }
graph.build(); graph._маршр = null; graph._routesFresh();
{ const L = моиСвязи(), ручн = связь(Q.id, дети[3].id);
  t.push({имя: "свой режим связи сильнее режима графа", ок: !!(ручн && ручн._рт) && L.filter(l => l._рт).length === 1,
          факт: "с маршрутом " + L.filter(l => l._рт).length + " (ждали одну — ручную)"}); }
{ const s = JSON.parse(JSON.stringify({graphs: S.graphs}));
  const g = s.graphs.find(x => (x.links || []).some(l => l[3] === "ortho"));
  const копия = g && g.links.find(l => l[3] === "ortho");
  t.push({имя: "режим связи лежит 4-м элементом в данных", ок: !!копия && копия.length === 4, факт: копия ? JSON.stringify(копия.slice(2)) : "не нашли"}); }
if (свой) свой.length = 3;

// ================== ЗАМЕР: дерево 520 нод ==================
{
  const ids = [], N0 = 520; txBegin();
  const корень = addItem({kind: "note", title: "связи-замер", area: обл}); корень.x = -6000; корень.y = 0; ids.push(корень.id);
  /* дерево похоже на настоящее: по четыре ребёнка вокруг родителя, конусом наружу, как кусты после
     «Упорядочить». Первый замер шёл на спирали, где дети лежали за полграфа от родителей, — там
     пересечений на порядок больше, чем бывает, и провал мерил не то */
  const уровень = [корень], угол = [0], глуб = [0];
  for (let i = 1; i < N0; i++) {
    const pi = Math.floor((i - 1) / 4), k = (i - 1) % 4, род = уровень[pi];
    const ug = pi === 0 ? k * Math.PI / 2 : угол[pi] + (k - 1.5) * 0.5, r = глуб[pi] === 0 ? 260 : 150 / Math.sqrt(глуб[pi]);
    const it = addItem({kind: "note", title: "связи-замер", area: обл}); it.x = род.x + Math.cos(ug) * r; it.y = род.y + Math.sin(ug) * r;
    ids.push(it.id); уровень.push(it); угол.push(ug); глуб.push(глуб[pi] + 1); addLink(род.id, it.id);
  }
  txEnd(); recomputeHierarchy(); graph.build(); graph.alpha = 0;
  graph.zoom = 0.35; graph.tx = graph.W / 2 + 6000 * 0.35; graph.ty = graph.H / 2;
  const ряд = [];
  // мягкая — ещё раз в конце: первый прогон платит за разогрев JIT, и её провал выходил вчетверо дороже
  for (const m of LINK_MODES.map(x => x.id).concat("soft")) {
    graphSetLinkMode(m);
    /* первая сборка после смены режима заводит переход ВСЕМ связям — это худший случай; в движении
       сборка идёт каждый кадр с той же формой — её и меряем второй подряд */
    let t0 = performance.now(); graph._routeBuild(); const мрСмена = performance.now() - t0;
    t0 = performance.now(); graph._drawMain(); const кадрПерехода = performance.now() - t0;
    // медиана семи сборок: одиночный замер прыгал между 3 и 6 мс от сборки мусора
    const сб = []; for (let k = 0; k < 7; k++) { t0 = performance.now(); graph._routeBuild(); сб.push(performance.now() - t0); }
    сб.sort((a, b) => a - b); const мр = сб[3];
    t0 = performance.now(); graph._crossBuild(); const пр = performance.now() - t0;
    await ж(220);                                         // переход доехал
    graph._drawMain();
    t0 = performance.now(); for (let k = 0; k < 20; k++) graph._drawMain(); const кадр = (performance.now() - t0) / 20;
    ряд.push({m, мр, мрСмена, кадрПерехода, пр, кадр});
  }
  ряд.shift();
  const мяг = ряд[ряд.length - 1].кадр, мягП = ряд[ряд.length - 1].пр;
  for (const р of ряд) t.push({имя: "замер " + graph.nodes.length + " нод, " + р.m + ": маршруты, провал и кадр в пределах",
    ок: р.мр < 4 && р.кадр < мяг + 8 && р.пр < мягП * 2.5 + 20,
    факт: "сборка в движении " + р.мр.toFixed(1) + " мс (при смене режима " + р.мрСмена.toFixed(1) + ", кадр перехода " + р.кадрПерехода.toFixed(1) + "), провал " + р.пр.toFixed(1) + " мс, кадр " + р.кадр.toFixed(2) + " мс (мягкая " + мяг.toFixed(2) + ")"});
  deletePack(ids);
}

// ================== РЕЖИМ ВЕТКИ (it.branchmode) ==================
/* Старшинство: свой у связи → режим ветки ближайшего предка родительского конца (сама нода тоже) →
   режим графа. Дерево R → A → A1, A2 и R → B при мягком режиме графа. */
{
  const нв = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = 30000 + x; it.y = 30000 + y; мои.push(it.id); return it; };
  const R = нв("связи-вR", 0, 0, true), A = нв("связи-вA", 220, -120), B = нв("связи-вB", 220, 160), A1 = нв("связи-вA1", 420, -200), A2 = нв("связи-вA2", 420, -60);
  addLink(R.id, A.id); addLink(R.id, B.id); addLink(A.id, A1.id); addLink(A.id, A2.id); recomputeHierarchy(); persist();
  graphSetLinkMode("soft");
  const режим = (p, c) => { graph.build(); graph._маршр = null; graph._routesFresh();
    const l = graph.links.find(x => (x.a === p.id && x.b === c.id) || (x.b === p.id && x.a === c.id));
    return !l ? "нет" : !l._рт ? "soft" : l._рт.metro ? "metro" : l._рт.умолч ? l._рт.умолч.m : "?"; };
  const все = () => ["R→A " + режим(R, A), "R→B " + режим(R, B), "A→A1 " + режим(A, A1), "A→A2 " + режим(A, A2)].join(", ");
  A.branchmode = "ortho";
  t.push({имя: "ветка: режим ветки на ноде — её связям вниз, связь к самой ноде — нет", ок: режим(A, A1) === "ortho" && режим(A, A2) === "ortho" && режим(R, A) === "soft",
          факт: все()});
  R.branchmode = "metro";
  t.push({имя: "ветка: ближайший предок с режимом перекрывает дальнего", ок: режим(A, A1) === "ortho" && режим(R, B) === "metro" && режим(R, A) === "metro", факт: все()});
  const свой = S.links.find(x => (x[0] === A.id && x[1] === A1.id) || (x[1] === A.id && x[0] === A1.id)); свой[2] = +свой[2] || 1; свой[3] = "bus";
  t.push({имя: "ветка: свой режим связи сильнее режима ветки", ок: режим(A, A1) === "bus" && режим(A, A2) === "ortho", факт: все()});
  delete A.branchmode;
  t.push({имя: "ветка: сброс на ноде — её связи берут режим дальнего предка, свой у связи остаётся", ок: режим(A, A2) === "metro" && режим(A, A1) === "bus", факт: все()});
  свой.length = 3; delete R.branchmode;
  t.push({имя: "ветка: всё сброшено — как у графа", ок: [режим(R, A), режим(R, B), режим(A, A1), режим(A, A2)].every(x => x === "soft"), факт: все()});
  // на выделение и «между выделенными»
  graph.build(); graph.selNodes = new Set([A.id, A1.id, B.id]);
  graph._setBranchMode(graph.byId[A.id], "ortho", false);
  t.push({имя: "ветка: на выделение — режим каждой выделенной ноде", ок: A.branchmode === "ortho" && A1.branchmode === "ortho" && B.branchmode === "ortho" && !R.branchmode,
          факт: [A, A1, B, R].map(x => x.title.replace("связи-в", "") + ":" + (x.branchmode || "—")).join(", ")});
  for (const x of [A, A1, B]) delete x.branchmode;
  graph.build(); graph.selNodes = new Set([A.id, A1.id, A2.id]);
  graph._setBranchMode(graph.byId[A.id], "metro", true);
  const м1 = S.links.find(x => (x[0] === A.id && x[1] === A1.id) || (x[1] === A.id && x[0] === A1.id)), мR = S.links.find(x => (x[0] === R.id && x[1] === A.id) || (x[1] === R.id && x[0] === A.id));
  t.push({имя: "ветка: «между выделенными» — режим самих связей, ветку не трогает", ок: м1 && м1[3] === "metro" && !(мR && мR[3]) && !A.branchmode,
          факт: "A→A1 " + (м1 && м1[3]) + ", R→A " + (мR && мR[3] || "—") + ", у A ветка " + (A.branchmode || "—")});
  for (const x of S.links) if ([A.id, A1.id, A2.id].includes(x[0]) && [A.id, A1.id, A2.id].includes(x[1])) x.length = Math.min(x.length, 3);
  graph.selNodes = new Set();
  // санитайзер и копия
  A.branchmode = "мусор";
  { const s = JSON.parse(JSON.stringify({graphs: S.graphs, settings: S.settings, boards: {}, media: {}, tags: S.tags, templates: S.templates}));
    let x = null; for (const g of sanitizeState(s).graphs || []) { x = (g.items || []).find(i => i.id === A.id) || x; }
    t.push({имя: "ветка: санитайзер срезает мусор в режиме ветки", ок: !!x && !("branchmode" in x), факт: x ? JSON.stringify(x.branchmode) : "нода не найдена"}); }
  A.branchmode = "bus"; graph.build(); graph.selNodes = new Set([A.id]); graph.copySelection();
  const рез = graph.pasteClip(40, true), копия = рез && рез.newIds && S.items.find(i => i.id === рез.newIds[0]);
  if (рез && рез.newIds) мои.push(...рез.newIds);
  t.push({имя: "ветка: копия ноды уносит режим ветки", ок: !!копия && копия.branchmode === "bus", факт: копия ? (копия.branchmode || "—") : "копии нет"});
  delete A.branchmode; graph.selNodes = new Set(); graph.build();
}

// ================== ПРОТЯЖКА СВЯЗИ: ТОЧКА МАРШРУТА (вариант Б, 04.11.2026) ==================
/* Связь тянут мышью — она идёт через точку под курсором. Точка хранится смещением от середины концов
   (5-й элемент S.links, у нити к области — it.areaanchor), с привязкой садится на узел сетки и
   держится на нём, клик без сдвига открывает меню, двойной клик и кнопка меню сбрасывают. */
{
  const былСнап = {s: S.settings.graphSnap, m: S.settings.graphSnapMode, d: S.settings.graphDrift};
  // без дыхания: точка без сетки едет за серединой ВМЕСТЕ с дыханием концов, а ждём её по центрам нод
  S.settings.graphSnap = false; S.settings.graphDrift = 0;
  const тихо = () => graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
  тихо();
  const C1 = дети[1], хран = () => S.links.find(x => (x[0] === P.id && x[1] === C1.id) || (x[1] === P.id && x[0] === C1.id));
  const жив = () => связь(P.id, C1.id);
  const мид = () => { const a = graph.byId[P.id], b = graph.byId[C1.id]; return [(a.x + b.x) / 2, (a.y + b.y) / 2]; };
  // расстояние от точки до пути (до отрезков, не до вершин). ДОП — угол в точке скруглён (радиус 12 даёт ~4.2 px), связь идёт рядом, а не ровно через неё
  const ДОП = 5;
  const черезТочку = (l, x, y) => { const p = (тихо(), точки(l)); let м = Infinity;
    for (let k = 0; k < p.length - 1; k++) { const ex = p[k + 1][0] - p[k][0], ey = p[k + 1][1] - p[k][1], L2 = ex * ex + ey * ey || 1e-9; let u = ((x - p[k][0]) * ex + (y - p[k][1]) * ey) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u;
      м = Math.min(м, Math.hypot(x - p[k][0] - ex * u, y - p[k][1] - ey * u)); } return м; };
  const ровно = (l, метро) => { const p = точки(l), плохо = [];
    for (let k = 0; k < p.length - 1; k++) { const dx = Math.abs(p[k + 1][0] - p[k][0]), dy = Math.abs(p[k + 1][1] - p[k][1]);
      if (Math.hypot(dx, dy) <= 8) continue;
      if (!(dx < 0.01 || dy < 0.01 || (метро && Math.abs(dx - dy) < 0.05 * Math.max(dx, dy)))) плохо.push(dx.toFixed(1) + "×" + dy.toFixed(1)); }
    return плохо; };
  const svg = () => graph.svg;
  const соб = (тип, p, доп) => svg().dispatchEvent(new PointerEvent(тип, Object.assign({button: 0, buttons: тип === "pointermove" ? 1 : 0, clientX: p.clientX, clientY: p.clientY, bubbles: true, cancelable: true}, доп || {})));
  // точка на самой связи — середина отрезка, дальнего от хорды (как «клик в колено» выше)
  const наСвязи = l => { const p = точки(l), a = центр(graph.byId[l.a]), b = центр(graph.byId[l.b]);
    const ex = b[0] - a[0], ey = b[1] - a[1], от = (x, y) => Math.abs((x - a[0]) * ey - (y - a[1]) * ex) / (Math.hypot(ex, ey) || 1);
    let ц = null; for (let k = 0; k < p.length - 1; k++) { const mx = (p[k][0] + p[k + 1][0]) / 2, my = (p[k][1] + p[k + 1][1]) / 2;
      if (Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]) > 20 && (!ц || от(mx, my) > ц.d)) ц = {x: mx, y: my, d: от(mx, my)}; }
    return ц; };
  const протянуть = (l, wx, wy, доп) => { тихо(); const н = наСвязи(l);
    graph.zoom = 1; graph.tx = graph.W / 2 - (н.x + wx) / 2; graph.ty = graph.H / 2 - (н.y + wy) / 2;
    const попал = graph.links[graph._hitLink(экр(н.x, н.y))] === l;
    соб("pointerdown", экр(н.x, н.y), доп); соб("pointermove", экр((н.x + wx) / 2, (н.y + wy) / 2), доп); соб("pointermove", экр(wx, wy), доп);
    graph._routesFresh(); return попал; };
  graphSetLinkMode("ortho"); graph.alpha = 0; graph.build(); graph._маршр = null; graph._routesFresh(); await ж(450);
  const [mx0, my0] = мид(), W = [mx0 + 40, my0 + 70];
  const попал = протянуть(жив(), W[0], W[1]);
  const вРуке = жив();
  t.push({имя: "протяжка: связь в руке идёт через точку под курсором, ступенькой без косых",
          ок: попал && !!(вРуке._рт && вРуке._рт.via) && черезТочку(вРуке, W[0], W[1]) < ДОП && ровно(вРуке).length === 0 && !хран()[4],
          факт: "взяли " + (попал ? "связь" : "мимо") + ", до точки " + черезТочку(вРуке, W[0], W[1]).toFixed(2) + " px, косых: " + (ровно(вРуке).join(", ") || "нет") + ", в данных до отпускания: " + JSON.stringify(хран()[4] || null)});
  соб("pointerup", экр(W[0], W[1]));
  const я = хран()[4] && хран()[4][0];
  t.push({имя: "протяжка: на отпускании точка уходит в данные смещением от середины концов",
          ок: !!я && Math.abs(я.dx - 40) < 0.2 && Math.abs(я.dy - 70) < 0.2 && хран().length === 5 && !я.g,
          факт: JSON.stringify(хран().slice(2))});
  graph._routesFresh();
  const после = жив(), рт = после._рт && после._рт.via;
  t.push({имя: "протяжка: подбор точку не двигает — путь по-прежнему через неё", ок: !!рт && черезТочку(после, W[0], W[1]) < ДОП,
          факт: рт ? "через точку, до неё " + черезТочку(после, W[0], W[1]).toFixed(2) + " px" : "маршрут без точки"});
  // концы едут — точка едет за серединой: сдвиг ноды (60, 20) двигает её на (30, 10)
  { const n = graph.byId[C1.id]; n.x += 60; n.y += 20; graph._маршр.грязно = true; graph._routesFresh();
    const д = черезТочку(жив(), W[0] + 30, W[1] + 10);
    t.push({имя: "протяжка: точка едет за серединой концов", ок: д < ДОП && ровно(жив()).length === 0, факт: "до ожидаемой точки " + д.toFixed(2) + " px"});
    n.x -= 60; n.y -= 20; graph._маршр.грязно = true; graph._routesFresh(); }
  // метка якоря при наведении: связь с точкой — метка в точке, курсор ушёл — метки нет
  // курсор — на саму точку: середина дальнего отрезка лежала у соседней ноды, а нода главнее связи
  // и ПОСЛЕ плавного перехода формы (_routeMorph, 180 мс): посреди него линия ещё идёт старым путём
  { graph._маршр.грязно = true; graph._routesFresh(); await ж(250); тихо(); const l = жив(), н = {x: W[0], y: W[1]};
    graph.zoom = 1; graph.tx = graph.W / 2 - н.x; graph.ty = graph.H / 2 - н.y;
    const разбор = "якорных " + (graph._якорные || []).length + ", попадание " + graph._hitLink(экр(н.x, н.y), graph._якорные || []) + " (она " + graph.links.indexOf(l) + "), нода " + graph._hitNode(экр(н.x, н.y)) + ", холст " + graph.canvasMode;
    соб("pointermove", экр(н.x, н.y), {buttons: 0}); const нав = graph._якНав, м = (graph._anchorMark(l) || [])[0];
    соб("pointermove", экр(н.x + 400, н.y + 400), {buttons: 0});
    t.push({имя: "протяжка: наведение на связь с якорем показывает метку в точке, уход — снимает",
            ок: нав === l && !!м && Math.hypot(м.x - W[0], м.y - W[1]) < 0.5 && !graph._якНав && (graph._якорные || []).includes(l),
            факт: "под курсором " + (нав === l ? "она" : нав ? "другая" : "ничего") + ", метка " + (м ? "в " + Math.hypot(м.x - W[0], м.y - W[1]).toFixed(2) + " px от точки" : "нет") + ", после ухода " + (graph._якНав ? "осталась" : "снята") + (нав === l ? "" : "; " + разбор)}); }
  // в других режимах через ту же точку
  for (const [m, метро] of [["soft", false], ["metro", true], ["bus", false], ["bundle", false]]) {
    graphSetLinkMode(m); graph._маршр = null; graph._routesFresh();
    const l = жив(), д = черезТочку(l, W[0], W[1]), косых = m === "soft" || m === "bundle" ? [] : ровно(l, метро);
    t.push({имя: "протяжка: " + m + " — через точку" + (m === "metro" ? ", прямые и 45°" : m === "bus" ? ", ступенькой" : ", плавно"),
            ок: !!(l._рт && l._рт.via) && д < ДОП && косых.length === 0, факт: "до точки " + д.toFixed(2) + " px, не по правилу: " + (косых.join(", ") || "нет")}); }
  graphSetLinkMode("ortho"); graph._маршр = null; graph._routesFresh();
  // свой режим связи снимают — точка остаётся
  { const s = хран(); s[3] = "metro"; graph._маршр.грязно = true; graph._routesFresh();
    const меню = graph._openLinkPop(жив(), экр(W[0], W[1])), кн = document.querySelector('#node-pop [data-lm=""]');
    if (кн) кн.click();
    t.push({имя: "протяжка: снять свой режим связи — точка маршрута остаётся", ок: !!кн && хран().length === 5 && хран()[3] == null && !!хран()[4],
            факт: JSON.stringify(хран().slice(2))}); graph._closePop(); }
  // клик без сдвига — ничего (меню связи только по ПКМ), данные не трогаются; ПКМ — меню с кнопкой сброса
  { await ж(400); graph._closePop(); const н = наСвязи(жив()), до = JSON.stringify(хран());
    соб("pointerdown", экр(н.x, н.y)); соб("pointermove", экр(н.x + 1, н.y + 1)); соб("pointerup", экр(н.x + 1, н.y + 1));
    const послеЛКМ = !!document.querySelector("#node-pop");
    graph._lcLink = null;
    const пк = экр(н.x, н.y); svg().dispatchEvent(new MouseEvent("contextmenu", {button: 2, clientX: пк.clientX, clientY: пк.clientY, bubbles: true, cancelable: true}));
    const кн = document.querySelector('#node-pop [data-lp="unanc"]');
    t.push({имя: "протяжка: ЛКМ без сдвига меню не открывает, ПКМ — меню с «Сбросить маршрут»", ок: !послеЛКМ && !!document.querySelector("#node-pop") && !!кн && JSON.stringify(хран()) === до,
            факт: "после ЛКМ меню " + (послеЛКМ ? "открылось" : "нет") + ", после ПКМ " + (document.querySelector("#node-pop") ? "открыто" : "нет") + ", кнопка сброса " + (кн ? "есть" : "нет")});
    if (кн) кн.click(); graph._routesFresh();
    t.push({имя: "протяжка: «Сбросить маршрут» возвращает автоподбор", ок: !хран()[4] && !(жив()._рт && жив()._рт.via), факт: JSON.stringify(хран().slice(2))}); }
  // откат: одна протяжка — один шаг
  { await ж(450); протянуть(жив(), W[0], W[1]); соб("pointerup", экр(W[0], W[1])); const был4 = !!хран()[4];
    await ж(450); undoStep(); await ж(300);
    t.push({имя: "протяжка: Ctrl+Z снимает её одним шагом", ок: был4 && !!хран() && !хран()[4], факт: "до отката " + (был4 ? "точка есть" : "точки нет") + ", после " + JSON.stringify(хран() ? хран().slice(2) : "связи нет")}); }
  // двойной клик — сброс
  { const s = хран(); s[2] = +s[2] || 1; s[3] = null; s[4] = {dx: 40, dy: 70}; graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh();
    const н = наСвязи(жив()); graph.zoom = 1; graph.tx = graph.W / 2 - н.x; graph.ty = graph.H / 2 - н.y; graph._lcLink = null;
    for (let k = 0; k < 2; k++) { соб("pointerdown", экр(н.x, н.y)); соб("pointerup", экр(н.x, н.y)); }
    t.push({имя: "протяжка: двойной клик по связи сбрасывает точку", ок: !хран()[4], факт: JSON.stringify(хран().slice(2))}); graph._closePop(); }
  // несколько точек: протяжка в другом месте связи добавляет точку, рядом с точкой — двигает её, двойной клик по точке убирает её одну
  { const тащить = (из, в, доп) => { graph.zoom = 1; graph.tx = graph.W / 2 - (из[0] + в[0]) / 2; graph.ty = graph.H / 2 - (из[1] + в[1]) / 2; graph._lcLink = null;
      соб("pointerdown", экр(из[0], из[1]), доп); соб("pointermove", экр((из[0] + в[0]) / 2, (из[1] + в[1]) / 2), доп); соб("pointermove", экр(в[0], в[1]), доп);
      соб("pointerup", экр(в[0], в[1]), доп); graph._routesFresh(); };
    graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); await ж(450); тихо();
    const [ax, ay] = мид(), W1 = [ax + 40, ay + 70];
    тащить((наСвязи(жив()) && [наСвязи(жив()).x, наСвязи(жив()).y]), W1); await ж(250); тихо();
    // взять связь подальше от первой точки и от концов
    const a0 = центр(graph.byId[P.id]), b0 = центр(graph.byId[C1.id]);
    const кан = точки(жив()).filter(q => Math.hypot(q[0] - W1[0], q[1] - W1[1]) > 60 && Math.hypot(q[0] - a0[0], q[1] - a0[1]) > 50 && Math.hypot(q[0] - b0[0], q[1] - b0[1]) > 50);
    const q = кан[Math.floor(кан.length / 2)], W2 = q ? [q[0] - 20, q[1] - 30] : null;
    if (q) { тащить(q, W2); await ж(250); }
    const сп = хран()[4] || [];
    t.push({имя: "точки маршрута: протяжка в другом месте связи добавляет вторую точку",
            ок: !!q && сп.length === 2 && черезТочку(жив(), W1[0], W1[1]) < ДОП && черезТочку(жив(), W2[0], W2[1]) < ДОП,
            факт: "точек " + сп.length + (q ? ", до первой " + черезТочку(жив(), W1[0], W1[1]).toFixed(1) + ", до второй " + черезТочку(жив(), W2[0], W2[1]).toFixed(1) + " px" : ", взять негде")});
    // рядом с первой точкой — она и едет, новой не появляется
    const мм = graph._anchorMark(жив()) || [], м1 = мм.reduce((б, м) => (!б || Math.hypot(м.x - W1[0], м.y - W1[1]) < Math.hypot(б.x - W1[0], б.y - W1[1])) ? м : б, null);
    const W1б = [W1[0] + 25, W1[1] - 10];
    if (м1) { тащить([м1.x + 3, м1.y + 2], W1б); await ж(250); }
    const сп2 = хран()[4] || [];
    t.push({имя: "точки маршрута: протяжка у точки двигает её, а не добавляет новую",
            ок: сп2.length === 2 && черезТочку(жив(), W1б[0], W1б[1]) < ДОП && (!W2 || черезТочку(жив(), W2[0], W2[1]) < ДОП),
            факт: "точек " + сп2.length + ", до нового места " + черезТочку(жив(), W1б[0], W1б[1]).toFixed(1) + " px"});
    // двойной клик по второй точке — уходит она одна
    const мм2 = graph._anchorMark(жив()) || [], м2 = W2 && мм2.reduce((б, м) => (!б || Math.hypot(м.x - W2[0], м.y - W2[1]) < Math.hypot(б.x - W2[0], б.y - W2[1])) ? м : б, null);
    if (м2) { graph.zoom = 1; graph.tx = graph.W / 2 - м2.x; graph.ty = graph.H / 2 - м2.y; graph._lcLink = null;
      for (let k = 0; k < 2; k++) { соб("pointerdown", экр(м2.x, м2.y)); соб("pointerup", экр(м2.x, м2.y)); } graph._routesFresh(); }
    const сп3 = хран()[4] || [];
    t.push({имя: "точки маршрута: двойной клик по точке убирает только её", ок: сп3.length === 1 && черезТочку(жив(), W1б[0], W1б[1]) < ДОП,
            факт: "точек " + сп3.length});
    хран().length = 3; graph.build(); graph.alpha = 0; graph._closePop(); }
  /* подбор сторон обхода: связь A→B с точкой посередине; у двух самых простых путей по два поворота,
     сторона «по оси дерева» идёт вертикалью x = середины, и на ней стоит чужая нода O. Подбор обязан
     увести связь горизонталью через ту же точку, а не сквозь O. */
  { const нп = (title, x, y) => { const it = addItem({kind: "note", title}); it.x = 50000 + x; it.y = 50000 + y; мои.push(it.id); return it; };
    const A = нп("связи-пА", 0, 0), B = нп("связи-пБ", 300, 200), O = нп("связи-пO", 150, 45);
    addLink(A.id, B.id); recomputeHierarchy(); persist();
    graphSetLinkMode("ortho"); graph.build(); graph.alpha = 0;
    const s = S.links.find(x => (x[0] === A.id && x[1] === B.id) || (x[1] === A.id && x[0] === B.id)); s[2] = 1; s[3] = null; s[4] = [{dx: 0, dy: 0}];
    graph._маршр = null; graph._routesFresh(); for (let k = 0; k < 4 && graph._оптНедо; k++) { await ж(200); graph._routesFresh(); } тихо();
    const l = связь(A.id, B.id), o = graph.byId[O.id], до = l ? черезТочку(l, o.x, o.y) : 0, Wп = [50150, 50100];
    t.push({имя: "точки маршрута: подбор выбирает сторону обхода мимо чужой ноды",
            ок: !!(l && l._рт && l._рт.via) && до > (o.r || 8) + 6 && черезТочку(l, Wп[0], Wп[1]) < ДОП,
            факт: l && l._рт && l._рт.via ? "стороны " + l._рт.via.mask.toString(2) + ", до чужой ноды " + до.toFixed(1) + " px, до точки " + черезТочку(l, Wп[0], Wп[1]).toFixed(1) : "маршрута через точку нет"});
    s.length = 3; graph.build(); graph.alpha = 0; }
  // привязка: точка садится на узел сетки и держится на нём, когда концы едут
  { S.settings.graphSnap = true; S.settings.graphSnapMode = "always"; graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh();
    const [ax, ay] = мид(), Wc = [ax + 47.3, ay + 81.9];
    протянуть(жив(), Wc[0], Wc[1]); соб("pointerup", экр(Wc[0], Wc[1])); graph._routesFresh();
    const я2 = хран()[4] && хран()[4][0], в = жив()._рт && жив()._рт.via && жив()._рт.via.pts[0], наУзле = (x, g) => Math.abs(x / g - Math.round(x / g)) < 1e-6;
    t.push({имя: "протяжка с привязкой: точка на узле сетки, шаг сетки в данных",
            ок: !!я2 && я2.g > 0 && !!в && наУзле(в.wx, я2.g) && наУзле(в.wy, я2.g),
            факт: "в данных " + JSON.stringify(я2) + ", точка " + (в ? в.wx.toFixed(2) + ", " + в.wy.toFixed(2) : "нет")});
    const n = graph.byId[C1.id]; n.x += 37; n.y += 13; graph._маршр.грязно = true; graph._routesFresh();
    const в2 = жив()._рт && жив()._рт.via && жив()._рт.via.pts[0];
    t.push({имя: "протяжка с привязкой: концы поехали — точка остаётся на узлах", ок: !!в2 && !!я2 && наУзле(в2.wx, я2.g) && наУзле(в2.wy, я2.g) && черезТочку(жив(), в2.wx, в2.wy) < ДОП,
            факт: в2 ? в2.wx.toFixed(2) + ", " + в2.wy.toFixed(2) + " при шаге " + (я2 && я2.g) : "точки нет"});
    n.x -= 37; n.y -= 13; хран().length = 3; S.settings.graphSnap = false; graph.build(); }
  // шина: протяжка любой связи группы двигает ОБЩИЙ ствол (busoff родителя), Shift — точку одной связи
  /* своё дерево: у детей выше своя область, и связь к ним не связь дерева — группы шины там нет.
     Здесь дети без области, родитель им — Pn по связи (как в разделе «режим ветки») */
  { const нш = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = 40000 + x; it.y = 40000 + y; мои.push(it.id); return it; };
    const Pn = нш("связи-шР", 0, 0, true), дети = [[220, -160], [260, -40], [240, 70], [210, 150]].map(([dx, dy], i) => нш("связи-ш" + i, dx, dy));
    дети.forEach(c => addLink(Pn.id, c.id)); recomputeHierarchy(); persist();
    const P = Pn, C1 = дети[1], хран = () => S.links.find(x => (x[0] === P.id && x[1] === C1.id) || (x[1] === P.id && x[0] === C1.id));
    graphSetLinkMode("bus"); graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); тихо();
    const груп = дети.map(c => связь(P.id, c.id)), ш = груп[0]._рт && груп[0]._рт.шина;
    const X = graph.byId[P.id].x + 120, н = наСвязи(груп[0]);
    graph.zoom = 1; graph.tx = graph.W / 2 - X; graph.ty = graph.H / 2 - н.y;
    соб("pointerdown", экр(н.x, н.y)); соб("pointermove", экр((н.x + X) / 2, н.y)); соб("pointermove", экр(X, н.y)); graph._routesFresh();
    const наСтволе = l => { const p = (тихо(), точки(l)); for (let k = 0; k < p.length - 1; k++)
      if (Math.abs(p[k][0] - X) < 0.5 && Math.abs(p[k + 1][0] - X) < 0.5 && Math.abs(p[k + 1][1] - p[k][1]) > 4) return true; return false; };
    const вРуке = дети.map(c => наСтволе(связь(P.id, c.id)));
    соб("pointerup", экр(X, н.y)); graph._routesFresh();
    const после = дети.map(c => наСтволе(связь(P.id, c.id))), б = Pn && Pn.busoff;
    t.push({имя: "шина: протяжка одной связи двигает общий ствол всей группы",
            ок: !!ш && вРуке.filter(Boolean).length >= 3 && после.filter(Boolean).length >= 3 && !!б && !!б[ш.k] && Math.abs(б[ш.k].off - 120) < 0.2 && !хран()[4],
            факт: "группа " + (ш ? ш.k : "нет") + ", на стволе в руке " + вРуке.filter(Boolean).length + ", после " + после.filter(Boolean).length + " из 4, в родителе " + JSON.stringify(б || null)});
    t.push({имя: "шина: ствол, поставленный рукой, подбор не трогает", ок: дети.every(c => { const l = связь(P.id, c.id); return l._рт && !l._рт.умолч; }),
            факт: дети.map(c => связь(P.id, c.id)._рт && связь(P.id, c.id)._рт.умолч ? "подбор" : "рука").join(", ")});
    { const мш = (graph._anchorMark(связь(P.id, дети[2].id)) || [])[0];
      t.push({имя: "шина: метка якоря у любой связи группы — ручка на развилке ствола", ок: !!мш && мш.ствол && Math.abs(мш.x - X) < 0.5,
              факт: мш ? (мш.ствол ? "ручка" : "точка") + " в x " + мш.x.toFixed(1) + " при стволе " + X.toFixed(1) : "метки нет"}); }
    // Shift — точка маршрута только этой связи, ствол группы на месте
    await ж(400); const н2 = наСвязи(связь(P.id, C1.id)), W2 = [н2.x + 30, н2.y + 40];
    graph.zoom = 1; graph.tx = graph.W / 2 - н2.x; graph.ty = graph.H / 2 - н2.y;
    соб("pointerdown", экр(н2.x, н2.y), {shiftKey: true}); соб("pointermove", экр(н2.x + 15, н2.y + 20), {shiftKey: true}); соб("pointermove", экр(W2[0], W2[1]), {shiftKey: true});
    соб("pointerup", экр(W2[0], W2[1]), {shiftKey: true}); graph._routesFresh();
    t.push({имя: "шина: Shift+протяжка — точка маршрута одной связи, ствол не меняется",
            ок: !!хран()[4] && !!(Pn.busoff && Pn.busoff[ш.k] && Math.abs(Pn.busoff[ш.k].off - 120) < 0.2), факт: "у связи " + JSON.stringify(хран()[4] || null) + ", ствол " + JSON.stringify(Pn.busoff || null)});
    // сброс двойным кликом по связи группы
    хран().length = 3; graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); тихо();
    const н3 = наСвязи(груп[0] && связь(P.id, дети[0].id)); graph._lcLink = null;
    graph.zoom = 1; graph.tx = graph.W / 2 - н3.x; graph.ty = graph.H / 2 - н3.y;
    for (let k = 0; k < 2; k++) { соб("pointerdown", экр(н3.x, н3.y)); соб("pointerup", экр(н3.x, н3.y)); }
    t.push({имя: "шина: двойной клик по связи группы возвращает ствол автоподбору", ок: !Pn.busoff, факт: JSON.stringify(Pn.busoff || null)});
    delete Pn.busoff; graphSetLinkMode("ortho"); graph.build(); graph.alpha = 0; }
  // санитайзер и нить к области; нода — заново из данных: откат выше заменил объекты нод копиями из снимка
  { const P = S.items.find(i => i.id === мои[0]);
    const s = хран(); s[2] = 1; s[3] = null; s[4] = {dx: 12.34, dy: -8}; P.areaanchor = {dx: 0, dy: 90};
    const чист = sanitizeState(JSON.parse(JSON.stringify({graphs: S.graphs, settings: S.settings, boards: {}, media: {}, tags: S.tags, templates: S.templates})));
    let св = null, нд = null;
    for (const g of чист.graphs || []) { св = (g.links || []).find(x => (x[0] === P.id && x[1] === C1.id) || (x[1] === P.id && x[0] === C1.id)) || св; нд = (g.items || []).find(i => i.id === P.id) || нд; }
    s[4] = {dx: "мусор"}; P.areaanchor = [1, 2];
    const чист2 = sanitizeState(JSON.parse(JSON.stringify({graphs: S.graphs, settings: S.settings, boards: {}, media: {}, tags: S.tags, templates: S.templates})));
    let св2 = null, нд2 = null;
    for (const g of чист2.graphs || []) { св2 = (g.links || []).find(x => (x[0] === P.id && x[1] === C1.id) || (x[1] === P.id && x[0] === C1.id)) || св2; нд2 = (g.items || []).find(i => i.id === P.id) || нд2; }
    t.push({имя: "протяжка: санитайзер держит точку и срезает мусор",
            ок: !!св && св.length === 5 && св[3] === null && Array.isArray(св[4]) && св[4][0].dx === 12.3 && !!нд && Array.isArray(нд.areaanchor) && нд.areaanchor[0].dy === 90 && !!св2 && св2.length <= 3 && !!нд2 && !("areaanchor" in нд2),
            факт: "законная " + JSON.stringify(св && св.slice(2)) + " / " + JSON.stringify(нд && нд.areaanchor) + ", мусор → " + JSON.stringify(св2 && св2.slice(2)) + " / " + JSON.stringify(нд2 && нд2.areaanchor)});
    s.length = 3; P.areaanchor = {dx: 0, dy: 90}; graph.build(); graph._маршр = null; graph._routesFresh();
    const нить = graph.links.find(l => !l.manual && l.a === P.id), а = graph.byId[P.id], б = нить && graph.byId[нить.b];
    const дн = нить && б ? черезТочку(нить, (а.x + б.x) / 2, (а.y + б.y) / 2 + 90) : Infinity;
    t.push({имя: "протяжка: нить к области идёт через свою точку (it.areaanchor)", ок: !!(нить && нить._рт && нить._рт.via) && дн < ДОП,
            факт: нить ? "до точки " + дн.toFixed(2) + " px" : "нити нет"});
    delete P.areaanchor; graph.build(); }
  S.settings.graphSnap = былСнап.s; if (былСнап.m == null) delete S.settings.graphSnapMode; else S.settings.graphSnapMode = былСнап.m;
  if (былСнап.d == null) delete S.settings.graphDrift; else S.settings.graphDrift = былСнап.d;
  graphSetLinkMode("soft");
}

// ================== ТОЧКА СВЯЗЕЙ (Alt-сбор, как dot в Houdini, 04.11.2026) ==================
/* Alt + протяжка по связям: задетые цепляются к курсору, точка встаёт там, где отпустил; Alt+клик по
   пустому ничего не создаёт. Точка — S.dots, связь ссылается на неё {d:id}. Откат одним шагом, протяжка
   точки, меню (отцепить одну, убрать точку), санитайзер, копия с новыми id. */
{
  const былД = S.settings.graphDrift, былС = S.settings.graphSnap; S.settings.graphDrift = 0; S.settings.graphSnap = false;
  const X = 60000, Y = 60000;
  const нт = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X + x; it.y = Y + y; мои.push(it.id); return it; };
  const A1 = нт("связи-тA1", 0, 0, true), B1 = нт("связи-тB1", 400, 40), A2 = нт("связи-тA2", 0, 160, true), B2 = нт("связи-тB2", 400, 200);
  addLink(A1.id, B1.id); addLink(A2.id, B2.id); recomputeHierarchy(); persist();
  graphSetLinkMode("ortho"); graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); await ж(450);
  graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
  const svgт = () => graph.svg;
  const экрт = (wx, wy) => { const rc = graph.svg.getBoundingClientRect(); return {clientX: rc.left + (wx * graph.zoom + graph.tx) / graph.W * rc.width, clientY: rc.top + (wy * graph.zoom + graph.ty) / graph.H * rc.height}; };
  const сбт = (тип, x, y, доп) => { const p = экрт(x, y); svgт().dispatchEvent(new PointerEvent(тип, Object.assign({button: 0, buttons: тип === "pointermove" ? 1 : 0, clientX: p.clientX, clientY: p.clientY, bubbles: true, cancelable: true}, доп || {}))); };
  const хр = (a, b) => S.links.find(x => (x[0] === a.id && x[1] === b.id) || (x[1] === a.id && x[0] === b.id));
  const жл = (a, b) => связь(a.id, b.id);
  const точкиС = () => Object.keys((graphCurrent() || {}).dots || {});
  const доТочки = (l, x, y) => { const p = []; graph._routeTrace({moveTo: (a, b) => p.push([a, b]), lineTo: (a, b) => p.push([a, b])}, {a: l.a, b: l.b, _рт: Object.assign({}, l._рт, {мф: null})}, false, 1, 0, 0);
    let м = Infinity; for (let k = 0; k < p.length - 1; k++) { const ex = p[k + 1][0] - p[k][0], ey = p[k + 1][1] - p[k][1], L2 = ex * ex + ey * ey || 1e-9; let u = ((x - p[k][0]) * ex + (y - p[k][1]) * ey) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; м = Math.min(м, Math.hypot(x - p[k][0] - ex * u, y - p[k][1] - ey * u)); } return м; };
  graph.zoom = 1; graph.tx = graph.W / 2 - (X + 200); graph.ty = graph.H / 2 - (Y + 100);
  // Alt+клик по пустому — ничего не создаётся
  { const до = S.items.length; сбт("pointerdown", X + 200, Y - 120, {altKey: true}); сбт("pointerup", X + 200, Y - 120, {altKey: true}); await ж(100);
    const коробка = !!document.querySelector(".g-quick");
    t.push({имя: "точка связей: Alt+клик по пустому месту ноду не создаёт", ок: S.items.length === до && !коробка && !точкиС().length,
            факт: "нод было " + до + ", стало " + S.items.length + ", окно ввода " + (коробка ? "открылось" : "нет") + ", точек " + точкиС().length}); }
  // Alt-протяжка поперёк обеих связей: в руке — пучок за курсором, отпустил — точка там же
  await ж(400);
  const Wt = [X + 230, Y + 110];
  сбт("pointerdown", X + 200, Y - 60, {altKey: true});
  for (let k = 1; k <= 12; k++) сбт("pointermove", X + 200, Y - 60 + k * 25, {altKey: true});
  сбт("pointermove", Wt[0], Wt[1], {altKey: true}); graph._routesFresh();
  const вРуке = graph._сбор ? graph._сбор.связи.size : 0, тч = graph._сбор && graph._сбор.точка;
  const заКурсором = !!тч && Math.hypot(тч.x - Wt[0], тч.y - Wt[1]) < 0.5 && доТочки(жл(A1, B1), Wt[0], Wt[1]) < 5 && доТочки(жл(A2, B2), Wt[0], Wt[1]) < 5;
  сбт("pointerup", Wt[0], Wt[1]); graph._routesFresh(); await ж(250);
  const ид = точкиС()[0], д = ид && graphCurrent().dots[ид], я1 = хр(A1, B1)[4], я2 = хр(A2, B2)[4];
  t.push({имя: "точка связей: Alt-протяжка собирает задетые связи в пучок за курсором", ок: вРуке === 2 && заКурсором,
          факт: "в пучке " + вРуке + ", точка " + (тч ? "под курсором " + (Math.hypot(тч.x - Wt[0], тч.y - Wt[1]) < 0.5 ? "да" : "нет") : "не заведена")});
  t.push({имя: "точка связей: отпустил — точка там, где отпустил, обе связи через неё",
          ок: точкиС().length === 1 && !!д && Math.hypot(д.x - Wt[0], д.y - Wt[1]) < 0.5 && !!я1 && я1[0].d === ид && !!я2 && я2[0].d === ид && доТочки(жл(A1, B1), д.x, д.y) < 5 && доТочки(жл(A2, B2), д.x, д.y) < 5,
          факт: "точек " + точкиС().length + (д ? ", в " + (д.x - X).toFixed(0) + "," + (д.y - Y).toFixed(0) : "") + ", у связей " + JSON.stringify([я1, я2])});
  t.push({имя: "точка связей: в точке нет провала и подбор не разводит пучок", ок: !(жл(A1, B1)._пров || []).length && !(жл(A2, B2)._пров || []).length,
          факт: "провалов " + ((жл(A1, B1)._пров || []).length + (жл(A2, B2)._пров || []).length)});
  // ничего не задел — ничего
  { await ж(400); const до = точкиС().length; сбт("pointerdown", X + 700, Y - 300, {altKey: true}); сбт("pointermove", X + 720, Y - 290, {altKey: true}); сбт("pointermove", X + 760, Y - 280, {altKey: true}); сбт("pointerup", X + 760, Y - 280, {altKey: true});
    t.push({имя: "точка связей: протяжка мимо связей ничего не создаёт", ок: точкиС().length === до, факт: "точек было " + до + ", стало " + точкиС().length}); }
  // протяжка самой точки — связи едут за ней
  { await ж(400); const д0 = graphCurrent().dots[ид], W2 = [д0.x + 40, д0.y - 30];
    graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
    сбт("pointerdown", д0.x, д0.y); сбт("pointermove", д0.x + 20, д0.y - 15); сбт("pointermove", W2[0], W2[1]); сбт("pointerup", W2[0], W2[1]); graph._routesFresh(); await ж(250);
    const д1 = graphCurrent().dots[ид];
    t.push({имя: "точка связей: протяжка точки — связи едут за ней", ок: !!д1 && Math.hypot(д1.x - W2[0], д1.y - W2[1]) < 0.5 && доТочки(жл(A1, B1), W2[0], W2[1]) < 5 && доТочки(жл(A2, B2), W2[0], W2[1]) < 5,
            факт: д1 ? "точка в " + (д1.x - X).toFixed(0) + "," + (д1.y - Y).toFixed(0) + ", до связей " + доТочки(жл(A1, B1), W2[0], W2[1]).toFixed(1) + " / " + доТочки(жл(A2, B2), W2[0], W2[1]).toFixed(1) : "точки нет"}); }
  // откат: один шаг снимает протяжку точки, второй — саму точку
  { await ж(400); const д1 = Object.assign({}, graphCurrent().dots[ид]); undoStep(); await ж(300);
    const после1 = (graphCurrent().dots || {})[ид]; undoStep(); await ж(300);
    const после2 = точкиС().length, я = хр(A1, B1) && хр(A1, B1)[4];
    t.push({имя: "точка связей: Ctrl+Z — шаг за жестом: сперва место точки, потом сама точка",
            ок: !!после1 && Math.hypot(после1.x - Wt[0], после1.y - Wt[1]) < 0.5 && после2 === 0 && !я,
            факт: "после первого " + (после1 ? (после1.x - X).toFixed(0) + "," + (после1.y - Y).toFixed(0) : "точки нет") + " (было " + (д1.x - X).toFixed(0) + "," + (д1.y - Y).toFixed(0) + "), после второго точек " + после2 + ", у связи " + JSON.stringify(я || null)});
    redoStep(); await ж(300); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); }
  // меню точки: клик без сдвига; «Отцепить» одну, «Убрать точку» — все
  { const ид2 = точкиС()[0], д = ид2 && graphCurrent().dots[ид2];
    if (д) { graph.zoom = 1; graph.tx = graph.W / 2 - д.x; graph.ty = graph.H / 2 - д.y; graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; }); сбт("pointerdown", д.x, д.y); сбт("pointerup", д.x, д.y); }
    const кн = [...document.querySelectorAll('#node-pop [data-dp]')];
    t.push({имя: "точка связей: клик по точке — меню «Убрать точку» и «Отцепить» по каждой связи", ок: кн.length === 3 && кн[0].dataset.dp === "del",
            факт: "кнопок " + кн.length + (кн.length ? ": " + кн.map(b => b.textContent.trim()).join(" | ") : "")});
    const от = кн.find(b => b.dataset.dp === "0"); if (от) от.click(); graph._routesFresh();
    const сп = graph._dotLinks(ид2);
    t.push({имя: "точка связей: «Отцепить» снимает одну связь, точка остаётся у второй", ок: сп.length === 1 && точкиС().length === 1, факт: "через точку " + сп.length + ", точек " + точкиС().length});
    graph._dotDetach(ид2, null); graph._routesFresh();
    t.push({имя: "точка связей: «Убрать точку» — связи к автомаршруту, точки нет", ок: !точкиС().length && !хр(A1, B1)[4] && !хр(A2, B2)[4], факт: "точек " + точкиС().length}); graph._closePop(); }
  // санитайзер: висячая ссылка снимается, точка без связей уходит
  { const g = graphCurrent(); g.dots = {dot_live: {x: X + 10, y: Y + 10}, dot_orphan: {x: 0, y: 0}}; хр(A1, B1)[2] = 1; хр(A1, B1)[3] = null; хр(A1, B1)[4] = [{d: "dot_live"}]; хр(A2, B2)[2] = 1; хр(A2, B2)[3] = null; хр(A2, B2)[4] = [{d: "dot_none"}, {dx: 5, dy: 5}];
    const ч = sanitizeState(JSON.parse(JSON.stringify({graphs: S.graphs, settings: S.settings, boards: {}, media: {}, tags: S.tags, templates: S.templates})));
    const гр = (ч.graphs || []).find(x => x.id === g.id) || {}, к1 = (гр.links || []).find(x => x[0] === A1.id || x[1] === A1.id), к2 = (гр.links || []).find(x => x[0] === A2.id || x[1] === A2.id);
    t.push({имя: "точка связей: санитайзер снимает висячие ссылки и точки без связей",
            ок: !!гр.dots && !!гр.dots["dot_live"] && !гр.dots["dot_orphan"] && !!к1 && к1[4][0].d === "dot_live" && !!к2 && к2[4].length === 1 && !к2[4][0].d,
            факт: "точки " + JSON.stringify(Object.keys(гр.dots || {})) + ", связи " + JSON.stringify([к1 && к1[4], к2 && к2[4]])}); }
  // копия ветки: точка с новым id, связь копии идёт через неё, не через оригинал
  { graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh();
    graph.selNodes = new Set([A1.id, B1.id]); graph.copySelection(); const рез = graph.pasteClip(40, true);
    if (рез && рез.newIds) мои.push(...рез.newIds);
    const нов = рез && рез.newIds ? S.links.find(x => рез.newIds.includes(x[0]) && рез.newIds.includes(x[1])) : null, нд = нов && нов[4] && нов[4][0] && нов[4][0].d;
    t.push({имя: "точка связей: копия ветки получает свою точку с новым id", ок: !!нд && нд !== "dot_live" && !!graphCurrent().dots[нд],
            факт: "у копии " + JSON.stringify(нов ? нов[4] : null) + ", точек " + JSON.stringify(точкиС())}); graph.selNodes = new Set(); }
  /* ALT — ЖИВОЙ ПЕРЕКЛЮЧАТЕЛЬ (КРОЛИК: «Alt отпускаю, а оно всё равно следующие связи цепляет»): три
     связи друг под другом; Alt зажат — первая в пучке, отпущен — вторая НЕ цепляется (а пучок едет за
     курсором), нажат снова при той же ЛКМ — третья цепляется в тот же пучок */
  { await ж(400);
    const тр = [0, 1, 2].map(i => { const a = нт("связи-тП" + i, 900, 400 + i * 120, true), b = нт("связи-тЦ" + i, 1300, 430 + i * 120); addLink(a.id, b.id); return [a, b]; });
    recomputeHierarchy(); persist(); graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
    graph.zoom = 1; graph.tx = graph.W / 2 - (X + 1100); graph.ty = graph.H / 2 - (Y + 520);
    const клав = тип => window.dispatchEvent(new KeyboardEvent(тип, {key: "Alt", code: "AltLeft", bubbles: true, cancelable: true}));
    const вПучке = () => graph._сбор ? [...graph._сбор.связи].filter(k => тр.some(([a, b]) => k === a.id + "|" + b.id || k === b.id + "|" + a.id)).length : -1;
    сбт("pointerdown", X + 1100, Y + 360, {altKey: true});
    for (let y = 360; y <= 470; y += 20) сбт("pointermove", X + 1100, Y + y, {altKey: true});       // через первую (y≈400–430)
    const послеПервой = вПучке(); клав("keyup");
    for (let y = 470; y <= 590; y += 20) сбт("pointermove", X + 1100, Y + y);                        // через вторую (y≈520–550) без Alt
    const послеВторой = вПучке(), т0 = graph._сбор && graph._сбор.точка, едет = !!т0 && Math.abs(т0.y - (Y + 590)) < 0.5;
    клав("keydown");
    for (let y = 590; y <= 710; y += 20) сбт("pointermove", X + 1100, Y + y, {altKey: true});       // через третью (y≈640–670) снова с Alt
    const послеТретьей = вПучке();
    сбт("pointerup", X + 1100, Y + 710, {altKey: true}); graph._routesFresh();
    t.push({имя: "точка связей: Alt отпущен — новые связи не цепляются, пучок едет; нажат снова — сбор продолжается",
            ок: послеПервой === 1 && послеВторой === 1 && едет && послеТретьей === 2,
            факт: "в пучке после первой " + послеПервой + ", после второй (без Alt) " + послеВторой + ", после третьей (Alt снова) " + послеТретьей + ", точка за курсором " + (едет ? "да" : "нет")});
    const ид3 = graph._сбор ? null : Object.keys((graphCurrent() || {}).dots || {}).find(k => k !== ид);
    if (ид3) graph._dotDetach(ид3, null); graph._routesFresh(); }
  /* ЦЕПОЧКА ТОЧЕК (КРОЛИК: «даю ей ещё один якорь дальше — она отцепляется от первого»): второй Alt-жест
     дальше по тем же связям вставляет вторую точку ПОСЛЕ первой, первая остаётся; «Отцепить» от второй
     не трогает первую */
  { await ж(400);
    const цп = [0, 1].map(i => { const a = нт("связи-цЕ" + i, 0, 1000 + i * 100, true), b = нт("связи-цF" + i, 600, 1040 + i * 100); addLink(a.id, b.id); return [a, b]; });
    recomputeHierarchy(); persist(); graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh(); graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
    graph.zoom = 1; graph.tx = graph.W / 2 - (X + 300); graph.ty = graph.H / 2 - (Y + 1100);
    const жест = (x, y0, y1, yК) => { сбт("pointerdown", X + x, Y + y0, {altKey: true});
      for (let y = y0; y <= y1; y += 15) сбт("pointermove", X + x, Y + y, {altKey: true});
      сбт("pointermove", X + x, Y + yК, {altKey: true}); сбт("pointerup", X + x, Y + yК, {altKey: true}); graph._routesFresh(); };
    const спЦ = () => цп.map(([a, b]) => хр(a, b)[4] || []);
    жест(150, 960, 1180, 1220); await ж(400); graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
    const д1 = (спЦ()[0][0] || {}).d;
    жест(450, 960, 1260, 1280); await ж(400); graph.nodes.forEach(n => { n._ix = 0; n._iy = 0; });
    const сп = спЦ(), д2 = сп[0][1] && сп[0][1].d, т1 = д1 && graphCurrent().dots[д1], т2 = д2 && graphCurrent().dots[д2];
    const обе = сп.every(s => s.length === 2 && s[0].d === д1 && s[1].d === д2);
    const через = !!т1 && !!т2 && цп.every(([a, b]) => доТочки(жл(a, b), т1.x, т1.y) < 5 && доТочки(жл(a, b), т2.x, т2.y) < 5);
    t.push({имя: "точка связей: вторая точка дальше по связям встаёт ПОСЛЕ первой, первая жива", ок: !!д1 && !!д2 && д1 !== д2 && обе && через,
            факт: "у связей " + JSON.stringify(сп) + ", через обе точки " + (через ? "да" : "нет")});
    const l0 = жл(цп[0][0], цп[0][1]); if (д2) graph._dotDetach(д2, l0); graph._routesFresh();
    const сп2 = спЦ();
    t.push({имя: "точка связей: «Отцепить» от второй точки не трогает первую", ок: сп2[0].length === 1 && сп2[0][0].d === д1 && сп2[1].length === 2,
            факт: "у первой связи " + JSON.stringify(сп2[0]) + ", у второй " + JSON.stringify(сп2[1])}); }
  { const g = graphCurrent(); delete g.dots; for (const x of S.links) if (x[4]) x.length = 3; graph.build(); }
  /* на отдалении точка — часть связи, а не нода (снимок КРОЛИКА 61): на общем плане её диаметр меньше
     диаметра самой мелкой ноды минимум вдвое; на сильном отдалении не рисуется; под курсором — полная */
  { const rМин = Math.min(...graph.nodes.map(n => n.r).filter(r => r > 0));
    const ряд = [0.25, 0.4, 0.6, 1, 2].map(z => ({z, d: 2 * graph._dotRadius(z, false), н: 2 * rМин * z}));
    const плохо = ряд.filter(x => x.d > x.н / 2 + 1e-6);
    t.push({имя: "точка связей: на отдалении диаметр точки не больше половины самой мелкой ноды", ок: !плохо.length && graph._dotRadius(0.1, false) === 0 && graph._dotRadius(0.25, true) === 5.5,
            факт: ряд.map(x => "×" + x.z + ": точка " + x.d.toFixed(1) + " / нода " + x.н.toFixed(1)).join(", ") + "; на ×0.1 — " + graph._dotRadius(0.1, false)}); }
  // цвет точки — смесь цветов её связей в этом месте, в OKLab (mixColors), а не белый
  { const нц = (title, x, y, c, своя) => { const it = нт(title, x, y, своя); it.color = c; return it; };
    const К1 = нц("связи-кИ", 0, 1500, "#e0625a", true), К2 = нц("связи-кЦ1", 400, 1500, "#e0625a"), К3 = нц("связи-кИ2", 0, 1600, "#6f9bd8", true), К4 = нц("связи-кЦ2", 400, 1600, "#6f9bd8");
    addLink(К1.id, К2.id); addLink(К3.id, К4.id); recomputeHierarchy(); persist();
    const g = graphCurrent(); g.dots = Object.assign({}, g.dots || {}, {dot_color: {x: X + 200, y: Y + 1550}});
    const s1 = хр(К1, К2), s2 = хр(К3, К4); s1[2] = 1; s1[3] = null; s1[4] = [{d: "dot_color"}]; s2[2] = 1; s2[3] = null; s2[4] = [{d: "dot_color"}];
    graph.build(); graph.alpha = 0; graph._маршр = null; graph._routesFresh();
    const смесь = graph._точкиЦвет && graph._точкиЦвет.get("dot_color"), ждём = mixColors(["#e0625a", "#6f9bd8"]);
    s2.length = 3; graph._маршр = null; graph._routesFresh();
    const одна = graph._точкиЦвет && graph._точкиЦвет.get("dot_color");
    // сравнение по каналам с допуском в единицу: порядок сложения весов даёт копеечную разницу при округлении
    const рядом = (x, y) => !!x && !!y && [1, 3, 5].every(i => Math.abs(parseInt(x.slice(i, i + 2), 16) - parseInt(y.slice(i, i + 2), 16)) <= 1);
    t.push({имя: "точка связей: цвет — под цвет нод, у нескольких — смесь в OKLab", ок: рядом(смесь, ждём) && рядом(одна, "#e0625a"),
            факт: "две связи (красная и синяя) → " + смесь + " (ждали " + ждём + "), одна красная → " + одна});
    s1.length = 3; graph.build(); }
  t.push({имя: "точка связей: подсказка клавиш не обещает «Alt+клик — новая нода»", ок: !/Alt\+клик — новая нода/.test((document.querySelector("#g-hint") || {}).textContent || "") , факт: ((document.querySelector("#g-hint") || {}).textContent || "").slice(0, 90)});
  S.settings.graphDrift = былД; if (былД == null) delete S.settings.graphDrift; S.settings.graphSnap = былС;
  graphSetLinkMode("soft");
}

// ================== УБОРКА ==================
deletePack(мои);
if (был.mode) S.settings.graphLinkMode = был.mode; else delete S.settings.graphLinkMode;
S.settings.graphRender = был.rend; S.settings.graphHome = был.home;
render(); await ж(200);
t.push({имя: "за собой убрано", ок: !S.items.some(i => /^связи-/.test(i.title || "")),
        факт: "осталось проверочных нод: " + S.items.filter(i => /^связи-/.test(i.title || "")).length});
return t;
