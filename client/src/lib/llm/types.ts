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
  supportsResponsesAPI?: boolean;
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
  sendResponsesAPIMessage?(
    request: ResponsesAPIRequest
  ): Promise<ResponsesAPIResponse>;
}

export interface LLMConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

// GPT-5 Responses API types
export interface ReasoningConfig {
  effort: "minimal" | "low" | "medium" | "high";
}

export interface TextConfig {
  verbosity: "low" | "medium" | "high";
}

export interface CustomTool {
  type: "custom";
  name: string;
  description: string;
  grammar?: string; // Lark grammar for constraining outputs
}

export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

export interface AllowedToolsChoice {
  type: "allowed_tools";
  mode: "auto" | "required";
  tools: Array<{ type: "function"; name: string } | { type: "mcp"; server_label: string } | { type: "image_generation" }>;
}

export interface ResponsesAPIRequest {
  input: string;
  model: string;
  reasoning?: ReasoningConfig;
  text?: TextConfig;
  tools?: Array<CustomTool | FunctionTool>;
  tool_choice?: AllowedToolsChoice | "auto" | "none";
  previous_response_id?: string;
  store?: boolean;
  include?: string[];
  // Existing chat parameters for compatibility
  conversationId?: string;
  context?: Message[];
  attachment?: Attachment;
  allAttachments?: Attachment[];
  useKnowledge?: boolean;
  pendingKnowledgeSources?: number[];
  useTools?: boolean;
}

export interface ResponsesAPIResponse {
  id: string;
  object: "response";
  created: number;
  model: string;
  text?: {
    content: string;
    reasoning?: any[];
  };
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    reasoning_tokens: number;
    total_tokens: number;
  };
  encrypted_content?: string; // For ZDR mode
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