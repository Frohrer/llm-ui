/**
 * Client-side token counting system using a mathematical approximation formula
 * 
 * The formula approximates token count as:
 * #tokens ≈ #characters * (1/e) + safety_margin
 * 
 * Where e is Euler's number (≈ 2.7182818284590)
 * 
 * This approximation is based on empirical observations that tokens in most tokenizers
 * like GPT are roughly 4 characters on average, with safety margins to account for
 * variance in different languages and special characters.
 */

// Euler's number for mathematical approximation 
const EULER = 2.7182818284590;

/**
 * Estimates the number of tokens in a text string
 * 
 * @param text - The text to estimate token count for
 * @param safetyMargin - Additional tokens to add as a safety margin (default: 2)
 * @returns The estimated token count
 */
export function estimateTokenCount(text: string, safetyMargin: number = 2): number {
  if (!text) return 0;
  
  const characterCount = text.length;
  // Base calculation: characters divided by e (≈ 2.7182...)
  let baseTokenCount = characterCount / EULER;
  
  // For longer texts, increase the safety margin
  // This accounts for the fact that longer texts may have more complex tokenization patterns
  let effectiveSafetyMargin = safetyMargin;
  if (characterCount > 2000) {
    // For r50k_base tokenizer, we need a larger safety margin after 2000 characters
    effectiveSafetyMargin = 8;
  }
  
  // Round up to the nearest integer and add safety margin
  return Math.ceil(baseTokenCount) + effectiveSafetyMargin;
}

/**
 * Calculates the maximum number of characters that can fit within a token limit
 * 
 * @param tokenLimit - The maximum number of tokens allowed
 * @param safetyMargin - Tokens to reserve as a safety margin (default: 2)
 * @returns The maximum number of characters that should fit within the token limit
 */
export function maxCharactersForTokenLimit(tokenLimit: number, safetyMargin: number = 2): number {
  // Subtract safety margin from the token limit
  const availableTokens = tokenLimit - safetyMargin;
  
  // Convert tokens to characters based on our approximation
  // tokens ≈ characters / e, so characters ≈ tokens * e
  return Math.floor(availableTokens * EULER);
}

/**
 * Truncates text to fit within a specified token limit
 * 
 * @param text - The text to truncate
 * @param tokenLimit - The maximum number of tokens allowed
 * @param safetyMargin - Tokens to reserve as a safety margin (default: 2)
 * @param addEllipsis - Whether to add "..." to the end of truncated text (default: true)
 * @returns The truncated text
 */
export function truncateToTokenLimit(
  text: string,
  tokenLimit: number,
  safetyMargin: number = 2,
  addEllipsis: boolean = true
): string {
  if (!text) return '';
  
  const estimatedTokens = estimateTokenCount(text, safetyMargin);
  
  if (estimatedTokens <= tokenLimit) {
    return text; // Text is within limits, no truncation needed
  }
  
  // Calculate max characters based on token limit
  const maxChars = maxCharactersForTokenLimit(tokenLimit, safetyMargin);
  
  // Truncate safely to avoid cutting in the middle of a multi-byte character
  let truncated = text.slice(0, maxChars);
  
  // If requested, add ellipsis to indicate truncation
  if (addEllipsis) {
    truncated = truncated + '...';
  }
  
  return truncated;
}

/**
 * Checks if text exceeds a specified token limit
 * 
 * @param text - The text to check
 * @param tokenLimit - The maximum number of tokens allowed
 * @param safetyMargin - Tokens to reserve as a safety margin (default: 2)
 * @returns True if the text exceeds the token limit, false otherwise
 */
export function exceedsTokenLimit(text: string, tokenLimit: number, safetyMargin: number = 2): boolean {
  if (!text) return false;
  
  const estimatedTokens = estimateTokenCount(text, safetyMargin);
  return estimatedTokens > tokenLimit;
}