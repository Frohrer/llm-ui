import type { LLMProvider } from '@/lib/llm/types';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import * as SiIcons from 'react-icons/si';

interface ProviderSidebarProps {
  providers: LLMProvider[];
  activeProvider: LLMProvider;
  onProviderChange: (provider: LLMProvider) => void;
}

export function ProviderSidebar({ providers, activeProvider, onProviderChange }: ProviderSidebarProps) {
  return (
    <div className="h-screen border-r bg-sidebar">
      <div className="p-4 border-b">
        <h2 className="font-semibold">Chat Providers</h2>
      </div>
      <ScrollArea className="h-[calc(100vh-65px)]">
        <div className="p-2 space-y-2">
          {providers.map((provider) => {
            const Icon = (SiIcons as any)[provider.icon];
            return (
              <Button
                key={provider.id}
                variant={provider.id === activeProvider.id ? "default" : "ghost"}
                className="w-full justify-start gap-2"
                onClick={() => onProviderChange(provider)}
              >
                {Icon && <Icon className="h-4 w-4" />}
                {provider.name}
              </Button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}