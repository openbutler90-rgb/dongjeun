// AI Prompts and Category generators
import { retryGemini, extractText, getTierForCategory, type ModelTier } from './client';
import { fetchLinkInfo, FetchedLinkInfo } from './urlParser';

function getCurrentDateContext(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  let season = '겨울';
  if (month >= 3 && month <= 5) season = '봄';
  else if (month >= 6 && month <= 8) season = '여름';
  else if (month >= 9 && month <= 11) season = '가을';
  return `현재 날짜: ${year}년 ${month}월 ${day}일 (${season})`;
}

const APP_CONTEXT = `
동전커피는 20~30대 청년 커뮤니티 앱입니다.
채널: 모임(정모/지역모임/소모임), 공지사항, 자유게시판, 패션/OOTD, 생활꿀팁, 핫플레이스, 맛집, 인생샷 스팟, 숙소 리뷰
글 스타일: 친근하고 솔직한 한국어, 이모지 적극 활용, 마크다운 사용
`.trim();

// ─── 카테고리별 폴백 이미지 (Unsplash CDN) ───
const PHOTO_POOL: Record<string, string[]> = {
  restaurants: [
    'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&q=75',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&q=75',
    'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=600&q=75',
    'https://images.unsplash.com/photo-1476224203421-9ac39bcb3327?w=600&q=75',
  ],
  hotplace: [
    'https://images.unsplash.com/photo-1559339352-11d035aa65de?w=600&q=75',
    'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=600&q=75',
    'https://images.unsplash.com/photo-1534430480872-3498386e7856?w=600&q=75',
    'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&q=75',
  ],
  spots: [
    'https://images.unsplash.com/photo-1598808503746-f34c53b9323e?w=600&q=75',
    'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=600&q=75',
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&q=75',
  ],
  accommodation: [
    'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=600&q=75',
    'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=600&q=75',
    'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=600&q=75',
  ],
  ootd: [
    'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=600&q=75',
    'https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=600&q=75',
    'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=600&q=75',
  ],
  freeboard: [
    'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=600&q=75',
    'https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=600&q=75',
  ],
};

function getCategoryImages(channelId: string, count = 1): string[] {
  const pool = PHOTO_POOL[channelId] || PHOTO_POOL.hotplace;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export interface PostDraftInput {
  channelId?: string;
  title?: string;
  locationName?: string;
  address?: string;
  region?: string;
  currentContent?: string;
  links?: string[];
  sourceLinks?: string[];
  imageUrls?: string[];
  fashionItems?: { name: string; brand: string; link: string; imageUrl: string }[];
  hint?: string;
  signal?: AbortSignal;
}

export interface PostDraftResult {
  title: string;
  content: string;
  imageUrls: string[];
  locationName: string;
  mapUrl: string;
  region: string;
  fashionItems?: { name: string; brand: string; link: string; imageUrl: string }[];
  modelImages?: string[];
}

export async function generatePostDraft(input: PostDraftInput): Promise<PostDraftResult> {
  const {
    channelId = 'freeboard',
    title,
    locationName,
    address,
    region,
    currentContent,
    imageUrls = [],
    fashionItems = [],
    hint,
    signal,
  } = input;

  const allLinks = [...new Set([...(input.links || []), ...(input.sourceLinks || [])])];
  const fetchedLinks: FetchedLinkInfo[] = [];
  const fetchedImages: string[] = [...imageUrls];

  if (allLinks.length > 0) {
    const linkResults = await Promise.allSettled(
      allLinks.slice(0, 5).map(link => fetchLinkInfo(link))
    );
    for (const result of linkResults) {
      if (result.status === 'fulfilled') {
        fetchedLinks.push(result.value);
        if (result.value.imageUrl?.startsWith('https://')) {
          fetchedImages.push(result.value.imageUrl);
        }
      }
    }
  }

  const linkContext = fetchedLinks.map((l, i) => {
    const parts = [`[링크${i + 1}] URL: ${l.url}`];
    if (l.title) parts.push(`제목: ${l.title}`);
    if (l.description) parts.push(`설명: ${l.description.slice(0, 400)}`);
    if (l.authorName) parts.push(`작성자: ${l.authorName}`);
    if (l.raw) parts.push(`본문: ${l.raw.slice(0, 400)}`);
    return parts.join('\n');
  }).join('\n\n');

  const channelNames: Record<string, string> = {
    freeboard: '자유게시판', hotplace: '핫플레이스', restaurants: '맛집 추천',
    spots: '인생샷 스팟', accommodation: '숙소 리뷰', ootd: '패션/OOTD',
    counseling: '생활 꿀팁', notice: '공지사항', meetings: '모임',
  };

  const isOotd = channelId === 'ootd';

  const prompt = `${APP_CONTEXT}

${getCurrentDateContext()}
사용자가 특정 월이나 계절을 언급하면 반드시 해당 시기에 적합한 내용을 추천하세요.

== 사용자 입력 ==
채널: ${channelNames[channelId] || channelId}
${title ? `제목/키워드: ${title}` : ''}
${locationName ? `장소명: ${locationName}` : ''}
${address ? `주소: ${address}` : ''}
${region ? `지역: ${region}` : ''}
${hint ? `힌트: ${hint}` : ''}
${currentContent ? `기존 메모: ${currentContent.slice(0, 200)}` : ''}
${linkContext ? `\n== 링크 분석 ==\n${linkContext}` : ''}
${channelId === 'ootd' && fashionItems.length > 0 ? `\n== 추가된 의류 아이템 ==\n${JSON.stringify(fashionItems)}` : ''}

== 작업 ==
위 정보를 분석해서 동전커피 커뮤니티에 올릴 게시물 초안을 작성하세요.
${channelId === 'ootd' ? `
패션/OOTD 채널입니다. 
추가된 의류 아이템 정보를 바탕으로 전체적인 스타일링(코디) 조언을 300자 내외로 작성하세요.
그리고 반드시 "modelImages" 필드에 해당 코디를 입은 한국 남성 모델을 생성하는 Pollinations AI URL을 1~2개 배열로 반환하세요. 전신 사진이어야 하므로 "full body shot" 키워드를 반드시 넣으세요!
(예: https://image.pollinations.ai/prompt/Korean%20male%20fashion%20model,%20wearing%20[옷키워드],%20street%20fashion,%20full%20body%20shot?width=800&height=1000&nologo=true)
비어있는 아이템의 brand나 name을 문맥에 맞게 채우고, 만약 imageUrl이 비어있다면 Pollinations AI를 통해 제품 컷 URL을 생성하여 "fashionItems" 필드를 반환하세요.
(예: https://image.pollinations.ai/prompt/product%20shot,%20[옷키워드],%20white%20background?width=400&height=400&nologo=true)
` : `링크가 있으면 해당 내용을 반드시 반영하고, 이미지 URL이 있으면 mapUrl에 활용하세요.`}

JSON 형식으로만 응답 (다른 텍스트 없이):
{
  "title": "게시물 제목 (50자 이내)",
  "content": "본문 (마크다운, 300~800자, 이모지, 친근한 말투, ## 소제목 활용)",
  "locationName": "장소명 (없으면 빈 문자열)",
  "region": "지역 (서울/부산/제주 등, 없으면 빈 문자열)",
  "mapUrl": "카카오맵/네이버맵 URL (없으면 빈 문자열)"${channelId === 'ootd' ? `,\n  "modelImages": ["Pollinations AI URL"],\n  "fashionItems": [{"name": "", "brand": "", "link": "", "imageUrl": ""}]` : ''}
}`;

  // 입력 콘텐츠의 풍부함/부하 여부에 따라 동적 티어 판정 (링크 수, 힌트 유무, 의류 매칭 정보 유무 등)
  const hasHeavyContext = allLinks.length > 0 || (hint && hint.trim().length > 10) || fashionItems.length > 0;
  const chosenTier = getTierForCategory(channelId, hasHeavyContext);

  // 게시물 초안: 동적 선택된 티어로 호출
  const data = await retryGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
  }, signal, chosenTier, { skipLocal: true });

  const raw = extractText(data).trim();

  let parsed: any = {};
  try {
    const jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const match = jsonStr.replace(/[\u200B-\u200D\uFEFF]/g, "").match(/\{[\s\S]+\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    parsed = { title: title || '게시물 초안', content: raw };
  }

  let finalImages = fetchedImages.filter(u => u.startsWith('https://'));
  if (finalImages.length === 0) finalImages = getCategoryImages(channelId, 1);

  const resolvedLocationName = String(parsed.locationName || locationName || '');

  return {
    title: String(parsed.title || title || '').slice(0, 100),
    content: String(parsed.content || '').slice(0, 3000),
    imageUrls: [...new Set(finalImages)].slice(0, 5),
    locationName: resolvedLocationName,
    mapUrl: String(parsed.mapUrl || (resolvedLocationName
      ? `https://map.kakao.com/link/search/${encodeURIComponent(resolvedLocationName)}`
      : '')),
    region: String(parsed.region || region || ''),
    fashionItems: Array.isArray(parsed.fashionItems) ? parsed.fashionItems : fashionItems,
    modelImages: Array.isArray(parsed.modelImages) ? parsed.modelImages : [],
  };
}

export interface RecommendationItem {
  title: string;
  category: string;
  region: string;
  locationName: string;
  mapUrl?: string;
  sourceLinks?: string[];
  briefDesc: string;
  imageUrls?: string[];
  imageUrl?: string;
  fashionItems?: { name: string; brand: string; link: string; imageUrl: string }[];
  modelImages?: string[];
}

function buildNaverSearchUrl(query: string) {
  return `https://map.naver.com/v5/search/${encodeURIComponent(query)}`;
}

function detectFallbackRegion(prompt: string) {
  if (/인천|구월|송도|부평|월미|차이나타운|개항장|소래/.test(prompt)) return '인천';
  if (/부산|해운대|광안리|서면|영도|남포|범일/.test(prompt)) return '부산';
  if (/서울|홍대|성수|강남|종로|연남|망원|한남/.test(prompt)) return '서울';
  if (/전주|전북|한옥마을|완산|덕진/.test(prompt)) return '전북';
  if (/제주|서귀포|애월|성산|조천/.test(prompt)) return '제주';

  // 전국 다른 시도 및 시군구 추가 검출
  const match = prompt.match(/(경기|수원|성남|용인|고양|부천|화성|안산|남양주|안양|평택|시흥|파주|의정부|김포|광주|하남|광명|군포|이천|오산|강원|춘천|원주|강릉|동해|속초|삼척|홍천|횡성|영월|평창|정선|철원|화천|양구|인제|고성|양양|충북|청주|충주|제천|보은|옥천|영동|증평|진천|괴산|음성|단양|충남|천안|공주|보령|아산|서산|논산|계룡|당진|금산|부여|서천|청양|홍성|예산|태안|전남|목포|여수|순천|나주|광양|담양|곡성|구례|고흥|보성|화순|장흥|강진|해남|영암|무안|함평|영광|장성|완도|진도|신안|경북|포항|경주|김천|안동|구미|영주|영천|상주|문경|경산|군위|의성|청송|영양|영덕|청도|고령|성주|칠곡|예천|봉화|울진|울릉|경남|창원|진주|통영|사천|김해|밀양|거제|양산|의령|함안|창녕|고성|남해|하동|산청|함양|거창|합천|대구|대전|광주|울산|세종)/);
  if (match) {
    const raw = match[1];
    if (/수원|성남|용인|고양|부천|화성|안산|남양주|안양|평택|시흥|파주|의정부|김포|광주|하남|광명|군포|이천|오산/.test(raw)) return '경기';
    if (/춘천|원주|강릉|동해|속초|삼척|홍천|횡성|영월|평창|정선|철원|화천|양구|인제|고성|양양/.test(raw)) return '강원';
    if (/청주|충주|제천|보은|옥천|영동|증평|진천|괴산|음성|단양/.test(raw)) return '충북';
    if (/천안|공주|보령|아산|서산|논산|계룡|당진|금산|부여|서천|청양|홍성|예산|태안/.test(raw)) return '충남';
    if (/목포|여수|순천|나주|광양|담양|곡성|구례|고흥|보성|화순|장흥|강진|해남|영암|무안|함평|영광|장성|완도|진도|신안/.test(raw)) return '전남';
    if (/포항|경주|김천|안동|구미|영주|영천|상주|문경|경산|군위|의성|청송|영양|영덕|청도|고령|성주|칠곡|예천|봉화|울진|울릉/.test(raw)) return '경북';
    if (/창원|진주|통영|사천|김해|밀양|거제|양산|의령|함안|창녕|고성|남해|하동|산청|함양|거창|합천/.test(raw)) return '경남';
    return raw;
  }
  return '';
}

function detectFallbackCategory(prompt: string) {
  if (/데이트룩|소개팅룩|하객룩|남친룩|룩|옷|코디|패션|스타일|착장|아우터|셔츠|팬츠|신발|ootd/i.test(prompt)) return 'ootd';
  if (/숙소|호텔|펜션|리조트|스테이/.test(prompt)) return 'accommodation';
  if (/맛집|밥|음식|고기|국밥|카페|디저트|술집|먹/.test(prompt)) return 'restaurants';
  if (/인생샷|사진|포토|명소|스팟|풍경|뷰/.test(prompt)) return 'spots';
  if (/핫플|놀|데이트|가볼|장소|코스|거리/.test(prompt)) return 'hotplace';
  return '';
}

function buildFashionFallbackRecommendations(prompt: string): RecommendationItem[] {
  const lowered = prompt.toLowerCase();
  const season = /겨울|코트|패딩/.test(prompt) ? '겨울' : /가을|자켓|재킷/.test(prompt) ? '가을' : /여름|반팔|린넨/.test(prompt) ? '여름' : '사계절';
  const isDateLook = /데이트룩|데이트|소개팅/.test(prompt);
  const baseTitle = isDateLook ? `${season} 데이트룩 코디` : lowered.includes('ootd') ? `${season} OOTD 코디` : `${season} 데일리 코디`;
  const sets = [
    {
      title: `미니멀 ${baseTitle}`,
      desc: '과하게 꾸민 느낌보다 깨끗한 실루엣을 먼저 잡는 코디예요. 상의는 단정하게, 하의는 여유 있는 스트레이트 핏으로 맞추면 편안하지만 정돈된 분위기가 납니다. 장소가 카페나 가벼운 식사라면 신발은 로퍼나 깔끔한 스니커즈가 잘 맞아요.',
      items: [
        { name: '오버핏 셔츠', brand: '무신사 스탠다드', link: '', imageUrl: '' },
        { name: '테이퍼드 슬랙스', brand: '유니클로', link: '', imageUrl: '' },
        { name: '레더 로퍼', brand: '금강제화', link: '', imageUrl: '' },
      ],
    },
    {
      title: `시티보이 ${baseTitle}`,
      desc: '여유 있는 셔츠나 니트에 와이드 팬츠를 맞춰 자연스럽게 멋을 내는 방향이에요. 사진으로 봤을 때 비율이 무너지지 않도록 상의 길이는 너무 길지 않게 잡고, 포인트 색은 하나만 쓰는 편이 안정적입니다.',
      items: [
        { name: '릴렉스핏 니트', brand: '스파오', link: '', imageUrl: '' },
        { name: '와이드 치노 팬츠', brand: '탑텐', link: '', imageUrl: '' },
        { name: '캔버스 스니커즈', brand: '컨버스', link: '', imageUrl: '' },
      ],
    },
    {
      title: `모노톤 ${baseTitle}`,
      desc: '검정, 차콜, 아이보리만으로 구성하면 실패 확률이 낮아요. 대신 소재 차이를 주면 밋밋하지 않습니다. 상의는 부드러운 조직감, 하의는 매끈한 소재, 가방이나 시계는 작게 포인트를 주면 깔끔합니다.',
      items: [
        { name: '크루넥 티셔츠', brand: '무신사 스탠다드', link: '', imageUrl: '' },
        { name: '블랙 데님 팬츠', brand: '플랙', link: '', imageUrl: '' },
        { name: '미니멀 스니커즈', brand: '아디다스', link: '', imageUrl: '' },
      ],
    },
  ];

  return sets.map((item) => ({
    title: item.title,
    category: 'ootd',
    region: '',
    locationName: '',
    mapUrl: '',
    sourceLinks: [
      `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(item.title)}`,
      `https://www.musinsa.com/search/musinsa/integration?q=${encodeURIComponent(item.title)}`,
    ],
    briefDesc: item.desc,
    imageUrls: getCategoryImages('ootd', 2),
    imageUrl: getCategoryImages('ootd', 1)[0] || '',
    fashionItems: item.items,
    modelImages: [],
  }));
}

function buildFallbackRecommendations(prompt: string): RecommendationItem[] {
  const region = detectFallbackRegion(prompt) || '전국';
  const category = detectFallbackCategory(prompt);
  if (category === 'ootd') return buildFashionFallbackRecommendations(prompt);
  if (!category) return [];

  const pools: Record<string, Partial<Record<string, Array<{ title: string; desc: string }>>>> = {
    제주: {
      hotplace: [
        { title: '도두동 무지개해안도로', desc: '바다와 색감 있는 방호벽이 이어지는 제주 대표 산책 코스예요. 가볍게 들러 사진 남기고 근처 카페로 이동하기 좋습니다.' },
        { title: '애월 카페거리', desc: '바다 전망 카페와 산책 동선을 함께 잡기 좋은 권역이에요. 날씨 좋은 날 커플 코스로 쓰기 편합니다.' },
        { title: '동문시장 야시장', desc: '먹거리와 활기 있는 분위기를 함께 즐길 수 있는 제주 도심 핫플이에요. 저녁 일정으로 묶기 좋습니다.' },
      ],
      spots: [
        { title: '사려니숲길', desc: '나무 사이로 들어오는 빛과 숲길 분위기가 좋아 차분한 사진을 남기기 좋은 명소예요.' },
        { title: '성산일출봉', desc: '제주 동쪽 풍경을 크게 담을 수 있는 대표 뷰 포인트예요. 이른 시간이나 노을 무렵 사진이 특히 좋습니다.' },
        { title: '이호테우해변', desc: '말 등대와 바다 배경이 한 화면에 잡히는 촬영 코스예요. 공항과 가까워 마지막 일정에도 넣기 좋습니다.' },
      ],
      restaurants: [
        { title: '우진해장국', desc: '제주식 고사리육개장으로 유명한 곳이에요. 대기 시간이 생길 수 있어 방문 전 최신 후기를 확인하면 좋습니다.' },
        { title: '자매국수', desc: '고기국수로 잘 알려진 제주 대표 맛집 후보예요. 가벼운 식사 코스로 넣기 좋습니다.' },
        { title: '오는정김밥', desc: '여행 중 간단히 챙겨가기 좋은 김밥 맛집 후보예요. 예약이나 대기 방식은 최신 정보를 확인하세요.' },
      ],
      accommodation: [
        { title: '애월 오션뷰 숙소권', desc: '바다 전망과 카페 동선을 함께 잡기 좋은 숙소 권역이에요. 렌터카 이동 여부를 기준으로 고르면 편합니다.' },
        { title: '서귀포 감성 스테이권', desc: '조용한 휴식과 남쪽 관광지 동선이 잘 맞는 숙소 권역이에요. 뷰와 주차 후기를 함께 보세요.' },
        { title: '성산 일출 숙소권', desc: '성산일출봉과 우도 일정을 묶기 좋은 숙소 권역이에요. 아침 일정이 있는 여행에 잘 맞습니다.' },
      ],
    },
    부산: {
      hotplace: [
        { title: '해리단길', desc: '카페, 소품샵, 식당이 골목 단위로 이어지는 해운대권 핫플이에요. 식사와 산책을 함께 잡기 좋습니다.' },
        { title: '전포카페거리', desc: '부산에서 감도 있는 카페와 편집숍을 둘러보기 좋은 권역이에요.' },
        { title: '광안리 해변', desc: '바다와 광안대교 야경을 함께 즐길 수 있는 대표 코스예요.' },
      ],
      spots: [
        { title: '감천문화마을', desc: '색감 있는 골목과 전망 포인트가 많아 사진 코스로 쓰기 좋은 명소예요.' },
        { title: '흰여울문화마을', desc: '바다를 따라 이어지는 골목과 카페가 좋아 산책 사진을 남기기 좋습니다.' },
        { title: '청사포 다릿돌전망대', desc: '바다 풍경이 시원하게 열리는 촬영 포인트예요.' },
      ],
      restaurants: [
        { title: '해운대암소갈비집', desc: '해운대권에서 오래 알려진 갈비 맛집 후보예요. 예약과 대기 정보를 확인하면 좋습니다.' },
        { title: '합천국밥집', desc: '부산식 국밥 후보로 많이 언급되는 곳이에요. 든든한 식사 코스로 좋습니다.' },
        { title: '범일빈대떡', desc: '부산 범일동권에서 전통적인 분위기의 맛집 후보로 쓰기 좋아요.' },
      ],
      accommodation: [
        { title: '해운대 해변 숙소권', desc: '바다 접근성과 식당 동선이 좋아 부산 첫 숙소로 잡기 편한 권역이에요.' },
        { title: '광안리 오션뷰 숙소권', desc: '야경과 카페 동선을 중시할 때 잘 맞는 숙소 권역이에요.' },
        { title: '서면 중심 숙소권', desc: '교통과 식사 선택지를 넓게 가져가기 좋은 중심 권역이에요.' },
      ],
    },
    서울: {
      hotplace: [
        { title: '성수동 카페거리', desc: '카페, 팝업, 편집숍이 모여 있어 최신 분위기를 보기 좋은 권역이에요.' },
        { title: '연남동 경의선숲길', desc: '산책과 식사, 카페를 함께 연결하기 좋은 데이트 코스예요.' },
        { title: '한남동 거리', desc: '레스토랑과 카페, 쇼룸이 모여 있어 감도 있는 일정을 만들기 좋습니다.' },
      ],
      spots: [
        { title: '노들섬', desc: '한강과 하늘 배경을 넓게 담기 좋은 촬영 코스예요.' },
        { title: '서울숲', desc: '계절감 있는 사진과 산책 코스를 함께 잡기 좋은 장소예요.' },
        { title: '북촌한옥마을', desc: '한옥 골목과 도심 풍경을 같이 담을 수 있는 대표 명소예요.' },
      ],
      restaurants: [
        { title: '몽탄', desc: '고기 메뉴로 유명한 서울 맛집 후보예요. 예약과 대기 정보를 먼저 확인하세요.' },
        { title: '을지로 노포거리', desc: '다양한 노포 식당을 고를 수 있는 권역형 맛집 코스예요.' },
        { title: '연남동 맛집거리', desc: '양식, 아시안, 카페까지 선택지가 넓은 식사 권역이에요.' },
      ],
      accommodation: [
        { title: '홍대입구 숙소권', desc: '이동성과 야간 동선을 중요하게 볼 때 편한 숙소 권역이에요.' },
        { title: '명동 숙소권', desc: '서울 중심 관광과 교통을 함께 잡기 좋은 숙소 권역이에요.' },
        { title: '성수·건대 숙소권', desc: '동쪽 카페/핫플 동선을 즐기기 좋은 숙소 권역이에요.' },
      ],
    },
    전북: {
      hotplace: [
        { title: '전주한옥마을', desc: '한옥 거리, 간식, 사진 코스를 한 번에 묶기 좋은 전주 대표 권역이에요.' },
        { title: '객리단길', desc: '전주 도심 카페와 식당을 둘러보기 좋은 핫플 권역이에요.' },
        { title: '전주 남부시장 청년몰', desc: '시장 분위기와 먹거리, 소규모 상점을 함께 보기 좋은 코스예요.' },
      ],
      spots: [
        { title: '오목대', desc: '전주한옥마을 전경을 내려다보기 좋은 사진 포인트예요.' },
        { title: '전동성당', desc: '전주 도심에서 분위기 있는 건축 사진을 남기기 좋은 장소예요.' },
        { title: '덕진공원', desc: '연못과 산책로가 있어 계절 사진을 남기기 좋은 곳이에요.' },
      ],
      restaurants: [
        { title: '전주현대옥 전주한옥마을점', desc: '전주식 콩나물국밥 후보로 한옥마을 일정과 묶기 좋아요.' },
        { title: '베테랑 칼국수', desc: '전주한옥마을 인근에서 오래 알려진 식사 후보예요.' },
        { title: '한국집', desc: '전주비빔밥 후보로 많이 언급되는 곳이에요. 최신 후기를 확인하고 방문하세요.' },
      ],
      accommodation: [
        { title: '전주한옥마을 한옥스테이권', desc: '한옥 분위기를 살리며 도보 여행하기 좋은 숙소 권역이에요.' },
        { title: '객사 주변 숙소권', desc: '카페와 식당 동선이 편한 전주 도심 숙소 권역이에요.' },
        { title: '전주역 주변 숙소권', desc: '기차 이동이 많을 때 편한 숙소 권역이에요.' },
      ],
    },
    인천: {
      hotplace: [
        { title: '구월동 로데오거리', desc: '카페, 음식점, 술집, 쇼핑 동선이 한 번에 이어지는 인천 대표 번화가예요. 가볍게 만나서 식사와 2차까지 연결하기 좋아 모임 후보로 쓰기 편합니다.' },
        { title: '송도 센트럴파크', desc: '공원 산책, 야경, 주변 카페를 함께 묶기 좋은 정돈된 핫플 코스예요. 조용한 데이트나 사진 남기는 일정에도 잘 맞습니다.' },
        { title: '개항장 거리', desc: '근대 건축물과 카페 골목이 이어지는 분위기 있는 산책 코스예요. 차이나타운, 자유공원, 신포시장과 함께 묶기 좋습니다.' },
      ],
      spots: [
        { title: '송월동 동화마을', desc: '색감 있는 벽화와 골목 배경이 많아 인생샷을 남기기 좋은 포토 코스예요. 차이나타운과 가까워 짧은 일정에 함께 넣기 좋습니다.' },
        { title: '소래습지생태공원', desc: '갈대, 풍차, 넓은 하늘이 어울려 계절감 있는 사진이 잘 나오는 장소예요. 노을 시간대에 특히 분위기가 좋습니다.' },
        { title: '월미도 문화의거리', desc: '바다와 야간 조명이 함께 잡히는 밝은 분위기의 촬영 코스예요. 산책, 간식, 놀이시설까지 이어가기 쉽습니다.' },
      ],
      restaurants: [
        { title: '신포국제시장', desc: '닭강정, 분식, 간식류를 다양하게 고를 수 있는 시장형 맛집 코스예요. 개항장이나 차이나타운 일정과 묶기 좋습니다.' },
        { title: '구월동 로데오거리 맛집거리', desc: '인원수와 취향에 맞춰 고기, 술집, 카페 후보를 고르기 쉬운 상권이에요. 모임 식사 장소 후보로 쓰기 좋습니다.' },
        { title: '차이나타운 식당거리', desc: '인천다운 특색 있는 식사를 잡기 좋은 중식 상권이에요. 최근 리뷰와 대기 시간을 확인하고 고르면 안정적입니다.' },
      ],
      accommodation: [
        { title: '송도 센트럴파크 주변 숙소', desc: '야경 산책과 카페 동선이 편한 숙소 권역이에요. 전망, 주차, 조식 조건을 비교해 고르면 좋습니다.' },
        { title: '영종도 해안 숙소권', desc: '바다를 보며 쉬는 일정에 맞는 숙소 후보가 많은 권역이어야 합니다. 차량 이동 여부와 체크인 시간을 먼저 확인하세요.' },
        { title: '월미도 주변 숙소권', desc: '바다 산책과 먹거리 동선을 짧게 가져갈 수 있는 숙소 권역이에요. 주말 혼잡과 소음 후기를 함께 보면 좋습니다.' },
      ],
    },
  };

  const selected = pools[region]?.[category] || [];
  if (selected.length === 0) {
    const genericPools: Record<string, Array<{ title: string; desc: string }>> = {
      hotplace: [
        { title: `${region} 대표 명소/상권`, desc: `${region} 지역에서 가장 잘 알려지고 방문객이 많은 대표적인 핫플레이스 상권입니다.` },
        { title: `${region} 감성 데이트 코스`, desc: `연인이나 친구와 함께 걷기 좋고 감성적인 카페나 소품샵 등이 모여 있는 추천 구역입니다.` },
        { title: `${region} 로컬 나들이 명소`, desc: `주말에 가족이나 지인들과 함께 가볍게 산책하거나 풍경을 감상하며 힐링하기 좋은 명소입니다.` },
      ],
      spots: [
        { title: `${region} 베스트 포토존`, desc: `${region}의 멋진 풍경이나 분위기 있는 인생 사진을 남기기 가장 좋은 대표 포토 스팟입니다.` },
        { title: `${region} 야경/전망 명소`, desc: `도시의 밤풍경이나 확 트인 전경을 한눈에 담을 수 있는 조망 포인트입니다.` },
        { title: `${region} 계절 테마 포토스팟`, desc: `봄, 여름, 가을, 겨울 각 계절마다 고유한 매력을 뽐내는 자연 속 야외 사진 촬영 명소입니다.` },
      ],
      restaurants: [
        { title: `${region} 소문난 현지인 맛집`, desc: `지역 주민들 사이에서 맛으로 오랜 시간 신뢰받으며 입소문이 난 진짜 현지인 추천 식당가입니다.` },
        { title: `${region} 인기 트렌디 식당`, desc: `최근 인스타그램이나 블로그 등에서 화려한 비주얼과 특색 있는 메뉴로 사랑받는 핫한 맛집입니다.` },
        { title: `${region} 대표 향토 음식점`, desc: `${region}의 특산물이나 전통 요리를 맛볼 수 있어 여행 시 꼭 들러야 할 대표 메뉴 맛집입니다.` },
      ],
      accommodation: [
        { title: `${region} 감성 펜션/독채 스테이`, desc: `인테리어가 예쁘고 독창적인 분위기를 즐기며 아늑하게 쉴 수 있는 인기 스테이 권역입니다.` },
        { title: `${region} 도심형 가성비 호텔`, desc: `접근성이 뛰어나고 깔끔한 시설을 자랑하며 가성비가 높은 실용적인 도심 숙소들입니다.` },
        { title: `${region} 전망 좋은 리조트/호텔`, desc: `바다나 산, 도시의 아름다운 전망을 객실에서 편안하게 감상할 수 있는 고급 뷰 맛집 숙소권입니다.` },
      ],
    };
    const genericSelected = genericPools[category] || genericPools.hotplace;
    return genericSelected.map(item => ({
      title: item.title,
      category,
      region,
      locationName: `${region} ${item.title.replace(`${region} `, '')}`,
      mapUrl: buildNaverSearchUrl(`${region} ${item.title}`),
      sourceLinks: [
        buildNaverSearchUrl(`${region} ${item.title}`),
        `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(`${region} ${item.title}`)}`,
        `https://search.naver.com/search.naver?query=${encodeURIComponent(`${region} ${item.title} 블로그`)}`,
      ],
      briefDesc: item.desc,
      imageUrls: getCategoryImages(category, 2),
      imageUrl: getCategoryImages(category, 1)[0] || '',
      fashionItems: [],
      modelImages: [],
    }));
  }

  return selected.map(item => ({
    title: item.title,
    category,
    region,
    locationName: item.title,
    mapUrl: buildNaverSearchUrl(`${region} ${item.title}`),
    sourceLinks: [
      buildNaverSearchUrl(`${region} ${item.title}`),
      `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(`${region} ${item.title}`)}`,
      `https://search.naver.com/search.naver?query=${encodeURIComponent(`${region} ${item.title} 블로그`)}`,
    ],
    briefDesc: item.desc,
    imageUrls: getCategoryImages(category, 2),
    imageUrl: getCategoryImages(category, 1)[0] || '',
    fashionItems: [],
    modelImages: [],
  }));
}

function buildFallbackResponse(userPrompt: string, reason?: string): { text: string; recommendations: RecommendationItem[] } {
  const fallback = buildFallbackRecommendations(userPrompt);
  if (fallback.length > 0) {
    return {
      text: `${fallback[0].region} 기준으로 바로 확인할 수 있는 후보 ${fallback.length}곳을 먼저 정리했어요. 지금 AI 사용량이 잠시 막혀서 상세 분석은 가볍게 구성했고, 오른쪽 카드에서 지도와 이미지 검색을 바로 확인할 수 있어요.`,
      recommendations: fallback,
    };
  }

  return {
    text: reason
      ? '지금 AI 사용량이 잠시 막혀서 자동 추천 목록을 만들지 못했어요. 지역과 카테고리를 함께 적어 다시 보내면 기본 후보 카드부터 구성해볼게요.'
      : '추천 목록을 만들려면 지역과 원하는 카테고리를 함께 적어주세요. 예: "인천 구월동 핫플", "부산 인생샷 명소"',
    recommendations: [],
  };
}

function formatAiSource(data: any) {
  const source = data?.__dongjeonAiSource;
  if (!source) return '';
  if (source.type === 'local') return `로컬 ${source.provider || 'local'} · ${source.model || ''}`.trim();
  if (source.type === 'gemini') return `Gemini API · ${source.model || ''}${source.key ? ` · ${source.key}` : ''}`;
  return '';
}

function cleanThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function repairJsonString(jsonStr: string): string {
  let cleaned = jsonStr.trim();
  
  // Replace smart/curly quotes with standard quotes
  cleaned = cleaned.replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");

  // Remove trailing commas before closing braces/brackets
  cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');

  // Fix unescaped newlines and control characters inside JSON string literals
  let inString = false;
  let escapeNext = false;
  let result = '';
  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (escapeNext) {
      result += char;
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      result += char;
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }
    if (inString && (char === '\n' || char === '\r')) {
      result += '\\n';
    } else if (inString && char === '\t') {
      result += '\\t';
    } else {
      result += char;
    }
  }
  return result;
}

function extractJsonFieldsRegex(text: string): { text: string; recommendations: any[] } {
  const textMatch = text.match(/"text"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"|\s*\})/);
  const introText = textMatch ? textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
  
  const recsMatch = text.match(/"recommendations"\s*:\s*\[([\s\S]*)\]/);
  const recommendations: any[] = [];
  
  if (recsMatch) {
    const recsBlock = recsMatch[1];
    const objMatches = recsBlock.match(/\{[\s\S]*?\}(?=\s*,\s*\{|\s*\]|\s*$)/g) || [];
    for (const objStr of objMatches) {
      const getField = (fieldName: string) => {
        const re = new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)"(?=\\s*,|\\s*\\})`);
        const m = objStr.match(re);
        return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
      };
      
      const getArrayField = (fieldName: string) => {
        const re = new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\]`);
        const m = objStr.match(re);
        if (!m) return [];
        return m[1].split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, '').trim())
          .filter(Boolean);
      };

      const title = getField('title');
      if (title) {
        recommendations.push({
          title,
          category: getField('category') || 'hotplace',
          region: getField('region'),
          locationName: getField('locationName') || title,
          briefDesc: getField('briefDesc'),
          sourceLinks: getArrayField('sourceLinks'),
          fashionItems: [],
          modelImages: getArrayField('modelImages'),
        });
      }
    }
  }
  return { text: introText, recommendations };
}

export function normalizeCategory(cat: string): string {
  const clean = String(cat || '').trim().toLowerCase();
  if (/restaurant|cafe|cafes|food|dining|식당|맛집|카페|음식/.test(clean)) {
    return 'restaurants';
  }
  if (/hotplace|play|date|course|핫플|데이트|놀거리/.test(clean)) {
    return 'hotplace';
  }
  if (/spot|spots|photo|view|사진|명소|스팟/.test(clean)) {
    return 'spots';
  }
  if (/accommodation|stay|hotel|pension|resort|숙소|호텔|펜션|민박/.test(clean)) {
    return 'accommodation';
  }
  if (/ootd|fashion|style|cloth|clothes|wear|패션|옷|코디|스타일/.test(clean)) {
    return 'ootd';
  }
  if (/counseling|tips|tip|info|guide|꿀팁|정보/.test(clean)) {
    return 'counseling';
  }
  if (/freeboard|general|chat|board|자유|잡담/.test(clean)) {
    return 'freeboard';
  }
  return 'hotplace';
}

function parseTextBulletPoints(rawText: string): { text: string; recommendations: any[] } {
  const lines = rawText.split('\n');
  const recommendations: any[] = [];
  let introLines: string[] = [];
  let currentRec: any = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const bulletMatch = trimmed.match(/^(?:-|\*|\d+\.)\s*(?:\[([^\]]+)\]|([^\(\:\n]+?))\s*(?:\(([^)]+)\))?\s*(?:[:：]|\s+-\s+)\s*(.*)/i);
    
    if (bulletMatch) {
      const title = (bulletMatch[1] || bulletMatch[2] || '').trim();
      const desc = (bulletMatch[4] || '').trim();
      const region = (bulletMatch[3] || '').trim();
      
      if (title && title.length < 50) {
        if (currentRec) {
          recommendations.push(currentRec);
        }
        currentRec = {
          title,
          category: 'hotplace',
          region,
          locationName: title,
          briefDesc: desc,
          sourceLinks: [],
          fashionItems: [],
          modelImages: [],
        };
      }
    } else {
      const simpleBullet = trimmed.match(/^(?:-|\*|\d+\.)\s*(.*)/);
      if (simpleBullet) {
        const text = simpleBullet[1].trim();
        if (text && text.length < 50) {
          if (currentRec) {
            recommendations.push(currentRec);
          }
          currentRec = {
            title: text,
            category: 'hotplace',
            region: '',
            locationName: text,
            briefDesc: '',
            sourceLinks: [],
            fashionItems: [],
            modelImages: [],
          };
          continue;
        }
      }

      if (!currentRec) {
        if (!trimmed.startsWith('#') && trimmed.length > 5) {
          introLines.push(trimmed);
        }
      } else {
        if (trimmed.length > 2 && !trimmed.match(/^(?:-|\*|\d+\.)/)) {
          currentRec.briefDesc = (currentRec.briefDesc ? currentRec.briefDesc + '\n' : '') + trimmed;
        }
      }
    }
  }
  if (currentRec) {
    recommendations.push(currentRec);
  }

  return {
    text: introLines.slice(0, 3).join(' '),
    recommendations,
  };
}

export function robustParseRecommendations(raw: string, userPrompt: string): { text: string; recommendations: any[] } {
  const cleanRaw = cleanThinkingTags(raw);
  
  let jsonStr = cleanRaw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = jsonStr.replace(/[\u200B-\u200D\uFEFF]/g, "").match(/\{[\s\S]+\}/);
  
  let parsedText = '';
  let recommendations: any[] = [];
  
  if (match) {
    const candidateJson = match[0];
    try {
      const parsed = JSON.parse(candidateJson);
      parsedText = String(parsed.text || '');
      recommendations = parsed.recommendations || [];
    } catch (e) {
      console.warn("Standard JSON parse failed, trying repaired JSON parse", e);
      try {
        const repaired = repairJsonString(candidateJson);
        const parsed = JSON.parse(repaired);
        parsedText = String(parsed.text || '');
        recommendations = parsed.recommendations || [];
      } catch (err2) {
        console.warn("Repaired JSON parse failed, trying regex fallback", err2);
        try {
          const regexExtracted = extractJsonFieldsRegex(candidateJson);
          parsedText = regexExtracted.text;
          recommendations = regexExtracted.recommendations;
        } catch (err3) {
          console.warn("Regex fallback failed", err3);
        }
      }
    }
  }

  if (!recommendations || recommendations.length === 0) {
    console.info("No recommendations parsed from JSON. Falling back to bullet points parsing.");
    const bulletParsed = parseTextBulletPoints(cleanRaw);
    parsedText = bulletParsed.text;
    recommendations = bulletParsed.recommendations;
  }

  return {
    text: parsedText || '추천 목록입니다! 🎉',
    recommendations: recommendations || [],
  };
}

export async function generateRecommendations(
  userPrompt: string,
  history: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
  options: { forceCloud?: boolean; onStep?: (step: string) => void } = {},
): Promise<{ text: string; recommendations: RecommendationItem[]; source?: string }> {
  const systemContext = `${APP_CONTEXT}

${getCurrentDateContext()}
사용자가 특정 월이나 계절을 언급하면 반드시 해당 시기에 적합한 내용을 추천하세요.

당신은 동전커피 앱의 AI 루이입니다. 이름은 루이입니다.
사용자 요청에 따라 적절한 카테고리로 3~5개 추천해주세요.

## 카테고리 분류 규칙
- 맛집/음식점 → "restaurants"
- 핫플/놀거리/데이트코스 → "hotplace"
- 사진 명소 → "spots"
- 숙소/호텔/펜션 → "accommodation"
- 패션/옷/코디/스타일 → "ootd"
- 꿀팁/생활정보/유용한정보 → "counseling"
- 자유게시판/이슈/유머/잡담 → "freeboard"

## 장소 카테고리(restaurants, hotplace, spots, accommodation) 규칙
1. 실제 검색 가능한 장소, 상권, 거리, 권역, 상호 후보를 넓게 추천하세요. 불확실한 세부 주소와 좌표는 추측하지 마세요.
2. "title"에는 구체적인 상호명+지역명을 함께 넣으세요. 예: "성수동 탬버린즈", "제주 애월 카페 귤꽃다락", "부산 해운대 광안리 해변".
3. "locationName"에는 실제 상호명 또는 지역명+장소명을 넣으세요. 주소 직접 작성은 금지. 예: "탬버린즈", "애월 귤꽃다락", "광안리 해변". 모호한 키워드("감성 카페", "핫플", "인생샷")는 금지!
4. "mapUrl"과 "sourceLinks"는 확실한 링크가 있을 때만 넣고, 애매하면 빈 값으로 두세요. 시스템이 자동으로 보강합니다.

## 패션(ootd) 규칙 ★ 남성 전용 ★
- 이 모임은 남자 회원만 있습니다. 반드시 남성 코디만 추천하세요.
- 사용자가 계절/월을 언급하면 반드시 해당 시기에 적합한 아이템만 추천하세요. 예: 6월 → 반팔, 반바지, 린넨, 샌들 등 여름 아이템만.
- title에 계절을 명시하세요 (예: "여름 시티보이 린넨 코디", "겨울 미니멀 패딩 코디")
- briefDesc: **패션 매거진 수준의 상세한 스타일링 가이드**를 작성하세요! 반드시 아래 구성을 따르세요:
  1) 코디 컨셉 소개 (어떤 분위기/상황에 어울리는지 2~3문장)
  2) 각 아이템별 선택 이유와 스타일링 팁 (왜 이 색상/핏/소재를 골랐는지)
  3) 체형별 착용 팁 (마른 체형, 보통 체형, 큰 체형 각각)
  4) 계절/날씨에 따른 레이어링 팁
  5) 이 코디와 어울리는 악세사리/신발 추천
  이모지를 적절히 사용하고, 마크다운 **굵은글씨**와 소제목(##)을 활용하여 읽기 좋게 작성하세요. 최소 500자 이상 작성!
- locationName: 빈 문자열
- sourceLinks: 빈 문자열
- fashionItems: 코디에 사용된 개별 아이템 배열 (3~5개). 확실한 상품명이 있으면 브랜드와 상품명을 쓰고, 확실하지 않으면 검색 가능한 보편 아이템명과 브랜드 후보를 쓰세요. link와 imageUrl은 빈 문자열로 두면 시스템이 보강합니다.
- modelImages: 빈 배열 []로 두세요. 시스템이 무신사에서 실제 모델 착용 사진을 자동 검색합니다.

## 꿀팁(counseling) 규칙
- title: 꿀팁 제목
- briefDesc: 꿀팁 내용 요약 + 필요한 도구/제품이 있으면 구매 링크 포함
- sourceLinks: 관련 유튜브 영상 URL이나 제품 구매 링크 배열

## 자유게시판(freeboard) 규칙
- title: 이슈/유머/영상 제목
- briefDesc: 간략한 설명
- sourceLinks: 관련 유튜브 URL 등

반드시 다음 JSON 형식으로 응답하세요:
{
  "text": "친근한 인트로 멘트 (1~2문장, 이모지 포함)",
  "recommendations": [
    {
      "title": "제목",
      "category": "restaurants|hotplace|spots|accommodation|ootd|counseling|freeboard",
      "region": "지역명 (장소일 때만, 아니면 빈 문자열)",
      "locationName": "장소일 때 상호명, 아니면 빈 문자열",
      "mapUrl": "",
      "sourceLinks": ["관련 링크들"],
      "briefDesc": "2~5문장 설명 (이모지 포함, 친근하게)",
      "fashionItems": [{"name": "아이템명", "brand": "브랜드", "link": "", "imageUrl": ""}],
      "modelImages": []
    }
  ]
}

잘못된 예: "locationName": "인천광역시 중구 우현로49번길 3" ← 주소 직접 작성 금지!
잘못된 예: "locationName": "성수동 감성 카페" ← 모호한 키워드! 실제 상호명을 넣으세요.
올바른 예: "locationName": "신포닭강정 본점" ← 상호명만!
올바른 예: "locationName": "성수동 카페 탬버린즈" ← 지역명+상호명!`;

  const messages = [
    ...history.slice(-6).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: userPrompt }] },
  ];

  let raw = '';
  let aiSource = '';
  try {
    // AI 루이 추천: medium 티어. 장소/패션 후보는 검색 도구와 폴백 카드로 보강하고 3.5 호출은 아낀다.
    options.onStep?.('Gemini 검색 도구로 지역과 카테고리 후보를 찾는 중입니다.');
    const data = await retryGemini({
      system_instruction: { parts: [{ text: systemContext }] },
      contents: messages,
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
    }, signal, 'medium', { skipLocal: true });
    aiSource = formatAiSource(data);
    options.onStep?.(`응답을 추천 카드 JSON으로 변환하는 중입니다. (${aiSource || 'Gemini'})`);
    raw = extractText(data).trim();
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    options.onStep?.('AI 사용량 또는 네트워크 문제로 기본 후보 카드를 구성하는 중입니다.');
    return buildFallbackResponse(userPrompt, error?.message);
  }

  let text = '추천 결과입니다! 🎉';
  let recommendations: RecommendationItem[] = [];

  try {
    const parsedData = robustParseRecommendations(raw, userPrompt);
    text = parsedData.text || text;
    recommendations = (parsedData.recommendations || []).map((r: any) => {
      const placeName = String(r.title || '').trim();
      const region = String(r.region || detectFallbackRegion(userPrompt) || '').trim();
      const locName = String(r.locationName || placeName).trim();
      const normalizedCategory = normalizeCategory(String(r.category || 'hotplace'));
      return {
        title: placeName,
        category: normalizedCategory,
        region,
        locationName: locName,
        mapUrl: '',
        sourceLinks: Array.isArray(r.sourceLinks) ? r.sourceLinks : [],
        briefDesc: String(r.briefDesc || ''),
        imageUrls: Array.isArray(r.modelImages) && r.modelImages.length > 0 ? r.modelImages.map(u => String(u).includes('pollinations.ai') ? `${u}&seed=${Math.floor(Math.random() * 100000)}` : String(u)) : getCategoryImages(normalizedCategory, 2),
        imageUrl: Array.isArray(r.modelImages) && r.modelImages.length > 0 ? (String(r.modelImages[0]).includes('pollinations.ai') ? `${r.modelImages[0]}&seed=${Math.floor(Math.random() * 100000)}` : String(r.modelImages[0])) : (getCategoryImages(normalizedCategory, 1)[0] || ''),
        fashionItems: Array.isArray(r.fashionItems) ? r.fashionItems : [],
        modelImages: Array.isArray(r.modelImages) ? r.modelImages.map(u => String(u).includes('pollinations.ai') ? `${u}&seed=${Math.floor(Math.random() * 100000)}` : String(u)) : [],
      };
    });
  } catch (e) {
    console.error("Failed mapping robust recommendations", e);
    text = raw.slice(0, 300) || '죄송해요, 잠시 후 다시 시도해주세요.';
  }

  if (recommendations.length === 0) {
    options.onStep?.('추천 카드가 비어 있어 기본 후보 풀로 보강하는 중입니다.');
    return buildFallbackResponse(userPrompt);
  }

  options.onStep?.(`추천 후보 ${recommendations.length}개를 정리했습니다.`);
  return { text, recommendations, source: aiSource };
}

export async function generateReply(
  postTitle: string,
  postContent: string,
  userComment: string,
  signal?: AbortSignal,
  options: {
    isOperator?: boolean;
    forceLocal?: boolean;
    localModel?: string;
    skipLocal?: boolean;
  } = {},
): Promise<string | null> {
  try {
    const prompt = `${APP_CONTEXT}

당신은 동전커피 앱의 AI 루이입니다. 이름은 루이입니다.
게시물: "${postTitle.slice(0, 60)}"
내용: ${postContent.slice(0, 200)}

사용자 댓글: "${userComment.slice(0, 150)}"

위 댓글에 대해 친근하고 따뜻한 답변을 2줄 이내로 작성하세요. 이모지 적극 활용.`;
    // 댓글 답변: low 티어 (짧고 빠른 응답)
    const skipLocal = options.skipLocal !== undefined ? options.skipLocal : !options.isOperator;
    const data = await retryGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.8, maxOutputTokens: 200 },
    }, signal, 'low', {
      skipLocal,
      forceLocal: options.forceLocal,
      localModel: options.localModel,
    });
    const reply = extractText(data).trim();
    return reply || null;
  } catch {
    return null;
  }
}

export async function generateFullBlog(
  placeName: string,
  locationHint = '',
  signal?: AbortSignal,
  options: { forceCloud?: boolean } = {},
): Promise<string> {
  try {
    const prompt = `${APP_CONTEXT}

당신은 동전커피 앱의 AI 루이입니다. 이름은 루이입니다.
이하의 입장에서 "${placeName}"${locationHint ? ` (${locationHint})` : ''}에 대한 블로그형 상세 리뷰를 작성해주세요.

조건:
- 800자 이상 2000자 이하
- 마크다운 포맷 (## 소제목, - 목록 등)
- 이모지 포함
- 진짜 방문한 듯 친근한 말투
- 주소, 운영시간, 필수 메뉴, 분위기, 주차, 팁, 추천 포인트, 방문 팁 등 풍부하게 포함`;
    // 블로그 상세 리뷰: 맛집 추천과 유사한 등급 처리하며 힌트 유무에 따라 티어 격상
    const hasHeavyContext = locationHint.trim().length > 10;
    const chosenTier = getTierForCategory('restaurants', hasHeavyContext);

    const data = await retryGemini({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.75, maxOutputTokens: 2000 },
    }, signal, chosenTier, { skipLocal: options.forceCloud });
    return extractText(data).trim();
  } catch {
    return '';
  }
}

export async function generateDailyCategoryPost(
  channelId: string,
  label: string,
  topic: string,
  signal?: AbortSignal,
): Promise<{
  title: string;
  content: string;
  locationName: string;
  region: string;
  mapUrl: string;
  sourceLinks: string[];
  fashionItems?: any[];
  modelImages?: string[];
}> {
  const isOotd = channelId === 'ootd';
  const prompt = `${APP_CONTEXT}

당신은 동전커피 앱의 최고 수준 AI 매거진 에디터 겸 AI 루이입니다. 이름은 루이입니다.
카테고리: ${label} (${channelId})
주제: ${topic}

위 주제에 대해 오늘의 추천 게시물을 작성해주세요.
⚠️ 매우 중요한 지시사항:
- 가상의 URL, 존재하지 않는 유튜브 링크, 가짜 상품 링크를 절대 만들지 마세요.
- Google Search 도구를 반드시 사용하여 실제로 존재하는 최신/인기 유튜브 영상 링크나 실제 상품 페이지 링크를 본문에 포함해야 합니다.
- 유튜브 링크는 반드시 'https://www.youtube.com/watch?v=실제ID' 형태여야 합니다.
${isOotd ? `
- ★ 남성 패션(OOTD) 전용 지시사항:
  1. 반드시 무신사 스냅(https://www.musinsa.com/snap/main/recommend)에서 최신 남성 코디 게시물을 검색하거나 참고하세요.
  2. 모델 이미지와 하단의 코디 착용 아이템 정보(브랜드, 상품명, 가격, 링크 등)를 완벽하게 쌍(Pair)으로 맞추어 정확하게 매치하여 가져와야 합니다. 절대 다른 스냅사진과 아이템 정보를 뒤섞거나 허구의 제품을 지어내지 마세요.
  3. "modelImages" 필드에는 해당 무신사 스냅에서 사용된 실제 모델 이미지 URL을 반드시 입력하세요.
  4. "fashionItems" 필드에는 해당 모델이 실제로 입고 있는 착용 아이템들의 정보(상품명, 브랜드, 구매처 링크, 이미지 URL 등)를 쌍으로 매칭하여 입력하세요. (아이템 이미지 URL도 무신사 등에서 실제 이미지 URL을 가져오거나, 없으면 빈 문자열로 두세요.)
  5. 착용 아이템의 구매처 링크는 실제로 존재하는 무신사 상품 페이지나 브랜드 공홈 링크로 입력해야 합니다.
` : ''}

JSON 형식으로만 응답 (다른 텍스트 없이):
{
  "title": "게시물 제목 (50자 이내, 이모지 포함)",
  "content": "본문 (마크다운 포맷, 사진/링크 포함, 400~1500자 분량, 잡지처럼 세련된 어조 또는 친근한 어조 활용)",
  "locationName": "장소명 (장소가 없으면 빈 문자열)",
  "region": "지역 (서울/부산/제주 등, 없으면 빈 문자열)",
  "mapUrl": "카카오맵/네이버맵/유튜브 등 대표 링크 (없으면 빈 문자열)",
  "sourceLinks": ["관련 유튜브 영상 링크", "구매처 링크 1", "기타 참고 링크"]${isOotd ? `,\n  "modelImages": ["실제 무신사 스냅 모델 이미지 URL"],\n  "fashionItems": [{"name": "아이템명", "brand": "브랜드", "link": "실제 상품 링크 URL", "imageUrl": "실제 상품 이미지 URL (없으면 빈 문자열)"}]` : ''}
}`;

  // 일괄 발행 게시물: 정규 AI 매거진 콘텐츠이므로 기본적으로 heavyContext=true 수준의 엄격한 추론을 카테고리별로 적용
  const chosenTier = getTierForCategory(channelId, true);

  const data = await retryGemini({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: { temperature: 0.8, maxOutputTokens: 1200 },
  }, signal, chosenTier);

  const raw = extractText(data).trim();

  let parsed: any = {};
  try {
    const jsonStr = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    const match = jsonStr.replace(/[\u200B-\u200D\uFEFF]/g, "").match(/\{[\s\S]+\}/);
    if (match) parsed = JSON.parse(match[0]);
  } catch {
    parsed = { title: `오늘의 ${label} 추천`, content: raw };
  }

  const resolvedLocationName = String(parsed.locationName || '');

  return {
    title: String(parsed.title || `오늘의 ${label} 추천`).slice(0, 100),
    content: String(parsed.content || '').slice(0, 3000),
    locationName: resolvedLocationName,
    region: String(parsed.region || '전국'),
    mapUrl: String(parsed.mapUrl || (resolvedLocationName
      ? `https://map.kakao.com/link/search/${encodeURIComponent(resolvedLocationName)}`
      : '')),
    sourceLinks: Array.isArray(parsed.sourceLinks) ? parsed.sourceLinks : [],
    fashionItems: isOotd && Array.isArray(parsed.fashionItems) ? parsed.fashionItems : [],
    modelImages: isOotd && Array.isArray(parsed.modelImages) ? parsed.modelImages : [],
  };
}
