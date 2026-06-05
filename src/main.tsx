import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(<App />);

// ✅ SW 등록 (Electron 제외)
const isElectronEnv = navigator.userAgent.includes('Electron');
if ('serviceWorker' in navigator && !isElectronEnv) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch((error) => console.warn('SW registration failed:', error));
  });
}

