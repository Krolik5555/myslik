# -*- coding: utf-8 -*-
"""Проверялка «Мыслика» — быстрые факты вместо ручной переписки с браузером.

    python tools/dev.py status           состояние: версия, ветка, что не закоммичено
    python tools/dev.py check            быстрый контроль: синтаксис, версии, данные
    python tools/dev.py run              все сценарии из tools/scenarios/
    python tools/dev.py run полотно      один сценарий
    python tools/dev.py map              карта символов (кто где определён)
    python tools/dev.py где картинка     адрес по слову: карта + символы + селекторы стилей
    python tools/dev.py shot [окно|панель]  снимок для визуальных вопросов

Сценарии — обычные JS-файлы в tools/scenarios/. Каждый выполняется ВНУТРИ приложения,
поднятого в дев-режиме (демо-данные), и возвращает список проверок:

    // tools/scenarios/пример.js
    const t = [];
    t.push({имя: "что проверяем", ок: <булево>, факт: "что вышло"});
    return t;

Живой data/planner.json не открывается: дев-режим всегда работает на демо-данных.
"""
import io
import json
import os
import re
import subprocess
import sys
import time

# Консоль Windows по умолчанию в cp1252 — русский вывод падал бы с UnicodeEncodeError.
# Инструмент обязан работать без переменных окружения снаружи.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "ui")
SCEN = os.path.join(ROOT, "tools", "scenarios")

GREEN, RED, DIM, OFF = "\033[92m", "\033[91m", "\033[90m", "\033[0m"
if os.name == "nt":
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleMode(ctypes.windll.kernel32.GetStdHandle(-11), 7)
    except Exception:
        GREEN = RED = DIM = OFF = ""


def _read(path):
    return io.open(os.path.join(ROOT, path), encoding="utf-8").read()


def _git(*args):
    """git с явной кодировкой utf-8: в проекте кириллические имена файлов, и системная cp1252
    роняет разбор вывода. core.quotepath=false — чтобы пути читались, а не выводились кодами."""
    try:
        r = subprocess.run(["git", "-c", "core.quotepath=false"] + list(args), cwd=ROOT,
                           capture_output=True, text=True, encoding="utf-8", errors="replace",
                           timeout=20)
        return (r.stdout or "").strip()
    except Exception:
        return ""


# ---------------------------------------------------------------- check

def _check_versions():
    """Версия обязана совпадать в трёх местах — иначе релиз соберётся с рассинхроном."""
    out = []
    app = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', _read("app.py"))
    html = re.search(r'Мыслик\s+([\d.]+)\s*<span>beta</span>', _read("ui/index.html"))
    txt = re.match(r'Мыслик\s+([\d.]+)\s+beta', _read("packaging/ЧИТАТЬ.txt"))
    vs = {"app.py": app and app.group(1), "index.html": html and html.group(1),
          "ЧИТАТЬ.txt": txt and txt.group(1)}
    same = len(set(v for v in vs.values() if v)) == 1 and all(vs.values())
    out.append(("версия совпадает в трёх местах", same,
                ", ".join("%s=%s" % (k, v) for k, v in vs.items())))
    return out


def _check_assets_version():
    """?v= в index.html должен подниматься при каждой правке фронта, иначе WebView2 отдаст
    старый код и чиниться будет призрак."""
    changed = _git("diff", "--name-only", "HEAD", "--", "ui/js", "ui/styles.css").split()
    idx_changed = _git("diff", "--name-only", "HEAD", "--", "ui/index.html")
    if not changed:
        return [("?v= поднимать не нужно", True, "фронт не менялся с последнего коммита")]
    return [("?v= поднят после правки фронта", bool(idx_changed),
             "изменены: %s" % ", ".join(os.path.basename(c) for c in changed))]


def _check_python():
    out = []
    for f in ("app.py", "ai.py"):
        r = subprocess.run([sys.executable, "-m", "py_compile", os.path.join(ROOT, f)],
                           capture_output=True, text=True)
        out.append(("%s компилируется" % f, r.returncode == 0, (r.stderr or "").strip()[:200]))
    return out


def _check_data():
    """Целостность живого файла — только ЧТЕНИЕ, ничего не пишем."""
    p = os.path.join(ROOT, "data", "planner.json")
    if not os.path.isfile(p):
        return [("data/planner.json на месте", True, "файла нет — чистая установка")]
    try:
        d = json.load(io.open(p, encoding="utf-8"))
    except Exception as e:
        return [("data/planner.json читается", False, repr(e))]
    # Ноды и области живут внутри графов (их несколько). Верхнеуровневые items/areas остались
    # только у старых файлов — читаем оба вида, иначе проверка молча рапортует «0 элементов»
    # о полном файле, и настоящая беда с данными проходит незамеченной.
    graphs = d.get("graphs")
    if isinstance(graphs, list) and graphs:
        parts = [(g.get("name") or "?", g.get("items") or [], g.get("areas") or [], g.get("links") or [])
                 for g in graphs if isinstance(g, dict)]
    else:
        parts = [("(один граф)", d.get("items") or [], d.get("areas") or [], d.get("links") or [])]
    items = [i for _, its, _, _ in parts for i in its]
    links = [l for _, _, _, ls in parts for l in ls]
    areas = [a for _, _, ars, _ in parts for a in ars]
    dangling, bad_parent = [], []
    for _, its, _, ls in parts:
        ids = set(i.get("id") for i in its)          # связи проверяем В ПРЕДЕЛАХ своего графа
        dangling += [l for l in ls if len(l) >= 2
                     and (l[0] not in ids and not str(l[0]).startswith("hub_")
                          or l[1] not in ids and not str(l[1]).startswith("hub_"))]
        bad_parent += [i for i in its if i.get("parent") and i["parent"] not in ids]
    состав = ", ".join("%s: %d" % (n, len(its)) for n, its, _, _ in parts)
    return [
        ("данные читаются", len(items) > 0 or not parts,
         "%d элементов, %d связей, %d областей | графы — %s"
         % (len(items), len(links), len(areas), состав)),
        ("нет висячих связей", not dangling, "%d" % len(dangling)),
        ("нет висячих родителей", not bad_parent, "%d" % len(bad_parent)),
    ]


def _символы_кода():
    """Все имена, определённые во фронте и в питоне, — чтобы сверять с ними карту."""
    имена = set()
    for f in ("core.js", "model.js", "views.js", "graph.js", "overlays.js", "draw.js",
              "fields.js", "ai.js", "report.js", "main.js"):
        s = _read("ui/js/" + f)
        for a, b, c in re.findall(r'^(?:async\s+)?function\s+([A-Za-zА-Яа-я_$][\w$]*)'
                                  r'|^\s*class\s+([A-Za-z_$][\w$]*)'
                                  r'|^(?:const|let|var)\s+([A-Za-zА-Яа-я_$][\w$]*)\s*=', s, re.M):
            имена.add(a or b or c)
        # методы класса и объявления внутри функций карта тоже цитирует (_tick, _hover, build)
        for m in re.findall(r'^\s{2,}(?:async\s+)?([A-Za-zА-Яа-я_$][\w$]*)\s*\([^)]*\)\s*\{', s, re.M):
            имена.add(m)
        # объявления внутри функций, включая множественные: const ореолы=[], навед=[]
        for стр in re.findall(r'^\s+(?:const|let)\s+(.+)$', s, re.M):
            for m in re.findall(r'([A-Za-zА-Яа-я_$][\w$]*)\s*=', стр):
                имена.add(m)
        # свойства-функции в объектах настроек (onLinkOpen: …) — карта их тоже цитирует
        for m in re.findall(r'([A-Za-zА-Яа-я_$][\w$]*)\s*:\s*(?:function|async|\()', s):
            имена.add(m)
        # поля объекта: карта цитирует и их (this._glCache, this.drag)
        for m in re.findall(r'this\.([A-Za-zА-Яа-я_$][\w$]*)\s*=', s):
            имена.add(m)
    for f in ("app.py", "ai.py"):
        s = _read(f)
        for a, b in re.findall(r'^(?:class|def)\s+(\w+)|^\s+def\s+(\w+)', s, re.M):
            имена.add(a or b)
        # константы модуля (_REPORT_INSTRUCT и подобные) — карта на них ссылается
        for m in re.findall(r'^([A-Za-z_][\w]*)\s*=', s, re.M):
            имена.add(m)
    return имена


# Слова в обратных кавычках, которые НЕ являются символами кода: ключи данных, значения
# настроек, названия файлов и команд. Проверять их бессмысленно — карта описывает ими формат.
КАРТА_НЕ_СИМВОЛЫ = {
    "v", "id", "kind", "task", "note", "flow", "title", "body", "area", "status", "due", "repeat",
    "priority", "tags", "created", "updated", "done", "x", "y", "pin", "parent", "color", "type",
    "name", "value", "media", "gw", "gh", "br", "st", "gwm", "off", "nofit", "text", "image",
    "board", "elements", "files", "appState", "fromFlow", "fields", "items", "areas", "links",
    "boards", "settings", "templates", "template", "prose", "list", "available", "reason",
    "inbound", "outbound", "map", "check", "run", "status", "где", "shot", "python", "main",
    "hub_", "fld_", "arealen", "lenMul", "restLen", "max", "parse_partial",
    # инструменты, которыми работают, а не код проекта
    "Edit", "Grep", "Read", "search_graph", "trace_path", "get_code_snippet", "get_architecture",
    "check_index_coverage", "index_status", "index_repository", "detect_changes", "codebase-memory",
}
# не селекторы, хотя выглядят как они: расширения файлов и служебные суффиксы
КАРТА_НЕ_СЕЛЕКТОРЫ = {".part", ".js", ".py", ".css", ".md", ".ps1", ".json"}


def _check_карта():
    """Карта обязана совпадать с кодом: иначе она молча превращается во вредный справочник.

    Проверяем три вещи, которые устаревают первыми: упомянутые файлы существуют, упомянутые
    символы определены, упомянутые селекторы встречаются в стилях.
    """
    карта = _read("docs/КАРТА.md")
    if not карта:
        return [("карта кода на месте", False, "docs/КАРТА.md не читается")]
    токены = re.findall(r'`([^`\n]+)`', карта)
    символы = _символы_кода()
    css = _read("ui/styles.css")

    нет_файлов, нет_символов, нет_селекторов = [], [], []
    проверено = 0
    for t in токены:
        t = t.strip()
        # файл или путь. Карта называет модули коротко («main.js»), поэтому ищем и по
        # обычным каталогам проекта, а не только от корня
        if re.match(r'^[\w./-]+\.(js|py|css|html|json|md)$', t) or (t.count("/") and re.match(r'^[\w./-]+$', t)):
            проверено += 1
            где = ["", "ui/js/", "ui/", "tools/", "tools/scenarios/", "docs/"]
            if not any(os.path.exists(os.path.join(ROOT, п + t)) for п in где):
                нет_файлов.append(t)
            continue
        # селектор стилей
        if re.match(r'^[.#][\w-]+$', t):
            if t in КАРТА_НЕ_СЕЛЕКТОРЫ:
                continue
            проверено += 1
            if t.rstrip("*") not in css:
                нет_селекторов.append(t)
            continue
        # имя символа (в карте они бывают через слэш: fieldsLayout/fieldsFromLayout)
        for часть in t.split("/"):
            часть = часть.strip().rstrip("()")
            if not re.match(r'^[A-Za-zА-Яа-я_$][\w$]*$', часть):
                continue
            if часть in КАРТА_НЕ_СИМВОЛЫ:
                continue
            проверено += 1
            if часть not in символы:
                нет_символов.append(часть)

    плохо = нет_файлов + нет_селекторов + sorted(set(нет_символов))
    факт = ("проверено %d упоминаний" % проверено) if not плохо else \
           ("не найдено: " + ", ".join(плохо[:8]) + (" …" if len(плохо) > 8 else ""))
    return [("карта кода не разошлась с кодом", not плохо, факт)]


def cmd_check():
    rows = []
    rows += _check_versions()
    rows += _check_assets_version()
    rows += _check_python()
    rows += _check_карта()
    rows += _check_data()
    # синтаксис фронта — внутри приложения (нужен движок), отдельным сценарием
    js = run_scenarios(["модули"], quiet=True)
    rows += js
    return _report("check", rows)


# ---------------------------------------------------------------- run

BOOT_WAIT = 25          # сколько ждём, пока приложение поднимется
SCEN_WAIT = 60          # потолок на один сценарий


def _scenario_files(names):
    if not os.path.isdir(SCEN):
        return []
    files = sorted(f for f in os.listdir(SCEN) if f.endswith(".js"))
    if names:
        want = [n if n.endswith(".js") else n + ".js" for n in names]
        files = [f for f in files if f in want]
    return [os.path.join(SCEN, f) for f in files]


def _serve_ui():
    """Отдаёт ui/ по localhost на свободном порту. Возвращает порт."""
    import http.server
    import socketserver
    import threading

    class Тихий(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=UI, **kw)

        def log_message(self, *a):
            pass                    # без шума в отчёте

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Тихий)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def run_scenarios(names=None, quiet=False):
    """Поднимает приложение в дев-режиме и выполняет сценарии внутри него.

    Окно уводится за пределы экрана, а не прячется: скрытое окно WebView2 не рисует кадры,
    и всё, что завязано на requestAnimationFrame (граф, стрелки полотна), не отрабатывает.
    """
    files = _scenario_files(names)
    if not files:
        return [("сценарии найдены", False, "нет файлов в tools/scenarios/")]

    import webview

    results = []
    state = {"done": False}

    def worker(window):
        try:
            # ждём, пока приложение соберётся: демо-данные на месте и вид отрисован
            deadline = time.time() + BOOT_WAIT
            ready = False
            while time.time() < deadline:
                try:
                    ready = window.evaluate_js(
                        "typeof S!=='undefined' && S.items && S.items.length>0"
                        " && !!document.querySelector('#view')"
                        " && typeof openNoteReader==='function'"      # overlays.js
                        " && typeof openBoard==='function'"           # draw.js — доска полотна
                        " && typeof repOpen==='function'"             # report.js — отчёт в правой панели
                        " && typeof boot==='function'")               # main.js — последний в списке
                except Exception:
                    ready = False
                if ready:
                    break
                time.sleep(0.25)
            if not ready:
                results.append(("приложение поднялось", False, "не дождались за %d с" % BOOT_WAIT))
                return

            for path in files:
                name = os.path.splitext(os.path.basename(path))[0]
                code = io.open(path, encoding="utf-8").read()
                wrapped = (
                    "window.__r=null;window.__d=false;"
                    "(async()=>{" + code + "})()"
                    ".then(v=>{window.__r=v;window.__d=true;})"
                    ".catch(e=>{window.__r=[{имя:'сценарий выполнился',ок:false,факт:String(e&&e.message||e)}];window.__d=true;});"
                )
                try:
                    window.evaluate_js(wrapped)
                except Exception as e:
                    results.append((name + ": запуск", False, repr(e)))
                    continue
                end = time.time() + SCEN_WAIT
                got = None
                while time.time() < end:
                    try:
                        if window.evaluate_js("window.__d===true"):
                            got = window.evaluate_js("JSON.stringify(window.__r)")
                            break
                    except Exception:
                        pass
                    time.sleep(0.2)
                if got is None:
                    results.append((name + ": завершился", False, "таймаут %d с" % SCEN_WAIT))
                    continue
                try:
                    for row in (json.loads(got) or []):
                        results.append((name + ": " + str(row.get("имя", "?")),
                                        bool(row.get("ок")), str(row.get("факт", ""))))
                except Exception as e:
                    results.append((name + ": разбор ответа", False, repr(e)))
        finally:
            state["done"] = True
            try:
                window.destroy()
            except Exception:
                pass

    # Грузим через локальный http, а не file://: query-строка на файловом пути ломает pywebview
    # (он поднимает собственный сервер и промахивается мимо корня), а ?dev нам обязателен —
    # именно он включает демо-данные и не даёт тронуть живой planner.json.
    port = _serve_ui()
    url = "http://127.0.0.1:%d/index.html?dev&v=%d" % (port, int(time.time()))
    win = webview.create_window("Мыслик — проверка", url=url, width=1280, height=800,
                                x=-3000, y=-3000)   # за пределами экрана: кадры идут, глаза не мозолит
    webview.start(worker, win, gui="edgechromium")
    if not results:
        results.append(("проверка выполнилась", False, "приложение закрылось раньше времени"))
    return results if quiet else _report("run", results) or results


# ---------------------------------------------------------------- map

def cmd_map():
    out = []
    for f in ("core.js", "model.js", "views.js", "graph.js", "overlays.js", "draw.js", "fields.js",
              "ai.js", "report.js", "main.js"):
        s = _read("ui/js/" + f)
        top = re.findall(r'^(?:async\s+)?function\s+([A-Za-zА-Яа-я_$][\w$]*)|^class\s+([A-Za-z_$][\w$]*)'
                         r'|^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=', s, re.M)
        names = [a or b or c for a, b, c in top]
        out.append("== %-13s %3d КБ, символов %d" % (f, len(s) // 1024, len(names)))
        out.append("   " + ", ".join(names))
    for f in ("app.py", "ai.py"):
        s = _read(f)
        names = re.findall(r'^(?:class|def)\s+(\w+)|^    def\s+(\w+)', s, re.M)
        names = [a or b for a, b in names]
        out.append("== %-13s %3d КБ, символов %d" % (f, len(s) // 1024, len(names)))
        out.append("   " + ", ".join(names))
    print("\n".join(out))
    return 0


# ---------------------------------------------------------------- где

def cmd_где(слово=None):
    """Адрес по слову: строки карты, символы кода и селекторы стилей.

    Первый ход по любой задаче: запрос звучит как «календарь всрато», а не именем функции, и
    отсюда за один прогон видно, в какой файл идти. Читать код целиком после этого не нужно.
    """
    if not слово:
        print("нужно слово: python tools/dev.py где картинка")
        return 1
    igl = слово.lower()
    печатали = False

    карта = _read("docs/КАРТА.md")
    строки = [(n, s.strip()) for n, s in enumerate(карта.splitlines(), 1) if igl in s.lower()]
    if строки:
        печатали = True
        print("\ndocs/КАРТА.md")
        for n, s in строки[:12]:
            print("  %-5d %s" % (n, s[:150]))

    # символы кода: где определено имя, содержащее слово
    JS = ("core.js", "model.js", "views.js", "graph.js", "overlays.js", "draw.js", "fields.js",
          "ai.js", "report.js", "main.js")
    найдено = []
    for f in JS:
        s = _read("ui/js/" + f)
        for m in re.finditer(r'^(?:async\s+)?function\s+([A-Za-zА-Яа-я_$][\w$]*)'
                             r'|^class\s+([A-Za-z_$][\w$]*)'
                             r'|^(?:const|let)\s+([A-Za-zА-Яа-я_$][\w$]*)\s*=', s, re.M):
            имя = m.group(1) or m.group(2) or m.group(3)
            if igl in имя.lower():
                найдено.append((f, имя, s[:m.start()].count("\n") + 1))
    if найдено:
        печатали = True
        print("\nсимволы кода")
        for f, имя, n in найдено[:20]:
            print("  ui/js/%-12s %-28s строка %d" % (f, имя, n))

    # селекторы стилей: правила, в чьём селекторе есть слово
    css = _read("ui/styles.css")
    сел = []
    for n, s in enumerate(css.splitlines(), 1):
        s = s.strip()
        if not s or s.startswith(("/*", "*", "--")) or "{" not in s:
            continue
        селектор = s.split("{", 1)[0].strip()
        if igl in селектор.lower():
            сел.append((n, селектор))
    if сел:
        печатали = True
        print("\nстили")
        for n, s in сел[:20]:
            print("  styles.css:%-5d %s" % (n, s[:120]))

    if not печатали:
        print("«%s» не встречается ни в карте, ни в именах символов, ни в селекторах." % слово)
        print("Значит это текст интерфейса или комментарий — искать Grep'ом по ui/.")
    return 0


# ---------------------------------------------------------------- shot

def cmd_shot(what="панель"):
    """Снимок для визуальных вопросов: дешевле любых рассуждений о том, что видно глазами."""
    from PIL import ImageGrab
    import win32gui
    dst = os.path.join(ROOT, "build", "shot_%s.png" % what)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if what == "панель":
        h = win32gui.FindWindow("Shell_TrayWnd", None)
    else:
        h = win32gui.FindWindow(None, "Мыслик")
    if not h:
        print("окно не найдено:", what)
        return 1
    ImageGrab.grab(bbox=win32gui.GetWindowRect(h), all_screens=True).save(dst)
    print("снимок:", dst)
    return 0


# ---------------------------------------------------------------- вывод

def _report(title, rows):
    bad = [r for r in rows if not r[1]]
    print("\n%s: проверок %d, не прошло %d" % (title, len(rows), len(bad)))
    for name, ok, fact in rows:
        mark = (GREEN + "  ok  " + OFF) if ok else (RED + " ПЛОХО" + OFF)
        print("%s %s%s" % (mark, name, (DIM + "  — " + fact + OFF) if fact else ""))
    return 1 if bad else 0


def cmd_status():
    """Состояние проекта одной командой — чтобы не выяснять его расспросами в начале работы."""
    sh = lambda *a: _git(*a[1:])          # a[0] — само слово "git", оно уже внутри _git
    ver = re.search(r'APP_VERSION\s*=\s*"([^"]+)"', _read("app.py"))
    asset = re.search(r'\?v=(\d+)', _read("ui/index.html"))
    ветка = sh("git", "rev-parse", "--abbrev-ref", "HEAD")
    незапушено = [l for l in sh("git", "log", "--oneline", "origin/%s..HEAD" % ветка).split("\n") if l]
    грязно = [l for l in sh("git", "status", "--porcelain").split("\n") if l]
    тег = sh("git", "describe", "--tags", "--abbrev=0")
    print("версия      : %s   (ассеты ?v=%s)" % (ver and ver.group(1), asset and asset.group(1)))
    print("ветка       : %s" % ветка)
    print("последний тег: %s" % (тег or "нет"))
    print("не запушено : %d коммит(ов)%s" % (len(незапушено),
          ("\n   " + "\n   ".join(незапушено[:8])) if незапушено else ""))
    print("не закоммичено: %d файл(ов)%s" % (len(грязно),
          ("\n   " + "\n   ".join(грязно[:8])) if грязно else ""))
    сцен = [os.path.splitext(f)[0] for f in sorted(os.listdir(SCEN))] if os.path.isdir(SCEN) else []
    print("сценарии    : %s" % ", ".join(сцен))
    return 0


def main(argv):
    cmd = (argv[1] if len(argv) > 1 else "check").lower()
    if cmd == "status":
        return cmd_status()
    if cmd == "check":
        return cmd_check()
    if cmd == "run":
        rows = run_scenarios(argv[2:], quiet=True)
        return _report("run", rows)
    if cmd == "map":
        return cmd_map()
    if cmd in ("где", "where"):
        return cmd_где(argv[2] if len(argv) > 2 else None)
    if cmd == "shot":
        return cmd_shot(argv[2] if len(argv) > 2 else "панель")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
