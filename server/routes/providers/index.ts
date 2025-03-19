import openaiRouter, { initializeOpenAI, getOpenAIClient } from './openai';
import anthropicRouter, { initializeAnthropic, getAnthropicClient } from './anthropic';
import deepseekRouter, { initializeDeepSeek, getDeepSeekClient } from './deepseek';
import geminiRouter, { initializeGemini, getGeminiClient } from './gemini';

export {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  getOpenAIClient,
  getAnthropicClient,
  getDeepSeekClient,
  getGeminiClient
};