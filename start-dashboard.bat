@echo off
chcp 65001 >nul
title Blog Dashboard Server
color 0B

echo =========================================================
echo  [DASHBOARD] Starting Blog Automation Dashboard...
echo  URL: http://localhost:3131/dashboard.html
echo =========================================================
echo.

cd "%~dp0"

node -e "require('express')" 2>nul
if not %errorlevel% == 0 (
  echo [INSTALL] Installing express...
  call npm install express --save
)

echo [START] Server starting...
start "" "http://localhost:3131/dashboard.html"
node dashboard-server.js

echo.
pause
