import { useState, useCallback } from 'react';
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

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      const success = await onSendMessage(message);
      if (success) {
        setMessage('');
      }
    }
  }, [message, isLoading, onSendMessage]);

  const handleSpeechStart = useCallback(async () => {
    try {
      // First explicitly request microphone permission using the browser API
      // This should trigger the permission prompt directly
      try {
        console.log("Requesting microphone access...");
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Stop the stream immediately after getting permission
        stream.getTracks().forEach(track => track.stop());
        console.log("Microphone access granted");
      } catch (permissionError) {
        console.error("Microphone access denied:", permissionError);
        throw new Error("Microphone permission is required");
      }
      
      // Now start speech recognition
      await startListening((text) => {
        // Add the recognized text with proper spacing
        setMessage((prev) => {
          const needsSpace = prev.length > 0 && !prev.endsWith(' ');
          return prev + (needsSpace ? ' ' : '') + text;
        });
      });
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      // Error handling is now done in the hook
    }
  }, [startListening]);

  const handleSpeechStop = useCallback(async () => {
    try {
      await stopListening();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
      // Error handling is now done in the hook
    }
  }, [stopListening]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }, [handleSubmit]);

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  }, []);

  const renderMicButton = useCallback(() => (
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
  ), [isListening, handleSpeechStart, handleSpeechStop]);

  const renderSendButton = useCallback(() => (
    <Button type="submit" size="icon" disabled={isLoading || !message.trim()}>
      <SendHorizonal className="h-4 w-4" />
    </Button>
  ), [isLoading, message]);

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Textarea
        value={message}
        onChange={handleTextChange}
        placeholder="Type your message..."
        className="min-h-[60px]"
        onKeyDown={handleKeyDown}
      />
      <div className="flex flex-col gap-2">
        {renderMicButton()}
        {renderSendButton()}
      </div>
    </form>
  );
}