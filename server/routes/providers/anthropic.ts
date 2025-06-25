import express, { Request, Response } from 'express';
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { getToolDefinitions, handleToolCalls } from "../../tools";

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

// Helper function to process attachments
async function processAttachments(allAttachments: any[]) {
  const imageAttachments: any[] = [];
  const documentTexts: string[] = [];
  
  for (const att of allAttachments) {
    if (att.type === 'image') {
      try {
        const fileName = att.url.split('/').pop();
        if (!fileName) {
          throw new Error('Invalid image URL');
        }
        
        const imagePath = path.join(process.cwd(), 'uploads', 'images', fileName);
        
        if (!fs.existsSync(imagePath)) {
          throw new Error('Image file not found on server');
        }
        
        const imageBuffer = fs.readFileSync(imagePath);
        const base64Image = imageBuffer.toString('base64');
        const mimeType = path.extname(fileName).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
        
        imageAttachments.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mimeType,
            data: base64Image
          }
        });
      } catch (imageError) {
        console.error("Error processing image for Anthropic:", imageError);
        documentTexts.push(`[Image processing failed: ${imageError instanceof Error ? imageError.message : 'Unknown error'}]`);
      }
    } else if (att.type === 'document' && att.text) {
      documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
    }
  }
  
  return { imageAttachments, documentTexts };
}

// Helper function to create user message content
function createUserMessageContent(message: string, imageAttachments: any[], documentTexts: string[], knowledgeContent: string) {
  let textContent = message;
  
  if (documentTexts.length > 0) {
    textContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
  }
  
  if (knowledgeContent) {
    textContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
  }
  
  if (imageAttachments.length > 0) {
    return [
      { type: "text", text: textContent },
      ...imageAttachments
    ];
  } else {
    return textContent;
  }
}

// Helper function to execute tools and get response
async function executeToolsAndGetResponse(
  client: Anthropic,
  toolCalls: any[],
  conversationMessages: any[],
  model: string,
  conversationId: number
): Promise<string> {
  // Store tool calls as internal messages
  await db.insert(messages).values({
    conversation_id: conversationId,
    role: "tool",
    content: JSON.stringify(toolCalls),
    metadata: { type: 'tool_calls' },
    created_at: new Date(),
  });
  
  // Execute all tool calls
  const toolResults = await handleToolCalls(toolCalls);
  
  // Store tool results as internal messages
  await db.insert(messages).values({
    conversation_id: conversationId,
    role: "tool",
    content: JSON.stringify(toolResults),
    metadata: { type: 'tool_results' },
    created_at: new Date(),
  });
  
  // Create messages for Anthropic API with tool results
  const toolResponseMessages = [
    ...conversationMessages,
    // Assistant message with tool use
    { 
      role: 'assistant' as const, 
      content: toolCalls.map(toolCall => ({
        type: 'tool_use',
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.arguments
      }))
    },
    // User message with tool results
    { 
      role: 'user' as const, 
      content: toolResults.map(result => ({
        type: 'tool_result',
        tool_use_id: result.toolCallId,
        content: result.error ? 
          `Error: ${result.error}` : 
          JSON.stringify(result.result, null, 2).substring(0, 4000) // Limit size
      }))
    }
  ];
  
  // Get final response with tool results
  const toolCompletionResponse = await client.messages.create({
    model: model,
    messages: toolResponseMessages,
    temperature: 0.7,
    max_tokens: 4096,
  });
  
  // Extract text content from response
  let finalResponse = '';
  if (toolCompletionResponse.content && toolCompletionResponse.content.length > 0) {
    const textBlocks = toolCompletionResponse.content.filter(block => block.type === 'text');
    if (textBlocks.length > 0) {
      finalResponse = textBlocks.map(block => block.text).join('\n\n');
    }
  }
  
  if (!finalResponse) {
    finalResponse = "I've processed your request using the available tools.";
  }
  
  return finalResponse;
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
      useTools = false,
    } = req.body;
    
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Invalid message" });
    }
    
    if (!client) {
      return res.status(503).json({ error: "Anthropic service not initialized" });
    }
    


    // Set up SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    let conversationTitle = message.slice(0, 100);
    let dbConversation;

    // Create or update conversation
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

      // Add pending knowledge sources
      if (pendingKnowledgeSources && pendingKnowledgeSources.length > 0) {
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
        content: message,
        created_at: timestamp,
      });

      dbConversation = existingConversation;
    }

    // Process context messages
    const apiMessages = context
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map((msg: any) => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      }));

    // Process attachments
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    const { imageAttachments, documentTexts } = await processAttachments(allAttachmentsToProcess);

    // Get knowledge content if requested
    let knowledgeContent = '';
    if (useKnowledge && dbConversation) {
      try {
        knowledgeContent = await prepareKnowledgeContentForConversation(dbConversation.id, message);
      } catch (knowledgeError) {
        console.error("Error retrieving knowledge content:", knowledgeError);
      }
    }

    // Set up the API request
    let requestOptions: any = {
      messages: [],
      model,
      max_tokens: 4096,
      temperature: 0.7,
      stream: true,
    };



    // Add tools if enabled
    if (useTools) {
      try {
        const toolDefinitions = await getToolDefinitions();
        
        if (toolDefinitions.length > 0) {
          const anthropicTools = toolDefinitions.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          }));
          
          requestOptions.tools = anthropicTools;
        }
      } catch (toolError) {
        console.error("Error loading tools:", toolError);
      }
    }

    // Create user message content
    const userMessageContent = createUserMessageContent(message, imageAttachments, documentTexts, knowledgeContent);
    apiMessages.push({ role: "user", content: userMessageContent });
    requestOptions.messages = apiMessages;



    // Send initial conversation data
    res.write(`data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`);

    // Set up keep-alive
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    let streamedResponse = "";
    let toolCallsInProgress: { [index: number]: any } = {};

        try {
      // Create stream
      const stream = await client.messages.create(requestOptions);

      // Process stream
      for await (const chunk of stream as any) {
        if (chunk.type === 'content_block_start') {
          const contentBlock = chunk.content_block;
          
          if (contentBlock?.type === 'text' && contentBlock.text) {
            const content = contentBlock.text;
            streamedResponse += content;
            res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
          } else if (contentBlock?.type === 'tool_use') {
            // Initialize tool call - input will come in delta events
            const toolIndex = chunk.index;
            toolCallsInProgress[toolIndex] = {
              id: contentBlock.id,
              name: contentBlock.name,
              arguments: contentBlock.input || {},
              partialJsonString: '',
              index: toolIndex
            };
          }
        } else if (chunk.type === 'content_block_delta') {
          const delta = chunk.delta;
          
          if (delta?.text) {
            const content = delta.text;
            streamedResponse += content;
            res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
          } else if (delta?.type === 'input_json_delta' && delta?.partial_json) {
            // Accumulate tool input JSON chunks
            const index = chunk.index;
            if (index !== undefined && toolCallsInProgress[index]) {
              toolCallsInProgress[index].partialJsonString += delta.partial_json;
            }
          }
        } else if (chunk.type === 'content_block_stop') {
          // Finalize tool arguments when content block stops
          const index = chunk.index;
          if (index !== undefined && toolCallsInProgress[index] && toolCallsInProgress[index].partialJsonString) {
            try {
              const completeJson = JSON.parse(toolCallsInProgress[index].partialJsonString);
              toolCallsInProgress[index].arguments = completeJson;
            } catch (parseError) {
              console.error(`Failed to parse tool arguments for tool ${index}:`, parseError);
            }
            delete toolCallsInProgress[index].partialJsonString;
          }
        }
      }

      const toolCallsArray = Object.values(toolCallsInProgress);

      // Handle tool calls if present
      if (useTools && toolCallsArray.length > 0) {
        // Clean up tool calls (remove temporary fields) and validate
        const cleanedToolCalls = toolCallsArray.map((toolCall: any) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }));
        
        // Validate tool calls
        const validToolCalls = cleanedToolCalls.filter((toolCall: any) => {
          if (!toolCall.id || !toolCall.name) {
            return false;
          }
          
          if (toolCall.arguments === null || toolCall.arguments === undefined) {
            return false;
          }
          
          if (typeof toolCall.arguments !== 'object') {
            return false;
          }
          
          // Empty arguments object is valid for tools with all optional parameters
          return true;
        });
        
        if (validToolCalls.length === 0) {
          const errorMessage = "\n\nI attempted to use a tool but there was an issue with the tool call. Please try rephrasing your request.";
          
          res.write(`data: ${JSON.stringify({ type: "chunk", content: errorMessage })}\n\n`);
          
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse + errorMessage,
            created_at: new Date(),
          });
          
          streamedResponse += errorMessage;
        } else {
          
          // Save initial response if it exists
          if (streamedResponse.trim()) {
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "assistant",
              content: streamedResponse,
              created_at: new Date(),
            });
          }
          
          // Execute tools and get final response
          const toolResponse = await executeToolsAndGetResponse(
            client,
            validToolCalls,
            apiMessages,
            model,
            dbConversation.id
          );
          
          // Stream the tool response
          res.write(`data: ${JSON.stringify({ type: "chunk", content: toolResponse })}\n\n`);
          
          // Save the tool response
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: toolResponse,
            metadata: { type: 'tool_result_response' },
            created_at: new Date(),
          });
          
          streamedResponse += toolResponse;
        }
      } else {
        // No tool calls - save the response normally
        if (streamedResponse.trim()) {
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: new Date(),
          });
        } else {
          // Handle empty response
          const fallbackMessage = "I'm sorry, I couldn't generate a response to your query.";
          streamedResponse = fallbackMessage;
          res.write(`data: ${JSON.stringify({ type: "chunk", content: fallbackMessage })}\n\n`);
          
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: new Date(),
          });
        }
      }

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

      res.write(`data: ${JSON.stringify({
        type: "end",
        conversation: transformDatabaseConversation(updatedConversation),
      })}\n\n`);

    } catch (streamError) {
      console.error("Streaming error:", streamError);
      res.write(`data: ${JSON.stringify({
        type: "error",
        error: streamError instanceof Error ? streamError.message : "Stream interrupted",
      })}\n\n`);
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