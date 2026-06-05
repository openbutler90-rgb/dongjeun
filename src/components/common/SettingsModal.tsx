import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
  getLocalAiSettings,
  LOCAL_AI_STORAGE_KEY,
  saveLocalAiSettings,
  testLocalImageConnection,
  testLocalTextConnection,
  type LocalAiSettings,
} from '../../lib/localAi';

interface SettingsModalProps {
  onClose: () => void;
}

function Toggle({ checked, onClick }: { checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${checked ? 'bg-rose-500' : 'bg-slate-200'} relative h-6 w-11 rounded-full transition-colors`}
    >
      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-all ${checked ? 'left-6' : 'left-1'}`} />
    </button>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { profile } = useAuthStore();
  const isOperator = profile?.role === 'admin' || profile?.role === 'manager';
  const isElectronApp = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
  const [isDarkMode, setIsDarkMode] = useState(() => document.documentElement.classList.contains('dark'));
  const [pushEnabled, setPushEnabled] = useState(() => localStorage.getItem('dongjeon-push-enabled') === '1');
  const [localAi, setLocalAi] = useState<LocalAiSettings>(() => getLocalAiSettings());
  const [textStatus, setTextStatus] = useState('');
  const [imageStatus, setImageStatus] = useState('');

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const updateLocalAi = (patch: Partial<LocalAiSettings>) => {
    setLocalAi(prev => ({ ...prev, ...patch }));
  };

  const handleTextTest = async () => {
    setTextStatus('Checking connection...');
    try {
      const result = await testLocalTextConnection(localAi);
      const models = result.models || [];
      setTextStatus(models.length ? `Connected: ${models.slice(0, 3).join(', ')}` : 'Connected, but no models found');
    } catch (error: any) {
      setTextStatus(`Connection failed: ${error?.message || 'no response'}`);
    }
  };

  const handleStartLocal = async (target: 'ollama' | 'comfyui') => {
    const label =
      target === 'comfyui' ? 'ComfyUI' :
      'Ollama';
    const setter = target === 'comfyui' ? setImageStatus : setTextStatus;
    setter(`Starting ${label}...`);
    window.dispatchEvent(new CustomEvent('dongjeon-local-runner', { detail: { target, status: 'starting' } }));
    try {
      const response = await fetch('/api/local-ai/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, endpoint: localAi.imageEndpoint }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || 'Local start failed');
      }
      setter(data.readyUrl ? `${label} ready: ${data.readyUrl}` : `${label} ready`);
      window.dispatchEvent(new CustomEvent('dongjeon-local-runner', { detail: { target, status: 'ready', readyUrl: data.readyUrl || '' } }));
    } catch (error: any) {
      setter(`Auto start failed: ${error?.message || 'local server did not respond'}`);
      window.dispatchEvent(new CustomEvent('dongjeon-local-runner', { detail: { target, status: 'failed', error: error?.message || '' } }));
    }
  };

  const handlePushToggle = async () => {
    if (pushEnabled) {
      localStorage.setItem('dongjeon-push-enabled', '0');
      setPushEnabled(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      alert('이 기기에서는 알림을 지원하지 않습니다.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      alert('알림 권한이 필요합니다.');
      return;
    }
    localStorage.setItem('dongjeon-push-enabled', '1');
    setPushEnabled(true);
    new Notification('동전커피', { body: '알림이 활성화되었습니다.', icon: '/logo.png' });
  };

  const handleImageTest = async () => {
    setImageStatus('Checking connection...');
    try {
      await testLocalImageConnection(localAi);
      setImageStatus('Image server connected');
    } catch (error: any) {
      setImageStatus(`Connection failed: ${error?.message || 'no response'}`);
    }
  };

  const handleSave = () => {
    if (isOperator && isElectronApp) {
      const normalized: LocalAiSettings = {
        ...localAi,
        textProvider: 'ollama',
        textEndpoint: 'http://127.0.0.1:11434',
        textModel: 'gemma4:e4b',
        webtoonScenarioModel: 'gemma4:e4b',
        webtoonCharacterModel: 'gemma4:e4b',
        webtoonStoryboardModel: 'gemma4:e4b',
        webtoonAdultModel: 'gemma4:e4b',
        imageProvider: 'comfyui',
        imageEndpoint: 'http://127.0.0.1:8188',
        comfyWorkflowJson: '',
      };
      saveLocalAiSettings(normalized);
      window.dispatchEvent(new StorageEvent('storage', { key: LOCAL_AI_STORAGE_KEY }));
    }
    alert('Settings saved.');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 p-4">
          <h2 className="flex items-center font-bold text-slate-800">
            <svg className="mr-2 h-5 w-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v2m0 8v2m6-6h-2M8 12H6m9.54-5.54-1.42 1.42M9.88 16.12l-1.42 1.42m9.08 0-1.42-1.42M9.88 7.88 8.46 6.46" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            설정
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto p-4">
          <section className="space-y-3">
            <label className="block text-sm font-bold text-slate-700">화면</label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">다크 모드</span>
              <Toggle checked={isDarkMode} onClick={() => setIsDarkMode(!isDarkMode)} />
            </div>
          </section>

          <section className="space-y-3 border-t border-slate-100 pt-4">
            <label className="block text-sm font-bold text-slate-700">알림</label>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">푸시 알림 받기</span>
              <Toggle checked={pushEnabled} onClick={handlePushToggle} />
            </div>
          </section>

          {isOperator && isElectronApp && (
            <section className="space-y-3 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4">
              <div>
                <label className="block text-sm font-black text-slate-800">운영자 로컬 AI</label>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  운영자 기기에서만 저장됩니다. 웹툰 제작은 로컬 LLM과 로컬 이미지 서버를 우선 사용합니다.
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <div>
                  <p className="text-sm font-bold text-slate-700">로컬 글 생성 사용</p>
                  <p className="text-[11px] text-slate-400">장르/수위에 맞춰 Ollama 모델 자동 선택</p>
                </div>
                <Toggle checked={localAi.textEnabled} onClick={() => updateLocalAi({ textEnabled: !localAi.textEnabled })} />
              </div>
              <div className="rounded-xl bg-white p-3 text-[11px] leading-relaxed text-slate-500">
                텍스트 생성에는 제약 없는 버전인 로컬 Gemma 4 모델(gemma4:e4b)을 사용합니다.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => handleStartLocal('ollama')} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm hover:bg-indigo-50">
                  Start Ollama
                </button>
                <button type="button" onClick={handleTextTest} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm hover:bg-indigo-50">
                  연결 테스트
                </button>
                {textStatus && <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-500">{textStatus}</span>}
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2">
                <div>
                  <p className="text-sm font-bold text-slate-700">로컬 이미지 생성 사용</p>
                  <p className="text-[11px] text-slate-400">ComfyUI 모델/워크플로는 자동 선택</p>
                </div>
                <Toggle checked={localAi.imageEnabled} onClick={() => updateLocalAi({ imageEnabled: !localAi.imageEnabled })} />
              </div>
              <div className="rounded-xl bg-white p-3 text-[11px] leading-relaxed text-slate-500">
                커버/썸네일은 Juggernaut 계열, 애니풍은 Nova/Animagine 계열, 캐릭터 고정은 IPAdapter와 ControlNet을 내부에서 사용합니다.
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStartLocal('comfyui')}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm hover:bg-indigo-50"
                >
                  Start ComfyUI
                </button>
                <button type="button" onClick={handleImageTest} className="rounded-xl bg-white px-3 py-2 text-xs font-black text-indigo-600 shadow-sm hover:bg-indigo-50">
                  이미지 서버 연결 테스트
                </button>
                {imageStatus && <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-slate-500">{imageStatus}</span>}
              </div>
            </section>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 p-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-bold text-slate-500 transition-colors hover:bg-slate-200">
            취소
          </button>
          <button onClick={handleSave} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-slate-900">
            저장하기
          </button>
        </div>
      </div>
    </div>
  );
}
