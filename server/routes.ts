import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { loadProviderConfigs } from "./config/loader";
import { cloudflareAuthMiddleware } from "./middleware/auth";
import { 
  uploadSingleMiddleware, 
  uploadMultipleMiddleware, 
  handleUploadErrors, 
  extractTextFromFile, 
  isImageFile,
  cleanupDocumentFile,
  cleanupImageFile
} from "./file-handler";
import knowledgeRoutes from "./routes/knowledge";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "./knowledge-service";
import type { SQL } from "drizzle-orm";

// Load provider configurations at startup
let providerConfigs: Awaited<ReturnType<typeof loadProviderConfigs>>;
loadProviderConfigs()
  .then((configs) => {
    providerConfigs = configs;
  })
  .catch((error) => {
    console.error("Failed to load provider configurations:", error);
    process.exit(1);
  });

// Initialize API clients based on available API keys
const clients: Record<string, any> = {};

// OpenAI client initialization
if (process.env.OPENAI_API_KEY) {
  clients.openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Anthropic client initialization
if (process.env.ANTHROPIC_API_KEY) {
  clients.anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// DeepSeek client initialization
if (process.env.DEEPSEEK_API_KEY) {
  clients.deepseek = new OpenAI({
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
}

// Gemini client initialization
if (process.env.GEMINI_API_KEY) {
  clients.gemini = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

export function registerRoutes(app: Express): Server {
  // Speech credentials route
  app.get('/api/speech-credentials', (req, res) => {
    res.json({
      key: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION
    });
  });
  // Apply authentication middleware to all /api routes
  app.use("/api", cloudflareAuthMiddleware);

  // Add endpoint to get current user info
  app.get("/api/user", (req, res) => {
    res.json(req.user);
  });

  // Add provider configurations endpoint - only return providers with available API keys
  app.get("/api/providers", async (_req, res) => {
    try {
      if (!providerConfigs) {
        providerConfigs = await loadProviderConfigs();
      }

      // Filter providers based on available API keys
      const availableProviders = providerConfigs.filter((provider) => {
        switch (provider.id) {
          case "openai":
            return !!clients.openai;
          case "anthropic":
            return !!clients.anthropic;
          case "deepseek":
            return !!clients.deepseek;
          case "gemini":
            return !!clients.gemini;
          default:
            return false;
        }
      });

      res.json(availableProviders);
    } catch (error) {
      console.error("Error fetching provider configurations:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch provider configurations" });
    }
  });

  // Modified stream handling for OpenAI endpoint (similar changes needed for other providers)
  app.post("/api/chat/openai", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "gpt-4",
        attachment = null,
        allAttachments = [],
        useKnowledge = false,
        pendingKnowledgeSources = [],
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }
      
      console.log(`Processing message with ${allAttachments.length} attachments for OpenAI`);

      // Set up SSE headers with keep-alive
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "openai",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        // Add any pending knowledge sources to the new conversation
        if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
          console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to new conversation ${newConversation.id}`);
          
          for (const knowledgeSourceId of pendingKnowledgeSources) {
            try {
              await addKnowledgeToConversation(newConversation.id, knowledgeSourceId);
            } catch (error) {
              console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
            }
          }
        }

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Process attachments based on type
      let stream;
      const maxRetries = 3;
      let retryCount = 0;
      
      // Get all attachments (prioritize the allAttachments array if it exists)
      const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
      
      console.log(`Processing ${allAttachmentsToProcess.length} attachments for OpenAI`);
      
      // Variables to track attachment types
      let hasImageAttachment = false;
      let imageAttachmentContent = null;
      let documentTexts: string[] = [];
      
      // Process each attachment
      for (const att of allAttachmentsToProcess) {
        // Handle image attachments
        if (att.type === 'image') {
          try {
            console.log("Processing image attachment for OpenAI:", att.url);
            
            // Extract filename from URL
            const fileName = att.url.split('/').pop();
            if (!fileName) {
              throw new Error('Invalid image URL');
            }
            
            // Determine the image path
            const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
            
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
              throw new Error('Image file not found on server');
            }
            
            // Read the image as base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            const dataUri = `data:${mimeType};base64,${base64Image}`;
            
            // Save for later use
            imageAttachmentContent = { 
              type: "image_url", 
              image_url: { url: dataUri } 
            };
            
            hasImageAttachment = true;
            console.log("Image successfully processed for OpenAI");
            
            // Delete the file after processing
            cleanupImageFile(att.url);
          } catch (imageError) {
            console.error("Error processing image for OpenAI:", imageError);
            // Add error to document texts
            if (imageError instanceof Error) {
              documentTexts.push(`[Image processing failed: ${imageError.message}]`);
            } else {
              documentTexts.push('[Image processing failed: Unknown error]');
            }
          }
        } 
        // Handle document attachments
        else if (att.type === 'document' && att.text) {
          console.log(`Processing document attachment for OpenAI: ${att.name}`);
          documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
          
          // Clean up the document file
          if (att.url) {
            cleanupDocumentFile(att.url);
          }
        }
      }
      
      // Get knowledge content if requested
      let knowledgeContent = '';
      if (useKnowledge && dbConversation) {
        try {
          knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message, apiMessages);
          if (knowledgeContent) {
            console.log("Retrieved knowledge content for conversation");
          }
        } catch (knowledgeError) {
          console.error("Error retrieving knowledge content:", knowledgeError);
        }
      }

      // Create the message content based on what we have
      if (hasImageAttachment) {
        // For OpenAI, we use a different format with content array
        let contentArray: any[] = [];
        
        // Add text first with any document content
        let textContent = message;
        if (documentTexts.length > 0) {
          textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        // Add knowledge content if available
        if (knowledgeContent) {
          textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        contentArray.push({ type: "text", text: textContent });
        
        // Add the image
        if (imageAttachmentContent) {
          contentArray.push(imageAttachmentContent);
        }
        
        apiMessages.push({
          role: "user",
          content: contentArray
        });
        
        console.log("Multimodal message with image, documents, and knowledge added for OpenAI");
      } 
      else if (documentTexts.length > 0 || knowledgeContent) {
        // Text-only message with documents or knowledge
        let userContent = message;
        
        if (documentTexts.length > 0) {
          userContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        if (knowledgeContent) {
          userContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        apiMessages.push({ role: "user", content: userContent });
        console.log("Message with document/knowledge content added for OpenAI");
      } 
      else {
        // Regular text message without attachments or knowledge
        apiMessages.push({ role: "user", content: message });
        console.log("Plain text message added for OpenAI");
      }

      // Stream the completion with retries

      while (retryCount < maxRetries) {
        try {
          stream = await clients.openai.chat.completions.create({
            messages: apiMessages,
            model,
            stream: true,
            max_completion_tokens: 4096, // Increased from 2048 to 4096
            temperature: 0.7,
          });
          console.log("Stream created with model:", model); //Added logging
          break;
        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          ); // Exponential backoff
        }
      }

      if (!stream) {
        throw new Error("Failed to create stream after retries");
      }

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      // Set up keep-alive interval
      const keepAliveInterval = setInterval(() => {
        res.write(": keep-alive\n\n");
      }, 15000); // Send keep-alive every 15 seconds

      try {
        let lastChunkTime = Date.now();
        const chunkTimeout = 30000; // 30 seconds timeout between chunks

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            streamedResponse += content;
            lastChunkTime = Date.now();
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
            );
            if (res.flush) res.flush();
          }

          // Check for timeout between chunks
          if (Date.now() - lastChunkTime > chunkTimeout) {
            throw new Error("Stream timeout - no data received for 30 seconds");
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.response?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
      } finally {
        clearInterval(keepAliveInterval);
        res.end();
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Update Anthropic chat endpoint to use streaming
  app.post("/api/chat/anthropic", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "claude-3-5-sonnet-20241022",
        attachment = null,
        allAttachments = [],
        useKnowledge = false,
        pendingKnowledgeSources = [],
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }
      
      console.log(`Processing message with ${allAttachments.length} attachments for Anthropic`);

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "anthropic",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });
        // Add any pending knowledge sources to the new conversation
        if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
          console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to new conversation ${newConversation.id}`);
          
          for (const knowledgeSourceId of pendingKnowledgeSources) {
            try {
              await addKnowledgeToConversation(newConversation.id, knowledgeSourceId);
            } catch (error) {
              console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
            }
          }
        }

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Get all attachments (prioritize the allAttachments array if it exists)
      const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
      
      console.log(`Processing ${allAttachmentsToProcess.length} attachments for Anthropic`);
      
      // Variables to track attachment types
      let hasImageAttachment = false;
      let imageAttachmentContent = null;
      let documentTexts: string[] = [];
      
      // Get knowledge content if requested
      let knowledgeContent = '';
      if (useKnowledge && dbConversation) {
        try {
          knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message, apiMessages);
          if (knowledgeContent) {
            console.log("Retrieved knowledge content for conversation");
          }
        } catch (knowledgeError) {
          console.error("Error retrieving knowledge content:", knowledgeError);
        }
      }
      
      // Process each attachment
      for (const att of allAttachmentsToProcess) {
        // Handle image attachments
        if (att.type === 'image') {
          try {
            console.log("Processing image attachment for Anthropic:", att.url);
            
            // Extract filename from URL
            const fileName = att.url.split('/').pop();
            if (!fileName) {
              throw new Error('Invalid image URL');
            }
            
            // Determine the image path
            const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
            
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
              throw new Error('Image file not found on server');
            }
            
            // Read the image as base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            
            // Save image data for later use
            imageAttachmentContent = {
              type: "image",
              source: {
                type: "base64",
                media_type: mimeType,
                data: base64Image
              }
            };
            
            hasImageAttachment = true;
            console.log("Image successfully processed for Anthropic");
            
            // Delete the file after processing
            cleanupImageFile(att.url);
          } catch (imageError) {
            console.error("Error processing image for Anthropic:", imageError);
            // Add error to document texts
            documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
          }
        } 
        // Handle document attachments
        else if (att.type === 'document' && att.text) {
          console.log(`Processing document attachment: ${att.name}`);
          documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
          
          // Clean up the document file
          if (att.url) {
            cleanupDocumentFile(att.url);
          }
        }
      }
      
      // Create the message content based on what we have
      if (hasImageAttachment) {
        // For Anthropic, we need a special content structure
        let contentArray: any[] = [];
        
        // Add the image first
        if (imageAttachmentContent) {
          contentArray.push(imageAttachmentContent);
        }
        
        // Combine document texts with user message
        let textContent = message;
        if (documentTexts.length > 0) {
          textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        // Add knowledge content if available
        if (knowledgeContent) {
          textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        // Add the text part
        contentArray.push({
          type: "text",
          text: textContent
        });
        
        apiMessages.push({
          role: "user",
          content: contentArray
        });
        
        console.log("Multimodal message with image, documents, and knowledge added for Anthropic");
      } 
      else if (documentTexts.length > 0 || knowledgeContent) {
        // Text-only message with documents or knowledge
        let userContent = message;
        
        if (documentTexts.length > 0) {
          userContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        if (knowledgeContent) {
          userContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        apiMessages.push({ role: "user", content: userContent });
        console.log("Message with document/knowledge content added for Anthropic");
      } 
      else {
        // Regular text message without attachments or knowledge
        apiMessages.push({ role: "user", content: message });
        console.log("Plain text message added for Anthropic");
      }

      // Stream the completion
      const stream = await clients.anthropic.messages.create({
        messages: apiMessages,
        model,
        max_tokens: 4096, // Increased from 1024 to 4096
        temperature: 0.7,
        stream: true,
      });
      console.log("Anthropic stream created with model:", model);

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.text) {
            streamedResponse += chunk.delta.text;
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content: chunk.delta.text })}\n\n`,
            );
            if (res.flush) res.flush();
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );

        res.end();
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.completion?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
        res.end();
        return;
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Add DeepSeek chat endpoint with streaming
  app.post("/api/chat/deepseek", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "deepseek-chat",
        attachment = null,
        allAttachments = [],
        useKnowledge = false,
        pendingKnowledgeSources = [],
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "deepseek",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });
        // Add any pending knowledge sources to the new conversation
        if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
          console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to new conversation ${newConversation.id}`);
          
          for (const knowledgeSourceId of pendingKnowledgeSources) {
            try {
              await addKnowledgeToConversation(newConversation.id, knowledgeSourceId);
            } catch (error) {
              console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
            }
          }
        }

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      // Get all attachments (prioritize the allAttachments array if it exists)
      const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
      
      console.log(`Processing ${allAttachmentsToProcess.length} attachments for DeepSeek`);
      
      // Variables to track attachment types
      let hasImageAttachment = false;
      let imageAttachmentContent = null;
      let documentTexts: string[] = [];
      
      // Get knowledge content if requested
      let knowledgeContent = '';
      if (useKnowledge && dbConversation) {
        try {
          knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message, apiMessages);
          if (knowledgeContent) {
            console.log("Retrieved knowledge content for conversation");
          }
        } catch (knowledgeError) {
          console.error("Error retrieving knowledge content:", knowledgeError);
        }
      }
      
      // Process each attachment
      for (const att of allAttachmentsToProcess) {
        // Handle image attachments
        if (att.type === 'image') {
          try {
            console.log("Processing image attachment for DeepSeek:", att.url);
            
            // Extract filename from URL
            const fileName = att.url.split('/').pop();
            if (!fileName) {
              throw new Error('Invalid image URL');
            }
            
            // Determine the image path
            const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
            
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
              throw new Error('Image file not found on server');
            }
            
            // Read the image as base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            const dataUri = `data:${mimeType};base64,${base64Image}`;
            
            // Save for later use
            imageAttachmentContent = { 
              type: "image_url", 
              image_url: { url: dataUri } 
            };
            
            hasImageAttachment = true;
            console.log("Image successfully processed for DeepSeek");
            
            // Delete the file after processing
            cleanupImageFile(att.url);
          } catch (imageError) {
            console.error("Error processing image for DeepSeek:", imageError);
            // Add error to document texts
            documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
          }
        } 
        // Handle document attachments
        else if (att.type === 'document' && att.text) {
          console.log(`Processing document attachment for DeepSeek: ${att.name}`);
          documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
          
          // Clean up the document file
          if (att.url) {
            cleanupDocumentFile(att.url);
          }
        }
      }
      
      // Create the message content based on what we have
      if (hasImageAttachment) {
        // For DeepSeek, we use a different format with content array
        let contentArray: any[] = [];
        
        // Add text first with any document content
        let textContent = message;
        if (documentTexts.length > 0) {
          textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        // Add knowledge content if available
        if (knowledgeContent) {
          textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        contentArray.push({ type: "text", text: textContent });
        
        // Add the image
        if (imageAttachmentContent) {
          contentArray.push(imageAttachmentContent);
        }
        
        apiMessages.push({
          role: "user",
          content: contentArray
        });
        
        console.log("Multimodal message with image, documents, and knowledge added for DeepSeek");
      } 
      else if (documentTexts.length > 0 || knowledgeContent) {
        // Text-only message with documents or knowledge
        let userContent = message;
        
        if (documentTexts.length > 0) {
          userContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
        }
        
        if (knowledgeContent) {
          userContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
        }
        
        apiMessages.push({ role: "user", content: userContent });
        console.log("Message with document/knowledge content added for DeepSeek");
      } 
      else {
        // Regular text message without attachments or knowledge
        apiMessages.push({ role: "user", content: message });
        console.log("Plain text message added for DeepSeek");
      }

      // Stream the completion using DeepSeek
      const stream = await clients.deepseek.chat.completions.create({
        messages: apiMessages,
        model,
        stream: true,
        max_tokens: 4096, // Increased token limit
        temperature: 0.7,
      });

      console.log("DeepSeek stream created with model:", model);

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            streamedResponse += content;
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
            );
            if (res.flush) res.flush();
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );

        res.end();
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.response?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
        res.end();
        return;
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Rest of the routes (conversations endpoints)
  app.delete("/api/conversations/:id", async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }
      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId),
      });
      if (!conversation || conversation.user_id !== req.user!.id) {
        return res
          .status(404)
          .json({ error: "Conversation not found or unauthorized" });
      }
      await db
        .delete(messages)
        .where(eq(messages.conversation_id, conversationId));
      await db
        .delete(conversations)
        .where(eq(conversations.id, conversationId));
      res.json({ success: true });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  app.get("/api/conversations", async (req, res) => {
    try {
      const result = await db.query.conversations.findMany({
        where: eq(conversations.user_id, req.user!.id),
        orderBy: (conversations, { desc }) => [
          desc(conversations.last_message_at),
        ],
        with: {
          messages: true,
        },
      });
      const transformedConversations = result.map((conv) =>
        transformDatabaseConversation(conv),
      );
      res.json(transformedConversations);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id", async (req, res) => {
    try {
      const result = await db.query.conversations.findFirst({
        where: eq(conversations.id, parseInt(req.params.id)),
        with: {
          messages: true,
        },
      });

      if (!result) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (result.user_id !== req.user!.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const transformedConversation = transformDatabaseConversation(result);
      res.json(transformedConversation);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // File upload endpoint
  // Single file upload endpoint
  app.post('/api/upload', uploadSingleMiddleware, handleUploadErrors, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const filePath = req.file.path;
      const fileName = path.basename(filePath);
      
      // Determine if this is an image based on mimetype (more reliable than file extension)
      const isImage = req.file.mimetype.startsWith('image/');
      
      // Construct the URL path correctly
      let folderName = isImage ? 'images' : 'documents';
      const fileUrl = `/uploads/${folderName}/${fileName}`;
      
      // Ensure file is accessible by checking its existence
      if (!fs.existsSync(filePath)) {
        console.error(`File does not exist at path: ${filePath}`);
        return res.status(500).json({ error: 'File upload was not saved correctly' });
      }
      
      // For images, just return the URL since we'll process them with AI on the client
      if (isImage) {
        return res.json({
          success: true,
          file: {
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            url: fileUrl,
            isImage: true
          }
        });
      }
      
      // For documents, extract the text
      try {
        const extractedText = await extractTextFromFile(filePath);
        
        // If text extraction failed or text is very short, return a warning but still proceed
        if (!extractedText || extractedText.length < 10) {
          console.warn(`Document text extraction issue for file: ${req.file.originalname}`);
          return res.json({
            success: true,
            file: {
              name: req.file.originalname,
              type: req.file.mimetype,
              size: req.file.size,
              url: fileUrl,
              isImage: false,
              text: `[Document: ${req.file.originalname}]`
            },
            warning: 'Document contained little or no extractable text'
          });
        }
      
        return res.json({
          success: true,
          file: {
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            url: fileUrl,
            isImage: false,
            text: extractedText
          }
        });
      } catch (docError) {
        console.error('Error processing document:', docError);
        return res.json({
          success: true,
          file: {
            name: req.file.originalname,
            type: req.file.mimetype,
            size: req.file.size,
            url: fileUrl,
            isImage: false,
            text: `[Document: ${req.file.originalname} - Could not extract text]`
          },
          warning: 'Failed to extract text from document'
        });
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      return res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to upload file' 
      });
    }
  });

  // Multiple files upload endpoint
  app.post('/api/upload-batch', uploadMultipleMiddleware, handleUploadErrors, async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const results = [];
      const filePromises = [];

      // Process each file in the batch
      for (const file of req.files as Express.Multer.File[]) {
        const filePath = file.path;
        const fileName = path.basename(filePath);
        
        // Determine if this is an image based on mimetype
        const isImage = file.mimetype.startsWith('image/');
        
        // Construct the URL path correctly
        const folderName = isImage ? 'images' : 'documents';
        const fileUrl = `/uploads/${folderName}/${fileName}`;
        
        // Ensure file is accessible by checking its existence
        if (!fs.existsSync(filePath)) {
          console.error(`File does not exist at path: ${filePath}`);
          results.push({
            success: false,
            name: file.originalname,
            error: 'File upload was not saved correctly'
          });
          continue;
        }
        
        // For images, just return the URL
        if (isImage) {
          results.push({
            success: true,
            file: {
              name: file.originalname,
              type: file.mimetype,
              size: file.size,
              url: fileUrl,
              isImage: true
            }
          });
          continue;
        }
        
        // For documents, extract the text (async)
        const processDocumentPromise = extractTextFromFile(filePath)
          .then(extractedText => {
            // If text extraction failed or text is very short, provide a warning
            if (!extractedText || extractedText.length < 10) {
              console.warn(`Document text extraction issue for file: ${file.originalname}`);
              results.push({
                success: true,
                file: {
                  name: file.originalname,
                  type: file.mimetype,
                  size: file.size,
                  url: fileUrl,
                  isImage: false,
                  text: `[Document: ${file.originalname}]`
                },
                warning: 'Document contained little or no extractable text'
              });
            } else {
              results.push({
                success: true,
                file: {
                  name: file.originalname,
                  type: file.mimetype,
                  size: file.size,
                  url: fileUrl,
                  isImage: false,
                  text: extractedText
                }
              });
            }
          })
          .catch(docError => {
            console.error('Error processing document:', docError);
            results.push({
              success: true,
              file: {
                name: file.originalname,
                type: file.mimetype,
                size: file.size,
                url: fileUrl,
                isImage: false,
                text: `[Document: ${file.originalname} - Could not extract text]`
              },
              warning: 'Failed to extract text from document'
            });
          });
        
        filePromises.push(processDocumentPromise);
      }
      
      // Wait for all document processing to complete
      await Promise.all(filePromises);
      
      // Return results for all files
      return res.json({
        success: true,
        files: results
      });
    } catch (error) {
      console.error('Error uploading files:', error);
      return res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to upload files' 
      });
    }
  });

  // Serve uploaded files with improved security and reliability
  app.use('/uploads', (req, res, next) => {
    // Check for user authentication, but allow in-app requests that have session
    // We'll skip auth check for images, but keep it for documents to maintain security
    const isImageRequest = req.url.includes('/images/');
    
    // For image requests OR authenticated users, allow access
    if (isImageRequest || req.user) {
      return next();
    }
    
    // If we get here, it's a document request without authentication
    return res.status(401).json({ error: 'Unauthorized' });
  }, (req, res, next) => {
    try {
      // Get the requested path
      let requestedPath = req.url;
      
      // Normalize the path to prevent directory traversal attacks
      const normalizedPath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, '');
      
      // Construct the full path to the requested file
      const uploadPath = path.join(process.cwd(), 'uploads', normalizedPath);
      
      // Check if the path exists and is a file
      if (fs.existsSync(uploadPath) && fs.statSync(uploadPath).isFile()) {
        // Set appropriate content type based on file extension
        const ext = path.extname(uploadPath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.pdf': 'application/pdf',
          '.txt': 'text/plain',
          '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        // If we know the MIME type, set it
        if (mimeTypes[ext]) {
          res.setHeader('Content-Type', mimeTypes[ext]);
        }
        
        // Add cache control headers for better performance
        res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 1 day
        return res.sendFile(uploadPath);
      }
      
      // If we get here, the file doesn't exist or isn't a file
      return res.status(404).json({ error: 'File not found' });
    } catch (error) {
      console.error('Error serving file:', error);
      return res.status(500).json({ error: 'Server error' });
    }
  });

  // Handle image analysis
  app.post('/api/analyze-image', async (req, res) => {
    try {
      const { imageUrl, provider = 'openai' } = req.body;
      
      if (!imageUrl) {
        return res.status(400).json({ error: 'No image URL provided' });
      }
      
      // Extract filename from URL
      const fileName = imageUrl.split('/').pop();
      if (!fileName) {
        return res.status(400).json({ error: 'Invalid image URL' });
      }
      
      // Determine the image path
      const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
      
      // Check if file exists
      if (!fs.existsSync(imagePath)) {
        return res.status(404).json({ error: 'Image not found' });
      }
      
      // Read the image as base64
      const imageBuffer = fs.readFileSync(imagePath);
      const base64Image = imageBuffer.toString('base64');
      const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
      const dataUri = `data:${mimeType};base64,${base64Image}`;
      
      let result;
      
      // Use the appropriate provider for image analysis
      if (provider === 'openai' && clients.openai) {
        // Analyze the image with OpenAI
        try {
          const response = await clients.openai.chat.completions.create({
            model: 'gpt-4-vision-preview',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'What is shown in this image? Provide a detailed description.' },
                  { type: 'image_url', image_url: { url: dataUri } }
                ]
              }
            ],
            max_tokens: 1000
          });
          
          result = response.choices[0]?.message?.content || 'No analysis available';
        } catch (error) {
          console.error('Error analyzing image with OpenAI:', error);
          return res.status(500).json({ error: 'Failed to analyze image with OpenAI' });
        }
      } else if (provider === 'anthropic' && clients.anthropic) {
        // Analyze the image with Anthropic
        try {
          const response = await clients.anthropic.messages.create({
            model: 'claude-3-opus-20240229',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: 'What is shown in this image? Provide a detailed description.' },
                  { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } }
                ]
              }
            ],
            max_tokens: 1000
          });
          
          result = response.content[0]?.text || 'No analysis available';
        } catch (error) {
          console.error('Error analyzing image with Anthropic:', error);
          return res.status(500).json({ error: 'Failed to analyze image with Anthropic' });
        }
      } else {
        return res.status(400).json({ error: 'No valid provider available for image analysis' });
      }
      
      return res.json({ success: true, analysis: result });
    } catch (error) {
      console.error('Error analyzing image:', error);
      return res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Failed to analyze image' 
      });
    }
  });

  // Gemini chat endpoint
  app.post("/api/chat/gemini", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "gemini-1.5-pro",
        attachment = null,
        allAttachments = [],
        useKnowledge = false,
        pendingKnowledgeSources = [],
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Set up SSE headers with keep-alive
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "gemini",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });
        // Add any pending knowledge sources to the new conversation
        if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
          console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to new conversation ${newConversation.id}`);
          
          for (const knowledgeSourceId of pendingKnowledgeSources) {
            try {
              await addKnowledgeToConversation(newConversation.id, knowledgeSourceId);
            } catch (error) {
              console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
            }
          }
        }

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Get the Gemini model
      const genModel = clients.gemini.getGenerativeModel({ model });
      
      // Process the current message parts (including attachments)
      const currentMessageParts = [];
      
      // Get all attachments (prioritize the allAttachments array if it exists)
      const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
      
      console.log(`Processing ${allAttachmentsToProcess.length} attachments for Gemini`);
      
      // Variables to track attachment types
      let hasImageAttachment = false;
      let imageAttachmentData = [];
      let documentTexts: string[] = [];
      
      // Get knowledge content if requested
      let knowledgeContent = '';
      if (useKnowledge && dbConversation) {
        try {
          knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message, apiMessages);
          if (knowledgeContent) {
            console.log("Retrieved knowledge content for Gemini conversation");
            documentTexts.push("Knowledge Content:\n" + knowledgeContent);
          }
        } catch (knowledgeError) {
          console.error("Error retrieving knowledge content for Gemini:", knowledgeError);
        }
      }
      
      // Process each attachment
      for (const att of allAttachmentsToProcess) {
        // Handle image attachments
        if (att.type === 'image') {
          try {
            console.log("Processing image attachment for Gemini:", att.url);
            
            // Extract filename from URL
            const fileName = att.url.split('/').pop();
            if (!fileName) {
              throw new Error('Invalid image URL');
            }
            
            // Determine the image path
            const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
            
            // Check if file exists
            if (!fs.existsSync(imagePath)) {
              throw new Error('Image file not found on server');
            }
            
            // Read the image as base64
            const imageBuffer = fs.readFileSync(imagePath);
            const base64Image = imageBuffer.toString('base64');
            const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
            
            // Save image data for later use
            imageAttachmentData.push({
              inlineData: {
                data: base64Image,
                mimeType
              }
            });
            
            hasImageAttachment = true;
            console.log("Image successfully processed for Gemini");
            
            // Delete the file after processing
            cleanupImageFile(att.url);
          } catch (imageError) {
            console.error("Error processing image for Gemini:", imageError);
            // Add error to document texts
            documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
          }
        } 
        // Handle document attachments
        else if (att.type === 'document' && att.text) {
          console.log(`Processing document attachment for Gemini: ${att.name}`);
          documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
          
          // Clean up the document file
          if (att.url) {
            cleanupDocumentFile(att.url);
          }
        }
      }
      
      // Add the text part first with any document content
      let textContent = message;
      if (documentTexts.length > 0) {
        textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
      }
      
      // Add text content
      currentMessageParts.push({ text: textContent });
      
      // Add any image attachments
      for (const imgData of imageAttachmentData) {
        currentMessageParts.push(imgData);
      }
      
      console.log(`Sending Gemini message with ${currentMessageParts.length} parts (text + ${imageAttachmentData.length} images)`);
      

      // Build conversation history for the chat
      let chatHistory = [];
      
      // Fetch previous messages for this conversation if it exists
      if (conversationId) {
        const previousMessages = await db.query.messages.findMany({
          where: eq(messages.conversation_id, dbConversation.id),
          orderBy: (messages, { asc }) => [asc(messages.created_at)],
        });
        
        // Transform messages to Gemini format
        for (const msg of previousMessages) {
          if (msg.role === "user") {
            chatHistory.push({
              role: "user",
              parts: [{ text: msg.content }]
            });
          } else if (msg.role === "assistant") {
            chatHistory.push({
              role: "model",
              parts: [{ text: msg.content }]
            });
          }
        }
      }

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`
      );

      // Set up keep-alive interval
      const keepAliveInterval = setInterval(() => {
        res.write(": keep-alive\n\n");
      }, 15000); // Send keep-alive every 15 seconds

      try {
        // Start a chat session with history if we have previous messages
        const chat = genModel.startChat({
          history: chatHistory.slice(0, -1), // Exclude the last user message as we'll send it separately
        });
        
        console.log("Gemini chat created with model:", model, "and history length:", chatHistory.length);
        
        // Send the current message and stream the response
        const result = await chat.sendMessageStream(currentMessageParts);
        
        for await (const chunk of result.stream) {
          const content = chunk.text();
          if (content) {
            streamedResponse += content;
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content })}\n\n`
            );
            if (res.flush) res.flush();
          }
        }

        // Save the complete response
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`
        );
      } catch (streamError) {
        console.error("Streaming error with Gemini:", streamError);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`
        );
      } finally {
        clearInterval(keepAliveInterval);
        res.end();
      }
    } catch (error) {
      console.error("Error with Gemini API:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`
      );
      res.end();
    }
  });

  // Register Knowledge source routes
  app.use('/api/knowledge', knowledgeRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
