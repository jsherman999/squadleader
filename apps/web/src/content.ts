import { rawBoards } from '@squadwar/content';
import { composeMap, parseBoard, type BoardDef, type GameMap, type MapLayout } from '@squadwar/terrain';

let boardCache: Record<string, BoardDef> | undefined;

export function allBoards(): Record<string, BoardDef> {
  boardCache ??= Object.fromEntries(Object.entries(rawBoards).map(([id, raw]) => [id, parseBoard(raw)]));
  return boardCache;
}

const mapCache = new Map<string, GameMap>();

export function mapFor(layout: MapLayout, boards: Record<string, BoardDef> = allBoards()): GameMap {
  const key = JSON.stringify(layout);
  const useCache = boards === boardCache;
  const hit = useCache ? mapCache.get(key) : undefined;
  if (hit) return hit;
  const m = composeMap(layout, boards);
  if (useCache) mapCache.set(key, m);
  return m;
}
