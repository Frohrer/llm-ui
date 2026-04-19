import { useState, useRef, useCallback, useEffect } from 'react';

export type SpeechState = 'idle' | 'recording' | 'transcribing';

export function useSpeechToText() {
  const [state, setState] = useState<SpeechState>('idle');
  const [audioLevels, setAudioLevels] = useState<number[]>(() => new Array(40).fill(0));

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animFrameRef = useRef<number>(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(t => t.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setAudioLevels(new Array(40).fill(0));
  }, []);

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup]);

  const startRecording = useCallback(async () => {
    try {
      cleanup();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Audio analysis for waveform
      const audioCtx = new AudioContext();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;

      // Animation loop for frequency data
      const updateLevels = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        // Sample ~40 bars, normalized to 0-1
        const levels: number[] = [];
        const binCount = data.length;
        for (let i = 0; i < 40; i++) {
          const idx = Math.floor((i / 40) * binCount);
          levels.push(data[idx] / 255);
        }
        setAudioLevels(levels);
        animFrameRef.current = requestAnimationFrame(updateLevels);
      };
      animFrameRef.current = requestAnimationFrame(updateLevels);

      setState('recording');
    } catch (err) {
      console.error('Failed to start recording:', err);
      cleanup();
      throw err;
    }
  }, [cleanup]);

  const stopRecording = useCallback(async (): Promise<string> => {
    return new Promise((resolve, reject) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        cleanup();
        setState('idle');
        resolve('');
        return;
      }

      recorder.onstop = async () => {
        // Stop animation and audio context but keep stream for now
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = 0;
        }

        setState('transcribing');

        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          const formData = new FormData();
          formData.append('audio', blob, 'recording.webm');

          const res = await fetch('/api/chat/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            throw new Error('Transcription failed');
          }

          const { text } = await res.json();
          cleanup();
          setState('idle');
          resolve(text || '');
        } catch (err) {
          console.error('Transcription error:', err);
          cleanup();
          setState('idle');
          reject(err);
        }
      };

      recorder.stop();
      // Stop media stream tracks
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
      }
    });
  }, [cleanup]);

  const cancelRecording = useCallback(() => {
    cleanup();
    setState('idle');
  }, [cleanup]);

  return {
    state,
    audioLevels,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
