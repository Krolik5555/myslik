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
  let концы = 0, кривых = [], всего = 0;
  for (const l of L) { if (!l._рт) continue;
    const p = точки(l), a = центр(graph.byId[l.a]), b = центр(graph.byId[l.b]);
    if (Math.hypot(p[0][0] - a[0], p[0][1] - a[1]) < 0.5 && Math.hypot(p[p.length - 1][0] - b[0], p[p.length - 1][1] - b[1]) < 0.5) концы++;
    for (let k = 0; k < p.length - 1; k++) {
      const dx = Math.abs(p[k + 1][0] - p[k][0]), dy = Math.abs(p[k + 1][1] - p[k][1]);
      if (Math.hypot(dx, dy) <= 8) continue;     // кусочек скругления колена (радиус до 14, четыре куска)
      всего++;
      const осевой = dx < 0.01 || dy < 0.01, диаг = Math.abs(dx - dy) < 0.05 * Math.max(dx, dy);
      const годен = m === "metro" ? (осевой || диаг) : m === "bundle" ? true : осевой;
      if (!годен) кривых.push(dx.toFixed(1) + "×" + dy.toFixed(1));
    } }
  t.push({имя: m + ": путь проходит через центры обоих концов", ок: концы === L.length, факт: концы + " из " + L.length});
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

// ================== УБОРКА ==================
deletePack(мои);
if (был.mode) S.settings.graphLinkMode = был.mode; else delete S.settings.graphLinkMode;
S.settings.graphRender = был.rend; S.settings.graphHome = был.home;
render(); await ж(200);
t.push({имя: "за собой убрано", ок: !S.items.some(i => /^связи-/.test(i.title || "")),
        факт: "осталось проверочных нод: " + S.items.filter(i => /^связи-/.test(i.title || "")).length});
return t;
