# -*- coding: utf-8 -*-
"""
planner — KROLIK edition
Нативное desktop-окно (pywebview / WebView2). UI лежит в ui/.
Данные: data/planner.json, авто-бэкапы: data/backups/.
"""
import os
import sys
import json
import time
import shutil
import threading
import datetime
import ctypes

import webview

# tray icon (optional — gracefully skip if missing)
try:
    import pystray
    from PIL import Image
    _HAS_TRAY = True
except Exception:
    _HAS_TRAY = False

# локальный ИИ-слой (умный захват) — ПОЛНОСТЬЮ опционален. Нет модуля/движка/модели —
# просто работаем как раньше. Импорт под try, чтобы даже сломанный ai.py не ронял приложение.
try:
    import ai as ai_mod
except Exception as _e:
    ai_mod = None
    print("[ai] module not loaded:", _e)

# Пути: в собранном exe (PyInstaller) ресурсы (ui/) лежат в бандле (_MEIPASS, read-only),
# а данные пишем РЯДОМ С EXE (портативно: переносишь папку — заметки с тобой).
if getattr(sys, "frozen", False):
    _UI_BASE = os.path.join(sys._MEIPASS, "ui")
    _DATA_BASE = os.path.dirname(sys.executable)
else:
    _ROOT = os.path.dirname(os.path.abspath(__file__))
    _UI_BASE = os.path.join(_ROOT, "ui")
    _DATA_BASE = _ROOT
UI = os.path.join(_UI_BASE, "index.html")
DATA_DIR = os.path.join(_DATA_BASE, "data")
DATA_FILE = os.path.join(DATA_DIR, "planner.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
MAX_BACKUPS = 30
# Папка ИИ — РЯДОМ с приложением (портативно, как data/), в exe НЕ зашивается.
# Внутри: models/ (файлы моделей .gguf), engine-cpu/, engine-vulkan/ (движки).
AI_DIR = os.path.join(_DATA_BASE, "ai")

# Каталог скачиваемых моделей. HOST-AGNOSTIC: сейчас — прямые ссылки на ОФИЦИАЛЬНЫЕ
# HuggingFace-репозитории (ничего никуда заливать не надо, лимитов нет, HF работает
# под DPI, в отличие от GitHub-релизов с их лимитом 2 ГБ/файл). Захочешь свой
# хостинг/зеркало — поменяй только url. Модели по умолчанию НЕ качаются: только по
# кнопке пользователя. Порядок = от лёгкой к тяжёлой.
_HF = "https://huggingface.co"
# Каталог локальных моделей: намеренно ДВЕ — минимально допустимая и средняя
# (по просьбе КРОЛИКа: «оставим 2 модели — среднюю и минимально допустимую»).
AI_MODEL_CATALOG = [
    {"name": "Qwen3-0.6B-Q8_0.gguf", "size": 639446688, "title": "Qwen3 0.6B",
     "tier": "Минимальная", "note": "Для слабых ПК. Быстрая и лёгкая, заголовки попроще.",
     "url": _HF + "/Qwen/Qwen3-0.6B-GGUF/resolve/main/Qwen3-0.6B-Q8_0.gguf"},
    {"name": "QVikhr-3-1.7B-noreasoning-Q8_0.gguf", "size": 1834426080, "title": "QVikhr-3 1.7B",
     "tier": "Средняя", "note": "Русская, не «думает». Заметно чище заголовки — золотая середина.",
     "url": _HF + "/Vikhrmodels/QVikhr-3-1.7B-Instruction-noreasoning-GGUF/resolve/main/QVikhr-3-1.7B-Instruction-noreasoning-Q8_0.gguf"},
]

# Каталог движков llama_cpp (паки рядом с приложением: ai/engine-cpu, ai/engine-vulkan).
# ХОСТ — GitHub-релиз `engines` (prerelease, НЕ участвует в авто-обновлении: апдейтер берёт
# /releases/latest). Проверено 2026-07: GitHub release-assets у КРОЛИКа качаются нормально, в
# т.ч. большие файлы — старый DPI-блок ушёл. Ассеты — zip с llama_cpp/ в корне. Только по кнопке.
_ENGINE_BASE = "https://github.com/Krolik5555/myslik/releases/download/engines"
ENGINE_CATALOG = [
    {"backend": "cpu", "dir": "engine-cpu", "title": "CPU-движок", "size": 2685084,
     "note": "Работает на любом ПК. Нужен для локального ИИ.",
     "url": _ENGINE_BASE + "/engine-cpu.zip"},
    {"backend": "gpu", "dir": "engine-vulkan", "title": "GPU-движок (Vulkan)", "size": 19497996,
     "note": "Считает на видеокарте (любой), занимает видеопамять.",
     "url": _ENGINE_BASE + "/engine-vulkan.zip"},
]

# состояние текущей загрузки модели/движка (для прогресса в UI)
_AI_DL = {"active": None, "pct": 0, "done": False, "error": None}
_AI_DL_LOCK = threading.Lock()
# токен/чат Telegram — ОТДЕЛЬНЫЙ файл, а не часть planner.json: он не должен попадать
# в экспорт/импорт данных (иначе токен бота утечёт вместе с шарингом заметок).
TG_FILE = os.path.join(DATA_DIR, "telegram.json")

TRACE = os.environ.get("PLANNER_TRACE") == "1"

# ---- авто-обновление с GitHub Releases ----
# Единый источник версии для сравнения с релизом. Теги релизов: vX.Y.Z (напр. v1.3.0).
APP_VERSION = "1.4.8"
# owner/repo публичного репозитория (заполнится после gh auth login — owner = твой GitHub-логин)
GH_REPO_SLUG = "Krolik5555/myslik"

# ---- отчёты о проблемах от пользователей ----
# URL веб-приложения Google Apps Script (код и инструкция — tools/feedback-appscript.gs).
# Это НЕ секрет: обычный эндпоинт, принимающий отчёт. Худшее при утечке — спам в таблицу,
# поэтому его безопасно держать в открытом exe. Пусто/PASTE → кнопка честно скажет «не настроено».
FEEDBACK_URL = "https://script.google.com/macros/s/AKfycbzSi4wlGG8aPhSwW9TeVttt18kbq0DxKMLMoG6fR6VWZfhsnAYJkV6MxXfx_-3TNJaBRA/exec"

# bat-хелпер подмены файлов после закрытия приложения. Папки data/ в архиве НЕТ → она не трогается.
# Пути передаются ЧЕРЕЗ ПЕРЕМЕННЫЕ ОКРУЖЕНИЯ (MYSLIK_*), а не подставляются в текст bat:
#   - юникод-безопасно (кириллические пути C:\Users\Кролик\... не корёжатся),
#   - literal '%' в пути не раскрывается как batch-переменная.
# Сам bat — чистый ASCII. Логика: ждём выхода процесса (с таймаутом) -> собираем новый _internal
# рядом -> быстрым переименованием (старый в .bak) подменяем -> меняем exe -> при любом сбое
# откатываемся к рабочей версии и оставляем папку обновления для повторной попытки.
_UPDATE_BAT = r"""@echo off
setlocal enableextensions
set /a n=0
:wait
tasklist /fi "imagename eq Myslik.exe" 2>nul | find /i "Myslik.exe" >nul || goto gone
set /a n+=1
if %n% geq 90 goto giveup
ping -n 2 127.0.0.1 >nul
goto wait
:giveup
taskkill /f /im "Myslik.exe" >nul 2>&1
ping -n 2 127.0.0.1 >nul
:gone
ping -n 3 127.0.0.1 >nul

rem clean leftovers from a previous attempt
if exist "%MYSLIK_INSTALL%\_internal.new" rmdir /s /q "%MYSLIK_INSTALL%\_internal.new"
if exist "%MYSLIK_INSTALL%\_internal.bak" rmdir /s /q "%MYSLIK_INSTALL%\_internal.bak"

rem 1) stage the new _internal next to the old one (old stays live; safe to abort here)
if exist "%MYSLIK_SRC%\_internal" (
  robocopy "%MYSLIK_SRC%\_internal" "%MYSLIK_INSTALL%\_internal.new" /E /R:2 /W:2 /NFL /NDL /NJH /NJS /NC /NS /NP >nul
  if errorlevel 8 goto fail
)

rem 2) swap _internal via fast same-volume renames (old -> .bak, new -> live)
if exist "%MYSLIK_INSTALL%\_internal.new" (
  move "%MYSLIK_INSTALL%\_internal" "%MYSLIK_INSTALL%\_internal.bak" >nul || goto fail
  move "%MYSLIK_INSTALL%\_internal.new" "%MYSLIK_INSTALL%\_internal" >nul || goto rollback
)

rem 3) swap the exe
copy /y "%MYSLIK_SRC%\Myslik.exe" "%MYSLIK_INSTALL%\Myslik.exe" >nul || goto rollback

rem 4) success: drop backup + update folder, relaunch new build
if exist "%MYSLIK_INSTALL%\_internal.bak" rmdir /s /q "%MYSLIK_INSTALL%\_internal.bak"
rmdir /s /q "%MYSLIK_UPD%"
start "" "%MYSLIK_EXE%"
goto done

:rollback
rem restore the old _internal; keep the update folder for a retry
if exist "%MYSLIK_INSTALL%\_internal.bak" (
  if exist "%MYSLIK_INSTALL%\_internal" rmdir /s /q "%MYSLIK_INSTALL%\_internal"
  move "%MYSLIK_INSTALL%\_internal.bak" "%MYSLIK_INSTALL%\_internal" >nul
)
:fail
if exist "%MYSLIK_INSTALL%\_internal.new" rmdir /s /q "%MYSLIK_INSTALL%\_internal.new"
start "" "%MYSLIK_EXE%"

:done
endlocal
(goto) 2>nul & del "%~f0"
"""


def _ver_tuple(v):
    import re
    nums = re.findall(r"\d+", str(v or ""))
    return tuple(int(x) for x in nums[:4]) if nums else (0,)


def _ver_gt(a, b):
    return _ver_tuple(a) > _ver_tuple(b)


def trace(*a):
    if TRACE:
        print("[trace]", *a, flush=True)


def _ensure_dirs():
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)


def _atomic_write(path, text):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _tg_load():
    try:
        with open(TG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _tg_save(cfg):
    _ensure_dirs()
    try:
        _atomic_write(TG_FILE, json.dumps(cfg, ensure_ascii=False, indent=1))
    except Exception as e:
        print("telegram save error:", e)


# Состояние держим в module-глобалах, а НЕ в атрибутах Api:
# pywebview сериализует атрибуты js_api-объекта, и ссылка на окно (WinForms-контрол)
# вызывает бесконечную рекурсию, ломая мост JS<->Python.
_WINDOW = None
_MAXED = False
_SAVE_LOCK = threading.Lock()
_HWND = 0


def _get_hwnd():
    """HWND нативного окна (ищем по заголовку 'Мыслик', кэшируем)."""
    global _HWND
    if _HWND:
        return _HWND
    try:
        import win32gui
        _HWND = win32gui.FindWindow(None, "Мыслик") or 0
    except Exception:
        _HWND = 0
    return _HWND


class Api:
    # ---------- data ----------
    def load(self):
        trace("load() called")
        _ensure_dirs()
        if not os.path.exists(DATA_FILE):
            return None
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("load error:", e)
            # подкинуть резервную копию, если основной файл побился:
            # только planner_*.json, перебираем от новых к старым, пока какая-то не распарсится
            try:
                bks = sorted(
                    f for f in os.listdir(BACKUP_DIR)
                    if f.startswith("planner_") and f.endswith(".json")
                )
                for f in reversed(bks):
                    try:
                        with open(os.path.join(BACKUP_DIR, f), "r", encoding="utf-8") as bf:
                            return json.load(bf)
                    except Exception:
                        continue
            except Exception:
                pass
            return None

    def save(self, state):
        trace("save() called, items=", len((state or {}).get("items", [])))
        _ensure_dirs()
        with _SAVE_LOCK:
            try:
                _atomic_write(DATA_FILE, json.dumps(state, ensure_ascii=False, indent=1))
                return True
            except Exception as e:
                print("save error:", e)
                return False

    def backup(self):
        _ensure_dirs()
        if not os.path.exists(DATA_FILE):
            return ""
        stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        dst = os.path.join(BACKUP_DIR, "planner_%s.json" % stamp)
        try:
            shutil.copy2(DATA_FILE, dst)
            self._rotate()
            return dst
        except Exception as e:
            print("backup error:", e)
            return ""

    def _rotate(self):
        try:
            bks = sorted(
                [f for f in os.listdir(BACKUP_DIR) if f.endswith(".json")]
            )
            for old in bks[:-MAX_BACKUPS]:
                os.remove(os.path.join(BACKUP_DIR, old))
        except Exception:
            pass

    def export_data(self, state):
        try:
            res = _WINDOW.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename="myslik-export-%s.json"
                % datetime.datetime.now().strftime("%Y%m%d"),
                file_types=("JSON (*.json)",),
            )
            path = res if isinstance(res, str) else (res[0] if res else None)
            if not path:
                return ""
            _atomic_write(path, json.dumps(state, ensure_ascii=False, indent=2))
            return path
        except Exception as e:
            print("export error:", e)
            return ""

    def import_data(self):
        try:
            res = _WINDOW.create_file_dialog(
                webview.OPEN_DIALOG,
                allow_multiple=False,
                file_types=("JSON (*.json)",),
            )
            path = res[0] if res else None
            if not path:
                return None
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print("import error:", e)
            return None

    def pick_folder(self):
        try:
            res = _WINDOW.create_file_dialog(webview.FOLDER_DIALOG)
            path = res if isinstance(res, str) else (res[0] if res else None)
            trace("pick_folder() ->", path)
            return path or ""
        except Exception as e:
            print("pick_folder error:", e)
            return ""

    def open_path(self, path):
        try:
            if not path or not isinstance(path, str) or not os.path.exists(path):
                trace("open_path() rejected:", path)
                return False
            # Безопасно: только открываем существующий путь в проводнике ОС,
            # никаких произвольных команд по строке не выполняем.
            try:
                os.startfile(path)
                trace("open_path() ->", path)
                return True
            except Exception as e:
                print("open_path startfile error:", e)
                return False
        except Exception as e:
            print("open_path error:", e)
            return False

    def open_url(self, url):
        # открыть http(s)-ссылку в браузере (для «как получить ключ»). Только http/https.
        try:
            u = (url or "").strip()
            if not (u.startswith("http://") or u.startswith("https://")):
                return False
            import webbrowser
            webbrowser.open(u)
            return True
        except Exception as e:
            print("open_url error:", e)
            return False

    # ---------- telegram (захват заметок с телефона; проверка ТОЛЬКО по клику пользователя,
    # никакого фонового поллинга — не грузим ни CPU, ни сеть, пока не попросили явно) ----------
    def telegram_status(self):
        cfg = _tg_load()
        return {"configured": bool(cfg.get("token")), "linked": bool(cfg.get("chat_id"))}

    def telegram_set_token(self, token):
        token = (token or "").strip()
        if not token:
            return False
        # новый токен = другой бот → сбрасываем привязку чата и смещение апдейтов
        _tg_save({"token": token, "chat_id": None, "offset": 0})
        return True

    def telegram_clear(self):
        try:
            if os.path.exists(TG_FILE):
                os.remove(TG_FILE)
        except Exception as e:
            print("telegram clear error:", e)
        return True

    def telegram_check(self):
        """Разовый опрос getUpdates (НЕ long-polling: timeout=0, мгновенный ответ).
        Первое сообщение привязывает бота к этому чату — дальше чужие чаты игнорируются
        (защита на случай, если токен/имя бота кому-то попадётся на глаза)."""
        cfg = _tg_load()
        token = cfg.get("token")
        if not token:
            return {"ok": False, "error": "no_token"}
        import urllib.request
        offset = cfg.get("offset", 0) or 0
        chat_id = cfg.get("chat_id")
        url = "https://api.telegram.org/bot%s/getUpdates?offset=%d&timeout=0" % (token, offset)
        try:
            with urllib.request.urlopen(url, timeout=12) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print("telegram_check network error:", e)
            return {"ok": False, "error": "network"}
        if not data.get("ok"):
            print("telegram_check api error:", data.get("description"))
            return {"ok": False, "error": "api"}
        messages = []
        max_update = offset - 1
        for upd in data.get("result", []):
            uid = upd.get("update_id", 0)
            if uid > max_update:
                max_update = uid
            msg = upd.get("message") or upd.get("channel_post")
            if not msg:
                continue
            text = msg.get("text")
            if not text:
                continue
            cid = (msg.get("chat") or {}).get("id")
            if chat_id is None and cid is not None:
                chat_id = cid
            if chat_id is not None and cid != chat_id:
                continue
            messages.append(text)
        cfg["offset"] = max_update + 1
        cfg["chat_id"] = chat_id
        _tg_save(cfg)
        return {"ok": True, "messages": messages}

    # ---------- обновление ----------
    def app_version(self):
        return APP_VERSION

    def send_feedback(self, msg, contact=""):
        """Отправить отчёт о проблеме на веб-приложение Google Apps Script.
        Пользователю не нужны никакие аккаунты и настройки — одна кнопка.
        Секретов не шлём и не храним: в exe лежит только URL эндпоинта.
        Данные пользователя (заметки/задачи) НЕ отправляются — только текст,
        который он сам написал, плюс версия/ОС для диагностики."""
        if not FEEDBACK_URL or "PASTE" in FEEDBACK_URL:
            return {"ok": False, "error": "not_configured"}
        msg = (msg or "").strip()
        if not msg:
            return {"ok": False, "error": "empty"}
        import urllib.request
        import platform
        payload = {
            "message": msg[:5000],
            "contact": (contact or "").strip()[:200],
            "version": APP_VERSION,
            "os": "%s %s" % (platform.system(), platform.release()),
            "frozen": bool(getattr(sys, "frozen", False)),
        }
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(FEEDBACK_URL, data=data, headers={
            "Content-Type": "application/json", "User-Agent": "Myslik-Feedback",
        })
        try:
            # Apps Script отвечает 302 на script.googleusercontent.com — urllib сам сходит
            # по редиректу; doPost к этому моменту уже отработал и строку записал.
            with urllib.request.urlopen(req, timeout=20) as resp:
                body = resp.read().decode("utf-8", "replace")
            trace("send_feedback() ->", body[:200])
            return {"ok": True}
        except Exception as e:
            print("send_feedback error:", e)
            return {"ok": False, "error": "network"}

    def check_update(self):
        """Спросить у GitHub последний релиз и сравнить с текущей версией.
        Ничего не скачивает и не меняет — только читает публичный API."""
        if "OWNER" in GH_REPO_SLUG:
            return {"ok": False, "error": "not_configured", "current": APP_VERSION}
        import urllib.request
        url = "https://api.github.com/repos/%s/releases/latest" % GH_REPO_SLUG
        req = urllib.request.Request(url, headers={
            "Accept": "application/vnd.github+json", "User-Agent": "Myslik-Updater",
        })
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print("check_update error:", e)
            return {"ok": False, "error": "network", "current": APP_VERSION}
        latest = (data.get("tag_name") or "").lstrip("vV")
        asset = None
        for a in data.get("assets", []):
            if (a.get("name") or "").lower().endswith(".zip"):
                asset = a.get("browser_download_url")
                break
        return {
            "ok": True, "current": APP_VERSION, "latest": latest,
            "hasUpdate": bool(asset) and _ver_gt(latest, APP_VERSION),
            "notes": data.get("body") or "", "asset": asset,
            "page": data.get("html_url") or "",
            "frozen": bool(getattr(sys, "frozen", False)),
        }

    def apply_update(self, asset_url):
        """Скачать zip релиза, распаковать рядом и запустить bat-хелпер, который
        после закрытия приложения подменит файлы (кроме data/) и перезапустит."""
        if not getattr(sys, "frozen", False):
            return {"ok": False, "error": "not_frozen"}   # в dev-режиме подменять нечего
        # пин строго на наш репозиторий (не любой github.com) — чтобы renderer не смог
        # подсунуть произвольный URL
        _pin = "https://github.com/%s/" % GH_REPO_SLUG
        if not asset_url or not asset_url.startswith(_pin):
            return {"ok": False, "error": "bad_url"}
        import urllib.request
        import zipfile
        import tempfile
        install_dir = os.path.dirname(sys.executable)
        upd_dir = os.path.join(install_dir, "_update")
        new_dir = os.path.join(upd_dir, "new")
        try:
            if os.path.isdir(upd_dir):
                shutil.rmtree(upd_dir, ignore_errors=True)
            os.makedirs(new_dir, exist_ok=True)
            zip_path = os.path.join(upd_dir, "update.zip")
            req = urllib.request.Request(asset_url, headers={"User-Agent": "Myslik-Updater"})
            with urllib.request.urlopen(req, timeout=180) as resp, open(zip_path, "wb") as f:
                shutil.copyfileobj(resp, f)
            with zipfile.ZipFile(zip_path) as z:
                base = os.path.realpath(new_dir)
                for m in z.namelist():   # защита от zip-slip: не даём распаковаться за пределы new_dir
                    dest = os.path.realpath(os.path.join(new_dir, m))
                    if dest != base and not dest.startswith(base + os.sep):
                        raise ValueError("zip slip: %s" % m)
                z.extractall(new_dir)
        except Exception as e:
            print("apply_update download error:", e)
            return {"ok": False, "error": "download"}
        # ищем папку с Myslik.exe (архив может быть с обёрткой-папкой или без)
        src_root = None
        for root, _dirs, files in os.walk(new_dir):
            if any(fn.lower() == "myslik.exe" for fn in files):
                src_root = root
                break
        if not src_root:
            return {"ok": False, "error": "no_exe_in_zip"}
        # НЕ подменять рабочую сборку неполным обновлением: проверяем, что в скачанном
        # билде реально есть интерфейс. Без этого оборванная загрузка убила бы _internal
        # (у пользователя вылезал бы голый 404 «index.html does not exist»).
        if not os.path.isfile(os.path.join(src_root, "_internal", "ui", "index.html")):
            print("apply_update: скачанный билд без ui/index.html — подмену отменяем")
            return {"ok": False, "error": "bad_bundle"}
        bat_path = os.path.join(tempfile.gettempdir(), "myslik_update.bat")
        try:
            with open(bat_path, "w", encoding="ascii") as f:
                f.write(_UPDATE_BAT)   # чистый ASCII; пути идут через env (юникод/%-безопасно)
        except Exception as e:
            print("apply_update bat error:", e)
            return {"ok": False, "error": "bat"}
        try:
            import subprocess
            env = dict(os.environ)
            env["MYSLIK_SRC"] = src_root
            env["MYSLIK_INSTALL"] = install_dir
            env["MYSLIK_UPD"] = upd_dir
            env["MYSLIK_EXE"] = os.path.join(install_dir, "Myslik.exe")
            # CREATE_NO_WINDOW (скрытая консоль, переживёт закрытие); cwd вне папки установки,
            # иначе rename/rmdir внутри неё могут упасть «занято другим процессом»
            subprocess.Popen(["cmd", "/c", bat_path], creationflags=0x08000000,
                             env=env, cwd=tempfile.gettempdir())
        except Exception as e:
            print("apply_update launch error:", e)
            return {"ok": False, "error": "launch"}

        def _close():
            time.sleep(0.8)   # дать JS получить ответ до закрытия окна
            try:
                _WINDOW.destroy()
            except Exception:
                os._exit(0)
        threading.Thread(target=_close, daemon=True).start()
        return {"ok": True}

    # ---------- локальный ИИ (умный захват) ----------
    # Оба метода никогда не бросают в JS: при любой беде честно возвращают
    # available:false / ok:false, и фронт просто не показывает ИИ-подсказки.
    def ai_status(self):
        if not ai_mod:
            return {"available": False, "reason": "no_module"}
        try:
            return ai_mod.status()
        except Exception as e:
            print("[ai] status error:", e)
            return {"available": False, "reason": "error", "detail": repr(e)}

    def ai_capture(self, text):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.capture(text or "")
        except Exception as e:
            print("[ai] capture error:", e)
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_report(self, text, purpose=""):
        """Прозаический отчёт по выделенным заметкам/задачам (свободный текст).
        purpose — необязательная цель/адресат отчёта."""
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.report(text or "", purpose or "")
        except Exception as e:
            print("[ai] report error:", e)
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_set_backend(self, name):
        # сменить движок ИИ (cpu/gpu). Применяется при перезапуске.
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_backend(name or "")
        except Exception as e:
            print("[ai] set_backend error:", e)
            return {"ok": False, "error": "exception", "detail": repr(e)}

    # ---------- модели ИИ (список / выбор / удаление / каталог / скачивание) ----------
    def ai_list_models(self):
        if not ai_mod:
            return []
        try:
            return ai_mod.list_models()
        except Exception as e:
            print("[ai] list_models error:", e)
            return []

    def ai_set_model(self, name):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_model(name or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_delete_model(self, name):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.delete_model(name or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_model_catalog(self):
        """Каталог скачиваемых моделей + пометка, что уже установлено."""
        try:
            installed = set(m["name"] for m in (ai_mod.list_models() if ai_mod else []))
        except Exception:
            installed = set()
        return [dict(m, installed=(m["name"] in installed)) for m in AI_MODEL_CATALOG]

    def ai_download_model(self, name):
        """Скачать модель из каталога (в фоне, с прогрессом). Только по кнопке."""
        entry = next((m for m in AI_MODEL_CATALOG if m["name"] == name), None)
        if not entry:
            return {"ok": False, "error": "unknown_model"}
        with _AI_DL_LOCK:
            if _AI_DL["active"]:
                return {"ok": False, "error": "busy", "active": _AI_DL["active"]}
            _AI_DL.update(active=name, pct=0, done=False, error=None)
        models_dir = os.path.join(AI_DIR, "models")
        os.makedirs(models_dir, exist_ok=True)
        dest = os.path.join(models_dir, name)

        def _worker():
            import urllib.request
            tmp = dest + ".part"
            try:
                req = urllib.request.Request(entry["url"], headers={"User-Agent": "Myslik"})
                with urllib.request.urlopen(req, timeout=60) as resp:
                    total = int(resp.headers.get("Content-Length") or entry.get("size") or 0)
                    got = 0
                    with open(tmp, "wb") as f:
                        while True:
                            chunk = resp.read(262144)
                            if not chunk:
                                break
                            f.write(chunk)
                            got += len(chunk)
                            if total:
                                _AI_DL["pct"] = min(99, int(got * 100 / total))
                os.replace(tmp, dest)          # атомарно: недокачанный .part не «установится»
                _AI_DL.update(pct=100, done=True, active=None)
            except Exception as e:
                print("[ai] download error:", e)
                try:
                    os.remove(tmp)
                except Exception:
                    pass
                _AI_DL.update(error=repr(e), active=None)

        threading.Thread(target=_worker, daemon=True).start()
        return {"ok": True, "name": name}

    def ai_engine_catalog(self):
        """Каталог движков + флаг установлен ли (по наличию llama_cpp в паке)."""
        out = []
        for e in ENGINE_CATALOG:
            inst = os.path.isfile(os.path.join(AI_DIR, e["dir"], "llama_cpp", "__init__.py"))
            out.append(dict(e, installed=inst))
        return out

    def ai_download_engine(self, backend):
        """Скачать пак движка (zip с HF) и распаковать в ai/engine-*. Атомарно, с ретраями
        (DPI может рвать соединение). Только по кнопке."""
        entry = next((e for e in ENGINE_CATALOG if e["backend"] == backend), None)
        if not entry:
            return {"ok": False, "error": "unknown_engine"}
        with _AI_DL_LOCK:
            if _AI_DL["active"]:
                return {"ok": False, "error": "busy", "active": _AI_DL["active"]}
            _AI_DL.update(active=entry["dir"], pct=0, done=False, error=None)
        os.makedirs(AI_DIR, exist_ok=True)
        dest_dir = os.path.join(AI_DIR, entry["dir"])
        tmp_zip = os.path.join(AI_DIR, entry["dir"] + ".part.zip")
        stage = dest_dir + ".new"

        def _worker():
            import urllib.request
            import zipfile
            try:
                last = None
                for _attempt in range(3):            # ретраи: DPI/сеть иногда рвут поток
                    try:
                        req = urllib.request.Request(entry["url"], headers={"User-Agent": "Myslik"})
                        with urllib.request.urlopen(req, timeout=120) as resp:
                            total = int(resp.headers.get("Content-Length") or entry.get("size") or 0)
                            got = 0
                            with open(tmp_zip, "wb") as f:
                                while True:
                                    chunk = resp.read(262144)
                                    if not chunk:
                                        break
                                    f.write(chunk)
                                    got += len(chunk)
                                    if total:
                                        _AI_DL["pct"] = min(98, int(got * 100 / total))
                        last = None
                        break
                    except Exception as e:
                        last = e
                        try:
                            os.remove(tmp_zip)
                        except Exception:
                            pass
                if last:
                    raise last
                # распаковка в stage + защита от zip-slip
                if os.path.isdir(stage):
                    shutil.rmtree(stage, ignore_errors=True)
                os.makedirs(stage, exist_ok=True)
                with zipfile.ZipFile(tmp_zip) as z:
                    base = os.path.realpath(stage)
                    for m in z.namelist():
                        d = os.path.realpath(os.path.join(stage, m))
                        if d != base and not d.startswith(base + os.sep):
                            raise ValueError("zip slip: %s" % m)
                    z.extractall(stage)
                # архив мог положить llama_cpp/ в корень ИЛИ во вложенную папку engine-*/
                inner = os.path.join(stage, entry["dir"])
                root = inner if os.path.isfile(os.path.join(inner, "llama_cpp", "__init__.py")) else stage
                if not os.path.isfile(os.path.join(root, "llama_cpp", "__init__.py")):
                    raise ValueError("bad_engine_zip")   # нет llama_cpp — не ставим битый пак
                if os.path.isdir(dest_dir):
                    shutil.rmtree(dest_dir, ignore_errors=True)
                os.replace(root, dest_dir)               # атомарно на том же диске
                if os.path.isdir(stage):
                    shutil.rmtree(stage, ignore_errors=True)
                os.remove(tmp_zip)
                _AI_DL.update(pct=100, done=True, active=None)
            except Exception as e:
                print("[ai] engine download error:", e)
                for p in (tmp_zip,):
                    try:
                        os.remove(p)
                    except Exception:
                        pass
                try:
                    if os.path.isdir(stage):
                        shutil.rmtree(stage, ignore_errors=True)
                except Exception:
                    pass
                _AI_DL.update(error=repr(e), active=None)

        threading.Thread(target=_worker, daemon=True).start()
        return {"ok": True, "backend": backend}

    def ai_download_status(self):
        return dict(_AI_DL)

    # ---------- провайдер ИИ (off / groq / cerebras / local) + ключи API ----------
    def ai_set_provider(self, name):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_provider(name or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_set_api_key(self, provider, key):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_api_key(provider or "", key or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_set_api_model(self, provider, model):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_api_model(provider or "", model or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    def ai_set_api_account(self, provider, account):
        if not ai_mod:
            return {"ok": False, "error": "no_module"}
        try:
            return ai_mod.set_api_account(provider or "", account or "")
        except Exception as e:
            return {"ok": False, "error": "exception", "detail": repr(e)}

    # ---------- window ----------
    def win_min(self):
        try:
            _WINDOW.minimize()
        except Exception as e:
            print(e)

    def win_max(self):
        # спрашиваем РЕАЛЬНОЕ состояние окна (IsZoomed), а не свой флаг — иначе после
        # Aero Snap / Win+Up кнопка начинала работать наоборот
        try:
            import win32gui
            h = _get_hwnd()
            if h and win32gui.IsZoomed(h):
                _WINDOW.restore()
            else:
                _WINDOW.maximize()
        except Exception as e:
            # старые версии без maximize/restore — переключаем fullscreen
            try:
                _WINDOW.toggle_fullscreen()
            except Exception:
                print(e)

    def win_close(self):
        try:
            _WINDOW.destroy()
        except Exception as e:
            print(e)

    def win_drag(self, edge):
        """Ресайз безрамочного окна тянущим за края — из фронтенда.
        WM_NCHITTEST до WndProc формы не доходит (его перехватывает дочернее окно
        WebView2, накрывающее клиентскую область), поэтому тянем сами: двигаем
        нужный край окна к текущей позиции курсора. И курсор, и rect окна — в
        физических пикселях, так что DPI-масштаб не мешает.
        edge: строка из букв l/r/t/b (например 'br' = правый-нижний угол)."""
        try:
            import win32gui
            import win32api
            h = _get_hwnd()
            if not h:
                return False
            cx, cy = win32api.GetCursorPos()
            l, t, r, b = win32gui.GetWindowRect(h)
            MINW, MINH = 900, 600  # физ.px — не даём схлопнуть окно
            if "l" in edge:
                l = min(cx, r - MINW)
            if "r" in edge:
                r = max(cx, l + MINW)
            if "t" in edge:
                t = min(cy, b - MINH)
            if "b" in edge:
                b = max(cy, t + MINH)
            win32gui.MoveWindow(h, l, t, r - l, b - t, True)
            return True
        except Exception as e:
            print("[resize] win_drag error:", e)
            return False

    def win_startdrag(self):
        """Нативное перетаскивание окна руками Windows — чтобы работал Aero Snap
        (тянешь окно к верху экрана → разворот на весь экран; к боковому краю →
        половина экрана; тряска → свернуть остальные). Запускаем штатный move-loop
        Windows: ReleaseCapture + WM_NCLBUTTONDOWN с кодом HTCAPTION. SendMessage
        крутит модальный цикл перемещения на GUI-потоке до отпускания кнопки —
        поэтому Windows сам рисует зоны привязки и разворачивает окно. Зовётся из
        JS на pointerdown/старте перетаскивания титлбара (см. main.js)."""
        try:
            import win32gui
            import win32con
            h = _get_hwnd()
            if not h:
                return False
            win32gui.ReleaseCapture()
            win32gui.SendMessage(h, win32con.WM_NCLBUTTONDOWN, win32con.HTCAPTION, 0)
            return True
        except Exception as e:
            print("[drag] win_startdrag error:", e)
            return False


def _selftest(window):
    # PLANNER_SELFTEST=1 — открыть окно на пару секунд и закрыть (проверка запуска)
    time.sleep(3.5)
    try:
        window.destroy()
    except Exception:
        pass


def _set_taskbar_icon(icon_path):
    """Поставить иконку нативному окну (иначе в панели задач/Alt-Tab — иконка pythonw).
    pystray даёт только значок в трее, но НЕ меняет иконку окна — это делаем здесь через WM_SETICON."""
    try:
        import win32gui
        import win32con
    except Exception as e:
        print("[icon] win32 missing:", e)
        return
    # ждём, пока pywebview создаст нативное окно (заголовок 'Мыслик')
    hwnd = 0
    for _ in range(120):  # до ~12 c
        hwnd = win32gui.FindWindow(None, "Мыслик")
        if hwnd:
            break
        time.sleep(0.1)
    if not hwnd:
        print("[icon] window not found")
        return
    try:
        big = win32gui.LoadImage(0, icon_path, win32con.IMAGE_ICON, 0, 0,
                                 win32con.LR_LOADFROMFILE | win32con.LR_DEFAULTSIZE)
        small = win32gui.LoadImage(0, icon_path, win32con.IMAGE_ICON, 16, 16,
                                   win32con.LR_LOADFROMFILE)
        if big:
            win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_BIG, big)
        if small:
            win32gui.SendMessage(hwnd, win32con.WM_SETICON, win32con.ICON_SMALL, small)
        print("[icon] window icon set, hwnd=", hwnd)
    except Exception as e:
        print("[icon] set error:", e)


# держим ссылки глобально, иначе GC соберёт callback → краш
_RESIZE_PROC = None
_OLD_WNDPROC = None


def _enable_frameless_resize(title="Мыслик", border=8):
    """Безрамочное окно WinForms (FormBorderStyle.None) лишено границы ресайза.
    Подменяем WndProc и на WM_NCHITTEST у краёв отдаём коды зон ресайза —
    нативный ресайз тянущим за края, без видимой рамки. Всё под try/except:
    при любой ошибке окно просто откроется без ресайза, не падая."""
    global _RESIZE_PROC, _OLD_WNDPROC
    try:
        import win32gui
    except Exception as e:
        print("[resize] win32 missing:", e)
        return
    hwnd = 0
    for _ in range(120):  # до ~12 c ждём появления окна
        hwnd = win32gui.FindWindow(None, title)
        if hwnd:
            break
        time.sleep(0.1)
    if not hwnd:
        print("[resize] window not found")
        return
    try:
        from ctypes import wintypes
        WM_NCHITTEST = 0x0084
        HTLEFT, HTRIGHT, HTTOP, HTTOPLEFT, HTTOPRIGHT = 10, 11, 12, 13, 14
        HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT = 15, 16, 17
        GWLP_WNDPROC = -4
        user32 = ctypes.windll.user32
        LRESULT = ctypes.c_ssize_t
        WNDPROCTYPE = ctypes.WINFUNCTYPE(
            LRESULT, wintypes.HWND, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t
        )
        # 64-бит: SetWindowLongPtrW (иначе на 32-бит — SetWindowLongW)
        setlp = getattr(user32, "SetWindowLongPtrW", None) or user32.SetWindowLongW
        setlp.restype = LRESULT
        setlp.argtypes = [wintypes.HWND, ctypes.c_int, WNDPROCTYPE]
        callwp = user32.CallWindowProcW
        callwp.restype = LRESULT
        callwp.argtypes = [LRESULT, wintypes.HWND, ctypes.c_uint, ctypes.c_size_t, ctypes.c_ssize_t]
        user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]

        def proc(h, msg, wp, lp):
            try:
                if msg == WM_NCHITTEST:
                    x = ctypes.c_short(lp & 0xFFFF).value
                    y = ctypes.c_short((lp >> 16) & 0xFFFF).value
                    r = wintypes.RECT()
                    user32.GetWindowRect(h, ctypes.byref(r))
                    on_l, on_r = x < r.left + border, x >= r.right - border
                    on_t, on_b = y < r.top + border, y >= r.bottom - border
                    if on_t and on_l: return HTTOPLEFT
                    if on_t and on_r: return HTTOPRIGHT
                    if on_b and on_l: return HTBOTTOMLEFT
                    if on_b and on_r: return HTBOTTOMRIGHT
                    if on_l: return HTLEFT
                    if on_r: return HTRIGHT
                    if on_t: return HTTOP
                    if on_b: return HTBOTTOM
            except Exception:
                pass
            return callwp(_OLD_WNDPROC, h, msg, wp, lp)

        _RESIZE_PROC = WNDPROCTYPE(proc)
        _OLD_WNDPROC = setlp(hwnd, GWLP_WNDPROC, _RESIZE_PROC)
        print("[resize] frameless resize enabled, hwnd=", hwnd)
    except Exception as e:
        print("[resize] error:", e)


def _repair_bundle_if_broken():
    """Защита от битой сборки у пользователя (обычно после оборванного авто-обновления):
    если файлов интерфейса нет — пробуем восстановить ui/ из остатков обновления
    (_internal.bak / _internal.new), а не показываем голый 404. Если восстановить нечем —
    честное окно с инструкцией. Копируем ТОЛЬКО ui/ (не трогаем занятые python-либы в
    _internal и заметки в data/)."""
    if not getattr(sys, "frozen", False) or os.path.exists(UI):
        return
    install = os.path.dirname(sys.executable)
    for src in (os.path.join(install, "_internal.bak", "ui"),
                os.path.join(install, "_internal.new", "ui")):
        try:
            if os.path.isfile(os.path.join(src, "index.html")):
                shutil.copytree(src, _UI_BASE, dirs_exist_ok=True)
                print("[repair] ui/ восстановлен из", src)
                break
        except Exception as e:
            print("[repair] ошибка восстановления:", e)
    if not os.path.exists(UI):
        msg = ("Файлы Мыслика повреждены — не найден интерфейс приложения.\n\n"
               "Скорее всего оборвалось обновление. Скачай свежую версию с GitHub и "
               "распакуй заново. Папку data с заметками НЕ трогай — они целы.")
        try:
            ctypes.windll.user32.MessageBoxW(0, msg, "Мыслик", 0x10)
        except Exception:
            print(msg)
        sys.exit(1)


def main():
    global _WINDOW
    trace("main start, file=", __file__)
    # отдельная идентичность приложения → Windows не группирует под pythonw и берёт нашу иконку
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("krolik.planner")
    except Exception as e:
        print("[appid] error:", e)
    _repair_bundle_if_broken()   # битый _internal после сорванного обновления → чиним или честно сообщаем
    _ensure_dirs()
    # сброс кэша WebView2 (CSS/JS закэширован)
    cache_dir = os.path.join(os.environ.get("LOCALAPPDATA", ""), "planner", "EBWebView")
    if os.path.exists(cache_dir):
        try:
            shutil.rmtree(cache_dir)
            print("[cache] cleared WebView2 cache")
        except Exception as e:
            print("[cache] clear error:", e)
    # стартовый снимок текущих данных (раз в сессию)
    api = Api()
    if os.path.exists(DATA_FILE):
        api.backup()
    # инициализация ИИ-слоя: только запоминаем путь к модели рядом с приложением;
    # сама модель грузится лениво при первом захвате, старт не тормозит.
    if ai_mod:
        try:
            info = ai_mod.init(AI_DIR)
            print("[ai] init:", info)   # без status(): в нём кириллица (названия провайдеров) — падает print в cp1252-консоли frozen-сборки
        except Exception as e:
            print("[ai] init error:", e)
    trace("api created")

    frameless = os.environ.get("PLANNER_FRAMED") != "1"
    # ВАЖНО: в собранной сборке грузим index.html ПЛОСКИМ путём (file://), без ?v.
    # Query-строка на пути файла ломает pywebview: он не может открыть файл напрямую и
    # поднимает http-сервер, который у части пользователей промахивается мимо корня и
    # отдаёт голый 404 «index.html File does not exist». Кэш WebView2 и так чистим на
    # старте (см. cache_dir выше), так что ?v для свежести не нужен. В деве — оставляем
    # ?v для hot-reload (там грузимся не из бандла).
    if getattr(sys, "frozen", False):
        start_url = UI
    else:
        start_url = UI + "?v=" + str(int(time.time()))
    window = webview.create_window(
        "Мыслик",
        url=start_url,
        js_api=api,
        width=1200,
        height=800,
        min_size=(920, 640),
        frameless=frameless,
        easy_drag=False,
        background_color="#000000",
        text_select=False,
    )
    _WINDOW = window

    # иконка окна (панель задач / Alt-Tab) — в фоне, как только окно появится
    win_icon = os.path.join(_UI_BASE, "icon.ico")
    if os.path.exists(win_icon):
        threading.Thread(target=_set_taskbar_icon, args=(win_icon,), daemon=True).start()

    # включить ресайз безрамочного окна (тянуть за края) — только в безрамочном режиме
    if frameless:
        threading.Thread(target=_enable_frameless_resize, daemon=True).start()

    # tray icon
    if _HAS_TRAY:
        icon_path = os.path.join(_UI_BASE, "icon.ico")
        if not os.path.exists(icon_path):
            icon_path = os.path.join(_UI_BASE, "icon.png")
        print("[tray] icon path:", icon_path, "exists:", os.path.exists(icon_path))
        if os.path.exists(icon_path):
            try:
                tray_icon = Image.open(icon_path)
                tray = pystray.Icon("planner", tray_icon, "Мыслик", menu=pystray.Menu(
                    pystray.MenuItem("Показать", lambda: window.show()),
                    pystray.MenuItem("Выход", lambda: window.destroy()),
                ))
                threading.Thread(target=tray.run, daemon=True).start()
                print("[tray] started")
            except Exception as e:
                print("[tray] error:", e)
        else:
            print("[tray] icon not found")

    if os.environ.get("PLANNER_SELFTEST") == "1":
        threading.Thread(target=_selftest, args=(window,), daemon=True).start()

    trace("starting webview, frameless=", frameless)
    webview.start(gui="edgechromium", debug=os.environ.get("PLANNER_DEBUG") == "1")
    trace("webview.start returned")
    if _HAS_TRAY and 'tray' in dir():
        try:
            tray.stop()
        except Exception:
            pass


if __name__ == "__main__":
    main()
