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

interface ChatWindowProps {
  conversation?: Conversation;
  onConversationUpdate?: (conversation: Conversation) => void;
}

export function ChatWindow({ conversation, onConversationUpdate }: ChatWindowProps) {
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
  const { data: providers, isLoading: isLoadingProviders } = useProviders();
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

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sortedMessages = transformMessages(conversation);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);

  useEffect(() => {
    // Scroll to bottom when new messages arrive or when streaming
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [messages, streamedText]);

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

  const getProviderForModel = (modelId: string): string => {
    if (!providers) return '';
    for (const provider of Object.values(providers)) {
      if (provider.models.some(m => m.id === modelId)) {
        return provider.id;
      }
    }
    throw new Error(`No provider found for model: ${modelId}`);
  };

  const handleSendMessage = async (content: string) => {
    const timestamp = Date.now();
    const userMessage: MessageType = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setStreamedText('');
    streamIdRef.current = nanoid();

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
          model: selectedModel
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error('No response body received');
      }

      // Handle server-sent events
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const currentStreamId = streamIdRef.current;

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          // Process the received chunks
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(5));

                // Only process events if the stream hasn't been superseded
                if (currentStreamId === streamIdRef.current) {
                  switch (data.type) {
                    case 'start':
                      // Reset streamed text when starting a new response
                      setStreamedText('');
                      break;

                    case 'chunk':
                      setStreamedText(prev => prev + data.content);
                      break;

                    case 'end':
                      // Update the full conversation state
                      if (onConversationUpdate && data.conversation) {
                        onConversationUpdate(data.conversation);
                      }
                      setStreamedText('');
                      // Transform and sort messages again to ensure proper order
                      const updatedMessages = transformMessages(data.conversation);
                      setMessages(updatedMessages);
                      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
                      break;

                    case 'error':
                      throw new Error(data.error);
                  }
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e);
              }
            }
          }
        }
      } catch (error) {
        console.error('Error reading stream:', error);
        throw error;
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to send message. Please try again."
      });
      setMessages(prev => prev.filter(msg => msg.id !== userMessage.id));
    } finally {
      setIsLoading(false);
      setStreamedText('');
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="font-semibold">{conversation?.title || 'New Conversation'}</h2>
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
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full p-4" ref={scrollAreaRef}>
          {messages.map(message => (
            <Message key={message.id} message={message} />
          ))}
          {streamedText && (
            <Message
              message={{
                id: 'streaming',
                role: 'assistant',
                content: streamedText,
                timestamp: Date.now()
              }}
            />
          )}
          {isLoading && !streamedText && (
            <div className="animate-pulse">Thinking...</div>
          )}
        </ScrollArea>
      </div>
      <div className="p-4 border-t">
        <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
}