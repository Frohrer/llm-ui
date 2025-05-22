import type { SelectConversation, SelectMessage } from '@db/schema';
import type { IconType } from 'react-icons';

export interface Attachment {
  type: 'document' | 'image';
  url: string;
  text?: string;
  name: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
  attachment?: Attachment;
  attachments?: Attachment[]; // Add support for multiple attachments
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

export interface ProviderConfig {
  id: string;
  name: string;
  icon: string;  // Just the icon name, not the component
  models: ModelConfig[];
}

export interface LLMProvider {
  config: ProviderConfig;
  sendMessage(
    message: string, 
    conversationId?: string, 
    context?: Message[],
    attachment?: Attachment,
    allAttachments?: Attachment[],
    useKnowledge?: boolean,
    pendingKnowledgeSources?: number[],
    useTools?: boolean
  ): Promise<string>;
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

// Helper function to transform database response to frontend format
export function transformDatabaseConversation(dbConv: SelectConversation & { messages?: SelectMessage[] }): Conversation {
  return {
    id: dbConv.id,
    title: dbConv.title,
    provider: dbConv.provider,
    model: dbConv.model,
    lastMessageAt: dbConv.last_message_at.toISOString(),
    createdAt: dbConv.created_at.toISOString(),
    messages: dbConv.messages 
      ? dbConv.messages
          .filter(msg => msg.role !== 'tool') // Filter out tool messages
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map(msg => ({
            id: msg.id,
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            created_at: msg.created_at.toISOString()
          }))
      : []
  };
}