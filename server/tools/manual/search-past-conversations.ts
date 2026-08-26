import type { Tool, ToolContext } from './types';
import { searchPastConversations } from '../../memory-service';

/**
 * Cold-tier memory lookup. The hot-tier slice in the system prompt covers
 * pinned and entity-matched facts; this tool lets the model dig deeper into
 * raw history when the always-on memories don't have what it needs.
 */
export const searchPastConversationsTool: Tool = {
  name: 'search_past_conversations',
  description:
    "Search the user's prior conversation history (across all conversations) for messages matching a query. " +
    "Use when the user references something from a past chat that isn't already in the persistent_memory block, " +
    "or when you want to confirm whether a topic has come up before. Returns matching message snippets with " +
    "conversation titles and timestamps. Do not use for trivia answerable from general knowledge.",
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Natural-language search query. Multiple words are OR-matched by default; quote a phrase to require it.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of message hits to return (default 10, max 25).',
      },
    },
    required: ['query'],
  },
  execute: async (
    params: { query: string; limit?: number },
    ctx?: ToolContext,
  ) => {
    try {
      if (!ctx?.userId) {
        return { success: false, error: 'search_past_conversations requires user context.' };
      }
      const hits = await searchPastConversations(ctx.userId, params.query, {
        limit: params.limit,
        // The current chat is already in context; "past" means the others.
        excludeConversationId: ctx.conversationId,
      });
      return {
        success: true,
        count: hits.length,
        results: hits.map((h) => ({
          conversation_id: h.conversation_id,
          conversation_title: h.conversation_title,
          message_id: h.message_id,
          role: h.role,
          snippet: h.snippet,
          created_at: h.created_at.toISOString(),
        })),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
