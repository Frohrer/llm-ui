import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Mic, MicOff, SendHorizonal } from 'lucide-react';
import { useSpeech } from '@/hooks/use-speech';

interface ChatInputProps {
  onSendMessage: (message: string) => Promise<boolean | void>;
  isLoading: boolean;
}

export function ChatInput({ onSendMessage, isLoading }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const { isListening, startListening, stopListening } = useSpeech();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      const success = await onSendMessage(message);
      if (success) {
        setMessage('');
      }
    }
  };

  const handleSpeechStart = async () => {
    try {
      await startListening((text) => {
        setMessage((prev) => prev + ' ' + text);
      });
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
    }
  };

  const handleSpeechStop = async () => {
    try {
      await stopListening();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message..."
        className="min-h-[60px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      />
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="icon"
          variant={isListening ? "destructive" : "secondary"}
          onClick={isListening ? handleSpeechStop : handleSpeechStart}
        >
          {isListening ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
        <Button type="submit" size="icon" disabled={isLoading || !message.trim()}>
          <SendHorizonal className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
}