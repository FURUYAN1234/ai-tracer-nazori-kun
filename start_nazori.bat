@echo off
setlocal
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.15 or later is required. Install it from https://nodejs.org/. 1>&2
  if /i not "%~1"=="--mcp" pause
  exit /b 1
)
node.exe "%~dp0scripts\launch-windows.mjs" %*
set "nazoriExit=%errorlevel%"
if not "%nazoriExit%"=="0" if /i not "%~1"=="--mcp" pause
exit /b %nazoriExit%
