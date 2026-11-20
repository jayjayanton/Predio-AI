@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is not installed or Docker is not available.
  echo Install Docker Desktop, start it, and double-click this file again.
  pause
  exit /b 1
)

docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop is not running. Start Docker Desktop and try again.
  pause
  exit /b 1
)

set "PREDIOAI_DOWNLOADS=%USERPROFILE%\Downloads"
echo Preparing the PredioAI IRM assistant. The first start can take several minutes...
docker compose -f docker-compose.yml up -d --build
if errorlevel 1 goto :fail

start "" "http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale"
echo.
echo PredioAI IRM assistant is running. You can close this window.
timeout /t 3 >nul
exit /b 0

:fail
echo.
echo The assistant could not start. Review the message above and try again.
pause
exit /b 1
