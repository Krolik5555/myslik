"use strict";
/* ===========================================================
   ОТЧЁТ ИЗ ВЫДЕЛЕННОГО
   -----------------------------------------------------------
   Выделяешь заметки/задачи в графе → «Отчёт». Два режима:
   • Простой — детерминированный текст (заметки + задачи по статусу), мгновенно, без ИИ.
   • Через ИИ — модель пишет связный отчёт прозой (провайдер из Настройки → ИИ).
   Отчёт можно скопировать или сохранить как заметку.
   =========================================================== */

/* Статус для отчёта. Значения берём из общего реестра (СТАТУСЫ в core.js), а не перечисляем
   заново: раньше здесь была лесенка из if, и каждый новый статус пришлось бы дописывать в
   четырёх местах этого файла — маркер, мета, сводка и сам разбор. Заметки и схемы отчёт по
   статусу не разбирает: у них он вспомогательный, в тексте они идут обычным буллетом. */
function reportStatusOf(it){
  if(!it || it.kind!=="task") return null;
  if(it.done) return "done";
  return (typeof СТАТУСЫ!=="undefined" && СТАТУСЫ[it.status] && it.status!=="note") ? it.status : "todo";
}

// человекочитаемая дата timestamp → «дд.мм.гггг»
function _repTs(ts){ try{ return new Date(ts).toLocaleDateString("ru"); }catch(e){ return ""; } }

// маркер пункта: • заметка · ✓/►/○ задача по статусу
function _reportMarker(it){
  const st=reportStatusOf(it);
  return (st && СТАТУСЫ[st] && СТАТУСЫ[st].маркер) || "•";
}
function _reportMeta(it){
  const st=reportStatusOf(it), meta=[];
  if(st==="done" && it.doneAt) meta.push("выполнено "+_repTs(it.doneAt));
  if(st && st!=="done" && it.due){ const dl=(typeof dueLabel==="function")?dueLabel(it.due):null; meta.push("срок "+(dl&&dl.txt?dl.txt:it.due)); }
  if(it.priority) meta.push("!".repeat(it.priority));
  return meta.length?"  ("+meta.join(", ")+")":"";
}
/* детерминированный «простой» отчёт: ДЕРЕВО по иерархии (parent), маркеры статусов, сводка задач.
   opts.folders — добавить путь к папке каждой ноды. По умолчанию ВЫКЛЮЧЕНО: папки привязаны
   почти ко всем нодам, и в обычном отчёте (о чём сделано, что осталось) длинные пути — шум.
   Нужны они в одном случае — когда отчёт передают смежнику, чтобы тот забрал файлы. */
function buildReportText(items, opts){
  const withFolders=!!(opts && opts.folders);
  items=(items||[]).filter(Boolean);
  const idset=new Set(items.map(i=>i.id));
  const children={}, roots=[];
  items.forEach(i=>{ if(i.parent && idset.has(i.parent)){ (children[i.parent]=children[i.parent]||[]).push(i); } else roots.push(i); });

  const L=[];
  let head="Отчёт · "+items.length+" элем.";
  try{ head+=" · "+new Date().toLocaleDateString("ru"); }catch(e){}
  L.push(head);
  // краткая сводка по задачам (если они есть)
  const tasks=items.filter(i=>i.kind==="task");
  if(tasks.length){
    const cnt=s=>tasks.filter(t=>reportStatusOf(t)===s).length;
    /* Сводка идёт ЦИКЛОМ по реестру, а не четырьмя парами if: каждая пара звала cnt() дважды и
       требовала правки на каждый новый статус — как раз то место, про которое забывают. */
    const p=[];
    ["done","doing","review","waiting","next","paused","todo"].forEach(k=>{
      const n=cnt(k); if(!n || !СТАТУСЫ[k]) return;
      p.push(СТАТУСЫ[k].маркер+" "+n+" "+({done:"выполнено", doing:"в работе", review:"на проверке",
             waiting:"ждёт", next:"на очереди", paused:"на паузе", todo:"не начато"}[k]||СТАТУСЫ[k].имя.toLowerCase()));
    });
    L.push("Задачи: "+tasks.length+(p.length?" — "+p.join(", "):""));
  }
  if(withFolders){ const n=items.filter(i=>i.folder).length; if(n) L.push("Папок: "+n); }
  L.push("");

  const seen=new Set();
  const walk=(it, depth)=>{
    if(seen.has(it.id)) return; seen.add(it.id);   // защита от циклов parent
    const ind="  ".repeat(depth);
    L.push(ind+_reportMarker(it)+" "+((it.title||"").trim()||"(без названия)")+_reportMeta(it));
    // Папка ноды — ради того отчёт и собирают: смежник должен знать, откуда забирать работу.
    // Путь укорочен до общей части Dropbox (см. shortFolder в core.js), иначе у него он не откроется.
    if(withFolders && it.folder) L.push(ind+"    Папка: "+((typeof shortFolder==="function")?shortFolder(it.folder):it.folder));
    const b=(it.body||"").trim();
    if(b) L.push(ind+"    "+b.replace(/\n/g,"\n"+ind+"    "));
    /* Именованные поля идут в отчёт вслед за описанием: смежник читает отчёт вместо ноды,
       и текст, написанный в поле «Что сделано», нужен ему не меньше общего описания. */
    (typeof fieldsOf==="function"?fieldsOf(it):[]).forEach(f=>{
      if(f.type!=="text") return;
      const v=(f.value||"").trim(); if(!v) return;
      L.push(ind+"    "+(f.name?f.name+": ":"")+v.replace(/\n/g,"\n"+ind+"    "));
    });
    (children[it.id]||[]).forEach(ch=>walk(ch, depth+1));
  };
  roots.forEach(r=>walk(r,0));
  if(!items.length) L.push("(в выделении нет заметок или задач)");
  return L.join("\n");
}

// подстраховка: если модель всё же выдала markdown (*, +, -, ###, **) — чистим в аккуратный текст
function _reportCleanMd(s){
  return (s||"").split("\n").map(line=>{
    line=line.replace(/^(\s*)#{1,6}\s+/, "$1");           // ### заголовок → без решётки
    line=line.replace(/^(\s*)[*+\-]\s+/, "$1• ");          // маркер списка → чистый буллет (отступ = иерархия)
    line=line.replace(/\*\*(.+?)\*\*/g, "$1");             // **жирный** → просто текст
    line=line.replace(/`([^`]+)`/g, "$1");                 // `код` → просто текст
    return line;
  }).join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

/* Список «владелец — путь» в читаемый вид: запись остаётся ОДНОЙ строкой, между записями —
   пустая. Модель отдаёт строки вплотную, и пути такой длины сливаются в простыню; разносить
   же владельца и путь по разным строкам оказалось хуже — читается как два разных пункта.
   Формат наводит КОД, а не уговоры в промпте: так он одинаков у любого провайдера.
   Строки без пути (например «Подходящих папок нет») проходят как есть. */
function _repFormatList(text){
  const L=[];
  (text||"").split("\n").forEach(line=>{
    const s=line.trim();
    if(!s) return;
    if(L.length) L.push("");
    L.push(s);
  });
  return L.join("\n");
}

/* Что из выделенного в список не попало и почему. Модель молчит о пропусках, и «нет Neon»
   выглядит как её ошибка, хотя чаще у ноды просто НЕ ПРИВЯЗАНА папка — выводить было нечего.
   Это код знает точно, поэтому говорит сам. */
function _repMissing(items, text, refs){
  const out=[];
  const byId={}; items.forEach(i=>byId[i.id]=i);
  const owner=it=>{ const p=it.parent&&byId[it.parent]; return (p&&(p.title||"").trim()) ? p.title.trim()+" → " : ""; };
  const noFolder=items.filter(i=>!i.folder);
  if(noFolder.length){
    const list=noFolder.slice(0,8).map(i=>owner(i)+((i.title||"").trim()||"(без названия)"));
    // точка с запятой, а не запятая: внутри записи уже есть «владелец → нода», и по запятым
    // «Neon, Neon → Рендер» читается как три разных пункта
    out.push("Папка не привязана ("+noFolder.length+"): "+list.join("; ")
      +(noFolder.length>8?" и ещё "+(noFolder.length-8):""));
  }
  const used=(refs||[]).filter(p=>p && (text||"").includes(p)).length;
  if(refs && refs.length) out.push("Папок в выделении: "+refs.length+", в списке: "+used+".");
  return out;
}

/* Строки ответа ИИ, где есть путь, но НИ ОДИН исходный путь не встречается дословно.
   Признак пути — обратный слэш: модель могла сократить «…\renders\final\astra_compositing»
   до «…\final», и такая строка выглядит правдоподобно, а у получателя не откроется.
   Сверяем вхождением эталона целиком: искажённая строка не содержит его ни в каком виде. */
function _repBadPaths(text, refs){
  if(!refs || !refs.length) return [];
  return (text||"").split("\n")
    .filter(s=>s.includes("\\") && !refs.some(p=>p && s.includes(p)))
    .map(s=>s.trim()).filter(Boolean);
}

// надёжное копирование в буфер (file:// в WebView2 — не secure context, clipboard API может не сработать)
async function _repCopy(text){
  try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(text); return true; } }catch(e){}
  try{
    const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.focus(); ta.select();
    const ok=document.execCommand("copy"); ta.remove(); return ok;
  }catch(e){ return false; }
}

/* ОТЧЁТ ЖИВЁТ В ПРАВОЙ ПАНЕЛИ, а не во всплывающем окне: окно накрывало граф, ради которого
   отчёт и собирают, — не видно ни выделения, ни того, что в него попало. Состояние держим
   модульно (как asideId в views.js): панель перерисовывается на каждую правку поля, и локальные
   переменные обработчиков её не пережили бы. В данные это не пишется — вопрос одного сеанса. */
let repState=null;

function repReset(){ repState=null; }            // выделение сменилось — прежний отчёт больше не про него
function repActive(){ return !!repState; }
function repItems(){ return ((repState&&repState.ids)||[]).map(liveById).filter(Boolean); }

// вход: кнопка «Отчёт» над выделением в графе
function repOpen(items){
  const ids=(items||[]).filter(Boolean).map(i=>typeof i==="string"?i:i.id);
  if(!ids.length){ toast("Нечего в отчёт — выдели заметки или задачи",{icon:"ti-file-text"}); return; }
  repState={ids, mode:"simple", folders:false, asList:false, purpose:"", aiText:null, loading:false};
  if(typeof renderAside==="function") renderAside();
}

function repPanelHtml(){
  const items=repItems();
  if(!items.length) return "";
  const st=repState;
  const aiReady = !!(typeof AICap!=="undefined" && AICap.status && AICap.status.available);
  const anyFolder = items.some(i=>i.folder);
  const aiOn = st.mode==="ai" && aiReady;
  return `<div class="as-sec">Отчёт<span class="as-cnt">${items.length}</span></div>
    <div class="rep-panel">
      <div class="rep-head">
        <div class="seg" id="rep-mode">
          <button data-m="simple" class="${st.mode==="simple"?"on":""}">Простой</button>
          <button data-m="ai" class="${st.mode==="ai"?"on":""}">Через ИИ${aiReady?"":" ·  выкл"}</button>
        </div>
      </div>
      <div class="rep-ai-ctl" style="display:${aiOn?"flex":"none"}">
        <label id="rep-purpose-lb">${st.asList?"Запрос":"Цель"}</label>
        <input type="text" id="rep-purpose" value="${esc(st.purpose||"")}" placeholder="${st.asList?"напр. «папки с рендерами» — по чему отбирать":"напр. «баг-репорт разработчику» — необязательно"}" autocomplete="off">
        <button class="btn primary" id="rep-regen">${st.aiText?`<i class="ti ti-refresh"></i>Пересобрать`:`<i class="ti ti-sparkles"></i>Собрать через ИИ`}</button>
      </div>
      ${anyFolder?`<div class="rep-opts">
        <button class="sw-row" id="rep-folders" title="Добавить в отчёт пути к папкам нод — для передачи работы смежнику">
          <span class="sw${st.folders?" on":""}"></span><span class="sw-t">Папки в отчёте</span></button>
        <button class="sw-row" id="rep-list" style="display:${aiOn?"flex":"none"}" title="Вместо связного текста — список «владелец — папка» по твоему запросу">
          <span class="sw${st.asList?" on":""}"></span><span class="sw-t">Списком</span></button>
      </div>`:""}
      <pre class="rep-out" id="rep-out"></pre>
      <div class="rep-acts">
        <button class="btn ghost" id="rep-copy"><i class="ti ti-copy"></i>Копировать</button>
        <button class="btn ghost" id="rep-save" title="Сохранить отчёт как заметку"><i class="ti ti-note"></i>Сохранить</button>
        <button class="btn ghost" id="rep-close" title="Убрать отчёт из панели"><i class="ti ti-x"></i></button>
      </div>
    </div>`;
}

function repPanelWire(root){
  const st=repState; if(!st) return;
  const items=repItems(); if(!items.length) return;
  const aiReady = !!(typeof AICap!=="undefined" && AICap.status && AICap.status.available);
  // укороченные пути выделенного — эталон для сверки ответа ИИ (см. _repBadPaths)
  const refPaths=items.filter(i=>i.folder).map(i=>(typeof shortFolder==="function")?shortFolder(i.folder):i.folder);
  let simple=buildReportText(items,{folders:st.folders});

  const out=root.querySelector("#rep-out");
  const aiCtl=root.querySelector(".rep-ai-ctl");
  const regenBtn=root.querySelector("#rep-regen");
  const listBtn=root.querySelector("#rep-list");
  const folBtn=root.querySelector("#rep-folders");
  const purposeLb=root.querySelector("#rep-purpose-lb");
  const purposeIn=root.querySelector("#rep-purpose");
  if(!out) return;
  const paint=()=>{
    if(st.mode==="simple"){ out.textContent=simple; }
    else if(st.loading){ out.textContent="ИИ собирает отчёт…"; }
    else if(st.aiText){ out.textContent=st.aiText; }
    else if(!aiReady){ out.textContent="ИИ выключен. Включи провайдера в Настройки → ИИ."; }
    else { out.textContent="Впиши цель (по желанию) и нажми «Собрать через ИИ» — модель соберёт отчёт (потратит немного токенов провайдера)."; }
    const aiOn = st.mode==="ai" && aiReady;
    aiCtl.style.display = aiOn ? "flex" : "none";
    // «Списком» — формат ИИ-ответа, в простом отчёте его нет: там сортировать нечего
    if(listBtn) listBtn.style.display = aiOn ? "flex" : "none";
    if(purposeLb) purposeLb.textContent = st.asList ? "Запрос" : "Цель";
    if(purposeIn) purposeIn.placeholder = st.asList
      ? "напр. «папки с рендерами» — по чему отбирать"
      : "напр. «баг-репорт разработчику» — необязательно";
    // одна кнопка: «Собрать через ИИ» пока отчёта нет, дальше «Пересобрать»
    regenBtn.innerHTML = st.aiText ? `<i class="ti ti-refresh"></i>Пересобрать` : `<i class="ti ti-sparkles"></i>Собрать через ИИ`;
  };
  const curText=()=> (st.mode==="ai" && st.aiText) ? st.aiText : simple;

  const genAi=async()=>{
    if(!aiReady){ toast("Включи ИИ в Настройки → ИИ",{icon:"ti-sparkles"}); return; }
    if(st.loading) return;
    st.loading=true; st.aiText=null; paint();
    const purpose=(purposeIn && purposeIn.value||"").trim(); st.purpose=purpose;
    try{
      const r=await window.pywebview.api.ai_report(simple, purpose, st.asList?"list":"prose");
      if(r&&r.ok){
        let aiText=_reportCleanMd((r.text||"").trim())||"(пустой ответ)";
        // Путь прошёл через модель — она могла его сократить или «поправить». Строку с путём,
        // которая не совпала ни с одним исходным дословно, показываем явно: молча отданный
        // битый путь у получателя просто не откроется, и виноватым окажется отчёт.
        // Обе сверки — по СЫРОМУ ответу, пока «владелец — путь» лежит одной строкой.
        const bad=_repBadPaths(aiText, refPaths);
        const miss=st.asList ? _repMissing(items, aiText, refPaths) : [];
        if(st.asList) aiText=_repFormatList(aiText);
        if(bad.length){
          aiText+="\n\n— — —\nПути в этих строках НЕ совпали с исходными, сверь вручную:\n"+bad.map(s=>"  "+s).join("\n");
          toast("ИИ изменил "+bad.length+" путь(и) — сверь",{icon:"ti-alert-triangle"});
        }
        if(miss.length) aiText+="\n\n— — —\n"+miss.join("\n");
        // Модель упёрлась в лимит токенов и оборвала текст на полуслове. Молчать об этом
        // нельзя: обрубок выглядит как законченный отчёт, и человек унесёт его дальше как есть.
        if(r.truncated){
          aiText+="\n\n— — —\nОтвет оборван на лимите длины: возьми меньше элементов или сузь цель.";
          toast("Отчёт оборван по длине",{icon:"ti-alert-triangle"});
        }
        st.aiText=aiText;
      }
      else { toast("ИИ-отчёт: "+((typeof aiErrMsg==="function")?aiErrMsg(r):"ошибка"),{icon:"ti-alert-triangle"}); }
    }catch(e){ toast("Не удалось собрать ИИ-отчёт",{icon:"ti-alert-triangle"}); }
    st.loading=false; paint();
  };
  paint();

  root.querySelectorAll("#rep-mode button").forEach(b=>b.onclick=()=>{
    root.querySelectorAll("#rep-mode button").forEach(x=>x.classList.toggle("on",x===b));
    st.mode = b.dataset.m==="ai" ? "ai" : "simple";
    paint();   // НЕ запускаем ИИ автоматически — только по кнопке (чтобы случайно не жечь токены)
  });
  regenBtn.onclick=genAi;
  if(purposeIn) purposeIn.oninput=()=>{ st.purpose=purposeIn.value; };   // переживает перерисовку панели

  if(folBtn) folBtn.onclick=()=>{
    st.folders=!st.folders;
    folBtn.querySelector(".sw").classList.toggle("on",st.folders);
    simple=buildReportText(items,{folders:st.folders});
    // Готовый ИИ-отчёт собран по ДРУГОМУ черновику: оставить его на экране значило бы
    // показывать текст без папок при включённом выключателе. Пересборка — по кнопке, как и была.
    st.aiText=null;
    paint();
  };

  if(listBtn) listBtn.onclick=()=>{
    st.asList=!st.asList;
    listBtn.querySelector(".sw").classList.toggle("on",st.asList);
    // Списку нужны пути в черновике: без них модели нечего перечислять, и она начнёт
    // выдумывать. Поэтому «Списком» включает «Папки» само, а не молча выдаёт пустоту.
    if(st.asList && !st.folders && folBtn){ folBtn.click(); toast("Папки включены — списку нужны пути",{icon:"ti-folder"}); }
    st.aiText=null;
    paint();
  };

  root.querySelector("#rep-copy").onclick=async()=>{
    const ok=await _repCopy(curText());
    toast(ok?"Скопировано":"Не удалось скопировать",{icon:ok?"ti-copy":"ti-alert-triangle"});
  };
  root.querySelector("#rep-save").onclick=()=>{
    let title="Отчёт"; try{ title="Отчёт "+new Date().toLocaleDateString("ru"); }catch(e){}
    addItem({kind:"note", title:title, body:curText()});
    persist(); if(typeof render==="function") render();
    toast("Отчёт сохранён заметкой",{icon:"ti-note"});
  };
  root.querySelector("#rep-close").onclick=()=>{ repReset(); if(typeof renderAside==="function") renderAside(); };
}
