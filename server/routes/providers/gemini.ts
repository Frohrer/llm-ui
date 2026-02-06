import express, { Request, Response } from 'express';
import { GoogleGenerativeAI, GenerativeModel } from "@google/generative-ai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { saveGeneratedImage } from "../../file-handler";
import { getToolDefinitions, handleToolCalls } from "../../tools";
import { runAgenticLoop } from "../../agentic-workflow";
import { getGoogleModel } from "../../ai-sdk-providers";
import { generateText, tool } from "ai";
import { z, ZodTypeAny, ZodObject, ZodRawShape } from "zod";
import { prepareContext, isContextLengthError, truncateToolResult } from "../../context-manager";

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

// Helper to convert messages to simple format for agent
function convertToAgentMessages(messages: any[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant' || msg.role === 'model')
    .map(msg => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');
      }
      return {
        role: (msg.role === 'model' ? 'assistant' : msg.role) as 'user' | 'assistant',
        content
      };
    });
}

/**
 * Convert a JSON Schema property to a Zod type
 */
function jsonSchemaPropertyToZod(prop: any): ZodTypeAny {
  if (!prop || !prop.type) {
    return z.any();
  }

  let zodType: ZodTypeAny;

  switch (prop.type) {
    case 'string':
      if (prop.enum && Array.isArray(prop.enum)) {
        zodType = z.enum(prop.enum as [string, ...string[]]);
      } else {
        zodType = z.string();
      }
      break;
    case 'number':
    case 'integer':
      zodType = z.number();
      break;
    case 'boolean':
      zodType = z.boolean();
      break;
    case 'array':
      if (prop.items) {
        zodType = z.array(jsonSchemaPropertyToZod(prop.items));
      } else {
        zodType = z.array(z.any());
      }
      break;
    case 'object':
      if (prop.properties) {
        const shape: ZodRawShape = {};
        for (const [key, value] of Object.entries(prop.properties)) {
          shape[key] = jsonSchemaPropertyToZod(value);
        }
        zodType = z.object(shape);
      } else {
        zodType = z.record(z.any());
      }
      break;
    default:
      zodType = z.any();
  }

  if (prop.description) {
    zodType = zodType.describe(prop.description);
  }

  return zodType;
}

/**
 * Convert a JSON Schema object to a Zod schema
 */
function jsonSchemaToZod(schema: any): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const [key, prop] of Object.entries(properties)) {
    let zodProp = jsonSchemaPropertyToZod(prop);
    
    if (!required.includes(key)) {
      zodProp = zodProp.optional();
    }
    
    shape[key] = zodProp;
  }

  return z.object(shape);
}

// Get AI SDK tools from tool definitions
async function getAISDKTools(userId?: number): Promise<Record<string, any>> {
  const { executeTool } = await import('../../tools');
  const toolDefinitions = await getToolDefinitions();
  const tools: Record<string, any> = {};

  for (const toolDef of toolDefinitions) {
    const func = toolDef.function;
    
    // Convert JSON Schema to Zod schema
    const zodSchema = jsonSchemaToZod(func.parameters);
    
    tools[func.name] = tool({
      description: func.description,
      inputSchema: zodSchema,
      execute: async (params: any) => {
        try {
          const result = await executeTool(func.name, params, userId);
          return result;
        } catch (error) {
          console.error(`Error executing tool ${func.name}:`, error);
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false
          };
        }
      }
    });
  }

  return tools;
}

// Create or continue a Gemini chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "gemini-2.5-flash",
      modelContextLength = 1000000, // Default for Gemini models
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
      useTools = false,
      useAgenticMode = false,
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

    // Initialize history for the Gemini model and include attachment content from metadata
    const history = context
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
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: content }],
        };
      });

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

    // Create the user message content with current timestamp
    const currentTimeStr = `[${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC] `;
    let userText = currentTimeStr + message;
    if (documentTexts.length > 0) {
      userText += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
    }
    if (knowledgeContent) {
      userText += "\n\nKnowledge Sources:\n" + knowledgeContent;
    }

    // Initialize the model with the specified model name
    const genModel = client.getGenerativeModel({ model });
    
    // Convert Gemini history format to standard format for context management
    const standardHistory = history.map((h: any) => ({
      role: h.role === 'model' ? 'assistant' : h.role,
      content: h.parts.map((p: any) => p.text).join('\n')
    }));
    
    // Pre-emptively manage context to avoid exceeding model limits
    const { messages: contextManagedMessages, info: contextInfo } = prepareContext(
      standardHistory,
      model,
      { 
        maxTokens: modelContextLength, // Use context length from model config
        reserveForTools: useTools ? 8000 : 0,  // Only reserve for tools if enabled
      }
    );
    
    // Convert back to Gemini history format
    const contextManagedHistory = contextManagedMessages.map((msg: any) => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
      parts: [{ text: msg.content }]
    }));
    
    // Prepare for chat
    let chat;
    
    if (contextManagedHistory.length > 0) {
      chat = genModel.startChat({
        history: contextManagedHistory,
        generationConfig: {
          maxOutputTokens: 4096,
          temperature: 0.7,
        },
      });
      console.log("Gemini chat created with model:", model, "and history length:", contextManagedHistory.length);
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
    
    // Only notify user if messages were actually removed (not just tool results truncated)
    if (contextInfo.removedMessages > 0) {
      console.log(`[Gemini] Context truncated: ${contextInfo.originalTokens} -> ${contextInfo.finalTokens} tokens, removed ${contextInfo.removedMessages} messages`);
      res.write(`data: ${JSON.stringify({
        type: "chunk",
        content: `[Note: Conversation history was trimmed to fit model context. ${contextInfo.removedMessages} older messages removed.]\n\n`
      })}\n\n`);
    }

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000); // Send keep-alive every 15 seconds

    const requestStart = Date.now();
    let ttftMs: number | null = null;

    try {
      // Check if using agentic mode or tools mode with AI SDK
      if (useAgenticMode && useTools) {
        console.log('[Gemini] Using agentic mode with AI SDK');
        
        // Get the AI SDK model instance
        const aiModel = getGoogleModel(model);
        
        // Use context-managed messages which have already been truncated if needed
        // contextManagedMessages is in standard format, add current user message
        const agentApiMessages = [...contextManagedMessages];
        agentApiMessages.push({ role: 'user', content: userText });
        
        // Convert to simple format for agent
        const agentMessages = convertToAgentMessages(agentApiMessages);
        
        // Run the agentic loop with AI SDK v6 ToolLoopAgent
        const finalResponse = await runAgenticLoop(
          agentMessages,
          {
            maxIterations: 20,
            conversationId: dbConversation.id,
            model: aiModel,
            userId: req.user!.id
          }
        );
        
        // Stream the final response to the user
        if (finalResponse) {
          ttftMs = Date.now() - requestStart;
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
              ttft_ms: ttftMs
            },
            created_at: new Date(),
          });
        }
      } else if (useTools) {
        console.log('[Gemini] Using tools mode with AI SDK');
        
        // Get the AI SDK model instance
        const aiModel = getGoogleModel(model);
        
        // Use context-managed messages which have already been truncated if needed
        const toolsApiMessages = [...contextManagedMessages];
        toolsApiMessages.push({ role: 'user', content: userText });
        
        // Convert to agent message format
        const agentMessages = convertToAgentMessages(toolsApiMessages);
        
        // Get tools
        const tools = await getAISDKTools(req.user!.id);
        console.log(`[Gemini] Loaded ${Object.keys(tools).length} tools:`, Object.keys(tools).join(', '));
        
        // Use AI SDK generateText with tools
        const result = await generateText({
          model: aiModel,
          messages: agentMessages,
          tools,
          maxSteps: 5, // Allow up to 5 tool calling rounds
        });
        
        ttftMs = Date.now() - requestStart;
        
        // Stream the response
        if (result.text) {
          const chunkSize = 50;
          for (let i = 0; i < result.text.length; i += chunkSize) {
            const chunk = result.text.slice(i, i + chunkSize);
            res.write(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`);
            await new Promise(resolve => setTimeout(resolve, 20));
          }
          
          streamedResponse = result.text;
        }
        
        // Log tool usage if any
        if (result.toolCalls && result.toolCalls.length > 0) {
          console.log(`[Gemini] Used ${result.toolCalls.length} tools:`, result.toolCalls.map(tc => tc.toolName).join(', '));
          
          // Store tool calls as internal messages
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify(result.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: tc.args
            }))),
            metadata: { type: 'tool_calls' },
            created_at: new Date(),
          });
          
          // Store tool results
          if (result.toolResults && result.toolResults.length > 0) {
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "tool",
              content: JSON.stringify(result.toolResults.map((r, i) => ({
                toolCallId: result.toolCalls![i].toolCallId,
                toolName: result.toolCalls![i].toolName,
                result: r
              }))),
              metadata: { type: 'tool_results' },
              created_at: new Date(),
            });
          }
        }
        
        // Save the response
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          metadata: {
            tools_used: result.toolCalls?.length || 0,
            ai_sdk: true,
            ttft_ms: ttftMs
          },
          created_at: new Date(),
        });
      } else {
        // Original non-tool streaming logic
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
                
                // Process all parts in the response
                const parts = chunk.candidates[0].content.parts;
                for (const part of parts) {
                  // Handle text parts
                  if (part.text) {
                    content += part.text;
                  }
                  // Handle image parts (inline_data)
                  else if (part.inline_data || part.inlineData) {
                    const imageData = part.inline_data || part.inlineData;
                    if (imageData && imageData.data) {
                      // Handle different mime type property names
                      const mimeType = imageData.mime_type || imageData.mimeType || 'image/png';
                      // Save generated image to disk instead of embedding base64 in message
                      try {
                        const imageUrl = await saveGeneratedImage(imageData.data, mimeType, req);
                        content += `\n\n![Generated Image](${imageUrl})\n\n`;
                        console.log("Generated image saved to disk:", imageUrl);
                      } catch (imgSaveError) {
                        console.error("Failed to save generated image:", imgSaveError);
                        // Fallback to base64 if saving fails
                        const dataUri = `data:${mimeType};base64,${imageData.data}`;
                        content += `\n\n![Generated Image](${dataUri})\n\n`;
                      }
                    }
                  }
                }
              }
              
              // Process non-empty content
              if (content && content.trim()) {
                streamedResponse += content;
                lastChunkTime = Date.now();
                if (ttftMs === null) {
                  ttftMs = lastChunkTime - requestStart;
                }
                
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
        // Try to extract Gemini usage if available on the result
        let exactInputTokens: number | undefined;
        let exactOutputTokens: number | undefined;
        let exactTotalTokens: number | undefined;
        try {
          const usage = (result as any)?.usage || (result as any)?.responseMetadata?.tokenCount || (result as any)?.responseMetadata?.usage;
          if (usage) {
            exactInputTokens = usage.inputTokens ?? usage.input_tokens ?? usage.input ?? usage.promptTokens;
            exactOutputTokens = usage.outputTokens ?? usage.output_tokens ?? usage.output ?? usage.candidatesTokens;
            const total = usage.totalTokens ?? usage.total_tokens ?? usage.total;
            if (typeof total === 'number') exactTotalTokens = total;
          }
        } catch {}
        // Approximate input tokens from history
        let approxInputTokens = 0;
        try {
          const texts: string[] = [];
          for (const h of history) {
            for (const p of h.parts) {
              if (typeof p?.text === 'string') texts.push(p.text);
            }
          }
          texts.push(userText);
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
            total_tokens: exactTotalTokens ?? (result as any)?.usage?.total_tokens,
            input_tokens: exactInputTokens,
            output_tokens: exactOutputTokens,
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