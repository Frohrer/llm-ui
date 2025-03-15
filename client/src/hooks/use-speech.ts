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

  // Transcript state to track interim results during speech recognition
  const [transcript, setTranscript] = useState<string>('');
  
  const startRecording = async () => {
    try {
      // Request microphone permission and get stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Clear any previous transcript
      setTranscript('');
      
      // Try to use webm format which is more widely supported
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      
      // Initialize the media recorder
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      
      // Set up event handlers
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Start recording
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      
      // Set a timeout to automatically stop if it runs too long
      setTimeout(() => {
        if (isRecording && mediaRecorderRef.current === mediaRecorder) {
          stopRecording();
        }
      }, 30000);
      
      // Set placeholder transcript for better UX
      setTranscript("Listening...");
      
      // Every 3 seconds, update the transcript with current audio
      const transcriptUpdateInterval = setInterval(async () => {
        if (audioChunksRef.current.length > 0 && isRecording) {
          try {
            // Create a copy of current audio chunks
            const audioBlob = new Blob([...audioChunksRef.current], { type: 'audio/webm' });
            
            // Send to server for transcription
            const formData = new FormData();
            formData.append('audio', audioBlob);
            
            const response = await fetch('/api/stt', {
              method: 'POST',
              body: audioBlob,
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.text) {
                setTranscript(data.text);
              }
            }
          } catch (err) {
            console.error('Error getting interim transcript:', err);
          }
        }
      }, 3000);
      
      // Clear interval when recording stops
      mediaRecorder.onstop = () => {
        clearInterval(transcriptUpdateInterval);
      };
      
    } catch (error) {
      console.error('Error starting speech recognition:', error);
      toast({
        variant: "destructive",
        title: "Microphone Error",
        description: error instanceof Error 
          ? error.message 
          : "Please ensure your browser has permission to access the microphone."
      });
    }
  };

  const stopRecording = async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!mediaRecorderRef.current || !isRecording) {
        reject(new Error('No recording in progress'));
        return;
      }
      
      const mediaRecorder = mediaRecorderRef.current;
      
      // Set up onstop handler to process the audio
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          
          // Send to server for processing
          const response = await fetch('/api/stt', {
            method: 'POST',
            body: audioBlob,
          });
          
          if (!response.ok) {
            throw new Error('Server speech recognition failed');
          }
          
          const data = await response.json();
          
          if (data.error) {
            throw new Error(data.error);
          }
          
          // Clean up recording state
          setIsRecording(false);
          mediaRecorderRef.current = null;
          
          // Stop all tracks in the stream
          mediaRecorder.stream.getTracks().forEach(track => track.stop());
          
          if (data.text && data.text.trim()) {
            // Update the transcript one last time with the final result
            setTranscript(data.text);
            resolve(data.text);
          } else {
            setTranscript('');
            reject(new Error('No speech detected'));
          }
        } catch (error) {
          console.error('Speech recognition error:', error);
          setIsRecording(false);
          setTranscript('');
          
          // Stop all tracks in the stream
          mediaRecorder.stream.getTracks().forEach(track => track.stop());
          
          reject(error);
        }
      };
      
      // Stop the recording
      mediaRecorder.stop();
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