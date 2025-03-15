import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

class SpeechService {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private synthesizer: sdk.SpeechSynthesizer | null = null;
  private speechConfig: sdk.SpeechConfig | null = null;
  private isListening = false;
  private isInitialized = false;
  private initializationPromise: Promise<void>;
  private hasMicrophonePermission = false;

  constructor() {
    this.initializationPromise = this.initialize();
  }

  private async initialize() {
    try {
      const response = await fetch('/api/speech-credentials');
      if (!response.ok) throw new Error('Failed to fetch speech credentials');
      const { key, region } = await response.json();
      
      if (!key || !region) {
        console.error('Invalid speech credentials received from server');
        throw new Error('Invalid speech credentials');
      }
      
      console.log(`Initializing speech services with region: ${region}`);
      this.speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
      this.speechConfig.speechRecognitionLanguage = "en-US";
      this.speechConfig.speechSynthesisLanguage = "en-US"; 
      this.speechConfig.speechSynthesisVoiceName = "en-US-AriaNeural"; // Use a high-quality neural voice
      
      // Set output format for better browser compatibility
      this.speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;
      
      try {
        // Initialize only the synthesizer initially (doesn't require mic permission)
        // Default audio output to the default speaker device
        const audioConfig = sdk.AudioConfig.fromDefaultSpeakerOutput();
        console.log("Creating speech synthesizer with audio output configuration");
        this.synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, audioConfig);
        console.log("Speech synthesizer created successfully");
      } catch (synthError) {
        console.error('Error creating speech synthesizer:', synthError);
        // We'll attempt to create it on-demand in the speak method if needed
        this.synthesizer = null;
      }
      
      this.isInitialized = true;
      console.log("Speech service initialization complete");
    } catch (error) {
      console.error('Error initializing speech service:', error);
      throw error;
    }
  }
  
  async checkMicrophonePermission(): Promise<boolean> {
    if (this.hasMicrophonePermission) return true;
    
    try {
      // This will trigger the browser's permission dialog
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // If we get here, permission was granted
      this.hasMicrophonePermission = true;
      
      // Clean up the stream since we don't need it right now
      stream.getTracks().forEach(track => track.stop());
      
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      this.hasMicrophonePermission = false;
      return false;
    }
  }

  async startListening(onResult: (text: string) => void): Promise<void> {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }
    
    // Check for microphone permission first
    const hasPermission = await this.checkMicrophonePermission();
    if (!hasPermission) {
      throw new Error('Microphone permission is required for speech recognition');
    }
    
    // Create recognizer if we don't have one yet
    if (!this.recognizer && this.speechConfig) {
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      this.recognizer = new sdk.SpeechRecognizer(this.speechConfig, audioConfig);
    }
    
    if (!this.recognizer || this.isListening) return;

    this.isListening = true;
    
    this.recognizer.recognized = (s, e) => {
      if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
        onResult(e.result.text);
      }
    };

    return new Promise((resolve, reject) => {
      this.recognizer!.startContinuousRecognitionAsync(
        () => {
          console.log("Speech recognition started");
          resolve();
        },
        (error) => {
          this.isListening = false;
          console.error("Error starting speech recognition:", error);
          reject(error);
        }
      );
    });
  }

  async stopListening(): Promise<void> {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (!this.recognizer || !this.isListening) return;

    this.isListening = false;
    return new Promise((resolve, reject) => {
      this.recognizer!.stopContinuousRecognitionAsync(
        () => {
          console.log("Speech recognition stopped");
          resolve();
        },
        (error) => {
          console.error("Error stopping speech recognition:", error);
          reject(error);
        }
      );
    });
  }

  async speak(text: string): Promise<void> {
    if (!this.isInitialized) {
      console.log("Speech service not initialized, initializing now...");
      await this.initializationPromise;
    }

    // Recreate synthesizer if it doesn't exist
    if (!this.synthesizer && this.speechConfig) {
      console.log("Creating synthesizer...");
      const audioConfig = sdk.AudioConfig.fromDefaultSpeakerOutput();
      this.synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, audioConfig);
      console.log("Synthesizer created successfully");
    } else if (!this.synthesizer) {
      console.error("Failed to create synthesizer - speech config is not available");
      throw new Error("Speech synthesizer could not be created");
    }
    
    console.log("Starting text-to-speech synthesis...");
    
    // Limit text length to avoid long synthesis times and potential errors
    const maxLength = 2000;
    const truncatedText = text.length > maxLength ? text.substring(0, maxLength) + "..." : text;

    return new Promise((resolve, reject) => {
      try {
        this.synthesizer!.speakTextAsync(
          truncatedText,
          (result) => {
            if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
              console.log("Text-to-speech synthesis completed successfully");
              resolve();
            } else if (result.reason === sdk.ResultReason.Canceled) {
              const cancellationDetails = sdk.CancellationDetails.fromResult(result);
              console.error(`Speech synthesis canceled: ${cancellationDetails.reason}`);
              if (cancellationDetails.reason === sdk.CancellationReason.Error) {
                console.error(`Error details: ${cancellationDetails.errorDetails}`);
              }
              reject(new Error(`Speech synthesis canceled: ${cancellationDetails.reason}`));
            } else {
              console.error(`Speech synthesis failed with reason: ${result.reason}`);
              reject(new Error(`Speech synthesis failed: ${result.errorDetails || "Unknown error"}`));
            }
          },
          (error) => {
            console.error("Speech synthesis error:", error);
            reject(error);
          }
        );
      } catch (error) {
        console.error("Exception during speech synthesis:", error);
        reject(error);
      }
    });
  }

  async dispose(): Promise<void> {
    if (!this.isInitialized) {
      await this.initializationPromise;
    }

    if (this.recognizer) {
      await new Promise<void>((resolve) => {
        this.recognizer!.close(resolve);
      });
      this.recognizer = null;
    }
    
    if (this.synthesizer) {
      await new Promise<void>((resolve) => {
        this.synthesizer!.close(resolve);
      });
      this.synthesizer = null;
    }
    
    this.isInitialized = false;
  }
}

export const speechService = new SpeechService();