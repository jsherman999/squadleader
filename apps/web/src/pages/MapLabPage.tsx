import { useCallback, useMemo, useState } from 'react';
import type { HexKey } from '@squadwar/hex';
import { BoardView } from '../board/BoardView';
import type { BoardRenderer, PointerInfo } from '../board/renderer';
import { drawHexOutline } from '../board/overlays';
import { mapFor } from '../content';
import { describeHex } from '../ui/describe';
import { HexCard } from '../ui/HexCard';
import { TopBar } from '../ui/TopBar';

export function MapLabPage() {
  const map = useMemo(() => mapFor([{ board: 'A', x: 0, y: 0 }]), []);
  const [renderer, setRenderer] = useState<BoardRenderer>();
  const [hover, setHover] = useState<HexKey>();

  const onHover = useCallback(
    (p: PointerInfo) => {
      setHover(p.hex);
      if (!renderer) return;
      const g = renderer.overlay('hover', 'top');
      if (p.hex) drawHexOutline(g, map.hexes[p.hex]!.hex, 0xffffff, 0.9, 3);
    },
    [renderer, map],
  );

  return (
    <div className="page">
      <TopBar title="Map & LOS lab" />
      <div className="board-wrap">
        <BoardView map={map} onReady={setRenderer} onHover={onHover} />
        <div className="hud-bottom-left">
          <HexCard d={hover ? describeHex(map, hover) : undefined} />
        </div>
      </div>
    </div>
  );
}
