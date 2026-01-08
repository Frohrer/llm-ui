/**
 * Context Manager - Handles token limits and message truncation
 * 
 * This module provides utilities to:
 * 1. Estimate token counts for messages
 * 2. Truncate conversation history when exceeding context limits
 * 3. Summarize/truncate long tool results
 * 4. Retry API calls with truncated context on failure
 */

// Token estimation: use a more conservative estimate
// Real tokenizers average ~3.5-4 chars per token, but we use 3.2 to be safe
// This is more conservative than Euler's number (~2.7) which underestimates
const CHARS_PER_TOKEN = 3.2;

// Safety buffer percentage to account for estimation errors
const SAFETY_BUFFER_PERCENT = 0.05; // 5% buffer

// Default model context limits (conservative estimates)
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // OpenAI
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'gpt-4': 8192,
  'gpt-3.5-turbo': 16385,
  'o1': 200000,
  'o1-mini': 128000,
  'o1-preview': 128000,
  'o3': 200000,
  'o3-mini': 200000,
  'gpt-5': 400000,
  
  // Anthropic
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
  'claude-3-sonnet': 200000,
  'claude-3-haiku': 200000,
  'claude-sonnet-4': 200000,
  
  // Google
  'gemini-2.0-flash': 1048576,
  'gemini-1.5-pro': 2000000,
  'gemini-1.5-flash': 1048576,
  
  // Grok
  'grok-2': 131072,
  'grok-3': 2000000,
  
  // DeepSeek
  'deepseek-chat': 64000,
  'deepseek-reasoner': 64000,
  
  // Default fallback
  'default': 8000,
};

/**
 * Get the context limit for a model
 */
export function getModelContextLimit(model: string): number {
  // Check for exact match first
  if (MODEL_CONTEXT_LIMITS[model]) {
    return MODEL_CONTEXT_LIMITS[model];
  }
  
  // Check for partial matches (e.g., "claude-3-5-sonnet-latest" matches "claude-3-5-sonnet")
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (model.includes(key) || key.includes(model)) {
      return limit;
    }
  }
  
  return MODEL_CONTEXT_LIMITS['default'];
}

/**
 * Estimate token count for a string
 * Uses a conservative estimate to avoid underestimating
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Base calculation with conservative chars per token
  const baseCount = Math.ceil(text.length / CHARS_PER_TOKEN);
  
  // Add a percentage-based safety margin for longer texts
  // This accounts for special characters, formatting, and tokenizer variance
  const safetyMargin = Math.ceil(baseCount * SAFETY_BUFFER_PERCENT) + 10;
  
  return baseCount + safetyMargin;
}

/**
 * Estimate tokens for a message object
 */
export function estimateMessageTokens(message: any): number {
  // Account for role and metadata overhead
  let tokens = 4; // Approximate overhead for role, etc.
  
  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text' && part.text) {
        tokens += estimateTokens(part.text);
      } else if (part.type === 'tool_result' || part.type === 'tool-result') {
        const resultStr = typeof part.result === 'string' 
          ? part.result 
          : JSON.stringify(part.result);
        tokens += estimateTokens(resultStr);
      } else if (part.type === 'tool_use') {
        tokens += estimateTokens(JSON.stringify(part.input || {}));
      }
      // Images add approximately 85-170 tokens per tile (we estimate ~500 for typical images)
      if (part.type === 'image' || part.type === 'image_url') {
        tokens += 500;
      }
    }
  }
  
  return tokens;
}

/**
 * Estimate total tokens for an array of messages
 */
export function estimateTotalTokens(messages: any[]): number {
  return messages.reduce((total, msg) => total + estimateMessageTokens(msg), 0);
}

/**
 * Truncate a long string to fit within a token limit
 */
export function truncateString(text: string, maxTokens: number): string {
  const currentTokens = estimateTokens(text);
  if (currentTokens <= maxTokens) {
    return text;
  }
  
  // Approximate characters to keep (use conservative estimate)
  const maxChars = Math.floor(maxTokens * CHARS_PER_TOKEN * 0.9); // 90% to be safe
  const truncated = text.substring(0, maxChars);
  
  return truncated + '\n\n[Content truncated due to length...]';
}

/**
 * Truncate tool result content to be more concise
 */
export function truncateToolResult(result: any, maxTokens: number = 4000): string {
  let resultStr: string;
  
  if (typeof result === 'string') {
    resultStr = result;
  } else {
    resultStr = JSON.stringify(result, null, 2);
  }
  
  const currentTokens = estimateTokens(resultStr);
  
  if (currentTokens <= maxTokens) {
    return resultStr;
  }
  
  console.log(`[Context Manager] Truncating tool result from ~${currentTokens} to ~${maxTokens} tokens`);
  
  // Try to parse and truncate intelligently if it's JSON
  if (typeof result !== 'string') {
    try {
      // For arrays, keep first and last items with count
      if (Array.isArray(result)) {
        const summary = {
          _truncated: true,
          _originalLength: result.length,
          _preview: result.slice(0, 3),
          _message: `Array truncated from ${result.length} items to 3 for context limit`
        };
        return JSON.stringify(summary, null, 2);
      }
      
      // For objects with many keys, keep most important ones
      if (typeof result === 'object' && result !== null) {
        const keys = Object.keys(result);
        if (keys.length > 10) {
          const truncatedObj: any = { _truncated: true, _originalKeys: keys.length };
          // Keep first 5 keys
          for (let i = 0; i < Math.min(5, keys.length); i++) {
            truncatedObj[keys[i]] = result[keys[i]];
          }
          truncatedObj._remainingKeys = keys.slice(5);
          return JSON.stringify(truncatedObj, null, 2);
        }
      }
    } catch (e) {
      // Fall through to string truncation
    }
  }
  
  // Fall back to simple string truncation
  return truncateString(resultStr, maxTokens);
}

/**
 * Options for context truncation
 */
export interface TruncationOptions {
  /** Maximum tokens allowed (will use model's limit if not specified) */
  maxTokens?: number;
  /** Reserve tokens for the response (default: 8192) */
  reserveForResponse?: number;
  /** Reserve tokens for system prompt (default: 2000) */
  reserveForSystem?: number;
  /** Reserve tokens for tool definitions when tools are enabled (default: 8000) */
  reserveForTools?: number;
  /** Additional safety buffer tokens (default: 5000) */
  safetyBuffer?: number;
  /** Minimum messages to keep (including last user message) */
  minMessages?: number;
  /** Whether to preserve tool messages (default: true for recent ones) */
  preserveToolMessages?: boolean;
  /** Max tokens per tool result before truncation */
  maxToolResultTokens?: number;
}

/**
 * Result of context truncation
 */
export interface TruncationResult {
  messages: any[];
  wasTruncated: boolean;
  originalMessageCount: number;
  finalMessageCount: number;
  originalTokens: number;
  finalTokens: number;
  removedMessages: number;
}

/**
 * Truncate conversation history to fit within model's context limit
 * Strategy: Keep system messages, recent messages, and progressively remove older messages
 */
export function truncateContext(
  messages: any[],
  model: string,
  options: TruncationOptions = {}
): TruncationResult {
  const {
    maxTokens = getModelContextLimit(model),
    reserveForResponse = 8192,
    reserveForSystem = 2000,
    reserveForTools = 8000,
    safetyBuffer = 5000,
    minMessages = 2,
    preserveToolMessages = true,
    maxToolResultTokens = 4000,
  } = options;
  
  // Calculate available tokens with all reserves
  const totalReserved = reserveForResponse + reserveForSystem + reserveForTools + safetyBuffer;
  const availableTokens = maxTokens - totalReserved;
  const originalMessageCount = messages.length;
  const originalTokens = estimateTotalTokens(messages);
  
  console.log(`[Context Manager] Checking context: ${originalTokens} tokens, limit: ${availableTokens} (model: ${model})`);
  
  // First pass: truncate any oversized tool results
  let truncatedMessages = messages.map(msg => {
    if (msg.role === 'tool' || (msg.role === 'user' && Array.isArray(msg.content))) {
      const msgTokens = estimateMessageTokens(msg);
      if (msgTokens > maxToolResultTokens) {
        console.log(`[Context Manager] Truncating oversized message (${msgTokens} tokens)`);
        if (typeof msg.content === 'string') {
          return {
            ...msg,
            content: truncateToolResult(msg.content, maxToolResultTokens)
          };
        } else if (Array.isArray(msg.content)) {
          return {
            ...msg,
            content: msg.content.map((part: any) => {
              if (part.type === 'tool_result' || part.type === 'tool-result') {
                return {
                  ...part,
                  content: truncateToolResult(part.content || part.result, maxToolResultTokens / 2)
                };
              }
              return part;
            })
          };
        }
      }
    }
    return msg;
  });
  
  let currentTokens = estimateTotalTokens(truncatedMessages);
  
  // If within limit after tool truncation, we're done
  if (currentTokens <= availableTokens) {
    return {
      messages: truncatedMessages,
      wasTruncated: currentTokens !== originalTokens,
      originalMessageCount,
      finalMessageCount: truncatedMessages.length,
      originalTokens,
      finalTokens: currentTokens,
      removedMessages: 0,
    };
  }
  
  console.log(`[Context Manager] Need to truncate: ${currentTokens} tokens > ${availableTokens} available`);
  
  // Separate system messages and conversation messages
  const systemMessages = truncatedMessages.filter(m => m.role === 'system');
  const conversationMessages = truncatedMessages.filter(m => m.role !== 'system');
  
  // Always keep the last user message and any immediately related messages
  const lastUserMsgIndex = conversationMessages.findLastIndex((m: any) => m.role === 'user');
  
  // Messages to definitely keep (recent context)
  const keepEndCount = Math.min(
    conversationMessages.length,
    Math.max(minMessages, conversationMessages.length - lastUserMsgIndex + 2)
  );
  
  const messagesToKeep = conversationMessages.slice(-keepEndCount);
  let messagesToConsider = conversationMessages.slice(0, -keepEndCount);
  
  // Progressive removal: remove oldest messages first, but try to keep pairs
  while (currentTokens > availableTokens && messagesToConsider.length > 0) {
    // Remove from the beginning (oldest messages)
    const removed = messagesToConsider.shift();
    console.log(`[Context Manager] Removing message: ${removed?.role} (${estimateMessageTokens(removed)} tokens)`);
    
    const remainingMessages = [...systemMessages, ...messagesToConsider, ...messagesToKeep];
    currentTokens = estimateTotalTokens(remainingMessages);
  }
  
  const finalMessages = [...systemMessages, ...messagesToConsider, ...messagesToKeep];
  const finalTokens = estimateTotalTokens(finalMessages);
  
  console.log(`[Context Manager] Truncation complete: ${originalMessageCount} -> ${finalMessages.length} messages, ${originalTokens} -> ${finalTokens} tokens`);
  
  return {
    messages: finalMessages,
    wasTruncated: true,
    originalMessageCount,
    finalMessageCount: finalMessages.length,
    originalTokens,
    finalTokens,
    removedMessages: originalMessageCount - finalMessages.length,
  };
}

/**
 * Check if an error is related to context length
 */
export function isContextLengthError(error: any): boolean {
  const errorMessage = error?.message || error?.error?.message || String(error);
  const errorLower = errorMessage.toLowerCase();
  
  const contextErrorPatterns = [
    'context length',
    'context_length',
    'token limit',
    'tokens exceed',
    'maximum context',
    'max_tokens',
    'too many tokens',
    'prompt is too long',
    'input too long',
    'request too large',
    'content too long',
    'context window',
    'sequence length',
  ];
  
  return contextErrorPatterns.some(pattern => errorLower.includes(pattern));
}

/**
 * Create a context-aware wrapper for API calls that automatically retries with truncation
 */
export async function withContextRetry<T>(
  apiCall: (messages: any[]) => Promise<T>,
  messages: any[],
  model: string,
  options: TruncationOptions & { maxRetries?: number } = {}
): Promise<{ result: T; truncationInfo?: TruncationResult }> {
  const { maxRetries = 2, ...truncationOptions } = options;
  
  let currentMessages = messages;
  let lastTruncation: TruncationResult | undefined;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // On first attempt, just try with original messages
      // On subsequent attempts, truncate more aggressively
      if (attempt > 0) {
        const aggressiveOptions = {
          ...truncationOptions,
          maxTokens: (truncationOptions.maxTokens || getModelContextLimit(model)) * (0.8 - attempt * 0.1),
        };
        
        const truncation = truncateContext(currentMessages, model, aggressiveOptions);
        currentMessages = truncation.messages;
        lastTruncation = truncation;
        
        console.log(`[Context Manager] Retry ${attempt}: truncated to ${truncation.finalTokens} tokens`);
      }
      
      const result = await apiCall(currentMessages);
      return { result, truncationInfo: lastTruncation };
      
    } catch (error) {
      if (isContextLengthError(error)) {
        console.log(`[Context Manager] Context length error on attempt ${attempt + 1}/${maxRetries + 1}`);
        
        if (attempt === maxRetries) {
          // Final attempt failed, throw with helpful message
          throw new Error(
            `Context too long for model ${model} even after truncation. ` +
            `Try starting a new conversation or removing some messages.`
          );
        }
        
        // Continue to next attempt with truncation
        continue;
      }
      
      // Not a context error, rethrow
      throw error;
    }
  }
  
  // Should not reach here
  throw new Error('Unexpected end of retry loop');
}

/**
 * Pre-emptively check and truncate context before API call
 * This is the recommended approach to avoid API errors
 */
export function prepareContext(
  messages: any[],
  model: string,
  options: TruncationOptions = {}
): { messages: any[]; info: TruncationResult } {
  const truncation = truncateContext(messages, model, options);
  
  if (truncation.wasTruncated) {
    console.log(`[Context Manager] Pre-emptively truncated context: ${truncation.originalTokens} -> ${truncation.finalTokens} tokens`);
  }
  
  return {
    messages: truncation.messages,
    info: truncation,
  };
}
