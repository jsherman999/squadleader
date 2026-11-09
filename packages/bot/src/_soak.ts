import { scenarioCtx, selfPlay } from './selfplay';
const idx = Number(process.argv[2] ?? 1);
const n = Number(process.argv[3] ?? 10);
const ctx = scenarioCtx(idx);
const wins: Record<string, number> = {};
const kinds: Record<string, number> = {};
const t0 = Date.now();
for (let seed = 1000; seed < 1000 + n; seed++) {
  const r = selfPlay(ctx, seed);
  wins[r.winner ?? 'none'] = (wins[r.winner ?? 'none'] ?? 0) + 1;
  for (const a of r.log) kinds[a.type] = (kinds[a.type] ?? 0) + 1;
  if (r.problems.length) console.log('seed', seed, r.problems.slice(0, 5));
}
console.log(ctx.scenario.id, wins, `${((Date.now() - t0) / n).toFixed(0)}ms/game`, JSON.stringify(kinds));
