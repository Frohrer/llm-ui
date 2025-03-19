import express, { Express, Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { Server, createServer } from "http";
import { OpenAI } from "openai";
import { CloudflareOneClient } from "cloudflare-one";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Anthropic from "@anthropic-ai/sdk";
import {
  transformDatabaseConversation
} from "../client/src/lib/llm/types";
import { db } from "db"; // Import the db object
import { and, asc, desc, eq, or } from "drizzle-orm";
import { cloudflareAuthMiddleware } from "./middleware/auth";
import { users, conversations, messages, conversationKnowledge } from "@db/schema";
import { loadProviderConfigs } from "./config/loader";
import {
  extractTextFromFile,
  uploadSingleMiddleware,
  uploadMultipleMiddleware,
  handleUploadErrors,
  isImageFile,
  cleanupDocumentFile,
  cleanupImageFile
} from "./file-handler";
import knowledgeRoutes from "./routes/knowledge";
import { addKnowledgeToConversation } from "./knowledge-service";
import { handleKnowledgePreparation } from "./knowledge-handler";
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
          // Use centralized knowledge handler to get content and show notifications
          knowledgeContent = await handleKnowledgePreparation(dbConversation.id, message, res);
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
          // Use centralized knowledge handler to get content and show notifications
          knowledgeContent = await handleKnowledgePreparation(dbConversation.id, message, res);
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
      } catch (error) {
        console.error("Streaming error:", error);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              error instanceof Error
                ? error.message
                : "Stream interrupted",
          })}\n\n`,
        );
      } finally {
        res.end();
      }
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Add DeepSeek chat endpoint for extended model support
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
      
      console.log(`Processing message with ${allAttachments.length} attachments for DeepSeek`);

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
          // Use centralized knowledge handler to get content and show notifications
          knowledgeContent = await handleKnowledgePreparation(dbConversation.id, message, res);
        } catch (knowledgeError) {
          console.error("Error retrieving knowledge content:", knowledgeError);
        }
      }
      
      // Process document attachments (DeepSeek doesn't support images currently)
      for (const att of allAttachmentsToProcess) {
        if (att.type === 'document' && att.text) {
          console.log(`Processing document attachment: ${att.name}`);
          documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
          
          // Clean up the document file
          if (att.url) {
            cleanupDocumentFile(att.url);
          }
        }
        else if (att.type === 'image') {
          // Inform that image attachments aren't supported
          console.log("Image attachments are not supported by DeepSeek, skipping:", att.url);
          documentTexts.push(`[Image attachment (${att.name || 'unnamed'}) not supported by this model]`);
          
          // Clean up the image file anyway
          if (att.url) {
            cleanupImageFile(att.url);
          }
        }
      }
      
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

      // Stream the completion with retries
      const maxRetries = 3;
      let retryCount = 0;
      let stream;

      while (retryCount < maxRetries) {
        try {
          stream = await clients.deepseek.chat.completions.create({
            messages: apiMessages,
            model,
            stream: true,
            max_tokens: 4096,
            temperature: 0.7,
          });
          console.log("Stream created with model:", model);
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
      } catch (error) {
        console.error("Streaming error:", error);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              error instanceof Error
                ? error.message
                : "Stream interrupted",
          })}\n\n`,
        );
      } finally {
        res.end();
      }
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Add Gemini chat endpoint
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
      
      console.log(`Processing message with ${allAttachments?.length || 0} attachments for Gemini`);

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
            provider: "gemini",
            model: model,
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

      // Need to process context messages in Gemini-specific format
      const geminiHistory = [];
      for (const msg of context) {
        geminiHistory.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }]
        });
      }

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
          // Use centralized knowledge handler to get content and show notifications
          knowledgeContent = await handleKnowledgePreparation(dbConversation.id, message, res);
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
            
            // Read the image - Gemini requires different handling
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Add to image data array for Gemini
            imageAttachmentData.push(imageBuffer);
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
      
      // Create content parts for the Gemini API
      let content = "";
      if (documentTexts.length > 0) {
        content += message + "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
      } else {
        content = message;
      }
      
      // Add knowledge content if available
      if (knowledgeContent) {
        content += "\n\nKnowledge Sources:\n" + knowledgeContent;
      }
      
      // Initialize the Gemini model
      let geminiModel = clients.gemini.getGenerativeModel({ model: model });
      
      const geminiGenerationConfig = {
        temperature: 0.7,
        maxOutputTokens: 4096,
        topK: 40,
        topP: 0.95,
      };
      
      // Create chat session
      const chat = geminiModel.startChat({
        history: geminiHistory,
        generationConfig: geminiGenerationConfig,
      });
      
      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );
      
      try {
        let result;
        
        // Send message with or without images
        if (hasImageAttachment && imageAttachmentData.length > 0) {
          // For messages with images, we need to use the content creation method
          console.log("Sending multimodal request to Gemini");
          
          // Construct parts array
          const parts = [];
          
          // Add text part
          parts.push({ text: content });
          
          // Add image parts
          for (const imgData of imageAttachmentData) {
            parts.push({
              inlineData: {
                data: Buffer.from(imgData).toString('base64'),
                mimeType: "image/jpeg" // Assuming JPEG, could detect from file
              }
            });
          }
          
          console.log(`Sending request with ${parts.length} parts to Gemini`);
          
          // Use generateContent instead of chat for multimodal
          result = await geminiModel.generateContentStream({ contents: [{ role: "user", parts }] });
        } else {
          // For text-only messages, use the chat session
          console.log("Sending text-only request to Gemini");
          result = await chat.sendMessageStream(content);
        }
        
        // Process the streaming response
        for await (const chunk of result.stream) {
          const chunkText = chunk.text();
          streamedResponse += chunkText;
          res.write(
            `data: ${JSON.stringify({ type: "chunk", content: chunkText })}\n\n`,
          );
          if (res.flush) res.flush();
        }
        
        // Save the complete response
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
      } catch (error) {
        console.error("Gemini API error:", error);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              error instanceof Error
                ? error.message
                : "Failed to get response from Gemini",
          })}\n\n`,
        );
      } finally {
        res.end();
      }
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  });

  // Add an endpoint to get all conversations for the current user
  app.get("/api/conversations", async (req, res) => {
    try {
      // Get all conversations for the user, ordered by lastMessageAt descending
      const userConversations = await db.query.conversations.findMany({
        where: eq(conversations.user_id, req.user!.id),
        orderBy: (conversations, { desc }) => [desc(conversations.last_message_at)],
        with: {
          messages: true,
        },
      });

      const transformedConversations = userConversations.map((conv) => transformDatabaseConversation(conv));

      res.json(transformedConversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch conversations" });
    }
  });

  // Add search endpoint for conversations
  app.get("/api/conversations/search", async (req, res) => {
    const { query } = req.query;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "Invalid query" });
    }

    try {
      // Search in conversation titles and message content
      const searchResults = await db.query.conversations.findMany({
        where: and(
          eq(conversations.user_id, req.user!.id),
          or(
            // Search for the query in the conversation title (case insensitive if your DB supports it)
            SQL`LOWER(${conversations.title}) LIKE LOWER(${"%" + query + "%"})`,
            // You would also need to do a join to search in messages content
            // This is a simplified approach and may need to be adjusted depending on your DB
            SQL`EXISTS (
              SELECT 1 FROM ${messages} 
              WHERE ${messages.conversation_id} = ${conversations.id} 
              AND LOWER(${messages.content}) LIKE LOWER(${"%" + query + "%"})
            )`
          )
        ),
        orderBy: [desc(conversations.last_message_at)],
        with: {
          messages: true,
        },
      });

      const transformedResults = searchResults.map((conv) => transformDatabaseConversation(conv));

      res.json(transformedResults);
    } catch (error) {
      console.error("Error searching conversations:", error);
      res.status(500).json({ error: "Failed to search conversations" });
    }
  });

  // Add endpoint to delete a conversation
  app.delete("/api/conversations/:id", async (req, res) => {
    const conversationId = parseInt(req.params.id);
    if (isNaN(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }

    try {
      // Verify the conversation exists and belongs to the user
      const conversation = await db.query.conversations.findFirst({
        where: and(
          eq(conversations.id, conversationId),
          eq(conversations.user_id, req.user!.id)
        ),
      });

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Delete all knowledge associations
      await db
        .delete(conversationKnowledge)
        .where(eq(conversationKnowledge.conversation_id, conversationId));

      // Delete all messages first (assuming CASCADE doesn't work)
      await db
        .delete(messages)
        .where(eq(messages.conversation_id, conversationId));

      // Then delete the conversation
      await db
        .delete(conversations)
        .where(eq(conversations.id, conversationId));

      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Upload route for files
  app.post(
    "/api/upload/file",
    uploadSingleMiddleware,
    handleUploadErrors,
    async (req: Request, res: Response) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const file = req.file;
        console.log(`Processing uploaded file: ${file.originalname}`);

        // Determine if this is an image or a document
        const fileType = isImageFile(file.path) ? "image" : "document";
        const url = `/uploads/${fileType === "image" ? "images" : "documents"}/${file.filename}`;

        // For documents, extract the text content
        let text = "";
        if (fileType === "document") {
          try {
            text = await extractTextFromFile(file.path);
            console.log(`Extracted ${text.length} characters from document`);
          } catch (extractError) {
            console.error("Error extracting text from document:", extractError);
            text = "[Error extracting text from document]";
          }
        }

        res.json({
          success: true,
          file: {
            type: fileType,
            name: file.originalname,
            url,
            text: fileType === "document" ? text : undefined,
          },
        });
      } catch (error) {
        console.error("Error processing uploaded file:", error);
        res.status(500).json({ error: "Failed to process file" });
      }
    },
  );

  // Generate system prompt route
  app.post(
    "/api/system-prompt",
    async (req: Request, res: Response) => {
      try {
        const { persona } = req.body;
        
        if (!persona || typeof persona !== "string") {
          return res.status(400).json({ error: "Invalid persona" });
        }
        
        const prompt = `As ${persona}, I will assist you with your questions and tasks.`;
        
        res.json({ prompt });
      } catch (error) {
        console.error("Error generating system prompt:", error);
        res.status(500).json({ error: "Failed to generate system prompt" });
      }
    }
  );

  // Register knowledge-specific routes
  app.use("/api/knowledge", knowledgeRoutes);

  // Don't create a new server, just return the express app
  // Let server/index.ts handle server creation and listening
  return require('http').createServer(app);
}