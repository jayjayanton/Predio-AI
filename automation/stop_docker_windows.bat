@echo off
setlocal
cd /d "%~dp0"
docker compose -f docker-compose.yml down
if errorlevel 1 (
  echo The assistant could not be stopped. Make sure Docker Desktop is running.
  pause
  exit /b 1
)
echo PredioAI IRM assistant stopped.
timeout /t 2 >nul
