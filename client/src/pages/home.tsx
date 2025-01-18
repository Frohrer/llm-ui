import { useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ProviderSidebar } from '@/components/provider-sidebar';
import { ChatWindow } from '@/components/chat/chat-window';
import { ConversationList } from '@/components/conversation-list';
import type { LLMProvider, Conversation } from '@/lib/llm/types';
import { getAllProviders } from '@/lib/llm/providers';

export default function Home() {
  const [activeProvider, setActiveProvider] = useState<LLMProvider>(getAllProviders()[0]);
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>();

  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={20} minSize={15}>
          <div className="h-screen flex flex-col">
            <ProviderSidebar
              providers={getAllProviders()}
              activeProvider={activeProvider}
              onProviderChange={(provider) => {
                setActiveProvider(provider);
                setActiveConversation(undefined);
              }}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={20} minSize={15}>
          <ConversationList
            activeConversation={activeConversation}
            onSelectConversation={setActiveConversation}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={60}>
          <ChatWindow
            provider={activeProvider}
            conversation={activeConversation}
            onConversationUpdate={setActiveConversation}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}