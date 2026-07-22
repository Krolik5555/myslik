// Полотно: создание, связи, удаление, отмена, выравнивание, закрытие.
// Каждая проверка здесь — след от реального бага: стрелки пропадали из-за проглоченной
// комментарием строки, отмены не существовало вовсе, Esc закрывал полотно вместо снятия выделения.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const $$ = s => document.querySelectorAll(s);

// перехватываем экземпляр редактора при монтировании
let fe = null;
const origMount = FlowEditor.prototype.mount;
FlowEditor.prototype.mount = function(){ fe = this; return origMount.call(this); };

const схема = addItem({kind:"flow", title:"Проверка полотна"});
openFlowEditor(схема);
await ж(400);
FlowEditor.prototype.mount = origMount;

t.push({имя:"полотно открылось", ок: !!document.querySelector(".flow-screen") && !!fe,
        факт: fe ? "блоков: " + fe.f.blocks.length : "редактор не перехвачен"});
if (!fe) return t;

const сцена = document.querySelector(".flow-stage");
сцена.setPointerCapture = () => {}; сцена.releasePointerCapture = () => {};
const жест = (эл, тип, x, y, доп={}) => эл.dispatchEvent(new PointerEvent(тип,
  {clientX:x, clientY:y, bubbles:true, cancelable:true, pointerId:1, button:0, buttons:1, ...доп}));

t.push({имя:"подсказка по управлению видна",
        ок: getComputedStyle(document.querySelector(".flow-hint")).display !== "none", факт:""});

// блоки
fe.addBlockAt("proc", 200, 200); document.activeElement.blur();
fe.addBlockAt("decision", 500, 200); document.activeElement.blur();
await ж(120);
const блоки = fe.f.blocks.filter(b => b.type !== "terminal");
t.push({имя:"блоки создаются", ок: блоки.length === 2, факт:"всего в схеме: " + fe.f.blocks.length});

// связь Alt-протяжкой (привычный жест из графа)
const [б1, б2] = блоки;
const э1 = document.querySelector(`.flow-block[data-id="${б1.id}"]`);
const э2 = document.querySelector(`.flow-block[data-id="${б2.id}"]`);
const п1 = э1.getBoundingClientRect(), п2 = э2.getBoundingClientRect();
const былоX = б1.x;
жест(э1, "pointerdown", п1.left+40, п1.top+20, {altKey:true}); await ж(40);
жест(сцена, "pointermove", п2.left+40, п2.top+20, {altKey:true}); await ж(40);
жест(сцена, "pointerup", п2.left+40, п2.top+20, {altKey:true}); await ж(80);
t.push({имя:"Alt+протяжка рисует стрелку", ок: fe.f.edges.length === 1, факт:"связей: " + fe.f.edges.length});
t.push({имя:"Alt+протяжка не таскает блок", ок: б1.x === былоX, факт:"x: " + б1.x});

// стрелки реально в DOM (а не только в данных)
fe.drawEdges(); await ж(60);
t.push({имя:"стрелки отрисованы", ок: $$(".fe-line").length === fe.f.edges.length,
        факт: $$(".fe-line").length + " из " + fe.f.edges.length});

// перетаскивание
const доX = б2.x;
жест(э2, "pointerdown", п2.left+30, п2.top+20); await ж(30);
жест(сцена, "pointermove", п2.left+150, п2.top+90); await ж(40);
жест(сцена, "pointerup", п2.left+150, п2.top+90); await ж(80);
t.push({имя:"блок перетаскивается", ок: б2.x !== доX, факт:"x: " + доX + " → " + б2.x});

// удаление и отмена
const былоБлоков = fe.f.blocks.length;
fe._clearSel(); fe._select(б2.id); fe.deleteSelection(); await ж(80);
const послеУдаления = fe.f.blocks.length;
fe.undo(); await ж(100);
t.push({имя:"Delete удаляет выделенное", ок: послеУдаления === былоБлоков - 1,
        факт: былоБлоков + " → " + послеУдаления});
t.push({имя:"Ctrl+Z возвращает удалённое", ок: fe.f.blocks.length === былоБлоков,
        факт:"стало: " + fe.f.blocks.length});
t.push({имя:"после отмены блоки на экране", ок: $$(".flow-block").length === fe.f.blocks.length,
        факт: $$(".flow-block").length + " в DOM"});

// выравнивание
const рядок = fe.f.blocks.slice(0, 3);
рядок.forEach((b, i) => { b.x = 100 + i*180; b.y = 100 + i*40; });
fe._align(рядок, "top"); await ж(60);
t.push({имя:"выравнивание по верху", ок: new Set(рядок.map(b => b.y)).size === 1,
        факт: рядок.map(b => b.y).join(", ")});

// рамка забирает блоки, оказавшиеся внутри
fe.addBlockAt("frame", 100 + 180, 120); await ж(100);
const рамка = fe.f.blocks.find(b => b.type === "frame");
t.push({имя:"новая рамка забирает содержимое",
        ок: fe.f.blocks.some(b => b.parent === рамка.id),
        факт:"детей: " + fe.f.blocks.filter(b => b.parent === рамка.id).length});

// Escape разбирается по шагам. Сначала — выход из правки текста: создание блока сразу ставит
// курсор в подпись, и Esc в этот момент обязан лишь снять фокус, ничего больше не трогая.
// шлём клавишу туда, где стоит фокус, — как это делает настоящая клавиатура;
// отправка в document мимо сфокусированного элемента даёт неверную картину
const esc = () => (document.activeElement || document).dispatchEvent(new KeyboardEvent("keydown",
  {key:"Escape", code:"Escape", bubbles:true, cancelable:true}));
fe._selectMany(fe.f.blocks.map(b => b.id), false); await ж(40);
const вТексте = document.activeElement && document.activeElement.classList.contains("fb-title");
if (вТексте){
  esc(); await ж(60);
  t.push({имя:"Esc в тексте снимает фокус, не трогая выделение",
          ок: !document.activeElement.classList.contains("fb-title") && fe.selSet.size > 0,
          факт:"выделено: " + fe.selSet.size});
}
esc(); await ж(80);
t.push({имя:"Esc снимает выделение, не закрывая", ок: fe.selSet.size === 0 && !!document.querySelector(".flow-screen"),
        факт:"выделено: " + fe.selSet.size});

// закрытие возвращает в вид и перерисовывает его
fe.close(); await ж(150);
t.push({имя:"закрытие возвращает к заметкам",
        ок: !document.querySelector(".flow-screen") && document.querySelector("#overlay-root").children.length === 0,
        факт:"вид: " + view});

// убираем за собой
hardDeleteItem(схема.id); render();
return t;
