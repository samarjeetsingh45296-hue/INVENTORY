@echo off
REM Silent variant of start-inventory.cmd for the Windows Startup folder:
REM no pause, no browser popup, safe to run when everything is already up.
setlocal
cd /d "%~dp0.."

set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" exit /b 0

sc query postgresql-x64-16 | find "RUNNING" >nul || net start postgresql-x64-16 >nul 2>nul

netstat -ano | findstr /r ":4000 .*LISTENING" >nul || (
  start "Inventory API" /min "%NODE_EXE%" apps\api\dist\main.js
)
netstat -ano | findstr /r ":3000 .*LISTENING" >nul || (
  start "Inventory Web" /min "%NODE_EXE%" apps\web\node_modules\next\dist\bin\next dev apps\web -p 3000
)
endlocal
