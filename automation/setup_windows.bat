@echo off
setlocal
cd /d "%~dp0.."
where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher "py" not found. Install Python for Windows first.
  pause
  exit /b 1
)
echo Installing PredioAI desktop automation dependencies...
py -m pip install -r automation\requirements.txt
if errorlevel 1 goto :fail
echo Installing Playwright Chromium...
py -m playwright install chromium
if errorlevel 1 goto :fail
echo.
echo Setup complete. Installing background bridge for this Windows user...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "automation\install_background_bridge.ps1"
if errorlevel 1 goto :fail
echo PredioAI is ready. You can close this window.
exit /b 0
:fail
echo.
echo Setup failed. Review the error messages above.
pause
exit /b 1
