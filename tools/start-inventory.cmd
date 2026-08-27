@echo off
REM ---------------------------------------------------------------------------
REM  Starts the Inventory Suite on this machine.
REM
REM  Double-click this file (or run it from any Command Prompt). It opens two
REM  minimised windows - one for the API, one for the web app - that keep
REM  running until you close them or run stop-inventory.cmd. They belong to
REM  YOUR Windows session, so nothing else stopping (including Claude) can
REM  take them down.
REM ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0.."

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  where node >nul 2>nul && (set "NODE_EXE=node") || (
    echo Node.js was not found. Install it with:  winget install OpenJS.NodeJS.LTS
    pause & exit /b 1
  )
)

sc query postgresql-x64-16 | find "RUNNING" >nul || (
  echo PostgreSQL is not running - starting the service...
  net start postgresql-x64-16 || (
    echo Could not start PostgreSQL. Start it from Services and run this again.
    pause & exit /b 1
  )
)

if not exist "apps\api\dist\main.js" (
  echo The API has not been built yet. Building...
  call "%APPDATA%\npm\pnpm.cmd" --filter @inventory/api build || (
    echo Build failed - see the message above.
    pause & exit /b 1
  )
)

REM Already running? Do not start a second copy on the same port.
netstat -ano | findstr /r ":4000 .*LISTENING" >nul && (
  echo The API is already running on port 4000.
) || (
  start "Inventory API" /min "%NODE_EXE%" apps\api\dist\main.js
  echo API starting on http://localhost:4000
)

netstat -ano | findstr /r ":3000 .*LISTENING" >nul && (
  echo The web app is already running on port 3000.
) || (
  start "Inventory Web" /min "%NODE_EXE%" apps\web\node_modules\next\dist\bin\next dev apps\web -p 3000
  echo Web starting on http://localhost:3000
)

echo.
echo Give it ~15 seconds, then open:  http://localhost:3000
echo To stop everything later, run:   tools\stop-inventory.cmd
timeout /t 5 >nul
start "" http://localhost:3000
endlocal
