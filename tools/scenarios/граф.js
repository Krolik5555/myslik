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

/* ===== наезд связью на ноду во время перетаскивания =====
   Человек тащит ноду так, что её связь ложится на чужую. Раньше узел метался: физика его
   выталкивает, рука давит снова. Отталкивание при этом отключать нельзя — иначе ноды просто
   лежали бы на линиях, — поэтому во время драга оно мягче, а после отпускания работает в полную. */
{
  const A = addItem({kind:"task", title:"наездА"}); A.x = 5200; A.y = 5000;
  const B = addItem({kind:"task", title:"наездБ"}); B.x = 5600; B.y = 5000;
  const Р = addItem({kind:"task", title:"наездРодитель"}); Р.x = 5400; Р.y = 5220;
  const Ж = addItem({kind:"task", title:"наездЖертва"}); Ж.x = 5400; Ж.y = 5130;
  S.links.push([A.id, B.id, 1], [Р.id, Ж.id, 1]);
  recomputeHierarchy(); graph.build();

  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && у(Ж.id)) {
    const а = у(A.id), б = у(B.id), ж = у(Ж.id);
    а.fixed = true; у(Р.id).fixed = true;
    а.x = 5200; а.y = 5000; б.x = 5600; б.y = 5000; у(Р.id).x = 5400; у(Р.id).y = 5220; ж.x = 5400; ж.y = 5130;
    const св = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const дист = () => { const ex = б.x-а.x, ey = б.y-а.y, L2 = ex*ex+ey*ey || 1;
      let к = ((ж.x-а.x)*ex + (ж.y-а.y)*ey) / L2; к = Math.max(0, Math.min(1, к));
      return Math.hypot(ж.x-(а.x+ex*к), ж.y-(а.y+ey*к)); };

    // рука водит ноду туда-сюда около жертвы
    graph.drag = б;
    const прогибы = [], игреки = [];
    for (let i = 0; i < 240; i++) {
      б.y = 5000 + 120 + Math.sin(i*0.35)*28; б.vx = 0; б.vy = 0;
      graph.alpha = Math.max(graph.alpha, 0.4);
      graph._tick(true);
      прогибы.push(св && св._bendC ? Math.hypot(св._bendC.ox, св._bendC.oy) : 0);
      игреки.push(ж.y);
    }
    graph.drag = null;

    let миганий = 0;
    for (let i = 1; i < прогибы.length; i++) if ((прогибы[i-1] === 0) !== (прогибы[i] === 0)) миганий++;
    let разворотов = 0;
    for (let i = 2; i < игреки.length; i++) { const d1 = игреки[i-1]-игреки[i-2], d2 = игреки[i]-игреки[i-1];
      if (d1*d2 < 0 && Math.abs(d2) > 0.3) разворотов++; }
    t.push({имя:"под курсором нода не мечется", ок: разворотов === 0, факт:"разворотов " + разворотов});
    t.push({имя:"дуга не мигает у границы зазора", ок: миганий <= 2, факт:"переключений " + миганий});

    // отпустили — отталкивание снова в полную силу и уводит ноду с линии
    graph.alpha = 0.4;
    for (let i = 0; i < 250; i++) graph._tick(true);
    t.push({имя:"после отпускания нода уходит с линии", ок: дист() >= ж.r + 18,
            факт:"дистанция " + дист().toFixed(0) + " при зазоре " + (ж.r+18).toFixed(0)});
    graph.nodes.forEach(n => n.fixed = false);
  }
  [A, B, Р, Ж].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== крупный узел не дёргается под курсором, но вне драга ездит свободно =====
   Водишь нодой вдоль луча хаба — обратные силы приходят на его конец и складываются, и хаб
   мечется. Предел шага для тяжёлых узлов включается ТОЛЬКО на время перетаскивания: постоянное
   ограничение мешало хабу доехать до равновесия, пока физика не остыла. */
{
  const создать = () => {
    const ц = addItem({kind:"task", title:"хабЦентр"}); ц.x = 8000; ц.y = 8000;
    const ветки = [];
    for (let i = 0; i < 10; i++) { const в = addItem({kind:"task", title:"хабВ"+i});
      const a = i/10*Math.PI*2; в.x = 8000 + Math.cos(a)*260; в.y = 8000 + Math.sin(a)*260;
      S.links.push([ц.id, в.id, 1]); ветки.push(в); }
    const Ж = addItem({kind:"task", title:"хабЖертва"}); Ж.x = 8000; Ж.y = 7850;
    recomputeHierarchy(); graph.build();
    const у = id => graph.byId[id];
    ветки.forEach(в => { if (у(в.id)) у(в.id).fixed = true; });
    return {ц: у(ц.id), Ж: у(Ж.id), ветки: ветки.map(в => у(в.id)), все: [ц, ...ветки, Ж]};
  };

  const с1 = создать();
  if (с1.ц && с1.Ж && с1.ветки[2]) {
    const {ц, Ж} = с1, в = с1.ветки[2];
    graph.drag = Ж;
    const ряд = [];
    for (let i = 0; i < 300; i++) {
      const u = 0.35 + 0.3*Math.sin(i*0.5);
      Ж.x = ц.x + (в.x-ц.x)*u + 3; Ж.y = ц.y + (в.y-ц.y)*u + 3; Ж.vx = 0; Ж.vy = 0;
      graph.alpha = Math.max(graph.alpha, 0.4);
      graph._tick(true);
      ряд.push({x: ц.x, y: ц.y});
    }
    graph.drag = null;
    let максШаг = 0;
    for (let i = 1; i < ряд.length; i++) максШаг = Math.max(максШаг, Math.hypot(ряд[i].x-ряд[i-1].x, ряд[i].y-ряд[i-1].y));
    t.push({имя:"крупный узел не дёргается под курсором", ок: максШаг < 3.5,
            факт:"макс. шаг " + максШаг.toFixed(2) + " px за кадр"});
  }
  с1.все.forEach(n => hardDeleteItem(n.id));

  const с2 = создать();
  if (с2.ц) {
    const g = с2.ц;
    g.x += 800; g.y += 700; g.vx = 0; g.vy = 0;
    graph.alpha = 1;
    for (let i = 0; i < 1500; i++) { graph._tick(true); if (graph.alpha === 0) break; }
    let x = 0, y = 0, n = 0;
    graph.nodes.forEach(v => { if (v !== g && с2.ветки.indexOf(v) >= 0) { x += v.x; y += v.y; n++; } });
    const до = n ? Math.hypot(g.x - x/n, g.y - y/n) : 999;
    t.push({имя:"вне драга тяжёлый узел доезжает до равновесия", ок: до < 60,
            факт:"остановился в " + до.toFixed(0) + " px от центра своих веток"});
  }
  с2.все.forEach(n => hardDeleteItem(n.id));

  /* Главный случай: тащат СОСЕДНЮЮ ноду и давят ею на связь, которая крепится к крупному узлу.
     Толчки приходят на дальний конец каждый кадр, и хаб мелко трясётся — шаг маленький, но
     направление меняется десятки раз. Гасится вязкостью, которая включается только при драге. */
  const с3 = создать();
  if (с3.ц && с3.Ж && с3.ветки[1]) {
    const {ц, Ж} = с3, в = с3.ветки[1];
    const Р = addItem({kind:"task", title:"хабРодительСоседа"}); Р.x = 8300; Р.y = 7750;
    S.links.push([Р.id, Ж.ref.id, 1]);          // у соседа появляется своя связь
    recomputeHierarchy(); graph.build();
    const у = id => graph.byId[id];
    const ц2 = у(ц.ref.id), Ж2 = у(Ж.ref.id), в2 = у(в.ref.id);
    if (ц2 && Ж2 && в2) {
      с3.ветки.forEach(x => { const n = у(x.ref.id); if (n) n.fixed = true; });
      if (у(Р.id)) у(Р.id).fixed = true;
      graph.drag = Ж2;
      const ряд = [];
      for (let i = 0; i < 300; i++) {
        const u = 0.4 + 0.25*Math.sin(i*0.45);
        Ж2.x = ц2.x + (в2.x-ц2.x)*u + 4; Ж2.y = ц2.y + (в2.y-ц2.y)*u + 4; Ж2.vx = 0; Ж2.vy = 0;
        graph.alpha = Math.max(graph.alpha, 0.4);
        graph._tick(true);
        ряд.push({x: ц2.x, y: ц2.y});
      }
      graph.drag = null;
      let макс = 0;
      for (let i = 1; i < ряд.length; i++) макс = Math.max(макс, Math.hypot(ряд[i].x-ряд[i-1].x, ряд[i].y-ряд[i-1].y));
      // до вязкости тот же прогон давал 7.4 px за кадр — порог ловит возврат к дрожи
      t.push({имя:"давят соседней нодой — хаб почти не шевелится", ок: макс < 2.5,
              факт:"макс. шаг " + макс.toFixed(2) + " px за кадр"});
      graph.nodes.forEach(n => n.fixed = false);
    }
    hardDeleteItem(Р.id);
  }
  с3.все.forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== копия ноды не прицепляется к области сама =====
   Флаг «область унаследована» (areaAuto) при копировании терялся, и вставленная нода получала
   область как СВОЮ — а значит и отдельный луч к хабу, которого у оригинала не было. */
{
  const обл = S.areas[0] && S.areas[0].id;
  if (обл) {
    const Р = addItem({kind:"task", title:"копР"}); Р.x = 9000; Р.y = 9000; Р.area = обл; Р.areaAuto = false;
    const Д = addItem({kind:"task", title:"копД"}); Д.x = 9120; Д.y = 9080;
    S.links.push([Р.id, Д.id, 1]);
    recomputeHierarchy(); graph.build();
    const лучей = () => graph.links.filter(l => !l.manual).length;

    // копируем ТОЛЬКО ребёнка, который область наследует
    const было = лучей();
    graph.selNodes = new Set([Д.id]);
    graph.copySelection(); graph.pasteClip();
    recomputeHierarchy();
    const копия = S.items.filter(i => !i.deleted && i.title === "копД" && i.id !== Д.id)[0];
    t.push({имя:"копия унаследованной ноды не липнет к области",
            ок: !!копия && копия.areaAuto !== false && лучей() === было,
            факт:"лучей к хабу было " + было + ", стало " + лучей()});

    // копия ветки целиком: у копии родителя область СВОЯ, у копии ребёнка — унаследованная
    const было2 = лучей();
    graph.selNodes = new Set([Р.id, Д.id]);
    graph.copySelection(); graph.pasteClip();
    recomputeHierarchy();
    const копР = S.items.filter(i => !i.deleted && i.title === "копР" && i.id !== Р.id)[0];
    const копД = S.items.filter(i => !i.deleted && i.title === "копД" && i.id !== Д.id && i.id !== (копия||{}).id)[0];
    t.push({имя:"копия ветки сохраняет, кому область своя, а кому наследуется",
            ок: !!копР && копР.areaAuto !== true && !!копД && копД.areaAuto === true && лучей() === было2 + 1,
            факт:"лучей " + было2 + " -> " + лучей()});

    S.items.filter(i => !i.deleted && /^коп[РД]$/.test(i.title || "")).forEach(i => hardDeleteItem(i.id));
    recomputeHierarchy(); graph.build();
  }
}

/* ===== камера переживает перезапуск =====
   graphCam живёт только в памяти вкладки, поэтому после перезапуска приложения граф открывался
   в стороне от нод. Пишем камеру в настройки (с задержкой — _applyTransform зовётся на каждый
   кадр пана) и поднимаем её при создании графа. */
{
  const было = {tx: graph.tx, ty: graph.ty, zoom: graph.zoom};
  graph.tx = -1234; graph.ty = 567; graph.zoom = 0.75; graph._applyTransform();
  await ж(900);                                   // ждём отложенную запись
  const вНастройках = S.settings.graphCam;
  t.push({имя:"камера графа пишется в настройки",
          ок: !!вНастройках && Math.abs(вНастройках.tx + 1234) < 1 && Math.abs(вНастройках.zoom - 0.75) < 0.01,
          факт: JSON.stringify(вНастройках)});

  graphCam = null;                                // как после перезапуска: память вкладки пуста
  const свежий = new Graph(document.querySelector("#graph"));
  t.push({имя:"камера поднимается при создании графа",
          ок: Math.abs(свежий.tx + 1234) < 1 && Math.abs(свежий.ty - 567) < 1 && Math.abs(свежий.zoom - 0.75) < 0.01,
          факт: "tx " + Math.round(свежий.tx) + ", ty " + Math.round(свежий.ty) + ", zoom " + свежий.zoom.toFixed(2)});

  graph.tx = было.tx; graph.ty = было.ty; graph.zoom = было.zoom; graph._applyTransform();
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

    /* Прогиб инерционный (см. _easeBends), поэтому и появляется, и тает не мгновенно —
       прокручиваем кадры, а заодно меряем, нет ли рывков. */
    const прокрутить = n => { const шаги = [];
      for (let i = 0; i < n; i++) { graph._recalcBends(); graph._tick(true);
        шаги.push(св._bendC ? св._bendC.oy : 0); }
      let макс = 0;
      for (let i = 1; i < шаги.length; i++) макс = Math.max(макс, Math.abs(шаги[i] - шаги[i-1]));
      return макс; };

    у(П.id).x = -3000; у(П.id).y = -2994;              // почти на линии
    graph.alpha = 0;
    const рывокПоявления = прокрутить(60);
    const зазор = у(П.id).r + 16;
    t.push({имя:"связь обходит лежащую на ней ноду",
            ок: доКривой(у(П.id).x, у(П.id).y) >= зазор && /Q/.test(эл.getAttribute("d")),
            факт:"до кривой " + доКривой(у(П.id).x, у(П.id).y).toFixed(1) + " при зазоре " + зазор.toFixed(1)});
    t.push({имя:"прогиб нарастает без рывков", ок: рывокПоявления < 6,
            факт:"макс. шаг " + рывокПоявления.toFixed(2) + " px за кадр"});

    /* Дуга обязана считаться по ТЕМ ЖЕ координатам, по которым рисуется (с дрейфом). Пока это
       было не так, расстояние от НЕПОДВИЖНОЙ ноды до линии гуляло на 10 px — в тесном месте
       читалось как дрожание. Ноды тут зафиксированы, значит двигаться может только дрейф. */
    const ряд = [];
    for (let i = 0; i < 120; i++) { graph._tick(true);
      const L = эл.getTotalLength(); let m = 1e9;
      const nx = у(П.id).x + (у(П.id)._ix || 0), ny = у(П.id).y + (у(П.id)._iy || 0);
      for (let k = 0; k <= 30; k++) { const p = эл.getPointAtLength(L*k/30); m = Math.min(m, Math.hypot(p.x-nx, p.y-ny)); }
      ряд.push(m); }
    const размах = Math.max(...ряд) - Math.min(...ряд);
    t.push({имя:"дуга не гуляет от дрейфа", ок: размах < 1.5,
            факт:"размах расстояния до линии " + размах.toFixed(2) + " px"});

    у(П.id).y = -2940;                                  // помеха ушла
    const рывокУхода = прокрутить(80);
    t.push({имя:"без помехи связь снова прямая",
            ок: /L/.test(эл.getAttribute("d")) && !св._bendC, факт: эл.getAttribute("d")});
    t.push({имя:"прогиб тает без рывков", ок: рывокУхода < 6,
            факт:"макс. шаг " + рывокУхода.toFixed(2) + " px за кадр"});

    /* Перестроение графа (смена статуса задачи, цвета, новая связь) не должно распрямлять дуги:
       массив связей пересоздаётся целиком, и накопленный прогиб терялся — все линии отрастали
       заново, что читалось как рывок. Проверяем ПОСЛЕДНЕЙ: build() делает прежние ссылки на
       связь и её элемент недействительными. */
    у(П.id).y = -2994;                                  // помеха вернулась, дуга отросла
    прокрутить(60);
    const доBuild = св._bendC ? св._bendC.oy : 0;
    graph.build();
    const св2 = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const послеBuild = (св2 && св2._bendC) ? св2._bendC.oy : 0;
    t.push({имя:"перестроение не распрямляет дуги",
            ок: Math.abs(доBuild) > 1 && Math.abs(доBuild - послеBuild) < 2,
            факт:"прогиб " + доBuild.toFixed(1) + " -> " + послеBuild.toFixed(1)});
    graph.nodes.forEach(n => n.fixed = false);
  }
  [A, B, П].forEach(n => hardDeleteItem(n.id));
  recomputeHierarchy(); graph.build();
}

/* ===== свечение «в работе» вырезается по ФОРМЕ связи, включая прогиб =====
   Свечение стирается из-под линий, чтобы те не просвечивали. Пока вырез шёл по прямой, а связь
   гнулась, на светящейся ноде оставалась тёмная полоса по хорде: свечение стёрто, а линии там нет. */
{
  const A = addItem({kind:"task", title:"свечА", status:"doing"}); A.x = 260; A.y = 280;
  const B = addItem({kind:"task", title:"свечБ"}); B.x = 420; B.y = 280;   // коротко: связь внутри радиуса свечения
  const П = addItem({kind:"task", title:"свечП"}); П.x = 340; П.y = 284;
  S.links.push([A.id, B.id, 1]);
  recomputeHierarchy(); graph.build();

  const у = id => graph.byId[id];
  if (у(A.id) && у(B.id) && graph.glowCtx) {
    graph.nodes.forEach(n => n.fixed = true);
    у(A.id).x = 260; у(A.id).y = 280; у(B.id).x = 420; у(B.id).y = 280; у(П.id).x = 340; у(П.id).y = 284;
    graph.alpha = 0; graph.tx = 0; graph.ty = 0; graph.zoom = 1;
    for (let i = 0; i < 80; i++) graph._tick(true);
    graph._drawGlow();

    const cv = graph.glowCanvas, ctx = graph.glowCtx, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const альфа = (wx, wy) => { const x = Math.round(wx*dpr), y = Math.round(wy*dpr);
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return -1;
      return ctx.getImageData(x, y, 1, 1).data[3]; };
    const св = graph.links.find(l => (l.a === A.id && l.b === B.id) || (l.a === B.id && l.b === A.id));
    const bd = св && св._bendC;
    if (bd) {
      const px = 260 + 160*bd.t, cx = px + bd.ox*2, cy = 280 + bd.oy*2;
      const вершина = {x: (260 + 2*cx + 420)/4, y: (280 + 2*cy + 280)/4};
      t.push({имя:"свечение вырезано ПОД дугой, а не под хордой",
              ок: альфа(вершина.x, вершина.y) === 0 && альфа(вершина.x, 280) > 0,
              факт:"на дуге " + альфа(вершина.x, вершина.y) + ", на хорде " + альфа(вершина.x, 280)});
    } else {
      t.push({имя:"свечение вырезано ПОД дугой, а не под хордой", ок:false, факт:"связь не прогнулась"});
    }
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
