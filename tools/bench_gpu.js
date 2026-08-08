/* Стенд НАГРУЗКИ НА МАШИНУ (не времени JS). Запускается из tools/bench_gpu.py в дев-режиме,
   данные — копия живого файла (bench-data.json), граф берётся самый большой.

   Слои ГЛУШАТСЯ подменой методов, а не прячутся display:none: скрытый холст всё равно рисуется,
   display убирает только композицию — замер получался бы бессмысленным. */
const ж = (мс) => new Promise(r => setTimeout(r, мс));

const raw = await (await fetch("bench-data.json", {cache: "no-store"})).json();
S = sanitizeState(Object.assign(defaultState(), raw));
undoInit();
applySettings();
view = "notes";
render();
await ж(900);

const бол = S.graphs.slice().sort((a, b) => (b.items || []).length - (a.items || []).length)[0];
if (S.settings.graph !== бол.id) { graphSwitch(бол.id); render(); await ж(1200); }
graph._fitView();
await ж(400);

const gb = window.__gb = {};
gb._м = {кадров: 0, мс: 0, макс: 0};
gb._cap = 0;

/* счётчик кадров + свой потолок частоты (чтобы мерить «а что если» без правки настроек) */
const оригТик = Graph.prototype._tick;
graph._tick = function (f) {
  const now = performance.now();
  if (gb._cap && !f && now - (gb._lastT || 0) < gb._cap - 1) { this._schedule(); return; }
  gb._lastT = now;
  if (gb._нудж) { gb._нз = !gb._нз; this.tx += gb._нз ? 1 : -1; }   // сдвиг на пиксель = честная полная перерисовка
  оригТик.call(this, f);
  const d = performance.now() - now;
  gb._м.мс += d; gb._м.кадров++; if (d > gb._м.макс) gb._м.макс = d;
};
gb.потолок = function (мс) { gb._cap = мс || 0; };

const ОРИГ = {};
for (const имя of ["_drawGlow", "_drawBg", "_drawBgGL", "_drawMain"]) ОРИГ[имя] = Graph.prototype[имя];
gb.глушь = function (имена) {
  for (const имя in ОРИГ) Graph.prototype[имя] = ОРИГ[имя];
  (имена || []).forEach(имя => { if (ОРИГ[имя]) Graph.prototype[имя] = function () {}; });
};

/* ЗУМ ТУДА-СЮДА: непрерывная прокрутка колеса — щелчок каждые 50 мс, ×1.12 за щелчок (ровно как
   считает svg.onwheel), у пределов направление меняется. Разовая постановка цели не годится:
   камера доезжает за ~30 мс и дальше стоит, и нагрузки в замере не видно. */
gb.зум = function (вкл) {
  if (gb._t) { clearInterval(gb._t); gb._t = null; }
  if (!вкл) { graph._zoomTo = null; return; }
  let напр = 1;
  gb._t = setInterval(() => {
    const от = (graph._zoomTo != null) ? graph._zoomTo : graph.zoom;
    let ц = от * Math.exp(напр * 100 * 0.00113);
    if (ц > 1.8) { напр = -1; ц = 1.8; }
    if (ц < 0.16) { напр = 1; ц = 0.16; }
    graph._zoomTo = Math.max(0.12, Math.min(2.5, ц));
    graph._zoomAt = {x: graph.W / 2, y: graph.H / 2};
    graph._wake();
  }, 50);
};

gb.пан = function (вкл) {
  if (gb._p) { clearInterval(gb._p); gb._p = null; }
  if (!вкл) return;
  let a = 0;
  gb._p = setInterval(() => { a += 0.25;
    graph.tx += Math.cos(a) * 26; graph.ty += Math.sin(a) * 26; graph._applyTransform(); }, 33);
};

gb.нудж = function (вкл) {
  gb._нудж = !!вкл;
  if (вкл) { const шаг = () => { if (gb._нудж) { graph._wake(); requestAnimationFrame(шаг); } }; шаг(); }
};

/* Отключалки отдельных статей — на прототипе холста, чтобы не трогать graph.js.
   Присвоение strokeStyle не-градиента браузер молча игнорирует, и связь просто рисуется прежним
   цветом: ровно то, что нужно для «сколько стоят градиенты». */
const К = CanvasRenderingContext2D.prototype;
const ОРИГК = {createLinearGradient: К.createLinearGradient, fillText: К.fillText};
gb.без = function (что) {
  К.createLinearGradient = ОРИГК.createLinearGradient;
  К.fillText = ОРИГК.fillText;
  (что || []).forEach(имя => {
    if (имя === "градиенты") К.createLinearGradient = function () { return {addColorStop: function () {}}; };
    if (имя === "подписи") К.fillText = function () {};
  });
};
/* «минимум»: холст тот же и грязнится каждый кадр, но рисуется одна полоска. Разница с полным
   кадром — цена нашего рисования, разница с «главный заглушен» — цена самого факта грязного слоя. */
gb.минимум = function (вкл) {
  if (!вкл) { Graph.prototype._drawMain = ОРИГ._drawMain; return; }
  Graph.prototype._drawMain = function () {
    const ctx = this.mainCtx; if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.mainCanvas.width, this.mainCanvas.height);
    ctx.fillStyle = "#345"; ctx.fillRect(10, 10, 200, 40);
  };
};
/* Что дороже — связи или узлы: на время замера убираем один из списков (физика уже остыла). */
gb._спис = null;
gb.пусто = function (что) {
  if (!gb._спис) gb._спис = {links: graph.links, nodes: graph.nodes};
  graph.links = gb._спис.links; graph.nodes = gb._спис.nodes;
  if (что === "связи") graph.links = [];
  if (что === "узлы") graph.nodes = [];
  return graph.links.length + "/" + graph.nodes.length;
};

gb.стоп = function () { gb.зум(false); gb.пан(false); gb.нудж(false); gb.глушь([]);
                        gb.потолок(0); gb.без([]); gb.минимум(false);
                        if (gb._спис) gb.пусто(null); };

gb.метрика = function () {
  const m = gb._м; gb._м = {кадров: 0, мс: 0, макс: 0};
  m.зум = +graph.zoom.toFixed(3);
  return JSON.stringify(m);
};

/* ЦЕНА ОДНОГО ВЫЗОВА ОТРИСОВКИ: тугой цикл и СИНХРОНИЗАЦИЯ с видеокартой в конце (чтение пикселя
   или gl.finish) — иначе замерили бы только запись команд в очередь, а не саму отрисовку. */
gb.микро = function (имя, мс) {
  const f = ОРИГ[имя]; if (!f) return JSON.stringify({метод: имя, нет: true});
  const t0 = performance.now(); let n = 0;
  while (performance.now() - t0 < (мс || 1200)) { f.call(graph); n++; }
  try {
    if (имя === "_drawMain" && graph.mainCtx) graph.mainCtx.getImageData(0, 0, 1, 1);
    else if (имя === "_drawGlow" && graph.glowCtx) graph.glowCtx.getImageData(0, 0, 1, 1);
    else if (graph.bgGL && graph.bgGL.gl) graph.bgGL.gl.finish();
  } catch (e) {}
  const dt = performance.now() - t0;
  return JSON.stringify({метод: имя, вызовов: n, мс: +(dt / n).toFixed(3),
                         вСек: Math.round(n / (dt / 1000)), зум: +graph.zoom.toFixed(2)});
};
gb.зумНа = function (z) { graph._zoomTo = null; graph.zoom = z; graph._applyTransform(); return graph.zoom; };

/* частота обновления экрана: сколько кадров браузер выдаёт за 500 мс */
gb.герц = function () {
  return new Promise(res => {
    let n = 0; const t0 = performance.now();
    const шаг = () => { n++; if (performance.now() - t0 < 500) requestAnimationFrame(шаг);
                        else res(Math.round(n / ((performance.now() - t0) / 1000))); };
    requestAnimationFrame(шаг);
  });
};

gb.состояние = function () {
  const рз = (s) => { const e = document.querySelector(s); return e ? (e.width + "x" + e.height) : "нет"; };
  return JSON.stringify({узлов: graph.nodes.length, связей: graph.links.length,
                         W: graph.W, H: graph.H, окно: innerWidth + "x" + innerHeight,
                         экран: screen.width + "x" + screen.height,
                         dpr: window.devicePixelRatio, режим: S.settings.graphRender || "?",
                         потолок: S.settings.graphFpsCap,
                         холсты: {главный: рз(".graph-main-canvas"), свечение: рз(".graph-glow-canvas"),
                                  фон: рз(".graph-bg-canvas")}});
};
gb.ready = true;
return gb.состояние();
