import React, { useEffect, useState } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Link } from 'react-router';
import type { Post } from '../posts/PostList';
import { useAuthStore } from '../../stores/authStore';
import { WebtoonProjectModal } from './WebtoonProjectModal';

export function WebtoonList({ channelId }: { channelId: string }) {
  const [projects, setProjects] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuthStore();
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);

  const isOperator = profile?.role === 'admin' || profile?.role === 'manager';

  useEffect(() => {
    const q = query(
      collection(db, 'posts'),
      where('channelId', '==', channelId),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post)));
      setLoading(false);
    });
    return unsub;
  }, [channelId]);

  if (loading) {
    return <div className="text-center py-10 text-slate-500">불러오는 중...</div>;
  }

  return (
    <div>
      {isOperator && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setIsProjectModalOpen(true)}
            className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-95 text-white font-bold rounded-xl shadow-sm transition-all flex items-center gap-1.5 text-xs"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            <span>새 프로젝트 만들기</span>
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 pb-20 sm:grid-cols-[repeat(auto-fill,minmax(170px,220px))]">
        {projects.filter(p => isOperator || (p as any).isPublished === true).map(project => (
          <Link key={project.id} to={`/webtoon/${project.id}`} className="group cursor-pointer">
            <div className="aspect-[3/4] bg-slate-100 rounded-xl overflow-hidden relative shadow-sm border border-slate-200 group-hover:shadow-md transition-all">
              {project.imageUrl ? (
                <img src={project.imageUrl} alt={project.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-4xl">📖</div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              {isOperator && !(project as any).isPublished && (
                <div className="absolute top-2 left-2 px-2 py-0.5 bg-amber-400 text-amber-900 text-[10px] font-black rounded-full z-10">미게시</div>
              )}
              <div className="absolute bottom-3 left-3 right-3 text-white">
                <h3 className="font-bold text-sm leading-tight line-clamp-2 mb-1">{project.title}</h3>
                <p className="text-[10px] text-white/80 line-clamp-1">{project.content || '웹툰 프로젝트'}</p>
              </div>
            </div>
          </Link>
        ))}
        {projects.length === 0 && (
          <div className="col-span-full py-10 text-center text-slate-500">
            진행 중인 웹툰 프로젝트가 없습니다.<br />새로운 브로맨툰 세계관을 창조해보세요!
          </div>
        )}
      </div>

      {isProjectModalOpen && (
        <WebtoonProjectModal onClose={() => setIsProjectModalOpen(false)} />
      )}
    </div>
  );
}
