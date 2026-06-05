import React, { useState, useEffect } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, updateDoc, query, limit } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { uploadToCloudinary } from '../lib/cloudinary';
import { UserProfile, useAuthStore } from '../stores/authStore';
import {
  DECORATION_STYLES,
  DecorationStyleId,
  getEffectiveLevel,
  getHighestUnlockedDecoration,
  isDecorationUnlocked,
  resolveProfileDecorations,
} from '../lib/profileDecorations';

const ROLE_LABELS: Record<string, string> = {
  admin: '운영자 (방장)',
  manager: '부운영자',
  regionalLeader: '지역장',
  user: '일반 회원',
};

const COLORS = ['#f43f5e', '#ec4899', '#8b5cf6', '#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#f97316', '#64748b', '#000000'];

export function ProfilePage() {
  const { profile } = useAuthStore();
  const [nickname, setNickname] = useState('');
  const [bio, setBio] = useState('');
  const [profileColor, setProfileColor] = useState('');
  const [photoURL, setPhotoURL] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [decorationsEnabled, setDecorationsEnabled] = useState(true);
  const [avatarFrame, setAvatarFrame] = useState<DecorationStyleId>('none');
  const [nameStyle, setNameStyle] = useState<DecorationStyleId>('none');
  const [members, setMembers] = useState<(UserProfile & { id: string })[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [soundVolume, setSoundVolume] = useState(() => {
    const v = localStorage.getItem('dongjeon-volume');
    return v ? parseFloat(v) : 0.5;
  });

  useEffect(() => {
    if (profile) {
      setNickname(profile.nickname || '');
      setBio(profile.bio || '');
      setProfileColor(profile.profileColor || COLORS[0]);
      setPhotoURL(profile.photoURL || '');
      setPartnerId(profile.partnerId || '');
      const fallbackDecoration = getHighestUnlockedDecoration(profile).id;
      setDecorationsEnabled(profile.decorations?.enabled !== false);
      setAvatarFrame((profile.decorations?.avatarFrame as DecorationStyleId) || fallbackDecoration);
      setNameStyle((profile.decorations?.nameStyle as DecorationStyleId) || fallbackDecoration);
    }
  }, [profile]);

  useEffect(() => {
    const q = query(collection(db, 'users'), limit(150));
    const unsub = onSnapshot(q, (snapshot) => {
      setMembers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as UserProfile & { id: string })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
    return unsub;
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드 가능합니다.');
      return;
    }

    setIsSaving(true);
    setMessage('이미지 업로드 중...');

    try {
      const secureUrl = await uploadToCloudinary(file, 'profiles');
      setPhotoURL(secureUrl);
      setMessage('이미지가 업로드되었습니다. 저장 버튼을 눌러주세요.');
    } catch (err: any) {
      console.error('Profile image upload failed:', err);
      setMessage('이미지 업로드에 실패했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !profile) return;

    setIsSaving(true);
    setMessage('');

    try {
      await updateDoc(doc(db, 'users', auth.currentUser.uid), {
        nickname,
        bio,
        profileColor,
        photoURL,
        partnerId,
        decorations: {
          enabled: decorationsEnabled,
          avatarFrame,
          nameStyle,
        },
        updatedAt: serverTimestamp()
      });

      // ✅ 커플 꼼미기 동기화: 내 레벨이 커플보다 높으면 커플에게도 적용
      if (isMutualCouple && partner && decorationsEnabled) {
        const myLevel = profile.level || 1;
        const partnerLevel = (partner as any).level || 1;
        if (myLevel > partnerLevel) {
          await updateDoc(doc(db, 'users', partnerId), {
            decorations: { enabled: true, avatarFrame, nameStyle },
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }

      setMessage('프로필이 성공적으로 업데이트되었습니다.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${auth.currentUser.uid}`);
      setMessage('업데이트 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!profile) return <div>Loading...</div>;

  const currentUid = auth.currentUser?.uid;
  const partner = members.find(member => member.id === partnerId);
  const isMutualCouple = Boolean(partner && (partner as any).partnerId === currentUid);

  // ✅ 커플 프로필 브로특 (상호 연동 시 표시)
  const CoupleDisplay = () => {
    if (!isMutualCouple || !partner) return null;
    const partnerDecoration = resolveProfileDecorations(partner as any);
    return (
      <div className="mb-6 p-4 bg-gradient-to-r from-rose-50 to-pink-50 rounded-2xl border border-rose-100">
        <p className="text-xs font-bold text-rose-400 text-center mb-3">💕 커플 프로필</p>
        <div className="flex items-center justify-center gap-3">
          {/* 나 */}
          <div className="flex flex-col items-center gap-1">
            <div className={`rounded-full p-[2px] ${previewDecoration.avatarRingClass || 'bg-rose-200'}`}>
              {photoURL ? (
                <img src={photoURL} alt="me" className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ backgroundColor: profileColor }}>
                  {nickname.substring(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <span className={`text-xs font-bold ${previewDecoration.nameClass || 'text-slate-700'}`}>{nickname}</span>
            <span className="text-[10px] text-slate-400">Lv.{profile.level || 1}</span>
          </div>
          {/* 하트 */}
          <span className="text-2xl">❤️</span>
          {/* 커플 */}
          <div className="flex flex-col items-center gap-1">
            <div className={`rounded-full p-[2px] ${partnerDecoration.avatarRingClass || 'bg-rose-200'}`}>
              {(partner as any).photoURL ? (
                <img src={(partner as any).photoURL} alt="partner" referrerPolicy="no-referrer" className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ backgroundColor: (partner as any).profileColor || '#f43f5e' }}>
                  {((partner as any).nickname || '?').substring(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <span className={`text-xs font-bold ${partnerDecoration.nameClass || 'text-slate-700'}`}>{(partner as any).nickname}</span>
            <span className="text-[10px] text-slate-400">Lv.{(partner as any).level || 1}</span>
          </div>
        </div>
      </div>
    );
  };
  const selectableMembers = members
    .filter(member => member.id !== currentUid && member.role !== 'guest' && !(member as any).isAnonymous)
    .sort((a, b) => (a.nickname || '').localeCompare(b.nickname || '', 'ko'));
  const previewProfile = {
    ...profile,
    nickname,
    profileColor,
    photoURL,
    decorations: {
      enabled: decorationsEnabled,
      avatarFrame,
      nameStyle,
    },
  };
  const previewDecoration = resolveProfileDecorations(previewProfile);
  const effectiveLevel = getEffectiveLevel(profile);

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 relative overflow-y-auto">
      <header className="h-16 border-b border-slate-200 bg-white flex items-center px-6 shrink-0">
        <span className="text-2xl mr-2">👤</span>
        <h2 className="font-bold text-xl text-slate-800">내 프로필 관리</h2>
      </header>

      <main className="p-4 md:p-8 max-w-2xl mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5 md:p-8">
          <div className="flex flex-col sm:flex-row items-center sm:items-start space-y-4 sm:space-y-0 sm:space-x-6 mb-8 pb-8 border-b border-slate-100">
            <div className={`rounded-full p-[3px] shrink-0 ${previewDecoration.avatarRingClass || 'bg-white'}`}>
              {photoURL ? (
                <img
                  src={photoURL}
                  alt="Profile"
                  referrerPolicy="no-referrer"
                  className="w-24 h-24 rounded-full shadow-md object-cover bg-white"
                />
              ) : (
                <div
                  className="w-24 h-24 rounded-full border-4 border-slate-50 shadow-md flex items-center justify-center text-white text-3xl font-bold"
                  style={{ backgroundColor: profileColor }}
                >
                  {nickname.substring(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div className="text-center sm:text-left">
              <h3 className={`text-2xl font-bold ${previewDecoration.nameClass || 'text-slate-800'}`}>{nickname}</h3>
              <p className="text-slate-500 mt-1">{profile.email}</p>
              <div className="mt-3 flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <div className="text-xs font-semibold px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg inline-block uppercase shadow-sm">
                  권한: {ROLE_LABELS[profile.role] || ROLE_LABELS.user}
                </div>
                <div className="text-xs font-bold px-3 py-1.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-lg inline-block shadow-sm">
                  레벨: Lv.{profile.level || 1}
                </div>
                <div className="text-xs font-bold px-3 py-1.5 bg-rose-50 text-rose-600 border border-rose-100 rounded-lg inline-block shadow-sm">
                  경험치: {profile.xp || 0} XP
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSave} className="space-y-6">
            {profile.role !== 'guest' && <CoupleDisplay />}
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">닉네임</label>
              <input
                type="text"
                value={nickname}
                onChange={e => setNickname(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none"
                placeholder="카카오톡 닉네임을 입력하세요"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">프사 (프로필 사진) 첨부</label>
              <div className="flex items-center space-x-4">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-indigo-50 file:text-indigo-700
                    hover:file:bg-indigo-100 transition-colors cursor-pointer"
                />
                {photoURL && (
                  <button
                    type="button"
                    onClick={() => setPhotoURL('')}
                    className="text-xs text-rose-500 font-bold bg-rose-50 px-3 py-2 rounded-full hover:bg-rose-100 shrink-0"
                  >
                    사진 삭제
                  </button>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-2 ml-1">자동으로 보기 좋게 최적화되어 올라갑니다.</p>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">상태 메시지 (자기소개)</label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-400 focus:outline-none resize-none custom-scrollbar h-24"
                placeholder="자신을 간단히 소개해주세요!"
                maxLength={500}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">프로필 색상</label>
              <div className="flex flex-wrap gap-3">
                {COLORS.map(color => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setProfileColor(color)}
                    className={`w-10 h-10 rounded-full transition-transform ${profileColor === color ? 'scale-110 ring-4 ring-offset-2 ring-slate-200' : 'hover:scale-105'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-slate-800">레벨 꾸미기</p>
                  <p className="text-xs text-slate-500 mt-1">현재 Lv.{effectiveLevel} 기준으로 해금된 테두리와 닉네임 색을 선택합니다.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDecorationsEnabled(v => !v)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-black transition-colors ${decorationsEnabled ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-500'}`}
                >
                  {decorationsEnabled ? '켜짐' : '꺼짐'}
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-black text-slate-600">프로필 테두리</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DECORATION_STYLES.map(style => {
                    const unlocked = isDecorationUnlocked(profile, style.id);
                    const selected = avatarFrame === style.id;
                    return (
                      <button
                        key={`frame-${style.id}`}
                        type="button"
                        disabled={!unlocked}
                        onClick={() => setAvatarFrame(style.id)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${selected ? 'border-indigo-400 bg-white shadow-sm' : 'border-slate-200 bg-white/70 hover:bg-white'} ${!unlocked ? 'opacity-45' : ''}`}
                      >
                        <span className={`h-5 w-5 rounded-full ${style.swatchClass}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-black text-slate-700">{style.label}</span>
                          <span className="block text-[10px] font-bold text-slate-400">Lv.{style.minLevel}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-black text-slate-600">닉네임 색상</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {DECORATION_STYLES.map(style => {
                    const unlocked = isDecorationUnlocked(profile, style.id);
                    const selected = nameStyle === style.id;
                    return (
                      <button
                        key={`name-${style.id}`}
                        type="button"
                        disabled={!unlocked}
                        onClick={() => setNameStyle(style.id)}
                        className={`rounded-xl border px-3 py-2 text-left transition-all ${selected ? 'border-indigo-400 bg-white shadow-sm' : 'border-slate-200 bg-white/70 hover:bg-white'} ${!unlocked ? 'opacity-45' : ''}`}
                      >
                        <span className={`block truncate text-xs font-black ${style.nameClass || 'text-slate-700'}`}>{style.label}</span>
                        <span className="block text-[10px] font-bold text-slate-400">Lv.{style.minLevel}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {profile.role !== 'guest' && (
              <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                <label className="block text-sm font-bold text-slate-800 mb-2">커플 연동</label>
                <select
                  value={partnerId}
                  onChange={e => setPartnerId(e.target.value)}
                  className="w-full bg-white border border-rose-100 rounded-lg px-4 py-3 text-slate-800 focus:ring-2 focus:ring-rose-300 focus:outline-none"
                >
                  <option value="">연동 안 함</option>
                  {selectableMembers.map(member => (
                    <option key={member.id} value={member.id}>
                      {member.nickname} · Lv.{member.level || 1}
                    </option>
                  ))}
                </select>
                <p className={`mt-2 text-xs font-bold ${isMutualCouple ? 'text-emerald-600' : 'text-slate-500'}`}>
                  {partnerId
                    ? isMutualCouple
                      ? `${partner?.nickname || '상대'}님과 서로 연동됐어요. 둘 다 접속하면 커플 효과가 켜집니다.`
                      : '상대도 내 프로필을 선택하면 커플 효과가 켜집니다.'
                    : '내 커플을 지정하면 멤버 목록에서 함께 접속 중일 때 전용 효과가 표시됩니다.'}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <label className="block text-sm font-bold text-slate-800 mb-2 flex items-center justify-between">
                <span>앱 효과음 볼륨 🪙</span>
                <span className="text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">{Math.round(soundVolume * 100)}%</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={soundVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setSoundVolume(val);
                  localStorage.setItem('dongjeon-volume', String(val));
                  // 동적 임포트로 사운드 테스트
                  import('../lib/sound').then(({ playCoinSound }) => {
                    playCoinSound();
                  });
                }}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400 mt-1 font-bold">
                <span>음소거</span>
                <span>최대 볼륨</span>
              </div>
            </div>

            {message && (
              <div className={`p-4 rounded-lg text-sm font-medium ${message.includes('오류') || message.includes('실패') ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                {message}
              </div>
            )}

            <div className="pt-4">
              <button
                type="submit"
                disabled={isSaving}
                className="w-full bg-slate-900 text-white font-bold py-3 px-4 rounded-lg shadow-md hover:bg-slate-800 transition-colors disabled:opacity-50"
              >
                {isSaving ? '저장 중...' : '프로필 저장하기'}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
