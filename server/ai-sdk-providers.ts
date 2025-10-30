/**
 * AI SDK Provider Configuration
 * This module provides a unified way to initialize AI SDK providers
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { LanguageModel } from 'ai';

/**
 * Get an AI SDK model instance for OpenAI
 */
export function getOpenAIModel(modelName: string, apiKey?: string): LanguageModel {
  const openai = createOpenAI({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    compatibility: 'strict', // Ensure full compatibility
  });
  
  return openai(modelName);
}

/**
 * Get an AI SDK model instance for Anthropic
 */
export function getAnthropicModel(modelName: string, apiKey?: string): LanguageModel {
  const anthropic = createAnthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });
  
  return anthropic(modelName);
}

/**
 * Get an AI SDK model instance for Google
 */
export function getGoogleModel(modelName: string, apiKey?: string): LanguageModel {
  const google = createGoogleGenerativeAI({
    apiKey: apiKey || process.env.GOOGLE_API_KEY,
  });
  
  return google(modelName);
}

/**
 * Get an AI SDK model instance for xAI (Grok)
 */
export function getXAIModel(modelName: string, apiKey?: string): LanguageModel {
  const xai = createXai({
    apiKey: apiKey || process.env.XAI_API_KEY,
  });
  
  return xai(modelName);
}

/**
 * Get an AI SDK model instance for DeepSeek
 * DeepSeek is OpenAI-compatible, so we use the OpenAI provider with custom baseURL
 */
export function getDeepSeekModel(modelName: string, apiKey?: string): LanguageModel {
  const deepseek = createOpenAI({
    apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
    baseURL: 'https://api.deepseek.com/v1',
  });
  
  return deepseek(modelName);
}

/**
 * Get an AI SDK model instance for Groq
 * Groq is OpenAI-compatible
 */
export function getGroqModel(modelName: string, apiKey?: string): LanguageModel {
  const groq = createOpenAI({
    apiKey: apiKey || process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  
  return groq(modelName);
}

/**
 * Get an AI SDK model instance for any OpenAI-compatible provider
 */
export function getOpenAICompatibleModel(
  modelName: string,
  baseURL: string,
  apiKey: string
): LanguageModel {
  const provider = createOpenAI({
    apiKey,
    baseURL,
  });
  
  return provider(modelName);
}

/**
 * Auto-detect provider from model name and return appropriate AI SDK model
 */
export function getModelByName(modelName: string, apiKey?: string): LanguageModel {
  const lowerModel = modelName.toLowerCase();
  
  // OpenAI models
  if (lowerModel.includes('gpt') || lowerModel.includes('o1') || lowerModel.includes('o3')) {
    return getOpenAIModel(modelName, apiKey);
  }
  
  // Anthropic models
  if (lowerModel.includes('claude')) {
    return getAnthropicModel(modelName, apiKey);
  }
  
  // Google models
  if (lowerModel.includes('gemini')) {
    return getGoogleModel(modelName, apiKey);
  }
  
  // xAI models
  if (lowerModel.includes('grok')) {
    return getXAIModel(modelName, apiKey);
  }
  
  // DeepSeek models
  if (lowerModel.includes('deepseek')) {
    return getDeepSeekModel(modelName, apiKey);
  }
  
  // Default to OpenAI
  return getOpenAIModel(modelName, apiKey);
}

