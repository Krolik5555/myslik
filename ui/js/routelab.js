/* ЛАБОРАТОРИЯ МАРШРУТОВ — только дев (КРОЛИК, 04.11.2026: «не получается воспроизвести проблемы друга —
   доведи построение связей до ума»). Перестаём чинить по одному снимку: случаи генерируются десятками по
   зерну, каждый ставится на ВРЕМЕННЫЙ граф и меряется по одной спецификации (шапка tools/scenarios/
   маршруты.js). Зовут: сценарий tools/scenarios/перебор.js (таблица) и галерея index.html?dev&routes-gallery
   (случаи по одному на настоящем графе, нарушения — красным). В index.html модуль не подключается: его
   грузят по требованию, приложению он не нужен. Живые данные не трогает: свой граф, после — удаляется. */
const RouteLab=(()=>{
  const РЕЖИМЫ=["soft","ortho","bus","metro","bundle"];
  // детерминированный ГСЧ (mulberry32): тот же номер случая — тот же граф в каждом прогоне
  const гсч=s=>()=>{ s|=0; s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15), 1|s); t=(t+Math.imul(t^(t>>>7), 61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
  const СЛОВА=["Рендер","Сборка","VFX","Анимация","Свет","Композ","Звук","Монтаж","Текстуры","Риг","Симуляция одежды","Финальный цвет"];
  const подпись=(r,i,длинно)=>длинно ? "Очень длинная подпись ноды "+(i+1)+" "+СЛОВА[(r()*СЛОВА.length)|0] : (r()<0.5 ? "SH"+String(10+i*10).padStart(3,"0") : СЛОВА[(r()*СЛОВА.length)|0]);

  /* СЛУЧАИ. Каждый — {имя, ноды:[{к,x,y,т,корень,ветка}], связи:[[к1,к2,точки?]], точки:{id:{x,y}}, хаб:{x,y}}.
     Корни деревьев — со своей областью (её хаб — часть случая, как у живого графа «область → верхние ноды»),
     остальные — детьми по связям: иначе родителей не было бы, и связи шли бы «поперёк веток», без групп. */
  // прф — у второго куста того же родителя: без него ключи детей совпали бы, и в графе вышли бы две ноды с одним id
  function куст(r, сл, кк, cx, cy, n, сектор, ширина, дальше, прф){
    for(let i=0;i<n;i++){ const a=сектор+(n>1 ? (i/(n-1)-0.5)*ширина : 0)+(r()-0.5)*0.25, d=дальше[0]+r()*(дальше[1]-дальше[0]);
      const к=кк+"_"+(прф||"")+i; сл.ноды.push({к, x:Math.round(cx+Math.cos(a)*d), y:Math.round(cy+Math.sin(a)*d), т:подпись(r,сл.ноды.length,сл.длинно)});
      сл.связи.push([кк, к]); } }
  const ГЕН={
    // широкий куст: один родитель, 4–15 детей с одной или двух сторон
    куст(r){ const сл={ноды:[{к:"R", x:0, y:0, т:"SQ01", корень:true}], связи:[], хаб:{x:-320, y:-40}};
      const n=4+((r()*12)|0), сек=r()*Math.PI*2;
      if(r()<0.5) куст(r, сл, "R", 0, 0, n, сек, 0.6+r()*2.4, [140, 320]);
      else { куст(r, сл, "R", 0, 0, (n/2)|0, сек, 1.4, [140, 300]); куст(r, сл, "R", 0, 0, n-((n/2)|0), сек+Math.PI*(0.6+r()*0.8), 1.4, [140, 300], "b"); }
      return сл; },
    // глубокая цепочка с поворотами
    цепь(r){ const сл={ноды:[{к:"R", x:0, y:0, т:"SQ01", корень:true}], связи:[], хаб:{x:-300, y:0}};
      let x=0, y=0, a=r()*Math.PI*2, пред="R";
      for(let i=0;i<6+((r()*9)|0);i++){ a+=(r()-0.5)*1.6; x+=Math.cos(a)*(120+r()*90); y+=Math.sin(a)*(120+r()*90);
        const к="C"+i; сл.ноды.push({к, x:Math.round(x), y:Math.round(y), т:подпись(r,i,false)}); сл.связи.push([пред, к]); пред=к;
        if(r()<0.3){ const к2=к+"л"; сл.ноды.push({к:к2, x:Math.round(x+(r()-0.5)*200), y:Math.round(y+(r()-0.5)*200), т:подпись(r,i+50,false)}); сл.связи.push([к, к2]); } }
      return сл; },
    // несколько деревьев рядом, ветки заходят друг в друга
    деревья(r){ const сл={ноды:[], связи:[], хаб:{x:-200, y:-260}}; const к=2+((r()*2)|0);
      for(let t=0;t<к;t++){ const cx=t*(260+r()*160), cy=(r()-0.5)*120, R="T"+t;
        сл.ноды.push({к:R, x:Math.round(cx), y:Math.round(cy), т:"SQ0"+(t+1), корень:true});
        куст(r, сл, R, cx, cy, 4+((r()*5)|0), (t%2 ? Math.PI : 0)+(r()-0.5), 2.2, [120, 300]); }
      return сл; },
    // ноды точно на одной оси и почти на оси (±2–10 px)
    ось(r){ const сл={ноды:[{к:"R", x:0, y:0, т:"SQ01", корень:true}], связи:[], хаб:{x:-280, y:0}};
      for(let i=0;i<6;i++){ const сдвиг=i<2 ? 0 : (2+((r()*9)|0))*(r()<0.5?-1:1), верт=r()<0.5, d=(i+1)*90*(r()<0.5?-1:1);
        const к="A"+i; сл.ноды.push({к, x:верт ? сдвиг : d, y:верт ? d : сдвиг, т:подпись(r,i,r()<0.3)}); сл.связи.push(["R", к]); }
      return сл; },
    // ноды вплотную к чужим связям: поверх хорд кладутся посторонние ноды
    теснота(r){ const сл=ГЕН.куст(r);
      const есть=сл.ноды.slice(1), по={}; сл.ноды.forEach(н=>{ по[н.к]=н; });
      for(let i=0;i<Math.min(4, есть.length);i++){ const н=есть[(r()*есть.length)|0], t=0.35+r()*0.3;
        const к="X"+i; сл.ноды.push({к, x:Math.round(н.x*t+(r()-0.5)*14), y:Math.round(н.y*t+(r()-0.5)*14), т:подпись(r,40+i,false)});
        const м=есть[(r()*есть.length)|0]; if(м.к!==н.к) сл.связи.push([м.к, к]); }
      return сл; },
    // длинные подписи
    подписи(r){ const сл={ноды:[{к:"R", x:0, y:0, т:"Очень длинная подпись корня", корень:true}], связи:[], хаб:{x:-330, y:-60}, длинно:true};
      куст(r, сл, "R", 0, 0, 5+((r()*6)|0), r()*Math.PI*2, 2.6, [130, 280]); return сл; },
    // нити к области: несколько нод со своей областью вокруг хаба, у части — дети
    область(r){ const сл={ноды:[], связи:[], хаб:{x:0, y:0}};
      for(let i=0;i<4+((r()*4)|0);i++){ const a=r()*Math.PI*2, d=160+r()*200, к="O"+i;
        сл.ноды.push({к, x:Math.round(Math.cos(a)*d), y:Math.round(Math.sin(a)*d), т:подпись(r,i,false), корень:true});
        if(r()<0.6) куст(r, сл, к, Math.cos(a)*d, Math.sin(a)*d, 2+((r()*3)|0), a, 1.2, [110, 200]); }
      return сл; },
    // точки связей и цепочки точек
    точки(r){ const сл=ГЕН.куст(r), дети=сл.связи.slice(0, Math.min(сл.связи.length, 2+((r()*4)|0)));
      if(!дети.length) return сл;
      const по={}; сл.ноды.forEach(н=>{ по[н.к]=н; });
      let sx=0, sy=0; дети.forEach(([a,b])=>{ sx+=по[b].x; sy+=по[b].y; });
      const т1={x:Math.round(sx/дети.length*0.45+(r()-0.5)*40), y:Math.round(sy/дети.length*0.45+(r()-0.5)*40)};
      сл.точки={dot_lab1:т1};
      дети.forEach(с=>{ с[2]=[{d:"dot_lab1"}]; });
      if(r()<0.5 && дети.length>1){ const т2={x:Math.round(т1.x*1.6+(r()-0.5)*60), y:Math.round(т1.y*1.6+(r()-0.5)*60)}; сл.точки.dot_lab2=т2;
        дети.slice(0, 2).forEach(с=>{ с[2]=[{d:"dot_lab1"},{d:"dot_lab2"}]; }); }
      return сл; },
    // ручные якоря (точки маршрута одной связи)
    якоря(r){ const сл=ГЕН.куст(r);
      for(let i=0;i<Math.min(3, сл.связи.length);i++){ const с=сл.связи[(r()*сл.связи.length)|0]; if(!с[2]) с[2]=[{dx:Math.round((r()-0.5)*160), dy:Math.round((r()-0.5)*160)}]; }
      return сл; },
    // «как у живого человека»: дерево без упорядочивания, ноды поставлены рукой рядом с родителем
    ручные(r){ const сл={ноды:[{к:"R", x:0, y:0, т:"SQ01", корень:true}], связи:[], хаб:{x:-300, y:-120}};
      for(let i=0;i<14+((r()*17)|0);i++){ const р=сл.ноды[(r()*сл.ноды.length)|0], a=r()*Math.PI*2, d=90+r()*170, к="H"+i;
        сл.ноды.push({к, x:Math.round(р.x+Math.cos(a)*d), y:Math.round(р.y+Math.sin(a)*d), т:подпись(r,i,r()<0.15)}); сл.связи.push([р.к, к]); }
      return сл; },
    // смешанные режимы веток
    ветки(r){ const сл=ГЕН.ручные(r), м=["ortho","bus","metro","bundle","soft"];
      for(let i=0;i<3;i++){ const н=сл.ноды[1+((r()*(сл.ноды.length-1))|0)]; if(н) н.ветка=м[(r()*м.length)|0]; }
      return сл; },
  };
  const ВИДЫ=Object.keys(ГЕН), ЗЁРЕН=6;
  // список случаев: каждый вид × ЗЁРЕН зёрен; номер случая — его имя «вид-зерно»
  function случаи(){ const o=[];
    for(const вид of ВИДЫ) for(let z=1; z<=ЗЁРЕН; z++){ const r=гсч(z*7919+вид.length*131); const сл=ГЕН[вид](r); сл.имя=вид+"-"+z; o.push(сл); }
    return o; }
  // большой граф для замера: 520 нод кустами, как в связи.js
  function большой(){ const сл={имя:"большой", ноды:[{к:"R", x:0, y:0, т:"корень", корень:true}], связи:[], хаб:{x:-400, y:0}}, угол=[0], глуб=[0];
    for(let i=1;i<520;i++){ const pi=Math.floor((i-1)/4), k=(i-1)%4, р=сл.ноды[pi];
      const ug=pi===0 ? k*Math.PI/2 : угол[pi]+(k-1.5)*0.5, rr=глуб[pi]===0 ? 260 : 150/Math.sqrt(глуб[pi]);
      сл.ноды.push({к:"B"+i, x:Math.round(р.x+Math.cos(ug)*rr), y:Math.round(р.y+Math.sin(ug)*rr), т:"N"+i}); сл.связи.push([р.к, "B"+i]); угол.push(ug); глуб.push(глуб[pi]+1); }
    return сл; }

  /* ВРЕМЕННЫЙ ГРАФ лаборатории: заводится один раз, случаи ставятся в него по очереди целиком (items,
     links, areas, dots), в конце — удаляется вместе с содержимым. Режим «держать раскладку», дыхание и
     привязка на время выключены: ноды обязаны стоять ровно там, где их поставил генератор. */
  let лаб=null, было=null;
  function открыть(){
    if(лаб) return;
    было={graph:S.settings.graph, mode:S.settings.graphLinkMode, home:S.settings.graphHome, drift:S.settings.graphDrift, snap:S.settings.graphSnap, rend:S.settings.graphRender};
    const g=graphAdd("Лаборатория маршрутов"); лаб=g.id; graphSwitch(лаб);
    S.settings.graphHome=false; S.settings.graphDrift=0; S.settings.graphSnap=false; S.settings.graphRender="canvas";
    view="notes"; notesMode="graph"; render();
  }
  function закрыть(){
    if(!лаб) return;
    graphSwitch(было.graph); graphDelete(лаб); лаб=null;
    for(const k of ["graphLinkMode","graphHome","graphDrift","graphSnap","graphRender"]){ const v=было[{graphLinkMode:"mode",graphHome:"home",graphDrift:"drift",graphSnap:"snap",graphRender:"rend"}[k]]; if(v==null) delete S.settings[k]; else S.settings[k]=v; }
    render();
  }
  // поставить случай в граф лаборатории и довести маршруты режима до тишины (подбор — без бюджета)
  function поставить(сл, режим){
    const g=graphCurrent();
    g.areas=[{id:"a_lab", name:"Область", icon:"ti-folder", color:null, x:сл.хаб.x, y:сл.хаб.y}];
    const ид=к=>"lab_"+к;
    g.items=сл.ноды.map(н=>{ const it={id:ид(н.к), kind:"note", title:н.т, body:"", area:н.корень ? "a_lab" : null, status:"todo", due:null,
      repeat:"none", priority:0, tags:[], created:0, updated:0, done:false, x:н.x, y:н.y, pin:false, parent:null, deleted:false, deletedAt:null};
      if(н.ветка) it.branchmode=н.ветка; return it; });
    g.links=сл.связи.map(([a,b,т])=>т ? [ид(a), ид(b), 1, null, JSON.parse(JSON.stringify(т))] : [ид(a), ид(b)]);
    if(сл.точки) g.dots=JSON.parse(JSON.stringify(сл.точки)); else delete g.dots;
    recomputeHierarchy();
    if(режим==="soft") delete S.settings.graphLinkMode; else S.settings.graphLinkMode=режим;
    /* живые узлы прошлого случая — забыть: build() берёт место у живого узла с тем же id, а id у случаев
       общие (lab_H0…), и случай 66 мерился на раскладке 55-го (шина: 24 пересечения против 4 на своей) */
    graph.byId={}; graph.build(); graph.alpha=0; graph.nodes.forEach(n=>{ n._ix=0; n._iy=0; });
    // и первый подбор (из _routesFresh) — уже без бюджета: обрыв по времени делал итог зависимым от скорости машины
    graph._routeMem(true); graph._маршр=null; graph._оптБюджет=5000; graph._routesFresh(); довести();
    // прогиб мягкой связи доезжает до цели за кадры (_bendT → _bendC): меряем конечный вид, а не первый кадр
    for(const l of graph.links) l._bendC=l._bendT ? Object.assign({}, l._bendT) : null;
  }
  function довести(){ graph._оптБюджет=5000;
    for(let k=0;k<30;k++){ const n=graph._routeOptimize(); if(!n && !graph._оптНедо) break; if(n) graph._routeBuild(); }
    graph._оптБюджет=0; graph._crossBuild(); }

  /* ПУТЬ СВЯЗИ для метрик — та же геометрия, что рисует кадр: маршрут режима (вершины колен, без
     скруглений: их кусочки множили бы повороты), прогиб мягкой (парабола по 8 точкам) или хорда */
  function путь(l){
    const a=graph.byId[l.a], b=graph.byId[l.b]; if(!a||!b) return [];
    if(l._рт){ const c=l._рт.c, o=[]; for(let k=0;k+1<c.length;k+=2) o.push([c[k], c[k+1]]); return o; }
    const bd=l._bendC;
    if(bd){ const cx=a.x+(b.x-a.x)*bd.t+bd.ox*2, cy=a.y+(b.y-a.y)*bd.t+bd.oy*2, o=[];
      for(let k=0;k<=8;k++){ const t=k/8, u=1-t; o.push([u*u*a.x+2*u*t*cx+t*t*b.x, u*u*a.y+2*u*t*cy+t*t*b.y]); } return o; }
    return [[a.x,a.y],[b.x,b.y]]; }
  const отрезки=п=>{ const o=[]; for(let k=0;k+1<п.length;k++) if(Math.hypot(п[k+1][0]-п[k][0], п[k+1][1]-п[k][1])>0.5) o.push([п[k][0],п[k][1],п[k+1][0],п[k+1][1]]); return o; };
  function перес(A, B){ const ex=A[2]-A[0], ey=A[3]-A[1], fx=B[2]-B[0], fy=B[3]-B[1], d=ex*fy-ey*fx; if(Math.abs(d)<1e-9) return null;
    const s=((B[0]-A[0])*fy-(B[1]-A[1])*fx)/d, u=((B[0]-A[0])*ey-(B[1]-A[1])*ex)/d;
    return (s>0.001 && s<0.999 && u>0.001 && u<0.999) ? [A[0]+ex*s, A[1]+ey*s] : null; }
  // повороты ломаной вне своих нод (кусочки короче 3 px — не в счёт)
  function повороты(п, rA, rB){ const n=п.length; if(n<3) return 0; const a=п[0], b=п[n-1]; let к=0, пред=null;
    for(let i=0;i<n-1;i++){ const ex=п[i+1][0]-п[i][0], ey=п[i+1][1]-п[i][1], L=Math.hypot(ex,ey); if(L<3) continue;
      if(Math.hypot(п[i+1][0]-a[0], п[i+1][1]-a[1])<rA+2 || Math.hypot(п[i][0]-b[0], п[i][1]-b[1])<rB+2) { пред=[ex/L,ey/L]; continue; }
      const d=[ex/L, ey/L]; if(пред && Math.abs(пред[0]*d[1]-пред[1]*d[0])>0.05) к++; пред=d; }
    return к; }

  /* МЕТРИКИ СЛУЧАЯ — по спецификации (шапка маршруты.js). Каждое нарушение — запись с местом {x,y} для
     галереи. пер — скрещения чужих связей (в общей ноде и в общей точке связей — не в счёт);
     нав — связь через чужую ноду с подписью; разв — разворот на 180° по ходу связи; назад — выход из
     ноды или вход в неё с дальней стороны (routeNoBack; у пути через точки — по участку, routeViaNoBack);
     прямо — ноды на одной оси, а связь с коленами; впритык — параллельные отрезки чужих связей ближе
     ВПРИТЫК мировых единиц (≈ 4–5 экранных px на зуме ×0.8), кроме сходящихся в общей ноде или точке
     и кроме общего ствола (наложение связей с общим концом);
     уНоды — прошла вплотную (ближе 6) мимо чужой ноды; колен — всего поворотов (справка). */
  const ВПРИТЫК=6;
  function метрики(){
    const L=graph.links.filter(l=>graph.byId[l.a] && graph.byId[l.b]), П=L.map(путь), О=П.map(отрезки), нар=[];
    const м={пер:0, нав:0, разв:0, назад:0, прямо:0, впритык:0, уНоды:0, колен:0, связей:L.length};
    const узел=(x,y,ids)=>ids.some(id=>{ const n=graph.byId[id]; return n && Math.hypot(n.x-x, n.y-y)<(n.r||8)+6; });
    for(let i=0;i<L.length;i++) for(let j=i+1;j<L.length;j++){ const A=L[i], B=L[j];
      const общ=[A.a,A.b].filter(x=>x===B.a || x===B.b), точка=graph._dotShared(A, B);
      for(const s of О[i]) for(const q of О[j]){
        const p=перес(s, q);
        if(p){ if(!точка && !узел(p[0], p[1], [A.a,A.b,B.a,B.b])){ м.пер++; нар.push({вид:"пер", x:p[0], y:p[1], l:[A,B]}); } continue; }
        // параллельные: оба по одной оси (или одна диагональ), расстояние и нахлёст
        const ex=s[2]-s[0], ey=s[3]-s[1], fx=q[2]-q[0], fy=q[3]-q[1], Ls=Math.hypot(ex,ey), Lq=Math.hypot(fx,fy);
        if(Ls<6 || Lq<6 || Math.abs(ex*fy-ey*fx)>0.02*Ls*Lq) continue;
        const ux=ex/Ls, uy=ey/Ls, рас=Math.abs((q[0]-s[0])*uy-(q[1]-s[1])*ux);
        if(рас>=ВПРИТЫК) continue;
        const t0=(q[0]-s[0])*ux+(q[1]-s[1])*uy, t1=(q[2]-s[0])*ux+(q[3]-s[1])*uy, нах=Math.min(Ls, Math.max(t0,t1))-Math.max(0, Math.min(t0,t1));
        if(нах<=10 || точка) continue;
        const mx=s[0]+ux*(Math.max(0,Math.min(t0,t1))+нах/2), my=s[1]+uy*(Math.max(0,Math.min(t0,t1))+нах/2);
        if(общ.length && общ.some(id=>{ const n=graph.byId[id]; return n && Math.hypot(n.x-mx, n.y-my)<(n.r||8)+40; })) continue;   // сходятся в общей ноде — ствол
        // наложение у связей с общим концом — общий ствол (шина, слияние у цели): правило 6, не нарушение
        if(общ.length && рас<1) continue;
        м.впритык++; нар.push({вид:рас<1 ? "наложение" : "впритык", x:mx, y:my, l:[A,B]}); } }
    for(let i=0;i<L.length;i++){ const l=L[i], a=graph.byId[l.a], b=graph.byId[l.b], п=П[i];
      // наезд на чужую ноду и проход вплотную
      for(const n of graph.nodes){ if(n.id===l.a || n.id===l.b) continue; const R=routeNodeBox(n);
        let в=false, близ=false; for(const s of О[i]){ if(routeClipT(s[0],s[1],s[2],s[3],R,0)){ в=true; break; } if(routeClipT(s[0],s[1],s[2],s[3],R,6)) близ=true; }
        if(в){ м.нав++; нар.push({вид:"нав", x:n.x, y:n.y, l:[l]}); } else if(близ){ м.уНоды++; нар.push({вид:"уНоды", x:n.x, y:n.y, l:[l]}); } }
      // развороты по ходу связи
      for(let k=1;k<п.length-1;k++){ const e1=[п[k][0]-п[k-1][0], п[k][1]-п[k-1][1]], e2=[п[k+1][0]-п[k][0], п[k+1][1]-п[k][1]], L1=Math.hypot(...e1), L2=Math.hypot(...e2);
        if(L1>3 && L2>3 && (e1[0]*e2[0]+e1[1]*e2[1])/(L1*L2)<-0.5){ м.разв++; нар.push({вид:"разв", x:п[k][0], y:п[k][1], l:[l]}); break; } }
      // назад от цели у концов
      const в=l._рт && l._рт.via, К=п.map(v=>[v[0],v[1]]);
      if(К.length>=2 && !в && !routeNoBack(К, a.r||8, b.r||8)){ м.назад++; нар.push({вид:"назад", x:a.x, y:a.y, l:[l]}); }
      // ноды на одной оси, а связь с коленами
      const пов=повороты(п, a.r||8, b.r||8); м.колен+=пов;
      if(!в && l._рт && (Math.abs(a.x-b.x)<1 || Math.abs(a.y-b.y)<1) && пов>0
        && !graph.nodes.some(n=>n!==a && n!==b && routeClipT(a.x,a.y,b.x,b.y,routeNodeBox(n),2))){ м.прямо++; нар.push({вид:"прямо", x:(a.x+b.x)/2, y:(a.y+b.y)/2, l:[l]}); } }
    неизбежность(м, нар);
    return {м, нар}; }
  /* СВЕРХ НЕИЗБЕЖНЫХ: зонд подбора (_лабЗонд в _routeOptimize) для каждой связи с пересечением или наездом
     находит лучший путь по лабиринту при прочих связях на месте. Пересечение избегаемо, если обойти его
     может хоть одна из двух связей; наезд — если у связи есть путь с меньшим числом наездов. перИзб и
     навИзб — то, что можно было убрать; к нулю стремятся они. У мягкой связи маршрута нет — зонд молчит. */
  function неизбежность(м, нар){
    м.перИзб=0; м.навИзб=0;
    const нужны=new Set(); for(const н of нар) if(н.вид==="пер" || н.вид==="нав") for(const l of н.l) if(l._рт && l._рт.умолч) нужны.add(l);
    if(!нужны.size) return;
    graph._лабЗонд=[...нужны]; graph._оптБюджет=5000; graph._лабЗондИтог=null;
    try{ graph._routeOptimize(); } finally { graph._лабЗонд=null; graph._оптБюджет=0; }
    const з=graph._лабЗондИтог||new Map(), лучше=(l,поле)=>{ const r=з.get(l); return !!(r && r.лаб && r.лаб[поле]<r.сейч[поле]); };
    for(const н of нар){
      if(н.вид==="пер" && н.l.some(l=>лучше(l,"пер"))){ н.изб=true; м.перИзб++; }
      if(н.вид==="нав" && лучше(н.l[0],"нав")){ н.изб=true; м.навИзб++; } } }

  // снимок маршрутов для устойчивости: сиг и вершины
  const снимок=()=>{ const o=new Map(); for(const l of graph.links) o.set(l.a+"|"+l.b, JSON.stringify(путь(l).map(v=>[Math.round(v[0]), Math.round(v[1])]))); return o; };
  /* УСТОЙЧИВОСТЬ (п. 4 задачи): посторонняя правка — сдвиг ноды, переименование, новая нода в стороне.
     «Без причины» — сменили форму связи, которые правка не задела: не её связи и не ближе ЗАДЕЛ к её
     старым и новым путям (и к рамке ноды). Цель — ноль. */
  const ЗАДЕЛ=40;
  function устойчивость(сл, режим, r){
    const итог={сдвиг:0, имя:0, нова:0};
    const рядом=(путиН, ключ)=>{ const п=путь(graph.links.find(l=>l.a+"|"+l.b===ключ)||{a:"",b:""}); for(const q of п) for(const P of путиН) for(const v of P) if(Math.hypot(q[0]-v[0], q[1]-v[1])<ЗАДЕЛ) return true; return false; };
    const ноды=сл.ноды.filter(н=>!н.корень); if(!ноды.length) return итог;
    // 1) сдвиг ноды на 25 px
    { поставить(сл, режим); const до=снимок(), н=ноды[(r()*ноды.length)|0], id="lab_"+н.к;
      const старые=graph.links.filter(l=>l.a===id||l.b===id).map(путь);
      const it=S.items.find(x=>x.id===id); it.x+=25; it.y-=15; graph.byId={}; graph.build();   // без сброса build() оставил бы ноду на живом месте — сдвига не было бы вовсе graph.alpha=0; graph.nodes.forEach(n=>{ n._ix=0; n._iy=0; });
      graph._маршр=null; graph._оптБюджет=5000; graph._routesFresh(); довести(); const после=снимок();
      const новые=graph.links.filter(l=>l.a===id||l.b===id).map(путь), нр=graph.byId[id];
      до.forEach((v,k)=>{ if(после.get(k)===v || k.includes(id)) return; if(рядом(старые.concat(новые, [[[нр.x,нр.y]]]), k)) return; итог.сдвиг++; }); }
    // 2) переименование: подпись длиннее
    { поставить(сл, режим); const до=снимок(), н=ноды[(r()*ноды.length)|0], id="lab_"+н.к;
      const it=S.items.find(x=>x.id===id); it.title=it.title+" — переименована подлиннее"; graph.build(); graph.alpha=0; graph.nodes.forEach(n=>{ n._ix=0; n._iy=0; });
      graph._маршр=null; graph._оптБюджет=5000; graph._routesFresh(); довести(); const после=снимок(), нр=graph.byId[id];
      до.forEach((v,k)=>{ if(после.get(k)===v || k.includes(id)) return; if(рядом([[[нр.x,нр.y],[нр.x-120,нр.y+20],[нр.x+120,нр.y+20]]], k)) return; итог.имя++; }); }
    // 3) новая нода далеко в стороне
    { поставить(сл, режим); const до=снимок(); let mx=-Infinity, my=0; for(const н of сл.ноды){ if(н.x>mx){ mx=н.x; my=н.y; } }
      S.items.unshift({id:"lab_нова", kind:"note", title:"новая", body:"", area:null, status:"todo", due:null, repeat:"none", priority:0, tags:[], created:0, updated:0, done:false, x:mx+600, y:my, pin:false, parent:null, deleted:false, deletedAt:null});
      graph.build(); graph.alpha=0; graph.nodes.forEach(n=>{ n._ix=0; n._iy=0; }); graph._маршр=null; graph._оптБюджет=5000; graph._routesFresh(); довести();
      const после=снимок(); до.forEach((v,k)=>{ if(после.get(k)!==v) итог.нова++; }); }
    return итог; }

  /* ПРОГОН ВСЕГО: по каждому режиму — сумма метрик по случаям и худшие случаи; устойчивость — для режимов
     с маршрутом (у мягкой форма — прогиб, он считается физикой кадра). Возвращает таблицу для сценария. */
  function прогнать(опц){
    опц=опц||{}; открыть();
    const сп=случаи(), итог={}, худшие={}, уст={}, всеХудшие=[];
    try{
      for(const режим of (опц.режимы||РЕЖИМЫ)){ const сум={пер:0, перИзб:0, нав:0, навИзб:0, разв:0, назад:0, прямо:0, впритык:0, уНоды:0, колен:0, связей:0}, по=[];
        сп.forEach((сл, i)=>{ поставить(сл, режим); const {м}=метрики(); for(const k in сум) сум[k]+=м[k]||0;
          // тяжесть — по ИЗБЕГАЕМЫМ пересечениям и наездам: неизбежное от раскладки, а не от маршрута
          const тяж=м.перИзб*10+м.навИзб*8+м.разв*6+м.назад*6+м.прямо*4+м.впритык*2+м.уНоды; if(тяж){ по.push({имя:сл.имя, тяж, м}); if(режим!=="soft") всеХудшие.push({имя:сл.имя, номер:i+1, режим, тяж, м}); } });
        итог[режим]=сум; по.sort((x,y)=>y.тяж-x.тяж); худшие[режим]=по.slice(0,6);
        if(режим!=="soft" && опц.устойчивость!==false){ const у={сдвиг:0, имя:0, нова:0, случаев:0}, r=гсч(424242);
          for(const сл of сп.filter((x,i)=>i%3===0)){ const о=устойчивость(сл, режим, r); у.сдвиг+=о.сдвиг; у.имя+=о.имя; у.нова+=о.нова; у.случаев++; }
          уст[режим]=у; } }
      // замер скорости на большом графе
      const б=большой(), ск={};
      for(const режим of ["ortho","bus","metro"]){ поставить(б, режим); const t0=performance.now(); for(let k=0;k<5;k++) graph._routeBuild(); ск[режим]=(performance.now()-t0)/5; }
      всеХудшие.sort((x,y)=>y.тяж-x.тяж);
      return {итог, худшие, уст, ск, случаев:сп.length, десять:всеХудшие.slice(0,10)};
    } finally { закрыть(); } }

  /* ГАЛЕРЕЯ (?routes-gallery): случаи по одному на настоящем графе. Панель слева сверху — случай, режим,
     счёт нарушений; нарушения — кругами поверх холста (свой слой, идёт за камерой графа). Клавиши: ←/→ —
     случай, 1–5 — режим. Выход — закрыть вкладку: граф лаборатории временный. */
  function галерея(){
    // #12-bus в адресе — сразу к случаю 12 в шине (номера — из строки «10 худших» перебора)
    открыть(); const сп=случаи(); let i=0, режим="ortho", нар=[];
    { const м=/^#(\d+)(?:-([a-z]+))?/.exec(location.hash); if(м){ i=Math.max(0, Math.min(сп.length-1, +м[1]-1)); if(РЕЖИМЫ.includes(м[2])) режим=м[2]; } }
    const пан=document.createElement("div");
    пан.style.cssText="position:fixed;left:12px;top:12px;z-index:99999;background:rgba(14,14,18,.94);color:#f4f4f5;font:12px/1.45 Segoe UI,sans-serif;padding:10px 12px;border-radius:10px;box-shadow:0 0 0 1px rgba(255,255,255,.1);max-width:340px";
    document.body.appendChild(пан);
    const слой=document.createElement("canvas"); слой.style.cssText="position:fixed;pointer-events:none;z-index:99998";
    document.body.appendChild(слой);
    const ЦВ={пер:"#ff4d4d", нав:"#ff9f1a", разв:"#ff4dd2", назад:"#c74dff", прямо:"#4dd2ff", впритык:"#ffe14d", наложение:"#ffe14d", уНоды:"#8f8f8f"};
    function показать(){ const сл=сп[i]; поставить(сл, режим); const р=метрики(); нар=р.нар;
      пан.innerHTML=`<b>Маршруты: ${esc(сл.имя)}</b> · ${i+1}/${сп.length}<br>режим: ${РЕЖИМЫ.map((m,k)=>`<span style="cursor:pointer;${m===режим?"color:#6f9bd8;font-weight:600":""}" data-m="${m}">${k+1} ${m}</span>`).join(" · ")}<br>`+
        Object.entries(р.м).filter(([k])=>k!=="связей").map(([k,v])=>`<span style="color:${ЦВ[k]||"#9a9aa3"}">${k} ${v}</span>`).join(" · ")+
        `<br><span style="color:#7a7a83">← → случай · 1–5 режим · круги — нарушения</span>`;
      пан.querySelectorAll("[data-m]").forEach(s=>s.onclick=()=>{ режим=s.dataset.m; показать(); });
      // камера — на рамку случая
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; for(const n of graph.nodes){ x0=Math.min(x0,n.x); y0=Math.min(y0,n.y); x1=Math.max(x1,n.x); y1=Math.max(y1,n.y); }
      const z=Math.min(1.4, Math.min(graph.W/(x1-x0+200), graph.H/(y1-y0+200))); graph.zoom=z; graph.tx=graph.W/2-(x0+x1)/2*z; graph.ty=graph.H/2-(y0+y1)/2*z;
      graph._applyTransform && graph._applyTransform(); graph._wake(); }
    function кадр(){ const rc=graph.svg.getBoundingClientRect(), dpr=devicePixelRatio||1;
      слой.style.left=rc.left+"px"; слой.style.top=rc.top+"px"; слой.style.width=rc.width+"px"; слой.style.height=rc.height+"px";
      слой.width=rc.width*dpr; слой.height=rc.height*dpr; const c=слой.getContext("2d"); c.setTransform(dpr,0,0,dpr,0,0); c.clearRect(0,0,rc.width,rc.height);
      for(const н of нар){ const x=(н.x*graph.zoom+graph.tx)/graph.W*rc.width, y=(н.y*graph.zoom+graph.ty)/graph.H*rc.height;
        // неизбежное (лабиринт его не обходит) — бледным: смотреть надо на яркие
        const бледно=(н.вид==="пер" || н.вид==="нав") && !н.изб, цв=бледно ? "rgba(200,200,210,.35)" : (ЦВ[н.вид]||"#fff");
        c.strokeStyle=цв; c.lineWidth=бледно ? 1 : 2; c.beginPath(); c.arc(x,y,9,0,Math.PI*2); c.stroke();
        c.fillStyle=цв; c.font="10px Segoe UI"; c.fillText(н.вид+(бледно ? " (неизб.)" : ""), x+11, y-8); }
      requestAnimationFrame(кадр); }
    addEventListener("keydown", e=>{ if(e.key==="ArrowRight"){ i=(i+1)%сп.length; показать(); } else if(e.key==="ArrowLeft"){ i=(i-1+сп.length)%сп.length; показать(); }
      else if(/^[1-5]$/.test(e.key)){ режим=РЕЖИМЫ[+e.key-1]; показать(); } });
    показать(); requestAnimationFrame(кадр); }

  return {РЕЖИМЫ, случаи, большой, поставить, метрики, прогнать, галерея, открыть, закрыть};
})();
