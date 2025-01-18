import { useState, useEffect } from 'react';
import { nanoid } from 'nanoid';
import { Message } from './message';
import { ChatInput } from './chat-input';
import type { Message as MessageType, LLMProvider, Conversation } from '@/lib/llm/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';

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
  const { toast } = useToast();

  // Update messages when conversation changes
  useEffect(() => {
    setMessages(transformMessages(conversation));
  }, [conversation]);

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
          model: provider.models.find(m => m.defaultModel)?.id
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