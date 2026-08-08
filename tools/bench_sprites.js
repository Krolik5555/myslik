/* СПРАЙТЫ ПРОТИВ ПУТЕЙ: одни и те же ноды живого графа, нарисованные разными способами.
   Запускается из tools/bench_gpu.py --спрайты. Рисуем в НАСТОЯЩИЙ холст графа (он ускорен
   видеокартой ровно так же, как в работе), после замера граф перерисует себя сам.

   Каждый способ гоняется тугим циклом и в конце СИНХРОНИЗИРУЕТСЯ с видеокартой (чтение пикселя
   или gl.finish): вызовы холста только ставят команды в очередь, без синхронизации замер показал
   бы скорость записи в очередь, а не отрисовки. */
const ж = (мс) => new Promise(r => setTimeout(r, мс));

const raw = await (await fetch("bench-data.json", {cache: "no-store"})).json();
S = sanitizeState(Object.assign(defaultState(), raw));
undoInit(); applySettings();
view = "notes"; render();
await ж(900);
const бол = S.graphs.slice().sort((a, b) => (b.items || []).length - (a.items || []).length)[0];
if (S.settings.graph !== бол.id) { graphSwitch(бол.id); render(); await ж(1200); }
graph._fitView();
await ж(400);

const ctx = graph.mainCtx, cv = graph.mainCanvas;
const W = graph.W, H = graph.H;
const пал = graph._палитра();

/* ---- то, что рисуем: реальные ноды в экранных координатах текущей камеры ---- */
function собрать() {
  const сп = [];
  for (const n of graph.nodes) {
    const x = n.x * graph.zoom + graph.tx, y = n.y * graph.zoom + graph.ty;
    const r = Math.max(2, n.r * graph.zoom);
    if (x + r < -40 || x - r > W + 40 || y + r < -40 || y - r > H + 40) continue;
    сп.push({x, y, r, форма: graph._форма(n), цвет: n.color || пал.узел,
             зал: n.done ? (n.color || пал.узел) : пал.фонУзла,
             подпись: (n.label || "").slice(0, 22)});
  }
  return сп;
}
const УЗЛЫ = собрать();
// подписи — как в бою: не больше 200 самых крупных
const ПОДПИСИ = УЗЛЫ.slice().sort((a, b) => b.r - a.r).slice(0, 200).filter(n => n.подпись);

const ключ = (n) => n.форма + "|" + n.зал + "|" + n.цвет;
const СТИЛИ = [...new Set(УЗЛЫ.map(ключ))];

/* ---- 1. КАК СЕЙЧАС: пути пакетами по стилю (один fill+stroke на пакет) ---- */
function путями() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  const гр = new Map();
  for (const n of УЗЛЫ) { const k = ключ(n); let g = гр.get(k); if (!g) { g = {n, точки: []}; гр.set(k, g); } g.точки.push(n); }
  let вызовов = 0;
  гр.forEach(g => {
    ctx.fillStyle = g.n.зал; ctx.strokeStyle = g.n.цвет; ctx.lineWidth = 1.7;
    ctx.beginPath();
    for (const n of g.точки) graph._путьФормы(ctx, n.форма, n.x, n.y, n.r);
    ctx.fill(); ctx.stroke(); вызовов += 2;
  });
  return вызовов;
}

/* ---- 2. СПРАЙТЫ: заранее нарисованные картинки, по одной drawImage на ноду ----
   Две честных разновидности:
     «свой размер» — атлас по корзинам радиуса (резкость как у путей, но атлас надо
                      пересобирать при каждом изменении зума);
     «масштаб»     — один спрайт на стиль, растягивается при выводе (пересобирать не надо,
                      но при увеличении мылит). */
const АТЛАС = new Map();     // ключ стиля + корзина радиуса → готовый холст
function спрайт(n, корзина) {
  const r = корзина, к = ключ(n) + "|" + r;
  let s = АТЛАС.get(к);
  if (s) return s;
  const пад = 4, размер = Math.ceil((r + пад) * 2);
  s = document.createElement("canvas"); s.width = размер; s.height = размер;
  const c = s.getContext("2d");
  c.fillStyle = n.зал; c.strokeStyle = n.цвет; c.lineWidth = 1.7;
  c.beginPath(); graph._путьФормы(c, n.форма, размер / 2, размер / 2, r);
  c.fill(); c.stroke();
  АТЛАС.set(к, s);
  return s;
}
const КОРЗИНА = (r) => Math.max(2, Math.round(r));
function спрайтами(масштабом) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  let вызовов = 0;
  for (const n of УЗЛЫ) {
    if (масштабом) {
      const s = спрайт(n, 32), к = (n.r + 4) * 2 / s.width;
      ctx.drawImage(s, n.x - s.width * к / 2, n.y - s.height * к / 2, s.width * к, s.height * к);
    } else {
      const s = спрайт(n, КОРЗИНА(n.r));
      ctx.drawImage(s, n.x - s.width / 2, n.y - s.height / 2);
    }
    вызовов++;
  }
  return вызовов;
}

/* ---- 3. WEBGL: все ноды ОДНИМ вызовом (то, чем уже рисуется звёздный фон) ---- */
let ГЛ = null;
function глПодготовить() {
  const c = document.createElement("canvas");
  c.width = cv.width; c.height = cv.height;
  const gl = c.getContext("webgl", {alpha: true, antialias: false, depth: false});
  if (!gl) return null;
  // ИМЕНА В ШЕЙДЕРАХ ТОЛЬКО ЛАТИНИЦЕЙ: GLSL кириллицу не принимает, и программа молча не линкуется
  const вш = `attribute vec2 pos; attribute float rad; attribute vec3 col; varying vec3 vcol;
    uniform vec2 screen;
    void main(){ vcol=col; gl_PointSize=rad*2.0;
      gl_Position=vec4((pos/screen)*2.0-1.0, 0.0, 1.0); }`;
  const фш = `precision mediump float; varying vec3 vcol;
    void main(){ vec2 d=gl_PointCoord-vec2(0.5); float r=length(d);
      if(r>0.5) discard;
      float e=smoothstep(0.42,0.5,r);
      gl_FragColor=vec4(mix(vcol*0.35, vcol, e), 1.0); }`;
  const комп = (тип, ист) => { const s = gl.createShader(тип); gl.shaderSource(s, ист); gl.compileShader(s); return s; };
  const п = gl.createProgram();
  gl.attachShader(п, комп(gl.VERTEX_SHADER, вш)); gl.attachShader(п, комп(gl.FRAGMENT_SHADER, фш));
  gl.linkProgram(п); gl.useProgram(п);
  if (!gl.getProgramParameter(п, gl.LINK_STATUS)) return null;
  const дан = new Float32Array(УЗЛЫ.length * 6);
  УЗЛЫ.forEach((n, i) => {
    const ц = n.цвет.length >= 7 ? [parseInt(n.цвет.slice(1, 3), 16) / 255, parseInt(n.цвет.slice(3, 5), 16) / 255,
                                    parseInt(n.цвет.slice(5, 7), 16) / 255] : [0.6, 0.7, 0.9];
    дан.set([n.x, cv.height - n.y, n.r, ц[0], ц[1], ц[2]], i * 6);
  });
  const буф = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, буф); gl.bufferData(gl.ARRAY_BUFFER, дан, gl.STATIC_DRAW);
  const ат = (имя, к, сдв) => { const l = gl.getAttribLocation(п, имя); gl.enableVertexAttribArray(l);
                                gl.vertexAttribPointer(l, к, gl.FLOAT, false, 24, сдв); };
  ат("pos", 2, 0); ат("rad", 1, 8); ат("col", 3, 12);
  gl.uniform2f(gl.getUniformLocation(п, "screen"), cv.width, cv.height);
  gl.viewport(0, 0, cv.width, cv.height);
  return {gl, n: УЗЛЫ.length};
}
function веб() {
  const g = ГЛ.gl;
  g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.POINTS, 0, ГЛ.n);
  return 1;
}

/* ---- 4. ПОДПИСИ: живой текст против готовых картинок ---- */
function подписямиТекстом() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  // как в бою: 12px system-ui и подложка тенью (shadowBlur=4), иначе подпись теряется на связи
  ctx.font = "12px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = "center"; ctx.fillStyle = пал.текст;
  ctx.shadowColor = пал.фон; ctx.shadowBlur = 4;
  let в = 0;
  for (const n of ПОДПИСИ) { ctx.fillText(n.подпись, n.x, n.y + n.r + 12); в++; }
  ctx.shadowBlur = 0;
  return в;
}
const АТЛАСТ = new Map();
function подписьСпрайт(n) {
  let s = АТЛАСТ.get(n.подпись);
  if (s) return s;
  const и = document.createElement("canvas");
  const c = и.getContext("2d");
  const шрифт = "12px system-ui, -apple-system, Segoe UI, sans-serif";
  c.font = шрифт;
  и.width = Math.ceil(c.measureText(n.подпись).width) + 8; и.height = 20;
  const c2 = и.getContext("2d");
  c2.font = шрифт; c2.fillStyle = пал.текст; c2.textBaseline = "top";
  c2.shadowColor = пал.фон; c2.shadowBlur = 4;   // подложку печём В КАРТИНКУ, один раз
  c2.fillText(n.подпись, 4, 3);
  АТЛАСТ.set(n.подпись, и);
  return и;
}
function подписямиКартинками() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  let в = 0;
  for (const n of ПОДПИСИ) { const s = подписьСпрайт(n); ctx.drawImage(s, n.x - s.width / 2, n.y + n.r + 6); в++; }
  return в;
}

/* ---- 5. ВЕСЬ ГРАФ ОДНОЙ КАРТИНКОЙ. Идея в сильнейшем виде: пока крутят колесо, мировая
   геометрия не меняется — меняется только камера. Значит можно нарисовать граф ОДИН раз в
   отдельный холст и на время жеста просто выводить его с масштабом, а честно перерисовать,
   когда жест кончился. Цена кадра — один drawImage вместо двух тысяч операций. ---- */
const СНИМОК = document.createElement("canvas");
СНИМОК.width = cv.width; СНИМОК.height = cv.height;
function снятьСнимок() {
  const c = СНИМОК.getContext("2d");
  c.clearRect(0, 0, СНИМОК.width, СНИМОК.height);
  graph._drawMain();                       // настоящий кадр графа целиком
  c.drawImage(cv, 0, 0);
}
let фаза = 0;
function картинкой() {
  фаза += 0.01;
  const к = 1 + Math.sin(фаза) * 0.3;      // зум «туда-сюда», как колесом
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(СНИМОК, (cv.width - cv.width * к) / 2, (cv.height - cv.height * к) / 2,
                cv.width * к, cv.height * к);
  return 1;
}

/* ---- прогон ---- */
function синхр(веблиJI) {
  try { if (веблиJI && ГЛ) ГЛ.gl.finish(); else ctx.getImageData(0, 0, 1, 1); } catch (e) {}
}
async function замер(имя, f, мс, вебли) {
  f();                                  // прогрев: первый проход строит атласы и шейдеры
  синхр(вебли);
  await ж(60);
  const t0 = performance.now(); let n = 0, вызовов = 0;
  while (performance.now() - t0 < (мс || 1500)) { вызовов = f(); n++; }
  синхр(вебли);
  const dt = performance.now() - t0;
  await ж(60);
  return {способ: имя, проходов: n, мс: +(dt / n).toFixed(3), вСек: Math.round(n / (dt / 1000)),
          вызовов: вызовов};
}

const РЕЗ = [];
РЕЗ.push({способ: "— узлов в кадре: " + УЗЛЫ.length + ", стилей: " + СТИЛИ.length
                  + ", подписей: " + ПОДПИСИ.length + ", холст " + cv.width + "x" + cv.height});
РЕЗ.push(await замер("узлы: пути пакетами (как сейчас)", путями, 1500));
РЕЗ.push(await замер("узлы: спрайт своего размера", () => спрайтами(false), 1500));
РЕЗ.push(await замер("узлы: один спрайт с масштабом", () => спрайтами(true), 1500));
ГЛ = глПодготовить();
if (ГЛ) РЕЗ.push(await замер("узлы: WebGL, все одним вызовом", веб, 1500, true));
else РЕЗ.push({способ: "узлы: WebGL — контекст не создался", проходов: 0, мс: 0, вСек: 0, вызовов: 0});
РЕЗ.push(await замер("подписи: fillText (как сейчас)", подписямиТекстом, 1500));
РЕЗ.push(await замер("подписи: готовые картинки", подписямиКартинками, 1500));
РЕЗ.push(await замер("ВЕСЬ кадр графа честно (_drawMain)", () => { graph._drawMain(); return 1; }, 1500));
снятьСнимок();
РЕЗ.push(await замер("ВЕСЬ граф одной картинкой при зуме", картинкой, 1500));
РЕЗ.push({способ: "— спрайтов в атласе узлов: " + АТЛАС.size + ", в атласе подписей: " + АТЛАСТ.size});

graph._wake();
return JSON.stringify(РЕЗ);
