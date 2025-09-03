import { useEffect, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getAllProviders } from '@/lib/llm/providers';
import type { ModelConfig } from '@/lib/llm/types';

interface MultiModelSelectorProps {
  selectedModels: string[];
  onModelChange: (modelIds: string[]) => void;
  disabled?: boolean;
}

interface ProviderWithModels {
  id: string;
  name: string;
  models: ModelConfig[];
}

export function MultiModelSelector({ 
  selectedModels, 
  onModelChange, 
  disabled 
}: MultiModelSelectorProps) {
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function loadProviders() {
      try {
        setIsLoading(true);
        const loadedProviders = await getAllProviders();
        setProviders(loadedProviders);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to load providers:', error);
        setIsLoading(false);
      }
    }
    
    loadProviders();
  }, []);

  const handleModelToggle = (modelId: string, checked: boolean) => {
    if (checked) {
      onModelChange([...selectedModels, modelId]);
    } else {
      onModelChange(selectedModels.filter(id => id !== modelId));
    }
  };

  const handleSelectAll = () => {
    const allModelIds = providers.flatMap(provider => 
      provider.models.map(model => model.id)
    );
    onModelChange(allModelIds);
  };

  const handleClearAll = () => {
    onModelChange([]);
  };

  const getSelectedModelNames = () => {
    const selectedNames: string[] = [];
    providers.forEach(provider => {
      provider.models.forEach(model => {
        if (selectedModels.includes(model.id)) {
          selectedNames.push(`${provider.name} - ${model.name}`);
        }
      });
    });
    return selectedNames;
  };

  if (disabled) {
    const selectedNames = getSelectedModelNames();
    return (
      <div className="text-sm text-muted-foreground truncate max-w-[300px]">
        Using {selectedNames.length} models: {selectedNames.join(', ')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading models...
      </div>
    );
  }

  const selectedCount = selectedModels.length;
  const totalModels = providers.reduce((sum, provider) => sum + provider.models.length, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[300px] justify-between"
        >
          {selectedCount === 0 
            ? "Select models..." 
            : `${selectedCount} model${selectedCount === 1 ? '' : 's'} selected`
          }
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm font-medium">Select Models</span>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              className="h-7 px-2 text-xs"
            >
              All
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              className="h-7 px-2 text-xs"
            >
              Clear
            </Button>
          </div>
        </div>
        <ScrollArea className="h-[300px]">
          <div className="p-2">
            {providers.map((provider, providerIndex) => (
              <div key={provider.id} className="mb-3">
                <div className="px-2 py-1 text-sm font-semibold text-muted-foreground">
                  {provider.name}
                </div>
                <div className="space-y-1">
                  {provider.models.map((model) => (
                    <div
                      key={model.id}
                      className="flex items-center space-x-2 rounded-sm p-2 hover:bg-accent hover:text-accent-foreground"
                    >
                      <Checkbox
                        id={model.id}
                        checked={selectedModels.includes(model.id)}
                        onCheckedChange={(checked) =>
                          handleModelToggle(model.id, checked as boolean)
                        }
                      />
                      <label
                        htmlFor={model.id}
                        className="text-sm font-normal cursor-pointer flex-1"
                      >
                        {model.name}
                        {model.defaultModel && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            (default)
                          </span>
                        )}
                      </label>
                    </div>
                  ))}
                </div>
                {providerIndex < providers.length - 1 && (
                  <Separator className="mt-2" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <div className="border-t p-2 text-xs text-muted-foreground text-center">
          {selectedCount} of {totalModels} models selected
        </div>
      </PopoverContent>
    </Popover>
  );
} 