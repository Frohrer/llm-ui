/**
 * AudioWorklet processor for voice chat
 * Runs in the audio rendering thread for minimal latency
 * 
 * Features:
 * - Dynamic VAD threshold to allow voice interruption while preventing echo/feedback
 * - When AI is speaking, uses higher threshold to filter out echoed audio
 * - User speech (louder than echo) still gets through for interruption
 */
class VoiceInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // Optimized buffer size (reduced from 4096)
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isMuted = false;
    
    // VAD thresholds - dynamic based on AI speaking state
    this.baseThreshold = 0.01; // Normal threshold when AI is not speaking
    this.aiSpeakingThreshold = 0.08; // Higher threshold when AI is speaking (filters echo)
    this.currentThreshold = this.baseThreshold;
    this.isAISpeaking = false;
    
    this.silenceFrames = 0;
    this.maxSilenceFrames = 1000; // Very high - don't stop sending (let server VAD handle it)
    
    // Energy smoothing for more stable detection
    this.smoothedEnergy = 0;
    this.energySmoothingFactor = 0.3; // How much to weight new samples vs history

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setMuted') {
        this.isMuted = event.data.value;
      } else if (event.data.type === 'setVADThreshold') {
        this.baseThreshold = event.data.value;
        if (!this.isAISpeaking) {
          this.currentThreshold = this.baseThreshold;
        }
      } else if (event.data.type === 'setAISpeaking') {
        this.isAISpeaking = event.data.value;
        // Dynamically adjust threshold based on AI speaking state
        this.currentThreshold = this.isAISpeaking ? this.aiSpeakingThreshold : this.baseThreshold;
        console.log('[AudioProcessor] AI speaking:', this.isAISpeaking, 'threshold:', this.currentThreshold);
      } else if (event.data.type === 'setAISpeakingThreshold') {
        // Allow customizing the AI speaking threshold
        this.aiSpeakingThreshold = event.data.value;
        if (this.isAISpeaking) {
          this.currentThreshold = this.aiSpeakingThreshold;
        }
      }
    };
  }

  /**
   * Calculate audio energy for Voice Activity Detection
   */
  calculateEnergy(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
  }

  /**
   * Process audio data
   * This runs on every audio frame (~128 samples at 24kHz = ~5.3ms per frame)
   * 
   * Key behavior:
   * - When AI is NOT speaking: low threshold, all audio sent to server
   * - When AI IS speaking: high threshold, only loud audio (real user speech) sent
   *   This allows voice interruption while filtering out echo/feedback
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];

    // Check if muted (manual mute by user)
    if (this.isMuted) {
      this.silenceFrames = this.maxSilenceFrames;
      return true;
    }

    // Voice Activity Detection - check audio energy with smoothing
    const instantEnergy = this.calculateEnergy(inputChannel);
    this.smoothedEnergy = (this.energySmoothingFactor * instantEnergy) + 
                          ((1 - this.energySmoothingFactor) * this.smoothedEnergy);
    
    // Use dynamic threshold based on whether AI is speaking
    const hasVoice = this.smoothedEnergy > this.currentThreshold;

    if (hasVoice) {
      this.silenceFrames = 0;
    } else {
      this.silenceFrames++;
    }

    // Add samples to buffer
    for (let i = 0; i < inputChannel.length; i++) {
      this.buffer[this.bufferIndex++] = inputChannel[i];

      // When buffer is full, convert to PCM16 and send
      if (this.bufferIndex >= this.bufferSize) {
        const pcm16 = new Int16Array(this.bufferSize);
        
        for (let j = 0; j < this.bufferSize; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          pcm16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // When AI is speaking, only send audio if it exceeds the higher threshold
        // This filters out echo while still allowing user interruption
        const shouldSend = !this.isAISpeaking || hasVoice;
        
        if (shouldSend) {
          // Send to main thread
          this.port.postMessage({
            type: 'audioData',
            data: pcm16,
            energy: this.smoothedEnergy,
            hasVoice: hasVoice,
            isInterruption: this.isAISpeaking && hasVoice // Flag if this is an interruption
          }, [pcm16.buffer]);
        }

        this.bufferIndex = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('voice-input-processor', VoiceInputProcessor);

