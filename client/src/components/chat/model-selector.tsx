import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator, SelectGroup, SelectLabel } from '@/components/ui/select';
import type { ModelConfig } from '@/lib/llm/types';
import { useProviders } from '@/lib/llm/providers';

interface ModelSelectorProps {
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  getModelDisplayName?: (modelId: string) => string;
}

export function ModelSelector({ selectedModel, onModelChange, disabled, getModelDisplayName }: ModelSelectorProps) {
  const { data: providers, isLoading } = useProviders();
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

  // Loading state
  if (isLoading) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading models...
      </div>
    );
  }

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
        {Object.values(providers || {}).map((provider) => (
          <SelectGroup key={provider.id}>
            <SelectLabel className="font-semibold">{provider.name}</SelectLabel>
            {provider.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
            {provider !== Object.values(providers || {}).pop() && <SelectSeparator />}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}