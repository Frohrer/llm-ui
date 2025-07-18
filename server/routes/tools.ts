import express, { Request, Response } from 'express';
import { handleToolCalls } from '../tools';

const router = express.Router();

// Execute tools directly
router.post('/execute', async (req: Request, res: Response) => {
  try {
    const { toolCalls } = req.body;
    
    if (!toolCalls || !Array.isArray(toolCalls)) {
      return res.status(400).json({ error: 'Invalid tool calls' });
    }
    
    console.log(`Executing ${toolCalls.length} tool calls:`, toolCalls.map(t => t.name));
    
    const results = await handleToolCalls(toolCalls);
    
    res.json(results);
  } catch (error) {
    console.error('Tool execution error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error' 
    });
  }
});

export default router; 