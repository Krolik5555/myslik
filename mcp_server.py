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

# ВЕРСИИ ПРОТОКОЛА. Клиент присылает свою в params.protocolVersion, и вежливее ответить ЕЙ,
# если мы её понимаем: так соединение переживает и обновление Claude Code, и старую сборку
# Мыслика у соседа. Версия не из набора — отвечаем своей, клиент решает сам, работать с ней
# или нет. Набор пополнять по мере выхода новых; порядок в нём значения не имеет.
PROTOCOL = "2024-11-05"                 # своя: с ней сервер точно совместим
PROTOCOLS_OK = {"2024-11-05", "2025-03-26", "2025-06-18"}
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


def _alive(port):
    """ТОТ ЛИ ЭТО ПОРТ — спрашиваем КАЖДЫЙ РАЗ, без кэша.

    Маячок в agent.json остаётся лежать и после закрытия приложения, а порт к тому времени мог
    занять посторонний процесс — и мы отправили бы ему токен доступа к личным записям прямо в
    заголовке. Поэтому сначала GET /health: приложение отвечает там опознавательным словом и
    токена для этого не требует, то есть сама проверка ничего не раскрывает.

    КЭША ЗДЕСЬ БЫТЬ НЕ ДОЛЖНО, и это ровно тот случай, ради которого проверка написана: сессия
    клиента живёт часами, планер за это время закрывают, порт занимает кто угодно. Запомненное
    «жив» означало бы, что со второго вызова мы снова шлём токен вслепую — то есть защиты нет.
    Цена отказа от кэша копеечная: /health на петле стоит около миллисекунды, а любой вызов
    инструмента и так идёт по HTTP."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/health" % int(port), timeout=3) as r:
            data = json.loads(r.read().decode("utf-8"))
        return bool(data.get("ok")) and data.get("app") == "myslik"
    except Exception:
        return False


def _rpc(method, params=None):
    """Запрос к приложению. Ошибки возвращаем ТЕКСТОМ, а не исключением: агенту нужен ответ,
    по которому можно решить, что делать дальше, а не оборванный вызов."""
    cfg = _cfg()
    port, token = cfg.get("port"), cfg.get("token")
    if not port or not token:
        return {"ok": False, "error": NOT_READY}
    # на чужой порт токен не отправляем — сначала опознаём приложение (см. _alive)
    if not _alive(port):
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
    # явный UTF-8 байтами: ответ почти всегда с кириллицей, и полагаться на кодировку консоли
    # (в сборке без окна это cp1251) значит однажды отдать клиенту нечитаемую строку
    payload = json.dumps(obj, ensure_ascii=False) + "\n"
    try:
        out.write(payload.encode("utf-8"))
    except TypeError:
        out.write(payload)               # текстовый поток — запасной путь, если buffer недоступен
    out.flush()


def _handle(msg):
    """Ответ на одно сообщение или None, если отвечать не надо (уведомление)."""
    mid, method = msg.get("id"), msg.get("method")
    if method == "initialize":
        asked = ((msg.get("params") or {}).get("protocolVersion") or "")
        return {"jsonrpc": "2.0", "id": mid, "result": {
            "protocolVersion": asked if asked in PROTOCOLS_OK else PROTOCOL,
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


def _crash_log(text):
    """Куда писать необработанное падение. В сборке без консоли поток ошибок уходит в лог
    клиента, но при РАННЕМ падении у пользователя не остаётся вообще ничего — а объяснить,
    почему «сервер отключился», надо ему, а не разработчику. Приём и путь те же, что у окна
    приложения (STARTUP_LOG в app.py): файл рядом с программой, а если туда нельзя писать
    (Program Files), то во временную папку."""
    base = os.path.dirname(os.path.abspath(
        sys.executable if getattr(sys, "frozen", False) else __file__))
    where = os.path.join(base, "запуск-ошибка-mcp.txt")
    try:
        with open(where, "w", encoding="utf-8") as f:
            f.write(text)
    except Exception:
        try:
            import tempfile
            where = os.path.join(tempfile.gettempdir(), "myslik-запуск-ошибка-mcp.txt")
            with open(where, "w", encoding="utf-8") as f:
                f.write(text)
        except Exception:
            return ""
    return where


def _loop():
    """Приём сообщений. ЧИТАЕМ БАЙТАМИ И ДЕКОДИРУЕМ САМИ — это не педантизм.

    У текстового sys.stdin кодировка берётся от консоли (в сборке без окна это cp1251), а
    errors не задан: один битый байт во входе поднимает UnicodeDecodeError в САМОМ операторе
    цикла, то есть МИМО обоих try внутри него. Цикл рвётся, процесс молча умирает, и человек
    видит «сервер отключился» без единой причины. С байтами кодировка консоли не участвует
    вовсе, а errors="replace" превращает мусорный байт в один символ вместо падения.

    Ответы пишем туда же байтами в явном UTF-8: так протокол не зависит от того, удалось ли
    reconfigure — а кириллица в ответах есть почти всегда."""
    inp = getattr(sys.stdin, "buffer", None) or sys.stdin
    out = getattr(sys.stdout, "buffer", None) or sys.stdout
    for raw in inp:
        try:
            line = raw.decode("utf-8", "replace").strip()
        except Exception:
            continue
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue                    # мусорную строку молча пропускаем: рвать сессию из-за неё незачем
        try:
            ans = _handle(msg)
        except Exception as e:
            ans = {"jsonrpc": "2.0", "id": msg.get("id") if isinstance(msg, dict) else None,
                   "error": {"code": -32603, "message": str(e)}}
        if ans is not None:
            _write(ans, out)


def main():
    # stdout занят протоколом: всё постороннее — только в stderr, иначе клиент не разберёт поток.
    # reconfigure оставлен намеренно: сам обмен идёт байтами, но чужой код (traceback, warning)
    # печатается через текстовые потоки, и без него кириллица в них ломается.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
    try:
        _loop()
    except Exception:
        import traceback
        trace = traceback.format_exc()
        where = _crash_log("MCP-сервер «Мыслика» упал.\n\n" + trace)
        # дублируем в поток ошибок: у клиента он попадает в лог, и причина видна сразу
        try:
            sys.stderr.write(trace + ("\nПодробности: " + where + "\n" if where else "\n"))
            sys.stderr.flush()
        except Exception:
            pass
        raise SystemExit(1)


if __name__ == "__main__":
    main()
