import { useState, useRef } from 'react';
import { useToast } from '@/hooks/use-toast';

export function useSpeech() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioQueueRef = useRef<string[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Try to use webm format which is more widely supported
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      // Collect data every second or so to improve real-time capabilities
      mediaRecorder.start(1000);
      setIsRecording(true);
      
      // Set up a fallback mechanism if no data is received after 30 seconds
      setTimeout(() => {
        if (isRecording && mediaRecorderRef.current === mediaRecorder) {
          mediaRecorder.stop();
        }
      }, 30000);
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
      toast({
        variant: "destructive",
        title: "Microphone Access Error",
        description: "Please ensure your browser has permission to access the microphone."
      });
    }
  };

  const stopRecording = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorderRef.current) {
        reject(new Error('No recording in progress'));
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        try {
          // Using the Web Speech API directly for client-side speech recognition
          // as an alternative to server-side processing
          if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
            // Use browser's built-in speech recognition
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const recognition = new SpeechRecognition();
            recognition.lang = 'en-US';
            recognition.interimResults = false;
            recognition.maxAlternatives = 1;
            
            // Create an audio element to play back the recording for the recognizer
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            
            let recognitionStarted = false;
            audio.onplay = () => {
              if (!recognitionStarted) {
                recognition.start();
                recognitionStarted = true;
              }
            };
            
            recognition.onresult = (event: SpeechRecognitionEvent) => {
              const transcript = event.results[0][0].transcript;
              resolve(transcript);
            };
            
            recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
              console.error('Speech recognition error:', event.error);
              reject(new Error(`Recognition error: ${event.error}`));
            };
            
            recognition.onend = () => {
              if (!recognitionStarted) {
                reject(new Error('Recognition ended without starting'));
              }
              URL.revokeObjectURL(audioUrl);
            };
            
            // Start playing the audio to trigger recognition
            audio.play().catch(error => {
              console.error('Error playing audio:', error);
              reject(error);
            });
          } else {
            // Fallback to server-side processing if Web Speech API is not available
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            
            // Send audio data to the server for speech-to-text
            const response = await fetch('/api/stt', {
              method: 'POST',
              body: audioBlob,
            });

            if (!response.ok) {
              throw new Error('Speech recognition failed');
            }

            const data = await response.json();
            if (data.error) {
              throw new Error(data.error);
            }

            resolve(data.text);
          }
        } catch (error) {
          console.error('Speech recognition error:', error);
          reject(error);
        } finally {
          setIsRecording(false);
          // Stop all tracks in the stream
          mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorderRef.current.stop();
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
    startRecording,
    stopRecording,
    playText,
    stopPlaying,
  };
}