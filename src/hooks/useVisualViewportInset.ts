import { useEffect, useState } from 'react';

export function useVisualViewportInset() {
  const [bottomInset, setBottomInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const update = () => {
      const hiddenBottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setBottomInset(Math.round(hiddenBottom));
    };

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    window.addEventListener('orientationchange', update);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return bottomInset;
}
