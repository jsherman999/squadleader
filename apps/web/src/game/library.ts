/**
 * The saved-game library: whole games (actions plus the bot's reasoning)
 * kept in IndexedDB, so they can be reviewed later. Browser storage only;
 * download a save file to keep a game elsewhere.
 */
import type { SaveFile } from './session';

const DB = 'squadwar';
const STORE = 'games';

export interface GameSummary {
  readonly id: string;
  readonly scenario: string;
  readonly savedAt: string;
  readonly controllers: SaveFile['controllers'];
  readonly actions: number;
  readonly explained: number;
  readonly turn?: number;
  readonly result?: string;
  readonly winner?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser has no IndexedDB; download save files instead.'));
      return;
    }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the game library'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('Library request failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Library request aborted'));
    });
  } finally {
    db.close();
  }
}

export function newGameId(): string {
  return `g${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Store (or replace) a game; returns its id. */
export async function putGame(save: SaveFile): Promise<string> {
  const id = save.id ?? newGameId();
  await run('readwrite', (s) => s.put({ ...save, id }));
  return id;
}

export async function getGame(id: string): Promise<SaveFile | undefined> {
  return (await run<SaveFile | undefined>('readonly', (s) => s.get(id) as IDBRequest<SaveFile | undefined>)) ?? undefined;
}

export async function deleteGame(id: string): Promise<void> {
  await run('readwrite', (s) => s.delete(id));
}

export async function listGames(): Promise<GameSummary[]> {
  const all = await run<SaveFile[]>('readonly', (s) => s.getAll() as IDBRequest<SaveFile[]>);
  return all
    .map((g) => ({
      id: g.id!,
      scenario: g.scenario,
      savedAt: g.savedAt,
      controllers: g.controllers,
      actions: g.actions.length,
      explained: g.notes?.filter(Boolean).length ?? 0,
      ...(g.turn !== undefined ? { turn: g.turn } : {}),
      ...(g.result ? { result: g.result } : {}),
      ...(g.winner ? { winner: g.winner } : {}),
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/** Download a save as a JSON file. */
export function downloadSave(save: SaveFile, name: string): void {
  const blob = new Blob([JSON.stringify(save)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
