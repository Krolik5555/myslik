/* Тикер напоминаний по датам событий (it.eventAt / it.eventRepeat, см. overlays.js:
   eventControlHtml/openEventPicker и docs/КАРТА.md строку «напоминание»).

   ТОЛЬКО этот канал. Остальные правила из docs/УВЕДОМЛЕНИЯ.md (просрочка, застой, утренний
   план, тишина) там же и остались планом — ждут ответов КРОЛИКА на вопросы в конце файла и
   здесь не реализованы. Показ идёт через app.py: Api.show_toast (окно-тост, не системное
   Windows-уведомление — так решил КРОЛИК), клик по тосту возвращается в notifyOpenItem
   (main.js).

   Обходится БЕЗ отдельного журнала показанного: у каждого напоминания одна конкретная метка
   времени в eventAt, и после показа функция сама её убирает (не повторяется) или переставляет
   на следующее срабатывание (повторяется) — второй раз то же eventAt уже не пройдёт сравнение
   «пора». Журнал (S.settings.notifyLog) нужен только вероятностным правилам вроде «просрочка»,
   которых здесь нет. */
const NOTIFY_TICK_MS = 30000;   // раз в 30 с — минутная точность eventAt всё равно грубее

/* Строки «YYYY-MM-DDTHH:MM» сравниваются как обычный текст: формат с ведущими нулями и
   фиксированной длиной сортируется лексикографически ТАК ЖЕ, как по времени — Date тут даже
   не нужен. */
function notifyNowStr(){
  const d=new Date();
  const p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}

/* Следующее срабатывание после текущего eventAt. Крутим вперёд, пока не окажется в будущем —
   тот же приём, что у nextRepeat (core.js) для срока задачи: комп мог проспать день выключенным,
   и часовое напоминание не обязано разом высыпать десяток пропущенных копий. */
function notifyNextOccurrence(at, rep){
  const [ds,hm]=String(at).split("T");
  const день=parseYmd(ds); const врч=(hm||"00:00").split(":").map(Number);
  let d=new Date(день.getFullYear(), день.getMonth(), день.getDate(), врч[0]||0, врч[1]||0);
  const custom=/^every:(\d{1,3}):(minutes|hours|days|weeks|months)$/.exec(rep);
  const шаг=()=>{
    if(rep==="daily") d.setDate(d.getDate()+1);
    else if(rep==="weekly") d.setDate(d.getDate()+7);
    else if(rep==="monthly") d.setMonth(d.getMonth()+1);
    else if(custom){ const n=+custom[1];
      if(custom[2]==="minutes") d.setMinutes(d.getMinutes()+n);
      else if(custom[2]==="hours") d.setHours(d.getHours()+n);
      else if(custom[2]==="days") d.setDate(d.getDate()+n);
      else if(custom[2]==="weeks") d.setDate(d.getDate()+n*7);
      else{
        // месяцы — через 1-е число с зажимом дня по длине целевого месяца (тот же приём,
        // что у nextRepeat в core.js): иначе 31 января + месяц молча уедет на 3 марта
        const день=d.getDate();
        d.setDate(1); d.setMonth(d.getMonth()+n);
        d.setDate(Math.min(день, new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
      } }
    else return false;
    return true;
  };
  const сейчас=new Date();
  let охрана=0;
  while(d<=сейчас && охрана<10000){ if(!шаг()) break; охрана++; }
  const p=n=>String(n).padStart(2,"0");
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes());
}

// показ — через Python (см. app.py: Api.show_toast); без моста (дев-режим в браузере) молчим
function notifyFire(it){
  if(!HasPy() || typeof window.pywebview.api.show_toast!=="function") return;
  // текст тоста — описание ноды (КРОЛИК: «должно быть название и описание», не общая подпись);
  // пусто — тогда хоть что-то осмысленное вместо голой строки типа
  const тело=(it.body||"").trim();
  const текст = тело || (it.kind==="note" ? "Заметка-напоминание" : "Задача-напоминание");
  try{
    Promise.resolve(window.pywebview.api.show_toast(
      it.title||"Без названия", текст, it.id, S.settings.theme!=="light"
    )).catch(()=>{});
  }catch(e){ console.log("[notify] show_toast error:", e); }
}

/* Обходим ВСЕ графы, не только активный: напоминание на ноде в другом графе обязано
   сработать так же, как на текущем — человек его не открывал именно потому, что не думал
   про эту ветку прямо сейчас, за это и напоминание. */
function notifyTick(){
  if(!S || !Array.isArray(S.graphs)) return;
  const сейчас=notifyNowStr();
  let изменилось=false;
  S.graphs.forEach(g=>{
    (g.items||[]).forEach(it=>{
      if(it.deleted || !it.eventAt || it.eventAt>сейчас) return;
      notifyFire(it);
      it.eventAt = it.eventRepeat ? notifyNextOccurrence(it.eventAt, it.eventRepeat) : null;
      if(!it.eventAt) it.eventRepeat=null;
      изменилось=true;
    });
  });
  if(изменилось){ persist(); if(typeof renderAside==="function") renderAside(); }
}
