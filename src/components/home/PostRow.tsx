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

export function PostRow({ post, label }: { post: any; label?: string }) {
  const navigate = useNavigate();
  const category = CATEGORIES.find(c => c.id === post.channelId);
  const imageUrl = post.imageUrl || getCategoryFallbackImage(post.channelId);
  const handleClick = () => {
    sessionStorage.setItem('openPostId', post.id);
    navigate(`/channels/${post.channelId}`);
  };
  return (
    <div
      onClick={handleClick}
      className="group cursor-pointer flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2.5 hover:border-rose-200 hover:bg-rose-50/40 transition-colors"
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" loading="lazy" decoding="async" className="w-11 h-11 rounded-lg object-cover shrink-0 bg-slate-100" />
      ) : (
        <div className="w-11 h-11 rounded-lg bg-slate-100 flex items-center justify-center text-lg shrink-0">
          {category?.icon || '•'}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[10px] font-black text-slate-400">{label || category?.name}</span>
          {(post.commentsCount || 0) > 0 && <span className="text-[10px] font-bold text-rose-500">답글 {post.commentsCount}</span>}
        </div>
        <p className="text-sm font-bold text-slate-800 truncate group-hover:text-rose-600">{post.title}</p>
        <p className="text-xs text-slate-500 truncate">{stripText(post.content).slice(0, 42)}</p>
      </div>
    </div>
  );
}
