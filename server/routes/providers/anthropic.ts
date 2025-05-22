import express, { Request, Response } from 'express';
import Anthropic from "@anthropic-ai/sdk";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { getToolDefinitions, getTools, handleToolCalls } from "../../tools";

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
    
    console.log(`Processing message with ${allAttachments.length} attachments for Anthropic`);

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

    // Ensure context messages are properly ordered and format for Anthropic
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
    let stream;
    const maxRetries = 3;
    let retryCount = 0;
    
    // Get all attachments (prioritize the allAttachments array if it exists)
    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);
    
    console.log(`Processing ${allAttachmentsToProcess.length} attachments for Anthropic`);
    
    // Variables to track attachment types
    let hasImageAttachment = false;
    let imageAttachments: any[] = [];
    let documentTexts: string[] = [];
    
    // Process each attachment
    for (const att of allAttachmentsToProcess) {
      // Handle image attachments
      if (att.type === 'image') {
        try {
          console.log("Processing image attachment for Anthropic:", att.url);
          
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
          
          // Add to image attachments array for Claude
          imageAttachments.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mimeType,
              data: base64Image
            }
          });
          
          hasImageAttachment = true;
          console.log("Image successfully processed for Anthropic");
        } catch (imageError) {
          console.error("Error processing image for Anthropic:", imageError);
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
        console.log(`Processing document attachment for Anthropic: ${att.name}`);
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

    // Set up the API request
    let requestOptions: any = {
      messages: [],
      model,
      max_tokens: 4096,
      temperature: 0.7,
      stream: true,
    };

    // Add tools if enabled
    let toolDefinitions = [];
    if (useTools) {
      try {
        console.log("Attempting to load tools for Anthropic...");
        toolDefinitions = await getToolDefinitions();
        console.log(`Loaded ${toolDefinitions.length} tools:`, JSON.stringify(toolDefinitions));
        
        if (toolDefinitions.length > 0) {
          // Convert OpenAI tool format to Anthropic tools format
          const anthropicTools = toolDefinitions.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          }));
          
          requestOptions.tools = anthropicTools;
          console.log(`Added ${anthropicTools.length} tools to Anthropic request: ${anthropicTools.map(t => t.name).join(', ')}`);
        } else {
          console.warn("No tools were loaded, tool calling will not work");
          
          // Log the specific issue for debugging
          try {
            const tools = await getTools();
            console.log(`Raw tools loaded: ${tools.length}`);
            
            // Tell the user no tools are available
            res.write(`data: ${JSON.stringify({ 
              type: "chunk", 
              content: "\n\nNote: Tools were requested but none are available. The server may need to be restarted or there may be configuration issues."
            })}\n\n`);
          } catch (innerError) {
            console.error("Error getting raw tools:", innerError);
          }
        }
      } catch (toolError) {
        console.error("Error loading tools:", toolError);
        
        // Tell the user about the error
        res.write(`data: ${JSON.stringify({ 
          type: "chunk", 
          content: `\n\nError loading tools: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`
        })}\n\n`);
      }
    } else {
      console.log("Tool usage is disabled for this request");
    }

    // Create the message based on what we have
    if (hasImageAttachment) {
      // For Anthropic with images, create a message with text and image attachments
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
      
      console.log("Multimodal message with images, documents, and knowledge added for Anthropic");
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
      console.log("Message with document/knowledge content added for Anthropic");
    } 
    else {
      // Regular text message without attachments or knowledge
      apiMessages.push({ role: "user", content: message });
      console.log("Plain text message added for Anthropic");
    }

    // Add the messages to the request
    requestOptions.messages = apiMessages;

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

      // Create Anthropic message stream with retries
      while (retryCount < maxRetries) {
        try {
          stream = await client.messages.create(requestOptions);
          console.log("Anthropic stream created with model:", model);
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

      // Process the stream
      for await (const chunk of stream as any) {
        // Debug the received chunk structure - uncomment for debugging
        console.log("Anthropic chunk received type:", chunk.type);
        
        // Handle all types of content from Claude API
        if (chunk.type === 'content_block_delta') {
          const contentDelta = chunk.delta;
          // Handle text delta - check if it's a TextDelta with text property
          if (contentDelta && 'text' in contentDelta) {
            const content = contentDelta.text;
            if (content && content.trim().length > 0) {
              streamedResponse += content;
              lastChunkTime = Date.now();
              res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
            } else {
              // Just update lastChunkTime but don't send empty content
              lastChunkTime = Date.now();
              console.log("Received empty content_block_delta, not sending to user");
            }
          }
        } 
        else if (chunk.type === 'content_block_start') {
          const contentBlock = chunk.content_block;
          // Check if it's a TextBlock with text property
          if (contentBlock && contentBlock.type === 'text' && 'text' in contentBlock) {
            const content = contentBlock.text;
            if (content && content.trim().length > 0) {
              streamedResponse += content;
              lastChunkTime = Date.now();
              res.write(`data: ${JSON.stringify({ type: "chunk", content })}\n\n`);
            } else {
              // Just update lastChunkTime but don't send empty content
              lastChunkTime = Date.now();
              console.log("Received empty content_block_start, not sending to user");
            }
          }
        }
        else if (chunk.type === 'message_delta' && chunk.delta && chunk.delta.stop_reason) {
          // Message completion
          console.log("Anthropic message completed, reason:", chunk.delta.stop_reason);
          lastChunkTime = Date.now();
          
          // Check if the model is requesting to use a tool
          if (chunk.delta.stop_reason === 'tool_use') {
            console.log("Detected tool_use stop reason, waiting for tool_use event");
            // Look for tool use details in the chunk data
            if (chunk.delta.tool_calls && chunk.delta.tool_calls.length > 0) {
              console.log("Found tool calls in message_delta:", JSON.stringify(chunk.delta.tool_calls));
              
              // Process tool calls directly from message_delta if available
              for (const toolCall of chunk.delta.tool_calls) {
                toolCallsInProgress.push({
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.input || {}
                });
              }
            }
          }
        }
        else if (chunk.type === 'tool_use') {
          // Handle tool use
          console.log("Tool use detected:", JSON.stringify(chunk));
          
          // Add the tool call to the in-progress array
          const toolCall = {
            id: chunk.id,
            name: chunk.name,
            arguments: chunk.input || {}
          };
          
          toolCallsInProgress.push(toolCall);
          
          // Update the last chunk time to prevent timeout
          lastChunkTime = Date.now();
          
          // Don't notify the client that a tool is being used - silently handle tools
        }

        // Check for timeout between chunks
        if (Date.now() - lastChunkTime > chunkTimeout) {
          throw new Error("Stream timeout - no data received for 30 seconds");
        }
      }

      // Log the state after stream completion
      console.log(`Stream completed. Has content: ${streamedResponse.trim().length > 0}, Tool calls: ${toolCallsInProgress.length}`);
      
      // Check if the stream ended with stop_reason="tool_use" but no tool calls were registered
      // This might happen if there's a bug in how we process tool_use events
      if (streamedResponse.includes("I'll help you") && streamedResponse.includes("function") && toolCallsInProgress.length === 0) {
        console.log("WARNING: Detected tool-related content in response but no tool calls were registered");
        console.log("Response content:", streamedResponse);
        
        // Look for function name in the response text
        const functionNameMatch = streamedResponse.match(/using the (\w+) function/);
        if (functionNameMatch && functionNameMatch[1]) {
          const functionName = functionNameMatch[1];
          console.log(`Attempting to recover by creating tool call for "${functionName}"`);
          
          // Create a tool call based on response text
          toolCallsInProgress.push({
            id: `recovered_${Date.now()}`,
            name: functionName,
            arguments: {}
          });
        }
      }

      // Check if we need to execute tool calls
      // Handle the case where the model stopped with a tool_use without generating content
      if (useTools && toolCallsInProgress.length > 0) {
        console.log('Executing tool calls after stream completion:', JSON.stringify(toolCallsInProgress));
        
        // Skip saving empty assistant message before tool execution
        // If streamedResponse is empty, we'll only save the final response after tool execution
        const shouldSaveInitialMessage = streamedResponse.trim().length > 0;
        
        if (shouldSaveInitialMessage) {
          console.log("Saving non-empty initial message before tool execution:", streamedResponse);
          
          // Check if the message is purely an introduction to using a tool without any other useful content
          const isMereToolIntroduction = 
            // Common patterns that just state "I'll use X function"
            (streamedResponse.match(/^I'll help you .* using the \w+ function\.?$/i) || 
             streamedResponse.match(/^I'll use the \w+ function\.?$/i) ||
             streamedResponse.match(/^I'll use \w+ to .*\.?$/i)) &&
            // Ensure it's not a longer explanation
            streamedResponse.split(/[.!?]\s+/).length <= 2;
          
          if (isMereToolIntroduction) {
            console.log("Detected mere tool introduction message - skipping display and storing as metadata");
            
            // Instead of displaying the introduction, we'll store it as metadata
            // We won't show this to the user, but we'll execute the tool silently
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "assistant",
              content: "",  // Empty content - won't display to user
              metadata: { 
                type: 'tool_introduction',
                original_message: streamedResponse
              },
              created_at: new Date(),
            });
          } else {
            // This is a substantive message with useful content
            // Show this to the user before executing the tool
            console.log("Message contains substantive content beyond tool introduction - displaying to user");
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "assistant",
              content: streamedResponse,
              created_at: new Date(),
            });
          }
          
          // Clear streamedResponse after saving so we don't duplicate it
          // The tool execution response will be added to a fresh streamedResponse
          streamedResponse = "";
        } else {
          console.log("Initial message is empty, skipping save before tool execution");
        }
        
        try {
          // Store tool calls as internal messages
          const timestamp = new Date();
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify(toolCallsInProgress),
            metadata: { type: 'tool_calls' },
            created_at: timestamp,
          });
          
          // Execute all tool calls
          const toolResults = await handleToolCalls(toolCallsInProgress);
          console.log("Tool execution results:", JSON.stringify(toolResults, null, 2));
          
          // Store tool results as internal messages
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "tool",
            content: JSON.stringify(toolResults),
            metadata: { type: 'tool_results' },
            created_at: new Date(),
          });
          
          // Get an additional LLM response with the tool results
          // Create messages in the format Anthropic expects
          const toolResponseMessages = [
            ...apiMessages,
            // Use plain text for the assistant's tool call
            { 
              role: 'assistant' as const, 
              content: `I'm using the ${toolCallsInProgress[0].name} tool with input: ${JSON.stringify(toolCallsInProgress[0].arguments)}`
            },
            // Tool response as plain text
            { 
              role: 'user' as const, 
              content: `Here is the result from the ${toolCallsInProgress[0].name} tool: ${JSON.stringify(toolResults[0].result, null, 2)}`
            }
          ];
          
          console.log("Sending tool results back to Anthropic for processing:", 
            JSON.stringify(toolResults[0].result, null, 2));
          
          try {
            // Get final response with tool results
            const toolCompletionResponse = await client.messages.create({
              model: model,
              messages: toolResponseMessages as any,
              temperature: 0.7,
              max_tokens: 4096,
            });
            
            // Safely access content array and get text
            let toolFinalResponse = '';
            if (toolCompletionResponse.content && toolCompletionResponse.content.length > 0) {
              const contentBlock = toolCompletionResponse.content[0];
              if (contentBlock.type === 'text') {
                toolFinalResponse = contentBlock.text;
                console.log("Received final response from Anthropic after tool execution:", toolFinalResponse);
              } else {
                console.log("Unexpected content block type in tool completion response:", contentBlock.type);
              }
            } else {
              console.log("No content blocks in tool completion response from Anthropic");
            }
            
            // Send the tool result and final response to the user
            if (toolFinalResponse) {
              // Add the final response to the streamed response
              streamedResponse = toolFinalResponse; // Replace empty streamedResponse with tool result response
              
              // Send the response to the client
              res.write(`data: ${JSON.stringify({ 
                type: "chunk", 
                content: toolFinalResponse 
              })}\n\n`);
            } else {
              // If no response after tool execution, provide a generic message
              const fallbackMessage = "I've processed your request but couldn't generate a response.";
              streamedResponse = fallbackMessage;
              res.write(`data: ${JSON.stringify({ 
                type: "chunk", 
                content: fallbackMessage 
              })}\n\n`);
            }
          } catch (toolResponseError) {
            console.error("Error getting response after tool execution:", toolResponseError);
            
            // Handle error with tool response
            const errorMessage = `Error processing tool results: ${toolResponseError instanceof Error ? toolResponseError.message : 'Unknown error'}`;
            streamedResponse = errorMessage;
            
            res.write(`data: ${JSON.stringify({ 
              type: "chunk", 
              content: errorMessage 
            })}\n\n`);
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
          
          // Notify the client of the error
          res.write(`data: ${JSON.stringify({ 
            type: "chunk", 
            content: `\n\n[Tool execution error: ${toolError instanceof Error ? toolError.message : 'Unknown error'}]` 
          })}\n\n`);
          
          // Set streamedResponse if it's empty
          if (!streamedResponse) {
            streamedResponse = `[Tool execution error: ${toolError instanceof Error ? toolError.message : 'Unknown error'}]`;
          }
        }
        
        // Save the final response after tool execution (replaces empty initial response)
        const timestamp = new Date();
        
        // If we already saved a non-empty initial message, store this as a continuation
        if (shouldSaveInitialMessage) {
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            metadata: { type: 'tool_result_response' },
            created_at: timestamp,
          });
        } else {
          // Otherwise this is the only response we're saving
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: timestamp,
          });
        }
      } else {
        // No tool calls or tools not enabled - save the response normally
        // Save the complete response only if it's not empty
        if (streamedResponse.trim().length > 0) {
          console.log("Saving non-empty response with no tool calls:", streamedResponse);
          const timestamp = new Date();
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: timestamp,
          });
        } else {
          console.log("Response is empty with no tool calls, not saving to database");
          // Send a message to the client indicating that the model didn't generate a response
          res.write(`data: ${JSON.stringify({ 
            type: "chunk", 
            content: "I'm sorry, I couldn't generate a response to your query." 
          })}\n\n`);
          
          // Update streamedResponse with the fallback message for database save
          streamedResponse = "I'm sorry, I couldn't generate a response to your query.";
          
          // Save the fallback message
          const timestamp = new Date();
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            created_at: timestamp,
          });
        }
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