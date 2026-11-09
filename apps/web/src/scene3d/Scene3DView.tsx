import { useEffect, useRef } from 'react';
import type { GameMap } from '@squadwar/terrain';
import type { RendererEvents } from '../board/renderer';
import { Scene3D } from './scene';

export interface Scene3DViewProps extends RendererEvents {
  map: GameMap;
  /** Called once the scene is ready, and again with undefined on unmount. */
  onReady?: (s: Scene3D | undefined) => void;
}

/** Hosts a Scene3D. Drag orbits, right-drag pans, wheel zooms, double-click focuses a hex. */
export function Scene3DView({ map, onReady, onHover, onClick, onContext }: Scene3DViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | undefined>(undefined);
  const readyCb = useRef(onReady);
  readyCb.current = onReady;

  useEffect(() => {
    const sc = new Scene3D();
    sceneRef.current = sc;
    sc.init(hostRef.current!);
    sc.setMap(map);
    readyCb.current?.(sc);
    return () => {
      readyCb.current?.(undefined);
      sc.destroy();
      sceneRef.current = undefined;
    };
    // The scene lives for the component's lifetime; map changes go through setMap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setMap(map);
  }, [map]);

  useEffect(() => {
    sceneRef.current?.setEvents({ onHover, onClick, onContext });
  }, [onHover, onClick, onContext]);

  return <div ref={hostRef} className="board-host scene-host" />;
}
