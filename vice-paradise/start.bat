@echo off
rem Vice Paradise launcher for Windows
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20.19+ is required. Download it from https://nodejs.org
  pause
  exit /b 1
)
node scripts\launch.mjs %*
pause
