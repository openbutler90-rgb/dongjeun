import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../stores/authStore';
import { linkifyText } from '../../lib/linkify';
import { collection, serverTimestamp, addDoc, getDocs, query, where, updateDoc, doc, increment, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { generateFullBlog, searchPlaceImages } from '../../lib/gemini';
import { startLouisRecommendationTask, stopLouisTask, subscribeLouisTask, type LouisTaskState } from '../../lib/louisTaskManager';
import { buildKakaoSearchUrl, buildNaverSearchUrl, detectKoreanRegion, getRegionCenter, imageFromUserLink, resolveKoreanPlace, searchNaverPlaceImages, splitKoreanPlaceAddress, usableImageUrl } from '../../lib/placeTools';
import { playCoinSound } from '../../lib/sound';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  recommendations?: RecommendationItem[];
  source?: string;
}

interface RecommendationItem {
  title: string;
  category: string;
  region: string;
  locationName: string;
  mapUrl?: string;
  sourceLinks?: string[];
  briefDesc: string;
  imageUrls?: string[];
  imageUrl?: string;
  placeVerified?: boolean;
  fashionItems?: { name: string; brand: string; link: string; imageUrl: string }[];
  modelImages?: string[];
}

const CATEGORY_META: Record<string, { label: string; icon: string; color: string; channel: string }> = {
  meeting_board: { label: '모임 사진', icon: '📷', color: 'bg-indigo-50 text-indigo-600 border-indigo-200', channel: 'meeting_board' },
  restaurants:   { label: '맛집',       icon: '🍽️', color: 'bg-orange-50 text-orange-600 border-orange-200', channel: 'restaurants' },
  hotplace:      { label: '핫플레이스', icon: '📍', color: 'bg-rose-50 text-rose-600 border-rose-200',       channel: 'hotplace' },
  spots:         { label: '인생샷 스팟', icon: '📸', color: 'bg-purple-50 text-purple-600 border-purple-200', channel: 'spots' },
  accommodation: { label: '숙소',       icon: '🏨', color: 'bg-blue-50 text-blue-600 border-blue-200',       channel: 'accommodation' },
  ootd:          { label: '패션',       icon: '👔', color: 'bg-slate-50 text-slate-700 border-slate-200',     channel: 'ootd' },
  counseling:    { label: '꿀팁',       icon: '💡', color: 'bg-amber-50 text-amber-600 border-amber-200',     channel: 'counseling' },
  freeboard:     { label: '자유게시판', icon: '💬', color: 'bg-indigo-50 text-indigo-600 border-indigo-200',   channel: 'freeboard' },
};

const INTRO_MESSAGE: ChatMessage = {
  role: 'model',
  content: '안녕하세요! 동전커피 AI 루이입니다 ☕\n\n동전커피 앱 안내, 공지/모임 글 초안, 맛집·핫플·숙소 추천, 지도 확인용 검색 키워드, 이모티콘 아이디어까지 도와드릴게요.\n\n예시: "동전커피 기능 알려줘", "부산 해운대 맛집 추천해줘", "모임 공지 문구 다듬어줘"',
};

const cleanDisplayText = (text = '') =>
  text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/(^|\n)#{1,6}\s*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();

const cleanMessagesForSave = (messages: ChatMessage[]) =>
  JSON.parse(JSON.stringify(messages.slice(-80))) as ChatMessage[];

const mergeUsableImages = (...groups: Array<string[] | string | undefined | null>) =>
  Array.from(new Set(
    groups
      .flatMap(group => Array.isArray(group) ? group : group ? [group] : [])
      .map(url => usableImageUrl(url))
      .filter(Boolean)
  ));

const isGenericRecommendationImage = (url = '') => {
  const clean = url.trim();
  return !clean || clean.startsWith('/category-fallbacks/') || clean.includes('images.unsplash.com/');
};

const firstRealRecommendationImage = (...groups: Array<string[] | string | undefined | null>) => {
  const usable = mergeUsableImages(...groups);
  return usable.find(url => !isGenericRecommendationImage(url)) || '';
};

const cleanPlaceKeyword = (primary = '', fallback = '') => {
  const raw = (primary || fallback).trim().replace(/\s+/g, ' ');
  if (!raw) return '';
  const parts = raw.split(/[,|:：]/).map(part => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : raw;
};

const withTimeout = async <T,>(work: Promise<T>, ms: number, fallback: T): Promise<T> => {
  let timer: number | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>(resolve => {
        timer = window.setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) window.clearTimeout(timer);
  }
};

const notifyLouis = (title: string, body: string) => {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/ai-butler.png?v=20260518' });
};

interface DeepSearchState {
  loading: boolean;
  blogText: string;
  images: string[];
  error: string;
  done: boolean;
}

export function AiAssistant() {
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [louisTask, setLouisTask] = useState<LouisTaskState | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef(0);
  const { user, profile } = useAuthStore();
  const navigate = useNavigate();

  const [messages, setMessages] = useState<ChatMessage[]>([INTRO_MESSAGE]);

  // 카드별 선택 이미지
  const [cardImages, setCardImages] = useState<Record<string, string>>({});
  // 카드별 업로드 완료 여부
  const [uploadedRecs, setUploadedRecs] = useState<Set<string>>(new Set());
  const [uploadingRecs, setUploadingRecs] = useState<Set<string>>(new Set());
  // 심층서치 상태 (recKey → state)
  const [deepSearch, setDeepSearch] = useState<Record<string, DeepSearchState>>({});
  // 이미지 뷰어 (크게 보기)
  const [lightbox, setLightbox] = useState<string | null>(null);
  // 카드 작업 메뉴 열림 상태
  const [activeActionMenu, setActiveActionMenu] = useState<string | null>(null);
  // 헤더 메뉴 열림 상태
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const historyLoadedRef = useRef(false);
  const lastPersistedMessagesRef = useRef('');
  const saveTimerRef = useRef<number | null>(null);
  const enrichedMessageKeysRef = useRef<Set<string>>(new Set());
  const notifiedSourceKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    historyLoadedRef.current = false;
    const historyRef = doc(db, 'aiSessions', user.uid);
    const unsub = onSnapshot(historyRef, (snap) => {
      const saved = snap.data()?.messages;
      const nextMessages = Array.isArray(saved) && saved.length > 0
        ? cleanMessagesForSave(saved as ChatMessage[])
        : [INTRO_MESSAGE];
      const nextJson = JSON.stringify(nextMessages);
      if (nextJson !== lastPersistedMessagesRef.current) {
        lastPersistedMessagesRef.current = nextJson;
        setMessages(nextMessages);
      }
      historyLoadedRef.current = true;
    }, (error) => {
      console.error('AI history load failed:', error);
      historyLoadedRef.current = true;
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user || !historyLoadedRef.current) return;
    const nextMessages = cleanMessagesForSave(messages);
    const nextJson = JSON.stringify(nextMessages);
    if (nextJson === lastPersistedMessagesRef.current) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      lastPersistedMessagesRef.current = nextJson;
      setDoc(doc(db, 'aiSessions', user.uid), {
        userId: user.uid,
        messages: nextMessages,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch((error) => {
        console.error('AI history save failed:', error);
        lastPersistedMessagesRef.current = '';
      });
    }, 400);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [messages, user]);

  const handleClearHistory = async () => {
    if (!user) return;
    if (!confirm('AI 루이 대화 기록을 삭제할까요? 삭제 전까지는 이 계정에서 계속 보관됩니다.')) return;
    await deleteDoc(doc(db, 'aiSessions', user.uid)).catch(() => {});
    setMessages([INTRO_MESSAGE]);
    setCardImages({});
    setDeepSearch({});
    setUploadedRecs(new Set());
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, deepSearch]);

  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const insideMenu = target.closest('[data-action-menu]') !== null;
      if (!insideMenu) {
        setActiveActionMenu(null);
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeLouisTask((task) => {
      if (task.userId && task.userId !== user.uid) return;
      setLouisTask(task);
      const active = task.status === 'searching' || task.status === 'parsing';
      if (active) {
        setIsLoading(true);
      } else if (task.status !== 'idle') {
        setIsLoading(false);
        abortControllerRef.current = null;
      }
    });
  }, [user]);

  useEffect(() => {
    if (!louisTask || !(louisTask.status === 'searching' || louisTask.status === 'parsing')) return;
    const renderStep = () => {
      const elapsed = louisTask.startedAt ? Math.max(0, Math.floor((Date.now() - louisTask.startedAt) / 1000)) : 0;
      setLoadingStep(`${louisTask.step || '루이가 찾는 중이에요'} (${elapsed}s elapsed)`);
    };
    renderStep();
    const timer = window.setInterval(renderStep, 1000);
    return () => window.clearInterval(timer);
  }, [louisTask]);

  const checkDuplicateLocation = async (locName: string) => {
    if (!locName?.trim()) return false;
    const q = query(collection(db, 'posts'), where('locationName', '==', locName.trim()));
    const snap = await getDocs(q);
    return !snap.empty;
  };

  const enrichRecommendationsWithKakao = async (recs: RecommendationItem[] = []) => {
    return Promise.all(recs.map(async (rec) => {
      const locationSource = rec.locationName?.trim() || cleanPlaceKeyword(rec.title);
      const parsedLocation = splitKoreanPlaceAddress(locationSource);
      const placeName = parsedLocation.placeName || locationSource;
      const addressOnly = parsedLocation.address || '';
      const correctedRegion = parsedLocation.region || detectKoreanRegion(locationSource, rec.region) || rec.region;

      if (rec.category === 'ootd') {
        // ① 각 아이템의 실제 상품 이미지 + 구매 링크를 네이버에서 검색
        const enrichedItems = await Promise.all(
          (rec.fashionItems || []).map(async (item: any) => {
            if (item.imageUrl && item.link) return item;
            try {
              const query = `남자 ${item.brand} ${item.name}`.trim();
              if (!query || query === '남자') return item;
              const shoppingUrl = `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(query)}`;
              const images = item.imageUrl ? [] : await searchNaverPlaceImages(query).catch(() => []);
              return {
                ...item,
                imageUrl: item.imageUrl || (images.length > 0 ? images[0] : ''),
                link: item.link || shoppingUrl,
              };
            } catch { /* ignore */ }
            return item;
          })
        );

        // ② 모델 전신 이미지를 네이버에서 검색 (코디 컨셉 제목 기준으로 검색해야 전체 룩과 일관성 있는 사진이 나옴)
        let modelImages = Array.isArray(rec.modelImages) ? rec.modelImages.filter(Boolean) : [];
        if (modelImages.length === 0 && enrichedItems.length > 0) {
          try {
            // 코디 전체 컨셉으로 검색 (예: "남자 여름 시티보이 린넨 코디 전신")
            const modelQuery = `남자 ${rec.title || ''} 코디 전신`.trim();
            const modelImgs = await searchNaverPlaceImages(modelQuery).catch(() => []);
            if (modelImgs.length > 0) {
              modelImages = modelImgs.slice(0, 3);
            }
          } catch { /* ignore */ }
        }

        return {
          ...rec,
          fashionItems: enrichedItems,
          modelImages,
          imageUrls: modelImages.length > 0 ? modelImages : rec.imageUrls,
          imageUrl: modelImages[0] || rec.imageUrl || '',
        };
      }

      const keyword = [placeName, addressOnly || correctedRegion].filter(Boolean).join(' ').trim();
      if (!keyword) return rec;
      const modelImages = mergeUsableImages(rec.imageUrls, rec.imageUrl);

      const fallbackLinks = Array.from(new Set([
        ...(Array.isArray(rec.sourceLinks) ? rec.sourceLinks : []),
        buildKakaoSearchUrl(keyword),
        buildNaverSearchUrl(keyword),
      ])).slice(0, 5);

      try {
        const resolved = await resolveKoreanPlace(keyword);
        const imageQuery = [placeName, addressOnly || correctedRegion].filter(Boolean).join(' ');
        const naverImages = modelImages.length >= 2 ? [] : await searchNaverPlaceImages(imageQuery).catch(() => []);
        const baseImages = mergeUsableImages(modelImages, naverImages).slice(0, 6);
        if (resolved.source !== 'kakao' || !resolved.lat || !resolved.lng) {
          return {
            ...rec,
            region: correctedRegion,
            locationName: addressOnly || rec.locationName || '',
            mapUrl: rec.mapUrl || buildKakaoSearchUrl(keyword),
            sourceLinks: fallbackLinks,
            imageUrls: baseImages,
            imageUrl: baseImages[0] || '',
            placeVerified: false,
          };
        }

        const verifiedAddress = resolved.roadAddress || resolved.address || addressOnly;
        const verifiedName = `${resolved.name || placeName} ${verifiedAddress}`.trim();
        const verifiedRegion = detectKoreanRegion(verifiedAddress, resolved.roadAddress, resolved.address, correctedRegion) || correctedRegion;
        const verifiedImages = baseImages.length >= 2 ? [] : await searchNaverPlaceImages(verifiedName || imageQuery).catch(() => naverImages);
        const finalImages = mergeUsableImages(baseImages, verifiedImages).slice(0, 6);
        return {
          ...rec,
          region: verifiedRegion,
          locationName: verifiedAddress || addressOnly || rec.locationName || '',
          mapUrl: resolved.kakaoMapUrl || buildKakaoSearchUrl(verifiedName || keyword),
          imageUrls: finalImages,
          imageUrl: finalImages[0] || '',
          sourceLinks: Array.from(new Set([
            resolved.kakaoMapUrl,
            buildNaverSearchUrl(verifiedName || keyword),
            ...fallbackLinks,
          ].filter(Boolean) as string[])).slice(0, 5),
          placeVerified: true,
        };
      } catch {
        return {
          ...rec,
          region: correctedRegion,
          locationName: addressOnly || rec.locationName || '',
          mapUrl: rec.mapUrl || buildKakaoSearchUrl(keyword),
          sourceLinks: fallbackLinks,
          imageUrls: modelImages,
          imageUrl: modelImages[0] || '',
          placeVerified: false,
        };
      }
    }));
  };

  const notifyOperatorsAiSource = async (source: string) => {
    if (!source?.trim()) return;
    const operatorSnap = await getDocs(query(collection(db, 'users'), where('role', 'in', ['admin', 'manager'])));
    const operatorIds = Array.from(new Set(operatorSnap.docs.map(userDoc => userDoc.id)));
    const targetIds = operatorIds.length > 0
      ? operatorIds
      : (user && profile && ['admin', 'manager'].includes(profile.role) ? [user.uid] : []);
    await Promise.all(targetIds.map(userId => addDoc(collection(db, 'notifications'), {
      userId,
      actorId: user?.uid || 'system',
      actorName: 'AI 루이',
      type: 'louis_engine',
      postTitle: 'AI 루이 엔진',
      message: `집사방 추천 검색에 ${source}를 사용 중입니다.`,
      read: false,
      createdAt: serverTimestamp(),
    }).catch(console.error)));
  };

  useEffect(() => {
    if (!user || !historyLoadedRef.current) return;
    let targetIndex = -1;
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index];
      if (
        message.role === 'model' &&
        Array.isArray(message.recommendations) &&
        message.recommendations.some(rec =>
          ['restaurants', 'hotplace', 'spots', 'accommodation'].includes(rec.category) &&
          !firstRealRecommendationImage(rec.imageUrls, rec.imageUrl)
        )
      ) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex < 0) return;

    const target = messages[targetIndex];
    const key = `${targetIndex}:${target.recommendations?.map(rec => rec.title).join('|') || ''}`;
    if (enrichedMessageKeysRef.current.has(key)) return;
    enrichedMessageKeysRef.current.add(key);

    enrichRecommendationsWithKakao(target.recommendations || [])
      .then(enriched => {
        setMessages(prev => prev.map((message, index) =>
          index === targetIndex ? { ...message, recommendations: enriched } : message
        ));
      })
      .catch(error => console.warn('Louis recommendation image enrichment failed:', error));
  }, [messages, user]);

  useEffect(() => {
    const source = louisTask?.status === 'completed' ? louisTask.source : '';
    if (!source || !user) return;
    const key = `${louisTask?.id || ''}:${source}`;
    if (notifiedSourceKeysRef.current.has(key)) return;
    notifiedSourceKeysRef.current.add(key);
    notifyOperatorsAiSource(source).catch(console.error);
  }, [louisTask, profile, user]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || !user || isLoading) return;

    const userMessage = prompt.trim();
    setPrompt('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    setLoadingStep('루이가 찾는 중이에요');

    const requestId = Date.now();
    activeRequestRef.current = requestId;

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      await startLouisRecommendationTask({ userId: user.uid, prompt: userMessage, history });
    } catch (error: any) {
      if (activeRequestRef.current !== requestId) return;
      if (error?.name === 'AbortError') {
        setMessages(prev => [...prev, { role: 'model', content: 'Search cancelled.' }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'model',
          content: error?.message || 'Louis recommendation task failed.',
        }]);
      }
    } finally {
      if (activeRequestRef.current === requestId) {
        setIsLoading(false);
        setLoadingStep('');
        abortControllerRef.current = null;
      }
    }
  };

  const handleStop = () => {
    activeRequestRef.current += 1;
    stopLouisTask();
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setLoadingStep('');
    setMessages(prev => [...prev, { role: 'model', content: '검색을 중단했습니다.' }]);
  };

  // ✅ 심층서치: 실제 이미지 + 상세 블로그 텍스트 동시 검색
  const handleDeepSearch = async (rec: RecommendationItem, recKey: string) => {
    // 이미 진행 중이면 토글(닫기)
    if (deepSearch[recKey]?.done) {
      setDeepSearch(prev => { const n = { ...prev }; delete n[recKey]; return n; });
      return;
    }
    if (deepSearch[recKey]?.loading) return;

    setDeepSearch(prev => ({ ...prev, [recKey]: { loading: true, blogText: '', images: [], error: '', done: false } }));

    try {
      // 블로그 + 이미지 병렬 검색
      const searchTarget = rec.locationName?.trim() || cleanPlaceKeyword(rec.title, rec.region);
      const [blogText, images] = await Promise.all([
        withTimeout(
          generateFullBlog(rec.title, rec.locationName || rec.region, undefined, { forceCloud: true }).catch(() => ''),
          45000,
          '',
        ),
        withTimeout(
          searchPlaceImages(searchTarget, rec.region).catch(() => [] as string[]),
          20000,
          [] as string[],
        ),
      ]);
      const usableImages = mergeUsableImages(images).slice(0, 6);

      setDeepSearch(prev => ({
        ...prev,
        [recKey]: { loading: false, blogText, images: usableImages, error: '', done: true },
      }));

      // 실제 이미지를 찾았으면 카드 이미지로도 자동 적용
      if (usableImages.length > 0 && !cardImages[recKey]) {
        setCardImages(prev => ({ ...prev, [recKey]: usableImages[0] }));
      }
      if (blogText) {
        setMessages(prev => [...prev, {
          role: 'model',
          content: `📌 ${rec.title} 심층 리서치 완료\n\n${blogText}`,
        }]);
      }
    } catch (err: any) {
      setDeepSearch(prev => ({
        ...prev,
        [recKey]: { loading: false, blogText: '', images: [], error: err.message || '검색 실패', done: true },
      }));
    }
  };

  // 게시 처리
  const handleUpload = async (rec: RecommendationItem, recKey: string) => {
    if (!user) return;
    if (uploadingRecs.has(recKey)) return;

    setUploadingRecs(prev => new Set([...prev, recKey]));

    try {
      const meta = CATEGORY_META[rec.category] || CATEGORY_META.hotplace;
      const isPlaceCategory = ['restaurants', 'hotplace', 'spots', 'accommodation'].includes(rec.category);

      let lat = 0, lng = 0;
      let resolvedMapUrl = rec.mapUrl || '';
      let resolvedLocationName = rec.locationName || '';
      let resolvedPlaceName = rec.title || '';
      let detectedRegion = rec.region || '';

      if (isPlaceCategory) {
      const locationSource = rec.locationName?.trim() || cleanPlaceKeyword(rec.title, rec.region);
      const parsedLocation = splitKoreanPlaceAddress(locationSource);
      const originalPlaceName = parsedLocation.placeName || locationSource || '';
      const originalAddress = parsedLocation.address || rec.locationName || '';
      const originalRegion = parsedLocation.region || detectKoreanRegion(locationSource, rec.region) || rec.region || '';

        const isDuplicate = originalAddress ? await checkDuplicateLocation(originalAddress) : false;
        if (isDuplicate) {
          alert(`'${originalAddress}'은 이미 커뮤니티에 등록되어 있습니다! (중복 방지)`);
          return;
        }

        resolvedPlaceName = originalPlaceName;
        resolvedLocationName = originalAddress;
        detectedRegion = originalRegion;

        if ((originalPlaceName || originalAddress)?.trim()) {
          let resolved = await resolveKoreanPlace(originalAddress || originalPlaceName);
          if (!resolved.lat || resolved.lat === 0) {
            if (originalPlaceName && originalPlaceName !== originalAddress) {
              const fallbackKeyword = `${originalPlaceName} ${originalRegion || ''}`.trim();
              const fallbackResolved = await resolveKoreanPlace(fallbackKeyword);
              if (fallbackResolved.lat && fallbackResolved.lat !== 0) {
                resolved = fallbackResolved;
              }
            }
          }
          lat = resolved.lat;
          lng = resolved.lng;
          resolvedMapUrl = resolved.kakaoMapUrl || resolvedMapUrl;
          resolvedPlaceName = resolved.name || resolvedPlaceName;
          resolvedLocationName = resolved.roadAddress || resolved.address || originalAddress;
        }
        detectedRegion = detectKoreanRegion(resolvedLocationName, resolvedLocationName, detectedRegion) || detectedRegion || '';
      }

      // ✅ 좌표가 없으면 지역 대표 좌표로 fallback (지도 누락 방지)
      if ((!lat || lat === 0) && detectedRegion) {
        try {
          const regionCenter = await withTimeout(
            getRegionCenter(detectedRegion).catch(() => null),
            6000,
            null,
          );
          if (regionCenter) {
            lat = regionCenter.lat;
            lng = regionCenter.lng;
          }
        } catch {
          // Ignore
        }
      }

      // 선택된 실제 사진 우선, 없으면 카테고리 기본 이미지. 지도 캡처/빈 지도는 저장하지 않음.
      // ✅ 이미지를 1장이 아닌 1~3장으로 확보하여 시각적 풍부함 제공
      let imageUrls = mergeUsableImages(
        cardImages[recKey],
        deepSearch[recKey]?.images,
        rec.imageUrls,
        rec.imageUrl
      ).slice(0, 3);

      // 💡 [바로 게시 개선] 만약 실제 이미지가 없다면, 바로 게시 버튼을 누를 때에도 백그라운드 이미지 검색을 실행하여 보완합니다.
      if (imageUrls.length === 0) {
        const imageSearchTarget = [resolvedPlaceName, resolvedLocationName].filter(Boolean).join(' ').trim();
        try {
          const foundImages = await withTimeout(
            searchPlaceImages(imageSearchTarget || rec.title, detectedRegion || rec.region).catch(() => [] as string[]),
            20000,
            [] as string[],
          );
          const usableImages = mergeUsableImages(foundImages).slice(0, 3);
          if (usableImages.length > 0) {
            imageUrls = usableImages;
            // UI에 반영해서 카드 이미지와 동기화
            setCardImages(prev => ({ ...prev, [recKey]: usableImages[0] }));
          }
        } catch (imgErr) {
          console.error('[handleUpload] Failed to search place image for quick posting:', imgErr);
        }
      }
      const imageUrl = imageUrls[0] || '';

      // 게시 본문: 심층서치 텍스트 우선, 없으면 AI 블로그 생성
      let postContent = (deepSearch[recKey]?.blogText || '').substring(0, 5000);
      if (isPlaceCategory && (!postContent || postContent.length < 700)) {
        postContent = await withTimeout(
          generateFullBlog(rec.title, [resolvedPlaceName, resolvedLocationName || detectedRegion].filter(Boolean).join(' '), undefined, { forceCloud: true }).catch(() => ''),
          60000,
          '',
        );
      }
      // ✅ fallback: briefDesc가 너무 짧으면 풍부한 기본 내용 생성
      if (!postContent || postContent.length < 200) {
        const baseDesc = rec.briefDesc || rec.content || '';
        const regionText = detectedRegion || rec.region || '';
        postContent = `${rec.title}${regionText ? `는 ${regionText}` : ''} 지역의 ${CATEGORY_META[rec.category]?.name || '추천 장소'}입니다.\n\n` +
          `${resolvedLocationName ? `📍 위치: ${resolvedLocationName}\n` : ''}` +
          `${baseDesc ? `\n${baseDesc}\n` : ''}` +
          `\n## 🌟 추천 포인트\n- ${rec.title}${regionText ? `는 ${regionText} 대표적인 장소로` : '는'} 많은 방문객들이 찾는 곳입니다.\n` +
          `- 사진 촬영과 분위기 감상에 특히 좋습니다.\n` +
          `- 주변에 다른 볼거리도 함께 즐길 수 있습니다.\n` +
          `\n## 💡 방문 팁\n- 방문 전 운영 시간과 휴무일을 확인하세요.\n` +
          `- 평일 아침이나 저녁 시간대가 덜 붐빕니다.\n` +
          `- 근처 맛집과 카페를 함께 둘러보세요!\n`;
      }
      const mapSearchTarget = [resolvedPlaceName, resolvedLocationName].filter(Boolean).join(' ').trim();

      // ✅ locationName이 비었으면 title이나 keyword라도 저장 (주소 누락 방지)
      const finalLocationName = resolvedLocationName.trim() || resolvedPlaceName.trim() || rec.title.trim() || '';

      await addDoc(collection(db, 'posts'), {
        channelId: meta.channel,
        authorId: user.uid,
        title: (rec.title || 'AI 추천').substring(0, 100),
        content: postContent,
        locationName: finalLocationName.substring(0, 100),
        region: detectedRegion,
        lat, lng,
        likesCount: 0,
        commentsCount: 0,
        isAiGenerated: true,
        imageUrl,
        imageUrls: imageUrls.slice(0, 3),
        mapUrl: resolvedMapUrl || (mapSearchTarget ? buildKakaoSearchUrl(mapSearchTarget) : ''),
        sourceLinks: Array.from(new Set([
          ...(Array.isArray(rec.sourceLinks) ? rec.sourceLinks : []),
          ...(mapSearchTarget ? [buildKakaoSearchUrl(mapSearchTarget), buildNaverSearchUrl(mapSearchTarget)] : []),
        ])).slice(0, 5),
        fashionItems: Array.isArray(rec.fashionItems) ? rec.fashionItems : [],
        modelImages: Array.isArray(rec.modelImages) ? rec.modelImages : [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      updateDoc(doc(db, 'users', user.uid), { xp: increment(50), updatedAt: serverTimestamp() }).catch(() => {});
      setUploadedRecs(prev => new Set([...prev, recKey]));
      playCoinSound();
      
      // 게시 완료 후 해당 채널로 즉시 이동
      navigate(`/channels/${meta.channel}`);
    } catch (err: any) {
      alert(`게시 실패: ${err.message}`);
    } finally {
      setUploadingRecs(prev => { const n = new Set(prev); n.delete(recKey); return n; });
    }
  };

  const QUICK_PROMPTS = [
    '홍대 근처 분위기 좋은 카페 추천',
    '제주도 커플 핫플 추천',
    '서울 인생샷 스팟 TOP 3',
    '부산 해운대 맛집 추천',
  ];

  const latestRecommendations = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      const recs = messages[idx].recommendations;
      if (messages[idx].role === 'model' && recs?.length) {
        return recs.map((rec, i) => ({ rec, recKey: `${idx}-${i}` }));
      }
    }
    return [];
  }, [messages]);

  const lastUserPrompt = useMemo(() => {
    for (let idx = messages.length - 1; idx >= 0; idx--) {
      if (messages[idx].role === 'user') return messages[idx].content;
    }
    return '';
  }, [messages]);

  const hasModelReplyWithoutCards = useMemo(() => {
    const lastModel = [...messages].reverse().find(m => m.role === 'model');
    return !!lastModel && (!lastModel.recommendations || lastModel.recommendations.length === 0);
  }, [messages]);

  return (
    <>
      {/* 라이트박스 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <img src={lightbox} alt="" className="w-full h-auto max-h-[80vh] object-contain rounded-xl" />
            <div className="flex justify-between mt-3">
              <a
                href={lightbox}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs bg-white/20 text-white px-4 py-2 rounded-full font-bold hover:bg-white/30"
                onClick={e => e.stopPropagation()}
              >
                🔗 원본 열기 (우클릭 → 저장 가능)
              </a>
              <button onClick={() => setLightbox(null)} className="text-xs bg-white/20 text-white px-4 py-2 rounded-full font-bold hover:bg-white/30">닫기 ✕</button>
            </div>
            <p className="text-center text-xs text-white/60 mt-2">이미지 위에서 우클릭 → "이미지를 다른 이름으로 저장" 또는 "이미지 주소 복사"</p>
          </div>
        </div>
      )}

      <div className="grid h-[calc(100dvh-5rem)] min-h-[320px] lg:h-[calc(100dvh-8rem)] lg:min-h-[560px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_430px] 2xl:grid-cols-[minmax(0,1fr)_480px] gap-3">
        <div className="flex flex-col min-h-0 bg-slate-50 border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
        {/* Messages */}
        {/* ✅ 헤더 ⋮ 메뉴 (기록 삭제 + 상태 통합) */}
        <div className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
            <span className="text-[10px] text-emerald-500 font-bold">온라인</span>
          </div>
          <div className="relative">
            <button
              onClick={() => setShowHeaderMenu(!showHeaderMenu)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>
            </button>
            {showHeaderMenu && (
              <div className="absolute right-0 mt-1 w-28 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { handleClearHistory(); setShowHeaderMenu(false); }}
                  className="w-full text-left px-3 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 transition-colors"
                >
                  🗑️ 기록 삭제
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50">
          {messages.map((msg, idx) => (
            <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`flex items-start gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} max-w-[95%] md:max-w-[82%]`}>
                {msg.role === 'model' && (
                  <img
                    src="/ai-butler.png?v=20260518"
                    alt=""
                    className="mt-1 w-7 h-7 rounded-full object-cover border border-indigo-100 bg-indigo-50 shrink-0"
                  />
                )}
                <div className={`p-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                }`}>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.role === 'model' ? linkifyText(cleanDisplayText(msg.content)) : linkifyText(msg.content)}</p>
                </div>
              </div>

              {/* 추천 카드 */}
              {msg.role === 'model' && msg.recommendations && msg.recommendations.length > 0 && (
                <div className="mt-3 space-y-4 w-full max-w-[95%] pl-2 lg:hidden">
                  {msg.recommendations.map((rec, i) => {
                    const recKey = `${idx}-${i}`;
                    const meta = CATEGORY_META[rec.category] || CATEGORY_META.hotplace;
                    const isUploaded = uploadedRecs.has(recKey);
                    const isUploading = uploadingRecs.has(recKey);
                    const ds = deepSearch[recKey];
                    // 이미지 우선순위: 사용자 선택 > 심층서치 > AI 원본
                    const cardImg = firstRealRecommendationImage(
                        cardImages[recKey],
                        ds?.images,
                        rec.imageUrls,
                        rec.imageUrl
                      );
                    const isDeepOpen = !!ds?.done;
                    const placeQuery = rec.locationName?.trim() || cleanPlaceKeyword(rec.title, rec.region);

                    return (
                      <div key={i} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-md">
                        {/* 메인 이미지 */}
                        {cardImg ? (
                          <div
                            className="relative h-40 overflow-hidden bg-slate-100 cursor-pointer group"
                            onClick={() => setLightbox(cardImg)}
                          >
                            <img
                              src={cardImg}
                              alt={rec.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                              crossOrigin="anonymous"
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <span className="opacity-0 group-hover:opacity-100 text-white text-xs font-bold bg-black/40 px-3 py-1.5 rounded-full transition-opacity">
                                🔍 크게 보기 / 우클릭 저장
                              </span>
                            </div>
                            {ds?.images?.length > 0 && (
                              <span className="absolute top-2 right-2 text-[10px] bg-emerald-500 text-white font-bold px-2 py-0.5 rounded-full">
                                ✅ 실제 사진
                              </span>
                            )}
                            {!ds?.images?.length && cardImg.includes('/category-fallbacks/') && (
                              <span className="absolute top-2 right-2 text-[10px] bg-slate-900/70 text-white font-bold px-2 py-0.5 rounded-full">
                                임시 이미지
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="h-20 bg-gradient-to-r from-indigo-50 to-rose-50 flex items-center justify-center text-5xl">
                            {meta.icon}
                          </div>
                        )}

                        <div className="p-4">
                          {/* 뱃지 */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${meta.color}`}>
                              {meta.icon} {meta.label}
                            </span>
                            {rec.region && (
                              <span className="text-[11px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">📍 {rec.region}</span>
                            )}
                          </div>

                          {/* 제목 */}
                          <h4 className="font-bold text-slate-900 text-base mb-2">{rec.title}</h4>

                          {/* 설명 */}
                          <p className="text-xs text-slate-600 leading-relaxed mb-3 line-clamp-3">
                            {rec.briefDesc || '추천 장소입니다.'}
                          </p>

                          {/* OOTD 패션 아이템 미리보기 */}
                          {rec.category === 'ootd' && Array.isArray(rec.fashionItems) && rec.fashionItems.length > 0 && (
                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
                              <p className="text-[11px] font-bold text-slate-500 mb-2">👔 추천 아이템</p>
                              <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                {rec.fashionItems.map((item: any, idx: number) => (
                                  <div key={idx} className="flex-shrink-0 w-16 group">
                                    <div className="w-16 h-16 bg-white border border-slate-200 rounded-lg overflow-hidden mb-1">
                                      {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xl bg-slate-100">👔</div>}
                                    </div>
                                    <p className="text-[9px] font-bold text-slate-800 truncate">{item.brand}</p>
                                    <p className="text-[9px] text-slate-500 truncate">{item.name}</p>
                                    {item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-[8px] text-indigo-500 hover:underline block truncate">구매 링크</a>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 주소 - 지도 버튼: 장소명+주소 조합으로 검색 (addr만 쓰면 업소 코어로 검색) */}
                          {rec.locationName && (
                            <button
                              onClick={() => window.open(
                                rec.mapUrl ||
                                `https://map.kakao.com/link/search/${encodeURIComponent(placeQuery)}`,
                                '_blank'
                              )}
                              className="flex items-center gap-1.5 text-xs bg-yellow-50 border border-yellow-200 text-yellow-800 font-bold px-3 py-1.5 rounded-full hover:bg-yellow-100 transition-colors mb-3"
                            >
                              🗺️ {rec.locationName}
                            </button>
                          )}

                          <div className="flex gap-2 flex-wrap mb-3">
                            <a
                              href={`https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(placeQuery)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] bg-green-50 text-green-700 border border-green-200 font-bold px-2.5 py-1.5 rounded-full hover:bg-green-100"
                            >
                              네이버 이미지 ↗
                            </a>
                            <a
                              href={`https://images.google.com/search?tbm=isch&q=${encodeURIComponent(placeQuery)}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2.5 py-1.5 rounded-full hover:bg-blue-100"
                            >
                              구글 이미지 ↗
                            </a>
                            {rec.sourceLinks?.slice(0, 2).map((url, linkIdx) => (
                              <a
                                key={`${recKey}-source-${linkIdx}`}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] bg-slate-50 text-slate-600 border border-slate-200 font-bold px-2.5 py-1.5 rounded-full hover:bg-slate-100"
                              >
                                리뷰 {linkIdx + 1} ↗
                              </a>
                            ))}
                          </div>

                          {/* ✅ 심층서치 결과 영역 */}
                          {ds?.loading && (
                            <div className="mb-3 bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                              <div className="flex items-center gap-2">
                                <div className="flex gap-1">
                                  {[0,1,2].map(d => (
                                    <span key={d} className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: `${d * 0.2}s` }} />
                                  ))}
                                </div>
                              <span className="text-xs font-bold text-indigo-600">네이버 이미지와 리뷰를 확인하는 중... 🔍</span>
                              </div>
                            </div>
                          )}

                          {ds?.done && (
                            <div className="mb-3 space-y-3">
                              {/* 실제 이미지 그리드 */}
                              {ds.images.length > 0 ? (
                                <div>
                                  <p className="text-[11px] font-bold text-slate-500 mb-2">
                                    ✅ 네이버 이미지 후보 {ds.images.length}장 발견 (클릭 선택 · 우클릭 저장)
                                  </p>
                                  <div className="grid grid-cols-3 gap-1.5">
                                    {ds.images.map((imgUrl, ii) => {
                                      const isSelected = cardImages[recKey] === imgUrl;
                                      return (
                                        <div
                                          key={ii}
                                          className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-all group ${isSelected ? 'border-rose-500 ring-2 ring-rose-300' : 'border-transparent hover:border-slate-400'}`}
                                          style={{ paddingTop: '66%' }}
                                        >
                                          <img
                                            src={imgUrl}
                                            alt=""
                                            className="absolute inset-0 w-full h-full object-cover"
                                            onError={e => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
                                            onClick={() => setCardImages(prev => ({ ...prev, [recKey]: imgUrl }))}
                                            onContextMenu={e => e.stopPropagation()} // 우클릭 허용
                                          />
                                          {/* 확대 버튼 */}
                                          <button
                                            className="absolute top-1 right-1 w-5 h-5 bg-black/50 text-white rounded-full text-[9px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                            onClick={e => { e.stopPropagation(); setLightbox(imgUrl); }}
                                          >🔍</button>
                                          {isSelected && (
                                            <div className="absolute inset-0 bg-rose-500/20 flex items-center justify-center">
                                              <span className="bg-rose-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">선택됨</span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <p className="text-[9px] text-slate-400 mt-1">검색 이미지 후보입니다. 게시 전 장소와 사진이 맞는지 한 번만 확인해주세요.</p>
                                </div>
                              ) : (
                                <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                                  <p className="text-xs text-amber-700 font-bold mb-1">📷 자동 사진 후보가 아직 없어요</p>
                                  <p className="text-[11px] text-amber-600">지도 화면을 사진처럼 넣지 않고, 아래 네이버 이미지에서 실제 사진만 골라 넣을 수 있게 했어요.</p>
                                </div>
                              )}

                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                                <p className="text-[11px] font-bold text-slate-600 mb-2">직접 고른 사진 적용</p>
                                <div className="flex gap-2 flex-wrap">
                                  {[
                                    { name: '구글 이미지', url: `https://images.google.com/search?tbm=isch&q=${encodeURIComponent(placeQuery)}`, color: 'bg-blue-500' },
                                    { name: '네이버 이미지', url: `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(placeQuery)}`, color: 'bg-green-500' },
                                    { name: '핀터레스트', url: `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(`${placeQuery} Korea`)}`, color: 'bg-red-500' },
                                  ].map(src => (
                                    <a key={src.name} href={src.url} target="_blank" rel="noopener noreferrer"
                                      className={`${src.color} text-white text-[10px] font-bold px-2.5 py-1.5 rounded-full hover:opacity-90`}>
                                      {src.name} ↗
                                    </a>
                                  ))}
                                </div>
                                <div className="flex gap-2 mt-2">
                                  <input
                                    type="text"
                                    placeholder="우클릭 → 이미지 주소 복사 후 붙여넣기..."
                                    className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        const val = (e.target as HTMLInputElement).value.trim();
                                        const imageUrl = imageFromUserLink(val);
                                        if (imageUrl) {
                                          setCardImages(prev => ({ ...prev, [recKey]: imageUrl }));
                                          (e.target as HTMLInputElement).value = '';
                                        }
                                      }
                                    }}
                                  />
                                  <span className="text-[9px] text-slate-400 self-center">Enter 적용</span>
                                </div>
                                <p className="text-[9px] text-slate-400 mt-1">다운로드한 파일은 게시글 작성/수정 화면에서 직접 업로드하는 방식이 가장 안정적입니다.</p>
                              </div>

                              {/* 블로그 텍스트 (요약) */}
                              {ds.blogText && (
                                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                                  <p className="text-[11px] font-bold text-slate-500 mb-1.5">📝 루이 상세 리뷰</p>
                                  <p className="text-xs text-slate-700 leading-relaxed line-clamp-6 whitespace-pre-wrap">
                                    {ds.blogText.slice(0, 400)}...
                                  </p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* ✅ 버튼 영역 → ⋮ 작업 메뉴로 통합 */}
                          <div data-action-menu>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setActiveActionMenu(activeActionMenu === recKey ? null : recKey); }}
                              className="w-full text-xs font-bold py-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5"
                            >
                              ⚡ 작업
                              <svg className={`w-3 h-3 transition-transform ${activeActionMenu === recKey ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                            </button>
                            {activeActionMenu === recKey && (
                              <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 overflow-hidden">
                                <button
                                  type="button"
                                  onClick={() => { handleDeepSearch(rec, recKey); setActiveActionMenu(null); }}
                                  disabled={ds?.loading}
                                  className="w-full text-left px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                                >
                                  {ds?.loading ? '⏳ 검색 중..' : isDeepOpen ? '🔍 결과 닫기' : '🔍 심층서치'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { handleUpload(rec, recKey); setActiveActionMenu(null); }}
                                  disabled={isUploaded || isUploading}
                                  className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors border-t border-slate-50 flex items-center gap-1.5 ${
                                    isUploaded ? 'text-emerald-600' : 'text-rose-500 hover:bg-rose-50'
                                  }`}
                                >
                                  {isUploaded ? '✅ 게시 완료' : isUploading ? '⏳ 게시 중..' : '📤 바로 게시'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start">
              <div className="bg-white border border-indigo-100 p-4 rounded-2xl rounded-tl-sm shadow-md flex flex-col gap-3 min-w-[260px]">
                <div className="flex items-center space-x-2">
                  <div className="flex space-x-1">
                    {[0, 1, 2].map(d => (
                      <span key={d} className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: `${d * 0.2}s` }} />
                    ))}
                  </div>
                  <span className="text-xs font-bold text-indigo-600">루이가 찾는 중..</span>
                </div>
                <div className="bg-indigo-50/60 p-3 rounded-xl border border-indigo-100 flex items-center gap-3">
                  <img src="/ai-butler.png?v=20260518" alt="루이" className="w-9 h-9 rounded-full object-cover border border-indigo-100 bg-white shadow-sm" />
                  <div className="min-w-0">
                    <p className="text-xs text-indigo-800 font-medium leading-tight">{loadingStep}</p>
                  </div>
                </div>
                <button onClick={handleStop} className="text-[10px] text-slate-400 hover:text-rose-500 font-bold self-end transition-colors">
                  ⏹ 중단하기
                </button>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* 빠른 프롬프트 */}
        {messages.length <= 1 && (
          <div className="bg-white border-t border-slate-100 px-4 py-2 flex gap-2 overflow-x-auto custom-scrollbar">
            {QUICK_PROMPTS.map(qp => (
              <button
                key={qp}
                onClick={() => setPrompt(qp)}
                className="text-[11px] whitespace-nowrap bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-full font-bold hover:bg-indigo-100 transition-colors shrink-0"
              >
                {qp}
              </button>
            ))}
          </div>
        )}

        {/* 입력창 */}
        <div className="bg-white p-3 border-t border-slate-100">
          <form onSubmit={handleSend} className="flex space-x-2">
            <input
              type="text"
              className="flex-1 bg-slate-50 border border-slate-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 transition-all"
              placeholder="☕ 루이에게 물어보세요"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              disabled={isLoading}
            />
            {isLoading ? (
              <button type="button" onClick={handleStop}
                className="bg-rose-500 hover:bg-rose-600 text-white w-10 h-10 rounded-full shadow-md flex items-center justify-center transition-colors shrink-0">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="5" width="10" height="10" /></svg>
              </button>
            ) : (
              <button type="submit" disabled={!prompt.trim()}
                className={`${prompt.trim() ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-200'} text-white w-10 h-10 rounded-full shadow-md flex items-center justify-center transition-all shrink-0`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
              </button>
            )}
          </form>
        </div>
        </div>

        <aside className="hidden lg:flex min-h-0 flex-col rounded-2xl border border-slate-100 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <h3 className="font-black text-slate-900">검색 결과 리스트</h3>
            <p className="mt-1 text-xs text-slate-500">후보는 여기서 고르고, 심층 리서치 완료본은 왼쪽 채팅창에 쌓입니다.</p>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3 bg-slate-50">
            {latestRecommendations.length === 0 ? (
              <div className="h-full min-h-80 rounded-2xl border border-dashed border-slate-200 bg-white flex flex-col items-center justify-center text-center p-6">
                <span className="text-4xl mb-3">🔎</span>
                <p className="text-sm font-bold text-slate-600">
                  {hasModelReplyWithoutCards ? '추천 카드가 비어 있어요.' : '검색 결과가 여기에 표시됩니다.'}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {hasModelReplyWithoutCards ? '지역과 카테고리를 넣어 다시 검색하면 fallback 후보를 바로 구성합니다.' : '왼쪽에서 장소를 물어보면 후보 리스트가 정리돼요.'}
                </p>
                {hasModelReplyWithoutCards && lastUserPrompt && (
                  <button
                    type="button"
                    onClick={() => setPrompt(lastUserPrompt)}
                    className="mt-4 px-3 py-2 rounded-xl bg-indigo-50 text-indigo-600 text-xs font-bold border border-indigo-100 hover:bg-indigo-100"
                  >
                    같은 질문 다시 넣기
                  </button>
                )}
              </div>
            ) : latestRecommendations.map(({ rec, recKey }) => {
              const meta = CATEGORY_META[rec.category] || CATEGORY_META.hotplace;
              const ds = deepSearch[recKey];
              const isUploaded = uploadedRecs.has(recKey);
              const isUploading = uploadingRecs.has(recKey);
              const cardImg = firstRealRecommendationImage(cardImages[recKey], ds?.images, rec.imageUrls, rec.imageUrl);
              const placeQuery = rec.locationName?.trim() || cleanPlaceKeyword(rec.title, rec.region);

              return (
                <div key={recKey} className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                  {cardImg ? (
                    <button type="button" onClick={() => setLightbox(cardImg)} className="block w-full h-32 bg-slate-100 overflow-hidden">
                      <img src={cardImg} alt={rec.title} className="h-full w-full object-cover hover:scale-105 transition-transform duration-300" />
                    </button>
                  ) : (
                    <div className="h-20 bg-gradient-to-r from-indigo-50 to-rose-50 flex items-center justify-center text-4xl">{meta.icon}</div>
                  )}

                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${meta.color}`}>{meta.icon} {meta.label}</span>
                      {rec.region && <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{rec.region}</span>}
                    </div>

                    <h4 className="font-black text-sm text-slate-900 leading-tight">{rec.title}</h4>
                    <p className="mt-1 text-xs text-slate-500 line-clamp-2">{rec.briefDesc || '추천 장소입니다.'}</p>
                    {rec.locationName && (
                      <p className="mt-1.5 text-[10px] text-indigo-600 font-bold bg-indigo-50/50 border border-indigo-100 px-1.5 py-0.5 rounded inline-flex items-center gap-1 w-fit max-w-full truncate">
                        📍 {rec.locationName}
                      </p>
                    )}

                    {/* OOTD 패션 아이템 미리보기 (데스크톱) */}
                    {rec.category === 'ootd' && Array.isArray(rec.fashionItems) && rec.fashionItems.length > 0 && (
                      <div className="mt-2 bg-slate-50 border border-slate-200 rounded-xl p-2">
                        <p className="text-[10px] font-bold text-slate-500 mb-1.5">👔 추천 아이템</p>
                        <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
                          {rec.fashionItems.map((item: any, idx: number) => (
                            <div key={idx} className="flex-shrink-0 w-12 group">
                              <div className="w-12 h-12 bg-white border border-slate-200 rounded-md overflow-hidden mb-0.5">
                                {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-sm bg-slate-100">👔</div>}
                              </div>
                              <p className="text-[8px] font-bold text-slate-800 truncate">{item.brand}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex gap-1.5 flex-wrap">
                      <a href={`https://images.google.com/search?tbm=isch&q=${encodeURIComponent(placeQuery)}`} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 font-bold px-2 py-1 rounded-full">구글 이미지</a>
                      <a href={`https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(placeQuery)}`} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-green-50 text-green-700 border border-green-200 font-bold px-2 py-1 rounded-full">네이버 이미지</a>
                      {(rec.mapUrl || rec.locationName) && (
                        <a
                          href={rec.mapUrl || `https://map.kakao.com/link/search/${encodeURIComponent(placeQuery)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] bg-yellow-50 text-yellow-700 border border-yellow-200 font-bold px-2 py-1 rounded-full"
                        >
                          지도
                        </a>
                      )}
                    </div>

                    <input
                      type="text"
                      placeholder="이미지 주소 붙여넣기 후 Enter"
                      className="mt-2 w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val.startsWith('http')) {
                            setCardImages(prev => ({ ...prev, [recKey]: imageFromUserLink(val) }));
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                    />

                    {/* ✅ 사이드바 버튼 영역 → ⋮ 작업 메뉴로 통합 */}
                    <div className="mt-2" data-action-menu>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setActiveActionMenu(activeActionMenu === recKey ? null : recKey); }}
                        className="w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center justify-center gap-1.5"
                      >
                        ⚡ 작업
                        <svg className={`w-3 h-3 transition-transform ${activeActionMenu === recKey ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {activeActionMenu === recKey && (
                        <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => { handleDeepSearch(rec, recKey); setActiveActionMenu(null); }}
                            disabled={ds?.loading}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-50"
                          >
                            {ds?.loading ? '⏳ 리서치 중...' : ds?.done ? '🔍 결과 닫기' : '🔍 심층 리서치'}
                          </button>
                          <button
                            type="button"
                            onClick={() => { handleUpload(rec, recKey); setActiveActionMenu(null); }}
                            disabled={isUploaded || isUploading}
                            className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors border-t border-slate-50 ${
                              isUploaded ? 'text-emerald-600' : 'text-rose-500 hover:bg-rose-50'
                            }`}
                          >
                            {isUploaded ? '✅ 게시 완료' : isUploading ? '⏳ 게시 중..' : '📤 바로 게시'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </>
  );
}
