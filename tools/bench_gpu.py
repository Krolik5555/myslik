# -*- coding: utf-8 -*-
"""Замер НАГРУЗКИ НА МАШИНУ при работе графа: видеокарта и процессор, а не время JS.

    .venv\\Scripts\\python.exe tools/bench_gpu.py            основные режимы (покой, зум, слои, пан)
    .venv\\Scripts\\python.exe tools/bench_gpu.py --итог      A/B: с потолком кадров и без, три повтора
    .venv\\Scripts\\python.exe tools/bench_gpu.py --статьи    из чего состоит кадр (градиенты, подписи, узлы, связи)
    .venv\\Scripts\\python.exe tools/bench_gpu.py --микро     цена одного вызова _drawMain/_drawGlow/_drawBgGL

ЗАЧЕМ ОТДЕЛЬНЫЙ СТЕНД. Счётчик кадров (Ctrl+Shift+F) и tools/bench_graph.py меряют ТОЛЬКО JS:
вызовы холста и WebGL лишь ставят команды в очередь видеокарты, и «кадр 0.9 мс» показывается,
пока карта разогнана до 2 ГГц. Здесь берутся счётчики Windows «\\GPU Engine(pid_*)\\Utilization
Percentage» по процессам НАШЕГО дерева плюс nvidia-smi (частота и ватты).

ЧИТАТЬ КОЛОНКИ ПРАВИЛЬНО. «GPU%» (он же процент в диспетчере задач) — это ВРЕМЯ занятости, а не
работа: на редких кадрах видеокарта не разгоняется, каждый кадр тянется дольше, и процент почти
не меняется, хотя ватт втрое меньше. Судить о нагрузке надо по «Вт» и «МГц».

Живой data/planner.json только ЧИТАЕТСЯ: копия отдаётся http-сервером как bench-data.json,
приложение поднимается в дев-режиме (запись уходит в localStorage, не в файл).
"""
import argparse
import io
import json
import os
import re
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UI = os.path.join(ROOT, "ui")
DATA = os.path.join(ROOT, "data", "planner.json")
JS = os.path.join(ROOT, "tools", "bench_gpu.js")
ЛОГ = os.path.join(ROOT, "build", "bench-gpu-счётчики.csv")
НВ = os.path.join(ROOT, "build", "bench-gpu-карта.csv")

ЯДЕР = os.cpu_count() or 8
ФАЗА_С = 8.0
ОСЕСТЬ_С = 1.5


def _serve(данные):
    import http.server
    import socketserver
    import threading

    class Тихий(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=UI, **kw)

        def do_GET(self):
            if self.path.split("?")[0].endswith("bench-data.json"):
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(данные)))
                self.end_headers()
                self.wfile.write(данные)
                return
            return super().do_GET()

        def log_message(self, *a):
            pass

    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), Тихий)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


def _ps(команда, timeout=60):
    p = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", команда],
                       capture_output=True, timeout=timeout)
    return p.stdout.decode("utf-8", "replace")


def _дерево(корень):
    """pid'ы всего дерева процессов: питон, окно WebView2 и все его дети (GPU-процесс в том числе).
       Считать по имени msedgewebview2 нельзя: у КРОЛИКА параллельно живут чужие WebView2."""
    out = _ps("Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId);$($_.ParentProcessId);$($_.Name)\" }")
    род, имя = {}, {}
    for s in out.splitlines():
        c = s.strip().split(";")
        if len(c) < 3 or not c[0].isdigit():
            continue
        род[int(c[0])] = int(c[1]) if c[1].isdigit() else 0
        имя[int(c[0])] = c[2]
    свои = {корень}
    for _ in range(6):
        новые = {p for p, r in род.items() if r in свои} - свои
        if not новые:
            break
        свои |= новые
    return sorted(свои), имя


def старт_логгера(pids):
    """Фоновый PowerShell: каждые ~120 мс строка «мс,gpu%,cpu_сек,по движкам».
       Счётчик спрашиваем ТОЧЕЧНО по нашим pid: перечисление всех инстансов стоит 2.3 с."""
    сп = ",".join(str(p) for p in pids)
    код = (
        "$pids=@(%s);"
        "$paths=$pids | ForEach-Object { \"\\GPU Engine(pid_$($_)*)\\Utilization Percentage\" };"
        "$sw=New-Object IO.StreamWriter('%s',$false);"
        "while($true){"
        " $t=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();"
        " $g=0.0; $b=@{};"
        " try{ $s=(Get-Counter $paths -EA SilentlyContinue).CounterSamples;"
        "   foreach($x in $s){ $g += $x.CookedValue;"
        "     $k=($x.InstanceName -split 'engtype_')[-1];"
        "     if($b.ContainsKey($k)){$b[$k]+=$x.CookedValue}else{$b[$k]=$x.CookedValue} } }catch{}"
        " $c=0.0; try{ $c=(Get-Process -Id $pids -EA SilentlyContinue | Measure-Object CPU -Sum).Sum }catch{}"
        " $bs=(($b.GetEnumerator() | ForEach-Object { \"$($_.Key)=$([math]::Round($_.Value,1))\" }) -join '|');"
        " $sw.WriteLine(\"$t,$([math]::Round($g,2)),$c,$bs\"); $sw.Flush();"
        " Start-Sleep -Milliseconds 120 }"
    ) % (сп, ЛОГ.replace("\\", "\\\\"))
    return subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", код],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def старт_нвидиа():
    """Вторая колонка правды: загрузка, частота и ватты всей видеокарты."""
    код = ("$sw=New-Object IO.StreamWriter('%s',$false);"
           "while($true){"
           " $t=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();"
           " $v=(& nvidia-smi --query-gpu=utilization.gpu,clocks.current.sm,power.draw"
           " --format=csv,noheader,nounits) -join ' ';"
           " $sw.WriteLine(\"$t;$v\"); $sw.Flush(); Start-Sleep -Milliseconds 400 }"
           ) % НВ.replace("\\", "\\\\")
    return subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-Command", код],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def _читать(путь, разд):
    строки = []
    try:
        for s in io.open(путь, encoding="utf-8", errors="replace"):
            c = s.strip().split(разд)
            if len(c) < 2 or not c[0].isdigit():
                continue
            строки.append((int(c[0]) / 1000.0, c[1:]))
    except OSError:
        pass
    return строки


def свод(t0, t1):
    окно = []
    for мс, c in _читать(ЛОГ, ","):
        if t0 <= мс <= t1:
            try:
                окно.append((мс, float(c[0].replace(",", ".")), float((c[1] or "0").replace(",", "."))))
            except ValueError:
                pass
    if len(окно) < 2:
        return None
    g = [x[1] for x in окно]
    cpu = (окно[-1][2] - окно[0][2]) / max(0.001, окно[-1][0] - окно[0][0]) / ЯДЕР * 100.0
    return {"gpu": sum(g) / len(g), "gpuмакс": max(g), "cpu": cpu}


def сводНВ(t0, t1):
    окно = []
    for мс, c in _читать(НВ, ";"):
        if not (t0 <= мс <= t1):
            continue
        ч = [x for x in re.split(r"[,\s]+", (c[0] or "").strip()) if x]
        if len(ч) < 3:
            continue
        try:
            окно.append((float(ч[0]), float(ч[1]), float(ч[2])))
        except ValueError:
            pass
    if not окно:
        return None
    n = len(окно)
    return {"util": sum(x[0] for x in окно) / n, "мгц": sum(x[1] for x in окно) / n,
            "вт": sum(x[2] for x in окно) / n}


def фазы(a):
    """Каждая строка: имя и JS, который включает режим. gb.стоп() зовётся перед каждой."""
    if a.итог:
        сп = []
        for i in range(3):
            сп.append(("ЗУМ, потолка кадров нет #%d" % (i + 1), "S.settings.graphFpsCap=0;window.__gb.зум(true);"))
            сп.append(("ЗУМ, потолок 60 #%d" % (i + 1), "S.settings.graphFpsCap=60;window.__gb.зум(true);"))
        сп.append(("покой, потолка нет", "S.settings.graphFpsCap=0;"))
        сп.append(("покой, потолок 60", "S.settings.graphFpsCap=60;"))
        return сп
    if a.картинка:
        сп = []
        for i in range(3):
            сп.append(("ЗУМ, честная перерисовка #%d" % (i + 1),
                       "S.settings.graphFpsCap=0;S.settings.graphFastZoom=false;window.__gb.зум(true);"))
            сп.append(("ЗУМ готовой картинкой #%d" % (i + 1),
                       "S.settings.graphFpsCap=0;S.settings.graphFastZoom=true;window.__gb.зум(true);"))
        сп.append(("ПАН, честная перерисовка", "S.settings.graphFastZoom=false;window.__gb.пан(true);"))
        сп.append(("ПАН готовой картинкой", "S.settings.graphFastZoom=true;window.__gb.пан(true);"))
        return сп
    if a.статьи:
        return [
            ("ЗУМ, всё как есть", "window.__gb.зум(true);"),
            ("ЗУМ без градиентов связей", "window.__gb.без(['градиенты']);window.__gb.зум(true);"),
            ("ЗУМ без подписей", "window.__gb.без(['подписи']);window.__gb.зум(true);"),
            ("ЗУМ без связей (только узлы)", "window.__gb.пусто('связи');window.__gb.зум(true);"),
            ("ЗУМ без узлов (только связи)", "window.__gb.пусто('узлы');window.__gb.зум(true);"),
            ("ЗУМ: главный холст = одна полоска", "window.__gb.минимум(true);window.__gb.зум(true);"),
            ("ЗУМ: главный холст заглушен", "window.__gb.глушь(['_drawMain']);window.__gb.зум(true);"),
            ("ЗУМ, всё как есть (повтор)", "window.__gb.зум(true);"),
        ]
    return [
        ("покой: граф стоит, никто не трогает", ""),
        ("ЗУМ туда-сюда", "window.__gb.зум(true);"),
        ("ЗУМ без свечения (_drawGlow)", "window.__gb.глушь(['_drawGlow']);window.__gb.зум(true);"),
        ("ЗУМ без фона (_drawBg/_drawBgGL)", "window.__gb.глушь(['_drawBg','_drawBgGL']);window.__gb.зум(true);"),
        ("ЗУМ без главного холста (_drawMain)", "window.__gb.глушь(['_drawMain']);window.__gb.зум(true);"),
        ("ЗУМ вообще без отрисовки", "window.__gb.глушь(['_drawGlow','_drawBg','_drawBgGL','_drawMain']);window.__gb.зум(true);"),
        ("ПАН (тянем камеру)", "window.__gb.пан(true);"),
        ("покой: контроль в конце", ""),
    ]


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--итог", action="store_true", help="A/B потолка кадров, три повтора")
    p.add_argument("--статьи", action="store_true", help="из чего состоит кадр")
    p.add_argument("--микро", action="store_true", help="цена одного вызова отрисовки")
    p.add_argument("--картинка", action="store_true",
                   help="A/B: зум и пан честной перерисовкой против готовой картинки")
    p.add_argument("--спрайты", action="store_true",
                   help="узлы путями против готовых картинок и против WebGL (tools/bench_sprites.js)")
    p.add_argument("--мс", type=int, default=int(ФАЗА_С * 1000), help="длина одной фазы")
    a = p.parse_args(argv[1:])

    if not os.path.isfile(DATA):
        print("нет data/planner.json — мерить не на чем")
        return 1
    сырое = io.open(DATA, "rb").read()          # ЧТЕНИЕ, ничего не пишем
    d = json.loads(сырое.decode("utf-8"))
    print("копия: " + ", ".join("%s: %d нод/%d связей" % (g.get("name") or "?", len(g.get("items") or []),
                                                          len(g.get("links") or []))
                                for g in (d.get("graphs") or [])))
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    код = io.open(os.path.join(ROOT, "tools", "bench_sprites.js") if a.спрайты else JS,
                  encoding="utf-8").read()

    import webview
    итог = {"строки": []}

    def worker(window):
        логгер = нв = None
        try:
            try:
                window.maximize()      # мерить надо в том размере, в каком человек работает
            except Exception:
                pass
            time.sleep(1.0)
            край = time.time() + 40
            while time.time() < край:
                try:
                    if window.evaluate_js("typeof S!=='undefined' && typeof Graph==='function'"
                                          " && typeof render==='function'"):
                        break
                except Exception:
                    pass
                time.sleep(0.25)
            window.evaluate_js("window.__gb=null;window.__gbErr=null;"
                               "(async()=>{" + код + "})().then(v=>{window.__gbInfo=v;})"
                               ".catch(e=>{window.__gbErr=String(e&&e.message||e);});")
            край = time.time() + 90
            info = None
            while time.time() < край:
                try:
                    err = window.evaluate_js("window.__gbErr")
                    if err:
                        print("ОШИБКА стенда: " + str(err))
                        return
                    info = window.evaluate_js("window.__gbInfo||null")
                    if info:
                        break
                except Exception:
                    pass
                time.sleep(0.3)
            if not info:
                print("стенд не поднялся")
                return
            if a.спрайты:
                итог["спрайты"] = json.loads(info)
                return
            print("граф: " + str(info))
            window.evaluate_js("window.__gb.герц().then(v=>{window.__гц=v;});")
            time.sleep(1.2)
            print("частота монитора: %s Гц" % window.evaluate_js("window.__гц"))

            if a.микро:
                print("\n%-8s %11s %9s %11s  цена одного вызова" % ("зум", "метод", "мс", "вызовов/с"))
                for z in (0.23, 0.6, 1.2):
                    window.evaluate_js("window.__gb.зумНа(%f)" % z)
                    time.sleep(0.4)
                    for м in ("_drawMain", "_drawGlow", "_drawBgGL"):
                        r = json.loads(window.evaluate_js("window.__gb.микро('%s',1200)" % м) or "{}")
                        print("%-8s %11s %9.3f %11d" % ("%.2f" % z, м, r.get("мс", 0), r.get("вСек", 0)))
                return

            pids, имена = _дерево(os.getpid())
            логгер = старт_логгера(pids)
            нв = старт_нвидиа()
            time.sleep(3.5)            # запуск powershell + первый замер
            for имя, js in фазы(a):
                window.evaluate_js("window.__gb.стоп();" + js)
                time.sleep(ОСЕСТЬ_С)
                window.evaluate_js("window.__gb.метрика();")
                t0 = time.time()
                time.sleep(a.мс / 1000.0)
                t1 = time.time()
                м = json.loads(window.evaluate_js("window.__gb.метрика()") or "{}")
                итог["строки"].append({"имя": имя, "t0": t0, "t1": t1, "м": м})
                print("  ... " + имя)
            window.evaluate_js("window.__gb.стоп();")
        finally:
            time.sleep(0.5)
            for пр in (логгер, нв):
                if пр:
                    пр.terminate()
            try:
                window.destroy()
            except Exception:
                pass

    port = _serve(сырое)
    url = "http://127.0.0.1:%d/index.html?dev&v=%d" % (port, int(time.time()))
    win = webview.create_window("Мыслик — замер нагрузки", url=url, width=2560, height=1392, x=0, y=0)
    webview.start(worker, win, gui="edgechromium")

    if итог.get("спрайты"):
        print("\n%-38s %9s %10s %9s" % ("способ", "мс/проход", "проходов/с", "вызовов"))
        for r in итог["спрайты"]:
            if r.get("мс") is None:
                print(r["способ"])
                continue
            print("%-38s %9.3f %10d %9d" % (r["способ"], r["мс"], r["вСек"], r["вызовов"]))
        print("\nмс/проход — с ожиданием видеокарты в конце (без него мерилась бы только очередь команд)")
        return 0
    if not итог["строки"]:
        return 0 if a.микро else 1
    print("\n%-38s %6s %6s %6s %6s %6s %6s %6s"
          % ("фаза", "GPU%", "CPU%", "кадр/с", "JSмс", "картаU", "МГц", "Вт"))
    for r in итог["строки"]:
        s = свод(r["t0"], r["t1"])
        n = сводНВ(r["t0"], r["t1"]) or {}
        м = r["м"] or {}
        кс = (м.get("кадров") or 0) / max(0.001, r["t1"] - r["t0"])
        js = (м.get("мс") or 0) / max(1, м.get("кадров") or 1)
        if not s:
            print("%-38s   нет проб GPU" % r["имя"])
            continue
        print("%-38s %6.1f %6.1f %6.1f %6.2f %6.0f %6.0f %6.1f"
              % (r["имя"], s["gpu"], s["cpu"], кс, js,
                 n.get("util", 0), n.get("мгц", 0), n.get("вт", 0)))
    print("\nGPU%% — время занятости движков видеокарты нашими процессами (то же, что в диспетчере)")
    print("CPU%% — доля всей машины (%d ядер);  Вт и МГц — вся видеокарта целиком" % ЯДЕР)
    print("СУДИТЬ О НАГРУЗКЕ ПО ВАТТАМ: процент занятости на редких кадрах почти не падает,")
    print("потому что видеокарта на них не разгоняется — каждый кадр просто тянется дольше.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
