import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectGroup, SelectLabel } from '@/components/ui/select';
import type { ModelConfig } from '@/lib/llm/types';
import { getAllProviders } from '@/lib/llm/providers';

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  getModelDisplayName?: (modelId: string) => string;
}

export function ModelSelector({ selectedModel, onModelChange, disabled, getModelDisplayName }: ModelSelectorProps) {
  const modelName = getModelDisplayName 
    ? getModelDisplayName(selectedModel)
    : selectedModel;

  // If disabled (existing conversation), show just the model name
  if (disabled) {
    return (
      <div className="text-sm text-muted-foreground">
        Using {modelName}
      </div>
    );
  }

  const providers = getAllProviders();

  // For new conversations, show the grouped dropdown
  return (
    <Select
      value={selectedModel}
      onValueChange={onModelChange}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent>
        {providers.map((provider) => (
          <SelectGroup key={provider.id}>
            <SelectLabel className="font-semibold">{provider.name}</SelectLabel>
            {provider.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
            {provider !== providers[providers.length - 1] && <SelectSeparator />}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}