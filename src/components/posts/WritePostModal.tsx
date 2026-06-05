import React, { useState, useRef, useEffect } from 'react';
import { collection, serverTimestamp, updateDoc, doc, increment, setDoc } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { uploadToCloudinary } from '../../lib/cloudinary';
import { sendGlobalNotification } from '../../lib/notifications';
import { generatePostDraft } from '../../lib/gemini';
import { buildKakaoSearchUrl, detectKoreanRegion, resolveKoreanPlace } from '../../lib/placeTools';
import { encodeGeohash, getGeoPrefix } from '../../lib/geo';
import { useVisualViewportInset } from '../../hooks/useVisualViewportInset';
import { useToastStore } from '../../stores/toastStore';
import { playCoinSound } from '../../lib/sound';
import type { FashionItem } from './FashionPostView';

interface WritePostModalProps {
  channelId: string;
  onClose: () => void;
  onSaved?: () => void;
  editPost?: {
    id: string;
    title: string;
    content: string;
    imageUrls?: string[];
    imageUrl?: string;
    locationName?: string;
    region?: string;
    lat?: number;
    lng?: number;
    mapUrl?: string;
    fashionItems?: FashionItem[];
    modelImages?: string[];
    subCategory?: string;
  };
}

const REGIONS = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];

async function compressImage(file: File, maxWidth = 1200, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = e => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        if (w > maxWidth) { h = Math.round((h * maxWidth) / w); w = maxWidth; }
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => b ? resolve(b) : reject(new Error('Blob 변환 실패')), 'image/jpeg', quality);
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
}

const safeParseFloat = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const extractUrls = (t = '') => Array.from(new Set(t.match(/https?:\/\/[^\s)]+/g) || []));

export function WritePostModal({ channelId, onClose, onSaved, editPost }: WritePostModalProps) {
  // ✅ 위치/지도는 "장소 채널"에서만 허용 (커뮤니티 채널에서는 절대 저장/표시 금지)
  const isLocationChannel = ['hotplace','restaurants','spots','accommodation'].includes(channelId);

  const [title, setTitle] = useState(editPost?.title || '');
  const [content, setContent] = useState(editPost?.content || '');
  const [imageUrls, setImageUrls] = useState<string[]>(editPost?.imageUrls || (editPost?.imageUrl ? [editPost.imageUrl] : []));
  const [locationName, setLocationName] = useState(isLocationChannel ? (editPost?.locationName || '') : '');
  const [region, setRegion] = useState(isLocationChannel ? (editPost?.region || '') : '');
  const [subCategory, setSubCategory] = useState(editPost?.subCategory || '자유발언');
  const [lat, setLat] = useState(isLocationChannel && editPost?.lat ? String(editPost.lat) : '');
  const [lng, setLng] = useState(isLocationChannel && editPost?.lng ? String(editPost.lng) : '');
  const [mapUrl, setMapUrl] = useState(isLocationChannel ? (editPost?.mapUrl || '') : '');
  const [fashionItems, setFashionItems] = useState<FashionItem[]>(editPost?.fashionItems || []);
  const [modelImages, setModelImages] = useState<string[]>(editPost?.modelImages || []);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<number, number>>({});
  const [isGeoLoading, setIsGeoLoading] = useState(false);
  const [isAiDrafting, setIsAiDrafting] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState<'idle'|'loading'|'ok'|'fail'>('idle');
  const [activeTab, setActiveTab] = useState<'write'|'preview'>('write');
  const [compressionInfo, setCompressionInfo] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyboardInset = useVisualViewportInset();
  const { showToast } = useToastStore();

  // ✅ 클립보드 이미지 붙여넣기 (Ctrl+V / 모바일 붙여넣기)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items || []);
      const imageItems = items.filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;
      e.preventDefault();
      if (imageUrls.length >= 5) return alert('이미지는 최대 5장까지 첨부할 수 있습니다.');
      if (!auth.currentUser) return;
      setIsSubmitting(true);
      try {
        for (const item of imageItems.slice(0, 5 - imageUrls.length)) {
          const file = item.getAsFile();
          if (!file) continue;
          let blob: Blob = file;
          if (file.size > 300 * 1024) blob = await compressImage(file);
          const url = await uploadToCloudinary(blob, 'posts');
          setImageUrls(prev => [...prev, url]);
        }
      } catch (err: any) {
        showToast(`이미지 업로드 오류: ${err.message}`, 'error');
      } finally {
        setIsSubmitting(false);
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [imageUrls.length]);

  const canGenerateDraft = Boolean(title.trim() || locationName.trim() || content.trim() || imageUrls.length > 0 || mapUrl.trim());
  const hasCoords = lat && lng && parseFloat(lat) !== 0 && parseFloat(lng) !== 0;

  // ✅ 커뮤니티 채널에서는 위치 관련 상태를 강제로 비움(숨겨진 값이 저장되는 사고 방지)
  useEffect(() => {
    if (isLocationChannel) return;
    setLocationName('');
    setRegion('');
    setLat('');
    setLng('');
    setMapUrl('');
    setGeocodeStatus('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLocationChannel]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.max(300, ta.scrollHeight) + 'px'; }
  }, [content]);

  const insertMarkdown = (before: string, after = '') => {
    const ta = textareaRef.current;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = content.substring(s, e);
    setContent(content.substring(0, s) + before + sel + after + content.substring(e));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); }, 0);
  };

  const handleGeocode = async () => {
    if (!locationName.trim()) return alert('장소명이나 주소를 먼저 입력해주세요.');
    setGeocodeStatus('loading');
    const rawLocation = locationName.trim();
    const keyword = [rawLocation, region].filter(Boolean).join(' ');
    let result = await resolveKoreanPlace(rawLocation);
    if ((!result.lat || !result.lng || result.source === 'link-only') && keyword !== rawLocation) {
      result = await resolveKoreanPlace(keyword);
    }
    setMapUrl(result.kakaoMapUrl || buildKakaoSearchUrl(keyword));
    if (result.lat && result.lng && result.source !== 'link-only') {
      setLat(result.lat.toFixed(6));
      setLng(result.lng.toFixed(6));
      if (!region) {
        const det = detectKoreanRegion(result.roadAddress || result.address || '', result.name, locationName);
        if (det) setRegion(det);
      }
      setGeocodeStatus('ok');
    } else {
      setGeocodeStatus('fail');
    }
  };

  // ✅ AI 루이 초안 - URL 딥 분석 포함, PostDraftResult 객체 올바르게 처리
  const handleGenerateDraft = async () => {
    if (!canGenerateDraft) {
      alert('제목, 장소, 링크, 사진 중 하나는 먼저 넣어주세요.');
      return;
    }
    setIsAiDrafting(true);
    try {
      const sourceLinks = Array.from(new Set([
        ...extractUrls(title),
        ...extractUrls(locationName),
        ...extractUrls(mapUrl),
        ...extractUrls(content),
      ])).slice(0, 8);

      const result = await generatePostDraft({
        channelId,
        title: title.trim() || locationName.trim() || sourceLinks[0] || '',
        locationName: locationName.trim(),
        region,
        currentContent: content.trim(),
        imageUrls,
        fashionItems, // ✅ OOTD용 아이템 목록 전달
        sourceLinks,
      });

      // ✅ PostDraftResult 객체 분해
      if (result?.content) {
        setContent(result.content);
        if (result.title && !title.trim()) setTitle(result.title.slice(0, 100));
        // 커뮤니티 채널에서는 지도/위치 데이터를 절대 세팅하지 않음
        if (isLocationChannel) {
          if (result.locationName && !locationName.trim()) setLocationName(result.locationName);
          if (result.mapUrl && !mapUrl.trim()) setMapUrl(result.mapUrl);
          if (result.region && !region) setRegion(result.region);
        }
        
        if (result.imageUrls?.length > 0) {
          setImageUrls(prev => [...new Set([...prev, ...result.imageUrls])].slice(0, 5));
        }
        
        // OOTD 전용 필드 반영
        if (result.fashionItems && result.fashionItems.length > 0) {
          // 기존 imageUrl을 유지하면서 내용만 병합
          setFashionItems(prev => {
            return result.fashionItems!.map((item: any, i: number) => ({
              ...item,
              imageUrl: prev[i]?.imageUrl || item.imageUrl || '',
            }));
          });
        }
        if (result.modelImages && result.modelImages.length > 0) {
          setModelImages(prev => [...new Set([...prev, ...result.modelImages!])].slice(0, 5));
        }
        
        setActiveTab('write');
      } else {
        alert('AI 루이가 초안을 만들지 못했어요. 제목, 장소, 또는 링크를 조금 더 추가해주세요.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') alert(`초안 생성 실패: ${err.message || '잠시 후 다시 시도해주세요.'}`);
    } finally {
      setIsAiDrafting(false);
    }
  };

  const handleGetLocation = () => {
    if (!navigator.geolocation) return alert('브라우저가 위치 정보를 지원하지 않습니다.');
    setIsGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      pos => { setLat(pos.coords.latitude.toFixed(6)); setLng(pos.coords.longitude.toFixed(6)); setIsGeoLoading(false); setGeocodeStatus('ok'); },
      err => { alert('위치 정보를 가져올 수 없습니다: ' + err.message); setIsGeoLoading(false); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    if (!files.length) return;
    if (imageUrls.length + files.length > 5) return alert('이미지는 최대 5장까지 첨부할 수 있습니다.');
    if (!auth.currentUser) return alert('로그인이 필요합니다.');
    setIsSubmitting(true);
    setCompressionInfo('');
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const origKB = (file.size / 1024).toFixed(0);
        let blob: Blob = file;
        if (file.size > 300 * 1024) {
          setCompressionInfo(`🗜️ 압축 중.. (원본 ${origKB}KB)`);
          blob = await compressImage(file);
          setCompressionInfo(`✅ 압축 완료: ${origKB}KB → ${(blob.size/1024).toFixed(0)}KB`);
        }
        const idx = imageUrls.length + i;
        setUploadProgress(p => ({ ...p, [idx]: 50 }));
        const url = await uploadToCloudinary(blob, 'posts');
        setImageUrls(p => [...p, url]);
        setUploadProgress(p => ({ ...p, [idx]: 100 }));
      }
      setCompressionInfo('');
    } catch (err: any) {
      alert(`이미지 업로드 오류: ${err.message}`);
    } finally {
      setIsSubmitting(false);
      setUploadProgress({});
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || !auth.currentUser || isSubmitting) return;
    if (isLocationChannel && !region) return alert('지역을 선택해주세요.');
    setIsSubmitting(true);
    try {
      const cleanTitle = title.trim();
      const cleanContent = content.trim();

      // 커뮤니티 채널: 지도/위치 링크를 자동 생성/저장하지 않음
      const sourceLinks = Array.from(new Set([
        ...extractUrls(cleanTitle),
        ...extractUrls(cleanContent),
        ...(isLocationChannel ? extractUrls(locationName) : []),
        ...(isLocationChannel ? extractUrls(mapUrl) : []),
      ])).slice(0, 6);

      const finalImageUrls = [...imageUrls];
      if (finalImageUrls.length === 0) {
        const ytUrls = extractUrls(cleanContent).filter(u => u.includes('youtu'));
        for (const u of ytUrls) {
          const ytMatch = u.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
          if (ytMatch && ytMatch[1]) {
            finalImageUrls.push(`https://img.youtube.com/vi/${ytMatch[1]}/hqdefault.jpg`);
            break;
          }
        }
      }

      const postData: Record<string, any> = {
        channelId, authorId: auth.currentUser.uid,
        title: cleanTitle, content: cleanContent,
        likesCount: 0, imageUrl: finalImageUrls[0] || '', imageUrls: finalImageUrls,
        sourceLinks, isAiGenerated: false, updatedAt: serverTimestamp(),
      };

      if (isLocationChannel) {
        const parsedLat = safeParseFloat(lat);
        const parsedLng = safeParseFloat(lng);
        const geohash = encodeGeohash(parsedLat, parsedLng);
        const cleanLoc = locationName.trim();
        const cleanRegion = detectKoreanRegion(cleanLoc) || region || '';
        const mapSearchKw = cleanLoc || cleanTitle;
        postData.locationName = cleanLoc;
        postData.region = cleanRegion;
        postData.lat = parsedLat;
        postData.lng = parsedLng;
        postData.geohash = geohash;
        postData.geoPrefix = getGeoPrefix(geohash);
        postData.mapUrl = mapUrl || (mapSearchKw ? buildKakaoSearchUrl(mapSearchKw) : '');
      }

      if (channelId === 'freeboard') {
        postData.subCategory = subCategory;
      }

      if (channelId === 'ootd') {
        postData.fashionItems = fashionItems;
        postData.modelImages = modelImages;
        // ootd인 경우 대표 이미지(imageUrl)를 모델컷의 첫번째로 지정
        if (modelImages.length > 0) {
          postData.imageUrl = modelImages[0];
          postData.imageUrls = [...modelImages];
        }
      }
      if (!editPost) {
        const postRef = doc(collection(db, 'posts'));
        postData.createdAt = new Date();
        postData.commentsCount = 0;
        await setDoc(postRef, postData);
        onSaved?.();
        onClose(); // 즉시 모달 닫기
        playCoinSound();
        // ✅ 공지사항 등록 시 전역 알림
        if (channelId === 'notice') {
          sendGlobalNotification({
            userId: auth.currentUser?.uid || '',
            type: 'new_notice',
            title: '새 공지사항',
            message: `📢 ${title.trim()}`,
            postId: postRef.id,
            postTitle: title.trim(),
            actorId: auth.currentUser?.uid,
            actorName: auth.currentUser?.displayName || '운영자',
            channelId: 'notice',
            url: `${import.meta.env.VITE_APP_URL || ''}/channels/notice`,
          }).catch(console.error);
        }
        updateDoc(doc(db, 'users', auth.currentUser.uid), { xp: increment(50), updatedAt: new Date() }).catch(() => {});
      } else {
        // 수정 시 원본 고유 필드 보존 (Firestore 보안 규칙 충돌 방지)
        const { createdAt, authorId, channelId: _c, commentsCount, likesCount, ...upd } = postData;
        await updateDoc(doc(db, 'posts', editPost.id), upd);
        onSaved?.();
        onClose(); // 즉시 모달 닫기
        playCoinSound();
      }
      // ✅ 모바일 소프트 키보드 닫기
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onClose();
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('permission-denied') || msg.includes('Missing or insufficient')) {
        alert('권한 오류: 로그인 상태를 확인하거나 관리자에게 문의해주세요.\n\n상세: ' + msg);
      } else {
        showToast(`게시물 등록 실패: ${msg || '알 수 없는 오류가 발생했습니다.'}`, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderPreview = (text: string) =>
    text.replace(/^### (.+)$/gm, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>')
        .replace(/^## (.+)$/gm, '<h2 class="text-xl font-bold mt-6 mb-3">$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code class="bg-slate-100 text-rose-600 px-1 rounded">$1</code>')
        .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-rose-300 pl-4 italic my-2">$1</blockquote>')
        .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
        .replace(/\n\n/g, '</p><p class="mb-3">').replace(/\n/g, '<br/>');

  const TOOLBAR = [
    { label: 'H2', action: () => insertMarkdown('## '), title: '제목' },
    { label: 'H3', action: () => insertMarkdown('### '), title: '소제목' },
    { label: 'B', action: () => insertMarkdown('**', '**'), title: '굵게', cls: 'font-bold' },
    { label: 'I', action: () => insertMarkdown('*', '*'), title: '기울임', cls: 'italic' },
    { label: '인용', action: () => insertMarkdown('> '), title: '인용구' },
    { label: '목록', action: () => insertMarkdown('- '), title: '목록' },
  ];

  const isUploadingImages = Object.keys(uploadProgress).length > 0;

  return (
    <div
      className="fixed inset-0 z-[30000] flex items-start justify-center bg-slate-900/50 backdrop-blur-sm p-0 md:items-center md:p-4"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: keyboardInset ? `${keyboardInset}px` : 'env(safe-area-inset-bottom)' }}
    >
      <div className="bg-white w-full h-[100dvh] max-h-[100dvh] rounded-none shadow-2xl flex flex-col overflow-hidden md:h-auto md:max-w-3xl md:max-h-[92vh] md:rounded-2xl">
        <div className="px-5 py-3.5 border-b border-slate-100 flex justify-between items-center bg-white shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✏️</span>
            <h3 className="font-bold text-lg text-slate-800">{editPost ? '게시물 수정' : '새 글 작성'}</h3>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-100 rounded-lg p-0.5">
              {(['write','preview'] as const).map(t => (
                <button key={t} type="button" onClick={() => setActiveTab(t)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-colors ${activeTab === t ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}>
                  {t === 'write' ? '작성' : '미리보기'}
                </button>
              ))}
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
          <div className="p-4 md:p-5 space-y-4 flex-1">
            {/* 제목 */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">제목</label>
                <span className={`text-[10px] ${title.length > 90 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>{title.length}/100</span>
              </div>
              <input type="text" value={title} onChange={e => setTitle(e.target.value)} required maxLength={100}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800 text-lg font-bold focus:ring-2 focus:ring-rose-400 focus:outline-none placeholder:font-normal placeholder:text-slate-300"
                placeholder="제목을 입력하세요" />
            </div>

            {/* freeboard 서브카테고리 */}
            {channelId === 'freeboard' && (
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1 block">카테고리</label>
                <div className="flex gap-2 flex-wrap">
                  {['자유발언', '유머게시판', '동전 유튜브', '동전 갤러리'].map(cat => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSubCategory(cat)}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
                        subCategory === cat
                          ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300'
                      }`}
                    >
                      {cat === '자유발언' ? '💬 자유발언' : cat === '유머게시판' ? '😂 유머' : cat === '동전 유튜브' ? '📺 유튜브' : '🖼️ 갤러리'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 위치 정보 */}
            {isLocationChannel && (
              <div className="bg-rose-50 rounded-xl border border-rose-100 p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-rose-500 text-sm font-bold">📍 위치 정보</span>
                  <div className="ml-auto flex gap-1">
                    <button type="button" onClick={handleGeocode} disabled={geocodeStatus === 'loading' || !locationName.trim()}
                      className="text-[11px] bg-indigo-500 text-white px-3 py-1 rounded-full font-bold hover:bg-indigo-600 disabled:opacity-50">
                      {geocodeStatus === 'loading' ? '검색 중..' : '🗺️ 주소로 좌표 찾기'}
                    </button>
                    <button type="button" onClick={handleGetLocation} disabled={isGeoLoading}
                      className="text-[11px] bg-rose-500 text-white px-3 py-1 rounded-full font-bold hover:bg-rose-600 disabled:opacity-50">
                      {isGeoLoading ? '위치 확인 중..' : '📡 현재 위치'}
                    </button>
                  </div>
                </div>
                <div className="flex gap-2">
                  <select value={region} onChange={e => setRegion(e.target.value)} required={isLocationChannel}
                    className="w-1/3 bg-white border border-rose-200 rounded-lg px-2 py-2 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none">
                    <option value="" disabled>지역 선택</option>
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input type="text" value={locationName} onChange={e => { setLocationName(e.target.value); setGeocodeStatus('idle'); }} required={isLocationChannel}
                    className="flex-1 bg-white border border-rose-200 rounded-lg px-3 py-2 text-slate-800 text-sm focus:ring-2 focus:ring-rose-400 focus:outline-none"
                    placeholder="도로명 주소 (예: 인천광역시 중구 개항장로 74)" />
                </div>
                <div className="flex items-center gap-2">
                  {geocodeStatus === 'ok' && hasCoords && (
                    <span className="text-[10px] text-emerald-600 font-bold bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                      ✅ 지도 핀 설정됨 ({parseFloat(lat).toFixed(4)}, {parseFloat(lng).toFixed(4)})
                    </span>
                  )}
                  {geocodeStatus === 'fail' && (
                    <span className="text-[10px] text-orange-600 font-bold bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                      ⚠️ 정확한 도로명 주소를 입력하거나 현재 위치를 사용해주세요
                    </span>
                  )}
                  {!hasCoords && geocodeStatus === 'idle' && locationName && (
                    <span className="text-[10px] text-slate-400">💡 "주소로 좌표 찾기"를 누르면 지도에 자동 등록돼요</span>
                  )}
                  {!hasCoords && geocodeStatus === 'idle' && !locationName && (
                    <span className="text-[10px] text-slate-400">📍 좌표를 입력하면 전국 지도에 핀이 표시돼요</span>
                  )}
                </div>
              </div>
            )}

            {/* 에디터 */}
            {activeTab === 'write' ? (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 border-b border-slate-200 px-2 py-1.5 flex flex-wrap gap-1 items-center">
                  {TOOLBAR.map(tool => (
                    <button key={tool.label} type="button" onClick={tool.action} title={tool.title}
                      className={`px-2 py-1 text-xs rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-indigo-50 ${tool.cls || ''}`}>
                      {tool.label}
                    </button>
                  ))}
                  {/* ✅ AI 루이 초안 버튼 - 제목/주소/링크/사진 → URL 딥분석 후 본문 자동 완성 */}
                  <button type="button" onClick={handleGenerateDraft} disabled={isAiDrafting || !canGenerateDraft}
                    className="ml-auto px-3 py-1 text-xs rounded-md bg-violet-600 text-white font-bold hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1"
                    title="제목·주소·링크·사진을 분석해서 AI 루이가 본문을 완성합니다">
                    {isAiDrafting ? (
                      <><svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> 작성 중..</>
                    ) : '✨ 루이 초안'}
                  </button>
                </div>
                <textarea ref={textareaRef} value={content} onChange={e => setContent(e.target.value)} required maxLength={5000}
                  className="w-full bg-white px-4 py-4 text-slate-800 text-sm leading-relaxed focus:outline-none resize-none min-h-[300px]"
                  placeholder="글을 작성해주세요..&#10;유튜브 링크, 블로그 링크, 장소 주소를 붙여넣고 ✨ 루이 초안을 누르면 AI가 분석해서 완성합니다. (마크다운 지원)" />
                <div className="bg-slate-50 border-t border-slate-200 px-3 py-1 flex justify-end">
                  <span className={`text-[10px] ${content.length > 4800 ? 'text-rose-500 font-bold' : 'text-slate-400'}`}>{content.length}/5000</span>
                </div>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden min-h-[300px]">
                <div className="p-4 text-sm text-slate-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: '<p class="mb-3">' + renderPreview(content || '*미리보기*') + '</p>' }} />
              </div>
            )}

            {/* 사진 */}
            {channelId === 'ootd' ? (
              <div className="space-y-4">
                {/* 모델 컷 (갤러리) */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
                    📸 모델 연출 컷 ({modelImages.length}/5)
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {modelImages.map((url, i) => (
                      <div key={i} className="relative w-20 h-24 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        <button type="button" onClick={() => setModelImages(p => p.filter((_, j) => j !== i))}
                          className="absolute top-0.5 right-0.5 w-5 h-5 bg-slate-900/70 text-white rounded-full flex items-center justify-center text-xs hover:bg-rose-600">✕</button>
                      </div>
                    ))}
                    {modelImages.length < 5 && !isUploadingImages && (
                      <label className="w-20 h-24 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-400 cursor-pointer bg-white">
                        <span className="text-xl">+</span>
                        <span className="text-[9px] mt-0.5">모델사진</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={async e => {
                          const files = Array.from(e.target.files || []) as File[];
                          if (!files.length) return;
                          setIsSubmitting(true);
                          try {
                            for (const file of files.slice(0, 5 - modelImages.length)) {
                              const blob = file.size > 300 * 1024 ? await compressImage(file) : file;
                              const url = await uploadToCloudinary(blob, 'posts');
                              setModelImages(p => [...p, url]);
                            }
                          } catch (err: any) { alert(err.message); } finally { setIsSubmitting(false); }
                        }} />
                      </label>
                    )}
                  </div>
                </div>

                {/* 개별 아이템 (테트리스 방식) */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex justify-between items-center">
                    <span>👔 개별 아이템 ({fashionItems.length}/10)</span>
                    <span className="text-[10px] font-normal text-slate-400 normal-case bg-white px-2 py-0.5 rounded border border-slate-200 shadow-sm">
                      사진 추가 후 브랜드를 적어주세요
                    </span>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {fashionItems.map((item, i) => (
                      <div key={i} className="relative w-24 rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-white flex flex-col group">
                        <div className="w-full aspect-square relative">
                          <img src={item.imageUrl} alt="" className="w-full h-full object-cover" />
                          <button type="button" onClick={() => setFashionItems(p => p.filter((_, j) => j !== i))}
                            className="absolute top-0.5 right-0.5 w-5 h-5 bg-slate-900/70 text-white rounded-full flex items-center justify-center text-xs hover:bg-rose-600 opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                        </div>
                        <div className="p-1.5 space-y-1">
                          <input type="text" placeholder="브랜드명" value={item.brand} onChange={e => setFashionItems(p => p.map((it, j) => j === i ? { ...it, brand: e.target.value } : it))}
                            className="w-full text-[10px] font-bold border-b border-slate-200 px-1 py-0.5 focus:outline-none focus:border-indigo-400" />
                          <input type="text" placeholder="아이템명" value={item.name} onChange={e => setFashionItems(p => p.map((it, j) => j === i ? { ...it, name: e.target.value } : it))}
                            className="w-full text-[10px] border-b border-slate-200 px-1 py-0.5 focus:outline-none focus:border-indigo-400" />
                          <input type="url" placeholder="구매링크(URL)" value={item.link} onChange={e => setFashionItems(p => p.map((it, j) => j === i ? { ...it, link: e.target.value } : it))}
                            className="w-full text-[9px] text-indigo-500 border-b border-slate-200 px-1 py-0.5 focus:outline-none focus:border-indigo-400" />
                        </div>
                      </div>
                    ))}
                    {fashionItems.length < 10 && !isUploadingImages && (
                      <label className="w-24 aspect-square border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-400 cursor-pointer bg-white">
                        <span className="text-xl">+</span>
                        <span className="text-[9px] mt-0.5 text-center px-2">아이템 추가</span>
                        <input type="file" accept="image/*" multiple className="hidden" onChange={async e => {
                          const files = Array.from(e.target.files || []) as File[];
                          if (!files.length) return;
                          setIsSubmitting(true);
                          try {
                            for (const file of files.slice(0, 10 - fashionItems.length)) {
                              const blob = file.size > 300 * 1024 ? await compressImage(file) : file;
                              const url = await uploadToCloudinary(blob, 'posts');
                              setFashionItems(p => [...p, { imageUrl: url, brand: '', name: '', link: '' }]);
                            }
                          } catch (err: any) { alert(err.message); } finally { setIsSubmitting(false); }
                        }} />
                      </label>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 block">
                  사진 첨부 ({imageUrls.length}/5)
                  <span className="ml-2 text-[10px] font-normal text-slate-400 normal-case">✨ 자동 압축 · Ctrl+V 또는 사진 붙여넣기 가능</span>
                </label>
                {compressionInfo && <div className="mb-2 text-xs text-indigo-600 bg-indigo-50 px-3 py-2 rounded-lg">{compressionInfo}</div>}
                {isUploadingImages && (
                  <div className="mb-3 space-y-1">
                    {Object.entries(uploadProgress).map(([idx, p]) => (
                      <div key={idx} className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${p}%` }} />
                        </div>
                        <span className="text-[10px] text-slate-500 w-10 text-right">{Math.round(p as number)}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 flex-wrap">
                  {imageUrls.map((url, i) => (
                    <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                      <img src={url} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => setImageUrls(p => p.filter((_, j) => j !== i))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 bg-slate-900/70 text-white rounded-full flex items-center justify-center text-xs hover:bg-rose-600">✕</button>
                    </div>
                  ))}
                  {imageUrls.length < 5 && !isUploadingImages && (
                    <button type="button" onClick={() => fileInputRef.current?.click()}
                      className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-xl flex flex-col items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-400">
                      <span className="text-xl">+</span>
                      <span className="text-[9px] mt-0.5">사진 추가</span>
                    </button>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
              </div>
            )}
          </div>

          <div className="px-5 py-3 border-t border-slate-100 flex justify-between items-center gap-2 bg-slate-50 shrink-0">
            <p className="text-[10px] text-slate-400">
              {isLocationChannel ? '📍 위치 좌표 입력 시 전국 지도에 표시돼요' : '✨ 링크/주소 붙여넣고 루이 초안 누르면 AI가 완성합니다'}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-slate-600 font-medium hover:bg-slate-100 text-sm">취소</button>
              <button type="submit" disabled={isSubmitting || !title.trim() || !content.trim() || isUploadingImages}
                className="px-6 py-2 rounded-xl text-white font-bold bg-gradient-to-r from-rose-500 to-orange-400 shadow-md hover:shadow-lg disabled:opacity-50 text-sm flex items-center gap-2">
                {isSubmitting ? (
                  <><svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>처리 중..</>
                ) : editPost ? '수정 완료 ✏️' : '게시하기 🎉'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
