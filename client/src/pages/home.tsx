import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Menu } from 'lucide-react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ChatWindow } from '@/components/chat/chat-window';
import { MainSidebar } from '@/components/main-sidebar';
import type { Conversation } from '@/lib/llm/types';
import { nanoid } from 'nanoid';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>();

  const handleCreateNewConversation = () => {
    // Here we would normally create a new conversation in the database
    // For now, just create a temporary one in-memory
    const newConversation: Conversation = {
      id: parseInt(nanoid(8), 36),
      title: "New conversation",
      provider: "openai",
      model: "gpt-4o",
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      messages: []
    };
    setActiveConversation(newConversation);
  };

  const SidebarSheet = () => (
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
        <MainSidebar
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
          onNewConversation={handleCreateNewConversation}
          isMobile={true}
          onClose={() => {
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
        {/* Desktop sidebar */}
        <ResizablePanel defaultSize={25} minSize={20} className="hidden md:block">
          <MainSidebar
            activeConversation={activeConversation}
            onSelectConversation={setActiveConversation}
            onNewConversation={handleCreateNewConversation}
          />
        </ResizablePanel>
        <ResizableHandle className="hidden md:block" />
        {/* Main chat area */}
        <ResizablePanel defaultSize={75}>
          <ChatWindow
            conversation={activeConversation}
            onConversationUpdate={setActiveConversation}
            mobileMenuTrigger={<SidebarSheet />}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}