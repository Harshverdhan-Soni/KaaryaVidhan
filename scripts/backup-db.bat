@echo off
REM KaaryaVidhan - Realtime Database backup (double-click, or point Task Scheduler here)
REM Delegates to backup-db.ps1 so the backup logic lives in one place.
setlocal
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0backup-db.ps1"
set "_rc=%ERRORLEVEL%"
REM Keep the window open only when double-clicked from Explorer, not when scheduled.
echo %cmdcmdline% | find /i "%~nx0" >nul && pause
exit /b %_rc%
