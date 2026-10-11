@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22 || (v[0]===22 && v[1]>=20) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.20 or newer is required. Node.js 24 LTS is recommended.
  pause
  exit /b 1
)
if not exist "%~dp0dist\index.html" (
  echo Pi Office has not been built in this folder.
  echo Open a terminal in "%~dp0" and run npm ci, then npm run build.
  echo These commands install the locked dependencies and build the app.
  pause
  exit /b 1
)
node "%~dp0bridge\server.mjs"
set "OFFICE_EXIT=%ERRORLEVEL%"
if not "%OFFICE_EXIT%"=="0" pause
exit /b %OFFICE_EXIT%
