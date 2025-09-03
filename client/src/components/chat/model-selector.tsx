import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import * as SiIcons from 'react-icons/si';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';

import { getAllProviders } from '@/lib/llm/providers';
import type { ModelConfig } from '@/lib/llm/types';

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  getModelDisplayName?: (modelId: string) => string;
}

interface ProviderWithModels {
  id: string;
  name: string;
  icon?: string;
  models: ModelConfig[];
}

export function ModelSelector({ selectedModel, onModelChange, disabled, getModelDisplayName }: ModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [expandedProviderId, setExpandedProviderId] = useState<string | null>(null);

  const modelName = useMemo(() => {
    if (getModelDisplayName) return getModelDisplayName(selectedModel);
    const provider = providers.find(p => p.models.some(m => m.id === selectedModel));
    const model = provider?.models.find(m => m.id === selectedModel);
    return model ? `${provider?.name} - ${model.name}` : selectedModel || 'Select a model';
  }, [getModelDisplayName, providers, selectedModel]);

  useEffect(() => {
    async function loadProviders() {
      try {
        setIsLoading(true);
        const loaded = await getAllProviders();
        // Normalize to a simple typed shape
        const normalized: ProviderWithModels[] = loaded.map((p: any) => ({
          id: p.id ?? p.config?.id,
          name: p.name ?? p.config?.name,
          icon: p.icon ?? p.config?.icon,
          models: p.models ?? p.config?.models ?? [],
        }));
        setProviders(normalized);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load providers:', error);
        setIsLoading(false);
      }
    }

    loadProviders();
  }, []);

  // Reset expanded section when popover closes
  useEffect(() => {
    if (!open) {
      setExpandedProviderId(null);
    }
  }, [open]);

  // If disabled (existing conversation), show just the model name
  if (disabled) {
    return (
      <div className="text-sm text-muted-foreground truncate max-w-[280px]">Using {modelName}</div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading models...</div>
    );
  }

  const expandedProvider = providers.find(p => p.id === expandedProviderId) || null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[280px] justify-between"
        >
          <span className="truncate">
            {selectedModel ? modelName : 'Select a model...'}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0">
        <div className="p-3 border-b">
          <span className="text-sm font-medium">Select Provider</span>
        </div>
        <div className="p-3">
          <div className="grid grid-cols-3 gap-3">
            {providers.map((provider) => {
              const Icon = provider.icon ? (SiIcons as any)[provider.icon] : null;
              const isExpanded = provider.id === expandedProviderId;
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setExpandedProviderId(prev => prev === provider.id ? null : provider.id)}
                  className={`flex flex-col items-center justify-center aspect-square rounded-md border transition-colors hover:bg-accent hover:text-accent-foreground ${isExpanded ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
                >
                  {Icon && <Icon className="h-8 w-8 md:h-10 md:w-10" />}
                  <span className="mt-2 text-xs truncate max-w-[8rem] text-muted-foreground">{provider.name}</span>
                </button>
              );
            })}
          </div>
        </div>
        <Separator />

        {expandedProvider ? (
          <>
            <div className="p-3 border-b">
              <span className="text-sm font-medium">{expandedProvider.name} Models</span>
            </div>
            <ScrollArea className="h-[260px]">
              <div className="p-2">
                <div className="space-y-1">
                  {expandedProvider.models.map((model) => (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => { onModelChange(model.id); setOpen(false); }}
                      className="w-full flex items-center gap-3 rounded-md p-2 text-left hover:bg-accent hover:text-accent-foreground"
                    >
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{model.name}</span>
                        <span className="text-xs text-muted-foreground">{model.contextLength.toLocaleString()} tokens{model.defaultModel ? ' • default' : ''}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </ScrollArea>
            <div className="border-t p-2 text-xs text-muted-foreground text-center">
              {expandedProvider.models.length} models available
            </div>
          </>
        ) : (
          <div className="p-3 text-xs text-muted-foreground">Click a provider to view its models</div>
        )}
      </PopoverContent>
    </Popover>
  );
}