export function extractUrls(text = '') {
  return Array.from(new Set(text.match(/https?:\/\/[^\s<]+/g) || []));
}

function getYouTubeInfo(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtu.be')) {
      return { id: parsed.pathname.split('/').filter(Boolean)[0] || '', isShorts: false };
    }
    if (parsed.hostname.includes('youtube.com')) {
      if (parsed.pathname.startsWith('/shorts/')) {
        return { id: parsed.pathname.split('/').filter(Boolean)[1] || '', isShorts: true };
      }
      return { id: parsed.searchParams.get('v') || '', isShorts: false };
    }
  } catch {
    return { id: '', isShorts: false };
  }
  return { id: '', isShorts: false };
}

function getUrlMeta(url: string) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '').slice(0, 54);
    const ytInfo = getYouTubeInfo(url);
    return {
      host,
      title: ytInfo.id ? 'YouTube 영상' : path || host,
      favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=64`,
      youtubeId: ytInfo.id,
      isShorts: ytInfo.isShorts,
    };
  } catch {
    return { host: url, title: url, favicon: '', youtubeId: '', isShorts: false };
  }
}

export function LinkPreviewCard({ url, compact = false }: { url: string; compact?: boolean }) {
  const meta = getUrlMeta(url);

  if (meta.youtubeId && !compact) {
    return (
      <div className={`mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${meta.isShorts ? 'max-w-xs' : 'max-w-xl'}`}>
        <div className={`w-full bg-slate-100 ${meta.isShorts ? 'aspect-[9/16]' : 'aspect-video'}`}>
          <iframe
            className="h-full w-full"
            src={`https://www.youtube.com/embed/${encodeURIComponent(meta.youtubeId)}`}
            title="YouTube video"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 p-3 text-left hover:bg-slate-50"
          onClick={(event) => event.stopPropagation()}
        >
          {meta.favicon ? <img src={meta.favicon} alt="" className="h-7 w-7 rounded-lg bg-slate-100 p-1" /> : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-black text-slate-800">YouTube에서 보기</span>
            <span className="block truncate text-[10px] font-bold text-slate-400">{meta.host}</span>
          </span>
          <span className="text-xs font-black text-indigo-400">열기</span>
        </a>
      </div>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white/90 p-2 text-left text-slate-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-indigo-50 ${compact ? 'max-w-[240px]' : 'max-w-md'}`}
      onClick={(event) => event.stopPropagation()}
    >
      {meta.favicon ? <img src={meta.favicon} alt="" className="h-7 w-7 rounded-lg bg-slate-100 p-1" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-black text-slate-800">{meta.title}</span>
        <span className="block truncate text-[10px] font-bold text-slate-400">{meta.host}</span>
      </span>
      <span className="text-xs font-black text-indigo-400">열기</span>
    </a>
  );
}
