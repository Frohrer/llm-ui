/**
 * AudioWorklet processor for voice chat
 * Runs in the audio rendering thread for minimal latency
 */
class VoiceInputProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048; // Optimized buffer size (reduced from 4096)
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.isMuted = false;
    this.energyThreshold = 0.01; // Voice Activity Detection threshold (for UI display only)
    this.silenceFrames = 0;
    this.maxSilenceFrames = 1000; // Very high - don't stop sending (let server VAD handle it)

    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'setMuted') {
        this.isMuted = event.data.value;
      } else if (event.data.type === 'setVADThreshold') {
        this.energyThreshold = event.data.value;
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
   */
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const inputChannel = input[0];

    // Check if muted
    if (this.isMuted) {
      this.silenceFrames = this.maxSilenceFrames;
      return true;
    }

    // Voice Activity Detection - check audio energy
    const energy = this.calculateEnergy(inputChannel);
    const hasVoice = energy > this.energyThreshold;

    if (hasVoice) {
      this.silenceFrames = 0;
    } else {
      this.silenceFrames++;
    }

    // Note: We don't skip sending silent audio - let OpenAI's server-side VAD handle turn detection
    // The silenceFrames is only used for UI feedback (voice activity indicator)

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

        // Send to main thread
        this.port.postMessage({
          type: 'audioData',
          data: pcm16,
          energy: energy,
          hasVoice: hasVoice
        }, [pcm16.buffer]);

        this.bufferIndex = 0;
      }
    }

    return true; // Keep processor alive
  }
}

registerProcessor('voice-input-processor', VoiceInputProcessor);

