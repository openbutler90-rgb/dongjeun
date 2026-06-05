import React, { useEffect, useState, useRef } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, serverTimestamp, addDoc, deleteDoc, orderBy, getDocs, where, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { uploadToCloudinary } from '../lib/cloudinary';
import { useAuthStore, UserProfile } from '../stores/authStore';
import { useToastStore } from '../stores/toastStore';
import { Navigate } from 'react-router';
import { resolveKoreanPlace } from '../lib/placeTools';
import { ensureDailyAiPosts, DAILY_AI_CATEGORIES } from '../lib/dailyAiPublisher';
import { AdminJoinRequests } from '../components/admin/AdminJoinRequests';
import { AdminMailSender } from '../components/admin/AdminMailSender';
import { AdminUsers } from '../components/admin/AdminUsers';
import { AdminPushNotificationTab } from '../components/admin/AdminPushNotification';
import {
  JoinRequest, OperationOptions, DEFAULT_OPERATION_OPTIONS, ROLE_META
} from '../components/admin/AdminTypes';

interface Banner {
  id: string;
  imageUrl: string;
  mobileImageUrl?: string;   // 모바일 전용 이미지
  title: string;
  subtitle: string;
  mobileTitle?: string;
  mobileSubtitle?: string;
  showTitle?: boolean;       // 메인 텍스트 표시여부
  showSubtitle?: boolean;    // 서브 텍스트 표시여부
  mobileShowTitle?: boolean;
  mobileShowSubtitle?: boolean;
  focalX?: number;           // 인물 포커스 X (%)
  focalY?: number;           // 인물 포커스 Y (%) — 얼굴은 보통 15~35
  mobileFocalX?: number;
  mobileFocalY?: number;
  titleSize: number;
  subtitleSize: number;
  mobileTitleSize?: number;
  mobileSubtitleSize?: number;
  titleColor: string;
  subtitleColor: string;
  mobileTitleColor?: string;
  mobileSubtitleColor?: string;
  titleX: number;
  titleY: number;
  mobileTitleX?: number;
  mobileTitleY?: number;
  subtitleX: number;
  subtitleY: number;
  mobileSubtitleX?: number;
  mobileSubtitleY?: number;
  showLogo?: boolean;
  logoX?: number;
  logoY?: number;
  logoSize?: number;
  mobileShowLogo?: boolean;
  mobileLogoX?: number;
  mobileLogoY?: number;
  mobileLogoSize?: number;
  showWordmark?: boolean;
  wordmarkX?: number;
  wordmarkY?: number;
  wordmarkSize?: number;
  mobileShowWordmark?: boolean;
  mobileWordmarkX?: number;
  mobileWordmarkY?: number;
  mobileWordmarkSize?: number;
  linkChannel?: string;
  placement?: 'hero' | 'rail';
  isActive?: boolean;
  priority?: number;
  createdAt: any;
}

type BannerDevice = 'desktop' | 'mobile';
type BannerDragTarget = 'title' | 'subtitle' | 'logo' | 'wordmark';

const BANNER_LINK_OPTIONS = [
  { value: '', label: '연결 없음' },
  { value: 'notice', label: '공지사항' },
  { value: 'meetings', label: '모임' },
  { value: 'hotplace', label: '핫플레이스' },
  { value: 'restaurants', label: '맛집' },
  { value: 'spots', label: '인생샷' },
  { value: 'accommodation', label: '숙소' },
  { value: 'freeboard', label: '자유게시판' },
  { value: 'ootd', label: '패션/OOTD' },
  { value: 'counseling', label: '생활 꿀팁' },
  { value: 'inquiries', label: '문의/신고' },
  { value: 'webtoon', label: '브로맨툰' },
  { value: 'ai', label: 'AI 루이' },
  { value: 'map', label: '지도' },
  { value: import.meta.env.VITE_KAKAO_OPENCHAT || '', label: '오픈카톡 (외부)' },
  { value: import.meta.env.VITE_DISCORD_URL || '', label: '디스코드 (외부)' },
  { value: import.meta.env.VITE_INSTAGRAM_URL || '', label: '인스타그램 (외부)' },
];

function compressImage(file: File | Blob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1600;
        let width = img.width;
        let height = img.height;
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else reject(new Error('Canvas to Blob failed'));
          },
          'image/jpeg',
          0.7
        );
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

const DEFAULT_BANNER = {
  title: '동전커피',
  subtitle: '동전커피에 오신 것을 환영합니다!',
  mobileTitle: '동전커피',
  mobileSubtitle: '동전커피에 오신 것을 환영합니다!',
  showTitle: true,
  showSubtitle: true,
  mobileShowTitle: true,
  mobileShowSubtitle: true,
  focalX: 50,
  focalY: 30,
  mobileFocalX: 50,
  mobileFocalY: 30,
  mobileImageUrl: '',
  titleSize: 48,
  subtitleSize: 24,
  mobileTitleSize: 30,
  mobileSubtitleSize: 15,
  titleColor: '#ffffff',
  subtitleColor: '#ffffff',
  mobileTitleColor: '#ffffff',
  mobileSubtitleColor: '#ffffff',
  titleX: 50,
  titleY: 40,
  mobileTitleX: 50,
  mobileTitleY: 38,
  subtitleX: 50,
  subtitleY: 60,
  mobileSubtitleX: 50,
  mobileSubtitleY: 56,
  showLogo: true,
  logoX: 38,
  logoY: 48,
  logoSize: 74,
  mobileShowLogo: true,
  mobileLogoX: 34,
  mobileLogoY: 42,
  mobileLogoSize: 52,
  showWordmark: true,
  wordmarkX: 55,
  wordmarkY: 48,
  wordmarkSize: 260,
  mobileShowWordmark: true,
  mobileWordmarkX: 55,
  mobileWordmarkY: 42,
  mobileWordmarkSize: 160,
  linkChannel: '',
  placement: 'hero',
  isActive: true,
  priority: 0,
};

// ─── AI 게시물 관리 컴포넌트 (카테고리 선택 생성 + 청소 미리보기) ───
const CHANNEL_LABELS: Record<string, string> = {
  freeboard: '자유게시판', restaurants: '맛집', accommodation: '숙소',
  hotplace: '핫플레이스', ootd: '패션/OOTD', counseling: '생활꿀팁',
};

function AiPostManager({ profile, isLoading, setIsLoading }: { profile: any; isLoading: boolean; setIsLoading: (v: boolean) => void }) {
  const [selectedGenIndices, setSelectedGenIndices] = useState<Set<number>>(new Set(DAILY_AI_CATEGORIES.map((_, i) => i)));
  const [showCleanupModal, setShowCleanupModal] = useState(false);
  const [showAiMenu, setShowAiMenu] = useState(false);
  const [cleanupPosts, setCleanupPosts] = useState<any[]>([]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [excludedChannels, setExcludedChannels] = useState<Set<string>>(new Set());
  const [cleanupLoading, setCleanupLoading] = useState(false);

  const toggleGenIndex = (i: number) => {
    setSelectedGenIndices(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const toggleGenAll = () => {
    if (selectedGenIndices.size === DAILY_AI_CATEGORIES.length) {
      setSelectedGenIndices(new Set());
    } else {
      setSelectedGenIndices(new Set(DAILY_AI_CATEGORIES.map((_, i) => i)));
    }
  };

  const handleGenerate = async () => {
    if (selectedGenIndices.size === 0) { alert('생성할 카테고리를 1개 이상 선택해주세요.'); return; }
    if (!window.confirm(`선택한 ${selectedGenIndices.size}개 카테고리의 AI 게시물을 생성하시겠습니까?`)) return;
    setIsLoading(true);
    try {
      await ensureDailyAiPosts(profile, true, Array.from(selectedGenIndices));
      showToast('AI 게시물 생성을 완료했습니다.', 'success');
    } catch (err: any) { alert('오류: ' + err.message); }
    finally { setIsLoading(false); }
  };

  const handleOpenCleanup = async () => {
    setCleanupLoading(true);
    try {
      const q = query(collection(db, 'posts'), where('isAiGenerated', '==', true), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setCleanupPosts(posts);
      setExcludedIds(new Set());
      setExcludedChannels(new Set());
      setShowCleanupModal(true);
    } catch (err: any) { alert('불러오기 실패: ' + err.message); }
    finally { setCleanupLoading(false); }
  };

  const toggleExcludeChannel = (ch: string) => {
    setExcludedChannels(prev => {
      const next = new Set(prev);
      if (next.has(ch)) {
        next.delete(ch);
        // 해당 채널 게시물 개별 해제도 원복
        setExcludedIds(prevIds => {
          const nextIds = new Set(prevIds);
          cleanupPosts.filter(p => p.channelId === ch).forEach(p => nextIds.delete(p.id));
          return nextIds;
        });
      } else {
        next.add(ch);
        // 해당 채널 게시물 전부 개별 해제에 추가
        setExcludedIds(prevIds => {
          const nextIds = new Set(prevIds);
          cleanupPosts.filter(p => p.channelId === ch).forEach(p => nextIds.add(p.id));
          return nextIds;
        });
      }
      return next;
    });
  };

  const toggleExcludePost = (postId: string) => {
    setExcludedIds(prev => {
      const next = new Set(prev);
      if (next.has(postId)) next.delete(postId); else next.add(postId);
      return next;
    });
  };

  const postsToDelete = cleanupPosts.filter(p => !excludedIds.has(p.id));

  const handleConfirmDelete = async () => {
    if (postsToDelete.length === 0) { alert('삭제할 게시물이 없습니다.'); return; }
    if (!window.confirm(`총 ${postsToDelete.length}개의 AI 게시물을 삭제합니다. 이 작업은 되돌릴 수 없습니다.`)) return;
    setCleanupLoading(true);
    try {
      let count = 0;
      for (const post of postsToDelete) {
        await deleteDoc(doc(db, 'posts', post.id));
        count++;
      }
      showToast(`🧹 ${count}개의 AI 게시물이 삭제되었습니다.`, 'success');
      setShowCleanupModal(false);
    } catch (err: any) { alert('오류: ' + err.message); }
    finally { setCleanupLoading(false); }
  };

  // 채널별 그룹화
  const channelGroups = cleanupPosts.reduce<Record<string, any[]>>((acc, p) => {
    const ch = p.channelId || 'unknown';
    if (!acc[ch]) acc[ch] = [];
    acc[ch].push(p);
    return acc;
  }, {});

  return (
    <>
      <div className="space-y-5">
        <div>
          <h4 className="font-bold text-slate-700 mb-1">🤖 AI 게시물 수동 일괄 발행</h4>
          <p className="text-xs text-slate-400 mb-3">생성할 카테고리를 선택하고 발행하세요.</p>
          
          {/* 카테고리 선택 그리드 */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-slate-600">생성할 카테고리 선택</span>
              <button
                type="button"
                onClick={toggleGenAll}
                className="text-[11px] font-bold text-indigo-600 hover:underline"
              >
                {selectedGenIndices.size === DAILY_AI_CATEGORIES.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DAILY_AI_CATEGORIES.map((cat, i) => (
                <label
                  key={i}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-bold cursor-pointer transition-all ${
                    selectedGenIndices.has(i)
                      ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                      : 'bg-white border-slate-200 text-slate-400'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedGenIndices.has(i)}
                    onChange={() => toggleGenIndex(i)}
                    className="w-3.5 h-3.5 accent-indigo-600"
                  />
                  <span className="truncate">{cat.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* ✅ AI 작업 메뉴 (버튼 2개 → ⋮ 하나로 통합) */}
          <div className="relative">
            <button
              onClick={() => setShowAiMenu(!showAiMenu)}
              className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2"
            >
              ⚡ AI 작업
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showAiMenu && (
              <div className="absolute left-0 top-full mt-1 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30 overflow-hidden">
                <button
                  onClick={() => { handleGenerate(); setShowAiMenu(false); }}
                  disabled={isLoading || selectedGenIndices.size === 0}
                  className="w-full text-left px-4 py-2.5 text-sm font-bold text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40 disabled:hover:bg-white flex items-center gap-2"
                >
                  🚀 선택한 {selectedGenIndices.size}개 카테고리 생성
                </button>
                <button
                  onClick={() => { handleOpenCleanup(); setShowAiMenu(false); }}
                  disabled={isLoading || cleanupLoading}
                  className="w-full text-left px-4 py-2.5 text-sm font-bold text-rose-500 hover:bg-rose-50 transition-colors border-t border-slate-100 disabled:opacity-40 flex items-center gap-2"
                >
                  🗑️ AI 게시물 청소 미리보기
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 청소 미리보기 모달 */}
      {showCleanupModal && (
        <div className="fixed inset-0 z-[99999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-lg font-black text-slate-800">🧹 AI 게시물 청소 미리보기</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  전체 {cleanupPosts.length}개 중 <span className="font-bold text-rose-600">{postsToDelete.length}개 삭제</span> · <span className="font-bold text-green-600">{excludedIds.size}개 보존</span>
                </p>
              </div>
              <button onClick={() => setShowCleanupModal(false)} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full">✕</button>
            </div>

            {/* 카테고리별 일괄 해제 */}
            <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 shrink-0">
              <p className="text-[11px] font-bold text-slate-500 mb-2">카테고리별 일괄 보존/해제</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(channelGroups).map(ch => (
                  <button
                    key={ch}
                    onClick={() => toggleExcludeChannel(ch)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                      excludedChannels.has(ch)
                        ? 'bg-green-50 border-green-300 text-green-700'
                        : 'bg-white border-slate-200 text-slate-600 hover:border-rose-300'
                    }`}
                  >
                    {excludedChannels.has(ch) ? '✅ ' : ''}{CHANNEL_LABELS[ch] || ch} ({channelGroups[ch].length})
                  </button>
                ))}
              </div>
            </div>

            {/* 게시물 리스트 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
              {cleanupPosts.length === 0 ? (
                <div className="text-center py-20 text-slate-400">AI 생성 게시물이 없습니다.</div>
              ) : (
                cleanupPosts.map(post => {
                  const isExcluded = excludedIds.has(post.id);
                  return (
                    <div
                      key={post.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isExcluded
                          ? 'bg-green-50/60 border-green-200'
                          : 'bg-white border-slate-200 hover:border-rose-300'
                      }`}
                    >
                      {/* 체크박스 */}
                      <button
                        onClick={() => toggleExcludePost(post.id)}
                        className={`w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                          isExcluded
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-rose-300 bg-rose-50 text-rose-400'
                        }`}
                      >
                        {isExcluded ? '✓' : '✕'}
                      </button>

                      {/* 썸네일 */}
                      <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden shrink-0">
                        {post.imageUrl ? (
                          <img src={post.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300 text-xs">X</div>
                        )}
                      </div>

                      {/* 정보 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">{CHANNEL_LABELS[post.channelId] || post.channelId}</span>
                          {!post.imageUrl && <span className="text-[10px] font-bold px-1.5 py-0.5 bg-rose-100 text-rose-500 rounded">이미지 없음</span>}
                        </div>
                        <p className="text-xs font-bold text-slate-700 line-clamp-1 mt-0.5">{post.title}</p>
                      </div>

                      {/* 상태 뱃지 */}
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${
                        isExcluded ? 'bg-green-100 text-green-700' : 'bg-rose-100 text-rose-600'
                      }`}>
                        {isExcluded ? '보존' : '삭제'}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* 하단 액션 */}
            <div className="p-5 border-t border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <button
                onClick={() => setShowCleanupModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-sm font-bold text-slate-600 transition-colors"
              >
                취소
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={cleanupLoading || postsToDelete.length === 0}
                className="px-6 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-bold disabled:opacity-50 transition-all flex items-center gap-2"
              >
                {cleanupLoading ? '삭제 중...' : `🗑️ ${postsToDelete.length}개 삭제 확정`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function AdminPage() {
  const { profile, user } = useAuthStore();
  const [users, setUsers] = useState<(UserProfile & { id: string })[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'join_requests' | 'mail_sender' | 'banners' | 'settings' | 'activity' | 'push'>('users');
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const isAdmin = profile?.role === 'admin';
  const isManager = profile?.role === 'manager';
  const canManageOnlyJoinRequests = isManager && !isAdmin;

  // ── 가입신청 관리 상태 ──
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);

  // ── 운영설정 템플릿 저장 핸들러 (AdminMailSender에서 호출) ──
  const handleSaveTemplate = async (patch: Partial<OperationOptions>) => {
    if (!user) return;
    await setDoc(doc(db, 'appConfig', 'public'), {
      operationOptions: { ...operationOptions, ...patch },
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true });
    setOperationOptions(prev => ({ ...prev, ...patch }));
  };

  const [geoFixResult, setGeoFixResult] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [newBanner, setNewBanner] = useState({ ...DEFAULT_BANNER });
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [editingBannerImageUrl, setEditingBannerImageUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedMobileFile, setSelectedMobileFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [mobilePreviewUrl, setMobilePreviewUrl] = useState<string | null>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
  const [previewAspect, setPreviewAspect] = useState(16 / 9);
  const [bannerDevice, setBannerDevice] = useState<BannerDevice>('desktop');
  const [draggingText, setDraggingText] = useState<BannerDragTarget | null>(null);
  const [inviteCodeSetting, setInviteCodeSetting] = useState('동전커피2026');
  const [inviteHint, setInviteHint] = useState('카카오톡 공지에서 운영자가 공유한 코드');
  const [operationOptions, setOperationOptions] = useState<OperationOptions>(DEFAULT_OPERATION_OPTIONS);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState<string | null>(null);

  // 활동 모니터링 상태
  const [activitySelectedUser, setActivitySelectedUser] = useState<string>('');
  const [kakaoLogText, setKakaoLogText] = useState('');
  const [kakaoStats, setKakaoStats] = useState<any>(null);
  // 앱 활동 분석 상태
  const [appChatCounts, setAppChatCounts] = useState<Record<string, number>>({});
  const [appPostCounts, setAppPostCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (canManageOnlyJoinRequests && activeTab !== 'join_requests') {
      setActiveTab('join_requests');
    }
  }, [canManageOnlyJoinRequests]);
  const [appChatMessages, setAppChatMessages] = useState<any[]>([]);
  const [appPostsList, setAppPostsList] = useState<any[]>([]);
  const [appActivityTab, setAppActivityTab] = useState<'overview' | 'detail'>('overview');

  useEffect(() => {
    if (profile?.role !== 'admin' && profile?.role !== 'manager') return;

    // ✅ getDocs + 폴링: users/banners/joinRequests (실시간 불필요, 30초 간격)
    const loadAdminData = async () => {
      try {
        const usersSnap = await getDocs(query(collection(db, 'users')));
        const userResults = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() } as UserProfile & { id: string }));
        userResults.sort((a, b) => (ROLE_META[b.role]?.rank || 0) - (ROLE_META[a.role]?.rank || 0));
        setUsers(userResults);
      } catch (e) { console.error('Failed to load users:', e); }

      try {
        const bannersSnap = await getDocs(query(collection(db, 'banners'), orderBy('createdAt', 'desc')));
        setBanners(
          bannersSnap.docs
            .map((d) => ({ id: d.id, ...d.data() } as Banner))
            .sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
        );
      } catch (e) { console.error('Failed to load banners:', e); }

      try {
        const jrSnap = await getDocs(query(collection(db, 'joinRequests'), orderBy('createdAt', 'desc')));
        setJoinRequests(jrSnap.docs.map(d => ({ id: d.id, ...d.data() } as JoinRequest)));
      } catch (e) { console.error('Failed to load joinRequests:', e); }
    };
    loadAdminData();
    const pollInterval = window.setInterval(loadAdminData, 30000);

    // appConfig는 실시간 설정 변경 필요
    const unsubConfig = onSnapshot(doc(db, 'appConfig', 'public'), (snapshot) => {
      const data = snapshot.data();
      if (typeof data?.inviteCode === 'string' && data.inviteCode.trim()) {
        setInviteCodeSetting(data.inviteCode);
      }
      if (typeof data?.inviteHint === 'string') {
        setInviteHint(data.inviteHint);
      }
      if (data?.operationOptions && typeof data.operationOptions === 'object') {
        setOperationOptions({
          ...DEFAULT_OPERATION_OPTIONS,
          ...data.operationOptions,
          permissions: {
            ...DEFAULT_OPERATION_OPTIONS.permissions,
            ...(data.operationOptions.permissions || {}),
          },
        });
      }
    }, (error) => {
      console.error('Failed to load app config:', error);
    });

    return () => { window.clearInterval(pollInterval); unsubConfig(); };
  }, [profile]);

  // ✅ 앱 활동 분석: 수동 새로고침 (실시간 구독 제거로 Firestore 과금 대폭 감소)
  const loadActivityStats = async () => {
    if (profile?.role !== 'admin' && profile?.role !== 'manager') return;
    try {
      const chatsSnap = await getDocs(query(collection(db, 'chats'), orderBy('createdAt', 'desc'), limit(500)));
      const msgs = chatsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAppChatMessages(msgs);
      const chatCounts: Record<string, number> = {};
      msgs.forEach((m: any) => {
        if (m.authorId) chatCounts[m.authorId] = (chatCounts[m.authorId] || 0) + 1;
      });
      setAppChatCounts(chatCounts);
    } catch (e) { console.error('Failed to load chats:', e); }

    try {
      const postsSnap = await getDocs(query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(500)));
      const posts = postsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAppPostsList(posts);
      const postCounts: Record<string, number> = {};
      posts.forEach((p: any) => {
        if (p.authorId) postCounts[p.authorId] = (postCounts[p.authorId] || 0) + 1;
      });
      setAppPostCounts(postCounts);
    } catch (e) { console.error('Failed to load posts:', e); }
  };

  const handleMobileFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedMobileFile(file);
      setMobilePreviewUrl(URL.createObjectURL(file));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      const img = new Image();
      img.onload = () => {
        if (img.width && img.height) setPreviewAspect(img.width / img.height);
      };
      img.src = url;
    }
  };

  const resetBannerForm = () => {
    setNewBanner({ ...DEFAULT_BANNER });
    setEditingBannerId(null);
    setEditingBannerImageUrl('');
    setSelectedFile(null);
    setSelectedMobileFile(null);
    setPreviewUrl(null);
    setMobilePreviewUrl(null);
    setPreviewAspect(16 / 9);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (mobileFileInputRef.current) mobileFileInputRef.current.value = '';
  };

  const getBannerField = (desktopKey: string, mobileKey?: string) => {
    const draft = newBanner as any;
    if (bannerDevice === 'mobile' && mobileKey && draft[mobileKey] !== undefined && draft[mobileKey] !== '') {
      return draft[mobileKey];
    }
    return draft[desktopKey];
  };

  const setBannerField = (desktopKey: string, value: unknown, mobileKey?: string) => {
    const key = bannerDevice === 'mobile' && mobileKey ? mobileKey : desktopKey;
    setNewBanner(prev => ({ ...prev, [key]: value }));
  };

  const copyDesktopBannerToMobile = () => {
    setNewBanner(prev => ({
      ...prev,
      mobileTitle: prev.mobileTitle || prev.title,
      mobileSubtitle: prev.mobileSubtitle || prev.subtitle,
      mobileShowTitle: prev.showTitle,
      mobileShowSubtitle: prev.showSubtitle,
      mobileFocalX: prev.focalX,
      mobileFocalY: prev.focalY,
      mobileTitleSize: Math.max(16, Math.round(prev.titleSize * 0.65)),
      mobileSubtitleSize: Math.max(11, Math.round(prev.subtitleSize * 0.7)),
      mobileTitleColor: prev.titleColor,
      mobileSubtitleColor: prev.subtitleColor,
      mobileTitleX: prev.titleX,
      mobileTitleY: prev.titleY,
      mobileSubtitleX: prev.subtitleX,
      mobileSubtitleY: prev.subtitleY,
      mobileShowLogo: prev.showLogo,
      mobileLogoX: prev.logoX,
      mobileLogoY: prev.logoY,
      mobileLogoSize: Math.max(28, Math.round((prev.logoSize || 74) * 0.7)),
      mobileShowWordmark: prev.showWordmark,
      mobileWordmarkX: prev.wordmarkX,
      mobileWordmarkY: prev.wordmarkY,
      mobileWordmarkSize: Math.max(90, Math.round((prev.wordmarkSize || 260) * 0.65)),
    }));
    setBannerDevice('mobile');
  };

  const handleEditBanner = (banner: Banner, initialDevice: BannerDevice = 'desktop') => {
    setNewBanner({ ...DEFAULT_BANNER, ...banner });
    setEditingBannerId(banner.id);
    setEditingBannerImageUrl(banner.imageUrl);
    setSelectedFile(null);
    setSelectedMobileFile(null);
    setPreviewUrl(banner.imageUrl);
    setMobilePreviewUrl(banner.mobileImageUrl || null);
    setPreviewAspect(16 / 9);
    setBannerDevice(initialDevice);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const updateBannerTextPosition = (target: BannerDragTarget, clientX: number, clientY: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.min(95, Math.max(5, ((clientX - rect.left) / rect.width) * 100));
    const y = Math.min(95, Math.max(5, ((clientY - rect.top) / rect.height) * 100));
    setNewBanner(prev => {
      if (bannerDevice === 'mobile') {
        if (target === 'title') return { ...prev, mobileTitleX: x, mobileTitleY: y };
        if (target === 'subtitle') return { ...prev, mobileSubtitleX: x, mobileSubtitleY: y };
        if (target === 'logo') return { ...prev, mobileLogoX: x, mobileLogoY: y };
        return { ...prev, mobileWordmarkX: x, mobileWordmarkY: y };
      }
      if (target === 'title') return { ...prev, titleX: x, titleY: y };
      if (target === 'subtitle') return { ...prev, subtitleX: x, subtitleY: y };
      if (target === 'logo') return { ...prev, logoX: x, logoY: y };
      return { ...prev, wordmarkX: x, wordmarkY: y };
    });
  };

  const handleTextPointerDown = (target: BannerDragTarget, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingText(target);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateBannerTextPosition(target, event.clientX, event.clientY);
  };

  // 좌표 없는 게시물 일괄 지오코딩
  const handleFixMissingCoords = async () => {
    if (!window.confirm('lat/lng가 0인 위치 게시물을 카카오 지도 API로 자동 보정합니다.\n계속할까요?')) return;
    setIsLoading(true);
    setGeoFixResult(null);
    const LOCATION_CHANNELS = ['hotplace', 'restaurants', 'spots', 'accommodation'];
    let total = 0, fixed = 0, skipped = 0, failed = 0;
    const failedNames: string[] = [];
    try {
      for (const channelId of LOCATION_CHANNELS) {
        const snap = await getDocs(query(
          collection(db, 'posts'),
          where('channelId', '==', channelId)
        ));
        for (const docSnap of snap.docs) {
          const data = docSnap.data();
          if ((data.lat && data.lat !== 0) || !data.locationName?.trim()) {
            skipped++;
            continue;
          }
          total++;
          try {
            await new Promise(r => setTimeout(r, 300));
            
            // 1순위: locationName 단독 검색 (깔끔한 주소 또는 상호명)
            let resolved = await resolveKoreanPlace(data.locationName || data.title);
            
            // 2순위: 못 찾았으면 title + region 조합으로 재검색
            if (!resolved.lat || resolved.lat === 0) {
              if (data.title && data.title !== data.locationName) {
                await new Promise(r => setTimeout(r, 200));
                const fallbackKeyword = `${data.title} ${data.region || ''}`.trim();
                const fallbackResolved = await resolveKoreanPlace(fallbackKeyword);
                if (fallbackResolved.lat && fallbackResolved.lat !== 0) {
                  resolved = fallbackResolved;
                }
              }
            }
            
            if (resolved.lat && resolved.lng && resolved.lat !== 0) {
              await updateDoc(doc(db, 'posts', docSnap.id), {
                lat: resolved.lat,
                lng: resolved.lng,
                mapUrl: resolved.kakaoMapUrl || data.mapUrl || '',
                updatedAt: serverTimestamp(),
              });
              fixed++;
            } else {
              failed++;
              failedNames.push(data.title || data.locationName || '이름 없음');
            }
          } catch {
            failed++;
            failedNames.push(data.title || data.locationName || '이름 없음');
          }
          setGeoFixResult(`진행 중... 처리: ${fixed + failed}/${total} (성공 ${fixed} / 실패 ${failed})`);
        }
      }
      const failedMsg = failedNames.length > 0 ? `\n(실패한 게시물: ${failedNames.join(', ')})` : '';
      setGeoFixResult(`✅ 완료! 총 ${total}건 처리 — 성공: ${fixed}건, 좌표 못 찾음: ${failed}건, 이미 있거나 주소 없음: ${skipped}건${failedMsg}`);
    } catch (err: any) {
      setGeoFixResult(`❌ 오류 발생: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSeedBanners = async () => {
    if (!window.confirm('샘플 배너 5종을 생성하시겠습니까?')) return;
    setIsLoading(true);
    try {
      const seeds = [
        { title: '동전커피', subtitle: '좋아하는 카페에서, 맛있는 대화가 시작되는 곳', imageUrl: 'https://images.unsplash.com/photo-1445116572660-236099ec97a0?auto=format&fit=crop&q=80&w=800', titleY: 35, subtitleY: 55, titleColor: '#ffffff', subtitleColor: '#ffffff', titleSize: 52, subtitleSize: 22 },
        { title: '동전커피', subtitle: '오늘 기분은 어떤가요? 자유롭게 이야기를 나눠보세요', imageUrl: 'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?auto=format&fit=crop&q=80&w=800', titleY: 30, subtitleY: 50, titleColor: '#ffffff', subtitleColor: '#ffffff', titleSize: 48, subtitleSize: 20 },
        { title: '동전커피', subtitle: '특별한 시간, 함께하고 싶은 커플 정보를 공유합니다', imageUrl: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&q=80&w=800', titleY: 40, subtitleY: 60, titleColor: '#ffffff', subtitleColor: '#f0f0f0', titleSize: 55, subtitleSize: 24 },
        { title: '동전커피', subtitle: '인생샷을 위한 완벽한 스팟, 지금 바로 확인하세요', imageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&q=80&w=800', titleY: 25, subtitleY: 45, titleColor: '#ffffff', subtitleColor: '#ffffff', titleSize: 50, subtitleSize: 21 },
        { title: '동전커피', subtitle: '두 사람을 위한 최고의 숙소 리뷰', imageUrl: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=800', titleY: 35, subtitleY: 55, titleColor: '#ffffff', subtitleColor: '#f5f5f5', titleSize: 45, subtitleSize: 18 },
      ];
      for (const b of seeds) {
        await addDoc(collection(db, 'banners'), { ...b, titleX: 50, subtitleX: 50, createdAt: serverTimestamp() });
      }
      alert('샘플 배너 5종이 생성되었습니다! 🎉');
    } catch (err: any) {
      alert(`실패: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddBanner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile && !editingBannerImageUrl) { alert('배너 이미지를 선택해주세요.'); return; }
    if (!user) return;
    setIsUploading(true);
    setUploadProgress(0);
    try {
      let imageUrl = editingBannerImageUrl;
      let origSize = '기존';
      let compSize = '기존';
      if (selectedFile) {
        origSize = (selectedFile.size / 1024).toFixed(0);
        const blob = await compressImage(selectedFile);
        compSize = (blob.size / 1024).toFixed(0);
        setUploadProgress(40);
        imageUrl = await uploadToCloudinary(blob, 'banners');
      }
      setUploadProgress(70);
      // 모바일 이미지 업로드 (optional)
      let mobileImageUrl = newBanner.mobileImageUrl || '';
      if (selectedMobileFile) {
        const mblob = await compressImage(selectedMobileFile);
        mobileImageUrl = await uploadToCloudinary(mblob, 'banners');
      }
      setUploadProgress(90);
      const { id: _id, createdAt: _createdAt, imageUrl: _oldImageUrl, ...bannerFields } = newBanner as any;
      const payload = { ...bannerFields, imageUrl, mobileImageUrl, updatedAt: serverTimestamp() };
      const wasEditing = Boolean(editingBannerId);
      if (editingBannerId) {
        await updateDoc(doc(db, 'banners', editingBannerId), payload);
      } else {
        await addDoc(collection(db, 'banners'), { ...payload, createdAt: serverTimestamp() });
      }
      resetBannerForm();
      showToast(wasEditing ? '배너 수정 완료! 🎉' : `배너 등록 완료! 🎉 (${origSize}KB → ${compSize}KB 최적화)`, 'success');
      setUploadProgress(100);
    } catch (err: any) {
      showToast(`업로드 실패: ${err.message}`, 'error');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleDeleteBanner = async (id: string) => {
    if (!confirm('이 배너를 삭제하시겠습니까?')) return;
    try { await deleteDoc(doc(db, 'banners', id)); }
    catch { showToast('삭제 실패', 'error'); }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (profile?.role !== 'admin') return alert('초대코드 변경은 방장만 가능합니다.');
    const cleanCode = inviteCodeSetting.trim();
    if (cleanCode.length < 4 || cleanCode.length > 40) {
      alert('초대코드는 4~40자 사이로 입력해주세요.');
      return;
    }
    setIsSavingSettings(true);
    try {
      await setDoc(doc(db, 'appConfig', 'public'), {
        inviteCode: cleanCode,
        inviteHint: inviteHint.trim(),
        operationOptions,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser?.uid || user?.uid || '',
      }, { merge: true });
      setInviteCodeSetting(cleanCode);
      setSettingsSavedAt(new Date().toLocaleString('ko-KR'));
    } catch (err: any) {
      alert(`운영 설정 저장 실패: ${err.message || '알 수 없는 오류'}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  if (!profile) return <div className="p-8 text-center font-bold text-slate-400">관리자 페이지 로드 중...</div>;
  if (profile.role !== 'admin' && profile.role !== 'manager') return <Navigate to="/" replace />;

  // ── JoinQuestionEditor 인라인 컴포넌트 ──
  function JoinQuestionEditor() {
    const [questions, setLocalQuestions] = useState<{id:string;type:'choice'|'text';question:string;options?:string[];answerType?:'choice'|'text'|'freetext_only'}[]>([]);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);
    useEffect(() => {
      import('firebase/firestore').then(({ getDoc, doc: d2 }) => {
        getDoc(d2(db, 'appConfig', 'public')).then(snap => {
          const data = snap.data();
          if (data?.joinQuestions?.length) setLocalQuestions(data.joinQuestions);
          else setLocalQuestions([
            { id: 'q1', type: 'choice', answerType: 'choice', question: '동전커피 모임에 가입하려는 주된 목적이 무엇인가요?', options: ['동네 친구 만들기', '맛집/카페 탐방', '소모임 참석', '정보 공유', '직접 적기'] },
            { id: 'q2', type: 'choice', answerType: 'choice', question: '커뮤니티 가이드라인을 준수하고 매너를 지켜주실 건가요?', options: ['네, 준수하겠습니다', '아니요', '직접 적기'] },
            { id: 'q3', type: 'choice', answerType: 'choice', question: '거주하고 계신 지역은 어디인가요?', options: ['서울/수도권', '인청/경기', '대전/세종/충청', '광주/전라', '대구/경북', '부산/울산/경남', '강원/제주', '직접 적기'] },
          ]);
          setLoaded(true);
        });
      });
    }, []);
    const addQuestion = () => setLocalQuestions(prev => [...prev, { id: `q${Date.now()}`, type: 'choice', answerType: 'choice', question: '', options: ['예', '아니요', '직접 적기'] }]);
    const removeQuestion = (id: string) => setLocalQuestions(prev => prev.filter(q => q.id !== id));
    const updateQuestion = (id: string, field: string, value: any) => setLocalQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
    const addOption = (id: string) => setLocalQuestions(prev => prev.map(q => q.id === id ? { ...q, options: [...(q.options||[]), '새 옵션'] } : q));
    const updateOption = (id: string, idx: number, value: string) => setLocalQuestions(prev => prev.map(q => q.id === id ? { ...q, options: q.options?.map((o,i) => i===idx ? value : o) } : q));
    const removeOption = (id: string, idx: number) => setLocalQuestions(prev => prev.map(q => q.id === id ? { ...q, options: q.options?.filter((_,i) => i!==idx) } : q));
    const save = async () => {
      setSaving(true);
      try {
        const { setDoc, doc: d2, serverTimestamp: st } = await import('firebase/firestore');
        await setDoc(d2(db, 'appConfig', 'public'), { joinQuestions: questions, updatedAt: st(), updatedBy: auth.currentUser?.uid || user?.uid || '' }, { merge: true });
        alert('✅ 가입 질문이 저장되었습니다!');
      } catch(e:any) { alert('저장 실패: '+e.message); }
      finally { setSaving(false); }
    };
    if (!loaded) return <div className="bg-white rounded-3xl p-6 text-center text-slate-400">질문 로드 중...</div>;
    return (
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">📝 가입 질문 설정</h3>
            <p className="text-xs text-slate-400 mt-1">네이버 카페스타일 가입 질문을 자유롭게 설정하세요. 저장시 게스트 가입신청 폼에 리얼타임으로 반영됩니다.</p>
          </div>
          <button onClick={addQuestion} className="px-4 py-2 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-colors">+ 질문 추가</button>
        </div>
        <div className="space-y-4 mb-6">
          {questions.map((q, qi) => (
            <div key={q.id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50">
              <div className="flex items-start gap-3 mb-3">
                <span className="w-6 h-6 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-black shrink-0 mt-0.5">{qi+1}</span>
                <div className="flex-1 space-y-2">
                  <input value={q.question} onChange={e=>updateQuestion(q.id,'question',e.target.value)} placeholder="질문 내용" className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none focus:border-indigo-400" />
                  <div className="flex gap-2">
                    <select value={q.type} onChange={e=>updateQuestion(q.id,'type',e.target.value)} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none">
                      <option value="choice">객관식 (선택지)</option>
                      <option value="text">주관식 (직접 입력)</option>
                    </select>
                    <button onClick={()=>removeQuestion(q.id)} className="ml-auto px-3 py-1.5 bg-rose-50 text-rose-500 text-xs font-bold rounded-xl hover:bg-rose-100 transition-colors">질문 삭제</button>
                  </div>
                </div>
              </div>
              {q.type === 'choice' && (
                <div className="ml-9 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">선택지</p>
                  {q.options?.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input value={opt} onChange={e=>updateOption(q.id,oi,e.target.value)} className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-400" />
                      <button onClick={()=>removeOption(q.id,oi)} className="w-7 h-7 bg-rose-50 text-rose-400 rounded-lg text-xs font-black hover:bg-rose-100 shrink-0">✕</button>
                    </div>
                  ))}
                  <button onClick={()=>addOption(q.id)} className="text-xs font-bold text-indigo-500 hover:underline mt-1">+ 선택지 추가</button>
                </div>
              )}
            </div>
          ))}
        </div>
        <button onClick={save} disabled={saving} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-2xl text-sm disabled:opacity-50 transition-all">
          {saving ? '저장 중...' : '가입 질문 저장'}
        </button>
      </div>
    );
  }

  const fontSizes = [14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 96];
  const isMobileBanner = bannerDevice === 'mobile';
  const activePreviewUrl = isMobileBanner ? mobilePreviewUrl : previewUrl;
  const activeTitle = String(isMobileBanner ? (newBanner.mobileTitle ?? '') : newBanner.title);
  const activeSubtitle = String(isMobileBanner ? (newBanner.mobileSubtitle ?? '') : newBanner.subtitle);
  const activeShowTitle = isMobileBanner ? newBanner.mobileShowTitle !== false : newBanner.showTitle !== false;
  const activeShowSubtitle = isMobileBanner ? newBanner.mobileShowSubtitle !== false : newBanner.showSubtitle !== false;
  const activeShowLogo = isMobileBanner ? newBanner.mobileShowLogo !== false : newBanner.showLogo !== false;
  const activeShowWordmark = isMobileBanner ? newBanner.mobileShowWordmark !== false : newBanner.showWordmark !== false;
  const activeTitleSize = Number(getBannerField('titleSize', 'mobileTitleSize') || 30);
  const activeSubtitleSize = Number(getBannerField('subtitleSize', 'mobileSubtitleSize') || 15);
  const activeTitleColor = String(getBannerField('titleColor', 'mobileTitleColor') || '#ffffff');
  const activeSubtitleColor = String(getBannerField('subtitleColor', 'mobileSubtitleColor') || '#ffffff');
  const activeLogoSize = Number(getBannerField('logoSize', 'mobileLogoSize') || 52);
  const activeWordmarkSize = Number(getBannerField('wordmarkSize', 'mobileWordmarkSize') || 160);
  const activeFocalX = Number(getBannerField('focalX', 'mobileFocalX') || 50);
  const activeFocalY = Number(getBannerField('focalY', 'mobileFocalY') || 30);
  const activeTitleX = Number(getBannerField('titleX', 'mobileTitleX') || 50);
  const activeTitleY = Number(getBannerField('titleY', 'mobileTitleY') || 40);
  const activeSubtitleX = Number(getBannerField('subtitleX', 'mobileSubtitleX') || 50);
  const activeSubtitleY = Number(getBannerField('subtitleY', 'mobileSubtitleY') || 60);
  const activeLogoX = Number(getBannerField('logoX', 'mobileLogoX') || 38);
  const activeLogoY = Number(getBannerField('logoY', 'mobileLogoY') || 48);
  const activeWordmarkX = Number(getBannerField('wordmarkX', 'mobileWordmarkX') || 55);
  const activeWordmarkY = Number(getBannerField('wordmarkY', 'mobileWordmarkY') || 48);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-y-auto">
      <header className="border-b border-slate-200 bg-white flex flex-col md:flex-row items-center md:justify-between px-4 md:px-6 py-3 md:h-16 shrink-0 sticky top-0 z-50 shadow-sm gap-3">
        <div className="flex items-center gap-2 w-full md:w-auto justify-center md:justify-start">
          <span className="text-xl md:text-2xl">⚙️</span>
          <h2 className="font-bold text-lg md:text-xl text-slate-800">동전커피 관리자</h2>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-xl w-full md:w-auto justify-center md:justify-start gap-1">
          {!canManageOnlyJoinRequests && (
            <button onClick={() => setActiveTab('users')} title="회원 관리" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'users' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
              <span>👥</span>
              <span className="hidden md:inline text-[12px]">회원 관리</span>
              {/* 툴팁 */}
              <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">회원 관리</span>
            </button>
          )}
          <button onClick={() => setActiveTab('join_requests')} title="가입신청" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'join_requests' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
            <span>📝</span>
            <span className="hidden md:inline text-[12px]">가입신청</span>
            {joinRequests.filter(r => r.status === 'pending').length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 md:-top-1 md:-right-1 min-w-4 h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1">
                {joinRequests.filter(r => r.status === 'pending').length}
              </span>
            )}
            <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">가입신청</span>
          </button>
          {isAdmin && (
            <>
              <button onClick={() => setActiveTab('mail_sender')} title="우편 발송" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'mail_sender' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
                <span>✉️</span>
                <span className="hidden md:inline text-[12px]">우편 발송</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">우편 발송</span>
              </button>
              <button onClick={() => setActiveTab('banners')} title="배너" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'banners' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
                <span>🖼️</span>
                <span className="hidden md:inline text-[12px]">배너</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">배너</span>
              </button>
              <button onClick={() => setActiveTab('settings')} title="운영 설정" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'settings' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
                <span>⚙️</span>
                <span className="hidden md:inline text-[12px]">운영 설정</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">운영 설정</span>
              </button>
              <button onClick={() => setActiveTab('activity')} title="활동" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'activity' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
                <span>📈</span>
                <span className="hidden md:inline text-[12px]">활동</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">활동</span>
              </button>
              <button onClick={() => setActiveTab('push')} title="푸시 알림" className={`group relative flex-shrink-0 w-10 md:w-auto md:px-3 py-1.5 rounded-lg text-lg md:text-sm font-bold transition-all flex items-center justify-center md:gap-1.5 ${activeTab === 'push' ? 'bg-white shadow-md text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`}>
                <span>🔔</span>
                <span className="hidden md:inline text-[12px]">푸시 알림</span>
                <span className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 px-2 py-1 bg-slate-800 text-white text-[10px] rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none hidden md:block z-50">푸시 알림</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto w-full">
        {isAdmin && activeTab === 'users' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4">사용자 권한 · 차단 · 삭제</h3>
            <AdminUsers users={users} />
          </div>
        )}

        {activeTab === 'join_requests' && (
          <div className="space-y-6">
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
              <h3 className="text-lg font-bold text-slate-800 mb-4">
                📝 가입신청 관리
                {joinRequests.filter(r=>r.status==='pending').length > 0 && (
                  <span className="ml-2 text-sm font-bold text-rose-500">
                    (대기 {joinRequests.filter(r=>r.status==='pending').length}건)
                  </span>
                )}
              </h3>
              <AdminJoinRequests
                joinRequests={joinRequests}
                users={users}
                operationOptions={operationOptions}
                inviteCodeSetting={inviteCodeSetting}
              />
            </div>
            {isAdmin && <JoinQuestionEditor />}
          </div>
        )}

        {isAdmin && activeTab === 'mail_sender' && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
            <h3 className="text-lg font-bold text-slate-800 mb-4">✉️ 우편 발송 · 편지 템플릿 관리</h3>
            <AdminMailSender
              users={users}
              operationOptions={operationOptions}
              onSaveTemplate={handleSaveTemplate}
            />
          </div>
        )}

        {isAdmin && activeTab === 'settings' && (
          <div className="space-y-6">
            <form onSubmit={handleSaveSettings} className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-slate-800">초대코드 관리</h3>
                <p className="text-sm text-slate-500 mt-1">신규 가입 때만 쓰는 코드입니다. 로그인 중인 기존 회원은 코드 없이 들어올 수 있습니다.</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 block">초대코드</label>
                  <input
                    type="text"
                    value={inviteCodeSetting}
                    onChange={e => setInviteCodeSetting(e.target.value)}
                    disabled={profile.role !== 'admin'}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition-all disabled:opacity-60"
                    maxLength={40}
                  />
                </div>
                <div>
                  <label className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 block">입력 안내 문구</label>
                  <input
                    type="text"
                    value={inviteHint}
                    onChange={e => setInviteHint(e.target.value)}
                    disabled={profile.role !== 'admin'}
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition-all disabled:opacity-60"
                    maxLength={80}
                  />
                </div>
              </div>
              <div className="mt-6 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-400">
                  {settingsSavedAt ? `마지막 저장: ${settingsSavedAt}` : '운영 설정은 방장만 변경할 수 있습니다.'}
                </p>
                <button
                  type="submit"
                  disabled={isSavingSettings || profile.role !== 'admin'}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50 transition-all"
                >
                  {isSavingSettings ? '저장 중...' : '운영 설정 저장'}
                </button>
              </div>
            </form>

            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-5">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">운영 옵션</h3>
                  <p className="text-sm text-slate-500 mt-1">모임 운영 방식과 게시판 권한을 한 곳에서 관리합니다.</p>
                </div>
                <span className="text-xs font-bold text-slate-400">저장은 위의 운영 설정 저장 버튼으로 적용됩니다.</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[
                  ['approvalMode', '게스트 가입신청 승인제', '게스트로 입장한 가입신청만 운영진 승인 후 정회원으로 승격합니다.'],
                  ['pinNotices', '공지 상단 고정', '중요 공지를 홈과 게시판 상단에 우선 노출합니다.'],
                  ['reportWorkflow', '신고 처리 상태', '문의/신고 글에 접수, 처리중, 완료 상태를 운영합니다.'],
                  ['regionLeaderAreas', '지역장 담당 지역', '지역장이 맡은 권역을 운영 기준으로 사용합니다.'],
                  ['autoHideBannedWords', '금칙어/자동 숨김', '금칙어가 포함된 글을 운영진 확인 전까지 숨깁니다.'],
                  ['settlementTracking', '모임 정산 상태', '모임별 입금, 결제, 정산 완료 상태를 표시합니다.'],
                  ['activityLog', '회원 활동 로그', '권한 변경, 차단, 주요 운영 작업을 기록합니다.'],
                ].map(([key, title, desc]) => (
                  <label key={key} className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 cursor-pointer hover:border-indigo-200 transition-colors">
                    <input
                      type="checkbox"
                      checked={Boolean(operationOptions[key as keyof OperationOptions])}
                      onChange={e => setOperationOptions(prev => ({ ...prev, [key]: e.target.checked }))}
                      disabled={profile.role !== 'admin'}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600"
                    />
                    <span>
                      <span className="block text-sm font-black text-slate-800">{title}</span>
                      <span className="block text-xs text-slate-500 mt-1">{desc}</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-5 grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="text-sm font-black text-slate-800 mb-3">게시판별 쓰기 권한</h4>
                  <div className="space-y-3">
                    {[
                      ['notice', '공지사항'],
                      ['meetings', '모임'],
                      ['posts', '일반 게시판'],
                      ['inquiries', '문의/신고'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center justify-between gap-3 text-sm">
                        <span className="font-bold text-slate-600">{label}</span>
                        <select
                          value={operationOptions.permissions[key as keyof OperationOptions['permissions']]}
                          onChange={e => setOperationOptions(prev => ({
                            ...prev,
                            permissions: { ...prev.permissions, [key]: e.target.value as any },
                          }))}
                          disabled={profile.role !== 'admin'}
                          className="min-w-36 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none"
                        >
                          {key === 'notice' ? (
                            <>
                              <option value="manager">부운영자 이상</option>
                              <option value="admin">방장만</option>
                            </>
                          ) : (
                            <>
                              <option value="user">전체 회원</option>
                              <option value="regionalLeader">지역장 이상</option>
                              <option value="manager">부운영자 이상</option>
                            </>
                          )}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="text-sm font-black text-slate-800 mb-3">금칙어 목록</h4>
                  <textarea
                    value={operationOptions.bannedWords}
                    onChange={e => setOperationOptions(prev => ({ ...prev, bannedWords: e.target.value }))}
                    disabled={profile.role !== 'admin'}
                    className="w-full min-h-32 resize-none bg-white border border-slate-200 rounded-2xl px-4 py-3 text-sm outline-none focus:border-indigo-400"
                    placeholder="쉼표로 구분해서 입력하세요. 예: 욕설, 광고, 도배"
                  />
                </div>
              </div>

              <div className="mt-8 pt-6 border-t border-slate-100">
                <AiPostManager profile={profile} isLoading={isLoading} setIsLoading={setIsLoading} />
              </div>
            </div>
          </div>
        )}

        {isAdmin && activeTab === 'banners' && (
          <div className="space-y-10">
            {/* 배너 에디터 */}
            <div className="bg-white rounded-[2.5rem] shadow-2xl border border-slate-100 p-8 md:p-10">
              <div className="mb-8 flex justify-between items-end flex-wrap gap-4">
                <div>
                  <h3 className="text-2xl font-black text-slate-800">배너 에디터 스튜디오 🎨</h3>
                  <p className="text-sm text-slate-500 mt-1">이미지 선택 후 텍스트를 드래그해서 위치를 조정하세요</p>
                </div>
                {isUploading && (
                  <div className="text-right">
                    <p className="text-xs font-black text-indigo-600 mb-1">업로드 중... {Math.round(uploadProgress)}%</p>
                    <div className="w-36 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-indigo-500 transition-all rounded-full" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  </div>
                )}
              </div>

              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-2">
                <div className="flex rounded-xl bg-white p-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => setBannerDevice('desktop')}
                    className={`px-4 py-2 rounded-lg text-sm font-black transition-all ${bannerDevice === 'desktop' ? 'bg-slate-900 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    PC 배너
                  </button>
                  <button
                    type="button"
                    onClick={() => setBannerDevice('mobile')}
                    className={`px-4 py-2 rounded-lg text-sm font-black transition-all ${bannerDevice === 'mobile' ? 'bg-rose-500 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
                  >
                    모바일 배너
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {bannerDevice === 'mobile' && (
                    <button
                      type="button"
                      onClick={copyDesktopBannerToMobile}
                      className="rounded-xl border border-rose-100 bg-white px-3 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50"
                    >
                      PC 설정 복사
                    </button>
                  )}
                    <span className="text-xs font-bold text-slate-500">
                    {bannerDevice === 'desktop'
                      ? 'PC 권장 1600x480px. PC에서는 PC 이미지와 PC 위치만 사용합니다.'
                      : '모바일 권장 800x350px. 모바일에서는 모바일 이미지와 모바일 위치만 사용합니다.'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
                <div className="lg:col-span-7 space-y-5">
                  {/* 미리보기 캔버스 */}
                  <div
                    ref={containerRef}
                    className={`relative w-full bg-slate-900 rounded-3xl overflow-hidden border-4 border-dashed shadow-inner cursor-crosshair ${isMobileBanner ? 'max-w-[560px] mx-auto border-rose-200' : 'border-slate-200'}`}
                    style={{ aspectRatio: isMobileBanner ? 16 / 7 : 16 / 4.8 }}
                    onClick={() => {
                      if (isMobileBanner) {
                        if (!selectedMobileFile && !mobilePreviewUrl) mobileFileInputRef.current?.click();
                      } else if (!selectedFile && !previewUrl) {
                        fileInputRef.current?.click();
                      }
                    }}
                    onPointerMove={(e) => draggingText && updateBannerTextPosition(draggingText, e.clientX, e.clientY)}
                    onPointerUp={() => setDraggingText(null)}
                    onPointerLeave={() => setDraggingText(null)}
                  >
                    {activePreviewUrl ? (
                      <>
                        <img src={activePreviewUrl} alt="Preview" className="w-full h-full object-contain select-none pointer-events-none" style={{ objectPosition: `${activeFocalX}% ${activeFocalY}%` }} />
                        {activeShowLogo && (
                          <div
                            onPointerDown={(e) => handleTextPointerDown('logo', e)}
                            style={{
                              position: 'absolute',
                              left: `${activeLogoX}%`,
                              top: `${activeLogoY}%`,
                              transform: 'translate(-50%, -50%)',
                              width: `${activeLogoSize}px`,
                              zIndex: 18
                            }}
                            className="cursor-grab active:cursor-grabbing select-none touch-none drop-shadow-2xl"
                          >
                            <img src="/logo.png?v=20260517b" alt="로고" className="w-full h-auto pointer-events-none select-none" />
                          </div>
                        )}
                        {activeShowWordmark && (
                          <div
                            onPointerDown={(e) => handleTextPointerDown('wordmark', e)}
                            style={{
                              position: 'absolute',
                              left: `${activeWordmarkX}%`,
                              top: `${activeWordmarkY}%`,
                              transform: 'translate(-50%, -50%)',
                              width: `${activeWordmarkSize}px`,
                              zIndex: 19
                            }}
                            className="cursor-grab active:cursor-grabbing select-none touch-none drop-shadow-2xl"
                          >
                            <img src="/wordmark.png?v=20260517b" alt="동전커피 글씨" className="w-full h-auto pointer-events-none select-none" />
                          </div>
                        )}
                        {activeShowTitle && (
                          <div
                            onPointerDown={(e) => handleTextPointerDown('title', e)}
                            style={{
                              position: 'absolute',
                              left: `${activeTitleX}%`,
                              top: `${activeTitleY}%`,
                              transform: 'translate(-50%, -50%)',
                              color: activeTitleColor,
                              fontSize: `${activeTitleSize}px`,
                              zIndex: 20
                            }}
                            className="font-black whitespace-nowrap drop-shadow-2xl active:cursor-grabbing cursor-grab select-none leading-none touch-none"
                          >
                            {activeTitle || '메인 타이틀'}
                          </div>
                        )}
                        {activeShowSubtitle && (
                          <div
                            onPointerDown={(e) => handleTextPointerDown('subtitle', e)}
                            style={{
                              position: 'absolute',
                              left: `${activeSubtitleX}%`,
                              top: `${activeSubtitleY}%`,
                              transform: 'translate(-50%, -50%)',
                              color: activeSubtitleColor,
                              fontSize: `${activeSubtitleSize}px`,
                              zIndex: 10
                            }}
                            className="font-bold whitespace-nowrap drop-shadow-lg active:cursor-grabbing cursor-grab select-none opacity-90 touch-none"
                          >
                            {activeSubtitle || '서브 타이틀'}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                        <div className="w-20 h-20 bg-white rounded-3xl flex items-center justify-center text-4xl mb-5 shadow-md">🖼️</div>
                        <p className="text-lg font-black text-slate-700">{isMobileBanner ? '모바일 배너 이미지를 선택해주세요' : 'PC 배너 이미지를 선택해주세요'}</p>
                        <p className="text-xs text-slate-400 mt-1">클릭하여 {isMobileBanner ? '모바일용' : 'PC용'} 파일을 선택합니다</p>
                      </div>
                    )}
                    <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
                    <input ref={mobileFileInputRef} type="file" accept="image/*" onChange={handleMobileFileChange} className="hidden" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">{isMobileBanner ? '모바일 메인 문구' : 'PC 메인 문구'}</label>
                      <input
                        type="text"
                        value={activeTitle}
                        onChange={e => setBannerField('title', e.target.value, 'mobileTitle')}
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition-all"
                        placeholder="메인 문구 입력"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-1.5 block">{isMobileBanner ? '모바일 서브 문구' : 'PC 서브 문구'}</label>
                      <input
                        type="text"
                        value={activeSubtitle}
                        onChange={e => setBannerField('subtitle', e.target.value, 'mobileSubtitle')}
                        className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold outline-none focus:border-indigo-400 focus:bg-white transition-all"
                        placeholder="서브 문구 입력"
                      />
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5 flex flex-col gap-5">
                  <div className="bg-indigo-50/60 rounded-2xl p-5 border border-indigo-100">
                    <h4 className="text-xs font-black text-indigo-600 uppercase tracking-widest mb-4">{isMobileBanner ? '모바일 메인 타이틀' : 'PC 메인 타이틀'}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1 block">글자 크기</label>
                        <select
                          value={activeTitleSize}
                          onChange={e => setBannerField('titleSize', Number(e.target.value), 'mobileTitleSize')}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none"
                        >
                          {fontSizes.map(s => <option key={s} value={s}>{s}px</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1 block">글자 색상</label>
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                          <input
                            type="color"
                            value={activeTitleColor}
                            onChange={e => setBannerField('titleColor', e.target.value, 'mobileTitleColor')}
                            className="w-8 h-8 rounded cursor-pointer border-none p-0 bg-transparent"
                          />
                          <span className="text-[10px] font-mono text-slate-500">{activeTitleColor}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-emerald-50/60 rounded-2xl p-5 border border-emerald-100">
                    <h4 className="text-xs font-black text-emerald-600 uppercase tracking-widest mb-4">{isMobileBanner ? '모바일 서브 타이틀' : 'PC 서브 타이틀'}</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1 block">글자 크기</label>
                        <select
                          value={activeSubtitleSize}
                          onChange={e => setBannerField('subtitleSize', Number(e.target.value), 'mobileSubtitleSize')}
                          className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-bold outline-none"
                        >
                          {fontSizes.map(s => <option key={s} value={s}>{s}px</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 mb-1 block">글자 색상</label>
                        <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200">
                          <input
                            type="color"
                            value={activeSubtitleColor}
                            onChange={e => setBannerField('subtitleColor', e.target.value, 'mobileSubtitleColor')}
                            className="w-8 h-8 rounded cursor-pointer border-none p-0 bg-transparent"
                          />
                          <span className="text-[10px] font-mono text-slate-500">{activeSubtitleColor}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-50/60 rounded-2xl p-5 border border-amber-100">
                    <h4 className="text-xs font-black text-amber-700 uppercase tracking-widest mb-4">{isMobileBanner ? '모바일 브랜드 로고' : 'PC 브랜드 로고'}</h4>
                    <div className="space-y-4">
                      <label className="flex items-center justify-between gap-3 bg-white border border-amber-100 rounded-xl px-3 py-2">
                        <span className="text-xs font-bold text-slate-600">컵 로고 표시</span>
                        <input
                          type="checkbox"
                          checked={activeShowLogo}
                          onChange={e => setBannerField('showLogo', e.target.checked, 'mobileShowLogo')}
                          className="w-4 h-4"
                        />
                      </label>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-400">컵 로고 크기</label>
                          <span className="text-[10px] font-bold text-slate-500">{activeLogoSize}px</span>
                        </div>
                        <input
                          type="range"
                          min={36}
                          max={220}
                          value={activeLogoSize}
                          onChange={e => setBannerField('logoSize', Number(e.target.value), 'mobileLogoSize')}
                          className="w-full accent-amber-500"
                        />
                      </div>

                      <label className="flex items-center justify-between gap-3 bg-white border border-amber-100 rounded-xl px-3 py-2">
                        <span className="text-xs font-bold text-slate-600">글씨 로고 표시</span>
                        <input
                          type="checkbox"
                          checked={activeShowWordmark}
                          onChange={e => setBannerField('showWordmark', e.target.checked, 'mobileShowWordmark')}
                          className="w-4 h-4"
                        />
                      </label>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-400">글씨 로고 크기</label>
                          <span className="text-[10px] font-bold text-slate-500">{activeWordmarkSize}px</span>
                        </div>
                        <input
                          type="range"
                          min={120}
                          max={560}
                          value={activeWordmarkSize}
                          onChange={e => setBannerField('wordmarkSize', Number(e.target.value), 'mobileWordmarkSize')}
                          className="w-full accent-amber-500"
                        />
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">미리보기 위에서 컵 로고나 글씨 로고를 드래그하면 위치가 저장됩니다.</p>
                    </div>
                  </div>

                  {/* 포커스 옵션 & 텍스트 토글 */}
                  <div className="bg-rose-50/60 rounded-2xl p-5 border border-rose-100">
                    <h4 className="text-xs font-black text-rose-600 uppercase tracking-widest mb-4">📸 인물 포커스 & 텍스트</h4>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="flex items-center justify-between gap-2 bg-white border border-rose-100 rounded-xl px-3 py-2 cursor-pointer">
                          <span className="text-xs font-bold text-slate-600">메인문구 표시</span>
                          <input type="checkbox" checked={activeShowTitle} onChange={e => setBannerField('showTitle', e.target.checked, 'mobileShowTitle')} className="w-4 h-4" />
                        </label>
                        <label className="flex items-center justify-between gap-2 bg-white border border-rose-100 rounded-xl px-3 py-2 cursor-pointer">
                          <span className="text-xs font-bold text-slate-600">서브문구 표시</span>
                          <input type="checkbox" checked={activeShowSubtitle} onChange={e => setBannerField('showSubtitle', e.target.checked, 'mobileShowSubtitle')} className="w-4 h-4" />
                        </label>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-400">포커스 X (좌우)</label>
                          <span className="text-[10px] font-bold text-slate-500">{activeFocalX}%</span>
                        </div>
                        <input type="range" min={0} max={100} value={activeFocalX} onChange={e => setBannerField('focalX', +e.target.value, 'mobileFocalX')} className="w-full accent-rose-500" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-400">포커스 Y (얼굴 위치, 온라욜 올릴수록 위)</label>
                          <span className="text-[10px] font-bold text-slate-500">{activeFocalY}%</span>
                        </div>
                        <input type="range" min={0} max={100} value={activeFocalY} onChange={e => setBannerField('focalY', +e.target.value, 'mobileFocalY')} className="w-full accent-rose-500" />
                      </div>
                      <p className="text-[9px] text-slate-400 leading-relaxed">PC와 모바일은 서로 다른 이미지, 포커스, 문구 위치를 저장합니다. 모바일 탭에서 맞춘 위치는 모바일 화면에만 적용됩니다.</p>
                    </div>
                  </div>

                  <div className="bg-sky-50/60 rounded-2xl p-5 border border-sky-100">
                    <h4 className="text-xs font-black text-sky-600 uppercase tracking-widest mb-4">{isMobileBanner ? '📱 모바일 배너 이미지' : '🖥️ PC 배너 이미지'}</h4>
                    <p className="text-[10px] text-slate-500 mb-3">
                      {isMobileBanner
                        ? '모바일 홈에서는 이 이미지와 모바일 문구 위치만 사용합니다. 비워두면 기존 배너 호환을 위해 PC 이미지를 임시로 보여줍니다.'
                        : 'PC 홈에서는 이 이미지와 PC 문구 위치만 사용합니다.'}
                    </p>
                    <div className="flex items-center gap-3">
                      {activePreviewUrl ? (
                        <div className="relative">
                          <img src={activePreviewUrl} alt="banner preview" className="w-24 h-16 object-cover rounded-xl border border-sky-200" />
                          {isMobileBanner && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedMobileFile(null);
                                setMobilePreviewUrl(null);
                                setNewBanner(p => ({ ...p, mobileImageUrl: '' }));
                                if (mobileFileInputRef.current) mobileFileInputRef.current.value = '';
                              }}
                              className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white rounded-full text-[9px] flex items-center justify-center"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="w-24 h-16 rounded-xl border-2 border-dashed border-sky-200 flex items-center justify-center text-sky-300 text-xl">{isMobileBanner ? '📱' : '🖥️'}</div>
                      )}
                      <button
                        type="button"
                        onClick={() => (isMobileBanner ? mobileFileInputRef.current : fileInputRef.current)?.click()}
                        className="flex-1 text-xs bg-white border border-sky-200 text-sky-600 font-bold px-3 py-2 rounded-xl hover:bg-sky-50 transition-colors"
                      >
                        {activePreviewUrl ? `${isMobileBanner ? '모바일' : 'PC'} 이미지 교체` : `${isMobileBanner ? '모바일' : 'PC'} 이미지 선택`}
                      </button>
                    </div>
                  </div>

                  <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                    <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-4">운영 표시</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="flex items-center justify-between gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <span className="text-xs font-bold text-slate-600">홈에 노출</span>
                        <input
                          type="checkbox"
                          checked={newBanner.isActive !== false}
                          onChange={e => setNewBanner(p => ({ ...p, isActive: e.target.checked }))}
                          className="w-4 h-4"
                        />
                      </label>
                      <label className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <span className="text-xs font-bold text-slate-600 shrink-0">우선순위</span>
                        <input
                          type="number"
                          min={0}
                          max={99}
                          value={newBanner.priority}
                          onChange={e => setNewBanner(p => ({ ...p, priority: Number(e.target.value) || 0 }))}
                          className="w-full bg-transparent text-right text-xs font-black outline-none"
                        />
                      </label>
                      <label className="col-span-2 flex flex-col gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold text-slate-600 shrink-0">클릭 연결</span>
                          <select
                            value={newBanner.linkChannel || ''}
                            onChange={e => setNewBanner(p => ({ ...p, linkChannel: e.target.value }))}
                            className="bg-transparent text-right text-xs font-black outline-none flex-1 max-w-[70%]"
                          >
                            {BANNER_LINK_OPTIONS.map(option => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                        <input
                          type="text"
                          value={newBanner.linkChannel || ''}
                          onChange={e => setNewBanner(p => ({ ...p, linkChannel: e.target.value }))}
                          placeholder="이동할 채널ID 또는 외부 URL (예: freeboard, https://...)"
                          className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-400 focus:bg-white transition-all"
                        />
                      </label>
                      <label className="col-span-2 flex flex-col gap-2 bg-white border border-slate-100 rounded-xl px-3 py-2">
                        <div className="flex items-center justify-between w-full">
                          <span className="text-xs font-bold text-slate-600 shrink-0">노출 위치</span>
                          <select
                            value={newBanner.placement || 'hero'}
                            onChange={e => setNewBanner(p => ({ ...p, placement: e.target.value as 'hero' | 'rail' }))}
                            className="bg-transparent text-right text-xs font-black outline-none flex-1 max-w-[70%]"
                          >
                            <option value="hero">상단 메인 배너 · 권장 16:4.8</option>
                            <option value="rail">오른쪽 링크 배너 · 권장 16:6</option>
                          </select>
                        </div>
                        {newBanner.placement === 'rail' && (
                          <div className="text-[10px] text-indigo-600 font-bold mt-1 px-1">
                            💡 사이드 배너 권장 크기: 800x300 (비율 8:3)
                          </div>
                        )}
                      </label>
                    </div>
                  </div>
                  {/* ✅ 액션 버튼 플렉스 래퍼 추가 */}
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={resetBannerForm}
                      className="flex-1 py-3 rounded-2xl bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 transition-colors"
                    >
                      초기화
                    </button>
                    <button
                      type="button"
                      onClick={() => (isMobileBanner ? mobileFileInputRef.current : fileInputRef.current)?.click()}
                      className="flex-1 py-3 rounded-2xl bg-indigo-50 text-indigo-600 text-sm font-bold hover:bg-indigo-100 border border-indigo-100 transition-colors"
                    >
                      {isMobileBanner ? '모바일 이미지 교체' : 'PC 이미지 교체'}
                    </button>
                  </div>

                  <button
                    onClick={handleAddBanner}
                    disabled={isUploading || (!selectedFile && !editingBannerImageUrl)}
                    className={`w-full text-base font-black py-5 rounded-3xl transition-all flex items-center justify-center gap-3 active:scale-95 shadow-xl ${isUploading ? 'bg-slate-400 cursor-not-allowed text-white' : (selectedFile || editingBannerImageUrl) ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-200' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {isUploading ? (
                      <><svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg> 업로드 중... {Math.round(uploadProgress)}%</>
                    ) : <>{editingBannerId ? '💾 배너 수정하기' : '🚀 배너 등록하기'}</>}
                  </button>
                </div>
              </div>
            </div>

            {/* 현재 배너 목록 */}
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-slate-800">등록된 배너 ({banners.length}개)</h3>
                <button
                  onClick={handleSeedBanners}
                  disabled={isLoading}
                  className="bg-indigo-50 text-indigo-600 border border-indigo-100 px-4 py-2 rounded-xl text-sm font-bold hover:bg-indigo-100 disabled:opacity-50 transition-all"
                >
                  {isLoading ? '처리 중...' : '✨ 샘플 배너 5종 생성'}
                </button>
              </div>
              {banners.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-slate-200">
                  <p className="text-4xl mb-3">🖼️</p>
                  <p className="text-slate-400">등록된 배너가 없습니다. 위에서 배너를 만들거나 샘플을 생성해보세요.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {banners.map((banner) => (
                    <div key={banner.id} className="bg-white rounded-2xl shadow-md border border-slate-100 overflow-hidden group">
                      <div className="grid grid-cols-[1fr_112px] gap-2 bg-slate-100 p-2">
                        <button type="button" onClick={() => handleEditBanner(banner, 'desktop')} className="relative h-44 bg-slate-200 overflow-hidden rounded-xl text-left group/pc">
                          <img src={banner.imageUrl} alt="" className="w-full h-full object-cover group-hover/pc:scale-105 transition-transform duration-500" />
                          <div className="absolute inset-0 bg-black/25" />
                          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-black text-slate-700">PC</span>
                          {banner.showLogo && (
                            <img
                              src="/logo.png?v=20260517b"
                              alt=""
                              style={{ position: 'absolute', left: `${banner.logoX || 38}%`, top: `${banner.logoY || 48}%`, transform: 'translate(-50%,-50%)', width: `${(banner.logoSize || 74) * 0.35}px` }}
                              className="drop-shadow-xl"
                            />
                          )}
                          {banner.showWordmark && (
                            <img
                              src="/wordmark.png?v=20260517b"
                              alt=""
                              style={{ position: 'absolute', left: `${banner.wordmarkX || 55}%`, top: `${banner.wordmarkY || 48}%`, transform: 'translate(-50%,-50%)', width: `${(banner.wordmarkSize || 260) * 0.35}px` }}
                              className="drop-shadow-xl"
                            />
                          )}
                          {banner.showTitle !== false && <div style={{ position: 'absolute', left: `${banner.titleX}%`, top: `${banner.titleY}%`, transform: 'translate(-50%,-50%)', color: banner.titleColor, fontSize: `${banner.titleSize * 0.35}px` }} className="font-black whitespace-nowrap drop-shadow-xl">{banner.title}</div>}
                          {banner.showSubtitle !== false && <div style={{ position: 'absolute', left: `${banner.subtitleX}%`, top: `${banner.subtitleY}%`, transform: 'translate(-50%,-50%)', color: banner.subtitleColor, fontSize: `${banner.subtitleSize * 0.35}px` }} className="font-bold whitespace-nowrap drop-shadow-md opacity-90">{banner.subtitle}</div>}
                        </button>
                        <button type="button" onClick={() => handleEditBanner(banner, 'mobile')} className="relative h-44 bg-slate-200 overflow-hidden rounded-xl text-left group/mobile">
                          <img src={banner.mobileImageUrl || banner.imageUrl} alt="" className="w-full h-full object-cover group-hover/mobile:scale-105 transition-transform duration-500" style={{ objectPosition: `${banner.mobileFocalX ?? banner.focalX ?? 50}% ${banner.mobileFocalY ?? banner.focalY ?? 30}%` }} />
                          <div className="absolute inset-0 bg-black/25" />
                          <span className="absolute left-2 top-2 rounded-full bg-white/90 px-2 py-1 text-[10px] font-black text-rose-500">모바일</span>
                          {banner.mobileShowLogo !== false && (
                            <img
                              src="/logo.png?v=20260517b"
                              alt=""
                              style={{ position: 'absolute', left: `${banner.mobileLogoX ?? banner.logoX ?? 34}%`, top: `${banner.mobileLogoY ?? banner.logoY ?? 42}%`, transform: 'translate(-50%,-50%)', width: `${(banner.mobileLogoSize || 52) * 0.5}px` }}
                              className="drop-shadow-xl"
                            />
                          )}
                          {banner.mobileShowWordmark !== false && (
                            <img
                              src="/wordmark.png?v=20260517b"
                              alt=""
                              style={{ position: 'absolute', left: `${banner.mobileWordmarkX ?? banner.wordmarkX ?? 55}%`, top: `${banner.mobileWordmarkY ?? banner.wordmarkY ?? 42}%`, transform: 'translate(-50%,-50%)', width: `${(banner.mobileWordmarkSize || 160) * 0.45}px` }}
                              className="drop-shadow-xl"
                            />
                          )}
                          {banner.mobileShowTitle !== false && <div style={{ position: 'absolute', left: `${banner.mobileTitleX ?? banner.titleX ?? 50}%`, top: `${banner.mobileTitleY ?? banner.titleY ?? 38}%`, transform: 'translate(-50%,-50%)', color: banner.mobileTitleColor || banner.titleColor, fontSize: `${(banner.mobileTitleSize || 30) * 0.45}px` }} className="font-black whitespace-nowrap drop-shadow-xl">{banner.mobileTitle || banner.title}</div>}
                          {banner.mobileShowSubtitle !== false && <div style={{ position: 'absolute', left: `${banner.mobileSubtitleX ?? banner.subtitleX ?? 50}%`, top: `${banner.mobileSubtitleY ?? banner.subtitleY ?? 56}%`, transform: 'translate(-50%,-50%)', color: banner.mobileSubtitleColor || banner.subtitleColor, fontSize: `${(banner.mobileSubtitleSize || 15) * 0.45}px` }} className="font-bold whitespace-nowrap drop-shadow-md opacity-90">{banner.mobileSubtitle || banner.subtitle}</div>}
                        </button>
                      </div>
                      <div className="p-4 flex justify-between items-center bg-slate-50">
                        <span className="text-[10px] text-slate-400 font-bold">
                          {banner.createdAt?.toDate ? banner.createdAt.toDate().toLocaleDateString('ko-KR') : ''}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleEditBanner(banner)}
                            className="text-indigo-600 text-xs font-bold hover:bg-indigo-50 px-3 py-1.5 rounded-xl transition-colors"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => handleDeleteBanner(banner.id)}
                            className="text-rose-500 text-xs font-bold hover:bg-rose-50 px-3 py-1.5 rounded-xl transition-colors"
                          >
                            삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        
        {isAdmin && activeTab === 'push' && (
          <AdminPushNotificationTab />
        )}

        {isAdmin && activeTab === 'activity' && (
          <div className="space-y-6">
            {/* 실시간 활동 타임라인 */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span>🕐</span> 실시간 활동 타임라인
              </h3>
              <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
                {users
                  .filter(u => {
                    const lastMs = u.updatedAt && typeof (u.updatedAt as any).toDate === 'function' ? (u.updatedAt as any).toDate().getTime() : 0;
                    return lastMs > Date.now() - 7 * 24 * 60 * 60 * 1000;
                  })
                  .sort((a, b) => {
                    const aMs = a.updatedAt && typeof (a.updatedAt as any).toDate === 'function' ? (a.updatedAt as any).toDate().getTime() : 0;
                    const bMs = b.updatedAt && typeof (b.updatedAt as any).toDate === 'function' ? (b.updatedAt as any).toDate().getTime() : 0;
                    return bMs - aMs;
                  })
                  .slice(0, 30)
                  .map(u => {
                    const lastMs = u.updatedAt && typeof (u.updatedAt as any).toDate === 'function' ? (u.updatedAt as any).toDate().getTime() : 0;
                    const isOnline = u.status === 'online' && lastMs > Date.now() - 5 * 60 * 1000;
                    const timeAgo = lastMs ? new Date(lastMs).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '알 수 없음';
                    return (
                      <div key={u.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors">
                        <div className="relative">
                          {u.photoURL ? (
                            <img src={u.photoURL} alt="" referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: u.profileColor || '#94a3b8' }}>{u.nickname?.[0]?.toUpperCase()}</div>
                          )}
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isOnline ? 'bg-green-500' : 'bg-slate-300'}`} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-slate-700 truncate">{u.nickname}</p>
                          <p className="text-[10px] text-slate-400">{isOnline ? '현재 접속 중' : `마지막 접속: ${timeAgo}`}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOnline ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-400'}`}>
                            {isOnline ? '🟢 온라인' : '⚫ 오프라인'}
                          </span>
                          <p className="text-[10px] text-slate-400 mt-0.5">Lv.{u.level || 1}</p>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            </div>

            {/* 사용자별 활동 통계 */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span>📊</span> 사용자별 활동 통계
              </h3>
              <select
                value={activitySelectedUser}
                onChange={e => setActivitySelectedUser(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium mb-4"
              >
                <option value="">사용자를 선택하세요</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.nickname} (Lv.{u.level || 1})</option>)}
              </select>
              {activitySelectedUser && (() => {
                const selectedU = users.find(u => u.id === activitySelectedUser);
                if (!selectedU) return null;
                const level = Number(selectedU.level) || 1;
                const xp = Number(selectedU.xp) || 0;
                const joinDate = selectedU.createdAt && typeof (selectedU.createdAt as any).toDate === 'function'
                  ? (selectedU.createdAt as any).toDate().toLocaleDateString('ko-KR')
                  : '알 수 없음';
                const lastActive = selectedU.updatedAt && typeof (selectedU.updatedAt as any).toDate === 'function'
                  ? (selectedU.updatedAt as any).toDate().toLocaleString('ko-KR')
                  : '알 수 없음';
                // 활동 막대 그래프 (레벨 기반 시각화)
                const barWidth = Math.min(100, (level / 100) * 100);
                const xpBarWidth = Math.min(100, (xp / 10000) * 100);
                return (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-indigo-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-black text-indigo-600">{level}</p>
                        <p className="text-[10px] font-bold text-indigo-400">레벨</p>
                      </div>
                      <div className="bg-amber-50 rounded-xl p-3 text-center">
                        <p className="text-2xl font-black text-amber-600">{xp.toLocaleString()}</p>
                        <p className="text-[10px] font-bold text-amber-400">경험치</p>
                      </div>
                      <div className="bg-emerald-50 rounded-xl p-3 text-center">
                        <p className="text-sm font-black text-emerald-600">{joinDate}</p>
                        <p className="text-[10px] font-bold text-emerald-400">가입일</p>
                      </div>
                      <div className="bg-rose-50 rounded-xl p-3 text-center">
                        <p className="text-sm font-black text-rose-600">{lastActive}</p>
                        <p className="text-[10px] font-bold text-rose-400">마지막 활동</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                          <span>레벨 진행도</span>
                          <span>{level}/100</span>
                        </div>
                        <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all" style={{ width: `${barWidth}%` }} />
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 mb-1">
                          <span>경험치</span>
                          <span>{xp.toLocaleString()} XP</span>
                        </div>
                        <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all" style={{ width: `${xpBarWidth}%` }} />
                        </div>
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3">
                      <p className="text-xs font-bold text-slate-500 mb-1">상태</p>
                      <p className="text-sm text-slate-700">
                        {selectedU.status === 'online' ? '🟢 현재 접속 중' : '⚫ 오프라인'}
                        {selectedU.isBanned && ' · 🚫 차단됨'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">역할: {selectedU.role || 'user'}</p>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 카카오톡 대화 로그 분석기 */}
            <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <span>💬</span> 카카오톡 대화 로그 분석기
              </h3>
              <p className="text-xs text-slate-400 mb-3">카카오톡에서 내보낸 .txt 파일을 업로드하면 대화 통계를 분석합니다.</p>
              <label className="inline-flex items-center px-4 py-2.5 bg-amber-50 text-amber-700 rounded-xl text-xs font-bold cursor-pointer hover:bg-amber-100 transition-colors border border-amber-200">
                📂 카카오톡 로그 파일 업로드 (.txt)
                <input type="file" accept=".txt" className="hidden" onChange={e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    const text = reader.result as string;
                    setKakaoLogText(text);
                    // 파싱 로직
                    const lines = text.split('\n');
                    const chatPattern = /^\d{4}년 \d{1,2}월 \d{1,2}일 .+\d{1,2}:\d{2},\s*(.+?)\s*:/;
                    const altPattern = /^\[(.*?)\]\s*\[.+\d{1,2}:\d{2}\]/;
                    const hourPattern = /(?:오전|오후)\s*(\d{1,2}):\d{2}|(?:(\d{1,2}):\d{2})/;
                    const userCounts: Record<string, number> = {};
                    const hourCounts: number[] = new Array(24).fill(0);
                    const wordCounts: Record<string, number> = {};
                    const dayCounts: Record<string, number> = {};
                    const userLastActiveDate: Record<string, string> = {};
                    let totalMessages = 0;
                    let currentDate = '알 수 없음';
                    
                    lines.forEach(line => {
                      // 날짜 변경선 감지 (예: --------------- 2026년 5월 27일 수요일 ---------------)
                      const dateSeparatorMatch = line.match(/---\s*(\d{4}년 \d{1,2}월 \d{1,2}일)/);
                      if (dateSeparatorMatch) {
                        currentDate = dateSeparatorMatch[1];
                      } else {
                        // 일반 라인의 첫 날짜 표시
                        const lineDateMatch = line.match(/(\d{4}년 \d{1,2}월 \d{1,2}일)/);
                        if (lineDateMatch && line.indexOf(lineDateMatch[0]) < 10) {
                          currentDate = lineDateMatch[1];
                        }
                      }

                      let match = line.match(chatPattern) || line.match(altPattern);
                      if (match) {
                        const userName = match[1].trim();
                        if (userName && !userName.includes('님이 나갔습니다') && !userName.includes('님이 들어왔습니다')) {
                          userCounts[userName] = (userCounts[userName] || 0) + 1;
                          totalMessages++;
                          
                          // 마지막 대화 날짜 기록
                          if (currentDate !== '알 수 없음') {
                            userLastActiveDate[userName] = currentDate;
                          }

                          // 시간대 분석
                          const hMatch = line.match(hourPattern);
                          if (hMatch) {
                            let hour = parseInt(hMatch[1] || hMatch[2]);
                            if (line.includes('오후') && hour < 12) hour += 12;
                            if (line.includes('오전') && hour === 12) hour = 0;
                            hourCounts[hour]++;
                          }
                          // 날짜 분석
                          const dateMatch = line.match(/(\d{4}년 \d{1,2}월 \d{1,2}일)/);
                          if (dateMatch) {
                            dayCounts[dateMatch[1]] = (dayCounts[dateMatch[1]] || 0) + 1;
                          }
                        }
                      }
                      // 키워드 추출 (2글자 이상)
                      const msgPart = line.split(/:\s*/).slice(1).join(': ');
                      if (msgPart) {
                        const words = msgPart.match(/[가-힣a-zA-Z]{2,}/g) || [];
                        words.forEach(w => {
                          if (!['ㅋㅋ', '사진', '이모티콘', '삭제된', '메시지입니다'].some(skip => w.includes(skip))) {
                            wordCounts[w] = (wordCounts[w] || 0) + 1;
                          }
                        });
                      }
                    });
                    const topChatters = Object.entries(userCounts).sort((a, b) => b[1] - a[1]);
                    const topKeywords = Object.entries(wordCounts).sort((a, b) => b[1] - a[1]).slice(0, 20);
                    const activeDays = Object.keys(dayCounts).length;
                    const peakHour = hourCounts.indexOf(Math.max(...hourCounts));

                    // 닉네임 정규화 함수: 공백, 특수문자(/·._ 등) 모두 제거
                    const normalizeNick = (s: string) => s.trim().replace(/[\s/·._\-\[\]()（）【】「」『』]/g, '').toLowerCase();
                    // 닉네임 베이스 추출: 대괄호 앞부분만 (예: '구름[인천/96]' → '구름')
                    const baseNick = (s: string) => s.trim().replace(/[\[\(（【「『].*/g, '').trim().toLowerCase();
                    // 매칭 함수
                    const isNickMatch = (memberNick: string, chatterNick: string) => {
                      const normM = normalizeNick(memberNick);
                      const normC = normalizeNick(chatterNick);
                      const baseM = baseNick(memberNick);
                      const baseC = baseNick(chatterNick);
                      if (!normM || !normC) return false;
                      // 완전 일치, 포함 관계, 또는 베이스 닉네임이 2자 이상이고 동일
                      return normC === normM || normC.includes(normM) || normM.includes(normC) || (baseM.length >= 2 && baseM === baseC);
                    };

                    // 동전커피 회원 목록(users)과 매칭
                    const matchedChatterSet = new Set<string>();
                    const matchedMembers = users.map(u => {
                      let chatCount = 0;
                      let matchedChatterName = '';
                      let lastChatDate = '';
                      for (const [chatterName, count] of Object.entries(userCounts)) {
                        if (isNickMatch(u.nickname || '', chatterName)) {
                          chatCount += count;
                          matchedChatterName = chatterName;
                          lastChatDate = userLastActiveDate[chatterName] || '';
                          matchedChatterSet.add(chatterName);
                        }
                      }
                      return {
                        id: u.id,
                        nickname: u.nickname,
                        photoURL: u.photoURL,
                        profileColor: u.profileColor,
                        level: u.level || 1,
                        role: u.role || 'user',
                        chatCount,
                        matchedChatterName,
                        lastChatDate
                      };
                    }).sort((a, b) => b.chatCount - a.chatCount);

                    // 미매칭 외부인 목록 추출
                    const externalChatters: { name: string; count: number; lastChatDate: string }[] = [];
                    for (const [chatterName, count] of Object.entries(userCounts)) {
                      const isMatched = matchedChatterSet.has(chatterName);
                      if (!isMatched) {
                        externalChatters.push({ 
                          name: chatterName, 
                          count,
                          lastChatDate: userLastActiveDate[chatterName] || '알 수 없음'
                        });
                      }
                    }
                    externalChatters.sort((a, b) => b.count - a.count);

                    setKakaoStats({ topChatters, hourCounts, topKeywords, activeDays, totalMessages, peakHour, dayCounts, matchedMembers, externalChatters });
                  };
                  reader.readAsText(file, 'UTF-8');
                }} />
              </label>
              {kakaoStats && (
                <div className="mt-6 space-y-6">
                  {/* 요약 통계 */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-indigo-50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-indigo-600">{kakaoStats.totalMessages.toLocaleString()}</p>
                      <p className="text-[10px] font-bold text-indigo-400">총 메시지</p>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-amber-600">{kakaoStats.topChatters.length}</p>
                      <p className="text-[10px] font-bold text-amber-400">참여자 수</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-emerald-600">{kakaoStats.activeDays}</p>
                      <p className="text-[10px] font-bold text-emerald-400">활동일 수</p>
                    </div>
                    <div className="bg-rose-50 rounded-xl p-3 text-center">
                      <p className="text-2xl font-black text-rose-600">{kakaoStats.peakHour}시</p>
                      <p className="text-[10px] font-bold text-rose-400">피크 시간대</p>
                    </div>
                  </div>

                  {/* Top 채터 랭킹 */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-700 mb-3">🏆 채팅 랭킹</h4>
                    <div className="space-y-2">
                      {kakaoStats.topChatters.map(([name, count]: [string, number], i: number) => {
                        const maxCount = kakaoStats.topChatters[0]?.[1] || 1;
                        const pct = (count / maxCount) * 100;
                        return (
                          <div key={name} className="flex items-center gap-3">
                            <span className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-black ${
                              i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-slate-200 text-slate-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'
                            }`}>{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="font-bold text-slate-700 truncate">{name}</span>
                                <span className="font-bold text-slate-400 shrink-0">{count.toLocaleString()}회</span>
                              </div>
                              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 동전커피 회원 매칭 톡수 분석표 */}
                  {kakaoStats.matchedMembers && (
                    <div className="mt-4">
                      <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <span>👥</span> 동전커피 회원 톡수 분석표 ({kakaoStats.matchedMembers.filter((m: any) => m.chatCount > 0).length}명 매칭됨)
                      </h4>
                      <div className="overflow-x-auto border border-slate-100 rounded-2xl bg-slate-50/50 p-2">
                        <table className="w-full text-left border-collapse text-[11px] md:text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-400 font-bold">
                              <th className="py-2 px-3">순위</th>
                              <th className="py-2 px-3">회원</th>
                              <th className="py-2 px-3">레벨</th>
                              <th className="py-2 px-3">카톡 닉네임</th>
                              <th className="py-2 px-3">마지막 톡 날짜</th>
                              <th className="py-2 px-3 text-right">메시지 수</th>
                            </tr>
                          </thead>
                          <tbody>
                            {kakaoStats.matchedMembers.map((m: any, idx: number) => {
                              const isChatting = m.chatCount > 0;
                              return (
                                <tr key={m.id} className={`border-b border-slate-100 last:border-none hover:bg-slate-100/50 transition-colors ${!isChatting ? 'opacity-40' : ''}`}>
                                  <td className="py-2.5 px-3 font-bold text-slate-500">{idx + 1}</td>
                                  <td className="py-2.5 px-3 flex items-center gap-2">
                                    {m.photoURL ? (
                                      <img src={m.photoURL} alt="" className="w-5 h-5 rounded-full object-cover" />
                                    ) : (
                                      <div className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold" style={{ backgroundColor: m.profileColor || '#94a3b8' }}>
                                        {m.nickname?.[0]?.toUpperCase()}
                                      </div>
                                    )}
                                    <span className="font-bold text-slate-700">{m.nickname}</span>
                                  </td>
                                  <td className="py-2.5 px-3 font-medium text-slate-400">Lv.{m.level}</td>
                                  <td className="py-2.5 px-3 text-slate-500 font-medium truncate max-w-[100px]" title={m.matchedChatterName}>{m.matchedChatterName || '-'}</td>
                                  <td className="py-2.5 px-3 text-slate-500 font-bold">{m.lastChatDate || '-'}</td>
                                  <td className="py-2.5 px-3 text-right font-black text-indigo-600">
                                    {m.chatCount.toLocaleString()}회
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* 미매칭 외부 대화자 */}
                  {kakaoStats.externalChatters && kakaoStats.externalChatters.length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                        <span>❓</span> 미매칭 대화자 (동전커피 미등록/닉네임 다름)
                      </h4>
                      <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-3 bg-slate-50/50 rounded-2xl border border-slate-100 custom-scrollbar">
                        {kakaoStats.externalChatters.slice(0, 35).map((ext: any, idx: number) => (
                          <span key={idx} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-100 rounded-lg text-[11px] font-bold text-slate-600 shadow-sm" title={`마지막 대화: ${ext.lastChatDate}`}>
                            <span className="text-slate-400 font-medium">{ext.name}</span>
                            <span className="text-[9px] text-slate-400 font-medium">({ext.lastChatDate})</span>
                            <span className="font-black text-indigo-500">{ext.count.toLocaleString()}회</span>
                          </span>
                        ))}
                        {kakaoStats.externalChatters.length > 35 && (
                          <span className="px-2.5 py-1 text-[10px] font-bold text-slate-400 flex items-center">
                            외 {kakaoStats.externalChatters.length - 35}명 더 있음
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 시간대별 분포 */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-700 mb-3">⏰ 시간대별 메시지 분포</h4>
                    <div className="flex items-end gap-1 h-32 bg-slate-50 rounded-xl p-3">
                      {kakaoStats.hourCounts.map((count: number, hour: number) => {
                        const maxH = Math.max(...kakaoStats.hourCounts, 1);
                        const hPct = (count / maxH) * 100;
                        return (
                          <div key={hour} className="flex-1 flex flex-col items-center justify-end h-full" title={`${hour}시: ${count}건`}>
                            <div
                              className={`w-full rounded-t transition-all ${hour === kakaoStats.peakHour ? 'bg-rose-400' : 'bg-indigo-300'}`}
                              style={{ height: `${Math.max(2, hPct)}%` }}
                            />
                            {hour % 3 === 0 && <span className="text-[8px] text-slate-400 mt-1">{hour}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 키워드 빈도 */}
                  <div>
                    <h4 className="text-sm font-bold text-slate-700 mb-3">🔤 자주 사용된 키워드</h4>
                    <div className="flex flex-wrap gap-2">
                      {kakaoStats.topKeywords.map(([word, count]: [string, number], i: number) => (
                        <span key={word} className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          i < 3 ? 'bg-indigo-100 text-indigo-700' : i < 8 ? 'bg-slate-100 text-slate-600' : 'bg-slate-50 text-slate-400'
                        }`}>
                          {word} ({count})
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

    </div>
  );
}
