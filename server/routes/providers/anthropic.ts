import express, { Request, Response } from 'express';
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { 
  cleanupDocumentFile,
  cleanupImageFile
} from "../../file-handler";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";

const router = express.Router();
let client: Anthropic | null = null;

// Initialize the Anthropic client
export function initializeAnthropic(apiKey?: string) {
  if (apiKey || process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
    return true;
  }
  return false;
}

// Get the Anthropic client instance
export function getAnthropicClient() {
  return client;
}

// Create or continue an Anthropic chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "claude-3-5-sonnet-latest",
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
    } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "Anthropic service not initialized" });
    }
    
    console.log(`Processing message with ${allAttachments.length} attachments for Anthropic`);

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

    // Ensure context messages are properly ordered and format for Anthropic
    const apiMessages = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      }));

    // Process attachments based on type
    let stream;
    const maxRetries = 3;
    let retryCount = 0;
    
    // Get all attachments (prioritize the allAttachments array if it exists)
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for Anthropic`);
    
    // Variables to track attachment types
    let hasImageAttachment = false;
    let imageAttachments: any[] = [];
    let documentTexts: string[] = [];
    
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
          
          // Add to image attachments array for Claude
          imageAttachments.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Image
            }
          });
          
          hasImageAttachment = true;
          console.log("Image successfully processed for Anthropic");
        } catch (imageError) {
          console.error("Error processing image for Anthropic:", imageError);
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
        console.log(`Processing document attachment for Anthropic: ${att.name}`);
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

    // Create the message based on what we have
    if (hasImageAttachment) {
      // For Anthropic with images, create a message with text and image attachments
      let textContent = message;
      
      // Add document content
      if (documentTexts.length > 0) {
        textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
      }
      
      // Add knowledge content if available
      if (knowledgeContent) {
        textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
      }
      
      // Push the user message with text and image content
      apiMessages.push({
        role: "user",
        content: [
          {
            type: "text",
            text: textContent
          },
          ...imageAttachments
        ]
      });
      
      console.log("Multimodal message with images, documents, and knowledge added for Anthropic");
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

    // Create Anthropic message stream
    console.log("Anthropic stream created with model:", model);
    
    // Stream the completion with retries
    while (retryCount < maxRetries) {
      try {
        stream = await client.messages.create({
          messages: apiMessages,
          model,
          max_tokens: 4096,
          temperature: 0.7,
          stream: true,
        });
        console.log("Anthropic stream created with model:", model);
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
        // Debug the received chunk structure - uncomment for debugging
        console.log("Anthropic chunk received type:", chunk.type);
        
        // Handle all types of content from Claude API
        if (chunk.type === 'content_block_delta') {
          const contentDelta = chunk.delta;
          if (contentDelta && typeof contentDelta.text === 'string') {
            const content = contentDelta.text;
            if (content) {
              streamedResponse += content;
              lastChunkTime = Date.now();
              res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
              if (res.flush) res.flush();
            }
          }
        } 
        else if (chunk.type === 'content_block_start') {
          const contentBlock = chunk.content_block;
          if (contentBlock && typeof contentBlock.text === 'string') {
            const content = contentBlock.text;
            if (content) {
              streamedResponse += content;
              lastChunkTime = Date.now();
              res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
              if (res.flush) res.flush();
            }
          }
        }
        else if (chunk.type === 'message_delta' && chunk.delta && chunk.delta.stop_reason) {
          // Message completion
          console.log("Anthropic message completed, reason:", chunk.delta.stop_reason);
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