import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';

export function useSpeech() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const scriptProcessorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const audioQueueRef = useRef<string[]>([]);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Transcript state to track interim results during speech recognition
  const [transcript, setTranscript] = useState<string>('');
  
  // Cleanup function for audio resources
  const cleanupAudio = () => {
    // Stop and release the media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }

    // Stop all tracks in the media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
    }

    // Clean up audio processor node
    if (scriptProcessorNodeRef.current) {
      scriptProcessorNodeRef.current.disconnect();
    }

    // Close audio context
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }

    // Reset all refs
    mediaRecorderRef.current = null;
    mediaStreamRef.current = null;
    scriptProcessorNodeRef.current = null;
    audioContextRef.current = null;
    audioChunksRef.current = [];
  };
  
  // Ensure cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);
  
  const startRecording = async () => {
    try {
      // Clean up any existing recording state
      cleanupAudio();
      
      // Clear any previous transcript
      setTranscript('Listening...');
      
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      
      // Create audio context
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      
      // Create media stream source
      const microphone = audioContext.createMediaStreamSource(stream);
      
      // Create script processor for audio analysis
      const bufferSize = 4096;
      const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
      scriptProcessorNodeRef.current = processor;
      
      // Connect nodes: microphone -> processor -> destination
      microphone.connect(processor);
      processor.connect(audioContext.destination);
      
      // Setup audio processing for voice activity detection
      processor.onaudioprocess = (event) => {
        const audioData = event.inputBuffer.getChannelData(0);
        
        // Simple energy-based voice activity detection
        const energy = calculateEnergy(audioData);
        
        // Debug: Log energy levels
        if (isRecording && audioChunksRef.current.length % 10 === 0) {
          console.log('Audio energy:', energy);
        }
      };
      
      // Setup media recorder for capturing audio
      let options = {};
      if (MediaRecorder.isTypeSupported('audio/webm')) {
        options = { mimeType: 'audio/webm' };
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        options = { mimeType: 'audio/mp4' };
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      
      // Setup event listeners
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Set up interval to send audio to server for transcription
      const updateInterval = setInterval(async () => {
        if (isRecording && audioChunksRef.current.length > 0) {
          try {
            // Create a copy of the current audio chunks
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            
            // Send to server for recognition
            const response = await fetch('/api/stt', {
              method: 'POST',
              body: audioBlob,
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.text && data.text.trim()) {
                setTranscript(data.text);
              }
            }
          } catch (err) {
            console.error('Error getting interim transcript:', err);
          }
        }
      }, 5000); // Check every 5 seconds
      
      // Start recording
      mediaRecorder.start(1000); // Collect data every second
      setIsRecording(true);
      
      // Set up cleanup on stop
      mediaRecorder.onstop = () => {
        clearInterval(updateInterval);
      };
      
      // Set a timeout to automatically stop if it runs too long
      setTimeout(() => {
        if (isRecording) {
          stopRecording().catch(console.error);
        }
      }, 30000); // 30 seconds max
      
    } catch (error) {
      console.error('Error starting audio recording:', error);
      cleanupAudio();
      setIsRecording(false);
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
      
      // Stop media recorder
      const mediaRecorder = mediaRecorderRef.current;
      
      // Capture current transcript
      const currentTranscript = transcript;
      
      if (mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = async () => {
          try {
            if (audioChunksRef.current.length === 0) {
              setIsRecording(false);
              cleanupAudio();
              reject(new Error('No audio data collected'));
              return;
            }
            
            // Create a blob from all chunks
            const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
            
            // Send to server for final transcription
            const response = await fetch('/api/stt', {
              method: 'POST',
              body: audioBlob,
            });
            
            // Update recording status
            setIsRecording(false);
            cleanupAudio();
            
            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Server error during speech recognition');
            }
            
            const data = await response.json();
            
            if (data.text && data.text.trim()) {
              setTranscript(data.text);
              resolve(data.text);
            } else if (currentTranscript && currentTranscript !== 'Listening...') {
              // Fall back to what we already had
              resolve(currentTranscript);
            } else {
              reject(new Error('No speech detected'));
            }
          } catch (error) {
            console.error('Speech recognition error:', error);
            setIsRecording(false);
            setTranscript('');
            cleanupAudio();
            reject(error);
          }
        };
        
        mediaRecorder.stop();
      } else {
        setIsRecording(false);
        cleanupAudio();
        
        if (currentTranscript && currentTranscript !== 'Listening...') {
          resolve(currentTranscript);
        } else {
          reject(new Error('No speech detected'));
        }
      }
    });
  };
  
  // Helper function to calculate energy level of audio for voice activity detection
  const calculateEnergy = (audioData: Float32Array): number => {
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += Math.abs(audioData[i]);
    }
    return sum / audioData.length;
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