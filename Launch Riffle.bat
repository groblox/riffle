@echo off
rem Double-click to start Riffle and open it in your browser. Close this window to stop it.
title Riffle
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Riffle needs Node.js. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
  if errorlevel 1 ( pause & exit /b 1 )
)

rem already running? just open it
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 http://localhost:5199/ | Out-Null; exit 0 } catch { exit 1 }"
if not errorlevel 1 (
  start "" http://localhost:5199/
  exit /b 0
)

echo Starting Riffle at http://localhost:5199/
echo Other devices on your network can use the "Network" address shown below.
echo Keep this window open while you play; close it to stop.
call npx vite --host --port 5199 --strictPort --open
if errorlevel 1 pause
