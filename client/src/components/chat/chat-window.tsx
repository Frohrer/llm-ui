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
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sortedMessages = transformMessages(conversation);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Scroll to bottom when new messages arrive or when streaming text updates
  useEffect(() => {
    scrollToBottom();
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

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const currentStreamId = streamIdRef.current;
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

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
                      setStreamedText(prev => prev + data.content);
                    }
                    break;
                  case 'end':
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
      // Remove the user message if the request failed
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
        <ScrollArea className="h-full p-4">
          <div className="space-y-4">
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
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>
      </div>
      <div className="p-4 border-t">
        <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
}