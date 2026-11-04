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
const svg = graph.svg;
const экр = (wx, wy) => { const rc = svg.getBoundingClientRect();
  return {x: rc.left + (wx * graph.zoom + graph.tx) / graph.W * rc.width, y: rc.top + (wy * graph.zoom + graph.ty) / graph.H * rc.height}; };
// протяжка: нажать на ноде, два движения (первое — за порог), отпустить; ctrl2 — Ctrl на втором движении
const тянуть = (n, wx, wy, ctrl2) => {
  const p = экр(n.x, n.y), q = экр(wx, wy), mid = {x: (p.x + q.x) / 2 + 9, y: (p.y + q.y) / 2 + 9};
  svg.dispatchEvent(new PointerEvent("pointerdown", {button: 0, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true}));
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: mid.x, clientY: mid.y, bubbles: true, cancelable: true}));
  svg.dispatchEvent(new PointerEvent("pointermove", {buttons: 1, clientX: q.x, clientY: q.y, ctrlKey: !!ctrl2, bubbles: true, cancelable: true}));
  svg.dispatchEvent(new PointerEvent("pointerup", {button: 0, clientX: q.x, clientY: q.y, ctrlKey: !!ctrl2, bubbles: true, cancelable: true}));
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
    // мимо нарисованной линии: линию _drawMain кладёт в round(экран)+0.5
    const sx = A.x * z + graph.tx, sy = A.y * z + graph.ty;
    const мимо = Math.max(Math.abs(Math.round(sx) + 0.5 - sx), Math.abs(Math.round(sy) + 0.5 - sy));
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

// ================== УБОРКА ==================
deletePack([A.id]);
S.settings.graphSnap = был.snap; S.settings.graphSnapMode = был.mode; S.settings.graphHome = был.home; S.settings.graphRender = был.rend;
render(); await ж(200);
t.push({имя: "за собой убрано", ок: !S.items.some(i => i.title === "привязка-нода"),
        факт: "осталось проверочных нод: " + S.items.filter(i => i.title === "привязка-нода").length});
return t;
