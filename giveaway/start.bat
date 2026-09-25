@echo off
rem Double-click to start Token Wars on Windows.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install it from https://nodejs.org ^(the LTS button^), then double-click this file again.
  echo.
  pause
  exit /b 1
)
if exist giveaway\serve.js (node giveaway\serve.js --open) else (node serve.js --open)
