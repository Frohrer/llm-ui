import { db } from "@db";
import { userPreferences } from "@db/schema";
import { eq } from "drizzle-orm";

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

/**
 * Build a system message from the user's custom prompt
 * @param userId - The user ID
 * @returns System prompt string or empty string
 */
export async function buildSystemPrompt(
  userId: number
): Promise<string> {
  const customPrompt = await getUserCustomPrompt(userId);
  return customPrompt || "";
}
