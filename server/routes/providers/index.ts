import openaiRouter, { initializeOpenAI, getOpenAIClient } from './openai';
import anthropicRouter, { initializeAnthropic, getAnthropicClient } from './anthropic';
import deepseekRouter, { initializeDeepSeek, getDeepSeekClient } from './deepseek';
import geminiRouter, { initializeGemini, getGeminiClient } from './gemini';
import { falRouter, initializeFal } from './fal';
import grokRouter, { initializeGrok, getGrokClient } from './grok';
import superModelRouter, { initializeSuperModel, getSuperModelStatus } from './super-model';
import ollamaRouter, { initializeOllama, getOllamaClient } from './ollama';

export {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  grokRouter,
  superModelRouter,
  ollamaRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
  initializeGrok,
  initializeSuperModel,
  initializeOllama,
  getOpenAIClient,
  getAnthropicClient,
  getDeepSeekClient,
  getGeminiClient,
  getGrokClient,
  getSuperModelStatus,
  getOllamaClient
};