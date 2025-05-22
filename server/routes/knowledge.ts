import express, { Request, Response } from 'express';
import multer from 'multer';
import { 
  createKnowledgeSourceFromFile, 
  createKnowledgeSourceFromText,
  createKnowledgeSourceFromUrl,
  getKnowledgeSources,
  getKnowledgeSource,
  deleteKnowledgeSource,
  addKnowledgeToConversation,
  removeKnowledgeFromConversation,
  getConversationKnowledge,
  updateKnowledgeSourceText
} from '../knowledge-service';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index';
import { 
  knowledgeSources, 
  knowledgeContent, 
  conversationKnowledge 
} from '../../db/schema';

const router = express.Router();

// Configure temp storage for uploads
const upload = multer({
  dest: 'uploads/temp',
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB max for knowledge files
  },
  fileFilter: (req, file, cb) => {
    // Allow various document types
    const allowedMimes = [
      // Documents
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.oasis.opendocument.text', // .odt
      'application/rtf', // .rtf
      'text/plain', // .txt
      
      // Spreadsheets
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.oasis.opendocument.spreadsheet', // .ods
      'text/csv', // .csv
      
      // Presentations
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'application/vnd.oasis.opendocument.presentation', // .odp
      
      // Text formats
      'text/markdown',
      'text/html',
      'application/json',
      
      // Images (limited support)
      'image/jpeg', 
      'image/png',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
      return cb(new Error('Only document files are allowed for knowledge sources'));
    }
  }
});

// Create a knowledge source from a file upload
router.post('/file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const { name, description } = req.body;
    const useRag = req.body.useRag === 'true' || req.body.useRag === true;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const knowledgeSource = await createKnowledgeSourceFromFile({
      userId: req.user.id,
      name,
      description,
      file: req.file,
      useRag
    });
    
    res.status(201).json(knowledgeSource);
  } catch (error: any) {
    console.error('Error creating knowledge source from file:', error);
    res.status(500).json({ error: error.message || 'Failed to create knowledge source' });
  }
});

// Create a knowledge source from text input
router.post('/text', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const { name, description, text } = req.body;
    const useRag = req.body.useRag === 'true' || req.body.useRag === true;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!text) {
      return res.status(400).json({ error: 'Text content is required' });
    }
    
    const knowledgeSource = await createKnowledgeSourceFromText({
      userId: req.user.id,
      name,
      description,
      text,
      useRag
    });
    
    res.status(201).json(knowledgeSource);
  } catch (error: any) {
    console.error('Error creating knowledge source from text:', error);
    res.status(500).json({ error: error.message || 'Failed to create knowledge source' });
  }
});

// Create a knowledge source from a URL
router.post('/url', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const { name, description, url } = req.body;
    const useRag = req.body.useRag === 'true' || req.body.useRag === true;
    
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const knowledgeSource = await createKnowledgeSourceFromUrl({
      userId: req.user.id,
      name,
      description,
      url,
      useRag
    });
    
    res.status(201).json(knowledgeSource);
  } catch (error: any) {
    console.error('Error creating knowledge source from URL:', error);
    res.status(500).json({ error: error.message || 'Failed to create knowledge source' });
  }
});

// Get all knowledge sources for the current user
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const sources = await getKnowledgeSources(req.user.id);
    res.json(sources);
  } catch (error: any) {
    console.error('Error getting knowledge sources:', error);
    res.status(500).json({ error: error.message || 'Failed to get knowledge sources' });
  }
});

// Get a specific knowledge source
router.get('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    
    const source = await getKnowledgeSource(req.user.id, id);
    
    if (!source) {
      return res.status(404).json({ error: 'Knowledge source not found' });
    }
    
    res.json(source);
  } catch (error: any) {
    console.error('Error getting knowledge source:', error);
    res.status(500).json({ error: error.message || 'Failed to get knowledge source' });
  }
});

// Delete a knowledge source
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid ID' });
    }
    
    // Delete in this order:
    // 1. conversation_knowledge (join table)
    // 2. knowledge_content (chunks)
    // 3. knowledge_sources (main record)
    await db.transaction(async (tx) => {
      // Delete conversation associations
      await tx.delete(conversationKnowledge)
        .where(eq(conversationKnowledge.knowledge_source_id, id));
      
      // Delete content chunks
      await tx.delete(knowledgeContent)
        .where(eq(knowledgeContent.knowledge_source_id, id));
      
      // Finally delete the knowledge source itself
      const result = await tx.delete(knowledgeSources)
        .where(eq(knowledgeSources.id, id))
        .returning();
        
      return result;
    });
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting knowledge source:', error);
    res.status(500).json({ error: error.message || 'Failed to delete knowledge source' });
  }
});

// Add a knowledge source to a conversation
router.post('/conversation/:conversationId', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const conversationId = parseInt(req.params.conversationId);
    const { knowledgeSourceId } = req.body;
    
    if (isNaN(conversationId) || !knowledgeSourceId) {
      return res.status(400).json({ error: 'Invalid conversation ID or knowledge source ID' });
    }
    
    const association = await addKnowledgeToConversation(conversationId, knowledgeSourceId);
    res.status(201).json(association);
  } catch (error: any) {
    console.error('Error adding knowledge source to conversation:', error);
    res.status(500).json({ error: error.message || 'Failed to add knowledge source to conversation' });
  }
});

// Remove a knowledge source from a conversation
router.delete('/conversation/:conversationId/:knowledgeSourceId', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const conversationId = parseInt(req.params.conversationId);
    const knowledgeSourceId = parseInt(req.params.knowledgeSourceId);
    
    if (isNaN(conversationId) || isNaN(knowledgeSourceId)) {
      return res.status(400).json({ error: 'Invalid conversation ID or knowledge source ID' });
    }
    
    const result = await removeKnowledgeFromConversation(conversationId, knowledgeSourceId);
    res.json(result);
  } catch (error: any) {
    console.error('Error removing knowledge source from conversation:', error);
    res.status(500).json({ error: error.message || 'Failed to remove knowledge source from conversation' });
  }
});

// Get all knowledge sources for a conversation
router.get('/conversation/:conversationId', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const conversationId = parseInt(req.params.conversationId);
    
    if (isNaN(conversationId)) {
      return res.status(400).json({ error: 'Invalid conversation ID' });
    }
    
    const sources = await getConversationKnowledge(conversationId);
    res.json(sources);
  } catch (error: any) {
    console.error('Error getting conversation knowledge sources:', error);
    res.status(500).json({ error: error.message || 'Failed to get conversation knowledge sources' });
  }
});

// Update a text knowledge source
router.put('/text/:id', async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: 'User not authenticated' });
    }
    
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid knowledge source ID' });
    }
    
    const { name, description, text, useRag } = req.body;
    
    const knowledgeSource = await updateKnowledgeSourceText({
      userId: req.user.id,
      id,
      name,
      description,
      text,
      useRag: useRag === 'true' || useRag === true
    });
    
    res.json(knowledgeSource);
  } catch (error: any) {
    console.error('Error updating knowledge source:', error);
    res.status(500).json({ error: error.message || 'Failed to update knowledge source' });
  }
});

export default router;