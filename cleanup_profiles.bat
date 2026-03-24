@echo off
echo [안내] Playwright 브라우저 프로필을 초기화합니다...
if exist "playwright-profile-gemini-vibe" (
    echo [삭제 중] playwright-profile-gemini-vibe...
    rmdir /s /q "playwright-profile-gemini-vibe"
)
if exist "playwright-profile-blogger" (
    echo [삭제 중] playwright-profile-blogger...
    rmdir /s /q "playwright-profile-blogger"
)
if exist "playwright-profile-gemini-vibe-fresh" (
    echo [삭제 중] playwright-profile-gemini-vibe-fresh...
    rmdir /s /q "playwright-profile-gemini-vibe-fresh"
)
echo [완료] 프로필 폴더가 삭제되었습니다. 이제 다시 실행해 주세요.
pause
