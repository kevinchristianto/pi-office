@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 24 LTS from https://nodejs.org/
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22 || (v[0]===22 && v[1]>=20) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.20 or newer is required. Node.js 24 LTS is recommended.
  exit /b 1
)
where pi >nul 2>nul
if errorlevel 1 (
  echo Pi is not on PATH. Install Pi using its official instructions first.
  exit /b 1
)
if not exist "%~dp0extension\pi-office.ts" (
  echo The observer extension is missing. Restore the complete Pi Office folder.
  exit /b 1
)
if not defined PI_OFFICE_TOKEN_FILE set "PI_OFFICE_TOKEN_FILE=%~dp0.pi-office-token"
if not defined PI_OFFICE_TOKEN (
  if not exist "%PI_OFFICE_TOKEN_FILE%" (
    echo Start Pi Office first, or set PI_OFFICE_TOKEN_FILE to the bridge's token file.
    exit /b 1
  )
)
if not defined PI_OFFICE_PORT set "PI_OFFICE_PORT=4317"
if not defined PI_OFFICE_URL set "PI_OFFICE_URL=http://127.0.0.1:%PI_OFFICE_PORT%"
rem Keep the caller's project directory and leave persistent Pi settings unchanged.
rem The observer reads the token file itself; never print or copy its contents.
call pi -e "%~dp0extension\pi-office.ts" %*
exit /b %ERRORLEVEL%
