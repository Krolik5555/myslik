/* Замер графа на КОПИИ реального файла. Возвращает список строк-замеров.
   Запускается из tools/bench_graph.py внутри дев-режима (демо-данные подменяются копией).

   ДВЕ метрики на каждый режим, и обе нужны:
     tjs   — среднее время НАШЕГО кадра (физика + запись в DOM), мс;
     fps   — сколько кадров граф реально успел отрисовать за окно времени.
   Разница между 1000/tjs и fps — это то, что браузер тратит ВНЕ нашего кода:
   пересчёт стилей, раскладка и заливка SVG. Ради неё замер и делается: если fps
   заметно ниже 1000/tjs, узкое место не в JS, а в отрисовке. */
const РЕЗ = [];
const ж = (мс) => new Promise(r => setTimeout(r, мс));
const ОКНО = (window.__BENCH && window.__BENCH.ms) || 1200;   // сколько держим каждый режим

/* ---- данные: копия живого файла, через тот же санитайзер, что и настоящий старт ---- */
const raw = await (await fetch("bench-data.json", {cache: "no-store"})).json();
S = sanitizeState(Object.assign(defaultState(), raw));
// чем рисовать — задаёт стенд (--render svg|canvas): в файле КРОЛИКА этой настройки нет,
// а сравнивать два рендера надо на одних и тех же данных и в одном окне
if (window.__BENCH && window.__BENCH.render) S.settings.graphRender = window.__BENCH.render;
undoInit();
applySettings();
view = "notes";
render();
await ж(900);

/* ---- служебное ---- */
const снимок = () => graph.nodes.map(n => [n, n.x, n.y, n.vx || 0, n.vy || 0]);
const восстановить = (с) => с.forEach(([n, x, y, vx, vy]) => { n.x = x; n.y = y; n.vx = vx; n.vy = vy; });

// сколько нод и связей попадает в кадр при текущей камере — без этого числа замер не читается
function вКадре(){
  const z = graph.zoom, вид = {x1: -graph.tx / z, y1: -graph.ty / z,
                               x2: (graph.W - graph.tx) / z, y2: (graph.H - graph.ty) / z};
  const н = graph.nodes.filter(n => n.x > вид.x1 && n.x < вид.x2 && n.y > вид.y1 && n.y < вид.y2).length;
  const с = graph.links.filter(l => {
    const a = graph.byId[l.a], b = graph.byId[l.b];
    if (!a || !b) return false;
    return Math.max(a.x, b.x) > вид.x1 && Math.min(a.x, b.x) < вид.x2
        && Math.max(a.y, b.y) > вид.y1 && Math.min(a.y, b.y) < вид.y2;
  }).length;
  return н + "/" + с;
}

/* Кадры считаем ПОДМЕНОЙ _tick, а не своим requestAnimationFrame: свой счётчик мерил бы
   частоту кадров БРАУЗЕРА (она упирается в монитор), а нам нужно, сколько кадров успел
   отрисовать сам граф — с учётом того, что следующий rAF не придёт, пока не нарисован
   предыдущий. Именно так цена SVG попадает в число. */
async function режим(имя, мс, подготовка, перед){
  const с = снимок();
  // Камеру запоминаем и возвращаем: панорама за секунду уводит её на сотни пикселей, и
  // следующий режим мерился бы по пустому месту (первый замер так и вышел — 35 нод в кадре
  // вместо 654). Числа с разной камерой между собой несравнимы.
  const кам = {tx: graph.tx, ty: graph.ty, zoom: graph.zoom};
  const кадр = вКадре();
  graph.alpha = 0; graph.drag = null; graph.panning = null; graph._zoomTo = null;
  if (подготовка) подготовка();
  const ориг = Graph.prototype._tick;
  let n = 0, рис = 0, сум = 0, макс = 0;
  graph._tick = function(f){
    if (перед) перед();
    const a = performance.now();
    ориг.call(this, f);
    const d = performance.now() - a;
    n++; сум += d; if (d > макс) макс = d;
    if (d >= 0.15) рис++;            // всё, что дешевле — ранний выход по троттлингу, не кадр
  };
  graph._wake();
  const t0 = performance.now();
  await ж(мс);
  const прошло = (performance.now() - t0) / 1000;
  delete graph._tick;
  graph.alpha = 0; graph.drag = null; graph.panning = null;
  восстановить(с);
  graph.tx = кам.tx; graph.ty = кам.ty; graph.zoom = кам.zoom;
  const tjs = рис ? сум / рис : 0;
  РЕЗ.push({режим: имя, кадров: n, fps: +(рис / прошло).toFixed(1), tjs: +tjs.toFixed(2),
            макс: +макс.toFixed(1), потолок: tjs ? +(1000 / tjs).toFixed(0) : 0,
            занято: +(сум / прошло / 10).toFixed(1),     // % времени, съеденного нашим JS
            вКадре: кадр});
}

/* КАЧЕСТВО РАСКЛАДКИ. Ускорение физики бессмысленно, если дерево от него сползается в кучу,
   поэтому каждое ускорение отчитывается ещё и этими числами: перекрестья связей, узлы, лежащие
   на чужих линиях, и охват дерева. Считается ОДИН раз (не в кадре), поэтому O(E²) здесь можно. */
function качество(){
  const L = graph.links.filter(l => graph.byId[l.a] && graph.byId[l.b]);
  const пл = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  let крестов = 0;
  for (let i = 0; i < L.length; i++){
    const a = graph.byId[L[i].a], b = graph.byId[L[i].b];
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
    for (let j = i + 1; j < L.length; j++){
      const c = graph.byId[L[j].a], d = graph.byId[L[j].b];
      if (a === c || a === d || b === c || b === d) continue;
      if (x2 < Math.min(c.x, d.x) || x1 > Math.max(c.x, d.x)) continue;
      if (y2 < Math.min(c.y, d.y) || y1 > Math.max(c.y, d.y)) continue;
      if ((пл(c, d, a) > 0) !== (пл(c, d, b) > 0) && (пл(a, b, c) > 0) !== (пл(a, b, d) > 0)) крестов++;
    }
  }
  let наЛиниях = 0;
  const сетка = graph._grid(n => n.x, n => n.y, 200);
  for (const n of graph.nodes){
    let лежит = false;
    for (const l of L){
      const a = graph.byId[l.a], b = graph.byId[l.b];
      if (a === n || b === n) continue;
      const ex = b.x - a.x, ey = b.y - a.y, e2 = ex * ex + ey * ey; if (e2 < 1) continue;
      let t = ((n.x - a.x) * ex + (n.y - a.y) * ey) / e2; if (t < 0) t = 0; else if (t > 1) t = 1;
      const dx = n.x - (a.x + ex * t), dy = n.y - (a.y + ey * t);
      if (dx * dx + dy * dy < (n.r + 13) * (n.r + 13)){ лежит = true; break; }
    }
    if (лежит) наЛиниях++;
  }
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  graph.nodes.forEach(n => { x1 = Math.min(x1, n.x); y1 = Math.min(y1, n.y);
                             x2 = Math.max(x2, n.x); y2 = Math.max(y2, n.y); });
  return {крестов, наЛиниях, охват: Math.round(x2 - x1) + "×" + Math.round(y2 - y1), сетка: сетка.m.size};
}

/* ---- прогон по одному графу в двух камерах ---- */
async function поГрафу(гр){
  if (S.settings.graph !== гр.id){ graphSwitch(гр.id); render(); await ж(900); }
  const метка = гр.name + " (" + graph.nodes.length + " нод, " + graph.links.length + " связей)";

  for (const кам of ["всё дерево", "вблизи"]){
    if (кам === "всё дерево"){ graph._fitView(); }
    else {
      // «работа вблизи»: масштаб 1:1 по центру масс — так человек правит ветку
      let sx = 0, sy = 0;
      graph.nodes.forEach(n => { sx += n.x; sy += n.y; });
      const cx = sx / graph.nodes.length, cy = sy / graph.nodes.length;
      graph.zoom = 1; graph.tx = graph.W / 2 - cx; graph.ty = graph.H / 2 - cy;
    }
    graph._tick(true);
    await ж(120);
    const п = метка + " · " + кам + " · ";

    await режим(п + "покой", ОКНО, null, null);
    // Панорама ВОДИТ КАМЕРУ ВОКРУГ исходной точки, а не уносит её прочь: за секунду прямого
    // хода граф уезжает из кадра, и замерялась бы пустота, а не отрисовка.
    let шаг = 0;
    await режим(п + "панорама", ОКНО, () => { graph.panning = {x: 0, y: 0}; шаг = 0; },
                () => { шаг++; graph.tx += Math.cos(шаг / 14) * 7; graph.ty += Math.sin(шаг / 14) * 5;
                        graph.panning = {x: 0, y: 0}; });
    await режим(п + "живая раскладка", ОКНО, () => { graph.alpha = 1; },
                () => { graph.alpha = 1; });
    // нода в руке: берём самый населённый узел — его и таскают, и он тянет за собой ветку
    let тяж = graph.nodes[0];
    graph.nodes.forEach(n => { const d = (graph.adj[n.id] ? graph.adj[n.id].size : 0);
                               if (d > (graph.adj[тяж.id] ? graph.adj[тяж.id].size : 0)) тяж = n; });
    let ф = 0;
    await режим(п + "нода в руке", ОКНО,
                () => { graph.drag = тяж; тяж._moved = true; graph._grab = {dx: 0, dy: 0}; graph.alpha = 0.4; },
                () => { ф++; тяж.x += Math.cos(ф / 6) * 4; тяж.y += Math.sin(ф / 6) * 4;
                        graph.drag = тяж; graph.alpha = Math.max(graph.alpha, 0.4); });

    /* КОНТРОЛЬНЫЙ ЗАМЕР: тот же кадр, но браузеру нечего рисовать (visibility:hidden — стили
       и раскладка считаются, заливка нет). Разница с обычным режимом и есть цена отрисовки
       SVG, то есть верхняя граница выигрыша от переезда на canvas. Гоняем только на большом
       дереве: на малом разница тонет в шуме. */
    if (graph.nodes.length > 300){
      await режим(п + "живая раскладка · SVG не рисуется", ОКНО,
                  () => { graph.alpha = 1; graph.svg.style.visibility = "hidden"; },
                  () => { graph.alpha = 1; });
      graph.svg.style.visibility = "";
      await режим(п + "покой · SVG не рисуется", ОКНО,
                  () => { graph.svg.style.visibility = "hidden"; }, null);
      graph.svg.style.visibility = "";
      graph._tick(true);
    }
  }
}

for (const гр of S.graphs) await поГрафу(гр);

/* КАЧЕСТВО — на большом графе, после того как физика САМА уложит дерево из тех координат,
   что лежат в файле. Иначе сравнивать нечего: качество раскладки видно не в статике, а в том,
   во что физика приводит граф за время остывания. */
{
  const бол = S.graphs.find(g => (g.items || []).length > 300) || S.graphs[S.graphs.length - 1];
  if (S.settings.graph !== бол.id){ graphSwitch(бол.id); render(); await ж(900); }
  const до = качество();
  const с = снимок();
  graph.alpha = 1;
  const t0 = performance.now();
  for (let i = 0; i < 220; i++){ graph.alpha = Math.max(graph.alpha, 0.05); graph._tick(true); }
  const секунд = ((performance.now() - t0) / 1000).toFixed(1);
  const после = качество();
  восстановить(с); graph.alpha = 0;
  РЕЗ.push({режим: "__качество", кадров: 220, fps: 0, tjs: 0, макс: 0, потолок: 0, занято: 0,
            вКадре: "220 кадров раскладки за " + секунд + " с | перекрестий " + до.крестов + " → " + после.крестов
                  + ", узлов на чужих линиях " + до.наЛиниях + " → " + после.наЛиниях
                  + ", охват " + до.охват + " → " + после.охват});
}

/* ---- окружение: без него числа не воспроизводятся ---- */
// Потолок кадров: сколько их вообще отдаёт браузер на этом мониторе. Без него непонятно,
// упёрся ли режим в отрисовку или просто в частоту развёртки.
let потолокFPS = 0;
{
  graph.pause();                     // иначе меряем не потолок, а остаток после самого графа
  let n = 0; const t0 = performance.now();
  await new Promise(r => { const шаг = () => { n++;
    if (performance.now() - t0 < 600) requestAnimationFrame(шаг); else r(); }; requestAnimationFrame(шаг); });
  потолокFPS = Math.round(n / ((performance.now() - t0) / 1000));
  graph.resume();
}
РЕЗ.push({режим: "__окружение", кадров: 0, fps: потолокFPS, tjs: 0, макс: 0, потолок: 0, занято: 0,
          вКадре: "потолок кадров " + потолокFPS + "/с, окно " + innerWidth + "×" + innerHeight + ", холст графа "
                  + graph.W + "×" + graph.H + ", dpr " + devicePixelRatio
                  + ", панель " + (S.settings.asideOn ? S.settings.asideW + " px" : "скрыта")
                  + ", тема " + S.settings.theme});
return РЕЗ;
