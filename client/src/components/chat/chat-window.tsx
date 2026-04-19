import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { nanoid } from "nanoid";
import { Message } from "@/components/chat/message";
import { ChatInput } from "@/components/chat/chat-input";
import { ModelSelector } from "./model-selector";
import type { Message as MessageType, Conversation } from "@/lib/llm/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { getAllProviders } from "@/lib/llm/providers";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  Wrench,
  Grid3x3,
  Plus,
  Menu,
  History,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { getConversationKnowledge } from "@/hooks/use-knowledge";
import { KnowledgeModal } from "@/components/knowledge/knowledge-modal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider
} from "@/components/ui/tooltip";
import { MainSidebar } from "@/components/main-sidebar";
import { ConversationList } from "@/components/conversation-list";

interface ChatWindowProps {
  conversation?: Conversation;
  onConversationUpdate?: (conversation: Conversation) => void;
  onNewChat?: () => void;
  onSelectConversation?: (conversation: Conversation | undefined) => void;
  isMultiModelMode?: boolean;
  onToggleMode?: () => void;
}

export function ChatWindow({
  conversation,
  onConversationUpdate,
  onNewChat,
  onSelectConversation,
  isMultiModelMode = false,
  onToggleMode,
}: ChatWindowProps) {
  const transformMessages = (conv?: Conversation): MessageType[] => {
    if (!conv) return [];
    return conv.messages
      .map((msg) => {
        const attachments = msg.metadata?.attachments as MessageType['attachments'];
        return {
          id: msg.id.toString(),
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at).getTime(),
          attachment: attachments?.[0],
          attachments,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const [messages, setMessages] = useState<MessageType[]>(
    transformMessages(conversation),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const streamIdRef = useRef<string>("");
  const abortControllerRef = useRef<AbortController>();
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Message queue for sending messages while AI is responding
  type QueuedMessage = {
    id: string;
    content: string;
    attachment?: { type: "document" | "image"; url: string; text?: string; name: string };
    allAttachments?: { type: "document" | "image"; url: string; text?: string; name: string }[];
  };
  const [messageQueue, setMessageQueue] = useState<QueuedMessage[]>([]);
  const isProcessingQueueRef = useRef(false);

  const [providers, setProviders] = useState<Record<string, any>>({});
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);

  // Load providers on component mount
  useEffect(() => {
    async function loadProviders() {
      try {
        const loadedProviders = await getAllProviders();
        const providersMap = loadedProviders.reduce(
          (acc, provider) => {
            acc[provider.config.id] = provider;
            return acc;
          },
          {} as Record<string, any>,
        );
        setProviders(providersMap);
        setIsLoadingProviders(false);
      } catch (error) {
        console.error("Failed to load providers:", error);
        setIsLoadingProviders(false);
      }
    }

    loadProviders();
  }, []);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Add focus effect to check server and auth status
  useEffect(() => {
    const checkServerStatus = async () => {
      try {
        const response = await fetch("/api/user");
        if (!response.ok) {
          // If we get a 401, we need to refresh the page to trigger re-auth
          if (response.status === 401) {
            toast({
              title: "Session expired",
              description: "Please refresh the page to continue.",
              variant: "destructive",
            });
          } else {
            // For other errors, just show a general error message
            toast({
              title: "Connection error",
              description:
                "Unable to connect to server. Please check your connection.",
              variant: "destructive",
            });
          }
        } else {
          // If connection is successful, refresh all queries to get latest data
          await queryClient.invalidateQueries();
        }
      } catch (error) {
        toast({
          title: "Connection error",
          description:
            "Unable to connect to server. Please check your connection.",
          variant: "destructive",
        });
      }
    };

    // Add focus event listener
    const handleFocus = () => {
      checkServerStatus();
    };

    window.addEventListener("focus", handleFocus);

    // Cleanup
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [queryClient, toast]);

  const [selectedModel, setSelectedModel] = useState<string>("");
  // Knowledge is always enabled now, but keeping for API compatibility
  const useKnowledge = true;
  // Add useAgenticMode state for agentic workflow
  const [useAgenticMode, setUseAgenticMode] = useState<boolean>(false);
  const [showMenuSheet, setShowMenuSheet] = useState(false);
  const [showHistorySheet, setShowHistorySheet] = useState(false);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [hideNsfw, setHideNsfw] = useState(() => {
    const stored = localStorage.getItem("nsfw-visibility");
    return stored !== "show";
  });
  const [pendingKnowledgeSources, setPendingKnowledgeSources] = useState<
    number[]
  >([]);
  const [pendingNsfw, setPendingNsfw] = useState(false);



  // Check if conversation has knowledge attached
  const conversationKnowledgeQuery = useQuery({
    queryKey: ["/api/knowledge/conversation", conversation?.id],
    queryFn: async () => {
      if (!conversation?.id) return [];
      try {
        return await getConversationKnowledge(conversation.id);
      } catch (error) {
        console.error("Error fetching knowledge sources:", error);
        return [];
      }
    },
    enabled: !!conversation?.id,
  });

  // Check if knowledge is attached to the current conversation or if there are pending sources
  const hasKnowledgeAttached = !!(
    (conversationKnowledgeQuery.data &&
      conversationKnowledgeQuery.data.length > 0) ||
    (pendingKnowledgeSources && pendingKnowledgeSources.length > 0)
  );

  // Fetch full conversation with messages when a conversation is selected
  const { data: fullConversation } = useQuery<Conversation>({
    queryKey: ["/api/conversations", conversation?.id, "messages"],
    queryFn: async () => {
      const response = await fetch(`/api/conversations/${conversation!.id}/messages`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch conversation messages");
      return response.json();
    },
    enabled: !!conversation?.id,
  });

  // Update messages when conversation changes or full messages load
  useEffect(() => {
    // Prefer the full conversation (with messages) from the query
    const source = fullConversation?.id === conversation?.id ? fullConversation : conversation;
    const sortedMessages = transformMessages(source);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation?.id, fullConversation]);

  // Helper to get the Radix scroll viewport element
  const getViewport = useCallback(() => {
    return containerRef.current?.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  // Set default model when providers are loaded
  useEffect(() => {
    if (!providers || selectedModel || conversation) {
      return;
    }

    // Find the first default model
    for (const provider of Object.values(providers)) {
      const defaultModel = provider.models.find((m: any) => m.defaultModel);
      if (defaultModel) {
        console.log("Setting default model:", defaultModel.id);
        setSelectedModel(defaultModel.id);
        return;
      }
    }

    // If no default model is found, use the first available model
    const firstProvider = Object.values(providers)[0];
    if (firstProvider && firstProvider.models.length > 0) {
      console.log("Setting first available model:", firstProvider.models[0].id);
      setSelectedModel(firstProvider.models[0].id);
    }
  }, [providers, selectedModel, conversation]);

  // Check if the viewport is scrolled near the bottom (within 80px)
  const isNearBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return true;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 80;
  }, [getViewport]);

  // Instantly scroll the viewport to the very bottom (for button click / sending a message)
  const scrollToBottom = useCallback(() => {
    const viewport = getViewport();
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
    shouldAutoScrollRef.current = true;
    setShowScrollButton(false);
  }, [getViewport]);

  // Auto-scroll when streaming text changes — useLayoutEffect fires after DOM update
  // but before the browser paints, so the user never sees an un-scrolled frame.
  useLayoutEffect(() => {
    if (streamedText && shouldAutoScrollRef.current) {
      const viewport = getViewport();
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [streamedText, getViewport]);

  // Auto-scroll when the messages array changes (user message added, stream finishes)
  useLayoutEffect(() => {
    if (messages.length > 0 && shouldAutoScrollRef.current) {
      const viewport = getViewport();
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, getViewport]);

  // Scroll-position listener: unstick when user scrolls up, re-stick when they scroll back down
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const onScroll = () => {
      const atBottom = isNearBottom();
      shouldAutoScrollRef.current = atBottom;
      setShowScrollButton(!atBottom);
    };

    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", onScroll);
  }, [conversation?.id, messages.length, getViewport, isNearBottom]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Process queued messages when loading finishes
  useEffect(() => {
    if (!isLoading && messageQueue.length > 0 && !isProcessingQueueRef.current) {
      isProcessingQueueRef.current = true;
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);

      // Remove the optimistic queued user message (it will be re-added by handleSendMessage)
      setMessages((prev) => prev.filter((m) => m.id !== `queued-${next.id}`));

      // Small delay to let state settle before sending next message
      setTimeout(() => {
        isProcessingQueueRef.current = false;
        handleSendMessage(next.content, next.attachment, next.allAttachments);
      }, 100);
    }
  }, [isLoading, messageQueue]);

  // Clear queue when conversation changes
  useEffect(() => {
    setMessageQueue([]);
  }, [conversation?.id]);

  const getModelDisplayName = (modelId: string): string => {
    if (!providers) return modelId;
    for (const provider of Object.values(providers)) {
      const model = provider.models.find((m: any) => m.id === modelId);
      if (model) {
        return `${provider.name} - ${model.name}`;
      }
    }
    return modelId;
  };

  const getModelContextLength = (modelId: string): number => {
    if (!providers) {
      console.log("No providers available yet, using default context length");
      return 128000; // Default to a reasonable value
    }

    console.log("All providers:", providers);
    console.log("Looking for model:", modelId);

    for (const provider of Object.values(providers)) {
      console.log(`Checking provider ${provider.id}:`, provider);
      console.log("Provider models:", provider.models);

      const model = provider.models.find((m: any) => m.id === modelId);
      if (model) {
        console.log(
          `Found model ${model.id} with context length:`,
          model.contextLength,
        );
        return model.contextLength;
      }
    }

    console.log(
      `Model ${modelId} not found in any provider, using default context length`,
    );
    return 128000; // Default fallback value
  };

  const getModelSkipSystemPrompt = (modelId: string): boolean => {
    if (!providers) return false;
    for (const provider of Object.values(providers)) {
      const model = provider.config.models.find((m: any) => m.id === modelId);
      if (model) return model.skipSystemPrompt || false;
    }
    return false;
  };

  const getProviderForModel = (modelId: string): string => {
    if (!providers) return "";
    for (const provider of Object.values(providers)) {
      if (provider.models.some((m: any) => m.id === modelId)) {
        return provider.config.id;
      }
    }
    throw new Error(`No provider found for model: ${modelId}`);
  };

  const currentNsfw = conversation?.isNsfw || pendingNsfw;

  const handleToggleNsfw = async () => {
    if (conversation) {
      try {
        const res = await fetch(`/api/conversations/${conversation.id}/nsfw`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_nsfw: !conversation.isNsfw }),
        });
        if (res.ok) {
          const updated = await res.json();
          onConversationUpdate?.(updated);
          queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
        }
      } catch (error) {
        console.error("Failed to toggle hidden flag:", error);
      }
    } else {
      setPendingNsfw((prev) => !prev);
    }
  };

  const handleSendMessage = async (
    content: string,
    attachment?: {
      type: "document" | "image";
      url: string;
      text?: string;
      name: string;
    },
    allAttachments?: {
      type: "document" | "image";
      url: string;
      text?: string;
      name: string;
    }[],
  ) => {
    // Check if a model is selected
    if (!selectedModel) {
      toast({
        variant: "destructive",
        title: "No model selected",
        description: "Please select a model before sending a message.",
      });
      return;
    }

    // If already loading, queue the message instead of sending immediately
    if (isLoading) {
      const queued: QueuedMessage = {
        id: nanoid(),
        content,
        attachment,
        allAttachments,
      };
      setMessageQueue((prev) => [...prev, queued]);

      // Show the queued user message in the chat immediately
      const queuedUserMessage: MessageType = {
        id: `queued-${queued.id}`,
        role: "user",
        content,
        timestamp: Date.now(),
        attachment,
        attachments: allAttachments,
      };
      setMessages((prev) => [...prev, queuedUserMessage]);
      shouldAutoScrollRef.current = true;
      return true;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const timestamp = Date.now();
    const userMessage: MessageType = {
      id: nanoid(),
      role: "user",
      content,
      timestamp,
      attachment, // This can be undefined or a single attachment
      attachments: allAttachments, // Include all attachments for display
    };

    // Add the message to the UI
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);
    setStreamedText("");
    streamIdRef.current = nanoid();

    // Force auto-scroll on — the useLayoutEffect on messages will scroll after render
    shouldAutoScrollRef.current = true;

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    // Display the attachments being sent in console for debugging
    console.log("Sending message with attachments:", {
      primaryAttachment: attachment,
      allAttachments: allAttachments || [],
    });

    try {
      const providerId = getProviderForModel(selectedModel);
      const response = await fetch(`/api/chat/${providerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          conversationId: conversation?.id,
          context: messages,
          model: selectedModel,
          modelContextLength: getModelContextLength(selectedModel), // Pass context limit from config
          attachment: attachment,
          allAttachments: allAttachments || [], // Send all attachments to be processed together
          useKnowledge: useKnowledge,
          pendingKnowledgeSources: pendingKnowledgeSources,
          skipSystemPrompt: getModelSkipSystemPrompt(selectedModel),
          useTools: useAgenticMode, // Enable tools when using agentic mode
          useAgenticMode: useAgenticMode, // Send agentic mode state to the API
        }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      // The rest of the function deals with handling the successful response
      // Signal to ChatInput that the message was sent successfully
      // This will be handled by returning true at the end of this try block
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const currentStreamId = streamIdRef.current;
      let buffer = "";
      let isStreamActive = true;

      try {
        while (isStreamActive) {
          const { value, done } = await reader.read();

          if (done) {
            isStreamActive = false;
            break;
          }

          // Process the incoming chunk
          const text = decoder.decode(value, { stream: true });
          buffer += text;

          // Process each complete line in the buffer
          const lines = buffer.split("\n");
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

            try {
              const jsonStr = trimmedLine.slice(5).trim();
              if (!jsonStr) continue;

              // Safely parse the JSON data
              let data;
              try {
                data = JSON.parse(jsonStr);
              } catch (parseError) {
                console.error("Error parsing SSE data:", parseError);
                console.debug("Problematic JSON string:", jsonStr);
                continue; // Skip this malformed message and continue processing
              }

              // Only process if this is still the current stream
              if (currentStreamId === streamIdRef.current) {
                switch (data.type) {
                  case "start":
                    setStreamedText("");
                    break;
                  case "chunk":
                    if (typeof data.content === "string") {
                      setStreamedText((prev) => prev + data.content);
                    }
                    break;
                  case "tool_call_progress":
                    if (data.tool_calls) {
                      const toolCallContent = data.tool_calls.map((call: any) => {
                        return `\n\nCalling tool: ${call.function?.name || "Unknown Tool"}\nWith parameters: ${call.function?.arguments || "{}"}`;
                      }).join("");
                      setStreamedText((prev) => prev + toolCallContent);
                    }
                    break;
                  case "tool_execution_start":
                    setStreamedText((prev) => prev + "\n\nExecuting tools...");
                    break;
                  case "tool_execution_complete":
                    if (data.results) {
                      const resultContent = data.results.map((result: any) => {
                        return `\n\nTool: ${result.toolName}\nResult: ${JSON.stringify(result.result, null, 2)}`;
                      }).join("");
                      setStreamedText((prev) => prev + resultContent);
                    }
                    break;
                  case "tool_execution_error":
                    if (data.error) {
                      setStreamedText((prev) => prev + `\n\nTool Execution Error: ${data.error}`);
                    }
                    break;
                  case "end":
                    isStreamActive = false; // Ensure we stop after receiving end event
                    if (onConversationUpdate && data.conversation) {
                      onConversationUpdate(data.conversation);
                    }
                    // If this was a new conversation and pendingNsfw is true, mark it
                    if (pendingNsfw && data.conversation?.id) {
                      fetch(`/api/conversations/${data.conversation.id}/nsfw`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ is_nsfw: true }),
                      }).then(res => {
                        if (res.ok) {
                          res.json().then(updated => {
                            onConversationUpdate?.(updated);
                            queryClient.invalidateQueries({ queryKey: ["/api/conversations"] });
                          });
                        }
                      }).catch(err => console.error("Failed to set hidden flag on new conversation:", err));
                      setPendingNsfw(false);
                    }
                    const updatedMessages = transformMessages(
                      data.conversation,
                    );
                    setMessages(updatedMessages);
                    // Clear streamed text after a brief delay to ensure final message renders first
                    setTimeout(() => setStreamedText(""), 0);
                    queryClient.invalidateQueries({
                      queryKey: ["/api/conversations"],
                    });
                    // useLayoutEffect on messages handles the scroll
                    break;
                  case "error":
                    isStreamActive = false;
                    // Display error as assistant message so user can see it in chat
                    const errorContent = data.error || "An error occurred";
                    const errorMessage: MessageType = {
                      id: `error-${Date.now()}`,
                      role: "assistant",
                      content: errorContent,
                      timestamp: new Date(),
                    };
                    setMessages(prev => [...prev, errorMessage]);
                    setStreamedText("");
                    break;
                }
              }
            } catch (error) {
              console.error("Error processing SSE data:", error);
              isStreamActive = false;
              if (error instanceof Error) {
                // Display parsing errors as toast (these are actual bugs, not user-facing errors)
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: error.message,
                });
              }
            }
          }
        }

        // Handle any remaining buffer data after the stream ends
        if (buffer.trim()) {
          try {
            const trimmedLine = buffer.trim();
            if (trimmedLine.startsWith("data: ")) {
              const jsonStr = trimmedLine.slice(5).trim();
              const data = JSON.parse(jsonStr);
              if (data.type === "chunk" && typeof data.content === "string") {
                setStreamedText((prev) => prev + data.content);
              }
            }
          } catch (error) {
            console.error("Error processing final buffer:", error);
          }
        }

        // Successfully handled the message, return true to signal to ChatInput that it was successful
        return true;
      } catch (error) {
        console.error("Error reading stream:", error);
        throw error;
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Request aborted");
        return false;
      }
      console.error("Error sending message:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to send message. Please try again.",
      });
      // Remove the user message if the request failed
      setMessages((prev) => prev.filter((msg) => msg.id !== userMessage.id));
      return false;
    } finally {
      setIsLoading(false);
      setStreamedText("");
      abortControllerRef.current = undefined;
    }
  };

  const hasMessages = messages.length > 0 || !!streamedText;

  const inputBar = (
    <ChatInput
      onSendMessage={handleSendMessage}
      isLoading={isLoading}
      modelContextLength={getModelContextLength(selectedModel)}
      contextMessages={messages}
      isNsfw={currentNsfw}
      onToggleNsfw={handleToggleNsfw}
      queueSize={messageQueue.length}
      onClearQueue={() => {
        const queuedIds = new Set(messageQueue.map((q) => `queued-${q.id}`));
        setMessages((prev) => prev.filter((m) => !queuedIds.has(m.id)));
        setMessageQueue([]);
      }}
      onAddKnowledge={() => setShowKnowledgeModal(true)}
    />
  );

  // Hamburger menu sheet
  const menuSheet = (
    <Sheet open={showMenuSheet} onOpenChange={setShowMenuSheet}>
      <SheetContent side="left" className="w-[280px] p-0">
        <MainSidebar
          activeConversation={conversation}
          onSelectConversation={(conv) => {
            onSelectConversation?.(conv);
            setShowMenuSheet(false);
          }}
          onNewConversation={() => {
            onNewChat?.();
            setShowMenuSheet(false);
          }}
          isMobile={true}
          onClose={() => setShowMenuSheet(false)}
        />
      </SheetContent>
    </Sheet>
  );

  // History sheet
  const historySheet = (
    <Sheet open={showHistorySheet} onOpenChange={setShowHistorySheet}>
      <SheetContent side="left" className="w-[320px] sm:w-[380px] flex flex-col p-0 gap-0 [&>button]:top-[28px] [&>button]:right-3 [&>button]:-translate-y-1/2">
        <SheetHeader className="sr-only">
          <SheetTitle>Chat History</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden">
          <ConversationList
            activeConversation={conversation}
            onSelectConversation={(conv) => {
              onSelectConversation?.(conv);
              setShowHistorySheet(false);
            }}
            hideNsfw={hideNsfw}
            onToggleHideNsfw={() => {
              const next = !hideNsfw;
              setHideNsfw(next);
              localStorage.setItem("nsfw-visibility", next ? "hide" : "show");
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );

  const knowledgeModal = (
    <KnowledgeModal
      open={showKnowledgeModal}
      onOpenChange={setShowKnowledgeModal}
      conversationId={conversation?.id}
      pendingKnowledgeSources={pendingKnowledgeSources}
      onTogglePendingSource={(sourceId) => {
        if (pendingKnowledgeSources.includes(sourceId)) {
          setPendingKnowledgeSources((prev) => prev.filter((id) => id !== sourceId));
        } else {
          setPendingKnowledgeSources((prev) => [...prev, sourceId]);
        }
      }}
      attachedSourceIds={conversationKnowledgeQuery.data?.map(s => s.id) || []}
    />
  );

  const topBar = (
    <TooltipProvider>
      <div className="flex items-center justify-between px-2 sm:px-4 py-2 sm:py-3 shrink-0 gap-1 min-w-0">
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowMenuSheet(true)}>
            <Menu className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => setShowHistorySheet(true)}>
            <History className="h-5 w-5" />
          </Button>
          {hasMessages && (
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 sm:hidden"
              onClick={onNewChat}
            >
              <Plus className="h-5 w-5" />
            </Button>
          )}
          {hasMessages && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-muted-foreground hidden sm:flex"
              onClick={onNewChat}
            >
              <Plus className="h-4 w-4" />
              New chat
            </Button>
          )}
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 min-w-0">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={(modelId) => setSelectedModel(modelId)}
            disabled={!!conversation || isLoading || isLoadingProviders}
            getModelDisplayName={getModelDisplayName}
          />
          {onToggleMode && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 hidden sm:flex" onClick={onToggleMode}>
                  <Grid3x3 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Multi-model mode</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 relative"
                onClick={() => setUseAgenticMode(!useAgenticMode)}
              >
                <Wrench className="h-4 w-4" />
                {useAgenticMode && (
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{useAgenticMode ? "Agentic mode on" : "Agentic mode off"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );

  // Random greeting for empty state
  const emptyStateGreetings = [
    "Haven't had enough?",
    "What else?",
    "What now?",
    "You again.",
    "Time for another embarrassing question?",
    "Back for more, huh?",
    "Oh, it's you again.",
    "Miss me already?",
    "What trouble are we getting into now?",
    "Couldn't stay away, could you?",
    "Ready to pretend you know what you're doing?",
    "Let's make some questionable decisions.",
  ];
  const [greeting] = useState(() =>
    emptyStateGreetings[Math.floor(Math.random() * emptyStateGreetings.length)]
  );

  // Empty state — no messages yet
  if (!hasMessages) {
    return (
      <div className="flex flex-col h-screen bg-background">
        {topBar}
        <div className="flex-1 flex flex-col items-center pt-[12vh] sm:pt-[18vh] px-3 sm:px-4">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-semibold mb-6 sm:mb-8 text-foreground text-center">
            {greeting}
          </h1>
          <div className="w-full max-w-2xl">
            {inputBar}
          </div>
        </div>
        {menuSheet}
        {historySheet}
        {knowledgeModal}
      </div>
    );
  }

  // Active chat — has messages
  return (
    <div className="flex flex-col h-screen bg-background">
      {topBar}

      <div className="flex-1 overflow-hidden relative">
        <ScrollArea className="h-full w-full">
          <div
            className="max-w-2xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-2"
            ref={containerRef}
          >
            {messages.map((message) => (
              <Message key={message.id} message={message} />
            ))}
            {streamedText && (
              <Message
                key="streaming"
                message={{
                  id: streamIdRef.current,
                  role: "assistant",
                  content: streamedText,
                  timestamp: Date.now(),
                  attachment: undefined,
                  attachments: undefined,
                }}
              />
            )}
            {isLoading && !streamedText && (
              <div className="loading-dots text-muted-foreground py-2">
                <span>.</span><span>.</span><span>.</span>
              </div>
            )}
            <div id="bottom-anchor" className="h-1 w-full" />
          </div>
        </ScrollArea>

        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full p-2 bg-secondary hover:bg-secondary/80 text-foreground z-10 transition-colors"
            style={{ width: "35px", height: "35px" }}
            aria-label="Scroll to bottom"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
        )}
      </div>

      <div className="shrink-0 px-3 sm:px-4 pb-3 sm:pb-4 pt-2" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="max-w-2xl mx-auto">
          {inputBar}
        </div>
      </div>

      {menuSheet}
      {historySheet}
      {knowledgeModal}
    </div>
  );
}
