import React, { useEffect, useRef, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';

interface Letter {
  id: string;
  title: string;
  content: string;
  senderName: string;
  read: boolean;
  type: string;
  createdAt: any;
}

interface Props {
  onClose: () => void;
}

export function MailboxModal({ onClose }: Props) {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [selected, setSelected] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const { user } = useAuthStore();

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) { setLoading(false); return; }
    const q = query(
      collection(db, 'letters'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc')
    );
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Letter));
      setLetters(data);
      setLoading(false);
    }, err => { console.error('[MailboxModal] onSnapshot error:', err); setLoading(false); });
    return unsub;
  }, [user?.uid]);

  const openLetter = async (letter: Letter) => {
    setSelected(letter);
    if (!letter.read) {
      try {
        await updateDoc(doc(db, 'letters', letter.id), { read: true, readAt: serverTimestamp() });
        console.log('[MailboxModal] marked read:', letter.id);
      } catch (err) {
        console.error('[MailboxModal] updateDoc failed:', err);
      }
    }
  };

  const unreadCount = letters.filter(l => !l.read).length;
  const readCount = letters.filter(l => l.read).length;

  const markAllRead = async () => {
    if (isBulkLoading || unreadCount === 0) return;
    setIsBulkLoading(true);
    try {
      const batch = writeBatch(db);
      letters.filter(l => !l.read).forEach(l => {
        batch.update(doc(db, 'letters', l.id), { read: true, readAt: serverTimestamp() });
      });
      await batch.commit();
      console.log('[MailboxModal] markAllRead done');
    } catch (err) {
      console.error('[MailboxModal] markAllRead failed:', err);
    } finally {
      setIsBulkLoading(false);
    }
  };

  const deleteReadLetters = async () => {
    if (isBulkLoading || readCount === 0) return;
    const ok = window.confirm(`읽은 편지 ${readCount}건을 삭제할까요?`);
    if (!ok) return;
    setIsBulkLoading(true);
    try {
      const batch = writeBatch(db);
      letters.filter(l => l.read).forEach(l => {
        batch.delete(doc(db, 'letters', l.id));
      });
      await batch.commit();
      console.log('[MailboxModal] deleteReadLetters done');
    } catch (err) {
      console.error('[MailboxModal] deleteReadLetters failed:', err);
    } finally {
      setIsBulkLoading(false);
    }
  };

  const typeIcon: Record<string, string> = {
    approval: '🎉',
    announcement: '📣',
    personal: '✏️',
    system: '⚙️',
    welcome: '🎊',
    join_request_received: '📝',
  };

  return (
    <div className="fixed inset-0 z-[99999] bg-black/50 backdrop-blur-sm flex items-end md:items-center justify-center p-0 md:p-4">

      {selected ? (
        /* ✅ 편지 상세 — 모바일 전체화면, PC 넓은 모달 */
        <div className="bg-white w-full h-[100dvh] md:max-w-2xl md:h-auto md:max-h-[90vh] md:rounded-3xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 bg-white sticky top-0 z-10 shrink-0">
            <button
              onClick={() => setSelected(null)}
              className="flex items-center justify-center w-9 h-9 rounded-full hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
              </svg>
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-black text-slate-800 truncate">{selected.title}</h2>
              <p className="text-[11px] text-slate-400">
                {selected.senderName} · {selected.createdAt?.toDate ? selected.createdAt.toDate().toLocaleString('ko-KR') : ''}
              </p>
            </div>
            <button onClick={onClose} className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 transition-colors shrink-0">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="p-5 space-y-4">
              <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl p-5 border border-amber-100">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">{typeIcon[selected.type] || '✉️'}</span>
                  <div>
                    <h3 className="font-black text-slate-800 text-base leading-tight">{selected.title}</h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {selected.senderName} · {selected.createdAt?.toDate ? selected.createdAt.toDate().toLocaleString('ko-KR') : ''}
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                <pre className="whitespace-pre-wrap text-sm text-slate-700 leading-relaxed font-sans">{selected.content}</pre>
              </div>
              {selected.type === 'approval' && (
                <div className="bg-indigo-50 rounded-2xl p-4 border border-indigo-100">
                  <p className="text-sm font-bold text-indigo-700 mb-2">🚀 정식 계정으로 전환하면 더 많은 기능을 이용할 수 있어요!</p>
                  <p className="text-xs text-indigo-600 leading-relaxed">
                    프로필 → 로그아웃 → 로그인 화면에서 [회원가입] 탭 선택 → 초대코드 입력 → Google 계정으로 가입하세요
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      ) : (
        /* ✅ 편지 목록 — 모바일 바텀시트, PC 센터드 모달 */
        <div
          className="bg-white w-full h-[100dvh] md:max-w-lg md:min-h-[480px] md:h-auto md:max-h-[90vh] md:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col relative"
        >
          <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mt-2 mb-0 md:hidden shrink-0" />
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xl">✉️</span>
              <h2 className="text-base font-black text-slate-800">우편함</h2>
              {unreadCount > 0 && (
                <span className="bg-rose-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 leading-none">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  disabled={isBulkLoading}
                  className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isBulkLoading ? '처리 중...' : '모두 읽음'}
                </button>
              )}
              {readCount > 0 && (
                <button
                  onClick={deleteReadLetters}
                  disabled={isBulkLoading}
                  className="text-[11px] font-bold text-slate-400 hover:text-rose-500 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                >
                  삭제
                </button>
              )}
              <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-100 rounded-full transition-colors">✕</button>
            </div>
          </div>


          {/* 편지 목록 */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <div className="w-8 h-8 border-3 border-rose-200 border-t-rose-500 rounded-full animate-spin" />
                <p className="text-sm text-slate-400">불러오는 중...</p>
              </div>
            ) : letters.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-3">
                <span className="text-5xl">📭</span>
                <p className="text-base font-bold text-slate-500">아직 받은 편지가 없어요</p>
                <p className="text-xs text-slate-400">가입 승인·공지·개인 편지가 여기에 쌓여요</p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-50">
                {letters.map(letter => (
                  <li key={letter.id}>
                    <button
                      onClick={() => openLetter(letter)}
                      className={`w-full flex items-start gap-3 px-5 py-4 text-left transition-colors active:bg-slate-50 hover:bg-slate-50 ${!letter.read ? 'bg-rose-50/40' : ''}`}
                    >
                      <span className="text-2xl shrink-0 mt-0.5">{typeIcon[letter.type] || '✉️'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <p className={`text-sm truncate ${!letter.read ? 'font-black text-slate-800' : 'font-bold text-slate-600'}`}>
                            {letter.title}
                          </p>
                          {!letter.read && (
                            <span className="w-2 h-2 bg-rose-500 rounded-full shrink-0" />
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate">
                          {letter.senderName} · {letter.createdAt?.toDate ? letter.createdAt.toDate().toLocaleDateString('ko-KR') : ''}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-slate-300 shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 하단 여백 (모바일 홈 바 대응) */}
          <div className="h-safe-bottom md:hidden" />
        </div>
      )}
    </div>
  );
}
