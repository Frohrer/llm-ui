import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ModelConfig } from '@/lib/llm/types';

interface ModelSelectorProps {
  models: ModelConfig[];
  selectedModel: string;
  onModelChange: (modelId: string) => void;
  disabled?: boolean;
  getModelDisplayName?: (modelId: string) => string;
}

export function ModelSelector({ models, selectedModel, onModelChange, disabled, getModelDisplayName }: ModelSelectorProps) {
  // Find the selected model config to display its name
  const modelName = getModelDisplayName 
    ? getModelDisplayName(selectedModel)
    : models.find(model => model.id === selectedModel)?.name || selectedModel;

  // If disabled (existing conversation), show just the model name
  if (disabled) {
    return (
      <div className="text-sm text-muted-foreground">
        Using {modelName}
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