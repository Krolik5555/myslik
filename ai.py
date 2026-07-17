# -*- coding: utf-8 -*-
"""
ai.py — локальный ИИ-слой Мыслика (умный захват).

Задача: превратить сырую мысль ("завтра надо намыть жопу") в чистую ноду
(заголовок "Намыть жопу", вид/приоритет/дата, длинный текст → в описание).

ПРИНЦИПЫ:
  * Всё опционально и graceful. Нет пакета gpt4all или файла модели — status()
    честно вернёт available:false, и Мыслик работает ровно как раньше.
  * Модель живёт РЯДОМ с приложением (папка ai/, путь передаётся из app.py, тот
    же приём, что и data/), в exe НЕ зашивается.
  * Python тут «тупой»: только зовёт модель и отдаёт строгий JSON. Резолв
    относительной даты в реальное число и приоритета в 0..3 делает фронт
    (ui/js/ai.js) через свои же хелперы — чтобы не дублировать логику дат.
  * Модель грузится ЛЕНИВО (при первом захвате), не на старте.

Движок: gpt4all (обёртка над llama.cpp с готовыми бинарями на PyPI). Модель —
любой *.gguf в папке ai/ (по умолчанию Qwen2.5-1.5B-Instruct — лёгкая, хорошо
знает русский). Форс-JSON у gpt4all нет, поэтому надёжность даёт связка
низкой температуры + few-shot примеров + аккуратный разбор {…} с одной повторной
попыткой.
"""
import os
import re
import json
import threading

try:
    from gpt4all import GPT4All
    _HAS_ENGINE = True
except Exception as _e:  # пакет не установлен — нормальный, ожидаемый путь
    GPT4All = None
    _HAS_ENGINE = False
    _IMPORT_ERR = repr(_e)
else:
    _IMPORT_ERR = ""

# ---- конфигурация ----
_MODEL_DIR = None          # папка, где искать *.gguf (задаётся init())
_MODEL_PATH = None         # найденный файл модели
_LLM = None                # ленивый singleton модели
_LOAD_LOCK = threading.Lock()
_INFER_LOCK = threading.Lock()   # модель не потокобезопасна — захваты сериализуем
_LOAD_ERR = ""

# Ограничения под «средний ПК»: маленький контекст, короткий ответ, низкая
# температура (нужна предсказуемость, а не фантазия), CPU-only.
_N_CTX = 2048
_MAX_TOKENS = 320
_TEMPERATURE = 0.2

# набор допустимых значений (для санитизации ответа)
_PRIOS = ("high", "medium", "low", "none")
_WHENS = ("", "today", "tomorrow", "day_after", "mon", "tue", "wed", "thu", "fri", "sat", "sun")

_INSTRUCT = (
    "Ты — часть личного планировщика «Мыслик». Пользователь бросает сырую мысль "
    "на русском. Верни ТОЛЬКО JSON-объект (без пояснений) с полями:\n"
    "- title: короткий чистый заголовок для узла на графе, на русском, в форме "
    "дела. УБЕРИ служебные слова «срочно», «надо», «нужно», «завтра», «сегодня» "
    "— они уходят в другие поля, а не в заголовок.\n"
    "- kind: \"task\" если это действие/дело, \"note\" если мысль, идея, факт.\n"
    "- priority: \"high\" при явной срочности («срочно», «горит», «важно»); "
    "иначе \"none\". Не придумывай срочность на пустом месте.\n"
    "- when: относительная дата ОДНИМ токеном если названа: \"today\", "
    "\"tomorrow\", \"day_after\", \"mon\"..\"sun\". Если даты нет — \"\". "
    "Не вычисляй календарные числа.\n"
    "- body: если мысль длинная — полный текст-подробности сюда; если короткая — "
    "\"\".\n"
    "Не выдумывай фактов, которых нет во вводе."
)

# few-shot: крохотные модели резко надёжнее с примерами (и формат JSON фиксируют)
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


def init(model_dir):
    """Задать папку с моделью (*.gguf). Файл модели тут НЕ грузится."""
    global _MODEL_DIR, _MODEL_PATH
    _MODEL_DIR = model_dir
    _MODEL_PATH = _find_model(model_dir)
    return {"model_dir": model_dir, "model_path": _MODEL_PATH}


def _find_model(model_dir):
    try:
        if not model_dir or not os.path.isdir(model_dir):
            return None
        ggufs = sorted(f for f in os.listdir(model_dir) if f.lower().endswith(".gguf"))
        return os.path.join(model_dir, ggufs[0]) if ggufs else None
    except Exception:
        return None


def status():
    """Быстрая проверка без загрузки модели. available:true = движок стоит И
    файл модели найден (грузиться будет при первом захвате)."""
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
    """Ленивая загрузка модели под замком (первый захват платит ~секунды)."""
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
            n_threads = max(2, (os.cpu_count() or 4) // 2)  # половина ядер — не душим ПК
            _LLM = GPT4All(
                model_name=os.path.basename(path),
                model_path=os.path.dirname(path),
                allow_download=False,     # ничего не тянем из сети — только локальный файл
                device="cpu",             # CPU-only: предсказуемо, не спорит с творческим софтом
                ngl=0,
                n_ctx=_N_CTX,
                n_threads=n_threads,
                verbose=False,
            )
            _LOAD_ERR = ""
        except Exception as e:
            _LOAD_ERR = repr(e)
            _LLM = None
    return _LLM


def _build_user_prompt(text):
    """Инструкция + few-shot примеры + сама мысль — одним пользовательским ходом."""
    lines = [_INSTRUCT, "", "Примеры:"]
    for raw, out in _FEWSHOT:
        lines.append("Ввод: " + raw)
        lines.append("Ответ: " + json.dumps(out, ensure_ascii=False))
    lines.append("")
    lines.append("Ввод: " + text)
    lines.append("Ответ:")
    return "\n".join(lines)


# Нативный ChatML Qwen — чтобы модель получала свой формат, а не дефолтный шаблон gpt4all.
_SYS = "<|im_start|>system\nТы аккуратный ассистент, отвечаешь только валидным JSON.<|im_end|>\n"
_TMPL = "<|im_start|>user\n{0}<|im_end|>\n<|im_start|>assistant\n"


def _extract_json(s):
    """Достать первый {...}-объект из ответа модели (на случай лишнего текста)."""
    if not s:
        return None
    s = s.replace("<|im_end|>", "").strip()
    m = re.search(r"\{.*\}", s, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


def _run(llm, text):
    prompt = _build_user_prompt(text)
    with _INFER_LOCK:
        with llm.chat_session(system_prompt=_SYS, prompt_template=_TMPL):
            out = llm.generate(
                prompt, max_tokens=_MAX_TOKENS, temp=_TEMPERATURE,
                top_k=40, top_p=0.9, repeat_penalty=1.1,
            )
    return out


def capture(text):
    """Сырой текст → предложение-карточка (dict) ИЛИ {'ok': False, ...}.
    Резолв 'when'→дата и 'priority'→0..3 делает фронт (ui/js/ai.js)."""
    text = (text or "").strip()
    if not text:
        return {"ok": False, "error": "empty"}
    llm = _get_llm()
    if llm is None:
        return {"ok": False, "error": "unavailable", "detail": _LOAD_ERR or _IMPORT_ERR}
    data = None
    try:
        data = _extract_json(_run(llm, text))
        if data is None:                       # одна повторная попытка при кривом JSON
            data = _extract_json(_run(llm, text))
    except Exception as e:
        return {"ok": False, "error": "infer", "detail": repr(e)}
    if not isinstance(data, dict):
        return {"ok": False, "error": "parse"}

    # Санитизация: приводим к безопасным значениям; заголовок никогда не пустой.
    title = (data.get("title") or "").strip() or text[:60].strip()
    kind = data.get("kind") if data.get("kind") in ("task", "note") else "task"
    priority = data.get("priority") if data.get("priority") in _PRIOS else "none"
    when = data.get("when") if data.get("when") in _WHENS else ""
    body = (data.get("body") or "").strip()
    if body and body.strip().lower() == title.strip().lower():
        body = ""                              # модель продублировала заголовок в body — выкинуть
    return {
        "ok": True, "title": title, "kind": kind, "priority": priority,
        "when": when, "body": body, "raw": text,
    }
