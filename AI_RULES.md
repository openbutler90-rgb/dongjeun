# 프로젝트 공개 목적 및 운영 규칙

## 현재 GitHub 공개 목적

이 프로젝트는 실제 사용자가 존재하는 운영 중인 모임앱입니다.
현재 GitHub에 올리려는 이유는 **OpenAI의 Codex for OSS(오픈소스 지원 프로그램) 검토 및 신청 목적** 때문입니다.

목표:
- 실제 운영 프로젝트 증명
- 유지보수 프로젝트 증빙
- OpenAI Codex 지원 검토
- ChatGPT Pro 지원 혜택 신청

중요: 이 저장소는 **"공개 검토용" 저장소**이며, 운영 시스템 전체를 공개하려는 목적이 아닙니다.

---

## 공개 정책

GitHub 공개 시 반드시 다음 원칙을 지킵니다.

### 공개 가능
- UI 코드
- 일반 기능 로직
- 앱 구조
- 컴포넌트
- 상태관리 구조
- mock/sample 데이터
- 문서(README)

### 절대 공개 금지
- 실제 회원정보
- 운영 DB
- 채팅 데이터
- Firebase admin credentials
- API keys
- `.env`
- secret file
- 운영 서버 주소
- 관리자 권한 로직
- 결제 정보
- 운영용 Firebase 프로젝트 정보

민감 정보는 placeholder 또는 example 값으로 대체합니다.
예: `process.env.OPENAI_API_KEY` → `your_key_here`

---

# 운영 앱 AI 개발 규칙

현재 프로젝트는 실제 사용자가 존재하는 운영 중인 모임앱입니다.
절대 운영 코드를 직접 수정하지 마세요.

---

## 폴더 구조

```
D:\
  ├ 동전커피_PROD      ← 실제 운영 앱 (절대 직접 수정 금지)
  ├ 동전커피_DEV       ← 개발본 (테스트)
  ├ 동전커피_AI_WORK   ← AI가 수정하는 작업본
  └ BACKUP
       ├ YYYY-MM-DD_HHMM
       └ ...
```

| 폴더      | 용도         | AI 수정 허용 |
|----------|-------------|------------|
| PROD     | 실제 서비스   | ❌ 금지     |
| DEV      | 사람이 검수   | 제한적     |
| AI_WORK  | AI 실험/수정  | ✅ 허용     |

---

## 절대 금지

- 운영 앱(PROD) 직접 수정
- DB reset / delete / migration
- Firebase deploy 자동 실행
- Security rules 임의 수정
- Auth 구조 변경
- `.env` 또는 secret 파일 수정
- "전체 코드 정리", "리팩토링", "최적화", "안 쓰는 코드 제거" 등 전체 작업
- 회원 개인정보(이메일, 전화번호, 채팅 내용, 가입 신청서 등) 출력/커밋

---

## 작업 환경

AI는 반드시 `동전커피_AI_WORK` 폴더에서만 작업합니다.

```
PROD → DEV → AI_WORK
```

---

## 작업 순서 (필수)

1. **수정 계획 제출** — 변경 내용, 수정 파일, 영향 범위, 위험 요소
2. **사용자 승인** — 계획 확인 후 "승인" 받기
3. **AI_WORK에서 수정** — 요청한 파일만 수정
4. **Git Diff 확인** — `git diff`로 변경 내용 출력
5. **DEV 테스트** — 빌드/기능 테스트
6. **승격(Promote)** — 수정된 파일만 PROD로 이동 (전체 복사 금지)
7. **운영 배포** — 사용자 승인 후 `firebase deploy`

---

## 수정 범위

요청한 파일만 수정합니다. 다른 파일 변경 금지.

### 안전한 요청 예시

```
MeetingModal 참석자 실시간 동기화 버그만 수정

파일:
- src/components/MeetingModal.tsx

다른 파일 수정 금지
DB 구조 변경 금지
```

### 위험한 요청 예시 (금지)

```
전체 코드 정리해
최적화해
프로젝트 리팩토링해
안 쓰는 코드 제거해
깃허브에 올릴 준비해 (→ 별도 복사본 처리 필요)
```

---

## 수정 후 확인 사항

반드시 diff 출력:
- 변경 파일 목록
- 변경 이유
- 위험 요소

특히 아래 파일이 갑자기 수정되면 **즉시 중단**:
- `firebase.rules`
- `security.rules`
- `src/lib/firebase.ts` (config 로직)
- `.env*`
- `package-lock.json`
- 마이그레이션/DB 관련 파일

---

## 민감정보

절대 출력/커밋/게시 금지:
- API Key (Gemini, Kakao, Naver 등)
- Firebase admin credentials / config
- 회원 정보 (이메일, 전화번호, 주소, 채팅 데이터)
- 운영 서버 URL (`YOUR_APP_URL` 등)
- 오픈카톡 코드, 디스코드 채널 ID
- 환경변수, secret 파일

---

## 배포 규칙

- `firebase deploy`는 절대 자동 실행하지 않음
- 사용자가 "배포해"라고 명시적으로 지시한 후에만 가능
- 배포 전 반드시 `npm run build` 성공 확인

---

## GitHub 이벤트 제출 시

운영 코드를 직접 수정하지 마세요.

올바른 절차:
1. `동전커피_AI_WORK` 폴더에서 작업
2. 민감정보를 placeholder로 교체 (`.env.example` 등)
3. 별도 복사본에서 GitHub용 정리
4. 원본(PROD)은 절대 건드리지 않음
