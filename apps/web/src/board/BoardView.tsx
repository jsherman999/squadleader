import { useEffect, useRef } from 'react';
import type { GameMap } from '@squadwar/terrain';
import { BoardRenderer, type RendererEvents } from './renderer';

export interface BoardViewProps extends RendererEvents {
  map: GameMap;
  /** Called once the renderer is ready, and again with undefined on unmount. */
  onReady?: (r: BoardRenderer | undefined) => void;
}

/** Hosts a BoardRenderer. Keyboard: arrows pan, +/- zoom, 0 fits the board. */
export function BoardView({ map, onReady, onHover, onClick, onContext }: BoardViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<BoardRenderer | undefined>(undefined);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;

  useEffect(() => {
    const host = hostRef.current!;
    const r = new BoardRenderer();
    rendererRef.current = r;
    let alive = true;
    void r.init(host).then(() => {
      if (!alive) return;
      r.setMap(map, true);
      readyCb.current?.(r);
    });
    return () => {
      alive = false;
      readyCb.current?.(undefined);
      r.destroy();
      rendererRef.current = undefined;
    };
    // The renderer lives for the component's lifetime; map changes go through setMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    rendererRef.current?.setMap(map);
  }, [map]);

  useEffect(() => {
    rendererRef.current?.setEvents({ onHover, onClick, onContext });
  }, [onHover, onClick, onContext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const r = rendererRef.current;
      if (!r || (e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      const step = 60;
      if (e.key === 'ArrowLeft') r.panBy(step, 0);
      else if (e.key === 'ArrowRight') r.panBy(-step, 0);
      else if (e.key === 'ArrowUp') r.panBy(0, step);
      else if (e.key === 'ArrowDown') r.panBy(0, -step);
      else if (e.key === '+' || e.key === '=') r.zoomBy(1.2);
      else if (e.key === '-') r.zoomBy(1 / 1.2);
      else if (e.key === '0') r.fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return <div ref={hostRef} className="board-host" />;
}
