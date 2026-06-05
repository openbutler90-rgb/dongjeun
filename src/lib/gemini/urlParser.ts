// URL Parser for metadata extraction

export interface FetchedLinkInfo {
  url: string;
  type: 'youtube' | 'webpage' | 'navermap' | 'kakaomap' | 'unknown';
  title?: string;
  description?: string;
  imageUrl?: string;
  authorName?: string;
  raw?: string;
}

function detectUrlType(url: string): FetchedLinkInfo['type'] {
  if (/youtube\.com|youtu\.be/i.test(url)) return 'youtube';
  if (/map\.naver\.com/i.test(url)) return 'navermap';
  if (/map\.kakao\.com/i.test(url)) return 'kakaomap';
  if (/^https?:\/\//i.test(url)) return 'webpage';
  return 'unknown';
}

async function fetchYouTubeInfo(url: string): Promise<FetchedLinkInfo> {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = await res.json();
      return {
        url,
        type: 'youtube',
        title: data.title || '',
        description: `YouTube 영상 by ${data.author_name || ''}`,
        imageUrl: data.thumbnail_url || '',
        authorName: data.author_name || '',
      };
    }
  } catch {}
  return { url, type: 'youtube' };
}

function extractOgTags(html: string): { title: string; description: string; imageUrl: string } {
  const getMeta = (prop: string) => {
    const patterns = [
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return '';
  };
  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '';
  return {
    title: getMeta('og:title') || getMeta('twitter:title') || titleTag,
    description: getMeta('og:description') || getMeta('description') || getMeta('twitter:description'),
    imageUrl: getMeta('og:image') || getMeta('twitter:image'),
  };
}

async function fetchWebpageInfo(url: string): Promise<FetchedLinkInfo> {
  // allorigins.win CORS 프록시 사용
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json();
      const html: string = data.contents || '';
      const og = extractOgTags(html);
      const plainText = html
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);
      return {
        url,
        type: 'webpage',
        title: og.title,
        description: og.description || plainText.slice(0, 300),
        imageUrl: og.imageUrl,
        raw: plainText,
      };
    }
  } catch {}
  
  // jina.ai reader fallback
  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, { signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const text = await res.text();
      return {
        url,
        type: 'webpage',
        title: text.match(/^#+ (.+)/m)?.[1] || '',
        description: text.slice(0, 500),
        imageUrl: '',
        raw: text.slice(0, 1000),
      };
    }
  } catch {}
  return { url, type: 'webpage' };
}

export async function fetchLinkInfo(url: string): Promise<FetchedLinkInfo> {
  const type = detectUrlType(url.trim());
  if (type === 'youtube') return fetchYouTubeInfo(url);
  if (type === 'navermap' || type === 'kakaomap') return { url, type };
  if (type === 'webpage') return fetchWebpageInfo(url);
  return { url, type: 'unknown' };
}
