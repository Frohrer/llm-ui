import { useEffect, useMemo, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow, isToday, isThisWeek, isThisMonth, parseISO } from "date-fns";
import { Trash2, Search, X, MessageSquare } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Conversation } from "@/lib/llm/types";

interface ConversationListProps {
  activeConversation?: Conversation;
  onSelectConversation: (conversation: Conversation | undefined) => void;
  hideNsfw?: boolean;
  compact?: boolean;
}

export function ConversationList({
  activeConversation,
  onSelectConversation,
  hideNsfw = false,
  compact = false,
}: ConversationListProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");

  const isVoiceConversation = (conv: Conversation) => conv.provider === 'openai-realtime';

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
    const conversationsToUse = debouncedSearchQuery.trim().length > 0 ? searchResults : conversations;

    if (!conversationsToUse) return { today: [], thisWeek: [], thisMonth: [], older: [] };

    const filtered = hideNsfw ? conversationsToUse.filter(c => !c.isNsfw) : conversationsToUse;

    return filtered.reduce(
      (acc, conv) => {
        const lastMessageDate = parseISO(conv.lastMessageAt);

        if (isToday(lastMessageDate)) {
          acc.today = [...(acc.today || []), conv];
        } else if (isThisWeek(lastMessageDate)) {
          acc.thisWeek = [...(acc.thisWeek || []), conv];
        } else if (isThisMonth(lastMessageDate)) {
          acc.thisMonth = [...(acc.thisMonth || []), conv];
        } else {
          acc.older = [...(acc.older || []), conv];
        }

        return acc;
      },
      { today: [], thisWeek: [], thisMonth: [], older: [] } as Record<"today" | "thisWeek" | "thisMonth" | "older", Conversation[]>,
    );
  }, [conversations, searchResults, debouncedSearchQuery, hideNsfw]);

  useEffect(() => {
    if (activeConversationWithMessages) {
      onSelectConversation(activeConversationWithMessages);
    }
  }, [activeConversationWithMessages, onSelectConversation]);

  const clearSearch = useCallback(() => {
    setSearchQuery("");
    setDebouncedSearchQuery("");
  }, []);

  const handleConversationClick = (conv: Conversation) => {
    if (isVoiceConversation(conv)) {
      setLocation(`/voice-chat/${conv.id}`);
    } else {
      onSelectConversation(conv);
    }
  };

  // Format model name for display
  const formatModelName = (model: string) => {
    if (!model) return "";
    // Shorten common prefixes
    return model
      .replace(/^gpt-/, "")
      .replace(/^claude-/, "")
      .replace(/^gemini-/, "gem-")
      .replace(/-(?:latest|preview)$/, "");
  };

  const searchInput = (
    <div className="shrink-0">
      <div className="relative px-3 pr-10 py-2.5">
        <Search className="absolute left-5.5 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 pr-8 h-9 text-sm border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 bg-transparent outline-none"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="sm"
            className="absolute right-3 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
            onClick={clearSearch}
          >
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <hr className="border-border" />
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        {searchInput}
        <div className="px-4 pt-2 text-muted-foreground text-sm">
          <span className="loading-dots"><span>.</span><span>.</span><span>.</span></span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full">
        {searchInput}
        <div className="px-4 pt-2 text-destructive text-sm">
          Failed to load conversations.
        </div>
      </div>
    );
  }

  const renderConversationItem = (conv: Conversation) => {
    const isVoice = isVoiceConversation(conv);
    const isActive = conv.id === activeConversation?.id;
    const modelLabel = formatModelName(conv.model);
    const messageCount = conv.messages?.length;

    return (
      <div
        key={conv.id}
        className={`group relative px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
          isActive
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent/50"
        }`}
        onClick={() => handleConversationClick(conv)}
      >
        {/* Content */}
        <div className="min-w-0 overflow-hidden" style={{ maxWidth: 'calc(100% - 1.5rem)' }}>
          <p className="text-sm font-medium truncate">
            {conv.title}
          </p>
          <div className="flex items-center gap-1.5">
            {modelLabel && (
              <span className="text-[11px] text-muted-foreground/70 truncate max-w-[100px]">
                {modelLabel}
              </span>
            )}
            {modelLabel && (
              <span className="text-muted-foreground/40 text-[10px]">&middot;</span>
            )}
            <span className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
              {formatDistanceToNow(parseISO(conv.lastMessageAt), { addSuffix: true })}
            </span>
            {messageCount != null && messageCount > 0 && (
              <>
                <span className="text-muted-foreground/40 text-[10px]">&middot;</span>
                <span className="text-[11px] text-muted-foreground/70 whitespace-nowrap">
                  {messageCount} msg{messageCount !== 1 ? "s" : ""}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Delete button — visible on hover (desktop) or always subtly visible (mobile/touch) */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 opacity-40 sm:opacity-0 group-hover:opacity-100 transition-opacity absolute right-1.5 top-1/2 -translate-y-1/2"
          onClick={(e) => handleDelete(conv.id, e)}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
        </Button>
      </div>
    );
  };

  const renderCategory = (
    title: string,
    conversations: Conversation[] = [],
  ) => {
    if (!conversations.length) return null;

    return (
      <div key={title} className="mb-1">
        <h3 className="mb-1 px-2 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">
          {title}
        </h3>
        <div className="space-y-0.5">
          {conversations.map(renderConversationItem)}
        </div>
      </div>
    );
  };

  const isShowingSearchResults = debouncedSearchQuery.trim().length > 0;
  const currentConversations = isShowingSearchResults ? searchResults : conversations;
  const hasNoResults = isShowingSearchResults && searchResults?.length === 0;
  const hasNoConversations = !isShowingSearchResults && !conversations?.length;

  return (
    <div className="flex flex-col h-full">
      {searchInput}

      <ScrollArea className="flex-1 [&>div>div]:!block">
        <div className="px-1 pb-2 overflow-hidden">
          {isSearching && isShowingSearchResults && (
            <div className="text-center text-muted-foreground text-sm py-4">
              Searching...
            </div>
          )}

          {searchError && isShowingSearchResults && (
            <div className="text-center text-destructive text-sm py-4">
              Search failed. Please try again.
            </div>
          )}

          {hasNoResults && !isSearching && (
            <div className="text-center text-muted-foreground text-sm py-8">
              No results for "{debouncedSearchQuery}"
            </div>
          )}

          {hasNoConversations && (
            <div className="flex flex-col items-center justify-center text-muted-foreground text-sm py-12 px-4">
              <MessageSquare className="h-8 w-8 mb-3 opacity-30" />
              <span className="text-center">No conversations yet</span>
            </div>
          )}

          {currentConversations && currentConversations.length > 0 && !isSearching && (
            <>
              {renderCategory("Today", categorizedConversations.today)}
              {renderCategory("This Week", categorizedConversations.thisWeek)}
              {renderCategory("This Month", categorizedConversations.thisMonth)}
              {renderCategory("Older", categorizedConversations.older)}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
