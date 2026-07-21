"use strict";
/* ===========================================================
   RENDER
   =========================================================== */
const NAV=[
  ["today","ti-sun","Сегодня"],
  ["tasks","ti-checklist","Задачи"],
  ["notes","ti-affiliate","Заметки"],
  ["board","ti-folders","Папки"],
  ["cal","ti-calendar-month","Календарь"],
  ["bin","ti-trash","Корзина"]
];

// Неразобранное = мысль, которую ещё не поставили на холст (нет координат). Считаем ради
// бейджа на «Заметках»: лоток живёт внутри графа, и, не заходя туда, про накопившееся
// (например, пачку из Telegram) человек бы не узнал вовсе.
function counts(){
  let unsorted=0, todayN=0, binN=0;
  S.items.forEach(it=>{
    if(it.deleted){ binN++; return; }
    if(it.x==null) unsorted++;
    if(it.kind==="task" && !it.done && it.due && parseYmd(it.due)<=today()) todayN++;
  });
  return {unsorted, today:todayN, bin:binN};
}

function renderNav(){
  const c=counts();
  $("#nav").innerHTML = NAV.map(n=>{
    const badge = (n[0]==="notes"&&c.unsorted)?`<span class="badge">${c.unsorted}</span>`
                : (n[0]==="today"&&c.today)?`<span class="badge">${c.today}</span>`
                : (n[0]==="bin"&&c.bin)?`<span class="badge">${c.bin}</span>`:"";
    return `<button class="navi ${view===n[0]?"on":""}" data-v="${n[0]}"><i class="ti ${n[1]}"></i>${n[2]}${badge}</button>`;
  }).join("");
  $("#areas").innerHTML = S.areas.map(a=>{
    const tasks=S.items.filter(it=>it.kind==="task"&&it.area===a.id&&!it.deleted);
    const n=tasks.filter(it=>!it.done&&it.status!=="note").length;
    const pct=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):null;
    const col=a.color?`style="color:${a.color}"`:"";
    return `<button class="areai ${areaFilter===a.id?"on":""}" data-area="${a.id}"><i class="ti ${a.icon}" ${col}></i>${esc(a.name)}<span class="cnt">${n||""}${pct!=null?" ("+pct+"%)":""}</span></button>`;
  }).join("");
}

function head(title, sub, actions){
  $("#main-title").textContent=title;
  $("#main-sub").innerHTML=sub||"";
  $("#head-actions").innerHTML=actions||"";
}

function taskCard(it, opts){
  opts=opts||{};
  const dl=dueBadge(it);
  const tags=(it.tags||[]).map(t=>{ const ts=tagStyle(t); return `<span class="tag hash" data-tag="${esc(t)}" title="Фильтр по тегу" ${ts&&ts.color?`style="border-color:${ts.color};color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(t)}</span>`; }).join("");
  return `<div class="card ${it.done?"done":""} pri-${it.priority||0}" data-id="${it.id}">
    <button class="chk ${it.done?"done":""}" data-chk="${it.id}"><i class="ti ti-check"></i></button>
    <div class="card-body">
      <div class="card-ttl">${esc(it.title)}</div>
      <div class="meta">
        ${it.area?`<span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        ${dl?`<span class="due ${dl.cls}"><i class="ti ti-calendar-event"></i>${dl.txt}</span>`:""}
        ${it.repeat&&it.repeat!=="none"?`<span class="rep"><i class="ti ti-repeat"></i>${REPEAT[it.repeat]}</span>`:""}
        ${it.priority?`<span class="pri"><i class="ti ti-flag-3"></i></span>`:""}
        ${tags}
        ${it.folder?`<button class="nc-folder" data-openfolder="${it.id}" title="Открыть папку на ПК"><i class="ti ti-folder"></i></button>`:""}
      </div>
    </div>
    <div class="card-act">
      ${opts.today?`<button data-today="${it.id}" title="Перенести на сегодня"><i class="ti ti-target"></i></button>`:""}
      <button data-edit="${it.id}" title="Изменить"><i class="ti ti-pencil"></i></button>
      <button data-del="${it.id}" title="Удалить"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}
function emptyBox(icon,text){ return `<div class="empty"><i class="ti ${icon}"></i>${text}</div>`; }
// текстовый фильтр списков (#list-filter): ввод → перерендер → вернуть фокус и каретку (иначе теряются при innerHTML)
function wireListFilter(v){
  const lf=$("#list-filter",v); if(!lf) return;
  // каретку НЕ трогаем: её положение снимает и возвращает render() (см. _viewSnapshot).
  // Раньше здесь стояло setSelectionRange(в конец) — и правка середины слова была невозможна.
  lf.oninput=()=>{ listQuery=lf.value; render(); const nf=$("#list-filter"); if(nf && document.activeElement!==nf) nf.focus(); };
  lf.onkeydown=e=>{ if(e.key==="Escape" && lf.value){ e.stopPropagation(); listQuery=""; render(); const nf=$("#list-filter"); if(nf) nf.focus(); } };
}

/* render() перерисовывает вид целиком через innerHTML — это просто и надёжно, но вместе с
   разметкой стирается ЭФЕМЕРНОЕ состояние DOM: положение прокрутки и позиция каретки в поле
   фильтра. Раньше каждое действие в длинном списке (галочка, перенос на сегодня) отбрасывало
   человека в начало, а фильтр после каждой буквы ставил каретку в конец — править середину
   слова было невозможно. Снимаем это состояние ДО перерисовки и возвращаем после; при смене
   вкладки, наоборот, честно начинаем сверху. */
function _viewSnapshot(){
  const v=$("#view"); if(!v) return null;
  const ae=document.activeElement;
  const inField = ae && v.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName);
  const scroller = v.scrollTop ? v : (v.querySelector(".list, .tree, .cards") || v);
  return {
    top: scroller===v ? v.scrollTop : scroller.scrollTop,
    sameView: _prevView===view,
    focusId: inField ? (ae.id||null) : null,
    selStart: inField ? ae.selectionStart : null,
    selEnd: inField ? ae.selectionEnd : null
  };
}
function _viewRestore(sn){
  const v=$("#view"); if(!v) return;
  if(!sn || !sn.sameView){ v.scrollTop=0; return; }   // сменили вкладку — начинаем сверху, а не с середины прошлой
  if(sn.top){ const scroller=(v.scrollHeight>v.clientHeight) ? v : (v.querySelector(".list, .tree, .cards")||v); scroller.scrollTop=sn.top; }
  if(sn.focusId){
    const f=document.getElementById(sn.focusId);
    if(f && typeof f.setSelectionRange==="function"){
      f.focus();
      const n=f.value.length;
      try{ f.setSelectionRange(Math.min(sn.selStart,n), Math.min(sn.selEnd,n)); }catch(e){}
    }
  }
}
function render(){
  if(!NAV.some(n=>n[0]===view)) view="today";   // устаревший/удалённый вид (напр. бывшая «board») → на главную
  const _sn=_viewSnapshot();
  renderNav();
  const v=$("#view");
  if(S.settings.view!==view){ S.settings.view=view; persist(); }   // не переписываем весь стейт при простой навигации
  v.classList.toggle("anim-in", _prevView!==view);
  if(_prevView!==view) listQuery="";                               // фильтр списка не «протекает» между вкладками
  _prevView=view;                                                  // плавный вход карточек только при смене вкладки
  // остановить анимацию графа, если уходим с вкладки «Заметки» (иначе rAF крутится на отсоединённых узлах)
  if(graph && view!=="notes"){ const g=graph; graph=null; g.destroy(); }
  if(view==="today") renderToday(v);
  else if(view==="tasks") renderTasks(v);
  else if(view==="notes") renderNotes(v);
  else if(view==="board") renderFolders(v);
  else if(view==="cal") renderCal(v);
  else if(view==="bin") renderBin(v);
  _viewRestore(_sn);
}

function plural(n,one,few,many){ n=Math.abs(n)%100; const n1=n%10; if(n>10&&n<20) return many; if(n1>1&&n1<5) return few; if(n1===1) return one; return many; }
function ringSVG(pct){ const r=46, c=2*Math.PI*r, off=(c*(1-pct/100)).toFixed(1), glow=pct/100;
  return `<svg class="day-ring" viewBox="0 0 110 110"><circle class="ring-bg" cx="55" cy="55" r="${r}"></circle><circle class="ring-fg" cx="55" cy="55" r="${r}" style="stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${off};filter:drop-shadow(0 0 ${(2+glow*8).toFixed(1)}px var(--glow))"></circle></svg>`; }
function sparkSVG(wk){ const w=190,h=46,max=Math.max(1,...wk),pad=5;
  const X=i=>(i/(Math.max(1,wk.length-1))*(w-pad*2)+pad).toFixed(1), Y=v=>(h-pad-(v/max)*(h-pad*2)).toFixed(1);
  const pts=wk.map((v,i)=>`${X(i)},${Y(v)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon class="spark-area" points="${pad},${h} ${pts} ${w-pad},${h}"></polygon><polyline class="spark-line" points="${pts}"></polyline><circle class="spark-dot" cx="${X(wk.length-1)}" cy="${Y(wk[wk.length-1])}" r="3.2"></circle></svg>`; }
// домашняя «Пульс ритма»: кольцо дня + стрик/угольки + спарклайн недели + баланс областей + фокус (синтез агентов)
function renderToday(v){
  head("Сегодня", new Intl.DateTimeFormat("ru",{weekday:"long",day:"numeric",month:"long"}).format(new Date()),
    `<button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const T=today(), ymdT=ymd(T), isT=it=>!it.deleted&&it.kind==="task";
  const todayAll=S.items.filter(it=>isT(it)&&it.due&&ymd(parseYmd(it.due))===ymdT);
  const doneT=todayAll.filter(it=>it.done).length, dayTotal=todayAll.length, pct=dayTotal?Math.round(doneT/dayTotal*100):0;
  const over=S.items.filter(it=>isT(it)&&!it.done&&it.due&&parseYmd(it.due)<T).sort((a,b)=>(b.priority||0)-(a.priority||0));
  const inb=S.items.filter(it=>!it.deleted&&it.x==null).length;   // неразобранное = ещё не на холсте
  // ритм по дням выполнения (doneAt)
  const byDay={}; S.items.forEach(it=>{ if(isT(it)&&it.done&&it.doneAt){ const k=ymd(new Date(it.doneAt)); byDay[k]=(byDay[k]||0)+1; } });
  const has=k=>!!byDay[k];
  let streak=0; { let d=new Date(T); if(!has(ymd(d))) d=addDays(d,-1); while(has(ymd(d))){ streak++; d=addDays(d,-1); } }
  let record=0; { const ds=Object.keys(byDay).sort(); let run=0,prev=null; ds.forEach(k=>{ run=(prev&&daysBetween(parseYmd(k),parseYmd(prev))===1)?run+1:1; prev=k; if(run>record)record=run; }); }
  const embers=[]; for(let i=13;i>=0;i--){ const k=ymd(addDays(T,-i)); embers.push({k,n:byDay[k]||0,today:i===0}); }
  const maxE=Math.max(1,...embers.map(e=>e.n));
  const wk=[]; for(let i=6;i>=0;i--) wk.push(byDay[ymd(addDays(T,-i))]||0);
  const wkSum=wk.reduce((a,b)=>a+b,0);
  let prevSum=0; for(let i=13;i>=7;i--) prevSum+=byDay[ymd(addDays(T,-i))]||0;
  const trend=prevSum?Math.round((wkSum-prevSum)/prevSum*100):null, hasHist=Object.keys(byDay).length>0;
  const hr=new Date().getHours(), greet=hr<5?"Доброй ночи":hr<12?"Доброе утро":hr<18?"Добрый день":"Добрый вечер";
  const phrase = dayTotal===0?"На сегодня ничего не запланировано — чистый лист.":doneT===0?"С чего начнём?":doneT<dayTotal?`${doneT} позади, осталось ${dayTotal-doneT} — и день твой.`:"Сегодня всё сделано. Можно выдохнуть.";
  const areaBars=S.areas.map(a=>{ const tasks=S.items.filter(it=>isT(it)&&it.area===a.id); const open=tasks.filter(it=>!it.done).length; const p=tasks.length?Math.round(tasks.filter(it=>it.done).length/tasks.length*100):0;
    return `<div class="area-bar${tasks.length&&p>=80?' lead':''}" data-area="${a.id}"><i class="ti ${a.icon}" ${a.color?`style="color:${a.color}"`:''}></i><span class="ab-name">${esc(a.name)}</span><span class="ab-track"><span class="ab-fill" style="width:${p}%${a.color?`;background:${a.color}`:''}"></span></span><span class="ab-meta">${open} · ${tasks.length?p+'%':'—'}</span></div>`; }).join("");
  const lag=S.areas.map(a=>{ const tasks=S.items.filter(it=>isT(it)&&it.area===a.id); const open=tasks.filter(it=>!it.done).length; const p=tasks.length?tasks.filter(it=>it.done).length/tasks.length:1; return {a,open,p}; }).filter(x=>x.open>0).sort((x,y)=>x.p-y.p).slice(0,2).map(x=>x.a.name);
  const focus=[...over.map(it=>({it,o:true})), ...todayAll.filter(it=>!it.done).map(it=>({it,o:false}))].sort((a,b)=>(b.it.priority||0)-(a.it.priority||0)).slice(0,6);
  const focusHtml=focus.length?focus.map(f=>taskCard(f.it,{today:f.o})).join(""):emptyBox("ti-checks","На сегодня дел нет. Выдохни ✨");
  v.innerHTML=`<div class="home">
    <div class="home-head"><div class="hh-greet">${greet}, КРОЛИК</div>${streak>0?`<div class="hh-streak"><i class="ti ti-flame"></i>${streak} ${plural(streak,"день","дня","дней")} подряд</div>`:""}</div>
    <div class="hh-phrase">${esc(phrase)}</div>
    <div class="home-grid g2">
      <div class="card home-card ring-card">${ringSVG(pct)}
        <div class="ring-side">
          <div class="ring-big">${pct}<span>%</span></div>
          <div class="ring-sub">${dayTotal?`${doneT} из ${dayTotal} на сегодня`:"на сегодня нет задач"}</div>
          <div class="ring-stat">${over.length?`<span class="rs-warn" data-goto="tasks"><i class="ti ti-alert-triangle"></i>${over.length} просрочено</span> · <span class="rs-link" data-overtoday="1" title="Перенести всю просрочку на сегодня"><i class="ti ti-target"></i>всё на сегодня</span>`:`<span class="rs-ok"><i class="ti ti-check"></i>без долгов</span>`}${inb?` · <span class="rs-link" data-goto="notes">${inb} не разобрано</span>`:""}</div>
        </div>
      </div>
      <div class="card home-card spark-card">
        <div class="hc-title">Эта неделя</div>${sparkSVG(wk)}
        <div class="spark-foot">${hasHist?`<b>${wkSum}</b> закрыто${trend!=null?` · <span class="${trend>=0?'tr-up':'tr-down'}">${trend>=0?'+':''}${trend}%</span> к прошлой`:''}`:"копим статистику…"}</div>
      </div>
    </div>
    <div class="card home-card embers-card">
      <div class="hc-title">Ритм · 14 дней</div>
      <div class="embers">${embers.map(e=>`<span class="ember${e.today?' today':''}${e.n?' lit':''}" style="--lit:${(e.n/maxE).toFixed(2)}" title="${e.k}: ${e.n}"></span>`).join("")}</div>
      <div class="embers-foot">${streak>0?`🔥 серия ${streak}${record>streak?` · рекорд ${record}`:''}`:hasHist?"серия прервалась — зажги новый уголёк":"закрой задачу — зажги первый уголёк"}</div>
    </div>
    <div class="home-grid g2">
      <div class="card home-card areas-card">
        <div class="hc-title">Области</div>
        ${S.areas.length?areaBars:emptyBox("ti-folder","Областей нет")}
        ${lag.length?`<div class="areas-insight"><i class="ti ti-bulb"></i>${esc(lag.join(" и "))} отста${lag.length>1?'ют':'ёт'} — загляни?</div>`:""}
      </div>
      <div class="card home-card focus-card">
        <div class="hc-title"><i class="ti ti-target"></i> Фокус дня</div>
        ${focusHtml}
      </div>
    </div>
    ${(over.length||inb)?`<button class="home-foot" data-goto="${over.length?'tasks':'notes'}"><i class="ti ti-moon"></i>${[over.length?`${over.length} просрочено`:'',inb?`${inb} не разобрано`:''].filter(Boolean).join(' · ')} — когда будут силы</button>`:""}
  </div>`;
}
function renderTasks(v){
  recomputeHierarchy();   // свежая иерархия из графа — подтягиваем её в задачи
  const f=areaFilter, T=today();
  const FILT={ all:()=>true, today:it=>it.due&&parseYmd(it.due)<=T, week:it=>it.due&&daysBetween(parseYmd(it.due),T)<=7, nodue:it=>!it.due };
  // Раньше тут отсекался status==="inbox" — вкладка Inbox прятала свои задачи от «Задач».
  // Теперь такого статуса нет: задача есть задача, даже если её ещё не поставили на холст.
  // Корни без области подхватит секция «Без области» ниже — ничего не теряется.
  const isTask=it=>!it.deleted&&it.kind==="task";
  const doneCount=S.items.filter(it=>isTask(it)&&it.done).length;
  const filt=FILT[taskFilter]||FILT.all;
  // видимые задачи: фильтр срока + (done только при showDone) + фильтр по тегу + текстовый фильтр
  const q=listQuery.trim().toLowerCase();
  const qhit=it=>!q || (it.title||"").toLowerCase().includes(q) || (it.body||"").toLowerCase().includes(q);
  const visTasks=S.items.filter(it=>isTask(it) && (showDone||!it.done) && filt(it) && (!tagFilter||(it.tags||[]).includes(tagFilter)) && qhit(it));
  // дерево из паутины (заметки+задачи), parent из графа; оставляем только задачи + их предков-структуру
  const nodes=S.items.filter(inWeb);
  const ids=new Set(nodes.map(n=>n.id));
  const hasParent=it=> it.parent && ids.has(it.parent);
  const keep=new Set();
  visTasks.forEach(t=> noteParentChain(t.id).forEach(id=>keep.add(id)) );
  head(f?areaName(f):"Задачи", f?"Фильтр по области · нажми ещё раз чтобы снять":"Иерархия из заметок · клик — открыть, чекбокс — выполнить",
    `${doneCount?`<button class="btn ghost" data-toggle="done"><i class="ti ${showDone?"ti-eye-off":"ti-checks"}"></i>Выполнено ${doneCount}</button>`:""}
     <button class="btn" data-new="task"><i class="ti ti-plus"></i>Задача</button>`);
  const ts=tagFilter?tagStyle(tagFilter):null;
  const chips=`<div class="tf-chips">`+
    (tagFilter?`<button class="tf-chip on tf-tag" data-cleartag="1" title="Снять фильтр по тегу" ${ts&&ts.color?`style="border-color:${ts.color};color:${ts.color}"`:""}><i class="ti ${ts&&ts.icon?ts.icon:"ti-hash"}"></i>${esc(tagFilter)}<i class="ti ti-x" style="font-size:13px;margin-left:2px;"></i></button>`:"")+
    [["all","Все"],["today","Сегодня"],["week","Неделя"],["nodue","Без срока"]]
      .map(([k,l])=>`<button class="tf-chip ${taskFilter===k?"on":""}" data-tf="${k}">${l}</button>`).join("")+
    `<span class="list-find"><i class="ti ti-search"></i><input id="list-filter" type="text" placeholder="Фильтр…" value="${esc(listQuery)}" spellcheck="false"></span>`+
  `</div>`;
  // в «Задачах» всегда сортировка по ДАТЕ: срок по возрастанию (просрочка/ближайшее сверху), без срока — в конец; затем приоритет, затем свежесть
  const byDue=(a,b)=>{ const ad=a.due?parseYmd(a.due):Infinity, bd=b.due?parseYmd(b.due):Infinity; return ad-bd || (b.priority||0)-(a.priority||0) || (b.updated||0)-(a.updated||0); };
  const kidsKept=id=>childrenOf(id).filter(k=>inWeb(k)&&keep.has(k.id)).sort(byDue);
  const seen=new Set();
  function branch(it, depth){
    if(seen.has(it.id)) return ""; seen.add(it.id);
    const kk=kidsKept(it.id);
    // заметки → компактный контекст-заголовок (true), задачи → полная карточка с чекбоксом
    let hh=noteCard(it, depth, kk.length>0, true);
    if(isCollapsed(it.id) || !kk.length) return hh;
    return hh+`<div class="tree-branch">`+kk.map(k=>branch(k,depth+1)).join("")+`</div>`;
  }
  const group=roots=>`<div class="notes-tree">`+roots.slice().sort(byDue).map(r=>branch(r,0)).join("")+`</div>`;
  const sec=(key,icon,name,count,colorStyle)=>{ const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`; };
  let body="";
  S.areas.forEach(a=>{
    if(f && a.id!==f) return;
    const roots=nodes.filter(it=>keep.has(it.id)&&!hasParent(it)&&it.area===a.id);
    if(!roots.length) return;
    const key="area:"+a.id;
    body+=sec(key, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed(key)) body+=group(roots);
  });
  if(!f){
    const noArea=nodes.filter(it=>keep.has(it.id)&&!hasParent(it)&&!it.area);
    if(noArea.length){ body+=sec("area:__none","ti-circle-dashed","Без области",noArea.length,""); if(!isCollapsed("area:__none")) body+=group(noArea); }
  }
  if(!body) body=emptyBox("ti-checklist", q?"Ничего не нашлось по фильтру «"+esc(listQuery.trim())+"».":taskFilter==="all"?"Нет активных задач. Добавь первую — поле сверху или <b>N</b>":"По этому фильтру задач нет.");
  v.innerHTML=chips+body;
  wireListFilter(v);
  // обработчики дерева (как в списке заметок)
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=(e)=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$(".note-card",v).forEach(card=>card.onclick=(e)=>{
    if(e.target.closest("[data-chk]")) return;       // чекбокс — делегат #view
    if(e.target.closest("[data-tag]")) return;       // клик по тегу — фильтр (делегат #view), не открываем карточку
    if(e.target.closest("[data-collapse]")) return;  // каретка
    if(e.target.closest("[data-openfolder]")) return; // кнопка папки — делегат #view
    const id=card.dataset.nid||card.dataset.tid;
    const it=S.items.find(i=>i.id===id); if(it) openItemSmart(it);
  });
}
/* ===========================================================
   ПАПКИ (вкладка «board»): дерево только тех нод, у кого есть папка
   на ПК, + их предки для контекста (keep-набор, как в «Задачах»).
   Нода-с-папкой → строка-цель с «открыть папку»; предок-без-папки →
   приглушённый контекст с бейджем «N папок внутри».
   =========================================================== */
function renderFolders(v){
  recomputeHierarchy();
  const f=areaFilter;
  const nodes=S.items.filter(inWeb);
  const ids=new Set(nodes.map(n=>n.id));
  const byId=id=>S.items.find(i=>i.id===id);
  const hasFld=it=>typeof it.folder==="string"&&!!it.folder;
  const isDone=it=>it.kind==="task" && it.done;
  // архивация решается ТОЛЬКО на уровне корня ветки (нода без родителя): архивен, если сам done.
  // У дочерней ноды свой собственный done НЕ имеет значения — она наследует статус родителя.
  // Так подзадача (VFX/Light) с папкой не улетает в «Завершённые» сама по себе — её папка ещё
  // может быть нужна, пока не закрыта родительская задача-проект (Breach); когда та закрывается,
  // архивируется вся ветка разом, вне зависимости от того, когда были закрыты подзадачи.
  const archMemo=new Map();
  const isArchived=it=>{
    if(archMemo.has(it.id)) return archMemo.get(it.id);
    archMemo.set(it.id,false);   // защита от циклов на случай кривых данных
    const pid=(it.parent&&ids.has(it.parent))?it.parent:null;
    const res = pid ? isArchived(byId(pid)) : isDone(it);
    archMemo.set(it.id,res); return res;
  };
  // делим ноды-с-папкой + их предков-по-пути на «активные»/«архив» — каждая нода своим статусом.
  const keepActive=new Set(), keepDone=new Set();
  nodes.filter(hasFld).forEach(fn=>{
    let cur=fn, g=new Set();
    while(cur && !g.has(cur.id)){ g.add(cur.id); (isArchived(cur)?keepDone:keepActive).add(cur.id);
      const pid=(cur.parent&&ids.has(cur.parent))?cur.parent:null; cur=pid?byId(pid):null; }
  });
  // активные сверху по ДЕДЛАЙНУ (срок ↑, без срока — по алфавиту)
  const byDeadline=(a,b)=>{ const ad=a.due?parseYmd(a.due):Infinity, bd=b.due?parseYmd(b.due):Infinity; return ad-bd || (a.title||"").localeCompare(b.title||"","ru"); };
  const basename=p=>{ const s=String(p).replace(/[\\/]+$/,""); const parts=s.split(/[\\/]/); return parts[parts.length-1]||s; };
  const fldRow=(it,card)=>`<div class="fld-row has-folder${it.done?" done":""}">${card}<span class="nc-path" title="${esc(it.folder)}"><i class="ti ti-folder"></i>${esc(basename(it.folder))}</span><div class="nc-foot-acts"><button class="nc-folder dim" data-opennode="${it.id}" title="Открыть ноду"><i class="ti ti-note"></i></button><button class="nc-folder dim" data-foldpick="${it.id}" title="Сменить папку"><i class="ti ti-folder-cog"></i></button></div></div>`;
  const foldersUnder=(id,keep)=>{ let n=0; childrenOf(id).filter(k=>inWeb(k)&&keep.has(k.id)).forEach(k=>{ if(hasFld(k))n++; n+=foldersUnder(k.id,keep); }); return n; };
  head("Папки", f?areaName(f)+" · папки на ПК":"Папки проектов и ассетов · клик по строке — открыть папку · кнопки — открыть ноду / сменить", "");
  function branch(it,keep,seen){
    if(seen.has(it.id)) return ""; seen.add(it.id);
    const kk=childrenOf(it.id).filter(k=>inWeb(k)&&keep.has(k.id)).sort(byDeadline);
    const card=folderRowCard(it, kk.length>0);
    const h = hasFld(it)
      ? fldRow(it, card)
      : `<div class="fld-row ctx-only">${card}${foldersUnder(it.id,keep)?`<span class="fld-cnt"><i class="ti ti-folder"></i>${foldersUnder(it.id,keep)}</span>`:""}</div>`;
    if(isCollapsed(it.id)||!kk.length) return h;
    return h+`<div class="tree-branch">`+kk.map(k=>branch(k,keep,seen)).join("")+`</div>`;
  }
  const sec=(key,icon,name,count,colorStyle)=>{ const c=isCollapsed(key);
    return `<div class="sec sec-collapse" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ${icon}" ${colorStyle||""}></i>${esc(name)}<span class="sec-cnt">${count}</span></div>`; };
  const group=(roots,keep)=>{ const seen=new Set(); return `<div class="notes-tree">`+roots.slice().sort(byDeadline).map(r=>branch(r,keep,seen)).join("")+`</div>`; };
  // корни keep-набора = ноды без родителя в том же наборе
  const rootsOf=keep=>nodes.filter(it=>keep.has(it.id) && !(it.parent&&keep.has(it.parent)));
  let body="";
  const activeRoots=rootsOf(keepActive);
  S.areas.forEach(a=>{ if(f&&a.id!==f) return;
    const roots=activeRoots.filter(it=>(it.area||null)===a.id);
    if(!roots.length) return;
    body+=sec("area:"+a.id, a.icon, a.name, roots.length, a.color?`style="color:${a.color}"`:"");
    if(!isCollapsed("area:"+a.id)) body+=group(roots,keepActive);
  });
  if(!f){ const noArea=activeRoots.filter(it=>!it.area);
    if(noArea.length){ body+=sec("area:__none","ti-circle-dashed","Без области",noArea.length,""); if(!isCollapsed("area:__none")) body+=group(noArea,keepActive); } }
  // ЗАВЕРШЁННЫЕ: завершённый проект уезжает сюда ЦЕЛИКОМ со своим поддеревом
  // (активные ассеты вложены под ним), чтобы не мозолить глаз в активном дереве.
  const doneRoots=rootsOf(keepDone).filter(it=>!f||(it.area||null)===f).sort((a,b)=>(b.doneAt||0)-(a.doneAt||0));
  if(doneRoots.length){ const key="fld:done", c=isCollapsed(key);
    body+=`<div class="sec sec-collapse fld-done-sec" data-collapse="${key}"><i class="ti ${c?'ti-chevron-right':'ti-chevron-down'} sec-chev"></i><i class="ti ti-checks"></i>Завершённые<span class="sec-cnt">${doneRoots.length}</span></div>`;
    if(!c) body+=group(doneRoots,keepDone);
  }
  const anyFolder=nodes.some(it=>hasFld(it));
  if(!anyFolder) body=emptyBox("ti-folders","Здесь появятся ноды с привязанной папкой на ПК. Открой ноту/задачу (или ноду в графе) и нажми «Привязать папку» — потом откроешь папку проекта в проводнике одним кликом отсюда.<br>Напр.: «МТС Арена» → папка проекта; «Ассеты» → подноты, у каждой своя.");
  else if(!body) body=emptyBox("ti-folder-off","В этой области нет нод с папкой — сними фильтр области.");
  v.innerHTML=body;
  $$("[data-collapse]",v).forEach(elm=>elm.onclick=e=>{ e.stopPropagation(); toggleCollapse(elm.dataset.collapse); render(); });
  $$("[data-opennode]",v).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const it=S.items.find(i=>i.id===b.dataset.opennode); if(it) openItemSmart(it); });
  $$("[data-foldpick]",v).forEach(b=>b.onclick=e=>{ e.stopPropagation(); const it=S.items.find(i=>i.id===b.dataset.foldpick); if(it) pickItemFolder(it,()=>render()); });
  $$(".note-card",v).forEach(card=>card.onclick=e=>{
    if(e.target.closest("[data-collapse]")||e.target.closest("[data-opennode]")||e.target.closest("[data-foldpick]")||e.target.closest("[data-tag]")) return;
    const id=card.dataset.nid||card.dataset.tid; const it=S.items.find(i=>i.id===id); if(!it) return;
    if(it.folder) openItemFolder(it); else openItemSmart(it);   // клик по строке-с-папкой = открыть папку; контекст-предок = открыть ноду
  });
}
function renderCal(v){
  const base=new Date(); base.setDate(1); base.setMonth(base.getMonth()+calOffset);
  head("Календарь", new Intl.DateTimeFormat("ru",{month:"long",year:"numeric"}).format(base),
    `<div class="cal-nav">
       <button data-cal="-1" title="Предыдущий"><i class="ti ti-chevron-left"></i></button>
       <button class="btn ghost" data-cal="0" style="height:30px">Сегодня</button>
       <button data-cal="1" title="Следующий"><i class="ti ti-chevron-right"></i></button>
     </div>`);
  const y=base.getFullYear(), m=base.getMonth();
  const first=new Date(y,m,1), start=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  // призраки повторов: активная повторяющаяся задача проецируется на будущие даты видимого месяца
  const mStart=startOfDay(first), mEnd=startOfDay(new Date(y,m+1,0));
  const ghosts={};
  S.items.forEach(it=>{
    if(it.deleted||it.kind!=="task"||it.done||!it.due||!it.repeat||it.repeat==="none") return;
    let d=nextRepeat(it.due,it.repeat), i=0;
    while(d && i++<370 && parseYmd(d)<=mEnd){ if(parseYmd(d)>=mStart) (ghosts[d]||(ghosts[d]=[])).push(it); d=nextRepeat(d,it.repeat); }
  });
  let cells=["пн","вт","ср","чт","пт","сб","вс"].map(d=>`<div class="cal-wd">${d}</div>`).join("");
  for(let i=0;i<start;i++) cells+=`<div class="cd dim"></div>`;
  const todayStr=ymd(today());
  for(let d=1;d<=days;d++){
    const ds=ymd(new Date(y,m,d));
    const ev=S.items.filter(it=>!it.deleted&&it.due===ds && it.kind==="task");
    cells+=`<div class="cd ${ds===todayStr?"tod":""}" data-day="${ds}" title="Добавить задачу на этот день">`+`<div class="cd-n">${d}</div>`+
      ev.map(it=>{ const over=parseYmd(ds)<today()&&!it.done; return `<div class="ev ${it.done?"done":""} ${over?"over":""}" draggable="true" data-ev="${it.id}" data-edit="${it.id}" title="${esc(it.title)} · тащи на другой день">${esc(it.title)}</div>`; }).join("")+
      (ghosts[ds]?ghosts[ds].map(it=>`<div class="ev ghost" data-edit="${it.id}" title="Повтор: ${esc(it.title)} (${REPEAT[it.repeat]})"><i class="ti ti-repeat"></i>${esc(it.title)}</div>`).join(""):"")+`</div>`;
  }
  v.innerHTML=`<div class="cal">${cells}</div>`;
  // drag-and-drop: перетащить задачу на другой день = перенести срок
  $$(".ev[data-ev]",v).forEach(el=>{ el.ondragstart=e=>{ e.dataTransfer.setData("text/plain", el.dataset.ev); e.dataTransfer.effectAllowed="move"; }; });
  $$(".cd[data-day]",v).forEach(cell=>{
    cell.ondragover=e=>{ e.preventDefault(); cell.classList.add("drop"); };
    cell.ondragleave=()=>cell.classList.remove("drop");
    cell.ondrop=e=>{ e.preventDefault(); cell.classList.remove("drop");
      const it=S.items.find(i=>i.id===e.dataTransfer.getData("text/plain")); if(!it||it.due===cell.dataset.day) return;
      it.due=cell.dataset.day; touch(it); persist(); render();
      toast("Перенесено: "+((dueLabel(it.due)||{}).txt||it.due),{icon:"ti-calendar-event"});
    };
  });
}
function renderBin(v){
  head("Корзина","Удалённые элементы · можно восстановить или стереть навсегда",
    `<button class="btn ghost" data-toggle="clear"><i class="ti ti-trash"></i>Очистить всё</button>`);
  const arr=S.items.filter(it=>it.deleted).sort((a,b)=>(b.deletedAt||0)-(a.deletedAt||0));
  if(!arr.length){ v.innerHTML=emptyBox("ti-trash","Корзина пуста. Удалённые элементы появятся здесь."); return; }
  v.innerHTML=arr.map(it=>`<div class="card" data-id="${it.id}">
    <div class="card-body" style="flex:1">
      <div class="card-ttl">${esc(it.title)}</div>
      <div class="meta">
        ${it.area?`<span class="tag"><i class="ti ${areaIcon(it.area)}"></i>${esc(areaName(it.area))}</span>`:""}
        <span class="due"><i class="ti ti-calendar-event"></i>удалено ${it.deletedAt?new Date(it.deletedAt).toLocaleDateString("ru"):""}</span>
      </div>
    </div>
    <div class="card-act" style="opacity:1;display:flex;gap:4px;">
      <button data-restore="${it.id}" title="Восстановить"><i class="ti ti-arrow-back-up"></i></button>
      <button data-hard="${it.id}" title="Удалить навсегда" style="color:var(--warn)"><i class="ti ti-trash"></i></button>
    </div>
  </div>`).join("");
  $$("[data-restore]",v).forEach(b=>b.onclick=()=>{ restoreItem(b.dataset.restore); render(); toast("Восстановлено"); });
  $$("[data-hard]",v).forEach(b=>b.onclick=async()=>{ if(await uiConfirm("Этот элемент будет удалён навсегда. Это нельзя отменить.",{danger:true,title:"Удалить навсегда?",okLabel:"Удалить"})){ hardDeleteItem(b.dataset.hard); render(); toast("Удалено навсегда"); } });
  // «Очистить всё» обрабатывает делегат #head-actions (data-toggle="clear") — без дубля здесь (был двойной confirm)
}
