import { rawLegacyScenarios, rawRules, rawScenarios } from '@squadwar/content';
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

// ---- Custom scenarios (Design Your Own, the scenario editor, campaigns) ----

const CUSTOM_KEY = 'squadwar:scenarios';
const custom = new Map<string, Scenario>();
let customLoaded = false;

function loadCustom(): void {
  if (customLoaded) return;
  customLoaded = true;
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    for (const x of raw ? (JSON.parse(raw) as unknown[]) : []) {
      try {
        const sc = parseScenario(x);
        custom.set(sc.id, sc);
      } catch {
        // A stored scenario that no longer validates is skipped.
      }
    }
  } catch {
    // Storage unavailable.
  }
}

function saveCustom(): void {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify([...custom.values()]));
  } catch {
    // Storage full or unavailable: the scenario still works this session.
  }
}

/** Add or replace a custom scenario; it is kept in this browser. */
export function registerScenario(sc: Scenario): void {
  loadCustom();
  custom.set(sc.id, sc);
  ctxCache.delete(sc.id);
  saveCustom();
}

export function removeScenario(id: string): void {
  loadCustom();
  custom.delete(id);
  ctxCache.delete(id);
  saveCustom();
}

/** Scenarios made in this browser, newest last. */
export function customScenarios(): Scenario[] {
  loadCustom();
  return [...custom.values()];
}

export function customScenario(id: string): Scenario | undefined {
  loadCustom();
  return custom.get(id);
}

// ---- Earlier revisions of built-in scenarios ----
//
// A saved game is its seed and its actions, replayed against the scenario. When a built-in
// scenario's forces change, its revision goes up and the old one is kept (id "s8@1"), so a
// game started before the change still loads, replays and can be played on as it was.

let legacy: Map<string, Scenario> | undefined;
function legacyScenarios(): Map<string, Scenario> {
  legacy ??= new Map(rawLegacyScenarios.map((s) => parseScenario(s)).map((s) => [s.id, s]));
  return legacy;
}

/** Any scenario by id: built in first, then custom, then earlier revisions of built-in ones. */
export function scenarioById(id: string): Scenario | undefined {
  return allScenarios().find((s) => s.id === id) ?? customScenario(id) ?? legacyScenarios().get(id);
}

/** The scenario id a saved game is replayed against: the revision it was played on. */
export function savedScenarioId(save: { readonly scenario: string; readonly scenarioRev?: number }): string {
  const current = allScenarios().find((s) => s.id === save.scenario);
  if (!current) return save.scenario;
  const rev = save.scenarioRev ?? 1;
  const old = `${save.scenario}@${rev}`;
  return rev < (current.revision ?? 1) && legacyScenarios().has(old) ? old : save.scenario;
}

/** How a game on this scenario id is written to a save: the built-in id, and its revision when not the first. */
export function scenarioRef(id: string): { scenario: string; scenarioRev?: number } {
  if (legacyScenarios().has(id)) {
    const at = id.lastIndexOf('@');
    const rev = Number(id.slice(at + 1));
    return { scenario: id.slice(0, at), ...(rev > 1 ? { scenarioRev: rev } : {}) };
  }
  const rev = allScenarios().find((s) => s.id === id)?.revision ?? 1;
  return { scenario: id, ...(rev > 1 ? { scenarioRev: rev } : {}) };
}

const ctxCache = new Map<string, Ctx>();
export function ctxFor(id: string): Ctx {
  let c = ctxCache.get(id);
  if (!c) {
    const sc = scenarioById(id);
    if (!sc) throw new Error(`unknown scenario ${id}`);
    c = makeCtx(sc, rulesData(), allBoards());
    ctxCache.set(id, c);
  }
  return c;
}
