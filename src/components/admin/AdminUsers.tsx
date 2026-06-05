import React, { useState } from 'react';
import { collection, doc, updateDoc, deleteDoc, serverTimestamp, getDocs, query, where, addDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuthStore, UserProfile } from '../../stores/authStore';
import { ROLE_META } from './AdminTypes';

interface Props {
  users: (UserProfile & { id: string })[];
}

export function AdminUsers({ users }: Props) {
  const { profile } = useAuthStore();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState<string>('all');
  const [search, setSearch] = useState('');
  const canDelete = profile?.role === 'admin';

  const deleteUserData = async (userId: string) => {
    const collections = ['joinRequests', 'letters', 'notifications'];
    for (const col of collections) {
      console.log(`[AdminUsers] Querying and deleting from collection: ${col}`);
      try {
        const snap = await getDocs(query(collection(db, col), where('userId', '==', userId)));
        console.log(`[AdminUsers] Found ${snap.size} documents in ${col}`);
        for (const d of snap.docs) {
          try {
            await deleteDoc(d.ref);
          } catch (e: any) {
            console.error(`[AdminUsers] Failed to delete doc ${d.id} in ${col}:`, e);
            throw new Error(`[${col}] 컬렉션 문서(${d.id}) 삭제 권한 없음 또는 실패: ${e.message}`);
          }
        }
      } catch (e: any) {
        console.error(`[AdminUsers] Error processing collection ${col}:`, e);
        throw new Error(`[${col}] 컬렉션 쿼리 또는 삭제 실패: ${e.message}`);
      }
    }

    console.log(`[AdminUsers] Querying posts by authorId: ${userId}`);
    try {
      const postSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', userId)));
      console.log(`[AdminUsers] Found ${postSnap.size} posts`);
      for (const d of postSnap.docs) {
        try {
          await deleteDoc(d.ref);
        } catch (e: any) {
          console.error(`[AdminUsers] Failed to delete post doc ${d.id}:`, e);
          throw new Error(`게시물 문서(${d.id}) 삭제 권한 없음 또는 실패: ${e.message}`);
        }
      }
    } catch (e: any) {
      console.error(`[AdminUsers] Error processing posts:`, e);
      throw new Error(`게시물 목록 쿼리 또는 삭제 실패: ${e.message}`);
    }

    console.log(`[AdminUsers] Deleting main user profile document: ${userId}`);
    try {
      await deleteDoc(doc(db, 'users', userId));
      console.log(`[AdminUsers] Successfully deleted user profile document: ${userId}`);
    } catch (e: any) {
      console.error(`[AdminUsers] Failed to delete user profile document:`, e);
      throw new Error(`사용자 프로필 문서 삭제 실패: ${e.message}`);
    }
  };

  const filtered = users.filter(u => {
    const matchRole = filterRole === 'all' || u.role === filterRole;
    const matchSearch = !search || u.nickname?.toLowerCase().includes(search.toLowerCase())
      || u.email?.toLowerCase().includes(search.toLowerCase());
    return matchRole && matchSearch;
  });

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const isTopRole = newRole === 'admin' || newRole === 'manager';
      await updateDoc(doc(db, 'users', userId), {
        role: newRole,
        ...(isTopRole ? { level: 100, xp: 999999 } : {}),
        updatedAt: serverTimestamp(),
      });
    } catch { alert('권한 변경 실패'); }
  };

  const handleBanChange = async (userId: string, isBanned: boolean) => {
    try {
      await updateDoc(doc(db, 'users', userId), { isBanned, updatedAt: serverTimestamp() });
    } catch { alert('처리 실패'); }
  };

  const handleLevelChange = async (userId: string, newLevel: number) => {
    if (isNaN(newLevel) || newLevel < 1) return;
    try {
      await updateDoc(doc(db, 'users', userId), { level: newLevel, updatedAt: serverTimestamp() });
    } catch { console.error('Failed to change level'); }
  };

  // 유저 완전 삭제 (Firestore 데이터 전체)
  const handleFullDelete = async (u: UserProfile & { id: string }) => {
    if (!canDelete) {
      alert('삭제 기능은 운영자만 사용할 수 있습니다.');
      return;
    }
    const label = u.role === 'guest' ? '게스트' : '회원';
    if (u.role === 'admin') {
      alert('운영자 계정은 이 화면에서 삭제할 수 없습니다.');
      return;
    }
    if (!confirm(`정말 "${u.nickname}" ${label}을 삭제할까요?\n\n이 작업은 되돌릴 수 없습니다.\n가입신청, 우편, 알림, 작성 게시물, 회원정보가 삭제됩니다.`)) return;
    if (!confirm(`마지막 확인입니다.\n"${u.nickname}" ${label}의 회원정보를 진짜 삭제하시겠습니까?`)) return;
    setDeletingId(u.id);
    try {
      await deleteUserData(u.id);
      alert(`✅ "${u.nickname}" 완전 삭제 완료`);
    } catch (err: any) {
      alert('삭제 실패: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  // 게스트 일괄 정리 (1일 이상 된 게스트 삭제)
  const handleCleanupGuests = async () => {
    if (!canDelete) {
      alert('삭제 기능은 운영자만 사용할 수 있습니다.');
      return;
    }
    const oldGuests = users.filter(u => {
      if (u.role !== 'guest') return false;
      if (!u.createdAt?.toDate) return true;
      const diff = Date.now() - u.createdAt.toDate().getTime();
      return diff > 24 * 60 * 60 * 1000; // 1일
    });
    if (oldGuests.length === 0) { alert('정리할 만료 게스트가 없습니다.'); return; }
    if (!confirm(`24시간 이상 된 게스트 ${oldGuests.length}명을 일괄 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    if (!confirm(`마지막 확인입니다. 만료 게스트 ${oldGuests.length}명의 회원정보를 진짜 삭제할까요?`)) return;
    let count = 0;
    for (const g of oldGuests) {
      try {
        await deleteUserData(g.id);
        count++;
      } catch { /* skip */ }
    }
    alert(`✅ ${count}명의 만료 게스트 삭제 완료`);
  };

  const guestCount = users.filter(u => u.role === 'guest').length;

  return (
    <div className="space-y-4">
      {/* 필터 + 게스트 정리 */}
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="닉네임/이메일 검색..." className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs w-40"/>
        <select value={filterRole} onChange={e=>setFilterRole(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-1.5 text-xs">
          <option value="all">전체</option>
          <option value="guest">게스트</option>
          <option value="user">일반</option>
          <option value="regionalLeader">지역장</option>
          <option value="manager">부운영자</option>
          <option value="admin">운영자</option>
        </select>
        {canDelete && guestCount > 0 && (
          <button onClick={handleCleanupGuests}
            className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-xs font-bold">
            🧹 만료 게스트 정리 ({guestCount}명 중 24h+ 삭제)
          </button>
        )}
        <span className="text-xs text-slate-400 ml-auto">{filtered.length}명</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="py-2 px-3 font-bold text-slate-400">사용자</th>
              <th className="py-2 px-3 font-bold text-slate-400 hidden md:table-cell">이메일</th>
              <th className="py-2 px-3 font-bold text-slate-400">직책</th>
              <th className="py-2 px-3 font-bold text-slate-400">레벨</th>
              <th className="py-2 px-3 font-bold text-slate-400">정지</th>
              <th className="py-2 px-3 font-bold text-slate-400">삭제</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id} className={`border-b border-slate-50 hover:bg-slate-50 ${u.isBanned ? 'opacity-50' : ''} ${u.role === 'guest' ? 'bg-slate-50/50' : ''}`}>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full overflow-hidden bg-slate-200 flex items-center justify-center shrink-0"
                      style={{ backgroundColor: u.profileColor || '#e2e8f0' }}>
                      {u.photoURL ? <img src={u.photoURL} alt="" className="w-full h-full object-cover"/> : <span className="text-white text-[10px] font-bold">{u.nickname?.[0]}</span>}
                    </div>
                    <span className="font-bold text-slate-700 text-xs">{u.nickname}</span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-slate-400 hidden md:table-cell">{u.email || '익명'}</td>
                <td className="py-2.5 px-3">
                  {u.role === 'guest' ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">게스트</span>
                  ) : (
                    <select value={u.role} onChange={e=>handleRoleChange(u.id, e.target.value)}
                      disabled={u.role === 'admin' && profile?.role !== 'admin'}
                      className="text-[10px] font-bold border border-slate-200 rounded-lg px-1.5 py-0.5">
                      {Object.entries(ROLE_META).filter(([k])=>k!=='guest').map(([k,v])=>(
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                  )}
                </td>
                <td className="py-2.5 px-3">
                  {u.role !== 'guest' ? (
                    <input type="number" defaultValue={u.level||1} min={1} max={100}
                      onBlur={e=>handleLevelChange(u.id, parseInt(e.target.value))}
                      className="w-14 border border-slate-200 rounded-lg px-1.5 py-0.5 text-xs text-center"/>
                  ) : <span className="text-slate-300">-</span>}
                </td>
                <td className="py-2.5 px-3">
                  {u.role !== 'guest' && (
                    <button onClick={()=>handleBanChange(u.id, !u.isBanned)}
                      className={`text-[10px] font-bold px-2 py-1 rounded-lg ${u.isBanned ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600'}`}>
                      {u.isBanned ? '해제' : '정지'}
                    </button>
                  )}
                </td>
                <td className="py-2.5 px-3">
                  {canDelete ? (
                    <button onClick={()=>handleFullDelete(u)} disabled={deletingId===u.id || u.id===profile?.uid}
                      className="text-[10px] font-bold px-2 py-1 rounded-lg bg-rose-50 text-rose-500 hover:bg-rose-100 disabled:opacity-30">
                      {deletingId===u.id ? '...' : '삭제'}
                    </button>
                  ) : (
                    <span className="text-slate-300">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
