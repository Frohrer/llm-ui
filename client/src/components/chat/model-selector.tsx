import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ModelConfig } from '@/lib/llm/types';

interface ModelSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ models, selectedModel, onModelChange, disabled }: ModelSelectorProps) {
  // Find the selected model config to display its name
  const selectedModelConfig = models.find(model => model.id === selectedModel);

  // If disabled (existing conversation), show just the model name
  if (disabled) {
    return (
      <div className="text-sm text-muted-foreground">
        Using {selectedModelConfig?.name || selectedModel}
      </div>
    );
  }

  // For new conversations, show the dropdown
  return (
    <Select
      value={selectedModel}
      onValueChange={onModelChange}
    >
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="Select a model" />
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}