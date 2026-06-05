import React, { useState } from 'react';

/**
 * 패션(OOTD) 전용 게시물 상세 뷰 — 무신사 상세페이지 스타일
 *
 * 구조:
 *   ┌─────────────────────────────┐
 *   │     모델 전신 사진 (메인)     │
 *   ├─────────────────────────────┤
 *   │  👔 아이템  [가로 스크롤]     │
 *   │  [img][img][img][img]       │
 *   ├─────────────────────────────┤
 *   │  🛒 구매 링크 버튼들          │
 *   ├─────────────────────────────┤
 *   │        상세 설명 텍스트        │
 *   └─────────────────────────────┘
 */

export interface FashionItem {
  imageUrl: string;
  brand: string;
  name: string;
  link: string;
}

interface FashionPostViewProps {
  title: string;
  content: string;
  /** 개별 아이템 사진 + 메타 */
  fashionItems?: FashionItem[];
  /** 모델 연출컷 (여러 장 가능) */
  modelImages?: string[];
  /** 기존 imageUrls 폴백용 */
  imageUrls?: string[];
  sourceLinks?: string[];
}

// 마크다운 내부 이미지를 파싱 (![alt](url) 패턴)
function extractMarkdownImages(content: string) {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const images: string[] = [];
  let match;
  while ((match = regex.exec(content)) !== null) {
    images.push(match[2]);
  }
  return images;
}

// content에서 패션 테이블 파싱 시도 (AI가 만드는 | 아이템 | 브랜드 | 가격 | 링크 | 형식)
function parseFashionTable(content: string): FashionItem[] {
  const lines = content.split('\n');
  const items: FashionItem[] = [];
  let headerFound = false;

  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // 헤더 행 감지 (아이템, 브랜드, 가격 등 키워드)
    if (!headerFound && (cells.some(c => /아이템|상의|하의|브랜드|가격|제품/i.test(c)))) {
      headerFound = true;
      continue;
    }
    // 구분선 (---) 건너뜀
    if (cells.every(c => /^[-:]+$/.test(c))) continue;

    if (headerFound && cells.length >= 2) {
      // 링크 추출
      const linkMatch = cells.join(' ').match(/https?:\/\/[^\s)]+/);
      items.push({
        imageUrl: '',
        name: cells[0] || '',
        brand: cells[1] || '',
        link: linkMatch ? linkMatch[0] : '',
      });
    }
  }
  return items;
}

const renderMarkdown = (text: string) => {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '') // 이미지 제거 (별도 표시)
    .replace(/\|[^\n]+\|/g, '') // 테이블 제거 (별도 표시)
    .replace(/^[-:|\s]+$/gm, '') // 테이블 구분선 제거
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold mt-3 mb-1 text-slate-800">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold mt-4 mb-2 text-slate-900">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-bold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote class="border-l-4 border-rose-300 pl-3 text-slate-600 italic my-2">$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-indigo-600 underline decoration-indigo-200 underline-offset-2 break-all">$1</a>')
    .replace(/\n\n/g, '</p><p class="mb-2">')
    .replace(/\n/g, '<br/>')
    .replace(/(<br\/>){3,}/g, '<br/><br/>') // 과도한 줄바꿈 정리
    .trim();
};

export function FashionPostView({ title, content, fashionItems, modelImages, imageUrls, sourceLinks }: FashionPostViewProps) {
  // 모델 이미지 결정: modelImages > content 내 이미지 > imageUrls
  const contentImages = extractMarkdownImages(content);
  const allModelImages = modelImages && modelImages.length > 0
    ? modelImages
    : contentImages.length > 0
      ? contentImages
      : (imageUrls || []).slice(0, 3);

  const [mainModelIndex, setMainModelIndex] = useState(0);

  // 아이템 결정: fashionItems > 테이블 파싱
  const items = fashionItems && fashionItems.length > 0
    ? fashionItems
    : parseFashionTable(content);

  return (
    <div className="space-y-4">
      {/* ① 모델 전신 사진 (메인 — 무신사 스타일 상단 전체 폭) */}
      {allModelImages.length > 0 && (
        <div className="relative rounded-xl overflow-hidden bg-slate-100 shadow-sm">
          <img
            src={allModelImages[mainModelIndex] || allModelImages[0]}
            alt={`${title} 스타일링 ${mainModelIndex + 1}`}
            referrerPolicy="no-referrer"
            className="w-full object-contain max-h-[600px] mx-auto bg-white"
          />
          {/* 화살표 네비게이션 */}
          {allModelImages.length > 1 && (
            <>
              <button
                onClick={() => setMainModelIndex(prev => (prev - 1 + allModelImages.length) % allModelImages.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-slate-700 shadow-md transition-all"
              >‹</button>
              <button
                onClick={() => setMainModelIndex(prev => (prev + 1) % allModelImages.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white/80 hover:bg-white rounded-full flex items-center justify-center text-slate-700 shadow-md transition-all"
              >›</button>
              <span className="absolute bottom-2 right-2 bg-black/50 text-white text-[10px] px-2 py-0.5 rounded-full font-bold">
                {mainModelIndex + 1} / {allModelImages.length}
              </span>
            </>
          )}
        </div>
      )}

      {/* ② 아이템 사진 — 가로 스크롤 (무신사 하단 아이템 바) */}
      {items.length > 0 && (
        <div>
          <p className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wide">👔 착용 아이템</p>
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x snap-mandatory custom-scrollbar">
            {items.map((item, i) => (
              <div
                key={i}
                className="flex-shrink-0 w-28 group cursor-pointer rounded-xl overflow-hidden bg-white border border-slate-200 shadow-sm transition-all hover:shadow-lg hover:border-indigo-300 snap-start"
                onClick={() => item.link && window.open(item.link, '_blank')}
              >
                {item.imageUrl ? (
                  <img src={item.imageUrl} alt={item.name} referrerPolicy="no-referrer"
                    className="w-full aspect-square object-cover" />
                ) : (
                  <div className="w-full aspect-square flex items-center justify-center bg-slate-50 text-slate-300">
                    <span className="text-3xl">👔</span>
                  </div>
                )}
                {/* 브랜드 + 이름 (항상 표시) */}
                <div className="px-2 py-1.5 space-y-0.5">
                  <p className="text-[10px] font-bold text-slate-700 truncate">{item.brand}</p>
                  <p className="text-[9px] text-slate-500 truncate">{item.name}</p>
                  {item.link && <p className="text-[9px] text-indigo-400 font-bold">구매하기 →</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ③ 구매 링크 카드 */}
      {items.some(it => it.link) && (
        <div className="bg-slate-50 rounded-xl border border-slate-100 p-3">
          <p className="text-[11px] font-bold text-slate-500 mb-2">🛒 구매 링크</p>
          <div className="flex flex-wrap gap-2">
            {items.filter(it => it.link).map((item, i) => {
              let favicon = '';
              try { favicon = `https://www.google.com/s2/favicons?domain=${new URL(item.link).hostname}&sz=32`; } catch {}
              return (
                <a
                  key={i}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-colors shadow-sm"
                >
                  {favicon && <img src={favicon} alt="" className="w-3.5 h-3.5 rounded" />}
                  {item.brand || item.name}
                  <span className="text-indigo-400">↗</span>
                </a>
              );
            })}
          </div>
        </div>
      )}

      {/* ④ 하단: 상세 설명 텍스트 */}
      <div
        className="text-slate-700 text-sm leading-relaxed prose prose-sm max-w-none"
        dangerouslySetInnerHTML={{ __html: '<p class="mb-2">' + renderMarkdown(content) + '</p>' }}
      />

      {/* sourceLinks 추가 */}
      {sourceLinks && sourceLinks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {sourceLinks.filter(u => u && !u.includes('kakao') && !u.includes('map.naver')).slice(0, 5).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
              className="text-[11px] font-bold bg-white border border-slate-200 text-slate-600 px-3 py-1.5 rounded-full hover:border-indigo-200 hover:text-indigo-600 transition-colors">
              참고 링크 {i + 1} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
