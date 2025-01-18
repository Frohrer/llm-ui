import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Define validation schema for provider configurations
const ModelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  contextLength: z.number(),
  defaultModel: z.boolean(),
});

const ProviderConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  icon: z.string(),
  models: z.array(ModelConfigSchema),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export async function loadProviderConfigs(): Promise<ProviderConfig[]> {
  try {
    const currentFilePath = fileURLToPath(import.meta.url);
    const providersDir = path.join(path.dirname(currentFilePath), 'providers');
    const files = await readdir(providersDir);
    const jsonFiles = files.filter(file => file.endsWith('.json'));

    const configs = await Promise.all(
      jsonFiles.map(async (file) => {
        const filePath = path.join(providersDir, file);
        const content = await readFile(filePath, 'utf-8');
        const config = JSON.parse(content);
        return ProviderConfigSchema.parse(config);
      })
    );

    return configs;
  } catch (error) {
    console.error('Error loading provider configurations:', error);
    throw new Error('Failed to load provider configurations');
  }
}