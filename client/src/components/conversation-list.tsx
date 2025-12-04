import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow, isToday, isThisWeek, parseISO } from "date-fns";
import { Trash2, Search, X, Mic } from "lucide-react";
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
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  
  // Helper to check if a conversation is a voice chat
  const isVoiceConversation = (conv: Conversation) => conv.provider === 'openai-realtime';

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    data: conversations,
    isLoading,
    error,
  } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations"],
  });

  // Search query - only triggered when there's a search term
  const {
    data: searchResults,
    isLoading: isSearching,
    error: searchError,
  } = useQuery<Conversation[]>({
    queryKey: ["/api/conversations/search", debouncedSearchQuery],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/search?q=${encodeURIComponent(debouncedSearchQuery)}`);
      if (!response.ok) {
        throw new Error("Failed to search conversations");
      }
      return response.json();
    },
    enabled: debouncedSearchQuery.trim().length > 0,
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
    // Use search results if searching, otherwise use all conversations
    const conversationsToUse = debouncedSearchQuery.trim().length > 0 ? searchResults : conversations;
    
    if (!conversationsToUse) return { today: [], thisWeek: [], older: [] };

    return conversationsToUse.reduce(
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
      { today: [], thisWeek: [], older: [] } as Record<"today" | "thisWeek" | "older", Conversation[]>,
    );
  }, [conversations, searchResults, debouncedSearchQuery]);

  // Update active conversation with messages when they are loaded
  useEffect(() => {
    if (activeConversationWithMessages) {
      onSelectConversation(activeConversationWithMessages);
    }
  }, [activeConversationWithMessages, onSelectConversation]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        {/* Search input even during loading */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={clearSearch}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="p-4 pt-2 text-muted-foreground text-sm md:text-base">
          Loading conversations...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {/* Search input even during error */}
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={clearSearch}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
        <div className="p-4 pt-2 text-destructive text-sm md:text-base">
          Error loading conversations. Please try again later.
        </div>
      </div>
    );
  }

  const handleConversationClick = (conv: Conversation) => {
    if (isVoiceConversation(conv)) {
      // Navigate to voice chat page for voice conversations
      setLocation(`/voice-chat/${conv.id}`);
    } else {
      // Use the regular conversation selection for text chats
      onSelectConversation(conv);
    }
  };

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
          {conversations.map((conv) => {
            const isVoice = isVoiceConversation(conv);
            return (
              <div key={conv.id} className="group grid grid-cols-[1fr,40px] items-center px-2 w-full">
                <Button
                  variant={
                    conv.id === activeConversation?.id ? "secondary" : "ghost"
                  }
                  className="w-full justify-start text-left h-auto py-3 md:py-2 overflow-hidden pr-1"
                  onClick={() => handleConversationClick(conv)}
                >
                  <div className="flex items-start gap-2 w-full overflow-hidden">
                    {isVoice && (
                      <Mic className="h-4 w-4 flex-shrink-0 mt-0.5 text-muted-foreground" />
                    )}
                    <div className="flex flex-col items-start w-full overflow-hidden">
                      <span className="text-sm md:text-base truncate w-full inline-block">
                        {conv.title}
                      </span>
                      <span className="text-xs text-muted-foreground truncate w-full inline-block">
                        {isVoice ? '🎙️ ' : ''}{formatDistanceToNow(parseISO(conv.lastMessageAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
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
            );
          })}
        </div>
      </div>
    );
  };

  // Determine if we're showing search results
  const isShowingSearchResults = debouncedSearchQuery.trim().length > 0;
  const currentConversations = isShowingSearchResults ? searchResults : conversations;
  const hasNoResults = isShowingSearchResults && searchResults?.length === 0;
  const hasNoConversations = !isShowingSearchResults && !conversations?.length;

  return (
    <div className="flex flex-col h-full">
      {/* Search Input */}
      <div className="p-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
              onClick={clearSearch}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-4 pt-2 space-y-2">
          {/* Loading state for search */}
          {isSearching && isShowingSearchResults && (
            <div className="text-center text-muted-foreground text-sm md:text-base">
              Searching conversations...
            </div>
          )}

          {/* Search error */}
          {searchError && isShowingSearchResults && (
            <div className="text-center text-destructive text-sm md:text-base">
              Error searching conversations. Please try again.
            </div>
          )}

          {/* No search results */}
          {hasNoResults && !isSearching && (
            <div className="text-center text-muted-foreground text-sm md:text-base">
              No conversations found matching "{debouncedSearchQuery}".
            </div>
          )}

          {/* No conversations at all */}
          {hasNoConversations && (
            <div className="text-center text-muted-foreground text-sm md:text-base">
              No conversations yet. Start a new chat to begin.
            </div>
          )}

          {/* Show categorized results */}
          {currentConversations && currentConversations.length > 0 && !isSearching && (
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