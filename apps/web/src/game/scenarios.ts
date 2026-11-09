import { rawRules, rawScenarios } from '@squadwar/content';
import { makeCtx, parseRulesData, parseScenario, type Ctx, type RulesData, type Scenario } from '@squadwar/engine';
import { allBoards } from '../content';

let data: RulesData | undefined;
export function rulesData(): RulesData {
  data ??= parseRulesData(rawRules);
  return data;
}

let scenarios: Scenario[] | undefined;
export function allScenarios(): Scenario[] {
  scenarios ??= rawScenarios.map((s) => parseScenario(s));
  return scenarios;
}

const ctxCache = new Map<string, Ctx>();
export function ctxFor(id: string): Ctx {
  let c = ctxCache.get(id);
  if (!c) {
    const sc = allScenarios().find((s) => s.id === id);
    if (!sc) throw new Error(`unknown scenario ${id}`);
    c = makeCtx(sc, rulesData(), allBoards());
    ctxCache.set(id, c);
  }
  return c;
}
