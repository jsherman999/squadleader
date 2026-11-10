import { useEffect, useState } from 'react';

/** Minimal hash router: "#/lab", "#/editor", "#/play/s1". */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash);
      // A new page starts at its top: on phones the previous page's scroll position would carry over.
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function go(path: string): void {
  window.location.hash = `#/${path}`;
}
