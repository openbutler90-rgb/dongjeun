import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, orderBy, limit, onSnapshot, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Link, useNavigate } from 'react-router';
import { RightSidebar } from '../components/layout/RightSidebar';
import { getCategoryFallbackImage } from '../lib/placeTools';
import type { UserProfile } from '../stores/authStore';
import { getEffectiveLevel } from '../lib/profileDecorations';

const CATEGORIES = [
  { id: 'notice',        name: '공지사항',   icon: '📌', desc: '운영 공지' },
  { id: 'meetings',      name: '모임 일정',   icon: '🤝', desc: '정모와 번개' },
  { id: 'meeting_board', name: '모임 사진',   icon: '📷', desc: '모임 후기/사진' },
  { id: 'hotplace',      name: '핫플레이스', icon: '📍', desc: '요즘 뜨는 장소' },
  { id: 'restaurants',   name: '맛집',       icon: '🍽', desc: '추천 맛집' },
  { id: 'spots',         name: '인생샷',     icon: '📸', desc: '사진 명소' },
  { id: 'accommodation', name: '숙소',       icon: '🏨', desc: '숙소 리뷰' },
  { id: 'freeboard',     name: '자유게시판', icon: '💬', desc: '일상 대화' },
  { id: 'ootd',          name: '패션/OOTD',  icon: '👗', desc: '스타일 공유' },
  { id: 'counseling',    name: '생활 꿀팁',  icon: '💡', desc: '고민과 팁' },
  { id: 'inquiries',     name: '문의·신고',  icon: '🛟', desc: '비공개 문의' },
  { id: 'webtoon',       name: '브로맨툰',   icon: '📖', desc: 'AI 릴레이 웹툰' },
];

const PLACE_CHANNELS = ['hotplace', 'restaurants', 'spots', 'accommodation'];
const COMMUNITY_CHANNELS = ['meeting_board', 'freeboard', 'counseling'];
const TALK_CHANNELS = COMMUNITY_CHANNELS;

const bannerLinkTo = (channel?: string) => {
  if (!channel) return '';
  if (channel.startsWith('http')) return channel;
  if (channel === 'map') return '/map';
  return `/channels/${channel}`;
};

const stripText = (value = '') =>
  value.replace(/<[^>]+>/g, '').replace(/#{1,3} /g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();

function PostRow({ post, label }: { key?: React.Key; post: any; label?: string }) {
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

function FeatureCard({ post }: { key?: React.Key; post?: any }) {
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
      <div className="relative aspect-[16/10] bg-slate-50 overflow-hidden flex items-center justify-center p-1">
        {imageUrl ? (
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain md:transition-transform md:duration-500 md:group-hover:scale-105" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-2xl">{category?.icon || '•'}</div>
        )}
      </div>
      <div className="p-2 md:p-3">
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

function FeaturePanel({ title, posts, to }: { title: string; posts: any[]; to: string }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-slate-900">{title}</h2>
        <Link to={to} className="text-xs font-bold text-rose-500">더보기</Link>
      </div>
      <div className="grid grid-cols-2 gap-2 md:gap-3">
        {(posts.length ? posts.slice(0, 2) : [undefined, undefined]).map((post, index) => (
          <FeatureCard key={post?.id || `${title}-${index}`} post={post} />
        ))}
      </div>
    </section>
  );
}

function RankingCard({ users }: { users: Array<UserProfile & { id: string }> }) {
  const ranked = [...users]
    .filter(user => !user.isBanned && user.role !== 'guest' && !(user as any).isAnonymous)
    .sort((a, b) => getEffectiveLevel(b) - getEffectiveLevel(a) || Number(b.xp || 0) - Number(a.xp || 0))
    .slice(0, 5);
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-slate-900">랭킹</h2>
        <span className="text-[11px] font-bold text-slate-400">레벨 TOP 5</span>
      </div>
      <div className="space-y-2">
        {ranked.map((user, index) => (
          <Link key={user.id} to="/profile" className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 hover:bg-rose-50 transition-colors">
            <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${index === 0 ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-500'}`}>{index + 1}</span>
            {user.photoURL ? (
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="h-9 w-9 rounded-full object-cover bg-white" />
            ) : (
              <div className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ backgroundColor: user.profileColor || '#FF5C5C' }}>
                {user.nickname?.[0]?.toUpperCase() || '?'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-slate-800">{user.nickname}</p>
              <p className="text-[11px] font-bold text-slate-400">Lv.{getEffectiveLevel(user)}</p>
            </div>
          </Link>
        ))}
        {ranked.length === 0 && <p className="py-6 text-center text-sm font-bold text-slate-400">랭킹을 불러오는 중입니다.</p>}
      </div>
    </section>
  );
}

function MiniLinkBanners({ banners }: { banners: any[] }) {
  const fallbackLinks = [
    {
      href: import.meta.env.VITE_KAKAO_OPENCHAT || '',
      label: '오픈카톡',
      title: '공지와 실시간 대화방 바로가기',
      tone: 'border-yellow-100 from-yellow-50 via-amber-50 to-white text-yellow-800',
      badge: 'bg-yellow-100 text-yellow-700',
      image: '/logo.png?v=20260517b',
    },
    {
      href: import.meta.env.VITE_INSTAGRAM_URL || '',
      label: '인스타그램',
      title: '일상과 모임 사진 공유',
      tone: 'border-rose-100 from-rose-50 via-pink-50 to-white text-rose-800',
      badge: 'bg-rose-100 text-rose-700',
      image: '/logo.png?v=20260517b',
    },
    {
      href: import.meta.env.VITE_DISCORD_URL || '',
      label: '디스코드',
      title: '음성·자료 공유 공간',
      tone: 'border-indigo-100 from-indigo-50 via-violet-50 to-white text-indigo-800',
      badge: 'bg-indigo-100 text-indigo-700',
      image: '/ai-butler.png?v=20260518',
    },
  ];
  const links = banners.length
    ? banners.slice(0, 3).map(banner => ({
      href: bannerLinkTo(banner.linkChannel) || '#',
      label: banner.title || '링크 배너',
      title: banner.subtitle || banner.title || '바로가기',
      tone: 'border-slate-100 from-slate-50 via-white to-white text-slate-800',
      badge: 'bg-white/90 text-slate-700',
      image: banner.imageUrl,
    }))
    : fallbackLinks;

  return (
    <div className="grid gap-3">
      {links.map(link => (
        <a
          key={link.href}
          href={link.href}
          target={link.href.startsWith('http') ? '_blank' : undefined}
          rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
          className={`group relative aspect-[8/3] min-h-[128px] overflow-hidden rounded-2xl border bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${link.tone}`}
          title={link.title}
        >
          <img
            src={link.image}
            alt=""
            loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        </a>
      ))}
    </div>
  );
}

// ✅ 스켈레톤 카드 (로딩 중 표시)
function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />
      ))}
    </div>
  );
}

export function HomePage() {
  const [posts, setPosts] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [users, setUsers] = useState<Array<UserProfile & { id: string }>>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notices, setNotices] = useState<any[]>([]);
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < 768
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    const bannersQuery = query(collection(db, 'banners'), orderBy('createdAt', 'desc'));
    const unsubBanners = onSnapshot(bannersQuery, (snap) => {
      setBanners(
        snap.docs
          .map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }))
          .filter((banner: any) => banner.isActive !== false && !(banner.imageUrl && banner.imageUrl.includes('images.unsplash.com')))
          .sort((a: any, b: any) => (Number(a.priority) || 0) - (Number(b.priority) || 0))
      );
    });

    const postsQuery = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(50));
    const unsubPosts = onSnapshot(postsQuery, (snap) => {
      setPosts(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
      setLoading(false);
    }, (err) => {
      console.error('Failed to load posts', err);
      setLoading(false);
    });

    // ✅ 공지사항은 별도 쿼리: 항상 최신 공지 5개 표시 (다른 채널 활동량과 무관)
    const noticeQuery = query(collection(db, 'posts'), where('channelId', '==', 'notice'), orderBy('createdAt', 'desc'), limit(5));
    const unsubNotices = onSnapshot(noticeQuery, (snap) => {
      setNotices(snap.docs.map(d => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) })));
    }, (err) => console.error('Failed to load notices', err));

    return () => { unsubBanners(); unsubPosts(); unsubNotices(); };
  }, []);

  useEffect(() => {
    const usersQuery = query(collection(db, 'users'), orderBy('xp', 'desc'), limit(20));
    const unsubUsers = onSnapshot(usersQuery, (snap) => {
      setUsers(snap.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile & { id: string })));
    }, console.error);
    return unsubUsers;
  }, []);

  useEffect(() => {
    if (banners.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentBannerIndex(prev => (prev + 1) % banners.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [banners.length]);

  const heroBanners = useMemo(
    () => banners.filter((banner: any) => !banner.placement || banner.placement === 'hero'),
    [banners]
  );
  const railBanners = useMemo(
    () => banners.filter((banner: any) => banner.placement === 'rail'),
    [banners]
  );

  // ✅ 각 섹션 5개로 통일
  const noticePosts = useMemo(() => posts.filter(p => p.channelId === 'notice').slice(0, 5), [posts]);
  const placePosts = useMemo(
    () => posts
      .filter(p => PLACE_CHANNELS.includes(p.channelId))
      .sort((a, b) =>
        ((Number(b.likesCount) || 0) + (Number(b.commentsCount) || 0)) -
        ((Number(a.likesCount) || 0) + (Number(a.commentsCount) || 0))
      )
      .slice(0, 5),
    [posts]
  );
  const talkPosts = useMemo(() => posts.filter(p => COMMUNITY_CHANNELS.includes(p.channelId)).slice(0, 5), [posts]);
  const popularPosts = useMemo(
    () => posts
      .filter(p => p.channelId !== 'inquiries' && p.channelId !== 'webtoon')
      .sort((a, b) =>
        ((Number(b.likesCount) || 0) * 2 + (Number(b.commentsCount) || 0)) -
        ((Number(a.likesCount) || 0) * 2 + (Number(a.commentsCount) || 0))
      )
      .slice(0, 6),
    [posts]
  );
  const communityPosts = useMemo(() => posts.filter(p => p.channelId !== 'notice' && p.channelId !== 'webtoon' && p.channelId !== 'inquiries').slice(0, 6), [posts]);
  const webtoonPosts = useMemo(() => posts.filter(p => p.channelId === 'webtoon' && (p as any).isPublished === true).slice(0, 5), [posts]);
  const meetingPhotoPosts = useMemo(() => posts.filter(p => p.channelId === 'meeting_board').slice(0, 4), [posts]);

  // ✅ 섹션 최소 높이: 5개 기준 고정 (박스 크기 통일)
  const SECTION_MIN_H = 'min-h-[340px]';

  return (
    <div className="h-full bg-slate-50 flex overflow-hidden">
      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-3 md:p-5 xl:p-6">
        <div className="max-w-7xl mx-auto animate-in fade-in duration-500 pb-16">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
            <div className="space-y-5 min-w-0">

          {/* 배너 슬라이더 */}
          {heroBanners.length > 0 ? (
            <div
              className="relative rounded-2xl overflow-hidden shadow-lg bg-white"
              style={{ aspectRatio: isMobile ? '16 / 7' : '16 / 4.8' }}
            >
              {heroBanners.map((banner, idx) => {
                const bannerTo = bannerLinkTo(banner.linkChannel);
                const bgImg = isMobile ? (banner.mobileImageUrl || banner.imageUrl) : banner.imageUrl;
                const pick = (mobileKey: string, desktopKey: string, fallback: any) =>
                  isMobile && banner[mobileKey] !== undefined && banner[mobileKey] !== ''
                    ? banner[mobileKey]
                    : banner[desktopKey] ?? fallback;
                const focalX = Number(pick('mobileFocalX', 'focalX', 50));
                const focalY = Number(pick('mobileFocalY', 'focalY', 30));
                const title = String(pick('mobileTitle', 'title', ''));
                const subtitle = String(pick('mobileSubtitle', 'subtitle', ''));
                const showTitle = Boolean(pick('mobileShowTitle', 'showTitle', true));
                const showSubtitle = Boolean(pick('mobileShowSubtitle', 'showSubtitle', true));
                const showLogo = Boolean(pick('mobileShowLogo', 'showLogo', true));
                const showWordmark = Boolean(pick('mobileShowWordmark', 'showWordmark', true));
                const logoX = Number(pick('mobileLogoX', 'logoX', 38));
                const logoY = Number(pick('mobileLogoY', 'logoY', 48));
                const logoSize = Number(pick('mobileLogoSize', 'logoSize', 74));
                const wordmarkX = Number(pick('mobileWordmarkX', 'wordmarkX', 55));
                const wordmarkY = Number(pick('mobileWordmarkY', 'wordmarkY', 48));
                const wordmarkSize = Number(pick('mobileWordmarkSize', 'wordmarkSize', 260));
                const titleX = Number(pick('mobileTitleX', 'titleX', 50));
                const titleY = Number(pick('mobileTitleY', 'titleY', 40));
                const titleColor = String(pick('mobileTitleColor', 'titleColor', '#ffffff'));
                const titleSize = Number(pick('mobileTitleSize', 'titleSize', 44));
                const subtitleX = Number(pick('mobileSubtitleX', 'subtitleX', 50));
                const subtitleY = Number(pick('mobileSubtitleY', 'subtitleY', 60));
                const subtitleColor = String(pick('mobileSubtitleColor', 'subtitleColor', '#ffffff'));
                const subtitleSize = Number(pick('mobileSubtitleSize', 'subtitleSize', 20));

                const isExternal = bannerTo.startsWith('http');
                const Wrapper = isExternal ? 'a' : Link;
                const wrapperProps = isExternal
                  ? { href: bannerTo, target: '_blank', rel: 'noopener noreferrer' }
                  : { to: bannerTo || '#' };

                return (
                  <Wrapper
                    key={banner.id}
                    {...(wrapperProps as any)}
                    onClick={(event: any) => { if (!bannerTo) event.preventDefault(); }}
                    className={`absolute inset-0 transition-opacity duration-1000 ${idx === currentBannerIndex % heroBanners.length ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                  >
                    <img
                      src={bgImg}
                      alt=""
                      className="absolute inset-0 h-full w-full select-none object-contain"
                      style={{ objectPosition: `${focalX}% ${focalY}%` }}
                    />
                    <div className="relative z-10 w-full h-full">
                      {showLogo && (
                        <img src="/logo.png?v=20260517b" alt="" style={{ position: 'absolute', left: `${logoX}%`, top: `${logoY}%`, transform: 'translate(-50%, -50%)', width: isMobile ? `${logoSize}px` : `clamp(36px, 10vw, ${logoSize}px)` }} className="select-none drop-shadow-2xl" />
                      )}
                      {showWordmark && (
                        <img src="/wordmark.png?v=20260517b" alt="동전커피" style={{ position: 'absolute', left: `${wordmarkX}%`, top: `${wordmarkY}%`, transform: 'translate(-50%, -50%)', width: isMobile ? `${wordmarkSize}px` : `clamp(100px, 36vw, ${wordmarkSize}px)` }} className="select-none drop-shadow-2xl" />
                      )}
                      {showTitle && title && (
                        <div style={{ position: 'absolute', left: `${titleX}%`, top: `${titleY}%`, transform: 'translate(-50%, -50%)', color: titleColor, fontSize: isMobile ? `${titleSize}px` : `clamp(${Math.max(16, Math.round(titleSize * 0.38))}px, ${(titleSize / 380 * 100).toFixed(1)}vw, ${Math.min(titleSize, 64)}px)`, textAlign: 'center', lineHeight: 1.1, wordBreak: 'keep-all', maxWidth: '88%' }} className="font-black drop-shadow-2xl select-none">
                          {title}
                        </div>
                      )}
                      {showSubtitle && subtitle && (
                        <div style={{ position: 'absolute', left: `${subtitleX}%`, top: `${subtitleY}%`, transform: 'translate(-50%, -50%)', color: subtitleColor, fontSize: isMobile ? `${subtitleSize}px` : `clamp(${Math.max(11, Math.round(subtitleSize * 0.45))}px, ${(subtitleSize / 380 * 100).toFixed(1)}vw, ${Math.min(subtitleSize, 28)}px)`, textAlign: 'center', lineHeight: 1.3, wordBreak: 'keep-all', maxWidth: '88%' }} className="font-bold drop-shadow-lg opacity-90 select-none">
                          {subtitle}
                        </div>
                      )}
                    </div>
                  </Wrapper>
                );
              })}
              {heroBanners.length > 1 && (
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
                  {heroBanners.map((_, i) => (
                    <button key={i} onClick={() => setCurrentBannerIndex(i)}
                      className={`rounded-full transition-all ${i === currentBannerIndex % heroBanners.length ? 'w-5 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/75'}`} />
                  ))}
                </div>
              )}
              <div className="invisible h-full" />
            </div>
          ) : (
            <div className="rounded-2xl p-7 shadow-lg relative overflow-hidden bg-gradient-to-br from-slate-800 via-indigo-900 to-slate-900 min-h-[116px] md:min-h-[250px] flex flex-col justify-end">
              <div className="relative z-10 text-white">
                <h1 className="text-3xl md:text-4xl font-extrabold mb-2">동전커피</h1>
                <p className="text-white/90 max-w-xl text-base font-medium">공지, 모임, 맛집, 장소 정보를 한눈에 확인하세요.</p>
              </div>
            </div>
          )}

          {/* 카테고리 그리드 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {CATEGORIES.slice(0, 10).map(category => (
              <Link key={category.id} to={`/channels/${category.id}`}
                className="bg-white border border-slate-100 rounded-xl px-3 py-3 hover:border-rose-200 hover:bg-rose-50/40 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{category.icon}</span>
                  <span className="font-black text-sm text-slate-800 truncate">{category.name}</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 truncate">{category.desc}</p>
              </Link>
            ))}
          </div>

          {/* 인기/자유게시판 카드 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FeaturePanel title="🔥 인기게시물" posts={popularPosts} to="/channels/freeboard" />
            <FeaturePanel title="🆕 신규 게시물" posts={communityPosts} to="/channels/freeboard" />
          </div>

          {/* ✅ 게시물 섹션 3열 - 박스 높이 동일하게 items-stretch */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">

            {/* 운영 공지 */}
            <section className={`bg-white rounded-2xl border border-slate-100 p-4 flex flex-col ${SECTION_MIN_H}`}>
              <div className="flex justify-between items-center mb-3 shrink-0">
                <h2 className="font-black text-slate-900">운영 공지</h2>
                <Link to="/channels/notice" className="text-xs font-bold text-rose-500">더보기</Link>
              </div>
              <div className="flex-1 space-y-2">
                {loading ? <SkeletonRows count={5} />
                  : notices.length
                    ? notices.map(post => <PostRow key={post.id} post={post} label="공지" />)
                    : <div className="flex-1 flex items-center justify-center"><p className="text-sm text-slate-400 text-center">등록된 공지가 없습니다.</p></div>
                }
              </div>
            </section>

            {/* 요즘 뜨는 장소 */}
            <section className={`bg-white rounded-2xl border border-slate-100 p-4 flex flex-col ${SECTION_MIN_H}`}>
              <div className="flex justify-between items-center mb-3 shrink-0">
                <h2 className="font-black text-slate-900">요즘 뜨는 장소</h2>
                <Link to="/map" className="text-xs font-bold text-rose-500">지도 보기</Link>
              </div>
              <div className="flex-1 space-y-2">
                {loading ? <SkeletonRows count={5} />
                  : placePosts.length
                    ? placePosts.map(post => <PostRow key={post.id} post={post} />)
                    : <div className="flex-1 flex items-center justify-center"><p className="text-sm text-slate-400 text-center">장소 게시물이 없습니다.</p></div>
                }
              </div>
            </section>

            {/* 최근 이야기 */}
            <section className={`bg-white rounded-2xl border border-slate-100 p-4 flex flex-col ${SECTION_MIN_H}`}>
              <div className="flex justify-between items-center mb-3 shrink-0">
                <h2 className="font-black text-slate-900">커뮤니티</h2>
                <Link to="/channels/freeboard" className="text-xs font-bold text-rose-500">더보기</Link>
              </div>
              <div className="flex-1 space-y-2">
                {loading ? <SkeletonRows count={5} />
                  : talkPosts.length
                    ? talkPosts.map(post => <PostRow key={post.id} post={post} />)
                    : <div className="flex-1 flex items-center justify-center"><p className="text-sm text-slate-400 text-center">최근 이야기가 없습니다.</p></div>
                }
              </div>
            </section>

          </div>

            </div>

            <aside className="hidden xl:flex flex-col gap-4">
              <RankingCard users={users} />
              <MiniLinkBanners banners={railBanners} />
              <section className={`rounded-2xl border border-slate-100 bg-white p-4 shadow-sm flex flex-col justify-between`}>
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="font-black text-slate-900 font-bold text-slate-800">📖 브로맨툰</h2>
                    <Link to="/channels/webtoon" className="text-xs font-bold text-rose-500">더보기</Link>
                  </div>
                  <div className="space-y-2">
                    {webtoonPosts.length > 0 ? webtoonPosts.map(post => <PostRow key={post.id} post={post} label="웹툰" />) : (
                      <p className="py-8 text-center text-sm font-bold text-slate-400">연재 목록이 없습니다.</p>
                    )}
                  </div>
                </div>
              </section>

              {/* 모임 사진 2x2 격자 */}
              <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-black text-slate-900 flex items-center gap-1">📷 모임 사진</h2>
                  <Link to="/channels/meeting_board" className="text-xs font-bold text-rose-500">더보기</Link>
                </div>
                {meetingPhotoPosts.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {meetingPhotoPosts.map(post => {
                      const imgUrl = post.imageUrl || getCategoryFallbackImage('meeting_board');
                      return (
                        <Link
                          key={post.id}
                          to={`/channels/meeting_board`}
                          onClick={() => sessionStorage.setItem('openPostId', post.id)}
                          className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 border border-slate-100 hover:border-rose-200 transition-colors"
                        >
                          <img
                            src={imgUrl}
                            alt=""
                            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                            <p className="text-[10px] font-bold text-white truncate w-full">{post.title}</p>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm font-bold text-slate-400">등록된 사진이 없습니다.</p>
                )}
              </section>
            </aside>
          </div>

        </div>
      </div>

      <div className="block">
        <RightSidebar isMobile />
      </div>
    </div>
  );
}
