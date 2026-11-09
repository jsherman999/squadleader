import type { ChatProvider, LlmConfig } from '../types';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { BASE_URLS, openAIProvider } from './openai';

export { anthropicProvider, anthropicError } from './anthropic';
export { geminiProvider } from './gemini';
export { openAIProvider, BASE_URLS } from './openai';
export { mockProvider, type MockBrain, type MockStep } from './mock';

/** The provider for a configuration. Keys stay in memory; they are never part of LlmConfig. */
export function makeProvider(cfg: Pick<LlmConfig, 'provider' | 'baseUrl'>, apiKey: string): ChatProvider {
  switch (cfg.provider) {
    case 'anthropic':
      return anthropicProvider({ apiKey });
    case 'gemini':
      return geminiProvider({ apiKey });
    case 'openai':
      return openAIProvider({ id: 'openai', apiKey, baseUrl: BASE_URLS.openai });
    case 'openrouter':
      return openAIProvider({ id: 'openrouter', apiKey, baseUrl: BASE_URLS.openrouter });
    case 'local':
      return openAIProvider({ id: 'local', ...(apiKey ? { apiKey } : {}), baseUrl: cfg.baseUrl || BASE_URLS.local });
    default:
      throw new Error(`No adapter for ${cfg.provider}`);
  }
}

export const PROVIDER_NAMES: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  openrouter: 'OpenRouter',
  local: 'Local (OpenAI-compatible: Ollama, LM Studio, vLLM)',
};

/** Hosts a provider talks to, for the settings panel's privacy note. */
export const PROVIDER_HOSTS: Record<string, string> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  gemini: 'generativelanguage.googleapis.com',
  openrouter: 'openrouter.ai',
  local: 'your local server',
};
