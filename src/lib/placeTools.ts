export interface ResolvedPlace {
  keyword: string;
  name: string;
  address: string;
  roadAddress: string;
  lat: number;
  lng: number;
  kakaoMapUrl: string;
  naverMapUrl: string;
  source: 'kakao' | 'osm' | 'link-only';
}

declare global {
  interface Window {
    kakao?: any;
  }
}

const KAKAO_SDK_ID = 'kakao-map-sdk';
const KAKAO_MAP_KEY = import.meta.env.VITE_KAKAO_MAP_KEY || '';

export function buildKakaoSearchUrl(keyword: string) {
  return `https://map.kakao.com/?q=${encodeURIComponent(keyword.trim())}`;
}

export function buildNaverSearchUrl(keyword: string) {
  return `https://map.naver.com/p/search/${encodeURIComponent(keyword.trim())}`;
}

export function buildNaverPhotoUrl(keyword: string, sourceUrl = '') {
  const cleanSource = sourceUrl.trim();
  if (/^https?:\/\//i.test(cleanSource)) {
    try {
      const url = new URL(cleanSource);
      if (url.hostname.includes('map.naver.com')) {
        url.searchParams.set('placePath', '/photo');
        return url.toString();
      }
    } catch {
      // Fall back to a photo-tab search URL below.
    }
  }

  return `${buildNaverSearchUrl(keyword)}?placePath=/photo`;
}

export function getCategoryFallbackImage(channelId = '') {
  const fallbackMap: Record<string, string> = {
    notice: '/category-fallbacks/notice.jpg',
    meetings: '/category-fallbacks/meetings.jpg',
    hotplace: '/category-fallbacks/hotplace.jpg',
    restaurants: '/category-fallbacks/restaurants.jpg',
    spots: '/category-fallbacks/spots.jpg',
    accommodation: '/category-fallbacks/accommodation.jpg',
    freeboard: '/category-fallbacks/freeboard.jpg',
    ootd: '/category-fallbacks/ootd.jpg',
    counseling: '/category-fallbacks/counseling.jpg',
    inquiries: '/category-fallbacks/inquiries.jpg',
  };
  return fallbackMap[channelId] || '';
}

export function isDirectImageUrl(url: string) {
  return /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url.trim());
}

const TRUSTED_PLACE_IMAGE_HOSTS = [
  'blogfiles.naver.net',
  'postfiles.pstatic.net',
  'mblogthumb-phinf.pstatic.net',
  'ldb-phinf.pstatic.net',
  'pup-review-phinf.pstatic.net',
  'shopping-phinf.pstatic.net',
  'shop-phinf.pstatic.net',
  'kakaocdn.net',
  'tripadvisor',
  'res.cloudinary.com',
  'cloudinary.com',
  'pollinations.ai',
  'img.youtube.com',
  'i.ytimg.com',
];

const SCREENSHOT_OR_MAP_TOKENS = [
  'image.thum.io',
  'screenshot',
  'screenshotmachine',
  'urlbox',
  'microlink',
  'htmlcsstoimage',
  'page2images',
  'map.naver.com',
  'map.kakao.com',
  'maps.google.',
  'maps.gstatic.',
  'googleusercontent.com/maps',
  'staticmap',
  '/map/tile',
  '/map/tile/',
  '/tiles/',
  'ssl.pstatic.net/static/common',
  'ssl.pstatic.net/static/maps',
];

function decodeRepeated(value: string, limit = 3) {
  let current = value;
  for (let i = 0; i < limit; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

export function isBlockedPreviewImage(url = '') {
  const lower = decodeRepeated(url).toLowerCase();
  return SCREENSHOT_OR_MAP_TOKENS.some(token => lower.includes(token));
}

export function isRealPlacePhotoUrl(url = '') {
  const cleanUrl = url.trim().replace(/&amp;/g, '&');
  if (!cleanUrl.startsWith('https://')) return false;
  if (isBlockedPreviewImage(cleanUrl)) return false;

  const decoded = decodeRepeated(cleanUrl).toLowerCase();
  if (decoded.includes('search.pstatic.net')) {
    return true;
  }

  return TRUSTED_PLACE_IMAGE_HOSTS.some(host => decoded.includes(host))
    && /\.(?:jpe?g|png|webp|gif)(?:\?|$)/i.test(decoded);
}

export function usableImageUrl(url = '') {
  const cleanUrl = url.trim().replace(/&amp;/g, '&');
  if (!cleanUrl) return '';
  // ✅ 카테고리 폴백, AI 집사 이미지는 비교 없이 허용
  if (cleanUrl.startsWith('/category-fallbacks/') || cleanUrl.startsWith('/ai-butler')) return cleanUrl;
  // ✅ Cloudinary 업로드 이미지 직접 허용 (확장자 없어도 통과)
  if (
    cleanUrl.startsWith('https://res.cloudinary.com/') ||
    cleanUrl.startsWith('https://cloudinary.com/')
  ) return cleanUrl;
  // ✅ YouTube 썸네일 직접 허용
  if (
    cleanUrl.startsWith('https://img.youtube.com/') ||
    cleanUrl.startsWith('https://i.ytimg.com/')
  ) return cleanUrl;
  // ✅ Pollinations AI 이미지 직접 허용
  if (cleanUrl.startsWith('https://image.pollinations.ai/')) return cleanUrl;
  return isRealPlacePhotoUrl(cleanUrl) ? cleanUrl : '';
}

export function firstUsableImageUrl(...groups: Array<string | string[] | undefined | null>) {
  for (const group of groups) {
    const candidates = Array.isArray(group) ? group : group ? [group] : [];
    for (const candidate of candidates) {
      const usable = usableImageUrl(candidate);
      if (usable) return usable;
    }
  }
  return '';
}

function collectCandidateUrls(text: string) {
  const candidates = new Set<string>();
  const addMatches = (source: string) => {
    const directMatches = source.match(/https:\/\/[^\s)\]"'<>]+\.(?:jpg|jpeg|png|webp|gif)(?:\?[^\s)\]"'<>]+)?/gi) || [];
    directMatches.forEach(url => candidates.add(url.replace(/&amp;/g, '&')));

    const proxyMatches = source.match(/https:\/\/search\.pstatic\.net\/(?:common|sunny)\/[^\s)\]"'<>]+/gi) || [];
    proxyMatches.forEach(url => candidates.add(url.replace(/&amp;/g, '&')));
  };

  addMatches(text);
  addMatches(decodeRepeated(text));
  for (const url of Array.from(candidates)) {
    try {
      const parsed = new URL(url);
      const src = parsed.searchParams.get('src');
      if (src) {
        const decodedSrc = decodeRepeated(src);
        candidates.add(decodedSrc);
      }
    } catch {
      // Ignore malformed candidates.
    }
  }
  return Array.from(candidates);
}

function extractImageUrlsFromText(text: string) {
  return collectCandidateUrls(text)
    .map(url => usableImageUrl(url))
    .filter(Boolean);
}

export async function searchNaverPlaceImages(keyword: string, signal?: AbortSignal): Promise<string[]> {
  const normalized = keyword.trim().replace(/\s+/g, ' ');
  if (!normalized) return [];

  try {
    const response = await fetch(`/api/place/naver-images?query=${encodeURIComponent(normalized)}`, { signal });
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json();
      const apiImages: string[] = Array.isArray(data?.images)
        ? data.images.map((url: string) => usableImageUrl(url)).filter((url: string) => Boolean(url))
        : [];
      if (apiImages.length > 0) return Array.from(new Set(apiImages)).slice(0, 8);
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
  }

  const naverImageUrl = `https://search.naver.com/search.naver?where=image&query=${encodeURIComponent(normalized)}`;
  const readerUrl = `https://r.jina.ai/${naverImageUrl}`;

  try {
    const response = await fetch(readerUrl, { signal });
    if (!response.ok) return [];
    const text = await response.text();
    return Array.from(new Set(extractImageUrlsFromText(text))).slice(0, 8);
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

const KOREAN_REGION_PATTERN = /(서울특별시|서울|부산광역시|부산|대구광역시|대구|인천광역시|인천|광주광역시|광주|대전광역시|대전|울산광역시|울산|세종특별자치시|세종|경기도|경기|강원특별자치도|강원도|강원|충청북도|충북|충청남도|충남|전북특별자치도|전라북도|전북|전라남도|전남|경상북도|경북|경상남도|경남|제주특별자치도|제주)/;

export function splitKoreanPlaceAddress(...parts: Array<string | undefined | null>) {
  const text = parts
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return { placeName: '', address: '', region: '' };

  const match = text.match(KOREAN_REGION_PATTERN);
  const region = detectKoreanRegion(text);
  if (!match || match.index === undefined) {
    return { placeName: text, address: '', region };
  }

  const placeName = text.slice(0, match.index).trim();
  let address = text.slice(match.index).trim();
  if (region) {
    const trailingRegion = new RegExp(`\\s+(?:${REGION_ALIASES.find(([r]) => r === region)?.[1].join('|') || region})$`);
    address = address.replace(trailingRegion, '').trim();
  }

  return {
    placeName,
    address,
    region: detectKoreanRegion(address) || region,
  };
}

const REGION_ALIASES: Array<[string, string[]]> = [
  ['서울', ['서울', '서울특별시']],
  ['부산', ['부산', '부산광역시']],
  ['대구', ['대구', '대구광역시']],
  ['인천', ['인천', '인천광역시']],
  ['광주', ['광주', '광주광역시']],
  ['대전', ['대전', '대전광역시']],
  ['울산', ['울산', '울산광역시']],
  ['세종', ['세종', '세종특별자치시']],
  ['경기', ['경기', '경기도']],
  ['강원', ['강원', '강원특별자치도']],
  ['충북', ['충북', '충청북도']],
  ['충남', ['충남', '충청남도']],
  ['전북', ['전북', '전라북도', '전북특별자치도']],
  ['전남', ['전남', '전라남도']],
  ['경북', ['경북', '경상북도']],
  ['경남', ['경남', '경상남도']],
  ['제주', ['제주', '제주특별자치도']],
];

export function detectKoreanRegion(...parts: Array<string | undefined | null>) {
  const text = parts.filter(Boolean).join(' ');
  for (const [region, aliases] of REGION_ALIASES) {
    if (aliases.some(alias => text.includes(alias))) return region;
  }
  return '';
}

export function imageFromUserLink(url: string) {
  const cleanUrl = url.trim();
  return usableImageUrl(cleanUrl);
}

function toResolvedLinkOnly(keyword: string): ResolvedPlace {
  return {
    keyword,
    name: keyword,
    address: keyword,
    roadAddress: '',
    lat: 0,
    lng: 0,
    kakaoMapUrl: `https://map.kakao.com/?q=${encodeURIComponent(keyword.trim())}`,
    naverMapUrl: buildNaverSearchUrl(keyword),
    source: 'link-only',
  };
}

// ✅ 지역 대표 좌표 캐시 (성수동 → {lat: 37.544, lng: 127.056})
const regionCenterCache = new Map<string, { lat: number; lng: number }>();

export async function getRegionCenter(regionName: string): Promise<{ lat: number; lng: number } | null> {
  const key = (regionName || '').trim();
  if (key.length < 2) return null;
  if (regionCenterCache.has(key)) return regionCenterCache.get(key)!;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(key)}&format=json&limit=1&accept-language=ko&countrycodes=kr`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!response.ok) return null;
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0 && data[0].lat && data[0].lon) {
      const result = { lat: Number(data[0].lat), lng: Number(data[0].lon) };
      regionCenterCache.set(key, result);
      return result;
    }
  } catch {
    // Fail silently
  }
  return null;
}

function loadKakaoSdk(): Promise<boolean> {
  if (!KAKAO_MAP_KEY) return Promise.resolve(false);
  if (window.kakao?.maps?.services) return Promise.resolve(true);

  return new Promise((resolve) => {
    const existing = document.getElementById(KAKAO_SDK_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => {
        window.kakao?.maps?.load(() => resolve(!!window.kakao?.maps?.services));
      }, { once: true });
      existing.addEventListener('error', () => resolve(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = KAKAO_SDK_ID;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_MAP_KEY}&libraries=services&autoload=false`;
    script.async = true;
    script.onload = () => window.kakao?.maps?.load(() => resolve(!!window.kakao?.maps?.services));
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

async function searchKakaoPlace(keyword: string): Promise<ResolvedPlace | null> {
  const ready = await loadKakaoSdk();
  if (!ready || !window.kakao?.maps?.services) return null;

  return new Promise((resolve) => {
    const places = new window.kakao.maps.services.Places();
    places.keywordSearch(keyword, (results: any[], status: string) => {
      if (status !== window.kakao.maps.services.Status.OK || !results?.length) {
        resolve(null);
        return;
      }
      const parsedKeyword = splitKoreanPlaceAddress(keyword);
      const expectedRegion = parsedKeyword.region || detectKoreanRegion(keyword);
      const expectedName = (parsedKeyword.placeName || keyword)
        .replace(KOREAN_REGION_PATTERN, '')
        .replace(/\s+/g, '')
        .trim();
      const scoreResult = (item: any) => {
        const haystack = `${item.place_name || ''} ${item.road_address_name || ''} ${item.address_name || ''}`;
        const compactName = String(item.place_name || '').replace(/\s+/g, '');
        let score = 0;
        if (expectedRegion && detectKoreanRegion(haystack) === expectedRegion) score += 80;
        if (expectedRegion && haystack.includes(expectedRegion)) score += 20;
        if (expectedName && compactName.includes(expectedName)) score += 50;
        if (expectedName && expectedName.includes(compactName)) score += 30;
        if (item.road_address_name) score += 5;
        return score;
      };
      const best = [...results].sort((a, b) => scoreResult(b) - scoreResult(a))[0];
      const name = best.place_name || keyword;
      const address = best.address_name || '';
      const roadAddress = best.road_address_name || '';
      const lat = Number.parseFloat(best.y) || 0;
      const lng = Number.parseFloat(best.x) || 0;
      const searchKeyword = `${name} ${roadAddress || address}`.trim();
      resolve({
        keyword,
        name,
        address,
        roadAddress,
        lat,
        lng,
        kakaoMapUrl: best.place_url || `https://map.kakao.com/link/to/${encodeURIComponent(name)},${lat},${lng}`,
        naverMapUrl: buildNaverSearchUrl(searchKeyword),
        source: 'kakao',
      });
    }, { size: 10 });
  });
}

async function searchKakaoAddress(addressKeyword: string): Promise<ResolvedPlace | null> {
  const ready = await loadKakaoSdk();
  if (!ready || !window.kakao?.maps?.services) return null;

  return new Promise((resolve) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(addressKeyword, (results: any[], status: string) => {
      if (status !== window.kakao.maps.services.Status.OK || !results?.length) {
        resolve(null);
        return;
      }
      const best = results[0];
      const roadAddress = best.road_address?.address_name || '';
      const address = best.address?.address_name || best.address_name || '';
      const lat = Number.parseFloat(best.y) || 0;
      const lng = Number.parseFloat(best.x) || 0;
      const resolvedAddress = roadAddress || address || addressKeyword;
      resolve({
        keyword: addressKeyword,
        name: resolvedAddress,
        address,
        roadAddress,
        lat,
        lng,
        kakaoMapUrl: `https://map.kakao.com/link/to/${encodeURIComponent(resolvedAddress)},${lat},${lng}`,
        naverMapUrl: buildNaverSearchUrl(resolvedAddress),
        source: 'kakao',
      });
    });
  });
}

async function searchOsmPlace(keyword: string): Promise<ResolvedPlace | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(keyword)}&format=json&limit=1&accept-language=ko&countrycodes=kr`,
      { headers: { 'User-Agent': 'DongJeonCoffee Community App (contact@dongjeon.kr)' } },
    );
    const data = await response.json();
    if (!data?.[0]) return null;

    const displayName = String(data[0].display_name || '');
    const lat = Number.parseFloat(data[0].lat) || 0;
    const lng = Number.parseFloat(data[0].lon) || 0;
    if (!lat || !lng) return null;

    return {
      keyword,
      name: keyword,
      address: displayName,
      roadAddress: displayName,
      lat,
      lng,
      kakaoMapUrl: `https://map.kakao.com/link/to/${encodeURIComponent(keyword)},${lat},${lng}`,
      naverMapUrl: buildNaverSearchUrl(keyword),
      source: 'osm',
    };
  } catch {
    return null;
  }
}

export async function resolveKoreanPlace(keyword: string): Promise<ResolvedPlace> {
  const normalized = keyword.trim().replace(/\s+/g, ' ');
  if (!normalized) return toResolvedLinkOnly('');

  try {
    const response = await fetch(`/api/place/resolve?query=${encodeURIComponent(normalized)}`);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('application/json')) {
      const data = await response.json();
      if (data?.ok && data?.lat && data?.lng) {
        return {
          keyword: normalized,
          name: data.name || normalized,
          address: data.address || '',
          roadAddress: data.roadAddress || '',
          lat: Number(data.lat) || 0,
          lng: Number(data.lng) || 0,
          kakaoMapUrl: data.kakaoMapUrl || buildKakaoSearchUrl(normalized),
          naverMapUrl: data.naverMapUrl || buildNaverSearchUrl(normalized),
          source: 'kakao',
        };
      }
    }
  } catch {
    // Fall back to Kakao JavaScript SDK below.
  }

  const kakaoResult = await searchKakaoPlace(normalized);
  if (kakaoResult) return kakaoResult;

  const addressResult = await searchKakaoAddress(normalized);
  if (addressResult) return addressResult;

  // 카카오 지도 API가 실패한 경우, 글로벌 OpenStreetMap 지오코더를 백업으로 사용해 전국 모든 읍/면/리 주소까지 좌표를 찾아냅니다.
  const osmResult = await searchOsmPlace(normalized);
  if (osmResult) return osmResult;

  return toResolvedLinkOnly(normalized);
}
