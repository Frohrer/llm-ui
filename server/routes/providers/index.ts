import openaiRouter, { initializeOpenAI, getOpenAIClient } from './openai';
import anthropicRouter, { initializeAnthropic, getAnthropicClient } from './anthropic';
import deepseekRouter, { initializeDeepSeek, getDeepSeekClient } from './deepseek';
import geminiRouter, { initializeGemini, getGeminiClient } from './gemini';
import { falRouter, initializeFal } from './fal';
import mcpRouter from './mcp';

// Initialize MCP
function initializeMCP(): boolean {
  try {
    if (process.env.MCP_SERVER_URL) {
      console.log("MCP provider initialized with server URL:", process.env.MCP_SERVER_URL);
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error initializing MCP provider:", error);
    return false;
  }
}

export {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  mcpRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
  initializeMCP,
  getOpenAIClient,
  getAnthropicClient,
  getDeepSeekClient,
  getGeminiClient
};