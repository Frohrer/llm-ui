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
  const { isRecording, isPlaying, transcript, startRecording, stopRecording, playText, stopPlaying } = useSpeech();
  const { toast } = useToast();

  // Play the assistant's message when it arrives
  useEffect(() => {
    if (lastAssistantMessage && !isRecording) {
      playText(lastAssistantMessage);
    }
  }, [lastAssistantMessage, isRecording, playText]);

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
        className={`shrink-0 ${isRecording ? 'animate-pulse border-2 border-red-500' : ''}`}
        onClick={handleMicClick}
      >
        {isRecording ? (
          <MicOff className="h-4 w-4 animate-pulse text-red-500" />
        ) : (
          <Mic className="h-4 w-4" />
        )}
        {isRecording && (
          <>
            <span className="absolute -top-2 -right-2 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
            </span>
            <span className="absolute -top-10 left-1/2 transform -translate-x-1/2 bg-gray-800 text-white text-xs px-2 py-1 rounded animate-pulse whitespace-nowrap">
              Listening...
            </span>
          </>
        )}
      </Button>
      <Textarea
        value={isRecording ? transcript : message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder={isRecording ? "Listening..." : "Type your message..."}
        readOnly={isRecording}
        className={`min-h-[60px] ${isRecording ? 'bg-red-50 dark:bg-red-900/10' : ''}`}
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
      <Button 
        type="submit" 
        disabled={isLoading || (!message.trim() && !(isRecording && transcript.trim()))}
        className={isRecording && transcript.trim() ? "bg-red-500 hover:bg-red-600" : ""}
        onClick={(e) => {
          if (isRecording && transcript.trim()) {
            e.preventDefault();
            stopRecording().then(text => {
              if (text) {
                onSendMessage(text);
              }
            });
          }
        }}
      >
        <SendHorizonal className="h-4 w-4" />
      </Button>
    </form>
  );
}
