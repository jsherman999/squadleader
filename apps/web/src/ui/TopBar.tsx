import type { ReactNode } from 'react';
import { go } from '../router';

export function TopBar({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="topbar">
      <button className="topbar-brand stencil" onClick={() => go('')} title="Home">
        Squad War
      </button>
      <span className="topbar-title">{title}</span>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
