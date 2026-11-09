/** Cost estimate for the meter, from models.config.json. Unknown models report tokens only. */
import config from './models.config.json';
import type { Usage } from './types';

export interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
}

const PRICES = Object.entries(config.prices as Record<string, Price>).sort((a, b) => b[0].length - a[0].length);

export function priceOf(model: string): Price | undefined {
  const id = model.replace(/^anthropic\//, '');
  return PRICES.find(([k]) => id.startsWith(k))?.[1];
}

/** Dollars for some usage, or undefined when the model's price is unknown. Cache writes cost 1.25× input. */
export function costOf(model: string, u: Usage): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  const fresh = Math.max(0, u.inputTokens);
  return (fresh * p.input + u.cacheWriteTokens * p.input * 1.25 + u.cachedInputTokens * p.cacheRead + u.outputTokens * p.output) / 1e6;
}

export const RECOMMENDED: Record<string, readonly string[]> = config.recommended;
export const DEFAULT_MODEL: Record<string, string> = config.defaults;
