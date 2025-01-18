import { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { Message } from './message';
import { ChatInput } from './chat-input';
import { ModelSelector } from './model-selector';
import type { Message as MessageType, LLMProvider, Conversation } from '@/lib/llm/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { getAllProviders } from '@/lib/llm/providers';

interface ChatWindowProps {
  provider: LLMProvider;
  conversation?: Conversation;
  onConversationUpdate?: (conversation: Conversation) => void;
}

export function ChatWindow({ provider, conversation, onConversationUpdate }: ChatWindowProps) {
  // Transform database messages to frontend message format
  const transformMessages = (conv?: Conversation): MessageType[] => {
    if (!conv) return [];
    return conv.messages.map(msg => ({
      id: msg.id.toString(),
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.created_at).getTime()
    }));
  };

  const [messages, setMessages] = useState<MessageType[]>(transformMessages(conversation));
  const [isLoading, setIsLoading] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (conversation) {
      return conversation.model;
    }
    return provider.models.find(m => m.defaultModel)?.id || provider.models[0].id;
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Helper function to find model display name across all providers
  const getModelDisplayName = (modelId: string): string => {
    for (const p of getAllProviders()) {
      const model = p.models.find(m => m.id === modelId);
      if (model) {
        return model.name;
      }
    }
    return modelId; // Fallback to ID if model not found
  };

  // Update messages when conversation changes
  useEffect(() => {
    setMessages(transformMessages(conversation));
    if (conversation) {
      setSelectedModel(conversation.model);
    }
  }, [conversation]);

  // Update selected model when provider changes
  useEffect(() => {
    if (!conversation) {
      setSelectedModel(provider.models.find(m => m.defaultModel)?.id || provider.models[0].id);
    }
  }, [provider]);

  const handleSendMessage = async (content: string) => {
    const userMessage: MessageType = {
      id: nanoid(),
      role: 'user',
      content,
      timestamp: Date.now()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await fetch(`/api/chat/${provider.id}`, {
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

      const assistantMessage: MessageType = {
        id: nanoid(),
        role: 'assistant',
        content: data.response,
        timestamp: Date.now()
      };

      if (onConversationUpdate && data.conversation) {
        onConversationUpdate(data.conversation);
      }

      setMessages(transformMessages(data.conversation));

      // Invalidate conversations query to refresh the list
      queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
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
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <div className="p-4 border-b flex items-center justify-between">
        <h2 className="font-semibold">{conversation?.title || 'New Conversation'}</h2>
        <ModelSelector
          models={provider.models}
          selectedModel={selectedModel}
          onModelChange={setSelectedModel}
          disabled={!!conversation || isLoading}
          getModelDisplayName={getModelDisplayName}
        />
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