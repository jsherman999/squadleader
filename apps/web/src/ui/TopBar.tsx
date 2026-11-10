import type { ReactNode } from 'react';
import { go } from '../router';

/** `narrowTitle` replaces the title on phones, where the bar stays at the top of the screen (the battle screen puts the turn and phase there). */
export function TopBar({ title, narrowTitle, children }: { title: string; narrowTitle?: string | undefined; children?: ReactNode }) {
  return (
    <header className="topbar">
      <button className="topbar-brand stencil" onClick={() => go('')} title="Home">
        Squad War
      </button>
      <span className={`topbar-title ${narrowTitle ? 'has-narrow' : ''}`}>
        <span className="tt-wide">{title}</span>
        {narrowTitle && <span className="tt-narrow">{narrowTitle}</span>}
      </span>
      <div className="topbar-actions">{children}</div>
    </header>
  );
}
