import { encoding_for_model, TiktokenModel } from 'tiktoken';

/**
 * Get the encoding for a specific model or a default one
 */
function getEncodingForModel(model: string) {
  try {
    // Try to get an encoding specifically for this model
    // Cast to TiktokenModel type since only specific models are supported by the library
    return encoding_for_model(model as TiktokenModel);
  } catch (error) {
    // If that fails, use a reasonable default based on the model family
    if (model.includes('gpt-4')) {
      return encoding_for_model('gpt-4');
    } else if (model.includes('gpt-3.5')) {
      return encoding_for_model('gpt-3.5-turbo');
    } else if (model.includes('claude')) {
      // Claude uses the same tokenizer as GPT-4
      return encoding_for_model('gpt-4');
    } else if (model.includes('gemini')) {
      // For Gemini models, we'll use the cl100k_base tokenizer as a reasonable approximation
      return encoding_for_model('gpt-4');
    } else {
      // Default fallback
      return encoding_for_model('gpt-4');
    }
  }
}

/**
 * Count tokens in a text string for a specific model
 */
export function countTokens(text: string, model: string): number {
  if (!text) return 0;
  
  const enc = getEncodingForModel(model);
  const tokens = enc.encode(text);
  enc.free(); // Free the underlying resources when done
  
  return tokens.length;
}

/**
 * Get the model ID from provider and model information
 */
export function getModelId(providerId: string, modelId: string): string {
  if (providerId === 'openai') {
    return modelId; // OpenAI model IDs are already in the right format
  } else if (providerId === 'anthropic') {
    return modelId; // Return Anthropic model ID
  } else if (providerId === 'gemini') {
    return modelId; // Return Gemini model ID
  } else if (providerId === 'deepseek') {
    return modelId; // Return DeepSeek model ID
  }
  return modelId; // Default fallback
}

/**
 * Get the maximum context length for a model
 */
export function getMaxContextLength(
  providers: Record<string, { models: Array<{ id: string; contextLength: number }> }>,
  modelId: string
): number {
  for (const provider of Object.values(providers)) {
    const model = provider.models.find(m => m.id === modelId);
    if (model) {
      return model.contextLength;
    }
  }
  return 0; // Return 0 if model not found
}