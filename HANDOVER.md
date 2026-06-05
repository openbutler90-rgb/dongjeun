# 동전커피 프로젝트 인수인계

## 2026-05-28 작업(게스트 안내 우편 / 승인절차 저장 UX / 관리자 삭제 오류)

### 게스트 입장 시 안내 우편 자동 발송
- 익명 로그인(게스트 입장) 직후 1회 “게스트 입장 안내 우편” 생성 + 알림 생성
- 우편 내용: 환영, 가입신청 방법, 로그아웃 시 게스트 정보/우편 확인 불가 경고, 승인 후 절차 저장/캡처 안내
- 파일: [AuthPage.tsx](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/pages/AuthPage.tsx)

### 승인 우편 저장 UX(복사/TXT 저장)
- 편지 상세에서 “내용 복사”, “TXT 저장” 버튼 제공 + 저장/캡처 안내 문구 표시
- 파일: [MailboxModal.tsx](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/components/layout/MailboxModal.tsx), [MailboxModal.tsx](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/components/common/MailboxModal.tsx)

### 승인 우편 기본 템플릿 문구 강화
- “승인 후 바로 로그아웃 금지”, “우편을 먼저 저장/캡처 후 절차 진행” 흐름을 기본 템플릿에 반영
- 파일: [AdminTypes.ts](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/components/admin/AdminTypes.ts)

### 관리자(운영진) 삭제 실패 원인 수정
- 원인: 운영진이 다른 유저의 알림/우편을 조회(쿼리)할 때 규칙에서 read 권한이 막혀, 삭제 전에 조회 단계에서 permission-denied가 발생
- 조치: 운영자(isAdmin)만 다른 유저의 letters/notifications 조회 및 삭제 가능하도록 규칙 정리 + 관리자 UI에서 부운영자는 가입신청 승인만 가능하도록 제한
- 파일: [firestore.rules](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/firestore.rules), [AdminUsers.tsx](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/components/admin/AdminUsers.tsx), [AdminJoinRequests.tsx](file:///c:/Users/dhvnf/Downloads/%EB%8F%99%EC%A0%84%EC%BB%A4%ED%94%BC/src/components/admin/AdminJoinRequests.tsx)

## 운영/배포 메모
- Firebase Hosting 배포 전: `npm run build`로 dist 생성 후 `firebase deploy` 수행
