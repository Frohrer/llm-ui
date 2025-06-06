import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow, isToday, isThisWeek, parseISO } from "date-fns";
import { Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Conversation } from "@/lib/llm/types";

interface ConversationListProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation | undefined) => void;
}

export function ConversationList({
  activeConversation,
  onSelectConversation,
}: ConversationListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const {
    data: conversations,
    isLoading,
    error,
  } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  // Query for messages when a conversation is selected
  const { data: activeConversationWithMessages } = useQuery<Conversation>({
    queryKey: ["/api/conversations", activeConversation?.id, "messages"],
    queryFn: async () => {
      if (!activeConversation?.id) return undefined;
      const response = await fetch(`/api/conversations/${activeConversation.id}/messages`);
      if (!response.ok) {
        throw new Error("Failed to fetch conversation messages");
      }
      return response.json();
    },
    enabled: !!activeConversation?.id,
  });

  // Delete conversation mutation
  const deleteMutation = useMutation({
    mutationFn: async (conversationId: number) => {
      const response = await fetch(`/api/conversations/${conversationId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Failed to delete conversation");
      }
      return conversationId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
      toast({
        description: "Conversation deleted successfully",
      });
    },
    onError: (error) => {
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete conversation",
      });
    },
  });

  // Removed handleNewChat function as it's now handled in the MainSidebar

  const handleDelete = async (
    conversationId: number,
    event: React.MouseEvent,
  ) => {
    event.stopPropagation();
    if (confirm("Are you sure you want to delete this conversation?")) {
      await deleteMutation.mutate(conversationId);
      if (activeConversation?.id === conversationId) {
        onSelectConversation(undefined);
      }
    }
  };

  const categorizedConversations = useMemo(() => {
    if (!conversations) return {};

    return conversations.reduce(
      (acc, conv) => {
        const lastMessageDate = parseISO(conv.lastMessageAt);

        if (isToday(lastMessageDate)) {
          acc.today = [...(acc.today || []), conv];
        } else if (isThisWeek(lastMessageDate)) {
          acc.thisWeek = [...(acc.thisWeek || []), conv];
        } else {
          acc.older = [...(acc.older || []), conv];
        }

        return acc;
      },
      {} as Record<"today" | "thisWeek" | "older", Conversation[]>,
    );
  }, [conversations]);

  // Update active conversation with messages when they are loaded
  useEffect(() => {
    if (activeConversationWithMessages) {
      onSelectConversation(activeConversationWithMessages);
    }
  }, [activeConversationWithMessages, onSelectConversation]);

  if (isLoading) {
    return (
      <div className="p-4 text-muted-foreground text-sm md:text-base">
        Loading conversations...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-destructive text-sm md:text-base">
        Error loading conversations. Please try again later.
      </div>
    );
  }

  const renderCategory = (
    title: string,
    conversations: Conversation[] = [],
  ) => {
    if (!conversations.length) return null;

    return (
      <div key={title} className="mb-6">
        <h3 className="mb-2 px-2 text-xs md:text-sm font-semibold text-muted-foreground">
          {title}
        </h3>
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div key={conv.id} className="group grid grid-cols-[1fr,40px] items-center px-2 w-full">
              <Button
                variant={
                  conv.id === activeConversation?.id ? "secondary" : "ghost"
                }
                className="w-full justify-start text-left h-auto py-3 md:py-2 overflow-hidden pr-1"
                onClick={() => onSelectConversation(conv)}
              >
                <div className="flex flex-col items-start w-full overflow-hidden">
                  <span className="text-sm md:text-base truncate w-full inline-block">
                    {conv.title}
                  </span>
                  <span className="text-xs text-muted-foreground truncate w-full inline-block">
                    {formatDistanceToNow(parseISO(conv.lastMessageAt), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 justify-self-end"
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
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {!conversations?.length ? (
            <div className="text-center text-muted-foreground text-sm md:text-base">
              No conversations yet. Start a new chat to begin.
            </div>
          ) : (
            <>
              {renderCategory("Today", categorizedConversations.today)}
              {renderCategory("This Week", categorizedConversations.thisWeek)}
              {renderCategory("Previous", categorizedConversations.older)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}