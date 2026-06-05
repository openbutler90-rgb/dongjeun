import React from 'react';
import { useNavigate } from 'react-router';
import { getCategoryFallbackImage } from '../../lib/placeTools';

const CATEGORIES = [
  { id: 'notice',        name: '공지사항',   icon: '📌' },
  { id: 'meetings',      name: '모임 일정',   icon: '🤝' },
  { id: 'meeting_board', name: '모임 사진',   icon: '📷' },
  { id: 'hotplace',      name: '핫플레이스', icon: '📍' },
  { id: 'restaurants',   name: '맛집',       icon: '🍽' },
  { id: 'spots',         name: '인생샷',     icon: '📸' },
  { id: 'accommodation', name: '숙소',       icon: '🏨' },
  { id: 'freeboard',     name: '자유게시판', icon: '💬' },
  { id: 'ootd',          name: '패션/OOTD',  icon: '👗' },
  { id: 'counseling',    name: '생활 꿀팁',  icon: '💡' },
  { id: 'inquiries',     name: '문의·신고',  icon: '🛟' },
  { id: 'webtoon',       name: '브로맨툰',   icon: '📖' },
];

const stripText = (value = '') =>
  value.replace(/<[^>]+>/g, '').replace(/#{1,3} /g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();

export function FeatureCard({ post }: { post?: any }) {
  const navigate = useNavigate();
  const category = post ? CATEGORIES.find(c => c.id === post.channelId) : null;
  const imageUrl = post?.imageUrl || (post ? getCategoryFallbackImage(post.channelId) : '');
  if (!post) {
    return (
      <div className="min-h-28 rounded-xl border border-dashed border-slate-200 bg-white/70 p-4 flex items-center justify-center text-xs font-bold text-slate-400">
        표시할 게시물이 없습니다.
      </div>
    );
  }
  const handleClick = () => {
    sessionStorage.setItem('openPostId', post.id);
    navigate(`/channels/${post.channelId}`);
  };
  return (
    <div
      onClick={handleClick}
      className="group cursor-pointer block overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-md transition-all"
    >
      {/* ✅ 모바일 최적화: 이미지 영역을 더 컴팩트하게 */}
      <div className="relative aspect-[16/10] bg-slate-50 overflow-hidden flex items-center justify-center p-1">
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain md:transition-transform md:duration-500 md:group-hover:scale-105" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-2xl">{category?.icon || '•'}</div>
        )}
      </div>
      <div className="p-2.5">
        <div className="mb-0.5 flex items-center gap-1">
          <span className="text-[10px]">{category?.icon}</span>
          <span className="text-[10px] font-black text-slate-400">{category?.name}</span>
          {(post.likesCount || 0) > 0 && <span className="ml-auto text-[10px] font-bold text-rose-500">♡ {post.likesCount}</span>}
        </div>
        <h3 className="line-clamp-1 text-xs font-black text-slate-900 group-hover:text-rose-600">{post.title}</h3>
        <p className="mt-0.5 line-clamp-1 text-[11px] leading-relaxed text-slate-500">{stripText(post.content).slice(0, 50)}</p>
      </div>
    </div>
  );
}
