import { describe, expect, it } from 'vitest';
import { replaySave, useSession } from './session';

describe('AI vs AI sessions', () => {
  it('records a reason for every bot move and keeps them through save and load', () => {
    const st = useSession.getState();
    st.start('s1', { rus: 'bot', ger: 'bot' }, 5);
    for (let i = 0; i < 3000 && useSession.getState().states.at(-1)!.phase !== 'gameOver'; i++) {
      if (!useSession.getState().stepBot()) break;
    }
    const done = useSession.getState();
    expect(done.states.at(-1)!.phase).toBe('gameOver');
    expect(done.notes).toHaveLength(done.actions.length);
    expect(done.notes.every(Boolean)).toBe(true);

    const save = done.save()!;
    expect(save.notes).toHaveLength(save.actions.length);
    expect(save.result).toBeTruthy();
    // Save files are JSON.
    const copy = JSON.parse(JSON.stringify(save));
    useSession.getState().start('s1', { rus: 'human', ger: 'human' }, 1);
    useSession.getState().load(copy);
    const back = useSession.getState();
    expect(back.actions).toHaveLength(save.actions.length);
    expect(back.notes.map((n) => n?.goal)).toEqual(save.notes!.map((n) => n?.goal));
    expect(back.states.at(-1)!.winner).toBe(done.states.at(-1)!.winner);

    const r = replaySave(copy);
    expect(r.states).toHaveLength(save.actions.length + 1);
  });

  it('loads older saves without reasons', () => {
    useSession.getState().start('s1', { rus: 'bot', ger: 'human' }, 2);
    const save = useSession.getState().save()!;
    const { notes: _n, ...old } = save;
    useSession.getState().load(old);
    expect(useSession.getState().notes).toEqual([]);
  });

  it('a game saved before the forces of a scenario changed replays on the line-up it was played with', () => {
    const squads = (side: string) => {
      const st = useSession.getState();
      const s = st.states.at(-1)!;
      return Object.values(s.units).filter((u) => u.side === side && /^us-(666|847)$/.test(u.type)).length;
    };
    // Causeway before its American reinforcement: 7 squads and one Sherman.
    useSession.getState().start('s8@1', { ger: 'bot', us: 'bot' }, 7);
    for (let i = 0; i < 200; i++) if (!useSession.getState().stepBot()) break;
    const played = useSession.getState();
    const end = played.states.at(-1)!;
    const save = JSON.parse(JSON.stringify(played.save()!));
    // Written like any save made before revisions existed: the built-in id, no revision.
    expect(save.scenario).toBe('s8');
    expect(save.scenarioRev).toBeUndefined();
    useSession.getState().start('s1', { rus: 'human', ger: 'human' }, 1);
    useSession.getState().load(save);
    expect(useSession.getState().scenarioId).toBe('s8@1');
    expect(useSession.getState().states.at(-1)).toEqual(end);
    expect(squads('us')).toBeLessThanOrEqual(7);
    expect(Object.values(useSession.getState().states[0]!.vehicles).filter((v) => v.type === 'us-m4a4')).toHaveLength(1);

    // A new game gets the current forces, and its save says which revision that is.
    useSession.getState().start('s8', { ger: 'bot', us: 'bot' }, 7);
    expect(squads('us')).toBe(10);
    expect(Object.values(useSession.getState().states[0]!.vehicles).filter((v) => v.type === 'us-m4a4')).toHaveLength(2);
    for (let i = 0; i < 60; i++) if (!useSession.getState().stepBot()) break;
    const now = JSON.parse(JSON.stringify(useSession.getState().save()!));
    expect(now.scenario).toBe('s8');
    expect(now.scenarioRev).toBe(2);
    const last = useSession.getState().states.at(-1)!;
    useSession.getState().load(now);
    expect(useSession.getState().scenarioId).toBe('s8');
    expect(useSession.getState().states.at(-1)).toEqual(last);
  });
});
