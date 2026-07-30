# @kitana-sdk/core

Router, provider detection, and failover for [Kitana SDK](https://github.com/ataztech910/kitana) — use AI subscriptions (Claude Max, ChatGPT Plus) programmatically, without API keys.

## Install

```bash
npm install @kitana-sdk/core
```

## Usage

```typescript
import { createRouter, detect } from '@kitana-sdk/core'

const env = await detect()
// { providers: { claude: { available, auth: { loggedIn, subscriptionType } }, ollama: {...} }, ... }

const router = createRouter({
  chain: ['claude', 'ollama', 'api-key'],
  apiKeys: { anthropic: process.env.ANTHROPIC_API_KEY }
})

const response = await router.complete({
  messages: [{ role: 'user', content: 'Hello' }],
  model: 'auto'
})
// { content, model, provider, usage }
```

### Streaming

```typescript
import { streamClaude } from '@kitana-sdk/core'

await streamClaude('say PONG', 'auto', text => {
  process.stdout.write(text) // called incrementally as tokens arrive
})
```

### Provider fallback context

`onProviderSwitch` lets a caller (e.g. `@kitana-sdk/bible`) inject context when the router falls back to a different provider. The context is passed through each provider's real system-prompt channel — never mixed into the user message — so it isn't mistaken for a prompt-injection attempt.

```typescript
const router = createRouter({
  chain: ['claude', 'ollama'],
  onProviderSwitch: async ({ from, to }) => {
    return 'facts carried over from the previous step...'
  }
})
```

## Requirements

- Claude CLI (`npm install -g @anthropic-ai/claude-code`), authenticated via `claude auth login`
- Optionally: Ollama running locally, or an Anthropic/OpenAI API key for fallback

See the [main repo](https://github.com/ataztech910/kitana) for full documentation.
