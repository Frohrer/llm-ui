export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  provider: string;
  model: string;
  createdAt: string;
  lastMessageAt: string;
}

export interface ModelConfig {
  id: string;
  name: string;
  contextLength: number;
  defaultModel: boolean;
}

export interface LLMProvider {
  id: string;
  name: string;
  icon: string;
  models: ModelConfig[];
  sendMessage(message: string, conversationId?: string, context?: Message[]): Promise<string>;
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}