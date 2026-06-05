import { Outlet, Navigate, Link, useLocation, useNavigate } from 'react-router';
import { useAuthStore } from '../../stores/authStore';
import { auth, db } from '../../lib/firebase';
import { signOut } from 'firebase/auth';
import React, { useState, useEffect, useRef } from 'react';
import { collection, deleteDoc, doc, limit, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { SettingsModal } from '../common/SettingsModal';
import { BrandLogo } from '../common/BrandLogo';
import { resolveProfileDecorations } from '../../lib/profileDecorations';
import { MailboxModal } from './MailboxModal';
import { NewMailBounce } from './NewMailBounce';
import { OperatorErrorBoundary } from '../common/OperatorErrorBoundary';
import { ToastContainer } from '../common/Toast';

const HomeIcon = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? '#FF5C5C' : 'none'} stroke={active ? '#FF5C5C' : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);
const SearchIcon = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF5C5C' : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const MapIcon = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF5C5C' : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
    <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
  </svg>
);
const CategoryIcon = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={active ? '#FF5C5C' : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const UserIcon = ({ active }: { active?: boolean }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? '#FF5C5C' : 'none'} stroke={active ? '#FF5C5C' : '#888'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>
);

const CHANNELS = [
  { id: 'meetings',      name: '모임 일정',    icon: '🤝', category: 'meeting' },
  { id: 'meeting_board', name: '모임 사진',    icon: '📷', category: 'meeting' },
  { id: 'hotplace',      name: '핫플레이스',  icon: '📍', category: 'place' },
  { id: 'restaurants',   name: '맛집',        icon: '🍽', category: 'place' },
  { id: 'spots',         name: '인생샷',      icon: '📸', category: 'place' },
  { id: 'accommodation', name: '숙소',        icon: '🏨', category: 'place' },
  { id: 'first_greeting',name: '첫 인사',    icon: '🌱', category: 'community' },
  { id: 'freeboard',     name: '자유게시판',  icon: '💬', category: 'community' },
  { id: 'ootd',          name: '패션/OOTD',   icon: '👗', category: 'community' },
  { id: 'counseling',    name: '생활꿀팁',    icon: '💡', category: 'community' },
  { id: 'webtoon',       name: '브로맨툰',     icon: '📖', category: 'community' },
  { id: 'ai',            name: 'AI 루이',     icon: '/ai-butler.png?v=20260518', category: 'community' },
  { id: 'inquiries',     name: '문의/신고',    icon: '🛟', category: 'community' },
  { id: 'join_request',  name: '가입신청',    icon: '📝', category: 'community' },
];

interface AppNotification {
  id: string;
  userId: string;
  type: 'like' | 'comment' | 'reply' | string;
  actorName?: string;
  postId?: string;
  title?: string;
  channelId?: string;
  message?: string;
  read?: boolean;
  createdAt?: any;
}

const toDateMs = (value: any) => {
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return 0;
};

// ✅ 전역 중복 방지: 모든 NotificationsBell 인스턴스가 공유하는 Set
const globalDisplayedNotifIds = new Set<string>();

function MenuIcon({ icon, active = false }: { icon: string; active?: boolean }) {
  if (icon.startsWith('/')) {
    return (
      <img
        src={icon}
        alt=""
        className={`w-6 h-6 rounded-full object-cover border ${active ? 'border-rose-200' : 'border-indigo-100'} bg-indigo-50`}
      />
    );
  }
  return <span className="text-lg w-6 text-center">{icon}</span>;
}

function NotificationsBell({ userId, compact = false, mobile = false }: { userId: string; compact?: boolean; mobile?: boolean }) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const [pushEnabled, setPushEnabled] = useState<boolean>(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const lastNotifiedMsRef = useRef<number>(0);

  // ✅ 푸시 상태 확인 (OneSignal or localStorage fallback)
  useEffect(() => {
    async function checkPush() {
      // 1. 먼저 localStorage 체크 (Electron & 웹 공통)
      const stored = localStorage.getItem('dongjeon-push-enabled');
      if (stored === '1') { setPushEnabled(true); return; }
      if (stored === '0') { setPushEnabled(false); return; }
      
      // 2. OneSignal 체크 (웹)
      try {
        const os = (window as any).OneSignal;
        if (os && os.Notifications) {
          const p = await os.Notifications.permission;
          setPushEnabled(p);
          if (p) localStorage.setItem('dongjeon-push-enabled', '1');
          return;
        }
      } catch { /* ignore */ }
      
      // 3. 브라우저 기본 권한 체크
      if (typeof Notification !== 'undefined') {
        setPushEnabled(Notification.permission === 'granted');
      }
    }
    checkPush();
  }, [isOpen]);

  async function togglePush(e: React.MouseEvent) {
    e.stopPropagation();
    console.log('[togglePush] clicked, pushEnabled:', pushEnabled);
    
    if (pushEnabled) {
      setPushEnabled(false);
      localStorage.setItem('dongjeon-push-enabled', '0');
      return;
    }
    
    // ✅ OneSignal 먼저 시도 (웹)
    try {
      const os = (window as any).OneSignal;
      if (os && os.Notifications && os.Notifications.requestPermission) {
        // OneSignal v16: 권한 요청 + 명시적 optIn
        await os.Notifications.requestPermission();
        try {
          await os.User.PushSubscription.optIn();
        } catch(e) {}
        const p = await os.Notifications.permission;
        console.log('[togglePush] OneSignal permission:', p);
        if (p) {
          setPushEnabled(true);
          localStorage.setItem('dongjeon-push-enabled', '1');
          // ✅ 구독 ID 로깅
          try {
            const sub = await os.User.PushSubscription;
            console.log('[OneSignal] PushSubscription ID:', sub?.id || 'none');
          } catch(e) {}
          return;
        }
      }
    } catch (err) {
      console.warn('[OneSignal] request failed:', err);
    }
    
    // ✅ OneSignal 실패 시 fallback — 브라우저 기본 알림 (단, 저장은 별도)
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
      const result = await Notification.requestPermission();
      console.log('[togglePush] Native permission:', result);
      const granted = result === 'granted';
      // ⚠️ OneSignal 없이 브라우저만 허용: 푸시는 못 받고, 앱 내 알림만 받음
      if (granted) {
        setPushEnabled(true);
        localStorage.setItem('dongjeon-push-enabled', '1');
      } else {
        setPushEnabled(false);
        localStorage.setItem('dongjeon-push-enabled', '0');
      }
    }
  }

  useEffect(() => {
    let personal: AppNotification[] = [];
    let globalItems: AppNotification[] = [];

    const mergeAndSet = () => {
      const merged = [...personal, ...globalItems]
        .sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));

      const pushEnabled = localStorage.getItem('dongjeon-push-enabled') === '1';
      if (pushEnabled && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const now = Date.now();
        const minGapMs = 2500;
        const readyToNotify = now - lastNotifiedMsRef.current > minGapMs;
        if (readyToNotify) {
          const newItems = merged.filter(item => item.id && !knownIdsRef.current.has(item.id));
          const top = newItems.find(item => item.read !== true && item.id && !globalDisplayedNotifIds.has(item.id));
          if (top && top.id) {
            const body = top.message || `${top.actorName || '누군가'}님의 알림이 도착했습니다.`;
            new Notification('동전커피', { body, icon: '/logo.png' });
            globalDisplayedNotifIds.add(top.id);
            lastNotifiedMsRef.current = now;
          }
        }
      }

      knownIdsRef.current = new Set(merged.map(item => item.id).filter(Boolean) as string[]);
      setItems(merged);
    };

    const q1 = query(collection(db, 'notifications'), where('userId', '==', userId), limit(50));
    const unsub1 = onSnapshot(q1, (snap) => {
      personal = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as AppNotification));
      mergeAndSet();
    }, console.error);

    // ✅ 전역 알림 (userId='all') 도 수신
    const q2 = query(collection(db, 'notifications'), where('userId', '==', 'all'), limit(50));
    const unsub2 = onSnapshot(q2, (snap) => {
      globalItems = snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as AppNotification));
      mergeAndSet();
    }, console.error);

    return () => { unsub1(); unsub2(); };
  }, [userId]);

  const unreadCount = items.filter(item => !item.read).length;
  const markAllRead = async () => {
    await Promise.all(
      items
        .filter(item => !item.read)
        .slice(0, 30)
        .map(item => updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(console.error))
    );
  };
  const handleClearAll = async () => {
    if (!confirm('모든 알림을 삭제하시겠습니까? (복구할 수 없습니다)')) return;
    await Promise.all(
      items.slice(0, 50).map(item => deleteDoc(doc(db, 'notifications', item.id)).catch(console.error))
    );
  };
  const openNotification = async (item: AppNotification) => {
    if (!item.read) updateDoc(doc(db, 'notifications', item.id), { read: true }).catch(console.error);
    setIsOpen(false);
    if (item.postId && item.channelId) {
      sessionStorage.setItem('openPostId', item.postId);
      navigate(`/channels/${item.channelId}`);
    }
  };

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          if (!isOpen && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setDropdownPos({ top: rect.bottom + 8, left: Math.min(rect.left, window.innerWidth - 324) });
          }
          setIsOpen(v => !v);
        }}
        className={`${compact ? 'h-9 w-9' : 'h-8 w-8'} relative flex items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-500 transition-colors`}
        title="알림"
      >
        <svg className={compact ? 'h-5 w-5' : 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-black leading-none text-white shadow">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className={`${mobile ? 'fixed right-3 top-14 w-[calc(100vw-1.5rem)] max-w-sm' : 'fixed w-80'} z-[99999] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl`}
          style={!mobile && dropdownPos ? { top: dropdownPos.top, left: dropdownPos.left } : undefined}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-black text-slate-800">알림</p>
            <div className="flex items-center gap-2">
              {/* ✅ OneSignal 푸시 알림 토글 */}
              <button
                type="button"
                onClick={(e) => togglePush(e)}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                  pushEnabled ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'
                }`}
                title={pushEnabled ? '푸시 알림 켜짐' : '푸시 알림 꺼짐'}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {pushEnabled ? 'ON' : 'OFF'}
              </button>
              {unreadCount > 0 && (
                <button type="button" onClick={markAllRead} className="text-[11px] font-black text-rose-500 hover:text-rose-600">모두 읽음</button>
              )}
              {items.length > 0 && (
                <button type="button" onClick={handleClearAll} className="text-[11px] font-black text-slate-400 hover:text-rose-500">모두 삭제</button>
              )}
              <button type="button" onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-rose-500">×</button>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length > 0 ? items.slice(0, 20).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => openNotification(item)}
                className={`flex w-full gap-3 border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${item.read ? 'bg-white' : 'bg-rose-50/50'}`}
              >
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${item.read ? 'bg-slate-200' : 'bg-rose-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-black text-slate-700 line-clamp-2">
                    {item.message || `${item.actorName || '누군가'}님이 반응했습니다.`}
                  </span>
                  {item.title && <span className="mt-1 block truncate text-[11px] text-slate-400">{item.title}</span>}
                </span>
              </button>
            )) : (
              <div className="px-4 py-8 text-center text-sm font-bold text-slate-400">아직 받은 알림이 없습니다.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, profile, isLoading } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadMailCount, setUnreadMailCount] = useState(0);
  const [isMailboxOpen, setIsMailboxOpen] = useState(false);
  const [localRunnerNotice, setLocalRunnerNotice] = useState<{ message: string; tone: 'info' | 'success' | 'error'; busy: boolean } | null>(null);

  useEffect(() => {
    const handler = (event: any) => {
      const detail = event?.detail || {};
      const target = detail.target === 'comfyui' ? 'ComfyUI' : 'Ollama';
      if (detail.status === 'starting') {
        setLocalRunnerNotice({ message: `${target} 실행기 올리는 중...`, tone: 'info', busy: true });
        return;
      }
      if (detail.status === 'ready') {
        setLocalRunnerNotice({ message: `${target} 실행기 준비 완료`, tone: 'success', busy: false });
        return;
      }
      if (detail.status === 'failed') {
        setLocalRunnerNotice({ message: `${target} 실행기 시작 실패`, tone: 'error', busy: false });
      }
    };
    window.addEventListener('dongjeon-local-runner', handler);
    return () => window.removeEventListener('dongjeon-local-runner', handler);
  }, []);

  useEffect(() => {
    if (!localRunnerNotice || localRunnerNotice.busy) return;
    const timer = window.setTimeout(() => setLocalRunnerNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [localRunnerNotice]);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'letters'),
      where('userId', '==', user.uid),
      where('read', '==', false)
    );
    const unsub = onSnapshot(q, (snap) => {
      setUnreadMailCount(snap.size);
    }, console.error);
    return unsub;
  }, [user]);

  // 1초 타이머
  const [nowTime, setNowTime] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // AI 웹툰 실시간 대시상황 및 전역 승인알림 상태
  const isOperator = profile?.role === 'admin' || profile?.role === 'manager';
  const [activeWebtoons, setActiveWebtoons] = useState<any[]>([]);
  const [closedNotifications, setClosedNotifications] = useState<string[]>(() => {
    try {
      const saved = sessionStorage.getItem('closed_webtoon_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // activeWebtoons 실시간 감지
  useEffect(() => {
    if (!isOperator || !user) {
      setActiveWebtoons([]);
      return;
    }
    const q = query(
      collection(db, 'posts'),
      where('status', 'in', ['planning', 'generating_episode', 'generating_cover', 'awaiting_character_approval', 'awaiting_episode_approval', 'awaiting_cover_approval'])
    );
    const unsub = onSnapshot(q, (snap) => {
      const active = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setActiveWebtoons(active);
    }, (err) => {
      console.error("Layout activeWebtoons snapshot error:", err);
    });
    return unsub;
  }, [isOperator, user]);

  const handleCloseNotification = (id: string) => {
    const next = [...closedNotifications, id];
    setClosedNotifications(next);
    try {
      sessionStorage.setItem('closed_webtoon_notifications', JSON.stringify(next));
    } catch (e) {
      console.error(e);
    }
  };

  const getProgressPercentage = (status: string, msg: string): number => {
    if (status === 'planning') {
      if (msg.includes('1단계')) return 15;
      if (msg.includes('2단계')) return 40;
      if (msg.includes('3단계')) return 65;
      if (msg.includes('4단계')) return 85;
      return 25;
    }
    if (status === 'generating_episode') {
      if (msg.includes('1단계')) return 25;
      if (msg.includes('2단계')) return 50;
      if (msg.includes('3단계')) return 75;
      if (msg.includes('4단계')) return 90;
      return 35;
    }
    if (status === 'generating_cover') return 80;
    return 100;
  };

  const getApprovalStepName = (status: string): string => {
    if (status === 'awaiting_character_approval') return '등장인물 설정화';
    if (status === 'awaiting_episode_approval') return '에피소드 콘티 미리보기';
    if (status === 'awaiting_cover_approval') return '대표 커버/썸네일';
    return '새 단계';
  };

  // ✅ 라우트 변경 시 카테고리 메뉴 자동 닫기
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // ✅ 안드로이드 뒤로가기 버튼으로 카테고리 메뉴 닫기 (popstate)
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    // 메뉴가 열릴 때 history에 상태 추가
    window.history.pushState({ menuOpen: true }, '');

    const handlePop = () => {
      setIsMobileMenuOpen(false);
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [isMobileMenuOpen]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo size="md" showText={false} className="animate-pulse" />
          <span className="text-sm text-gray-400 font-medium">불러오는 중...</span>
        </div>
      </div>
    );
  }

  // ✅ user 없으면 /auth로 (user 있는데 profile만 로딩 중인 경우는 스피너 표시)
  if (!user) return <Navigate to="/auth" replace />;
  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <BrandLogo size="md" showText={false} className="animate-pulse" />
          <span className="text-sm text-gray-400 font-medium">프로필 불러오는 중...</span>
        </div>
      </div>
    );
  }

  const isHome = location.pathname === '/';
  const isMap = location.pathname === '/map';
  const isProfile = location.pathname === '/profile';
  const isAdmin = location.pathname === '/admin';
  const channelId = location.pathname.split('/channels/')[1];
  const profileDecoration = resolveProfileDecorations(profile);
  const isGuest = profile?.role === 'guest';

  const visibleChannels = CHANNELS.filter(c => {
    if (c.id === 'join_request') return isGuest;
    if (c.id === 'first_greeting') return !isGuest;
    if (c.id === 'ai') return !isGuest;
    if (c.category === 'meeting') return !isGuest;
    return true;
  });

  const allowedForGuest = isGuest
    ? (
      location.pathname === '/'
      || location.pathname.startsWith('/channels/join_request')
      || (
        location.pathname.startsWith('/channels/')
        && !location.pathname.startsWith('/channels/ai')
        && !location.pathname.startsWith('/channels/meetings')
        && !location.pathname.startsWith('/channels/meeting_board')
        && !location.pathname.startsWith('/channels/first_greeting')
      )
      || location.pathname.startsWith('/profile')
    )
    : true;

  const renderMainContent = () => {
    if (isGuest && !allowedForGuest) {
      // 지도 페이지 - 흐릿하게 보이고 접근 불가
      if (isMap) {
        return (
          <div className="flex-1 relative overflow-hidden h-full">
            <div className="absolute inset-0 bg-slate-200 flex items-center justify-center" style={{ filter: 'blur(4px)', transform: 'scale(1.05)' }}>
              <div className="w-full h-full bg-gradient-to-br from-blue-100 via-green-50 to-blue-200 opacity-80" />
            </div>
            <div className="absolute inset-0 bg-white/60 backdrop-blur-md flex flex-col items-center justify-center z-10 p-6 text-center">
              <span className="text-5xl mb-4 block">🗺️</span>
              <h2 className="text-xl font-black text-slate-800 mb-2">정회원 전용 지도</h2>
              <p className="text-sm text-slate-500 mb-6 leading-relaxed">
                데이트 코스, 맛집, 핫플레이스 지도는<br/>가입 승인 후 전체 공개됩니다
              </p>
              <button
                onClick={() => navigate('/channels/join_request')}
                className="py-3 px-6 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-opacity"
              >
                📝 가입 신청서 작성하기
              </button>
            </div>
          </div>
        );
      }
      // 나머지 잠금 화면 (홈, 다른 채널)
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-6 text-center h-full">
          <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-xl max-w-md w-full space-y-6">
            <span className="text-6xl block animate-bounce">🔒</span>
            <div className="space-y-2">
              <h1 className="text-2xl font-black text-slate-800">가입 승인 대기 중</h1>
              <p className="text-sm font-bold text-slate-500">
                이 서비스는 정회원 전용 공간입니다.
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                커뮤니티의 &apos;가입신청&apos; 탭에서 신청서를 먼저 작성해주세요!<br/>
                승인 완료 후 모든 기능을 이용할 수 있습니다.
              </p>
            </div>
            <div className="pt-2">
              <button
                onClick={() => navigate('/channels/join_request')}
                className="w-full py-3 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-opacity"
              >
                📝 가입 신청서 작성하기
              </button>
            </div>
          </div>
        </div>
      );
    }
    if (isAdmin && isOperator) {
      return (
        <OperatorErrorBoundary title="관리자 페이지 오류">
          <Outlet />
        </OperatorErrorBoundary>
      );
    }
    return <Outlet />;
  };

  // ✅ 탭 클릭 핸들러 - 카테고리 메뉴 열려있으면 history 정리 후 이동
  const handleTabClick = (path: string, isCategory = false) => {
    if (isCategory) {
      setIsMobileMenuOpen(v => !v);
      return;
    }
    // 카테고리 메뉴가 열려 있으면 pushState한 항목을 정리
    if (isMobileMenuOpen) {
      setIsMobileMenuOpen(false);
      // popstate 핸들러가 제거된 후 navigate 실행
      setTimeout(() => navigate(path), 0);
      return;
    }
    navigate(path);
  };

  const bottomTabs = [
    { label: '홈',      path: '/',        icon: (a: boolean) => <HomeIcon active={a} />,     active: isHome && !isMobileMenuOpen },
    { label: '카테고리', path: '#',       icon: (a: boolean) => <CategoryIcon active={a} />, active: isMobileMenuOpen,            isCategory: true },
    ...(!isGuest ? [{ label: '지도',    path: '/map',     icon: (a: boolean) => <MapIcon active={a} />,      active: isMap && !isMobileMenuOpen }] : []),
    { label: '내 정보', path: '/profile', icon: (a: boolean) => <UserIcon active={a} />,     active: (isProfile || isAdmin) && !isMobileMenuOpen },
  ];

  return (
    <div className="flex h-screen w-full bg-[#F7F7F7] overflow-hidden">
      {localRunnerNotice && (
        <div className={`fixed top-0 left-0 right-0 z-[99999] ${localRunnerNotice.tone === 'success' ? 'bg-emerald-600' : localRunnerNotice.tone === 'error' ? 'bg-rose-600' : 'bg-slate-800'} text-white px-4 py-2 text-xs font-black flex items-center gap-2`}>
          {localRunnerNotice.busy ? <span className="animate-spin">⏳</span> : <span>{localRunnerNotice.tone === 'success' ? '✅' : localRunnerNotice.tone === 'error' ? '⚠️' : '⚙️'}</span>}
          <span className="flex-1 truncate">{localRunnerNotice.message}</span>
          <button type="button" onClick={() => setLocalRunnerNotice(null)} className="opacity-80 hover:opacity-100">✕</button>
        </div>
      )}

      {/* 데스크탑 왼쪽 사이드바 */}
      <aside className={`hidden md:flex flex-col bg-white border-r border-gray-100 transition-all duration-300 ${isDesktopSidebarOpen ? 'w-64' : 'w-16'} shrink-0`}>
        <div className="h-16 flex items-center px-4 border-b border-gray-100 gap-3 cursor-pointer" onClick={() => setIsDesktopSidebarOpen(v => !v)}>
          <BrandLogo size="sm" showText={isDesktopSidebarOpen} />
          {isDesktopSidebarOpen && (
            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => setIsMailboxOpen(true)}
                className="h-8 w-8 relative flex items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                title="편지함"
              >
                <span className="text-base">✉️</span>
                {unreadMailCount > 0 && (
                  <span className="absolute -right-1 -top-1 min-w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-[9px] font-black text-white shadow">
                    {unreadMailCount}
                  </span>
                )}
              </button>
              <NotificationsBell userId={user.uid} />
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar py-3 px-2">
          <Link to="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all ${isHome ? 'bg-red-50 text-[#FF5C5C]' : 'text-gray-600 hover:bg-gray-50'}`}>
            <HomeIcon active={isHome} />
            {isDesktopSidebarOpen && <span className="font-semibold text-sm">홈</span>}
          </Link>

          <Link to="/channels/notice" className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all ${channelId === 'notice' ? 'bg-red-50 text-[#FF5C5C]' : 'text-gray-600 hover:bg-gray-50'}`}>
            <span className="text-lg w-6 text-center">📌</span>
            {isDesktopSidebarOpen && <span className="font-semibold text-sm">공지사항</span>}
          </Link>

          {!isGuest && (
            <Link to="/map" className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 transition-all ${isMap ? 'bg-red-50 text-[#FF5C5C]' : 'text-gray-600 hover:bg-gray-50'}`}>
              <MapIcon active={isMap} />
              {isDesktopSidebarOpen && <span className="font-semibold text-sm">지도</span>}
            </Link>
          )}

          {!isDesktopSidebarOpen && (
            <div className="my-1 flex flex-col items-center gap-2">
              <button
                onClick={() => setIsMailboxOpen(true)}
                className="h-9 w-9 relative flex items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-500 transition-colors"
                title="편지함"
              >
                <span className="text-base">✉️</span>
                {unreadMailCount > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-[9px] font-black text-white shadow text-center">
                    {unreadMailCount}
                  </span>
                )}
              </button>
              <NotificationsBell userId={user.uid} compact />
            </div>
          )}

          {isDesktopSidebarOpen && (
            <>
                  <div className="px-3 py-2 mt-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">모임</span>
                  </div>
                  {visibleChannels.filter(c => c.category === 'meeting').map(c => (
                    <Link key={c.id} to={`/channels/${c.id}`}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-all ${channelId === c.id ? 'bg-red-50 text-[#FF5C5C] font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                      <MenuIcon icon={c.icon} active={channelId === c.id} />
                      <span className="font-medium text-sm">{c.name}</span>
                    </Link>
                  ))}

                  <div className="px-3 py-2 mt-3">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">데이트 코스</span>
                  </div>
                  {visibleChannels.filter(c => c.category === 'place').map(c => (
                    <Link key={c.id} to={`/channels/${c.id}`}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-all ${channelId === c.id ? 'bg-red-50 text-[#FF5C5C] font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                      <MenuIcon icon={c.icon} active={channelId === c.id} />
                      <span className="font-medium text-sm">{c.name}</span>
                    </Link>
                  ))}

              <div className="px-3 py-2 mt-3">
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">커뮤니티</span>
              </div>
              {visibleChannels.filter(c => c.category === 'community').map(c => (
                <Link key={c.id} to={`/channels/${c.id}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 transition-all ${channelId === c.id ? 'bg-red-50 text-[#FF5C5C] font-bold' : 'text-gray-600 hover:bg-gray-50'}`}>
                  <MenuIcon icon={c.icon} active={channelId === c.id} />
                  <span className="font-medium text-sm">{c.name}</span>
                </Link>
              ))}

              {!isGuest && (
                <>
                  <div className="px-3 py-2 mt-3">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">링크</span>
                  </div>
                  <a href={import.meta.env.VITE_KAKAO_OPENCHAT || ''} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-gray-600 hover:bg-yellow-50 hover:text-yellow-700 transition-all">
                    <span className="text-lg w-6 text-center">💬</span>
                    <span className="font-medium text-sm">오픈카톡</span>
                  </a>
                  <a href={import.meta.env.VITE_INSTAGRAM_URL || ''} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-gray-600 hover:bg-rose-50 hover:text-rose-600 transition-all">
                    <span className="text-lg w-6 text-center">📷</span>
                    <span className="font-medium text-sm">인스타그램</span>
                  </a>
                  <a href={import.meta.env.VITE_DISCORD_URL || ''} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl mb-0.5 text-gray-600 hover:bg-indigo-50 hover:text-indigo-600 transition-all">
                    <span className="text-lg w-6 text-center">🎮</span>
                    <span className="font-medium text-sm">디스코드</span>
                  </a>
                </>
              )}
            </>
          )}
        </nav>

        <div className={`border-t border-gray-100 p-3 ${isDesktopSidebarOpen ? '' : 'flex flex-col items-center gap-2'}`}>
          {isDesktopSidebarOpen ? (
            <div className="flex items-center gap-3">
              <Link to="/profile" title="내 프로필" className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity">
                <div className={`rounded-full p-[2px] shrink-0 ${profileDecoration.avatarRingClass || 'bg-white'}`}>
                  {profile.photoURL ? (
                    <img src={profile.photoURL} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover bg-white" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: profile.profileColor || '#FF5C5C' }}>
                      {profile.nickname?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-bold truncate ${profileDecoration.nameClass || 'text-gray-900'}`}>{profile.nickname}</p>
                  <p className="text-[11px] text-gray-400 truncate">
                    {profile.role === 'guest' ? '가입 신청 대기 중' : `Lv.${profile.level || 1} · ${profile.xp || 0}XP`}
                  </p>
                </div>
              </Link>
              <div className="flex gap-1">
                {(profile.role === 'admin' || profile.role === 'manager') && (
                  <Link to="/admin" className={`p-1.5 rounded-lg hover:bg-amber-50 transition-colors ${isAdmin ? 'text-amber-500' : 'text-gray-400'}`} title="운영 도구함">
                    <span className="text-base">👑</span>
                  </Link>
                )}
                <button onClick={() => setIsSettingsOpen(true)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors" title="설정">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                <button onClick={() => signOut(auth)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors" title="로그아웃">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>
            </div>
          ) : (
            <>
              <Link to="/profile">
                <div className={`rounded-full p-[2px] ${profileDecoration.avatarRingClass || 'bg-white'}`}>
                  {profile.photoURL ? (
                    <img src={profile.photoURL} alt="" referrerPolicy="no-referrer" className="w-9 h-9 rounded-full object-cover bg-white" />
                  ) : (
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: profile.profileColor || '#FF5C5C' }}>
                      {profile.nickname?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                </div>
              </Link>
              <button onClick={() => signOut(auth)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-400 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </>
          )}
        </div>
      </aside>

      {/* 메인 콘텐츠 영역 */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        {/* AI 웹툰 제작소 실시간 백그라운드 진행 상태 표시 (바) */}
        {isOperator && activeWebtoons.filter(w => ['planning', 'generating_episode', 'generating_cover'].includes(w.status)).map(project => {
          const activeLog = (() => {
            if (!project.workLogs || !Array.isArray(project.workLogs)) return null;
            const processing = project.workLogs.filter((l: any) => l.status === 'processing');
            return processing.length > 0 ? processing[processing.length - 1] : null;
          })();

          let displayMsg = project.progressMsg || '기획 준비 중...';
          let remainingSec = 0;
          if (activeLog) {
            const elapsedMs = nowTime - toDateMs(activeLog.startedAt);
            const elapsedSec = Math.floor(elapsedMs / 1000);
            remainingSec = Math.max(0, activeLog.estimatedSeconds - elapsedSec);
            displayMsg = `${activeLog.stepName} [모델: ${activeLog.model}]`;
          }

          const pct = getProgressPercentage(project.status, project.progressMsg || '');

          return (
            <div key={`progress-${project.id}`} className="bg-slate-900 text-white border-b border-slate-800 px-4 py-2 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs z-[20005] shrink-0 font-sans">
              <div className="flex items-center gap-2 min-w-0 w-full sm:w-auto">
                <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping shrink-0" />
                <span className="font-extrabold text-indigo-400 shrink-0">[AI 작업중]</span>
                <span className="font-bold truncate text-slate-200 max-w-[120px] sm:max-w-[200px]">"{project.title}"</span>
                <span className="text-slate-400 truncate text-[11px] font-medium">
                  - {displayMsg} {activeLog && <span className="text-indigo-300 font-bold ml-1">(예상 잔여: {remainingSec}초)</span>}
                </span>
              </div>
              <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-between sm:justify-end">
                <div className="w-24 sm:w-32 bg-slate-800 h-2 rounded-full overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 h-full transition-all duration-500" 
                    style={{ width: `${pct}%` }} 
                  />
                </div>
                <span className="font-black text-indigo-300 text-[10px] w-8 text-right shrink-0">
                  {pct}%
                </span>
                <button 
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    navigate(`/webtoon/${project.id}`);
                  }}
                  className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-[10px] transition-colors"
                >
                  상세보기
                </button>
                <button 
                  onClick={async () => {
                    if (window.confirm("AI 작업을 중지하시겠습니까?")) {
                      await updateDoc(doc(db, "posts", project.id), { cancelRequested: true });
                    }
                  }}
                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-bold text-[10px] transition-colors"
                >
                  ⏹ 중지
                </button>
              </div>
            </div>
          );
        })}

        {/* AI 웹툰 제작소 검수/승인 대기 전역 알림 배너 (수동 닫기/승인 전까지 절대 안 없어짐) */}
        {isOperator && activeWebtoons
          .filter(w => ['awaiting_character_approval', 'awaiting_episode_approval', 'awaiting_cover_approval'].includes(w.status))
          .filter(w => !closedNotifications.includes(w.id))
          .map(project => (
            <div key={`approval-${project.id}`} className="bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white px-4 py-3 shadow-lg flex items-center justify-between gap-3 text-xs sm:text-sm animate-fade-in z-[20006] shrink-0 relative">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-base shrink-0 animate-bounce">🔔</span>
                <p className="font-bold truncate">
                  <span className="bg-white/20 px-1.5 py-0.5 rounded text-[10px] font-black mr-1.5 border border-white/30">승인 요청</span>
                  웹툰 <strong className="text-amber-100">"{project.title}"</strong>의 {getApprovalStepName(project.status)} 승인이 필요합니다.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => {
                    setIsMobileMenuOpen(false);
                    navigate(`/webtoon/${project.id}`);
                  }}
                  className="bg-white text-orange-600 font-black px-3 py-1.5 rounded-lg shadow-md hover:bg-orange-50 active:scale-95 transition-all text-[11px]"
                >
                  승인하러 가기 →
                </button>
                <button
                  onClick={() => handleCloseNotification(project.id)}
                  className="text-white/80 hover:text-white hover:bg-white/10 p-1.5 rounded-full text-base transition-colors"
                  title="이 알림 숨기기 (새로고침 전까지)"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}

        {/* 모바일 상단 헤더 */}
        <header className="md:hidden h-14 bg-white border-b border-gray-100 flex items-center justify-between px-5 shrink-0 z-[20010]">
          {/* ✅ 홈 로고 클릭 시에도 카테고리 메뉴 닫기 */}
          <button
            onClick={() => {
              if (isMobileMenuOpen) {
                setIsMobileMenuOpen(false);
                setTimeout(() => navigate('/'), 0);
              } else {
                navigate('/');
              }
            }}
            className="flex items-center gap-2 pl-1"
          >
            <BrandLogo size="sm" />
          </button>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsMailboxOpen(true)}
              className="h-9 w-9 relative flex items-center justify-center rounded-xl text-slate-500 hover:bg-rose-50 hover:text-rose-500 transition-colors"
              title="편지함"
            >
              <span className="text-lg">✉️</span>
              {unreadMailCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-rose-500 flex items-center justify-center text-[9px] font-black text-white shadow">
                  {unreadMailCount}
                </span>
              )}
            </button>
            <NotificationsBell userId={user.uid} compact mobile />
            <Link to="/profile" className="p-1.5">
              <div className={`rounded-full p-[2px] ${profileDecoration.avatarRingClass || 'bg-white'}`}>
                {profile.photoURL ? (
                  <img src={profile.photoURL} alt="" referrerPolicy="no-referrer" className="w-7 h-7 rounded-full object-cover bg-white" />
                ) : (
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: profile.profileColor || '#FF5C5C' }}>
                    {profile.nickname?.[0]?.toUpperCase() || '?'}
                  </div>
                )}
              </div>
            </Link>
            {(profile.role === 'admin' || profile.role === 'manager') && (
              <Link to="/admin" className="p-1.5">
                <span className="text-lg">👑</span>
              </Link>
            )}
            <button onClick={() => setIsSettingsOpen(true)} className="p-1.5">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button onClick={() => signOut(auth)} className="p-1.5" title="로그아웃">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        {/* 페이지 콘텐츠 */}
        <main className="flex-1 overflow-hidden pb-16 md:pb-0">
          {renderMainContent()}
        </main>

        {/* ✅ 모바일 하단 탭바 */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-gray-100 flex items-center z-[20010] px-2">
          {bottomTabs.map((tab) => (
            <button
              key={tab.label}
              onClick={() => handleTabClick(tab.path, tab.isCategory)}
              className="flex-1 flex flex-col items-center justify-center gap-0.5 py-2"
            >
              {tab.icon(tab.active)}
              <span className={`text-[10px] font-semibold ${tab.active ? 'text-[#FF5C5C]' : 'text-gray-400'}`}>
                {tab.label}
              </span>
            </button>
          ))}
        </nav>
      </div>

      {/* ✅ 모바일 카테고리 메뉴 - 탭바보다 낮은 z-index로 탭바가 항상 위에 */}
      {isMobileMenuOpen && (
        <div
          className="md:hidden fixed inset-0 z-[20000] bg-white overflow-y-auto"
          style={{ top: '56px', bottom: '64px' }}
        >
          <div className="p-4 space-y-5">
            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">기본 메뉴</h3>
              <div className="grid grid-cols-2 gap-2">
                {!isGuest && (
                  <Link to="/channels/notice" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100 active:bg-gray-100">
                    <span className="text-xl">📌</span><span className="font-bold text-gray-700">공지사항</span>
                  </Link>
                )}
                {!isGuest && (
                  <Link to="/map" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100 active:bg-gray-100">
                    <span className="text-xl">🗺️</span><span className="font-bold text-gray-700">지도 검색</span>
                  </Link>
                )}
              </div>
            </div>

            {!isGuest && (
              <>
                <div>
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">모임</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {visibleChannels.filter(c => c.category === 'meeting').map(c => (
                      <Link key={c.id} to={`/channels/${c.id}`} onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-red-50/50 border border-red-100/50 active:bg-red-50">
                        <MenuIcon icon={c.icon} /><span className="font-bold text-gray-700">{c.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">데이트 코스</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {visibleChannels.filter(c => c.category === 'place').map(c => (
                      <Link key={c.id} to={`/channels/${c.id}`} onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-blue-50/50 border border-blue-100/50 active:bg-blue-50">
                        <MenuIcon icon={c.icon} /><span className="font-bold text-gray-700">{c.name}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div>
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">커뮤니티</h3>
              <div className="grid grid-cols-2 gap-2">
                {visibleChannels.filter(c => c.category === 'community').map(c => (
                  <Link key={c.id} to={`/channels/${c.id}`} onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-amber-50/50 border border-amber-100/50 active:bg-amber-50">
                    <MenuIcon icon={c.icon} /><span className="font-bold text-gray-700">{c.name}</span>
                  </Link>
                ))}
              </div>
            </div>

            {!isGuest && (
              <div>
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 ml-1">링크</h3>
                <div className="grid grid-cols-3 gap-2">
                  <a href={import.meta.env.VITE_KAKAO_OPENCHAT || ''} target="_blank" rel="noopener noreferrer" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-yellow-50/50 border border-yellow-100/50 active:bg-yellow-50">
                    <span className="text-xl">💬</span><span className="font-bold text-gray-700">오픈카톡</span>
                  </a>
                  <a href={import.meta.env.VITE_INSTAGRAM_URL || ''} target="_blank" rel="noopener noreferrer" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-rose-50/50 border border-rose-100/50 active:bg-rose-50">
                    <span className="text-xl">📷</span><span className="font-bold text-gray-700">인스타</span>
                  </a>
                  <a href={import.meta.env.VITE_DISCORD_URL || ''} target="_blank" rel="noopener noreferrer" onClick={() => setIsMobileMenuOpen(false)} className="flex items-center gap-3 p-3 rounded-2xl bg-indigo-50/50 border border-indigo-100/50 active:bg-indigo-50">
                    <span className="text-xl">🎮</span><span className="font-bold text-gray-700">디스코드</span>
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
      {isMailboxOpen && <MailboxModal onClose={() => setIsMailboxOpen(false)} />}
      <NewMailBounce onOpenMailbox={() => setIsMailboxOpen(true)} />
      <ToastContainer />
    </div>
  );
}
