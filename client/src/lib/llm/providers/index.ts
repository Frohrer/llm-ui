import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import type { LLMProvider } from '../types';

const providers: Record<string, LLMProvider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
};

export function getProvider(id: string): LLMProvider {
  if (!(id in providers)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providers[id];
}

export function getAllProviders(): LLMProvider[] {
  return Object.values(providers);
}
