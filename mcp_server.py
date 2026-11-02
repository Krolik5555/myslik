"""MCP-сервер «Мыслика» — личного планера.

Как это связано:

    Claude Code ──stdio──> этот сервер ──HTTP 127.0.0.1──> Мыслик ──evaluate_js──> ui/js/cmd.js

Своей логики здесь нет намеренно. Разбор пакета команд, белый список операций, предпросмотр и
откат живут ВНУТРИ приложения (`ui/js/cmd.js`): второй набор правил на этой стороне разошёлся бы
с первым молча, и ошибку увидел бы не человек, а модель.

БЕЗ ЕДИНОЙ ЗАВИСИМОСТИ, И ЭТО НЕ АСКЕЗА. Мыслик приезжает пользователю одним exe, Python у него
может не стоять вовсе — значит ни `pip install mcp`, ни venv потребовать нельзя. Транспорт MCP
по stdio — это JSON-RPC построчно, а нужных методов горстка (initialize, tools/list,
tools/call, ping, с 1.2 ещё prompts и resources). Поэтому сервер работает и как отдельный скрипт, и внутри самого приложения
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
# Отвечать чужой версией безопасно, потому что нового от сервера с одними инструментами
# эти ревизии не требуют: всё, что они добавили (структурированный ответ, elicitation,
# задачи), — по желанию. Единственное, что убрали (пакеты JSON-RPC массивом), мы и так не
# принимали. Claude Code 2.1 шлёт 2025-11-25; без неё в наборе он считал сервер устаревшим.
PROTOCOL = "2024-11-05"                 # своя: с ней сервер точно совместим
PROTOCOLS_OK = {"2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"}
TIMEOUT = 20          # применение идёт через мост в браузер — секунды, но не мгновенно
SERVER_VERSION = "1.2"   # 1.2: поиск, повестка, карточка, захват, body_append, аннотации, промпты, ресурсы


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
# Поля ноды по умолчанию — ровно то, по чему строят дерево и на что ссылаются. Остальное (срок,
# теги, область, приоритет) агент просит через fields: снимок на четыреста нод растёт вдвое
# от полей, которые в конкретной задаче не нужны.
# has_body здесь НЕ ради полноты: без него не видно, есть ли в ноде текст, а `edit body` затирает
# его целиком — то есть дописывать в существующую ноду пришлось бы вслепую. Флаг стоит 13 байт
# и только у нод с телом; завершённость видна и так, через status.
SNAP_FIELDS_DEF = "id,kind,title,parent,status,has_body"
_SNAP_KEYS = ("graph", "area", "root", "depth", "fields", "limit", "cursor", "format")


def _t_ping(_):
    return _rpc("ping")


def _t_rules(a):
    # без topic — основные правила БЕЗ раздела про схему на полотне (треть текста, нужна
    # только когда рисуют); topic:"draw" — один этот раздел. Режет их cmdPrompt, не мы.
    p = {"topic": a["topic"]} if a.get("topic") else {}
    r = _rpc("rules", p)
    return r.get("rules", "") if r.get("ok") else r


def _t_snapshot(a):
    p = {k: a[k] for k in _SNAP_KEYS if a.get(k) not in (None, "")}
    p.setdefault("fields", SNAP_FIELDS_DEF)
    # compact по умолчанию: на том же графе он на 35–40 % короче json (замер — docs/ПЛАН-MCP.md),
    # а читает его модель одинаково. json — по явной просьбе, когда нужны именованные поля.
    p.setdefault("format", "compact")
    r = _rpc("snapshot", p)
    return r.get("snapshot") if r.get("ok") else r


def _t_graphs(_):
    return _rpc("graphs")


def _t_preview(a):
    return _rpc("preview", {"ops": a.get("ops")})


def _t_apply(a):
    # токен ИЛИ пакет: с токеном от preview пакет второй раз по мосту не едет (см. cmdTokenTake)
    p = {"allowDelete": bool(a.get("allow_delete"))}
    if a.get("token") and not a.get("ops"):
        p["token"] = a["token"]
    else:
        p["ops"] = a.get("ops")
    return _rpc("apply", p)


def _t_board(a):
    p = {k: a[k] for k in ("node", "limit", "format") if a.get(k) not in (None, "")}
    p.setdefault("format", "compact")   # та же причина, что у снимка
    r = _rpc("board", p)
    return r.get("board") if r.get("ok") else r


_FIND_KEYS = ("query", "tags", "status", "kind", "area", "due_before", "due_after", "graph", "limit", "done")


def _t_search(a):
    return _rpc("search", {k: a[k] for k in _FIND_KEYS if a.get(k) not in (None, "")})


def _t_agenda(a):
    return _rpc("agenda", {"range": a.get("range") or "today"})


def _t_node(a):
    r = _rpc("node", {"id": a.get("id")})
    return r.get("node") if r.get("ok") else r


def _t_capture(a):
    p = {"text": a.get("text") or ""}
    if a.get("parent"):
        p["parent"] = a["parent"]
    return _rpc("capture", p)


def _t_undo(a):
    # tx из ответа myslik_apply: откатит ровно этот пакет и откажет, если после него в планере
    # уже что-то делали (проверяет cmd.js: cmdAgent, ветка undo)
    return _rpc("undo", {"tx": a["tx"]} if a.get("tx") else {})


_BOARD_SCHEMA = {
    "type": "object",
    "properties": {
        "node": {"type": "string", "description": "id ноды-полотна (kind \"flow\"). Берётся из снимка графа."},
        "limit": {"type": "integer", "description": "Потолок блоков в ответе (по умолчанию 200)."},
        "format": {"type": "string", "enum": ["compact", "json"],
                   "description": "По умолчанию compact — строка на блок через табуляцию. json — если нужны именованные поля."}},
    "required": ["node"]}

_OPS_SCHEMA = {"type": "object",
               "properties": {"ops": {"type": "string",
                                      "description": 'Пакет команд в JSON: {"v":1,"ops":[…]} либо просто массив операций.'}},
               "required": ["ops"]}
_NO_ARGS = {"type": "object", "properties": {}}
_RULES_SCHEMA = {
    "type": "object",
    "properties": {
        "topic": {"type": "string", "enum": ["draw"],
                  "description": ("draw — только правила схемы на полотне (op \"draw\"): блоки, стрелки, "
                                  "раскладка. Без topic — основные правила, схема в них лишь упомянута.")}}}

_SNAP_SCHEMA = {
    "type": "object",
    "properties": {
        "root": {"type": "string",
                 "description": "id ноды: отдать её и всё поддерево. Главный способ не тянуть весь граф."},
        "area": {"type": "string", "description": "Только ноды этой области — id или название."},
        "depth": {"type": "integer",
                  "description": "Сколько уровней отдавать: от root, а без него — от корней выборки (1 — только они сами). По умолчанию без предела."},
        "graph": {"type": "string", "description": "id или название графа. По умолчанию открытый; подграф — id вида gs_<id ноды>."},
        "limit": {"type": "integer", "description": "Потолок нод в ответе (по умолчанию 400). Срез идёт по границе ветки."},
        "cursor": {"type": "integer", "description": "Продолжить с этой позиции — значение next_cursor из прошлого ответа."},
        "fields": {"type": "string",
                   "description": ("Поля нод через запятую. По умолчанию " + SNAP_FIELDS_DEF +
                                   "; сверх того бывают done, due, priority, tags, area, tray, inside.")},
        "format": {"type": "string", "enum": ["compact", "json"],
                   "description": "По умолчанию compact — строка на ноду через табуляцию (id, вид, статус, родитель, название). json — если нужны именованные поля."}}}

_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "description": "Слова через пробел — все должны встретиться в названии или тегах. Текст нод не ищется: он личный."},
        "tags": {"type": "string", "description": "Теги через запятую — все обязательны."},
        "status": {"type": "string", "description": "Статусы через запятую: todo, next, doing, waiting, review, paused, done, note."},
        "kind": {"type": "string", "description": "Виды через запятую: task, note, flow, sub."},
        "area": {"type": "string", "description": "Область — id или название."},
        "due_before": {"type": "string", "description": "Срок не позже ГГГГ-ММ-ДД."},
        "due_after": {"type": "string", "description": "Срок не раньше ГГГГ-ММ-ДД."},
        "graph": {"type": "string", "description": "id или название графа. По умолчанию открытый."},
        "done": {"type": "boolean", "description": "Искать и среди выполненных (по умолчанию нет)."},
        "limit": {"type": "integer", "description": "Сколько отдать (по умолчанию 30, не больше 200)."}}}

_AGENDA_SCHEMA = {
    "type": "object",
    "properties": {"range": {"type": "string", "enum": ["today", "week", "overdue", "hot"],
                             "description": ("today — просроченное, сегодняшнее и «в работе»; week — ещё и семь дней "
                                             "вперёд; overdue — только просроченное; hot — очередь «что горит» с причинами.")}}}

_NODE_SCHEMA = {"type": "object", "properties": {"id": {"type": "string", "description": "id ноды из поиска или снимка."}},
                "required": ["id"]}

_CAPTURE_SCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": ("Одна строка, как в строке захвата приложения: «Позвонить в студию "
                                                     "завтра !! #работа». Понимает даты словами, ! !! !!! (приоритет 1…3), "
                                                     "#область или #тег, * в начале — заметка.")},
        "parent": {"type": "string", "description": "id ноды, под которую повесить запись (необязательно)."}},
    "required": ["text"]}

# Аннотации (M1): чтение помечено readOnlyHint — клиент вправе пускать его без вопроса на каждый
# вызов; запись — destructiveHint по правде о том, может ли она снести чужое. openWorldHint:false у
# всех: инструменты ходят только в локальный планер, не в интернет.
_RO = {"readOnlyHint": True, "openWorldHint": False}

TOOLS = [
    {"name": "myslik_rules", "fn": _t_rules, "schema": _RULES_SCHEMA, "title": "Правила пакета", "ann": _RO,
     "desc": ("Правила и формат пакета команд: операции, виды нод, статусы, как строить ветку. "
              "Звать ПЕРВЫМ перед любой правкой, один раз за сессию. Правила схемы на полотне "
              "сюда не входят — topic:\"draw\", когда собираешься рисовать. Снимка графа тут нет "
              "намеренно — id берут отдельно, myslik_snapshot по нужной ветке.")},
    {"name": "myslik_snapshot", "fn": _t_snapshot, "schema": _SNAP_SCHEMA, "tight": True, "title": "Снимок графа", "ann": _RO,
     "desc": ("Ноды и связи графа: id, вид, название, родитель, статус — строка на ноду. БЕЗ "
              "АРГУМЕНТОВ ОТДАЁТ ВЕСЬ ГРАФ — на сотнях нод это десятки килобайт; спрашивай узко: "
              "root (ветка), area (область), limit + cursor (частями), fields (лишние поля не "
              "тянуть). В ответе total, returned и truncated — сколько всего подошло и сколько "
              "отдано. Тело нод и содержимое полей не отдаются никогда: это личные записи; есть "
              "ли текст в ноде, показывает has_body.")},
    {"name": "myslik_search", "fn": _t_search, "schema": _SEARCH_SCHEMA, "tight": True, "title": "Поиск нод", "ann": _RO,
     "desc": ("Найти ноды по словам в названии, тегам, статусу, виду, области и сроку — не вытягивая "
              "граф снимком. Отдаёт id, вид, статус, название, путь к ноде (предки), срок и приоритет; "
              "готовые не ищет, пока не попросишь done:true или status done. Порядок: точное "
              "название, начало названия, затем срочность.")},
    {"name": "myslik_agenda", "fn": _t_agenda, "schema": _AGENDA_SCHEMA, "tight": True, "title": "Повестка", "ann": _RO,
     "desc": ("Повестка по ВСЕМ графам: что просрочено, что на сегодня, что в работе, неделя вперёд "
              "или очередь «что горит» с причинами (why). Для вопросов «что у меня сегодня», "
              "«что горит», недельного обзора.")},
    {"name": "myslik_node", "fn": _t_node, "schema": _NODE_SCHEMA, "title": "Карточка ноды", "ann": _RO,
     "desc": ("Карточка одной ноды: все поля, путь, родитель, дети, боковые связи, имена именованных "
              "полей. Текст ноды (body) — только если человек разрешил это в приложении; иначе "
              "body_hidden и has_body. Дописать текст можно всегда: edit с body_append.")},
    {"name": "myslik_capture", "fn": _t_capture, "schema": _CAPTURE_SCHEMA, "title": "Быстрая запись",
     "ann": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False, "openWorldHint": False},
     "desc": ("Записать одну мысль строкой — тот же разбор, что у строки захвата в приложении "
              "(«завтра», «через 3 дня», !! — приоритет, #область, * — заметка). Самый дешёвый путь записи: без пакета и "
              "без правил. Ложится в открытый граф (или под parent) одним шагом истории; в ответе "
              "created и tx для myslik_undo.")},
    {"name": "myslik_graphs", "fn": _t_graphs, "schema": _NO_ARGS, "title": "Графы", "ann": _RO,
     "desc": "Графы верхнего уровня: id, название, число нод и какой сейчас открыт."},
    {"name": "myslik_board", "fn": _t_board, "schema": _BOARD_SCHEMA, "tight": True, "title": "Доска полотна", "ann": _RO,
     "desc": ("Что нарисовано на полотне: блоки (id, вид, место в клетках, подпись) и стрелки "
              "между ними. Звать ПЕРЕД тем, как дорисовывать: без этого пакет ляжет вслепую. "
              "Картинки не отдаются — только их место и размер. Вид блока приблизительный: в "
              "сцене от стиля осталась одна обводка. Что не разобралось (линии от руки, чужие "
              "фигуры) считается в skipped — на такой доске бери mode \"append\", а не "
              "\"replace\": заменой сотрёшь и то, чего здесь не видно.")},
    {"name": "myslik_preview", "fn": _t_preview, "schema": _OPS_SCHEMA, "title": "Предпросмотр пакета", "ann": _RO,
     "desc": ("Проверить пакет и получить «что будет сделано», НИЧЕГО не применяя: разбор вернёт "
              "ошибки по номерам операций, will — сколько появится нод и связей, token — короткий "
              "ключ для myslik_apply, чтобы не слать пакет вторым разом.")},
    {"name": "myslik_apply", "fn": _t_apply, "title": "Применить пакет",
     # destructive: с allow_delete пакет сносит ноды и заменяет доски
     "ann": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False},
     "schema": {
        "type": "object",
        "properties": {"ops": _OPS_SCHEMA["properties"]["ops"],
                       "token": {"type": "string",
                                 "description": "Ключ из myslik_preview вместо ops. Одноразовый, живёт три минуты; изменился граф — попросит повторить предпросмотр."},
                       "allow_delete": {"type": "boolean",
                                        "description": ("Разрешить удаления — и снос ноды, и замену непустой доски "
                                                        "(mode \"replace\"). Корзины в приложении нет — только откат.")}}},
     "desc": ("Применить пакет к планеру — по token из myslik_preview либо целиком в ops. Весь "
              "пакет — ОДИН шаг истории; любая ошибка разбора отменяет его целиком. В ответе "
              "created: имя из пакета → настоящий id, и tx — метка пакета для myslik_undo. Человек "
              "увидит в приложении сообщение и сможет отменить нажатием.")},
    {"name": "myslik_undo", "fn": _t_undo, "title": "Откатить свой пакет",
     "ann": {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False},
     "schema": {
        "type": "object",
        "properties": {"tx": {"type": "string",
                              "description": "Метка tx из ответа myslik_apply: откатить именно этот пакет."}}},
     "desc": ("Отменить СВОЙ пакет, применённый через myslik_apply, — целиком. Работает, только "
              "пока пакет последний в истории планера: если после него человек что-то делал, "
              "откат откажет (чужие правки агент не снимает). Отвечает уже после отката и сразу "
              "числом нод: отдельный ping не нужен.")},
    {"name": "myslik_ping", "fn": _t_ping, "schema": _NO_ARGS, "title": "Связь", "ann": _RO,
     "desc": "Проверить связь: открыто ли приложение, какой граф активен, сколько в нём нод."},
]
_BY_NAME = {t["name"]: t for t in TOOLS}

# РЕСУРСЫ (M9): правила как документ — клиент может держать их в контексте и не тратить вызов.
# Текст берётся у приложения (cmdPrompt), не хранится здесь: правила одни на всех.
RESOURCES = [
    {"uri": "myslik://rules", "name": "Правила пакета", "mimeType": "text/plain", "topic": None,
     "description": "Формат пакета команд Мыслика: операции, виды нод, статусы, как строить ветку."},
    {"uri": "myslik://rules/draw", "name": "Правила схемы на полотне", "mimeType": "text/plain", "topic": "draw",
     "description": "Как рисовать схему на полотне (op draw): блоки, стрелки, раскладка."},
]

# ПРОМПТЫ (M8): готовые сценарии планера — в Claude Code они становятся слэш-командами. Текст —
# инструкция агенту, какими инструментами и в каком порядке пройти сценарий; данных в нём нет.
PROMPTS = [
    {"name": "plan_project", "title": "Разложить проект",
     "description": "Разложить цель или проект в ветку задач Мыслика: этапы, шаги, сроки.",
     "arguments": [{"name": "goal", "description": "Что за проект и к какому сроку", "required": True}],
     "text": ("Разложи проект в моём планере Мыслик. Проект: {goal}\n\n"
              "1. Вызови myslik_rules — формат пакета и правила веток.\n"
              "2. myslik_search по ключевым словам проекта: возможно, ветка уже есть — тогда дополняй её, а не создавай вторую.\n"
              "3. Собери пакет: корень с областью, этапы, внутри этапов последовательные шаги цепочкой; сроки — только если они "
              "следуют из моих слов.\n4. myslik_preview, покажи мне, что получится, и только после моего «да» — myslik_apply по token.")},
    {"name": "weekly_review", "title": "Обзор недели",
     "description": "Недельный обзор: что просрочено, что горит, что на неделе — и предложения, что перенести или закрыть.",
     "arguments": [],
     "text": ("Сделай обзор недели по моему планеру Мыслик.\n\n"
              "1. myslik_agenda range=overdue и range=week, затем range=hot.\n"
              "2. Коротко: что просрочено и насколько, что горит и почему (поле why), что на неделе по дням.\n"
              "3. Предложи, что перенести, что разбить, что закрыть. Ничего не меняй сам — сначала спроси меня; "
              "правки потом одним пакетом через myslik_preview и myslik_apply.")},
    {"name": "inbox_triage", "title": "Разобрать неразобранное",
     "description": "Разобрать ноды без области и без родителя: куда повесить, что сделать задачей, что заметкой.",
     "arguments": [],
     "text": ("Помоги разобрать неразобранное в моём планере Мыслик.\n\n"
              "1. myslik_snapshot с fields id,kind,title,parent,area,status и limit 200 — найди ноды без родителя и без области.\n"
              "2. Для каждой предложи: под какую ветку повесить (myslik_search по смыслу), задача это или заметка, нужен ли срок.\n"
              "3. Покажи список предложений одной таблицей и после моего «да» примени одним пакетом (link и edit) через "
              "myslik_preview и myslik_apply.")},
]


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
            "capabilities": {"tools": {}, "prompts": {}, "resources": {}},
            "serverInfo": {"name": "myslik", "version": SERVER_VERSION}}}
    if method in ("notifications/initialized", "notifications/cancelled"):
        return None                     # уведомления ответа не требуют — на них нельзя отвечать вовсе
    if method == "ping":
        return {"jsonrpc": "2.0", "id": mid, "result": {}}
    if method == "resources/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"resources": [
            {k: v for k, v in r.items() if k != "topic"} for r in RESOURCES]}}
    if method == "resources/templates/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"resourceTemplates": []}}
    if method == "resources/read":
        uri = (msg.get("params") or {}).get("uri")
        r = next((x for x in RESOURCES if x["uri"] == uri), None)
        if not r:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32002, "message": "нет такого ресурса: %s" % uri}}
        text = _t_rules({"topic": r["topic"]} if r["topic"] else {})
        if not isinstance(text, str):           # приложение не ответило — честно говорим почему
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": (text or {}).get("error") or NOT_READY}}
        return {"jsonrpc": "2.0", "id": mid, "result": {"contents": [
            {"uri": uri, "mimeType": "text/plain", "text": text}]}}
    if method == "prompts/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"prompts": [
            {k: v for k, v in pr.items() if k != "text"} for pr in PROMPTS]}}
    if method == "prompts/get":
        p = msg.get("params") or {}
        pr = next((x for x in PROMPTS if x["name"] == p.get("name")), None)
        if not pr:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": -32602, "message": "нет такого промпта: %s" % p.get("name")}}
        args = p.get("arguments") or {}
        text = pr["text"].format(**{a["name"]: (args.get(a["name"]) or "").strip() or "—" for a in pr.get("arguments", [])})
        return {"jsonrpc": "2.0", "id": mid, "result": {"description": pr["description"],
                "messages": [{"role": "user", "content": {"type": "text", "text": text}}]}}
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": mid, "result": {"tools": [
            {"name": t["name"], "title": t.get("title", t["name"]), "description": t["desc"],
             "inputSchema": t["schema"],
             "annotations": dict(t.get("ann", {}), title=t.get("title", t["name"]))} for t in TOOLS]}}
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
        if isinstance(res, str):
            text = res
        elif t.get("tight"):
            # снимок читает машина, а не человек: отступы на четырёхстах нодах — это четыре
            # тысячи лишних строк и заметная часть объёма ответа (замер — docs/ПЛАН-MCP.md)
            text = json.dumps(res, ensure_ascii=False, separators=(",", ":"))
        else:
            text = json.dumps(res, ensure_ascii=False, indent=1)
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
        if not isinstance(msg, dict):
            # массив (пакет JSON-RPC) или голое значение: отвечать некому — id нет, а пакеты
            # из протокола убраны в 2025-06-18. Раньше это давало -32603 с внутренней ошибкой.
            _write({"jsonrpc": "2.0", "id": None,
                    "error": {"code": -32600, "message": "ожидается объект JSON-RPC"}}, out)
            continue
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
