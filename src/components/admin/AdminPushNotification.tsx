import React, { useState } from 'react';
import { sendOneSignalNotification } from '../../lib/onesignal';

export function AdminPushNotificationTab() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [url, setUrl] = useState(import.meta.env.VITE_APP_URL || '');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<string>('');

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) return;
    setIsSending(true);
    setResult('');
    const ok = await sendOneSignalNotification({
      title: title.trim(),
      body: body.trim(),
      url: url.trim() || undefined,
    });
    setIsSending(false);
    setResult(ok ? '✅ 알림이 성공적으로 발송되었습니다!' : '❌ 발송 실패. OneSignal 설정(API Key, App ID)을 확인하세요.');
    if (ok) {
      setTitle('');
      setBody('');
    }
  };

  // ✅ API Key는 onesignal.ts에 하드코딩되어 있음
  const hasKey = true;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 md:p-8">
        <h3 className="text-lg font-bold text-slate-800 mb-1">🔔 푸시 알림 발송</h3>
        <p className="text-sm text-slate-400 mb-6">
          OneSignal을 통해 전체 사용자에게 푸시 알림을 보냅니다. (월 1만 건 무료)
        </p>

        {!hasKey && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
            ⚠️ OneSignal이 설정되지 않았습니다. .env에 VITE_ONESIGNAL_APP_ID와 VITE_ONESIGNAL_REST_API_KEY를 추가해주세요.
          </div>
        )}

        <div className="space-y-4 max-w-xl">
          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">알림 제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="예: 새 게시물이 등록되었습니다"
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">알림 내용</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="예: 동전커피에 새로운 데이트코스 추천 글이 올라왔어요!"
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-bold text-slate-600 mb-1">클릭 시 이동 URL (선택)</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder={import.meta.env.VITE_APP_URL || ''}
              className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none text-sm"
            />
          </div>

          <button
            onClick={handleSend}
            disabled={isSending || !title.trim() || !body.trim()}
            className="w-full py-3 bg-indigo-500 text-white font-bold rounded-xl hover:bg-indigo-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSending ? '발송 중...' : '🚀 전체 사용자에게 알림 보내기'}
          </button>

          {result && (
            <p className={`text-sm font-bold text-center ${result.includes('✅') ? 'text-emerald-600' : 'text-rose-500'}`}>
              {result}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
