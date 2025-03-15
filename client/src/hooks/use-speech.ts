import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

// Define a type for the SpeechRecognition constructor
type SpeechRecognitionConstructor = new () => SpeechRecognition;

export function useSpeech() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Transcript state to track interim results during speech recognition
  const [transcript, setTranscript] = useState<string>('');
  
  const startRecording = async () => {
    try {
      // Check if the browser supports the Web Speech API
      const SpeechRecognitionAPI = window.SpeechRecognition || 
                                 window.webkitSpeechRecognition as unknown as SpeechRecognitionConstructor;
      
      if (!SpeechRecognitionAPI) {
        // Fall back to our server-side audio recording approach
        throw new Error('Speech recognition not available directly. Using server-side processing.');
      }

      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Clear any previous transcript
      setTranscript('');
      
      // Initialize speech recognition
      const recognition = new SpeechRecognitionAPI();
      
      // Configure recognition
      recognition.lang = 'en-US';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      
      // Set up event handlers before starting
      let finalTranscript = '';
      
      recognition.onstart = () => {
        console.log('Speech recognition started');
      };
      
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        // Update the transcript state with the current recognition results
        setTranscript(finalTranscript + interimTranscript);
      };
      
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error:', event.error);
        
        // Don't stop for no-speech error as it might just need more time
        if (event.error !== 'no-speech') {
          recognition.stop();
        }
      };
      
      recognition.onend = () => {
        console.log('Speech recognition ended');
      };
      
      // Store the recognition instance
      recognitionRef.current = recognition;
      
      // Start recognition
      recognition.start();
      setIsRecording(true);
      
      // Set a timeout to automatically stop if it runs too long
      setTimeout(() => {
        if (isRecording && recognitionRef.current === recognition) {
          stopRecording();
        }
      }, 30000);
      
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      toast({
        variant: "destructive",
        title: "Speech Recognition Error",
        description: error instanceof Error 
          ? error.message 
          : "Please ensure your browser has permission to access the microphone."
      });
    }
  };

  const stopRecording = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!recognitionRef.current) {
        reject(new Error('No recording in progress'));
        return;
      }
      
      // Capture the current transcript
      const currentTranscript = transcript;
      
      // Clean up
      const recognition = recognitionRef.current;
      recognition.stop();
      recognitionRef.current = null;
      setIsRecording(false);
      
      // Resolve with the captured transcript
      if (currentTranscript.trim()) {
        resolve(currentTranscript.trim());
      } else {
        reject(new Error('No speech detected'));
      }
    });
  };

  const playText = async (text: string) => {
    try {
      // If already playing, add to queue
      if (isPlaying) {
        audioQueueRef.current.push(text);
        return;
      }

      setIsPlaying(true);

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error('Text-to-speech synthesis failed');
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      if (!audioElementRef.current) {
        audioElementRef.current = new Audio();
      }

      audioElementRef.current.src = audioUrl;
      audioElementRef.current.onended = () => {
        URL.revokeObjectURL(audioUrl);
        setIsPlaying(false);

        // Play next in queue if exists
        if (audioQueueRef.current.length > 0) {
          const nextText = audioQueueRef.current.shift();
          if (nextText) {
            playText(nextText);
          }
        }
      };

      await audioElementRef.current.play();
    } catch (error) {
      console.error('Text-to-speech error:', error);
      setIsPlaying(false);
      toast({
        variant: "destructive",
        title: "Speech Synthesis Error",
        description: "Failed to convert text to speech. Please try again."
      });
    }
  };

  const stopPlaying = () => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.currentTime = 0;
    }
    audioQueueRef.current = []; // Clear the queue
    setIsPlaying(false);
  };

  return {
    isRecording,
    isPlaying,
    transcript,
    startRecording,
    stopRecording,
    playText,
    stopPlaying,
  };
}