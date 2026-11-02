# -*- coding: utf-8 -*-
"""Сквозная проверка MCP-моста на ИЗОЛИРОВАННОМ экземпляре Мыслика — собранном exe.

    python tools/mcp_e2e.py <путь к Myslik.exe>
    python tools/mcp_e2e.py <путь к app.py В КОПИИ>   — исходники без сборки exe (MCP 1.2)

Копия обязательна: data/ берётся рядом с app.py, и запуск по исходникам самого репозитория
открыл бы живой planner.json. Такой путь скрипт отвергает сам.

Экземпляр живёт своей жизнью: свой data/ рядом с exe (пустой — приложение засеет демо),
свой APPDATA во временной папке (маячок живого приложения не трогается), свой порт
(живое приложение на 8766 не мешает: занятый порт больше не отдаётся, см. agent_start).
Поднимает окно приложения (видно на экране около половины минуты), гоняет весь цикл
через MCP по stdio — ping → rules → snapshot → preview → apply(token) → snapshot по ветке и
внутри подграфа → board → undo, — печатает размеры ответов и закрывает приложение.
Живой планер не трогает ни байтом: ни его данные, ни его маячок, ни его порт."""
import json, os, subprocess, sys, tempfile, time, urllib.request

if len(sys.argv) < 2 or not os.path.exists(sys.argv[1]):
    raise SystemExit("нужен путь к собранному Myslik.exe или к app.py в копии")
EXE = os.path.abspath(sys.argv[1])
DIST = os.path.dirname(EXE)
SRC = EXE.lower().endswith(".py")
if SRC and os.path.isdir(os.path.join(DIST, ".git")):
    raise SystemExit("это исходники самого репозитория — их data/ живая. Скопируй app.py, ai.py, mcp_server.py и ui/ в отдельную папку")
APP_CMD = [sys.executable, EXE] if SRC else [EXE]
MCP_CMD = [sys.executable, os.path.join(DIST, "mcp_server.py")] if SRC else [EXE, "--mcp"]
DATA = os.path.join(DIST, "data")
APPDATA = tempfile.mkdtemp(prefix="myslik-e2e-appdata-")
os.makedirs(DATA, exist_ok=True)
AGENT = os.path.join(DATA, "agent.json")
with open(AGENT, "w", encoding="utf-8") as f:
    json.dump({"enabled": True}, f)          # приложение само выберет порт и выпишет токен

env = dict(os.environ); env["APPDATA"] = APPDATA; env.pop("MYSLIK_AGENT", None); env.pop("MYSLIK_DATA", None)
t0 = time.perf_counter()
app = subprocess.Popen(APP_CMD, env=env, cwd=DIST)
print("приложение запущено, pid", app.pid)

def cfg():
    try:
        c = json.load(open(AGENT, encoding="utf-8"))
        return c if c.get("port") and c.get("token") else None
    except Exception:
        return None

C = None
while time.perf_counter() - t0 < 60:
    C = cfg()
    if C:
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/health" % C["port"], timeout=2) as r:
                if json.loads(r.read().decode()).get("app") == "myslik":
                    break
        except Exception:
            pass
    time.sleep(0.3)
print("порт %s готов через %.1f с" % (C and C["port"], time.perf_counter() - t0))
assert C, "приложение не подняло приёмник"

menv = dict(env); menv["MYSLIK_AGENT"] = AGENT
srv = subprocess.Popen(MCP_CMD, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=menv)
_id = [0]
def call(method, params=None):
    _id[0] += 1
    msg = {"jsonrpc": "2.0", "id": _id[0], "method": method}
    if params is not None: msg["params"] = params
    t = time.perf_counter()
    srv.stdin.write((json.dumps(msg, ensure_ascii=False) + "\n").encode("utf-8")); srv.stdin.flush()
    line = srv.stdout.readline()
    return json.loads(line.decode("utf-8")), time.perf_counter() - t

def tool(name, args=None):
    r, dt = call("tools/call", {"name": name, "arguments": args or {}})
    res = r.get("result") or {}
    text = "".join(c.get("text", "") for c in res.get("content", []))
    try:
        val = json.loads(text)
    except Exception:
        val = text
    return val, text, dt, bool(res.get("isError"))

def est_tokens(s):
    cyr = sum(1 for ch in s if "Ѐ" <= ch <= "ӿ")
    return int(cyr / 2.2 + (len(s) - cyr) / 3.5)

results = []
def check(name, ok, fact=""):
    results.append((name, bool(ok), fact))
    print(("  ok  " if ok else " ПЛОХО ") + name + ("  — " + str(fact)[:150] if fact else ""))

r, dt = call("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "0"}})
check("initialize отвечает версией клиента", r.get("result", {}).get("protocolVersion") == "2025-11-25", "%.0f мс" % (dt * 1000))
srv.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n'); srv.stdin.flush()
r, dt = call("tools/list"); names = [t["name"] for t in r["result"]["tools"]]
check("tools/list: 12 инструментов", len(names) == 12, names)
ann = {t["name"]: t.get("annotations", {}) for t in r["result"]["tools"]}
check("аннотации: чтение readOnly, apply и undo destructive",
      all(ann[n].get("readOnlyHint") for n in ("myslik_rules", "myslik_snapshot", "myslik_search", "myslik_agenda", "myslik_node", "myslik_graphs", "myslik_board", "myslik_preview", "myslik_ping"))
      and ann["myslik_apply"].get("destructiveHint") and ann["myslik_undo"].get("destructiveHint") and not ann["myslik_capture"].get("readOnlyHint"), "")
descr = json.dumps(r["result"]["tools"], ensure_ascii=False)
print("   объём описаний инструментов: %d симв. ~%d ток." % (len(descr), est_tokens(descr)))
r, dt = call("resources/list"); check("resources/list: правила и правила схемы", [x["uri"] for x in r.get("result", {}).get("resources", [])] == ["myslik://rules", "myslik://rules/draw"], r)
r, dt = call("prompts/list"); check("prompts/list: три сценария", [x["name"] for x in r.get("result", {}).get("prompts", [])] == ["plan_project", "weekly_review", "inbox_triage"], "")

# фронт грузится и засевает демо — ждём, пока число нод перестанет меняться
prev, stable = None, 0
for _ in range(80):
    v, text, dt, err = tool("myslik_ping")
    n = v.get("nodes") if isinstance(v, dict) and v.get("ok") else None
    stable = stable + 1 if (n is not None and n == prev) else 0
    prev = n
    if stable >= 4: break
    time.sleep(0.5)
check("ping ok, версия приложения видна", isinstance(v, dict) and v.get("ok") and v.get("version"), v if isinstance(v, dict) else text[:100])
было = prev

v, text, dt, err = tool("myslik_rules")
check("rules без схемы: короче 6 КБ, отсылка к topic draw, раздела схемы нет",
      isinstance(v, str) and len(v) < 6000 and 'topic:"draw"' in v and "Блок:" not in v and "mt" not in v.split("Настоящие id")[0][-200:],
      "%d симв. ~%d ток., %.0f мс" % (len(text), est_tokens(text), dt * 1000))
v, text, dt, err = tool("myslik_rules", {"topic": "draw"})
check("rules topic=draw: только схема", isinstance(v, str) and "Блок:" in v and "Виды нод" not in v, "%d симв. ~%d ток." % (len(text), est_tokens(text)))

v, text, dt, err = tool("myslik_graphs")
check("graphs", isinstance(v, dict) and v.get("ok"), text[:120].replace("\n", " "))
areas = []
v, text, dt, err = tool("myslik_snapshot", {"limit": 5})
check("snapshot по умолчанию compact", isinstance(v, str) and v.startswith("graph:"), text[:80].replace("\n", " | "))
if isinstance(v, str):
    for line in v.split("\n"):
        if line.startswith("areas:"):
            areas = [a.split("=")[0].strip() for a in line[6:].split(",") if "=" in a]
v, text, dt, err = tool("myslik_snapshot", {"limit": 5, "format": "json"})
check("snapshot format=json — объект", isinstance(v, dict) and "nodes" in v, list(v.keys()) if isinstance(v, dict) else text[:80])
area = areas[0] if areas else None

# корень куста БЕЗ area — предпросмотр обязан предупредить
v, text, dt, err = tool("myslik_preview", {"ops": json.dumps({"v": 1, "ops": [
    {"op": "node", "as": "r", "title": "E2E без области"}, {"op": "node", "as": "k", "title": "E2E ребёнок"},
    {"op": "link", "from": "r", "to": "k"}]}, ensure_ascii=False)})
check("preview предупреждает: корень куста без area", isinstance(v, dict) and v.get("ok") and any("без area" in w for w in v.get("warns", [])), v.get("warns") if isinstance(v, dict) else text[:100])

pkg = {"v": 1, "ops": [
    {"op": "node", "as": "root", "kind": "task", "title": "E2E проект", "area": area},
    {"op": "node", "as": "s1", "kind": "task", "title": "E2E шаг один"},
    {"op": "node", "as": "s2", "kind": "task", "title": "E2E шаг два"},
    {"op": "node", "as": "n", "kind": "note", "title": "E2E заметка"},
    {"op": "node", "as": "sub", "kind": "sub", "title": "E2E подграф"},
    {"op": "node", "as": "i1", "kind": "task", "title": "E2E внутри верх", "in": "sub"},
    {"op": "node", "as": "i2", "kind": "task", "title": "E2E внутри низ", "in": "sub"},
    {"op": "node", "as": "map", "kind": "flow", "title": "E2E роадмап"},
    {"op": "link", "from": "root", "to": "s1"}, {"op": "link", "from": "s1", "to": "s2"},
    {"op": "link", "from": "root", "to": "n"}, {"op": "link", "from": "root", "to": "sub"},
    {"op": "link", "from": "root", "to": "map"}, {"op": "link", "from": "i1", "to": "i2"},
    {"op": "draw", "node": "map", "blocks": [
        {"id": "a", "type": "terminal", "text": "Идея", "col": 1, "row": 0},
        {"id": "b", "type": "proc", "text": "Прототип", "col": 1, "row": 1},
        {"id": "c", "type": "decision", "text": "Годится?", "col": 1, "row": 2},
        {"id": "d", "type": "proc", "text": "Выпустить", "col": 0, "row": 3},
        {"id": "e", "type": "proc", "text": "Доработать", "col": 2, "row": 3}],
     "edges": [{"from": "a", "to": "b"}, {"from": "b", "to": "c"}, {"from": "c", "to": "d", "label": "да"}, {"from": "c", "to": "e", "label": "нет"}]},
]}
v, text, dt, err = tool("myslik_preview", {"ops": json.dumps(pkg, ensure_ascii=False)})
check("preview ok: will + token, без предупреждений", isinstance(v, dict) and v.get("ok") and v.get("token") and v.get("will", {}).get("nodes") == 8 and not v.get("warns"),
      "%d симв., will=%s, warns=%s, %.0f мс" % (len(text), v.get("will") if isinstance(v, dict) else "?", v.get("warns") if isinstance(v, dict) else "?", dt * 1000))
token = v.get("token") if isinstance(v, dict) else None

v, text, dt, err = tool("myslik_apply", {"token": token})
check("apply по токену: created с именами", isinstance(v, dict) and v.get("ok") and set(v.get("created", {})) >= {"root", "s1", "s2", "n", "sub", "i1", "i2", "map"},
      "%d симв., %.0f мс, result=%s" % (len(text), dt * 1000, v.get("result") if isinstance(v, dict) else "?"))
ids = v.get("created", {}) if isinstance(v, dict) else {}

v, text, dt, err = tool("myslik_apply", {"token": token})
check("повтор того же токена отвергнут", isinstance(v, dict) and not v.get("ok"), text[:100].replace("\n", " "))

v, text, dt, err = tool("myslik_snapshot", {"root": ids.get("root"), "fields": "id,kind,title,parent"})
rows = [l.split("\t") for l in text.split("\n") if l.count("\t") >= 3]
parents = {r[4] if len(r) > 4 else "": r[3] for r in rows}
check("снимок ветки root: 6 нод, s2 под s1, n под root", len(rows) == 6 and parents.get("E2E шаг два") == ids.get("s1") and parents.get("E2E заметка") == ids.get("root"),
      "%d симв., %d строк; %s" % (len(text), len(rows), {k: ("root" if p == ids.get("root") else "s1" if p == ids.get("s1") else p) for k, p in parents.items()}))

v, text, dt, err = tool("myslik_snapshot", {"graph": "gs_" + ids.get("sub", ""), "fields": "id,title,parent"})
rows = [l.split("\t") for l in text.split("\n") if l.count("\t") >= 3]
parents = {r[4] if len(r) > 4 else "": r[3] for r in rows}
check("внутри подграфа: верх без родителя, низ под верхом", len(rows) == 2 and parents.get("E2E внутри верх") == "-" and parents.get("E2E внутри низ") == ids.get("i1"),
      str(parents))

v, text, dt, err = tool("myslik_board", {"node": ids.get("map")})
check("board compact: 5 блоков, 4 стрелки", isinstance(v, str) and "blocks: 5" in v and text.count(">") >= 4, "%d симв., %.0f мс" % (len(text), dt * 1000))

v, text, dt, err = tool("myslik_apply", {"ops": json.dumps([{"op": "delete", "node": ids.get("n")}])})
check("удаление без allow_delete отвергнуто", isinstance(v, dict) and not v.get("ok"), text[:90].replace("\n", " "))

v, text, dt, err = tool("myslik_undo")
check("undo: число нод вернулось", isinstance(v, dict) and v.get("ok") and v.get("nodes") == было, "%s, было %s" % (v.get("nodes") if isinstance(v, dict) else "?", было))
v, text, dt, err = tool("myslik_ping")
check("ping после undo сходится", isinstance(v, dict) and v.get("nodes") == было, v.get("nodes") if isinstance(v, dict) else "?")

big = {"v": 1, "ops": [{"op": "node", "as": "b%d" % i, "kind": "task", "title": "E2E куст %d" % i} for i in range(30)]}
v, text, dt, err = tool("myslik_preview", {"ops": json.dumps(big, ensure_ascii=False)})
check("preview на 30 операций: список порезан до 20 + строка «ещё»", isinstance(v, dict) and len(v.get("preview", [])) == 21 and "ещё" in v["preview"][-1],
      "%d симв. ~%d ток." % (len(text), est_tokens(text)))

# ===== MCP 1.2: точечное чтение, захват, дописка =====
r, dt = call("resources/read", {"uri": "myslik://rules"})
check("resources/read отдаёт правила", "Виды нод" in json.dumps(r.get("result", {}), ensure_ascii=False), "%.0f мс" % (dt * 1000))
v, text, dt, err = tool("myslik_search", {"query": "куст"})
check("search не находит снятое откатом", isinstance(v, dict) and v.get("ok") and v.get("total") == 0, text[:100])
v, text, dt, err = tool("myslik_agenda", {"range": "week"})
check("agenda week отвечает", isinstance(v, dict) and v.get("ok") and "count" in v, "%d симв., count=%s" % (len(text), v.get("count") if isinstance(v, dict) else "?"))
v, text, dt, err = tool("myslik_capture", {"text": "E2E захват завтра !!"})
cap = v.get("created", {}).get("captured") if isinstance(v, dict) else None
check("capture: создана задача с tx", isinstance(v, dict) and v.get("ok") and cap and v.get("tx"), text[:120])
cap_tx = v.get("tx") if isinstance(v, dict) else None
v, text, dt, err = tool("myslik_search", {"query": "e2e захват"})
check("search находит захваченное, срок и приоритет разобраны",
      isinstance(v, dict) and v.get("total") == 1 and v["results"][0].get("priority") == 2 and v["results"][0].get("due"), text[:160])
time.sleep(1.7)   # окно схлопывания правок: иначе дописка сольётся с захватом в один шаг истории
v, text, dt, err = tool("myslik_apply", {"ops": json.dumps([{"op": "edit", "id": cap, "body_append": "строка агента"}], ensure_ascii=False)})
app_tx = v.get("tx") if isinstance(v, dict) else None
v, text, dt, err = tool("myslik_node", {"id": cap})
check("node: карточка без тела, has_body после дописки", isinstance(v, dict) and v.get("has_body") is True and "body" not in v, text[:160])
v, text, dt, err = tool("myslik_undo", {"tx": app_tx}); check("undo дописки", isinstance(v, dict) and v.get("ok"), text[:80])
v, text, dt, err = tool("myslik_undo", {"tx": cap_tx}); check("undo захвата — число нод как было", isinstance(v, dict) and v.get("ok") and v.get("nodes") == было, text[:80])

srv.stdin.close(); srv.wait(timeout=5)
check("MCP-сервер вышел сам по EOF", srv.returncode == 0, srv.returncode)
app.terminate()
try: app.wait(timeout=5)
except Exception: app.kill()
print("приложение закрыто")
bad = [r for r in results if not r[1]]
print("\nИТОГ: проверок %d, не прошло %d" % (len(results), len(bad)))
sys.exit(1 if bad else 0)
