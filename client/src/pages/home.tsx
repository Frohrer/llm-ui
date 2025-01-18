import { useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ProviderSidebar } from '@/components/provider-sidebar';
import { ChatWindow } from '@/components/chat/chat-window';
import type { LLMProvider } from '@/lib/llm/types';
import { getAllProviders } from '@/lib/llm/providers';

export default function Home() {
  const [activeProvider, setActiveProvider] = useState<LLMProvider>(getAllProviders()[0]);
  
  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={15}>
          <ProviderSidebar
            providers={getAllProviders()}
            activeProvider={activeProvider}
            onProviderChange={setActiveProvider}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={80}>
          <ChatWindow provider={activeProvider} />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
