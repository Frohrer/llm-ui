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
import { runAgenticLoop } from "../../agentic-workflow";
import { getAnthropicModel } from "../../ai-sdk-providers";
import { prepareContext, isContextLengthError, truncateToolResult } from "../../context-manager";
import { buildSystemPrompt } from "../../user-preferences-service";

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

// Helper to convert Anthropic messages to simple format for agent
function convertToAgentMessages(messages: any[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => {
      let content = '';
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Extract text from content blocks
        content = msg.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('\n');
      }
      return {
        role: msg.role as 'user' | 'assistant',
        content
      };
    });
}

// Helper function to execute tools and get response
async function executeToolsAndGetResponse(
  client: Anthropic,
  toolCalls: any[],
  conversationMessages: any[],
  model: string,
  conversationId: number
): Promise<string> {
  console.log(`Executing ${toolCalls.length} tool calls:`, toolCalls.map(t => t.name));
  
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
  console.log(`Tool execution completed. Results:`, toolResults.map(r => ({
    toolCallId: r.toolCallId,
    hasError: !!r.error,
    resultType: typeof r.result,
    resultLength: r.result ? JSON.stringify(r.result).length : 0
  })));
  
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
          (typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2))
      }))
    }
  ];
  
  console.log(`Making follow-up API call to Anthropic with ${toolResults.length} tool results`);
  
  try {
    // Get final response with tool results
    const toolCompletionResponse = await client.messages.create({
      model: model,
      messages: toolResponseMessages,
      temperature: 0.7,
      max_tokens: 4096,
    });
    
    console.log(`Anthropic API response received. Content blocks:`, toolCompletionResponse.content?.length);
    
    // Extract text content from response
    let finalResponse = '';
    if (toolCompletionResponse.content && toolCompletionResponse.content.length > 0) {
      const textBlocks = toolCompletionResponse.content.filter(block => block.type === 'text');
      if (textBlocks.length > 0) {
        finalResponse = textBlocks.map(block => block.text).join('\n\n');
      }
    }
    
    // If no response, create a summary of tool results
    if (!finalResponse || finalResponse.trim() === '') {
      console.log('No response from Anthropic API, creating summary of tool results');
      
      const successfulResults = toolResults.filter(r => !r.error);
      const failedResults = toolResults.filter(r => r.error);
      
      let summaryParts = [];
      
      if (successfulResults.length > 0) {
        summaryParts.push(`I executed ${successfulResults.length} tool(s) successfully:`);
        successfulResults.forEach((result, index) => {
          const toolCall = toolCalls.find(tc => tc.id === result.toolCallId);
          const toolName = toolCall ? toolCall.name : 'Unknown tool';
          summaryParts.push(`\n${index + 1}. ${toolName}: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}`);
        });
      }
      
      if (failedResults.length > 0) {
        summaryParts.push(`\n\n${failedResults.length} tool(s) failed:`);
        failedResults.forEach((result, index) => {
          const toolCall = toolCalls.find(tc => tc.id === result.toolCallId);
          const toolName = toolCall ? toolCall.name : 'Unknown tool';
          summaryParts.push(`\n${index + 1}. ${toolName}: Error - ${result.error}`);
        });
      }
      
      finalResponse = summaryParts.join('');
    }
    
    console.log(`Final response length: ${finalResponse.length}`);
    return finalResponse;
    
  } catch (apiError) {
    console.error('Error in follow-up API call:', apiError);
    
    // If API call fails, still show the tool results
    const successfulResults = toolResults.filter(r => !r.error);
    const failedResults = toolResults.filter(r => r.error);
    
    let errorSummary = `I encountered an error while processing the tool results, but here's what I found:\n\n`;
    
    if (successfulResults.length > 0) {
      errorSummary += `Tool results:\n`;
      successfulResults.forEach((result, index) => {
        const toolCall = toolCalls.find(tc => tc.id === result.toolCallId);
        const toolName = toolCall ? toolCall.name : 'Unknown tool';
        errorSummary += `${index + 1}. ${toolName}: ${typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2)}\n\n`;
      });
    }
    
    if (failedResults.length > 0) {
      errorSummary += `Failed tools:\n`;
      failedResults.forEach((result, index) => {
        const toolCall = toolCalls.find(tc => tc.id === result.toolCallId);
        const toolName = toolCall ? toolCall.name : 'Unknown tool';
        errorSummary += `${index + 1}. ${toolName}: ${result.error}\n`;
      });
    }
    
    return errorSummary;
  }
}

// Create or continue an Anthropic chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "claude-3-5-sonnet-latest",
      modelContextLength = 200000, // Default for Claude models
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

    // Process context messages and include attachment content from metadata
    const apiMessages = context
      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
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
          role: msg.role === "user" ? "user" : "assistant",
          content: content,
        };
      });

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
        console.log(`Loaded ${toolDefinitions.length} tool definitions:`, toolDefinitions.map(t => t.function.name));
        
        if (toolDefinitions.length > 0) {
          const anthropicTools = toolDefinitions.map(tool => ({
            name: tool.function.name,
            description: tool.function.description,
            input_schema: tool.function.parameters
          }));
          
          requestOptions.tools = anthropicTools;
          console.log('Tools added to Anthropic request options');
        } else {
          console.log('No tools available to add to request');
        }
      } catch (toolError) {
        console.error("Error loading tools:", toolError);
      }
    } else {
      console.log('Tools disabled for this request');
    }

    // Create user message content
    const userMessageContent = createUserMessageContent(message, imageAttachments, documentTexts, knowledgeContent);
    apiMessages.push({ role: "user", content: userMessageContent });

    // Pre-emptively manage context to avoid exceeding model limits
    const { messages: contextManagedMessages, info: contextInfo } = prepareContext(
      apiMessages,
      model,
      {
        maxTokens: modelContextLength, // Use context length from model config
        reserveForTools: useTools ? 8000 : 0,  // Only reserve for tools if enabled
      }
    );

    requestOptions.messages = contextManagedMessages;

    // Build system prompt with user custom prompt
    const baseSystemPrompt = "You are a helpful AI assistant.";
    const systemPrompt = await buildSystemPrompt(baseSystemPrompt, req.user!.id);
    if (systemPrompt) {
      requestOptions.system = systemPrompt;
    }

    // Send initial conversation data
    res.write(`data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`);
    
    // Only notify user if messages were actually removed (not just tool results truncated)
    if (contextInfo.removedMessages > 0) {
      console.log(`[Anthropic] Context truncated: ${contextInfo.originalTokens} -> ${contextInfo.finalTokens} tokens, removed ${contextInfo.removedMessages} messages`);
      res.write(`data: ${JSON.stringify({
        type: "chunk",
        content: `[Note: Conversation history was trimmed to fit model context. ${contextInfo.removedMessages} older messages removed.]\n\n`
      })}\n\n`);
    }

    // Set up keep-alive
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    let streamedResponse = "";
    const requestStart = Date.now();
    let ttftMs: number | null = null;

    try {
      // Check if using agentic mode
      if (useAgenticMode && useTools) {
        console.log('[Anthropic] Using agentic mode with AI SDK');
        
        // Get the AI SDK model instance
        const aiModel = getAnthropicModel(model);
        
        // Extract system prompt from contextManagedMessages (which has been truncated if needed)
        const systemMessage = contextManagedMessages.find((msg: any) => msg.role === 'system');
        const systemPrompt = systemMessage?.content || undefined;
        
        // Convert messages to simple format for agent - use contextManagedMessages which has been truncated
        const agentMessages = convertToAgentMessages(contextManagedMessages);
        
        // Run the agentic loop with AI SDK v6 ToolLoopAgent
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
        // Original streaming logic
        let toolCallsInProgress: { [index: number]: any } = {};
        
        // Create stream
        const stream = await client.messages.create(requestOptions);

      // Process stream
      for await (const chunk of stream as any) {
        if (chunk.type === 'content_block_start') {
          const contentBlock = chunk.content_block;
          
          if (contentBlock?.type === 'text' && contentBlock.text) {
            const content = contentBlock.text;
            streamedResponse += content;
            if (ttftMs === null) {
              ttftMs = Date.now() - requestStart;
            }
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
            if (ttftMs === null) {
              ttftMs = Date.now() - requestStart;
            }
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
      
      console.log(`Stream completed. useTools: ${useTools}, toolCallsArray.length: ${toolCallsArray.length}`);
      if (useTools && toolCallsArray.length === 0) {
        console.log('Tools enabled but no tool calls received in stream');
      }

      // Handle tool calls if present
      if (useTools && toolCallsArray.length > 0) {
        console.log(`Processing ${toolCallsArray.length} tool calls from stream`);
        
        // Clean up tool calls (remove temporary fields) and validate
        const cleanedToolCalls = toolCallsArray.map((toolCall: any) => ({
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments
        }));
        
        console.log('Cleaned tool calls:', cleanedToolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          hasArguments: !!tc.arguments,
          argumentsType: typeof tc.arguments
        })));
        
        // Validate tool calls
        const validationResults = cleanedToolCalls.map((toolCall: any) => {
          const issues = [];
          
          if (!toolCall.id) issues.push('missing id');
          if (!toolCall.name) issues.push('missing name');
          if (toolCall.arguments === null || toolCall.arguments === undefined) issues.push('missing arguments');
          if (typeof toolCall.arguments !== 'object') issues.push('invalid arguments type');
          
          return {
            toolCall,
            isValid: issues.length === 0,
            issues
          };
        });
        
        const validToolCalls = validationResults
          .filter(result => result.isValid)
          .map(result => result.toolCall);
        
        const invalidToolCalls = validationResults.filter(result => !result.isValid);
        
        console.log(`Validation results: ${validToolCalls.length} valid, ${invalidToolCalls.length} invalid`);
        
        if (invalidToolCalls.length > 0) {
          console.log('Invalid tool calls:', invalidToolCalls.map(result => ({
            name: result.toolCall.name,
            issues: result.issues
          })));
        }
        
        if (validToolCalls.length === 0) {
          let errorMessage = "\n\nI attempted to use tools but encountered issues:";
          
          if (invalidToolCalls.length > 0) {
            errorMessage += "\n";
            invalidToolCalls.forEach((result, index) => {
              errorMessage += `\n${index + 1}. Tool "${result.toolCall.name || 'Unknown'}": ${result.issues.join(', ')}`;
            });
            errorMessage += "\n\nPlease try rephrasing your request or providing more specific details.";
          } else {
            errorMessage += " No valid tool calls were found. Please try rephrasing your request.";
          }
          
          res.write(`data: ${JSON.stringify({ type: "chunk", content: errorMessage })}\n\n`);
          
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse + errorMessage,
            metadata: {
              ttft_ms: ttftMs ?? undefined,
              total_tokens: (stream as any)?.usage?.output_tokens != null && (stream as any)?.usage?.input_tokens != null
                ? (stream as any)?.usage?.output_tokens + (stream as any)?.usage?.input_tokens
                : undefined,
              input_tokens: (stream as any)?.usage?.input_tokens,
              output_tokens: (stream as any)?.usage?.output_tokens,
            },
            created_at: new Date(),
          });
          
          streamedResponse += errorMessage;
        } else {
          console.log(`Executing ${validToolCalls.length} valid tool calls`);
          
          // Save initial response if it exists
          if (streamedResponse.trim()) {
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "assistant",
              content: streamedResponse,
              metadata: {
                ttft_ms: ttftMs ?? undefined,
                total_tokens: (stream as any)?.usage?.output_tokens != null && (stream as any)?.usage?.input_tokens != null
                  ? (stream as any)?.usage?.output_tokens + (stream as any)?.usage?.input_tokens
                  : undefined,
                input_tokens: (stream as any)?.usage?.input_tokens,
                output_tokens: (stream as any)?.usage?.output_tokens,
              },
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
          res.write(`data: ${JSON.stringify({ type: "chunk", content: "\n\n" + toolResponse })}\n\n`);
          
          // Save the tool response
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: toolResponse,
            metadata: { type: 'tool_result_response', ttft_ms: ttftMs ?? undefined },
            created_at: new Date(),
          });
          
          streamedResponse += "\n\n" + toolResponse;
        }
      } else {
        // No tool calls - save the response normally
        if (streamedResponse.trim()) {
          await db.insert(messages).values({
            conversation_id: dbConversation.id,
            role: "assistant",
            content: streamedResponse,
            metadata: {
              ttft_ms: ttftMs ?? undefined,
              total_tokens: (stream as any)?.usage?.output_tokens != null && (stream as any)?.usage?.input_tokens != null
                ? (stream as any)?.usage?.output_tokens + (stream as any)?.usage?.input_tokens
                : undefined,
              input_tokens: (stream as any)?.usage?.input_tokens,
              output_tokens: (stream as any)?.usage?.output_tokens,
            },
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
            metadata: {
              ttft_ms: ttftMs ?? undefined,
              total_tokens: (stream as any)?.usage?.output_tokens != null && (stream as any)?.usage?.input_tokens != null
                ? (stream as any)?.usage?.output_tokens + (stream as any)?.usage?.input_tokens
                : undefined,
              input_tokens: (stream as any)?.usage?.input_tokens,
              output_tokens: (stream as any)?.usage?.output_tokens,
            },
            created_at: new Date(),
          });
        }
      }
      }
      
      // Send completion event (common for both modes)
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