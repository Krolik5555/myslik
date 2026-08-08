/* Разбивка кадра графа по статьям: сколько миллисекунд уходит в каждый вызываемый метод и
   сколько остаётся на код, написанный прямо в _tick (силы, пружины, запись атрибутов).
   Запускается тем же tools/bench_graph.py: --js tools/bench_profile.js */
const РЕЗ = [];
const ж = (мс) => new Promise(r => setTimeout(r, мс));

const raw = await (await fetch("bench-data.json", {cache: "no-store"})).json();
S = sanitizeState(Object.assign(defaultState(), raw));
undoInit(); applySettings();
view = "notes"; render();
await ж(900);

const бол = S.graphs.find(g => (g.items || []).length > 300);
if (S.settings.graph !== бол.id){ graphSwitch(бол.id); render(); await ж(900); }
graph._fitView(); graph._tick(true); await ж(150);

const ЦЕЛИ = ["_grid", "_near", "_recalcBends", "_easeBends", "_drawGlow", "_drawBg",
              "_applyTransform", "_paintSel", "_renderTray", "_syncAside"];
const счёт = {};
const ориг = {};
for (const имя of ЦЕЛИ){
  if (typeof Graph.prototype[имя] !== "function") continue;
  ориг[имя] = Graph.prototype[имя];
  счёт[имя] = {мс: 0, раз: 0};
  Graph.prototype[имя] = function(...a){
    const t = performance.now();
    const r = ориг[имя].apply(this, a);
    счёт[имя].мс += performance.now() - t; счёт[имя].раз++;
    return r;
  };
}
const оригТик = Graph.prototype._tick;
let всего = 0, кадров = 0;
graph._tick = function(f){
  graph.alpha = 1;
  const t = performance.now();
  оригТик.call(this, f);
  всего += performance.now() - t; кадров++;
};

graph.alpha = 1; graph._wake();
await ж(2500);
delete graph._tick;
for (const имя in ориг) Graph.prototype[имя] = ориг[имя];
graph.alpha = 0;

/* КОНТРОЛЬНЫЙ ПРОГОН: тот же кадр, но метод-подозреваемый заменён пустышкой. Время, приписанное
   методу обёрткой, может оказаться не его: браузер откладывает работу с холстом и предъявляет
   счёт первому же вызову, который его дождётся. Разница «весь кадр с методом» минус «весь кадр
   без него» — вот честная цена. */
async function безМетода(имя, мс){
  const был = Graph.prototype[имя];
  Graph.prototype[имя] = function(){};
  let n = 0, сум = 0;
  graph._tick = function(f){ graph.alpha = 1; const t = performance.now(); оригТик.call(this, f);
                             сум += performance.now() - t; n++; };
  graph.alpha = 1; graph._wake();
  await ж(мс);
  delete graph._tick;
  Graph.prototype[имя] = был;
  return {кадр: n ? сум / n : 0, кадров: n};
}
const безСвечения = await безМетода("_drawGlow", 1500);
const безПрогибов = await безМетода("_recalcBends", 1500);
graph.alpha = 0;

const наКадр = (м) => +(м / Math.max(1, кадров)).toFixed(2);
let вложено = 0;
// _grid и _near зовутся ИЗ _recalcBends тоже — их время уже сидит внутри него, поэтому
// в остаток вычитаем только методы верхнего уровня
const ВЕРХ = ["_recalcBends", "_easeBends", "_drawGlow", "_drawBg", "_applyTransform",
              "_paintSel", "_renderTray", "_syncAside"];
for (const имя of ВЕРХ) if (счёт[имя]) вложено += счёт[имя].мс;

for (const имя of ЦЕЛИ){
  if (!счёт[имя] || !счёт[имя].раз) continue;
  РЕЗ.push({режим: имя, кадров: счёт[имя].раз, fps: 0, tjs: наКадр(счёт[имя].мс),
            макс: 0, потолок: 0, занято: +(счёт[имя].мс / всего * 100).toFixed(1),
            вКадре: (ВЕРХ.indexOf(имя) >= 0 ? "верхний уровень" : "внутри _recalcBends")});
}
РЕЗ.push({режим: "ОСТАТОК: силы и запись атрибутов прямо в _tick", кадров: кадров, fps: 0,
          tjs: наКадр(всего - вложено), макс: 0, потолок: 0,
          занято: +((всего - вложено) / всего * 100).toFixed(1),
          вКадре: "узлов " + graph.nodes.length + ", связей " + graph.links.length});
РЕЗ.push({режим: "ВЕСЬ КАДР", кадров: кадров, fps: 0, tjs: наКадр(всего), макс: 0, потолок: 0,
          занято: 100, вКадре: "живая раскладка, обзор всего дерева"});
РЕЗ.push({режим: "контроль: кадр БЕЗ свечения", кадров: безСвечения.кадров, fps: 0,
          tjs: +безСвечения.кадр.toFixed(2), макс: 0, потолок: 0, занято: 0,
          вКадре: "разница с полным кадром = настоящая цена _drawGlow"});
РЕЗ.push({режим: "контроль: кадр БЕЗ прогибов", кадров: безПрогибов.кадров, fps: 0,
          tjs: +безПрогибов.кадр.toFixed(2), макс: 0, потолок: 0, занято: 0,
          вКадре: "разница с полным кадром = настоящая цена _recalcBends"});
return РЕЗ;
