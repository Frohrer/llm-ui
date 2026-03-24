// Lookup tables mapping model IDs to friendly names and context lengths.
// Provider APIs often only return { id, owned_by }, so we need these to provide
// display names and context window sizes.

export const KNOWN_OPENAI_MODELS: Record<string, { name: string; contextLength: number }> = {
  // GPT-5 family
  "gpt-5": { name: "GPT-5", contextLength: 400000 },
  "gpt-5-mini": { name: "GPT-5 Mini", contextLength: 400000 },
  "gpt-5-nano": { name: "GPT-5 Nano", contextLength: 400000 },

  // GPT-4.1 family
  "gpt-4.1": { name: "GPT-4.1", contextLength: 128000 },
  "gpt-4.1-mini": { name: "GPT-4.1 Mini", contextLength: 128000 },
  "gpt-4.1-nano": { name: "GPT-4.1 Nano", contextLength: 128000 },

  // GPT-4o family
  "gpt-4o": { name: "GPT-4 Omni", contextLength: 128000 },
  "gpt-4o-mini": { name: "GPT-4 Omni Mini", contextLength: 128000 },
  "gpt-4o-2024-11-20": { name: "GPT-4o (2024-11-20)", contextLength: 128000 },
  "gpt-4o-2024-08-06": { name: "GPT-4o (2024-08-06)", contextLength: 128000 },
  "gpt-4o-2024-05-13": { name: "GPT-4o (2024-05-13)", contextLength: 128000 },
  "gpt-4o-mini-2024-07-18": { name: "GPT-4o Mini (2024-07-18)", contextLength: 128000 },

  // GPT-4 family
  "gpt-4": { name: "GPT-4", contextLength: 8192 },
  "gpt-4-turbo": { name: "GPT-4 Turbo", contextLength: 128000 },
  "gpt-4-turbo-preview": { name: "GPT-4 Turbo Preview", contextLength: 128000 },
  "gpt-4-turbo-2024-04-09": { name: "GPT-4 Turbo (2024-04-09)", contextLength: 128000 },

  // O-series reasoning models
  "o1": { name: "O1", contextLength: 200000 },
  "o1-preview": { name: "O1 Preview", contextLength: 128000 },
  "o1-mini": { name: "O1 Mini", contextLength: 128000 },
  "o3": { name: "O3", contextLength: 200000 },
  "o3-mini": { name: "O3 Mini", contextLength: 200000 },
  "o4-mini": { name: "O4 Mini", contextLength: 200000 },

  // ChatGPT models
  "chatgpt-4o-latest": { name: "ChatGPT-4o Latest", contextLength: 128000 },

  // GPT-3.5 family
  "gpt-3.5-turbo": { name: "GPT-3.5 Turbo", contextLength: 16385 },
  "gpt-3.5-turbo-0125": { name: "GPT-3.5 Turbo (0125)", contextLength: 16385 },

  // Image models (included for completeness in the table)
  "gpt-image-1": { name: "GPT Image 1", contextLength: 32000 },
  "gpt-image-1-edit": { name: "GPT Image Edit", contextLength: 32000 },
  "gpt-image-1.5": { name: "GPT Image 1.5", contextLength: 32000 },
};

export const KNOWN_ANTHROPIC_MODELS: Record<string, { name: string; contextLength: number }> = {
  "claude-opus-4-5": { name: "Claude Opus 4.5", contextLength: 200000 },
  "claude-sonnet-4-5": { name: "Claude Sonnet 4.5", contextLength: 200000 },
  "claude-sonnet-4-0": { name: "Claude Sonnet 4.0", contextLength: 200000 },
  "claude-opus-4-0": { name: "Claude Opus 4.0", contextLength: 200000 },
  "claude-opus-4-1": { name: "Claude Opus 4.1", contextLength: 200000 },
  "claude-3-7-sonnet-latest": { name: "Claude 3.7 Sonnet", contextLength: 200000 },
  "claude-3-opus-latest": { name: "Claude 3 Opus", contextLength: 200000 },
  "claude-3-5-sonnet-latest": { name: "Claude 3.5 Sonnet", contextLength: 200000 },
  "claude-3-5-haiku-latest": { name: "Claude 3.5 Haiku", contextLength: 200000 },
};

export const KNOWN_DEEPSEEK_MODELS: Record<string, { name: string; contextLength: number }> = {
  "deepseek-chat": { name: "DeepSeek Chat", contextLength: 64000 },
  "deepseek-reasoner": { name: "DeepSeek Reasoner", contextLength: 64000 },
};

export const KNOWN_GROK_MODELS: Record<string, { name: string; contextLength: number }> = {
  "grok-4-fast-reasoning": { name: "Grok 4 Fast Reasoning", contextLength: 2000000 },
  "grok-4-fast-non-reasoning": { name: "Grok 4 Fast Non-Reasoning", contextLength: 2000000 },
  "grok-4-latest": { name: "Grok 4", contextLength: 131072 },
  "grok-3": { name: "Grok 3", contextLength: 131072 },
  "grok-3-fast": { name: "Grok 3 Fast", contextLength: 131072 },
  "grok-3-mini": { name: "Grok 3 Mini", contextLength: 131072 },
  "grok-3-mini-fast": { name: "Grok 3 Mini Fast", contextLength: 131072 },
  "grok-2-vision": { name: "Grok 2 Vision", contextLength: 32768 },
};

export const KNOWN_GEMINI_MODELS: Record<string, { name: string; contextLength: number }> = {
  "gemini-3-pro-preview": { name: "Gemini 3 Pro Preview", contextLength: 1048576 },
  "gemini-2.5-pro": { name: "Gemini 2.5 Pro", contextLength: 2000000 },
  "gemini-2.5-flash-image": { name: "Gemini 2.5 Flash Image", contextLength: 32768 },
  "gemini-2.5-flash": { name: "Gemini 2.5 Flash", contextLength: 2000000 },
  "gemini-2.5-flash-lite": { name: "Gemini 2.5 Flash Lite", contextLength: 2000000 },
  "gemini-2.0-flash": { name: "Gemini 2.0 Flash", contextLength: 2000000 },
  "gemini-2.0-flash-lite": { name: "Gemini 2.0 Flash Lite", contextLength: 2000000 },
};

export const KNOWN_OLLAMA_MODELS: Record<string, { name: string; contextLength: number }> = {
  "gpt-oss:20b": { name: "GPT-OSS 20B", contextLength: 32000 },
};

export const KNOWN_FAL_MODELS: Record<string, { name: string; contextLength: number }> = {
  "fal-ai/hidream-i1-full": { name: "HiDream I1 Full", contextLength: 1024 },
  "fal-ai/flux-pro/v1.1-ultra": { name: "Flux Pro Ultra", contextLength: 1024 },
  "fal-ai/flux-pro/v1.1": { name: "Flux Pro v1.1", contextLength: 1024 },
  "fal-ai/flux-pro": { name: "Flux Pro", contextLength: 1024 },
  "fal-ai/flux/dev": { name: "Flux Dev", contextLength: 1024 },
  "fal-ai/flux/schnell": { name: "Flux Schnell", contextLength: 1024 },
  "fal-ai/flux-realism": { name: "Flux Realism", contextLength: 1024 },
  "fal-ai/stable-diffusion-v35-large": { name: "Stable Diffusion 3.5 Large", contextLength: 1024 },
  "fal-ai/stable-diffusion-v35-medium": { name: "Stable Diffusion 3.5 Medium", contextLength: 1024 },
  "fal-ai/reve/text-to-image": { name: "Reve", contextLength: 1024 },
  "fal-ai/nano-banana-pro": { name: "Nano Banana Pro", contextLength: 1024 },
  "fal-ai/bytedance/seedream/v4/text-to-image": { name: "ByteDance Seedream v4", contextLength: 1024 },
  "fal-ai/bytedance/dreamina/v3.1/text-to-image": { name: "ByteDance Dreamina v3.1", contextLength: 1024 },
  "fal-ai/ideogram/v3": { name: "Ideogram v3", contextLength: 1024 },
  "fal-ai/ideogram/v2": { name: "Ideogram v2", contextLength: 1024 },
  "fal-ai/recraft-v3": { name: "Recraft v3", contextLength: 1024 },
  "fal-ai/aura-flow": { name: "AuraFlow", contextLength: 1024 },
  "fal-ai/kolors": { name: "Kolors", contextLength: 1024 },
};

export const KNOWN_MODELS_BY_PROVIDER: Record<string, Record<string, { name: string; contextLength: number }>> = {
  openai: KNOWN_OPENAI_MODELS,
  anthropic: KNOWN_ANTHROPIC_MODELS,
  deepseek: KNOWN_DEEPSEEK_MODELS,
  grok: KNOWN_GROK_MODELS,
  gemini: KNOWN_GEMINI_MODELS,
  ollama: KNOWN_OLLAMA_MODELS,
  falai: KNOWN_FAL_MODELS,
};

/**
 * Returns display info for a model ID. If providerId is given, looks up in that
 * provider's known models first. Falls back to OpenAI map, then generates a
 * reasonable fallback from the model ID itself.
 */
export function getModelDisplayInfo(modelId: string, providerId?: string): { name: string; contextLength: number } {
  // Check provider-specific map first
  if (providerId && KNOWN_MODELS_BY_PROVIDER[providerId]) {
    const known = KNOWN_MODELS_BY_PROVIDER[providerId][modelId];
    if (known) return known;
  }

  // Fall back to OpenAI map for backward compatibility
  const openaiKnown = KNOWN_OPENAI_MODELS[modelId];
  if (openaiKnown) return openaiKnown;

  // Fallback: convert model ID to a title-cased name
  const name = modelId
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return { name, contextLength: 128000 };
}
