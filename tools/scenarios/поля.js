// Поля ноды (текст/картинка/доска) и шаблоны нод — fields.js.
// Проверяем то, что ломается молча: тяжёлое содержимое обязано лежать ВНЕ ноды (иначе снимок
// отката раздувается), копия поля обязана получать СВОИ ключи (иначе две ноды рисуют на одном
// холсте), удаление обязано уносить картинку и доску, высота врезки — переживать перезагрузку.
const t = [];
const ж = ms => new Promise(r => setTimeout(r, ms));
const ждать = async (усл, предел=25000) => { let n=0; while(n<предел && !усл()){ await ж(200); n+=200; } return усл(); };
const PNG = "data:image/png;base64,iVBORw0KGgo=";

/* ---------- санитайзер: чужой и подпорченный json ---------- */
const s1 = sanitizeState({
  items: [{id:"i1", kind:"note", title:"нода", fields:[
    {id:"f1", type:"text", name:"Что", value:"текст"},
    {type:"image", media:"m_ok"},
    {id:"f2", type:"board", h:5000},
    null,
    {type:"мусор", name:"x"}
  ]}],
  media: {m_ok:PNG, m_bad:"http://example.com/1.png", m_orphan:PNG},
  boards: {"fld_f2":{elements:[{type:"rectangle", id:"r1"}]}, "fld_нет":{elements:[{type:"rectangle", id:"r2"}]}}
});
const п1 = s1.items[0].fields;
t.push({имя:"мусор в полях отсеивается, тип чинится",
        ок: п1.length===4 && п1[3].type==="text" && п1.every(f=>typeof f.id==="string" && f.id),
        факт: "полей: "+п1.length+", типы: "+п1.map(f=>f.type).join(",")});
// высоту ЗАЖИМАЕМ, а не сбрасываем: растянутую руками плитку нельзя молча вернуть к дефолту
t.push({имя:"высота плитки зажата в пределы", ок: п1[2].gh===FIELD_H_MAX, факт:"gh="+п1[2].gh});
// у старого формата ширины были в процентах, а строки — по порядку; на колонках ширина это доля
// строки, а перенос строки — флаг br, поэтому проверяем ровно их
t.push({имя:"старые поля переносятся на колонки",
        ок: п1.every(f=>f.gw>=1 && f.gw<=GRID_COLS && f.gx===undefined && f.gy===undefined)
            && !п1[0].br,
        факт: п1.map(f=>"gw"+f.gw+(f.br?"|нс":"")).join(", ")});
t.push({имя:"картинка не по data: выкинута, живая осталась",
        ок: !s1.media.m_bad && s1.media.m_ok===PNG, факт:"ключей в media: "+Object.keys(s1.media).join(",")});
t.push({имя:"осиротевшие картинка и доска подметены",
        ок: !s1.media.m_orphan && !s1.boards["fld_нет"] && !!s1.boards["fld_f2"],
        факт:"boards: "+Object.keys(s1.boards).join(",")});
t.push({имя:"пустой список полей в ноде не хранится",
        ок: sanitizeState({items:[{id:"i9", kind:"note", fields:[]}]}).items[0].fields===undefined,
        факт:"fields после чистки: "+JSON.stringify(sanitizeState({items:[{id:"i8", kind:"note", fields:[]}]}).items[0].fields)});

// столкновение id полей между нодами: доска остаётся у первого хозяина, второй получает новый id
const s2 = sanitizeState({
  items: [{id:"a", kind:"note", fields:[{id:"общий", type:"board"}]},
          {id:"b", kind:"note", fields:[{id:"общий", type:"board"}]}],
  boards: {"fld_общий":{elements:[{type:"rectangle", id:"r1"}]}}
});
t.push({имя:"столкновение id полей не крадёт чужой холст",
        ок: s2.items[0].fields[0].id==="общий" && s2.items[1].fields[0].id!=="общий"
            && ((s2.boards["fld_общий"]||{}).elements||[]).length===1,
        факт: "id: "+s2.items[0].fields[0].id+" / "+s2.items[1].fields[0].id});

/* ---------- содержимое живёт вне ноды ---------- */
const нода = addItem({kind:"note", title:"Нода с полями"});
нода.fields = [fieldMake("text","Что сделать"), fieldMake("image","Эскиз"), fieldMake("board","Набросок")];
нода.fields[0].value = "первая строка";
нода.fields[1].media = fieldMediaPut(PNG);
S.boards[fieldBoardKey(нода.fields[2].id)] = {elements:[{type:"rectangle", id:"rr"}], files:{}, appState:{}, fromFlow:false};
persist();
t.push({имя:"картинка и доска поля лежат вне ноды",
        ок: JSON.stringify(нода).indexOf("base64") < 0 && !!S.media[нода.fields[1].media]
            && !!S.boards[fieldBoardKey(нода.fields[2].id)],
        факт: "вес ноды: "+JSON.stringify(нода).length+" симв."});
t.push({имя:"текст полей идёт в поиск и отчёт",
        ок: fieldsText(нода).indexOf("первая строка")>=0 && fieldsText(нода).indexOf("Что сделать")>=0,
        факт: fieldsText(нода).replace(/\n/g," / ")});

/* ---------- живая доска во врезке ----------
   Порог не наш, а вендорский: Excalidraw уходит в телефонный интерфейс, если ЕГО контейнер
   уже 730 px (и если ниже 500 при ширине меньше 1000). Проверяем на стенде нужного размера —
   в окне правки такой ширины взяться неоткуда. */
{
  const стенд = document.createElement("div");
  стенд.style.cssText = "position:fixed;left:0;top:0;width:1100px;height:320px;opacity:0.01;pointer-events:none;";
  const бокс = document.createElement("div");
  бокс.className = "fld-box fld-board"; бокс.style.cssText = "width:1100px;height:320px;";
  стенд.appendChild(бокс); document.body.appendChild(стенд);
  const узкий = document.createElement("div");
  узкий.style.cssText = "position:fixed;left:0;top:0;width:520px;height:220px;opacity:0.01;pointer-events:none;";
  document.body.appendChild(узкий);
  t.push({имя:"широкая врезка годится под живую доску, узкая — нет",
          ок: fieldBoardFits(бокс) && !fieldBoardFits(узкий), факт: "1100x320: "+fieldBoardFits(бокс)+", 520x220: "+fieldBoardFits(узкий)});
  узкий.remove();

  await fieldBoardStart(бокс, нода.fields[2], нода, ()=>{});
  await ждать(()=> typeof drawApi!=="undefined" && drawApi && бокс.querySelector("canvas"), 25000);
  const мобильный = !!бокс.querySelector(".excalidraw--mobile, .App-bottom-bar");
  t.push({имя:"во врезке доска живая и не телефонная",
          ок: !!бокс.querySelector("canvas") && !мобильный,
          факт: "холстов: "+бокс.querySelectorAll("canvas").length+", телефонная: "+мобильный});
  if(бокс.querySelector("canvas")){
    drawApi.updateScene({elements: ExcalidrawLib.convertToExcalidrawElements([{type:"rectangle", x:30, y:30, width:120, height:70}])});
    await ж(1300);
    t.push({имя:"нарисованное во врезке уезжает в доску поля",
            ок: ((S.boards[fieldBoardKey(нода.fields[2].id)]||{}).elements||[]).length>0,
            факт: "элементов: "+((S.boards[fieldBoardKey(нода.fields[2].id)]||{}).elements||[]).length});
  }
  fieldBoardStop(false);
  t.push({имя:"живая доска снимается вместе с врезкой",
          ок: typeof drawRoot==="undefined" || !drawRoot, факт: "корень React: "+(drawRoot?"остался":"снят")});
  стенд.remove();
}

/* ---------- копия поля получает свои ключи ---------- */
const пачка = fieldsPack(нода);
const копияПолей = fieldsUnpack(пачка);
const своиКлючи = копияПолей[1].media!==нода.fields[1].media
  && копияПолей[2].id!==нода.fields[2].id
  && !!S.boards[fieldBoardKey(копияПолей[2].id)]
  && S.boards[fieldBoardKey(копияПолей[2].id)]!==S.boards[fieldBoardKey(нода.fields[2].id)];
t.push({имя:"копия поля не делит холст и картинку с оригиналом", ок: своиКлючи,
        факт: "media: "+нода.fields[1].media+" → "+копияПолей[1].media});

/* ---------- удаление уносит содержимое ---------- */
const врем = addItem({kind:"note", title:"На удаление"});
врем.fields = [fieldMake("image","кар"), fieldMake("board","дос")];
врем.fields[0].media = fieldMediaPut(PNG);
S.boards[fieldBoardKey(врем.fields[1].id)] = {elements:[], files:{}, appState:{}, fromFlow:false};
const ключКартинки = врем.fields[0].media, ключДоски = fieldBoardKey(врем.fields[1].id);
hardDeleteItem(врем.id);
t.push({имя:"удаление ноды уносит картинки и доски её полей",
        ок: !S.media[ключКартинки] && !S.boards[ключДоски],
        факт: "остались: "+(S.media[ключКартинки]?"картинка ":"")+(S.boards[ключДоски]?"доска":"—")});

/* ---------- окно правки ---------- */
closeOverlays();
openItemEditor(нода);
await ж(400);
const блоки = () => document.querySelectorAll("#f-fields .fld");
// окно с полем-доской открывается шире обычного: иначе во врезке не порисуешь
t.push({имя:"окно правки с доской открывается широким",
        ок: document.querySelector(".modal").getBoundingClientRect().width>1000,
        факт: Math.round(document.querySelector(".modal").getBoundingClientRect().width)+" px"});
// доска поднимается САМА, без клика по плашке
{
  const жива = await ждать(()=>document.querySelector("#f-fields .fld-board canvas"), 25000);
  t.push({имя:"доска в поле поднимается сама, без клика", ок: !!жива,
          факт: жива?"холст на месте":"осталась плашка"});
  // клик по холсту НЕ должен пересобирать доску — иначе рисование сбрасывалось бы на каждом штрихе
  const холст = document.querySelector("#f-fields .fld-board canvas");
  document.querySelector("#f-fields .fld-board").click();
  await ж(400);
  t.push({имя:"клик по живой доске не пересобирает её",
          ок: document.querySelector("#f-fields .fld-board canvas")===холст,
          факт: document.querySelector("#f-fields .fld-board canvas")===холст?"тот же холст":"холст подменился"});
}
t.push({имя:"поля показаны в окне правки", ок: блоки().length===3,
        факт: "блоков: "+блоки().length+", названия: "+[...document.querySelectorAll("#f-fields .fld-name")].map(i=>i.textContent).join(",")});
// ширина плитки — доля строки, высота — пиксели
t.push({имя:"плитки получили доли строки и высоту",
        ок: нода.fields.every(f=>f.gw>=1 && f.gw<=GRID_COLS && f.gh>0) && нода.fields[2].gh===FIELD_BOARD_H_DEF,
        факт: нода.fields.map(f=>f.gw+"/12 × "+f.gh+"px").join(", ")});

/* Перетаскивание картинки во врезку. Кнопку «добавить картинку» здесь НЕ жмём: она открывает
   системный диалог выбора файла, и сценарий встал бы намертво. */
{
  const блок = [...document.querySelectorAll("#f-fields .fld")][1];
  const пусто = блок.querySelector(".fld-box");
  const бин = Uint8Array.from(atob(PNG.split(",")[1]), c=>c.charCodeAt(0));
  const файл = new File([бин], "скрин.png", {type:"image/png"});
  const dt = new DataTransfer(); dt.items.add(файл);
  пусто.dispatchEvent(new DragEvent("dragover", {bubbles:true, cancelable:true, dataTransfer:dt}));
  const подсветка = пусто.classList.contains("drop");
  пусто.dispatchEvent(new DragEvent("drop", {bubbles:true, cancelable:true, dataTransfer:dt}));
  await ж(400);
  const img = [...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-img");
  t.push({имя:"картинку можно бросить во врезку мышью",
          ок: подсветка && !!img && (img.src||"").indexOf("data:image/")===0,
          факт: "подсветка: "+подсветка+", картинка: "+(img?"вставлена":"нет")});
}

/* Ctrl+V во врезку под курсором: снимок экрана попадает в поле без промежуточного файла.
   Врезка не фокусируется (это div), поэтому paste ловится глобально, а «куда» помнит наведение.
   Проверяем по РАЗМЕТКЕ, а не по ноде: окно правки держит черновик, и в ноду он уедет только
   по «Сохранить». */
{
  const плитка=[...document.querySelectorAll("#f-fields .fld")][1];
  const врезка=плитка.querySelector(".fld-box");
  const былSrc=(плитка.querySelector(".fld-img")||{}).src||"";
  // настоящий однопиксельный png, а не обрезанный: иначе подгонка плитки под пропорции молчит
  const бин=Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c=>c.charCodeAt(0));
  const dt=new DataTransfer(); dt.items.add(new File([бин],"буфер.png",{type:"image/png"}));
  /* Точку берём в ВИДИМОЙ части врезки: цель ищется через elementFromPoint, а он смотрит
     только на экран — центр плитки, уехавшей под нижний край панели, вернул бы пусто. */
  const мышьНа=узел=>{
    узел.scrollIntoView({block:"center"});
    const r=узел.getBoundingClientRect();
    const x=Math.round(Math.min(Math.max(r.left+r.width/2, 1), innerWidth-2));
    const y=Math.round(Math.min(Math.max(r.top+r.height/2, 1), innerHeight-2));
    document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true, clientX:x, clientY:y}));
    return document.elementFromPoint(x,y);
  };
  мышьНа(врезка);
  const событие=new ClipboardEvent("paste",{bubbles:true, cancelable:true, clipboardData:dt});
  document.body.dispatchEvent(событие);
  await ж(600);
  const сталSrc=([...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-img")||{}).src||"";
  t.push({имя:"картинка вставляется во врезку под курсором по Ctrl+V",
          ок: событие.defaultPrevented && сталSrc.indexOf("data:image/")===0 && сталSrc!==былSrc,
          факт: "перехвачено: "+событие.defaultPrevented+"; картинка сменилась: "+(сталSrc!==былSrc)});

  /* Настоящий Ctrl+V порождает событие только у РЕДАКТИРУЕМОГО элемента: над картинкой фокус
     обычно «нигде», и система вставки просто не начинает. Поэтому под курсором врезки фокус
     держит невидимый приёмник — без него жест молчал, хотя обработчик стоял. */
  {
    // фокус в поле ввода (в окне правки он там по умолчанию) — Ctrl+V всё равно обязан
    // забрать его приёмнику: курсор над врезкой и есть намерение вставить картинку сюда
    мышьНа([...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-box"));
    const заголовок=$("#f-title"); заголовок.focus(); заголовок.value="имя";
    заголовок.selectionStart=заголовок.selectionEnd=4;
    document.dispatchEvent(new KeyboardEvent("keydown",{key:"v",ctrlKey:true,bubbles:true}));
    t.push({имя:"Ctrl+V над врезкой забирает фокус даже у поля ввода",
            ок: document.activeElement && document.activeElement.classList.contains("fld-paste-sink"),
            факт: "в фокусе: "+((document.activeElement||{}).className||(document.activeElement||{}).tagName||"?")});

    // но если в буфере ТЕКСТ, а не картинка, — фокус и сам текст возвращаются хозяину
    const dtТекст=new DataTransfer(); dtТекст.setData("text/plain","хвост");
    const сТекстом=new ClipboardEvent("paste",{bubbles:true, cancelable:true, clipboardData:dtТекст});
    document.body.dispatchEvent(сТекстом);
    await ж(120);
    t.push({имя:"текст из буфера не пропадает: возвращается в поле ввода",
            ок: document.activeElement===заголовок && заголовок.value==="имяхвост",
            факт: "в поле: «"+заголовок.value+"», фокус вернулся: "+(document.activeElement===заголовок)});
    заголовок.value="Нода с полями";
    заголовок.dispatchEvent(new Event("input",{bubbles:true}));
  }

  // курсор ушёл со врезки — вставка больше не должна попадать в поле
  document.dispatchEvent(new PointerEvent("pointermove",{bubbles:true, clientX:2, clientY:2}));
  const dt2=new DataTransfer(); dt2.items.add(new File([бин],"мимо.png",{type:"image/png"}));
  const мимо=new ClipboardEvent("paste",{bubbles:true, cancelable:true, clipboardData:dt2});
  document.body.dispatchEvent(мимо);
  await ж(300);
  const послеSrc=([...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-img")||{}).src||"";
  t.push({имя:"без наведения вставка в поле не уходит",
          ок: !мимо.defaultPrevented && послеSrc===сталSrc, факт:"перехвачено: "+мимо.defaultPrevented});
}

// клик по врезке картинки НЕ должен открывать системный диалог — иначе приложение зависало бы
// на модальном окне проводника при каждом попадании мимо
t.push({имя:"клик по картинке не лезет в проводник",
        ок: ![...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-box").onclick,
        факт: "обработчик клика: "+([...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-box").onclick?"есть":"нет")});

/* Содержимое копируется ПРАВОЙ КНОПКОЙ по полю — кнопок копирования и дублирования в полосе
   нет вовсе: первая отнимала место на каждом поле, вторая оказалась не нужна. */
{
  const было = блоки().length;
  const блок = [...document.querySelectorAll("#f-fields .fld")][0];
  const текст = блок.querySelector(".fld-text");
  блок.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
  текст.value = "строка для буфера";
  текст.dispatchEvent(new Event("input",{bubbles:true}));
  await ж(60);
  const меню = new MouseEvent("contextmenu",{bubbles:true, cancelable:true});
  текст.dispatchEvent(меню);
  await ж(400);
  // сам буфер не читаем: readText в WebView2 без фокуса окна висит без ответа и вешает прогон
  const тост = (document.querySelector("#toast")||{}).textContent||"";
  t.push({имя:"правая кнопка по полю копирует содержимое, кнопок копирования нет",
          ок: блоки().length===было && меню.defaultPrevented
              && !document.querySelector('#f-fields [data-fa="dup"], #f-fields [data-fa="copy"]')
              && тост.indexOf("копирован")>=0,
          факт: "меню перехвачено: "+меню.defaultPrevented+"; тост: «"+тост.trim()+"»"});
}

// тот же жест на общем описании: оно живёт не в fields, но человеку это неважно
{
  $("#f-body").value = "описание для буфера";
  const меню = new MouseEvent("contextmenu",{bubbles:true, cancelable:true});
  $("#f-body").dispatchEvent(меню);
  await ж(300);
  const тост = (document.querySelector("#toast")||{}).textContent||"";
  t.push({имя:"правая кнопка копирует и общее описание",
          ок: меню.defaultPrevented && тост.indexOf("копирован")>=0,
          факт: "меню перехвачено: "+меню.defaultPrevented+"; тост: «"+тост.trim()+"»"});
}

/* Клик по полосе (без перетаскивания) сворачивает поле и разворачивает обратно. */
{
  const полоса = ()=>[...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-bar");
  const клик = ()=>{ полоса().dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})); };
  клик(); await ж(250);
  const свёрнуто = !![...document.querySelectorAll("#f-fields .fld")][1].classList.contains("off")?1:null
                && ![...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-box");
  клик(); await ж(250);
  const развернули = ![...document.querySelectorAll("#f-fields .fld")][1].classList.contains("off")?1:null
                  && !![...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-box");
  t.push({имя:"клик по полосе сворачивает и разворачивает поле",
          ок: свёрнуто && развернули, факт:"свернулось: "+свёрнуто+", развернулось: "+развернули});
}

// правка названия + сохранение
/* Название правится ДВОЙНЫМ кликом: одиночный отдан перетаскиванию — за шапку берут плитку. */
{
  const подпись = [...document.querySelectorAll("#f-fields .fld")][1].querySelector(".fld-name");
  подпись.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
  await ж(120);
  const ввод = [...document.querySelectorAll("#f-fields .fld")][1].querySelector("input.fld-name-edit");
  t.push({имя:"название поля правится по двойному клику",
          ок: !!ввод, факт: ввод?"поле ввода открылось":"осталась подпись"});
  if(ввод){
    ввод.value = "Переименовано";
    ввод.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));
    await ж(200);
  }
}
$("#f-save").click();
await ж(250);
t.push({имя:"поля уезжают в ноду по «Сохранить»",
        ок: (нода.fields||[]).length===3 && нода.fields[1].name==="Переименовано",
        факт: "полей в ноде: "+(нода.fields||[]).length+", названия: "+(нода.fields||[]).map(f=>f.name).join(",")});

// «Отмена» не должна оставлять черновик в ноде
openItemEditor(нода);
await ж(300);
document.querySelector('#f-fields [data-fadd="text"]').click();
await ж(80);
const былоВОкне = блоки().length;
$("#f-cancel").click();
await ж(150);
t.push({имя:"«Отмена» не оставляет добавленное поле в ноде",
        ок: былоВОкне===4 && (нода.fields||[]).length===3,
        факт: "в окне было "+былоВОкне+", в ноде "+(нода.fields||[]).length});

/* ---------- раскладка: строки → колонки → стопка (модель Notion) ----------
   Бросок на ЛЕВЫЙ или ПРАВЫЙ край плитки открывает новую колонку с этой стороны, бросок в
   середину — кладёт ВЫШЕ или НИЖЕ цели в ЕЁ колонке (в колонке плиток может быть сколько
   угодно), бросок в промежуток между строками выносит плитку своей строкой. Одноуровневая
   раскладка этого не выражала: рядом с высокой картинкой помещалась ровно одна плашка, а
   место под ней оставалось мёртвым. */
{
  const кол = addItem({kind:"note", title:"Колонки"});
  кол.fields = [fieldMake("text","А"), fieldMake("text","Б"), fieldMake("text","В")];
  persist(); closeOverlays(); openNoteReader(кол); await ж(500);
  const host = document.querySelector("#nr-fields");
  const узел = имя => [...host.querySelectorAll(".fld")]
    .find(b=>(b.querySelector(".fld-name")||{}).textContent===имя);
  const тащ = async (кого, куда, дx, дy)=>{
    const б=узел(кого), цн=узел(куда);
    if(!б || !цн){ t.push({имя:"плитка «"+кого+"» или «"+куда+"» найдена", ок:false, факт:"нет в разметке"}); return false; }
    const ц=цн.getBoundingClientRect(), r=б.getBoundingClientRect();
    const x=ц.left+ц.width*дx, y=ц.top+ц.height*дy;
    б.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+20,button:0,pointerId:5}));
    window.dispatchEvent(new PointerEvent("pointermove",{clientX:x,clientY:y,button:0,pointerId:5}));
    await ж(120);
    const метка=[...host.querySelectorAll(".fld")].some(v=>/до|после|выше|ниже/.test(v.className));
    window.dispatchEvent(new PointerEvent("pointerup",{clientX:x,clientY:y,button:0,pointerId:5}));
    await ж(450);
    return метка;
  };
  const строк = ()=>host.querySelectorAll(".flds-row").length;
  const состав = ()=>fieldsLayout(кол.fields).map(с=>"["+с.map(к=>к.map(i=>
      кол.fields[i].name+":"+кол.fields[i].gw).join("+")).join(" | ")+"]").join(" ");
  // бросок в пустоту ниже всех строк: плитка обязана уехать своей строкой
  const внизСтрокой = async кого=>{
    const б=узел(кого); if(!б) return false;
    const строки=[...host.querySelectorAll(".flds-row")];
    const низ=строки[строки.length-1].getBoundingClientRect();
    const r=б.getBoundingClientRect();
    б.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+20,button:0,pointerId:6}));
    window.dispatchEvent(new PointerEvent("pointermove",{clientX:низ.left+низ.width/2,clientY:низ.bottom+40,pointerId:6}));
    await ж(120);
    const метка=[...host.querySelectorAll(".flds-row")].some(v=>/своей/.test(v.className));
    window.dispatchEvent(new PointerEvent("pointerup",{clientX:низ.left+низ.width/2,clientY:низ.bottom+40,pointerId:6}));
    await ж(450);
    return метка;
  };

  t.push({имя:"новые поля идут каждое своей строкой",
          ок: строк()===3 && кол.fields.every(f=>f.gw===GRID_COLS), факт: состав()});

  const былаМетка = await тащ("Б","А",0.95,0.5);
  t.push({имя:"бросок на край соседа открывает колонку рядом и делит строку пополам",
          ок: строк()===2 && кол.fields[0].gw===6 && кол.fields[1].gw===6,
          факт: состав()+"; строк "+строк()});
  t.push({имя:"место вставки подсвечивается во время перетаскивания",
          ок: былаМетка, факт:"подсветка: "+былаМетка});

  await тащ("В","Б",0.95,0.5);
  t.push({имя:"третья колонка делит строку на три",
          ок: строк()===1 && кол.fields.every(f=>f.gw===4), факт: состав()});

  /* Главное, чего не умела одноуровневая раскладка: положить ВТОРУЮ плашку в ту же колонку,
     под первой. Бросаем В в середину Б — она обязана встать в колонку Б, а не рядом. */
  await тащ("В","Б",0.5,0.9);
  {
    const слои=fieldsLayout(кол.fields);
    const вКолонке=слои[0] && слои[0].find(к=>к.length===2);
    t.push({имя:"плитку можно положить ПОД другую, в её колонку",
            ок: слои.length===1 && слои[0].length===2 && !!вКолонке
                && кол.fields[вКолонке[0]].gw===кол.fields[вКолонке[1]].gw,
            факт: состав()});
  }

  const меткаНиза = await внизСтрокой("В");
  t.push({имя:"бросок ниже всех строк выносит плитку своей строкой",
          ок: fieldsLayout(кол.fields).length===2
              && кол.fields.find(f=>f.name==="В").gw===GRID_COLS,
          факт: состав()});
  t.push({имя:"промежуток между строками подсвечивается", ок: меткаНиза, факт:"подсветка: "+меткаНиза});

  /* Ширина внутри строки — разделителем между колонками. Нормализация не имеет права
     выравнивать поделённое руками: иначе ручная ширина слетала бы на каждой перерисовке. */
  {
    await тащ("В","Б",0.95,0.5);            // снова собираем все три в одну строку
    const рз=host.querySelector(".fld-split");
    const строка=host.querySelector(".flds-row");
    if(рз && строка){
      const r=рз.getBoundingClientRect(), шаг=строка.getBoundingClientRect().width/GRID_COLS;
      const лево=кол.fields[+рз.dataset.a], право=кол.fields[+рз.dataset.b];
      const было=лево.gw, пара=лево.gw+право.gw;
      рз.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:r.left+2,clientY:r.top+20,button:0,pointerId:9}));
      window.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+2+шаг*2,clientY:r.top+20,pointerId:9}));
      await ж(80);
      window.dispatchEvent(new PointerEvent("pointerup",{clientX:r.left+2+шаг*2,clientY:r.top+20,pointerId:9}));
      await ж(350);
      const стало=лево.gw;
      openNoteReader(кол); await ж(300);    // перерисовка не должна выравнивать доли обратно
      t.push({имя:"разделитель меняет ширину колонок, и она переживает перерисовку",
              ок: стало>было && лево.gw===стало && лево.gw+право.gw===пара,
              факт: "ширина "+было+" → "+стало+"; строка: "+состав()});
    } else t.push({имя:"разделитель колонок есть в разметке", ок:false, факт:"не найден"});
  }

  /* Размер плитки задаёт ЧЕЛОВЕК: высоту — ручкой по нижней кромке, ширину — разделителем.
     У плитки, стоящей в строке одна, соседа нет, поэтому разделитель есть и у правого края
     строки: им её ужимают, оставляя пустое место справа. */
  {
    await внизСтрокой("В");                       // В — одна в своей строке
    const плитка=узел("В");
    const руч=плитка.querySelector(".fld-grip");
    const поле=кол.fields.find(f=>f.name==="В");
    const h0=поле.gh, r=руч.getBoundingClientRect();
    руч.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+2,button:0,pointerId:11}));
    window.dispatchEvent(new PointerEvent("pointermove",{clientX:r.left+40,clientY:r.top+2+120,pointerId:11}));
    await ж(60);
    const наЛету=Math.round(плитка.getBoundingClientRect().height);
    window.dispatchEvent(new PointerEvent("pointerup",{clientX:r.left+40,clientY:r.top+2+120,pointerId:11}));
    await ж(350);
    openNoteReader(кол); await ж(300);
    t.push({имя:"высота плитки тянется ручкой и переживает перерисовку",
            ок: поле.gh>h0 && наЛету===поле.gh && Math.abs(узел("В").getBoundingClientRect().height-поле.gh)<2,
            факт: "высота "+h0+" → "+поле.gh+" (на лету "+наЛету+")"});

    const строкаВ=узел("В").closest(".flds-row");
    const кон=строкаВ.querySelector(".fld-split-end");
    const шаг=строкаВ.getBoundingClientRect().width/GRID_COLS;
    const кr=кон.getBoundingClientRect(), w0=поле.gw;
    кон.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:кr.left+2,clientY:кr.top+20,button:0,pointerId:12}));
    window.dispatchEvent(new PointerEvent("pointermove",{clientX:кr.left+2-шаг*3,clientY:кr.top+20,pointerId:12}));
    await ж(60);
    window.dispatchEvent(new PointerEvent("pointerup",{clientX:кr.left+2-шаг*3,clientY:кr.top+20,pointerId:12}));
    await ж(350);
    const w1=поле.gw;
    openNoteReader(кол); await ж(300);
    t.push({имя:"одинокую плитку можно ужать по ширине, и её не растягивает обратно",
            ок: w1<w0 && поле.gw===w1 && поле.gwm===true,
            факт: "ширина "+w0+" → "+w1+" из двенадцати"});
  }

  /* Дыр не бывает — но только в строках, которых не касалась рука: ужатая руками строка
     оставляет пустое место справа намеренно. */
  t.push({имя:"строка без ручной правки заполнена целиком",
          ок: (()=>{ const ш=host.getBoundingClientRect().width;
                     return fieldsLayout(кол.fields).every((стр,k)=>{
                       if(стр.some(к=>к.some(i=>кол.fields[i].gwm))) return true;
                       const узлы=[...host.querySelectorAll(".flds-row")][k];
                       if(!узлы) return true;
                       const сум=[...узлы.querySelectorAll(":scope > .fld-col")]
                         .reduce((m,c)=>m+c.getBoundingClientRect().width, 0);
                       return Math.abs(сум+8*(стр.length-1)-ш)<24; }); })(),
          факт:"строки без пометки совпадают с шириной панели"});

  closeOverlays(); hardDeleteItem(кол.id);
  openNoteReader(нода); await ж(400);
}

/* ---------- ридер: правка на месте ---------- */
closeOverlays();
openNoteReader(нода);
await ж(150);
const тело = document.querySelector("#nr-fields .fld-text");
t.push({имя:"поля видны в ридере с названиями",
        ок: document.querySelectorAll("#nr-fields .fld").length===3 && !!тело,
        факт: "блоков: "+document.querySelectorAll("#nr-fields .fld").length});
/* Двойной клик ловит ПЛИТКА, а не сам текст: в режиме чтения текст не принимает мышь —
   иначе поле ввода перехватывало бы нажатие, и плитку нельзя было бы тащить за середину. */
document.querySelector("#nr-fields .fld").dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
await ж(120);
t.push({имя:"текст открывается на правку двойным кликом по плитке",
        ок: тело.readOnly===false, факт: тело.readOnly?"остался только для чтения":"правится"});
t.push({имя:"в режиме чтения текст не перехватывает мышь у перетаскивания",
        ок: (()=>{ const x=document.createElement("textarea"); x.className="fld-text"; x.readOnly=true;
                   document.querySelector("#nr-fields .fld").appendChild(x);
                   const r=getComputedStyle(x).pointerEvents; x.remove(); return r==="none"; })(),
        факт:"pointer-events у текста только для чтения"});
тело.value = "правка на месте";
тело.dispatchEvent(new Event("input",{bubbles:true}));
await ж(600);   // дебаунс панели — 400 мс
t.push({имя:"правка поля в ридере пишется в ноду сразу",
        ок: нода.fields[0].value==="правка на месте", факт: "в ноде: "+нода.fields[0].value});

/* Перекладка в ридере тоже ложится в ноду: панель там живая. */
{
  const host=document.querySelector("#nr-fields");
  const плитки=[...host.querySelectorAll(".fld")];
  const первая=плитки[0], вторая=плитки[1];
  const поле=нода.fields.find(f=>f.id===первая.dataset.fid);
  const было=поле.gw;
  const ц=вторая.getBoundingClientRect(), r=первая.getBoundingClientRect();
  первая.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,cancelable:true,clientX:r.left+40,clientY:r.top+20,button:0,pointerId:8}));
  window.dispatchEvent(new PointerEvent("pointermove",{clientX:ц.left+ц.width*0.85,clientY:ц.top+ц.height*0.5,button:0,pointerId:8}));
  await ж(120);
  window.dispatchEvent(new PointerEvent("pointerup",{clientX:ц.left+ц.width*0.85,clientY:ц.top+ц.height*0.5,button:0,pointerId:8}));
  await ж(450);
  t.push({имя:"перекладка в ридере ложится в ноду",
          ок: поле.gw<было, факт:"ширина "+было+" → "+поле.gw+" из двенадцати"});
}

/* Шаблон применяется и к УЖЕ созданной ноде — кнопкой «заполнить по шаблону». Он ЗАМЕНЯЕТ
   набор полей: дописывание копило бы дубли при каждом повторе. Поля непустые — значит должно
   спросить подтверждение. */
S.templates = [{id:"tpl_готовой", name:"Разбор", kind:"note", title:"", tags:[],
                fields:[{type:"text", name:"Итог", h:FIELD_H_DEF}]}];
const полейБыло = нода.fields.length;
document.querySelector('#nr-fields [data-fadd="tpl"]').click();
await ж(250);
document.querySelector('.modal [data-p="tpl_готовой"]').click();
await ж(250);
const спросили = !!document.querySelector("#cf-yes");
if(спросили){ document.querySelector("#cf-yes").click(); await ж(400); }
t.push({имя:"шаблон заменяет набор полей готовой ноды (спросив про содержимое)",
        ок: спросили && нода.fields.length===1 && нода.fields[0].name==="Итог",
        факт: "спросили: "+спросили+"; полей было "+полейБыло+", стало "+нода.fields.length+
              " ("+нода.fields.map(f=>f.name).join(",")+")"});
S.templates=[];
closeOverlays();

// нода без полей не должна обзаводиться пустым списком от одного взгляда на неё
const чистая = addItem({kind:"note", title:"Без полей"});
openNoteReader(чистая); await ж(300); closeOverlays(); await ж(100);
view="notes"; render(); await ж(300); asideSelect(чистая.id); await ж(400);
t.push({имя:"нода без полей не обрастает пустым списком",
        ок: чистая.fields===undefined, факт: "fields: "+JSON.stringify(чистая.fields)});
hardDeleteItem(чистая.id);

/* ---------- шаблоны ---------- */
S.templates = S.templates || [];
S.templates.push({id:"tpl_проверка", name:"Разбор", kind:"note", title:"Разбор задачи", tags:[],
                  fields:[{type:"text", name:"Что случилось", h:FIELD_H_DEF},
                          {type:"text", name:"Что делать",    h:FIELD_H_DEF}]});
S.settings.template = "tpl_проверка";
persist();
/* Шаблон обязан нести и РАСКЛАДКУ: два поля, стоявшие в одной строке, должны приехать строкой,
   а не разъехаться по своим. Флаг строки — br, доли ширины досчитываются при выдаче. */
{
  /* Шаблон обязан помнить ВСЮ раскладку: строки (br), стопки внутри колонки (st) и размеры.
     Проверяем ещё и живучесть после чистки данных — санитайзер срезал эти флаги, и шаблон
     терял расположение при первой же загрузке файла. */
  const макет = {kind:"note", tags:[], fields:[
    {type:"text", name:"Слева",  gw:6,  gh:FIELD_H_DEF},
    {type:"text", name:"Справа", gw:6,  gh:FIELD_H_DEF},
    {type:"text", name:"ПодСправа", gw:6, gh:FIELD_H_DEF, st:true},
    {type:"text", name:"Ниже",   gw:12, gh:400, br:true}]};
  const ряд = templateSeed(макет, "note");
  const слои = fieldsLayout(ряд.fields);
  t.push({имя:"шаблон переносит раскладку полей, а не только состав",
          ок: слои.length===2 && слои[0].length===2 && слои[0][1].length===2
              && ряд.fields[0].gw===6 && ряд.fields[3].gw===GRID_COLS && ряд.fields[3].gh===400,
          факт: слои.map(с=>"["+с.map(к=>к.map(i=>ряд.fields[i].name).join("+")).join(" | ")+"]").join(" ")});

  const чищено = sanitizeState({items:[], templates:[Object.assign({id:"tpl_м", name:"Макет"}, макет)]});
  const послеЧистки = fieldsLayout(templateSeed(чищено.templates[0], "note").fields);
  t.push({имя:"чистка данных не срезает раскладку шаблона",
          ок: послеЧистки.length===2 && послеЧистки[0].length===2 && послеЧистки[0][1].length===2,
          факт: послеЧистки.map(с=>с.map(к=>к.length).join("+")).join(" | ")});
}

const заготовка = templateSeed(templateDefault(), "note");
t.push({имя:"шаблон отдаёт пустые поля с названиями",
        ок: заготовка.fields.length===2 && заготовка.fields[0].name==="Что случилось"
            && заготовка.fields[0].value==="" && заготовка.fields[0].id!==заготовка.fields[1].id,
        факт: заготовка.fields.map(f=>f.name).join(" + ")});

createNew("note");
await ж(250);
// названия ноды в шаблоне нет намеренно — приезжает только НАБОР ПОЛЕЙ
t.push({имя:"новая нода рождается по шаблону по умолчанию",
        ок: блоки().length===2 && $("#f-title").value==="",
        факт: "блоков: "+блоки().length+", заголовок из шаблона: «"+$("#f-title").value+"»"});
$("#f-title").value="Разбор задачи";
$("#f-save").click();
await ж(250);
const рождённая = S.items.find(i=>i.title==="Разбор задачи");
t.push({имя:"сохранённая по шаблону нода получила поля",
        ок: !!рождённая && (рождённая.fields||[]).length===2 && рождённая.fields[1].name==="Что делать",
        факт: рождённая ? (рождённая.fields||[]).map(f=>f.name).join(", ") : "нода не создалась"});

// без шаблона всё как раньше — одно описание, полей нет
S.settings.template = null;
closeOverlays();
createNew("task");
await ж(150);
t.push({имя:"без шаблона нода создаётся как раньше",
        ок: блоки().length===0 && !!$("#f-body"), факт: "блоков полей: "+блоки().length});
closeOverlays();

/* ---------- убираем за собой ---------- */
S.templates = S.templates.filter(x=>x.id!=="tpl_проверка");
S.settings.template = null;
if(рождённая) hardDeleteItem(рождённая.id);
hardDeleteItem(нода.id);
копияПолей.forEach(f=>{ if(f.media) delete S.media[f.media]; if(f.type==="board") delete S.boards[fieldBoardKey(f.id)]; });
render();
return t;
