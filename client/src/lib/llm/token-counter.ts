/**
 * Simple, dependency-free utility for estimating token counts
 * 
 * This uses a mathematical approximation based on the relationship between 
 * characters and tokens in natural language. The approximation is:
 * 
 * tokenCount ≈ charCount * (1/e) + safetyMargin
 * 
 * where e is Euler's number (2.7182818284590...) 
 * 
 * For most languages and models, this provides a conservative estimate
 * that works well enough for practical purposes.
 */

// Euler's number
const E = 2.7182818284590452353602874713527;

/**
 * Estimates the number of tokens in a text string
 * 
 * @param text - The text to estimate token count for
 * @param safetyMargin - Additional tokens to add as a safety margin (default: 2)
 * @returns The estimated token count
 */
export function estimateTokenCount(text: string, safetyMargin: number = 2): number {
  if (!text) return 0;
  
  // Calculate using the 1/e approximation plus safety margin
  const charCount = text.length;
  const tokenEstimate = Math.ceil(charCount * (1 / E) + safetyMargin);
  
  return tokenEstimate;
}

/**
 * Calculates the maximum number of characters that can fit within a token limit
 * 
 * @param tokenLimit - The maximum number of tokens allowed
 * @param safetyMargin - Tokens to reserve as a safety margin (default: 2)
 * @returns The maximum number of characters that should fit within the token limit
 */
export function maxCharactersForTokenLimit(tokenLimit: number, safetyMargin: number = 2): number {
  if (tokenLimit <= safetyMargin) return 0;
  
  // Reverse the formula: charCount = (tokenLimit - safetyMargin) * e
  const maxChars = Math.floor((tokenLimit - safetyMargin) * E);
  
  return maxChars;
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
  
  const maxChars = maxCharactersForTokenLimit(tokenLimit, safetyMargin);
  
  if (text.length <= maxChars) return text;
  
  let truncated = text.substring(0, maxChars);
  
  // Add ellipsis if requested and there's space for it
  if (addEllipsis && maxChars > 3) {
    truncated = truncated.substring(0, maxChars - 3) + '...';
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