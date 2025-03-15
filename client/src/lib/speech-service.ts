import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

class SpeechService {
  private recognizer: sdk.SpeechRecognizer | null = null;
  private synthesizer: sdk.SpeechSynthesizer | null = null;
  private isListening = false;
  private isInitialized = false;
  private initializationPromise: Promise<void>;

  constructor() {
    this.initializationPromise = this.initialize();
  }

  private async initialize() {
    try {
      const response = await fetch('/api/speech-credentials');
      if (!response.ok) throw new Error('Failed to fetch speech credentials');
      const { key, region } = await response.json();
      
      const speechConfig = sdk.SpeechConfig.fromSubscription(key, region);
      speechConfig.speechRecognitionLanguage = "en-US";
      
      const audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
      this.recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
      this.synthesizer = new sdk.SpeechSynthesizer(speechConfig);
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing speech service:', error);
      throw error;
    }
  }

  async startListening(onResult: (text: string) => void): Promise<void> {
    if (!this.isInitialized) {
      await this.initializationPromise;
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
      await this.initializationPromise;
    }

    if (!this.synthesizer) return;

    return new Promise((resolve, reject) => {
      this.synthesizer!.speakTextAsync(
        text,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve();
          } else {
            reject(new Error(`Speech synthesis failed: ${result.errorDetails}`));
          }
        },
        (error) => {
          reject(error);
        }
      );
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