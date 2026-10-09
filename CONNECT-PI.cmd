@echo off
setlocal
where pi >nul 2>nul
if errorlevel 1 (
  echo Pi is not on PATH. Install Pi using its official instructions first.
  exit /b 1
)
if not defined PI_OFFICE_TOKEN (
  if not exist "%~dp0.pi-office-token" (
    echo Start Pi Office first so it can create its local observer token.
    exit /b 1
  )
  set /p PI_OFFICE_TOKEN=<"%~dp0.pi-office-token"
)
if not defined PI_OFFICE_URL set "PI_OFFICE_URL=http://127.0.0.1:4317"
call pi -e "%~dp0extension\pi-office.ts" %*
