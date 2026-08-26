import type { Tool, ToolContext } from './types';
import { deleteMemory, findMemoriesByQuery } from '../../memory-service';

// Delete without confirmation only above this similarity; below it, return
// candidates and require a second call with memory_id.
const CONFIDENT_DELETE_SIMILARITY = 0.7;

/**
 * Explicit, synchronous forget. Complement of save_memory: "forget X" acts
 * immediately (hard delete — explicit user intent, unlike decay's soft
 * invalidation) instead of waiting for the background extractor.
 */
export const forgetMemoryTool: Tool = {
  name: 'forget_memory',
  description:
    'Delete stored persistent memories about the user. Use when the user asks you to forget or stop remembering ' +
    'something ("forget that...", "stop bringing up..."). Pass a description of what to forget; clearly matching ' +
    'memories are deleted immediately, ambiguous matches are returned as candidates — confirm the right one by ' +
    'calling again with its memory_id. Deletion is permanent.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to forget, described in natural language (e.g. "my favorite color").',
      },
      memory_id: {
        type: 'number',
        description: 'Exact memory id to delete — use after a previous call returned candidates.',
      },
    },
    required: [],
  },
  execute: async (
    params: { query?: string; memory_id?: number },
    ctx?: ToolContext,
  ) => {
    try {
      if (!ctx?.userId) {
        return { success: false, error: 'forget_memory requires user context.' };
      }
      const userId = ctx.userId;

      if (params.memory_id != null) {
        // deleteMemory is user-scoped: a wrong id belonging to someone else is a no-op.
        await deleteMemory(params.memory_id, userId);
        return { success: true, deleted_memory_id: params.memory_id };
      }

      const query = params.query?.trim();
      if (!query) {
        return { success: false, error: 'Provide query or memory_id.' };
      }

      const matches = await findMemoriesByQuery(userId, query, { limit: 5, minSimilarity: 0.5 });
      if (matches.length === 0) {
        return { success: true, deleted: [], note: 'No stored memories match that description.' };
      }

      const confident = matches.filter((m) => m.similarity >= CONFIDENT_DELETE_SIMILARITY);
      if (confident.length > 0) {
        for (const m of confident) {
          await deleteMemory(m.row.id, userId);
        }
        return {
          success: true,
          deleted: confident.map((m) => ({ memory_id: m.row.id, body: m.row.body })),
        };
      }

      return {
        success: true,
        deleted: [],
        candidates: matches.map((m) => ({
          memory_id: m.row.id,
          body: m.row.body,
          similarity: Number(m.similarity.toFixed(2)),
        })),
        note: 'No confident match. If one of these is what the user means, call forget_memory again with its memory_id.',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};
