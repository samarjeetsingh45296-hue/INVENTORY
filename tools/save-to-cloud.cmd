@echo off
REM Puts the inventory data in the cloud - paste one connection string.
REM Get one: docs\CLOUD-DATABASE.md (Atlas or Neon, both free).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0save-to-cloud.ps1"
pause
