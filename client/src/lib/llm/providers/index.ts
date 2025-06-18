import type { LLMProvider, ProviderConfig } from '../types';
import { UnifiedProvider } from './unified';
import { useState, useEffect } from 'react';

let providersCache: Record<string, LLMProvider> = {};

export async function initializeProviders() {
  if (Object.keys(providersCache).length > 0) return providersCache;

  const response = await fetch('/api/providers');
  if (!response.ok) {
    throw new Error('Failed to fetch provider configurations');
  }

  const configs: ProviderConfig[] = await response.json();
  console.log('Received provider configs:', configs);

  for (const config of configs) {
    try {
      // Ensure the config has all required fields
      const validatedConfig: ProviderConfig = {
        id: config.id,
        name: config.name,
        icon: config.icon,
        models: Array.isArray(config.models) ? config.models : []
      };

      console.log('Creating provider with config:', validatedConfig);
      providersCache[config.id] = new UnifiedProvider(validatedConfig);
    } catch (error) {
      console.error(`Failed to initialize provider ${config.id}:`, error);
    }
  }

  console.log('Initialized providers:', Object.keys(providersCache));
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
          const firstProviderId = Object.keys(loadedProviders)[0];
          setActiveProvider(loadedProviders[firstProviderId]);
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
  if (Object.keys(providersCache).length === 0) {
    await initializeProviders();
  }

  if (!(id in providersCache)) {
    throw new Error(`Unknown provider: ${id}`);
  }
  return providersCache[id];
}

export async function getAllProviders(): Promise<LLMProvider[]> {
  if (Object.keys(providersCache).length === 0) {
    await initializeProviders();
  }
  return Object.values(providersCache);
}