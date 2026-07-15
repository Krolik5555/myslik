@echo off
cd /d "%~dp0"
set PLANNER_DEBUG=1
echo Запуск Мыслика в режиме отладки (DevTools). Не закрывай это чёрное окно.
".venv\Scripts\python.exe" "app.py"
echo.
echo Приложение закрыто.
pause
