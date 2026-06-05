import { useEffect, useState, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router';
import { useAuthStore } from './stores/authStore';
import { Layout } from './components/layout/Layout';
import { ChannelPage } from './pages/ChannelPage';
import { AuthPage } from './pages/AuthPage';
import { ProfilePage } from './pages/ProfilePage';
import { HomePage } from './pages/HomePage';
import { AdminPage } from './pages/AdminPage';
import { auth } from './lib/firebase';
import { signOut } from 'firebase/auth';
import { loginOneSignal, logoutOneSignal } from './lib/onesignal';

// ✅ Code Splitting — 웹툰/지도는 lazy로 분리
const MapPage = lazy(() => import('./pages/MapPage').then(m => ({ default: m.MapPage })));
const WebtoonDetailPage = lazy(() => import('./pages/WebtoonDetailPage').then(m => ({ default: m.WebtoonDetailPage })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-screen bg-[#F7F7F7]">
      <div className="w-10 h-10 border-4 border-rose-200 border-t-rose-500 rounded-full animate-spin" />
    </div>
  );
}

export default function App() {
  const { initAuth, profile, user, isLoading } = useAuthStore();
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  useEffect(() => {
    initAuth();
    if (localStorage.getItem('theme') === 'dark') {
      document.documentElement.classList.add('dark');
    }
  }, [initAuth]);

  // ✅ OneSignal: 로그인/로그아웃 싱크
  useEffect(() => {
    if (user?.uid) {
      loginOneSignal(user.uid, user.email || undefined);
    } else if (user === null) {
      logoutOneSignal();
    }
  }, [user]);

  // ✅ 추방/삭제: user는 있는데 profile이 null인 경우 (문서 삭제됨)
  // isLoading이 false인데 user는 있고 profile이 null이면 추방된 것
  if (!isLoading && user && !profile) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-white p-6 text-center z-50">
        <span className="text-6xl mb-6">🚫</span>
        <h1 className="text-2xl font-bold mb-3 text-rose-400">이용이 제한된 계정입니다</h1>
        <p className="text-slate-300 mb-2 max-w-sm text-sm leading-relaxed">
          이 계정은 관리자에 의해 추방되었거나<br/>
          👉 이용이 제한되었습니다.
        </p>
        <p className="text-slate-500 text-xs mb-8">문의사항은 운영진에게 연락해주세요.</p>
        <button
          onClick={() => signOut(auth)}
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-xl font-bold transition-colors text-sm"
        >
          로그아웃
        </button>
      </div>
    );
  }

  if (user && profile?.isBanned) {
    return (
      <div className="fixed inset-0 bg-slate-900 flex flex-col items-center justify-center text-white p-4 text-center z-50">
        <span className="text-6xl mb-6">🚫</span>
        <h1 className="text-3xl font-bold mb-4 text-rose-500">계정이 정지되었습니다</h1>
        <p className="text-slate-300 mb-8 max-w-md">
          커뮤니티 가이드라인 위반 등의 이유로 계정 이용이 제한되었습니다.<br />
          자세한 문의는 고객센터로 연락 부탁드립니다.
        </p>
        <button
          onClick={() => signOut(auth)}
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 rounded-lg font-bold transition-colors"
        >
          로그아웃
        </button>
      </div>
    );
  }

  return (
    <BrowserRouter>
      {/* ✅ 오프라인 배너 */}
      {isOffline && (
        <div className="fixed top-0 left-0 right-0 z-[99999] bg-slate-800 text-white text-xs font-bold text-center py-2 flex items-center justify-center gap-2">
          <span>📵</span> 인터넷 연결이 끊어졌습니다. 연결을 확인해주세요.
        </div>
      )}
      <Suspense fallback={<LazyFallback />}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<HomePage />} />
            <Route path="channels/:channelId" element={<ChannelPage />} />
            <Route path="webtoon/:projectId" element={<WebtoonDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="map" element={<MapPage />} />
          </Route>
          <Route path="/auth" element={<AuthPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
