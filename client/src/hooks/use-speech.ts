import { useCallback, useEffect, useState } from 'react';
import { speechService } from '@/lib/speech-service';

export function useSpeech() {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const startListening = useCallback((onResult: (text: string) => void) => {
    setIsListening(true);
    speechService.startListening(onResult);
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
    speechService.stopListening();
  }, []);

  const speak = useCallback(async (text: string) => {
    try {
      setIsSpeaking(true);
      await speechService.speak(text);
    } finally {
      setIsSpeaking(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      speechService.dispose();
    };
  }, []);

  return {
    isListening,
    isSpeaking,
    startListening,
    stopListening,
    speak
  };
}