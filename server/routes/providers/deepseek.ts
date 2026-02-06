import express, { Request, Response } from 'express';
import OpenAI from "openai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { prepareContext, isContextLengthError } from "../../context-manager";

const router = express.Router();
let client: OpenAI | null = null;

// Initialize the DeepSeek client (uses OpenAI client with custom baseURL)
export function initializeDeepSeek(apiKey?: string) {
  if (apiKey || process.env.DEEPSEEK_API_KEY) {
    client = new OpenAI({
      baseURL: "https://api.deepseek.com/v1",
      apiKey: apiKey || process.env.DEEPSEEK_API_KEY,
    });
    return true;
  }
  return false;
}

// Get the DeepSeek client instance
export function getDeepSeekClient() {
  return client;
}

// Create or continue a DeepSeek chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "deepseek-chat",
      modelContextLength = 64000, // Default for DeepSeek models
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
    } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "DeepSeek service not initialized" });
    }
    
    console.log(`Processing message with ${allAttachments.length} attachments for DeepSeek`);

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

      // Save attachment metadata so it's available in future context
      const messageMetadata: any = {};
      if (allAttachments && allAttachments.length > 0) {
        messageMetadata.attachments = allAttachments;
      } else if (attachment) {
        messageMetadata.attachments = [attachment];
      }

      await db.insert(messages).values({
        conversation_id: newConversation.id,
        role: "user",
        content: message,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
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

      // Save attachment metadata so it's available in future context
      const messageMetadata: any = {};
      if (allAttachments && allAttachments.length > 0) {
        messageMetadata.attachments = allAttachments;
      } else if (attachment) {
        messageMetadata.attachments = [attachment];
      }

      await db.insert(messages).values({
        conversation_id: conversationIdNum,
        role: "user",
        content: message,
        metadata: Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined,
        created_at: timestamp,
      });

      // Add any pending knowledge sources to existing conversation (allows mid-conversation injection)
      if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
        console.log(`Adding ${pendingKnowledgeSources.length} knowledge sources to existing conversation ${conversationIdNum}`);
        
        for (const knowledgeSourceId of pendingKnowledgeSources) {
          try {
            await addKnowledgeToConversation(conversationIdNum, knowledgeSourceId);
          } catch (error) {
            console.error(`Failed to add knowledge source ${knowledgeSourceId} to conversation:`, error);
          }
        }
      }

      dbConversation = existingConversation;
    }

    // Ensure context messages are properly ordered and include attachment content
    const apiMessages = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => {
        let content = msg.content;

        // Add timestamp so LLM understands time passage between messages
        if (msg.timestamp) {
          const msgTime = new Date(msg.timestamp).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
          content = `[${msgTime}] ${content}`;
        }

        // Include attachment content from metadata for historical messages
        if (msg.metadata && msg.metadata.attachments) {
          const attachments = msg.metadata.attachments;
          const documentTexts = attachments
            .filter((att: any) => att.type === 'document' && att.text)
            .map((att: any) => `\n\n[Attached file: ${att.name}]\n${att.text}`)
            .join('\n');

          if (documentTexts) {
            content += documentTexts;
          }
        }

        return {
          role: msg.role,
          content: content,
        };
      });

    // Process attachments based on type
    let stream;
    const maxRetries = 3;
    let retryCount = 0;
    
    // Get all attachments (prioritize the allAttachments array if it exists)
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for DeepSeek`);
    
    // DeepSeek doesn't support image attachments in the same way as OpenAI, handle as text
    let documentTexts: string[] = [];
    
    // Process each attachment
    for (const att of allAttachmentsToProcess) {
      // Handle document attachments
      if (att.type === 'document' && att.text) {
        console.log(`Processing document attachment for DeepSeek: ${att.name}`);
        documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
      }
      // Handle image attachments as text descriptions
      else if (att.type === 'image') {
        try {
          console.log("Processing image attachment for DeepSeek:", att.url);
          documentTexts.push(`[Image: ${att.name || 'Uploaded image'}]`);
        } catch (imageError) {
          console.error("Error processing image for DeepSeek:", imageError);
        }
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

    // Add current timestamp to the user message so LLM understands time passage
    const currentTimeStr = `[${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC] `;

    // Create the message content based on what we have
    if (documentTexts.length > 0 || knowledgeContent) {
      // Text-only message with documents or knowledge
      let userContent = currentTimeStr + message;
      
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
      apiMessages.push({ role: "user", content: currentTimeStr + message });
      console.log("Plain text message added for DeepSeek");
    }

    // Pre-emptively manage context to avoid exceeding model limits (DeepSeek doesn't use tools)
    const { messages: contextManagedMessages, info: contextInfo } = prepareContext(
      apiMessages,
      model,
      { 
        maxTokens: modelContextLength, // Use context length from model config
        reserveForTools: 0,  // DeepSeek doesn't support tool calling
      }
    );

    // Stream the completion with retries
    while (retryCount < maxRetries) {
      try {
        stream = await client.chat.completions.create({
          messages: contextManagedMessages,
          model,
          stream: true,
          max_tokens: 4096,
          temperature: 0.7,
        });
        console.log("Stream created with model:", model);
        break;
      } catch (error: any) {
        // Check if this is a context length error
        if (isContextLengthError(error)) {
          console.log(`[DeepSeek] Context length error detected, attempting to truncate further`);
          
          // Try with more aggressive truncation
          const { messages: retriedMessages, info: retryInfo } = prepareContext(
            contextManagedMessages,
            model,
            { 
              reserveForTools: 0,
              safetyBuffer: 10000, // Larger safety buffer for retry
            }
          );
          
          if (retryInfo.wasTruncated && retryInfo.finalMessageCount >= 2) {
            contextManagedMessages.length = 0;
            contextManagedMessages.push(...retriedMessages);
            retryCount++;
            continue;
          }
        }
        
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
    
    // Only notify user if messages were actually removed (not just tool results truncated)
    if (contextInfo.removedMessages > 0) {
      console.log(`[DeepSeek] Context truncated: ${contextInfo.originalTokens} -> ${contextInfo.finalTokens} tokens, removed ${contextInfo.removedMessages} messages`);
      res.write(`data: ${JSON.stringify({
        type: "chunk",
        content: `[Note: Conversation history was trimmed to fit model context. ${contextInfo.removedMessages} older messages removed.]\n\n`
      })}\n\n`);
    }

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000); // Send keep-alive every 15 seconds

    try {
      const requestStart = Date.now();
      let ttftMs: number | null = null;
      let lastChunkTime = Date.now();
      const chunkTimeout = 30000; // 30 seconds timeout between chunks

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          streamedResponse += content;
          lastChunkTime = Date.now();
          if (ttftMs === null) {
            ttftMs = lastChunkTime - requestStart;
          }
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
      // Approximate input tokens from apiMessages
      let approxInputTokens = 0;
      try {
        const texts: string[] = [];
        for (const m of apiMessages as any[]) {
          if (typeof m?.content === 'string') texts.push(m.content);
        }
        const EULER = 2.7182818284590;
        const combined = texts.join('\n');
        if (combined) {
          const len = combined.length;
          approxInputTokens = Math.ceil(len / EULER) + (len > 2000 ? 8 : 2);
        }
      } catch {}
      await db.insert(messages).values({
        conversation_id: dbConversation.id,
        role: "assistant",
        content: streamedResponse,
        metadata: {
          ttft_ms: ttftMs ?? undefined,
          total_tokens: (stream as any)?.response?.usage?.total_tokens,
          input_tokens: (stream as any)?.response?.usage?.prompt_tokens ?? (stream as any)?.response?.usage?.input_tokens,
          output_tokens: (stream as any)?.response?.usage?.completion_tokens ?? (stream as any)?.response?.usage?.output_tokens,
          approx_input_tokens: approxInputTokens,
        },
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