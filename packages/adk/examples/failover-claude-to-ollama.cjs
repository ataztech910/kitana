const { KitanaLlm } = require('./dist')
const { LlmAgent, Runner, InMemorySessionService } = require('@google/adk')

async function main() {
  const agent = new LlmAgent({
    name: 'hello',
    model: new KitanaLlm({ model: 'mistral:instruct', chain: ['claude', 'ollama'] }),
    instruction: 'Отвечай кратко на русском.'
  })
  const sessionService = new InMemorySessionService()
  const runner = new Runner({ agent, appName: 'test', sessionService })
  const session = await sessionService.createSession({ appName: 'test', userId: 'user' })

  for await (const event of runner.runAsync({
    userId: 'user',
    sessionId: session.id,
    newMessage: { role: 'user', parts: [{ text: 'Привет! Как дела?' }] }
  })) {
    console.log(JSON.stringify(event, null, 2))
  }
}

main().catch(e => console.error('ERROR:', e))
