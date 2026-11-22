@echo off
setlocal
set "PIDFILE=%APPDATA%\xome-planet\app.pid"
if not exist "%PIDFILE%" (
  echo No pid file. Planet is probably not running.
  timeout /t 3 >nul
  exit /b 1
)
set /p PID=<"%PIDFILE%"
if "%PID%"=="" (
  echo Pid file is empty.
  del "%PIDFILE%" >nul 2>&1
  timeout /t 3 >nul
  exit /b 1
)
taskkill /PID %PID% >nul 2>&1
if errorlevel 1 (
  echo Process %PID% not found. Cleaning up.
) else (
  echo Stopped PID %PID%.
)
del "%PIDFILE%" >nul 2>&1
timeout /t 2 >nul
