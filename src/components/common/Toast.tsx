import { useToastStore } from '../../stores/toastStore';

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  if (toasts.length === 0) return null;

  const bgMap = {
    success: 'bg-emerald-500',
    error: 'bg-rose-500',
    info: 'bg-slate-700',
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[99999] flex flex-col items-center gap-2 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => removeToast(t.id)}
          className={`pointer-events-auto ${bgMap[t.type]} text-white text-sm font-bold px-5 py-3 rounded-2xl shadow-lg animate-[fade-in_0.2s_ease-out] flex items-center gap-2`}
        >
          {t.type === 'success' && <span>✅</span>}
          {t.type === 'error' && <span>⚠️</span>}
          {t.type === 'info' && <span>ℹ️</span>}
          <span>{t.message}</span>
        </button>
      ))}
    </div>
  );
}
