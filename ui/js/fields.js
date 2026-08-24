"use strict";
/* ПОЛЯ НОДЫ и ШАБЛОНЫ.

   Кроме общего описания (it.body) у заметки и задачи бывают ИМЕНОВАННЫЕ поля: текст, картинка,
   врезка доски. Лежат в it.fields=[{id,type,name,…}] по порядку показа.

   Тяжёлое содержимое живёт ВНЕ ноды и по той же причине, что и доски полотен: снимок отката
   (_undoSnap в core.js) сериализует S.items целиком, и одна фотография в поле означала бы
   копию этой фотографии на каждый шаг истории.
     картинка → S.media["m_…"]           (data-URL)
     доска    → S.boards["fld_"+id поля] (сцена Excalidraw, как у полотна)
   Отсюда правило: удаляя поле или ноду, снимай и это (fieldsDrop); копируя — копируй в НОВЫЕ
   ключи (fieldsPack/fieldsUnpack), иначе две ноды рисовали бы на одном холсте. Осиротевшее
   подметает санитайзер при загрузке.

   Доска поля показана СНИМКОМ (exportToSvg), а рисуют её на весь экран. Причина в CLAUDE.md:
   Excalidraw включает телефонный интерфейс, когда ЕГО контейнер уже 730 px, — а поле в окне
   правки заведомо уже. Высота врезки тянется ручкой и живёт в поле (f.h). */

const FIELD_META = {
  text:  {icon:"ti-align-left", name:"Текст"},
  image: {icon:"ti-photo",      name:"Картинка"},
  board: {icon:"ti-artboard",   name:"Доска"}
};
const FIELD_IMG_MAX = 1600;          // сторона, до которой ужимаем картинку при вставке
const FIELD_BAR_H   = 36;            // полоса с названием над содержимым (она же вся высота свёрнутой плитки)

/* ---------- данные ---------- */

// пустой массив НЕ заводим: нода без полей не должна получать ключ fields (см. сохранить() в fieldsPanel)
function fieldsOf(it){ return (it && Array.isArray(it.fields)) ? it.fields : []; }
function fieldMake(type, name, h){
  const t = FIELD_TYPES.includes(type) ? type : "text";
  // новая плитка — во всю ширину сетки; куда её положить по вертикали, решает вызывающий
  /* Новая плитка — во всю ширину и СВОЕЙ строкой: строки теперь рвутся только по флагу,
     без него поле приклеивалось бы к предыдущему и делило с ним ряд без спроса. */
  const f = { id:"f_"+uid(), type:t, name:String(name==null?"":name),
              gw:GRID_COLS, gh:fieldHeightFor(t, h), br:true };
  if(t==="text") f.value="";
  if(t==="image") f.media=null;
  return f;
}
function fieldMediaPut(url){
  if(!S.media || typeof S.media!=="object") S.media={};
  const k = "m_"+uid(); S.media[k]=url; return k;
}
// весь текст полей — для поиска и отчёта: иначе написанное в поле не находилось бы вовсе
function fieldsText(it){
  return fieldsOf(it).filter(f=>f.type==="text" && (f.value||"").trim())
    .map(f=>(f.name?f.name+": ":"")+f.value).join("\n");
}
// снять картинки и доски полей (ноду удаляют насовсем / поле убрали руками)
function fieldsDrop(it){
  fieldsOf(it).forEach(f=>{
    if(f.media && S.media) delete S.media[f.media];
    if(f.type==="board") boardDelete(fieldBoardKey(f.id));
  });
}
function fieldDrop(f){
  if(!f) return;
  if(f.media && S.media) delete S.media[f.media];
  if(f.type==="board") boardDelete(fieldBoardKey(f.id));
}
/* Упаковка для буфера графа и дубликата: поля вместе с их содержимым. Ключи НЕ переносим —
   их выдаёт распаковка, иначе копия и оригинал делили бы одну картинку и один холст. */
function fieldsPack(it){
  const fields = JSON.parse(JSON.stringify(fieldsOf(it)));
  const media={}, boards={};
  fields.forEach(f=>{
    if(f.media && S.media && S.media[f.media]) media[f.media]=S.media[f.media];
    const b = (f.type==="board" && S.boards) ? S.boards[fieldBoardKey(f.id)] : null;
    if(b) boards[f.id]=JSON.parse(JSON.stringify(b));
  });
  return fields.length ? {fields, media, boards} : null;
}
function fieldsUnpack(pack){
  if(!pack || !Array.isArray(pack.fields) || !pack.fields.length) return null;
  if(!S.media  || typeof S.media !=="object") S.media={};
  return pack.fields.map(f=>{
    const старый=f.id, n=Object.assign({}, f, {id:"f_"+uid()});
    if(n.media){ const url=(pack.media||{})[n.media]; n.media = url ? fieldMediaPut(url) : null; }
    if(n.type==="board"){ const b=(pack.boards||{})[старый]; if(b) boardSet(fieldBoardKey(n.id), b); }
    return n;
  });
}

/* ---------- картинка ---------- */

/* Ужимаем перед сохранением: снимок с телефона — это 4-6 МБ base64 в planner.json, который
   целиком гоняется через мост при КАЖДОЙ записи. 1600 px хватает, чтобы разглядеть эскиз. */
function fieldShrink(url, mime){
  return new Promise(res=>{
    const img=new Image();
    img.onerror=()=>res(url);
    img.onload=()=>{
      const k=Math.min(1, FIELD_IMG_MAX/Math.max(img.naturalWidth||1, img.naturalHeight||1));
      if(k>=1) return res(url);
      try{
        const c=document.createElement("canvas");
        c.width=Math.max(1,Math.round(img.naturalWidth*k)); c.height=Math.max(1,Math.round(img.naturalHeight*k));
        c.getContext("2d").drawImage(img,0,0,c.width,c.height);
        // прозрачность бывает только у png/webp/gif — остальное пишем в jpeg, он вчетверо легче
        res(c.toDataURL(/png|webp|gif/i.test(mime||"")?"image/png":"image/jpeg", 0.9));
      }catch(e){ res(url); }
    };
    img.src=url;
  });
}
function fieldReadImage(file){
  return new Promise(res=>{
    if(!file || !/^image\//.test(file.type||"")){ res(null); return; }
    const r=new FileReader();
    r.onerror=()=>res(null);
    r.onload=()=>fieldShrink(String(r.result||""), file.type).then(res);
    r.readAsDataURL(file);
  });
}
function fieldPickImage(){
  return new Promise(res=>{
    const i=document.createElement("input");
    i.type="file"; i.accept="image/*"; i.style.cssText="position:fixed;left:-9999px;top:0";
    document.body.appendChild(i);
    i.onchange=()=>{ const f=i.files&&i.files[0]; fieldReadImage(f).then(u=>{ i.remove(); res(u); }); };
    // отмену в системном диалоге браузер не сообщает — узел иначе остался бы в DOM навсегда
    setTimeout(()=>{ if(i.isConnected && !(i.files&&i.files.length)) i.remove(); }, 120000);
    i.click();
  });
}

/* ---------- доска поля ---------- */

/* Псевдонода для draw.js: тому нужны только id (по нему лежит сцена) и заголовок. Настоящей
   ноды с таким id в S.items нет и быть не должно. */
function fieldBoardItem(f, it){
  return { id: fieldBoardKey(f.id), kind:"flow",
           title: (f.name||"Доска") + (it && it.title ? " — "+it.title : "") };
}
/* Снимок сцены в контейнер: вендор тянется лениво, поэтому обещание, а не сразу картинка.
   Снимок показывается там, где рисовать негде (узкая врезка) или где уже занято другой живой
   доской: живой корень React в приложении один. */
function fieldBoardPreview(host, key, тесно){
  const плашка=(ic,txt)=>{ host.innerHTML=`<div class="fld-empty"><i class="ti ${ic}"></i>${esc(txt)}</div>`; };
  const d=(S.boards&&S.boards[key])||null;
  if(!d || !Array.isArray(d.elements) || !d.elements.length){
    плашка(тесно?"ti-maximize":"ti-pencil", тесно?"Мало места для рисования — нажми, чтобы открыть на весь экран"
                                                 :"Пусто — нажми, чтобы рисовать здесь");
    return Promise.resolve(false);
  }
  плашка("ti-loader-2","Показываю…");
  return drawLoadLib().then(ok=>{
    if(!host.isConnected) return false;
    if(!ok || !window.ExcalidrawLib || !ExcalidrawLib.exportToSvg){ плашка("ti-artboard","Нажми, чтобы открыть доску"); return false; }
    /* Снимок делаем СВЕТЛЫЙ в обеих темах, и врезка под ним белая. Тёмную доску Excalidraw
       рисует не другими цветами, а фильтром поверх холста, — в снимке фильтра нет, и тёмный
       режим выдал бы светлые штрихи на светлом фоне, то есть пустой прямоугольник. */
    return ExcalidrawLib.exportToSvg({
      elements: d.elements, files: d.files||{}, exportPadding: 6,
      appState: Object.assign({}, d.appState||{}, {exportBackground:false})
    }).then(svg=>{
      if(!host.isConnected) return false;
      // растягиваем по врезке: у снимка свои width/height в пикселях сцены, viewBox остаётся
      svg.setAttribute("width","100%"); svg.setAttribute("height","100%"); svg.style.display="block";
      host.innerHTML=""; host.appendChild(svg); return true;
    }, ()=>{ плашка("ti-artboard","Нажми, чтобы открыть доску"); return false; });
  });
}
/* Открыть доску поля на весь экран и обновить снимок, когда её закроют. Слой доски снимает
   drawDestroy, поэтому «вернулись» ловим по исчезновению узла, а не по кнопке: закрыть могут
   и сменой ноды, и Esc. */
function fieldOpenBoard(f, it, after){
  openBoard(fieldBoardItem(f, it));
  const слой=$("#draw-screen");
  if(!слой){ if(after) after(); return; }
  const ob=new MutationObserver(()=>{ if(!слой.isConnected){ ob.disconnect(); if(after) after(); } });
  ob.observe($("#overlay-root"), {childList:true});
}

/* Содержимое поля в буфер обмена: текст — текстом, картинка и доска — картинкой (PNG), чтобы
   их можно было вставить в письмо или в ту же доску. Буфер принимает только image/png, поэтому
   jpeg прогоняем через canvas. */
async function fieldCopyContent(f){
  if(!f) return false;
  if(f.type==="text"){
    const ок=(typeof _repCopy==="function") ? await _repCopy(f.value||"") : false;
    toast(ок?"Текст скопирован":"Не удалось скопировать",{icon:ок?"ti-copy":"ti-alert-triangle"});
    return ок;
  }
  let blob=null;
  try{
    if(f.type==="image"){
      const url=f.media && S.media ? S.media[f.media] : null;
      if(!url){ toast("В поле нет картинки",{icon:"ti-photo-off"}); return false; }
      blob=await fieldPngBlob(url);
    }else{
      const d=(S.boards&&S.boards[fieldBoardKey(f.id)])||null;
      if(!d || !(d.elements||[]).length){ toast("Доска пустая",{icon:"ti-artboard"}); return false; }
      if(!(await drawLoadLib()) || !ExcalidrawLib.exportToBlob){ toast("Доска ещё не загрузилась",{icon:"ti-artboard"}); return false; }
      blob=await ExcalidrawLib.exportToBlob({elements:d.elements, files:d.files||{}, mimeType:"image/png",
        appState:Object.assign({}, d.appState||{}, {exportBackground:true, viewBackgroundColor:"#ffffff"})});
    }
    await navigator.clipboard.write([new ClipboardItem({"image/png": blob})]);
    toast(f.type==="image"?"Картинка скопирована":"Доска скопирована картинкой",{icon:"ti-copy"});
    return true;
  }catch(e){
    toast("Не удалось скопировать в буфер",{icon:"ti-alert-triangle"});
    return false;
  }
}
// data-URL → PNG-блоб (буфер обмена другого формата не принимает)
function fieldPngBlob(url){
  return new Promise((res,rej)=>{
    if(/^data:image\/png/i.test(url)){ fetch(url).then(r=>r.blob()).then(res,rej); return; }
    const img=new Image();
    img.onerror=rej;
    img.onload=()=>{
      const c=document.createElement("canvas");
      c.width=img.naturalWidth; c.height=img.naturalHeight;
      c.getContext("2d").drawImage(img,0,0);
      c.toBlob(b=>b?res(b):rej(new Error("png")), "image/png");
    };
    img.src=url;
  });
}

/* ЖИВАЯ доска прямо во врезке — если врезка достаточно велика. Порог не наш, а вендорский:
   Excalidraw включает телефонный интерфейс при ширине СВОЕГО контейнера меньше 730, а также
   при высоте меньше 500, когда ширина меньше 1000. Широкая и низкая врезка (правая панель у
   КРОЛИКА — за 1000 px) под это не попадает, и рисовать в ней можно по-настоящему.
   Живой может быть только ОДНА доска: корень React и API у draw.js одни на приложение. */
let fieldBoardLive = null;    // {box, f, сторож, done} — где сейчас смонтирована живая доска
/* Врезка картинки под курсором: в неё уйдёт Ctrl+V. Слушатель paste — ОДИН на документ, а не
   на врезке: врезка не фокусируется (это div), и событие вставки до неё просто не доходит. */
/* Скрытый ПРИЁМНИК вставки. Chromium шлёт событие paste только редактируемому элементу: над
   картинкой фокус обычно «нигде» (body) или на readonly-тексте плитки, и настоящий Ctrl+V не
   порождал события вовсе — врезка молчала, хотя обработчик стоял. Поэтому, пока курсор над
   врезкой, фокус держит невидимое поле ввода: система вставляет в него, а событие всплывает
   до нашего слушателя. Фокус забираем ТОЛЬКО у нередактируемых элементов — у того, кто печатает
   в текстовом поле, его отнимать нельзя. */
function fieldPasteSink(){
  if(!fieldPasteSink.узел || !fieldPasteSink.узел.isConnected){
    const ta=document.createElement("textarea");
    ta.className="fld-paste-sink"; ta.setAttribute("aria-hidden","true"); ta.tabIndex=-1;
    document.body.appendChild(ta);
    fieldPasteSink.узел=ta;
  }
  return fieldPasteSink.узел;
}
const fieldPasteEditable = n => !!n && (n.isContentEditable ||
  ((n.tagName==="INPUT"||n.tagName==="TEXTAREA") && !n.readOnly && n!==fieldPasteSink.узел));
/* Откуда забрали фокус — чтобы вернуть. Забирать приходится и у поля ввода: в окне правки
   фокус по умолчанию стоит в «Названии», и без этого жест молчал бы ровно там, где он нужен.
   Если в буфере окажется не картинка, а текст, мы вернём фокус и вставим текст сами. */
let fieldPastePrev = null;    // {el, start, end}
function fieldPasteFocus(мягко){
  const был=document.activeElement;
  if(мягко && fieldPasteEditable(был)) return;   // при наведении печатающему не мешаем
  fieldPastePrev = fieldPasteEditable(был)
    ? {el:был, start:был.selectionStart, end:был.selectionEnd} : null;
  const ta=fieldPasteSink(); ta.value="";
  try{ ta.focus({preventScroll:true}); }catch(e){ ta.focus(); }
}
// вернуть фокус тому, у кого забрали, и дописать текст руками: событие вставки ушло в приёмник
function fieldPasteGiveBack(текст){
  const п=fieldPastePrev; fieldPastePrev=null;
  if(!п || !п.el || !п.el.isConnected) return false;
  п.el.focus();
  if(текст){
    const s=п.start==null?п.el.value.length:п.start, e=п.end==null?s:п.end;
    п.el.value=п.el.value.slice(0,s)+текст+п.el.value.slice(e);
    п.el.selectionStart=п.el.selectionEnd=s+текст.length;
    п.el.dispatchEvent(new Event("input",{bubbles:true}));
  }
  return true;
}
function fieldPasteBlur(){
  const ta=fieldPasteSink.узел;
  if(ta && document.activeElement===ta) ta.blur();
}
/* Врезку под курсором ищем ПО КООРДИНАТАМ, а не по наведению. Наведение помнило узел, а после
   вставки панель перерисовывается — узел уже другой, и вторая вставка молчала, пока мышь не
   уведут и не вернут. Координаты переживают любую перерисовку. */
let fieldPasteXY = null;
function fieldPasteUnder(){
  if(!fieldPasteXY) return null;
  const n=document.elementFromPoint(fieldPasteXY.x, fieldPasteXY.y);
  const box=n && n.closest ? n.closest(".fld-box") : null;
  return (box && box.__пастеПринять) ? box : null;
}
/* Над доской не встреваем: у Excalidraw своя вставка, картинка ложится прямо на холст. Окно
   правки со своей панелью полей при этом никуда не делось (доска открывается ПОВЕРХ него),
   и без этой проверки Ctrl+V на доске заводил бы поле вместо рисунка. */
function fieldPasteNoGo(){
  if(document.querySelector("#overlay-root .draw-screen")) return true;
  const вДоске=n=>!!(n && n.closest && n.closest(".excalidraw"));
  if(вДоске(document.activeElement)) return true;
  if(fieldPasteXY && вДоске(document.elementFromPoint(fieldPasteXY.x, fieldPasteXY.y))) return true;
  return false;
}
/* Куда уедет картинка из буфера. Врезка под курсором — первым делом: человек показал пальцем.
   Врезки нет — картинка заводит СЕБЕ поле сама. Раньше на это уходило три действия (открыть
   ноду, нажать «картинка», вставить), из которых решало одно.
   В окне правки и в ридере курсор не спрашиваем: окно открыто, за Ctrl+V спорить не с кем.
   В правой панели — только под курсором: на холсте графа Ctrl+V занят вставкой скопированных
   нод (см. main.js), и перехват вслепую отнял бы её. */
function fieldPasteTarget(){
  if(fieldPasteNoGo()) return null;
  const box=fieldPasteUnder();
  if(box) return box.__пастеПринять;
  /* Панель ищем только в ВЕРХНЕМ слое: под окном шаблона или подтверждения может лежать
     открытое окно правки, и вставка уезжала бы в него мимо того, с чем человек сейчас работает. */
  const слои=document.querySelectorAll("#overlay-root > *");
  const верх=слои[слои.length-1];
  const вОкне=верх ? [...верх.querySelectorAll(".fld-host")].filter(h=>h.__полеПаста).pop() : null;
  if(вОкне) return вОкне.__полеПаста;
  /* Целимся в ПАНЕЛЬ ЦЕЛИКОМ, а не в узел с полями: у ноды без картинок это полоска кнопок
     «Добавить поле» высотой в строку, и попасть в неё курсором было заданием на меткость.
     Годится любое место правой панели — холст графа она не занимает, спорить за Ctrl+V не с чем. */
  if(fieldPasteXY){
    const n=document.elementFromPoint(fieldPasteXY.x, fieldPasteXY.y);
    const где=n && n.closest ? n.closest(".fld-host, #aside") : null;
    const host=!где ? null
             : где.classList.contains("fld-host") ? где : где.querySelector(".fld-host");
    if(host && host.__полеПаста) return host.__полеПаста;
  }
  return null;
}
function fieldPasteWire(){
  if(fieldPasteWire.готово) return;
  fieldPasteWire.готово=true;
  document.addEventListener("pointermove", ev=>{ fieldPasteXY={x:ev.clientX, y:ev.clientY}; }, true);
  /* Фокус переносим на приёмник ПРЯМО в keydown и событие не гасим — систему это не сбивает,
     она обработает вставку уже с новым получателем. Забираем фокус даже у поля ввода: курсор
     над врезкой и есть намерение положить картинку сюда. */
  document.addEventListener("keydown", ev=>{
    if(!(ev.ctrlKey||ev.metaKey) || ev.altKey) return;
    if((ev.key||"").toLowerCase()!=="v" && ev.code!=="KeyV") return;
    if(document.activeElement===fieldPasteSink.узел) return;
    /* У contenteditable фокус не отнимаем: вернуть в него текст нечем — fieldPasteGiveBack знает
       только value. Так правятся заголовок ноды в правой панели и описание в ридере, и вставка
       текста там пропадала бы бесследно. */
    if(document.activeElement && document.activeElement.isContentEditable) return;
    if(!fieldPasteTarget()) return;
    fieldPasteFocus();
  }, true);
  document.addEventListener("paste", ev=>{
    const принять=fieldPasteTarget();
    const цель=принять ? {принять} : null;
    if(!цель){
      // фокус мог остаться на приёмнике после ухода мыши — текст обязан вернуться хозяину
      if(document.activeElement===fieldPasteSink.узел && fieldPastePrev && ev.clipboardData){
        const т=ev.clipboardData.getData ? ev.clipboardData.getData("text/plain") : "";
        if(fieldPasteGiveBack(т)) ev.preventDefault();
      }
      return;
    }
    const данные=ev.clipboardData; if(!данные) return;
    const шт=[...(данные.items||[])].find(i=>i.kind==="file" && /^image\//.test(i.type||""));
    const файл=шт ? шт.getAsFile() : [...(данные.files||[])].find(f=>/^image\//.test(f.type||""));
    if(!файл){
      /* В буфере не картинка. Фокус мы уже забрали, и текст ушёл бы в невидимый приёмник —
         возвращаем и то, и другое хозяину, иначе вставка пропадала бы бесследно. */
      if(document.activeElement===fieldPasteSink.узел && fieldPastePrev){
        const текст=данные.getData ? данные.getData("text/plain") : "";
        if(fieldPasteGiveBack(текст)) ev.preventDefault();
      }
      return;
    }
    ev.preventDefault();   // иначе картинка заодно вставится в поле ввода, если фокус был в нём
    цель.принять(файл);
    // приёмник чистим: он невидим, и оставленный в нём текст всплыл бы при следующей вставке
    const ta=fieldPasteSink.узел; if(ta){ ta.value=""; }
    fieldPastePrev=null;
  }, true);
}
function fieldBoardFits(box){
  const r=box.getBoundingClientRect();
  return r.width>=1000 ? r.height>=180 : (r.width>=730 && r.height>=500);
}
function fieldBoardStart(box, f, it, done){
  fieldBoardStop(true);        // прежней врезке возвращаем снимок, а не пустое место
  box.classList.add("live"); box.innerHTML="";
  /* Колесо над доской не должно прокручивать панель под ней (та же болезнь, что у врезки
     полотна). Гасим в фазе всплытия и только пока доска живая — слушатель снимается вместе
     с ней, иначе над снимком осталась бы мёртвая зона без прокрутки. */
  const колесо=e=>e.preventDefault();
  box.addEventListener("wheel", колесо, {passive:false});
  /* Сторож: врезку может унести перерисовка панели, закрытие ридера или переход на другую
     вкладку — во всех этих случаях React-корень остался бы жить в оторванном DOM. */
  const сторож=new MutationObserver(()=>{
    if(box.isConnected) return;
    сторож.disconnect();
    if(fieldBoardLive && fieldBoardLive.box===box){ fieldBoardLive=null; drawDestroy(); }
  });
  сторож.observe(document.body, {childList:true, subtree:true});
  fieldBoardLive={box, f, сторож, колесо, done};
  drawDestroy();                                   // между досками — только полный ремонтаж
  return drawInto(fieldBoardItem(f, it), box);
}
function fieldBoardStop(рисоватьСнимок){
  if(!fieldBoardLive) return false;
  const {box, f, сторож, колесо, done}=fieldBoardLive;
  fieldBoardLive=null;
  if(сторож) сторож.disconnect();
  box.removeEventListener("wheel", колесо);
  drawDestroy();                                   // порядок важен: сцену снимаем, пока API жив
  if(box.isConnected){
    box.classList.remove("live");
    if(рисоватьСнимок!==false) fieldBoardPreview(box, fieldBoardKey(f.id));
  }
  if(done) done();
  return true;
}

// снять живую доску, если она смонтирована внутри узла (закрывают окно, перерисовывают панель)
function fieldsStopIn(node){ if(fieldBoardLive && node && node.contains(fieldBoardLive.box)) fieldBoardStop(false); }

/* Тот же жест — на ОБЩЕЕ описание ноды: правая кнопка копирует его целиком. Описание живёт
   не в fields, а в it.body, но человеку всё равно, где что лежит: жест должен быть один. */
function fieldsCopyOnRight(node, текст){
  if(!node || node._копияПКМ) return;
  node._копияПКМ=true;
  node.addEventListener("contextmenu", e=>{
    e.preventDefault();
    fieldCopyContent({type:"text", value:(typeof текст==="function"?текст():текст)||""});
  });
}


/* ---------- панель полей ---------- */

/* Одна и та же панель работает и в окне правки, и в ридере, и в правой панели. Разница одна:
   opts.save. Если он есть — правки пишутся сразу (ридер, панель), если нет — это черновик
   окна правки, и он применится по «Сохранить» (иначе «Отмена» ничего бы не отменяла). */
/* ---------- движок сетки ----------
   Плитки лежат по координатам (gx, gw — колонки; gy, gh — пиксели). Правила ровно три, и они
   те же, что у любого дашборда: плитки не накладываются, всё, что может подняться выше, —
   поднимается, а тащат плитку туда, куда указывает курсор, расталкивая занявших место вниз. */

/* Плавный переезд плиток (FLIP): снимаем, где они были, и после перерисовки пускаем из старого
   места в новое. Без этого перестановка выглядит подменой — глазу нечем проследить. */
function fieldsSnap(host){
  const м=new Map();
  host.querySelectorAll(".fld").forEach(n=>{ if(n.dataset.fid) м.set(n.dataset.fid, n.getBoundingClientRect()); });
  return м;
}
function fieldsFlip(host, снимок){
  if(!снимок || !снимок.size) return;
  host.querySelectorAll(".fld").forEach(n=>{
    const было=снимок.get(n.dataset.fid); if(!было) return;
    const стало=n.getBoundingClientRect();
    if(!стало.width || !стало.height) return;
    /* Анимируем ТОЛЬКО переезд. Масштаб по ширине (scaleX) выглядел резиновым текстом:
       буквы сжимались и разжимались вместе с плиткой — это и читалось как «топорно». */
    const dx=было.left-стало.left, dy=было.top-стало.top;
    if(Math.abs(dx)<1 && Math.abs(dy)<1) return;
    n.style.transformOrigin="top left";
    n.style.transition="none";
    n.style.transform="translate("+dx+"px,"+dy+"px)";
    let пущено=false;
    const пуск=()=>{ if(пущено) return; пущено=true;
      n.style.transition="transform .22s cubic-bezier(.2,.8,.2,1)";
      n.style.transform="";
      setTimeout(()=>{ n.style.transition=""; n.style.transformOrigin=""; }, 260); };
    requestAnimationFrame(пуск); setTimeout(пуск, 32);
  });
}

/* РАСКЛАДКА — СТРОКИ С КОЛОНКАМИ (модель Notion).
   Строка набирается по порядку полей, пока доли не добрали до двенадцати или пока не встретится
   поле с флагом «с новой строки». Сумма долей в строке ВСЕГДА двенадцать — поэтому не бывает
   ни дыр, ни плиток посреди пустоты. Свободной сетки нет: её четыре версии подряд не дали
   жеста «перетащил к соседу — поделили строку», ради которого всё и затевалось. */
/* РАСКЛАДКА ДВУХУРОВНЕВАЯ, как в Notion: строка делится на КОЛОНКИ, а внутри колонки плитки
   лежат ДРУГ ПОД ДРУГОМ. Одноуровневая («строка = плитки в ряд») не выражала простейшего
   случая: рядом с высокой картинкой справа помещалась ровно одна плашка, а место под ней
   оставалось мёртвым — положить туда вторую было нечем.

   Хранение осталось плоским списком, порядок = порядок чтения. Два флага:
     br — поле начинает НОВУЮ СТРОКУ;
     st — поле кладётся ПОД предыдущим, в ту же колонку (у первого поля строки не имеет смысла).
   Поле без обоих флагов открывает новую колонку в текущей строке — поэтому старые данные,
   где флага st не было вовсе, читаются правильно и без миграции. */
function fieldsLayout(fields){
  const строки=[];
  fields.forEach((f,i)=>{
    if(!строки.length || f.br) строки.push([]);      // новая строка
    const стр=строки[строки.length-1];
    if(!стр.length || !f.st) стр.push([i]);          // новая колонка в строке
    else стр[стр.length-1].push(i);                  // под предыдущей плиткой той же колонки
  });
  return строки;
}
// плоский список обратно из раскладки: флаги проставляются по месту, содержимое не трогаем
function fieldsFromLayout(строки, fields){
  const плоско=[];
  строки.map(стр=>стр.filter(к=>к.length)).filter(стр=>стр.length).forEach((стр,ns)=>{
    стр.forEach((кол,nk)=>{
      кол.forEach((i,nt)=>{
        const f=fields[i];
        if(ns>0 && nk===0 && nt===0) f.br=true; else delete f.br;
        if(nt>0) f.st=true; else delete f.st;
        плоско.push(f);
      });
    });
  });
  return плоско;
}
const FIELDS_ROW_MAX=4;   // больше четырёх колонок в строке нечитаемо: доля меньше трёх из двенадцати
/* Доли строки всегда в сумме дают двенадцать; ширина — свойство КОЛОНКИ, поэтому у всех плиток
   колонки она одинаковая (иначе плитки одной колонки разъезжались бы по ширине). */
function fieldsNormalize(fields){
  fieldsLayout(fields).forEach(стр=>{
    /* Доли уже складываются в двенадцать — не трогаем: строку могли поделить руками за
       разделитель, и «выравнивание» отменяло бы ручную ширину при каждой перерисовке.
       Правим только состав, который изменился (колонку добавили, унесли, поменяли местами). */
    const шир=стр.map(кол=>+fields[кол[0]].gw||0);
    const сумма=шир.reduce((m,w)=>m+w,0);
    /* Строку, поделённую руками (gwm), не растягиваем обратно: недобор до двенадцати там —
       не ошибка, а оставленное человеком пустое место справа. Чиним только перебор и мусор,
       и тогда же снимаем пометку — состав изменился, прежние доли всё равно уже не те. */
    const ручная=стр.some(кол=>кол.some(i=>fields[i].gwm));
    if(шир.some(w=>!(w>=1)) || сумма>GRID_COLS || (!ручная && сумма!==GRID_COLS)){
      const доля=Math.floor(GRID_COLS/стр.length);
      стр.forEach((кол,k)=>{ шир[k] = k===стр.length-1 ? GRID_COLS-доля*(стр.length-1) : доля; });
      стр.forEach(кол=>кол.forEach(i=>{ delete fields[i].gwm; }));
    }
    стр.forEach((кол,k)=>кол.forEach(i=>{ fields[i].gw=шир[k]; }));
  });
  return fields;
}

// снять живую доску, если она смонтирована внутри узла (закрывают окно, перерисовывают панель)
function fieldsStopIn(node){ if(fieldBoardLive && node && node.contains(fieldBoardLive.box)) fieldBoardStop(false); }

/* Тот же жест — на ОБЩЕЕ описание ноды: правая кнопка копирует его целиком. Описание живёт
   не в fields, а в it.body, но человеку всё равно, где что лежит: жест должен быть один. */
function fieldsCopyOnRight(node, текст){
  if(!node || node._копияПКМ) return;
  node._копияПКМ=true;
  node.addEventListener("contextmenu", e=>{
    e.preventDefault();
    fieldCopyContent({type:"text", value:(typeof текст==="function"?текст():текст)||""});
  });
}


/* ---------- панель полей ---------- */

/* Одна и та же панель работает и в окне правки, и в ридере, и в правой панели. Разница одна:
   opts.save. Если он есть — правки пишутся сразу (ридер, панель), если нет — это черновик
   окна правки, и он применится по «Сохранить» (иначе «Отмена» ничего бы не отменяла). */
/* ---------- раскладка: КОЛОНКИ, как в Notion ----------
   Модель выбрал КРОЛИК после четырёх отвергнутых версий (лента, стыковка к краю, свободная
   сетка, дашборд на gridstack): свободного размещения нет вовсе, и именно поэтому нет ни дыр,
   ни «уехавшей из-под курсора» цели.

   Плитки идут строками сверху вниз. Строку начинает поле с флагом `br`; ширина — не свойство
   плитки, а ДОЛЯ строки: сумма `gw` в строке всегда двенадцать, и её пересчитывает
   fieldsNormalize. Бросок на левый или правый край соседа ставит плитку в его строку, бросок
   к верхнему или нижнему краю выносит своей строкой. Высота `gh` — в ПИКСЕЛЯХ: их тянут
   ручкой, и они понятны человеку. */


// короткая сводка для свёрнутого поля: чтобы не разворачивать ради «а что там лежало»
function fieldSummary(f){
  if(f.type==="text"){ const t=(f.value||"").replace(/\s+/g," ").trim(); return t?t.slice(0,90):"пусто"; }
  if(f.type==="image") return f.media?"картинка":"пусто";
  const d=(S.boards&&S.boards[fieldBoardKey(f.id)])||null;
  const n=(d&&d.elements||[]).length;
  return n?("доска, фигур: "+n):"пусто";
}
function fieldBlockHtml(f, i){
  const meta=FIELD_META[f.type]||FIELD_META.text;
  const кнопка=(a,ic,t)=>`<button type="button" class="fld-b" data-fa="${a}" data-i="${i}" title="${esc(t)}"><i class="ti ${ic}"></i></button>`;
  /* Плитка знает только СВОЮ ВЫСОТУ: ширина — свойство колонки, в которой она лежит
     (в колонке их может быть несколько, и разъезжаться по ширине им нельзя). */
  const ш=` style="height:${f.off?36:fieldHeight(f.gh)}px"`;
  if(f.off){
    // свёрнутое поле: только полоса со сводкой. Содержимое НЕ рисуем вовсе — скрытая врезка
    // имеет нулевой размер, и доска в ней сочлась бы «не влезающей»
    return `<div class="fld off" data-i="${i}" data-fid="${esc(f.id)}"${ш}>
      <div class="fld-bar" title="Клик — развернуть, тянуть — переставить, правая кнопка — скопировать содержимое">
        <i class="ti ${meta.icon} fld-ico"></i>
        <span class="fld-name-off">${esc(f.name||meta.name)}</span>
        <span class="fld-sum">${esc(fieldSummary(f))}</span>
        ${кнопка("del","ti-x","Убрать поле")}
        <i class="ti ti-chevron-down fld-fold" title="Свёрнуто"></i>
      </div></div>`;
  }
  /* Содержимое занимает всю плитку: размер задаёт сама плитка, а не её начинка. Картинка
     вписывается целиком (contain) — растянутая по ширине, она вылезала бы за высоту плитки
     и была видна кусочком. Под пропорции картинки подгоняется САМА ПЛИТКА при вставке. */
  let тело;
  if(f.type==="text"){
    тело=`<textarea class="fld-text" data-i="${i}" readonly placeholder="Текст поля…" title="Двойной клик — править">${esc(f.value||"")}</textarea>`;
  }else if(f.type==="image"){
    тело=`<div class="fld-box${f.media?"":" fld-drop-here"}" data-i="${i}" title="Перетащи картинку мышью или наведи и нажми Ctrl+V">`+
         (f.media?`<img class="fld-img" data-i="${i}" draggable="false" alt="${esc(f.name||"картинка")}">`
                 :`<div class="fld-empty"><i class="ti ti-photo-plus"></i>Перетащи картинку сюда или вставь Ctrl+V</div>`)+
         `</div>`;
  }else{
    тело=`<div class="fld-box fld-board" data-i="${i}"></div>`;
  }
  /* Кнопки стоят СРАЗУ за названием, а не у дальнего края полосы: до правого края широкой
     ноды курсор тянуть далеко, а копируют и убирают поля часто. Порядок и переезд полей —
     не кнопками, а ручкой слева: её тянут мышью. */
  return `<div class="fld" data-i="${i}" data-fid="${esc(f.id)}"${ш}>
    <div class="fld-bar" title="Клик — свернуть, тянуть — переставить, правая кнопка — скопировать содержимое">
      <i class="ti ${meta.icon} fld-ico"></i>
      <span class="fld-name" data-i="${i}" title="Двойной клик — переименовать">${esc(f.name||"")||`<em>${esc(meta.name)} — название поля</em>`}</span>
      ${кнопка("del","ti-x","Убрать поле")}
      ${f.type==="board"?кнопка("full","ti-maximize","Открыть доску на весь экран"):""}
      ${f.type==="image"?кнопка("pick","ti-photo-search","Выбрать картинку файлом"):""}
      ${f.type==="image"?`<button type="button" class="fld-b${fieldAutoFit(f)?" on":""}" data-fa="fit" data-i="${i}" title="${
        fieldAutoFit(f)?"Высота едет за картинкой — нажми, чтобы задавать её руками"
                       :"Всегда подгонять высоту плитки под картинку"}"><i class="ti ti-aspect-ratio"></i></button>`:""}
      <span class="fld-sp"></span>
      <i class="ti ti-chevron-up fld-fold" title="Клик по полосе — свернуть"></i>
    </div>${тело}<div class="fld-grip" title="Потяни — высота плитки"></div></div>`;
}

function fieldsPanel(host, fields, opts){
  opts=opts||{};
  const живьём=!!opts.save;
  let таймер=null;
  const позже=fn=>{ clearTimeout(таймер); таймер=setTimeout(fn,400); };
  /* В живом режиме массив полей прирастает к ноде ТОЛЬКО когда в нём появилось поле: иначе
     один взгляд в правую панель добавлял бы каждой ноде пустой fields:[] — лишний вес файла
     и лишний шум в ключе отмены. Пустой список так же честно убираем. */
  const сохранить=()=>{
    if(opts.attach && opts.item){
      if(fields.length) opts.item.fields=fields; else delete opts.item.fields;
    }
    if(opts.save) opts.save();
  };

  // поле по узлу разметки: порядок в списке меняется библиотекой, индексам доверять нельзя
  const полеУзла=n=>{ const б=n&&n.closest&&n.closest("[data-fid]"); return б?fields.find(x=>x.id===б.dataset.fid):null; };
  const draw=()=>{
    // живую доску снимаем ДО замены разметки: иначе React-корень остался бы в оторванном DOM
    if(fieldBoardLive && host.contains(fieldBoardLive.box)) fieldBoardStop(false);
    fieldsNormalize(fields);      // доли строк всегда в сумме двенадцать
    /* Между соседями в строке — разделитель: ширина внутри строки регулируется им, а не
       ручкой на самой плитке. Плитка не знает своей ширины в пикселях (она доля строки),
       поэтому тянуть логично именно границу между двумя долями. */
    host.innerHTML = fieldsLayout(fields).map(стр=>
        `<div class="flds-row">`+стр.map((кол,k)=>
          (k?`<div class="fld-split" data-a="${стр[k-1][0]}" data-b="${кол[0]}" title="Потяни — изменить ширину колонок"></div>`:"")
          +`<div class="fld-col" style="--gw:${gridW(fields[кол[0]].gw)}">`
          +кол.map(i=>fieldBlockHtml(fields[i], i)).join("")
          +`</div>`).join("")
        /* Разделитель у ПРАВОГО края строки: без него ширину было нечем править у плитки,
           стоящей в строке одна — соседа, за границу с которым тянут, просто нет. Ужатая
           строка оставляет пустое место справа, и это законный результат: ширину задали руками. */
        +`<div class="fld-split fld-split-end" data-a="${стр[стр.length-1][0]}" title="Потяни — ширина последней колонки"></div>`
        +`</div>`).join("")+
      `<div class="fld-add">
         <span>Добавить поле:</span>
         <button type="button" data-fadd="text"><i class="ti ti-align-left"></i>текст</button>
         <button type="button" data-fadd="image"><i class="ti ti-photo"></i>картинка</button>
         <button type="button" data-fadd="board"><i class="ti ti-artboard"></i>доска</button>
       </div>
       <div class="fld-add fld-tpl">
         <span>Шаблон:</span>
         <button type="button" data-fadd="tpl" title="Взять набор полей из шаблона — он заменит нынешний"><i class="ti ti-layout-list"></i>заполнить по шаблону</button>
         <button type="button" data-fadd="save" title="Запомнить нынешний набор полей как шаблон"><i class="ti ti-device-floppy"></i>сохранить как шаблон</button>
       </div>`;
    // картинки и снимки досок — после вставки разметки: data-URL в innerHTML раздувал бы строку
    host.querySelectorAll(".fld-img").forEach(img=>{
      const f=полеУзла(img); const url=f&&f.media&&S.media?S.media[f.media]:null;
      if(!url){ img.replaceWith(el("div","fld-empty","<i class='ti ti-photo-off'></i>картинка потерялась")); return; }
      /* Пропорции знает только загруженная картинка, поэтому пересчёт «всегда по размеру»
         вешаем на её загрузку, а не делаем сразу после разметки. */
      if(fieldAutoFit(f)) img.addEventListener("load", ()=>{ if(fieldsFitAuto(host, fields)) позже(сохранить); }, {once:true});
      img.src=url;
    });
    /* Доску поднимаем СРАЗУ, а не по клику: поле для того и заводят, чтобы рисовать, и лишний
       клик по плашке был просто данью реализации. Замер размеров — через два кадра: сразу
       после вставки разметки ширина ещё не посчитана, и годная врезка сочлась бы тесной.
       Живой может быть только ОДНА доска (корень React один) — остальные ждут снимками. */
    const доски=[...host.querySelectorAll(".fld-board")];
    const поднять=()=>{
      доски.forEach(box=>{
        if(!box.isConnected || box.classList.contains("live")) return;
        const f=полеУзла(box); if(!f) return;
        const влезает=fieldBoardFits(box);
        if(влезает && !fieldBoardLive){ fieldBoardStart(box, f, opts.item, сохранить); return; }
        fieldBoardPreview(box, fieldBoardKey(f.id), !влезает);
      });
    };
    /* Пробуем СРАЗУ и ещё раз чуть позже. Одного замера мало: окно правки успевает открыться
       раньше, чем посчитана его ширина, и годная врезка сочлась бы тесной. Одного rAF тоже
       мало — когда окно свёрнуто или не рисует кадров, кадровый колбэк не приходит вовсе,
       и доска не поднималась бы никогда. */
    if(доски.length){
      поднять();
      requestAnimationFrame(()=>requestAnimationFrame(поднять));
      setTimeout(поднять, 120);
    }
    wire();
  };

  /* ПЕРЕТАСКИВАНИЕ ПЛИТКИ — модель колонок.
     Курсор над чужой плиткой: левая или правая треть = встать в ЕЁ строку с этой стороны
     (строка делит ширину поровну), середина по высоте у края строки = отдельной строкой выше
     или ниже. Ничего не «прыгает»: пока тащим, только рисуем полоску в месте вставки. */
  const перетащить=(плитка, e0)=>{
    const f=полеУзла(плитка); if(!f) return;
    e0.preventDefault();
    const x0=e0.clientX, y0=e0.clientY;
    let двигалось=false, цель=null, зона="", строка=-1, куда="";
    const метка=()=>{
      host.querySelectorAll(".fld").forEach(n=>n.classList.remove("до","после","выше","ниже"));
      host.querySelectorAll(".flds-row").forEach(n=>n.classList.remove("своей-выше","своей-ниже"));
      if(цель && зона) цель.classList.add(зона);
      const стр=строка>=0 ? host.querySelectorAll(".flds-row")[строка] : null;
      if(стр && куда) стр.classList.add("своей-"+куда);
    };
    const двигать=ev=>{
      if(!двигалось && Math.abs(ev.clientX-x0)<4 && Math.abs(ev.clientY-y0)<4) return;
      if(!двигалось){ двигалось=true; плитка.classList.add("тащим"); document.body.classList.add("fld-drag"); }
      плитка.style.transform="translate("+(ev.clientX-x0)+"px,"+(ev.clientY-y0)+"px)";
      /* Цель ищем ГЕОМЕТРИЕЙ, а не «что под курсором»: elementFromPoint возвращает пусто,
         когда точка вне видимой области — а панель прокручивается, и половина плиток бывает
         за краем. Перебор прямоугольников от этого не зависит. */
      цель=null;
      host.querySelectorAll(".fld").forEach(n=>{
        if(n===плитка || цель) return;
        const r=n.getBoundingClientRect();
        if(ev.clientX>=r.left && ev.clientX<=r.right && ev.clientY>=r.top && ev.clientY<=r.bottom) цель=n;
      });
      зона="";
      if(цель){
        /* Края по X отданы КОЛОНКАМ, середина — стопке внутри колонки: «слева/справа» человек
           показывает пальцем у края, а «выше/ниже» — попадая в тело плитки. Полосы по краям
           широкие (четверть), иначе в узкую колонку не прицелиться. */
        const r=цель.getBoundingClientRect();
        const кx=(ev.clientX-r.left)/r.width, кy=(ev.clientY-r.top)/r.height;
        if(кx<0.25) зона="до";
        else if(кx>0.75) зона="после";
        else зона=(кy<0.5)?"выше":"ниже";
      }else{
        // пустое место под последней плиткой колонки — тоже цель: туда кладут вторую плашку
        host.querySelectorAll(".fld-col").forEach(к=>{
          if(цель) return;
          const r=к.getBoundingClientRect();
          if(ev.clientX>=r.left && ev.clientX<=r.right && ev.clientY>=r.top && ev.clientY<=r.bottom){
            const последняя=[...к.querySelectorAll(".fld")].filter(n=>n!==плитка).pop();
            if(последняя){ цель=последняя; зона="ниже"; }
          }
        });
      }
      /* Промежуток МЕЖДУ строками — отдельный жест: вынести плитку своей строкой. Без него
         вернуть плитку из ряда вниз было нечем, и «убрать вниз не получается» — ровно про это. */
      строка=-1; куда="";
      if(!цель){
        const строки=[...host.querySelectorAll(".flds-row")];
        строки.forEach((n,k)=>{
          if(строка>=0) return;
          const r=n.getBoundingClientRect();
          if(ev.clientY<r.top){ строка=k; куда="выше"; }
        });
        if(строка<0 && строки.length && ev.clientY>строки[строки.length-1].getBoundingClientRect().bottom){
          строка=строки.length-1; куда="ниже";
        }
      }
      метка();
    };
    const отпустить=()=>{
      window.removeEventListener("pointermove",двигать);
      window.removeEventListener("pointerup",отпустить);
      window.removeEventListener("pointercancel",отпустить);
      плитка.classList.remove("тащим"); плитка.style.transform="";
      document.body.classList.remove("fld-drag");
      const ц=цель, з=зона, стр=строка, кд=куда;
      цель=null; зона=""; строка=-1; куда=""; метка();
      if(!двигалось) return;               // клик разбирает обработчик полосы
      const цф=ц?полеУзла(ц):null;
      if((!цф || цф===f) && стр<0) return;
      const снимок=fieldsSnap(host);
      if(!цф || цф===f){
        // бросок в промежуток между строками: плитка уезжает СВОЕЙ строкой
        const слои=fieldsLayout(fields), мой=fields.indexOf(f);
        слои.forEach(с=>с.forEach(к=>{ const j=к.indexOf(мой); if(j>=0) к.splice(j,1); }));
        слои.splice(стр+(кд==="ниже"?1:0), 0, [[мой]]);
        const новые=fieldsFromLayout(слои, fields);
        fields.length=0; новые.forEach(x=>fields.push(x));
        fieldsNormalize(fields);
        сохранить(); draw(); fieldsFlip(host, снимок);
        return;
      }
      /* Работаем не с плоским списком, а с РАСКЛАДКОЙ: «встать справа от колонки» и «встать
         под плиткой» — операции над строками и колонками, а через индексы плоского списка
         они выражались бы флагами наугад (первая версия так и промахивалась). */
      const слои=fieldsLayout(fields);
      const мой=fields.indexOf(f), цi=fields.indexOf(цф);
      let ms=-1,mk=-1,mt=-1, цs=-1,цk=-1,цt=-1;
      слои.forEach((стр,s)=>стр.forEach((кол,k)=>кол.forEach((i,t)=>{
        if(i===мой){ ms=s; mk=k; mt=t; }
        if(i===цi){ цs=s; цk=k; цt=t; }
      })));
      if(цs<0) return;
      слои[ms][mk].splice(mt,1);                     // вынули плитку с её места
      // индексы цели могли съехать, если вынули из той же колонки выше неё
      if(цs===ms && цk===mk && mt<цt) цt-=1;
      if(з==="выше" || з==="ниже"){
        слои[цs][цk].splice(з==="выше"?цt:цt+1, 0, мой);      // в стопку той же колонки
      }else{
        // новая колонка слева или справа; строка длиннее четырёх колонок нечитаема — выносим строкой
        if(слои[цs].filter(к=>к.length).length>=FIELDS_ROW_MAX) слои.splice(цs+(з==="после"?1:0),0,[[мой]]);
        else слои[цs].splice(з==="после"?цk+1:цk, 0, [мой]);
      }
      const новые=fieldsFromLayout(слои, fields);
      fields.length=0; новые.forEach(x=>fields.push(x));
      fieldsNormalize(fields);
      сохранить(); draw(); fieldsFlip(host, снимок);
    };
    window.addEventListener("pointermove",двигать);
    window.addEventListener("pointerup",отпустить);
    window.addEventListener("pointercancel",отпустить);
  };

  const wire=()=>{
    fieldPasteWire();          // слушатели вставки — одни на документ, ставятся при первой панели
    host.querySelectorAll(".fld-name").forEach(имя=>{
      имя.ondblclick=e=>{
        e.stopPropagation();
        const f=полеУзла(имя); if(!f) return;
        const поле=el("input","fld-name fld-name-edit");
        поле.type="text"; поле.value=f.name||""; поле.placeholder="название поля";
        поле.dataset.i=имя.dataset.i;
        имя.replaceWith(поле); поле.focus(); поле.select();
        // пока правят имя, за шапку не тащат: щит от перетаскивания на самом вводе
        поле.addEventListener("pointerdown", ev=>ev.stopPropagation());
        const принять=()=>{
          if(!поле.isConnected) return;
          const было=f.name||"";
          f.name=поле.value.slice(0,80);
          if(f.name!==было) сохранить();
          draw();
        };
        поле.onblur=принять;
        поле.onkeydown=ev=>{
          if(ev.key==="Enter"){ ev.preventDefault(); принять(); }
          else if(ev.key==="Escape"){ ev.preventDefault(); поле.onblur=null; draw(); }
        };
      };
    });
    /* Размер задаёт ПЛИТКА, а не текст. Правка включается ДВОЙНЫМ кликом: одиночное нажатие
       в любом месте плитки отдано перетаскиванию, иначе поле нельзя было бы взять за середину. */
    host.querySelectorAll(".fld-text").forEach(ta=>{
      const f=полеУзла(ta); if(!f) return;
      ta.oninput=()=>{ f.value=ta.value; позже(сохранить); };
      ta.onblur=()=>{ ta.readOnly=true; ta.classList.remove("edit"); };
    });
    /* Картинка: клик по врезке НЕ открывает проводник. Системный диалог из-под руки — это
       всегда неожиданность, а картинку сюда обычно тащат мышью. Файлом — кнопка в полосе. */
    host.querySelectorAll(".fld-box").forEach(box=>{
      const f=полеУзла(box); if(!f) return;
      if(f.type==="board"){ box.onclick=()=>рисовать(f, box); return; }
      if(f.type!=="image") return;
      const принять=файл=>{
        if(!файл) return;
        fieldReadImage(файл).then(url=>{
          if(!url){ toast("Это не картинка",{icon:"ti-photo-off"}); return; }
          if(живьём && f.media && S.media) delete S.media[f.media];
          f.media=fieldMediaPut(url);
          // плитку подгоняем под пропорции картинки, потом уплотняем сетку
          fieldFitImage(host, f, url).then(()=>{ сохранить(); draw(); });
        });
      };
      box.addEventListener("dragover", e=>{ e.preventDefault(); box.classList.add("drop"); });
      box.addEventListener("dragleave", ()=>box.classList.remove("drop"));
      box.addEventListener("drop", e=>{
        e.preventDefault(); box.classList.remove("drop");
        принять((e.dataTransfer&&e.dataTransfer.files||[])[0]);
      });
      /* Ctrl+V прямо во врезку: снимок экрана или картинка из браузера попадают в поле без
         промежуточного файла. Врезка не фокусируется (это div), поэтому событие paste ловим
         глобально, а «куда вставлять» помним по наведению курсора. */
      /* Приёмник вставки помечаем на самой врезке: искать её потом будем по координатам
         курсора, и обработчик обязан ехать вместе с узлом через любую перерисовку. */
      box.__пастеПринять=принять;
      box.addEventListener("pointerenter", ()=>fieldPasteFocus(true));
      box.addEventListener("pointerleave", fieldPasteBlur);
    });
    /* Нативное перетаскивание браузера внутри плитки давим на корню: иначе оно перехватывает
       жест у нас — pointerup не приходит, и плитка остаётся поднятой. */
    host.addEventListener("dragstart", e=>{ if(e.target.closest && e.target.closest(".fld")) e.preventDefault(); });
    /* Двойной клик по плитке открывает её текст на правку. Пока текст «только для чтения», он
       не ловит мышь вовсе (pointer-events в CSS) — потому плитку и можно тащить за любое место,
       включая сам текст. Открытый на правку textarea мышь снова ловит и из захвата исключён. */
    host.querySelectorAll(".fld").forEach(плитка=>{
      плитка.addEventListener("dblclick", e=>{
        if(e.target.closest && e.target.closest("button, .fld-name, .excalidraw")) return;
        const ta=плитка.querySelector(".fld-text"); if(!ta) return;
        ta.readOnly=false; ta.classList.add("edit"); ta.focus();
      });
    });
    /* Правая кнопка по плитке копирует её содержимое. У живой доски своё меню — туда не лезем. */
    host.querySelectorAll(".fld").forEach(плитка=>{
      плитка.addEventListener("contextmenu", e=>{
        if(e.target.closest && e.target.closest(".excalidraw")) return;
        const f=полеУзла(плитка); if(!f) return;
        e.preventDefault();
        fieldCopyContent(f);
      });
    });
    // тащить можно за любое место плитки; клик по полосе (без протяжки) сворачивает
    host.querySelectorAll(".fld").forEach(плитка=>{
      плитка.addEventListener("pointerdown", e=>{
        if(e.button!==0) return;
        // ручки размера жест перетаскивания не начинают: иначе за них нельзя было бы потянуть
        if(e.target.closest("button, input, textarea:not([readonly]), .excalidraw, .fld-split, .fld-grip")) return;
        перетащить(плитка, e);
      });
    });
    /* Ширина колонок — протяжкой разделителя. Считаем в ПИКСЕЛЯХ по ширине строки и лишь на
       выходе округляем в доли: считать сразу в колонках значило бы дёргаться шагом по
       восьмой части панели. Сумма долей пары неизменна — соседи по строке не двигаются. */
    host.querySelectorAll(".fld-split").forEach(рз=>{
      рз.addEventListener("pointerdown", e=>{
        if(e.button!==0) return;
        e.preventDefault(); e.stopPropagation();
        const a=fields[+рз.dataset.a];
        if(!a) return;
        const строка=рз.parentNode, ширина=строка.getBoundingClientRect().width;
        const x0=e.clientX, шагПкс=ширина/GRID_COLS;
        // тянем ГРАНИЦУ КОЛОНОК, а не плиток: в колонке их бывает несколько, и ширина у них общая
        const левый=рз.previousElementSibling;
        const правый=рз.classList.contains("fld-split-end") ? null : рз.nextElementSibling;
        const колонка=узел=>[...(узел&&узел.classList.contains("fld-col")?узел.querySelectorAll(".fld"):[])]
          .map(n=>fields.find(x=>x.id===n.dataset.fid)).filter(Boolean);
        const слева=колонка(левый), справа=колонка(правый);
        const b=справа[0]||null;
        /* Предел зависит от того, за что тянут. Между колонками пара делит общее: одна шире —
           другая уже. У правого края строки соседа нет, и предел — сколько колонок вообще
           осталось свободными: ужатая строка просто оставляет пустое место справа. */
        const прочие=[...строка.querySelectorAll(":scope > .fld-col")]
          .filter(к=>к!==левый && к!==правый)
          .reduce((m,к)=>m+(колонка(к)[0]||{gw:0}).gw, 0);
        const пара = b ? a.gw+b.gw : GRID_COLS-прочие;
        рз.classList.add("тащим"); document.body.classList.add("fld-split-drag");
        const вести=ev=>{
          const сдвиг=Math.round((ev.clientX-x0)/шагПкс);
          const na=Math.max(2, Math.min(b?пара-2:пара, a.gw+сдвиг));
          if(левый) левый.style.setProperty("--gw", na);
          if(правый) правый.style.setProperty("--gw", пара-na);
          рз.dataset.na=na;
        };
        const кончить=()=>{
          window.removeEventListener("pointermove",вести); window.removeEventListener("pointerup",кончить);
          рз.classList.remove("тащим"); document.body.classList.remove("fld-split-drag");
          const na=+рз.dataset.na;
          if(na && na!==a.gw){
            /* Помечаем всю строку «поделена руками»: иначе нормализация растянула бы её обратно
               на все двенадцать долей, посчитав недобор ошибкой состава. */
            const все=[...строка.querySelectorAll(":scope > .fld-col")].flatMap(к=>колонка(к));
            все.forEach(f=>{ f.gwm=true; });
            слева.forEach(f=>{ f.gw=na; }); справа.forEach(f=>{ f.gw=пара-na; });
            сохранить(); draw();
          }
        };
        window.addEventListener("pointermove",вести); window.addEventListener("pointerup",кончить);
      });
    });
    /* Высота — ручкой по нижней кромке плитки. Задавать её содержимым нельзя: в поле лежит
       и текст, и картинка, и доска, а доска вообще оживает только с определённого размера
       (fieldBoardFits) — значит высота обязана быть тем, что человек задаёт сам. */
    host.querySelectorAll(".fld-grip").forEach(руч=>{
      руч.addEventListener("pointerdown", e=>{
        if(e.button!==0) return;
        e.preventDefault(); e.stopPropagation();
        const плитка=руч.closest(".fld"), f=полеУзла(руч); if(!f||f.off) return;
        const y0=e.clientY, h0=fieldHeight(f.gh);
        руч.classList.add("тащим"); document.body.classList.add("fld-grip-drag");
        let h=h0;
        const вести=ev=>{ h=fieldHeight(h0+(ev.clientY-y0)); плитка.style.height=h+"px"; };
        const кончить=()=>{
          window.removeEventListener("pointermove",вести); window.removeEventListener("pointerup",кончить);
          руч.classList.remove("тащим"); document.body.classList.remove("fld-grip-drag");
          if(h!==h0){
            /* Потянули руками — «всегда по размеру» снимаем. Иначе жест молчал бы: высоту тут
               же вернул бы пересчёт, и со стороны это выглядело бы как «ручка не работает». */
            if(fieldAutoFit(f)){ f.nofit=true; toast("Высоту задаёшь руками",{icon:"ti-aspect-ratio"}); }
            f.gh=h; сохранить(); draw();                // перерисовка нужна доске: порог живой врезки зависит от высоты
          }
        };
        window.addEventListener("pointermove",вести); window.addEventListener("pointerup",кончить);
      });
    });
    host.querySelectorAll(".fld-bar").forEach(бар=>{
      бар.addEventListener("click", e=>{
        if(e.target.closest("button, input, .fld-name")) return;
        const f=полеУзла(бар); if(f) свернуть(f);
      });
    });
    host.querySelectorAll("[data-fa]").forEach(b=>{ b.onclick=()=>действие(b.dataset.fa, полеУзла(b)); });
    host.querySelectorAll("[data-fadd]").forEach(b=>{ b.onclick=()=>добавить(b.dataset.fadd); });
  };

  /* Порядок полей меняют ПЕРЕТАСКИВАНИЕМ за ручку: кнопки «выше/ниже» заставляли кликать
     столько раз, на сколько мест едет поле.

     Геометрию снимаем ОДИН раз, в начале, и во время перетаскивания DOM не трогаем вовсе —
     только сдвигаем блоки через transform. Первая версия переставляла узлы прямо под курсором
     и каждый раз подправляла точку отсчёта; при разной высоте полей это давало дрожь и
     промахи — перетаскивание «почти не работало». Слушатели на ОКНЕ, а не на ручке: курсор
     уходит за её пределы в первые же миллиметры. */
  const свернуть=(f)=>{
    if(!f) return;
    if(f.off) delete f.off; else f.off=true;
    сохранить(); draw();
  };

  const выбрать=(f)=>{
    fieldPickImage().then(url=>{
      if(!url){ toast("Картинку не удалось прочитать",{icon:"ti-photo-off"}); return; }
      if(живьём && f.media && S.media) delete S.media[f.media];   // старую не копим
      f.media=fieldMediaPut(url);
      fieldFitImage(host, f, url).then(()=>{ сохранить(); draw(); });
    });
  };
  /* Ctrl+V мимо врезок: картинка заводит СЕБЕ поле в конце списка. Смысл жеста — «положить это
     сюда», а не «выбери сперва, куда»; поле-приёмник человек всё равно заводил вручную и тут же
     заполнял. Плитку сразу подгоняем под пропорции — как и при обычной вставке во врезку. */
  const принятьНовой=(файл)=>{
    if(fields.length>=FIELDS_MAX){ toast("Полей и так много",{icon:"ti-alert-triangle"}); return; }
    fieldReadImage(файл).then(url=>{
      if(!url){ toast("Это не картинка",{icon:"ti-photo-off"}); return; }
      const нов=fieldMake("image","");
      нов.media=fieldMediaPut(url);
      fields.push(нов);
      // рисуем ДО подгонки: fieldFitImage меряет ширину уже существующей плитки
      сохранить(); draw();
      fieldFitImage(host, нов, url).then(()=>{
        сохранить(); draw();
        const узел=host.querySelector('[data-fid="'+нов.id+'"]');
        if(узел) узел.scrollIntoView({block:"nearest"});
        toast("Картинка вставлена новым полем",{icon:"ti-photo"});
      });
    });
  };
  /* Клик по врезке доски = рисовать ЗДЕСЬ ЖЕ, если врезка достаточно велика (см. fieldBoardFits).
     Не влезает — открываем на весь экран: телефонный интерфейс Excalidraw хуже, чем смена окна. */
  const рисовать=(f, box)=>{
    /* Здесь уже рисуют — выходим. Без этой проверки каждый штрих по холсту всплывал до врезки
       и пересобирал доску заново: со стороны это выглядело как «доска не реагирует на мышь». */
    if(fieldBoardLive && fieldBoardLive.box===box) return;
    if(box && fieldBoardFits(box)){ fieldBoardStart(box, f, opts.item, сохранить); return; }
    fieldOpenBoard(f, opts.item, ()=>{ сохранить(); draw(); });
  };
  const наВесьЭкран=(f)=>{ fieldBoardStop(false); fieldOpenBoard(f, opts.item, ()=>{ сохранить(); draw(); }); };

  const добавить=(t)=>{
    if(t==="tpl"){ openTemplatePick(применитьШаблон); return; }
    if(t==="save"){
      // шаблон запоминает СОСТАВ (типы и названия полей), а не содержимое — см. templateSeed
      openTemplateEditor({ id:"tpl_"+uid(), name:"", kind:(opts.item&&opts.item.kind==="task")?"task":"note",
        tags:(opts.item&&opts.item.tags||[]).slice(),
        // br переносим наравне с размерами: без него шаблон терял бы разбивку на строки,
        // и поля, стоявшие в ряд, приезжали бы каждое своей строкой
        /* В шаблон уезжает ВСЯ раскладка, а не только состав: br (строка), st (под соседом,
           в той же колонке), gw/gh (размеры) и gwm (ширину строки задали руками). Без st поля
           из одной колонки приезжали бы каждое своей колонкой — а именно так их и ставили. */
        fields: fields.map(f=>({type:f.type, name:f.name||"", gw:f.gw, gh:f.gh,
                                br:f.br===true, st:f.st===true, gwm:f.gwm===true, nofit:f.nofit===true})) });
      return;
    }
    if(fields.length>=FIELDS_MAX){ toast("Полей и так много",{icon:"ti-alert-triangle"}); return; }
    const нов=fieldMake(t, "");   // новая плитка идёт СВОЕЙ строкой (br у fieldMake), в ряд её ставят мышью
    fields.push(нов);
    /* Завели доску в узком окне — расширяем окно, а не показываем плашку «мало места»:
       рисовать во врезке можно начиная с 1000 px (fieldBoardFits). Делаем ДО перерисовки,
       чтобы замер врезки увидел уже новую ширину. */
    if(t==="board"){ const окно=host.closest(".modal");
      if(окно && окно.getBoundingClientRect().width<1000) окно.style.width="min(1120px, 94vw)"; }
    сохранить(); draw();
    // картинку НЕ просим сразу файлом: её тащат мышью во врезку (или кнопкой в полосе поля)
    if(t==="text"){ const ta=host.querySelector('.fld-text[data-i="'+(fields.length-1)+'"]'); if(ta) ta.focus(); }
  };

  /* Шаблон ЗАМЕНЯЕТ набор полей, а не дописывает к нему: «заполнить по шаблону» — это про то,
     чтобы нода выглядела как в шаблоне, а добавление копило бы дубли при каждом повторе.
     Если в полях уже что-то написано — спрашиваем: содержимое уйдёт вместе с ними. */
  const применитьШаблон=async(tpl)=>{
    const з=templateSeed(tpl);
    if(!з || !з.fields.length){ toast("В шаблоне нет полей",{icon:"ti-layout-list"}); return; }
    const непусто=fields.some(f=>
      f.type==="text" ? !!(f.value||"").trim()
      : f.type==="image" ? !!f.media
      : !!((S.boards&&S.boards[fieldBoardKey(f.id)]||{}).elements||[]).length);
    if(непусто && !(await uiConfirm("Заменить поля ноды набором из шаблона «"+tpl.name+"»? Заполненные поля будут убраны вместе с содержимым.",
                                    {danger:true, title:"Заполнить по шаблону", okLabel:"Заменить"}))) return;
    fieldsStopIn(host);
    if(живьём) fields.forEach(fieldDrop);   // в черновике окна правки содержимое ещё может вернуть «Отмена»
    fields.length=0;
    з.fields.slice(0,FIELDS_MAX).forEach(f=>fields.push(f));
    fieldsNormalize(fields);   // шаблон несёт разбивку по строкам (br) — доли ширины досчитываем сами
    сохранить(); draw();
    toast("Поля по шаблону «"+tpl.name+"»",{icon:"ti-layout-list"});
  };

  const действие=async(a,f)=>{
    if(!f) return;
    const i=fields.indexOf(f);
    if(a==="full"){ наВесьЭкран(f); return; }
    if(a==="pick"){ выбрать(f); return; }
    /* «Всегда по размеру». Включили — сразу подгоняем: иначе режим выглядел бы сломанным до
       первой смены ширины. Выключили — высота остаётся той, какая есть, и дальше её задают рукой. */
    if(a==="fit"){
      if(fieldAutoFit(f)) f.nofit=true; else delete f.nofit;
      const авто=fieldAutoFit(f);
      const url=(авто && f.media && S.media) ? S.media[f.media] : null;
      if(url) await fieldFitImage(host, f, url);
      сохранить(); draw();
      toast(авто?"Высота едет за картинкой":"Высоту задаёшь руками",{icon:"ti-aspect-ratio"});
      return;
    }
    if(a==="del"){
      const непусто = f.type==="text" ? !!(f.value||"").trim()
                    : f.type==="image" ? !!f.media
                    : !!(S.boards&&S.boards[fieldBoardKey(f.id)]&&(S.boards[fieldBoardKey(f.id)].elements||[]).length);
      if(непусто && !(await uiConfirm("Убрать поле «"+(f.name||FIELD_META[f.type].name)+"» вместе с содержимым?",
                                      {danger:true,title:"Убрать поле",okLabel:"Убрать"}))) return;
      fields.splice(i,1);
      // содержимое сносим только когда правка идёт вживую: в черновике окна правки его ещё
      // может вернуть «Отмена», а осиротевшее подметёт санитайзер на следующей загрузке
      if(живьём) fieldDrop(f);
      сохранить(); draw();
    }
  };

  /* Разделитель меняет ширину панели БЕЗ перерисовки полей, и «всегда по размеру» обязано ехать
     следом — иначе режим работал бы ровно до первого движения разделителя. Наблюдателя заводим
     заново на каждую панель: прежний держал бы старый массив полей (панель одна на три места). */
  if(host.__fitRO){ host.__fitRO.disconnect(); host.__fitRO=null; }
  if(typeof ResizeObserver!=="undefined"){
    host.__fitRO=new ResizeObserver(()=>{ if(fieldsFitAuto(host, fields)) позже(сохранить); });
    host.__fitRO.observe(host);
  }
  host._fieldsDraw=draw;   // владелец панели может попросить перерисовать (сменилась тема, вернулись с доски)
  /* Метка для вставки: по ней Ctrl+V находит панель (в окне — любую, в правой панели — ту, что
     под курсором). Класс, а не реестр: панель живёт ровно столько, сколько её узел в DOM. */
  host.classList.add("fld-host");
  host.__полеПаста=принятьНовой;
  draw();                  // слушатели вставки ставит wire() внутри отрисовки
  return { draw };
}

/* Плитку под пропорции вставленной картинки: ширину человек уже выбрал, а высоту считаем от
   неё — «картинка по размеру картинки» без ручной подгонки.

   Ширину меряем у САМОЙ ПЛИТКИ. Раньше мерили узел `.fld-grid`, а его в панели нет с тех пор,
   как поля переехали на строки и колонки: querySelector отдавал пусто, функция молча выходила,
   и картинка ложилась в плитку прежней высоты — куском или с пустыми полями по краям. */
function fieldFitImage(host, f, url){
  return new Promise(res=>{
    const плитка=host.querySelector('[data-fid="'+f.id+'"]');
    const ширина=Math.max(40, плитка ? плитка.getBoundingClientRect().width
                    : host.getBoundingClientRect().width/GRID_COLS*f.gw - GRID_GAP);
    const img=new Image();
    img.onerror=()=>res(false);
    img.onload=()=>{
      f.gh=fieldImgHeight(ширина, img);
      res(true);
    };
    img.src=url;
  });
}
/* Высота плитки под КАРТИНКУ, а не под ширину плитки. Картинка не растягивается сверх своего
   размера (max-width/max-height в styles.css), поэтому в широкой плитке она лежит по центру
   своей натуральной ширины — а высота, посчитанная от ширины ПЛИТКИ, оставляла над ней и под
   ней по сотне пустых пикселей. Берём ту ширину, которой картинка показана на самом деле. */
function fieldImgHeight(ширинаПлитки, img){
  const w=img.naturalWidth||ширинаПлитки, h=img.naturalHeight||w;
  const показана=Math.min(ширинаПлитки, w);
  return fieldHeight(Math.round(показана*(h/w))+FIELD_BAR_H);
}
/* «Всегда по размеру»: высота плитки едет за её шириной. Хранится ОТКАЗ от режима (f.nofit), а не
   согласие: по умолчанию картинка сама держит свой размер — так же ведут себя и поля, вставленные
   до появления кнопки, иначе они навсегда остались бы с пустотами вокруг картинки.
   Правим ТОЛЬКО высоту и только в разметке, без перерисовки панели: пересчёт случается на каждом
   движении разделителя, а перерисовка на каждом кадре сносила бы живую доску и сбрасывала правку. */
const fieldAutoFit = f => !!f && f.type==="image" && f.nofit!==true;
function fieldsFitAuto(host, fields){
  let менялось=false;
  (fields||[]).forEach(f=>{
    if(!fieldAutoFit(f) || !f.media) return;
    const плитка=host.querySelector('[data-fid="'+f.id+'"]');
    const img=плитка ? плитка.querySelector(".fld-img") : null;
    if(!плитка || !img || !img.naturalWidth) return;
    const h=fieldImgHeight(плитка.getBoundingClientRect().width, img);
    if(h===f.gh) return;
    f.gh=h; плитка.style.height=h+"px"; менялось=true;
  });
  return менялось;
}

/* ---------- шаблоны нод ---------- */

function templateById(id){ return (S.templates||[]).find(t=>t.id===id)||null; }
function templateDefault(){ return templateById(S.settings&&S.settings.template); }
/* Шаблон → заготовка новой ноды. Поля создаются ПУСТЫМИ: шаблон описывает состав («две
   текстовые колонки с такими-то названиями»), а не содержимое. Названия ноды в шаблоне нет
   намеренно: одинаковый заголовок у всех нод одного шаблона не помогает их различать, а
   вписать своё всё равно приходится. */
function templateSeed(tpl, kind){
  if(!tpl) return null;
  return { kind: kind || tpl.kind || "note",
           tags: (tpl.tags||[]).slice(),
           // доли ширины досчитываем нормализацией: в шаблоне они могли остаться от строки
           // другого состава (поле из ряда удалили — соседям положено разъехаться на всю строку)
           /* fieldMake ставит br каждому полю (новое поле идёт своей строкой), поэтому в шаблоне
              флаг СНИМАЕМ, если его там нет: иначе стоявшие в ряд поля разъезжались бы. */
           fields: fieldsNormalize((tpl.fields||[]).map((f,i)=>{ const н=fieldMake(f.type, f.name);
             if(f.gw) н.gw=gridW(f.gw); if(f.gh) н.gh=fieldHeight(f.gh);
             if(f.br!==true) delete н.br;
             if(f.st===true && i>0) н.st=true;      // «под предыдущим, в той же колонке»
             if(f.gwm===true) н.gwm=true;           // ширину строки задавали руками — не выравнивать
             if(f.nofit===true && н.type==="image") н.nofit=true;   // «высоту задаю руками» едет вместе с раскладкой
             return н; })) };
}

/* Выбор шаблона для УЖЕ созданной ноды. Отдельное окно, а не выпадашка: шаблонов бывает
   с десяток, и в списке надо видеть, какие поля приедут. */
function openTemplatePick(onPick){
  const список=(S.templates||[]);
  const m=el("div","modal");
  m.innerHTML=`<h3><i class="ti ti-layout-list"></i>Заполнить по шаблону</h3>
    ${список.length
      ? `<div class="tpl-note">Набор полей ноды станет таким, как в шаблоне. Название и тип ноды не меняются.</div>
         <div class="tpl-pick-list">${список.map(t=>`
           <button type="button" class="tpl-pick" data-p="${esc(t.id)}">
             <i class="ti ${t.kind==="task"?"ti-checklist":"ti-note"}"></i>
             <span class="nm">${esc(t.name)}</span>
             <span class="tpl-cnt">${t.fields.length?esc(t.fields.map(f=>f.name||FIELD_META[f.type].name).join(" · ")):"без полей"}</span>
           </button>`).join("")}</div>`
      : `<div class="tpl-empty">Шаблонов пока нет — заведи первый в управлении.</div>`}
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="tp-close">Закрыть</button>
      <button class="btn" id="tp-mgr"><i class="ti ti-settings"></i>Управление шаблонами</button>
    </div></div>`;
  const ov=overlay(m);
  $("#tp-close",m).onclick=()=>closeOverlay(ov);
  $("#tp-mgr",m).onclick=()=>{ closeOverlay(ov); openTemplateManager(); };
  m.querySelectorAll("[data-p]").forEach(b=>b.onclick=()=>{
    const t=templateById(b.dataset.p); closeOverlay(ov); if(t && onPick) onPick(t);
  });
}

function openTemplateManager(){
  const m=el("div","modal");
  // поле по узлу разметки: порядок в списке меняется библиотекой, индексам доверять нельзя
  const draw=()=>{
    const список=(S.templates||[]);
    m.innerHTML=`<h3><i class="ti ti-layout-list"></i>Шаблоны нод</h3>
      <div class="tpl-note">Шаблон задаёт, с какими полями рождается новая заметка или задача.
        Отмеченный звёздочкой применяется по умолчанию; без него нода создаётся как раньше — с одним описанием.</div>
      <div id="tpl-list">${список.length?список.map(t=>`
        <div class="area-row" data-id="${esc(t.id)}">
          <button class="tpl-def${S.settings.template===t.id?" on":""}" data-def="${esc(t.id)}" title="${S.settings.template===t.id?"Снять «по умолчанию»":"Сделать шаблоном по умолчанию"}"><i class="ti ${S.settings.template===t.id?"ti-star-filled":"ti-star"}"></i></button>
          <i class="ti ${t.kind==="task"?"ti-checklist":"ti-note"}"></i>
          <span class="nm">${esc(t.name)}</span>
          <span class="tpl-cnt">${t.fields.length?t.fields.length+" "+plural(t.fields.length,"поле","поля","полей"):"без полей"}</span>
          <button data-edit="${esc(t.id)}" title="Изменить"><i class="ti ti-pencil"></i></button>
          <button data-del="${esc(t.id)}" title="Удалить"><i class="ti ti-trash"></i></button>
        </div>`).join(""):`<div class="tpl-empty">Шаблонов пока нет.</div>`}</div>
      <div class="modal-foot"><div class="right">
        <button class="btn ghost" id="tpl-close">Закрыть</button>
        <button class="btn primary" id="tpl-add"><i class="ti ti-plus"></i>Новый шаблон</button>
      </div></div>`;
    $("#tpl-close",m).onclick=()=>closeOverlay(ov);
    $("#tpl-add",m).onclick=()=>openTemplateEditor(null, draw);
    m.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openTemplateEditor(templateById(b.dataset.edit), draw));
    m.querySelectorAll("[data-def]").forEach(b=>b.onclick=()=>{
      S.settings.template = (S.settings.template===b.dataset.def) ? null : b.dataset.def;
      persist(); draw();
      toast(S.settings.template?"Шаблон по умолчанию: "+templateById(S.settings.template).name:"Шаблон по умолчанию снят",{icon:"ti-star"});
    });
    m.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
      const t=templateById(b.dataset.del); if(!t) return;
      if(!(await uiConfirm("Удалить шаблон «"+t.name+"»? Ноды, созданные по нему, останутся как есть.",
                           {danger:true,title:"Удалить шаблон",okLabel:"Удалить"}))) return;
      S.templates=S.templates.filter(x=>x.id!==t.id);
      if(S.settings.template===t.id) S.settings.template=null;
      persist(); draw();
    });
  };
  const ov=overlay(m); draw();
}

function openTemplateEditor(tpl, after){
  // «новый» — это не «не передали шаблон», а «такого ещё нет в списке»: из окна правки сюда
  // приходит готовая заготовка (состав полей текущей ноды), и она тоже новая
  const isNew = !tpl || !templateById(tpl.id);
  const t = tpl ? JSON.parse(JSON.stringify(tpl))
                : {id:"tpl_"+uid(), name:"", kind:"note", tags:[], fields:[]};
  const m=el("div","modal");
  m.innerHTML=`<h3><i class="ti ti-layout-list"></i>${isNew?"Новый шаблон":"Шаблон"}</h3>
    <div class="field"><label>Название шаблона</label>
      <input type="text" id="tp-name" value="${esc(t.name)}" placeholder="Например: разбор задачи"></div>
    <div class="field"><label>Тип ноды</label>
      <div class="seg" id="tp-kind">
        <button data-k="task" class="${t.kind==="task"?"on":""}"><i class="ti ti-checklist"></i> Задача</button>
        <button data-k="note" class="${t.kind==="note"?"on":""}"><i class="ti ti-note"></i> Заметка</button>
      </div></div>
    <div class="field"><label>Поля</label>
      <div class="tpl-fields" id="tp-fields"></div>
      <div class="fld-add">
        <span>Добавить:</span>
        <button type="button" data-tadd="text"><i class="ti ti-align-left"></i>текст</button>
        <button type="button" data-tadd="image"><i class="ti ti-photo"></i>картинка</button>
        <button type="button" data-tadd="board"><i class="ti ti-artboard"></i>доска</button>
      </div></div>
    <div class="modal-foot"><div class="right">
      <button class="btn ghost" id="tp-cancel">Отмена</button>
      <button class="btn primary" id="tp-save"><i class="ti ti-check"></i>Сохранить</button>
    </div></div>`;
  const ov=overlay(m);
  m.querySelectorAll("#tp-kind button").forEach(b=>b.onclick=()=>{
    t.kind=b.dataset.k; m.querySelectorAll("#tp-kind button").forEach(x=>x.classList.toggle("on",x===b)); });

  const поля=$("#tp-fields",m);
  const рисоватьПоля=()=>{
    поля.innerHTML = t.fields.length ? t.fields.map((f,i)=>{
      const meta=FIELD_META[f.type]||FIELD_META.text;
      return `<div class="tpl-f"><i class="ti ${meta.icon}" title="${esc(meta.name)}"></i>
        <input type="text" data-i="${i}" value="${esc(f.name||"")}" placeholder="${esc(meta.name)} — название поля">
        <button type="button" class="fld-b" data-ta="up" data-i="${i}" title="Выше"><i class="ti ti-chevron-up"></i></button>
        <button type="button" class="fld-b" data-ta="down" data-i="${i}" title="Ниже"><i class="ti ti-chevron-down"></i></button>
        <button type="button" class="fld-b" data-ta="del" data-i="${i}" title="Убрать"><i class="ti ti-x"></i></button></div>`;
    }).join("") : `<div class="tpl-empty">Без полей — нода родится с одним описанием.</div>`;
    поля.querySelectorAll("input[data-i]").forEach(inp=>{
      inp.oninput=()=>{ t.fields[+inp.dataset.i].name=inp.value.slice(0,80); }; });
    поля.querySelectorAll("[data-ta]").forEach(b=>b.onclick=()=>{
      const i=+b.dataset.i, a=b.dataset.ta;
      if(a==="del") t.fields.splice(i,1);
      else { const j=i+(a==="up"?-1:1); if(j<0||j>=t.fields.length) return; t.fields.splice(j,0,t.fields.splice(i,1)[0]); }
      рисоватьПоля();
    });
  };
  рисоватьПоля();
  m.querySelectorAll("[data-tadd]").forEach(b=>b.onclick=()=>{
    if(t.fields.length>=FIELDS_MAX) return;
    // новое поле шаблона идёт СВОЕЙ строкой: без флага оно встало бы колонкой к предыдущему
    t.fields.push({type:b.dataset.tadd, name:"", gh:fieldHeightFor(b.dataset.tadd), gw:GRID_COLS, br:true}); рисоватьПоля();
    const inp=поля.querySelector('input[data-i="'+(t.fields.length-1)+'"]'); if(inp) inp.focus();
  });

  $("#tp-cancel",m).onclick=()=>closeOverlay(ov);
  $("#tp-save",m).onclick=()=>{
    const name=$("#tp-name",m).value.trim();
    if(!name){ $("#tp-name",m).focus(); return; }
    t.name=name;
    if(!Array.isArray(S.templates)) S.templates=[];
    const был=S.templates.findIndex(x=>x.id===t.id);
    if(был>=0) S.templates[был]=t; else S.templates.push(t);
    persist(); closeOverlay(ov); if(after) after();
    toast(isNew?"Шаблон создан":"Шаблон сохранён",{icon:"ti-layout-list"});
  };
  setTimeout(()=>$("#tp-name",m).focus(),30);
}
