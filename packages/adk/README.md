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
  model: new KitanaLlm({ model: 'auto' }), // or: chain: ['claude', 'ollama', 'api-key']
  instruction: 'Be concise.'
})
```

Importing this package also registers `KitanaLlm` under the `kitana/*` prefix,
so a bare string works too once the module has been imported once:

```ts
import '@kitana-sdk/adk' // registers the resolver
const agent = new LlmAgent({ model: 'kitana/auto', ... })
```

## Known limitations

- **No streaming.** `@kitana-sdk/core`'s `router.complete()` is a single non-streaming
  call. `providers/claude.ts` already has a `streamClaude()` implementation, but it
  isn't wired through the router yet — `generateContentAsync` always yields exactly
  one full response regardless of the `stream` flag ADK passes.
- **No live/bidi.** `connect()` throws — Kitana has no equivalent of a live voice session.

See `examples/failover-claude-to-ollama.cjs` for a runnable end-to-end example
(built package + real `Runner`/`LlmAgent`, provider failover from `claude` to `ollama`).
