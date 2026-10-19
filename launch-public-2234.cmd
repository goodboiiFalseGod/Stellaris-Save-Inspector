@echo off
setlocal
cd /d "%~dp0"

set "STELLARIS_INSPECTOR_PORT=2234"
set "STELLARIS_INSPECTOR_PUBLIC=1"
set "STELLARIS_INSPECTOR_BIND=0.0.0.0"

call :server_ready
if defined SERVER_READY goto :open

start "Stellaris Save Inspector public server" /b powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0server.ps1"
for /l %%i in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  call :server_ready
  if defined SERVER_READY goto :open
)

echo Public Inspector could not start on port 2234.
echo Close any program using that port, then run this launcher again.
pause
exit /b 1

:open
start "" "http://127.0.0.1:2234/SaveInspector/index.html"
echo Public mode listens on TCP 2234. Traffic is plain HTTP and is not encrypted.
exit /b 0

:server_ready
set "SERVER_READY="
curl.exe -fs --max-time 1 "http://127.0.0.1:2234/SaveInspector/public-ready" 2^>nul | findstr /x /l /c:"stellaris-inspector-public-v1" >nul
if not errorlevel 1 set "SERVER_READY=1"
exit /b 0
