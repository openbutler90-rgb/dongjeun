import React from 'react';
import { Link } from 'react-router';
import { getEffectiveLevel } from '../../lib/profileDecorations';
import type { UserProfile } from '../../stores/authStore';

export function RankingCard({ users }: { users: Array<UserProfile & { id: string }> }) {
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
