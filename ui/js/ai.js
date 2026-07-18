"use strict";
/* ===========================================================
   ЛОКАЛЬНЫЙ ИИ — УМНЫЙ ЗАХВАТ  (полностью опционально)
   -----------------------------------------------------------
   Идея: захват остаётся МГНОВЕННЫМ (parseCapture в model.js создаёт ноду сразу).
   Уже ПОСЛЕ этого мы тихо спрашиваем локальную модель и, если она предлагает
   что-то лучше (чистый короткий заголовок, дату/срочность, длинное→в описание),
   показываем бледную карточку-предложение: «вот как понял» + Применить / ×.
   Ничего само не меняется — только по клику. Нет движка/модели → всё молчит,
   Мыслик работает ровно как раньше.

   Весь ИИ-фронт живёт ЗДЕСЬ (стили инжектятся ниже). Чтобы вырезать фичу целиком:
   удалить этот файл + строку <script src="js/ai.js"> в index.html + вызов
   aiRefineCapture и пункт палитры «Умный захват» в main.js. Питон-часть
   (ai.py, методы ai_* в app.py) можно оставить — без файла модели она молчит.
   =========================================================== */

const AICap = { status:{available:false, reason:"unknown"}, checked:false, busy:false };

// ---- статус движка (спрашиваем Python один раз) ----
async function aiCheckStatus(){
  AICap.checked = true;
  try{
    if(HasPy() && window.pywebview.api.ai_status){
      AICap.status = await window.pywebview.api.ai_status() || AICap.status;
    }
  }catch(e){ AICap.status={available:false, reason:"error"}; }
  return AICap.status;
}
function aiEnabled(){ return !!AICap.status.available && S.settings.aiCapture!==false; }

// ---- вкл/выкл (команда в палитре Ctrl+K) ----
async function aiToggle(){
  if(!AICap.checked) await aiCheckStatus();
  if(!AICap.status.available){
    const why = {no_module:"модуль ИИ не подключён", no_engine:"не установлен движок (gpt4all)",
                 no_model:"нет файла модели рядом с приложением (папка ai/)", load_error:"модель не загрузилась"}[AICap.status.reason]
              || "ИИ недоступен";
    toast("Умный захват выключен: "+why, {icon:"ti-sparkles-off"});
    return;
  }
  S.settings.aiCapture = (S.settings.aiCapture===false);   // было выключено → включаем
  persist();
  toast(S.settings.aiCapture!==false ? "Умный захват включён" : "Умный захват выключен",
        {icon: S.settings.aiCapture!==false ? "ti-sparkles" : "ti-sparkles-off"});
}

// ---- переключение движка CPU ⇄ GPU (применяется при перезапуске) ----
async function aiSwitchBackend(){
  if(!AICap.checked) await aiCheckStatus();
  const st=AICap.status||{}, bs=st.backends||[];
  if(!bs.length){ toast("ИИ недоступен: нет движка/модели рядом с приложением", {icon:"ti-cpu"}); return; }
  if(bs.length<2){ toast("Установлен только один движок: "+(bs[0]==="gpu"?"GPU (Vulkan)":"CPU"), {icon:"ti-cpu"}); return; }
  const cur=st.backend||bs[0];
  const next=bs.find(b=>b!==cur)||cur;
  const nm=next==="gpu"?"GPU (Vulkan)":"CPU";
  try{
    const r=await window.pywebview.api.ai_set_backend(next);
    if(r&&r.ok){ AICap.status.backend=next;
      toast("Движок ИИ → "+nm+". Перезапусти Мыслик, чтобы применить.", {icon:"ti-refresh", hold:true}); }
    else toast("Не удалось переключить движок", {icon:"ti-alert-triangle"});
  }catch(e){ toast("Не удалось переключить движок", {icon:"ti-alert-triangle"}); }
}

// ---- вкладка «ИИ» в настройках (вся начинка здесь, чтобы фича оставалась вырезаемой) ----
async function aiRenderSettings(panel){
  if(!panel) return;
  panel.innerHTML = `<div class="set-hint">Локальная модель при вводе мысли предлагает чистый заголовок, дату, срочность и вид. Всё локально — в сеть ничего не уходит.</div><div class="set-hint">Проверяю…</div>`;
  const st = (await aiCheckStatus()) || AICap.status || {};
  const avail = !!st.available, model = st.model || "—";
  const backends = st.backends || [], cur = st.backend || (backends[0]||"cpu");
  const enabled = S.settings.aiCapture!==false;
  const autoOn = S.settings.aiAutoApply===true;
  const lbl = b => b==="gpu" ? "GPU (Vulkan)" : "CPU";
  const restartNow = !!(st.active && st.active!==cur);
  const why = {no_engine:"нет движка (папки ai/engine-cpu или ai/engine-vulkan рядом с приложением)",
               no_model:"нет файла модели (*.gguf) в папке ai/", no_module:"ИИ-модуль не подключён",
               load_error:"движок не загрузился"}[st.reason] || "проверь папку ai/ рядом с приложением";
  panel.innerHTML = `
    <div class="set-hint">Локальная модель при вводе мысли предлагает чистый заголовок, дату, срочность и вид. Всё локально — в сеть ничего не уходит.</div>
    ${avail ? "" : `<div class="set-hint" style="color:var(--warn)"><i class="ti ti-alert-triangle"></i> ИИ недоступен: ${why}</div>`}
    <div class="set-sec">Умный захват</div>
    <div class="field"><label>Предлагать разбор мысли</label>
      <div class="seg" id="set-ai-onoff">
        <button data-v="1" class="${enabled?"on":""}" ${avail?"":"disabled"}>Вкл</button>
        <button data-v="0" class="${enabled?"":"on"}">Выкл</button>
      </div></div>
    <div class="field"><label>Применять сразу, без карточки</label>
      <div class="seg" id="set-ai-auto">
        <button data-v="1" class="${autoOn?"on":""}" ${avail?"":"disabled"}>Да</button>
        <button data-v="0" class="${autoOn?"":"on"}">Нет</button>
      </div></div>
    <div class="set-hint">Без карточки заголовок и вид меняются молча — если модель ошибётся, не заметишь. Надёжнее в паре с моделью поумнее.</div>
    <div class="set-row"><span class="set-val">Модель</span><div class="right"><b>${esc(model)}</b></div></div>
    <div class="set-sec">Движок</div>
    <div class="set-hint">CPU — лёгкий и работает у всех. GPU (Vulkan) — на видеокарте, чуть быстрее. Смена применяется после перезапуска.</div>
    <div class="field"><label>Где считать</label>
      <div class="seg" id="set-ai-engine">
        ${["cpu","gpu"].map(b=>`<button data-v="${b}" class="${cur===b?"on":""}" ${backends.includes(b)?"":"disabled"}>${lbl(b)}${backends.includes(b)?"":" — нет пака"}</button>`).join("")}
      </div></div>
    <div class="set-hint" id="set-ai-restart" style="display:${restartNow?"flex":"none"};align-items:center;gap:5px;color:var(--pri2)"><i class="ti ti-refresh"></i> Перезапусти Мыслик, чтобы применить движок.</div>`;
  panel.querySelectorAll("#set-ai-onoff button").forEach(b=>b.onclick=()=>{
    if(b.disabled) return;
    S.settings.aiCapture = b.dataset.v==="1"; persist();
    panel.querySelectorAll("#set-ai-onoff button").forEach(x=>x.classList.toggle("on",x===b));
  });
  panel.querySelectorAll("#set-ai-auto button").forEach(b=>b.onclick=()=>{
    if(b.disabled) return;
    S.settings.aiAutoApply = b.dataset.v==="1"; persist();
    panel.querySelectorAll("#set-ai-auto button").forEach(x=>x.classList.toggle("on",x===b));
  });
  panel.querySelectorAll("#set-ai-engine button").forEach(b=>b.onclick=async()=>{
    if(b.disabled) return;
    const name=b.dataset.v;
    try{
      const r=await window.pywebview.api.ai_set_backend(name);
      if(r&&r.ok){
        AICap.status.backend=name;
        panel.querySelectorAll("#set-ai-engine button").forEach(x=>x.classList.toggle("on",x===b));
        const rs=panel.querySelector("#set-ai-restart"); if(rs) rs.style.display=(st.active && st.active!==name)?"flex":"none";
        toast("Движок ИИ → "+lbl(name)+" (после перезапуска)",{icon:"ti-refresh"});
      } else toast("Не удалось переключить движок",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось переключить движок",{icon:"ti-alert-triangle"}); }
  });
}

// ---- резолв ответа модели в поля Мыслика (даты/приоритет — через хелперы core.js) ----
function aiResolveDue(when){
  if(!when) return null;
  const t=today();
  if(when==="today") return ymd(t);
  if(when==="tomorrow") return ymd(addDays(t,1));
  if(when==="day_after") return ymd(addDays(t,2));
  const wd={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:0};
  if(when in wd){ const cur=t.getDay(); let add=(wd[when]-cur+7)%7; if(add===0)add=7; return ymd(addDays(t,add)); }
  return null;
}
const AI_PR = {high:3, medium:2, low:1, none:0};

// ---- сравнить предложение модели с тем, что уже наделал parseCapture ----
function aiBuildProposal(it, res){
  const changes=[];
  const norm=s=>(s||"").replace(/\s+/g," ").trim().toLowerCase();
  const out={};

  // заголовок — главная ценность (чистка). Меняем, только если реально отличается и не пустой.
  const title=(res.title||"").trim();
  if(title && norm(title)!==norm(it.title)){ out.title=title; changes.push({k:"заголовок", v:title, i:"ti-pencil"}); }

  // дата — только если модель нашла, а у ноды её ещё НЕТ. Явную дату пользователя
  // (её уже проставил parseCapture из «25.12»/«пт»/…) НЕ перебиваем.
  const due=aiResolveDue(res.when);
  if(due && !it.due){ out.due=due; const dl=(typeof dueLabel==="function")?dueLabel(due):null; changes.push({k:"срок", v:dl?dl.txt:due, i:"ti-calendar-event"}); }

  // срочность — только если модель дала уровень ВЫШЕ текущего (и только по клику)
  const pr=AI_PR[res.priority]||0;
  if(pr>0 && pr>(it.priority||0)){ out.priority=pr; changes.push({k:"срочность", v:"!".repeat(pr), i:"ti-flag-3"}); }

  // вид — задача/заметка (полотно не трогаем)
  if((res.kind==="task"||res.kind==="note") && it.kind!=="flow" && res.kind!==it.kind){
    out.kind=res.kind; changes.push({k:"вид", v:res.kind==="note"?"заметка":"задача", i:res.kind==="note"?"ti-note":"ti-checklist"});
  }

  // длинное → в описание (не затираем уже существующий body)
  const body=(res.body||"").trim();
  if(body && !(it.body||"").trim()){ out.body=body; changes.push({k:"описание", v:body.length>60?body.slice(0,60)+"…":body, i:"ti-align-left"}); }

  out.changes=changes; out.title=out.title||it.title;
  return out;
}

// ---- применить предложение к ноде ----
function aiApply(it, prop, auto){
  if(!it || it.deleted) return;
  if(prop.title) it.title=prop.title;
  if(prop.body!==undefined) it.body=prop.body;
  if(prop.due!==undefined) it.due=prop.due;
  if(prop.priority!==undefined) it.priority=prop.priority;
  if(prop.kind){ it.kind=prop.kind; it.status = prop.kind==="note" ? "note" : (it.done?"done":"todo"); }
  touch(it); persist(); render();
  toast(auto ? "ИИ поправил заголовок" : "Применено", {icon:"ti-sparkles"});
}

// ---- главный вход: зовётся из main.js сразу после создания ноды ----
async function aiRefineCapture(it, raw){
  if(!AICap.checked) await aiCheckStatus();
  if(!aiEnabled() || !it || it.deleted || AICap.busy) return;
  AICap.busy=true;
  try{
    const host=aiHost(); aiRenderPending(host, it);
    let res=null;
    try{ res = await window.pywebview.api.ai_capture(raw); }catch(e){ res=null; }
    if(!res || !res.ok || it.deleted){ aiClear(host); return; }
    const prop=aiBuildProposal(it, res);
    if(!prop.changes.length){ aiClear(host); return; }   // ничего лучше — молчим
    if(S.settings.aiAutoApply){ aiClear(host); aiApply(it, prop, true); return; }   // авто-применение без карточки
    aiRenderProposal(host, it, prop);
  } finally {
    AICap.busy=false;   // что бы ни случилось — не залипаем, следующий захват снова спросит ИИ
  }
}

/* ---------- UI ---------- */
function aiHost(){
  let h=document.getElementById("ai-prop");
  if(!h){ h=document.createElement("div"); h.id="ai-prop"; document.body.appendChild(h); }
  if(h._timer){ clearTimeout(h._timer); h._timer=null; }
  return h;
}
function aiClear(h){ if(h){ h.classList.remove("show"); h.innerHTML=""; } }
function aiRenderPending(h, it){
  h.innerHTML = `<div class="aip-card pend"><span class="aip-dot"></span><span class="aip-t">ИИ смотрит мысль…</span></div>`;
  h.classList.add("show");
}
function aiRenderProposal(h, it, prop){
  const chips = prop.changes.map(c=>`<span class="aip-chip"><i class="ti ${c.i}"></i>${esc(c.v)}</span>`).join("");
  h.innerHTML = `<div class="aip-card">
    <div class="aip-head"><i class="ti ti-sparkles"></i><b>Понял так</b></div>
    <div class="aip-title">${esc(prop.title)}</div>
    <div class="aip-chips">${chips}</div>
    <div class="aip-btns">
      <button class="aip-apply"><i class="ti ti-check"></i>Применить</button>
      <button class="aip-skip" title="Оставить как есть">×</button>
    </div></div>`;
  h.classList.add("show");
  h.querySelector(".aip-apply").onclick=()=>{ aiApply(it, prop); aiClear(h); };
  h.querySelector(".aip-skip").onclick=()=>aiClear(h);
  h._timer=setTimeout(()=>aiClear(h), 14000);   // проигнорил — тихо исчезает
}

/* ---------- стили (инжектим, чтобы фича была самодостаточной) ---------- */
(function aiInjectCSS(){
  const css = `
  #ai-prop{ position:fixed; top:84px; left:50%; transform:translateX(-50%) translateY(-6px);
    z-index:60; opacity:0; pointer-events:none; transition:opacity .16s ease, transform .16s ease; max-width:min(520px,90vw); }
  #ai-prop.show{ opacity:1; transform:translateX(-50%) translateY(0); pointer-events:auto; }
  .aip-card{ background:var(--surf2); border:1px solid var(--bd2); border-radius:var(--r-l);
    padding:12px 14px; box-shadow:0 12px 40px rgba(0,0,0,.45); font-family:var(--font); }
  .aip-head{ display:flex; align-items:center; gap:6px; color:var(--mut); font-size:12px; margin-bottom:6px; }
  .aip-head .ti{ font-size:14px; }
  .aip-title{ color:var(--tx); font-size:15px; font-weight:600; line-height:1.25; margin-bottom:8px; word-break:break-word; }
  .aip-chips{ display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
  .aip-chip{ display:inline-flex; align-items:center; gap:4px; font-size:12px; color:var(--tx);
    background:var(--surf3); border:1px solid var(--bd); border-radius:999px; padding:2px 9px; }
  .aip-chip .ti{ font-size:13px; color:var(--mut); }
  .aip-btns{ display:flex; align-items:center; gap:8px; }
  .aip-apply{ display:inline-flex; align-items:center; gap:5px; cursor:pointer; font-family:var(--font);
    background:var(--acc); color:var(--bg); border:none; border-radius:var(--r-s); padding:6px 12px; font-size:13px; font-weight:600; }
  .aip-apply:hover{ filter:brightness(.92); }
  .aip-skip{ cursor:pointer; background:transparent; color:var(--mut); border:1px solid var(--bd);
    border-radius:var(--r-s); width:28px; height:28px; font-size:16px; line-height:1; }
  .aip-skip:hover{ color:var(--tx); border-color:var(--bd2); }
  .aip-card.pend{ display:flex; align-items:center; gap:8px; color:var(--mut); font-size:13px; }
  .aip-dot{ width:8px; height:8px; border-radius:50%; background:var(--mut);
    animation:aipPulse 1s ease-in-out infinite; }
  @keyframes aipPulse{ 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1.15)} }
  `;
  const s=document.createElement("style"); s.id="ai-prop-css"; s.textContent=css; document.head.appendChild(s);
})();

// первичная проверка статуса, когда мост Python готов
if(typeof window!=="undefined"){
  window.addEventListener("pywebviewready", ()=>{ aiCheckStatus(); });
  setTimeout(()=>{ if(!AICap.checked) aiCheckStatus(); }, 1500);   // подстраховка, если событие уже прошло
}
