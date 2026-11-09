# 0008: The LLM opponent

**Status:** Accepted

## Decision

`packages/agent` holds the LLM opponent, independent of the UI:

- **One conversation per decision.** The model is called once per phase in which its side has choices: Prep Fire, Movement, Defensive Fire, Advancing Fire and Advance. Rally, rout, close combat and setup are routine, and the scripted AI plays them ("economy mode" in PLAN.md §7.7). Each conversation is append-only. The system prompt (persona, a paraphrased rules primer, method, scenario briefing) and the tool list stay the same for the whole game, so providers can cache them.
- **Tools, not state edits.** The model looks with `get_situation`, `describe_hexes`, `check_los`, `preview_fire`, `preview_move` and `list_options` (the scripted AI's ranked options). It acts with `submit_orders`, which applies engine actions one by one and returns the dice results, or the refusal with its § reference. It finishes with `end_phase`, which can carry an in-character radio line. It keeps notes with `notebook_write`/`notebook_read`, and covers the opponent's next Movement Phase with `set_standing_orders`.
- **Every order states a goal and a reason.** They are stored as the action's tutor note, so LLM games can be reviewed like bot games.
- **Fog of war.** Everything the model sees passes through one gate, `visibleUnits`. In §1–21 every unit on the board is known; concealment and hidden placement only need to change that function.
- **Robustness.**
  - At most 3 rounds in a row with only refused orders, and 12 rounds per decision.
  - Provider errors, refusals, the spend cap or Cancel hand the rest of the phase to the scripted AI, with a notice. The game never stalls.
  - Tool choice stays on auto.
- **Standing orders** (`standing.ts`) are rules such as "fire at units moving in the open within 8 hexes, if at least 0.15 breaks are expected". In economy mode they replace the model call for Defensive Fire. Human players use the same executor through presets under Streamlined automation.
- **Providers** sit behind one small interface (`ChatProvider`/`Conversation`). Each adapter keeps its own native transcript:
  - **Anthropic** uses the official SDK in browser mode. It caches the stable prefix, sends effort explicitly, keeps tool choice on auto, enables server-side fallbacks on refusal where the model supports them, and appends each response's full content unchanged.
  - **OpenAI, OpenRouter and local servers** (Ollama, LM Studio, vLLM) share one Chat Completions adapter.
  - **Gemini** uses `generateContent`, and returns the model's parts, with their thought signatures, unchanged.
  - Adapters load lazily, so the 2D game doesn't pay for the SDK.
- **Keys** are held in memory, or in browser storage if the player opts in with a warning. They are sent only to the chosen provider: a Content-Security-Policy `connect-src` limits network calls to the provider domains and localhost. Keys never appear in saves, replays or logs.
- **Cost meter.** Each response's usage (input, cached and output tokens) is priced from `models.config.json`, which also carries recommended badges, so prices update without code changes. Unknown models show a call count instead.

## Why

- A decision per phase keeps the number of calls and the cost reasonable (roughly 40–80 calls a game), while letting the model plan a whole phase and react to dice inside it.
- Tools that go through the engine make illegal play impossible, and turn the rule references into a correction loop.
- Falling back to the scripted AI keeps the game playable whatever the provider does.

## Costs

- With no real key, CI tests the agent with a mock provider, and the adapters against recorded request and response shapes, not live APIs.
- The model plays through the same rules as a human, but it can still play poorly. Persona and effort settings help, and the bot's `list_options` gives it a floor.
