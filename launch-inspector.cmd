@echo off
setlocal
cd /d "%~dp0"

call :server_ready
if defined SERVER_READY goto :open
if defined INCOMPATIBLE_BACKEND goto :incompatible
if not defined SERVER_READY (
  start "Stellaris Save Inspector server" /b powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
  for /l %%i in (1,1,10) do (
    timeout /t 1 /nobreak >nul
    call :server_ready
    if defined SERVER_READY goto :open
    if defined INCOMPATIBLE_BACKEND goto :incompatible
  )
)

echo The inspector server could not start on port 8765.
echo Close any program using that port, then run this launcher again.
echo Windows PowerShell 5.1 or newer is required.
pause
exit /b 1

:open
start "" "http://127.0.0.1:8765/SaveInspector/index.html"
exit /b 0

:incompatible
echo Port 8765 is occupied by an incompatible inspector server.
echo Stop the fallback Node server or other process using this port, then run launch-inspector.cmd again.
exit /b 1

:server_ready
set "SERVER_READY="
set "INCOMPATIBLE_BACKEND="
curl.exe -fs --max-time 1 "http://127.0.0.1:8765/SaveInspector/powershell-ready" 2>nul | findstr /x /l /c:"stellaris-inspector-powershell-v2" >nul
if not errorlevel 1 set "SERVER_READY=1"
if defined SERVER_READY exit /b 0
curl.exe -fs --max-time 1 --output NUL "http://127.0.0.1:8765/SaveInspector/index.html" >nul 2>nul
if not errorlevel 1 set "INCOMPATIBLE_BACKEND=1"
exit /b 0
