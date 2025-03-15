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
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
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
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
          
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