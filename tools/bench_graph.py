# -*- coding: utf-8 -*-
"""Замер производительности графа на КОПИИ живого файла.

    .venv\\Scripts\\python.exe tools/bench_graph.py --tag до
    .venv\\Scripts\\python.exe tools/bench_graph.py --tag после --w 2560 --h 1392

Живой data/planner.json только ЧИТАЕТСЯ: копия отдаётся в память http-сервера как
bench-data.json, приложение поднимается в дев-режиме (моста нет → запись уходит в
localStorage браузера, не в файл).

Замер на синтетике запрещён не из вредности: однажды на выдуманном графе намерили
11 fps там, где на реальных данных 58 — у выдуманных нод была явная область, и лучей
принадлежности стало 878 вместо восемнадцати.

Отчёт печатается таблицей и кладётся в build/bench-<метка>.json — с ним сравнивается
следующий замер.
"""
import argparse
import io
import json
import os
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
BENCH_JS = os.path.join(ROOT, "tools", "bench_graph.js")

BOOT_WAIT = 30
RUN_WAIT = 240          # весь прогон: 16 режимов по секунде плюс перестроения графа


def _serve(данные):
    """ui/ по http плюс копия файла под именем bench-data.json (только в памяти)."""
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


def main(argv):
    p = argparse.ArgumentParser()
    p.add_argument("--tag", default="до", help="метка замера (имя файла отчёта)")
    p.add_argument("--w", type=int, default=2560)
    p.add_argument("--h", type=int, default=1392)
    p.add_argument("--x", type=int, default=0)
    p.add_argument("--y", type=int, default=0)
    p.add_argument("--ms", type=int, default=1200, help="сколько держим каждый режим")
    p.add_argument("--js", default=BENCH_JS, help="какой замерочный скрипт выполнять")
    p.add_argument("--render", default="svg", choices=["svg", "canvas"], help="чем рисовать граф")
    a = p.parse_args(argv[1:])

    if not os.path.isfile(DATA):
        print("нет data/planner.json — мерить не на чем")
        return 1
    сырое = io.open(DATA, "rb").read()          # ЧТЕНИЕ, ничего не пишем
    d = json.loads(сырое.decode("utf-8"))
    состав = ", ".join("%s: %d нод / %d связей" % (g.get("name") or "?", len(g.get("items") or []),
                                                   len(g.get("links") or []))
                       for g in (d.get("graphs") or []))
    print("копия файла: %s" % состав)

    import webview

    код = io.open(os.path.join(ROOT, a.js) if not os.path.isabs(a.js) else a.js,
                  encoding="utf-8").read()
    итог = {"rows": None}

    def worker(window):
        try:
            deadline = time.time() + BOOT_WAIT
            ready = False
            while time.time() < deadline:
                try:
                    ready = window.evaluate_js(
                        "typeof S!=='undefined' && S.items && S.items.length>0"
                        " && typeof boot==='function' && typeof Graph==='function'")
                except Exception:
                    ready = False
                if ready:
                    break
                time.sleep(0.25)
            if not ready:
                print("приложение не поднялось за %d с" % BOOT_WAIT)
                return
            window.evaluate_js("window.__BENCH={ms:%d,render:'%s'};" % (a.ms, a.render))
            window.evaluate_js(
                "window.__r=null;window.__d=false;"
                "(async()=>{" + код + "})()"
                ".then(v=>{window.__r=v;window.__d=true;})"
                ".catch(e=>{window.__r=[{режим:'ОШИБКА '+String(e&&e.message||e)}];window.__d=true;});")
            end = time.time() + RUN_WAIT
            while time.time() < end:
                try:
                    if window.evaluate_js("window.__d===true"):
                        итог["rows"] = json.loads(window.evaluate_js("JSON.stringify(window.__r)") or "null")
                        break
                except Exception:
                    pass
                time.sleep(0.3)
        finally:
            try:
                window.destroy()
            except Exception:
                pass

    port = _serve(сырое)
    url = "http://127.0.0.1:%d/index.html?dev&v=%d" % (port, int(time.time()))
    win = webview.create_window("Мыслик — замер графа", url=url,
                                width=a.w, height=a.h, x=a.x, y=a.y)
    webview.start(worker, win, gui="edgechromium")

    rows = итог["rows"]
    if not rows:
        print("замер не вернул ничего (окно закрылось раньше времени?)")
        return 1

    среда = [r for r in rows if r.get("режим") == "__окружение"]
    кач = [r for r in rows if r.get("режим") == "__качество"]
    rows = [r for r in rows if r.get("режим") not in ("__окружение", "__качество")]
    print("\nзамер «%s» · окно %d×%d" % (a.tag, a.w, a.h))
    if среда:
        print(среда[0].get("вКадре", ""))
    print("%-58s %7s %8s %8s %8s %8s %s"
          % ("режим", "fps", "кадр мс", "макс мс", "потолок", "занято%", "в кадре н/с"))
    for r in rows:
        if "fps" not in r:
            print(r.get("режим"))
            continue
        print("%-58s %7.1f %8.2f %8.1f %8d %8.1f %s"
              % (r["режим"], r["fps"], r["tjs"], r["макс"], r["потолок"],
                 r.get("занято", 0), r["вКадре"]))
    if кач:
        print("\nкачество раскладки: %s" % кач[0].get("вКадре", ""))
    print("\nfps — нарисованных кадров графа в секунду (с ценой отрисовки браузером)")
    print("потолок — 1000/кадр мс: сколько было бы, если бы вся цена сидела в нашем JS")
    print("занято% — доля времени, съеденная нашим кодом; остальное до кадра — отрисовка браузера")

    dst = os.path.join(ROOT, "build", "bench-%s.json" % a.tag)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    io.open(dst, "w", encoding="utf-8").write(json.dumps(
        {"метка": a.tag, "окно": [a.w, a.h], "когда": time.strftime("%Y-%m-%d %H:%M"),
         "окружение": среда[0]["вКадре"] if среда else "", "строки": rows},
        ensure_ascii=False, indent=1))
    print("отчёт: %s" % dst)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
