import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';
import { generateWebtoonProjectAssets } from '../../lib/webtoonAi';
import { retryGemini } from '../../lib/gemini';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { getWebtoonLocalAiSettings, testLocalImageConnection } from '../../lib/localAi';

const DEFAULT_GENRES = ['현대물', '추리물', '드라마', '액션', '판타지', '학원물', '오피스물', '로맨틱 코미디', '피카레스크', '인스타툰', '유머'];
const DEFAULT_ART_STYLE = '트렌디 웹툰 스타일 (Cel-shading)';
const CHARACTER_ROLES = ['주인공', '상대역', '히로인', '조연', '라이벌', '빌런', '멘토', '가족', '친구', '기타'];

interface Character {
  name: string;
  role: string;
  description: string;
  imageUrl?: string;
}

interface GenerationSettings {
  episodeCount: number;
  targetCutCount: number;
  minPanelsPerPage: number;
  maxPanelsPerPage: number;
  allowSinglePanelKeyScenes: boolean;
  approvalMode: boolean;
  publishMode: 'review' | 'auto';
  maturityLevel: 'all' | 'kiss' | 'mood' | 'mature';
  maturityNote: string;
}

async function compressImage(file: File, maxWidth = 900, quality = 0.72): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = e => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / Math.max(img.width, img.height));
        const width = Math.round(img.width * ratio);
        const height = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 압축 실패')), 'image/webp', quality);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

export function WebtoonProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { profile } = useAuthStore();
  const isOperator = profile?.role === 'admin' || profile?.role === 'manager';
  const isElectronApp = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
  
  const [loading, setLoading] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [creationMode, setCreationMode] = useState<'ai' | 'manual'>('manual');
  
  const [title, setTitle] = useState('');
  const [concept, setConcept] = useState('브로맨스 / BL');
  const [customConcept, setCustomConcept] = useState('');
  const [genres, setGenres] = useState<string[]>(['현대물']);
  const [worldview, setWorldview] = useState('');
  const [artStyle, setArtStyle] = useState(DEFAULT_ART_STYLE);
  const [customArtStyle, setCustomArtStyle] = useState('');
  const [uploadingCharacterIndex, setUploadingCharacterIndex] = useState<number | null>(null);
  const [uploadingAsset, setUploadingAsset] = useState<'cover' | 'thumbnail' | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState('');
  const [generationSettings, setGenerationSettings] = useState<GenerationSettings>({
    episodeCount: 10,
    targetCutCount: 24,
    minPanelsPerPage: 2,
    maxPanelsPerPage: 5,
    allowSinglePanelKeyScenes: true,
    approvalMode: true,
    publishMode: 'review',
    maturityLevel: 'kiss',
    maturityNote: '',
  });
  const [characters, setCharacters] = useState<Character[]>([
    { name: '', role: '주인공', description: '' },
    { name: '', role: '상대역', description: '' }
  ]);

  const [localSettings] = useState(() => getWebtoonLocalAiSettings());
  const [imageServerStatus, setImageServerStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');

  useEffect(() => {
    if (!isOperator || !isElectronApp) {
      setImageServerStatus('disconnected');
      return;
    }
    setImageServerStatus('checking');
    testLocalImageConnection(localSettings)
      .then(() => setImageServerStatus('connected'))
      .catch(() => setImageServerStatus('disconnected'));
  }, [localSettings, isOperator, isElectronApp]);

  const effectiveConcept = concept === 'custom' ? customConcept.trim() : concept;

  const toggleGenre = (g: string) => {
    if (genres.includes(g)) {
      if (genres.length > 1) setGenres(genres.filter(x => x !== g));
    } else {
      setGenres([...genres, g]);
    }
  };

  const handleAddCharacter = () => {
    setCharacters([...characters, { name: '', role: '조연', description: '' }]);
  };

  const handleRemoveCharacter = (index: number) => {
    if (characters.length <= 1) return;
    setCharacters(characters.filter((_, i) => i !== index));
  };

  const handleCharacterChange = (index: number, field: 'name' | 'role' | 'description' | 'imageUrl', value: string) => {
    const newChars = [...characters];
    newChars[index][field] = value;
    setCharacters(newChars);
  };

  const handleCharacterImageUpload = async (index: number, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 첨부할 수 있습니다.');
      return;
    }
    setUploadingCharacterIndex(index);
    try {
      const blob = file.size > 250 * 1024 ? await compressImage(file) : await compressImage(file, 900, 0.8);
      const imageUrl = await uploadToCloudinary(blob, 'webtoon/characters');
      handleCharacterChange(index, 'imageUrl', imageUrl);
    } catch (error) {
      console.error(error);
      alert('캐릭터 이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingCharacterIndex(null);
    }
  };

  const handleAssetUpload = async (kind: 'cover' | 'thumbnail', file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 첨부할 수 있습니다.');
      return;
    }
    setUploadingAsset(kind);
    try {
      const blob = await compressImage(file, kind === 'cover' ? 1400 : 900, 0.78);
      const imageUrl = await uploadToCloudinary(blob, `webtoon/${kind}`);
      if (kind === 'cover') setCoverImageUrl(imageUrl);
      else setThumbnailImageUrl(imageUrl);
    } catch (error) {
      console.error(error);
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setUploadingAsset(null);
    }
  };

  const updateGenerationSetting = <K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) => {
    setGenerationSettings(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'minPanelsPerPage' && Number(value) > next.maxPanelsPerPage) next.maxPanelsPerPage = Number(value);
      if (key === 'maxPanelsPerPage' && Number(value) < next.minPanelsPerPage) next.minPanelsPerPage = Number(value);
      if (key === 'approvalMode') next.publishMode = value ? 'review' : 'auto';
      return next;
    });
  };

  const effectiveArtStyle = artStyle === 'custom'
    ? customArtStyle.trim()
    : artStyle;

  const handleAutoGenerate = async () => {
    // 즉시 생성 프로세스로 진입 (백서버에서 AI 자동 기획)
    const fakeEvent = { preventDefault: () => {} } as React.FormEvent;
    await handleSubmit(fakeEvent);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !profile) return;
    
    const isOperator = profile.role === 'admin' || profile.role === 'manager';
    if (!isOperator) {
      alert('⚠️ 웹툰 프로젝트 생성은 운영자(관리자) 계정만 가능합니다.');
      return;
    }

    if (creationMode === 'ai' && imageServerStatus !== 'connected') {
      alert('AI 자동 생성 모드는 로컬 ComfyUI 연결이 필수입니다. ComfyUI 연결 확인 후 다시 시도하세요.');
      return;
    }

    // 문서 ID를 로컬에서 즉시 발급하여 렉과 갇힘을 완전히 차단
    const postsCol = collection(db, 'posts');
    const newPostRef = doc(postsCol);
    const newPostId = newPostRef.id;

    const initialTitle = title.trim() || "AI 기획 웹툰 프로젝트";
    const initialWorldview = worldview.trim() || "AI 기획 세계관 설정 대기 중";
    const cleanCharacters = characters.map((c, i) => ({
      ...c,
      name: c.name.trim() || `캐릭터 ${i + 1}`,
      description: c.description.trim() || "상세 설정 대기 중",
    }));

    // 즉시 모달을 닫고 리다이렉트
    navigate('/webtoon/' + newPostId);
    onClose();

    // 실제 Firestore 저장 및 백서버 API 호출은 백그라운드 비동기로 위임
    (async () => {
      try {
        await setDoc(newPostRef, {
          channelId: 'webtoon',
          authorId: auth.currentUser.uid,
          title: initialTitle,
          content: `${effectiveConcept} / ${genres.join(', ')}`,
          status: creationMode === 'manual' ? 'completed' : 'planning',
          progressMsg: creationMode === 'manual' ? '수동 생성 완료' : ((title.trim() && worldview.trim()) ? '1단계: 전체 시즌 스토리라인 기획 중...' : '0단계: AI 기획안 자동 설계 중...'),
          isPublished: false,
          webtoonMeta: {
            concept: effectiveConcept,
            genres,
            artStyle: effectiveArtStyle,
            worldview: initialWorldview,
            characters: cleanCharacters,
            coverImageUrl,
            thumbnailImageUrl,
            generationSettings,
          },
          imageUrl: coverImageUrl || thumbnailImageUrl || '',
          likesCount: 0,
          commentsCount: 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (creationMode === 'ai') {
          await generateWebtoonProjectAssets(
            newPostId,
            {
              title: title.trim(),
              concept: effectiveConcept,
              genres,
              worldview: worldview.trim(),
              characters: characters.map(c => ({
                ...c,
                name: c.name.trim(),
                description: c.description.trim()
              })),
              artStyle: effectiveArtStyle,
              coverImageUrl,
              thumbnailImageUrl,
              generationSettings,
            },
            auth.currentUser.uid
          );
        }
      } catch (error) {
        console.error('Background project generation setup failed:', error);
      }
    })();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[99999] flex justify-center items-end sm:items-center">
      <div className="bg-white w-full sm:w-[600px] sm:rounded-2xl rounded-t-2xl shadow-xl flex flex-col h-[85vh] sm:h-[85vh] overflow-hidden animate-slide-up sm:animate-fade-in">
        <div className="flex justify-between items-center p-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-800">새 웹툰 프로젝트 시작</h2>
          <div className="flex items-center gap-2">
            {isOperator && isElectronApp && (
              <div className="flex bg-slate-100 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => setCreationMode('manual')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${creationMode === 'manual' ? 'bg-white shadow-sm text-emerald-600' : 'text-slate-400'}`}
                >
                  📝 수동 생성
                </button>
                <button
                  type="button"
                  onClick={() => setCreationMode('ai')}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-all ${creationMode === 'ai' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}
                >
                  ✨ AI 생성
                </button>
              </div>
            )}
            {isOperator && isElectronApp && creationMode === 'ai' && (
              <button 
                type="button" 
                onClick={handleAutoGenerate} 
                className="px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-xs font-bold rounded-lg hover:opacity-90 flex items-center gap-1"
              >
                ✨ AI 기획으로 즉시 시작
              </button>
            )}
            <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-50 rounded-full">✕</button>
          </div>
        </div>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar">
          
          {/* 로컬 AI 연동 상태 표시 */}
          {creationMode === 'ai' && (
          <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-sm">
            <span className="text-xs font-extrabold text-slate-600">로컬 AI 엔진 상태</span>
            {imageServerStatus === 'checking' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-600 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                연결 확인 중...
              </span>
            )}
            {imageServerStatus === 'connected' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-600">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                로컬 연동됨 ({localSettings.imageProvider === 'comfyui' ? 'ComfyUI' : 'Forge'})
              </span>
            )}
            {imageServerStatus === 'disconnected' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-600" title="브로맨툰 이미지는 로컬 ComfyUI 연결이 필수입니다. 앱 서버가 ComfyUI 자동 시작을 시도합니다.">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                로컬 연결 필요
              </span>
            )}
          </div>
          )}

          {creationMode === 'manual' && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl shadow-sm">
              <p className="text-xs font-bold text-emerald-700">📝 수동 생성 모드</p>
              <p className="text-[11px] text-emerald-600 mt-1">ComfyUI 연결 없이 직접 프로젝트를 생성합니다. 표지/썸네일을 직접 업로드하고, 에피소드도 수동으로 등록할 수 있습니다.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">작품 메인 컨셉 / 테마</label>
            <select 
              value={concept} 
              onChange={e => setConcept(e.target.value)} 
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 font-medium text-slate-800"
            >
              <option value="브로맨스 / BL">브로맨스 / BL</option>
              <option value="로맨틱 코미디 / 순정">로맨틱 코미디 / 순정</option>
              <option value="로맨스 판타지 (회빙환/영애물)">로맨스 판타지 (회빙환/영애물)</option>
              <option value="학원 액션 / 성장물">학원 액션 / 성장물</option>
              <option value="현대 판타지 / 레이드 / 이능력">현대 판타지 / 레이드 / 이능력</option>
              <option value="무협 / 동양 판타지">무협 / 동양 판타지</option>
              <option value="스릴러 / 미스터리 / 느와르">스릴러 / 미스터리 / 느와르</option>
              <option value="일상 / 드라마 / 코미디">일상 / 드라마 / 코미디</option>
              <option value="custom">직접 적기 (자유 장르)</option>
            </select>
            {concept === 'custom' && (
              <input
                type="text"
                value={customConcept}
                onChange={e => setCustomConcept(e.target.value)}
                className="mt-2 w-full bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder="원하는 기획 장르나 컨셉을 적어주세요 (예: 좀비 아포칼립스 생존물)"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">세부 장르 (복수 선택 가능)</label>
            <div className="flex flex-wrap gap-2">
              {DEFAULT_GENRES.map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGenre(g)}
                  className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${genres.includes(g) ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">작화 스타일 (캐릭터체)</label>
            <select value={artStyle} onChange={e => setArtStyle(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
              <option value={DEFAULT_ART_STYLE}>트렌디 웹툰 스타일 (기본)</option>
              <option value="실사풍 (Photorealistic anime)">실사풍 (고퀄리티)</option>
              <option value="수채화풍 (Watercolor style)">수채화풍 (부드러운)</option>
              <option value="다크/느와르풍 (Dark Noir, heavy shadows)">다크/느와르풍 (무거운 분위기)</option>
              <option value="레트로 90년대 애니풍 (90s retro anime)">레트로 90년대 애니풍</option>
              <option value="지브리 스튜디오 애니메이션 (Studio Ghibli style)">지브리 그림체</option>
              <option value="마파 스튜디오 하이퀄리티 애니 (MAPPA studio anime style, cinematic)">마파(MAPPA) 애니 그림체</option>
              <option value="회귀물/이세계 하이판타지 웹툰 (Isekai manhwa style, regression fantasy)">회귀물/이세계 판타지풍</option>
              <option value="수채화풍 감성 판타지 애니 (Grimgar of Fantasy and Ash style, soft watercolor anime)">재와 환상의 그림갈풍</option>
              <option value="순정만화/로맨스 웹툰 (Shoujo manga style, sparkly, beautiful eyes)">순정만화 그림체</option>
              <option value="짱구는 못말려 (Crayon Shin-chan style, simple gag comic)">짱구 그림체</option>
              <option value="개그만화/웹툰 조석 (The Sound of Your Heart style, funny comic)">조석(개그) 그림체</option>
              <option value="병맛 개그만화 (Bbang bbang style, funny weird comic)">빵빵이(병맛) 그림체</option>
              <option value="custom">직접 적기</option>
            </select>
            {artStyle === 'custom' && (
              <textarea
                value={customArtStyle}
                onChange={e => setCustomArtStyle(e.target.value)}
                className="mt-2 w-full h-20 bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none"
                placeholder="원하는 작화 프롬프트를 직접 적어주세요. 예: clean high-end Korean manhwa, dynamic paneling, soft cinematic lighting..."
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">작품 제목</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" placeholder="예: 데드라인의 이면 (비워두면 AI가 기획)" />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1">세계관 및 스토리라인</label>
            <textarea value={worldview} onChange={e => setWorldview(e.target.value)} className="w-full h-24 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none" placeholder="세계관, 메인 스토리라인을 자세히 적어주세요. (비워두면 AI가 기획)" />
          </div>

          <div className="space-y-3 border border-slate-200 rounded-2xl p-4 bg-white">
            <div>
              <h3 className="text-sm font-black text-slate-800">표지/썸네일</h3>
              <p className="text-[11px] text-slate-400 mt-0.5">직접 올릴 수 있고, 비워두면 자동 생성된 캐릭터/표지를 사용합니다.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ['cover', '메인 표지', coverImageUrl],
                ['thumbnail', '목록 썸네일', thumbnailImageUrl],
              ] as const).map(([kind, label, imageUrl]) => (
                <div key={kind} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="aspect-[4/3] rounded-lg bg-white border border-slate-100 overflow-hidden flex items-center justify-center">
                    {imageUrl ? (
                      <img src={imageUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-xs font-bold text-slate-300">{label}</span>
                    )}
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <label className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:border-indigo-300 cursor-pointer">
                      {uploadingAsset === kind ? '업로드 중...' : imageUrl ? `${label} 교체` : `${label} 첨부`}
                      <input type="file" accept="image/*" className="hidden" disabled={uploadingAsset !== null} onChange={e => handleAssetUpload(kind, e.target.files?.[0])} />
                    </label>
                    {imageUrl && (
                      <button
                        type="button"
                        onClick={() => kind === 'cover' ? setCoverImageUrl('') : setThumbnailImageUrl('')}
                        className="px-2 py-2 rounded-lg text-xs font-bold text-rose-500 hover:bg-rose-50"
                      >
                        제거
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {creationMode === 'ai' && (
          <div className="space-y-3 border border-indigo-100 rounded-2xl p-4 bg-indigo-50/40">
            <div>
              <h3 className="text-sm font-black text-slate-800">생성 제어</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">컷수, 패널 수, 승인 방식은 프로젝트 생성 후 운영자가 다시 수정할 수 있습니다.</p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <label className="text-[11px] font-bold text-slate-500">
                총 회차
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={generationSettings.episodeCount}
                  onChange={e => updateGenerationSetting('episodeCount', Math.max(1, Number(e.target.value)) as GenerationSettings['episodeCount'])}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="text-[11px] font-bold text-slate-500">
                회차 총 컷수
                <input
                  type="number"
                  min={20}
                  max={120}
                  value={generationSettings.targetCutCount}
                  onChange={e => updateGenerationSetting('targetCutCount', Math.max(20, Number(e.target.value)) as GenerationSettings['targetCutCount'])}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="text-[11px] font-bold text-slate-500">
                최소 패널
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={generationSettings.minPanelsPerPage}
                  onChange={e => updateGenerationSetting('minPanelsPerPage', Math.min(5, Math.max(1, Number(e.target.value))) as GenerationSettings['minPanelsPerPage'])}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                />
              </label>
              <label className="text-[11px] font-bold text-slate-500">
                최대 패널
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={generationSettings.maxPanelsPerPage}
                  onChange={e => updateGenerationSetting('maxPanelsPerPage', Math.min(5, Math.max(1, Number(e.target.value))) as GenerationSettings['maxPanelsPerPage'])}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                <span className="text-xs font-bold text-slate-700">중요 장면 1컷 허용</span>
                <input type="checkbox" checked={generationSettings.allowSinglePanelKeyScenes} onChange={e => updateGenerationSetting('allowSinglePanelKeyScenes', e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                <span className="text-xs font-bold text-slate-700">생성 후 승인받기</span>
                <input type="checkbox" checked={generationSettings.approvalMode} onChange={e => updateGenerationSetting('approvalMode', e.target.checked)} />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[11px] font-bold text-slate-500">
                연출 강도
                <select
                  value={generationSettings.maturityLevel}
                  onChange={e => updateGenerationSetting('maturityLevel', e.target.value as GenerationSettings['maturityLevel'])}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                >
                  <option value="all">전체공개</option>
                  <option value="kiss">키스/설렘</option>
                  <option value="mood">성숙한 분위기</option>
                  <option value="mature">강한 성인 연출</option>
                </select>
              </label>
              <label className="text-[11px] font-bold text-slate-500">
                추가 제어 메모
                <input
                  type="text"
                  value={generationSettings.maturityNote}
                  onChange={e => updateGenerationSetting('maturityNote', e.target.value)}
                  className="mt-1 w-full bg-white border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800"
                  placeholder="예: 코미디 중심, 감정선 강조"
                />
              </label>
            </div>
          </div>
          )}

          <div className="space-y-4">
            <div className="flex justify-between items-end">
              <label className="block text-sm font-bold text-slate-700">등장인물 설정</label>
              <button type="button" onClick={handleAddCharacter} className="text-xs text-indigo-600 font-bold hover:underline">+ 인물 추가</button>
            </div>
            
            {characters.map((char, index) => (
              <div key={index} className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 relative group">
                {characters.length > 1 && (
                  <button type="button" onClick={() => handleRemoveCharacter(index)} className="absolute top-3 right-3 text-slate-300 hover:text-red-400">✕</button>
                )}
                <h3 className="text-sm font-bold text-indigo-600 mb-3">캐릭터 {index + 1}</h3>
                <select value={char.role} onChange={e => handleCharacterChange(index, 'role', e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm mb-2">
                  {CHARACTER_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                </select>
                <input type="text" value={char.name} onChange={e => handleCharacterChange(index, 'name', e.target.value)} placeholder="이름 (예: 태경) (비워두면 AI가 기획)" className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm mb-2" />
                <textarea value={char.description} onChange={e => handleCharacterChange(index, 'description', e.target.value)} placeholder="외양, 성격, 직업, 특징 묘사 (상세할수록 좋습니다) (비워두면 AI가 기획)" className="w-full h-20 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none" />
                <div className="mt-3 flex items-center gap-3">
                  {char.imageUrl ? (
                    <img src={char.imageUrl} alt="" className="w-16 h-16 rounded-xl object-cover border border-slate-200 bg-white" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl border border-dashed border-slate-300 bg-white flex items-center justify-center text-slate-300 text-xl">＋</div>
                  )}
                  <div className="flex-1">
                    <label className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-600 hover:border-indigo-300 cursor-pointer">
                      {uploadingCharacterIndex === index ? '압축/업로드 중...' : char.imageUrl ? '이미지 교체' : '캐릭터 이미지 첨부'}
                      <input type="file" accept="image/*" className="hidden" disabled={uploadingCharacterIndex !== null} onChange={e => handleCharacterImageUpload(index, e.target.files?.[0])} />
                    </label>
                    {char.imageUrl && (
                      <button type="button" onClick={() => handleCharacterChange(index, 'imageUrl', '')} className="ml-2 text-xs font-bold text-rose-500 hover:underline">
                        제거
                      </button>
                    )}
                    <p className="mt-1 text-[10px] text-slate-400">업로드 전 WebP로 압축하고 URL만 저장합니다.</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <button type="submit" disabled={loading} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-md transition-colors disabled:opacity-50">
            {loading ? '프로젝트 생성 중...' : creationMode === 'manual' ? '프로젝트 수동 생성' : '프로젝트 생성 (빈 칸은 AI가 자동 기획)'}
          </button>
        </form>
      </div>
    </div>
  );
}
