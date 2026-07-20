"use strict";
/* ===========================================================
   ОТЧЁТ ИЗ ВЫДЕЛЕННОГО
   -----------------------------------------------------------
   Выделяешь заметки/задачи в графе → «Отчёт». Два режима:
   • Простой — детерминированный текст (заметки + задачи по статусу), мгновенно, без ИИ.
   • Через ИИ — модель пишет связный отчёт прозой (провайдер из Настройки → ИИ).
   Отчёт можно скопировать или сохранить как заметку.
   =========================================================== */

// статус задачи для отчёта: done / doing / todo (заметки/схемы → null)
function reportStatusOf(it){
  if(!it || it.kind!=="task") return null;
  if(it.done) return "done";
  if(it.status==="doing") return "doing";
  return "todo";
}

// человекочитаемая дата timestamp → «дд.мм.гггг»
function _repTs(ts){ try{ return new Date(ts).toLocaleDateString("ru"); }catch(e){ return ""; } }

// детерминированный «простой» отчёт по выделенным элементам
function buildReportText(items){
  items=(items||[]).filter(Boolean);
  const notes=items.filter(i=>i.kind==="note"||i.kind==="flow");
  const tasks=items.filter(i=>i.kind==="task");
  const L=[];
  let head="Отчёт · "+items.length+" элем.";
  try{ head+=" · "+new Date().toLocaleDateString("ru"); }catch(e){}
  L.push(head); L.push("");

  if(notes.length){
    L.push("ЗАМЕТКИ ("+notes.length+")");
    notes.forEach(n=>{
      L.push("• "+((n.title||"").trim()||"(без названия)"));
      const b=(n.body||"").trim();
      if(b) L.push("  "+b.replace(/\n/g,"\n  "));
    });
    L.push("");
  }

  if(tasks.length){
    L.push("ЗАДАЧИ ("+tasks.length+")");
    const groups=[["done","✓ Выполнено"],["doing","► В работе"],["todo","○ Не начато"]];
    groups.forEach(([st,label])=>{
      const g=tasks.filter(t=>reportStatusOf(t)===st);
      if(!g.length) return;
      L.push(label+" ("+g.length+")");
      g.forEach(t=>{
        const meta=[];
        if(st==="done" && t.doneAt) meta.push("выполнено "+_repTs(t.doneAt));
        if(st!=="done" && t.due){ const dl=(typeof dueLabel==="function")?dueLabel(t.due):null; meta.push("срок "+(dl&&dl.txt?dl.txt:t.due)); }
        if(t.priority) meta.push("!".repeat(t.priority));
        L.push("  • "+((t.title||"").trim()||"(без названия)")+(meta.length?"  ("+meta.join(", ")+")":""));
        const b=(t.body||"").trim();
        if(b) L.push("    "+b.replace(/\n/g,"\n    "));
      });
    });
  }
  if(!notes.length && !tasks.length) L.push("(в выделении нет заметок или задач)");
  return L.join("\n");
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

// главное окно отчёта
function openReportModal(items){
  items=(items||[]).filter(Boolean);
  if(!items.length){ toast("Нечего в отчёт — выдели заметки или задачи",{icon:"ti-file-text"}); return; }
  const simple=buildReportText(items);
  const aiReady = !!(typeof AICap!=="undefined" && AICap.status && AICap.status.available);
  let mode="simple", aiText=null, loading=false;

  const m=el("div","modal report-modal");
  m.innerHTML=`
    <h3><i class="ti ti-file-text"></i>Отчёт · ${items.length} элем.</h3>
    <div class="seg" id="rep-mode">
      <button data-m="simple" class="on">Простой</button>
      <button data-m="ai">Через ИИ${aiReady?"":" ·  выкл"}</button>
    </div>
    <div class="field rep-purpose-row" style="display:none">
      <label>Цель</label>
      <input type="text" id="rep-purpose" placeholder="напр. «баг-репорт разработчику» — необязательно" autocomplete="off"
        style="flex:1;min-width:0;background:var(--surf3);border:1px solid var(--bd);border-radius:var(--r-s);color:var(--tx);padding:7px 10px;font-family:var(--font)">
    </div>
    <div class="report-body"><pre id="rep-out"></pre></div>
    <div class="modal-foot">
      <button class="btn ghost" id="rep-copy"><i class="ti ti-copy"></i>Копировать</button>
      <button class="btn ghost" id="rep-save"><i class="ti ti-note"></i>Сохранить заметкой</button>
      <div class="right">
        <button class="btn ghost" id="rep-regen" style="display:none"><i class="ti ti-refresh"></i>Пересобрать</button>
        <button class="btn primary" id="rep-close"><i class="ti ti-check"></i>Закрыть</button>
      </div>
    </div>`;
  const ov=overlay(m);
  const out=m.querySelector("#rep-out");
  const purposeRow=m.querySelector(".rep-purpose-row");
  const regenBtn=m.querySelector("#rep-regen");
  const paint=()=>{
    if(mode==="simple"){ out.textContent=simple; }
    else if(loading){ out.textContent="ИИ собирает отчёт…"; }
    else if(aiText){ out.textContent=aiText; }
    else { out.textContent="Нажми «Через ИИ» ещё раз или «Пересобрать»."; }
    purposeRow.style.display = (mode==="ai") ? "" : "none";
    regenBtn.style.display = (mode==="ai" && aiReady) ? "" : "none";
  };
  const curText=()=> (mode==="ai" && aiText) ? aiText : simple;

  const genAi=async()=>{
    if(!aiReady){ toast("Включи ИИ в Настройки → ИИ",{icon:"ti-sparkles"}); return; }
    if(loading) return;
    loading=true; aiText=null; paint();
    const purpose=(m.querySelector("#rep-purpose").value||"").trim();
    try{
      const r=await window.pywebview.api.ai_report(simple, purpose);
      if(r&&r.ok){ aiText=(r.text||"").trim()||"(пустой ответ)"; }
      else { toast("ИИ-отчёт: "+((typeof aiErrMsg==="function")?aiErrMsg(r):"ошибка"),{icon:"ti-alert-triangle"}); }
    }catch(e){ toast("Не удалось собрать ИИ-отчёт",{icon:"ti-alert-triangle"}); }
    loading=false; paint();
  };
  paint();

  m.querySelectorAll("#rep-mode button").forEach(b=>b.onclick=()=>{
    m.querySelectorAll("#rep-mode button").forEach(x=>x.classList.toggle("on",x===b));
    mode = b.dataset.m==="ai" ? "ai" : "simple";
    if(mode==="ai" && !aiText && !loading){ genAi(); } else { paint(); }
  });
  regenBtn.onclick=genAi;

  m.querySelector("#rep-copy").onclick=async()=>{
    const ok=await _repCopy(curText());
    toast(ok?"Скопировано":"Не удалось скопировать",{icon:ok?"ti-copy":"ti-alert-triangle"});
  };
  m.querySelector("#rep-save").onclick=()=>{
    let title="Отчёт"; try{ title="Отчёт "+new Date().toLocaleDateString("ru"); }catch(e){}
    addItem({kind:"note", title:title, body:curText()});
    persist(); if(typeof render==="function") render();
    toast("Отчёт сохранён заметкой",{icon:"ti-note"});
  };
  m.querySelector("#rep-close").onclick=()=>ov.remove();
}
