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
});
