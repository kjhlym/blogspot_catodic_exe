@echo off
title Cathodic Protection Blog Auto-Posting Bot
color 0B

echo =========================================================
echo  [SYSTEM] Cathodic Blog Automation Bot is starting...
echo  Posting will proceed in the background while this window is open.
echo  Live progress logs will be displayed below.
echo =========================================================
echo.

cd /d "%~dp0"

call npx tsx scripts/auto-publish.ts

echo.
echo =========================================================
echo  [SUCCESS] All auto-publishing tasks are completed!
echo  (The computer will NOT be shut down.)
echo  (This window will close automatically in 10 seconds.)
echo =========================================================
timeout /t 10
