import React from 'react';
import { Link } from 'react-router';

const bannerLinkTo = (channel?: string) => {
  if (!channel) return '';
  if (channel.startsWith('http')) return channel;
  if (channel === 'map') return '/map';
  return `/channels/${channel}`;
};

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
    href: import.meta.env.VITE_DISCORD_URL || '',
    label: '디스코드',
    title: '음성·자료 공유 공간',
    tone: 'border-indigo-100 from-indigo-50 via-violet-50 to-white text-indigo-800',
    badge: 'bg-indigo-100 text-indigo-700',
    image: '/ai-butler.png?v=20260518',
  },
];

export function MiniLinkBanners({ banners }: { banners: any[] }) {
  const links = banners.length
    ? banners.slice(0, 2).map(banner => ({
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
