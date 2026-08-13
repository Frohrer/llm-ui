import { db } from "@db";
import { userPreferences } from "@db/schema";
import { eq } from "drizzle-orm";
import { retrieveForTurn } from "./memory-service";

/**
 * Get custom prompt for a user
 * @param userId - The user ID
 * @returns The custom prompt string or empty string if none exists
 */
export async function getUserCustomPrompt(userId: number): Promise<string> {
  try {
    const [preferences] = await db
      .select({
        custom_prompt: userPreferences.custom_prompt,
      })
      .from(userPreferences)
      .where(eq(userPreferences.user_id, userId))
      .limit(1);

    return preferences?.custom_prompt || "";
  } catch (error) {
    console.error("Error fetching user custom prompt:", error);
    return "";
  }
}

export interface BuildSystemPromptOpts {
  /**
   * Latest user message — passed to the memory retriever for entity-keyed
   * recall. Optional; when omitted only the always-on memory slice is used.
   */
  latestUserMessage?: string;
  /** Set false to skip the persistent-memory block (e.g. for system tools). */
  includeMemories?: boolean;
}

/**
 * Build the full system prompt: user's custom prompt + persistent memory block.
 * Either piece may be empty; the function returns "" if both are.
 */
export async function buildSystemPrompt(
  userId: number,
  opts: BuildSystemPromptOpts = {},
): Promise<string> {
  const [customPrompt, memoryBlock] = await Promise.all([
    getUserCustomPrompt(userId),
    opts.includeMemories === false
      ? Promise.resolve("")
      : retrieveForTurn(userId, { latestUserMessage: opts.latestUserMessage }).catch((err) => {
          console.error("[memory] retrieval failed, continuing without memory:", err);
          return "";
        }),
  ]);

  return [customPrompt, memoryBlock].filter(Boolean).join("\n\n");
}
