import { Router } from "express";
import { fal } from "@fal-ai/client";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { transformDatabaseConversation } from "@/lib/llm/types";
import * as falConfig from "../../config/providers/falai.json";

// Define types for fal.ai responses
interface FalQueueUpdate {
  status: string;
  logs: Array<{ message: string }>;
}

interface FalImage {
  url: string;
  content_type: string;
  width?: number;
  height?: number;
}

interface FalResponse {
  images: FalImage[];
  prompt: string;
  timings?: any;
  seed?: number;
  has_nsfw_concepts?: boolean[];
}

interface ChatMessage {
  role: string;
  content: string;
}

interface ModelConfig {
  id: string;
  name: string;
  contextLength: number;
  defaultModel: boolean;
  parameters: Record<string, any>;
}

const router = Router();

// Initialize fal.ai client
export function initializeFal(): boolean {
  if (!process.env.FAL_KEY) {
    console.warn("FAL_KEY not found in environment variables");
    return false;
  }

  fal.config({
    credentials: process.env.FAL_KEY
  });

  return true;
}

// Chat completion endpoint
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message: userMessage,
      conversationId,
      context = [],
      model = "fal-ai/hidream-i1-full",
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
    } = req.body;

    if (!userMessage || typeof userMessage !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let conversationTitle = userMessage.slice(0, 100);
    let dbConversation;
    let streamedResponse = "";

    // Create or update conversation first
    if (!conversationId) {
      const timestamp = new Date();
      const [newConversation] = await db
        .insert(conversations)
        .values({
          title: conversationTitle,
          provider: "fal",
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
        content: userMessage,
        created_at: timestamp,
      });

      dbConversation = newConversation;
    } else {
      const conversationIdNum = parseInt(conversationId);
      if (isNaN(conversationIdNum)) {
        throw new Error("Invalid conversation ID");
      }

      const existingConversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationIdNum),
      });

      if (!existingConversation || existingConversation.user_id !== req.user!.id) {
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
        content: userMessage,
        created_at: timestamp,
      });

      dbConversation = existingConversation;
    }

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    try {
      // Send initial conversation data
      res.write(`data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`);

      // Check if this is an image generation request
      const isImageRequest = userMessage.toLowerCase().includes("generate") || 
                           userMessage.toLowerCase().includes("create") || 
                           userMessage.toLowerCase().includes("draw") ||
                           userMessage.toLowerCase().includes("image") ||
                           userMessage.toLowerCase().includes("picture") ||
                           userMessage.toLowerCase().includes("photo") ||
                           // Also check if the model is an image model
                           model.toLowerCase().includes("hidream") ||
                           model.toLowerCase().includes("stable") ||
                           model.toLowerCase().includes("sd") ||
                           model.toLowerCase().includes("diffusion") ||
                           model.toLowerCase().includes("flux"); // Add Flux Pro to image models

      if (isImageRequest) {
        // Send a single initial progress message
        res.write(`data: ${JSON.stringify({ type: "chunk", content: "Starting image generation...\n" })}\n\n`);

        try {
          // Find model configuration
          const modelConfig = (falConfig as any).models.find((m: ModelConfig) => m.id === model);
          if (!modelConfig) {
            throw new Error(`Model configuration not found for ${model}`);
          }

          // Handle image generation request
          const result = await fal.subscribe(model, {
            input: {
              prompt: userMessage,
              ...modelConfig.parameters
            },
            logs: true,
            onQueueUpdate: (update: FalQueueUpdate) => {
              if (update.status === "IN_PROGRESS" && update.logs.length > 0) {
                const progressMsg = update.logs[update.logs.length - 1].message;
                res.write(`data: ${JSON.stringify({ type: "chunk", content: `${progressMsg}\n\n` })}\n\n`);
                console.log("Generation progress:", progressMsg);
              }
            },
          });

          if (!result?.data) {
            console.error("Empty result received from Fal AI:", result);
            throw new Error("Invalid response format received from Fal AI");
          }

          const falResponse = result.data as FalResponse;
          if (model.toLowerCase().includes("flux")) {
            // For Flux Pro model, the image is returned directly in base64
            if (falResponse.images?.[0]?.url) {
              console.log("Base64 image received from Flux Pro");
              streamedResponse = `![Generated Image](${falResponse.images[0].url})`;
            } else {
              console.error("No image data in Flux Pro response:", falResponse);
              throw new Error("No image data received from Flux Pro model");
            }
          } else {
            // For other models (like HiDream)
            if (!falResponse.images?.[0]?.url) {
              console.error("No image URL in response:", falResponse);
              throw new Error("No image URL received in response");
            }
            console.log("Image URL received:", falResponse.images[0]);
            streamedResponse = `![Generated Image](${falResponse.images[0].url})`;
          }

          // Insert the assistant message
          const timestamp = new Date();
          // Approximate input tokens from formattedMessages
          let approxInputTokens = 0;
          try {
            const texts: string[] = formattedMessages.map((m: any) => m.content || '').filter(Boolean);
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
            metadata: { total_tokens: (result as any)?.usage?.total_tokens, approx_input_tokens: approxInputTokens },
            created_at: timestamp,
          });

          // Get updated conversation data
          const updatedConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, dbConversation.id),
            with: {
              messages: {
                orderBy: (_msgs: any, { asc }: { asc: any }) => [asc('created_at')],
              },
            },
          });

          if (!updatedConversation) {
            throw new Error("Failed to retrieve conversation");
          }

          // Send the final response
          res.write(
            `data: ${JSON.stringify({
              type: "end",
              conversation: transformDatabaseConversation(updatedConversation),
            })}\n\n`,
          );

        } catch (error) {
          console.error("Image generation error:", error);
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Failed to generate image",
            })}\n\n`,
          );
        }

      } else {
        // Handle regular chat completion with streaming
        const chatHistory = context || [];
        const currentMessage: ChatMessage = {
          role: "user",
          content: userMessage
        };

        const formattedMessages = [...chatHistory, currentMessage].map((msg: ChatMessage) => ({
          role: msg.role,
          content: msg.content
        }));

        // Send a single initial progress message
        res.write(`data: ${JSON.stringify({ type: "chunk", content: "Processing your message...\n" })}\n\n`);

        try {
          const resultPromise = fal.subscribe(model, { // Use the model from configuration
            input: {
              prompt: formattedMessages.map(msg => `${msg.role}: ${msg.content}`).join("\n"),
              max_tokens: 1000,
              temperature: 0.7,
              sync_mode: true // Ensure synchronous response
            },
            logs: true,
            onQueueUpdate: (update: FalQueueUpdate) => {
              if (update.status === "IN_PROGRESS" && update.logs.length > 0) {
                const progressMsg = update.logs[update.logs.length - 1].message;
                res.write(`data: ${JSON.stringify({ type: "chunk", content: `${progressMsg}\n` })}\n\n`);
                console.log("Processing progress:", progressMsg);
              }
            },
          });

          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Request timed out after 30 seconds")), 30000);
          });

          const result = await Promise.race([resultPromise, timeoutPromise]);

          if (!result?.data) {
            console.error("Empty result received from Fal AI:", result);
            throw new Error("Invalid response format received from Fal AI");
          }

          // For chat completion, expect response in data.response
          streamedResponse = result.data.response || result.data.generated_text || "";
          
          if (!streamedResponse) {
            console.error("No text response in result data:", result.data);
            throw new Error("No text response received from model");
          }

          // Insert the assistant message
          const timestamp = new Date();
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: timestamp,
          });

          // Get updated conversation data
          const updatedConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, dbConversation.id),
            with: {
              messages: {
                orderBy: (_msgs: any, { asc }: { asc: any }) => [asc('created_at')],
              },
            },
          });

          if (!updatedConversation) {
            throw new Error("Failed to retrieve conversation");
          }

          // Send the final response
          res.write(
            `data: ${JSON.stringify({
              type: "end",
              conversation: transformDatabaseConversation(updatedConversation),
            })}\n\n`,
          );

        } catch (error) {
          console.error("Chat completion error:", error);
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              error: error instanceof Error ? error.message : "Failed to process message",
            })}\n\n`,
          );
        }
      }

      // Clear the keep-alive interval
      clearInterval(keepAliveInterval);
      res.end();

    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export const falRouter = router; 