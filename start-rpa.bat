@echo off
setlocal
chcp 65001 >nul
title Blogger RPA Dashboard & Worker Starter
color 0B

echo ==========================================
echo   Blogger RPA Dashboard & Worker Starter
echo ==========================================

REM 1. Check Redis (Memurai)
echo [*] Checking Redis (Memurai) status...
net start | find "Memurai" > nul
if %errorlevel% neq 0 (
    echo [!] WARNING: Memurai service is NOT running.
    echo [*] Starting Memurai service...
    net start Memurai
)

REM 2. Check node_modules
if not exist "node_modules" (
    echo [!] node_modules not found. Installing...
    call npm install
)

REM 3. Set Port and Run
set PORT=3002
echo [*] Starting Next.js Dashboard (Background)...
start /b cmd /c "set PORT=%PORT% && npm run dev"

echo [*] Starting RPA Worker (Background)...
start /b cmd /c "npm run worker"

REM 4. Auto-open Browser (with a short delay for server startup)
echo [*] Opening Next.js Dashboard in 5 seconds...
timeout /t 5 >nul
start http://localhost:%PORT%/curation

echo ==========================================
echo   Main Dashboard: http://localhost:%PORT%/curation
echo ==========================================
echo.
echo [!] DO NOT close the dashboard or worker windows.
echo [!] Keep this window open until you are finished.
pause
