import { useEffect, useState } from 'react';

/** Minimal hash router: "#/lab", "#/editor", "#/play/s1". */
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

export function go(path: string): void {
  window.location.hash = `#/${path}`;
}
