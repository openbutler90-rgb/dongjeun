# 동전커피 운영자 Electron 앱

운영자 PC에서 Firebase 웹앱과 로컬 AI/Pinokio 연동을 함께 쓰기 위한 래퍼입니다.

## 실행

```bash
npm run desktop
```

동작 방식:

- 먼저 웹/서버 번들을 빌드합니다.
- `http://127.0.0.1:3000` 서버가 이미 있으면 재사용합니다.
- 서버가 없으면 `dist/server.cjs`를 백그라운드로 띄운 뒤 Electron 창을 엽니다.
- 운영진 설정의 Pinokio/로컬 LLM 기능은 이 로컬 서버를 통해 호출됩니다.

## 용도 분리

- 일반 회원: 기존 Firebase Hosting 웹 링크 사용
- 운영자/부운영자: 이 Electron 앱으로 로컬 LLM, Pinokio, 이미지 생성기를 제어

패키징 설치 파일은 다음 단계에서 `electron-builder` 또는 `electron-forge`로 추가할 수 있습니다.
