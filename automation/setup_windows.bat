@echo off
rem Backward-compatible entry point. Docker now supplies Python, Playwright and Chromium.
call "%~dp0start_docker_windows.bat"
exit /b %errorlevel%
