@echo off
REM Double-click wrapper for the cloud migration. See docs\CLOUD-DATABASE.md
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0move-database-to-cloud.ps1"
pause
