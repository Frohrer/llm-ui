// Type definitions for provider configuration
export interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  models: {
    id: string;
    name: string;
    contextLength: number;
    defaultModel: boolean;
  }[];
}
