import { useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDistanceToNow, isToday, isThisWeek, parseISO } from 'date-fns';
import { Trash2, Plus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import type { Conversation } from '@/lib/llm/types';

interface ConversationListProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation | undefined) => void;
}

export function ConversationList({ activeConversation, onSelectConversation }: ConversationListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: conversations, isLoading, error } = useQuery<Conversation[]>({
    queryKey: ['/api/conversations'],
  });

  // Delete conversation mutation
  const deleteMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }
      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      toast({
        description: "Conversation deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete conversation",
      });
    },
  });

  const handleNewChat = () => {
    onSelectConversation(undefined);
  };

  const handleDelete = async (conversationId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    if (confirm('Are you sure you want to delete this conversation?')) {
      await deleteMutation.mutate(conversationId);
      if (activeConversation?.id === conversationId) {
        onSelectConversation(undefined);
      }
    }
  };

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

  const renderCategory = (title: string, conversations: Conversation[] = []) => {
    if (!conversations.length) return null;

    return (
      <div key={title} className="mb-6">
        <h3 className="mb-2 px-2 text-sm font-semibold text-muted-foreground">
          {title}
        </h3>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div key={conv.id} className="group flex items-center gap-2 px-2">
              <Button
                variant={conv.id === activeConversation?.id ? "secondary" : "ghost"}
                className="flex-1 justify-start text-left"
                onClick={() => onSelectConversation(conv)}
              >
                <div className="flex flex-col items-start">
                  <span className="text-sm truncate">{conv.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(parseISO(conv.lastMessageAt), { addSuffix: true })}
                  </span>
                </div>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => handleDelete(conv.id, e)}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Chat History</h2>
          <Button onClick={handleNewChat} variant="outline" size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Chat
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {!conversations?.length ? (
            <div className="text-center text-muted-foreground">
              No conversations yet. Start a new chat to begin.
            </div>
          ) : (
            <>
              {renderCategory('Today', categorizedConversations.today)}
              {renderCategory('This Week', categorizedConversations.thisWeek)}
              {renderCategory('Previous', categorizedConversations.older)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}