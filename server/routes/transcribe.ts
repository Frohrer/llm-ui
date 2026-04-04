import express, { Request, Response } from 'express';
import { getOpenAIClient } from './providers/openai';
import multer from 'multer';
import { toFile } from 'openai';

const router = express.Router();

// 25MB limit for audio files
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/', upload.single('audio'), async (req: Request, res: Response) => {
  try {
    const client = getOpenAIClient();
    if (!client) {
      return res.status(503).json({ error: 'OpenAI client not initialized. Check OPENAI_API_KEY.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const file = await toFile(req.file.buffer, 'audio.webm', { type: req.file.mimetype });

    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      language: 'en',
    });

    res.json({ text: transcription.text });
  } catch (error) {
    console.error('Transcription error:', error);
    res.status(500).json({ error: 'Transcription failed' });
  }
});

export default router;
