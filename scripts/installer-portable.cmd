@echo off
setlocal
cd /d "%~dp0"
title MindCare - installation
echo.
echo   ============================================================
echo    MindCare - installation sur ce PC
echo   ============================================================
echo.
echo    M = ce PC est le PC MEDECIN  (il heberge la base du cabinet)
echo    A = ce PC est le PC ACCUEIL  (il se connecte au PC medecin)
echo.
choice /c MA /n /m "Votre choix [M/A] : "
if errorlevel 2 goto accueil
if errorlevel 1 goto medecin

:medecin
echo.
echo Installation en cours (PC medecin)...
rem -Force : le script arrete d'abord le service et l'application, puis repart
rem d'un dossier propre. Sans cela, un executable en cours d'execution fait
rem echouer la copie (robocopy 16) — constate en cabinet.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Portable-MindCare.ps1" -Force -ConfigureHost
goto fin

:accueil
echo.
echo Installation en cours (PC accueil)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Portable-MindCare.ps1" -Force
goto fin

:fin
echo.
echo Termine. MindCare est sur le Bureau.
pause
