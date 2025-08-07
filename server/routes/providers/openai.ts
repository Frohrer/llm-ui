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

const router = express.Router();
let client: OpenAI | null = null;

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
    } = req.body;
    
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

    // Ensure context messages are properly ordered
    const apiMessages = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => ({
        role: msg.role,
        content: msg.content,
      }));

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
        const streamOptions: any = {
          messages: apiMessages,
          model,
          stream: true,
          max_completion_tokens: 4096,
          temperature: model === "o3" ? 1 : 0.7,
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

// GPT-5 Responses API endpoint
router.post("/responses", async (req: Request, res: Response) => {
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
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let conversationTitle = input.slice(0, 100);
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

    // Build the request payload for Responses API
    const responsesPayload: any = {
      model,
      input: knowledgeContent ? `${knowledgeContent}\n\nUser query: ${input}` : input,
      reasoning,
      text,
      store,
      include
    };

    // Add previous response ID if provided
    if (previous_response_id) {
      responsesPayload.previous_response_id = previous_response_id;
    }

    // Add tools if enabled
    if (useTools && tools.length > 0) {
      responsesPayload.tools = tools;
      if (tool_choice) {
        responsesPayload.tool_choice = tool_choice;
      }
    } else if (useTools) {
      // Get default tool definitions
      const toolDefinitions = getToolDefinitions();
      responsesPayload.tools = toolDefinitions;
    }

    console.log("Responses API payload:", JSON.stringify(responsesPayload, null, 2));

    // Make the Responses API call
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(responsesPayload),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error('Responses API error:', response.status, errorData);
      throw new Error(`Responses API error: ${response.status} ${errorData?.error?.message || 'Unknown error'}`);
    }

    const responseData = await response.json();
    console.log("Responses API response:", JSON.stringify(responseData, null, 2));

    // Send initial conversation data
    res.write(
      `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
    );

    // Extract content and stream it
    const content = responseData.text?.content || responseData.content || "";
    streamedResponse = content;

    if (content) {
      // Stream the content in chunks for better UX
      const chunkSize = 50;
      for (let i = 0; i < content.length; i += chunkSize) {
        const chunk = content.slice(i, i + chunkSize);
        res.write(
          `data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`,
        );
        // Small delay to simulate streaming
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Handle tool calls if present
    if (responseData.tool_calls && responseData.tool_calls.length > 0 && useTools) {
      try {
        console.log('Executing tool calls from Responses API:', JSON.stringify(responseData.tool_calls, null, 2));
        
        // Store tool calls as internal messages
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "tool",
          content: JSON.stringify(responseData.tool_calls),
          metadata: { type: 'tool_calls', response_id: responseData.id },
          created_at: timestamp,
        });
        
        // Execute all tool calls
        const toolResults = await handleToolCalls(responseData.tool_calls);
        
        // Store tool results as internal messages
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "tool",
          content: JSON.stringify(toolResults),
          metadata: { type: 'tool_results', response_id: responseData.id },
          created_at: new Date(),
        });
        
        // Send tool results back to get additional response
        const followUpPayload = {
          model,
          input: `Tool results: ${JSON.stringify(toolResults, null, 2)}`,
          previous_response_id: responseData.id,
          reasoning,
          text,
          store,
          include
        };

        const followUpResponse = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(followUpPayload),
        });

        if (followUpResponse.ok) {
          const followUpData = await followUpResponse.json();
          const followUpContent = followUpData.text?.content || followUpData.content || "";
          
          if (followUpContent) {
            res.write(`data: ${JSON.stringify({ 
              type: "chunk", 
              content: '\n\n' + followUpContent 
            })}\n\n`);
            
            streamedResponse += '\n\n' + followUpContent;
          }
        }
        
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
        total_tokens: responseData.usage?.total_tokens
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
    res.end();
  }
});

export default router;