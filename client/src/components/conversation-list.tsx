import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow } from 'date-fns';
import type { Conversation } from '@/lib/llm/types';

interface ConversationListProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation) => void;
}

export function ConversationList({ activeConversation, onSelectConversation }: ConversationListProps) {
  const { data: conversations, isLoading } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
  });

  const categorizedConversations = useMemo(() => {
    if (!conversations) return {};

    const now = new Date();
    const today = new Date().setHours(0, 0, 0, 0);
    const weekAgo = new Date(today - 7 * 24 * 60 * 60 * 1000);

    return conversations.reduce((acc, conv) => {
      const lastMessageDate = new Date(conv.lastMessageAt);

      if (lastMessageDate >= new Date(today)) {
        acc.today = [...(acc.today || []), conv];
      } else if (lastMessageDate >= weekAgo) {
        acc.thisWeek = [...(acc.thisWeek || []), conv];
      } else {
        acc.older = [...(acc.older || []), conv];
      }

      return acc;
    }, {} as Record<'today' | 'thisWeek' | 'older', Conversation[]>);
  }, [conversations]);

  if (isLoading) {
    return <div className="p-4">Loading conversations...</div>;
  }

  const renderCategory = (title: string, conversations: Conversation[] = []) => {
    if (!conversations.length) return null;

    return (
      <div key={title}>
        <h3 className="mb-2 px-2 text-sm font-semibold text-muted-foreground">{title}</h3>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <Button
              key={conv.id}
              variant={conv.id === activeConversation?.id ? "secondary" : "ghost"}
              className="w-full justify-start text-left"
              onClick={() => onSelectConversation(conv)}
            >
              <div className="flex flex-col items-start">
                <span className="text-sm">{conv.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(conv.lastMessageAt), { addSuffix: true })}
                </span>
              </div>
            </Button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <ScrollArea className="h-[calc(100vh-65px)]">
      <div className="p-2 space-y-4">
        {renderCategory('Today', categorizedConversations.today)}
        {renderCategory('This Week', categorizedConversations.thisWeek)}
        {renderCategory('Previous', categorizedConversations.older)}
      </div>
    </ScrollArea>
  );
}
