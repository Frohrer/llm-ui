import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { SendHorizonal, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
import { useSpeech } from '@/hooks/use-speech';
import { useToast } from '@/hooks/use-toast';

interface ChatInputProps {
  onSendMessage: (message: string) => Promise<boolean | void>;
  isLoading: boolean;
  lastAssistantMessage?: string;
}

export function ChatInput({ onSendMessage, isLoading, lastAssistantMessage }: ChatInputProps) {
  const [message, setMessage] = useState('');
  const { isRecording, isPlaying, startRecording, stopRecording, playText, stopPlaying } = useSpeech();
  const { toast } = useToast();

  // Play the assistant's message when it arrives
  useEffect(() => {
    if (lastAssistantMessage && !isRecording) {
      playText(lastAssistantMessage);
    }
  }, [lastAssistantMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !isLoading) {
      // Only clear the message if the submission was successful
      // The onSendMessage function will return true if submission was successful
      const success = await onSendMessage(message);
      if (success) {
        setMessage('');
      }
    }
  };

  const handleMicClick = async () => {
    if (isRecording) {
      try {
        const text = await stopRecording();
        if (text) {
          setMessage(text);
          // Automatically send the message
          const success = await onSendMessage(text);
          if (success) {
            setMessage('');
          }
        }
      } catch (error) {
        console.error('Speech recognition error:', error);
        toast({
          variant: "destructive",
          title: "Speech Recognition Error",
          description: "Failed to recognize speech. Please try again."
        });
      }
    } else {
      await startRecording();
    }
  };

  const handleVolumeClick = () => {
    if (isPlaying) {
      stopPlaying();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <Button 
        type="button"
        variant={isRecording ? "destructive" : "outline"}
        size="icon"
        className="shrink-0"
        onClick={handleMicClick}
      >
        {isRecording ? (
          <MicOff className="h-4 w-4" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
      </Button>
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={isRecording ? "Listening..." : "Type your message..."}
        className="min-h-[60px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSubmit(e);
          }
        }}
      />
      <Button 
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0"
        onClick={handleVolumeClick}
      >
        {isPlaying ? (
          <VolumeX className="h-4 w-4" />
        ) : (
          <Volume2 className="h-4 w-4" />
        )}
      </Button>
      <Button type="submit" disabled={isLoading || !message.trim()}>
        <SendHorizonal className="h-4 w-4" />
      </Button>
    </form>
  );
}
