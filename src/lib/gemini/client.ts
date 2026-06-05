import { callLocalTextAI, shouldTryLocalText, type LocalAiSettings } from '../localAi';

// Gemini API Core Client
// ✅ 2026-05-20 업데이트: Gemini 3.5 GA 반영
// 카테고리별 용도에 맞춰 고/중/저 티어 모델을 자동 선택하는 구조

// ─── 모델 티어 정의 ───
// HIGH:   복잡한 추론, 웹툰 기획, 장문 생성 등
// MEDIUM: 일반 게시물, 추천, 블로그 등
// LOW:    간단한 댓글 응답, 짧은 답변 등

export type ModelTier = 'high' | 'medium' | 'low' | 'image';

const TIER_MODELS: Record<ModelTier, string[]> = {
  image: [
    'gemini-2.5-flash-image',      // 이미지 생성 전용 (Nano Banana)
    'gemini-2.5-flash',            // 이미지 생성 불가 시 텍스트 폴백
  ],
  high: [
    'gemini-2.5-pro',              // 복잡한 추론, 웹툰 기획
    'gemini-2.5-flash',            // 비용 절감 폴백
  ],
  medium: [
    'gemini-2.5-flash',            // 일반 게시물, 추천, 블로그
    'gemini-2.5-flash-lite',       // 안정 폴백
  ],
  low: [
    'gemini-2.5-flash-lite',       // 짧은 답변/댓글
  ],
};

// 기본 폴백 (티어 미지정 시)
const DEFAULT_MODELS = TIER_MODELS.medium;

/**
 * 카테고리(channelId)와 사용성(콘텍스트 부하 등)에 따라 적절한 모델 티어를 동적으로 결정하는 함수
 * @param channelId - 게시판 카테고리 아이디
 * @param hasHeavyContext - 링크, 이미지, 힌트 등 다량의 컨텍스트가 존재해 높은 추론이 필요한지 여부
 */
export function getTierForCategory(channelId: string, hasHeavyContext = false): ModelTier {
  // 패션/OOTD: 이미지 매칭이 중요하므로 heavy 시 medium, 평소 low
  if (channelId === 'ootd') {
    return hasHeavyContext ? 'medium' : 'low';
  }

  if (channelId === 'counseling') {
    return hasHeavyContext ? 'medium' : 'low';
  }

  // 맛집 추천, 핫플레이스, 인생샷 스팟, 숙소 리뷰 등은 지도 그라운딩 및 실명 장소 매칭 필요
  if (
    channelId === 'restaurants' ||
    channelId === 'hotplace' ||
    channelId === 'spots' ||
    channelId === 'accommodation'
  ) {
    return hasHeavyContext ? 'high' : 'medium';
  }

  // 웹툰 기획은 복잡한 추론 필요
  if (channelId === 'webtoon') {
    return 'high';
  }

  if (channelId === 'notice' || channelId === 'meetings') {
    return hasHeavyContext ? 'medium' : 'low';
  }

  // 자유게시판(freeboard) 및 기타 잡담 채널
  return hasHeavyContext ? 'medium' : 'low';
}

const KEYS = (import.meta.env.VITE_GEMINI_API_KEYS || '')
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);


let keyIndex = 0;
const quotaCooldowns = new Map<string, number>();
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;

class GeminiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'GeminiRequestError';
    this.status = status;
  }
}

function summarizeGeminiError(status: number, body: string) {
  if (status === 429) return 'Gemini 사용량 한도에 도달했습니다.';
  if (status === 400 && /thinkingConfig|thinkingLevel|thinkingBudget/i.test(body)) {
    return '모델 사고 설정을 지원하지 않습니다.';
  }
  if (status === 404) return 'Gemini 모델을 사용할 수 없습니다.';
  if (status >= 500) return 'Gemini 서버가 일시적으로 불안정합니다.';
  return `Gemini 호출 실패(HTTP ${status})`;
}

function keyLabel(index: number) {
  return `key-${index + 1}`;
}

function isCoolingDown(key: string) {
  const until = quotaCooldowns.get(key) || 0;
  if (until <= Date.now()) {
    quotaCooldowns.delete(key);
    return false;
  }
  return true;
}

function markQuotaCooldown(key: string) {
  quotaCooldowns.set(key, Date.now() + QUOTA_COOLDOWN_MS);
}

// 환경 변수 키를 우선하여 배열 구성
function getActiveKeys(): string[] {
  const activeKeys: string[] = [];
  
  // 1. Node 환경 (서버 사이드) GEMINI_API_KEY 조회
  if (typeof process !== 'undefined' && process.env && process.env.GEMINI_API_KEY) {
    activeKeys.push(process.env.GEMINI_API_KEY);
  }
  
  // 2. Vite 클라이언트 환경 VITE_GEMINI_API_KEY 조회
  const importMetaEnv = (import.meta as any).env;
  if (importMetaEnv && importMetaEnv.VITE_GEMINI_API_KEY) {
    activeKeys.push(importMetaEnv.VITE_GEMINI_API_KEY);
  }
  
  // 3. window 전역 __env__ 설정 조회
  if (typeof window !== 'undefined' && (window as any).__env__?.VITE_GEMINI_API_KEY) {
    activeKeys.push((window as any).__env__.VITE_GEMINI_API_KEY);
  }
  
  // 중복 제거 후 예비 키 순으로 붙임
  const uniqueActive = Array.from(new Set(activeKeys)).filter(key =>
    Boolean(key) &&
    key !== 'MY_GEMINI_API_KEY' &&
    !/^your[_-]?gemini[_-]?api[_-]?key$/i.test(key)
  );
  return [...uniqueActive, ...KEYS];
}

async function callGemini(
  modelName: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 25000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new GeminiRequestError(response.status, summarizeGeminiError(response.status, errText));
    }
    return response.json();
  } catch (error: any) {
    if (timedOut) throw new GeminiRequestError(408, 'Gemini 응답 시간이 초과되었습니다.');
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Gemini API 호출 (라운드로빈 + 자동 폴백)
 * @param body - API 요청 바디
 * @param signal - AbortSignal (선택)
 * @param tier - 모델 티어 ('high' | 'medium' | 'low') — 카테고리/용도에 따라 자동 선택
 */
export async function retryGemini(
  body: Record<string, unknown>,
  signal?: AbortSignal,
  tier?: ModelTier,
  options: { skipLocal?: boolean; forceLocal?: boolean; localModel?: string; localSettings?: LocalAiSettings } = {},
): Promise<any> {
  if (options.forceLocal || (!options.skipLocal && shouldTryLocalText(body as Record<string, any>))) {
    try {
      return await callLocalTextAI(body as Record<string, any>, signal, { model: options.localModel, settings: options.localSettings });
    } catch (error) {
      if (options.forceLocal) throw error;
      console.warn('Local AI unavailable, falling back to Gemini:', error);
    }
  }

  const models = tier ? TIER_MODELS[tier] : DEFAULT_MODELS;
  const errors: string[] = [];
  const currentKeys = getActiveKeys();

  for (const model of models) {
    for (let ki = 0; ki < currentKeys.length; ki++) {
      const activeKeyIndex = (keyIndex + ki) % currentKeys.length;
      const key = currentKeys[activeKeyIndex];
      if (isCoolingDown(key)) {
        errors.push(`[${model}/${keyLabel(activeKeyIndex)}] 사용량 한도 cooldown 중`);
        continue;
      }

      // 모델별 thinkingConfig 구성
      const reqBody = { ...body };
      if (!reqBody.generationConfig) {
        reqBody.generationConfig = {};
      } else {
        reqBody.generationConfig = { ...reqBody.generationConfig as object };
      }

      const isGemini3 = model.includes('gemini-3.5') || model.includes('gemini-3.1');
      const isGemini25 = model.includes('gemini-2.5');
      const isImageModel = model.includes('-image');

      // 이미지 생성 모델은 thinkingConfig 대신 responseModalities 설정
      if (isImageModel) {
        (reqBody.generationConfig as any).responseModalities = ['Text', 'Image'];
      } else if (isGemini3) {
        const thinkingLevelMap: Record<ModelTier, string> = {
          high: 'high',
          medium: 'medium',
          low: 'low',
          image: 'medium',
        };
        const level = thinkingLevelMap[tier || 'medium'];
        (reqBody.generationConfig as any).thinkingConfig = {
          thinkingLevel: level,
        };
      } else if (isGemini25) {
        const thinkingBudgetMap: Record<ModelTier, number> = {
          high: 4096,
          medium: 1024,
          low: 0,
          image: 1024,
        };
        const budget = thinkingBudgetMap[tier || 'medium'];
        (reqBody.generationConfig as any).thinkingConfig = {
          thinkingBudget: budget,
        };
      }

      try {
        // 1. thinkingConfig를 적용하여 최적의 성능/비용 효율로 시도
        const result = await callGemini(model, key, reqBody, signal);
        keyIndex = (activeKeyIndex + 1) % currentKeys.length;
        result.__dongjeonAiSource = { type: 'gemini', model, key: keyLabel(activeKeyIndex) };
        return result;
      } catch (e: any) {
        if (e?.name === 'AbortError') throw e;
        if (e?.status === 429) {
          markQuotaCooldown(key);
          errors.push(`[${model}/${keyLabel(activeKeyIndex)}] ${e.message}`);
          continue;
        }

        // 2. thinkingConfig 관련 API 400 에러 등이 발생할 수 있으므로, 미적용된 순수 바디로 즉시 폴백
        try {
          const fallbackBody = { ...body };
          if (fallbackBody.generationConfig) {
            fallbackBody.generationConfig = { ...fallbackBody.generationConfig as object };
            delete (fallbackBody.generationConfig as any).thinkingConfig;
          }
          const result = await callGemini(model, key, fallbackBody, signal);
          keyIndex = (activeKeyIndex + 1) % currentKeys.length;
          result.__dongjeonAiSource = { type: 'gemini', model, key: keyLabel(activeKeyIndex), fallback: true };
          return result;
        } catch (fallbackErr: any) {
          if (fallbackErr?.name === 'AbortError') throw fallbackErr;
          if (fallbackErr?.status === 429) markQuotaCooldown(key);
          errors.push(`[${model}/${keyLabel(activeKeyIndex)}] ${e.message} -> ${fallbackErr.message}`);
          await new Promise(r => setTimeout(r, 400));
        }
      }
    }
  }
  throw new Error(`Gemini 호출이 잠시 막혔습니다. ${errors.slice(0, 3).join(' / ')}`);
}

export function extractText(data: any): string {
  return data?.candidates?.[0]?.content?.parts
    ?.map((p: any) => p.text || '')
    .join('') || '';
}
