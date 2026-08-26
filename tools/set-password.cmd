@echo off
REM ---------------------------------------------------------------------------
REM  Sets the password for an Inventory Suite account.
REM
REM  Double-click this file, or run it from any Command Prompt. It finds Node
REM  itself, so it works even in a window that was open before Node was
REM  installed and therefore has a stale PATH.
REM
REM  Your password is typed at the prompt, not on the command line. It is not
REM  echoed, and never reaches your shell history or the process list.
REM ---------------------------------------------------------------------------
setlocal

cd /d "%~dp0..\apps\api" || (echo Could not find apps\api & pause & exit /b 1)

set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not exist "%NODE_EXE%" if "%NODE_EXE%" neq "node" (
  echo.
  echo Could not find Node.js. Install it, then run this again:
  echo   winget install OpenJS.NodeJS.LTS
  echo.
  pause
  exit /b 1
)

set "EMAIL=%~1"
if "%EMAIL%"=="" set /p "EMAIL=Email address of the account: "

if "%EMAIL%"=="" (
  echo No email given.
  pause
  exit /b 1
)

echo.
echo Setting the password for %EMAIL%
echo Type it at the prompt below. It will not be shown as you type.
echo.

"%NODE_EXE%" node_modules\ts-node\dist\bin.js --transpile-only scripts\set-password.ts --email "%EMAIL%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo Done. Sign in at http://localhost:3000/login
) else (
  echo That did not work - see the message above.
)
echo.
pause
endlocal
