import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow, isToday, isThisWeek, parseISO } from 'date-fns';
import type { Conversation } from '@/lib/llm/types';

interface ConversationListProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation) => void;
}

export function ConversationList({ activeConversation, onSelectConversation }: ConversationListProps) {
  const { data: conversations, isLoading, error } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
  });

  const categorizedConversations = useMemo(() => {
    if (!conversations) return {};

    return conversations.reduce((acc, conv) => {
      const lastMessageDate = parseISO(conv.lastMessageAt);

      if (isToday(lastMessageDate)) {
        acc.today = [...(acc.today || []), conv];
      } else if (isThisWeek(lastMessageDate)) {
        acc.thisWeek = [...(acc.thisWeek || []), conv];
      } else {
        acc.older = [...(acc.older || []), conv];
      }

      return acc;
    }, {} as Record<'today' | 'thisWeek' | 'older', Conversation[]>);
  }, [conversations]);

  if (isLoading) {
    return <div className="p-4 text-muted-foreground">Loading conversations...</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-destructive">
        Error loading conversations. Please try again later.
      </div>
    );
  }

  if (!conversations?.length) {
    return (
      <div className="p-4 text-center text-muted-foreground">
        No conversations yet. Start a new chat to begin.
      </div>
    );
  }

  const renderCategory = (title: string, conversations: Conversation[] = []) => {
    if (!conversations.length) return null;

    return (
      <div key={title} className="mb-6">
        <h3 className="mb-2 px-2 text-sm font-semibold text-muted-foreground">
          {title}
        </h3>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <Button
              key={conv.id}
              variant={conv.id === activeConversation?.id ? "secondary" : "ghost"}
              className="w-full justify-start text-left"
              onClick={() => onSelectConversation(conv)}
            >
              <div className="flex flex-col items-start">
                <span className="text-sm truncate">{conv.title}</span>
                <span className="text-xs text-muted-foreground">
                  {formatDistanceToNow(parseISO(conv.lastMessageAt), { addSuffix: true })}
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
      <div className="p-4 space-y-2">
        {renderCategory('Today', categorizedConversations.today)}
        {renderCategory('This Week', categorizedConversations.thisWeek)}
        {renderCategory('Previous', categorizedConversations.older)}
      </div>
    </ScrollArea>
  );
}