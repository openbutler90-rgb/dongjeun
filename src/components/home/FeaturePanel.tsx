import React from 'react';
import { Link } from 'react-router';
import { FeatureCard } from './FeatureCard';

export function FeaturePanel({ title, posts, to }: { title: string; posts: any[]; to: string }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-3 md:p-4 shadow-sm">
      <div className="mb-2 md:mb-3 flex items-center justify-between">
        <h2 className="font-black text-slate-900 text-sm md:text-base">{title}</h2>
        <Link to={to} className="text-[11px] md:text-xs font-bold text-rose-500">더보기</Link>
      </div>
      {/* ✅ 모바일에서도 2열 그리드로 표시, 카드가 너무 커지지 않도록 */}
      <div className="grid grid-cols-2 gap-2 md:gap-3">
        {(posts.length ? posts.slice(0, 2) : [undefined, undefined]).map((post, index) => (
          <FeatureCard key={post?.id || `${title}-${index}`} post={post} />
        ))}
      </div>
    </section>
  );
}
