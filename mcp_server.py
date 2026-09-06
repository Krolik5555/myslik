"""MCP-сервер «Мыслика» — личного планера.

Как это связано:

    Claude Code ──stdio──> этот сервер ──HTTP 127.0.0.1──> Мыслик ──evaluate_js──> ui/js/cmd.js

Своей логики здесь нет намеренно. Разбор пакета команд, белый список операций, предпросмотр и
откат живут ВНУТРИ приложения (`ui/js/cmd.js`): второй набор правил на этой стороне разошёлся бы
с первым молча, и ошибку увидел бы не человек, а модель.

БЕЗ ЕДИНОЙ ЗАВИСИМОСТИ, И ЭТО НЕ АСКЕЗА. Мыслик приезжает пользователю одним exe, Python у него
может не стоять вовсе — значит ни `pip install mcp`, ни venv потребовать нельзя. Транспорт MCP
по stdio — это JSON-RPC построчно, а нужных методов ровно четыре (initialize, tools/list,
tools/call, ping). Поэтому сервер работает и как отдельный скрипт, и внутри самого приложения
(`Myslik.exe --mcp`), где он и приезжает пользователю вместе с релизом.

Приложение должно быть ЗАПУЩЕНО, а доступ для агента включён в его настройках: порт в личный
планер по умолчанию не открывается.
"""

import json
import os
import sys
import urllib.error
import urllib.request

PROTOCOL = "2024-11-05"
TIMEOUT = 20          # применение идёт через мост в браузер — секунды, но не мгновенно


# ---------------------------------------------------------------- поиск приложения
def _cfg_paths():
    """Где искать порт и токен. Порядок от явного к общему: переменная окружения (дев и
    нестандартные установки), затем стандартное место в профиле — туда приложение пишет
    «маячок» независимо от того, куда его положили (Мыслик портативный, его каталог заранее
    неизвестен), затем каталог данных рядом с программой."""
    p = os.environ.get("MYSLIK_AGENT")
    if p:
        yield p
    appdata = os.environ.get("APPDATA")
    if appdata:
        yield os.path.join(appdata, "Myslik", "agent.json")
    d = os.environ.get("MYSLIK_DATA")
    if d:
        yield os.path.join(d, "agent.json")
    # рядом с самим приложением: в собранном виде отсчитываем от exe, в исходниках — от файла
    base = sys.executable if getattr(sys, "frozen", False) else __file__
    yield os.path.join(os.path.dirname(os.path.abspath(base)), "data", "agent.json")


def _cfg():
    for p in _cfg_paths():
        try:
            with open(p, "r", encoding="utf-8") as f:
                c = json.load(f)
            if c.get("port") and c.get("token"):
                return c
        except Exception:
            continue
    return {}


NOT_READY = ("Мыслик не найден. Проверь три вещи: приложение запущено; в его Настройках включён "
             "«Доступ для ИИ-агента»; окно не закрыто в трей до первого включения.")


def _rpc(method, params=None):
    """Запрос к приложению. Ошибки возвращаем ТЕКСТОМ, а не исключением: агенту нужен ответ,
    по которому можно решить, что делать дальше, а не оборванный вызов."""
    cfg = _cfg()
    port, token = cfg.get("port"), cfg.get("token")
    if not port or not token:
        return {"ok": False, "error": NOT_READY}
    body = json.dumps({"method": method, "params": params or {}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/rpc" % int(port), data=body,
        headers={"Content-Type": "application/json; charset=utf-8", "X-Myslik-Token": token})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            return {"ok": False, "error": "Токен не подошёл — вероятно, его сменили в настройках приложения."}
        return {"ok": False, "error": "Приложение ответило %s." % e.code}
    except Exception:
        return {"ok": False, "error": NOT_READY}


# ---------------------------------------------------------------- инструменты
def _t_ping(_):
    return _rpc("ping")


def _t_format(_):
    r = _rpc("prompt")
    return r.get("prompt", "") if r.get("ok") else r


def _t_snapshot(_):
    r = _rpc("snapshot")
    return r.get("snapshot") if r.get("ok") else r


def _t_graphs(_):
    return _rpc("graphs")


def _t_preview(a):
    return _rpc("preview", {"ops": a.get("ops")})


def _t_apply(a):
    return _rpc("apply", {"ops": a.get("ops"), "allowDelete": bool(a.get("allow_delete"))})


def _t_undo(_):
    return _rpc("undo")


_OPS_SCHEMA = {"type": "object",
               "properties": {"ops": {"type": "string",
                                      "description": 'Пакет команд в JSON: {"v":1,"ops":[…]} либо просто массив операций.'}},
               "required": ["ops"]}
_NO_ARGS = {"type": "object", "properties": {}}

TOOLS = [
    {"name": "myslik_format", "fn": _t_format, "schema": _NO_ARGS,
     "desc": ("Формат пакета команд ВМЕСТЕ со снимком текущего графа. Вызывать ПЕРВЫМ перед любой "
              "правкой: там перечислены операции, виды нод, статусы и правила, а в конце — настоящие "
              "id нод, которыми и надо ссылаться.")},
    {"name": "myslik_snapshot", "fn": _t_snapshot, "schema": _NO_ARGS,
     "desc": ("Снимок текущего графа: ноды (id, вид, название, статус, срок, теги, родитель) и связи. "
              "Тело нод и содержимое полей не отдаются — это личные записи, и объём ни к чему.")},
    {"name": "myslik_graphs", "fn": _t_graphs, "schema": _NO_ARGS,
     "desc": "Графы верхнего уровня: id, название, число нод и какой сейчас открыт."},
    {"name": "myslik_preview", "fn": _t_preview, "schema": _OPS_SCHEMA,
     "desc": ("Проверить пакет и получить список «что будет сделано», НИЧЕГО не применяя. Звать до "
              "myslik_apply: разбор вернёт ошибки по номерам операций.")},
    {"name": "myslik_apply", "fn": _t_apply, "schema": {
        "type": "object",
        "properties": {"ops": _OPS_SCHEMA["properties"]["ops"],
                       "allow_delete": {"type": "boolean",
                                        "description": "Разрешить удаления. Корзины в приложении нет — только откат."}},
        "required": ["ops"]},
     "desc": ("Применить пакет к планеру. Весь пакет — ОДИН шаг истории; любая ошибка разбора "
              "отменяет его целиком. Человек увидит в приложении сообщение и сможет отменить нажатием.")},
    {"name": "myslik_undo", "fn": _t_undo, "schema": _NO_ARGS,
     "desc": "Отменить последнее действие в планере — в том числе целиком пакет, применённый агентом."},
    {"name": "myslik_ping", "fn": _t_ping, "schema": _NO_ARGS,
     "desc": "Проверить связь: открыто ли приложение, какой граф активен, сколько в нём нод."},
]
_BY_NAME = {t["name"]: t for t in TOOLS}


# ---------------------------------------------------------------- транспорт
def _write(obj, out):
    out.write(json.dumps(obj, ensure_ascii=False) + "\n")
    out.flush()


def _handle(msg):
    """Ответ на одно сообщение или None, если отвечать не надо (уведомление)."""
    mid, method = msg.get("id"), msg.get("method")
    if method == "initialize":
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": PROTOCOL,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "myslik", "version": "1.0"}}}
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None                     # уведомления ответа не требуют — на них нельзя отвечать вовсе
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": [
            {"name": t["name"], "description": t["desc"], "inputSchema": t["schema"]} for t in TOOLS]}}
    if method == "tools/call":
        p = msg.get("params") or {}
        t = _BY_NAME.get(p.get("name"))
        if not t:
            return {"jsonrpc": "2.0", "id": mid,
                    "error": {"code": -32602, "message": "нет такого инструмента: %s" % p.get("name")}}
        try:
            res = t["fn"](p.get("arguments") or {})
        except Exception as e:
            res = {"ok": False, "error": "сбой инструмента: %s" % e}
        text = res if isinstance(res, str) else json.dumps(res, ensure_ascii=False, indent=1)
        return {"jsonrpc": "2.0", "id": mid,
                "result": {"content": [{"type": "text", "text": text}],
                           "isError": bool(isinstance(res, dict) and res.get("ok") is False)}}
    if mid is None:
        return None                     # неизвестное уведомление — молчим
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": "нет метода: %s" % method}}


def main():
    # stdout занят протоколом: всё постороннее — только в stderr, иначе клиент не разберёт поток
    inp = sys.stdin
    out = sys.stdout
    try:
        inp.reconfigure(encoding="utf-8")
        out.reconfigure(encoding="utf-8")
    except Exception:
        pass
    for line in inp:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue                    # мусорную строку молча пропускаем: рвать сессию из-за неё незачем
        try:
            ans = _handle(msg)
        except Exception as e:
            ans = {"jsonrpc": "2.0", "id": msg.get("id"),
                   "error": {"code": -32603, "message": str(e)}}
        if ans is not None:
            _write(ans, out)


if __name__ == "__main__":
    main()
