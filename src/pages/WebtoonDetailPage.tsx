import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router';
import { doc, collection, query, orderBy, onSnapshot, deleteDoc, addDoc, serverTimestamp, getDocs, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuthStore } from '../stores/authStore';
import { generateNextEpisode } from '../lib/webtoonAi';
import { getLocalAiSettings, testLocalImageConnection } from '../lib/localAi';
import { uploadToCloudinary } from '../lib/cloudinary';

const clampPercent = (value: any, fallback: number) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(92, Math.max(8, n));
};

const defaultBubblePosition = (position?: string) => {
  if (position === 'top-left') return { x: 24, y: 18 };
  if (position === 'top-right') return { x: 76, y: 18 };
  if (position === 'bottom-center') return { x: 50, y: 82 };
  if (position === 'center') return { x: 50, y: 48 };
  return { x: 50, y: 24 };
};

function WebtoonBubble({ dialogue, index, imageHasBubbles }: { dialogue: any; index: number; imageHasBubbles?: boolean }) {
  const type = dialogue?.bubbleStyle || dialogue?.type || 'normal';
  const fallback = defaultBubblePosition(dialogue?.position);
  const x = clampPercent(dialogue?.x, fallback.x);
  const y = clampPercent(dialogue?.y, fallback.y);
  const isTopHalf = y < 55;
  const tailX = x < 35 ? 'left-[18%]' : x > 65 ? 'right-[18%]' : 'left-1/2 -translate-x-1/2';
  const stackOffset = index * 8;
  const text = String(dialogue?.text || '').trim();
  if (!text) return null;

  const speaker = String(dialogue?.speaker || '').trim();
  const showSpeaker = speaker && !['unknown', '익명', '나레이션'].includes(speaker);
  const baseStyle: React.CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    transform: `translate(-50%, -50%) translateY(${stackOffset}px)`,
    fontFamily: '"Pretendard", "Noto Sans KR", system-ui, sans-serif',
  };

  if (imageHasBubbles) {
    const isNarration = type === 'narration' || speaker === '나레이션';
    return (
      <div style={baseStyle} className={`${isNarration ? 'max-w-[78%] min-w-[180px]' : 'max-w-[52%] min-w-[110px]'} absolute z-30 px-2 py-1 pointer-events-none`}>
        <p className={`${isNarration ? 'text-[11px] sm:text-sm' : 'text-[11px] sm:text-[13px]'} font-black leading-snug break-keep text-center text-slate-950`}
          style={{ textShadow: '0 1px 0 rgba(255,255,255,0.9), 1px 0 0 rgba(255,255,255,0.65), -1px 0 0 rgba(255,255,255,0.65)' }}>
          {text}
        </p>
      </div>
    );
  }

  if (type === 'narration' || speaker === '나레이션') {
    return (
      <div style={baseStyle} className="absolute z-30 max-w-[82%] min-w-[180px] bg-[#fff8dc] border-[3px] border-slate-950 px-4 py-2.5 shadow-[5px_5px_0_rgba(0,0,0,0.75)] pointer-events-none">
        <p className="text-[11px] sm:text-sm font-black leading-snug break-keep text-center text-slate-950">{text}</p>
      </div>
    );
  }

  if (type === 'shout') {
    return (
      <div style={baseStyle} className="absolute z-30 max-w-[62%] min-w-[132px] pointer-events-none">
        <div className="relative bg-slate-950 p-[3px] drop-shadow-[0_8px_12px_rgba(0,0,0,0.45)]"
          style={{ clipPath: 'polygon(6% 18%, 20% 7%, 32% 13%, 46% 3%, 58% 14%, 74% 7%, 84% 21%, 97% 28%, 87% 45%, 96% 62%, 80% 70%, 77% 91%, 58% 82%, 45% 96%, 32% 82%, 14% 90%, 15% 70%, 3% 58%, 13% 43%, 4% 30%)' }}>
          <div className="bg-[#fff6a8] px-5 py-4 text-center"
            style={{ clipPath: 'polygon(6% 18%, 20% 7%, 32% 13%, 46% 3%, 58% 14%, 74% 7%, 84% 21%, 97% 28%, 87% 45%, 96% 62%, 80% 70%, 77% 91%, 58% 82%, 45% 96%, 32% 82%, 14% 90%, 15% 70%, 3% 58%, 13% 43%, 4% 30%)' }}>
            {showSpeaker && <span className="block text-[9px] font-black text-rose-700 mb-0.5">{speaker}</span>}
            <p className="text-[12px] sm:text-[15px] font-black leading-tight text-slate-950 break-keep">{text}</p>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'thought') {
    return (
      <div style={baseStyle} className="absolute z-30 max-w-[60%] min-w-[130px] pointer-events-none">
        <div className="relative bg-white border-[3px] border-slate-950 rounded-[999px] px-5 py-3 shadow-[4px_5px_0_rgba(0,0,0,0.35)]">
          <span className={`absolute ${isTopHalf ? '-bottom-3' : '-top-3'} ${tailX} w-4 h-4 rounded-full bg-white border-[3px] border-slate-950`} />
          <span className={`absolute ${isTopHalf ? '-bottom-6' : '-top-6'} ${tailX} translate-x-5 w-2.5 h-2.5 rounded-full bg-white border-[2px] border-slate-950`} />
          {showSpeaker && <span className="block text-[9px] font-black text-indigo-600 mb-0.5 text-center">{speaker}</span>}
          <p className="text-[11px] sm:text-sm font-black italic leading-snug text-slate-950 break-keep text-center">{text}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={baseStyle} className="absolute z-30 max-w-[60%] min-w-[128px] pointer-events-none">
      <div className="relative bg-white border-[3px] border-slate-950 rounded-[55%_45%_52%_48%/48%_58%_42%_52%] px-5 py-3 shadow-[4px_5px_0_rgba(0,0,0,0.42)]">
        <span className={`absolute ${isTopHalf ? '-bottom-[9px] border-b-[3px] border-r-[3px]' : '-top-[9px] border-t-[3px] border-l-[3px]'} ${tailX} w-4 h-4 bg-white border-slate-950 rotate-45`} />
        {showSpeaker && <span className="block text-[9px] font-black text-indigo-600 mb-0.5 text-center">{speaker}</span>}
        <p className="text-[11px] sm:text-sm font-black leading-snug text-slate-950 break-keep text-center">{text}</p>
      </div>
    </div>
  );
}

function WebtoonSpeechLayer({ cut }: { cut: any }) {
  const narration = String(cut?.narration || '').trim();
  const dialogues = Array.isArray(cut?.dialogues) ? cut.dialogues : [];
  const imageHasBubbles = cut?.renderedBubbles === true || cut?.textOverlayMode === 'textOnly';
  return (
    <>
      {narration && (
        <WebtoonBubble
          dialogue={{ speaker: '나레이션', text: narration, type: 'narration', bubbleStyle: 'narration', x: 50, y: 9 }}
          index={0}
          imageHasBubbles={imageHasBubbles}
        />
      )}
      {dialogues.map((dialogue: any, index: number) => (
        <React.Fragment key={index}>
          <WebtoonBubble dialogue={dialogue} index={narration ? index + 1 : index} imageHasBubbles={imageHasBubbles} />
        </React.Fragment>
      ))}
    </>
  );
}

export function WebtoonDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { profile, user } = useAuthStore();
  const isOperator = profile?.role === 'admin' || profile?.role === 'manager';
  const isElectronApp = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

  const [project, setProject] = useState<any>(null);
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'episodes' | 'plots' | 'characters'>('episodes');
  const [selectedEpisode, setSelectedEpisode] = useState<any>(null);
  const [currentCutIndex, setCurrentCutIndex] = useState(0);
  const [comments, setComments] = useState<any[]>([]);
  const [commentInput, setCommentInput] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [viewMode, setViewMode] = useState<'slide' | 'scroll'>('slide');
  const [deletingProject, setDeletingProject] = useState(false);
  const [deletingEpisodeId, setDeletingEpisodeId] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showManualEpisodeModal, setShowManualEpisodeModal] = useState(false);
  const [manualEpNumber, setManualEpNumber] = useState(1);
  const [manualEpTitle, setManualEpTitle] = useState('');
  const [manualEpImages, setManualEpImages] = useState<{file: File; preview: string}[]>([]);
  const [manualEpUploading, setManualEpUploading] = useState(false);
  const [localSettings] = useState(() => getLocalAiSettings());
  const [imageServerStatus, setImageServerStatus] = useState<'checking' | 'connected' | 'disconnected' | 'disabled'>('disabled');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [isInterested, setIsInterested] = useState(() =>
    localStorage.getItem(`webtoon_interest_${projectId}`) === 'true'
  );
  const [interestCount] = useState(() => {
    const base = ((projectId || '').charCodeAt(0) || 0) * 12 + 130;
    return base;
  });
  // ✅ 에피소드 생성 설정 모달
  const [showEpSettings, setShowEpSettings] = useState(false);
  const [epSettings, setEpSettings] = useState({
    maturityLevel: '',
    maturityNote: '',
    targetCutCount: 24,
    minPanelsPerPage: 2,
    maxPanelsPerPage: 5,
    extraCharacters: [] as { name: string; role: string; description: string }[],
  });

  // ── 로컬 이미지 서버 상태 확인 (운영자 + 일렉트론에서만)
  useEffect(() => {
    if (!isOperator || !isElectronApp || !localSettings.imageEnabled) {
      setImageServerStatus('disabled');
      return;
    }
    setImageServerStatus('checking');
    testLocalImageConnection(localSettings)
      .then(() => setImageServerStatus('connected'))
      .catch(() => setImageServerStatus('disconnected'));
  }, [localSettings, isOperator, isElectronApp]);

  // ── 프로젝트 & 에피소드 실시간 구독
  useEffect(() => {
    if (!projectId) return;
    const projectRef = doc(db, 'posts', projectId);
    const unsubProject = onSnapshot(projectRef, snap => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, err => { console.error('프로젝트 구독 실패:', err); setLoading(false); });

    const q = query(collection(db, `posts/${projectId}/episodes`), orderBy('episodeNumber', 'desc'));
    const unsubEpisodes = onSnapshot(q, snap => {
      setEpisodes(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });

    return () => { unsubProject(); unsubEpisodes(); };
  }, [projectId]);

  // ── 에피소드 댓글 구독
  useEffect(() => {
    if (!selectedEpisode || !projectId) { setComments([]); return; }
    const q = query(collection(db, `posts/${projectId}/comments`), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, snap => {
      setComments(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter((c: any) => c.parentId === selectedEpisode.id));
    });
    return unsub;
  }, [selectedEpisode, projectId]);

  // ── 뷰어 상태 초기화
  useEffect(() => {
    setCurrentCutIndex(0);
    setFocusMode(false);
    setControlsVisible(true);
  }, [selectedEpisode]);

  // ── 집중 모드 자동 숨김
  useEffect(() => {
    if (!selectedEpisode || !focusMode || !controlsVisible) return;
    const timer = setTimeout(() => setControlsVisible(false), 1800);
    return () => clearTimeout(timer);
  }, [selectedEpisode, focusMode, controlsVisible, currentCutIndex]);

  // ── 키보드 단축키
  useEffect(() => {
    if (!selectedEpisode) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setCurrentCutIndex(p => Math.max(0, p - 1));
      else if (e.key === 'ArrowRight') setCurrentCutIndex(p => Math.min((selectedEpisode.cuts?.length || 1), p + 1));
      else if (e.key === 'Escape') setSelectedEpisode(null);
      else if (e.key.toLowerCase() === 'f') { setFocusMode(p => !p); setControlsVisible(true); }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [selectedEpisode]);

  const generating = project?.status === 'planning' || project?.status === 'generating_episode';
  const meta = project?.webtoonMeta || {};
  const hasOwnerPermission = project?.authorId === user?.uid || isOperator;
  const showViewerChrome = !focusMode || controlsVisible;

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentInput.trim() || !user || !projectId || !selectedEpisode) return;
    setSubmittingComment(true);
    try {
      await addDoc(collection(db, `posts/${projectId}/comments`), {
        postId: projectId, authorId: user.uid,
        nickname: profile?.nickname || '익명',
        content: commentInput.trim(), createdAt: serverTimestamp(),
        parentId: selectedEpisode.id,
      });
      setCommentInput('');
    } catch (err: any) { alert('댓글 등록 실패: ' + err.message); }
    finally { setSubmittingComment(false); }
  };

  const handleCommentDelete = async (commentId: string) => {
    if (!confirm('댓글을 삭제하시겠습니까?')) return;
    await deleteDoc(doc(db, `posts/${projectId}/comments`, commentId)).catch(e => alert(e.message));
  };

  const handleDeleteProject = async () => {
    if (!projectId || !confirm('정말로 프로젝트를 삭제하시겠습니까? 복구할 수 없습니다.')) return;
    setDeletingProject(true);
    try {
      for (const col of ['episodes', 'comments']) {
        const snap = await getDocs(collection(db, `posts/${projectId}/${col}`));
        for (let i = 0; i < snap.docs.length; i += 450) {
          const batch = writeBatch(db);
          snap.docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }
      await deleteDoc(doc(db, 'posts', projectId));
      navigate(-1);
    } catch (err: any) { alert('삭제 실패: ' + err.message); }
    finally { setDeletingProject(false); }
  };

  const handleDeleteEpisode = async (ep: any) => {
    if (!confirm(`제 ${ep.episodeNumber}화를 삭제하시겠습니까?`)) return;
    setDeletingEpisodeId(ep.id);
    try {
      const snap = await getDocs(collection(db, `posts/${projectId}/comments`));
      const toDelete = snap.docs.filter(d => (d.data() as any).parentId === ep.id);
      for (let i = 0; i < toDelete.length; i += 450) {
        const batch = writeBatch(db);
        toDelete.slice(i, i + 450).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      await deleteDoc(doc(db, `posts/${projectId}/episodes`, ep.id));
      if (selectedEpisode?.id === ep.id) setSelectedEpisode(null);
    } catch (err: any) { alert('에피소드 삭제 실패: ' + err.message); }
    finally { setDeletingEpisodeId(null); }
  };

  const handleGenerate = async (confirmedSettings?: any) => {
    if (!project || !user || !isOperator) return;
    if (!confirmedSettings) {
      // 설정 모달 먼저 열기
      const base = project?.webtoonMeta?.generationSettings || {};
      setEpSettings({
        maturityLevel: base.maturityLevel || 'kiss',
        maturityNote: base.maturityNote || '',
        targetCutCount: base.targetCutCount || 24,
        minPanelsPerPage: base.minPanelsPerPage || 2,
        maxPanelsPerPage: base.maxPanelsPerPage || 5,
        extraCharacters: [],
      });
      setShowEpSettings(true);
      return;
    }
    setShowEpSettings(false);
    try { await generateNextEpisode(project, episodes, user.uid, confirmedSettings); }
    catch (error: any) { if (error.message !== 'USER_CANCELLED') alert(error.message || '에피소드 생성 중 오류가 발생했습니다.'); }
  };

  const handlePublishToggle = async () => {
    if (!projectId) return;
    const next = !(project as any)?.isPublished;
    if (!confirm(next ? '웹툰을 게시하시겠습니까?' : '비공개로 전환하시겠습니까?')) return;
    await updateDoc(doc(db, 'posts', projectId), { isPublished: next, updatedAt: serverTimestamp() }).catch(e => alert(e.message));
  };

  const handleManualEpisodeSubmit = async () => {
    if (!projectId || !user || manualEpImages.length === 0) { alert('이미지를 최소 1장 업로드해주세요.'); return; }
    setManualEpUploading(true);
    try {
      const cuts: any[] = [];
      for (let i = 0; i < manualEpImages.length; i++) {
        const imageUrl = await uploadToCloudinary(manualEpImages[i].file, `webtoon/episodes/${projectId}`);
        cuts.push({ imageUrl, cutNumber: i + 1, dialogues: [], narration: '' });
      }
      await addDoc(collection(db, `posts/${projectId}/episodes`), {
        episodeNumber: manualEpNumber,
        title: manualEpTitle.trim() || `제 ${manualEpNumber}화`,
        cuts, status: 'completed', createdAt: serverTimestamp(),
      });
      setShowManualEpisodeModal(false);
      setManualEpImages([]);
      setManualEpTitle('');
      setManualEpNumber(p => p + 1);
      alert('에피소드가 등록되었습니다!');
    } catch (err: any) { alert('에피소드 등록 실패: ' + err.message); }
    finally { setManualEpUploading(false); }
  };

  const formatDate = (createdAt: any) => {
    if (!createdAt) return '';
    const d = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    return `${String(d.getFullYear()).slice(-2)}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
  };

  const sortedEpisodes = [...episodes].sort((a, b) => {
    const na = Number(a.episodeNumber) || 0, nb = Number(b.episodeNumber) || 0;
    return sortOrder === 'desc' ? nb - na : na - nb;
  });

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50">
      <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-slate-500 text-sm font-medium">프로젝트를 불러오고 있습니다...</p>
    </div>
  );

  if (!project) return (
    <div className="p-10 text-center bg-slate-50 min-h-screen flex flex-col items-center justify-center">
      <span className="text-5xl mb-4 block">😢</span>
      <p className="text-slate-600 font-medium mb-6">프로젝트를 찾을 수 없습니다.</p>
      <button onClick={() => navigate(-1)} className="px-6 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700">← 뒤로 가기</button>
    </div>
  );

  return (
    <div className="h-full overflow-y-auto bg-slate-50 pb-20">
      {/* 헤더 */}
      <header className="sticky top-0 z-50 bg-white border-b border-slate-200 px-4 h-14 flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="p-2 text-slate-600 hover:bg-slate-100 rounded-full">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="font-bold text-slate-800 line-clamp-1">{project.title}</h1>
        <div className="w-10"></div>
      </header>

      {/* 커버 */}
      <div className="bg-white p-5 border-b border-slate-200">
        <div className="flex gap-5 max-w-3xl mx-auto">
          <div className="w-28 h-40 sm:w-36 sm:h-52 bg-slate-100 rounded-lg overflow-hidden shrink-0 shadow-md border border-slate-200">
            {project.imageUrl
              ? <img src={project.imageUrl} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-4xl">📖</div>}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex gap-2 mb-2 flex-wrap">
              <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs font-bold rounded">{project.content}</span>
              {!(project as any).isPublished && <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded">미게시</span>}
            </div>
            <h2 className="text-xl font-black text-slate-900 mb-1 leading-tight">{project.title}</h2>
            <p className="text-xs text-slate-400 mb-3">{meta.artStyle || '웹툰 스타일'}</p>
            {meta.worldview && (
              <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-xl border border-slate-100 mb-4 line-clamp-3">{meta.worldview}</p>
            )}

            {/* 버튼 */}
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => { const next = !isInterested; setIsInterested(next); localStorage.setItem(`webtoon_interest_${projectId}`, String(next)); }}
                className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1 transition-all ${isInterested ? 'bg-slate-100 text-slate-400' : 'bg-[#00d564] text-white hover:bg-[#00c058]'}`}
              >
                {isInterested ? '✔' : '+'} 관심 {interestCount + (isInterested ? 1 : 0)}
              </button>
              {isOperator && (
                <>
                  <button onClick={handlePublishToggle} className={`px-4 py-2 rounded-lg text-xs font-bold ${(project as any).isPublished ? 'bg-amber-50 text-amber-600' : 'bg-emerald-50 text-emerald-600'}`}>
                    {(project as any).isPublished ? '📤 비공개' : '📢 게시하기'}
                  </button>
                  <button onClick={handleDeleteProject} disabled={deletingProject} className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-50 text-rose-500 disabled:opacity-50">
                    {deletingProject ? '삭제 중...' : '🗑️ 삭제'}
                  </button>
                </>
              )}
            </div>

            {/* 생성 버튼 (운영자 + 일렉트론) */}
            {isOperator && (
              <div className="mt-3 space-y-2">
                {generating ? (
                  <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
                      <span className="text-xs font-bold text-indigo-700">{project.progressMsg || 'AI 작업 중...'}</span>
                    </div>
                    <button
                      onClick={async () => { if (confirm('작업을 중단하시겠습니까?')) await updateDoc(doc(db, 'posts', projectId!), { cancelRequested: true }); }}
                      className="px-3 py-1.5 bg-rose-500 text-white rounded-lg text-xs font-bold shrink-0"
                    >⏹ 중단</button>
                  </div>
                ) : (
                  <>
                    {isElectronApp && (
                      <button onClick={handleGenerate} className="w-full py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-bold rounded-xl text-xs shadow-md">
                        ✨ 새 에피소드 AI 생성
                      </button>
                    )}
                    <button onClick={() => { setManualEpNumber(episodes.length + 1); setShowManualEpisodeModal(true); }}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-md">
                      📝 에피소드 수동 등록
                    </button>
                  </>
                )}

                {/* 이미지 서버 상태 */}
                {isElectronApp && !generating && (
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold">
                    <span className="text-slate-500">로컬 이미지 엔진</span>
                    {imageServerStatus === 'checking' && <span className="text-blue-600 animate-pulse">연결 확인 중...</span>}
                    {imageServerStatus === 'connected' && <span className="text-emerald-600">✅ 연동됨</span>}
                    {imageServerStatus === 'disconnected' && <span className="text-rose-500">❌ 연결 실패</span>}
                    {imageServerStatus === 'disabled' && <span className="text-slate-400">클라우드 기본</span>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 탭 (운영자만) */}
      {isOperator && (
        <div className="bg-white border-b border-slate-200 sticky top-14 z-40">
          <div className="flex max-w-3xl mx-auto">
            {(['episodes', 'plots', 'characters'] as const).map(tab => {
              const labels = { episodes: `🎬 에피소드 (${episodes.length})`, plots: '📋 플롯 기획', characters: '👥 등장인물' };
              return (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-3 text-sm font-bold border-b-2 transition-all ${activeTab === tab ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {labels[tab]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 탭 내용 */}
      <div className="max-w-3xl mx-auto p-4 mt-2">

        {/* 에피소드 목록 (운영자 탭 or 일반 사용자 항상 표시) */}
        {(activeTab === 'episodes' || !isOperator) && (
          <div>
            {episodes.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-2xl border border-slate-100 shadow-sm">
                <span className="text-5xl mb-3 block">🎨</span>
                <p className="font-bold text-slate-500">등록된 에피소드가 없습니다.</p>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-center px-3 py-2 bg-white rounded-t-xl border border-slate-200 border-b-0 shadow-sm">
                  <span className="text-xs font-bold text-slate-700">총 {episodes.length}화</span>
                  <button onClick={() => setSortOrder(p => p === 'desc' ? 'asc' : 'desc')}
                    className="text-xs font-bold text-slate-500 hover:text-slate-700">
                    {sortOrder === 'desc' ? '최신화부터 ↓' : '1화부터 ↑'}
                  </button>
                </div>
                <div className="bg-white border border-slate-200 rounded-b-xl overflow-hidden shadow-sm divide-y divide-slate-100">
                  {sortedEpisodes.map(ep => (
                    <div key={ep.id} className="flex gap-4 items-center p-3.5 hover:bg-slate-50 transition-colors group">
                      <div onClick={() => setSelectedEpisode(ep)} className="flex-1 flex gap-3 items-center cursor-pointer">
                        <div className="w-20 h-14 sm:w-24 rounded-md bg-slate-100 overflow-hidden border border-slate-200 relative shrink-0">
                          {ep.cuts?.[0]?.imageUrl
                            ? <img src={ep.cuts[0].imageUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                            : <div className="w-full h-full flex items-center justify-center text-lg">🖼️</div>}
                          <div className="absolute bottom-0 right-0 bg-black/60 text-white text-[8px] px-1 rounded-tl font-mono">{ep.cuts?.length || 0}컷</div>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] text-slate-400 font-bold mb-0.5">제 {ep.episodeNumber}화</p>
                          <h4 className="font-bold text-sm text-slate-800 line-clamp-1 group-hover:text-indigo-600">{ep.title}</h4>
                          <p className="text-[10px] text-slate-400 mt-0.5">{formatDate(ep.createdAt)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(hasOwnerPermission) && (
                          <button onClick={e => { e.stopPropagation(); handleDeleteEpisode(ep); }} disabled={deletingEpisodeId === ep.id}
                            className="p-2 text-slate-300 hover:text-rose-500 transition-colors disabled:opacity-50">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                        <button onClick={() => setSelectedEpisode(ep)}
                          className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-colors">
                          보기
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* 플롯 기획 탭 */}
        {activeTab === 'plots' && isOperator && (
          <div className="space-y-5">
            {meta.seasonsPlot && (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">📚 전체 시즌 스토리라인</h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border border-slate-100">{meta.seasonsPlot}</p>
              </div>
            )}
            {meta.selectedSeasonPlot && (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">🔥 시즌 1 상세 줄거리</h3>
                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap bg-slate-50 p-4 rounded-xl border border-slate-100">{meta.selectedSeasonPlot}</p>
              </div>
            )}
            {meta.episodesPlot?.length > 0 && (
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                <h3 className="font-bold text-slate-800 mb-4">🎬 에피소드 시놉시스</h3>
                <div className="space-y-3">
                  {meta.episodesPlot.map((ep: any, idx: number) => (
                    <div key={idx} className="flex gap-3 border-l-2 border-indigo-200 pl-4 py-1">
                      <span className="text-xs font-bold text-indigo-600 shrink-0">{ep.episodeNumber}화</span>
                      <div>
                        <p className="font-bold text-sm text-slate-800 mb-0.5">{ep.title}</p>
                        <p className="text-xs text-slate-500">{ep.synopsis}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {!meta.seasonsPlot && !meta.selectedSeasonPlot && (
              <div className="text-center py-12 text-slate-400 bg-white rounded-2xl border border-slate-100">기획 플롯이 없습니다.</div>
            )}
          </div>
        )}

        {/* 등장인물 탭 */}
        {activeTab === 'characters' && isOperator && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {meta.characters?.length > 0 ? meta.characters.map((char: any, i: number) => (
              <div key={i} className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
                <div className="w-full aspect-square bg-slate-100 rounded-xl mb-3 overflow-hidden border border-slate-100">
                  {char.imageUrl
                    ? <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-slate-300 text-sm">대기 중</div>}
                </div>
                <h4 className="font-black text-slate-800 mb-2">{char.name || `인물 ${i+1}`}</h4>
                <p className="text-xs text-slate-600 leading-relaxed">{char.description}</p>
                {char.visualPrompt && (
                  <p className="mt-2 text-[10px] text-slate-400 font-mono bg-slate-50 p-2 rounded border border-slate-200 line-clamp-3">{char.visualPrompt}</p>
                )}
              </div>
            )) : (
              <div className="col-span-full text-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-100">캐릭터 설정이 없습니다.</div>
            )}
          </div>
        )}
      </div>

      {/* 뷰어 모달 */}
      {selectedEpisode && (
        <div className="fixed inset-0 z-[100000] bg-black flex flex-col"
          onMouseMove={() => { if (focusMode) setControlsVisible(true); }}
          onTouchStart={() => { if (focusMode) setControlsVisible(true); }}>

          {/* 뷰어 헤더 */}
          <header className={`h-14 bg-gradient-to-b from-black/90 to-transparent flex items-center px-4 absolute top-0 left-0 right-0 z-50 transition-opacity ${showViewerChrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button onClick={() => setSelectedEpisode(null)} className="p-2 text-white/90 hover:text-white">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1 text-center">
              <p className="text-white font-bold text-sm line-clamp-1">{project.title}</p>
              <p className="text-white/80 text-[10px]">제 {selectedEpisode.episodeNumber}화: {selectedEpisode.title}</p>
            </div>
            <button onClick={() => setViewMode(p => p === 'slide' ? 'scroll' : 'slide')}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold mr-2">
              {viewMode === 'slide' ? '📱 스크롤' : '◀▶ 슬라이드'}
            </button>
            <button onClick={() => { setFocusMode(p => !p); setControlsVisible(true); }}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-bold">
              {focusMode ? 'UI 표시' : '집중'}
            </button>
          </header>

          {/* 뷰어 본문 */}
          <div className={`flex-1 flex flex-col items-center bg-[#0f0f11] relative select-none ${viewMode === 'scroll' ? 'overflow-y-auto pt-20 pb-10 px-4' : 'overflow-hidden justify-center'}`}>
            {viewMode === 'scroll' ? (
              <div className="w-full max-w-[500px] flex flex-col items-center">
                {selectedEpisode.cuts.map((cut: any, idx: number) => (
                  <div key={idx} className="relative w-full aspect-[2/3] overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950 mb-6 shrink-0">
                    <img src={cut.imageUrl} alt={`컷 ${idx + 1}`} className="w-full h-full object-cover pointer-events-none"
                      onError={e => { e.currentTarget.src = 'https://placehold.co/800x1200/f8f9fa/a8a29e?text=Loading'; }} />
                    <WebtoonSpeechLayer cut={cut} />
                  </div>
                ))}
                {/* 스크롤 완료 */}
                <EpisodeEndCard
                  episode={selectedEpisode} comments={comments} user={user} profile={profile} isOperator={isOperator}
                  commentInput={commentInput} setCommentInput={setCommentInput}
                  onCommentSubmit={handleCommentSubmit} onCommentDelete={handleCommentDelete}
                  submittingComment={submittingComment} onClose={() => setSelectedEpisode(null)}
                  onScrollTop={() => document.querySelector('.fixed.inset-0.overflow-y-auto')?.scrollTo({ top: 0, behavior: 'smooth' })}
                />
              </div>
            ) : currentCutIndex < (selectedEpisode.cuts?.length || 0) ? (
              <div className="w-full max-w-[500px] relative">
                {/* ✅ 슬라이드 뷰어 - translateX 버그 수정 완료 */}
                <div className="relative w-full aspect-[2/3] overflow-hidden rounded-2xl border border-slate-800 shadow-2xl bg-slate-950 cursor-pointer"
                  onClick={e => {
                    const xRatio = (e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width;
                    setCurrentCutIndex(p => xRatio < 0.3 ? Math.max(0, p - 1) : Math.min(selectedEpisode.cuts.length, p + 1));
                  }}>
                  <div
                    className="flex h-full transition-transform duration-300 ease-out"
                    style={{
                      // ✅ translateX(-N * cutWidth%) — 각 컷 너비 기준으로 이동 (이전 버그: * 100% = 전체 컨테이너 기준)
                      transform: `translateX(-${currentCutIndex * 100 / selectedEpisode.cuts.length}%)`,
                      width: `${selectedEpisode.cuts.length * 100}%`,
                    }}
                  >
                    {selectedEpisode.cuts.map((cut: any, idx: number) => (
                      <div key={idx} className="relative h-full select-none shrink-0" style={{ width: `${100 / selectedEpisode.cuts.length}%` }}>
                        <img src={cut.imageUrl} alt={`컷 ${idx + 1}`} className="w-full h-full object-cover pointer-events-none"
                          onError={e => { e.currentTarget.src = 'https://placehold.co/800x1200/f8f9fa/a8a29e?text=Loading'; }} />
                        <WebtoonSpeechLayer cut={cut} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 인디케이터 */}
                <div className={`flex gap-1.5 justify-center mt-3 transition-opacity ${showViewerChrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  {selectedEpisode.cuts.map((_: any, idx: number) => (
                    <button key={idx} onClick={() => setCurrentCutIndex(idx)}
                      className={`h-1.5 rounded-full transition-all ${idx === currentCutIndex ? 'w-5 bg-indigo-500' : 'w-1.5 bg-slate-700'}`} />
                  ))}
                  <button onClick={() => setCurrentCutIndex(selectedEpisode.cuts.length)}
                    className={`h-1.5 rounded-full transition-all ${currentCutIndex === selectedEpisode.cuts.length ? 'w-5 bg-indigo-500' : 'w-1.5 bg-slate-700'}`} />
                </div>

                {/* 이전/다음 */}
                <div className={`flex justify-between mt-4 transition-opacity ${showViewerChrome ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                  <button onClick={() => setCurrentCutIndex(p => Math.max(0, p - 1))} disabled={currentCutIndex === 0}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white disabled:opacity-20 rounded-lg text-xs font-bold">← 이전</button>
                  <span className="text-xs text-slate-400 font-mono self-center">{currentCutIndex + 1} / {selectedEpisode.cuts.length + 1}</span>
                  <button onClick={() => setCurrentCutIndex(p => Math.min(selectedEpisode.cuts.length, p + 1))}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold">
                    {currentCutIndex >= selectedEpisode.cuts.length - 1 ? '완료 →' : '다음 →'}
                  </button>
                </div>
              </div>
            ) : (
              <EpisodeEndCard
                episode={selectedEpisode} comments={comments} user={user} profile={profile} isOperator={isOperator}
                commentInput={commentInput} setCommentInput={setCommentInput}
                onCommentSubmit={handleCommentSubmit} onCommentDelete={handleCommentDelete}
                submittingComment={submittingComment} onClose={() => setSelectedEpisode(null)}
                onScrollTop={() => setCurrentCutIndex(0)}
                scrollTopLabel="🔄 다시 보기"
              />
            )}
          </div>
        </div>
      )}

      {/* 수동 에피소드 등록 모달 */}
      {showManualEpisodeModal && (
        <div className="fixed inset-0 bg-slate-900/50 z-[99999] flex justify-center items-center">
          <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl flex flex-col max-h-[80vh] overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b shrink-0">
              <h2 className="text-lg font-bold">📝 에피소드 수동 등록</h2>
              <button onClick={() => setShowManualEpisodeModal(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-bold text-slate-600">회차 번호
                  <input type="number" min={1} value={manualEpNumber} onChange={e => setManualEpNumber(Number(e.target.value))}
                    className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </label>
                <label className="text-xs font-bold text-slate-600">에피소드 제목
                  <input type="text" value={manualEpTitle} onChange={e => setManualEpTitle(e.target.value)} placeholder={`제 ${manualEpNumber}화`}
                    className="mt-1 w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </label>
              </div>
              <div>
                <p className="text-xs font-bold text-slate-600 mb-2">컷 이미지 ({manualEpImages.length}장)</p>
                <label className="inline-flex items-center px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold cursor-pointer hover:bg-indigo-100">
                  📷 이미지 선택
                  <input type="file" accept="image/*" multiple className="hidden" onChange={e => {
                    const files = Array.from(e.target.files || []);
                    setManualEpImages(p => [...p, ...files.map(f => ({ file: f, preview: URL.createObjectURL(f as Blob) }))]);
                  }} />
                </label>
                {manualEpImages.length > 0 && (
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {manualEpImages.map((img, idx) => (
                      <div key={idx} className="relative aspect-[2/3] rounded-lg overflow-hidden border border-slate-200">
                        <img src={img.preview} alt="" className="w-full h-full object-cover" />
                        <button onClick={() => setManualEpImages(p => p.filter((_, i) => i !== idx))}
                          className="absolute top-1 right-1 w-5 h-5 bg-rose-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center">✕</button>
                        <span className="absolute bottom-0 left-0 bg-black/60 text-white text-[9px] px-1 font-mono">{idx + 1}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="p-4 border-t shrink-0">
              <button onClick={handleManualEpisodeSubmit} disabled={manualEpUploading || manualEpImages.length === 0}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl disabled:opacity-50">
                {manualEpUploading ? '업로드 중...' : `제 ${manualEpNumber}화 등록 (${manualEpImages.length}컷)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 에피소드 완료 카드 ──
function EpisodeEndCard({ episode, comments, user, profile, isOperator, commentInput, setCommentInput, onCommentSubmit, onCommentDelete, submittingComment, onClose, onScrollTop, scrollTopLabel = '🔝 맨 위로' }: any) {
  return (
    <div className="w-full max-w-[500px] bg-[#09090b] border border-slate-800 p-6 rounded-2xl flex flex-col items-center py-10 my-6">
      <span className="text-5xl mb-4 animate-bounce">🎉</span>
      <h3 className="text-lg font-black text-white mb-1">제 {episode.episodeNumber}화 감상 완료!</h3>
      <p className="text-slate-400 text-xs mb-6">&quot;{episode.title}&quot;을 모두 읽었습니다.</p>
      <div className="flex gap-3 w-full max-w-[320px] mb-8">
        <button onClick={onScrollTop} className="flex-1 py-3.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-bold text-xs">{scrollTopLabel}</button>
        <button onClick={onClose} className="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl font-bold text-xs">🎬 목록으로</button>
      </div>
      <div className="w-full border-t border-slate-800 pt-6">
        <h4 className="text-sm font-bold text-slate-200 mb-4">💬 한줄평 ({comments.length})</h4>
        <div className="space-y-3 max-h-[200px] overflow-y-auto mb-4">
          {comments.length === 0
            ? <p className="text-xs text-slate-500 text-center py-4">첫 번째 한줄평을 남겨보세요!</p>
            : comments.map((c: any) => (
              <div key={c.id} className="bg-slate-900/60 border border-slate-800 rounded-xl p-3">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[10px] font-bold text-indigo-400">{c.nickname}</span>
                  {(c.authorId === user?.uid || isOperator) && (
                    <button onClick={() => onCommentDelete(c.id)} className="text-[9px] text-rose-500 font-bold">삭제</button>
                  )}
                </div>
                <p className="text-xs text-slate-300">{c.content}</p>
              </div>
            ))
          }
        </div>
        <form onSubmit={onCommentSubmit} className="flex gap-2">
          <input type="text" value={commentInput} onChange={e => setCommentInput(e.target.value)}
            placeholder="따뜻한 한줄평을 남겨주세요..." maxLength={150}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
          <button type="submit" disabled={submittingComment || !commentInput.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold disabled:opacity-50">
            등록
          </button>
        </form>
      </div>
    </div>
  );
}
