import { useState, useEffect } from 'react';
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
      .sort((a, b) => a.timestamp - b.timestamp); // Ensure messages are sorted by timestamp
  };

  const [messages, setMessages] = useState<MessageType[]>(transformMessages(conversation));
  const [isLoading, setIsLoading] = useState(false);
  const { data: providers, isLoading: isLoadingProviders } = useProviders();
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (conversation) {
      return conversation.model;
    }
    // Find the first default model from any provider
    if (providers) {
      for (const provider of Object.values(providers)) {
        const defaultModel = provider.models.find(m => m.defaultModel);
        if (defaultModel) return defaultModel.id;
      }
      // Fallback to first model of first provider
      const firstProvider = Object.values(providers)[0];
      if (firstProvider) return firstProvider.models[0].id;
    }
    return '';
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const sortedMessages = transformMessages(conversation);
    setMessages(sortedMessages);
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);

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

    setMessages(prev => [...prev, userMessage].sort((a, b) => a.timestamp - b.timestamp));
    setIsLoading(true);

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
        const errorData = await response.text();
        console.error(`API Error: ${response.status} - ${errorData}`);
        throw new Error(`Failed to send message: ${errorData}`);
      }

      const data = await response.json();

      if (!data.response) {
        throw new Error('No response received from the server');
      }

      if (onConversationUpdate && data.conversation) {
        onConversationUpdate(data.conversation);
      }

      // Transform and sort messages again to ensure proper order
      const updatedMessages = transformMessages(data.conversation);
      setMessages(updatedMessages);
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
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
          {messages.map(message => (
            <Message key={message.id} message={message} />
          ))}
          {isLoading && <div className="animate-pulse">Thinking...</div>}
        </ScrollArea>
      </div>
      <div className="p-4 border-t">
        <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
      </div>
    </div>
  );
}