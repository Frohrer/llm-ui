import { useState, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid';
import { Message } from '@/components/chat/message';
import { ChatInput } from '@/components/chat/chat-input';
import { ModelSelector } from './model-selector';
import type { Message as MessageType, Conversation } from '@/lib/llm/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { useProviders } from '@/lib/llm/providers';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { Volume2, VolumeX } from 'lucide-react';
import { speechService } from '@/lib/speech-service';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';

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

  const { data: providers, isLoading: isLoadingProviders } = useProviders();
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

  useEffect(() => {
    const sortedMessages = transformMessages(conversation);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (conversation) {
      return conversation.model;
    }
    if (providers) {
      for (const provider of Object.values(providers)) {
        const defaultModel = provider.models.find(m => m.defaultModel);
        if (defaultModel) return defaultModel.id;
      }
      const firstProvider = Object.values(providers)[0];
      if (firstProvider) return firstProvider.models[0].id;
    }
    return '';
  });

  const isNearBottom = () => {
    const container = containerRef.current;
    if (!container) return true;
    const threshold = 100;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    return distanceFromBottom <= threshold;
  };

  const scrollToBottom = () => {
    const container = containerRef.current;
    if (shouldAutoScroll && container) {
      container.scrollTop = container.scrollHeight;
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setShouldAutoScroll(isNearBottom());
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

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
    if (!providers) return 128000; // Default to a reasonable value
    for (const provider of Object.values(providers)) {
      const model = provider.models.find(m => m.id === modelId);
      if (model) {
        return model.contextLength;
      }
    }
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

  const handleSendMessage = async (content: string, attachment?: {
    type: 'document' | 'image';
    url: string;
    text?: string;
    name: string;
  }) => {
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
      attachment
    };

    // Add the message to the UI
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamedText('');
    streamIdRef.current = nanoid();
    setShouldAutoScroll(isNearBottom());

    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();

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
          attachment: userMessage.attachment
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
        <div className="flex items-center gap-4">
          <ModelSelector
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            disabled={!!conversation || isLoading || isLoadingProviders}
            getModelDisplayName={getModelDisplayName}
          />
          <ThemeToggle />
        </div>
      </div>
      
      <ResizablePanelGroup direction="vertical" className="flex-1">
        {/* Messages area */}
        <ResizablePanel defaultSize={75} minSize={30}>
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
                    attachment: undefined
                  }}
                />
              )}
              {isLoading && !streamedText && (
                <div className="animate-pulse">Thinking...</div>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>
        
        {/* Resizable handle with visible grip */}
        <ResizableHandle withHandle />
        
        {/* Input area */}
        <ResizablePanel defaultSize={25} minSize={15}>
          <div className="p-4 h-full border-t">
            <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}