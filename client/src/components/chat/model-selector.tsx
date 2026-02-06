import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft } from 'lucide-react';
import * as SiIcons from 'react-icons/si';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const isMobile = useIsMobile();

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
      <div className="text-xs sm:text-sm text-muted-foreground truncate max-w-[140px] sm:max-w-[280px]">Using {modelName}</div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">Loading models...</div>
    );
  }

  const expandedProvider = providers.find(p => p.id === expandedProviderId) || null;

  const triggerButton = (
    <Button
      variant="outline"
      role="combobox"
      aria-expanded={open}
      className="w-[160px] sm:w-[280px] justify-between text-xs sm:text-sm"
    >
      <span className="truncate">
        {selectedModel ? modelName : 'Select a model...'}
      </span>
      <ChevronDown className="ml-1 sm:ml-2 h-4 w-4 shrink-0 opacity-50" />
    </Button>
  );

  const providerGrid = (
    <div className={`grid gap-2 ${isMobile ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 sm:gap-3'}`}>
      {providers.map((provider) => {
        const Icon = provider.icon ? (SiIcons as any)[provider.icon] : null;
        const isExpanded = provider.id === expandedProviderId;
        return (
          <button
            key={provider.id}
            type="button"
            onClick={() => setExpandedProviderId(prev => prev === provider.id ? null : provider.id)}
            className={`flex flex-col items-center justify-center rounded-lg border-2 transition-all duration-200 hover:bg-accent hover:text-accent-foreground p-2 ${isMobile ? 'gap-1' : 'aspect-square'} ${isExpanded ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
          >
            {Icon && <Icon className={isMobile ? 'h-5 w-5' : 'h-5 w-5 sm:h-10 sm:w-10'} />}
            <span className={`text-[10px] truncate max-w-full px-1 text-muted-foreground ${isMobile ? '' : 'mt-1 sm:text-xs'}`}>{provider.name}</span>
          </button>
        );
      })}
    </div>
  );

  const modelList = expandedProvider ? (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-3 border-b flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpandedProviderId(null)}
          className="p-1 hover:bg-accent rounded"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{expandedProvider.name} Models</span>
      </div>
      <ScrollArea className={isMobile ? 'flex-1' : 'h-[260px]'}>
        <div className="p-2">
          <div className="space-y-1">
            {expandedProvider.models.map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => { onModelChange(model.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 rounded-lg p-3 text-left transition-all duration-200 hover:bg-accent hover:text-accent-foreground ${selectedModel === model.id ? 'bg-primary/10 border border-primary/20' : ''}`}
              >
                <div className="flex flex-col flex-1">
                  <span className="text-sm font-medium">{model.name}</span>
                  <span className="text-xs text-muted-foreground">{model.contextLength.toLocaleString()} tokens{model.defaultModel ? ' • default' : ''}</span>
                </div>
                {selectedModel === model.id && (
                  <div className="w-2 h-2 rounded-full bg-primary"></div>
                )}
              </button>
            ))}
          </div>
        </div>
      </ScrollArea>
      <div className="border-t p-2 text-xs text-muted-foreground text-center">
        {expandedProvider.models.length} models available
      </div>
    </div>
  ) : null;

  // Mobile: use Drawer for better UX
  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerTrigger asChild>
          {triggerButton}
        </DrawerTrigger>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle>Select Model</DrawerTitle>
          </DrawerHeader>
          <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {!expandedProvider && (
              <div className="px-4 pb-4">
                {providerGrid}
              </div>
            )}
            {modelList}
            {!expandedProvider && (
              <div className="p-4 text-xs text-muted-foreground text-center">
                Tap a provider to view its models
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  // Desktop: use Popover
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {triggerButton}
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0">
        <div className="p-3 border-b">
          <span className="text-sm font-medium">Select Provider</span>
        </div>
        <div className="p-3">
          {providerGrid}
        </div>
        <Separator />
        {modelList || (
          <div className="p-3 text-xs text-muted-foreground">Click a provider to view its models</div>
        )}
      </PopoverContent>
    </Popover>
  );
}