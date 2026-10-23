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
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Portable-MindCare.ps1" -ConfigureHost
goto fin

:accueil
echo.
echo Installation en cours (PC accueil)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Installer-Portable-MindCare.ps1"
goto fin

:fin
echo.
echo Termine. MindCare est sur le Bureau.
pause
