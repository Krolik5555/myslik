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

TRACE = os.environ.get("PLANNER_TRACE") == "1"


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


# Состояние держим в module-глобалах, а НЕ в атрибутах Api:
# pywebview сериализует атрибуты js_api-объекта, и ссылка на окно (WinForms-контрол)
# вызывает бесконечную рекурсию, ломая мост JS<->Python.
_WINDOW = None
_MAXED = False
_SAVE_LOCK = threading.Lock()


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
                save_filename="planner-export-%s.json"
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

    # ---------- window ----------
    def win_min(self):
        try:
            _WINDOW.minimize()
        except Exception as e:
            print(e)

    def win_max(self):
        global _MAXED
        try:
            if _MAXED:
                _WINDOW.restore()
            else:
                _WINDOW.maximize()
            _MAXED = not _MAXED
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
    # ждём, пока pywebview создаст нативное окно (заголовок 'planner')
    hwnd = 0
    for _ in range(120):  # до ~12 c
        hwnd = win32gui.FindWindow(None, "planner")
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


def _enable_frameless_resize(title="planner", border=8):
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


def main():
    global _WINDOW
    trace("main start, file=", __file__)
    # отдельная идентичность приложения → Windows не группирует под pythonw и берёт нашу иконку
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("krolik.planner")
    except Exception as e:
        print("[appid] error:", e)
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
    trace("api created")

    frameless = os.environ.get("PLANNER_FRAMED") != "1"
    window = webview.create_window(
        "planner",
        url=UI+"?v=4",
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
                tray = pystray.Icon("planner", tray_icon, "KROLIK planner", menu=pystray.Menu(
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
