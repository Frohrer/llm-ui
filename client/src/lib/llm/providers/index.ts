import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import type { LLMProvider } from '../types';
import { useQuery } from '@tanstack/react-query';

let providers: Record<string, LLMProvider>;

export async function initializeProviders() {
  if (providers) return providers;

  const response = await fetch('/api/providers');
  if (!response.ok) {
    throw new Error('Failed to fetch provider configurations');
  }

  const configs = await response.json();
  providers = {};

  for (const config of configs) {
    switch (config.id) {
      case 'openai':
        providers[config.id] = new OpenAIProvider(config);
        break;
      case 'anthropic':
        providers[config.id] = new AnthropicProvider(config);
        break;
      // New providers can be added here
    }
  }

  return providers;
}

export function useProviders() {
  return useQuery({
    queryKey: ['/api/providers'],
    queryFn: initializeProviders,
  });
}

export async function getProvider(id: string): Promise<LLMProvider> {
  if (!providers) {
    await initializeProviders();
  }

  if (!(id in providers)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providers[id];
}

export async function getAllProviders(): Promise<LLMProvider[]> {
  if (!providers) {
    await initializeProviders();
  }
  return Object.values(providers);
}