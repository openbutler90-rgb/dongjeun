import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase';
import { playCoinSound } from '../lib/sound';
import { notifyAdmins } from '../lib/notifications';
import { DEFAULT_GUEST_WELCOME_LETTER } from '../lib/guestWelcome';

const COLORS = ['#f43f5e', '#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#f97316'];
const DEFAULT_INVITE_CODE = '동전커피2026';
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || '';
const GOOGLE_INVITE_SESSION_KEY = 'dongjeon-google-invite-code';
const isElectronRuntime = () => /Electron/i.test(navigator.userAgent);

// 랜덤 게스트 닉네임 생성 (게스트_XXXX 형식)
const GUEST_ADJECTIVES = ['반짝', '솜사탕', '달콤', '설레는', '따뜻한', '귀여운', '신비한', '행복한'];
const generateGuestNickname = () => {
  const adj = GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)];
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${adj}게스트_${code}`;
};

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [activeInviteCode, setActiveInviteCode] = useState(DEFAULT_INVITE_CODE);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [signUpMode, setSignUpMode] = useState<'regular' | 'guest'>('regular');
  const googleLoginLock = useRef(false);
  const navigate = useNavigate();
  const { user, profile, isLoading: authLoading } = useAuthStore();

  // ✅ 카카오톡/인앱브라우저 감지
  const isInAppBrowser = /KAKAOTALK|Instagram|FBAN|FBAV|Line/.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  // 회원가입 모드에서 초대 코드 없으면 Google 로그인 차단
  const isGoogleDisabled = !isLogin && signUpMode === 'regular' && !inviteCode.trim();

  const parseFirebaseError = (err: any): string => {
    switch (err.code) {
      case 'auth/admin-restricted-operation':
        return '현재 이 기능이 제한되어 있습니다. Google 계정으로 로그인하거나 관리자에게 문의해주세요.';
      case 'auth/operation-not-allowed':
        return '이 로그인 방식이 비활성화되어 있습니다. Google 계정으로 로그인해주세요.';
      case 'auth/email-already-in-use':
        return '이미 사용 중인 이메일 주소입니다.';
      case 'auth/invalid-email':
        return '올바른 이메일 형식이 아닙니다.';
      case 'auth/weak-password':
        return '비밀번호는 6자리 이상으로 설정해주세요.';
      case 'auth/invalid-credential':
      case 'auth/user-not-found':
      case 'auth/wrong-password':
        return '이메일 또는 비밀번호가 올바르지 않습니다.';
      case 'auth/popup-closed-by-user':
        return '구글 로그인이 취소되었습니다.';
      case 'auth/popup-blocked':
        return '브라우저가 팝업을 차단했습니다. 구글 로그인 화면으로 이동합니다.';
      case 'auth/too-many-requests':
        return '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.';
      default:
        return err.message || '인증 과정에서 오류가 발생했습니다.';
    }
  };

  const ensureUserDoc = async (
    uid: string,
    emailAddr: string | null,
    displayName?: string | null,
    photoURL?: string | null,
    nicknameOverride?: string,
    roleOverride?: 'guest' | 'user'
  ) => {
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);
    const isAdmin = emailAddr === ADMIN_EMAIL;

    if (!userDoc.exists()) {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      await setDoc(userDocRef, {
        nickname: nicknameOverride || displayName || '동전회원',
        email: emailAddr,
        profileColor: color,
        photoURL: photoURL || '',
        status: 'online',
        role: roleOverride || (isAdmin ? 'admin' : 'user'),
        isAnonymous: roleOverride === 'guest' && !emailAddr,
        xp: isAdmin ? 999999 : 0,
        level: isAdmin ? 100 : 1,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(err => handleFirestoreError(err, OperationType.CREATE, `users/${uid}`));
    } else {
      const updates: any = { status: 'online', updatedAt: serverTimestamp() };
      if (isAdmin && userDoc.data()?.role !== 'admin') updates.role = 'admin';
      if (roleOverride === 'guest' && !emailAddr && userDoc.data()?.isAnonymous !== true) {
        updates.isAnonymous = true;
      }
      if (isAdmin && Number(userDoc.data()?.level || 1) < 100) {
        updates.level = 100;
        updates.xp = Math.max(Number(userDoc.data()?.xp || 0), 999999);
      }
      await setDoc(userDocRef, updates, { merge: true })
        .catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`));
    }
  };

  const sendWelcomeLetterIfEnabled = async (uid: string) => {
    try {
      const userRef = doc(db, 'users', uid);
      const userSnap = await getDoc(userRef);
      const userData = userSnap.data() || {};
      // 승인되지 않은 게스트거나 이미 환영 편지를 받은 경우 skip
      if (!userData.joinApproved || userData.welcomeLetterSent) return;

      const configSnap = await getDoc(doc(db, 'appConfig', 'public'));
      const opts = configSnap.data()?.operationOptions || {};
      const enabled = opts.welcomeLetterEnabled ?? true;
      const template = (opts.welcomeLetterTemplate as string | undefined) || '';
      const kakaoLink = (opts.welcomeKakaoLink as string | undefined) || '';
      const joinCode = (opts.welcomeJoinCode as string | undefined) || '';
      if (!enabled) return;

      const content = template
        .replace(/{{KAKAO_LINK}}/g, kakaoLink)
        .replace(/{{JOIN_CODE}}/g, joinCode)
        || '동전커피에 오신 것을 환영합니다!';

      await addDoc(collection(db, 'letters'), {
        userId: uid,
        title: '🎉 환영합니다!',
        content,
        senderId: uid,
        senderName: '운영진',
        read: false,
        type: 'welcome',
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'notifications'), {
        userId: uid,
        type: 'system',
        actorId: uid,
        actorName: '운영진',
        message: '✉️ 환영 편지가 도착했습니다. 편지함을 확인해주세요.',
        read: false,
        createdAt: serverTimestamp(),
      });
      // 중복 발송 방지 플래그
      await setDoc(userRef, { welcomeLetterSent: true, updatedAt: serverTimestamp() }, { merge: true });
    } catch {
    }
  };

  const sendGuestWelcomeLetter = async (uid: string) => {
    try {
      await addDoc(collection(db, 'letters'), {
        userId: uid,
        title: '☕ 게스트 입장을 환영합니다 · 꼭 읽어주세요',
        content: DEFAULT_GUEST_WELCOME_LETTER,
        senderId: uid,
        senderName: '동전커피 운영진',
        read: false,
        type: 'system',
        createdAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'notifications'), {
        userId: uid,
        type: 'system',
        actorId: uid,
        actorName: '동전커피 운영진',
        message: '✉️ 게스트 이용 안내 우편이 도착했습니다. 로그아웃 전 꼭 확인해주세요.',
        read: false,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn('Failed to send guest welcome letter:', err);
    }
  };

  const handleGoogleUser = async (
    user: { uid: string; email: string | null; displayName?: string | null; photoURL?: string | null },
    codeForNewUser: string
  ) => {
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    const isNewUser = !userDoc.exists();
    const isGuestFlow = codeForNewUser === 'GUEST';
    if (!userDoc.exists() && !isGuestFlow && codeForNewUser.trim() !== activeInviteCode) {
      await signOut(auth);
      setError('신규 가입은 카카오톡 공지의 모임 초대 코드를 먼저 입력한 뒤 구글 로그인을 눌러주세요.');
      return false;
    }

    await ensureUserDoc(
      user.uid,
      user.email,
      user.displayName,
      user.photoURL,
      undefined,
      isGuestFlow ? 'guest' : undefined
    );
    if (!isGuestFlow) {
      await sendWelcomeLetterIfEnabled(user.uid);
    }
    if (isNewUser && !isGuestFlow) {
      // ✅ 운영자 알림: 새 회원 가입
      notifyAdmins({
        type: 'new_user_joined',
        title: '새 회원 가입',
        message: `👋 ${user.displayName || user.email || '새 회원'}님이 가입했습니다!`,
        actorId: user.uid,
        actorName: user.displayName || user.email || '새 회원',
        url: '/admin',
      }).catch(console.error);
    }
    playCoinSound();
    navigate('/');
    return true;
  };

  // ✅ 이미 로그인된 사용자는 /auth 접근 시 홈으로 리다이렉트 (게스트 중복 클릭 방지)
  useEffect(() => {
    if (!authLoading && user) {
      navigate('/', { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Firestore에서 초대코드 로드 (운영자가 앱 내에서 변경 가능)
  useEffect(() => {
    let cancelled = false;
    const loadAppConfig = async () => {
      try {
        const configSnap = await getDoc(doc(db, 'appConfig', 'public'));
        const configuredCode = configSnap.data()?.inviteCode;
        if (!cancelled && typeof configuredCode === 'string' && configuredCode.trim()) {
          setActiveInviteCode(configuredCode.trim());
        }
      } catch (err) {
        console.warn('Failed to load app config:', err);
      }
    };
    loadAppConfig();
    return () => { cancelled = true; };
  }, []);

  // 구글 Redirect 로그인 완료 처리
  useEffect(() => {
    let cancelled = false;
    const completeRedirectLogin = async () => {
      setLoading(true);
      try {
        const result = await getRedirectResult(auth);
        if (!result?.user || cancelled) return;
        const savedCode = sessionStorage.getItem(GOOGLE_INVITE_SESSION_KEY) || '';
        await handleGoogleUser(result.user, savedCode);
      } catch (err: any) {
        if (!cancelled) setError(parseFirebaseError(err));
      } finally {
        sessionStorage.removeItem(GOOGLE_INVITE_SESSION_KEY);
        if (!cancelled) setLoading(false);
      }
    };
    completeRedirectLogin();
    return () => { cancelled = true; };
  }, []);

  // ✅ 버튼 한 방 — 익명 로그인 + 랜덤 게스트 닉네임 자동 생성
  const handleGuestEntry = async () => {
    if (loading) return;
    // 이미 로그인된 상태면 바로 리다이렉트 (중복 클릭 방지)
    if (auth.currentUser) {
      navigate('/channels/join_request');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await signInAnonymously(auth);
      const uid = result.user.uid;

      // ✅ setDoc 먼저 완료 후 navigate — profile이 준비된 상태로 이동
      const userDocRef = doc(db, 'users', uid);
      const userDoc = await getDoc(userDocRef);
      if (!userDoc.exists()) {
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const guestNickname = generateGuestNickname();
        await setDoc(userDocRef, {
          nickname: guestNickname,
          email: '',
          profileColor: color,
          photoURL: '',
          status: 'online',
          role: 'guest',
          xp: 0,
          level: 1,
          isAnonymous: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        sendGuestWelcomeLetter(uid).catch(() => {});
        // ✅ 운영자 알림: 게스트 입장
        notifyAdmins({
          type: 'new_guest_request',
          title: '게스트 입장',
          message: `👀 ${guestNickname}님이 게스트로 입장했습니다`,
          actorId: uid,
          actorName: guestNickname,
          url: '/admin',
        }).catch(console.error);
      }
      playCoinSound();
      navigate('/channels/join_request');
    } catch (err: any) {
      setError(parseFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    // ✅ 중복 호출 방지: useRef로 동기적 체크
    if (googleLoginLock.current) return;
    googleLoginLock.current = true;

    setError('');
    setLoading(true);
    sessionStorage.setItem(GOOGLE_INVITE_SESSION_KEY, signUpMode === 'guest' ? 'GUEST' : inviteCode);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await handleGoogleUser(result.user, inviteCode);
    } catch (err: any) {
      if (err.code === 'auth/popup-blocked' || err.code === 'auth/cancelled-popup-request') {
        await signInWithRedirect(auth, googleProvider);
        return;
      }
      setError(parseFirebaseError(err));
    } finally {
      googleLoginLock.current = false;
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) return;
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      await sendPasswordResetEmail(auth, resetEmail.trim());
      setSuccessMsg('비밀번호 재설정 이메일을 발송했습니다. 메일함을 확인해주세요.');
    } catch (err: any) {
      setError(parseFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        playCoinSound();
        await ensureUserDoc(cred.user.uid, email).catch(() => {});
        navigate('/');
      } else {
        if (signUpMode === 'regular' && inviteCode.trim() !== activeInviteCode) {
          setError('모임 초대 코드가 올바르지 않습니다. 카카오톡 공유방을 확인해주세요.');
          setLoading(false);
          return;
        }
        if (signUpMode === 'regular' && !inviteCode.trim()) {
          setError('초대 코드를 입력해주세요. 카카오톡 공유방에서 확인하실 수 있습니다.');
          setLoading(false);
          return;
        }
        if (!nickname.trim()) {
          setError('닉네임을 입력해주세요.');
          setLoading(false);
          return;
        }
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await ensureUserDoc(
          cred.user.uid,
          email,
          null,
          null,
          nickname.trim(),
          signUpMode === 'guest' ? 'guest' : undefined
        );
        if (signUpMode !== 'guest') {
          await sendWelcomeLetterIfEnabled(cred.user.uid);
          // ✅ 운영자 알림: 새 회원 가입 (이메일)
          notifyAdmins({
            type: 'new_user_joined',
            title: '새 회원 가입',
            message: `👋 ${nickname.trim() || email}님이 이메일로 가입했습니다!`,
            actorId: cred.user.uid,
            actorName: nickname.trim() || email,
            url: '/admin',
          }).catch(console.error);
        }
        playCoinSound();
        navigate('/');
      }
    } catch (err: any) {
      setError(parseFirebaseError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="flex h-screen w-full items-center justify-center bg-slate-900 bg-cover bg-center"
      style={{ backgroundImage: 'url(https://images.unsplash.com/photo-1497935586351-b67a49e012bf?auto=format&fit=crop&q=80&w=2000)' }}
    >
      <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm" />

      <div className="relative z-10 w-full max-w-md bg-white p-8 rounded-2xl shadow-2xl">
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img src="/logo.png" alt="동전커피 로고" className="w-12 h-12 object-contain drop-shadow-md" />
            <img src="/wordmark.png" alt="동전커피" className="h-8 object-contain" />
          </div>
          <p className="text-sm font-bold text-slate-500 mt-2">전국 커플 피플</p>
          <p className="text-xs text-slate-400 mt-1">우리만의 데이트 코스 & 맛집 공유 커뮤니티</p>
        </div>

        {/* ✅ 카카오톡 인앱브라우저 안내 */}
        {isInAppBrowser && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3.5">
            <p className="text-xs font-bold text-amber-700 mb-1">⚠️ 카카오톡 브라우저 감지</p>
            <p className="text-[11px] text-amber-600 leading-relaxed">
              일부 기능(로그인, 편지함 등)이 제한될 수 있습니다.
              <a href="/ios-guide.html" target="_blank" rel="noopener noreferrer" className="font-bold text-amber-800 underline ml-1">iOS 사용 가이드 →</a>
            </p>
          </div>
        )}

        {/* ✅ iOS Safari 권장 안내 */}
        {isIOS && !isInAppBrowser && (
          <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl p-3.5">
            <p className="text-xs font-bold text-blue-700 mb-1">📱 iOS 사용자 안내</p>
            <p className="text-[11px] text-blue-600 leading-relaxed">
              Safari에서 원활하게 이용하실 수 있습니다.
              <a href="/ios-guide.html" target="_blank" rel="noopener noreferrer" className="font-bold text-blue-800 underline ml-1">홈 화면 추가 방법 →</a>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div className="flex bg-slate-100 p-1 rounded-xl w-full">
              <div className="flex-1 py-2 text-xs font-bold rounded-lg bg-white shadow-sm text-rose-500 text-center">🤝 정회원 가입</div>
            </div>
          )}

          {!isLogin && signUpMode === 'regular' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-bold text-rose-500 uppercase tracking-wide mb-1">
                  모임 초대 코드 (신규 가입 필수)
                </label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  className="w-full bg-rose-50 border border-rose-200 rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none placeholder:text-rose-300"
                  placeholder="카카오톡 공유방에서 코드를 입력하세요"
                  required
                />
              </div>
              {/* 안내 메시지 */}
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1.5">
                <p className="text-[11px] text-blue-700 font-medium flex items-start gap-1.5">
                  <span className="shrink-0">🤝</span>
                  <span>모임 멤버이신가요? 카카오톡 공유방의 <strong>참여코드를 입력 후</strong> 가입해주세요.</span>
                </p>
                <p className="text-[11px] text-slate-500 font-medium flex items-start gap-1.5">
                  <span className="shrink-0">👀</span>
                  <span>아직 멤버가 아니신가요? 아래 <strong>"가입 전 둘러보기"</strong>를 눌러 게스트로 입장 후 가입신청을 진행해주세요.</span>
                </p>
              </div>
              {isGoogleDisabled && (
                <p className="text-[11px] text-rose-500 font-medium text-center">
                  ⚠️ 참여코드를 입력해야 Google 로그인이 가능합니다
                </p>
              )}
            </div>
          )}



          {!isLogin && (
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">닉네임</label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="w-full bg-slate-100 border-none rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none"
                placeholder="카카오톡 닉네임을 입력하세요"
                required={!isLogin}
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">이메일 (아이디)</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none"
              placeholder="user@example.com"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-100 border-none rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none"
              placeholder="••••••"
              required
            />
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-4 py-3">
              <p className="text-rose-600 text-sm font-medium">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-bold py-3 px-4 rounded-lg shadow-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? <><span className="animate-spin">⏳</span> 처리 중...</> : isLogin ? '로그인' : '가입하기'}
          </button>
        </form>

        {/* 비밀번호 재설정 토글 */}
        {isLogin && (
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => { setShowResetPassword(v => !v); setError(''); setSuccessMsg(''); }}
              className="text-xs text-slate-400 hover:text-rose-500 underline underline-offset-2 transition-colors"
            >
              비밀번호를 잊으셨나요?
            </button>
          </div>
        )}

        {/* 비밀번호 재설정 폼 */}
        {showResetPassword && isLogin && (
          <form onSubmit={handleResetPassword} className="mt-3 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-bold text-slate-600">등록한 이메일을 입력하시면 재설정 링크를 전송해드립니다.</p>
            <input
              type="email"
              value={resetEmail}
              onChange={e => setResetEmail(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none"
              placeholder="가입한 이메일 주소"
              required
            />
            {successMsg && <p className="text-emerald-600 text-xs font-bold bg-emerald-50 px-3 py-2 rounded-lg">{successMsg}</p>}
            <button
              type="submit"
              disabled={loading || !resetEmail.trim()}
              className="w-full bg-slate-700 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loading ? '전송 중...' : '재설정 링크 전송'}
            </button>
          </form>
        )}

        <div className="my-6 flex items-center before:mt-0.5 before:flex-1 before:border-t before:border-slate-200 after:mt-0.5 after:flex-1 after:border-t after:border-slate-200">
          <p className="mx-4 mb-0 text-center text-sm font-semibold text-slate-500">또는</p>
        </div>

        {/* 게스트 입장 — 눈에 덜 띄는 텍스트 링크 스타일 */}
        <div className="text-center mb-4">
          <button
            type="button"
            onClick={handleGuestEntry}
            disabled={loading}
            className="text-xs text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 mx-auto"
          >
            <span>👀</span>
            <span className="underline underline-offset-2">가입 전 둘러보기 (게스트 입장)</span>
          </button>
          <p className="text-[10px] text-slate-300 mt-1">이메일 없이 임시 입장 · 가입신청 채널만 이용 가능</p>
        </div>

        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading || isGoogleDisabled}
          className="w-full bg-white border border-slate-300 text-slate-700 font-bold py-3 px-4 rounded-lg shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
        >
          {loading ? (
             <><span className="animate-spin">⏳</span> <span>구글 로그인 중...</span></>
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              <span>Google 계정으로 계속하기</span>
            </>
          )}
        </button>

        <div className="mt-6 text-center text-sm text-slate-500">
          {isLogin ? '처음이신가요? ' : '이미 계정이 있나요? '}
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
            className="text-rose-500 font-bold hover:underline"
          >
            {isLogin ? '회원가입' : '이메일로 로그인'}
          </button>
        </div>
      </div>
    </div>
  );
}
