# -*- coding: utf-8 -*-
"""
ai.py — локальный ИИ-слой Мыслика (умный захват).

Задача: превратить сырую мысль ("завтра надо намыть жопу") в чистую ноду
(заголовок "Намыть жопу", вид/приоритет/дата, длинный текст → в описание).

Модель: Qwen3-0.6B (крохотная, но не тупая; форс-JSON по грамматике).
Движок: llama-cpp-python, но НЕ из pip, а из «паков» рядом с приложением:
    ai/engine-cpu/     — CPU-сборка (~9 МБ), работает у всех
    ai/engine-vulkan/  — GPU-Vulkan (~76 МБ), любая видеокарта
Выбор движка хранится в ai/ai_config.json ({"backend":"cpu"|"gpu"}). Смена
применяется при перезапуске (нативные DLL нельзя переподменить в живом процессе).

ПРИНЦИПЫ: всё опционально/graceful (нет пака или модели — ИИ выключен, Мыслик
работает как раньше); модель и движки рядом с приложением, не в exe; Python
только зовёт модель и отдаёт строгий JSON (резолв даты/приоритета — на фронте).
"""
import os
import sys
import json
import threading

# backend -> (папка пака, n_gpu_layers, человекочитаемое имя)
_BACKENDS = {
    "cpu": {"dir": "engine-cpu",    "ngl": 0,  "label": "CPU"},
    "gpu": {"dir": "engine-vulkan", "ngl": -1, "label": "GPU (Vulkan)"},
}

_AI_DIR = None
_ACTIVE_MODEL = None              # путь модели, реально загруженной в этой сессии
_LLM = None
_ACTIVE_BACKEND = None            # движок, реально загруженный в этой сессии
_LOAD_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()
_LOAD_ERR = ""

_N_CTX = 2048
_MAX_TOKENS = 320
_TEMPERATURE = 0.2
_MAX_THREADS = 4

_PRIOS = ("high", "medium", "low", "none")
_WHENS = ("", "today", "tomorrow", "day_after", "mon", "tue", "wed", "thu", "fri", "sat", "sun")

_SCHEMA = {
    "type": "object",
    "properties": {
        "title":    {"type": "string"},
        "kind":     {"type": "string", "enum": ["task", "note"]},
        "priority": {"type": "string", "enum": ["high", "medium", "low", "none"]},
        "when":     {"type": "string", "enum": list(_WHENS)},
    },
    "required": ["title", "kind", "priority", "when"],
}

# Заголовок срезал >= стольких символов → полный текст храним ДОСЛОВНО в описание.
_KEEP_DIFF = 15

_INSTRUCT = (
    "/no_think\n"
    "Ты — часть личного планировщика «Мыслик». Пользователь бросает сырую мысль "
    "на русском. Верни ТОЛЬКО JSON-объект с полями:\n"
    "- title: короткий чистый заголовок для узла на графе, на русском, в форме "
    "дела. УБЕРИ служебные слова «срочно», «надо», «нужно», «завтра», «сегодня».\n"
    "- kind: по умолчанию \"task\" — если это действие, дело или ПРАВКА (убери, "
    "поправь, сделай, добавь, приглуши, купи, позвони). \"note\" — для мысли, идеи, "
    "наблюдения; в частности если начинается со слов «идея», «мысль», «а что если», "
    "«подумать».\n"
    "- priority: \"high\" при явной срочности («срочно», «горит», «важно»); иначе "
    "\"none\". Не придумывай срочность на пустом месте.\n"
    "- when: относительная дата ОДНИМ токеном ТОЛЬКО если явно названо слово-дата "
    "(«сегодня»→today, «завтра»→tomorrow, «послезавтра»→day_after, день недели→mon..sun). "
    "ВАЖНО: «срочно», «важно», «горит» — это priority, а НЕ дата, при них when=\"\". "
    "Нет слова-даты — when=\"\". Календарь не вычисляй.\n"
    "Заголовок — МАКСИМУМ 3–4 слова, только САМАЯ СУТЬ (о чём это). ВЫБРОСЬ числа, "
    "суммы, проценты, названия организаций, второстепенные детали — они уже в "
    "описании. Не пересказывай мысль, назови её сутью. Полный текст сохранится "
    "отдельно сам.\n"
    "Не выдумывай фактов, которых нет во вводе."
)

_FEWSHOT = [
    ("срочно сделать дело",
     {"title": "Сделать дело", "kind": "task", "priority": "high", "when": ""}),
    ("завтра надо намыть жопу",
     {"title": "Намыть жопу", "kind": "task", "priority": "none", "when": "tomorrow"}),
    ("глянуть в пятницу почту по договору",
     {"title": "Глянуть почту по договору", "kind": "task", "priority": "none", "when": "fri"}),
    ("Внутрянка портала - убери космос либо приглуши цвет в ещё более тёмный",
     {"title": "Портал: убрать космос", "kind": "task", "priority": "none", "when": ""}),
    ("мысль: свет в ролике МТС слишком холодный, надо на этапе цвета прогреть "
     "тени и вытянуть кожу, глянуть рефы с прошлой съёмки",
     {"title": "Прогреть свет в ролике МТС", "kind": "note", "priority": "none", "when": ""}),
    ("Авторы «Смуты» анонсировали новую игру «Земский собор: Решающий выбор» — ИРИ "
     "выделили на игру 250 млн рублей. Дату релиза не назвали.",
     {"title": "Новая игра «Земский собор»", "kind": "note", "priority": "none", "when": ""}),
]


def _set_priority(low):
    """Windows: понизить/вернуть класс приоритета процесса на время инференса."""
    try:
        import ctypes
        BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
        NORMAL_PRIORITY_CLASS = 0x00000020
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(),
                           BELOW_NORMAL_PRIORITY_CLASS if low else NORMAL_PRIORITY_CLASS)
    except Exception:
        pass


# ---------- пути / конфиг / бэкенды ----------
def _config_path():
    return os.path.join(_AI_DIR, "ai_config.json") if _AI_DIR else None


def _load_config():
    try:
        with open(_config_path(), "r", encoding="utf-8") as f:
            d = json.load(f)
            return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _save_config(patch):
    cfg = _load_config()
    cfg.update(patch)
    try:
        with open(_config_path(), "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False)
        return True
    except Exception:
        return False


def _read_backend():
    b = _load_config().get("backend")
    return b if b in _BACKENDS else "cpu"


def set_backend(name):
    """Сменить движок (применится при перезапуске)."""
    if name not in _BACKENDS:
        return {"ok": False, "error": "unknown_backend"}
    if not _backend_installed(name):
        return {"ok": False, "error": "not_installed"}
    if not _save_config({"backend": name}):
        return {"ok": False, "error": "write"}
    return {"ok": True, "backend": name,
            "restart_required": bool(_ACTIVE_BACKEND and _ACTIVE_BACKEND != name)}


def _engine_dir(backend):
    return os.path.join(_AI_DIR, _BACKENDS[backend]["dir"]) if _AI_DIR else None


def _backend_installed(backend):
    d = _engine_dir(backend)
    return bool(d and os.path.isfile(os.path.join(d, "llama_cpp", "__init__.py")))


def _available_backends():
    return [b for b in _BACKENDS if _backend_installed(b)]


# ---- модели: файлы .gguf в ai/models/ ----
def _models_dir():
    return os.path.join(_AI_DIR, "models") if _AI_DIR else None


def list_models():
    """Список установленных моделей (файлов .gguf в ai/models/) с размерами."""
    d = _models_dir()
    out = []
    try:
        for f in sorted(os.listdir(d)):
            if f.lower().endswith(".gguf"):
                try:
                    sz = os.path.getsize(os.path.join(d, f))
                except Exception:
                    sz = 0
                out.append({"name": f, "size": sz})
    except Exception:
        pass
    return out


def _selected_model_path():
    """Путь к выбранной модели: из конфига, иначе первая установленная."""
    d = _models_dir()
    if not d:
        return None
    want = _load_config().get("model")
    if want and os.path.isfile(os.path.join(d, want)):
        return os.path.join(d, want)
    ms = list_models()
    return os.path.join(d, ms[0]["name"]) if ms else None


def set_model(name):
    """Выбрать активную модель (применится при перезапуске)."""
    d = _models_dir()
    if not name or not d or not os.path.isfile(os.path.join(d, name)):
        return {"ok": False, "error": "not_found"}
    if not _save_config({"model": name}):
        return {"ok": False, "error": "write"}
    active = os.path.basename(_ACTIVE_MODEL) if _ACTIVE_MODEL else None
    return {"ok": True, "model": name, "restart_required": bool(active and active != name)}


def delete_model(name):
    """Удалить файл модели. Активную загруженную удалить нельзя (замаплена) — нужен перезапуск."""
    d = _models_dir()
    if not name or not d:
        return {"ok": False, "error": "bad"}
    path = os.path.join(d, name)
    if not os.path.isfile(path):
        return {"ok": False, "error": "not_found"}
    if _ACTIVE_MODEL and os.path.basename(_ACTIVE_MODEL) == name:
        return {"ok": False, "error": "loaded"}
    try:
        os.remove(path)
        # если удалили выбранную — сбрасываем выбор (возьмётся первая доступная)
        if _load_config().get("model") == name:
            _save_config({"model": None})
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": "locked", "detail": repr(e)}


def init(ai_dir):
    """Задать папку ai/ (модели + паки движков). Ничего тяжёлого не грузим."""
    global _AI_DIR
    _AI_DIR = ai_dir
    return {"ai_dir": ai_dir, "models": list_models(),
            "backends": _available_backends(), "backend": _read_backend()}


def status():
    """Быстрая проверка без загрузки. available:true = есть хотя бы один пак движка
    И файл модели."""
    sel = _selected_model_path()
    sel_name = os.path.basename(sel) if sel else ""
    active_model = os.path.basename(_ACTIVE_MODEL) if _ACTIVE_MODEL else None
    avail = _available_backends()
    want = _read_backend()
    reason = ""
    if not avail:
        reason = "no_engine"
    elif not sel:
        reason = "no_model"
    elif _LOAD_ERR:
        reason = "load_error"
    return {
        "available": bool(avail and sel and not _LOAD_ERR),
        "reason": reason,
        "model": sel_name,               # выбранная модель
        "models": list_models(),         # все установленные
        "active_model": active_model,    # реально загруженная в этой сессии
        "backends": avail,               # какие паки движка стоят
        "backend": want,                 # выбранный движок
        "active": _ACTIVE_BACKEND,       # загруженный движок
        "restart_required": bool((_ACTIVE_BACKEND and _ACTIVE_BACKEND != want)
                                 or (active_model and active_model != sel_name)),
        "loaded": _LLM is not None,
        "detail": _LOAD_ERR,
    }


def _get_llm():
    """Ленивая загрузка: выбрать движок по конфигу, подцепить его DLL, загрузить модель."""
    global _LLM, _LOAD_ERR, _ACTIVE_BACKEND, _ACTIVE_MODEL
    if _LLM is not None:
        return _LLM
    with _LOAD_LOCK:
        if _LLM is not None:
            return _LLM
        backend = _read_backend()
        if not _backend_installed(backend):
            av = _available_backends()
            if not av:
                _LOAD_ERR = "no engine installed"
                return None
            backend = av[0]                      # выбранного пака нет — берём любой доступный
        path = _selected_model_path()
        if not path or not os.path.exists(path):
            _LOAD_ERR = "model file not found"
            return None
        eng = _engine_dir(backend)
        try:
            if eng not in sys.path:
                sys.path.insert(0, eng)          # llama_cpp берём из этого пака
            os.environ["LLAMA_CPP_LIB_PATH"] = os.path.join(eng, "llama_cpp", "lib")
            from llama_cpp import Llama
            n_threads = max(2, min(_MAX_THREADS, (os.cpu_count() or 4) // 2))
            _LLM = Llama(
                model_path=path,
                n_ctx=_N_CTX,
                n_threads=n_threads,
                n_gpu_layers=_BACKENDS[backend]["ngl"],
                verbose=False,
            )
            _ACTIVE_BACKEND = backend
            _ACTIVE_MODEL = path
            _LOAD_ERR = ""
        except Exception as e:
            _LOAD_ERR = repr(e)
            _LLM = None
    return _LLM


def _messages(text):
    msgs = [{"role": "system", "content": _INSTRUCT}]
    for raw, out in _FEWSHOT:
        msgs.append({"role": "user", "content": raw})
        msgs.append({"role": "assistant", "content": json.dumps(out, ensure_ascii=False)})
    msgs.append({"role": "user", "content": text})
    return msgs


def capture(text):
    """Сырой текст → предложение-карточка (dict) ИЛИ {'ok': False, ...}."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty"}
    # мусор/случайный ввод: если букв почти нет — не зовём модель. Иначе на
    # бессмысленном вводе крохотная модель копирует пример из few-shot («Земский собор»).
    if sum(1 for c in text if c.isalpha()) < 3:
        return {"ok": False, "error": "junk"}
    llm = _get_llm()
    if llm is None:
        return {"ok": False, "error": "unavailable", "detail": _LOAD_ERR}
    try:
        with _INFER_LOCK:
            _set_priority(True)
            try:
                try:
                    llm.reset()        # чистим KV-кэш: ответ прошлого запроса не должен течь в этот
                except Exception:
                    pass
                resp = llm.create_chat_completion(
                    messages=_messages(text),
                    response_format={"type": "json_object", "schema": _SCHEMA},
                    temperature=_TEMPERATURE,
                    max_tokens=_MAX_TOKENS,
                )
            finally:
                _set_priority(False)
        data = json.loads(resp["choices"][0]["message"]["content"])
    except Exception as e:
        return {"ok": False, "error": "infer", "detail": repr(e)}
    if not isinstance(data, dict):
        return {"ok": False, "error": "parse"}

    title = (data.get("title") or "").strip() or text[:60].strip()
    kind = data.get("kind") if data.get("kind") in ("task", "note") else "task"
    priority = data.get("priority") if data.get("priority") in _PRIOS else "none"
    when = data.get("when") if data.get("when") in _WHENS else ""
    # Заголовок срезал заметный кусок → полный текст в описание ДОСЛОВНО.
    body = text if (len(text) - len(title) >= _KEEP_DIFF) else ""
    return {
        "ok": True, "title": title, "kind": kind, "priority": priority,
        "when": when, "body": body, "raw": text,
    }
