@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
node "%~dp0bridge\server.mjs"
if errorlevel 1 pause
