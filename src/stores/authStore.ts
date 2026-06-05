import { create } from 'zustand';
import { User } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import type { ProfileDecorations } from '../lib/profileDecorations';

export interface UserProfile {
  nickname: string;
  email: string;
  profileColor: string;
  photoURL?: string;
  bio?: string;
  status: 'online' | 'offline';
  role: 'guest' | 'user' | 'regionalLeader' | 'manager' | 'admin';
  isBanned?: boolean;
  level?: number;
  xp?: number;
  partnerId?: string;
  decorations?: ProfileDecorations;
  updatedAt?: any;
}

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  initAuth: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  profile: null,
  isLoading: true,
  setUser: (user) => set({ user }),
  initAuth: () => {
    // ✅ 이전 프로필 리스너를 추적해서 로그아웃/재로그인 시 해제
    let profileUnsub: (() => void) | null = null;
    let presenceCleanup: (() => void) | null = null;

    onAuthStateChanged(auth, (user) => {
      // 이전 프로필 리스너 해제 (메모리 누수 방지)
      if (profileUnsub) {
        profileUnsub();
        profileUnsub = null;
      }
      if (presenceCleanup) {
        presenceCleanup();
        presenceCleanup = null;
      }

      if (user) {
        set({ user });
        const userRef = doc(db, 'users', user.uid);
        const setPresence = (status: 'online' | 'offline') => {
          updateDoc(userRef, { status, updatedAt: serverTimestamp() }).catch(() => {});
        };
        setPresence('online');
        const handleVisibility = () => setPresence(document.hidden ? 'offline' : 'online');
        const handleOnline = () => setPresence('online');
        const handleOffline = () => setPresence('offline');
        const heartbeat = window.setInterval(() => {
          if (!document.hidden && navigator.onLine) setPresence('online');
        }, 60 * 1000);

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        window.addEventListener('beforeunload', handleOffline);
        presenceCleanup = () => {
          window.clearInterval(heartbeat);
          document.removeEventListener('visibilitychange', handleVisibility);
          window.removeEventListener('online', handleOnline);
          window.removeEventListener('offline', handleOffline);
          window.removeEventListener('beforeunload', handleOffline);
        };

        // 프로필 실시간 구독 시작
        // ✅ 타임아웃: 3초 안에 문서 못 받으면 isLoading 강제 해제 (두 번 눌러야 하는 버그 수정)
        const loadingTimeout = setTimeout(() => {
          const current = get();
          if (current.isLoading) set({ isLoading: false });
        }, 3000);

        profileUnsub = onSnapshot(userRef, (docSnap) => {
          clearTimeout(loadingTimeout);
          if (docSnap.exists()) {
            const nextProfile = docSnap.data() as UserProfile;
            set({ profile: nextProfile, isLoading: false });
            if ((nextProfile.role === 'admin' || nextProfile.role === 'manager') && Number(nextProfile.level || 1) < 100) {
              updateDoc(userRef, {
                level: 100,
                xp: Math.max(Number(nextProfile.xp || 0), 999999),
                updatedAt: serverTimestamp(),
              }).catch(() => {});
            }
          } else {
            set({ profile: null, isLoading: false });
          }
        });
      } else {
        set({ user: null, profile: null, isLoading: false });
      }
    });
  }
}));
