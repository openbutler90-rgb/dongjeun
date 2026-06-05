@echo off
chcp 65001 > nul
cd /d "C:\Users\dhvnf\Downloads\동전커피"
echo === 빌드 시작 ===
call npm run build
if errorlevel 1 (
  echo 빌드 실패!
  exit /b 1
)
echo === 배포 시작 ===
call firebase deploy --only hosting
if errorlevel 1 (
  echo 배포 실패!
  exit /b 1
)
echo === 완료 ===
