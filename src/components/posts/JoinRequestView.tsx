import React, { useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, addDoc, doc, deleteDoc, serverTimestamp, getDoc, getDocs, updateDoc, limit } from 'firebase/firestore';
import { db, auth } from '../../lib/firebase';
import { useAuthStore } from '../../stores/authStore';
import { notifyAdmins } from '../../lib/notifications';
import { DEFAULT_OPERATION_OPTIONS } from '../admin/AdminTypes';

interface JoinQuestion {
  id: string;
  type: 'choice' | 'text';
  question: string;
  options?: string[];
  answerType?: 'choice' | 'text' | 'freetext_only'; // 객관식/주관식/주간식 구분 (v2)
}

interface JoinAnswer {
  questionId: string;
  questionText: string;
  selectedOption: string;
  directText?: string;
}

interface JoinRequest {
  id: string;
  userId: string;
  nickname: string;
  status: 'pending' | 'approved' | 'rejected';
  answers: JoinAnswer[];
  rejectReason?: string;
  createdAt: any;
}

const DEFAULT_JOIN_QUESTIONS: JoinQuestion[] = [
  { 
    id: 'q1', 
    type: 'choice', 
    question: '동전커피 모임에 가입하려는 주된 목적이 무엇인가요?', 
    options: ['동네 친구 만들기', '맛집/카페 탐방', '소모임 참석', '정보 공유', '직접 적기'] 
  },
  { 
    id: 'q2', 
    type: 'choice', 
    question: '커뮤니티 가이드라인을 준수하고 매너를 지켜주실 건가요?', 
    options: ['네, 준수하겠습니다', '아니요', '직접 적기'] 
  },
  { 
    id: 'q3', 
    type: 'choice', 
    question: '거주하고 계신 지역은 어디인가요?', 
    options: ['서울/수도권', '인천/경기', '대전/세종/충청', '광주/전라', '대구/경북', '부산/울산/경남', '강원/제주', '직접 적기'] 
  }
];

export function JoinRequestView() {
  const { user, profile, isLoading: authLoading } = useAuthStore();
  const [questions, setQuestions] = useState<JoinQuestion[]>(DEFAULT_JOIN_QUESTIONS);
  const [answers, setAnswers] = useState<Record<string, { selected: string; direct: string }>>({});
  const [myRequest, setMyRequest] = useState<JoinRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // 게스트 아닌 사용자는 이 채널 접근 불가
  const isGuest = profile?.role === 'guest';

  // 인증 로딩 중이면 로딩 UI
  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <span className="animate-spin text-2xl mb-2">⏳</span>
        <p className="text-xs font-bold">로딩 중...</p>
      </div>
    );
  }

  if (!isGuest) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <span className="text-5xl mb-4">🔒</span>
        <p className="text-sm font-bold">이 채널은 게스트 전용입니다.</p>
      </div>
    );
  }

  // 가입 질문 로드
  useEffect(() => {
    getDoc(doc(db, 'appConfig', 'public')).then((snap) => {
      const data = snap.data();
      if (data?.joinQuestions && Array.isArray(data.joinQuestions) && data.joinQuestions.length > 0) {
        setQuestions(data.joinQuestions);
      }
    }).catch(err => console.warn('Failed to load join questions:', err));
  }, []);

  // 가입 신청서 상태 실시간 감지
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'joinRequests'),
      where('userId', '==', user.uid)
    );

    const unsub = onSnapshot(q, (snap) => {
      if (!snap.empty) {
        const docData = snap.docs[0];
        const raw = docData.data();
        setMyRequest({
          id: docData.id,
          ...raw,
          answers: Array.isArray(raw.answers) ? raw.answers : []
        } as JoinRequest);
      } else {
        setMyRequest(null);
      }
      setLoading(false);
    }, (err) => {
      console.error('Failed to load join request:', err);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  // 질문 옵션 변경 핸들러
  const handleSelectChange = (questionId: string, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        selected: value,
        direct: prev[questionId]?.direct || ''
      }
    }));
  };

  // 질문 직접 적기 내용 변경 핸들러
  const handleDirectTextChange = (questionId: string, value: string) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: {
        selected: prev[questionId]?.selected || '',
        direct: value
      }
    }));
  };

  // 신청서 제출
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    // 답변 검증
    const formattedAnswers: JoinAnswer[] = [];
    for (const q of questions) {
      const ans = answers[q.id];
      const isTextOnly = q.type === 'text' || q.answerType === 'text' || q.answerType === 'freetext_only';
      if (isTextOnly) {
        if (!ans?.direct?.trim()) {
          alert(`질문: "${q.question}"에 답변해 주세요.`);
          return;
        }
        formattedAnswers.push({
          questionId: q.id,
          questionText: q.question,
          selectedOption: '직접 적기',
          directText: ans.direct.trim()
        });
        continue;
      }
      if (!ans || !ans.selected) {
        alert(`질문: "${q.question}"에 답변해 주세요.`);
        return;
      }
      if (ans.selected === '직접 적기' && !ans.direct.trim()) {
        alert(`질문: "${q.question}"의 직접 입력란을 작성해 주세요.`);
        return;
      }

      const answer: JoinAnswer = {
        questionId: q.id,
        questionText: q.question,
        selectedOption: ans.selected
      };
      if (ans.selected === '직접 적기') answer.directText = ans.direct.trim();
      formattedAnswers.push(answer);
    }

    setSubmitting(true);
    try {
      const data: any = {
        userId: user.uid,
        nickname: profile.nickname,
        status: 'pending',
        answers: formattedAnswers,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      // undefined 필드 제외 (Firestore 제약)
      if (profile.photoURL) data.userPhotoURL = profile.photoURL;
      if (profile.email) data.userEmail = profile.email;
      
      const requestRef = await addDoc(collection(db, 'joinRequests'), data);
      setMyRequest({
        id: requestRef.id,
        ...(data as any),
        answers: formattedAnswers || []
      } as JoinRequest);

      // ✅ 운영자 알림: 새 게스트 신청
      notifyAdmins({
        type: 'new_guest_request',
        title: '새 게스트 신청',
        message: `📩 ${profile.nickname || '익명'}님이 가입을 신청했습니다.`,
        actorId: user.uid,
        actorName: profile.nickname || '익명',
        url: `${import.meta.env.VITE_APP_URL || ''}/admin`,
      }).catch(console.error);

      // ✅ 자동 승인 체크
      let autoApproved = false;
      try {
        const configSnap = await getDoc(doc(db, 'appConfig', 'public'));
        const opOpts = { ...DEFAULT_OPERATION_OPTIONS, ...configSnap.data()?.operationOptions };
        if (opOpts.autoApproveEnabled === true) {
          // 닉네임 관련 질문 여부 판단
          const isNicknameQ = (text: string) => /닉네임|이름|성함/.test(text);
          // 질문이 텍스트 입력 전용인지 판단 (options가 없거나 명시적 text 타입이면 텍스트 필드)
          const isTextOnlyQuestion = (q?: JoinQuestion) => {
            if (!q) return false;
            if (q.type === 'text' || q.answerType === 'text' || q.answerType === 'freetext_only') return true;
            if (!q.options || q.options.length === 0) return true;
            // options가 ['직접 적기'] 하나만 있어도 텍스트 필드로 간주
            if (q.options.length === 1 && q.options[0] === '직접 적기') return true;
            return false;
          };
          // 자동 승인 불가 조건: 아니요 답변 OR 선택지가 있는 질문에서 직접 적기로 변경
          const blockAutoApprove = formattedAnswers.some(a => {
            const q = questions.find(qItem => qItem.id === a.questionId);
            const isTextOnly = isTextOnlyQuestion(q);
            const blocked = (
              a.selectedOption === '아니요' ||
              a.selectedOption === '아니오' ||
              (a.selectedOption === '직접 적기' && !isNicknameQ(a.questionText) && !isTextOnly)
            );
            return blocked;
          });
          // 디버깅: 개발자 도구(F12) 콘솔에서 확인
          console.log('[AutoApprove] questions:', questions.map(q => ({ id: q.id, text: q.question.slice(0, 20), type: q.type, options: q.options?.length })));
          console.log('[AutoApprove] answers:', formattedAnswers.map(a => ({ qid: a.questionId, text: a.questionText.slice(0, 20), sel: a.selectedOption })));
          console.log('[AutoApprove] blockAutoApprove:', blockAutoApprove);
          if (!blockAutoApprove) {
            // 승인 편지 내용 생성
            const template = opOpts.approvalLetterTemplate || '';
            const letterContent = template
              .replace(/{{KAKAO_LINK}}/g, opOpts.approvalKakaoLink || '')
              .replace(/{{JOIN_CODE}}/g, opOpts.approvalJoinCode || '')
              .replace(/{{RULES}}/g, opOpts.approvalRules || '')
              .replace(/{{INVITE_CODE}}/g, configSnap.data()?.inviteCode || '동전커피2026')
              || '✅ 동전커피 가입이 자동 승인되었습니다! 운영진 안내를 기다려주세요.';
            // Firestore 업데이트 (가입신청 상태 변경 — role은 정식 가입 후에만 'user'로 변경)
            await updateDoc(doc(db, 'joinRequests', requestRef.id), {
              status: 'approved',
              approvedAt: serverTimestamp(),
              approvedBy: 'auto',
              onboardingMsg: letterContent,
              updatedAt: serverTimestamp(),
            });
            await updateDoc(doc(db, 'users', user.uid), {
              joinApproved: true,
              updatedAt: serverTimestamp()
            }).catch(e => console.warn('자동 승인 플래그 저장 오류:', e));

            await addDoc(collection(db, 'letters'), {
              userId: user.uid,
              title: '🎉 동전커피 가입이 승인되었습니다!',
              content: letterContent,
              senderId: 'auto',
              senderName: '운영진 (자동 승인)',
              read: false,
              type: 'approval',
              createdAt: serverTimestamp(),
            });
            await addDoc(collection(db, 'notifications'), {
              userId: user.uid,
              type: 'system',
              actorId: 'auto',
              actorName: '운영진',
              message: '🎉 가입이 자동 승인되었습니다! 편지함을 확인해주세요.',
              read: false,
              createdAt: serverTimestamp(),
            });
            autoApproved = true;
          }
        }
      } catch (autoErr) {
        console.warn('자동 승인 처리 중 오류:', autoErr);
      }

      // 자동 승인이 아닌 경우에만 '접수됨' 편지 발송
      if (!autoApproved) {
        await addDoc(collection(db, 'letters'), {
          userId: user.uid,
          title: '📝 가입신청이 접수되었습니다',
          content: '가입 신청이 완료되었습니다. 운영진의 승인이 필요하며, 승인 완료 후 오픈채팅 링크와 참여코드를 편지함으로 보내드립니다. 잠시만 기다려주세요.',
          senderId: user.uid,
          senderName: '운영진',
          read: false,
          type: 'join_request_received',
          createdAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'notifications'), {
          userId: user.uid,
          type: 'system',
          actorId: user.uid,
          actorName: profile.nickname || '게스트',
          message: '✉️ 가입신청이 접수되었습니다. 편지함을 확인해주세요.',
          read: false,
          createdAt: serverTimestamp(),
        });
      }

      // ✅ 운영자 알림: 모든 관리자/매니저에게 가입신청 접수 알림
      try {
        await notifyAdmins({
          type: 'new_guest_request',
          title: '가입신청 접수',
          message: `📝 ${profile.nickname || '게스트'}님이 가입신청을 제출했습니다`,
          actorId: user.uid,
          actorName: profile.nickname || '게스트',
          url: '/admin',
        });
      } catch {}

      alert(autoApproved
        ? '🎉 가입이 즉시 승인되었습니다! 편지함을 확인해주세요.'
        : '가입 신청이 완료되었습니다! 운영진 승인을 기다려주세요.');
    } catch (err: any) {
      console.error(err);
      alert('신청서 제출에 실패했습니다: ' + (err.message || err));
    } finally {
      setSubmitting(false);
    }
  };

  // 재신청 (기존 반려 신청서 삭제 후 새로 작성)
  const handleReapply = async () => {
    if (!myRequest) return;
    if (!confirm('기존 반려된 신청서를 취소하고 새로 작성하시겠습니까?')) return;

    setLoading(true);
    try {
      await deleteDoc(doc(db, 'joinRequests', myRequest.id));
      setAnswers({});
      setMyRequest(null);
    } catch (err) {
      console.error(err);
      alert('재신청 준비에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <span className="animate-spin text-2xl mb-2">⏳</span>
        <p className="text-xs font-bold">로딩 중...</p>
      </div>
    );
  }

  // 1. 이미 승인됨 (정회원만)
  if (myRequest?.status === 'approved') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-xl p-8 text-center my-6 space-y-6">
        <span className="text-6xl block">🎉</span>
        <h3 className="text-2xl font-black text-slate-800">가입이 완료되었습니다!</h3>
        <p className="text-sm font-bold text-slate-600">
          동전커피 정회원이 되신 것을 축하합니다!
        </p>
        <p className="text-xs text-slate-400 leading-relaxed">
          이제 모임 일정, 핫플레이스, 실시간 채팅, 전체 멤버 목록 등 모든 메뉴를 정상적으로 이용하실 수 있습니다. 우측 상단의 편지함(✉️)을 열어 운영진이 보낸 모임 링크와 참여 코드를 꼭 확인해 주세요!
        </p>
      </div>
    );
  }


  // 2. 대기 중
  if (myRequest?.status === 'pending') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-xl p-8 my-6 space-y-6">
        <div className="text-center space-y-3 pb-4 border-b border-slate-100">
          <span className="text-5xl block animate-pulse">📝</span>
          <h3 className="text-xl font-black text-slate-800">가입 신청 검토 대기 중</h3>
          <p className="text-xs font-bold bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full inline-block">
            ⏱️ 운영진의 승인을 대기하고 있습니다
          </p>
          <p className="text-xs text-slate-400 leading-relaxed">
            제출하신 가입 신청서는 운영진이 신속하게 검토할 예정입니다.<br />
            승인이 완료되면 푸시 알림과 함께 개인 편지함으로 오픈채팅 링크가 전송됩니다.
          </p>
        </div>

        <div>
          <h4 className="text-xs font-bold text-slate-400 mb-3 uppercase tracking-wider">제출한 답변 요약</h4>
          <div className="space-y-4">
            {myRequest.answers?.map((ans, idx) => (
              <div key={idx} className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-1.5">
                <p className="text-xs font-bold text-slate-500">Q. {ans.questionText}</p>
                <p className="text-sm font-extrabold text-slate-700">
                  {ans.selectedOption === '직접 적기' ? `직접 입력: ${ans.directText}` : ans.selectedOption}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 3. 반려됨
  if (myRequest?.status === 'rejected') {
    return (
      <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-xl p-8 my-6 space-y-6">
        <div className="text-center space-y-3 pb-4 border-b border-slate-100">
          <span className="text-5xl block">❌</span>
          <h3 className="text-xl font-black text-slate-800">가입 신청 반려됨</h3>
          <p className="text-xs font-bold bg-rose-50 text-rose-600 px-3 py-1.5 rounded-full inline-block">
            신청서 내용 수정이 필요합니다
          </p>
        </div>

        <div className="bg-rose-50 border border-rose-100 rounded-2xl p-4 space-y-1.5">
          <h4 className="text-xs font-bold text-rose-700">⚠️ 반려 사유</h4>
          <p className="text-sm font-semibold text-rose-600 leading-relaxed whitespace-pre-wrap">
            {myRequest.rejectReason || '신청서 작성 기준에 미달하였습니다. 질문에 성실히 답해주세요.'}
          </p>
        </div>

        <div className="pt-2">
          <button
            onClick={handleReapply}
            className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-bold rounded-xl shadow-md hover:opacity-90 transition-opacity"
          >
            📝 신청서 다시 작성하기
          </button>
        </div>
      </div>
    );
  }

  // 4. 신청서 작성 폼 (가입하지 않았거나 미제출 상태)
  return (
    <div className="relative">
      <div className="max-w-xl mx-auto bg-white rounded-3xl border border-slate-100 shadow-xl p-6 md:p-8 my-4 space-y-6">
        <div className="pb-4 border-b border-slate-100">
          <h3 className="text-xl font-black text-slate-800">📝 가입 신청서 작성</h3>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            동전커피 모임은 오프라인 중심 소모임 공유 커뮤니티입니다.<br />
            신뢰할 수 있는 활동 멤버를 모시기 위해 아래 가입 신청서를 작성해 주시기 바랍니다.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {questions.map((q, idx) => {
            const selectedVal = answers[q.id]?.selected || '';
            // 주관식(type==='text') 또는 answerType==='text'/'freetext_only' 이면 textarea 바로 표시
            const isTextOnly = q.type === 'text' || q.answerType === 'text' || q.answerType === 'freetext_only';
            const showDirect = !isTextOnly && selectedVal === '직접 적기';

            return (
              <div key={q.id} className="space-y-2">
                <label className="block text-xs font-bold text-slate-600 leading-normal">
                  {idx + 1}. {q.question}
                  {isTextOnly && <span className="ml-1 text-indigo-400 font-normal">(주관식)</span>}
                </label>

                {/* 주관식: 바로 textarea */}
                {isTextOnly ? (
                  <textarea
                    value={answers[q.id]?.direct || ''}
                    onChange={(e) => handleDirectTextChange(q.id, e.target.value)}
                    placeholder="답변 내용을 직접 적어주세요..."
                    required
                    rows={3}
                    className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-xs md:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-400 transition-all placeholder:text-slate-300 font-semibold"
                  />
                ) : (
                  /* 객관식: 드롭다운 */
                  <>
                    <div className="relative">
                      <select
                        value={selectedVal}
                        onChange={(e) => handleSelectChange(q.id, e.target.value)}
                        required
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs md:text-sm text-slate-700 font-bold focus:outline-none focus:ring-2 focus:ring-rose-400 transition-all appearance-none cursor-pointer"
                      >
                        <option value="">선택해 주세요...</option>
                        {(q.options || ['예', '아니요', '직접 적기']).map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 text-xs">▼</div>
                    </div>
                    {showDirect && (
                      <textarea
                        value={answers[q.id]?.direct || ''}
                        onChange={(e) => handleDirectTextChange(q.id, e.target.value)}
                        placeholder="답변 내용을 직접 적어주세요..."
                        required
                        rows={3}
                        className="w-full bg-white border border-slate-200 rounded-xl p-3.5 text-xs md:text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-400 transition-all placeholder:text-slate-300 font-semibold"
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-3.5 bg-gradient-to-r from-rose-500 to-orange-400 text-white font-extrabold rounded-xl shadow-md hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? '제출 중...' : '가입 신청 완료'}
          </button>
        </form>
      </div>


    </div>
  );
}
