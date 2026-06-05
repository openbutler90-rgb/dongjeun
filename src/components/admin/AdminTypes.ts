// ── Admin 공통 타입 정의 ──

export interface JoinRequest {
  id: string;
  userId: string;
  nickname: string;
  userPhotoURL?: string;
  userEmail?: string;
  status: 'pending' | 'approved' | 'rejected';
  answers: { questionId: string; questionText: string; selectedOption: string; directText?: string }[];
  rejectReason?: string;
  createdAt: any;
}

export interface OperationOptions {
  approvalMode: boolean;
  pinNotices: boolean;
  reportWorkflow: boolean;
  regionLeaderAreas: boolean;
  autoHideBannedWords: boolean;
  settlementTracking: boolean;
  activityLog: boolean;
  bannedWords: string;
  permissions: {
    notice: 'admin' | 'manager';
    meetings: 'user' | 'regionalLeader' | 'manager';
    posts: 'user' | 'regionalLeader' | 'manager';
    inquiries: 'user' | 'regionalLeader' | 'manager';
  };
  // 승인 편지 템플릿
  approvalLetterTemplate?: string;
  approvalKakaoLink?: string;
  approvalJoinCode?: string;
  approvalRules?: string;
  // 신규 가입 환영 편지 템플릿
  welcomeLetterEnabled?: boolean;
  welcomeLetterTemplate?: string;
  welcomeKakaoLink?: string;
  welcomeJoinCode?: string;
  // ✅ 자동 승인 설정
  autoApproveEnabled?: boolean; // 직접작성·아니요 없으면 즉시 자동승인
}

export const DEFAULT_APPROVAL_LETTER = `안녕하세요! 동전커피 가입이 승인되었습니다 🎉

✅ 회원가입 승인이 완료되었습니다. 정식 가입을 위해 아래 절차를 진행해 주세요.

⚠️ 중요: 바로 로그아웃하지 마세요.
현재 우편 내용을 먼저 캡처하거나, 편지함의 [내용 복사] 또는 [TXT 저장] 기능으로 저장한 뒤 아래 절차를 진행해 주세요.
게스트 상태에서 로그아웃하면 현재 게스트 정보와 이 우편을 다시 확인하지 못할 수 있습니다.

──────────────────────
📱 정식 가입 방법
──────────────────────
현재 임시 게스트 계정으로 입장하셨습니다.
더 안전하고 편리한 이용을 위해 Google 계정으로 정식 가입을 권장드립니다.

▶ 가입 방법
1. 이 우편 내용을 캡처/복사/TXT 저장으로 먼저 보관
2. 저장이 끝난 뒤 우측 상단 프로필 → 로그아웃
3. 로그인 화면에서 [회원가입] 탭 선택
4. 참여코드 입력 후 Google 계정으로 가입
   (Google 로그인이 보안에 가장 안전합니다!)

🔐 참여코드: {{JOIN_CODE}}

──────────────────────
📋 커뮤니티 이용 규칙
──────────────────────
{{RULES}}

궁금한 점은 문의/신고 채널에 남겨주세요.
동전커피 운영진 드림 ☕`;

export const DEFAULT_WELCOME_LETTER = `환영합니다! 동전커피 정회원이 되신 것을 진심으로 축하드립니다 🎉

정식 가입이 완료되어 모든 기능을 이용하실 수 있습니다.

──────────────────────
💬 오픈카톡 모임 참여
──────────────────────
▶ 카카오톡 오픈채팅 링크: {{KAKAO_LINK}}
▶ 참여코드: {{JOIN_CODE}}

이 링크와 참여코드를 통해 오픈카톡 모임에 참여하실 수 있습니다.

앞으로 다양한 모임과 커뮤니티 활동을 함께 즐겨주세요.
궁금한 점은 언제든 문의/신고 채널에 남겨주시면 빠르게 도와드리겠습니다.

동전커피 운영진 드림 ☕`;

export const DEFAULT_OPERATION_OPTIONS: OperationOptions = {
  approvalMode: false,
  pinNotices: true,
  reportWorkflow: true,
  regionLeaderAreas: true,
  autoHideBannedWords: false,
  settlementTracking: true,
  activityLog: true,
  bannedWords: '',
  permissions: {
    notice: 'manager',
    meetings: 'user',
    posts: 'user',
    inquiries: 'user',
  },
  approvalLetterTemplate: DEFAULT_APPROVAL_LETTER,
  approvalKakaoLink: '',
  approvalJoinCode: '동전커피2026',
  approvalRules: '1. 서로 존중하는 언어 사용\n2. 개인정보 무단 공유 금지\n3. 광고/홍보성 게시글 금지\n4. 오프라인 모임 참석 시 매너 준수\n5. 운영진 결정에 협조',
  welcomeLetterEnabled: true,
  welcomeLetterTemplate: DEFAULT_WELCOME_LETTER,
  autoApproveEnabled: true,
};

export const ROLE_META: Record<string, { label: string; className: string; rank: number }> = {
  admin:          { label: '운영자',   className: 'bg-rose-500 text-white',    rank: 4 },
  manager:        { label: '부운영자', className: 'bg-amber-400 text-white',   rank: 3 },
  regionalLeader: { label: '지역장',   className: 'bg-blue-500 text-white',    rank: 2 },
  user:           { label: '일반',     className: 'bg-slate-200 text-slate-600', rank: 1 },
  guest:          { label: '게스트',   className: 'bg-gray-100 text-gray-400', rank: 0 },
};
