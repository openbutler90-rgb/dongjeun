import { addDoc, collection, doc, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { generateDailyCategoryPost, searchPlaceImages, fetchLinkInfo } from './gemini';
import { resolveKoreanPlace } from './placeTools';
import type { UserProfile } from '../stores/authStore';

export const DAILY_AI_CATEGORIES = [
  {
    channelId: 'freeboard',
    label: '자유게시판 (유튜브 1)',
    topic: '최신/인기 유튜브 쇼츠나 재미있는 영상 링크 하나를 포함한 흥미로운 이야기. (이전과 중복되지 않는 새로운 주제와 영상)',
  },
  {
    channelId: 'freeboard',
    label: '자유게시판 (유튜브 2)',
    topic: '최신/인기 유튜브 쇼츠나 재미있는 영상 링크 하나를 포함한 흥미로운 이야기. (이전과 중복되지 않는 새로운 주제와 영상)',
  },
  {
    channelId: 'freeboard',
    label: '자유게시판 (유머/이슈)',
    topic: '오늘의 유머, 커뮤니티 인기 썰, 또는 흥미로운 텍스트/이미지 위주 이슈 하나. (영상 없음)',
  },
  {
    channelId: 'restaurants',
    label: '전국 맛집',
    topic: '오늘 소개하기 좋은 전국 실제 맛집 한 곳. 메뉴, 방문 포인트, 같이 보면 좋은 정보 포함.',
  },
  {
    channelId: 'accommodation',
    label: '숙소',
    topic: '오늘 소개하기 좋은 국내 숙소 한 곳. 위치, 장점, 예약 전 확인할 점 포함.',
  },
  {
    channelId: 'hotplace',
    label: '핫플레이스',
    topic: '오늘 가볼 만한 국내 핫플레이스 한 곳. 분위기, 사진 포인트, 주변 동선 포함.',
  },
  {
    channelId: 'ootd',
    label: '남성 패션 매거진',
    topic: '★ 남성 전용 패션 ★ 오늘의 남자 코디: 무신사 스냅(https://www.musinsa.com/snap/main/recommend?gf=M)에서 인기 있는 스타일을 참고하여, 실제 판매 중인 상품들로 풀 코디(상의, 하의, 신발 등)를 제안해주세요. 절대로 AI 이미지를 생성하지 말고, 실제 존재하는 브랜드명, 정확한 가격, 그리고 유효한 구매처 도메인 링크를 마크다운 표로 깔끔하게 정리하세요. 코디와 어울리는 실제 유튜브 패션 유튜버 영상 링크도 포함하세요.',
  },
  {
    channelId: 'counseling',
    label: '생활 꿀팁',
    topic: '오늘 바로 써먹을 수 있는 생활 꿀팁. 가상의 URL이나 상품을 만들지 마시고, 반드시 구글 검색을 통해 실제로 존재하는 유튜브 꿀팁 영상 링크와 필요한 다이소/쿠팡 등 실제 제품 링크를 가져와주세요. 예전과 중복 금지.',
  },
];

const MANAGER_ROLES = new Set(['admin', 'manager']);

function getKoreaDateKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function claimDailyRun(runId: string, channelId: string, date: string) {
  const runRef = doc(db, 'dailyAiRuns', runId);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(runRef);
    const status = snap.exists() ? snap.data()?.status : null;
    if (status === 'running' || status === 'done') return false;

    transaction.set(runRef, {
      date,
      channelId,
      status: 'running',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  });
}

async function getCoordinates(query: string) {
  if (!query.trim()) return { lat: 0, lng: 0, mapUrl: '' };
  try {
    const resolved = await resolveKoreanPlace(query);
    return {
      lat: resolved.lat || 0,
      lng: resolved.lng || 0,
      mapUrl: resolved.kakaoMapUrl || '',
    };
  } catch {
    return { lat: 0, lng: 0, mapUrl: '' };
  }
}

/**
 * AI 게시물 일괄 발행
 * @param selectedIndices - 선택된 카테고리 인덱스 배열 (undefined면 전체)
 */
export async function ensureDailyAiPosts(profile: UserProfile | null, force = false, selectedIndices?: number[]) {
  if (!profile || !MANAGER_ROLES.has(profile.role)) return;

  const today = getKoreaDateKey();
  const localKey = `dongjeon-daily-ai-posts-${today}`;
  if (!force && localStorage.getItem(localKey) === 'done') return;

  const categoriesToRun = selectedIndices
    ? selectedIndices.map(i => DAILY_AI_CATEGORIES[i]).filter(Boolean)
    : DAILY_AI_CATEGORIES;

  for (const category of categoriesToRun) {
    const runId = force ? `${today}_${category.channelId}_manual_${Date.now()}` : `${today}_${category.channelId}`;
    const claimed = await claimDailyRun(runId, category.channelId, today);
    if (!claimed) continue;

    const runRef = doc(db, 'dailyAiRuns', runId);
    try {
      const generated = await generateDailyCategoryPost(category.channelId, category.label, category.topic);
      const isPlace = ['restaurants', 'accommodation', 'hotplace'].includes(category.channelId);
      const placeQuery = generated.locationName || generated.title;
      // 1. 유튜브 링크 추출 및 oEmbed 검증
      const ytUrlRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[a-zA-Z0-9_-]{11})/gi;
      const extractedYtUrls = Array.from(generated.content.matchAll(ytUrlRegex)).map(m => m[1]);
      
      const verifiedYtThumbnails: string[] = [];
      const verifiedSourceLinks: string[] = [];
      
      if (extractedYtUrls.length > 0) {
        const uniqueYtUrls = [...new Set(extractedYtUrls)];
        const ytInfos = await Promise.allSettled(uniqueYtUrls.map(url => fetchLinkInfo(url)));
        
        for (const res of ytInfos) {
          if (res.status === 'fulfilled' && res.value.type === 'youtube' && res.value.imageUrl) {
            verifiedYtThumbnails.push(res.value.imageUrl);
            verifiedSourceLinks.push(res.value.url);
          } else if (res.status === 'fulfilled' && res.value.type === 'youtube') {
            // 존재하지 않는 가짜 동영상은 본문 마크다운 링크와 본문 텍스트에서 삭제
            const fakeUrl = res.value.url;
            const markdownLinkRegex = new RegExp(`\\[[^\\]]*\\]\\(${fakeUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'gi');
            generated.content = generated.content.replace(markdownLinkRegex, '');
            generated.content = generated.content.replace(fakeUrl, '');
          }
        }
      }

      // 2. 장소 이미지 탐색
      let imageUrls = isPlace && placeQuery
        ? await searchPlaceImages(placeQuery, generated.region).catch(() => [])
        : [];

      // 3. 인라인 이미지 마크다운 및 Pollinations 주소 수집
      const allText = generated.content + ' ' + (generated.sourceLinks || []).join(' ');
      const mdImageMatches = Array.from(allText.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi));
      const pollinationsMatches = Array.from(allText.matchAll(/(https:\/\/image\.pollinations\.ai\/[^\s)"\]]+)/gi));
      const inlineImages = [
        ...mdImageMatches.map(m => m[1]),
        ...pollinationsMatches.map(m => m[1]),
      ].filter(u => !imageUrls.includes(u));

      // 최종 병합 (검증된 유튜브 썸네일 + 장소 이미지 + 인라인 이미지)
      imageUrls = [...new Set([...verifiedYtThumbnails, ...imageUrls, ...inlineImages])].filter(Boolean);

      const { lat, lng, mapUrl: coordsMapUrl } = isPlace
        ? await getCoordinates([generated.locationName, generated.region].filter(Boolean).join(' '))
        : { lat: 0, lng: 0, mapUrl: '' };
      const mapUrl = generated.mapUrl || coordsMapUrl || '';

      const nonYtLinks = (generated.sourceLinks || []).filter(l => !/youtube\.com|youtu\.be/i.test(l));
      const finalSourceLinks = [...new Set([...verifiedSourceLinks, ...nonYtLinks])];

      const postRef = await addDoc(collection(db, 'posts'), {
        channelId: category.channelId,
        authorId: auth.currentUser?.uid || 'ai-butler',
        title: generated.title,
        content: generated.content,
        locationName: generated.locationName || '',
        region: generated.region || '전국',
        lat,
        lng,
        likesCount: 0,
        commentsCount: 0,
        isAiGenerated: true,
        imageUrl: imageUrls[0] || '',
        imageUrls: imageUrls.slice(0, 5),
        mapUrl,
        sourceLinks: finalSourceLinks,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await setDoc(runRef, {
        status: 'done',
        postId: postRef.id,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error: any) {
      console.error('Daily AI post failed:', category.channelId, error);
      await setDoc(runRef, {
        status: 'error',
        error: String(error?.message || error).slice(0, 300),
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }
  }

  localStorage.setItem(localKey, 'done');
}
