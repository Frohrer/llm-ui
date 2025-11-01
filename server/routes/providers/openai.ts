import express, { Request, Response } from 'express';
import OpenAI, { toFile } from "openai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { getToolDefinitions, handleToolCalls } from "../../tools";
import { runAgenticLoop } from "../../agentic-workflow";
import { getOpenAIModel } from "../../ai-sdk-providers";
import { CoreMessage } from "ai";

const router = express.Router();
let client: OpenAI | null = null;

// Extract plain assistant text from various OpenAI response shapes
function extractResponseText(responseData: any): string {
  // 1) GPT-5 Responses API preferred shape: output[].content where type === 'message'
  const output = responseData?.output;
  if (Array.isArray(output)) {
    const message = output.find((item: any) => item?.type === "message");
    const parts = message?.content;
    if (Array.isArray(parts)) {
      return parts.map((p: any) => p?.text ?? p?.content ?? "").join("");
    }
    if (typeof message?.content === "string") {
      return message.content;
    }
  }

  // 2) Chat Completions / other fallbacks
  const choicesContent = responseData?.choices?.[0]?.message?.content;
  if (typeof choicesContent === "string") return choicesContent;
  if (Array.isArray(choicesContent)) {
    return choicesContent.map((p: any) => p?.text ?? p?.content ?? "").join("");
  }

  const textContent = responseData?.text?.content;
  if (typeof textContent === "string") return textContent;

  const directContent = responseData?.content;
  if (typeof directContent === "string") return directContent;
  if (Array.isArray(directContent)) {
    return directContent.map((p: any) => p?.text ?? p?.content ?? "").join("");
  }

  return "";
}

// Initialize the OpenAI client
export function initializeOpenAI(apiKey?: string) {
  if (apiKey || process.env.OPENAI_API_KEY) {
    client = new OpenAI({
      apiKey: apiKey || process.env.OPENAI_API_KEY,
    });
    return true;
  }
  return false;
}

// Get the OpenAI client instance
export function getOpenAIClient() {
  return client;
}

// Helper to convert OpenAI messages to AI SDK CoreMessage format
function convertToCoreMessages(messages: any[]): CoreMessage[] {
  return messages.map(msg => {
    if (msg.role === 'system') {
      // System messages are handled separately in AI SDK
      return null;
    }
    
    if (msg.role === 'user') {
      return {
        role: 'user' as const,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      };
    }
    
    if (msg.role === 'assistant') {
      return {
        role: 'assistant' as const,
        content: msg.content || ''
      };
    }
    
    return null;
  }).filter((msg): msg is CoreMessage => msg !== null);
}

// Create or continue an OpenAI chat conversation
router.post("/", async (req: Request, res: Response) => {
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
      useTools = false,
      useAgenticMode = false,
    } = req.body;

    // Check if this is a GPT-5 model and NOT in agentic mode - use Responses API
    // For agentic mode, use Chat Completions API (even for GPT-5) because 
    // Responses API doesn't support the iterative loop we need
    if (model && model.startsWith('gpt-5') && !useAgenticMode) {
      console.log(`Using Responses API for GPT-5 model: ${model}`);
      
      // Transform request body to match Responses API format
      req.body = {
        input: message,
        model,
        conversationId,
        context,
        attachment,
        allAttachments,
        useKnowledge,
        pendingKnowledgeSources,
        useTools,
        reasoning: { effort: "medium" },
        text: { verbosity: "medium" },
        store: true,
        include: []
      };
      
      // Call the responses handler directly
      return handleResponsesAPI(req, res);
    }
    
    // Use the model as-is (including GPT-5 for agentic mode via Chat Completions API)
    const effectiveModel = model;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "OpenAI service not initialized" });
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
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for OpenAI`);
    
    // Variables to track attachment types
    let hasImageAttachment = false;
    let imageAttachmentContent = null;
    let documentTexts: string[] = [];
    
    // Check if this is an image edit request
    const isImageEditRequest = model === "gpt-image-1-edit";
    
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
            image_url: { url: dataUri },
            base64: base64Image,
            mimeType: mimeType,
            fileName: fileName
          };
          
          hasImageAttachment = true;
          console.log("Image successfully processed for OpenAI");
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
      }
    }

    // Handle image edit request
    if (isImageEditRequest) {
      if (!hasImageAttachment || !imageAttachmentContent) {
        throw new Error("Image edit request requires an image attachment");
      }

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      // Send a single initial progress message
      res.write(`data: ${JSON.stringify({ type: "chunk", content: "Starting image edit...\n" })}\n\n`);

      try {
        // Handle image edit request
        const imageFile = await toFile(
          fs.createReadStream(path.join(process.cwd(), 'uploads', 'images', imageAttachmentContent.fileName)),
          null,
          {
            type: imageAttachmentContent.mimeType
          }
        );

        const result = await client.images.edit({
          model: "gpt-image-1",
          image: imageFile,
          prompt: message,
          n: 1
        });

        if (!result?.data?.[0]?.b64_json) {
          throw new Error("No image data received from OpenAI");
        }

        // Convert base64 to data URI
        const editedImageDataUri = `data:${imageAttachmentContent.mimeType};base64,${result.data[0].b64_json}`;
        streamedResponse = `![Edited Image](${editedImageDataUri})`;

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
              orderBy: (messages: any, { asc }: { asc: any }) => [asc(messages.created_at)],
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
        console.error("Image edit error:", error);
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Failed to edit image",
          })}\n\n`,
        );
      }

      res.end();
      return;
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
        contentArray.push({
          type: "image_url",
          image_url: {
            url: imageAttachmentContent.image_url.url
          }
        });
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
        // Reasoning models (o1, o3, gpt-4o, gpt-5) require temperature 1
        const isReasoningModelStream = effectiveModel.includes('o1') || effectiveModel.includes('o3') || effectiveModel.includes('gpt-4o') || effectiveModel.includes('gpt-5');
        
        const streamOptions: any = {
          messages: apiMessages,
          model: effectiveModel,
          stream: true,
          max_completion_tokens: 4096,
          temperature: isReasoningModelStream ? 1 : 0.7,
        };

        // Add tools if enabled
        if (useTools) {
          try {
            const toolDefinitions = await getToolDefinitions();
            if (toolDefinitions.length > 0) {
              streamOptions.tools = toolDefinitions;
              streamOptions.tool_choice = "auto";
              console.log(`Added ${toolDefinitions.length} tools to OpenAI request: ${toolDefinitions.map(t => t.function.name).join(', ')}`);
            } else {
              console.warn("Tools requested but no tools available");
            }
          } catch (toolError) {
            console.error("Error loading tools:", toolError);
          }
        }

        stream = await client.chat.completions.create(streamOptions);
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

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000); // Send keep-alive every 15 seconds

    try {
      const requestStart = Date.now();
      
      // Check if using agentic mode
      if (useAgenticMode && useTools) {
        console.log('[OpenAI] Using agentic mode with AI SDK');
        
        // Get the AI SDK model instance
        const aiModel = getOpenAIModel(effectiveModel);
        
        // Extract system prompt from apiMessages
        const systemMessage = apiMessages.find((msg: any) => msg.role === 'system');
        const systemPrompt = systemMessage?.content || undefined;
        
        // Convert messages to CoreMessage format (excluding system messages)
        const coreMessages = convertToCoreMessages(apiMessages);
        
        // Run the agentic loop with AI SDK
        const finalResponse = await runAgenticLoop(
          coreMessages,
          {
            maxIterations: 10,
            maxContextMessages: 15,
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
        // Original streaming logic
        let ttftMs: number | null = null;
        let lastChunkTime = Date.now();
        const chunkTimeout = 30000; // 30 seconds timeout between chunks
        let toolCallsInProgress: any[] = [];

        for await (const chunk of stream as unknown as AsyncIterable<any>) {
          const content = chunk.choices[0]?.delta?.content || "";
          const toolCallsDelta = chunk.choices[0]?.delta?.tool_calls;
        
        // Handle content chunks - only send to client if not part of a tool call
        if (content && !toolCallsDelta) {
          streamedResponse += content;
          lastChunkTime = Date.now();
          if (ttftMs === null) {
            ttftMs = lastChunkTime - requestStart;
          }
          res.write(
            `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
          );
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
          const isReasoningModelTool = effectiveModel.includes('o1') || effectiveModel.includes('o3') || effectiveModel.includes('gpt-4o') || effectiveModel.includes('gpt-5');
          const toolCompletionResponse = await client.chat.completions.create({
            model: effectiveModel,
            messages: toolResponseMessages,
            temperature: isReasoningModelTool ? 1 : 0.7,
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

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        const usageObj = (stream as any)?.response?.usage || {};
        const usageTotalTokens = usageObj?.total_tokens;
        const usagePromptTokens = usageObj?.prompt_tokens ?? usageObj?.input_tokens;
        const usageCompletionTokens = usageObj?.completion_tokens ?? usageObj?.output_tokens;
        // Approximate input tokens from apiMessages when usage is not provided
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
            total_tokens: usageTotalTokens,
            prompt_tokens: usagePromptTokens,
            completion_tokens: usageCompletionTokens,
            approx_input_tokens: approxInputTokens,
          },
          created_at: timestamp,
        });
      }
      
      // Send completion event after successful save (common for both modes)
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
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GPT-5 Responses API handler function
async function handleResponsesAPI(req: Request, res: Response) {
  try {
    const {
      input,
      model = "gpt-5",
      conversationId,
      context = [],
      attachment = null,
      allAttachments = [],
      useKnowledge = false,
      pendingKnowledgeSources = [],
      useTools = false,
      // New GPT-5 Responses API parameters
      reasoning = { effort: "medium" },
      text = { verbosity: "medium" },
      tools = [],
      tool_choice = null,
      previous_response_id = null,
      store = true,
      include = []
    } = req.body;
    
    if (!input || typeof input !== "string") {
      return res.status(400).json({ error: "Invalid input" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "OpenAI service not initialized" });
    }

    // Validate model supports Responses API
    const isGPT5Model = model.startsWith('gpt-5');
    if (!isGPT5Model) {
      return res.status(400).json({ 
        error: "Model does not support Responses API. Use GPT-5, GPT-5 Mini, or GPT-5 Nano." 
      });
    }
    
    console.log(`Processing Responses API request with model: ${model}`);

    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Transfer-Encoding", "chunked");
    ;(res as any).flushHeaders?.();

    let conversationTitle = input.slice(0, 100);
    let dbConversation;
    let streamedResponse = "";
    let keepAliveInterval: NodeJS.Timeout | null = null;

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
        content: input,
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
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, parseInt(conversationId)))
        .limit(1);

      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (conversation.user_id !== req.user!.id) {
        return res.status(403).json({ error: "Access denied" });
      }

      const timestamp = new Date();
      await db.insert(messages).values({
        conversation_id: conversation.id,
        role: "user",
        content: input,
        created_at: timestamp,
      });

      await db
        .update(conversations)
        .set({ last_message_at: timestamp })
        .where(eq(conversations.id, conversation.id));

      dbConversation = conversation;
    }

    // As soon as we have a conversation id, open the stream and notify client
    res.write(`data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`);
    ;(res as any).flush?.();
    // Start keep-alive pings; store handle on res to clear later
    keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
      ;(res as any).flush?.();
    }, 15000);
    ;(res as any)._keepAliveInterval = keepAliveInterval;

    // Prepare knowledge content if enabled
    let knowledgeContent = "";
    if (useKnowledge) {
      try {
        knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, input);
        console.log(`Knowledge content prepared, length: ${knowledgeContent.length}`);
      } catch (error) {
        console.error("Error preparing knowledge content:", error);
      }
    }

    // Process attachments (images, documents) for Responses API
    const allAttachmentsToProcess = (allAttachments && allAttachments.length > 0)
      ? allAttachments
      : (attachment ? [attachment] : []);

    const imageDataUris: string[] = [];
    const documentTexts: string[] = [];

    for (const att of allAttachmentsToProcess) {
      if (!att || !att.type) continue;
      if (att.type === 'image' && att.url) {
        try {
          const fileName = String(att.url).split('/').pop();
          if (!fileName) throw new Error('Invalid image URL');
          const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
          if (!fs.existsSync(imagePath)) throw new Error('Image file not found on server');
          const imageBuffer = fs.readFileSync(imagePath);
          const base64Image = imageBuffer.toString('base64');
          const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
          const dataUri = `data:${mimeType};base64,${base64Image}`;
          imageDataUris.push(dataUri);
        } catch (imageError) {
          console.error('Error processing image for GPT-5 Responses API:', imageError);
          documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
        }
      } else if (att.type === 'document' && att.text) {
        // Preserve any extracted text from uploaded documents
        documentTexts.push(`--- Document: ${att.name || 'Attachment'} ---\n${att.text}`);
      }
    }

    // Build the request payload for Responses API
    // Note: GPT-5 Responses API does not support temperature parameter
    // Temperature control is replaced by reasoning effort and verbosity settings
    const responsesPayload: any = {
      model,
      // input will be assigned below depending on attachment presence
      reasoning,
      text,
      store,
      include
    };

    // Build structured input when we have images/documents/knowledge
    const hasRichInput = imageDataUris.length > 0 || documentTexts.length > 0 || !!knowledgeContent;
    if (hasRichInput) {
      let textContent = input;
      if (documentTexts.length > 0) {
        textContent += `\n\nDocuments Content:\n${documentTexts.join("\n\n")}`;
      }
      if (knowledgeContent) {
        // Prepend knowledge in a labeled section for clarity
        textContent = `Knowledge Sources:\n${knowledgeContent}\n\nUser query: ${textContent}`;
      }

      const contentParts: any[] = [
        { type: 'input_text', text: textContent }
      ];
      for (const uri of imageDataUris) {
        contentParts.push({ type: 'input_image', image_url: uri });
      }
      responsesPayload.input = [
        {
          role: 'user',
          content: contentParts
        }
      ];
    } else {
      // Simple text input
      responsesPayload.input = input;
    }

    // Add previous response ID if provided
    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    // Add tools if enabled
    if (useTools && tools.length > 0) {
      // Transform tools to Responses API format (flatten the structure)
      responsesPayload.tools = tools.map((tool: any) => ({
        type: 'function',
        name: tool.function?.name || tool.name,
        description: tool.function?.description || tool.description,
        parameters: tool.function?.parameters || tool.parameters
      }));
      if (tool_choice) {
        responsesPayload.tool_choice = tool_choice;
      }
    } else if (useTools) {
      // Get default tool definitions and transform to Responses API format
      const toolDefinitions = await getToolDefinitions();
      // Transform from Chat Completions format to Responses API format
      responsesPayload.tools = toolDefinitions.map((tool: any) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }));
    }

    console.log("Responses API payload:", JSON.stringify(responsesPayload, null, 2));

    // Make the Responses API call
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(responsesPayload),
      });

      console.log('Responses API HTTP status:', response.status);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        console.error('Responses API error details:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        
        // If Responses API is not available, fall back to Chat Completions
        if (response.status === 404) {
          console.log('Responses API not available, falling back to Chat Completions API');
          throw new Error('Responses API not available - endpoint may not exist yet');
        }
        
        throw new Error(`Responses API error: ${response.status} ${errorData?.error?.message || response.statusText}`);
      }

      // Don't read the response body here, do it after the try-catch
      console.log("Responses API call successful, will parse response data");
      
    } catch (fetchError) {
      console.error('Failed to call Responses API:', fetchError);
      
      // Fall back to Chat Completions API for GPT-5
      console.log('Falling back to Chat Completions API for GPT-5');
      
      // Send error message to user explaining the fallback
      res.write(
        `data: ${JSON.stringify({ 
          type: "chunk", 
          content: "⚠️ GPT-5 Responses API not available. Using Chat Completions API instead.\n\n" 
        })}\n\n`,
      );
      
      // Use a compatible model for Chat Completions (gpt-4o instead of gpt-5)
      const fallbackModel = model.replace('gpt-5', 'gpt-4o');
      console.log(`Using fallback model: ${fallbackModel}`);
      
      // Create chatMessages array from input for Chat Completions, including images if present
      const chatMessages: any[] = [];
      if (imageDataUris.length > 0 || documentTexts.length > 0 || knowledgeContent) {
        let textContent = input;
        if (documentTexts.length > 0) {
          textContent += `\n\nDocuments Content:\n${documentTexts.join("\n\n")}`;
        }
        if (knowledgeContent) {
          textContent = `Knowledge Sources:\n${knowledgeContent}\n\nUser query: ${textContent}`;
        }
        const contentArray: any[] = [{ type: 'text', text: textContent }];
        for (const uri of imageDataUris) {
          contentArray.push({ type: 'image_url', image_url: { url: uri } });
        }
        chatMessages.push({ role: 'user', content: contentArray });
      } else {
        chatMessages.push({ role: 'user', content: input });
      }
      
      // Call Chat Completions API instead
      const isReasoningModelFallback = fallbackModel.includes('o1') || fallbackModel.includes('o3') || fallbackModel.includes('gpt-4o') || fallbackModel.includes('gpt-5');
      const stream = await client.chat.completions.create({
        model: fallbackModel,
        messages: chatMessages as any,
        stream: true,
        temperature: isReasoningModelFallback ? 1 : 0.7
      });
      
      // Process the stream like normal Chat Completions
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || "";
        if (content) {
          streamedResponse += content;
          res.write(
            `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
          );
        }
      }
      
      // Save the response and end
      const timestamp = new Date();
      await db.insert(messages).values({
        conversation_id: dbConversation.id,
        role: "assistant",
        content: streamedResponse,
        created_at: timestamp,
      });

      const updatedConversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, dbConversation.id),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.created_at)],
          },
        },
      });

      if (!updatedConversation) {
        throw new Error("Failed to retrieve conversation after fallback");
      }

      res.write(
        `data: ${JSON.stringify({
          type: "end",
          conversation: transformDatabaseConversation(updatedConversation),
        })}\n\n`,
      );
      
      return;
    }

    const responseData = await response.json();
    
    console.log("=== FULL RESPONSES API RESPONSE ===");
    console.log(JSON.stringify(responseData, null, 2));
    console.log("=== END RESPONSE ===");
    
    // Debug: Check for tool calls in different possible locations
    console.log("Checking for tool calls:");
    console.log("responseData.tool_calls:", responseData.tool_calls);
    console.log("responseData.output:", responseData.output);
    console.log("responseData.choices:", responseData.choices);

    // Send initial conversation data and start keep-alive pings
    res.write(
      `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
    );
    // keep-alive managed earlier

    // Extract content and stream it (robust extractor)
    const extracted = extractResponseText(responseData);
    console.log('Extracted content:', { 
      contentLength: extracted.length, 
      sample: extracted.substring(0, 100) + (extracted.length > 100 ? '...' : '') 
    });
    streamedResponse = extracted;

    if (extracted) {
      // Send the content as chunks to match the frontend streaming expectation
      const chunkSize = 50;
      for (let i = 0; i < extracted.length; i += chunkSize) {
        const chunk = extracted.slice(i, i + chunkSize);
        res.write(
          `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`,
        );
        // Small delay to simulate streaming for better UX
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } else {
      console.log("No content found in response payload");
      // Send a message if no content was returned
      res.write(
        `data: ${JSON.stringify({ type: "chunk", content: "No response content received from GPT-5." })}\n\n`,
      );
    }

    // Handle tool calls if present
    const toolCalls = responseData.output?.filter((item: any) => item.type === 'function_call') || [];
    if (toolCalls.length > 0 && useTools) {
      try {
        console.log('Executing tool calls from Responses API:', JSON.stringify(toolCalls, null, 2));
        
        // Store tool calls as internal messages
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "tool",
          content: JSON.stringify(toolCalls),
          metadata: { type: 'tool_calls', response_id: responseData.id },
          created_at: timestamp,
        });
        
        // Transform Responses API tool calls to the format expected by handleToolCalls
        const transformedToolCalls = toolCalls.map((toolCall: any) => ({
          id: toolCall.call_id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }));
        
        // Execute all tool calls
        const toolResults = await handleToolCalls(transformedToolCalls);
        console.log('Tool execution results:', JSON.stringify(toolResults, null, 2));
        
        // Store tool results as internal messages
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "tool",
          content: JSON.stringify(toolResults),
          metadata: { type: 'tool_results', response_id: responseData.id },
          created_at: new Date(),
        });
        
        // Instead of making a follow-up request, send the tool results directly to the user
        // since the Responses API doesn't seem to support follow-up requests with tool results
        const toolResultText = toolResults.map(result => {
          if (result.error) {
            return `Tool ${result.toolName} failed: ${result.error}`;
          } else {
            return `Tool ${result.toolName} result: ${JSON.stringify(result.result, null, 2)}`;
          }
        }).join('\n\n');
        
        // Send tool results to user
        res.write(`data: ${JSON.stringify({ 
          type: "chunk", 
          content: '\n\n' + toolResultText 
        })}\n\n`);
        
        streamedResponse += '\n\n' + toolResultText;
        
      } catch (toolError) {
        console.error('Error executing tools from Responses API:', toolError);
        // Store tool error as internal message
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "tool",
          content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : 'Unknown tool execution error' }),
          metadata: { type: 'tool_error', response_id: responseData.id },
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
    await db.insert(messages).values({
      conversation_id: dbConversation.id,
      role: "assistant",
      content: streamedResponse,
      metadata: { 
        response_id: responseData.id,
        reasoning_tokens: responseData.usage?.reasoning_tokens,
        total_tokens: responseData.usage?.total_tokens,
        // Responses API path is non-streaming in this handler, TTFT not captured
      },
      created_at: timestamp,
    });

    // Send completion event
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
        response_metadata: {
          response_id: responseData.id,
          reasoning_tokens: responseData.usage?.reasoning_tokens,
          total_tokens: responseData.usage?.total_tokens,
          reasoning_effort: reasoning.effort,
          verbosity: text.verbosity
        }
      })}\n\n`,
    );

  } catch (error) {
    console.error("Responses API error:", error);
    res.write(
      `data: ${JSON.stringify({
        type: "error",
        error: error instanceof Error ? error.message : "Unknown error",
      })}\n\n`,
    );
  } finally {
    try {
      // keepAliveInterval is scoped within handler; guard at runtime
      const anyRes: any = res;
      if (typeof anyRes._keepAliveInterval !== 'undefined' && anyRes._keepAliveInterval) {
        clearInterval(anyRes._keepAliveInterval);
      }
    } catch {}
    res.end();
  }
}

// GPT-5 Responses API endpoint
router.post("/responses", handleResponsesAPI);

export default router;