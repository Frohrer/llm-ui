import { useCallback, useEffect, useState } from 'react';
import { speechService } from '@/lib/speech-service';
import { useToast } from './use-toast';

export function useSpeech() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [hasMicrophonePermission, setHasMicrophonePermission] = useState<boolean | null>(null);
  const { toast } = useToast();

  // Check if microphone is available
  const checkMicrophonePermission = useCallback(async () => {
    try {
      const hasPermission = await speechService.checkMicrophonePermission();
      setHasMicrophonePermission(hasPermission);
      return hasPermission;
    } catch (error) {
      console.error('Error checking microphone permission:', error);
      setHasMicrophonePermission(false);
      return false;
    }
  }, []);

  const startListening = useCallback(async (onResult: (text: string) => void) => {
    try {
      // First explicitly check for microphone permission
      console.log("Checking microphone permission...");
      const permission = await checkMicrophonePermission();
      
      if (!permission) {
        console.log("No microphone permission, requesting...");
        // Force permission dialog to appear by requesting the microphone explicitly
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
          console.log("Microphone permission granted");
          setHasMicrophonePermission(true);
        } catch (permissionError) {
          console.error("Microphone permission denied:", permissionError);
          setHasMicrophonePermission(false);
          toast({
            variant: "destructive",
            title: "Microphone Access Required",
            description: "Please allow microphone access to use speech recognition."
          });
          throw new Error("Microphone permission is required");
        }
      }
      
      // Now start speech recognition
      console.log("Starting speech recognition...");
      await speechService.startListening(onResult);
      setIsListening(true);
    } catch (error) {
      console.error('Failed to start speech recognition:', error);
      setIsListening(false);
      
      if (!(error instanceof Error && error.message.includes('permission'))) {
        toast({
          variant: "destructive",
          title: "Speech Recognition Error",
          description: "Failed to start speech recognition. Please try again."
        });
      }
    }
  }, [toast, checkMicrophonePermission]);

  const stopListening = useCallback(async () => {
    try {
      await speechService.stopListening();
    } catch (error) {
      console.error('Failed to stop speech recognition:', error);
    } finally {
      setIsListening(false);
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      await speechService.speak(text);
    } catch (error) {
      console.error('Failed to speak text:', error);
      toast({
        variant: "destructive",
        title: "Text-to-Speech Error",
        description: "Failed to speak the message. Please try again."
      });
    } finally {
      setIsSpeaking(false);
    }
  }, [toast]);

  useEffect(() => {
    return () => {
      speechService.dispose();
    };
  }, []);

  return {
    isListening,
    isSpeaking,
    hasMicrophonePermission,
    checkMicrophonePermission,
    startListening,
    stopListening,
    speak
  };
}