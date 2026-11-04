/* ПРИВЯЗКА К СЕТКЕ (graph._snapPoint, магнит в тулбаре, Ctrl+'). Главное правило: нода после
   броска стоит РОВНО на узле той решётки, которую рисует фон «Сетка», и это тот её уровень, что
   горит в полную силу на текущем зуме. Решётка в проверке выписана заново, независимо от
   _snapPoint, по формуле _drawMain: разойдись привязка с фоном — проверка это и поймает.
   Ещё: в режиме «только рядом» шаг не мельче ноды и вдали от точки нода свободна; Ctrl посреди
   жеста переворачивает привязку; брошенную ноду физика с точки не уводит; откат — одним шагом. */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const был = {snap: S.settings.graphSnap, mode: S.settings.graphSnapMode, home: S.settings.graphHome, rend: S.settings.graphRender};
S.settings.graphSnap = false; S.settings.graphHome = false; S.settings.graphRender = "canvas";

const обл = S.areas[0] && S.areas[0].id;
if (!обл) { t.push({имя: "есть область для проверки", ок: false, факт: "в демо нет ни одной области"}); return t; }
const A = addItem({kind: "note", title: "привязка-нода", area: обл});
A.x = 37; A.y = -23; recomputeHierarchy(); persist();
view = "notes"; notesMode = "graph"; render(); await ж(300);
if (!graph) { t.push({имя: "граф создан", ок: false, факт: "графа нет"}); return t; }

graph.toggleSnap();
t.push({имя: "магнит включает и «Держать раскладку»", ок: S.settings.graphSnap === true && S.settings.graphHome === true,
        факт: "graphSnap=" + S.settings.graphSnap + ", graphHome=" + S.settings.graphHome});

// решётка фона «Сетка» — та же формула, что в _drawMain: уровни ×5 от 20, яркость (T-8)/28
const шагОжид = (z, r, near) => {
  let s = 20 * Math.pow(5, Math.ceil(Math.log(8 / (20 * z)) / Math.log(5)));
  s = Math.round(s * 1e6) / 1e6;
  while ((s * z - 8) / 28 < 1 - 1e-9 || (near && s < r * 3 - 1e-9)) s *= 5;
  return s;
};
// холст берём у ТЕКУЩЕГО графа: render() пересоздаёт экземпляр, и старый svg событий уже не слушает
const экр = (wx, wy) => { const rc = graph.svg.getBoundingClientRect();
  return {x: rc.left + (wx * graph.zoom + graph.tx) / graph.W * rc.width, y: rc.top + (wy * graph.zoom + graph.ty) / graph.H * rc.height}; };
// протяжка: нажать на ноде, два движения (первое — за порог), отпустить; ctrl2 — Ctrl на втором движении
const тянуть = (n, wx, wy, ctrl2, shift) => {
  const svg = graph.svg, p = экр(n.x, n.y), q = экр(wx, wy), mid = {x: (p.x + q.x) / 2 + 9, y: (p.y + q.y) / 2 + 9};
  svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, shiftKey: !!shift, bubbles: true, cancelable: true}));
  // Shift держится ВСЮ протяжку: режим «одна нода / с кустом» следует за ним на каждом движении (_soloShift)
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: mid.x, clientY: mid.y, shiftKey: !!shift, bubbles: true, cancelable: true}));
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: q.x, clientY: q.y, ctrlKey: !!ctrl2, shiftKey: !!shift, bubbles: true, cancelable: true}));
  svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: q.x, clientY: q.y, ctrlKey: !!ctrl2, shiftKey: !!shift, bubbles: true, cancelable: true}));
};
/* Перед жестом раскладке дают успокоиться: дом считается от ЖИВОГО владельца (_homeFromDrag), и
   бросок, пока хаб ещё едет к своему месту, честно уводит ноду на снос хаба — так у человека не
   бывает, хаб под рукой стоит. */
const навести = (n, z) => { graph.alpha = 1; for (let i = 0; i < 300; i++) graph._tick(true);
  graph.zoom = z; graph.tx = graph.W / 2 - n.x * z; graph.ty = graph.H / 2 - n.y * z; graph.alpha = 0; graph._tick(true); };

for (const mode of ["always", "near"]) {
  S.settings.graphSnapMode = mode;
  for (const z of [0.5, 1, 3]) {
    const n = graph.byId[A.id]; навести(n, z);
    const s = шагОжид(z, n.r, mode === "near");
    // цель — узел решётки в паре клеток от ноды, бросок — в 4 экранных px от него
    const gx = (Math.round(n.x / s) + 2) * s, gy = (Math.round(n.y / s) + 1) * s;
    тянуть(n, gx + 4 / z, gy - 3 / z);
    const на = Math.abs(A.x - gx) < 1e-6 && Math.abs(A.y - gy) < 1e-6;
    // мимо нарисованной линии: линию _drawMain кладёт в floor(экран)+0.5 — центр пикселя, где лежит узел
    const sx = A.x * z + graph.tx, sy = A.y * z + graph.ty;
    const мимо = Math.max(Math.abs(Math.floor(sx) + 0.5 - sx), Math.abs(Math.floor(sy) + 0.5 - sy));
    t.push({имя: mode + ", зум " + z + ": нода на узле яркого уровня сетки", ок: на && мимо <= 0.5,
            факт: "шаг " + s + " мира (" + Math.round(s * z) + " px), нода " + A.x + "," + A.y + " при узле " + gx + "," + gy + ", мимо линии " + мимо.toFixed(2) + " px"});
  }
}

// «только рядом»: брошенная в середину клетки нода свободна
{
  S.settings.graphSnapMode = "near";
  const n = graph.byId[A.id]; навести(n, 1);
  const s = шагОжид(1, n.r, true), cx = (Math.round(n.x / s) + 1.5) * s, cy = (Math.round(n.y / s) + 0.5) * s;
  тянуть(n, cx, cy);
  t.push({имя: "«только рядом»: в середине клетки нода не привязывается", ок: Math.abs(A.x - cx) < 1.5 && Math.abs(A.y - cy) < 1.5,
          факт: "брошена в " + cx + "," + cy + ", стоит в " + A.x + "," + A.y});
  t.push({имя: "«только рядом»: шаг не мельче ноды", ок: s >= n.r * 3,
          факт: "шаг " + s + " при диаметре ноды " + Math.round(n.r * 2)});
}

// Ctrl посреди жеста — наоборот: привязка включена, а нода встаёт мимо узла
{
  S.settings.graphSnapMode = "always";
  const n = graph.byId[A.id]; навести(n, 1);
  const s = шагОжид(1, n.r, false), gx = (Math.round(n.x / s) + 2) * s + 7, gy = Math.round(n.y / s) * s + 5;
  тянуть(n, gx, gy, true);
  t.push({имя: "Ctrl во время протяжки снимает привязку", ок: Math.abs(A.x - gx) < 1.5 && Math.abs(A.y - gy) < 1.5,
          факт: "брошена в " + gx + "," + gy + ", стоит в " + A.x + "," + A.y});
}

/* ДВУХСТУПЕНЧАТЫЙ МАГНИТ: мелкие узлы (следующий мелкий уровень сетки, крупный/5) тянут только
   вплотную — 8 px; в радиусе крупного побеждает крупный; мелкие точки лежат на нарисованных линиях. */
{
  const бросок = (mode, z, dxW, dyW) => {
    S.settings.graphSnapMode = mode; навести(graph.byId[A.id], z);
    const nn = graph.byId[A.id], s = шагОжид(z, nn.r, mode === "near");
    const gx = (Math.round(nn.x / s) + 2) * s, gy = (Math.round(nn.y / s) + 1) * s;
    тянуть(nn, gx + dxW, gy + dyW);
    const sx = A.x * z + graph.tx, sy = A.y * z + graph.ty;
    return {s, ф: s / 5, gx, gy, x: A.x, y: A.y, мимо: Math.max(Math.abs(Math.floor(sx) + 0.5 - sx), Math.abs(Math.floor(sy) + 0.5 - sy))};
  };
  const на = (r, x, y) => Math.abs(r.x - x) < 1e-6 && Math.abs(r.y - y) < 1e-6;
  let r = бросок("near", 1, 40 + 2, 20 - 1);
  t.push({имя: "мелкая ступень: вплотную к мелкому узлу нода встаёт на него", ок: r.ф * 1 >= 8 && на(r, r.gx + 40, r.gy + 20) && r.мимо <= 0.5,
          факт: "крупный " + r.s + ", мелкий " + r.ф + "; нода " + r.x + "," + r.y + " при узле " + (r.gx + 40) + "," + (r.gy + 20) + ", мимо линии " + r.мимо.toFixed(2)});
  r = бросок("near", 1, 40 + 7, 20 + 3);   // 7.6 px от мелкого узла — уже в радиусе 8
  t.push({имя: "мелкая ступень: в 7.6 px нода ещё ловится (радиус 8)", ок: на(r, r.gx + 40, r.gy + 20),
          факт: "нода " + r.x + "," + r.y + " при узле " + (r.gx + 40) + "," + (r.gy + 20)});
  r = бросок("near", 1, 40 + 8, 20 + 5);   // 9.4 px — за радиусом
  t.push({имя: "мелкая ступень: дальше 8 px — нода свободна («только рядом»)", ок: Math.abs(r.x - (r.gx + 48)) < 1.5 && Math.abs(r.y - (r.gy + 25)) < 1.5,
          факт: "брошена в " + (r.gx + 48) + "," + (r.gy + 25) + ", стоит в " + r.x + "," + r.y});
  r = бросок("always", 3, 3, 0);
  t.push({имя: "в радиусе крупного узла побеждает крупный", ок: на(r, r.gx, r.gy),
          факт: "крупный " + r.s + " (мелкий " + r.ф + " в 1 мире от броска), нода " + r.x + "," + r.y + " при крупном " + r.gx + "," + r.gy});
  r = бросок("always", 3, 8.3, 0);
  t.push({имя: "«всегда»: мелкая ступень тоже работает", ок: на(r, r.gx + 8, r.gy),
          факт: "нода " + r.x + "," + r.y + " при мелком узле " + (r.gx + 8) + "," + r.gy});
  r = бросок("always", 1, 30, 0);
  t.push({имя: "«всегда»: вне обеих радиусов — ближайший крупный", ок: на(r, r.gx, r.gy),
          факт: "нода " + r.x + "," + r.y + " при крупном " + r.gx + "," + r.gy});
}

// брошенная на точку нода не уплывает: у неё дом, физика её с точки не уводит
{
  const n = graph.byId[A.id]; навести(n, 1);
  const s = шагОжид(1, n.r, false), gx = (Math.round(n.x / s) - 2) * s, gy = (Math.round(n.y / s) + 2) * s;
  тянуть(n, gx + 3, gy + 3);
  const до = {x: A.x, y: A.y};
  graph.alpha = 1; for (let i = 0; i < 400; i++) graph._tick(true);
  const у = graph.byId[A.id];
  t.push({имя: "физика не уводит привязанную ноду с точки", ок: Math.hypot(у.x - gx, у.y - gy) <= 0.5,
          факт: "узел " + gx + "," + gy + " (в данных " + до.x + "," + до.y + "), через 400 кадров " + у.x.toFixed(2) + "," + у.y.toFixed(2)});
  // откат жеста — шаг раскладки (undoPushLayout), нода возвращается с точки
  const ок = undoStep();
  t.push({имя: "Ctrl+Z возвращает ноду с точки", ок: ок && (A.x !== gx || A.y !== gy),
          факт: "после отката " + A.x + "," + A.y});
}

/* ВЫКЛ/ВКЛ «Держать раскладку» возвращает привязанные ноды ТОЧНО на узлы (КРОЛИК, 04.11.2026:
   «включил и выключил режим дом, и они не вернулись на своё точное место»). Причин было две:
   свободная физика уносила хаб области, а включение принимало его новое место за дом (теперь у
   хаба свой якорь hx/hy), и пружина дома засыпала с недоездом ~1 px (теперь _homeSettle).
   Ребёнок — вторая нода, его дом считается от первой: так видна и цепочка, а не один хаб. */
const B = addItem({kind: "note", title: "привязка-ребёнок"});
B.x = A.x + 160; B.y = A.y + 40;   // без координат нода родится в лотке, и на холсте её не будет
addLink(A.id, B.id); recomputeHierarchy(); persist(); render(); await ж(200);
{
  const уснуть = () => { graph.alpha = 1; let i = 0; for (; i < 4000 && graph.alpha > 0; i++) graph._tick(true); return i; };
  S.settings.graphSnapMode = "always";
  /* Как в полном прогоне после «дом.js»: якорь хабу пишет ВЫКЛЮЧЕНИЕ дома, пока хаб стоит с
     дробным остатком. Якорь обязан выйти целым — иначе весь куст встаёт на тысячные мимо узлов
     (было: 2199.9994 вместо 2200). */
  { const ар = areaById(обл), хаб = graph.byId["hub_" + обл];
    delete ар.hx; delete ар.hy; if (хаб) { хаб.x += 0.37; хаб.y -= 0.41; }
    graph.toggleHome(); const цел = Number.isInteger(ар.hx) && Number.isInteger(ар.hy);
    graph.toggleHome(); уснуть();
    t.push({имя: "якорь хаба при выключении дома — целый", ок: цел, факт: "якорь " + ар.hx + "," + ар.hy}); }
  const nA = graph.byId[A.id]; навести(nA, 1);
  const s = шагОжид(1, nA.r, false), ax = Math.round(nA.x / s) * s, ay = Math.round(nA.y / s) * s;
  тянуть(graph.byId[A.id], ax + 3, ay - 2);
  тянуть(graph.byId[B.id], ax + 2 * s - 2, ay + 3);
  уснуть();
  const до = [A.x, A.y, B.x, B.y].join(",");
  t.push({имя: "после броска и сна физики ноды ровно на узлах", ок: A.x === ax && A.y === ay && B.x === ax + 2 * s && B.y === ay,
          факт: до + ", ждём " + [ax, ay, ax + 2 * s, ay].join(",")});
  graph.toggleHome(); const к1 = уснуть();
  const нA = graph.byId[A.id], сдвиг = Math.round(Math.hypot(нA.x - ax, нA.y - ay));
  graph.toggleHome(); const к2 = уснуть();
  const уA = graph.byId[A.id], уB = graph.byId[B.id];
  const ок = уA.x === ax && уA.y === ay && уB.x === ax + 2 * s && уB.y === ay;
  t.push({имя: "выкл/вкл дома: привязанные ноды встают ровно на свои узлы", ок,
          факт: "до " + до + "; без дома уехала на " + сдвиг + " px (" + к1 + " кадров); после " +
                [уA.x, уA.y, уB.x, уB.y].map(v => +v.toFixed(3)).join(",") + " (" + к2 + " кадров), ждём " + [ax, ay, ax + 2 * s, ay].join(",")});
  t.push({имя: "связь осталась строго горизонтальной", ок: Math.abs(уB.y - уA.y) < 1e-9,
          факт: "разница по вертикали " + (уB.y - уA.y).toFixed(4)});
}

/* С ПРИВЯЗКОЙ SHIFT НАОБОРОТ (КРОЛИК, 04.11.2026): обычная протяжка двигает одну ноду, куст стоит;
   Shift+протяжка тянет куст за собой; Shift-клик — по-прежнему выделение. B — ребёнок A. */
{
  const уснуть = () => { graph.alpha = 1; for (let i = 0; i < 4000 && graph.alpha > 0; i++) graph._tick(true); };
  S.settings.graphSnapMode = "always";
  const nA = graph.byId[A.id]; навести(nA, 1);
  const s = шагОжид(1, nA.r, false);
  // обычная протяжка: ребёнок остаётся на месте
  уснуть(); let b0 = {x: graph.byId[B.id].x, y: graph.byId[B.id].y};
  // вниз, а не вправо: справа через две клетки стоит сам ребёнок, и нода легла бы ровно на него
  let a = graph.byId[A.id]; тянуть(a, Math.round(a.x / s) * s, Math.round(a.y / s) * s + 2 * s); уснуть();
  let b1 = graph.byId[B.id], сдв = Math.hypot(b1.x - b0.x, b1.y - b0.y);
  t.push({имя: "с привязкой обычная протяжка двигает одну ноду, куст стоит", ок: сдв < 2,
          факт: "ребёнок сдвинулся на " + сдв.toFixed(2) + " px"});
  // Shift+протяжка: ребёнок едет следом
  b0 = {x: b1.x, y: b1.y}; a = graph.byId[A.id];
  const ax0 = a.x;
  тянуть(a, Math.round(a.x / s) * s - 2 * s, Math.round(a.y / s) * s, false, true); уснуть();
  b1 = graph.byId[B.id]; сдв = Math.hypot(b1.x - b0.x, b1.y - b0.y);
  const шагA = graph.byId[A.id].x - ax0;
  t.push({имя: "с привязкой Shift+протяжка тянет куст за собой", ок: Math.abs(шагA) > s && сдв > s * 0.8,
          факт: "нода сдвинулась на " + Math.round(шагA) + ", ребёнок на " + Math.round(сдв) + " px"});
  // Shift-клик без протяжки — в выделение
  graph.selNodes.clear(); graph._paintSel();
  { const svg = graph.svg, p = экр(graph.byId[B.id].x, graph.byId[B.id].y);
    svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, shiftKey: true, bubbles: true, cancelable: true}));
    svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: p.x, clientY: p.y, shiftKey: true, bubbles: true, cancelable: true})); }
  t.push({имя: "с привязкой Shift-клик добавляет ноду в выделение", ок: graph.selNodes.has(B.id),
          факт: "в выделении: " + [...graph.selNodes].map(id => id === B.id ? "B" : id === A.id ? "A" : id).join(",") +
                "; B в " + Math.round(graph.byId[B.id].x) + "," + Math.round(graph.byId[B.id].y) + ", A в " + Math.round(graph.byId[A.id].x) + "," + Math.round(graph.byId[A.id].y)});
  graph.selNodes.clear(); graph._paintSel();

  /* SHIFT ПО ХОДУ ЖЕСТА (КРОЛИК: «взял ноду, нажал Shift — остальные всё равно тянутся» и «отпустил
     Shift — ноды остались там, куда успели приехать»). В обоих режимах привязки: сперва куст едет
     за нодой, потом режим «одна нода» — куст ВОЗВРАЩАЕТСЯ на места начала жеста, и после броска
     ребёнок стоит там с точностью до пикселя; откат одним шагом возвращает и ноду. */
  for (const снап of [false, true]) {
    S.settings.graphSnap = снап;
    уснуть();
    const svg = graph.svg; a = graph.byId[A.id];
    const p = экр(a.x, a.y), aНач = {x: A.x, y: A.y}, bНач = {x: graph.byId[B.id].x, y: graph.byId[B.id].y};
    const ход = (dx, shift) => svg.dispatchEvent(new PointerEvent("pointermove",
      {buttons: 1, clientX: p.x + dx, clientY: p.y + 7, shiftKey: shift, bubbles: true, cancelable: true}));
    const кл = (тип) => window.dispatchEvent(new KeyboardEvent(тип, {key: "Shift", shiftKey: тип === "keydown"}));
    // «куст» без привязки — без Shift, с привязкой — с Shift; «одна нода» — наоборот
    const кустShift = снап;
    if (кустShift) кл("keydown");
    svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, shiftKey: кустShift, bubbles: true, cancelable: true}));
    ход(30, кустShift); ход(90, кустShift); for (let i = 0; i < 150; i++) graph._tick(true);
    const соло0 = graph._solo, уехал = Math.hypot(graph.byId[B.id].x - bНач.x, graph.byId[B.id].y - bНач.y);
    кл(кустShift ? "keyup" : "keydown");                                   // → «одна нода»
    const соло1 = graph._solo;
    ход(170, !кустShift); for (let i = 0; i < 150; i++) graph._tick(true);
    const вернулся = Math.hypot(graph.byId[B.id].x - bНач.x, graph.byId[B.id].y - bНач.y);
    svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: p.x + 170, clientY: p.y + 7, shiftKey: !кустShift, bubbles: true, cancelable: true}));
    if (!кустShift) кл("keyup");
    уснуть();
    const стоит = Math.hypot(graph.byId[B.id].x - bНач.x, graph.byId[B.id].y - bНач.y), aУшла = Math.hypot(A.x - aНач.x, A.y - aНач.y);
    const м = снап ? "с привязкой" : "без привязки";
    t.push({имя: м + ": Shift посреди протяжки переключает режим", ок: соло0 === false && соло1 === true,
            факт: "куст: _solo=" + соло0 + ", одна нода: _solo=" + соло1});
    t.push({имя: м + ": в «одной ноде» куст возвращается на исходные места", ок: уехал > 20 && вернулся < 1,
            факт: "ребёнок уезжал на " + Math.round(уехал) + " px, вернулся до " + вернулся.toFixed(2) + " px"});
    t.push({имя: м + ": после броска ребёнок на исходном месте до пикселя, нода ушла", ок: стоит < 1 && aУшла >= 80,
            факт: "ребёнок от исходного " + стоит.toFixed(2) + " px, нода ушла на " + Math.round(aУшла) + " px"});
    const ок = undoStep();
    t.push({имя: м + ": откат одним шагом возвращает ноду", ок: ок && Math.hypot(A.x - aНач.x, A.y - aНач.y) < 1,
            факт: "нода после отката в " + Math.round(Math.hypot(A.x - aНач.x, A.y - aНач.y)) + " px от исходного"});
  }
  S.settings.graphSnap = false;
  /* Обратный случай (КРОЛИК: «нажал Shift, взял ноду, отпустил Shift — дочерние не едут»): взял с
     Shift (одна нода), посреди жеста отпустил — дальше ребёнок обязан ехать следом. */
  уснуть();
  { const svg = graph.svg; a = graph.byId[A.id];
    const p = экр(a.x, a.y), ход = (dx, shift) => svg.dispatchEvent(new PointerEvent("pointermove",
      {buttons: 1, clientX: p.x + dx, clientY: p.y, shiftKey: shift, bubbles: true, cancelable: true}));
    window.dispatchEvent(new KeyboardEvent("keydown", {key: "Shift", shiftKey: true}));
    svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, shiftKey: true, bubbles: true, cancelable: true}));
    ход(40, true); for (let i = 0; i < 60; i++) graph._tick(true);
    const соло0 = graph._solo, b0 = {x: graph.byId[B.id].x, y: graph.byId[B.id].y};
    window.dispatchEvent(new KeyboardEvent("keyup", {key: "Shift"}));   // мышь стоит — режим обязан смениться и так
    const соло1 = graph._solo;
    ход(200, false); for (let i = 0; i < 300; i++) graph._tick(true);
    const b1 = graph.byId[B.id], поехал = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: p.x + 200, clientY: p.y, bubbles: true, cancelable: true}));
    t.push({имя: "взял с Shift, отпустил Shift посреди жеста — дети едут следом", ок: соло0 === true && соло1 === false && поехал > 60,
            факт: "с Shift " + соло0 + ", отпустил " + соло1 + "; ребёнок проехал " + Math.round(поехал) + " px за ноду, ушедшую на 160"});
  }
  S.settings.graphSnap = true;
}

// ================== УБОРКА ==================
deletePack([A.id, B.id]);
S.settings.graphSnap = был.snap; S.settings.graphSnapMode = был.mode; S.settings.graphHome = был.home; S.settings.graphRender = был.rend;
render(); await ж(200);
t.push({имя: "за собой убрано", ок: !S.items.some(i => /^привязка-/.test(i.title || "")),
        факт: "осталось проверочных нод: " + S.items.filter(i => i.title === "привязка-нода").length});
return t;
