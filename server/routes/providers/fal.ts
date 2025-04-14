import { Router } from "express";
import { fal } from "@fal-ai/client";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { transformDatabaseConversation } from "@/lib/llm/types";

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
                           model.toLowerCase().includes("diffusion");

      if (isImageRequest) {
        // Send a single initial progress message
        res.write(`data: ${JSON.stringify({ type: "chunk", content: "Starting image generation...\n" })}\n\n`);

        try {
          // Handle image generation request
          const result = await fal.subscribe(model, {
            input: {
              prompt: userMessage,
              negative_prompt: "",
              image_size: {
                width: 1024,
                height: 1024
              },
              num_inference_steps: 50,
              guidance_scale: 5,
              num_images: 1,
              enable_safety_checker: true,
              output_format: "jpeg",
              sync_mode: true // Ensure we get the image URL directly
            },
            logs: true,
            onQueueUpdate: (update: FalQueueUpdate) => {
              if (update.status === "IN_PROGRESS" && update.logs.length > 0) {
                const progressMsg = update.logs[update.logs.length - 1].message;
                res.write(`data: ${JSON.stringify({ type: "chunk", content: `${progressMsg}\n` })}\n\n`);
                console.log("Generation progress:", progressMsg);
              }
            },
          });

          if (!result?.data) {
            console.error("Empty result received from Fal AI:", result);
            throw new Error("Invalid response format received from Fal AI");
          }

          const falResponse = result.data as FalResponse;
          if (!falResponse.images?.[0]?.url) {
            // Check if we got a base64 image
            if (falResponse.images?.[0] && typeof falResponse.images[0].url === 'string' && falResponse.images[0].url.startsWith('data:image')) {
              // Use the base64 image directly
              console.log("Base64 image received:", falResponse.images[0]);
              streamedResponse = `![Generated Image](${falResponse.images[0].url})`;
            } else {
              console.error("No image URL in response:", falResponse);
              throw new Error("No image URL received in response");
            }
          } else {
            console.log("Image URL received:", falResponse.images[0]);
            streamedResponse = `![Generated Image](${falResponse.images[0].url})`;
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
          const resultPromise = fal.subscribe("fal-ai/llama-2-70b-chat", { // Use a specific chat model
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