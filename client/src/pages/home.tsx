import { useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ChatWindow } from '@/components/chat/chat-window';
import { ConversationList } from '@/components/conversation-list';
import type { Conversation } from '@/lib/llm/types';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>();

  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal">
        <ResizablePanel defaultSize={25} minSize={20}>
          <ConversationList
            activeConversation={activeConversation}
            onSelectConversation={setActiveConversation}
          />
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize={75}>
          <ChatWindow
            conversation={activeConversation}
            onConversationUpdate={setActiveConversation}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}