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

REM 3. Run Main Integrated Dashboard (Port 3002)
echo [*] Starting Main Dashboard (Next.js Port 3002)...
start /b cmd /c "npm run dev -- -p 3002"

REM 4. Run Background Worker
echo [*] Starting Background Worker...
start /b cmd /c "npm run worker"

REM 5. Auto-open Browser (with a short delay for server startup)
echo [*] Opening Main Integrated Dashboard in 10 seconds...
timeout /t 10 >nul
start http://localhost:3002/curation

echo ==========================================
echo   Main Dashboard: http://localhost:3002/curation
echo   Background Worker: Running...
echo ==========================================
echo.
echo [!] DO NOT close this window while using the RPA.
echo [!] Press any key to stop all background processes (closing this window also stops them).
pause
