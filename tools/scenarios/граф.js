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

view = "notes"; render(); await ж(300);
t.push({имя:"граф создаётся", ок: !!graph && graph.nodes.length > 0,
        факт: graph ? graph.nodes.length + " узлов, " + graph.links.length + " связей" : "графа нет"});
if (!graph) return t;

// узлы паутины = неудалённые элементы + хабы областей
const живых = S.items.filter(i => !i.deleted).length;
t.push({имя:"в паутине только живые элементы",
        ок: graph.nodes.filter(n => n.type !== "hub").length <= живых,
        факт: graph.nodes.filter(n => n.type !== "hub").length + " из " + живых});

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

    у(П.id).x = -3000; у(П.id).y = -2994;              // почти на линии
    graph.alpha = 0; graph._recalcBends(); graph._tick(true);
    const зазор = у(П.id).r + 16;
    t.push({имя:"связь обходит лежащую на ней ноду",
            ок: доКривой(у(П.id).x, у(П.id).y) >= зазор && /Q/.test(эл.getAttribute("d")),
            факт:"до кривой " + доКривой(у(П.id).x, у(П.id).y).toFixed(1) + " при зазоре " + зазор.toFixed(1)});

    у(П.id).y = -2940;                                  // помеха ушла
    graph._recalcBends(); graph._tick(true);
    t.push({имя:"без помехи связь снова прямая",
            ок: /L/.test(эл.getAttribute("d")) && !св._bend, факт: эл.getAttribute("d")});
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

hardDeleteItem(мысль.id); render();
return t;
