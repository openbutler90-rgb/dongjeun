import React from 'react';

type Props = {
  title?: string;
  children: React.ReactNode;
};

type State = {
  error: Error | null;
  componentStack: string;
};

export class OperatorErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error, componentStack: '' };
  }

  componentDidCatch(_error: Error, info: React.ErrorInfo) {
    this.setState({ componentStack: info.componentStack || '' });
  }

  render() {
    if (!this.state.error) return this.props.children;

    const details = [
      `${this.state.error.name}: ${this.state.error.message}`,
      this.state.error.stack || '',
      this.state.componentStack || '',
    ].filter(Boolean).join('\n');

    return (
      <div className="h-full w-full overflow-auto bg-white">
        <div className="mx-auto max-w-3xl p-6">
          <div className="rounded-3xl border border-rose-100 bg-rose-50 p-6 shadow-sm">
            <h1 className="text-lg font-black text-rose-600">{this.props.title || '화면 오류가 발생했습니다'}</h1>
            <p className="mt-2 text-sm font-bold text-slate-600">아래 오류 내용을 그대로 보내주면 바로 원인 잡아서 수정/배포까지 진행합니다.</p>
            <div className="mt-4 rounded-2xl border border-rose-200 bg-white p-4">
              <pre className="whitespace-pre-wrap break-words text-[11px] font-bold text-slate-700">{details}</pre>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => location.reload()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white"
              >
                새로고침
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(details);
                  } catch {
                  }
                }}
                className="rounded-xl bg-white px-4 py-2 text-xs font-black text-slate-700 ring-1 ring-slate-200"
              >
                오류 복사
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
