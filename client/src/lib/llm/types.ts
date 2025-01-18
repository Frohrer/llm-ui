export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  messages: Message[];
  provider: string;
}

export interface LLMProvider {
  id: string;
  name: string;
  icon: string;
  sendMessage(message: string): Promise<string>;
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}
