# @kitana-sdk/adk

Google ADK (JS) model adapter for Kitana.

## Why this exists

`@google/adk`'s `LLMRegistry` only ships resolvers for Gemini/Vertex model names
(`/gemini-.*/`) and Google Apigee (`ApigeeLlm`). There is no built-in OpenAI-compatible
or LiteLLM connector in the JS package — pointing `LlmAgent` at an `OPENAI_BASE_URL`
(e.g. Kitana's HTTP server, or Ollama's OpenAI-compatible endpoint) does nothing,
because nothing in `LlmAgent`/`LLMRegistry` reads that env var. A bare model string
that doesn't match Gemini's regex throws `Model X not found.`

`KitanaLlm` plugs directly into `@kitana-sdk/core`'s router instead — no separate
`kitana-server` HTTP process required.

## Usage

```ts
import { LlmAgent } from '@google/adk'
import { KitanaLlm } from '@kitana-sdk/adk'

const agent = new LlmAgent({
  name: 'hello',
  model: new KitanaLlm({ model: 'auto' }), // default: Claude, Codex, Ollama, then API key
  instruction: 'Be concise.'
})
```

Importing this package also registers `KitanaLlm` under the `kitana/*` prefix,
so a bare string works too once the module has been imported once:

```ts
import '@kitana-sdk/adk' // registers the resolver
const agent = new LlmAgent({ model: 'kitana/auto', ... })
```

## Function tools

ADK `FunctionTool` declarations are exposed to every Kitana provider through a
text-based JSON protocol. Kitana converts a valid provider response into an ADK
`functionCall` part; ADK's `Runner` executes the tool and sends the resulting
`functionResponse` back on the next turn. Tool-enabled requests are buffered and
returned as one complete event, even when ADK requests streaming.

## Known limitations

- **No live/bidi.** `connect()` throws — Kitana has no equivalent of a live voice session.

See `examples/failover-claude-to-ollama.cjs` for a runnable end-to-end example
(built package + real `Runner`/`LlmAgent`, provider failover from `claude` to `ollama`).
