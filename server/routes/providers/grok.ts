import express, { Request, Response } from 'express';
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import OpenAI from "openai";
import { getToolDefinitions, getTools, handleToolCalls } from "../../tools";

const router = express.Router();
let client: OpenAI | null = null;
const API_BASE_URL = 'https://api.x.ai/v1';

// Initialize the Grok client using OpenAI SDK with custom base URL
export function initializeGrok(apiKey?: string) {
  if (apiKey || process.env.XAI_KEY) {
    client = new OpenAI({
      apiKey: apiKey || process.env.XAI_KEY,
      baseURL: API_BASE_URL
    });
    return true;
  }
  return false;
}

// Get the Grok client
export function getGrokClient() {
  return client;
}

// Create or continue a Grok chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "grok-3",
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
      useTools = false, // New parameter to enable/disable tool calling
    } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "Grok service not initialized" });
    }
    
    console.log(`Processing message with ${allAttachments.length} attachments for Grok`);

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
          provider: "grok",
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

    // Ensure context messages are properly ordered and format for OpenAI
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
    const maxRetries = 3;
    let retryCount = 0;
    
    // Get all attachments (prioritize the allAttachments array if it exists)
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for Grok`);
    
    // Variables to track attachment types
    let hasImageAttachment = false;
    let imageAttachments: any[] = [];
    let documentTexts: string[] = [];
    
    // Process each attachment
    for (const att of allAttachmentsToProcess) {
      // Handle image attachments
      if (att.type === 'image') {
        try {
          console.log("Processing image attachment for Grok:", att.url);
          
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

          // For OpenAI-compatible API, add the image URL
          imageAttachments.push({
            type: "image_url",
            image_url: {
              url: att.url
            }
          });
          
          hasImageAttachment = true;
          console.log("Image URL added for Grok");
        } catch (imageError) {
          console.error("Error processing image for Grok:", imageError);
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
        console.log(`Processing document attachment for Grok: ${att.name}`);
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

    // Check if we should use a vision model for images
    const isVisionModel = model === "grok-2-vision" || model === "grok-2-image";
    const useVisionModel = hasImageAttachment && isVisionModel;

    // Create the message based on what we have
    if (hasImageAttachment && useVisionModel) {
      // For Grok with images, create a message with text and image attachments
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
      
      console.log("Multimodal message with images, documents, and knowledge added for Grok");
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
      console.log("Message with document/knowledge content added for Grok");
    } 
    else {
      // Regular text message without attachments or knowledge
      apiMessages.push({ role: "user", content: message });
      console.log("Plain text message added for Grok");
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
      // Set up the base request options
      const requestOptions: any = {
        model: model,
        messages: apiMessages,
        stream: true,
        temperature: 0.7,
        max_tokens: 4096,
      };

      // Add tools if enabled
      if (useTools) {
        try {
          console.log("Attempting to load tools for Grok...");
          const toolDefinitions = await getToolDefinitions();
          
          if (toolDefinitions.length > 0) {
            requestOptions.tools = toolDefinitions;
            requestOptions.tool_choice = "auto";
            console.log(`Added ${toolDefinitions.length} tools to Grok request: ${toolDefinitions.map(t => t.function.name).join(', ')}`);
          } else {
            console.warn("No tools were loaded, tool calling will not work");
          }
        } catch (toolError) {
          console.error("Error loading tools:", toolError);
        }
      } else {
        console.log("Tool usage is disabled for this request");
      }

      // Use OpenAI SDK streaming with Grok model
      const stream = await client.chat.completions.create(requestOptions);

      // Process the streaming response
      const requestStart = Date.now();
      let ttftMs: number | null = null;
      let lastChunkTime = Date.now();
      const chunkTimeout = 30000; // 30 seconds timeout between chunks
      let toolCallsInProgress: any[] = [];
      let toolCallParts = '';
      let isCollectingToolCall = false;

      for await (const chunk of stream as unknown as AsyncIterable<any>) {
        // Update last chunk time
        lastChunkTime = Date.now();
        
        const contentDelta = chunk.choices[0]?.delta?.content;
        const toolCallsDelta = chunk.choices[0]?.delta?.tool_calls;
        
        // Handle content chunks - only send to client if not part of a tool call
        if (contentDelta && !toolCallsDelta) {
          streamedResponse += contentDelta;
          if (ttftMs === null) {
            ttftMs = Date.now() - requestStart;
          }
          res.write(`data: ${JSON.stringify({ type: "chunk", content: contentDelta })}\n\n`);
        }
        
        // Handle tool call chunks if present and tool usage is enabled
        if (useTools && toolCallsDelta && toolCallsDelta.length > 0) {
          for (const toolCallDelta of toolCallsDelta) {
            const { index, id, type, function: funcDelta } = toolCallDelta;
            
            // Initialize tool call if this is the first chunk
            if (id && !toolCallsInProgress[index || 0]) {
              toolCallsInProgress[index || 0] = {
                id,
                type,
                function: {
                  name: funcDelta?.name || '',
                  arguments: ''
                }
              };
              console.log(`Initialized tool call ${index}: ${id}, name: ${funcDelta?.name}`);
            }
            
            // Append function arguments if present
            if (funcDelta?.arguments) {
              toolCallsInProgress[index || 0].function.arguments += funcDelta.arguments;
            }
            
            // If there's a function name, set it
            if (funcDelta?.name) {
              toolCallsInProgress[index || 0].function.name = funcDelta.name;
            }
          }
        }
        
        // Check for timeout between chunks
        if (Date.now() - lastChunkTime > chunkTimeout) {
          throw new Error("Stream timeout - no data received for 30 seconds");
        }
      }

      // Execute any tool calls if present and tool usage is enabled
      if (useTools && toolCallsInProgress.length > 0) {
        try {
          console.log('Executing tool calls:', JSON.stringify(toolCallsInProgress, null, 2));
          
          // Validate tool calls before execution
          const validToolCalls = toolCallsInProgress.filter(toolCall => {
            if (!toolCall.id || !toolCall.function?.name) {
              console.error('Invalid tool call structure:', toolCall);
              return false;
            }
            
            // Try to parse arguments to ensure they're valid JSON
            try {
              if (toolCall.function.arguments) {
                JSON.parse(toolCall.function.arguments);
              }
              return true;
            } catch (parseError) {
              console.error(`Invalid JSON arguments for tool ${toolCall.function.name}:`, toolCall.function.arguments);
              return false;
            }
          });
          
          if (validToolCalls.length === 0) {
            console.error('No valid tool calls found');
            throw new Error('No valid tool calls found');
          }
          
          console.log(`Validated ${validToolCalls.length} of ${toolCallsInProgress.length} tool calls`);
          
          // Store tool calls as internal messages
          const timestamp = new Date();
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify(validToolCalls),
            metadata: { type: 'tool_calls' },
            created_at: timestamp,
          });
          
          // Execute all tool calls
          const toolResults = await handleToolCalls(validToolCalls);
          
          // Store tool results as internal messages
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify(toolResults),
            metadata: { type: 'tool_results' },
            created_at: new Date(),
          });
          
          // Get an additional LLM response with the tool results
          const toolResponseMessages = [
            ...apiMessages,
            { role: 'assistant', content: null, tool_calls: validToolCalls },
            ...toolResults.map(result => ({
              role: 'tool',
              tool_call_id: result.toolCallId,
              content: result.error ? 
                `Error: ${result.error}` : 
                JSON.stringify(result.result, null, 2)
            }))
          ];
          
          // Get final response with tool results
          const toolCompletionResponse = await client.chat.completions.create({
            model: model,
            messages: toolResponseMessages,
            temperature: 0.7,
            max_tokens: 4096,
          });
          
          const toolFinalResponse = toolCompletionResponse.choices[0]?.message?.content || '';
          
          // Only send the final response if it's not empty
          if (toolFinalResponse) {
            res.write(`data: ${JSON.stringify({ 
              type: "chunk", 
              content: '\n\n' + toolFinalResponse 
            })}\n\n`);
            
            // Add the final response to the streamed response
            streamedResponse += '\n\n' + toolFinalResponse;
          }
          
        } catch (toolError) {
          console.error('Error executing tools:', toolError);
          // Store tool error as internal message
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : 'Unknown tool execution error' }),
            metadata: { type: 'tool_error' },
            created_at: new Date(),
          });
          
          // Send error message to user
          const errorMessage = `Tool execution failed: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
          res.write(`data: ${JSON.stringify({ 
            type: "chunk", 
            content: '\n\n' + errorMessage 
          })}\n\n`);
          
          streamedResponse += '\n\n' + errorMessage;
        }
      }

      // Save the complete response
      const timestamp = new Date();
      // Approximate input tokens from apiMessages
      let approxInputTokens = 0;
      try {
        const texts: string[] = [];
        for (const m of apiMessages as any[]) {
          if (typeof m?.content === 'string') texts.push(m.content);
          else if (Array.isArray(m?.content)) {
            for (const part of m.content) {
              if (typeof part?.text === 'string') texts.push(part.text);
            }
          }
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
            orderBy: (messages: any, { asc }: any) => [asc(messages.created_at)],
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