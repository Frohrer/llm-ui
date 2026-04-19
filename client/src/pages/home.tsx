import { useState } from 'react';
import { ChatWindow } from '@/components/chat/chat-window';
import { MultiChatWindow } from '@/components/chat/multi-chat-window';
import type { Conversation } from '@/lib/llm/types';
import { useUserPreferences } from '@/hooks/use-user-preferences';

export default function Home() {
  const [activeConversation, setActiveConversation] = useState<Conversation | undefined>();
  const [isMultiModelMode, setIsMultiModelMode] = useState<boolean>(false);

  useUserPreferences();

  return (
    <div className="h-screen">
      {isMultiModelMode ? (
        <MultiChatWindow
          onSwitchToSingle={() => setIsMultiModelMode(false)}
          isMultiModelMode={isMultiModelMode}
          onToggleMode={() => {
            setIsMultiModelMode(!isMultiModelMode);
            if (!isMultiModelMode) {
              setActiveConversation(undefined);
            }
          }}
        />
      ) : (
        <ChatWindow
          conversation={activeConversation}
          onConversationUpdate={setActiveConversation}
          onNewChat={() => setActiveConversation(undefined)}
          onSelectConversation={(conv) => {
            setActiveConversation(conv);
            setIsMultiModelMode(false);
          }}
          isMultiModelMode={isMultiModelMode}
          onToggleMode={() => {
            setIsMultiModelMode(!isMultiModelMode);
            if (!isMultiModelMode) {
              setActiveConversation(undefined);
            }
          }}
        />
      )}
    </div>
  );
}
