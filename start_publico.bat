@echo off
title Sistema de Votacion Sopo - Servidor y Tunel Publico
echo ========================================================
echo  INICIANDO SERVIDOR Y TUNEL PUBLICO HTTPS (GRATIS)
echo ========================================================
echo.
echo Iniciando servidor en segundo plano...
start /b node server/server.js
timeout /t 3 /nobreak >nul
echo.
echo Creando enlace publico seguro HTTPS para los residentes...
echo Comparta la URL generada a continuacion en el chat de Zoom/Meet:
echo.
npx --yes localtunnel --port 3000
pause
