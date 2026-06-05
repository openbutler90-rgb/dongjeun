@echo off
chcp 65001 > nul
title 동전커피 빌드 & 배포
echo ===================================
echo   동전커피 앱 빌드 + Firebase 배포
echo ===================================
echo.

cd /d "%~dp0"
echo [현재 폴더] %CD%
echo.

echo [1/3] 의존성 확인 중...
where node >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Node.js가 설치되지 않았습니다.
  pause & exit /b 1
)
where firebase >nul 2>&1
if %errorlevel% neq 0 (
  echo ERROR: Firebase CLI가 설치되지 않았습니다.
  echo npm install -g firebase-tools 를 먼저 실행해주세요.
  pause & exit /b 1
)

echo [2/3] npm run build 실행 중... (30~60초 소요)
call npm run build
if %errorlevel% neq 0 (
  echo.
  echo === BUILD 실패 ===
  pause & exit /b 1
)

echo.
echo [3/3] Firebase 배포 중...
call firebase deploy
if %errorlevel% neq 0 (
  echo.
  echo === DEPLOY 실패 ===
  pause & exit /b 1
)

echo.
echo ===================================
echo   배포 완료! https://dongjeun-c840a.web.app
echo ===================================
pause
