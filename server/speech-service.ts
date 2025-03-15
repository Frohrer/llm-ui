import * as sdk from 'microsoft-cognitiveservices-speech-sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// @ts-ignore
import fluent from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

// Set ffmpeg path
fluent.setFfmpegPath(ffmpegStatic as unknown as string);

// Validate speech service configuration
if (!process.env.SPEECH_KEY || !process.env.SPEECH_REGION) {
  console.error('Azure Speech Service configuration missing. Please set SPEECH_KEY and SPEECH_REGION environment variables.');
}

// Lazily create speech config when needed to ensure environment variables are loaded
function createSpeechConfig() {
  // Configure Azure Speech Service
  const config = sdk.SpeechConfig.fromSubscription(
    process.env.SPEECH_KEY!, 
    process.env.SPEECH_REGION!
  );
  
  // Set speech recognition language
  config.speechRecognitionLanguage = 'en-US';
  
  return config;
}

// Export for use in routes
let speechConfig: sdk.SpeechConfig | null = null;

// Initialize speech config as needed
function getSpeechConfig(): sdk.SpeechConfig {
  if (!speechConfig) {
    speechConfig = createSpeechConfig();
    // Configure Azure Speech Synthesis
    speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';
  }
  
  // This should never happen, but TypeScript doesn't know that
  if (!speechConfig) {
    throw new Error('Failed to initialize speech config');
  }
  
  return speechConfig;
}

export async function transcribeAudioBuffer(audioBuffer: Buffer): Promise<string> {
  try {
    // Create a temporary file path
    const tempRawFile = path.join(os.tmpdir(), `speech-${Date.now()}.wav`);
    
    // Write the buffer to a file
    fs.writeFileSync(tempRawFile, audioBuffer);
    
    // Create an audio config from the temp file
    // For SDK compatibility, use Buffer.from for the file input
    const audioConfig = sdk.AudioConfig.fromWavFileInput(Buffer.from(fs.readFileSync(tempRawFile)));
    
    // Create speech recognizer
    const recognizer = new sdk.SpeechRecognizer(getSpeechConfig(), audioConfig);
    
    return new Promise((resolve, reject) => {
      // Start recognition
      recognizer.recognizeOnceAsync(
        (result) => {
          // Clean up temp file
          try {
            fs.unlinkSync(tempRawFile);
          } catch (e) {
            console.warn('Failed to clean up temp file:', e);
          }
          
          // Handle recognition result
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            resolve(result.text);
          } else {
            console.log(`Speech recognition failed: ${result.reason}`);
            reject(new Error(`Recognition failed: ${result.reason}`));
          }
          
          // Close recognizer
          recognizer.close();
        },
        (err) => {
          // Clean up temp file
          try {
            fs.unlinkSync(tempRawFile);
          } catch (e) {
            console.warn('Failed to clean up temp file:', e);
          }
          
          console.error('Speech recognition error:', err);
          reject(err);
          
          // Close recognizer
          recognizer.close();
        }
      );
    });
  } catch (error) {
    console.error('Error in transcribeAudioBuffer:', error);
    throw new Error(`Speech recognition failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function synthesizeSpeech(text: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      // Create the speech synthesizer
      const synthesizer = new sdk.SpeechSynthesizer(getSpeechConfig());
      
      // Start speech synthesis
      synthesizer.speakTextAsync(
        text,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            resolve(Buffer.from(result.audioData));
          } else {
            console.error(`Speech synthesis failed: ${result.reason}`);
            reject(new Error(`Synthesis failed: ${result.reason}`));
          }
          
          // Close synthesizer
          synthesizer.close();
        },
        (error) => {
          console.error('Speech synthesis error:', error);
          reject(error);
          
          // Close synthesizer
          synthesizer.close();
        }
      );
    } catch (error) {
      console.error('Error in synthesizeSpeech:', error);
      reject(new Error(`Speech synthesis failed: ${error instanceof Error ? error.message : 'Unknown error'}`));
    }
  });
}

// Function to convert Web Audio API buffer to proper format for Azure
export async function convertAudioBuffer(audioBuffer: Buffer, sampleRate: number = 16000): Promise<Buffer> {
  try {
    // Create temporary files
    const tempInputFile = path.join(os.tmpdir(), `input-${Date.now()}.raw`);
    const tempOutputFile = path.join(os.tmpdir(), `output-${Date.now()}.wav`);
    
    // Write the buffer to the input file
    fs.writeFileSync(tempInputFile, audioBuffer);
    
    // Return a Promise to convert the audio using ffmpeg
    return new Promise((resolve, reject) => {
      fluent(tempInputFile)
        .inputOptions([
          `-f s16le`,
          `-ar ${sampleRate}`,
          `-ac 1`
        ])
        .output(tempOutputFile)
        .audioCodec('pcm_s16le')
        .on('end', () => {
          // Read the converted file
          const wavBuffer = fs.readFileSync(tempOutputFile);
          
          // Clean up temp files
          try {
            fs.unlinkSync(tempInputFile);
            fs.unlinkSync(tempOutputFile);
          } catch (e) {
            console.warn('Failed to clean up temp files:', e);
          }
          
          resolve(wavBuffer);
        })
        .on('error', (err: any) => {
          console.error('Error converting audio:', err);
          
          // Clean up temp files
          try {
            if (fs.existsSync(tempInputFile)) fs.unlinkSync(tempInputFile);
            if (fs.existsSync(tempOutputFile)) fs.unlinkSync(tempOutputFile);
          } catch (e) {
            console.warn('Failed to clean up temp files:', e);
          }
          
          reject(new Error(`Audio conversion failed: ${err.message}`));
        })
        .run();
    });
  } catch (error) {
    console.error('Error in convertAudioBuffer:', error);
    throw new Error(`Audio conversion failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}