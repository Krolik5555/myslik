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
// провайдер сам определяет, включён ли ИИ (off → выкл). available учитывает готовность.
function aiEnabled(){ return !!AICap.status.available; }

// открыть ссылку (получить ключ API) в браузере
async function aiOpenUrl(url){ try{ if(HasPy()&&window.pywebview.api.open_url) await window.pywebview.api.open_url(url); }catch(e){} }

// человекочитаемая причина отказа (чтобы «не работает» стало понятным)
function aiErrMsg(res){
  const e=(res&&res.error)||"";
  const simple={ no_key:"не задан ключ API", no_account:"не задан Account ID",
    off:"ИИ выключен", unavailable:"локальная модель не загрузилась",
    infer:"сбой локальной модели", net:"нет связи с провайдером (интернет или блокировка из РФ)" };
  if(simple[e]) return simple[e];
  if(e.indexOf("http_")===0){
    const c=e.slice(5);
    if(c==="401"||c==="403") return "ключ отклонён или у токена нет прав Inference (пересоздай с пресетом Inference)";
    if(c==="404") return "модель недоступна у провайдера (проверь имя модели)";
    if(c==="400") return "провайдер не принял запрос (модель или формат)";
    if(c==="402") return "кончились бесплатные кредиты провайдера";
    if(c==="429") return "слишком часто — подожди (лимит запросов)";
    return "ошибка провайдера ("+c+")";
  }
  return "ИИ недоступен";
}

// ---- быстрый тумблер ИИ (команда в палитре Ctrl+K): off ⇄ подходящий провайдер ----
async function aiToggle(){
  if(!AICap.checked) await aiCheckStatus();
  const st=AICap.status||{}, prov=st.provider||"off", api=st.api||{};
  let next;
  if(prov!=="off"){ next="off"; }
  else {
    // включаем самый готовый: API с ключом → он; иначе локалка с моделью; иначе просим настроить
    const keyed=Object.keys(api).find(n=>api[n]&&api[n].has_key);
    if(keyed) next=keyed;
    else if((st.models||[]).length) next="local";
    else { toast("Сначала выбери провайдера в Настройки → ИИ", {icon:"ti-sparkles"}); return; }
  }
  try{
    const r=await window.pywebview.api.ai_set_provider(next);
    if(r&&r.ok){ await aiCheckStatus();
      toast(next==="off"?"Умный захват выключен":"Умный захват включён ("+next+")",
            {icon: next==="off"?"ti-sparkles-off":"ti-sparkles"}); }
    else toast("Не удалось переключить", {icon:"ti-alert-triangle"});
  }catch(e){ toast("Не удалось переключить", {icon:"ti-alert-triangle"}); }
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
const aiFmtGB = b => (b/1e9).toFixed(b<1e9?2:1)+" ГБ";
async function aiRenderSettings(panel){ if(panel) await aiPaintSettings(panel); }

// off/local — статичные; API-провайдеры строятся из st.api (порядок задаёт ai.py)
const AI_PROV_OFF   = {id:"off",   title:"Выключен", note:"ИИ нет. Ноль нагрузки, ничего не уходит из Мыслика."};
const AI_PROV_LOCAL = {id:"local", title:"Локально", note:"Модель на твоём ПК: приватно, без ключа и интернета, но грузит проц на пару секунд."};

async function aiPaintSettings(panel){
  panel.innerHTML = `<div class="set-hint">Проверяю…</div>`;
  const st = (await aiCheckStatus()) || AICap.status || {};
  const provider = st.provider || "off";
  const api = st.api || {};
  const autoOn = S.settings.aiAutoApply===true;
  // список: Выключен → все API-провайдеры (из бэкенда) → Локально
  const provs = [AI_PROV_OFF,
    ...Object.keys(api).map(id=>({id, title:(api[id].title||id)+" · API", note:api[id].note||""})),
    AI_PROV_LOCAL];

  let html = `<div class="set-hint">Умный захват: при вводе мысли ИИ предлагает чистый заголовок, дату и вид карточкой «Понял так». По умолчанию выключен — выбери, где его считать.</div>
    <div class="set-sec">Где считать</div>
    <div id="ai-prov">
      ${provs.map(p=>`
        <div class="set-row ai-provrow" data-id="${p.id}" style="cursor:pointer">
          <span style="display:flex;align-items:flex-start;gap:8px">
            <i class="ti ${provider===p.id?"ti-circle-check":"ti-circle"}" style="margin-top:2px;${provider===p.id?"color:var(--acc)":"color:var(--mut2)"}"></i>
            <span class="set-val"><b>${esc(p.title)}</b><br><span style="color:var(--mut);font-size:12px">${esc(p.note)}</span></span>
          </span>
        </div>`).join("")}
    </div>`;

  if(api[provider]){
    html += aiApiSectionHtml(provider, api[provider]);
  } else if(provider==="local"){
    html += await aiLocalSectionHtml(st);
  } else {
    html += `<div class="set-hint" style="color:var(--mut)">ИИ выключен — Мыслик работает без нагрузки. Выбери провайдера выше, чтобы включить.</div>`;
  }

  if(provider!=="off"){
    html += `<div class="set-sec">Поведение</div>
      <div class="field"><label>Применять сразу, без карточки</label>
        <div class="seg" id="set-ai-auto">
          <button data-v="1" class="${autoOn?"on":""}">Да</button>
          <button data-v="0" class="${autoOn?"":"on"}">Нет</button>
        </div></div>`;
  }

  panel.innerHTML = html;

  // выбор провайдера
  panel.querySelectorAll(".ai-provrow").forEach(el=>el.onclick=async()=>{
    const id=el.dataset.id; if(id===provider) return;
    try{ const r=await window.pywebview.api.ai_set_provider(id);
      if(r&&r.ok){ await aiCheckStatus(); aiPaintSettings(panel); }
      else toast("Не удалось переключить провайдера",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось переключить провайдера",{icon:"ti-alert-triangle"}); }
  });
  // авто-применение
  panel.querySelectorAll("#set-ai-auto button").forEach(b=>b.onclick=()=>{ S.settings.aiAutoApply=b.dataset.v==="1"; persist(); panel.querySelectorAll("#set-ai-auto button").forEach(x=>x.classList.toggle("on",x===b)); });

  if(api[provider]) aiWireApiSection(panel, provider, api[provider]);
  else if(provider==="local") aiWireLocalSection(panel, st);
}

// --- секция API-провайдера (ключ + [Account ID] + как получить + модель) ---
const _aiInp = `style="flex:1;min-width:0;background:var(--surf3);border:1px solid var(--bd);border-radius:var(--r-s);color:var(--tx);padding:7px 10px;font-family:var(--font)"`;
function aiApiSectionHtml(provider, info){
  const acct = info.needs_account ? `
    <div class="field"><label>Account ID</label>
      <input type="text" id="ai-apiacct" placeholder="${info.has_account?esc(info.account||"сохранён"):"ID аккаунта из дашборда"}" autocomplete="off" spellcheck="false" ${_aiInp}></div>` : "";
  return `<div class="set-sec">${esc(info.title||provider)} — доступ</div>
    <div class="set-hint">${esc(info.note||"")} Данные хранятся только у тебя на диске и уходят лишь этому провайдеру.</div>
    ${acct}
    <div class="field"><label>API-ключ</label>
      <input type="password" id="ai-apikey" placeholder="${info.has_key?"••••••••••  (сохранён)":"вставь ключ сюда"}" autocomplete="off" spellcheck="false" ${_aiInp}></div>
    <div class="set-row">
      <span class="set-val">${info.has_key?(info.needs_account&&!info.has_account?"<span style='color:var(--warn)'>Ключ есть, нужен Account ID</span>":"<span style='color:var(--pri1)'><i class='ti ti-check'></i> Готово</span>"):"Ключ ещё не задан"}</span>
      <div class="right" style="display:flex;gap:6px">
        <button class="btn ghost" id="ai-key-how"><i class="ti ti-external-link"></i>Как получить</button>
        ${info.has_key?`<button class="btn ghost" id="ai-key-clear" title="Удалить ключ"><i class="ti ti-trash"></i></button>`:""}
        <button class="btn primary" id="ai-key-save"><i class="ti ti-check"></i>Сохранить</button>
      </div>
    </div>
    <div class="set-hint">Модель: <b>${esc(info.model||info.default_model||"")}</b> <span style="color:var(--mut)">(по умолчанию, менять не нужно)</span></div>`;
}
function aiWireApiSection(panel, provider, info){
  const how=panel.querySelector("#ai-key-how"); if(how) how.onclick=()=>aiOpenUrl(info.keys_url||"");
  const clr=panel.querySelector("#ai-key-clear"); if(clr) clr.onclick=async()=>{
    try{ await window.pywebview.api.ai_set_api_key(provider,""); toast("Ключ удалён",{icon:"ti-trash"}); await aiCheckStatus(); aiPaintSettings(panel); }catch(e){}
  };
  const save=panel.querySelector("#ai-key-save"); if(save) save.onclick=async()=>{
    const k=(panel.querySelector("#ai-apikey").value||"").trim();
    const acctEl=panel.querySelector("#ai-apiacct");
    const acct=acctEl?(acctEl.value||"").trim():"";
    if(!k && !acct){ toast("Вставь ключ",{icon:"ti-key"}); return; }
    try{
      if(acct) await window.pywebview.api.ai_set_api_account(provider, acct);
      if(k) await window.pywebview.api.ai_set_api_key(provider, k);
      await aiCheckStatus();
      toast("Сохранено, проверяю связь…",{icon:"ti-loader"});
      // авто-проверка: сразу зовём модель тестовой фразой и показываем результат/причину
      const r=await window.pywebview.api.ai_capture("завтра в 15 часов позвонить маме по работе");
      if(r&&r.ok) toast("Связь есть · понял так: «"+esc(r.title||"")+"»",{icon:"ti-check",hold:true});
      else toast("Ключ сохранён, но связь не прошла: "+aiErrMsg(r),{icon:"ti-alert-triangle",hold:true});
      aiPaintSettings(panel);
    }catch(e){ toast("Не удалось сохранить",{icon:"ti-alert-triangle"}); }
  };
}

// --- секция локальных моделей (менеджер + движок) ---
async function aiLocalSectionHtml(st){
  let catalog=[]; try{ catalog = await window.pywebview.api.ai_model_catalog() || []; }catch(e){}
  const models=st.models||[], selModel=st.model||"";
  const backends=st.backends||[], curB=st.backend||(backends[0]||"cpu");
  const lbl=b=>b==="gpu"?"GPU (Vulkan)":"CPU";
  const titleOf=n=>{ const c=catalog.find(x=>x.name===n); return c?c.title:n.replace(/\.gguf$/i,""); };
  const restartB=!!(st.active && st.active!==curB);
  const restartM=!!(st.active_model && st.active_model!==selModel);
  const installed=new Set(models.map(m=>m.name));
  const toGet=catalog.filter(c=>!installed.has(c.name));
  const why={no_engine:"нет движка (папки ai/engine-cpu/engine-vulkan рядом с приложением)",
             no_model:"нет ни одной модели — скачай ниже", load_error:"движок не загрузился"}[st.reason];
  return `
    ${(st.reason && st.reason!=="no_model") ? `<div class="set-hint" style="color:var(--warn)"><i class="ti ti-alert-triangle"></i> ${esc(why||"проверь папку ai/")}</div>` : ""}
    <div class="set-sec">Установленные модели</div>
    ${models.length ? models.map(m=>`
      <div class="set-row ai-modrow" data-name="${esc(m.name)}">
        <span class="ai-modpick" style="cursor:pointer;display:flex;align-items:center;gap:7px">
          <i class="ti ${m.name===selModel?"ti-circle-check":"ti-circle"}" style="${m.name===selModel?"color:var(--acc)":"color:var(--mut2)"}"></i>
          <span class="set-val"><b>${esc(titleOf(m.name))}</b> · ${aiFmtGB(m.size)}${m.name===st.active_model?" · загружена":""}</span></span>
        <div class="right"><button class="btn ghost ai-moddel" data-name="${esc(m.name)}" title="Удалить"><i class="ti ti-trash"></i></button></div>
      </div>`).join("") : `<div class="set-hint">Нет ни одной — скачай ниже.</div>`}
    <div class="set-hint" id="set-ai-mrestart" style="display:${restartM?"flex":"none"};align-items:center;gap:5px;color:var(--pri2)"><i class="ti ti-refresh"></i> Перезапусти Мыслик, чтобы применить выбранную модель.</div>

    <div class="set-sec">Скачать модель</div>
    <div class="set-hint">По требованию, только по кнопке. «Минимальная» — для слабого ПК, «Средняя» — золотая середина.</div>
    <div id="ai-dl-progress" style="display:none;margin:8px 0"></div>
    ${toGet.length ? toGet.map(c=>`
      <div class="set-row">
        <span class="set-val"><b>${esc(c.title)}</b> <span style="color:var(--mut)">· ${esc(c.tier)} · ${aiFmtGB(c.size)}</span><br><span style="color:var(--mut);font-size:12px">${esc(c.note)}</span></span>
        <div class="right"><button class="btn ghost ai-dl" data-name="${esc(c.name)}"><i class="ti ti-download"></i>Скачать</button></div>
      </div>`).join("") : `<div class="set-hint">Все модели каталога уже установлены.</div>`}

    <div class="set-sec">Движок</div>
    <div class="set-hint">CPU — работает у всех. GPU (Vulkan) — на видеокарте, но занимает видеопамять. Смена — после перезапуска.</div>
    <div class="field"><label>Где считать</label>
      <div class="seg" id="set-ai-engine">
        ${["cpu","gpu"].map(b=>`<button data-v="${b}" class="${curB===b?"on":""}" ${backends.includes(b)?"":"disabled"}>${lbl(b)}${backends.includes(b)?"":" — нет пака"}</button>`).join("")}
      </div></div>
    <div class="set-hint" id="set-ai-restart" style="display:${restartB?"flex":"none"};align-items:center;gap:5px;color:var(--pri2)"><i class="ti ti-refresh"></i> Перезапусти Мыслик, чтобы применить движок.</div>`;
}
function aiWireLocalSection(panel, st){
  let catalog=[]; // заголовки моделей достаём лениво из каталога при действиях
  const titleOf=n=>n.replace(/\.gguf$/i,"");
  panel.querySelectorAll("#set-ai-engine button").forEach(b=>b.onclick=async()=>{ if(b.disabled)return; const name=b.dataset.v;
    try{ const r=await window.pywebview.api.ai_set_backend(name);
      if(r&&r.ok){ AICap.status.backend=name; panel.querySelectorAll("#set-ai-engine button").forEach(x=>x.classList.toggle("on",x===b));
        const rs=panel.querySelector("#set-ai-restart"); if(rs) rs.style.display=(st.active&&st.active!==name)?"flex":"none";
        toast("Движок ИИ → "+(name==="gpu"?"GPU (Vulkan)":"CPU")+" (после перезапуска)",{icon:"ti-refresh"}); }
      else toast("Не удалось переключить движок",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось переключить движок",{icon:"ti-alert-triangle"}); } });
  panel.querySelectorAll(".ai-modrow .ai-modpick").forEach(el=>el.onclick=async()=>{ const name=el.closest(".ai-modrow").dataset.name;
    try{ const r=await window.pywebview.api.ai_set_model(name);
      if(r&&r.ok){ toast("Модель выбрана (после перезапуска)",{icon:"ti-check"}); await aiCheckStatus(); aiPaintSettings(panel); }
      else toast("Не удалось выбрать модель",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось выбрать модель",{icon:"ti-alert-triangle"}); } });
  panel.querySelectorAll(".ai-moddel").forEach(b=>b.onclick=async(e)=>{ e.stopPropagation(); const name=b.dataset.name;
    if(!(await uiConfirm("Удалить модель «"+titleOf(name)+"»? Файл будет стёрт с диска.",{danger:true,title:"Удалить модель",okLabel:"Удалить"}))) return;
    try{ const r=await window.pywebview.api.ai_delete_model(name);
      if(r&&r.ok){ toast("Модель удалена",{icon:"ti-trash"}); await aiCheckStatus(); aiPaintSettings(panel); }
      else if(r&&r.error==="loaded") toast("Эта модель загружена — перезапусти Мыслик и удали",{icon:"ti-alert-triangle"});
      else toast("Не удалось удалить",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось удалить",{icon:"ti-alert-triangle"}); } });
  panel.querySelectorAll(".ai-dl").forEach(b=>b.onclick=async()=>{ const name=b.dataset.name;
    try{ const r=await window.pywebview.api.ai_download_model(name);
      if(r&&r.ok){ toast("Загрузка началась",{icon:"ti-download"}); aiPollDownload(panel); }
      else if(r&&r.error==="busy") toast("Уже качается другая модель",{icon:"ti-download"});
      else toast("Не удалось начать загрузку",{icon:"ti-alert-triangle"});
    }catch(e){ toast("Не удалось начать загрузку",{icon:"ti-alert-triangle"}); } });
  aiPollDownload(panel, true);   // если загрузка уже идёт — подхватить прогресс
}

let _aiDlTimer=null;
async function aiPollDownload(panel, silent){
  if(_aiDlTimer){ clearInterval(_aiDlTimer); _aiDlTimer=null; }
  const box=panel.querySelector("#ai-dl-progress"); if(!box) return;
  if(silent){ let s={}; try{ s=await window.pywebview.api.ai_download_status()||{}; }catch(e){} if(!s.active) return; }
  const tick=async()=>{
    let s={}; try{ s=await window.pywebview.api.ai_download_status()||{}; }catch(e){}
    if(s.active){ box.style.display="block";
      box.innerHTML=`<div class="set-hint" style="margin-bottom:4px">Качаю ${esc(s.active.replace(/\.gguf$/i,""))}… ${s.pct||0}%</div><div style="height:6px;background:var(--surf3);border-radius:3px;overflow:hidden"><div style="height:100%;width:${s.pct||0}%;background:var(--acc);transition:width .3s"></div></div>`;
    } else { if(_aiDlTimer){ clearInterval(_aiDlTimer); _aiDlTimer=null; }
      if(s.done){ toast("Модель скачана",{icon:"ti-check"}); aiPaintSettings(panel); }
      else if(s.error){ box.style.display="block"; box.innerHTML=`<div class="set-hint" style="color:var(--warn)">Ошибка загрузки — проверь интернет и попробуй снова.</div>`; }
      else box.style.display="none"; }
  };
  tick(); _aiDlTimer=setInterval(tick, 1000);
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
let _aiSeq = 0;   // метка последнего захвата: результат более раннего игнорируем
async function aiRefineCapture(it, raw){
  if(!AICap.checked) await aiCheckStatus();
  if(!aiEnabled() || !it || it.deleted) return;
  const seq = ++_aiSeq;                        // этот захват стал «последним»
  const host=aiHost(); aiRenderPending(host, it);
  let res=null;
  try{ res = await window.pywebview.api.ai_capture(raw); }catch(e){ res=null; }
  if(seq !== _aiSeq) return;                    // пока думали — пришёл новый захват; этот ответ устарел, молчим
  if(!res || !res.ok || it.deleted){
    // молча гасим только «безобидные» отказы; реальные ошибки показываем, иначе «просто не работает»
    const benign = !res || it.deleted || ["off","junk","empty"].indexOf(res.error)>=0;
    if(res && !benign){ console.warn("[ai] capture error:", res.error, res.detail||""); toast("Умный захват: "+aiErrMsg(res), {icon:"ti-alert-triangle"}); }
    aiClear(host); return;
  }
  const prop=aiBuildProposal(it, res);
  if(!prop.changes.length){ aiClear(host); return; }   // ничего лучше — молчим
  if(S.settings.aiAutoApply){ aiClear(host); aiApply(it, prop, true); return; }   // авто-применение без карточки
  aiRenderProposal(host, it, prop);
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
