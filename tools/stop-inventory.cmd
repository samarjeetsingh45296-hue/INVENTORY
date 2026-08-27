@echo off
REM Stops the Inventory Suite servers (leaves PostgreSQL running - it is a
REM Windows service and other things may depend on it).
setlocal
echo Stopping anything listening on ports 3000 and 4000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":3000 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r ":4000 .*LISTENING"') do taskkill /f /pid %%p >nul 2>nul
echo Done. PostgreSQL was left running.
pause
endlocal
