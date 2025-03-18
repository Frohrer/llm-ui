import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { DeepSeekProvider } from './deepseek';
import { GeminiProvider } from './gemini';
import type { LLMProvider } from '../types';
import { useState, useEffect } from 'react';
let providersCache: Record<string, LLMProvider>;

export async function initializeProviders() {
  if (providersCache) return providersCache;

  const response = await fetch('/api/providers');
  if (!response.ok) {
    throw new Error('Failed to fetch provider configurations');
  }

  const configs = await response.json();
  providersCache = {};

  for (const config of configs) {
    switch (config.id) {
      case 'openai':
        providersCache[config.id] = new OpenAIProvider(config);
        break;
      case 'anthropic':
        providersCache[config.id] = new AnthropicProvider(config);
        break;
      case 'deepseek':
        providersCache[config.id] = new DeepSeekProvider(config);
        break;
      case 'gemini':
        providersCache[config.id] = new GeminiProvider(config);
        break;
      // New providers can be added here
    }
  }

  return providersCache;
}

export function useProviders() {
  const [providers, setProviders] = useState<Record<string, LLMProvider>>({});
  const [activeProvider, setActiveProvider] = useState<LLMProvider | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function loadProviders() {
      try {
        setIsLoading(true);
        const loadedProviders = await initializeProviders();
        setProviders(loadedProviders);
        
        // Set the first provider as active by default
        if (Object.keys(loadedProviders).length > 0 && !activeProvider) {
          setActiveProvider(loadedProviders[Object.keys(loadedProviders)[0]]);
        }
        setIsLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setIsLoading(false);
      }
    }
    
    loadProviders();
  }, []);

  return {
    providers: Object.values(providers),
    activeProvider,
    setActiveProvider,
    isLoading,
    error
  };
}

export async function getProvider(id: string): Promise<LLMProvider> {
  if (!providersCache) {
    await initializeProviders();
  }

  if (!(id in providersCache)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providersCache[id];
}

export async function getAllProviders(): Promise<LLMProvider[]> {
  if (!providersCache) {
    await initializeProviders();
  }
  return Object.values(providersCache);
}