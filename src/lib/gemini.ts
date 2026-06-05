// ✅ Gemini API Facade (Backward Compatibility)
// 원래 단일 파일에 뭉쳐 있던 AI 로직을 관심사별로 분리하여 유지보수성을 극대화했습니다.

export { retryGemini } from './gemini/client';
export type { ModelTier } from './gemini/client';
export { fetchLinkInfo } from './gemini/urlParser';
export type { FetchedLinkInfo } from './gemini/urlParser';
export {
  generatePostDraft,
  generateRecommendations,
  generateReply,
  generateFullBlog,
  generateDailyCategoryPost,
} from './gemini/prompts';
export type {
  PostDraftInput,
  PostDraftResult,
  RecommendationItem,
} from './gemini/prompts';

// ─── 하위 호환성용 헬퍼 및 함수 정의 ───

// 1. generateChatReply (generateReply의 alias)
export async function generateChatReply(
  postTitle: string,
  postContent: string,
  userComment: string,
  signal?: AbortSignal,
  options?: {
    isOperator?: boolean;
    forceLocal?: boolean;
    localModel?: string;
    skipLocal?: boolean;
  },
): Promise<string | null> {
  const { generateReply } = await import('./gemini/prompts');
  return generateReply(postTitle, postContent, userComment, signal, options);
}

// 2. searchPlaceImages (placeTools의 네이버 이미지 검색을 비동기로 매핑)
export async function searchPlaceImages(
  query: string,
  _region = '',
): Promise<string[]> {
  const { searchNaverPlaceImages } = await import('./placeTools');
  return searchNaverPlaceImages(query).catch(() => []);
}
