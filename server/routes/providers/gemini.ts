import express, { Request, Response } from 'express';
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";

const router = express.Router();
let client: GoogleGenerativeAI | null = null;

// Initialize the Gemini client
export function initializeGemini(apiKey?: string) {
  if (apiKey || process.env.GEMINI_API_KEY) {
    client = new GoogleGenerativeAI(apiKey || process.env.GEMINI_API_KEY);
    return true;
  }
  return false;
}

// Get the Gemini client instance
export function getGeminiClient() {
  return client;
}

// Create or continue a Gemini chat conversation
router.post("/", async (req: Request, res: Response) => {
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
    
    if (!client) {
      return res.status(503).json({ error: "Gemini service not initialized" });
    }
    
    console.log(`Processing ${allAttachments.length} attachments for Gemini`);

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

    // Initialize history for the Gemini model
    const history = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => ({
        role: msg.role === "user" ? "user" : "model",
        parts: [{ text: msg.content }],
      }));

    // Process attachments based on type
    const maxRetries = 3;
    let retryCount = 0;
    
    // Get all attachments (prioritize the allAttachments array if it exists)
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for Gemini`);
    
    // Variables to track attachment types
    let hasImageAttachment = false;
    let imageParts: any[] = [];
    let documentTexts: string[] = [];
    
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
          
          // Read the image file
          const imageBuffer = fs.readFileSync(imagePath);
          
          // Add to image parts for Gemini
          imageParts.push({
            inlineData: {
              data: imageBuffer.toString('base64'),
              mimeType: path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
            }
          });
          
          hasImageAttachment = true;
          console.log("Image successfully processed for Gemini");
        } catch (imageError) {
          console.error("Error processing image for Gemini:", imageError);
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
        console.log(`Processing document attachment for Gemini: ${att.name}`);
        documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
      }
    }
    
    // Get knowledge content if requested
    let knowledgeContent = '';
    if (useKnowledge && dbConversation) {
      try {
        knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message);
        if (knowledgeContent) {
          console.log("Retrieved knowledge content for conversation");
        }
      } catch (knowledgeError) {
        console.error("Error retrieving knowledge content:", knowledgeError);
      }
    }

    // Create the user message content
    let userText = message;
    if (documentTexts.length > 0) {
      userText += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
    }
    if (knowledgeContent) {
      userText += "\n\nKnowledge Sources:\n" + knowledgeContent;
    }

    // Initialize the model with the specified model name
    const genModel = client.getGenerativeModel({ model });
    
    // Prepare for chat
    let chat;
    
    if (history.length > 0) {
      chat = genModel.startChat({
        history,
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.7,
        },
      });
      console.log("Gemini chat created with model:", model, "and history length:", history.length);
    } else {
      chat = genModel.startChat({
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.7,
        },
      });
      console.log("Gemini chat created with model:", model, "and history length: 0");
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
      // Send the message with or without images
      let result;
      
      while (retryCount < maxRetries) {
        try {
          if (hasImageAttachment && imageParts.length > 0) {
            // For image + text
            const parts = [{ text: userText }, ...imageParts];
            result = await chat.sendMessageStream(parts);
            console.log("Gemini stream created with text and images");
          } else {
            // For text only
            result = await chat.sendMessageStream(userText);
            console.log("Gemini stream created with text only");
          }
          break;
        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          ); // Exponential backoff
        }
      }

      let lastChunkTime = Date.now();
      const chunkTimeout = 30000; // 30 seconds timeout between chunks

      if (result && result.stream) {
        for await (const chunk of result.stream) {
          // Debug log the chunk structure
          console.log("Gemini chunk received:", typeof chunk, chunk);
          
          // Extract text content properly from Gemini's response format
          if (chunk) {
            // Handle different chunk formats from Gemini
            let content = '';
            
            if (typeof chunk.text === 'string') {
              content = chunk.text;
            } else if (chunk.candidates && chunk.candidates.length > 0 && chunk.candidates[0].content && 
                      chunk.candidates[0].content.parts && chunk.candidates[0].content.parts.length > 0) {
              // Extract content from candidates structure
              content = chunk.candidates[0].content.parts[0].text || '';
            }
            
            // Process non-empty content
            if (content && content.trim()) {
              streamedResponse += content;
              lastChunkTime = Date.now();
              
              // Send formatted chunk to client
              res.write(
                `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
              );
              if (res.flush) res.flush();
            }
          }
  
          // Check for timeout between chunks
          if (Date.now() - lastChunkTime > chunkTimeout) {
            throw new Error("Stream timeout - no data received for 30 seconds");
          }
        }
      } else {
        throw new Error("Failed to create Gemini stream");
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
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;