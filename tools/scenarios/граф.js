// Граф-паутина: сборка, кадры, камера, лоток, уход с вкладки.
// Главная проверка тут — «ровно один запланированный кадр»: изменение размера окна однажды
// добавляло ещё один вечный цикл отрисовки поверх существующего, и граф считал физику
// в несколько потоков сразу.
const t = [];
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

hardDeleteItem(мысль.id); render();
return t;
