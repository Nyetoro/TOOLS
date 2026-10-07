@echo off
title Digital Presence Audit
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this computer.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting the audit tool...
echo   Your browser will open automatically. Keep this window open while you work.
echo   Close it when you are finished.
echo.

start "" /min cmd /c "timeout /t 2 >nul & start http://localhost:4321"

node server.js

echo.
echo   The tool has stopped.
pause
