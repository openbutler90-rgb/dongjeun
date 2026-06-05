@echo off
chcp 65001 > nul
cd /d "C:\Users\dhvnf\Downloads\동전커피"
echo [1/2] Building...
call npm run build
if errorlevel 1 (
  echo BUILD FAILED
  exit /b 1
)
echo [2/2] Deploying to Firebase...
call firebase deploy
echo DEPLOY DONE
