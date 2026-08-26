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
import { runAgenticLoop } from "../../agentic-workflow";
import { getOpenRouterModel } from "../../ai-sdk-providers";
import { buildSystemPrompt } from "../../user-preferences-service";
import { scheduleExtraction } from "../../memory-service";
import { redactRequest, restoreText, createStreamRestorer, schedulePiiClassification } from "../../pii-service";

const router = express.Router();
let client: OpenAI | null = null;

// Initialize the OpenRouter client (uses OpenAI client with custom baseURL)
export function initializeOpenRouter(apiKey?: string) {
  if (apiKey || process.env.OPENROUTER_API_KEY) {
    client = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey || process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        // App attribution headers (optional but recommended by OpenRouter)
        "HTTP-Referer": process.env.PROXY_DOMAIN ? `https://${process.env.PROXY_DOMAIN}` : "http://localhost:5000",
        "X-Title": process.env.NEXT_PUBLIC_CUSTOMER_NAME || "LLM UI",
      },
    });
    return true;
  }
  return false;
}

// Get the OpenRouter client instance
export function getOpenRouterClient() {
  return client;
}

// Helper to convert OpenRouter messages to simple format for agent
function convertToAgentMessages(messages: any[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
}

// Create or continue an OpenRouter chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "moonshotai/kimi-k3",
      modelContextLength = 128000,
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
      useTools = false,
      useAgenticMode = false,
      skipSystemPrompt = false,
    } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }

    if (!client) {
      return res.status(503).json({ error: "OpenRouter service not initialized" });
    }

    console.log(`Processing message with ${allAttachments.length} attachments for OpenRouter`);

    // Set up SSE headers with keep-alive
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering

    let conversationTitle = message.slice(0, 100);
    let dbConversation: typeof conversations.$inferSelect;
    let streamedResponse = "";

    // Create or update conversation first
    if (!conversationId) {
      const timestamp = new Date();
      const [newConversation] = await db
        .insert(conversations)
        .values({
          title: conversationTitle,
          provider: "openrouter",
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
      res.on("finish", () => { if (dbConversation) scheduleExtraction(dbConversation.id, req.user!.id); });
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
      res.on("finish", () => { if (dbConversation) scheduleExtraction(dbConversation.id, req.user!.id); });
    }

    // Propose name/address entities from the raw user message (in-process
    // NER; no-op unless the classifier is enabled in admin settings).
    schedulePiiClassification(message);

    // Ensure context messages are properly ordered and include attachment content
    const apiMessages = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => {
        let content = msg.content;

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

    console.log(`Processing ${allAttachmentsToProcess.length} attachments for OpenRouter`);

    // OpenRouter uses the OpenAI multimodal format; many hosted models (incl. Kimi K3) accept images
    const imageDataUris: string[] = [];
    let documentTexts: string[] = [];

    // Process each attachment
    for (const att of allAttachmentsToProcess) {
      if (att.type === 'image' && att.url) {
        try {
          const fileName = String(att.url).split('/').pop();
          if (!fileName) throw new Error('Invalid image URL');
          const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
          if (!fs.existsSync(imagePath)) throw new Error('Image file not found on server');
          const imageBuffer = fs.readFileSync(imagePath);
          const base64Image = imageBuffer.toString('base64');
          const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
          imageDataUris.push(`data:${mimeType};base64,${base64Image}`);
        } catch (imageError) {
          console.error("Error processing image for OpenRouter:", imageError);
          documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
        }
      } else if (att.type === 'document' && att.text) {
        console.log(`Processing document attachment for OpenRouter: ${att.name}`);
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

    // Create the message content based on what we have
    let textContent = message;
    if (documentTexts.length > 0) {
      textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
    }
    if (knowledgeContent) {
      textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
    }

    if (imageDataUris.length > 0) {
      const contentArray: any[] = [{ type: "text", text: textContent }];
      for (const uri of imageDataUris) {
        contentArray.push({ type: "image_url", image_url: { url: uri } });
      }
      apiMessages.push({ role: "user", content: contentArray });
      console.log("Multimodal message with image content added for OpenRouter");
    } else {
      apiMessages.push({ role: "user", content: textContent });
      console.log("Text message added for OpenRouter");
    }

    // Build and add system prompt with user custom prompt
    if (!skipSystemPrompt) {
      const systemPrompt = await buildSystemPrompt(req.user!.id, { latestUserMessage: message });
      if (systemPrompt) {
        apiMessages.unshift({ role: "system", content: systemPrompt });
      }
    }

    // Pre-emptively manage context to avoid exceeding model limits
    const { messages: contextManagedMessages, info: contextInfo } = prepareContext(
      apiMessages,
      model,
      {
        maxTokens: modelContextLength, // Use context length from model config
        reserveForTools: useTools ? 8000 : 0, // Only reserve for tools if enabled
      }
    );

    // Agentic mode makes its own requests through the AI SDK loop — skip the
    // direct completion stream entirely.
    const isAgentic = useAgenticMode && useTools;

    // Stream the completion with retries.
    // No temperature: OpenRouter routes to hundreds of models and several
    // (reasoning models, GPT-5 family, Kimi K3) reject custom values.
    while (!isAgentic && retryCount < maxRetries) {
      try {
        // Redacted: known PII entities and freshly detected PII are replaced
        // with tags before leaving the machine (re-redacts on each retry).
        stream = await client.chat.completions.create(await redactRequest({
          messages: contextManagedMessages,
          model,
          stream: true as const,
          max_tokens: 16000,
        }));
        console.log("Stream created with model:", model);
        break;
      } catch (error: any) {
        // Check if this is a context length error
        if (isContextLengthError(error)) {
          console.log(`[OpenRouter] Context length error detected, attempting to truncate further`);

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

    if (!stream && !isAgentic) {
      throw new Error("Failed to create stream after retries");
    }

    // Send initial conversation data
    res.write(
      `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
    );

    // Only notify user if messages were actually removed (not just tool results truncated)
    if (contextInfo.removedMessages > 0) {
      console.log(`[OpenRouter] Context truncated: ${contextInfo.originalTokens} -> ${contextInfo.finalTokens} tokens, removed ${contextInfo.removedMessages} messages`);
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

      // Check if using agentic mode
      if (isAgentic) {
        console.log('[OpenRouter] Using agentic mode with AI SDK');

        // Get the AI SDK model instance
        const aiModel = getOpenRouterModel(model);

        // Extract system prompt from contextManagedMessages (which has been truncated if needed)
        const systemMessage = contextManagedMessages.find((msg: any) => msg.role === 'system');
        const systemPrompt = systemMessage?.content || undefined;

        // Convert messages to simple format for agent - use contextManagedMessages which has been truncated
        const agentMessages = convertToAgentMessages(contextManagedMessages);

        // Run the agentic loop with AI SDK v7 ToolLoopAgent
        const finalResponse = await runAgenticLoop(
          agentMessages,
          {
            maxIterations: 20,
            conversationId: dbConversation.id,
            model: aiModel,
            systemPrompt,
            userId: req.user!.id
          }
        );

        // Stream the final response to the user
        if (finalResponse) {
          const chunkSize = 50;
          for (let i = 0; i < finalResponse.length; i += chunkSize) {
            const chunk = finalResponse.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 20));
          }

          streamedResponse = finalResponse;

          // Save the final response
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: finalResponse,
            metadata: {
              agentic_mode: true,
              ai_sdk: true,
              ttft_ms: Date.now() - requestStart
            },
            created_at: new Date(),
          });
        }
      } else {
        let ttftMs: number | null = null;
        let lastChunkTime = Date.now();
        // Reasoning models (e.g. Kimi K3 with always-on thinking) can pause for a
        // while before the first visible token — use a generous chunk timeout.
        const chunkTimeout = 120000;
        // Restores PII tags in streamed text; buffers tag fragments split
        // across chunk boundaries.
        const piiRestorer = createStreamRestorer();

        for await (const chunk of stream!) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            streamedResponse += content;
            lastChunkTime = Date.now();
            if (ttftMs === null) {
              ttftMs = lastChunkTime - requestStart;
            }
            const restored = await piiRestorer.push(content);
            if (restored) {
              res.write(
                `data: ${JSON.stringify({ type: "chunk", content: restored })}\n\n`,
              );
            }
            (res as any).flush?.();
          }

          // Check for timeout between chunks
          if (Date.now() - lastChunkTime > chunkTimeout) {
            throw new Error("Stream timeout - no data received for 120 seconds");
          }
        }

        // Emit any held-back tag fragment and convert accumulated tags back to
        // real values before persisting (DB keeps real values).
        const piiTail = await piiRestorer.flush();
        if (piiTail) {
          res.write(`data: ${JSON.stringify({ type: "chunk", content: piiTail })}\n\n`);
          (res as any).flush?.();
        }
        streamedResponse = await restoreText(streamedResponse);

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
      }

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
