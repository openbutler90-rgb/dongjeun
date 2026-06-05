import React, { useState } from 'react';
import { collection, doc, updateDoc, addDoc, serverTimestamp, deleteDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { sendPersonalNotification, notifyAdmins } from '../../lib/notifications';
import { useAuthStore, UserProfile } from '../../stores/authStore';
import { JoinRequest, OperationOptions, DEFAULT_APPROVAL_LETTER, ROLE_META } from './AdminTypes';
import { deleteUser as fbDeleteUser } from 'firebase/auth';

interface Props {
  joinRequests: JoinRequest[];
  users: (UserProfile & { id: string })[];
  operationOptions: OperationOptions;
  inviteCodeSetting: string;
}

export function AdminJoinRequests({ joinRequests, users, operationOptions, inviteCodeSetting }: Props) {
  const { profile, user } = useAuthStore();
  const [selectedRequest, setSelectedRequest] = useState<JoinRequest | null>(null);
  const [approveModal, setApproveModal] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [showFilterMenu, setShowFilterMenu] = useState(false);

  // 승인 편지 설정값 (운영설정에서 가져오거나 기본값)
  const [approvalLetter, setApprovalLetter] = useState(
    operationOptions.approvalLetterTemplate || DEFAULT_APPROVAL_LETTER
  );
  const [kakaoLink, setKakaoLink] = useState(operationOptions.approvalKakaoLink || '');
  const [joinCode, setJoinCode] = useState(operationOptions.approvalJoinCode || '');
  const [rules, setRules] = useState(operationOptions.approvalRules || '');
  const [inviteCode, setInviteCode] = useState(inviteCodeSetting || '');
  const [finalLetter, setFinalLetter] = useState('');

  const filtered = joinRequests.filter(r => filterStatus === 'all' || r.status === filterStatus);
  const pendingRequests = joinRequests.filter(r => r.status === 'pending');

  const renderLetterWithValues = (template: string, values: { kakaoLink: string; joinCode: string; rules: string; inviteCode: string }) =>
    template
      .replace(/{{KAKAO_LINK}}/g, values.kakaoLink)
      .replace(/{{JOIN_CODE}}/g, values.joinCode)
      .replace(/{{RULES}}/g, values.rules)
      .replace(/{{INVITE_CODE}}/g, values.inviteCode);

  const renderLetter = (template: string) =>
    renderLetterWithValues(template, { kakaoLink, joinCode, rules, inviteCode });

  const toggleExpanded = (id: string) => {
    setActiveMenuId(null);
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openApprove = (req: JoinRequest) => {
    setSelectedRequest(req);
    setRejectReason('');
    const template = operationOptions.approvalLetterTemplate || DEFAULT_APPROVAL_LETTER;
    const nextKakaoLink = operationOptions.approvalKakaoLink || '';
    const nextJoinCode = operationOptions.approvalJoinCode || '';
    const nextRules = operationOptions.approvalRules || '';
    const nextInviteCode = inviteCodeSetting || '';
    setApprovalLetter(template);
    setKakaoLink(nextKakaoLink);
    setJoinCode(nextJoinCode);
    setRules(nextRules);
    setInviteCode(nextInviteCode);
    setFinalLetter(renderLetterWithValues(template, {
      kakaoLink: nextKakaoLink,
      joinCode: nextJoinCode,
      rules: nextRules,
      inviteCode: nextInviteCode,
    }));
    setApproveModal(true);
  };

  const statusBadge = (status: string) => {
    if (status === 'pending')  return 'bg-amber-100 text-amber-700';
    if (status === 'approved') return 'bg-green-100 text-green-700';
    return 'bg-rose-100 text-rose-600';
  };
  const statusLabel = (s: string) => s === 'pending' ? '대기' : s === 'approved' ? '승인' : '거절';


  // ── 게스트 완전 삭제 (Firestore만 - Auth 삭제는 Cloud Function 필요)
  const handleDeleteGuest = async (req: JoinRequest) => {
    if (profile?.role !== 'admin') {
      alert('삭제 기능은 운영자만 사용할 수 있습니다.');
      return;
    }
    if (!confirm(`정말 "${req.nickname}" 게스트를 삭제할까요?\n\n가입신청, 우편, 알림, 게스트 회원정보가 삭제됩니다.\n이 작업은 되돌릴 수 없습니다.`)) return;
    if (!confirm(`마지막 확인입니다.\n"${req.nickname}" 게스트 정보를 진짜 삭제하시겠습니까?`)) return;
    setIsProcessing(true);
    try {
      const relatedCollections = ['letters', 'notifications'];
      for (const col of relatedCollections) {
        console.log(`[AdminJoinRequests] Deleting docs in collection: ${col} for userId: ${req.userId}`);
        try {
          const snap = await getDocs(query(collection(db, col), where('userId', '==', req.userId)));
          for (const d of snap.docs) {
            try {
              await deleteDoc(d.ref);
            } catch (e: any) {
              throw new Error(`[${col}] 컬렉션 문서(${d.id}) 삭제 권한 부족 또는 실패: ${e.message}`);
            }
          }
        } catch (e: any) {
          throw new Error(`[${col}] 컬렉션 처리 중 실패: ${e.message}`);
        }
      }
      
      console.log(`[AdminJoinRequests] Deleting joinRequest document: ${req.id}`);
      try {
        await deleteDoc(doc(db, 'joinRequests', req.id));
      } catch (e: any) {
        throw new Error(`가입 신청서 문서 삭제 실패: ${e.message}`);
      }

      console.log(`[AdminJoinRequests] Deleting user document: ${req.userId}`);
      try {
        await deleteDoc(doc(db, 'users', req.userId));
      } catch (e: any) {
        throw new Error(`사용자 프로필 문서 삭제 실패: ${e.message}`);
      }

      setSelectedRequest(null);
      alert(`✅ "${req.nickname}" 게스트 완전 삭제 완료`);
    } catch (err: any) {
      alert('삭제 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const approveRequest = async (req: JoinRequest, finalContent: string) => {
    if (!user || !profile) return;
    await updateDoc(doc(db, 'joinRequests', req.id), {
        status: 'approved', approvedAt: serverTimestamp(),
        approvedBy: user.uid, onboardingMsg: finalContent, updatedAt: serverTimestamp(),
      });
      // ✅ 승인 시 role을 'user'로 바꾸지 않음 — 정식 가입(이메일/구글) 완료 후에만 해금
      await updateDoc(doc(db, 'users', req.userId), {
        joinApproved: true, updatedAt: serverTimestamp(),
      });
      await addDoc(collection(db, 'letters'), {
        userId: req.userId,
        title: '🎉 동전커피 가입이 승인되었습니다!',
        content: finalContent,
        senderId: user.uid,
        senderName: profile.nickname || '운영진',
        read: false, type: 'approval',
        createdAt: serverTimestamp(),
      });
      // ✅ 승인 알림 (Firestore + OneSignal)
      await sendPersonalNotification({
        userId: req.userId,
        type: 'guest_approved',
        title: '가입 승인 완료',
        message: '🎉 동전커피 가입이 승인되었습니다! 편지함을 확인해주세요.',
        actorId: user.uid,
        actorName: profile.nickname || '운영진',
        url: import.meta.env.VITE_APP_URL || '',
      });
  };

  // ── 승인 처리
  const handleApprove = async () => {
    if (!selectedRequest || !user || !profile) return;
    setIsProcessing(true);
    try {
      const finalContent = (finalLetter || renderLetter(approvalLetter)).trim();
      if (!finalContent) { alert('승인 편지 내용을 입력해주세요.'); return; }

      await approveRequest(selectedRequest, finalContent);
      setApproveModal(false);
      setSelectedRequest(null);
      alert(`✅ ${selectedRequest.nickname}님 승인 완료! 편지가 발송되었습니다.`);
    } catch (err: any) {
      alert('승인 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulkApprove = async () => {
    if (!user || !profile) return;
    if (pendingRequests.length === 0) { alert('승인할 대기자가 없습니다.'); return; }
    const template = operationOptions.approvalLetterTemplate || DEFAULT_APPROVAL_LETTER;
    const finalContent = renderLetterWithValues(template, {
      kakaoLink: operationOptions.approvalKakaoLink || '',
      joinCode: operationOptions.approvalJoinCode || '',
      rules: operationOptions.approvalRules || '',
      inviteCode: inviteCodeSetting || '',
    }).trim();
    if (!finalContent) { alert('승인 편지 내용을 먼저 설정해주세요.'); return; }
    if (!confirm(`대기자 ${pendingRequests.length}명을 한 번에 승인하고 같은 안내 편지를 발송할까요?`)) return;
    setIsProcessing(true);
    try {
      for (const req of pendingRequests) {
        await approveRequest(req, finalContent);
      }
      alert(`✅ 대기자 ${pendingRequests.length}명 일괄 승인 완료!`);
    } catch (err: any) {
      alert('일괄 승인 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── 거절 처리
  const handleReject = async () => {
    if (!selectedRequest || !rejectReason.trim()) { alert('거절 사유를 입력해주세요.'); return; }
    setIsProcessing(true);
    try {
      await updateDoc(doc(db, 'joinRequests', selectedRequest.id), {
        status: 'rejected', rejectReason: rejectReason.trim(),
        rejectedAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      await sendPersonalNotification({
        userId: selectedRequest.userId,
        type: 'guest_approved',
        title: '가입 신청 반려',
        message: '⚠️ 가입신청이 반려되었습니다. 가입신청 채널에서 사유를 확인해주세요.',
        actorId: user!.uid,
        actorName: profile?.nickname || '운영진',
      });
      setRejectModal(false);
      setSelectedRequest(null);
      setRejectReason('');
    } catch (err: any) {
      alert('거절 실패: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };


  return (
    <div className="space-y-4">
      {/* ✅ 자동 승인 토글 (축소: 큰 카드 → 슬림한 행) */}
      <div className="flex items-center justify-between py-2 px-3 rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${operationOptions.autoApproveEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            {operationOptions.autoApproveEnabled ? '⚡ ON' : 'OFF'}
          </span>
          <span className="text-xs text-slate-500">자동 승인</span>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              const { setDoc, doc: fsDoc } = await import('firebase/firestore');
              const { db: fsDb } = await import('../../lib/firebase');
              const next = !operationOptions.autoApproveEnabled;
              await setDoc(fsDoc(fsDb, 'appConfig', 'public'), {
                operationOptions: { ...operationOptions, autoApproveEnabled: next },
              }, { merge: true });
              alert(next ? '✅ 자동 승인이 켜졌습니다.' : '⏸ 자동 승인이 꺼졌습니다.');
            } catch (e: any) { alert('변경 실패: ' + e.message); }
          }}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${operationOptions.autoApproveEnabled ? 'bg-emerald-500' : 'bg-slate-300'}`}
        >
          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${operationOptions.autoApproveEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {/* ✅ 필터/액션 메뉴 (버튼 5개 → ⋮ 하나로 통합) */}
      <div className="flex items-center justify-between">
        <div className="relative">
          <button
            onClick={() => setShowFilterMenu(!showFilterMenu)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border bg-white text-slate-600 border-slate-200 hover:border-slate-400 transition-all"
          >
            {filterStatus === 'all' ? '전체' : filterStatus === 'pending' ? `대기 (${pendingRequests.length})` : filterStatus === 'approved' ? '승인' : '거절'}
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </button>
          {showFilterMenu && (
            <div className="absolute left-0 top-full mt-1 w-36 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-30 overflow-hidden">
              {(['all','pending','approved','rejected'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => { setFilterStatus(s); setShowFilterMenu(false); }}
                  className={`w-full text-left px-3 py-2 text-xs font-bold transition-colors ${filterStatus===s ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {s==='all'?'전체':s==='pending'?`대기 (${joinRequests.filter(r=>r.status==='pending').length})`:s==='approved'?'승인':'거절'}
                </button>
              ))}
              <div className="border-t border-slate-100 my-1" />
              <button
                onClick={() => { handleBulkApprove(); setShowFilterMenu(false); }}
                disabled={isProcessing || pendingRequests.length === 0}
                className="w-full text-left px-3 py-2 text-xs font-bold text-green-600 hover:bg-green-50 transition-colors disabled:opacity-40"
              >
                ✅ 대기자 전체 승인 ({pendingRequests.length})
              </button>
            </div>
          )}
        </div>
        <span className="text-[11px] text-slate-400 font-bold">총 {filtered.length}건</span>
      </div>

      {/* 신청 목록 */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">가입신청이 없습니다.</div>
        )}
        {filtered.map(req => {
          const isExpanded = expandedIds.has(req.id);
          return (
          <div key={req.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => toggleExpanded(req.id)} className="flex items-center gap-3 text-left flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 font-bold text-xs overflow-hidden shrink-0">
                  {req.userPhotoURL ? <img src={req.userPhotoURL} alt="" className="w-full h-full object-cover"/> : req.nickname?.[0]}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{req.nickname}</p>
                  <p className="text-[10px] text-slate-400">{req.createdAt?.toDate?.().toLocaleString('ko-KR') || ''}</p>
                </div>
              </button>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBadge(req.status)}`}>
                  {statusLabel(req.status)}
                </span>
                {/* ✅ ⋮ 액션 메뉴 */}
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(activeMenuId === req.id ? null : req.id);
                    }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>
                  </button>
                  {activeMenuId === req.id && (
                    <div className="absolute right-0 mt-1 w-28 bg-white border border-slate-100 rounded-xl shadow-lg py-1 z-30 overflow-hidden">
                      {req.status === 'pending' && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); openApprove(req); setActiveMenuId(null); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-green-600 hover:bg-green-50 transition-colors"
                          >✅ 승인</button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setSelectedRequest(req); setRejectModal(true); setActiveMenuId(null); }}
                            className="w-full text-left px-3 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 transition-colors border-t border-slate-50"
                          >❌ 거절</button>
                        </>
                      )}
                      {profile?.role === 'admin' && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteGuest(req); setActiveMenuId(null); }}
                          disabled={isProcessing}
                          className="w-full text-left px-3 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors border-t border-slate-50 disabled:opacity-50"
                        >🗑️ 삭제</button>
                      )}
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => toggleExpanded(req.id)} className="text-xs text-slate-400 hover:text-slate-600">
                  {isExpanded ? '▲' : '▼'}
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="space-y-1.5">
                {req.answers?.map((a, i) => (
                  <div key={i} className="bg-slate-50 rounded-xl px-3 py-2">
                    <p className="text-[10px] text-slate-400 font-bold">Q{i+1}. {a.questionText}</p>
                    <p className="text-xs font-bold text-slate-700 mt-0.5">
                      {a.selectedOption === '직접 적기' ? `직접: ${a.directText}` : a.selectedOption}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* 액션 버튼 → ⋮ 메뉴로 통합됨 */}
          </div>
        )})}
      </div>


      {/* 승인 모달 */}
      {approveModal && selectedRequest && (
        <div className="fixed inset-0 z-[99999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base font-black text-slate-800">✅ {selectedRequest.nickname}님 가입 승인</h3>
              <button onClick={() => setApproveModal(false)} className="text-slate-400 hover:text-rose-500 p-1">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <p className="text-xs text-slate-500 bg-blue-50 px-3 py-2 rounded-xl">
                승인 시 해당 게스트는 정회원으로 승격되고, 아래 편지가 자동 발송됩니다.
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">오픈카톡 링크</label>
                  <input value={kakaoLink} onChange={e=>setKakaoLink(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="https://open.kakao.com/..."/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">참여코드</label>
                  <input value={joinCode} onChange={e=>setJoinCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="참여코드"/>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1">앱 초대코드</label>
                  <input value={inviteCode} onChange={e=>setInviteCode(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="앱 초대코드"/>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">이용 규칙</label>
                <textarea value={rules} onChange={e=>setRules(e.target.value)} rows={4}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"/>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">발송 편지 내용 ({'{{변수}}'}: KAKAO_LINK, JOIN_CODE, INVITE_CODE, RULES)</label>
                <textarea value={approvalLetter} onChange={e=>setApprovalLetter(e.target.value)} rows={12}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"/>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">최종 발송 내용 (직접 수정 가능)</label>
                <textarea
                  value={finalLetter}
                  onChange={e => setFinalLetter(e.target.value)}
                  rows={10}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                />
                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setFinalLetter(renderLetter(approvalLetter))}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-[11px] font-bold"
                  >
                    템플릿으로 다시 만들기
                  </button>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2 shrink-0">
              <button onClick={() => setApproveModal(false)} className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-bold text-slate-600">취소</button>
              <button onClick={handleApprove} disabled={isProcessing}
                className="flex-1 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {isProcessing ? '처리 중...' : '✅ 승인 확정 + 편지 발송'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 거절 모달 */}
      {rejectModal && selectedRequest && (
        <div className="fixed inset-0 z-[99999] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base font-black text-slate-800">❌ {selectedRequest.nickname}님 거절</h3>
              <button onClick={() => setRejectModal(false)} className="text-slate-400 p-1">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <label className="text-xs font-bold text-slate-600 block">거절 사유 (게스트에게 표시됩니다)</label>
              <textarea value={rejectReason} onChange={e=>setRejectReason(e.target.value)} rows={4}
                placeholder="거절 사유를 입력하세요..." className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"/>
            </div>
            <div className="p-4 border-t border-slate-100 flex gap-2">
              <button onClick={() => setRejectModal(false)} className="flex-1 py-2.5 bg-slate-100 rounded-xl text-sm font-bold text-slate-600">취소</button>
              <button onClick={handleReject} disabled={isProcessing}
                className="flex-1 py-2.5 bg-rose-500 hover:bg-rose-600 text-white rounded-xl text-sm font-bold disabled:opacity-50">
                {isProcessing ? '처리 중...' : '❌ 거절 처리'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
