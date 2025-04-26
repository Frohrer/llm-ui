import openaiRouter, { initializeOpenAI, getOpenAIClient } from './openai';
import anthropicRouter, { initializeAnthropic, getAnthropicClient } from './anthropic';
import deepseekRouter, { initializeDeepSeek, getDeepSeekClient } from './deepseek';
import geminiRouter, { initializeGemini, getGeminiClient } from './gemini';
import { falRouter, initializeFal } from './fal';

export {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
  getOpenAIClient,
  getAnthropicClient,
  getDeepSeekClient,
  getGeminiClient
};