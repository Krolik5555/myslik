/* ЛИНЕЙКА «УПОРЯДОЧИТЬ ЯРУСАМИ» (режимы "td" и "hz", выбор КРОЛИКА из demo_раскладка.html, 04.11.2026)
   и «Упорядочить весь граф» (_tidyAll) во всех трёх режимах. Меряем по ЦЕЛЕВЫМ местам — дом от дома
   владельца, — как в раскладка.js: ноды доезжают физикой секунды. Нормы — числа макета на «Норме»:
   связи дерева не пересекаются, подписи не налезают ни друг на друга, ни на чужую ноду, ни одна нода
   не лежит на чужой связи, площадь на ноду 4–22 тыс. px² (у кустов и ручного эталона ≈ 9, ярусы
   честно просторнее — 14–16 на широком дереве). */
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const обл = S.areas[0] && S.areas[0].id;
if (!обл) { t.push({имя:"есть область для проверки", ок:false, факт:"в демо нет ни одной области"}); return t; }
const _был = {дом:S.settings.graphHome, реж:S.settings.graphTidyMode, сетка:S.settings.graphSnap};
S.settings.graphSnap = false;
const свои = [], связи = [];
const мк = (title, род) => { const it = addItem({kind:"task", title:"ярус-" + title}); it.x = (Math.random() - .5) * 300; it.y = (Math.random() - .5) * 300;
  свои.push(it); if (род) { addLink(род.id, it.id); связи.push([род.id, it.id]); } return it; };
const кор = addItem({kind:"note", title:"ярус-Презентация команды", area:обл}); кор.x = 0; кор.y = 0; свои.push(кор);
const ветки = [];
const листья = [5, 4, 6, 3, 5, 7];
листья.forEach((k, b) => { const в = мк("Ветка номер " + b, кор); ветки.push(в);
  for (let l = 0; l < k; l++) { const лист = мк((l % 2 ? "длинное название листа " : "лист ") + b + "-" + l, в);
    if (b === 0 && l === 1) { мк("внук А", лист); мк("внук Б с подписью", лист); } } });
{ const в = мк("Цепочка", кор); ветки.push(в); let п = в; for (let l = 0; l < 10; l++) п = мк("звено " + l, п); }
{ const в = мк("Закупки", кор); ветки.push(в); let п = в; for (let l = 0; l < 4; l++) п = мк("шаг " + l, п); мк("возврат брака", п); мк("акт", п); }
recomputeHierarchy();
кор.pin = true;
view = "notes"; notesMode = "graph"; render(); await ж(300);
if (!graph) { t.push({имя:"граф создан", ок:false, факт:"графа нет"}); return t; }
// чужие узлы демо — далеко: раскладка выделения ярусами их не обходит (см. _tidyTiers), меряем само дерево
graph.nodes.forEach(n => { if (!свои.some(m => m.id === n.id)) { n.x += 6000; n.y += 6000; n.fixed = true; } });

const мер = document.createElement("canvas").getContext("2d");
const подп = id => { const n = graph.byId[id]; let т = (n.label || "").trim() || "(без названия)"; if (т.length > 22) т = т.slice(0, 21) + "…";
  const род = связи.some(l => l[0] === id); мер.font = (род ? "600 12px " : "10.5px ") + "system-ui, -apple-system, Segoe UI, sans-serif";
  return Math.ceil(мер.measureText(т).width) + 8; };
const o = (ax,ay,bx,by,cx,cy) => (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
// цели по цепочке домов: у ноды — владелец + дом, у области — её якорь, закреплённый корень — живое место
function цели(спис) {
  const цел = new Map();
  спис.forEach(it => { if (it.pin) { const жн = graph.byId[it.id]; if (жн) цел.set(it.id, {x:жн.x, y:жн.y}); } });
  for (let раунд = 0; раунд < 30; раунд++) спис.forEach(it => { if (цел.has(it.id)) return;
    if (it.hx == null) { if (!homeOwner(it) && it.x != null) цел.set(it.id, {x:it.x, y:it.y}); return; }
    const oo = homeOwner(it); if (!oo) return;
    const б = цел.get(oo.id) || (oo.hx != null ? {x:oo.hx, y:oo.hy} : (!спис.includes(oo) && oo.x != null ? {x:oo.x, y:oo.y} : null)); if (!б) return;
    цел.set(it.id, {x:б.x + it.hx, y:б.y + it.hy}); });
  return цел;
}
function промер(цел) {
  const сег = связи.map(l => ({a:l[0], b:l[1], p:цел.get(l[0]), q:цел.get(l[1])})).filter(s => s.p && s.q);
  let пер = 0; for (let i = 0; i < сег.length; i++) for (let j = i + 1; j < сег.length; j++) { const s = сег[i], r = сег[j];
    if (s.a === r.a || s.a === r.b || s.b === r.a || s.b === r.b) continue;
    if ((o(s.p.x,s.p.y,s.q.x,s.q.y,r.p.x,r.p.y) > 0) !== (o(s.p.x,s.p.y,s.q.x,s.q.y,r.q.x,r.q.y) > 0) &&
        (o(r.p.x,r.p.y,r.q.x,r.q.y,s.p.x,s.p.y) > 0) !== (o(r.p.x,r.p.y,r.q.x,r.q.y,s.q.x,s.q.y) > 0)) пер++; }
  let наЛинии = 0; сег.forEach(s => свои.forEach(n => { if (n.id === s.a || n.id === s.b) return; const p = цел.get(n.id); if (!p) return;
    const dx = s.q.x - s.p.x, dy = s.q.y - s.p.y, L2 = dx*dx + dy*dy || 1, tt = Math.max(0, Math.min(1, ((p.x - s.p.x)*dx + (p.y - s.p.y)*dy) / L2));
    if (Math.hypot(s.p.x + dx*tt - p.x, s.p.y + dy*tt - p.y) < (graph.byId[n.id].r || 8) + 4) наЛинии++; }));
  const кор_ = свои.filter(n => цел.has(n.id)).map(n => { const p = цел.get(n.id), r = graph.byId[n.id].r || 8, w = подп(n.id) / 2;
    return {id:n.id, p, r, л:[p.x - w, p.y + r + 3, p.x + w, p.y + r + 16]}; });
  const нахл = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  let подписи = 0, мин = 1e9, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  кор_.forEach(a => { x0 = Math.min(x0, a.л[0], a.p.x - a.r); x1 = Math.max(x1, a.л[2], a.p.x + a.r); y0 = Math.min(y0, a.p.y - a.r); y1 = Math.max(y1, a.л[3]); });
  for (let i = 0; i < кор_.length; i++) for (let j = i + 1; j < кор_.length; j++) { const a = кор_[i], b = кор_[j];
    мин = Math.min(мин, Math.hypot(a.p.x - b.p.x, a.p.y - b.p.y));
    const ка = [a.p.x - a.r, a.p.y - a.r, a.p.x + a.r, a.p.y + a.r], кб = [b.p.x - b.r, b.p.y - b.r, b.p.x + b.r, b.p.y + b.r];
    if (нахл(a.л, b.л) || нахл(a.л, кб) || нахл(b.л, ка)) подписи++; }
  return {пер, наЛинии, подписи, мин, площадь:(x1 - x0) * (y1 - y0) / кор_.length / 1000, W:x1 - x0, H:y1 - y0, всего:сег.length};
}
const поId = id => S.items.find(i => i.id === id);
for (const реж of ["td", "hz"]) {
  свои.splice(0, свои.length, ...свои.map(n => поId(n.id)));
  graph.selNodes = new Set(свои.map(n => n.id)); graph._paintSel();
  const t0 = performance.now(); const ок = graph._tidySelection(реж); const мс = Math.round(performance.now() - t0);
  await ж(120);
  свои.splice(0, свои.length, ...свои.map(n => поId(n.id)));
  const цел = цели(свои), м = промер(цел), п = (реж === "td" ? "сверху вниз" : "в две стороны") + ": ";
  t.push({имя:п+"отработала и дала цели всем", ок: ок === true && свои.every(n => цел.has(n.id)), факт: "целей " + свои.filter(n => цел.has(n.id)).length + " из " + свои.length + ", " + мс + " мс"});
  t.push({имя:п+"корень остался на месте", ок: Math.hypot(цел.get(кор.id).x, цел.get(кор.id).y) < 1, факт: JSON.stringify(цел.get(кор.id))});
  t.push({имя:п+"связи не пересекаются", ок: м.пер === 0, факт: м.пер + " из " + м.всего});
  t.push({имя:п+"нода не лежит на чужой связи", ок: м.наЛинии === 0, факт: String(м.наЛинии)});
  t.push({имя:п+"подписи не налезают (ни друг на друга, ни на ноды)", ок: м.подписи === 0, факт: м.подписи + " пар"});
  t.push({имя:п+"не слишком компактно и не слишком громоздко", ок: м.площадь >= 4 && м.площадь <= 22 && м.мин >= 30,
          факт: Math.round(м.W) + "×" + Math.round(м.H) + ", " + м.площадь.toFixed(1) + " тыс. px² на ноду (норма 4–22), ближайшие ноды " + Math.round(м.мин) + " px (≥30)"});
  // уровни: у развилки дети ниже (td) или дальше от корня в своей стороне (hz); у змейки цепочки — свои правила
  let неТам = 0; const ряд = [];
  связи.forEach(([a, b]) => { const дд = связи.filter(l => l[0] === a).length; if (дд < 2) return; const pa = цел.get(a), pb = цел.get(b); if (!pa || !pb) return;
    const плохо = реж === "td" ? pb.y < pa.y + 50 : Math.abs(pb.x) < Math.abs(pa.x) + 100 || (a !== кор.id && Math.sign(pb.x) !== Math.sign(pa.x));
    if (плохо) { неТам++; if (ряд.length < 3) ряд.push(поId(a).title + " → " + поId(b).title); } });
  t.push({имя:п+(реж === "td" ? "дети ниже родителя" : "дети дальше родителя от корня, в его стороне"), ок: неТам === 0, факт: неТам + (ряд.length ? " — " + ряд.join(", ") : "")});
  if (реж === "hz") { const стороны = new Set(ветки.map(в => Math.sign(цел.get(в.id).x)));
    t.push({имя:п+"ветки корня по обе стороны", ок: стороны.size === 2, факт: [...стороны].join(" ")}); }
  const цв = ветки[ветки.length - 2], цц = цел.get(цв.id);
  const цепьМакс = свои.filter(n => /^ярус-звено/.test(n.title)).reduce((m, n) => Math.max(m, Math.hypot(цел.get(n.id).x - цц.x, цел.get(n.id).y - цц.y)), 0);
  t.push({имя:п+"цепочка сворачивается змейкой", ок: цепьМакс > 0 && цепьМакс <= 520, факт: "дальнее звено в " + Math.round(цепьМакс) + " px от начала (прямой было бы ~1000)"});
  const лист = свои.find(n => /^ярус-лист 1-0/.test(n.title));
  undoStep(); await ж(120);
  t.push({имя:п+"откат одним шагом снимает дома", ок: поId(лист.id).hx == null, факт: "hx после отката: " + поId(лист.id).hx});
  graph.selNodes.clear(); graph._paintSel();
}

// РЕЖИМ ЗАПОМИНАЕТСЯ; «кустами» — умолчание и в файл не пишется
tidyModeSet("hz");
const запомнил = S.settings.graphTidyMode === "hz";
tidyModeSet("bush");
t.push({имя:"режим запоминается в S.settings, умолчание не пишется", ок: запомнил && !("graphTidyMode" in S.settings), факт: "после bush: " + S.settings.graphTidyMode});
render(); await ж(200);
t.push({имя:"в меню «…» три режима «весь граф»", ок: document.querySelectorAll("#g-more-menu [data-tidy-mode]").length === 3, факт: ""});

// ВЕСЬ ГРАФ: деревья областей разводятся полкой и не лежат друг на друге
for (const реж of ["td", "hz", "bush"]) {
  const ок = graph._tidyAll(реж); await ж(150);
  const все = S.items.filter(i => graph.byId[i.id]);
  const цел = цели(все);
  // дерево ноды — по цепочке владельцев до области или до ноды без владельца
  const чьё = it => { let x = it, шаг = 0; while (x && шаг++ < 60) { const oo = homeOwner(x); if (!oo) return x.id; if (!S.items.includes(oo)) return oo.id; x = oo; } return "?"; };
  const рамки = new Map();
  все.forEach(it => { const p = цел.get(it.id); if (!p) return; const к = чьё(it); const r = рамки.get(к) || {x0:1e9, y0:1e9, x1:-1e9, y1:-1e9, n:0};
    r.x0 = Math.min(r.x0, p.x); r.x1 = Math.max(r.x1, p.x); r.y0 = Math.min(r.y0, p.y); r.y1 = Math.max(r.y1, p.y); r.n++; рамки.set(к, r); });
  S.areas.forEach(a => { const r = рамки.get(a.id); if (r && a.hx != null) { r.x0 = Math.min(r.x0, a.hx); r.x1 = Math.max(r.x1, a.hx); r.y0 = Math.min(r.y0, a.hy); r.y1 = Math.max(r.y1, a.hy); } });
  const деревья = [...рамки.values()].filter(r => r.n >= 3);
  let наложились = 0;
  for (let i = 0; i < деревья.length; i++) for (let j = i + 1; j < деревья.length; j++) { const a = деревья[i], b = деревья[j];
    if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) наложились++; }
  t.push({имя:"весь граф " + tidyModeInfo(реж).label.toLowerCase() + ": отработал, деревья не накрывают друг друга", ок: ок === true && (реж === "bush" || наложились === 0),
          факт: "целей " + цел.size + " из " + все.length + ", деревьев " + деревья.length + ", пересеклись рамками " + наложились + (реж === "bush" ? " (у кустов рамка грубая — только отчёт)" : "")});
  undoStep(); await ж(150);
}

deletePack(свои.map(n => n.id));
S.settings.graphHome = _был.дом; S.settings.graphSnap = _был.сетка;
if (_был.реж) S.settings.graphTidyMode = _был.реж; else delete S.settings.graphTidyMode;
render(); await ж(150);
t.push({имя:"за собой убрано", ок: !S.items.some(i => /^ярус-/.test(i.title || "")), факт: ""});
return t;
