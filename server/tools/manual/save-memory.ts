import type { Tool, ToolContext } from './types';
import { createMemory, isConversationHidden } from '../../memory-service';

/**
 * Explicit, synchronous save into hot-tier memory. The background extractor
 * remains the passive path; this tool exists so "remember that ..." takes
 * effect immediately and certainly instead of hoping the extractor catches it.
 */
export const saveMemoryTool: Tool = {
  name: 'save_memory',
  description:
    'Save a fact about the user to persistent cross-conversation memory, effective immediately. ' +
    'Use ONLY when the user explicitly asks you to remember something ("remember that...", "note for the future...") ' +
    'or states a clearly durable preference/correction that should apply to future conversations. ' +
    'Do not use for ephemeral task state or general knowledge. Near-duplicates of an existing memory are ' +
    'automatically folded into it.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        enum: ['preference', 'fact', 'decision', 'open_thread', 'entity'],
        description:
          'preference = how the user wants things done; fact = stable info about the user/their world; ' +
          'decision = a choice they made; open_thread = ongoing work to follow up on; entity = a person/project/thing they reference.',
      },
      body: {
        type: 'string',
        description:
          'The memory, one or two self-contained sentences. Name the subject explicitly — a future reader has no surrounding conversation.',
      },
      pinned: {
        type: 'boolean',
        description:
          'true ONLY for facts that should influence EVERY future conversation regardless of topic (identity, hard rules, global style). Default false.',
      },
    },
    required: ['kind', 'body'],
  },
  execute: async (
    params: {
      kind: 'preference' | 'fact' | 'decision' | 'open_thread' | 'entity';
      body: string;
      pinned?: boolean;
    },
    ctx?: ToolContext,
  ) => {
    try {
      if (!ctx?.userId) {
        return { success: false, error: 'save_memory requires user context.' };
      }
      const body = params.body?.trim();
      if (!body) {
        return { success: false, error: 'body must be a non-empty string.' };
      }
      // Hidden chats leave no trace in memory, however explicit the request.
      if (ctx.conversationId && (await isConversationHidden(ctx.conversationId))) {
        return {
          success: false,
          error: 'This conversation is hidden, so nothing from it can be saved to memory.',
        };
      }
      // Explicit user request = direct statement: high confidence.
      const row = await createMemory({
        userId: ctx.userId,
        kind: params.kind,
        body,
        confidence: 95,
        pinned: params.pinned === true,
        // Linked to the chat it came from, so it dies with that chat.
        sourceConversationId: ctx.conversationId,
      });
      return {
        success: true,
        memory_id: row.id,
        saved: row.body,
        note:
          row.body === body
            ? 'Saved.'
            : 'An equivalent memory already existed; it was reinforced/updated instead of duplicated.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
