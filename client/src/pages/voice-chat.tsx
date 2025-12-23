import { useState, useRef, useEffect } from 'react';
import { useParams, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Mic, MicOff, Loader2, Wrench, Signal, SignalMedium, SignalLow, ArrowLeft, Hand, Volume2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Link } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  toolName?: string;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface ConnectionQuality {
  latency: number;
  quality: 'excellent' | 'good' | 'fair' | 'poor';
  packetsReceived: number;
  packetsSent: number;
}

interface VoiceChatProps {
  conversationId?: string;
}

export default function VoiceChat({ conversationId: propConversationId }: VoiceChatProps) {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  
  // Use prop or URL param for conversation ID
  const initialConversationId = propConversationId || params.id;
  const [conversationId, setConversationId] = useState<number | null>(
    initialConversationId ? parseInt(initialConversationId) : null
  );
  
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [isRecording, setIsRecording] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentToolCall, setCurrentToolCall] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionQuality, setConnectionQuality] = useState<ConnectionQuality>({
    latency: 0,
    quality: 'good',
    packetsReceived: 0,
    packetsSent: 0
  });
  const [voiceActivity, setVoiceActivity] = useState<number>(0);
  const [isAISpeaking, setIsAISpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);
  const responseCompleteRef = useRef(false);
  const nextPlayTimeRef = useRef<number>(0);
  const latencyCheckRef = useRef<{ timestamp: number; messageId: string } | null>(null);
  const lastPingRef = useRef<number>(Date.now());
  const audioWorkletLoadedRef = useRef(false);
  const scheduledSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const isAIRespondingRef = useRef(false);

  // Fetch previous messages if resuming a conversation
  const { data: previousMessages } = useQuery({
    queryKey: ['/api/conversations', conversationId, 'messages'],
    queryFn: async () => {
      if (!conversationId) return null;
      const response = await fetch(`/api/conversations/${conversationId}/messages`, {
        credentials: 'include'
      });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!conversationId && status === 'disconnected',
  });

  // Load previous messages into state when fetched
  useEffect(() => {
    if (previousMessages?.messages && messages.length === 0) {
      const loadedMessages: Message[] = previousMessages.messages
        .filter((m: any) => m.role === 'user' || m.role === 'assistant')
        .map((m: any, index: number) => ({
          id: `prev-${m.id || index}`,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: new Date(m.created_at)
        }));
      
      if (loadedMessages.length > 0) {
        setMessages(loadedMessages);
      }
    }
  }, [previousMessages, messages.length]);

  // Prevent body scrolling on mobile
  useEffect(() => {
    // Save original overflow style
    const originalOverflow = document.body.style.overflow;
    
    // Prevent body scrolling
    document.body.style.overflow = 'hidden';
    
    return () => {
      // Restore original overflow
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Initialize audio context and cleanup on unmount
  useEffect(() => {
    audioContextRef.current = new AudioContext({ sampleRate: 24000 });
    
    return () => {
      console.log('[Voice Chat] Component unmounting, cleaning up...');
      
      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      // Stop recording
      if (audioWorkletNodeRef.current) {
        try { audioWorkletNodeRef.current.disconnect(); } catch (e) {}
        audioWorkletNodeRef.current = null;
      }
      if (mediaStreamSourceRef.current) {
        try { mediaStreamSourceRef.current.disconnect(); } catch (e) {}
        mediaStreamSourceRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
      }
      
      // Close audio context
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  // Connect to WebSocket
  const connect = async () => {
    // Prevent multiple simultaneous connections
    if (status === 'connecting' || status === 'connected') {
      console.warn('[Voice Chat] Already connecting or connected, ignoring');
      return;
    }
    
    // Clean up any existing connection first
    if (wsRef.current || mediaStreamRef.current) {
      console.log('[Voice Chat] Cleaning up existing connection before reconnecting');
      disconnect();
      // Small delay to ensure cleanup completes
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    try {
      setStatus('connecting');
      setError(null);

      // Check if we're in an environment that supports audio capture
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        // Check if it's due to insecure context (HTTP instead of HTTPS)
        if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
          throw new Error('HTTPS_REQUIRED');
        }
        throw new Error('Your browser or environment does not support audio capture. This may occur when using Remote Desktop (RDP) or in unsupported browsers.');
      }

      // Request microphone access with echo cancellation to reduce feedback on mobile
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Lower sample rate can help reduce feedback sensitivity
          sampleRate: { ideal: 24000 }
        } 
      });
      mediaStreamRef.current = stream;

      // Create WebSocket connection with conversation ID if resuming
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = conversationId 
        ? `${protocol}//${window.location.host}/api/realtime-voice?conversationId=${conversationId}`
        : `${protocol}//${window.location.host}/api/realtime-voice`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Voice Chat] Connected to server');
        setStatus('connected');
        startRecording();
      };

      ws.onmessage = async (event) => {
        // Ignore messages if this isn't the current WebSocket
        if (ws !== wsRef.current) {
          console.warn('[Voice Chat] Ignoring message from old connection');
          return;
        }
        
        try {
          const message = JSON.parse(event.data);
          await handleServerMessage(message);
        } catch (error) {
          console.error('[Voice Chat] Error handling message:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('[Voice Chat] WebSocket error:', error);
        setError('Connection error occurred');
        setStatus('error');
      };

      ws.onclose = () => {
        console.log('[Voice Chat] Disconnected from server');
        setStatus('disconnected');
        stopRecording();
        
        // Invalidate conversations query to refresh the list
        queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
      };
    } catch (error) {
      console.error('[Voice Chat] Error connecting:', error);
      
      // Provide more helpful error messages
      let errorMessage = 'Failed to connect';
      
      if (error instanceof Error) {
        if (error.message === 'HTTPS_REQUIRED') {
          errorMessage = '🔒 HTTPS Required for Voice Chat\n\n' +
                        'Microphone access requires a secure connection (HTTPS).\n\n' +
                        'Solutions:\n' +
                        '• Access via localhost: http://localhost:5000/voice-chat\n' +
                        '• Or set up HTTPS (see VOICE_CHAT_GUIDE.md)\n' +
                        '• Current URL: ' + window.location.href;
        } else if (error.name === 'NotFoundError' || error.message.includes('object can not be found')) {
          errorMessage = 'Microphone not available. This commonly occurs when:\n' +
                        '• Using Remote Desktop (RDP) - try accessing directly on the local machine\n' +
                        '• Using HTTP instead of HTTPS (try localhost or set up HTTPS)\n' +
                        '• Microphone is disabled or not connected\n' +
                        '• Browser doesn\'t have permission to access audio devices';
        } else if (error.name === 'NotAllowedError') {
          errorMessage = 'Microphone access denied. Please allow microphone access in your browser settings.';
        } else if (error.name === 'NotSupportedError') {
          errorMessage = 'Your browser does not support audio capture.';
        } else {
          errorMessage = error.message;
        }
      }
      
      setError(errorMessage);
      setStatus('error');
    }
  };

  // Disconnect from WebSocket and clean up all resources
  const disconnect = () => {
    console.log('[Voice Chat] Disconnecting and cleaning up...');
    
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Stop recording and clean up audio nodes
    stopRecording();
    
    // Clear audio playback queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    responseCompleteRef.current = false;
    nextPlayTimeRef.current = 0;
    
    // Reset state (but keep messages for history)
    setStatus('disconnected');
    setIsRecording(false);
    setError(null);
    setVoiceActivity(0);
    setCurrentToolCall(null);
    setConnectionQuality({
      latency: 0,
      quality: 'good',
      packetsReceived: 0,
      packetsSent: 0
    });
    
    // Invalidate conversations query to refresh the list
    queryClient.invalidateQueries({ queryKey: ['/api/conversations'] });
    
    console.log('[Voice Chat] Cleanup complete');
  };

  // Start recording audio with AudioWorklet (better performance) or fallback to ScriptProcessorNode
  const startRecording = async () => {
    if (!audioContextRef.current || !mediaStreamRef.current || !wsRef.current) {
      console.error('[Voice Chat] Cannot start recording - missing dependencies');
      return;
    }

    const audioContext = audioContextRef.current;
    
    // Resume audio context if suspended (required in some browsers)
    if (audioContext.state === 'suspended') {
      console.log('[Voice Chat] Resuming suspended audio context');
      await audioContext.resume();
    }

    const source = audioContext.createMediaStreamSource(mediaStreamRef.current);
    mediaStreamSourceRef.current = source;

    // Try AudioWorklet first for best performance
    try {
      // Only load AudioWorklet module once
      if (!audioWorkletLoadedRef.current) {
        await audioContext.audioWorklet.addModule('/audio-processor.js');
        audioWorkletLoadedRef.current = true;
        console.log('[Voice Chat] AudioWorklet module loaded');
      }
      
      const workletNode = new AudioWorkletNode(audioContext, 'voice-input-processor');

      let audioChunksSent = 0;

      // Handle messages from the AudioWorklet
      workletNode.port.onmessage = (event) => {
        // Ignore if this isn't the current worklet
        if (workletNode !== audioWorkletNodeRef.current) {
          return;
        }
        
        if (event.data.type === 'audioData' && wsRef.current?.readyState === WebSocket.OPEN) {
          const pcm16 = event.data.data;
          
          // Update voice activity indicator
          setVoiceActivity(event.data.hasVoice ? event.data.energy * 100 : 0);
          
          // Check if this is a voice interruption (user speaking over AI)
          if (event.data.isInterruption && isAIRespondingRef.current) {
            console.log('[Voice Chat] Voice interruption detected - user speaking over AI');
            // The audio will be sent to OpenAI which will trigger speech_started
            // and our handler will call handleInterrupt()
          }

          // Convert to base64 and send
          const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: base64
          }));
          
          // Update packet count
          audioChunksSent++;
          setConnectionQuality(prev => ({
            ...prev,
            packetsSent: audioChunksSent
          }));
          
          // Log every 100 chunks
          if (audioChunksSent % 100 === 0) {
            console.log(`[Voice Chat] Sent ${audioChunksSent} audio chunks (optimized with AudioWorklet)`);
          }
        }
      };

      // Send mute state to worklet
      workletNode.port.postMessage({ type: 'setMuted', value: isMuted });

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);
      audioWorkletNodeRef.current = workletNode;
      setIsRecording(true);
      
      console.log('[Voice Chat] Audio recording started with AudioWorklet (optimized)');
      console.log('[Voice Chat] Audio context sample rate:', audioContext.sampleRate);
      console.log('[Voice Chat] Media stream active:', mediaStreamRef.current.active);
    } catch (error) {
      console.warn('[Voice Chat] AudioWorklet not available, using ScriptProcessorNode fallback:', error);
      setError('Using fallback audio mode (slightly higher latency)');
      
      // Fallback to ScriptProcessorNode (deprecated but widely supported)
      const processor = audioContext.createScriptProcessor(2048, 1, 1);
      let audioChunksSent = 0;

      // Fallback VAD state for ScriptProcessorNode
      let fallbackSmoothedEnergy = 0;
      const fallbackBaseThreshold = 0.01;
      const fallbackAISpeakingThreshold = 0.08;
      
      processor.onaudioprocess = (e) => {
        // Ignore if this isn't the current processor
        if (processor !== audioWorkletNodeRef.current) return;
        if (wsRef.current?.readyState !== WebSocket.OPEN) return;
        if (isMuted) return; // Don't send when muted

        const inputData = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(inputData.length);
        
        // Calculate energy for voice activity
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          sum += inputData[i] * inputData[i];
        }
        const energy = Math.sqrt(sum / inputData.length);
        
        // Smooth energy for more stable detection
        fallbackSmoothedEnergy = (0.3 * energy) + (0.7 * fallbackSmoothedEnergy);
        
        // Use higher threshold when AI is speaking to filter echo
        const currentThreshold = isAIRespondingRef.current ? fallbackAISpeakingThreshold : fallbackBaseThreshold;
        const hasVoice = fallbackSmoothedEnergy > currentThreshold;
        
        // Update voice activity indicator
        setVoiceActivity(hasVoice ? fallbackSmoothedEnergy * 100 : 0);

        // When AI is speaking, only send audio if it exceeds the higher threshold
        // This filters out echo while still allowing user interruption
        if (isAIRespondingRef.current && !hasVoice) {
          return; // Don't send echo audio
        }

        // Send audio
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64
        }));
        
        // Update packet count
        audioChunksSent++;
        setConnectionQuality(prev => ({
          ...prev,
          packetsSent: audioChunksSent
        }));
        
        // Log every 100 chunks
        if (audioChunksSent % 100 === 0) {
          console.log(`[Voice Chat] Sent ${audioChunksSent} audio chunks (fallback mode)`);
        }
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      audioWorkletNodeRef.current = processor as any; // Store for cleanup
      setIsRecording(true);
      
      console.log('[Voice Chat] Audio recording started with ScriptProcessorNode (fallback mode)');
      console.log('[Voice Chat] Audio context sample rate:', audioContext.sampleRate);
    }
  };

  // Stop recording audio and clean up all audio nodes
  const stopRecording = () => {
    console.log('[Voice Chat] Stopping recording...');
    
    // Disconnect and clean up audio worklet/processor node
    if (audioWorkletNodeRef.current) {
      try {
        audioWorkletNodeRef.current.disconnect();
      } catch (e) {
        console.warn('[Voice Chat] Error disconnecting worklet node:', e);
      }
      audioWorkletNodeRef.current = null;
    }
    
    // Disconnect media stream source
    if (mediaStreamSourceRef.current) {
      try {
        mediaStreamSourceRef.current.disconnect();
      } catch (e) {
        console.warn('[Voice Chat] Error disconnecting source:', e);
      }
      mediaStreamSourceRef.current = null;
    }
    
    // Stop all media stream tracks
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('[Voice Chat] Stopped track:', track.kind, track.label);
      });
      mediaStreamRef.current = null;
    }
    
    setIsRecording(false);
    console.log('[Voice Chat] Recording stopped');
  };

  // Handle user interruption - stops all AI audio and cancels response
  const handleInterrupt = () => {
    console.log('[Voice Chat] Handling interrupt - clearing audio queue and canceling response');
    
    // 1. Stop all scheduled audio sources immediately
    scheduledSourcesRef.current.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source may have already ended
      }
    });
    scheduledSourcesRef.current = [];
    
    // 2. Clear the audio queue
    audioQueueRef.current = [];
    isPlayingRef.current = false;
    nextPlayTimeRef.current = 0;
    
    // 3. Mark AI as no longer responding and lower VAD threshold
    isAIRespondingRef.current = false;
    setIsAISpeaking(false);
    if (audioWorkletNodeRef.current && 'port' in audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: 'setAISpeaking', value: false });
    }
    
    // 4. Send cancel message to OpenAI to stop generating response
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'response.cancel'
      }));
      console.log('[Voice Chat] Sent response.cancel to OpenAI');
    }
  };

  // Manual interrupt button handler - for users to tap and interrupt on mobile
  // This is a fallback for cases where voice interruption doesn't work well
  const handleManualInterrupt = () => {
    console.log('[Voice Chat] Manual interrupt triggered');
    handleInterrupt();
  };

  // Handle AI response completion - lower VAD threshold back to normal
  const handleAIResponseComplete = () => {
    console.log('[Voice Chat] AI response complete');
    isAIRespondingRef.current = false;
    setIsAISpeaking(false);
    
    // Signal to audio processor to lower VAD threshold back to normal
    if (audioWorkletNodeRef.current && 'port' in audioWorkletNodeRef.current) {
      console.log('[Voice Chat] AI done speaking - lowering VAD threshold');
      audioWorkletNodeRef.current.port.postMessage({ type: 'setAISpeaking', value: false });
    }
  };

  // Update mute state in AudioWorklet (if using AudioWorklet)
  useEffect(() => {
    if (audioWorkletNodeRef.current && 'port' in audioWorkletNodeRef.current) {
      audioWorkletNodeRef.current.port.postMessage({ type: 'setMuted', value: isMuted });
    }
    // Note: ScriptProcessorNode checks isMuted directly in onaudioprocess
  }, [isMuted]);

  // Handle messages from server
  const handleServerMessage = async (message: any) => {
    // Track packets received for connection quality
    setConnectionQuality(prev => ({
      ...prev,
      packetsReceived: prev.packetsReceived + 1
    }));

    switch (message.type) {
      case 'conversation.created':
        // New conversation was created on the server
        console.log('[Voice Chat] Conversation created:', message.conversationId);
        setConversationId(message.conversationId);
        // Update URL without full navigation
        setLocation(`/voice-chat/${message.conversationId}`, { replace: true });
        break;

      case 'conversation.resumed':
        // Resumed existing conversation
        console.log('[Voice Chat] Conversation resumed:', message.conversationId);
        break;

      case 'session.created':
        console.log('[Voice Chat] Session created');
        latencyCheckRef.current = { timestamp: Date.now(), messageId: 'session_start' };
        break;

      case 'session.updated':
        console.log('[Voice Chat] Session updated');
        break;

      case 'input_audio_buffer.speech_started':
        console.log('[Voice Chat] User started speaking');
        // If AI was responding, this is an interruption
        if (isAIRespondingRef.current) {
          console.log('[Voice Chat] User interrupted AI response');
          handleInterrupt();
        }
        // Start latency measurement and mark response as not complete
        latencyCheckRef.current = { timestamp: Date.now(), messageId: 'speech' };
        responseCompleteRef.current = false;
        nextPlayTimeRef.current = 0; // Reset scheduled time for new response
        break;

      case 'input_audio_buffer.speech_stopped':
        console.log('[Voice Chat] User stopped speaking');
        // Add placeholder for user message (will be updated with transcript)
        setMessages(prev => [...prev, {
          id: 'user-pending',
          role: 'user',
          content: '...',
          timestamp: new Date()
        }]);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        // Update user message with actual transcript
        setMessages(prev => {
          const messages = [...prev];
          // Find and update the placeholder or pending user message
          const userMsgIndex = messages.findIndex(m => 
            m.role === 'user' && (m.id === 'user-pending' || m.id === message.item_id || m.content === '...')
          );
          
          if (userMsgIndex !== -1) {
            // Update existing placeholder
            messages[userMsgIndex] = {
              id: message.item_id,
              role: 'user',
              content: message.transcript,
              timestamp: messages[userMsgIndex].timestamp
            };
            return messages;
          } else {
            // Insert at the correct position (before any assistant responses after the last user message)
            const lastUserIndex = messages.findLastIndex(m => m.role === 'user');
            const insertIndex = lastUserIndex + 1;
            messages.splice(insertIndex, 0, {
              id: message.item_id,
              role: 'user',
              content: message.transcript,
              timestamp: new Date()
            });
            return messages;
          }
        });
        break;

      case 'response.audio_transcript.delta':
        // Assistant's response text (incremental)
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.id === message.item_id) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + message.delta }
            ];
          }
          return [...prev, {
            id: message.item_id,
            role: 'assistant',
            content: message.delta,
            timestamp: new Date()
          }];
        });
        break;

      case 'response.audio.delta':
        // Assistant's audio response (play it)
        if (message.delta) {
          // Calculate latency from speech start to first audio response
          if (latencyCheckRef.current) {
            const latency = Date.now() - latencyCheckRef.current.timestamp;
            const quality = latency < 500 ? 'excellent' : latency < 1000 ? 'good' : latency < 2000 ? 'fair' : 'poor';
            setConnectionQuality(prev => ({
              ...prev,
              latency,
              quality
            }));
            latencyCheckRef.current = null;
          }
          
          // Mark AI as responding - signal to audio processor to use higher VAD threshold
          // This filters out echo while still allowing voice interruption
          if (!isAIRespondingRef.current) {
            isAIRespondingRef.current = true;
            setIsAISpeaking(true);
            // Signal to audio processor to raise VAD threshold (filter echo, allow loud speech)
            if (audioWorkletNodeRef.current && 'port' in audioWorkletNodeRef.current) {
              console.log('[Voice Chat] AI speaking - raising VAD threshold to filter echo');
              audioWorkletNodeRef.current.port.postMessage({ type: 'setAISpeaking', value: true });
            }
          }
          
          await playAudioChunk(message.delta);
        }
        break;

      case 'response.function_call_arguments.delta':
        // Tool call in progress
        if (message.name) {
          setCurrentToolCall(message.name);
        }
        break;

      case 'response.function_call_arguments.done':
        // Tool call completed
        setMessages(prev => [...prev, {
          id: message.call_id,
          role: 'tool',
          content: `Executing: ${message.name}(${message.arguments})`,
          timestamp: new Date(),
          toolName: message.name
        }]);
        setCurrentToolCall(null);
        break;

      case 'response.done':
        console.log('[Voice Chat] Response completed - marking for final playback');
        responseCompleteRef.current = true;
        // Trigger checks with longer delays to ensure all final chunks arrive and play
        setTimeout(() => {
          if (audioQueueRef.current.length > 0 && !isPlayingRef.current) {
            console.log('[Voice Chat] Playing final chunks after response.done');
            playNextChunk();
          }
        }, 200);
        // Add a second check to catch any stragglers
        setTimeout(() => {
          if (audioQueueRef.current.length > 0 && !isPlayingRef.current) {
            console.log('[Voice Chat] Playing remaining chunks after extended delay');
            playNextChunk();
          }
        }, 500);
        // Schedule auto-unmute after audio finishes playing
        setTimeout(() => {
          if (audioQueueRef.current.length === 0 && !isPlayingRef.current) {
            handleAIResponseComplete();
          }
        }, 1000);
        break;

      case 'error':
        console.error('[Voice Chat] Server error:', message.error);
        setError(message.error.message);
        break;
    }
  };

  // Play audio chunk with adaptive buffering
  const playAudioChunk = async (base64Audio: string) => {
    if (!audioContextRef.current) return;

    try {
      // Decode base64 to PCM16
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const pcm16 = new Int16Array(bytes.buffer);
      
      audioQueueRef.current.push(pcm16);

      // Adaptive buffering: start playing when we have some chunks buffered
      // This prevents audio glitches while minimizing latency
      const minBufferSize = 2; // Minimum chunks before starting playback
      const queueSize = audioQueueRef.current.length;
      
      if (!isPlayingRef.current && queueSize >= minBufferSize) {
        console.log(`[Voice Chat] Starting playback with ${queueSize} chunks buffered`);
        playNextChunk();
      }
      
      // Warn if buffer is getting too large (might indicate network issues)
      if (queueSize > 20) {
        console.warn('[Voice Chat] Audio buffer growing large:', queueSize, 'chunks');
      }
    } catch (error) {
      console.error('[Voice Chat] Error playing audio:', error);
    }
  };

  // Play next audio chunk from queue with seamless scheduling
  const playNextChunk = async () => {
    if (!audioContextRef.current || audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      // Check if this was the final chunk and AI response is complete
      if (responseCompleteRef.current) {
        handleAIResponseComplete();
      }
      return;
    }

    isPlayingRef.current = true;
    const pcm16 = audioQueueRef.current.shift()!;
    const audioContext = audioContextRef.current;

    // Convert PCM16 to Float32 with proper normalization
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) {
      // Proper PCM16 to float conversion
      float32[i] = pcm16[i] / (pcm16[i] < 0 ? 32768 : 32767);
    }

    // Create audio buffer
    const audioBuffer = audioContext.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    
    // Track this source so we can stop it on interrupt
    scheduledSourcesRef.current.push(source);
    
    // Clean up ended sources from tracking array
    source.onended = () => {
      const index = scheduledSourcesRef.current.indexOf(source);
      if (index > -1) {
        scheduledSourcesRef.current.splice(index, 1);
      }
    };
    
    // Add low-pass filter to remove high-frequency noise/artifacts
    const lowpassFilter = audioContext.createBiquadFilter();
    lowpassFilter.type = 'lowpass';
    lowpassFilter.frequency.value = 8000; // Cut off at 10kHz
    lowpassFilter.Q.value = 0.7; // Gentle rolloff
    
    source.connect(lowpassFilter);
    lowpassFilter.connect(audioContext.destination);
    
    // Calculate precise timing for seamless playback
    const currentTime = audioContext.currentTime;
    let startTime;
    
    if (nextPlayTimeRef.current === 0 || nextPlayTimeRef.current < currentTime) {
      // First chunk or catching up - start immediately with small buffer
      startTime = currentTime + 0.01; // 10ms buffer
    } else {
      // Schedule precisely after previous chunk
      startTime = nextPlayTimeRef.current;
    }
    
    const duration = audioBuffer.duration;
    nextPlayTimeRef.current = startTime + duration;
    
    // Continue to next chunk or wait for more
    const scheduleNext = () => {
      if (audioQueueRef.current.length > 0) {
        playNextChunk();
      } else {
        // Queue is empty - wait and check again
        // Increase wait time and retries when response is complete to ensure we don't cut off the last words
        const waitTime = responseCompleteRef.current ? 100 : 150;
        let retryCount = 0;
        const maxRetries = responseCompleteRef.current ? 8 : 10;
        
        const checkForMore = () => {
          if (audioQueueRef.current.length > 0) {
            playNextChunk();
          } else if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(checkForMore, waitTime);
          } else {
            isPlayingRef.current = false;
            nextPlayTimeRef.current = 0;
            console.log('[Voice Chat] Playback finished, queue empty after', retryCount, 'retries');
            // Check if AI response is complete and unmute
            if (responseCompleteRef.current) {
              handleAIResponseComplete();
            }
          }
        };
        
        setTimeout(checkForMore, waitTime);
      }
    };
    
    // Schedule next chunk slightly before current one ends for perfect continuity
    const timeUntilEnd = (startTime + duration - audioContext.currentTime) * 1000;
    if (timeUntilEnd > 100) {
      setTimeout(scheduleNext, timeUntilEnd - 50);
    } else {
      scheduleNext();
    }
    
    source.start(startTime);
  };

  // Start new conversation
  const startNewConversation = () => {
    setConversationId(null);
    setMessages([]);
    setLocation('/voice-chat', { replace: true });
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-background overflow-hidden overscroll-none">
      {/* Static Header - Won't scroll */}
      <div className="flex-none border-b bg-background z-10 touch-none">
        <div className="p-3 md:p-4">
          <div className="flex flex-col gap-3">
            {/* Title row */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href="/">
                    <a className="flex items-center text-muted-foreground hover:text-foreground">
                      <ArrowLeft className="h-4 w-4 mr-1" />
                      <span className="text-sm hidden sm:inline">Back</span>
                    </a>
                  </Link>
                  <h1 className="text-lg md:text-xl font-semibold truncate">Voice Chat</h1>
                  <Badge variant={status === 'connected' ? 'default' : 'secondary'} className="text-xs">
                    {status}
                  </Badge>
                  {conversationId && (
                    <Badge variant="outline" className="text-xs">
                      #{conversationId}
                    </Badge>
                  )}
                </div>
                <p className="text-xs md:text-sm text-muted-foreground mt-1 hidden sm:block">
                  {conversationId 
                    ? 'Continue your voice conversation - all messages are saved' 
                    : 'Start a new voice conversation - it will be saved automatically'}
                </p>
              </div>
            </div>
            
            {/* Controls row */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Connection quality indicator (only on connected) */}
              {status === 'connected' && (
                <div className="flex items-center gap-1.5 text-xs md:text-sm px-2 py-1 bg-muted rounded-md">
                  {connectionQuality.quality === 'excellent' && <Signal className="h-3 w-3 md:h-4 md:w-4 text-green-500" />}
                  {connectionQuality.quality === 'good' && <Signal className="h-3 w-3 md:h-4 md:w-4 text-blue-500" />}
                  {connectionQuality.quality === 'fair' && <SignalMedium className="h-3 w-3 md:h-4 md:w-4 text-yellow-500" />}
                  {connectionQuality.quality === 'poor' && <SignalLow className="h-3 w-3 md:h-4 md:w-4 text-red-500" />}
                  <span className="text-muted-foreground">
                    {connectionQuality.latency > 0 ? `${connectionQuality.latency}ms` : '---'}
                  </span>
                </div>
              )}
              
              {/* Mute button (only on connected) */}
              {status === 'connected' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsMuted(!isMuted)}
                  title={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                  className="h-9"
                >
                  {isMuted ? <MicOff className="h-4 w-4 mr-1.5" /> : <Mic className="h-4 w-4 mr-1.5" />}
                  <span className="hidden sm:inline">{isMuted ? 'Unmuted' : 'Mute'}</span>
                </Button>
              )}
              
              {/* New conversation button (when connected and has conversation) */}
              {status === 'connected' && conversationId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    disconnect();
                    startNewConversation();
                  }}
                  className="h-9"
                >
                  New Chat
                </Button>
              )}
              
              {/* Main action button */}
              <div className="flex-1 sm:flex-none sm:ml-auto">
                {status === 'disconnected' || status === 'error' ? (
                  <Button onClick={connect} className="w-full sm:w-auto h-9">
                    {conversationId ? 'Resume' : 'Connect'}
                  </Button>
                ) : status === 'connecting' ? (
                  <Button disabled className="w-full sm:w-auto h-9">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Connecting...
                  </Button>
                ) : (
                  <Button variant="destructive" onClick={disconnect} className="w-full sm:w-auto h-9">
                    Disconnect
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto overscroll-y-none touch-pan-y">
          <div className="p-3 md:p-4 space-y-3">
            {/* Error alert */}
            {error && (
              <Alert variant="destructive" className="text-sm">
                <AlertDescription className="whitespace-pre-line">{error}</AlertDescription>
              </Alert>
            )}

            {/* Tool call alert */}
            {currentToolCall && (
              <Alert className="text-sm">
                <Wrench className="h-4 w-4" />
                <AlertDescription>
                  Executing: <code className="font-mono text-xs">{currentToolCall}</code>
                </AlertDescription>
              </Alert>
            )}

            {/* Messages */}
            <div className="space-y-3 pb-4">
              {messages.length === 0 && status === 'disconnected' && !conversationId && (
                <div className="text-center text-muted-foreground py-12">
                  <Mic className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm md:text-base">Click Connect to start a voice conversation</p>
                  <p className="text-xs text-muted-foreground mt-2">Your conversation will be saved automatically</p>
                </div>
              )}
              
              {messages.length === 0 && status === 'connected' && (
                <div className="text-center text-muted-foreground py-12">
                  <Mic className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="text-sm md:text-base">Start speaking to begin the conversation</p>
                </div>
              )}

              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] sm:max-w-[80%] rounded-lg p-3 ${
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : message.role === 'tool'
                        ? 'bg-muted text-muted-foreground'
                        : 'bg-secondary'
                    }`}
                  >
                    {message.role === 'tool' && (
                      <div className="flex items-center gap-2 mb-1">
                        <Wrench className="h-3 w-3" />
                        <span className="text-xs font-mono">{message.toolName}</span>
                      </div>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                    <p className="text-xs opacity-70 mt-1">
                      {message.timestamp.toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Static Bottom Status Bar (only when connected) */}
        {status === 'connected' && (
          <div className="flex-none border-t bg-background z-10 touch-none">
            <div className="p-3 md:p-4">
              {/* Show interrupt button when AI is speaking - tap as fallback, or speak to interrupt */}
              {isAISpeaking ? (
                <button
                  onClick={handleManualInterrupt}
                  className="w-full flex flex-col items-center justify-center gap-2 p-4 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 active:from-orange-700 active:to-amber-700 text-white rounded-lg transition-colors touch-manipulation"
                >
                  <div className="flex items-center gap-3">
                    <Volume2 className="h-6 w-6 animate-pulse" />
                    <span className="text-lg font-medium">AI Speaking</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm opacity-90">
                    <Mic className="h-4 w-4" />
                    <span>Speak or tap to interrupt</span>
                  </div>
                </button>
              ) : (
                <div className="flex items-center justify-between gap-3 p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {isRecording && !isMuted && (
                      <>
                        <div className="flex items-center gap-2 text-xs md:text-sm flex-shrink-0">
                          <Mic className={`h-4 w-4 ${voiceActivity > 0 ? 'text-red-500 animate-pulse' : 'text-muted-foreground'}`} />
                          <span className="hidden sm:inline">{voiceActivity > 0 ? 'Speaking...' : 'Listening...'}</span>
                        </div>
                        <div className="flex-1 max-w-xs hidden sm:block">
                          <Progress value={Math.min(voiceActivity, 100)} className="h-2" />
                        </div>
                      </>
                    )}
                    {isMuted && (
                      <div className="flex items-center gap-2 text-xs md:text-sm text-muted-foreground">
                        <MicOff className="h-4 w-4" />
                        <span>Microphone muted</span>
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground text-right flex-shrink-0 hidden md:block">
                    <div>↑ {connectionQuality.packetsSent}</div>
                    <div>↓ {connectionQuality.packetsReceived}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
