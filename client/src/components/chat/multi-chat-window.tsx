import { useState, useEffect, useRef } from "react";
import { nanoid } from "nanoid";
import { Message } from "@/components/chat/message";
import { ChatInput } from "@/components/chat/chat-input";
import { MultiModelSelector } from "./multi-model-selector";
import type { Message as MessageType } from "@/lib/llm/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getAllProviders } from "@/lib/llm/providers";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  BookOpen,
  Wrench,
  Grid3x3,
  Minus,
  Copy,
} from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MultiChatWindowProps {
  mobileMenuTrigger?: React.ReactNode;
  onSwitchToSingle?: () => void;
  isMultiModelMode?: boolean;
  onToggleMode?: () => void;
}

interface ModelConversation {
  modelId: string;
  messages: MessageType[];
  isLoading: boolean;
  streamedText: string;
  abortController?: AbortController;
  streamId: string;
}

export function MultiChatWindow({
  mobileMenuTrigger,
  onSwitchToSingle,
  isMultiModelMode = true,
  onToggleMode,
}: MultiChatWindowProps) {
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [conversations, setConversations] = useState<Record<string, ModelConversation>>({});
  const [providers, setProviders] = useState<Record<string, any>>({});
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [useTools, setUseTools] = useState<boolean>(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const containerRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

                 // Set default models if none selected
         if (selectedModels.length === 0) {
           const defaultModels: string[] = [];
           loadedProviders.forEach(provider => {
             const defaultModel = provider.config.models.find((m: any) => m.defaultModel);
             if (defaultModel && defaultModels.length < 2) {
               defaultModels.push(defaultModel.id);
             }
           });
           if (defaultModels.length > 0) {
             setSelectedModels(defaultModels);
           }
         }
      } catch (error) {
        console.error("Failed to load providers:", error);
        setIsLoadingProviders(false);
      }
    }

    loadProviders();
  }, []);

  // Initialize conversations when models change
  useEffect(() => {
    const newConversations: Record<string, ModelConversation> = {};
    
    selectedModels.forEach(modelId => {
      if (conversations[modelId]) {
        // Keep existing conversation
        newConversations[modelId] = conversations[modelId];
      } else {
        // Create new conversation
        newConversations[modelId] = {
          modelId,
          messages: [],
          isLoading: false,
          streamedText: "",
          streamId: "",
        };
      }
    });

    // Cleanup conversations for removed models
    Object.values(conversations).forEach(conv => {
      if (!selectedModels.includes(conv.modelId) && conv.abortController) {
        conv.abortController.abort();
      }
    });

    setConversations(newConversations);
  }, [selectedModels]);

     const getProviderForModel = (modelId: string): string => {
     if (!providers) return "";
     for (const provider of Object.values(providers)) {
       if (provider.config.models.some((m: any) => m.id === modelId)) {
         return provider.config.id;
       }
     }
     throw new Error(`No provider found for model: ${modelId}`);
   };

     const getModelDisplayName = (modelId: string): string => {
     if (!providers) return modelId;
     for (const provider of Object.values(providers)) {
       const model = provider.config.models.find((m: any) => m.id === modelId);
       if (model) {
         return `${provider.config.name} - ${model.name}`;
       }
     }
     return modelId;
   };

     const getModelContextLength = (modelId: string): number => {
     if (!providers) return 128000;
     for (const provider of Object.values(providers)) {
       const model = provider.config.models.find((m: any) => m.id === modelId);
       if (model) {
         return model.contextLength;
       }
     }
     return 128000;
   };

  const scrollToBottom = (modelId: string) => {
    const container = containerRefs.current[modelId];
    if (container) {
      const viewport = container.closest('.relative.h-full')?.querySelector('[data-radix-scroll-area-viewport]');
      if (viewport) {
        viewport.scrollTop = viewport.scrollHeight;
      }
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
    if (selectedModels.length === 0) {
      toast({
        variant: "destructive",
        title: "No models selected",
        description: "Please select at least one model before sending a message.",
      });
      return;
    }

    const timestamp = Date.now();
    const userMessage: MessageType = {
      id: nanoid(),
      role: "user",
      content,
      timestamp,
      attachment,
      attachments: allAttachments,
    };

    // Add message to all conversations and start loading
    const updatedConversations = { ...conversations };
    const streamPromises: Promise<void>[] = [];

    selectedModels.forEach(modelId => {
      if (updatedConversations[modelId]) {
        // Cancel any existing request
        if (updatedConversations[modelId].abortController) {
          updatedConversations[modelId].abortController!.abort();
        }

        updatedConversations[modelId] = {
          ...updatedConversations[modelId],
          messages: [...updatedConversations[modelId].messages, userMessage],
          isLoading: true,
          streamedText: "",
          abortController: new AbortController(),
          streamId: nanoid(),
        };

        // Start streaming for this model
        const promise = startStreamingForModel(
          modelId,
          content,
          updatedConversations[modelId].messages.slice(0, -1), // Don't include the just-added user message
          attachment,
          allAttachments,
          updatedConversations[modelId].abortController!,
          updatedConversations[modelId].streamId
        );
        streamPromises.push(promise);
      }
    });

    setConversations(updatedConversations);

    // Scroll to bottom for all conversations
    selectedModels.forEach(modelId => {
      setTimeout(() => scrollToBottom(modelId), 0);
    });

    // Wait for all streams to complete
    try {
      await Promise.allSettled(streamPromises);
    } catch (error) {
      console.error("Error in multi-model streaming:", error);
    }

    return true;
  };

  const startStreamingForModel = async (
    modelId: string,
    content: string,
    context: MessageType[],
    attachment?: any,
    allAttachments?: any[],
    abortController?: AbortController,
    streamId?: string
  ): Promise<void> => {
    try {
      const providerId = getProviderForModel(modelId);
      const response = await fetch(`/api/chat/${providerId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          context,
          model: modelId,
          attachment,
          allAttachments: allAttachments || [],
          useKnowledge: true,
          pendingKnowledgeSources: [],
          useTools,
        }),
        signal: abortController?.signal,
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error("No response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let isStreamActive = true;

      while (isStreamActive) {
        const { value, done } = await reader.read();

        if (done) {
          isStreamActive = false;
          break;
        }

        const text = decoder.decode(value, { stream: true });
        buffer += text;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

          try {
            const jsonStr = trimmedLine.slice(5).trim();
            if (!jsonStr) continue;

            const data = JSON.parse(jsonStr);

            // Only process if this is still the current stream
            setConversations(prev => {
              const current = prev[modelId];
              if (!current || current.streamId !== streamId) {
                return prev;
              }

              switch (data.type) {
                case "start":
                  return {
                    ...prev,
                    [modelId]: {
                      ...current,
                      streamedText: "",
                    }
                  };
                case "chunk":
                  if (typeof data.content === "string") {
                    return {
                      ...prev,
                      [modelId]: {
                        ...current,
                        streamedText: current.streamedText + data.content,
                      }
                    };
                  }
                  break;
                case "end":
                  isStreamActive = false;
                  if (data.conversation) {
                    // Extract messages from the conversation data
                    const newMessages = data.conversation.messages
                      .map((msg: any) => ({
                        id: msg.id.toString(),
                        role: msg.role,
                        content: msg.content,
                        timestamp: new Date(msg.created_at).getTime(),
                      }))
                      .sort((a: any, b: any) => a.timestamp - b.timestamp);
                    
                    return {
                      ...prev,
                      [modelId]: {
                        ...current,
                        messages: newMessages,
                        isLoading: false,
                        streamedText: "",
                        abortController: undefined,
                      }
                    };
                  }
                  break;
                case "error":
                  throw new Error(data.error);
              }

              return prev;
            });

            // Auto-scroll
            setTimeout(() => scrollToBottom(modelId), 0);
          } catch (error) {
            console.error("Error processing SSE data:", error);
            isStreamActive = false;
            setConversations(prev => ({
              ...prev,
              [modelId]: {
                ...prev[modelId],
                isLoading: false,
                streamedText: "",
                abortController: undefined,
              }
            }));
          }
        }
      }

      reader.releaseLock();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`Request aborted for model ${modelId}`);
        return;
      }
      
      console.error(`Error streaming for model ${modelId}:`, error);
      toast({
        variant: "destructive",
        title: `Error with ${getModelDisplayName(modelId)}`,
        description: error instanceof Error ? error.message : "Failed to get response",
      });

      setConversations(prev => ({
        ...prev,
        [modelId]: {
          ...prev[modelId],
          isLoading: false,
          streamedText: "",
          abortController: undefined,
        }
      }));
    }
  };

  const copyResponse = (modelId: string) => {
    const conversation = conversations[modelId];
    if (conversation) {
      const lastAssistantMessage = conversation.messages
        .filter(m => m.role === "assistant")
        .pop();
      
      if (lastAssistantMessage) {
        navigator.clipboard.writeText(lastAssistantMessage.content);
        toast({
          title: "Copied to clipboard",
          description: `Response from ${getModelDisplayName(modelId)} copied.`,
        });
      }
    }
  };

  const anyModelLoading = Object.values(conversations).some(conv => conv.isLoading);
  const minContextLength = selectedModels.length > 0 
    ? Math.min(...selectedModels.map(getModelContextLength))
    : 128000;

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          {mobileMenuTrigger}
          <h2 className="font-semibold text-base md:text-lg hidden md:block">
            Multi-Model Chat
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <MultiModelSelector
            selectedModels={selectedModels}
            onModelChange={setSelectedModels}
            disabled={anyModelLoading || isLoadingProviders}
          />
          <TooltipProvider>
            {/* Single-model mode toggle */}
            {onToggleMode && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={onToggleMode}
                    aria-label="Switch to single model mode"
                  >
                    <Minus className="h-[1.2rem] w-[1.2rem]" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  Switch to single model mode
                </TooltipContent>
              </Tooltip>
            )}
            {/* Tools toggle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0 relative"
                  onClick={() => setUseTools(!useTools)}
                  aria-label="Toggle tool calling"
                >
                  <Wrench className="h-[1.2rem] w-[1.2rem]" />
                  {useTools && (
                    <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-green-500 animate-pulse shadow-sm"></span>
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {useTools ? "Tool calling enabled" : "Tool calling disabled"}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        {selectedModels.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Grid3x3 className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Select Models to Start</h3>
              <p className="text-muted-foreground">
                Choose multiple models to compare their responses side by side.
              </p>
            </div>
          </div>
        ) : (
          <ResizablePanelGroup direction="vertical" className="flex-1">
            {/* Chat grid */}
            <ResizablePanel defaultSize={75} minSize={30}>
              <div className="h-full">
                {selectedModels.length === 1 ? (
                  // Single column for one model
                  <div className="h-full">
                    {renderModelChat(selectedModels[0])}
                  </div>
                ) : (
                  // Grid for multiple models
                  <div 
                    className="h-full grid gap-2 p-2"
                    style={{
                      gridTemplateColumns: selectedModels.length === 2 
                        ? "1fr 1fr" 
                        : selectedModels.length === 3 
                        ? "1fr 1fr 1fr" 
                        : "repeat(auto-fit, minmax(300px, 1fr))"
                    }}
                  >
                    {selectedModels.map(modelId => (
                      <div key={modelId} className="min-h-0">
                        {renderModelChat(modelId)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Input area */}
            <ResizablePanel defaultSize={25} minSize={15}>
              <div className="p-4 h-full border-t">
                <ChatInput
                  onSendMessage={handleSendMessage}
                  isLoading={anyModelLoading}
                  modelContextLength={minContextLength}
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </div>
  );

  function renderModelChat(modelId: string) {
    const conversation = conversations[modelId];
    if (!conversation) return null;

    return (
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <span className="truncate" title={getModelDisplayName(modelId)}>
              {getModelDisplayName(modelId)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyResponse(modelId)}
              className="h-6 w-6 p-0 opacity-60 hover:opacity-100"
              title="Copy last response"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 p-2 min-h-0">
          <div className="relative h-full">
            <ScrollArea className="h-full w-full">
              <div
                className="p-2 space-y-4 max-w-full overflow-x-hidden"
                ref={(el) => containerRefs.current[modelId] = el}
              >
                {conversation.messages.map((message) => (
                  <Message key={message.id} message={message} />
                ))}
                {conversation.streamedText && (
                  <Message
                    message={{
                      id: "streaming-" + modelId,
                      role: "assistant",
                      content: conversation.streamedText,
                      timestamp: Date.now(),
                      attachment: undefined,
                      attachments: undefined,
                    }}
                  />
                )}
                {conversation.isLoading && !conversation.streamedText && (
                  <div className="animate-pulse text-sm text-muted-foreground">
                    Thinking...
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    );
  }
} 