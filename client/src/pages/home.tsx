import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ChatWindow } from '@/components/chat/chat-window';
import { ConversationList } from '@/components/conversation-list';
import type { Conversation } from '@/lib/llm/types';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>();

  const ConversationSheet = () => (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent 
        side="left" 
        className="w-full p-0 sm:max-w-full flex flex-col"
      >
        <ConversationList
          activeConversation={activeConversation}
          onSelectConversation={(conv) => {
            setActiveConversation(conv);
            const closestSheet = document.querySelector('[data-state="open"]');
            if (closestSheet instanceof HTMLElement) {
              const closeButton = closestSheet.querySelector('[data-state]');
              if (closeButton instanceof HTMLElement) {
                closeButton.click();
              }
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );

  return (
    <div className="h-screen">
      <ResizablePanelGroup direction="horizontal" className="min-h-screen">
        {/* Desktop conversation list */}
        <ResizablePanel defaultSize={25} minSize={20} className="hidden md:block">
          <ConversationList
            activeConversation={activeConversation}
            onSelectConversation={setActiveConversation}
          />
        </ResizablePanel>
        <ResizableHandle className="hidden md:block" />
        {/* Main chat area */}
        <ResizablePanel defaultSize={75}>
          <ChatWindow
            conversation={activeConversation}
            onConversationUpdate={setActiveConversation}
            mobileMenuTrigger={<ConversationSheet />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}