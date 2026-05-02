@echo off
chcp 65001 >nul
title Bonus Hunt Manager - Serveur local
cd /d "%~dp0"
echo.
echo   Demarrage du serveur local...
echo.
start "" http://localhost:8765/
node serve.js
pause
