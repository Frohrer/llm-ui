import { useEffect, useState } from 'react';
import { countTokens, getMaxContextLength } from '@/lib/token-counter';
import { useProviders } from '@/lib/llm/providers';

interface TokenCounterProps {
  text: string;
  modelId: string;
}

export function TokenCounter({ text, modelId }: TokenCounterProps) {
  const [tokenCount, setTokenCount] = useState(0);
  const { data: providers } = useProviders();
  
  const maxTokens = providers 
    ? getMaxContextLength(providers, modelId)
    : 0;
  
  useEffect(() => {
    if (text && modelId) {
      const count = countTokens(text, modelId);
      setTokenCount(count);
    } else {
      setTokenCount(0);
    }
  }, [text, modelId]);
  
  if (!modelId) return null;
  
  return (
    <div className="text-xs text-muted-foreground flex items-center mt-2">
      <span>
        Tokens: {tokenCount.toLocaleString()} / {maxTokens.toLocaleString()}
      </span>
      <div className="w-20 h-1 bg-secondary ml-2 rounded-full overflow-hidden">
        <div 
          className="h-full bg-primary rounded-full"
          style={{ 
            width: `${Math.min(100, (tokenCount / maxTokens) * 100)}%`,
            backgroundColor: tokenCount > maxTokens * 0.9 ? 'var(--destructive)' : undefined
          }}
        />
      </div>
    </div>
  );
}