import { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';

interface Props {
  onOpenMailbox: () => void;
}

const STORAGE_KEY = 'dongjeon-mail-bounce-seen';

export function NewMailBounce({ onOpenMailbox }: Props) {
  const { user } = useAuthStore();
  const [show, setShow] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;

    // 오늘 이미 봤는지 확인
    const seenRaw = localStorage.getItem(STORAGE_KEY);
    const today = new Date().toISOString().slice(0, 10);
    if (seenRaw === today) return;

    const q = query(
      collection(db, 'letters'),
      where('userId', '==', user.uid),
      where('read', '==', false)
    );

    // 한 번만 체크
    getDocs(q).then(snap => {
      if (snap.size > 0) {
        setHasUnread(true);
        setShow(true);
      }
    }).catch(() => {});

    // 실시간으로 0이 되면 숨김
    const unsub = onSnapshot(q, snap => {
      if (snap.size === 0) {
        setShow(false);
      }
    }, () => {});

    return unsub;
  }, [user?.uid]);

  const handleClick = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem(STORAGE_KEY, today);
    setShow(false);
    onOpenMailbox();
  };

  if (!show || !hasUnread) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleClick}
    >
      <div
        className="relative flex flex-col items-center gap-4 animate-mail-bounce cursor-pointer"
        onClick={e => { e.stopPropagation(); handleClick(); }}
      >
        <div className="relative">
          <span className="text-[80px] sm:text-[100px] md:text-[120px] filter drop-shadow-2xl">
            ✉️
          </span>
          <span className="absolute -top-1 -right-1 min-w-6 h-6 bg-rose-500 text-white text-xs font-black rounded-full flex items-center justify-center px-1.5 shadow-lg animate-pulse">
            N
          </span>
        </div>
        <p className="text-white font-bold text-base sm:text-lg text-center px-4 drop-shadow-lg">
          편지가 도착했어요! 클릭해서 확인해보세요 💌
        </p>
        <p className="text-white/60 text-xs">화면 아무 곳이나 클릭하면 닫혀요</p>
      </div>
    </div>
  );
}
