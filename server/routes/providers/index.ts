import openaiRouter, { initializeOpenAI, getOpenAIClient } from './openai';
import anthropicRouter, { initializeAnthropic, getAnthropicClient } from './anthropic';
import deepseekRouter, { initializeDeepSeek, getDeepSeekClient } from './deepseek';
import geminiRouter, { initializeGemini, getGeminiClient } from './gemini';
import { falRouter, initializeFal } from './fal';
import grokRouter, { initializeGrok, getGrokClient } from './grok';
import superModelRouter, { initializeSuperModel, getSuperModelStatus } from './super-model';

export {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  grokRouter,
  superModelRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
  initializeGrok,
  initializeSuperModel,
  getOpenAIClient,
  getAnthropicClient,
  getDeepSeekClient,
  getGeminiClient,
  getGrokClient,
  getSuperModelStatus
};