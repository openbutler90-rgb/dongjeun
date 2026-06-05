@echo off
cd /d "C:\Users\dhvnf\Downloads\동전커피"

echo ===== BUILD START =====
call npm run build
if errorlevel 1 (
    echo BUILD FAILED
    pause
    exit /b
)

echo ===== FIREBASE DEPLOY =====
call firebase deploy

pause