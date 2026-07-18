# -*- coding: utf-8 -*-
"""
ai.py — локальный ИИ-слой Мыслика (умный захват).

Задача: превратить сырую мысль ("завтра надо намыть жопу") в чистую ноду
(заголовок "Намыть жопу", вид/приоритет/дата, длинный текст → в описание).

Движок: llama-cpp-python (лёгкая CPU-сборка, ~6 МБ DLL в llama_cpp/lib/).
Модель: Qwen3-0.6B (новое поколение — крохотная, но не тупая; на CPU ~0.5с).
Форс-JSON (грамматика по схеме) гарантирует валидный ответ и заодно глушит
«размышления» Qwen3 (<think>): грамматика заставляет начать с '{'.

ПРИНЦИПЫ:
  * Всё опционально и graceful. Нет пакета llama-cpp-python или файла модели —
    status() честно вернёт available:false, и Мыслик работает как раньше.
  * Модель живёт РЯДОМ с приложением (папка ai/, путь из app.py), не в exe.
  * Python «тупой»: зовёт модель, отдаёт строгий JSON. Резолв даты и приоритета —
    на фронте (ui/js/ai.js) через свои же хелперы.
  * Ленивая загрузка (при первом захвате), не на старте.
  * На время генерации класс приоритета процесса → BELOW_NORMAL (уступаем
    активной работе). Для 0.6B нагрузка и так копеечная, но пусть будет вежливо.
"""
import os
import json
import threading

try:
    from llama_cpp import Llama
    _HAS_ENGINE = True
except Exception as _e:  # движок не установлен — нормальный, ожидаемый путь (ИИ просто выключен)
    Llama = None
    _HAS_ENGINE = False
    _IMPORT_ERR = repr(_e)
else:
    _IMPORT_ERR = ""

# ---- конфигурация ----
_MODEL_DIR = None
_MODEL_PATH = None
_LLM = None
_LOAD_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()   # модель не потокобезопасна — захваты сериализуем
_LOAD_ERR = ""

_N_CTX = 2048
_MAX_TOKENS = 320
_TEMPERATURE = 0.2
# 0.6B и на 2 потоках отвечает за ~0.5с; потолок 4, чтобы не занимать лишние ядра.
_MAX_THREADS = 4

_PRIOS = ("high", "medium", "low", "none")
_WHENS = ("", "today", "tomorrow", "day_after", "mon", "tue", "wed", "thu", "fri", "sat", "sun")

# JSON-схема ответа. llama.cpp строит из неё грамматику и ПРИНУДИТЕЛЬНО гонит вывод
# в валидный JSON нужной формы (и попутно не даёт Qwen3 «думать вслух»).
_SCHEMA = {
    "type": "object",
    "properties": {
        "title":    {"type": "string"},
        "kind":     {"type": "string", "enum": ["task", "note"]},
        "priority": {"type": "string", "enum": ["high", "medium", "low", "none"]},
        "when":     {"type": "string", "enum": list(_WHENS)},
        "body":     {"type": "string"},
    },
    "required": ["title", "kind", "priority", "when", "body"],
}

# /no_think — второй пояс: явно просим Qwen3 не размышлять (грамматика и так глушит).
_INSTRUCT = (
    "/no_think\n"
    "Ты — часть личного планировщика «Мыслик». Пользователь бросает сырую мысль "
    "на русском. Верни ТОЛЬКО JSON-объект с полями:\n"
    "- title: короткий чистый заголовок для узла на графе, на русском, в форме "
    "дела. УБЕРИ служебные слова «срочно», «надо», «нужно», «завтра», «сегодня» "
    "— они уходят в другие поля, не в заголовок.\n"
    "- kind: \"task\" если это действие/дело, \"note\" если мысль, идея, факт.\n"
    "- priority: \"high\" при явной срочности («срочно», «горит», «важно»); "
    "иначе \"none\". Не придумывай срочность на пустом месте.\n"
    "- when: относительная дата ОДНИМ токеном если названа: \"today\", "
    "\"tomorrow\", \"day_after\", \"mon\"..\"sun\". Если даты нет — \"\". "
    "Не вычисляй календарные числа.\n"
    "- body: если мысль длинная — полный текст-подробности сюда; если короткая — \"\".\n"
    "Не выдумывай фактов, которых нет во вводе."
)

_FEWSHOT = [
    ("срочно сделать дело",
     {"title": "Сделать дело", "kind": "task", "priority": "high", "when": "", "body": ""}),
    ("завтра надо намыть жопу",
     {"title": "Намыть жопу", "kind": "task", "priority": "none", "when": "tomorrow", "body": ""}),
    ("глянуть в пятницу почту по договору",
     {"title": "Глянуть почту по договору", "kind": "task", "priority": "none", "when": "fri", "body": ""}),
    ("мысль: свет в ролике МТС слишком холодный, надо на этапе цвета прогреть "
     "тени и вытянуть кожу, глянуть рефы с прошлой съёмки",
     {"title": "Прогреть свет в ролике МТС", "kind": "note", "priority": "none", "when": "",
      "body": "Свет слишком холодный. На этапе цвета прогреть тени и вытянуть кожу. "
              "Глянуть рефы с прошлой съёмки."}),
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


def init(model_dir):
    """Задать папку с моделью (*.gguf). Файл модели тут НЕ грузится."""
    global _MODEL_DIR, _MODEL_PATH
    _MODEL_DIR = model_dir
    _MODEL_PATH = _find_model(model_dir)
    return {"model_dir": model_dir, "model_path": _MODEL_PATH, "engine": bool(_HAS_ENGINE)}


def _find_model(model_dir):
    try:
        if not model_dir or not os.path.isdir(model_dir):
            return None
        ggufs = sorted(f for f in os.listdir(model_dir) if f.lower().endswith(".gguf"))
        return os.path.join(model_dir, ggufs[0]) if ggufs else None
    except Exception:
        return None


def status():
    """Быстрая проверка без загрузки модели. available:true = движок стоит И файл
    модели найден (грузиться будет при первом захвате)."""
    model_path = _MODEL_PATH or _find_model(_MODEL_DIR)
    reason = ""
    if not _HAS_ENGINE:
        reason = "no_engine"
    elif not model_path:
        reason = "no_model"
    elif _LOAD_ERR:
        reason = "load_error"
    return {
        "available": bool(_HAS_ENGINE and model_path and not _LOAD_ERR),
        "reason": reason,
        "engine": bool(_HAS_ENGINE),
        "model": os.path.basename(model_path) if model_path else "",
        "loaded": _LLM is not None,
        "detail": _LOAD_ERR or _IMPORT_ERR,
    }


def _get_llm():
    """Ленивая загрузка модели под замком (первый захват платит ~1-2с на загрузку)."""
    global _LLM, _LOAD_ERR
    if _LLM is not None:
        return _LLM
    if not _HAS_ENGINE:
        return None
    with _LOAD_LOCK:
        if _LLM is not None:
            return _LLM
        path = _MODEL_PATH or _find_model(_MODEL_DIR)
        if not path or not os.path.exists(path):
            _LOAD_ERR = "model file not found"
            return None
        try:
            n_threads = max(2, min(_MAX_THREADS, (os.cpu_count() or 4) // 2))
            _LLM = Llama(
                model_path=path,
                n_ctx=_N_CTX,
                n_threads=n_threads,
                n_gpu_layers=0,       # CPU-сборка; для GPU-пака тут будет -1 (отдельный движок)
                verbose=False,
            )
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
    """Сырой текст → предложение-карточка (dict) ИЛИ {'ok': False, ...}.
    Резолв 'when'→дата и 'priority'→0..3 делает фронт (ui/js/ai.js)."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty"}
    llm = _get_llm()
    if llm is None:
        return {"ok": False, "error": "unavailable", "detail": _LOAD_ERR or _IMPORT_ERR}
    try:
        with _INFER_LOCK:
            _set_priority(True)
            try:
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

    # Санитизация: заголовок никогда не пустой; значения — только из допустимых.
    title = (data.get("title") or "").strip() or text[:60].strip()
    kind = data.get("kind") if data.get("kind") in ("task", "note") else "task"
    priority = data.get("priority") if data.get("priority") in _PRIOS else "none"
    when = data.get("when") if data.get("when") in _WHENS else ""
    body = (data.get("body") or "").strip()
    if body and body.strip().lower() == title.strip().lower():
        body = ""
    return {
        "ok": True, "title": title, "kind": kind, "priority": priority,
        "when": when, "body": body, "raw": text,
    }
