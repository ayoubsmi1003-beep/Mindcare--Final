@echo off
setlocal EnableExtensions DisableDelayedExpansion
if "%~1"=="" exit /b 2
set "ELECTRON_RUN_AS_NODE=1"
set "MINDCARE_ELECTRON_ENV=production"
set "MINDCARE_CLINIC_CONFIG=%ProgramData%\MindCare\private\clinic-server.json"
set "MC_HTTPS=1"
set "NODE_OPTIONS="
"%~1\MindCare OS.exe" "%~1\resources\app.asar\dist-electron\main\serveur-cabinet.js" >>"%ProgramData%\MindCare\logs\clinic-task.log" 2>&1
exit /b %errorlevel%
