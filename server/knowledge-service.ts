import path from 'path';
import fs from 'fs';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { knowledgeSources, knowledgeContent, conversationKnowledge } from '../db/schema';
import type { SelectKnowledgeSource } from '../db/schema';
import { extractTextFromFile, isImageFile } from './file-handler';
import { eq, and, or, desc, asc } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

// Constants for knowledge sources management
const KNOWLEDGE_DIR = 'uploads/knowledge';
const MAX_DIRECT_CONTENT_SIZE = 50000; // Character limit for direct content embedding
const DEFAULT_CHUNK_SIZE = 1000; // Default chunk size in characters
const DEFAULT_CHUNK_OVERLAP = 200; // Default overlap between chunks in characters

// Ensure the knowledge directory exists
try {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  }
} catch (err) {
  console.error('Error creating knowledge directory:', err);
}

// Types for knowledge source operations
export interface CreateKnowledgeSourceFileOptions {
  userId: number;
  name: string;
  description?: string;
  file: Express.Multer.File;
  useRag?: boolean;
}

export interface CreateKnowledgeSourceTextOptions {
  userId: number;
  name: string;
  description?: string;
  text: string;
  useRag?: boolean;
}

export interface CreateKnowledgeSourceUrlOptions {
  userId: number;
  name: string;
  description?: string;
  url: string;
  useRag?: boolean;
}

/**
 * Creates a knowledge source from an uploaded file
 */
export async function createKnowledgeSourceFromFile(options: CreateKnowledgeSourceFileOptions) {
  const { userId, name, description, file, useRag = false } = options;

  try {
    // Generate a unique filename
    const uniqueId = nanoid();
    const ext = path.extname(file.originalname).toLowerCase();
    const fileName = `${uniqueId}${ext}`;
    const filePath = path.join(KNOWLEDGE_DIR, fileName);

    // Move file to knowledge directory
    fs.renameSync(file.path, filePath);

    // Get file size
    const fileSize = fs.statSync(filePath).size;

    // Extract text content from file
    let contentText = '';
    let isProcessed = false;

    // Check if it's an image file
    if (isImageFile(file.originalname)) {
      contentText = `[Image file: ${file.originalname}]`;
      isProcessed = true;
    } else {
      // Process document for text
      try {
        contentText = await extractTextFromFile(filePath);
        isProcessed = true;
      } catch (error: any) {
        console.error('Error extracting text from file:', error);
        contentText = `[Error extracting text: ${error.message || 'Unknown error'}]`;
        isProcessed = false;
      }
    }

    // Create knowledge source record
    const [knowledgeSource] = await db.insert(knowledgeSources).values({
      user_id: userId,
      name,
      description,
      source_type: 'file',
      file_path: filePath,
      file_type: file.mimetype,
      file_size: fileSize,
      content_text: contentText,
      is_processed: isProcessed,
      use_rag: useRag,
      metadata: {
        originalName: file.originalname,
      },
    }).returning();

    // If RAG is enabled, process for chunking
    if (useRag && isProcessed && contentText.length > 0) {
      await processTextForChunks(knowledgeSource.id, contentText);
    }

    return knowledgeSource;
  } catch (error) {
    console.error('Error creating knowledge source from file:', error);
    throw error;
  }
}

/**
 * Creates a knowledge source from pasted text
 */
export async function createKnowledgeSourceFromText(options: CreateKnowledgeSourceTextOptions) {
  const { userId, name, description, text, useRag = false } = options;

  try {
    // Create knowledge source record
    const [knowledgeSource] = await db.insert(knowledgeSources).values({
      user_id: userId,
      name,
      description,
      source_type: 'text',
      content_text: text,
      is_processed: true,
      use_rag: useRag,
    }).returning();

    // If RAG is enabled, process for chunking
    if (useRag && text.length > 0) {
      await processTextForChunks(knowledgeSource.id, text);
    }

    return knowledgeSource;
  } catch (error) {
    console.error('Error creating knowledge source from text:', error);
    throw error;
  }
}

/**
 * Creates a knowledge source from a URL by:
 * 1. Fetching the URL content
 * 2. Parsing HTML to extract text
 * 3. Storing the extracted content
 */
export async function createKnowledgeSourceFromUrl(options: CreateKnowledgeSourceUrlOptions) {
  const { userId, name, description, url, useRag = false } = options;
  
  try {
    // Import axios and cheerio here to prevent issues with circular dependencies
    const axios = await import('axios');
    const cheerio = await import('cheerio');

    // Set a user agent to avoid blocking by some websites
    const response = await axios.default.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KnowledgeBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml'
      },
      timeout: 10000 // 10 second timeout
    });

    // Get content type to handle different types of content
    const contentType = response.headers['content-type'] || '';
    let contentText = '';
    let isProcessed = false;
    let title = '';

    // Process HTML content if it's a webpage
    if (contentType.includes('text/html')) {
      const $ = cheerio.load(response.data);
      
      // Get the page title
      title = $('title').text().trim();
      
      // Remove script and style elements that aren't needed for content
      $('script, style, meta, link, noscript, iframe, svg').remove();
      
      // Extract text content from the body
      contentText = $('body')
        .text()
        .replace(/\s+/g, ' ')  // Replace multiple whitespace with single space
        .replace(/\n+/g, '\n') // Replace multiple newlines with single newline
        .trim();
        
      // Add the title at the top if available
      if (title) {
        contentText = `# ${title}\n\n${contentText}`;
      }
      
      isProcessed = true;
    } 
    // Handle plain text content
    else if (contentType.includes('text/plain')) {
      contentText = response.data;
      isProcessed = true;
    }
    // For other content types, store the content type but don't process
    else {
      contentText = `[Content of type: ${contentType}]`;
      isProcessed = false;
    }

    // Create knowledge source record
    const [knowledgeSource] = await db.insert(knowledgeSources).values({
      user_id: userId,
      name,
      description,
      source_type: 'url',
      url,
      content_text: contentText,
      is_processed: isProcessed,
      use_rag: useRag,
      metadata: {
        contentType,
        title: title || null,
        fetchedAt: new Date().toISOString(),
      },
    }).returning();

    // If RAG is enabled and content was successfully processed, process it for chunks
    if (useRag && isProcessed && contentText.length > 0) {
      await processTextForChunks(knowledgeSource.id, contentText);
    }

    return knowledgeSource;
  } catch (error) {
    console.error('Error creating knowledge source from URL:', error);
    
    // Create a record even if fetching fails to show the error to the user
    const [knowledgeSource] = await db.insert(knowledgeSources).values({
      user_id: userId,
      name,
      description,
      source_type: 'url',
      url,
      content_text: `[Error fetching URL content: ${error.message || 'Unknown error'}]`,
      is_processed: false,
      use_rag: useRag,
      metadata: {
        error: error.message || 'Unknown error',
        fetchAttemptAt: new Date().toISOString(),
      },
    }).returning();
    
    return knowledgeSource;
  }
}

/**
 * Processes text into chunks for RAG
 */
export async function processTextForChunks(knowledgeSourceId: number, text: string, chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP) {
  try {
    // Split text into paragraphs
    const paragraphs = text.split(/\n\s*\n/);
    
    // Create chunks - this is a simple chunking strategy
    // A more sophisticated approach would respect semantic boundaries
    const chunks: string[] = [];
    let currentChunk = '';
    
    for (const paragraph of paragraphs) {
      if (currentChunk.length + paragraph.length + 1 <= chunkSize) {
        // Add paragraph to current chunk
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      } else {
        // Current chunk is full, start a new one
        if (currentChunk) {
          chunks.push(currentChunk);
          
          // Start new chunk with overlap from previous chunk
          const words = currentChunk.split(' ');
          if (words.length > overlap / 5) { // Approximate words for overlap
            currentChunk = words.slice(-Math.floor(overlap / 5)).join(' ');
          } else {
            currentChunk = '';
          }
        }
        
        // Add paragraph to the new chunk
        currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
      }
    }
    
    // Add the last chunk if not empty
    if (currentChunk) {
      chunks.push(currentChunk);
    }
    
    // Store chunks in the database
    for (let i = 0; i < chunks.length; i++) {
      await db.insert(knowledgeContent).values({
        knowledge_source_id: knowledgeSourceId,
        chunk_index: i,
        content: chunks[i],
        metadata: {
          chunkSize,
          overlap,
        },
      });
    }
    
    // Update knowledge source with total chunks
    await db.update(knowledgeSources)
      .set({ total_chunks: chunks.length })
      .where(eq(knowledgeSources.id, knowledgeSourceId));
    
    return chunks.length;
  } catch (error) {
    console.error('Error processing text for chunks:', error);
    throw error;
  }
}

/**
 * Gets all knowledge sources for a user
 */
export async function getKnowledgeSources(userId: number) {
  try {
    return await db.query.knowledgeSources.findMany({
      where: eq(knowledgeSources.user_id, userId),
      orderBy: (knowledgeSources, { desc }) => [desc(knowledgeSources.created_at)],
    });
  } catch (error) {
    console.error('Error getting knowledge sources:', error);
    throw error;
  }
}

/**
 * Gets a knowledge source by ID for a specific user
 */
export async function getKnowledgeSource(userId: number, id: number) {
  try {
    return await db.query.knowledgeSources.findFirst({
      where: and(
        eq(knowledgeSources.id, id),
        eq(knowledgeSources.user_id, userId)
      ),
      with: {
        chunks: {
          orderBy: (knowledgeContent, { asc }) => [asc(knowledgeContent.chunk_index)],
        },
      },
    });
  } catch (error) {
    console.error('Error getting knowledge source:', error);
    throw error;
  }
}

/**
 * Deletes a knowledge source
 */
export async function deleteKnowledgeSource(userId: number, id: number) {
  try {
    // Get the knowledge source to check file path
    const source = await db.query.knowledgeSources.findFirst({
      where: and(
        eq(knowledgeSources.id, id),
        eq(knowledgeSources.user_id, userId)
      ),
    });
    
    if (!source) {
      throw new Error('Knowledge source not found');
    }
    
    // Delete file if it exists
    if (source.file_path && fs.existsSync(source.file_path)) {
      fs.unlinkSync(source.file_path);
    }
    
    // Delete the knowledge source (chunks will be automatically deleted due to foreign key constraints)
    await db.delete(knowledgeSources)
      .where(and(
        eq(knowledgeSources.id, id),
        eq(knowledgeSources.user_id, userId)
      ));
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting knowledge source:', error);
    throw error;
  }
}

/**
 * Associates a knowledge source with a conversation
 */
export async function addKnowledgeToConversation(conversationId: number, knowledgeSourceId: number) {
  try {
    // Check if the association already exists
    const existing = await db.query.conversationKnowledge.findFirst({
      where: and(
        eq(conversationKnowledge.conversation_id, conversationId),
        eq(conversationKnowledge.knowledge_source_id, knowledgeSourceId)
      ),
    });
    
    if (existing) {
      return existing;
    }
    
    // Create the association
    const [association] = await db.insert(conversationKnowledge).values({
      conversation_id: conversationId,
      knowledge_source_id: knowledgeSourceId,
    }).returning();
    
    return association;
  } catch (error) {
    console.error('Error adding knowledge source to conversation:', error);
    throw error;
  }
}

/**
 * Removes a knowledge source association from a conversation
 */
export async function removeKnowledgeFromConversation(conversationId: number, knowledgeSourceId: number) {
  try {
    await db.delete(conversationKnowledge)
      .where(and(
        eq(conversationKnowledge.conversation_id, conversationId),
        eq(conversationKnowledge.knowledge_source_id, knowledgeSourceId)
      ));
    
    return { success: true };
  } catch (error) {
    console.error('Error removing knowledge source from conversation:', error);
    throw error;
  }
}

/**
 * Gets all knowledge sources for a conversation
 */
export async function getConversationKnowledge(conversationId: number) {
  try {
    const associations = await db.query.conversationKnowledge.findMany({
      where: eq(conversationKnowledge.conversation_id, conversationId),
      with: {
        knowledgeSource: true,
      },
    });
    
    return associations.map(a => a.knowledgeSource);
  } catch (error) {
    console.error('Error getting conversation knowledge sources:', error);
    throw error;
  }
}

/**
 * Prepares knowledge content for use in a conversation
 * Depending on the size and RAG setting, either returns full content or relevant chunks
 * Returns an object containing the content and sources used
 */
export async function prepareKnowledgeContentForConversation(conversationId: number, query?: string) {
  try {
    // Get all knowledge sources for the conversation
    const sources = await getConversationKnowledge(conversationId);
    
    if (!sources || sources.length === 0) {
      return { content: '', usedSources: [] };
    }
    
    let content = '';
    const usedSources: { id: number; name: string }[] = [];
    
    for (const source of sources) {
      // Add each source to the usedSources array
      usedSources.push({ id: source.id, name: source.name });
      
      if (source.use_rag && source.total_chunks > 0 && query) {
        // Use RAG to find relevant chunks
        // This is a simple implementation - would use vector search in production
        const chunks = await db.query.knowledgeContent.findMany({
          where: eq(knowledgeContent.knowledge_source_id, source.id),
          orderBy: (knowledgeContent, { asc }) => [asc(knowledgeContent.chunk_index)],
        });
        
        if (chunks.length > 0) {
          // Add source header
          content += `\n\n### ${source.name}:\n`;
          
          // For now, just include the first few chunks as a simple approach
          // In a real RAG system, we would use embeddings and vector search
          const relevantChunks = chunks.slice(0, Math.min(3, chunks.length));
          
          for (const chunk of relevantChunks) {
            content += `${chunk.content}\n\n`;
          }
        }
      } else if (source.content_text) {
        // Use full content text
        content += `\n\n### ${source.name}:\n${source.content_text}\n\n`;
      }
    }
    
    return { content, usedSources };
  } catch (error) {
    console.error('Error preparing knowledge content for conversation:', error);
    throw error;
  }
}