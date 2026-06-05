import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { useAuthStore, UserProfile } from '../../stores/authStore';
import { OperationOptions, DEFAULT_APPROVAL_LETTER, DEFAULT_WELCOME_LETTER } from './AdminTypes';

interface Props {
  users: (UserProfile & { id: string })[];
  operationOptions: OperationOptions;
  onSaveTemplate: (patch: Partial<OperationOptions>) => Promise<void>;
}

export function AdminMailSender({ users, operationOptions, onSaveTemplate }: Props) {
  const { profile, user } = useAuthStore();

  // ── 우편 발송 상태
  const [mailTarget, setMailTarget] = useState<'all' | 'individual'>('individual');
  const [mailTargetUserId, setMailTargetUserId] = useState('');
  const [mailTitle, setMailTitle] = useState('');
  const [mailContent, setMailContent] = useState('');
  const [isSending, setIsSending] = useState(false);

  // ── 승인 편지 템플릿 설정
  const [approvalTemplate, setApprovalTemplate] = useState(
    operationOptions.approvalLetterTemplate || DEFAULT_APPROVAL_LETTER
  );
  const [approvalJoinCode, setApprovalJoinCode] = useState(operationOptions.approvalJoinCode || '');
  const [approvalRules, setApprovalRules] = useState(operationOptions.approvalRules || '');

  // ── 환영 편지 템플릿 설정
  const [welcomeEnabled, setWelcomeEnabled] = useState(operationOptions.welcomeLetterEnabled ?? true);
  const [welcomeTemplate, setWelcomeTemplate] = useState(
    operationOptions.welcomeLetterTemplate || DEFAULT_WELCOME_LETTER
  );
  const [welcomeKakaoLink, setWelcomeKakaoLink] = useState(operationOptions.welcomeKakaoLink || '');
  const [welcomeJoinCode, setWelcomeJoinCode] = useState(operationOptions.welcomeJoinCode || '');

  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [activeSubTab, setActiveSubTab] = useState<'send' | 'approval_template' | 'welcome_template'>('send');

  const nonGuestUsers = users.filter(u => u.role !== 'guest' && !(u as any).isAnonymous);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mailTitle.trim() || !mailContent.trim()) { alert('제목과 내용을 입력해주세요.'); return; }
    if (!user || !profile) return;
    setIsSending(true);
    try {
      if (mailTarget === 'all') {
        for (const u of nonGuestUsers) {
          await addDoc(collection(db, 'letters'), {
            userId: u.id, title: mailTitle.trim(), content: mailContent.trim(),
            senderId: user.uid, senderName: profile.nickname || '운영진',
            read: false, type: 'announcement', createdAt: serverTimestamp(),
          });
        }
        alert(`✅ 전체 ${nonGuestUsers.length}명에게 우편 발송 완료!`);
      } else {
        if (!mailTargetUserId) { alert('수신자를 선택해주세요.'); setIsSending(false); return; }
        await addDoc(collection(db, 'letters'), {
          userId: mailTargetUserId, title: mailTitle.trim(), content: mailContent.trim(),
          senderId: user.uid, senderName: profile.nickname || '운영진',
          read: false, type: 'personal', createdAt: serverTimestamp(),
        });
        await addDoc(collection(db, 'notifications'), {
          userId: mailTargetUserId, type: 'system',
          actorId: user.uid, actorName: profile.nickname || '운영진',
          message: '✉️ 운영진으로부터 새 편지가 도착했습니다.',
          read: false, createdAt: serverTimestamp(),
        });
        alert('✅ 개인 우편 발송 완료!');
      }
      setMailTitle(''); setMailContent('');
    } catch (err: any) {
      alert('발송 실패: ' + err.message);
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveApprovalTemplate = async () => {
    setIsSavingTemplate(true);
    try {
      await onSaveTemplate({
        approvalLetterTemplate: approvalTemplate,
        approvalJoinCode, approvalRules,
      });
      alert('✅ 승인 편지 템플릿이 저장되었습니다.');
    } catch (err: any) { alert('저장 실패: ' + err.message); }
    finally { setIsSavingTemplate(false); }
  };

  const handleSaveWelcomeTemplate = async () => {
    setIsSavingTemplate(true);
    try {
      await onSaveTemplate({
        welcomeLetterEnabled: welcomeEnabled,
        welcomeLetterTemplate: welcomeTemplate,
        welcomeKakaoLink, welcomeJoinCode,
      });
      alert('✅ 환영 편지 템플릿이 저장되었습니다.');
    } catch (err: any) { alert('저장 실패: ' + err.message); }
    finally { setIsSavingTemplate(false); }
  };

  return (
    <div className="space-y-4">
      {/* 서브탭 */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {([['send','✉️ 우편 발송'],['approval_template','✅ 승인 편지 설정'],['welcome_template','🎉 환영 편지 설정']] as const).map(([k,v]) => (
          <button key={k} onClick={() => setActiveSubTab(k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${activeSubTab===k ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>
            {v}
          </button>
        ))}
      </div>

      {activeSubTab === 'send' && (
        <form onSubmit={handleSend} className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
          <h4 className="font-bold text-slate-700">우편 발송</h4>
          <div className="flex gap-2">
            <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-bold ${mailTarget==='individual'?'border-indigo-400 bg-indigo-50 text-indigo-700':'border-slate-200 text-slate-500'}`}>
              <input type="radio" value="individual" checked={mailTarget==='individual'} onChange={()=>setMailTarget('individual')} className="accent-indigo-600"/>개인 발송
            </label>
            <label className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-bold ${mailTarget==='all'?'border-indigo-400 bg-indigo-50 text-indigo-700':'border-slate-200 text-slate-500'}`}>
              <input type="radio" value="all" checked={mailTarget==='all'} onChange={()=>setMailTarget('all')} className="accent-indigo-600"/>전체 발송 ({nonGuestUsers.length}명)
            </label>
          </div>

          {mailTarget === 'individual' && (
            <select value={mailTargetUserId} onChange={e=>setMailTargetUserId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm">
              <option value="">수신자 선택...</option>
              {nonGuestUsers.map(u => (
                <option key={u.id} value={u.id}>{u.nickname} ({u.role})</option>
              ))}
            </select>
          )}

          <input value={mailTitle} onChange={e=>setMailTitle(e.target.value)}
            placeholder="편지 제목" required
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"/>

          <textarea value={mailContent} onChange={e=>setMailContent(e.target.value)}
            placeholder="편지 내용을 작성하세요..." required rows={8}
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"/>

          <button type="submit" disabled={isSending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {isSending ? '발송 중...' : `✉️ ${mailTarget==='all'?`전체 ${nonGuestUsers.length}명에게`:'선택한 회원에게'} 발송`}
          </button>
        </form>
      )}

      {activeSubTab === 'approval_template' && (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
          <div>
            <h4 className="font-bold text-slate-700 mb-1">✅ 가입 승인 자동 편지 설정</h4>
            <p className="text-xs text-slate-400">운영자가 승인 버튼을 누르면 이 내용이 자동으로 게스트에게 발송됩니다.</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">참여코드 / 초대코드</label>
            <input value={approvalJoinCode} onChange={e=>setApprovalJoinCode(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="정식 가입 시 입력할 참여코드"/>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">이용 규칙 ({"{{RULES}}"} 자리에 삽입)</label>
            <textarea value={approvalRules} onChange={e=>setApprovalRules(e.target.value)} rows={4}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs"/>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">편지 템플릿 ({"{{JOIN_CODE}}"}, {"{{RULES}}"} 사용 가능)</label>
            <textarea value={approvalTemplate} onChange={e=>setApprovalTemplate(e.target.value)} rows={14}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"/>
          </div>
          <button onClick={handleSaveApprovalTemplate} disabled={isSavingTemplate}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {isSavingTemplate ? '저장 중...' : '✅ 승인 편지 템플릿 저장'}
          </button>
        </div>
      )}

      {activeSubTab === 'welcome_template' && (
        <div className="bg-white border border-slate-100 rounded-2xl p-6 space-y-4 shadow-sm">
          <div>
            <h4 className="font-bold text-slate-700 mb-1">🎉 신규 가입 환영 편지 설정</h4>
            <p className="text-xs text-slate-400">정식 회원가입(이메일/구글) 완료 시 자동으로 발송되는 환영 편지입니다.</p>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
            <input type="checkbox" checked={welcomeEnabled} onChange={e=>setWelcomeEnabled(e.target.checked)} className="accent-indigo-600 w-4 h-4"/>
            환영 편지 자동 발송 사용
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">오픈카톡 링크</label>
              <input value={welcomeKakaoLink} onChange={e=>setWelcomeKakaoLink(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="https://open.kakao.com/..."/>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-600 block mb-1">참여코드 / 비밀번호</label>
              <input value={welcomeJoinCode} onChange={e=>setWelcomeJoinCode(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs" placeholder="오픈카톡 참여코드"/>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1">환영 편지 내용 ({"{{KAKAO_LINK}}"}, {"{{JOIN_CODE}}"} 사용 가능)</label>
            <textarea value={welcomeTemplate} onChange={e=>setWelcomeTemplate(e.target.value)} rows={12}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono" disabled={!welcomeEnabled}/>
          </div>
          <button onClick={handleSaveWelcomeTemplate} disabled={isSavingTemplate}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-sm disabled:opacity-50">
            {isSavingTemplate ? '저장 중...' : '🎉 환영 편지 템플릿 저장'}
          </button>
        </div>
      )}
    </div>
  );
}
