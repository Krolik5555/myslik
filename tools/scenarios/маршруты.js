/* УСТОЙЧИВОСТЬ МАРШРУТОВ «ПРЯМЫХ УГЛОВ» (КРОЛИК, снимки 39–40, 04.11.2026: «на старом дереве любое
   действие — и прямые углы туда-сюда перестраиваются»). Сначала ЗАМЕР: на дереве, доведённом подбором
   до тишины, по отдельности делаем то, что связей не касается, и считаем, сколько связей сменили
   форму. Причины, которые меряем:
     build   — пересборка того же графа (её зовёт почти любая правка);
     render  — пересоздание графа (полный render(): вкладка, панель, подграф);
     дрожь   — ноды сдвинулись на ±1.5 px (физика после правки, дыхание);
     подбор  — повторный заход подбора без всяких изменений.
   И случай из уточнения КРОЛИКА: два соседа поменялись местами — их связи ложатся без пересечений,
   а маршруты нетронутых связей не меняются. */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const был = {mode: S.settings.graphLinkMode, rend: S.settings.graphRender, home: S.settings.graphHome, drift: S.settings.graphDrift};
S.settings.graphRender = "canvas"; S.settings.graphHome = false; S.settings.graphDrift = 0;   // дыхание меряем отдельно — дрожью

const обл = S.areas[0] && S.areas[0].id;
if (!обл) { t.push({имя: "есть область", ок: false, факт: "в демо нет областей"}); return t; }
// дерево как на снимках: SDVG в середине, шоты вокруг на сетке, у каждого шота по три листа
const X0 = 12000, Y0 = -8000, мои = [];
/* область — ТОЛЬКО у корня, остальные наследуют её через родителя, как в живом дереве. Первый замер
   дал область каждой ноде: родителя ни у кого не стало, все связи пошли путём «ручной поперёк веток»
   — без групп и дорожек, и мерилось не то дерево, что у КРОЛИКА */
const нода = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X0 + x; it.y = Y0 + y; мои.push(it.id); return it; };
const R = нода("маршруты-SDVG", 0, 0, true);
const шоты = [[-90, -310], [60, -320], [300, -330], [-90, -140], [60, -145], [300, -180], [600, -130], [680, -40],
              [450, 20], [320, 90], [-170, 90], [-170, -60], [30, 240], [450, 260]];
const листы = [[-60, -80], [50, -70], [90, 10]];
const sh = [];
шоты.forEach(([x, y], i) => { const s = нода("маршруты-SH" + (i + 1) * 10, x, y); addLink(R.id, s.id); sh.push(s);
  листы.forEach(([dx, dy], k) => { const л = нода("маршруты-л" + i + "-" + k, x + dx * (x < 0 ? -1 : 1), y + dy * (y > 0 ? -1 : 1)); addLink(s.id, л.id); }); });
recomputeHierarchy(); persist();
view = "notes"; notesMode = "graph"; render(); await ж(300);
if (!graph) { t.push({имя: "граф создан", ок: false, факт: "графа нет"}); return t; }
graph.alpha = 0;
const ids = new Set(мои);
graphSetLinkMode("ortho");

const свои = () => graph.links.filter(l => ids.has(l.a) && ids.has(l.b));
const снимок = () => { const m = new Map(); for (const l of свои()) if (l._рт) m.set(l.a + "|" + l.b, {сиг: l._рт.сиг, c: Array.from(l._рт.c)}); return m; };
// сменила форму: другое устройство колена или вершина уехала дальше допуска (дрожь сама даёт до 1.5 px)
/* насколько разошлись две ломаные: точки каждой через 3 px — до ближайшего отрезка другой, в обе стороны.
   Сравнение вершин ломалось, когда сторона Г короче 2 px: вершина то сливалась, то нет (замер маршруты) */
const разошлись = (a, b) => { const до = (px, py, c) => { let м = Infinity;
    for (let i = 0; i < c.length - 2; i += 2) { const ex = c[i + 2] - c[i], ey = c[i + 3] - c[i + 1], L2 = (ex * ex + ey * ey) || 1;
      let t = ((px - c[i]) * ex + (py - c[i + 1]) * ey) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t; м = Math.min(м, Math.hypot(px - c[i] - ex * t, py - c[i + 1] - ey * t)); }
    return c.length < 4 ? Math.hypot(px - c[0], py - c[1]) : м; };
  const край = (p, q) => { let м = 0;
    for (let i = 0; i < p.length - 2; i += 2) { const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]), n = Math.max(1, Math.ceil(L / 3));
      for (let k = 0; k <= n; k++) м = Math.max(м, до(p[i] + (p[i + 2] - p[i]) * k / n, p[i + 1] + (p[i + 3] - p[i + 1]) * k / n, q)); }
    return м; };
  return Math.max(край(a, b), край(b, a)); };
const сменили = (до, после, допуск) => { const кто = [];
  до.forEach((v, k) => { const п = после.get(k); if (!п) { кто.push(k); return; }
    const макс = разошлись(v.c, п.c);
    if (п.сиг !== v.сиг || макс > допуск) кто.push(k); });
  return кто; };
const имя = k => k.split("|").map(id => { const n = graph.byId[id]; return n && n.ref ? n.ref.title.replace("маршруты-", "") : "?"; }).join("→");
// что именно сменилось: подпись формы — режим|ось|сторона|дерево|в группе|дорожка|выход|точек|вариант
let ДО = null;
const почему = k => { const a = ДО && ДО.get(k), l = свои().find(x => x.a + "|" + x.b === k), b = l && l._рт;
  return a && b ? " [" + a.сиг.split("|").slice(1).join(",") + " → " + b.сиг.split("|").slice(1).join(",") + "]" : ""; };
const довести = () => { let заходов = 0, смен = 0, бюджет = 0;
  // до тишины — пока есть смены ИЛИ подбор не доделал (упёрся в бюджет): 0 смен при недоделке — не тишина
  for (let k = 0; k < 30; k++) { const n = graph._routeOptimize(); заходов++; смен += n; if ((graph._оптЦена || 0) >= 15) бюджет++;
    if (!n && !graph._оптНедо) break; if (n) graph._routeBuild(); }
  return {заходов, смен, бюджет}; };
const перес = () => { const L = свои(); let n = 0;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const A = L[i], B = L[j]; if (!A._рт || !B._рт) continue;
    const ca = A._рт.c, cb = B._рт.c;
    for (let p = 0; p < ca.length - 2; p += 2) for (let q = 0; q < cb.length - 2; q += 2) {
      const x0 = ca[p], y0 = ca[p + 1], ex = ca[p + 2] - x0, ey = ca[p + 3] - y0, u0 = cb[q], v0 = cb[q + 1], fx = cb[q + 2] - u0, fy = cb[q + 3] - v0;
      const d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
      const s = ((u0 - x0) * fy - (v0 - y0) * fx) / d, u = ((u0 - x0) * ey - (v0 - y0) * ex) / d;
      if (s <= 0 || s >= 1 || u <= 0 || u >= 1) continue;
      const px = x0 + ex * s, py = y0 + ey * s;
      if ([A.a, A.b, B.a, B.b].some(id => { const m = graph.byId[id]; return Math.hypot(m.x - px, m.y - py) < (m.r || 8) + 6; })) continue;
      n++; } }
  return n; };

// ===== исходное «старое дерево»: подбор доведён до тишины =====
graph._маршр = null; graph._routesFresh();
const первый = довести();
const база = снимок();
t.push({имя: "замер: дерево доведено подбором до тишины (справка)", ок: true,
        факт: "связей " + база.size + ", пересечений " + перес() + ", заходов " + первый.заходов + ", смен " + первый.смен + ", заходов в упор бюджета " + первый.бюджет + ", подбор " + (graph._оптЦена || 0).toFixed(1) + " мс"});

// ===== подбор: повторный заход без изменений =====
{ const n = graph._routeOptimize(); if (n) graph._routeBuild();
  const к = сменили(база, снимок(), 0.5);
  t.push({имя: "подбор: повторный заход без изменений формы не меняет", ок: к.length === 0, факт: "сменили " + к.length + (к.length ? ": " + к.slice(0, 8).map(имя).join(", ") : "")}); }

// ===== build того же графа =====
{ const до = снимок(); graph.build(); graph.alpha = 0; graph._routesFresh(); довести();
  const к = сменили(до, снимок(), 0.5);
  t.push({имя: "build: пересборка того же графа формы не меняет", ок: к.length === 0, факт: "сменили " + к.length + (к.length ? ": " + к.slice(0, 8).map(имя).join(", ") : "")}); }

// ===== дрожь нод на ±1.5 px =====
{ const до = снимок(); ДО = до; let i = 0;
  for (const id of мои) { const n = graph.byId[id]; if (!n) continue; i++; n.x += ((i * 7919) % 13) / 13 * 3 - 1.5; n.y += ((i * 104729) % 11) / 11 * 3 - 1.5; }
  graph._маршр.at = -1e9; graph.alpha = 0.01; graph._routesFresh(); graph.alpha = 0; graph._routesFresh(); довести();
  const к = сменили(до, снимок(), 4);
  t.push({имя: "дрожь ±1.5 px: колена на месте (допуск 4 px)", ок: к.length === 0, факт: "сменили " + к.length + (к.length ? ": " + к.slice(0, 8).map(k => имя(k) + почему(k)).join(", ") : "")}); }

// ===== пересоздание графа (полный render) =====
{ const до = снимок(); ДО = до; render(); await ж(300); graph.alpha = 0; graphSetLinkMode("ortho"); graph._маршр = null; graph._routesFresh(); довести();
  const к = сменили(до, снимок(), 4);
  t.push({имя: "render: пересоздание графа формы не меняет", ок: к.length === 0, факт: "сменили " + к.length + (к.length ? ": " + к.slice(0, 8).map(k => имя(k) + почему(k)).join(", ") : "")}); }

// ===== две ноды поменялись местами (уточнение КРОЛИКА) =====
/* грА и грБ меняются местами целиком (у куста листья едут со своим шотом). нольНужен — случай КРОЛИКА
   «у дерева рядом две ноды, поменял местами»: их связи обязаны лечь без пересечений. У обмена целых
   кустов ноль бывает недостижим — лист может оказаться за вертикалью чужой связи, — там это справка. */
const обмен = async (метка, грА, грБ, нольНужен) => {
  const до = снимок(), dx = грБ[0].x - грА[0].x, dy = грБ[0].y - грА[0].y;
  for (const n of грА) { n.x += dx; n.y += dy; } for (const n of грБ) { n.x -= dx; n.y -= dy; }
  // промежуточная форма — сразу после обмена, до подбора: «новый путь» из правила КРОЛИКА — и она тоже
  const родной = graph._routeOptimize; graph._routeOptimize = () => 0;
  graph._маршр.at = -1e9; graph.alpha = 0.01; graph._routesFresh(); graph.alpha = 0;
  const между0 = снимок(); graph._routeOptimize = родной;
  graph._маршр.at = -1e9; graph.alpha = 0.01; graph._routesFresh(); graph.alpha = 0; graph._routesFresh(); довести();
  ДО = до; const после = снимок(), тронутые = new Set([...грА, ...грБ].map(n => n.id));
  const кто = сменили(до, после, 4);
  /* «нетронутые» по уточнению КРОЛИКА: ни один конец не двигался, И путь (до или после) не пересекает
     и не делит линию со старыми или новыми путями обменянных кустов — такие перестраиваться вправе */
  const отр = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i], c[i + 1], c[i + 2], c[i + 3]]); return o; };
  const касаются = (p, q) => { const ex = p[2] - p[0], ey = p[3] - p[1], fx = q[2] - q[0], fy = q[3] - q[1], d = ex * fy - ey * fx;
    if (Math.abs(d) < 1e-9) {
      if (Math.abs(ey) < 0.01 && Math.abs(fy) < 0.01 && Math.abs(p[1] - q[1]) < 4) return Math.min(Math.max(p[0], p[2]), Math.max(q[0], q[2])) - Math.max(Math.min(p[0], p[2]), Math.min(q[0], q[2])) > 10;
      if (Math.abs(ex) < 0.01 && Math.abs(fx) < 0.01 && Math.abs(p[0] - q[0]) < 4) return Math.min(Math.max(p[1], p[3]), Math.max(q[1], q[3])) - Math.max(Math.min(p[1], p[3]), Math.min(q[1], q[3])) > 10;
      return false; }
    const s = ((q[0] - p[0]) * fy - (q[1] - p[1]) * fx) / d, u = ((q[0] - p[0]) * ey - (q[1] - p[1]) * ex) / d; return s > 0 && s < 1 && u > 0 && u < 1; };
  const ихПути = []; до.forEach((v, k) => { const [a, b] = k.split("|"); if (тронутые.has(a) || тронутые.has(b)) ихПути.push(...отр(v.c)); });
  после.forEach((v, k) => { const [a, b] = k.split("|"); if (тронутые.has(a) || тронутые.has(b)) ихПути.push(...отр(v.c)); });
  между0.forEach((v, k) => { const [a, b] = k.split("|"); if (тронутые.has(a) || тронутые.has(b)) ихПути.push(...отр(v.c)); });
  const рядом = k => [до.get(k), после.get(k)].some(v => v && отр(v.c).some(p => ихПути.some(q => касаются(p, q))));
  const чужие = кто.filter(k => { const [a, b] = k.split("|"); return !тронутые.has(a) && !тронутые.has(b) && !рядом(k); });
  // пересечения между связями двух кустов
  const их = свои().filter(l => тронутые.has(l.a) || тронутые.has(l.b));
  let между = 0; const пары = [];
  for (let i = 0; i < их.length; i++) for (let j = i + 1; j < их.length; j++) { const P = их[i], Q = их[j]; if (!P._рт || !Q._рт) continue;
    const ca = P._рт.c, cb = Q._рт.c;
    for (let p = 0; p < ca.length - 2; p += 2) for (let q = 0; q < cb.length - 2; q += 2) {
      const x0 = ca[p], y0 = ca[p + 1], ex = ca[p + 2] - x0, ey = ca[p + 3] - y0, u0 = cb[q], v0 = cb[q + 1], fx = cb[q + 2] - u0, fy = cb[q + 3] - v0;
      const d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
      const s = ((u0 - x0) * fy - (v0 - y0) * fx) / d, u = ((u0 - x0) * ey - (v0 - y0) * ex) / d;
      if (s <= 0 || s >= 1 || u <= 0 || u >= 1) continue;
      const px = x0 + ex * s, py = y0 + ey * s;
      if ([P.a, P.b, Q.a, Q.b].some(id => { const m = graph.byId[id]; return Math.hypot(m.x - px, m.y - py) < (m.r || 8) + 6; })) continue;
      const отн = c => Array.from(c).map((v, i) => Math.round(v - (i % 2 ? Y0 : X0))).join(",");
      между++; пары.push(имя(P.a + "|" + P.b) + " [" + отн(ca) + "] × " + имя(Q.a + "|" + Q.b) + " [" + отн(cb) + "]"); } }
  // для справки — сколько таких пересечений было до обмена (тот же счёт по снимку)
  let было = 0; { const зап = []; до.forEach((v, k) => { const [a, b] = k.split("|"); if (тронутые.has(a) || тронутые.has(b)) зап.push(v.c); });
    for (let i = 0; i < зап.length; i++) for (let j = i + 1; j < зап.length; j++) for (const p of отр(зап[i])) for (const q of отр(зап[j])) {
      const ex = p[2] - p[0], ey = p[3] - p[1], fx = q[2] - q[0], fy = q[3] - q[1], d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
      const s = ((q[0] - p[0]) * fy - (q[1] - p[1]) * fx) / d, u = ((q[0] - p[0]) * ey - (q[1] - p[1]) * ex) / d;
      if (s > 0.02 && s < 0.98 && u > 0.02 && u < 0.98) было++; } }
  const ст = graph._оптСтат || {};
  t.push({имя: метка + ": их связи " + (нольНужен ? "без пересечений" : "— пересечения (справка)"), ок: нольНужен ? между === 0 : true,
          факт: "было " + было + ", стало " + между + (пары.length ? ": " + пары.join("; ") : "") +
                "; последний подбор: задеты " + ст.задеты + ", проходов " + ст.проходов + ", недоделано " + !!ст.недоделано + ", " + (graph._оптЦена || 0).toFixed(1) + " мс"});
  t.push({имя: метка + ": нетронутые связи не перестроились", ок: чужие.length === 0,
          факт: "перестроились чужие " + чужие.length + (чужие.length ? ": " + чужие.slice(0, 8).map(k => имя(k) + почему(k)).join(", ") : "") + " (всего сменили " + кто.length + ")"});
};
{ const куст = s => graph.links.filter(l => l.manual && (l.a === s.id || l.b === s.id)).map(l => l.a === s.id ? l.b : l.a).filter(id => id !== R.id).map(id => graph.byId[id]);
  // два соседних листа одного шота (SH40) — случай КРОЛИКА
  const ш = graph.byId[sh[3].id], лл = куст(ш);
  await обмен("соседние листья поменялись местами", [лл[0]], [лл[1]], true);
  // два соседних куста у SDVG (SH80 и SH90) целиком
  const A = graph.byId[sh[7].id], B = graph.byId[sh[8].id];
  await обмен("соседние кусты поменялись местами", [A, ...куст(A)], [B, ...куст(B)], false); }

// ===== ЭТАЛОН со снимка КРОЛИКА 42: путь без пересечений есть — подбор обязан его найти =====
/* SQ02 и его ветки на тех же местах, что на снимке. Колено к SH030 шло «вверх, вправо» на уровне
   SH020 — резало её связь и ехало по самой ноде с подписью. Путь без пересечений существует:
   например, вертикаль между ветками SH020 и SH040. Подбор знает z, ступеньку и П-обход. */
{
  const X2 = -12000, Y2 = -9000, эт = [];
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X2 + x; it.y = Y2 + y; мои.push(it.id); эт.push(it.id); return it; };
  const SQ = н("маршруты-SQ02", 0, 0, true);
  const к = (title, x, y, род) => { const it = н("маршруты-" + title, x, y); addLink(род.id, it.id); return it; };
  const s20 = к("SH020", 90, -360, SQ), s30 = к("SH030", 272, -360, SQ), s10 = к("SH010", -90, -271, SQ), s40 = к("SH040", 363, -187, SQ), s50 = к("SH050", 363, 0, SQ);
  к("Сб20", 36, -452, s20); к("Рн20", 144, -452, s20);
  к("Рн30", 380, -397, s30); к("Сб30", 380, -325, s30); const s35 = к("SH035", 180, -545, s30); к("Сб35", 180, -633, s35); к("Рн35", 272, -633, s35);
  к("Сб10", -181, -271, s10); к("Рн10", -181, -200, s10); const s11 = к("SH011", -181, -451, s10); к("Сб11", -271, -542, s11); к("Рн11", -181, -542, s11);
  к("Рн40", 470, -250, s40); к("Сб40", 470, -150, s40);
  recomputeHierarchy(); persist(); graph.build(); graph.alpha = 0;
  graph._маршр = null; graph._routesFresh(); довести();
  const этС = new Set(эт), свяЭ = graph.links.filter(l => этС.has(l.a) && этС.has(l.b));
  const цель = свяЭ.find(l => (l.a === SQ.id && l.b === s30.id) || (l.b === SQ.id && l.a === s30.id));
  const отр = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i], c[i + 1], c[i + 2], c[i + 3]]); return o; };
  let пер = 0; const кого = [];
  if (цель && цель._рт) for (const l of свяЭ) { if (l === цель || !l._рт) continue;
    for (const p of отр(цель._рт.c)) for (const q of отр(l._рт.c)) {
      const ex = p[2] - p[0], ey = p[3] - p[1], fx = q[2] - q[0], fy = q[3] - q[1], d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
      const s = ((q[0] - p[0]) * fy - (q[1] - p[1]) * fx) / d, u = ((q[0] - p[0]) * ey - (q[1] - p[1]) * ex) / d;
      if (s <= 0 || s >= 1 || u <= 0 || u >= 1) continue;
      const px = p[0] + ex * s, py = p[1] + ey * s;
      if ([цель.a, цель.b].some(id => { const m = graph.byId[id]; return Math.hypot(m.x - px, m.y - py) < (m.r || 8) + 6; })) continue;   // под своей нодой не видно
      пер++; кого.push(имя(l.a + "|" + l.b)); } }
  // через SH020 с подписью: рамка ноды + подпись под ней
  const n20 = graph.byId[s20.id], r = n20.r || 8, R = [n20.x - 30, n20.y - r - 2, n20.x + 30, n20.y + r + 19];
  const поНоде = цель && цель._рт && отр(цель._рт.c).some(p => { const xa = Math.min(p[0], p[2]), xb = Math.max(p[0], p[2]), ya = Math.min(p[1], p[3]), yb = Math.max(p[1], p[3]); return xb >= R[0] && xa <= R[2] && yb >= R[1] && ya <= R[3]; });
  const путь = цель && цель._рт ? Array.from(цель._рт.c).map((v, i) => Math.round(v - (i % 2 ? Y2 : X2))).join(",") : "нет маршрута";
  t.push({имя: "эталон 42: SQ02 → SH030 без пересечений", ок: !!цель && пер === 0, факт: "пересечений " + пер + (кого.length ? " (" + кого.join(", ") + ")" : "") + "; путь " + путь});
  t.push({имя: "эталон 42: SQ02 → SH030 не идёт через SH020 и её подпись", ок: !!цель && !поНоде, факт: поНоде ? "идёт через рамку SH020" : "мимо"});
}

// ===== ЭТАЛОН со снимка КРОЛИКА 43: связь не выходит из ноды назад от цели =====
/* После раскладки связи к листьям выходили из ноды в обратную сторону и возвращались петлёй под
   ней (SH02, SH03, SH07). Правило — с ОБОИХ концов первый заметный отрезок (длиннее 3 px) не смотрит
   от другого конца; вбок можно. Проверяем все связи проверочных деревьев после всех подборов. */
{
  const отр = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i + 2] - c[i], c[i + 3] - c[i + 1]]); return o; };
  /* отрезок, которым связь выходит за край ноды (+2 px): сдвиг порта внутри ноды не виден и не в счёт */
  const назад = l => { const c = l._рт.c, n = c.length >> 1; if (n < 2) return false;
    const P = i => [c[2 * i], c[2 * i + 1]], A = P(0), B = P(n - 1), дx = B[0] - A[0], дy = B[1] - A[1];
    const rA = graph.byId[l.a].r || 8, rB = graph.byId[l.b].r || 8;
    const выход = (i0, шаг, r) => { const o = P(i0); for (let i = i0; i + шаг >= 0 && i + шаг < n; i += шаг) { const q = P(i + шаг), p = P(i);
      if (Math.hypot(q[0] - o[0], q[1] - o[1]) > r + 2) return [q[0] - p[0], q[1] - p[1]]; } return null; };
    const плохо = (e, tx, ty) => e && (e[0] * tx + e[1] * ty) < -1e-6 * Math.hypot(e[0], e[1]) * Math.hypot(tx, ty);
    return плохо(выход(0, 1, rA), дx, дy) || плохо(выход(n - 1, -1, rB), -дx, -дy); };
  const всеМои = new Set(мои);   // оба дерева: со снимков 39–40 и эталон 42
  const все = graph.links.filter(l => всеМои.has(l.a) && всеМои.has(l.b) && l._рт);
  const плохие = все.filter(назад);
  /* КОНТРОЛЬ: тот же подбор с чистой памятью — без правила и с ним. Показывает, что петлю давал именно
     подбор и что её снимает именно правило, а не случай раскладки */
  const сЧистого = () => { graph._routeMem(true); graph._маршр = null; graph._routesFresh(); довести();
    return graph.links.filter(l => всеМои.has(l.a) && всеМои.has(l.b) && l._рт).filter(назад).length; };
  const правило = window.routeNoBack; window.routeNoBack = () => true;
  const безПравила = сЧистого(); window.routeNoBack = правило; const сПравилом = сЧистого();
  t.push({имя: "эталон 43: контроль — петли даёт подбор, снимает правило", ок: сПравилом === 0,
          факт: "петель назад без правила " + безПравила + ", с правилом " + сПравилом});
  t.push({имя: "эталон 43: ни одна связь не выходит из ноды назад от цели", ок: плохие.length === 0,
          факт: "связей с маршрутом " + все.length + ", с петлёй назад " + плохие.length + (плохие.length ? ": " + плохие.slice(0, 8).map(l => имя(l.a + "|" + l.b) +
            " [" + Array.from(l._рт.c).map(Math.round).join(",") + "; " + l._рт.сиг + "]").join(", ") : "")});
}

// ===== общий счёт по набору нод: пересечения, петли назад, повороты =====
const счёт = набор => {
  const L = graph.links.filter(l => набор.has(l.a) && набор.has(l.b) && l._рт);
  const отрз = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i], c[i + 1], c[i + 2], c[i + 3]]); return o; };
  let пер = 0;
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const A = L[i], B = L[j];
    for (const p of отрз(A._рт.c)) for (const q of отрз(B._рт.c)) {
      const ex = p[2] - p[0], ey = p[3] - p[1], fx = q[2] - q[0], fy = q[3] - q[1], d = ex * fy - ey * fx; if (Math.abs(d) < 1e-9) continue;
      const s = ((q[0] - p[0]) * fy - (q[1] - p[1]) * fx) / d, u = ((q[0] - p[0]) * ey - (q[1] - p[1]) * ex) / d;
      if (s <= 0 || s >= 1 || u <= 0 || u >= 1) continue;
      const px = p[0] + ex * s, py = p[1] + ey * s;
      if ([A.a, A.b, B.a, B.b].some(id => { const m = graph.byId[id]; return Math.hypot(m.x - px, m.y - py) < (m.r || 8) + 6; })) continue;
      пер++; } }
  // повороты — по видимой части: без отрезков внутри нод-концов и короче 3 px (как в подборе)
  const повороты = l => { const c = l._рт.c, n = c.length >> 1, P = i => [c[2 * i], c[2 * i + 1]];
    const ra = (graph.byId[l.a].r || 8) + 2, rb = (graph.byId[l.b].r || 8) + 2, a = P(0), b = P(n - 1);
    let i0 = 0; while (i0 < n - 2 && Math.hypot(P(i0 + 1)[0] - a[0], P(i0 + 1)[1] - a[1]) <= ra) i0++;
    let i1 = n - 1; while (i1 > i0 + 1 && Math.hypot(P(i1 - 1)[0] - b[0], P(i1 - 1)[1] - b[1]) <= rb) i1--;
    let пред = null, к = 0;
    for (let i = i0; i < i1; i++) { const ex = P(i + 1)[0] - P(i)[0], ey = P(i + 1)[1] - P(i)[1], ll = Math.hypot(ex, ey); if (ll < 3) continue;
      const d = [ex / ll, ey / ll]; if (пред && Math.abs(пред[0] * d[1] - пред[1] * d[0]) > 0.05) к++; пред = d; }
    return к; };
  const пов = L.map(повороты);
  return {связей: L.length, пер, поворотов: пов.reduce((a, b) => a + b, 0), большеДвух: пов.filter(k => k > 2).length, L, пов}; };

// ===== ЭТАЛОН со снимка КРОЛИКА 44: без препятствий — без лишних ступенек =====
/* SH050 → «Сборка» шла вправо, вниз, вправо, вниз, вправо — четыре поворота при пустом месте вокруг.
   Ступенька выигрывала потому, что повороты в цене не стоили ничего. Правило: при равных
   пересечениях и наездах выигрывает путь с меньшим числом поворотов. Меряем повороты на всех
   проверочных деревьях: подбор с нуля без платы за повороты и с ней. */
{
  const X3 = 9000, Y3 = 9000;
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X3 + x; it.y = Y3 + y; мои.push(it.id); return it; };
  const SQ = н("маршруты-SQ03", -520, 0, true), s50 = н("маршруты-SH050", 0, 0); addLink(SQ.id, s50.id);
  const сб = н("маршруты-Сб50", 318, 158), рн = н("маршруты-Рн50", -160, 158); addLink(s50.id, сб.id); addLink(s50.id, рн.id);
  recomputeHierarchy(); persist(); graphSetLinkMode("ortho"); graph.build(); graph.alpha = 0;
  const набор = new Set(мои);
  const сЧистого = без => { graph._безПоворотов = без; graph._routeMem(true); graph._маршр = null; graph._routesFresh(); довести(); graph._безПоворотов = false; return счёт(набор); };
  const до = сЧистого(true), после = сЧистого(false);
  t.push({имя: "эталон 44: повороты на проверочных деревьях (справка)", ок: true,
          факт: "без платы за повороты: поворотов " + до.поворотов + ", связей больше двух поворотов " + до.большеДвух + ", пересечений " + до.пер +
                "; с платой: " + после.поворотов + ", " + после.большеДвух + ", " + после.пер});
  /* справка, а не требование: это итоги двух жадных подборов с нуля, они зависят от порядка обхода и
     расходились в обе стороны (6 → 9 и 9 → 7 в соседних прогонах). Посвязное правило «пересечения
     важнее поворотов» держит сам порядок сравнения в подборе (лучше) */
  t.push({имя: "эталон 44: пересечения без платы за повороты и с ней (справка)", ок: true, факт: "пересечений " + до.пер + " → " + после.пер});
  const связь = после.L.find(l => (l.a === s50.id && l.b === сб.id) || (l.b === s50.id && l.a === сб.id)), k = связь ? после.пов[после.L.indexOf(связь)] : -1;
  t.push({имя: "эталон 44: SH050 → «Сборка» без препятствий — не больше одного колена (≤ 2 поворотов)", ок: k >= 0 && k <= 2,
          факт: "поворотов " + k + (связь ? "; вид " + связь._рт.сиг : "")});
}

// ===== ШИНА: подбор против пересечений с сохранением вида шины и её устойчивость =====
/* Дерево SQ/SH со снимков 37–38 в режиме «шина». Подбор перебирает ось и отступ ствола на всю группу;
   меряем пересечения до подбора и после, отсутствие петель назад, и что шина не перестраивается от
   действий, которые её не касаются: build, пересоздание графа, дрожь. */
{
  const X4 = -6000, Y4 = 12000, шн = [];
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X4 + x; it.y = Y4 + y; мои.push(it.id); шн.push(it.id); return it; };
  const SQ = н("маршруты-шSQ02", 0, 0, true);
  const места = {SH040: [230, -114], SH030: [172, -230], SH050: [230, 0], SH060: [172, 115], SH070: [57, 115], SH080: [-57, 115], SH020: [57, -210], SH010: [-57, -172]};
  const SH = {}; for (const k in места) { SH[k] = н("маршруты-ш" + k, места[k][0], места[k][1]); addLink(SQ.id, SH[k].id); }
  for (const k of ["SH030", "SH040", "SH060"]) { const [x, y] = места[k]; addLink(SH[k].id, н("маршруты-ш" + k + "a", x + 70, y - 50).id); addLink(SH[k].id, н("маршруты-ш" + k + "b", x + 70, y + 40).id); }
  recomputeHierarchy(); persist(); graphSetLinkMode("bus"); graph.build(); graph.alpha = 0;
  const набор = new Set(шн);
  const родной = graph._routeOptimize;
  graph._routeOptimize = () => 0; graph._routeMem(true); graph._маршр = null; graph._routesFresh(); const до = счёт(набор);
  graph._routeOptimize = родной; graph._routeMem(true); graph._маршр = null; graph._routesFresh(); довести(); const после = счёт(набор);
  t.push({имя: "шина: подбор снижает пересечения на дереве SQ/SH", ок: после.пер < до.пер || после.пер === 0,
          факт: "пересечений до подбора " + до.пер + ", после " + после.пер + "; подбор " + (graph._оптЦена || 0).toFixed(1) + " мс"});
  const плохие = после.L.filter(l => !routeNoBack(Array.from({length: l._рт.c.length >> 1}, (_, i) => [l._рт.c[2 * i], l._рт.c[2 * i + 1]]), graph.byId[l.a].r || 8, graph.byId[l.b].r || 8));
  t.push({имя: "шина: ни одна связь не выходит из ноды назад от цели", ок: плохие.length === 0, факт: "с петлёй назад " + плохие.length});
  // устойчивость шины
  const снимШ = () => { const m = new Map(); for (const l of graph.links) if (набор.has(l.a) && набор.has(l.b) && l._рт) m.set(l.a + "|" + l.b, {сиг: l._рт.сиг, c: Array.from(l._рт.c)}); return m; };
  { const до2 = снимШ(); graph.build(); graph.alpha = 0; graph._routesFresh(); довести();
    t.push({имя: "шина: build не перестраивает", ок: сменили(до2, снимШ(), 0.5).length === 0, факт: "сменили " + сменили(до2, снимШ(), 0.5).length}); }
  { const до2 = снимШ(); render(); await ж(300); graph.alpha = 0; graphSetLinkMode("bus"); graph._маршр = null; graph._routesFresh(); довести();
    const к = сменили(до2, снимШ(), 4);
    t.push({имя: "шина: пересоздание графа не перестраивает", ок: к.length === 0, факт: "сменили " + к.length}); }
  { const до2 = снимШ(); let i = 0;
    for (const id of шн) { const n = graph.byId[id]; if (!n) continue; i++; n.x += ((i * 7919) % 13) / 13 * 3 - 1.5; n.y += ((i * 104729) % 11) / 11 * 3 - 1.5; }
    graph._маршр.at = -1e9; graph.alpha = 0.01; graph._routesFresh(); graph.alpha = 0; graph._routesFresh(); довести();
    const по2 = снимШ(), к = сменили(до2, по2, 4);
    t.push({имя: "шина: дрожь ±1.5 px не перестраивает", ок: к.length === 0,
            факт: "сменили " + к.length + (к.length ? ": " + к.slice(0, 4).map(k => имя(k) + " [" + до2.get(k).сиг + " → " + (по2.get(k) ? по2.get(k).сиг : "нет") + "]").join(", ") : "")}); }
  graphSetLinkMode("ortho");
}

// ===== ПРОВАЛ ПОД ЧУЖОЙ НОДОЙ (снимок КРОЛИКА 45) =====
/* Связь, прошедшая через рамку не своей ноды с подписью, гаснет на этом участке (_crossBuild, l._пров
   с меткой нода). Проверяем на прямых углах и на мягкой связи, и что пункт «провалы» в «…» выключает
   и это. Подбор выключен, чтобы связь честно легла через ноду. */
{
  const X5 = 15000, Y5 = 15000;
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X5 + x; it.y = Y5 + y; мои.push(it.id); return it; };
  const A = н("маршруты-пА", 0, 0, true), B = н("маршруты-пБ", 400, 0), чужая = н("маршруты-пЧужая", 200, -4, true);
  addLink(A.id, B.id); recomputeHierarchy(); persist();
  const былиПровалы = S.settings.graphBridges, родной = graph._routeOptimize;
  for (const m of ["ortho", "soft"]) {
    graphSetLinkMode(m); graph.build(); graph.alpha = 0; graph._routeOptimize = () => 0;
    graph._маршр = null; graph._routesFresh(); for (const l of graph.links) { l._bendC = null; l._bendT = null; }
    const l = graph.links.find(x => (x.a === A.id && x.b === B.id) || (x.b === A.id && x.a === B.id));
    /* чужую ноду ставим на НАСТОЯЩИЙ путь — в середину его самого длинного отрезка: прямые углы кладут
       эту связь скобой, и нода на месте прямой оказывалась честно обойдённой */
    { const ч = graph.byId[чужая.id], c = l && l._рт ? Array.from(l._рт.c) : [graph.byId[A.id].x, graph.byId[A.id].y, graph.byId[B.id].x, graph.byId[B.id].y];
      let лучш = null; for (let i = 0; i < c.length - 2; i += 2) { const d = Math.hypot(c[i + 2] - c[i], c[i + 3] - c[i + 1]); if (!лучш || d > лучш.d) лучш = {d, x: (c[i] + c[i + 2]) / 2, y: (c[i + 1] + c[i + 3]) / 2}; }
      ч.x = лучш.x; ч.y = лучш.y - 4; }
    S.settings.graphBridges = true; graph._crossBuild();
    const под = l && l._пров ? l._пров.filter(p => p.нода) : [];
    const путь = l && l._рт ? Array.from(l._рт.c).map((v, i) => Math.round(v - (i % 2 ? Y5 : X5))).join(",") : "прямая";
    const ч = graph.byId[чужая.id];
    t.push({имя: "провал под чужой нодой: " + m, ок: под.length === 1 && под[0].t > 0.35 && под[0].t < 0.65,
            факт: (под.length ? "провалов под нодой " + под.length + ", доля " + под[0].t.toFixed(2) + ", ширина " + под[0].ш.toFixed(0) : "провала нет") +
                  "; путь " + путь + "; чужая нода " + Math.round(ч.x - X5) + "," + Math.round(ч.y - Y5)});
    S.settings.graphBridges = false; graph._crossBuild();
    t.push({имя: "провал под чужой нодой: " + m + " — выключается пунктом «провалы»", ок: !(l && l._пров && l._пров.length), факт: l && l._пров ? "остался" : "нет"});
  }
  graph._routeOptimize = родной; if (былиПровалы == null) delete S.settings.graphBridges; else S.settings.graphBridges = былиПровалы;
  graphSetLinkMode("ortho");
}

// ===== БЛИЗОСТЬ (снимок КРОЛИКА 46): чужие отрезки и колена не впритык =====
/* Метрика — минимальный зазор между отрезками РАЗНЫХ связей (возле общей ноды и своих концов не в
   счёт — там связи сходятся) и число пар ближе 8 мировых px (≈4 экранных на обычном отдалении).
   Подбор с нуля без платы за близость и с ней. */
const зазоры = набор => { const L = graph.links.filter(l => набор.has(l.a) && набор.has(l.b) && l._рт);
  const отрз = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i], c[i + 1], c[i + 2], c[i + 3]]); return o; };
  const тчк = (px, py, s) => { const ex = s[2] - s[0], ey = s[3] - s[1], L2 = (ex * ex + ey * ey) || 1; let t = ((px - s[0]) * ex + (py - s[1]) * ey) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s[0] + ex * t, qy = s[1] + ey * t; return [Math.hypot(px - qx, py - qy), qx, qy]; };
  let мин = Infinity, впритык = 0; const кто = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) { const A = L[i], B = L[j];
    const общие = [A.a, A.b].filter(id => id === B.a || id === B.b), ids = [...new Set([A.a, A.b, B.a, B.b])];
    for (const p of отрз(A._рт.c)) for (const q of отрз(B._рт.c)) {
      const ex = p[2] - p[0], ey = p[3] - p[1], fx = q[2] - q[0], fy = q[3] - q[1], d = ex * fy - ey * fx;
      if (Math.abs(d) > 1e-9) { const s = ((q[0] - p[0]) * fy - (q[1] - p[1]) * fx) / d, u = ((q[0] - p[0]) * ey - (q[1] - p[1]) * ex) / d; if (s > 0 && s < 1 && u > 0 && u < 1) continue; }   // пересечение — это не близость
      let м = null; for (const v of [тчк(p[0], p[1], q), тчк(p[2], p[3], q), тчк(q[0], q[1], p), тчк(q[2], q[3], p)]) if (!м || v[0] < м[0]) м = v;
      if (ids.some(id => { const n = graph.byId[id]; return Math.hypot(м[1] - n.x, м[2] - n.y) < (n.r || 8) + 24; })) continue;
      if (м[0] < 0.5 && общие.length) continue;               // слипание у общего выхода — не сюда
      мин = Math.min(мин, м[0]); if (м[0] < 8) { впритык++; if (кто.length < 6) кто.push(имя(A.a + "|" + A.b) + "~" + имя(B.a + "|" + B.b) + " " + м[0].toFixed(1)); } } }
  return {мин, впритык, кто}; };
{
  const набор = new Set(мои);
  const сЧистого = без => { graph._безБлизости = без; graph._routeMem(true); graph._маршр = null; graph._routesFresh(); довести(); graph._безБлизости = false; return зазоры(набор); };
  graphSetLinkMode("ortho");
  const до = сЧистого(true), после = сЧистого(false);
  t.push({имя: "близость: пар впритык (ближе 8) с платой за близость не больше, чем без неё", ок: после.впритык <= до.впритык,
          факт: "без платы: впритык " + до.впритык + ", мин. зазор " + до.мин.toFixed(1) + "; с платой: " + после.впритык + ", " + после.мин.toFixed(1)});
}

// ===== ЭТАЛОН шины со снимка КРОЛИКА 47 =====
/* SQ02 и ряд SH080, SH070, SH060 ниже, SH050 справа на уровне SQ02. Ствол шины к SH060 спускался справа
   от SH070 и шёл по уровню центра её ромба — резал выход SH070 → «Сборка» и сливался с углом ромба.
   Требование: ноль пересечений и ни одна связь не идёт сквозь коридор чужой ноды. */
{
  const X6 = -15000, Y6 = 15000, эт = [];
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X6 + x; it.y = Y6 + y; мои.push(it.id); эт.push(it.id); return it; };
  const к = (title, x, y, род) => { const it = н("маршруты-47" + title, x, y); addLink(род.id, it.id); return it; };
  const SQ = н("маршруты-47SQ02", 0, 0, true);
  const s80 = к("SH080", -190, 380, SQ), s70 = к("SH070", 191, 380, SQ), s60 = к("SH060", 572, 380, SQ), s50 = к("SH050", 763, 0, SQ);
  к("Рн80", -381, 571, s80); к("Сб80", -190, 571, s80); к("Рн70", 191, 571, s70); к("Сб70", 381, 571, s70);
  к("Рн60", 572, 571, s60); к("Сб60", 763, 571, s60); к("Рн50", 572, 190, s50);
  recomputeHierarchy(); persist(); graphSetLinkMode("bus"); graph.build(); graph.alpha = 0;
  graph._маршр = null; graph._routesFresh(); довести();
  const набор = new Set(эт), с = счёт(набор);
  // сквозь коридор чужой ноды: рамка (routeNodeBox) + 4 px
  const сквозь = [];
  for (const l of с.L) { const c = l._рт.c;
    for (let i = 0; i < c.length - 2; i += 2) for (const id of эт) { if (id === l.a || id === l.b) continue; const n = graph.byId[id];
      if (routeClipT(c[i], c[i + 1], c[i + 2], c[i + 3], routeNodeBox(n), 4)) { сквозь.push(имя(l.a + "|" + l.b) + " у " + n.ref.title.replace("маршруты-47", "")); break; } } }
  t.push({имя: "эталон 47 (шина): ноль пересечений", ок: с.пер === 0, факт: "пересечений " + с.пер});
  t.push({имя: "эталон 47 (шина): связи не идут впритык к чужим нодам", ок: сквозь.length === 0, факт: сквозь.length ? [...new Set(сквозь)].slice(0, 6).join(", ") : "нет"});
  graphSetLinkMode("ortho");
}

// ===== ЭТАЛОН со снимка КРОЛИКА 48 и сравнение режимов (снимки 50–51: «шина выглядит лучше») =====
/* SQ02 с рядом шотов: SH050 справа на уровне SQ02, SH040 выше её, SH030 и SH020 сверху, ряд SH080, SH070,
   SH060 снизу. Было: SQ02 → SH040 шла одной горизонталью с SQ02 → SH050 до самой SH050 и поднималась у
   её угла, колено к SH060 садилось вплотную к SH070. Требования: связи от одного родителя не делят
   линию дальше общего выхода, ни одна не идёт впритык к чужой ноде. И таблица: прямые углы с коленом
   посередине (как было), у родителя (как стало) и шина — на одном дереве. */
{
  const X7 = 20000, Y7 = -20000, эт = [];
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X7 + x; it.y = Y7 + y; мои.push(it.id); эт.push(it.id); return it; };
  /* подписи КОРОТКИЕ, как в живом графе («Рендер», «SH050»): с длинными «маршруты-48Рн50» рамка подписи
     по оценке выходила ~150 px, и подбор обходил несуществующие наезды (разбор зазора у SH070).
     Убираются по списку id (мои), а не по названию; имя() для справок — по этим же коротким. */
  const к = (title, x, y, род) => { const it = н(title.replace(/^Рн\d+$/, "Рендер").replace(/^Сб\d+$/, "Сборка"), x, y); it._эт48 = title; addLink(род.id, it.id); return it; };
  const SQ = н("SQ02", 0, 0, true);
  const s50 = к("SH050", 370, 0, SQ), s40 = к("SH040", 370, -186, SQ), s30 = к("SH030", 278, -366, SQ), s20 = к("SH020", 93, -370, SQ), s10 = к("SH010", -92, -278, SQ);
  const s80 = к("SH080", -92, 185, SQ), s70 = к("SH070", 93, 185, SQ), s60 = к("SH060", 278, 185, SQ);
  к("Рн50", 278, 92, s50); к("Сб50", 463, 92, s50); к("Рн40", 500, -186, s40); к("Сб40", 500, -74, s40);
  к("Рн30", 410, -390, s30); к("Сб30", 410, -330, s30); к("Рн20", 150, -460, s20); к("Сб20", 37, -460, s20);
  к("Рн70", 93, 277, s70); к("Сб70", 185, 277, s70); к("Рн60", 278, 277, s60); к("Сб60", 370, 277, s60); к("Рн80", -185, 277, s80); к("Сб80", -92, 277, s80);
  recomputeHierarchy(); persist(); graph.build(); graph.alpha = 0;
  const набор = new Set(эт);
  const снять = (режим, посередине) => { graphSetLinkMode(режим); graph._коленоПосередине = посередине; graph.build(); graph.alpha = 0;
    graph._routeMem(true); graph._маршр = null; graph._routesFresh(); довести(); graph._коленоПосередине = false;
    const с = счёт(набор), з = зазоры(набор); let дл = 0;
    for (const l of с.L) { const c = l._рт.c; for (let i = 0; i < c.length - 2; i += 2) дл += Math.hypot(c[i + 2] - c[i], c[i + 3] - c[i + 1]); }
    return {пер: с.пер, пов: с.поворотов, мин: з.мин, впритык: з.впритык, кто: з.кто, дл: Math.round(дл), L: с.L}; };
  const сер = снять("ortho", true), у = снять("ortho", false), ш = снять("bus", false);
  const стр = (и, r) => и + ": пересечений " + r.пер + ", поворотов " + r.пов + ", мин. зазор " + (isFinite(r.мин) ? r.мин.toFixed(1) : "—") + ", впритык " + r.впритык +
    (r.кто.length ? " (" + r.кто.join("; ") + ")" : "") + ", длина " + r.дл;
  t.push({имя: "эталон 48: сравнение режимов на одном дереве (справка)", ок: true, факт: [стр("прямые углы, колено посередине", сер), стр("прямые углы, колено у родителя", у), стр("шина", ш)].join(" | ")});
  t.push({имя: "эталон 48: колено у родителя не хуже по пересечениям", ок: у.пер <= сер.пер, факт: сер.пер + " → " + у.пер});
  // проверки — на прямых углах «как стало»
  снять("ortho", false);
  const связь = (a, b) => graph.links.find(l => (l.a === a.id && l.b === b.id) || (l.b === a.id && l.a === b.id));
  const отрз = c => { const o = []; for (let i = 0; i < c.length - 2; i += 2) o.push([c[i], c[i + 1], c[i + 2], c[i + 3]]); return o; };
  // одна линия дальше общего выхода: параллельные отрезки ближе 4 px и внахлёст дальше R от SQ02
  const делят = (l1, l2) => { const n = graph.byId[SQ.id], R = (n.r || 8) + 24; let макс = 0;
    for (const p of отрз(l1._рт.c)) for (const q of отрз(l2._рт.c)) {
      const гор = Math.abs(p[1] - p[3]) < 0.5 && Math.abs(q[1] - q[3]) < 0.5 && Math.abs(p[1] - q[1]) < 4;
      const вер = Math.abs(p[0] - p[2]) < 0.5 && Math.abs(q[0] - q[2]) < 0.5 && Math.abs(p[0] - q[0]) < 4;
      if (!гор && !вер) continue;
      const лo = гор ? Math.max(Math.min(p[0], p[2]), Math.min(q[0], q[2])) : Math.max(Math.min(p[1], p[3]), Math.min(q[1], q[3]));
      const хи = гор ? Math.min(Math.max(p[0], p[2]), Math.max(q[0], q[2])) : Math.min(Math.max(p[1], p[3]), Math.max(q[1], q[3]));
      const c = гор ? n.x : n.y; макс = Math.max(макс, Math.max(0, хи - Math.max(лo, c + R)) + Math.max(0, Math.min(хи, c - R) - лo)); }
    return макс; };
  const л40 = связь(SQ, s40), л50 = связь(SQ, s50), общая = л40 && л50 && л40._рт && л50._рт ? делят(л40, л50) : -1;
  const путь = l => l && l._рт ? Array.from(l._рт.c).map((v, i) => Math.round(v - (i % 2 ? Y7 : X7))).join(",") + " [" + l._рт.сиг + "]" : "нет";
  t.push({имя: "эталон 48: SQ02 → SH040 и SQ02 → SH050 не идут одной линией дальше общего выхода", ок: общая >= 0 && общая <= 10,
          факт: "одной линией " + Math.round(общая) + " px; к SH040 " + путь(л40) + "; к SH050 " + путь(л50)});
  const сквозь = [];
  for (const l of graph.links.filter(l => набор.has(l.a) && набор.has(l.b) && l._рт)) { const c = l._рт.c;
    for (let i = 0; i < c.length - 2; i += 2) for (const id of эт) { if (id === l.a || id === l.b) continue; const m = graph.byId[id];
      if (routeClipT(c[i], c[i + 1], c[i + 2], c[i + 3], routeNodeBox(m), 4)) { сквозь.push(имя(l.a + "|" + l.b) + " у " + m.ref.title.replace("маршруты-48", "")); break; } } }
  t.push({имя: "эталон 48: связи не идут впритык к чужим нодам (у SH050, SH070)", ок: сквозь.length === 0, факт: сквозь.length ? [...new Set(сквозь)].slice(0, 6).join(", ") : "нет"});
  /* РАЗБОР зазора у SH070 (снимок 46): ломаные SQ02 → SH060 и SH070 → «Сборка», их подписи и точка
     сближения — какая из двух легла не туда */
  { const л60 = связь(SQ, s60), с70 = graph.links.find(l => (l.a === s70.id || l.b === s70.id) && (graph.byId[l.a === s70.id ? l.b : l.a].ref || {})._эт48 === "Сб70");
    let мин = null;
    if (л60 && с70 && л60._рт && с70._рт) for (const p of отрз(л60._рт.c)) for (const q of отрз(с70._рт.c)) {
      for (const [px, py, s] of [[p[0], p[1], q], [p[2], p[3], q], [q[0], q[1], p], [q[2], q[3], p]]) {
        const ex = s[2] - s[0], ey = s[3] - s[1], L2 = (ex * ex + ey * ey) || 1; let tt = ((px - s[0]) * ex + (py - s[1]) * ey) / L2; tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
        const d = Math.hypot(px - s[0] - ex * tt, py - s[1] - ey * tt); if (!мин || d < мин.d) мин = {d, x: Math.round(px - X7), y: Math.round(py - Y7)}; } }
    t.push({имя: "эталон 48: разбор зазора у SH070 (справка)", ок: true,
            факт: "к SH060 " + путь(л60) + "; SH070 → Сб70 " + путь(с70) + (мин ? "; ближе всего " + мин.d.toFixed(1) + " px у " + мин.x + "," + мин.y : "")}); }
}

// ===== ЭТАЛОН со снимка КРОЛИКА 52: метро 45° =====
/* Хаб «ТТ Тюрьма», колонки шотов слева и справа, у каждого «Рендер» и «Сборка», «правки» под SH03 и
   длинная связь сверху вниз вдоль левой колонки. Было: диагональ к «правки» шла сквозь SH03 вплотную к
   связи хаб → SH03, длинная вертикаль цепляла ромбы колонки. Меряем метро без подбора и с ним:
   пересечения, проходы сквозь чужие ноды (рамка с подписью), пары впритык. */
{
  const X9 = 25000, Y9 = 25000, эт = [];
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X9 + x; it.y = Y9 + y; мои.push(it.id); эт.push(it.id); return it; };
  const к = (title, x, y, род) => { const it = н(title, x, y); addLink(род.id, it.id); return it; };
  const хаб = н("ТТ Тюрьма", 0, 0, true);
  const лев = [["SH07", -270], ["SH08", -160], ["SH09", -50], ["SH10", 60], ["SH05", 170], ["SH04", 280]];
  const прав = [["SH00", -250], ["SH01", -140], ["SH02", -30], ["SH06", 80], ["SH03", 190]];
  let sh03 = null;
  for (const [т, y] of лев) { const s = к(т, -145, y, хаб); к("Рендер", -290, y - 15, s); к("Сборка", -290, y + 15, s); }
  for (const [т, y] of прав) { const s = к(т, 145, y, хаб); к("Рендер", 290, y - 15, s); к("Сборка", 290, y + 15, s); if (т === "SH03") sh03 = s; }
  к("правки", 145, 280, sh03);
  const верх = н("Верх", -125, -520, true); к("Boombot", -125, 470, верх);
  recomputeHierarchy(); persist();
  const набор = new Set(эт);
  const сквозь = () => { let n = 0;
    for (const l of graph.links.filter(l => набор.has(l.a) && набор.has(l.b) && l._рт)) { const c = l._рт.c;
      for (const id of эт) { if (id === l.a || id === l.b) continue; const m = graph.byId[id];
        for (let i = 0; i < c.length - 2; i += 2) if (routeClipT(c[i], c[i + 1], c[i + 2], c[i + 3], routeNodeBox(m), 0)) { n++; break; } } }
    return n; };
  const снять = сПодбором => { graphSetLinkMode("metro"); graph.build(); graph.alpha = 0; const родной = graph._routeOptimize;
    if (!сПодбором) graph._routeOptimize = () => 0;
    graph._routeMem(true); graph._маршр = null; graph._routesFresh(); if (сПодбором) довести(); graph._routeOptimize = родной;
    const с = счёт(набор), з = зазоры(набор); return {пер: с.пер, сквозь: сквозь(), впритык: з.впритык, пов: с.поворотов}; };
  const до = снять(false), после = снять(true);
  const стр = r => "пересечений " + r.пер + ", сквозь чужие ноды " + r.сквозь + ", впритык " + r.впритык + ", поворотов " + r.пов;
  t.push({имя: "эталон 52 (метро): без подбора и с ним (справка)", ок: true, факт: "без подбора: " + стр(до) + " | с подбором: " + стр(после)});
  t.push({имя: "эталон 52 (метро): подбор не хуже по пересечениям и проходам сквозь ноды", ок: после.пер <= до.пер && после.сквозь <= до.сквозь,
          факт: "пересечений " + до.пер + " → " + после.пер + ", сквозь ноды " + до.сквозь + " → " + после.сквозь});
  graphSetLinkMode("ortho");
}

// ===== ЭТАЛОН со снимка КРОЛИКА 49: связь проходит МИМО ноды — не гаснет =====
/* Провал под нодой гасил связи, шедшие рядом: рамка подписи по числу букв выходила шире текста и
   раздувалась ещё на 2 px. Теперь у провала строгая рамка — форма и настоящая подпись (её ширину
   меряет кадр). Проверяем: вертикаль между «Рендер» и «Сборка» и линия рядом с длинной подписью —
   без провала; линия сквозь подпись — с провалом; на своих концах провала нет никогда. */
{
  const X8 = -20000, Y8 = -20000;
  const н = (title, x, y, своя) => { const it = addItem(своя ? {kind: "note", title, area: обл} : {kind: "note", title}); it.x = X8 + x; it.y = Y8 + y; мои.push(it.id); return it; };
  const рн = н("Рендер", -40, 0, true), сб = н("Сборка", 40, 0, true), дл = н("Симуляция одежды", 300, 0, true);
  const A1 = н("маршруты-49A", 0, -200, true), B1 = н("маршруты-49B", 0, 200);          // вертикаль ровно между «Рендер» и «Сборка»
  const A2 = н("маршруты-49C", 300 + 75, -200, true), B2 = н("маршруты-49D", 300 + 75, 200);   // рядом с длинной подписью, мимо неё
  const A3 = н("маршруты-49E", 300 + 20, -200, true), B3 = н("маршруты-49F", 300 + 20, 200);   // сквозь подпись
  addLink(A1.id, B1.id); addLink(A2.id, B2.id); addLink(A3.id, B3.id); recomputeHierarchy(); persist();
  graphSetLinkMode("soft"); graph.build(); graph.alpha = 0;
  graph.zoom = 1; graph.tx = graph.W / 2 - (X8 + 150); graph.ty = graph.H / 2 - Y8;   // подписи в кадре — кадр их меряет
  for (const l of graph.links) { l._bendC = null; l._bendT = null; }
  graph._drawMain(); S.settings.graphBridges = true; graph._crossBuild();
  const подНодой = (a, b) => { const l = graph.links.find(x => (x.a === a.id && x.b === b.id) || (x.b === a.id && x.a === b.id)); return l && l._пров ? l._пров.filter(p => p.нода).length : 0; };
  const ш = graph.byId[дл.id]._подпШ || 0;
  t.push({имя: "эталон 49: вертикаль между «Рендер» и «Сборка» не гаснет", ок: подНодой(A1, B1) === 0, факт: "провалов под нодой " + подНодой(A1, B1)});
  t.push({имя: "эталон 49: линия рядом с длинной подписью не гаснет", ок: подНодой(A2, B2) === 0, факт: "провалов " + подНодой(A2, B2) + "; подпись " + Math.round(ш) + " px, линия в 75 от центра"});
  t.push({имя: "эталон 49: линия сквозь подпись гаснет", ок: подНодой(A3, B3) === 1, факт: "провалов " + подНодой(A3, B3)});
  const свои = graph.links.filter(l => [A1, B1, A2, B2, A3, B3].some(n => n.id === l.a || n.id === l.b));
  // провал помнит, под какой нодой стоит (p.нода — её id): ни одна из них не конец той же связи
  const наСвоих = свои.filter(l => (l._пров || []).some(p => p.нода && (p.нода === l.a || p.нода === l.b)));
  t.push({имя: "эталон 49: провал не встаёт на своих концах связи", ок: наСвоих.length === 0,
          факт: свои.length + " связей проверено, с провалом на своём конце " + наСвоих.length});
  graphSetLinkMode("ortho");
}

// ================== УБОРКА ==================
deletePack(мои);
if (был.mode) S.settings.graphLinkMode = был.mode; else delete S.settings.graphLinkMode;
S.settings.graphRender = был.rend; S.settings.graphHome = был.home;
if (был.drift == null) delete S.settings.graphDrift; else S.settings.graphDrift = был.drift;
render(); await ж(200);
t.push({имя: "за собой убрано", ок: !S.items.some(i => /^маршруты-/.test(i.title || "")), факт: "осталось " + S.items.filter(i => /^маршруты-/.test(i.title || "")).length});
return t;
