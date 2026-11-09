import { useEffect, useState } from 'react';
import { priceOf, RECOMMENDED, type Effort, type ModelInfo, type Persona, type ProviderId } from '@squadwar/agent';
import { useLlm } from '../game/llm';

const PROVIDERS: { id: ProviderId; name: string; host: string; keyHelp: string }[] = [
  { id: 'anthropic', name: 'Anthropic (Claude)', host: 'api.anthropic.com', keyHelp: 'Create a key in the Claude Console.' },
  { id: 'openai', name: 'OpenAI', host: 'api.openai.com', keyHelp: 'Create a key in the OpenAI platform settings.' },
  { id: 'gemini', name: 'Google Gemini', host: 'generativelanguage.googleapis.com', keyHelp: 'Create a key in Google AI Studio.' },
  { id: 'openrouter', name: 'OpenRouter', host: 'openrouter.ai', keyHelp: 'One OpenRouter key reaches many vendors’ models.' },
  { id: 'local', name: 'Local (Ollama, LM Studio, vLLM)', host: 'your computer', keyHelp: 'No key needed. The server must allow this site’s origin (for Ollama, set OLLAMA_ORIGINS).' },
];

/** LLM opponent settings. Keys stay in this tab unless "Remember" is ticked; they never go into saves. */
export function LlmSettings({ onClose }: { onClose: () => void }) {
  const llm = useLlm();
  const cfg = llm.config;
  const prov = PROVIDERS.find((p) => p.id === cfg.provider)!;
  const [key, setKey] = useState(llm.keys[cfg.provider] ?? '');
  const [remember, setRemember] = useState(llm.remember);
  const [models, setModels] = useState<ModelInfo[]>();
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setKey(useLlm.getState().keys[cfg.provider] ?? '');
    setModels(undefined);
    setStatus(undefined);
  }, [cfg.provider]);

  const test = async () => {
    setTesting(true);
    setStatus(undefined);
    llm.setKey(cfg.provider, key.trim(), remember);
    try {
      const { makeProvider } = await import('@squadwar/agent/providers');
      const list = await makeProvider(cfg, key.trim()).listModels();
      setModels(list);
      setStatus({ ok: true, text: `Connected: ${list.length} model${list.length === 1 ? '' : 's'} available.` });
      if (list.length && !list.some((m) => m.id === cfg.model)) llm.setConfig({ model: (RECOMMENDED[cfg.provider]?.find((r) => list.some((m) => m.id === r)) ?? list[0]!.id) });
    } catch (e) {
      const { anthropicError } = await import('@squadwar/agent/providers');
      setStatus({ ok: false, text: cfg.provider === 'anthropic' ? anthropicError(e) : (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const price = priceOf(cfg.model);
  return (
    <div className="modal-back" role="dialog" aria-label="LLM opponent settings" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel-card">
        <h2 className="stencil modal-title">LLM opponent</h2>
        <p className="small dim">A language model plays the side you set to “Computer (LLM)”. It sees only what that side could see, gives orders through the same rules as you, and explains each order. If it fails or runs over budget, the scripted AI takes over for that phase.</p>
        <label className="field">
          Provider
          <select value={cfg.provider} onChange={(e) => llm.setConfig({ provider: e.target.value as ProviderId, model: '' })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {cfg.provider === 'local' && (
          <label className="field">
            Server
            <input value={cfg.baseUrl ?? 'http://localhost:11434/v1'} onChange={(e) => llm.setConfig({ baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" />
          </label>
        )}
        <label className="field">
          API key
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={cfg.provider === 'local' ? 'optional' : 'paste your key'} />
        </label>
        <p className="small faint">{prov.keyHelp}</p>
        <label className="check">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember on this device
        </label>
        {remember && <p className="small warn">The key is stored in this browser’s storage. Browser storage is not a vault: anyone with access to this browser profile can read it.</p>}
        <div className="toolbar">
          <button className="btn" onClick={test} disabled={testing || (!key.trim() && cfg.provider !== 'local')}>
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          {status && <span className={`small ${status.ok ? 'ok' : 'warn'}`}>{status.text}</span>}
        </div>
        <label className="field">
          Model
          {models?.length ? (
            <select value={cfg.model} onChange={(e) => llm.setConfig({ model: e.target.value })}>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.note ? ` (${m.note})` : ''}
                </option>
              ))}
            </select>
          ) : (
            <input value={cfg.model} onChange={(e) => llm.setConfig({ model: e.target.value })} placeholder="Test the connection to list models" />
          )}
        </label>
        <p className="small faint">
          {price ? `About $${price.input}/$${price.output} per million input/output tokens. ` : 'Price unknown for this model: the meter counts tokens. '}A game is roughly 40–80 model calls; cached prompts keep repeat calls cheap.
        </p>
        <div className="level-row">
          <label className="field compact">
            Style
            <select value={cfg.persona} onChange={(e) => llm.setConfig({ persona: e.target.value as Persona })}>
              <option value="cautious">Cautious</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </label>
          <label className="field compact">
            Effort
            <select value={cfg.effort} onChange={(e) => llm.setConfig({ effort: e.target.value as Effort })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
        </div>
        <label className="field">
          Budget $
          <input type="number" min={0.1} step={0.5} value={cfg.budgetUsd} onChange={(e) => llm.setConfig({ budgetUsd: Math.max(0.1, Number(e.target.value) || 1) })} />
        </label>
        <label className="check">
          <input type="checkbox" checked={cfg.economy} onChange={(e) => llm.setConfig({ economy: e.target.checked })} /> Economy: Defensive Fire follows the model’s standing orders (fewer calls)
        </label>
        <p className="small faint">
          Calls go straight from your browser to {prov.host}. The key is never written into save files, replays or logs.
          {cfg.provider === 'anthropic' && ' Claude requests use adaptive thinking, prompt caching, and server-side fallbacks if a model declines.'}
        </p>
        <div className="play-actions">
          <button
            className="btn primary"
            onClick={() => {
              llm.setKey(cfg.provider, key.trim(), remember);
              onClose();
            }}
          >
            Done
          </button>
          {llm.remember && (
            <button className="btn" onClick={() => llm.forgetKeys()}>
              Forget saved keys
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
