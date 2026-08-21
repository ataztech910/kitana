export type ProviderName = 'claude' | 'codex' | 'ollama' | 'api-key'

export interface Message {
  role: string
  content: string
}

export interface CompleteRequest {
  messages: Message[]
  model?: string
  systemPrompt?: string
}

export interface CompleteResponse {
  content: string
  model: string
  provider: ProviderName
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export interface ClaudeDetectResult {
  available: boolean
  path?: string
  version?: string
  auth: {
    loggedIn: boolean
    subscriptionType: 'max' | 'enterprise' | 'pro' | 'team' | null
    email?: string
  }
}

export interface OllamaDetectResult {
  available: boolean
  running: boolean
  models: string[]
}

export interface CodexDetectResult {
  available: boolean
  version?: string
  auth: {
    loggedIn: boolean
    mode: 'chatgpt' | 'api-key' | 'unknown' | null
  }
}

export interface DetectResult {
  providers: {
    claude: ClaudeDetectResult
    codex: CodexDetectResult
    ollama: OllamaDetectResult
    openai: { available: boolean }
    gemini: { available: boolean }
  }
  httpServers: {
    ollama: { running: boolean; url: string }
    lmstudio: { running: boolean }
  }
}
