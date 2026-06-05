import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';
import { generateRecommendations, type RecommendationItem } from './gemini';
import {
  buildKakaoSearchUrl,
  buildNaverSearchUrl,
  detectKoreanRegion,
  getCategoryFallbackImage,
  resolveKoreanPlace,
  searchNaverPlaceImages,
  splitKoreanPlaceAddress,
  usableImageUrl,
} from './placeTools';

export type LouisTaskStatus = 'idle' | 'searching' | 'parsing' | 'completed' | 'failed' | 'cancelled';

export interface LouisTaskState {
  id: string | null;
  userId: string | null;
  prompt: string;
  status: LouisTaskStatus;
  step: string;
  source: string;
  startedAt: number;
  completedAt?: number;
  error?: string;
  result?: {
    text: string;
    recommendations: RecommendationItem[];
    source?: string;
  };
}

type ChatMessage = {
  role: 'user' | 'model';
  content: string;
  recommendations?: RecommendationItem[];
  source?: string;
};

const INITIAL_STATE: LouisTaskState = {
  id: null,
  userId: null,
  prompt: '',
  status: 'idle',
  step: '',
  source: '',
  startedAt: 0,
};

let state: LouisTaskState = { ...INITIAL_STATE };
let controller: AbortController | null = null;
const listeners = new Set<(next: LouisTaskState) => void>();

const isActive = (status: LouisTaskStatus) => status === 'searching' || status === 'parsing';
const PLACE_CATEGORIES = new Set(['restaurants', 'hotplace', 'spots', 'accommodation']);

function emit(patch: Partial<LouisTaskState>) {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener({ ...state }));
}

export function getLouisTaskState() {
  return { ...state };
}

export function subscribeLouisTask(listener: (next: LouisTaskState) => void) {
  listeners.add(listener);
  listener({ ...state });
  return () => listeners.delete(listener);
}

function notifyBrowser(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  new Notification(title, { body, icon: '/ai-butler.png?v=20260518' });
}

async function notifyInApp(userId: string, message: string, type = 'louis_complete') {
  await addDoc(collection(db, 'notifications'), {
    userId,
    type,
    actorId: userId,
    actorName: 'AI 루이',
    postTitle: 'AI 루이',
    message,
    read: false,
    createdAt: serverTimestamp(),
  }).catch(console.error);
}

async function appendSessionMessages(userId: string, userPrompt: string, modelMessage: ChatMessage) {
  const ref = doc(db, 'aiSessions', userId);
  const snap = await getDoc(ref);
  const existing = Array.isArray(snap.data()?.messages)
    ? (snap.data()?.messages as ChatMessage[])
    : [];

  const next = [...existing];
  const hasRecentPrompt = next.slice(-6).some(message => message.role === 'user' && message.content === userPrompt);
  if (!hasRecentPrompt) {
    next.push({ role: 'user', content: userPrompt });
  }

  const existingModelIndex = next.slice(-4).findIndex(message =>
    message.role === 'model' &&
    message.content === modelMessage.content &&
    message.source === modelMessage.source
  );
  if (existingModelIndex !== -1) {
    next[next.length - 4 + existingModelIndex] = modelMessage;
  } else {
    next.push(modelMessage);
  }

  await setDoc(ref, {
    userId,
    messages: JSON.parse(JSON.stringify(next.slice(-80))),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

function mergeUsableImages(...groups: Array<string | string[] | undefined | null>) {
  const seen = new Set<string>();
  const result: string[] = [];
  groups.forEach(group => {
    const candidates = Array.isArray(group) ? group : group ? [group] : [];
    candidates.forEach(candidate => {
      const usable = usableImageUrl(candidate);
      if (usable && !seen.has(usable)) {
        seen.add(usable);
        result.push(usable);
      }
    });
  });
  return result;
}

async function enrichRecommendation(rec: RecommendationItem, signal?: AbortSignal): Promise<RecommendationItem> {
  if (!PLACE_CATEGORIES.has(rec.category)) {
    return rec;
  }

  const parsed = splitKoreanPlaceAddress(rec.locationName || rec.title, rec.region);
  const placeName = parsed.placeName || rec.title;
  const addressHint = parsed.address || '';
  const region = parsed.region || detectKoreanRegion(rec.region, rec.title, rec.locationName) || rec.region;
  const keyword = [placeName, addressHint || region].filter(Boolean).join(' ').trim();
  const fallbackLinks = Array.from(new Set([
    ...(Array.isArray(rec.sourceLinks) ? rec.sourceLinks : []),
    buildKakaoSearchUrl(keyword || rec.title),
  ].filter(Boolean)));

  const existingImages = mergeUsableImages(rec.imageUrls, rec.imageUrl);
  const searchedImages = existingImages.length >= 2
    ? []
    : await searchNaverPlaceImages(keyword || rec.title, signal).catch(() => []);

  try {
    const resolved = keyword ? await resolveKoreanPlace(keyword) : null;
    const verifiedAddress = resolved?.roadAddress || resolved?.address || addressHint;
    const verifiedName = resolved?.name || placeName;
    const verifiedRegion = detectKoreanRegion(verifiedAddress, region) || region;
    const verifiedKeyword = [verifiedName, verifiedAddress || verifiedRegion].filter(Boolean).join(' ').trim();
    const verifiedImages = existingImages.length + searchedImages.length >= 2
      ? []
      : await searchNaverPlaceImages(verifiedKeyword || keyword || rec.title, signal).catch(() => []);
    const finalImages = mergeUsableImages(existingImages, searchedImages, verifiedImages).slice(0, 6);
    const fallback = getCategoryFallbackImage(rec.category);

    return {
      ...rec,
      region: verifiedRegion || region || rec.region,
      locationName: verifiedAddress || addressHint || '',
      mapUrl: resolved?.kakaoMapUrl || rec.mapUrl || buildKakaoSearchUrl(verifiedKeyword || keyword || rec.title),
      sourceLinks: Array.from(new Set([
        resolved?.naverMapUrl,
        resolved?.kakaoMapUrl,
        ...fallbackLinks,
      ].filter(Boolean) as string[])).slice(0, 6),
      imageUrls: finalImages.length ? finalImages : (fallback ? [fallback] : rec.imageUrls),
      imageUrl: finalImages[0] || fallback || rec.imageUrl || '',
    };
  } catch {
    const finalImages = mergeUsableImages(existingImages, searchedImages).slice(0, 6);
    const fallback = getCategoryFallbackImage(rec.category);
    return {
      ...rec,
      region: region || rec.region,
      locationName: addressHint || '',
      mapUrl: rec.mapUrl || buildKakaoSearchUrl(keyword || rec.title),
      sourceLinks: fallbackLinks.slice(0, 6),
      imageUrls: finalImages.length ? finalImages : (fallback ? [fallback] : rec.imageUrls),
      imageUrl: finalImages[0] || fallback || rec.imageUrl || '',
    };
  }
}

async function enrichRecommendations(recommendations: RecommendationItem[], signal?: AbortSignal) {
  return Promise.all(recommendations.map(rec => enrichRecommendation(rec, signal)));
}

export async function startLouisRecommendationTask(params: {
  userId: string;
  prompt: string;
  history: Array<{ role: string; content: string }>;
}) {
  if (isActive(state.status)) {
    throw new Error('이미 루이가 작업 중입니다.');
  }

  const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  controller = new AbortController();
  const signal = controller.signal;

  emit({
    id: taskId,
    userId: params.userId,
    prompt: params.prompt,
    status: 'searching',
    step: '루이가 실제 후보를 찾는 중이에요',
    source: '루이 추천',
    startedAt: Date.now(),
    completedAt: undefined,
    error: undefined,
    result: undefined,
  });

  try {
    const result = await generateRecommendations(params.prompt, params.history, signal, {
      forceCloud: true,
      onStep: (step) => emit({
        status: step.includes('변환') || step.includes('정리') ? 'parsing' : 'searching',
        step,
      }),
    });

    // ✅ 1단계: 텍스트 결과 즉시 emit + 저장 (이미지 없이도 바로 보여줌)
    const rawMessage: ChatMessage = {
      role: 'model',
      content: result.text || '추천 결과입니다.',
      recommendations: result.recommendations,
      source: result.source || '루이 추천',
    };
    emit({
      status: 'completed',
      step: `추천 후보 ${result.recommendations?.length || 0}개 정리 완료`,
      source: result.source || '루이 추천',
      result,
      completedAt: Date.now(),
    });
    await appendSessionMessages(params.userId, params.prompt, rawMessage);

    // ✅ 2단계: 백그라운드에서 이미지/지도 보강 (사용자는 이미 텍스트를 보고 있음)
    emit({
      status: 'parsing',
      step: '네이버 이미지와 지도 주소를 검증하는 중이에요',
    });
    const recommendations = await enrichRecommendations(result.recommendations || [], signal);
    const enrichedResult = { ...result, recommendations };
    const enrichedMessage: ChatMessage = {
      ...rawMessage,
      recommendations,
      source: enrichedResult.source || '루이 추천',
    };

    emit({
      status: 'completed',
      step: `추천 후보 ${recommendations.length}개 정리 완료`,
      source: enrichedResult.source || '루이 추천',
      result: enrichedResult,
      completedAt: Date.now(),
    });
    await appendSessionMessages(params.userId, params.prompt, enrichedMessage);

    const message = `루이 추천 완료: ${recommendations.length}개 후보를 정리했습니다.`;
    await notifyInApp(params.userId, message);
    notifyBrowser('루이 추천 완료', `${recommendations.length}개 후보를 정리했습니다.`);
    return enrichedResult;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      emit({
        status: 'cancelled',
        step: '작업을 중단했습니다.',
        completedAt: Date.now(),
      });
      await notifyInApp(params.userId, '루이 검색이 중단되었습니다.', 'louis_cancelled');
      return null;
    }

    const errorMessage = error?.message || '알 수 없는 오류';
    emit({
      status: 'failed',
      step: '검색 작업이 실패했습니다.',
      error: errorMessage,
      completedAt: Date.now(),
    });
    await notifyInApp(params.userId, `루이 추천 실패: ${errorMessage}`, 'louis_failed');
    notifyBrowser('루이 추천 실패', errorMessage);
    throw error;
  } finally {
    controller = null;
  }
}

export function stopLouisTask() {
  controller?.abort();
  emit({
    status: 'cancelled',
    step: '작업을 중단했습니다.',
    completedAt: Date.now(),
  });
}
