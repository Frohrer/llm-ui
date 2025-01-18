import { useState } from 'react';
import { nanoid } from 'nanoid';
import { Message } from './message';
import { ChatInput } from './chat-input';
import type { Message as MessageType, LLMProvider, Conversation } from '@/lib/llm/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useMutation } from '@tanstack/react-query';


interface ChatWindowProps {
  provider: LLMProvider;
  conversation?: Conversation;
  onConversationUpdate?: (conversation: Conversation) => void;
}

export function ChatWindow({ provider, conversation, onConversationUpdate }: ChatWindowProps) {
  const [messages, setMessages] = useState<MessageType[]>(conversation?.messages || []);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

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
      // Pass the entire conversation history as context
      const response = await provider.sendMessage(
        content,
        conversation?.id,
        [...messages, userMessage] // Include the current message in context
      );

      const assistantMessage: MessageType = {
        id: nanoid(),
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      };

      const updatedMessages = [...messages, userMessage, assistantMessage];
      setMessages(updatedMessages);

      // Update the parent component with new conversation state if callback exists
      if (onConversationUpdate && conversation) {
        onConversationUpdate({
          ...conversation,
          messages: updatedMessages,
          lastMessageAt: new Date().toISOString()
        });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to send message. Please try again."
      });
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