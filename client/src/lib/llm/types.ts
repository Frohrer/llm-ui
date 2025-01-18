import type { SelectConversation, SelectMessage } from '@db/schema';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface Conversation {
  id: number;
  title: string;
  provider: string;
  model: string;
  lastMessageAt: string; 
  createdAt: string;   
  messages: {
    id: number;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }[];
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

// Helper function to transform database response to frontend format
export function transformDatabaseConversation(dbConv: SelectConversation & { messages: SelectMessage[] }): Conversation {
  return {
    id: dbConv.id,
    title: dbConv.title,
    provider: dbConv.provider,
    model: dbConv.model,
    lastMessageAt: dbConv.last_message_at.toISOString(),
    createdAt: dbConv.created_at.toISOString(),
    messages: dbConv.messages.map(msg => ({
      id: msg.id,
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
      created_at: msg.created_at.toISOString()
    }))
  };
}