import { useState, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { Message } from '@/components/chat/message';
import { ChatInput } from '@/components/chat/chat-input';
import { ModelSelector } from './model-selector';
import type { Message as MessageType, Conversation } from '@/lib/llm/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getAllProviders } from '@/lib/llm/providers';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX, ChevronDown, BookOpen, X, Database } from 'lucide-react';
import { speechService } from '@/lib/speech-service';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { ConversationKnowledge } from '@/components/knowledge';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { KnowledgeSourceList } from '@/components/knowledge/knowledge-source-list';

interface ChatWindowProps {
  conversation?: Conversation;
  onConversationUpdate?: (conversation: Conversation) => void;
  mobileMenuTrigger?: React.ReactNode;
}

export function ChatWindow({ conversation, onConversationUpdate, mobileMenuTrigger }: ChatWindowProps) {
  const transformMessages = (conv?: Conversation): MessageType[] => {
    if (!conv) return [];
    return conv.messages
      .map(msg => ({
        id: msg.id.toString(),
        role: msg.role,
        content: msg.content,
        timestamp: new Date(msg.created_at).getTime()
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  };

  const [messages, setMessages] = useState<MessageType[]>(transformMessages(conversation));
  const [isLoading, setIsLoading] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const streamIdRef = useRef<string>('');
  const abortControllerRef = useRef<AbortController>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);


  const [providers, setProviders] = useState<Record<string, any>>({});
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  
  // Load providers on component mount
  useEffect(() => {
    async function loadProviders() {
      try {
        const loadedProviders = await getAllProviders();
        const providersMap = loadedProviders.reduce((acc, provider) => {
          acc[provider.id] = provider;
          return acc;
        }, {} as Record<string, any>);
        setProviders(providersMap);
        setIsLoadingProviders(false);
      } catch (error) {
        console.error('Failed to load providers:', error);
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
        const response = await fetch('/api/user');
        if (!response.ok) {
          // If we get a 401, we need to refresh the page to trigger re-auth
          if (response.status === 401) {
            toast({
              title: "Session expired",
              description: "Please refresh the page to continue.",
              variant: "destructive"
            });
          } else {
            // For other errors, just show a general error message
            toast({
              title: "Connection error",
              description: "Unable to connect to server. Please check your connection.",
              variant: "destructive"
            });
          }
        } else {
          // If connection is successful, refresh all queries to get latest data
          await queryClient.invalidateQueries();
        }
      } catch (error) {
        toast({
          title: "Connection error",
          description: "Unable to connect to server. Please check your connection.",
          variant: "destructive"
        });
      }
    };

    // Add focus event listener
    const handleFocus = () => {
      checkServerStatus();
    };

    window.addEventListener('focus', handleFocus);

    // Cleanup
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, [queryClient, toast]);

  const [selectedModel, setSelectedModel] = useState<string>('');
  // Knowledge is always enabled now, but keeping for API compatibility
  const useKnowledge = true;
  const [showKnowledgePanel, setShowKnowledgePanel] = useState<boolean>(false);
  const [pendingKnowledgeSources, setPendingKnowledgeSources] = useState<number[]>([]);
  
  // Update messages when conversation changes
  useEffect(() => {
    const sortedMessages = transformMessages(conversation);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);
  
  // Set default model when providers are loaded
  useEffect(() => {
    if (!providers || selectedModel || conversation) {
      return;
    }
      
    // Find the first default model
    for (const provider of Object.values(providers)) {
      const defaultModel = provider.models.find(m => m.defaultModel);
      if (defaultModel) {
        console.log('Setting default model:', defaultModel.id);
        setSelectedModel(defaultModel.id);
        return;
      }
    }
    
    // If no default model is found, use the first available model
    const firstProvider = Object.values(providers)[0];
    if (firstProvider && firstProvider.models.length > 0) {
      console.log('Setting first available model:', firstProvider.models[0].id);
      setSelectedModel(firstProvider.models[0].id);
    }
  }, [providers, selectedModel, conversation]);

  const isNearBottom = () => {
    // Check scroll position in the ScrollArea viewport element
    const viewport = document.querySelector('.scrollarea-viewport');
    if (!viewport) return true;
    
    const threshold = 100;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distanceFromBottom <= threshold;
  };

  const scrollToBottom = () => {
    // This is a very direct approach that will work in all browsers
    window.scrollTo(0, document.body.scrollHeight);
    
    // Also try to find any messages and scroll the last one into view
    const messagesContainer = document.querySelector('.p-4.space-y-4');
    if (messagesContainer && messagesContainer.children.length > 0) {
      const lastMessage = messagesContainer.children[messagesContainer.children.length - 1];
      if (lastMessage) {
        try {
          lastMessage.scrollIntoView({ behavior: 'smooth' });
        } catch (e) {
          console.error('Error using scrollIntoView:', e);
        }
      }
    }
    
    setShouldAutoScroll(true);
    setShowScrollButton(false);
  };

  useEffect(() => {
    // Add scroll event listener to the viewport
    const viewport = document.querySelector('.scrollarea-viewport');
    
    if (!viewport) return;
    
    // Force show the scroll button initially if we have messages and we're not at the bottom
    if (messages.length > 0) {
      const isAtBottom = isNearBottom();
      setShowScrollButton(!isAtBottom);
    }

    const handleScroll = () => {
      const isBottom = isNearBottom();
      setShouldAutoScroll(isBottom);
      setShowScrollButton(!isBottom);
    };

    // Use both viewport scroll events and mutations for detecting scroll position
    viewport.addEventListener('scroll', handleScroll);
    
    // Create mutation observer to watch for content changes that might affect scroll position
    const mutationObserver = new MutationObserver(() => {
      handleScroll();
    });
    
    // Watch for changes to the message container
    const messageContainer = document.querySelector('.scrollarea-viewport-view');
    if (messageContainer) {
      mutationObserver.observe(messageContainer, { 
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    
    // Initial check
    handleScroll();
    
    return () => {
      viewport.removeEventListener('scroll', handleScroll);
      mutationObserver.disconnect();
    };
  }, [messages.length]);

  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, streamedText, shouldAutoScroll]);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const getModelDisplayName = (modelId: string): string => {
    if (!providers) return modelId;
    for (const provider of Object.values(providers)) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        return `${provider.name} - ${model.name}`;
      }
    }
    return modelId;
  };
  
  const getModelContextLength = (modelId: string): number => {
    if (!providers) {
      console.log('No providers available yet, using default context length');
      return 128000; // Default to a reasonable value
    }
    
    console.log('All providers:', providers);
    console.log('Looking for model:', modelId);
    
    for (const provider of Object.values(providers)) {
      console.log(`Checking provider ${provider.id}:`, provider);
      console.log('Provider models:', provider.models);
      
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        console.log(`Found model ${model.id} with context length:`, model.contextLength);
        return model.contextLength;
      }
    }
    
    console.log(`Model ${modelId} not found in any provider, using default context length`);
    return 128000; // Default fallback value
  };

  const getProviderForModel = (modelId: string): string => {
    if (!providers) return '';
    for (const provider of Object.values(providers)) {
      if (provider.models.some(m => m.id === modelId)) {
        return provider.id;
      }
    }
    throw new Error(`No provider found for model: ${modelId}`);
  };

  const handleSendMessage = async (
    content: string, 
    attachment?: {
      type: 'document' | 'image';
      url: string;
      text?: string;
      name: string;
    },
    allAttachments?: {
      type: 'document' | 'image';
      url: string;
      text?: string;
      name: string;
    }[]
  ) => {
    // Check if a model is selected
    if (!selectedModel) {
      toast({
        variant: "destructive",
        title: "No model selected",
        description: "Please select a model before sending a message."
      });
      return;
    }

    // Cancel any existing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const timestamp = Date.now();
    const userMessage: MessageType = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp,
      attachment, // This can be undefined or a single attachment
      attachments: allAttachments // Include all attachments for display
    };

    // Add the message to the UI
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamedText('');
    streamIdRef.current = nanoid();
    setShouldAutoScroll(isNearBottom());

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

    // Display the attachments being sent in console for debugging
    console.log('Sending message with attachments:', {
      primaryAttachment: attachment,
      allAttachments: allAttachments || []
    });

    try {
      const providerId = getProviderForModel(selectedModel);
      const response = await fetch(`/api/chat/${providerId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: content,
          conversationId: conversation?.id,
          context: messages,
          model: selectedModel,
          attachment: attachment,
          allAttachments: allAttachments || [], // Send all attachments to be processed together
          useKnowledge: useKnowledge
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error('No response body received');
      }

      // The rest of the function deals with handling the successful response
      // Signal to ChatInput that the message was sent successfully
      // This will be handled by returning true at the end of this try block
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const currentStreamId = streamIdRef.current;
      let buffer = '';
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
          const lines = buffer.split('\n');
          // Keep the last potentially incomplete line in the buffer
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || !trimmedLine.startsWith('data: ')) continue;

            try {
              const jsonStr = trimmedLine.slice(5).trim();
              if (!jsonStr) continue;

              // Safely parse the JSON data
              let data;
              try {
                data = JSON.parse(jsonStr);
              } catch (parseError) {
                console.error('Error parsing SSE data:', parseError);
                console.debug('Problematic JSON string:', jsonStr);
                continue; // Skip this malformed message and continue processing
              }

              // Only process if this is still the current stream
              if (currentStreamId === streamIdRef.current) {
                switch (data.type) {
                  case 'start':
                    setStreamedText('');
                    break;
                  case 'chunk':
                    if (typeof data.content === 'string') {
                      setStreamedText(prev => {
                        const newText = prev + data.content;
                        // Force scroll to bottom on new content
                        if (shouldAutoScroll) {
                          setTimeout(scrollToBottom, 0);
                        }
                        return newText;
                      });
                    }
                    break;
                  case 'end':
                    isStreamActive = false; // Ensure we stop after receiving end event
                    if (onConversationUpdate && data.conversation) {
                      onConversationUpdate(data.conversation);
                    }
                    setStreamedText('');
                    const updatedMessages = transformMessages(data.conversation);
                    setMessages(updatedMessages);
                    queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
                    break;
                  case 'error':
                    throw new Error(data.error);
                }
              }
            } catch (error) {
              console.error('Error processing SSE data:', error);
              isStreamActive = false;
              if (error instanceof Error) {
                toast({
                  variant: "destructive",
                  title: "Error",
                  description: error.message
                });
              }
            }
          }
        }

        // Handle any remaining buffer data after the stream ends
        if (buffer.trim()) {
          try {
            const trimmedLine = buffer.trim();
            if (trimmedLine.startsWith('data: ')) {
              const jsonStr = trimmedLine.slice(5).trim();
              const data = JSON.parse(jsonStr);
              if (data.type === 'chunk' && typeof data.content === 'string') {
                setStreamedText(prev => prev + data.content);
              }
            }
          } catch (error) {
            console.error('Error processing final buffer:', error);
          }
        }

        // Successfully handled the message, return true to signal to ChatInput that it was successful
        return true;
      } catch (error) {
        console.error('Error reading stream:', error);
        throw error;
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Request aborted');
        return false;
      }
      console.error('Error sending message:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message. Please try again."
      });
      // Remove the user message if the request failed
      setMessages(prev => prev.filter(msg => msg.id !== userMessage.id));
      return false;
    } finally {
      setIsLoading(false);
      setStreamedText('');
      abortControllerRef.current = undefined;
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          {mobileMenuTrigger}
          <h2 className="font-semibold text-base md:text-lg">{conversation?.title || 'New Conversation'}</h2>
        </div>
        <div className="flex items-center gap-2">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={(modelId) => {
              console.log(`Model changed to: ${modelId}`);
              setSelectedModel(modelId);
              
              // Log the context length of the newly selected model
              if (providers) {
                for (const provider of Object.values(providers)) {
                  const model = provider.models.find(m => m.id === modelId);
                  if (model) {
                    console.log(`Selected model ${model.name} with context length: ${model.contextLength}`);
                    break;
                  }
                }
              }
            }}
            disabled={!!conversation || isLoading || isLoadingProviders}
            getModelDisplayName={getModelDisplayName}
          />
          <Button
            variant="outline"
            size="icon"
            className={`shrink-0 ${showKnowledgePanel ? "border-primary" : ""}`}
            onClick={() => setShowKnowledgePanel(!showKnowledgePanel)}
            title="Knowledge panel"
          >
            <BookOpen className="h-[1.2rem] w-[1.2rem]" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
      
      <div className="flex-1 flex">
        {/* Main chat area */}
        <ResizablePanelGroup direction="vertical" className="flex-1">
          {/* Messages area */}
          <ResizablePanel defaultSize={75} minSize={30}>
            <div className="relative h-full">
              <ScrollArea className="h-full">
                <div
                  className="p-4 space-y-4"
                  ref={containerRef}
                  style={{ overflow: 'auto' }}
                >
                  {messages.map(message => (
                    <Message key={message.id} message={message} />
                  ))}
                  {streamedText && (
                    <Message
                      message={{
                        id: 'streaming',
                        role: 'assistant',
                        content: streamedText,
                        timestamp: Date.now(),
                        // Explicitly passing undefined to prevent attachment handling during streaming
                        attachment: undefined,
                        attachments: undefined
                      }}
                    />
                  )}
                  {isLoading && !streamedText && (
                    <div className="animate-pulse">Thinking...</div>
                  )}
                  
                  {/* Hidden anchor for scroll functionality */}
                  <div id="bottom-anchor" className="h-1 w-full"></div>
                </div>
              </ScrollArea>
              
              {/* Scroll to bottom button - fixed position outside ScrollArea, always visible */}
              <a href="#bottom-anchor" className="absolute bottom-4 right-4 rounded-full p-2 shadow-md bg-primary hover:bg-primary/90 text-primary-foreground z-10 transition-all duration-200 hover:shadow-lg hover:scale-110 hover:translate-y-[-2px] flex items-center justify-center" style={{ width: "35px", height: "35px" }}>
                <ChevronDown className="h-5 w-5" />
              </a>
            </div>
          </ResizablePanel>
          
          {/* Resizable handle with visible grip */}
          <ResizableHandle withHandle />
          
          {/* Input area */}
          <ResizablePanel defaultSize={25} minSize={15}>
            <div className="p-4 h-full border-t">
              <ChatInput 
                onSendMessage={handleSendMessage} 
                isLoading={isLoading} 
                modelContextLength={getModelContextLength(selectedModel)}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        {/* Knowledge panel - shown as a sheet on mobile and as a sidebar on desktop */}
        <>
          {/* Mobile view - show as a sheet */}
          <div className="md:hidden">
            <Sheet open={showKnowledgePanel} onOpenChange={setShowKnowledgePanel}>
              <SheetContent side="right" className="w-[300px] sm:w-[400px] md:hidden">
                <SheetHeader>
                  <div className="flex items-center justify-between">
                    <SheetTitle>Conversation Knowledge</SheetTitle>
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      onClick={() => setShowKnowledgePanel(false)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </SheetHeader>
                <div className="py-4">
                  {conversation ? (
                    <ConversationKnowledge conversationId={conversation.id} />
                  ) : (
                    <KnowledgeSourceList 
                      showAttachButton={true} 
                      onSelectKnowledgeSource={(source) => {
                        if (pendingKnowledgeSources.includes(source.id)) {
                          setPendingKnowledgeSources(prev => prev.filter(id => id !== source.id));
                        } else {
                          setPendingKnowledgeSources(prev => [...prev, source.id]);
                        }
                      }}
                      selectedSourceIds={pendingKnowledgeSources}
                    />
                  )}
                </div>
              </SheetContent>
            </Sheet>
          </div>

          {/* Desktop view - show as a sidebar */}
          {showKnowledgePanel && (
            <div className="hidden md:block border-l w-[300px] overflow-auto">
              <div className="p-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Conversation Knowledge</h3>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    onClick={() => setShowKnowledgePanel(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {conversation ? (
                  <ConversationKnowledge conversationId={conversation.id} />
                ) : (
                  <KnowledgeSourceList 
                    showAttachButton={true}
                    onSelectKnowledgeSource={(source) => {
                      if (pendingKnowledgeSources.includes(source.id)) {
                        setPendingKnowledgeSources(prev => prev.filter(id => id !== source.id));
                      } else {
                        setPendingKnowledgeSources(prev => [...prev, source.id]);
                      }
                    }}
                    selectedSourceIds={pendingKnowledgeSources}
                  />
                )}
              </div>
            </div>
          )}
        </>
      </div>
    </div>
  );
}