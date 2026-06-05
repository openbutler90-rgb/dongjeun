import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';

interface Letter {
  id: string;
  userId: string;
  title: string;
  content: string;
  senderName: string;
  read: boolean;
  createdAt: any;
}

const renderLinkedContent = (text: string) => {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  return text.split(urlRegex).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part;
    return (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-indigo-600 underline underline-offset-2 break-all hover:text-indigo-800"
      >
        {part}
      </a>
    );
  });
};

export function MailboxModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuthStore();
  const [letters, setLetters] = useState<Letter[]>([]);
  const [selectedLetter, setSelectedLetter] = useState<Letter | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'letters'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Letter));
      setLetters(items);
      setLoading(false);
    }, (error) => {
      console.error('Failed to load letters:', error);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const handleReadLetter = async (letter: Letter) => {
    setSelectedLetter(letter);
    if (!letter.read) {
      try {
        await updateDoc(doc(db, 'letters', letter.id), { read: true });
      } catch (err) {
        console.error('Failed to mark letter as read:', err);
      }
    }
  };

  const copySelectedContent = async () => {
    if (!selectedLetter) return;
    await navigator.clipboard.writeText(`${selectedLetter.title}\n\n${selectedLetter.content}`);
    alert('편지 내용을 복사했습니다. 로그아웃 전에 메모장이나 카톡 나에게 보내기에 저장해 주세요.');
  };

  const downloadSelectedContent = () => {
    if (!selectedLetter) return;
    const blob = new Blob([`${selectedLetter.title}\n\n${selectedLetter.content}`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedLetter.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[50000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white w-full max-w-2xl min-h-[520px] h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-100">
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-slate-50/50">
          <div className="flex items-center gap-2">
            <span className="text-xl">✉️</span>
            <h3 className="font-bold text-slate-800">개인 편지함</h3>
            <span className="bg-rose-100 text-rose-600 text-[10px] font-black px-2 py-0.5 rounded-full shrink-0">
              {letters.filter(l => !l.read).length}개 안읽음
            </span>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-rose-500 font-bold transition-colors w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        {/* 바디 (좌우 스플릿) */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* 편지 목록 */}
          <div className="w-1/2 border-r border-slate-100 flex flex-col min-h-0 bg-slate-50/20">
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
              {loading ? (
                <div className="text-center py-12 text-xs font-bold text-slate-400">불러오는 중...</div>
              ) : letters.length === 0 ? (
                <div className="text-center py-20">
                  <span className="text-3xl block mb-2 opacity-40">📭</span>
                  <p className="text-xs font-bold text-slate-400">받은 편지가 없습니다.</p>
                </div>
              ) : (
                letters.map((letter) => {
                  const isSelected = selectedLetter?.id === letter.id;
                  const dateStr = letter.createdAt?.toDate 
                    ? letter.createdAt.toDate().toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) 
                    : '방금 전';
                  return (
                    <button
                      key={letter.id}
                      onClick={() => handleReadLetter(letter)}
                      className={`w-full text-left p-3.5 rounded-2xl border transition-colors flex flex-col gap-1.5 hover:shadow-sm ${
                        isSelected 
                          ? 'bg-rose-50 border-rose-200 shadow-sm' 
                          : letter.read 
                            ? 'bg-white border-slate-100 text-slate-600' 
                            : 'bg-white border-slate-200 text-slate-800 font-bold shadow-sm'
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md ${
                          letter.read ? 'bg-slate-100 text-slate-400' : 'bg-rose-100 text-rose-600'
                        }`}>
                          {letter.read ? '읽음' : 'NEW'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-bold">{dateStr}</span>
                      </div>
                      <div className="truncate text-xs font-bold leading-snug">{letter.title}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1 font-semibold">
                        <span>👤 발신:</span>
                        <span>{letter.senderName || '운영진'}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 편지 내용 상세 */}
          <div className="w-1/2 flex flex-col min-h-0 bg-white">
            {selectedLetter ? (
              <div className="flex-1 flex flex-col overflow-hidden min-h-0 p-5">
                <div className="border-b border-slate-100 pb-3 mb-4 shrink-0">
                  <h4 className="font-extrabold text-sm text-slate-800 mb-2 leading-relaxed">{selectedLetter.title}</h4>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold">
                    <span>발신: {selectedLetter.senderName || '운영진'}</span>
                    <span>
                      {selectedLetter.createdAt?.toDate 
                        ? selectedLetter.createdAt.toDate().toLocaleString('ko-KR') 
                        : ''}
                    </span>
                  </div>
                  <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 p-3 space-y-2">
                    <p className="text-[11px] font-black text-amber-700 leading-relaxed">
                      승인 우편은 로그아웃 전에 반드시 캡처하거나 저장해 주세요. 게스트 상태에서 로그아웃하면 이 우편을 다시 못 볼 수 있습니다.
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button onClick={copySelectedContent} className="py-2 rounded-lg bg-white text-amber-700 text-[11px] font-black border border-amber-100 hover:bg-amber-100">
                        내용 복사
                      </button>
                      <button onClick={downloadSelectedContent} className="py-2 rounded-lg bg-amber-500 text-white text-[11px] font-black hover:bg-amber-600">
                        TXT 저장
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar text-xs text-slate-600 leading-relaxed font-medium whitespace-pre-wrap">
                  {renderLinkedContent(selectedLetter.content)}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center min-h-0 p-6 text-center text-slate-400">
                <span className="text-4xl block mb-2 opacity-35">✉️</span>
                <p className="text-xs font-bold">읽을 편지를 선택해주세요.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
