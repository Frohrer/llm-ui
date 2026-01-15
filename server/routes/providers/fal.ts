import { Router } from "express";
import { fal } from "@fal-ai/client";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { transformDatabaseConversation } from "@/lib/llm/types";
import * as falConfig from "../../config/providers/falai.json";
import { downloadAndSaveImage, saveGeneratedImage } from "../../file-handler";

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
                           model.toLowerCase().includes("flux") ||
                           model.toLowerCase().includes("reve") ||
                           model.toLowerCase().includes("nano") ||
                           model.toLowerCase().includes("banana") ||
                           model.toLowerCase().includes("seedream") ||
                           model.toLowerCase().includes("dreamina") ||
                           model.toLowerCase().includes("bytedance") ||
                           model.toLowerCase().includes("text-to-image"); // Match any text-to-image endpoint

      if (isImageRequest) {
        // Send a single initial progress message
        res.write(`data: ${JSON.stringify({ type: "chunk", content: "Starting image generation...\n" })}\n\n`);

        try {
          // Find model configuration
          const modelConfig = (falConfig as any).models.find((m: ModelConfig) => m.id === model);
          if (!modelConfig) {
            throw new Error(`Model configuration not found for ${model}`);
          }

          const inputParams = {
            prompt: userMessage,
            ...modelConfig.parameters
          };
          
          console.log(`Calling FAL model ${model} with parameters:`, JSON.stringify(inputParams, null, 2));

          // Handle image generation request
          const result = await fal.subscribe(model, {
            input: inputParams,
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
          const imageData = falResponse.images?.[0];
          
          if (!imageData?.url) {
            console.error("No image data in response:", falResponse);
            throw new Error("No image data received from Fal AI model");
          }
          
          console.log("Image received from Fal AI:", imageData.url.substring(0, 100) + "...");
          
          // Check if it's a base64 data URI or an external URL
          let localImageUrl: string;
          if (imageData.url.startsWith('data:')) {
            // It's a base64 image, save it directly
            const mimeMatch = imageData.url.match(/^data:([^;]+);base64,/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
            localImageUrl = await saveGeneratedImage(imageData.url, mimeType, req);
            console.log("Base64 image saved locally:", localImageUrl);
          } else {
            // It's an external URL, download and save locally
            localImageUrl = await downloadAndSaveImage(imageData.url, req);
            console.log("External image downloaded and saved locally:", localImageUrl);
          }
          
          streamedResponse = `![Generated Image](${localImageUrl})`;

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
          // Extract detailed error information for FAL AI validation errors
          let errorMessage = "Failed to generate image";
          let isContentPolicyViolation = false;
          let logMessage = "";
          
          if (error && typeof error === 'object') {
            const err = error as any;
            
            // Check for content policy violation
            if (err.body && err.body.detail && Array.isArray(err.body.detail)) {
              const detail = err.body.detail[0];
              
              if (detail && detail.type === 'content_policy_violation') {
                isContentPolicyViolation = true;
                errorMessage = `⚠️ Content Policy Violation\n\nYour prompt was flagged by the content safety checker and cannot be processed.\n\nPlease modify your prompt to comply with content policies and try again.\n\n[Learn more about content policies](${detail.url || 'https://docs.fal.ai/errors#content_policy_violation'})`;
                logMessage = `Content policy violation for model ${model}: ${detail.msg}`;
                console.log(logMessage);
              } else if (detail && detail.msg) {
                // Other validation errors
                errorMessage = `❌ Validation Error: ${detail.msg}`;
                logMessage = `Validation error for model ${model}: ${detail.msg} (type: ${detail.type})`;
                console.error(logMessage);
                if (detail.input) {
                  console.error(`Input parameters:`, JSON.stringify(detail.input, null, 2));
                }
              } else {
                // Generic detail error
                errorMessage = `Model ${model} validation error: ${JSON.stringify(err.body.detail)}`;
                logMessage = `Full FAL AI error for model ${model}`;
                console.error(logMessage, JSON.stringify(err.body.detail, null, 2));
              }
            } else if (err.status === 422) {
              // 422 without detailed body
              errorMessage = `❌ Invalid request parameters for model ${model}. Please check the model configuration.`;
              logMessage = `422 error for model ${model} - Status: ${err.status}, Message: ${err.message || 'Unknown'}`;
              console.error(logMessage);
            } else if (err.status === 429) {
              // Rate limiting
              errorMessage = `⏱️ Rate limit exceeded. Please wait a moment and try again.`;
              logMessage = `Rate limit error for model ${model}`;
              console.error(logMessage);
            } else if (err.status === 503) {
              // Service unavailable
              errorMessage = `🔧 The ${model} service is temporarily unavailable. Please try again later.`;
              logMessage = `Service unavailable for model ${model}`;
              console.error(logMessage);
            } else if (error instanceof Error) {
              errorMessage = `Model ${model}: ${error.message}`;
              logMessage = `Error for model ${model}: ${error.message}`;
              console.error(logMessage);
            } else {
              logMessage = `Unknown error for model ${model}`;
              console.error(logMessage, error);
            }
          } else {
            logMessage = `Unknown error type for model ${model}`;
            console.error(logMessage, error);
          }
          
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              error: errorMessage,
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
          let errorMessage = "Failed to process message";
          let logMessage = "";
          
          if (error && typeof error === 'object') {
            const err = error as any;
            
            // Check for content policy violation
            if (err.body && err.body.detail && Array.isArray(err.body.detail)) {
              const detail = err.body.detail[0];
              
              if (detail && detail.type === 'content_policy_violation') {
                errorMessage = `⚠️ Content Policy Violation\n\nYour message was flagged by the content safety checker.\n\nPlease modify your message and try again.`;
                logMessage = `Content policy violation for chat model ${model}: ${detail.msg}`;
                console.log(logMessage);
              } else if (detail && detail.msg) {
                errorMessage = `❌ Error: ${detail.msg}`;
                logMessage = `Chat error for model ${model}: ${detail.msg} (type: ${detail.type})`;
                console.error(logMessage);
              }
            } else if (err.status === 422) {
              errorMessage = `❌ Invalid request parameters. Please check your input.`;
              logMessage = `422 error for chat model ${model}`;
              console.error(logMessage);
            } else if (err.status === 429) {
              errorMessage = `⏱️ Rate limit exceeded. Please wait a moment and try again.`;
              logMessage = `Rate limit error for chat model ${model}`;
              console.error(logMessage);
            } else if (err.status === 503) {
              errorMessage = `🔧 Service temporarily unavailable. Please try again later.`;
              logMessage = `Service unavailable for chat model ${model}`;
              console.error(logMessage);
            } else if (error instanceof Error) {
              errorMessage = error.message;
              logMessage = `Chat error for model ${model}: ${error.message}`;
              console.error(logMessage);
            } else {
              logMessage = `Unknown chat error for model ${model}`;
              console.error(logMessage, error);
            }
          } else {
            logMessage = `Unknown error type for chat model ${model}`;
            console.error(logMessage, error);
          }
          
          res.write(
            `data: ${JSON.stringify({
              type: "error",
              error: errorMessage,
            })}\n\n`,
          );
        }
      }

      // Clear the keep-alive interval
      clearInterval(keepAliveInterval);
      res.end();

    } catch (error) {
      let errorMessage = "Unknown error";
      let statusCode = 500;
      let logMessage = "";
      
      if (error && typeof error === 'object') {
        const err = error as any;
        
        // Check for content policy violation
        if (err.body && err.body.detail && Array.isArray(err.body.detail)) {
          const detail = err.body.detail[0];
          
          if (detail && detail.type === 'content_policy_violation') {
            errorMessage = "Content policy violation: Your request was flagged by the content safety checker.";
            statusCode = 400;
            logMessage = `Content policy violation: ${detail.msg}`;
            console.log(logMessage);
          } else if (detail && detail.msg) {
            errorMessage = detail.msg;
            statusCode = err.status || 400;
            logMessage = `FAL AI error (${detail.type}): ${detail.msg}`;
            console.error(logMessage);
          }
        } else if (err.status) {
          statusCode = err.status;
          if (error instanceof Error) {
            errorMessage = error.message;
            logMessage = `HTTP ${statusCode} error: ${errorMessage}`;
          } else {
            logMessage = `HTTP ${statusCode} error`;
          }
          console.error(logMessage);
        } else if (error instanceof Error) {
          errorMessage = error.message;
          logMessage = `Error: ${errorMessage}`;
          console.error(logMessage);
        } else {
          logMessage = "Unknown error type";
          console.error(logMessage, error);
        }
      } else {
        logMessage = "Error (not an object)";
        console.error(logMessage, error);
      }
      
      res.status(statusCode).json({ error: errorMessage });
    }
  } catch (error) {
    let errorMessage = "Unknown error";
    let statusCode = 500;
    let logMessage = "";
    
    if (error && typeof error === 'object') {
      const err = error as any;
      
      if (err.body && err.body.detail && Array.isArray(err.body.detail)) {
        const detail = err.body.detail[0];
        
        if (detail && detail.type === 'content_policy_violation') {
          errorMessage = "Content policy violation: Your request was flagged by the content safety checker.";
          statusCode = 400;
          logMessage = `Content policy violation: ${detail.msg}`;
          console.log(logMessage);
        } else if (detail && detail.msg) {
          errorMessage = detail.msg;
          statusCode = err.status || 400;
          logMessage = `FAL AI error (${detail.type}): ${detail.msg}`;
          console.error(logMessage);
        }
      } else if (err.status) {
        statusCode = err.status;
        if (error instanceof Error) {
          errorMessage = error.message;
          logMessage = `HTTP ${statusCode} error: ${errorMessage}`;
        } else {
          logMessage = `HTTP ${statusCode} error`;
        }
        console.error(logMessage);
      } else if (error instanceof Error) {
        errorMessage = error.message;
        logMessage = `Error: ${errorMessage}`;
        console.error(logMessage);
      } else {
        logMessage = "Unknown error type";
        console.error(logMessage, error);
      }
    } else {
      logMessage = "Error (not an object)";
      console.error(logMessage, error);
    }
    
    res.status(statusCode).json({ error: errorMessage });
  }
});

export const falRouter = router; 