import express, { Request, Response } from 'express';
import OpenAI from "openai";
import path from "path";
import fs from "fs";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { prepareKnowledgeContentForConversation, addKnowledgeToConversation } from "../../knowledge-service";
import { getToolDefinitions, handleToolCalls } from "../../tools";
import { runAgenticLoop } from "../../agentic-workflow";
import { getOllamaModel } from "../../ai-sdk-providers";
import { prepareContext, isContextLengthError } from "../../context-manager";
import { buildSystemPrompt } from "../../user-preferences-service";

const router = express.Router();
let client: OpenAI | null = null;

// Strip <think>...</think> blocks from model output (common in reasoning models like DeepSeek, QwQ)
function stripThinkingOutput(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trimStart();
}

// Helper to convert messages to simple format for agent
function convertToAgentMessages(messages: any[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter(msg => msg.role === 'user' || msg.role === 'assistant')
    .map(msg => ({
      role: msg.role as 'user' | 'assistant',
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
    }));
}

// Initialize the Ollama client (uses OpenAI client with custom baseURL and CF Access headers)
export function initializeOllama() {
  const baseURL = process.env.OLLAMA_API_URL;
  const cfClientId = process.env.OLLAMA_CF_CLIENT_ID;
  const cfClientSecret = process.env.OLLAMA_CF_CLIENT_SECRET;

  if (!baseURL || !cfClientId || !cfClientSecret) {
    return false;
  }

  client = new OpenAI({
    baseURL,
    apiKey: "ollama", // Placeholder — auth is via CF Access headers
    defaultHeaders: {
      "CF-Access-Client-Id": cfClientId,
      "CF-Access-Client-Secret": cfClientSecret,
    },
  });
  return true;
}

// Get the Ollama client instance
export function getOllamaClient() {
  return client;
}

// Create or continue an Ollama chat conversation
router.post("/", async (req: Request, res: Response) => {
  try {
    const {
      message,
      conversationId,
      context = [],
      model = "gpt-oss:20b",
      modelContextLength = 32000,
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
      return res.status(503).json({ error: "Ollama service not initialized" });
    }

    console.log(`Processing message with ${allAttachments.length} attachments for Ollama`);

    // Set up SSE headers with keep-alive
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

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
          provider: "ollama",
          model,
          user_id: req.user!.id,
          created_at: timestamp,
          last_message_at: timestamp,
        })
        .returning();

      if (!newConversation) {
        throw new Error("Failed to create conversation");
      }

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

    // Ensure context messages are properly ordered and include attachment content
    const apiMessages = context
      .sort(
        (a: any, b: any) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((msg: any) => {
        let content = msg.content;

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

    // Process attachments
    let stream;
    const maxRetries = 3;
    let retryCount = 0;

    const allAttachmentsToProcess = allAttachments.length > 0 ? allAttachments : (attachment ? [attachment] : []);

    console.log(`Processing ${allAttachmentsToProcess.length} attachments for Ollama`);

    let documentTexts: string[] = [];

    for (const att of allAttachmentsToProcess) {
      if (att.type === 'document' && att.text) {
        console.log(`Processing document attachment for Ollama: ${att.name}`);
        documentTexts.push(`--- Document: ${att.name} ---\n${att.text}`);
      }
      else if (att.type === 'image') {
        try {
          console.log("Processing image attachment for Ollama:", att.url);
          documentTexts.push(`[Image: ${att.name || 'Uploaded image'}]`);
        } catch (imageError) {
          console.error("Error processing image for Ollama:", imageError);
        }
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

    if (documentTexts.length > 0 || knowledgeContent) {
      let userContent = message;

      if (documentTexts.length > 0) {
        userContent += "\n\nDocuments Content:\n" + documentTexts.join("\n\n");
      }

      if (knowledgeContent) {
        userContent += "\n\nKnowledge Sources:\n" + knowledgeContent;
      }

      apiMessages.push({ role: "user", content: userContent });
      console.log("Message with document/knowledge content added for Ollama");
    }
    else {
      apiMessages.push({ role: "user", content: message });
      console.log("Plain text message added for Ollama");
    }

    // Build and add system prompt with user custom prompt
    if (!skipSystemPrompt) {
      const systemPrompt = await buildSystemPrompt(req.user!.id);
      if (systemPrompt) {
        apiMessages.unshift({ role: "system", content: systemPrompt });
      }
    }

    // Pre-emptively manage context to avoid exceeding model limits
    const { messages: contextManagedMessages, info: contextInfo } = prepareContext(
      apiMessages,
      model,
      {
        maxTokens: modelContextLength,
        reserveForTools: useTools ? 8000 : 0,
      }
    );

    // Stream the completion with retries
    while (retryCount < maxRetries) {
      try {
        const streamOptions: any = {
          messages: contextManagedMessages,
          model,
          stream: true,
          max_tokens: 4096,
          temperature: 0.7,
        };

        // Add tools if enabled
        if (useTools) {
          try {
            const toolDefinitions = await getToolDefinitions();
            if (toolDefinitions.length > 0) {
              streamOptions.tools = toolDefinitions;
              streamOptions.tool_choice = "auto";
              console.log(`Added ${toolDefinitions.length} tools to Ollama request: ${toolDefinitions.map(t => t.function.name).join(', ')}`);
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
      } catch (error: any) {
        if (isContextLengthError(error)) {
          console.log(`[Ollama] Context length error detected, attempting to truncate further`);

          const { messages: retriedMessages, info: retryInfo } = prepareContext(
            contextManagedMessages,
            model,
            {
              reserveForTools: useTools ? 8000 : 0,
              safetyBuffer: 10000,
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
        );
      }
    }

    if (!stream) {
      throw new Error("Failed to create stream after retries");
    }

    // Send initial conversation data
    res.write(
      `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
    );

    if (contextInfo.removedMessages > 0) {
      console.log(`[Ollama] Context truncated: ${contextInfo.originalTokens} -> ${contextInfo.finalTokens} tokens, removed ${contextInfo.removedMessages} messages`);
      res.write(`data: ${JSON.stringify({
        type: "chunk",
        content: `[Note: Conversation history was trimmed to fit model context. ${contextInfo.removedMessages} older messages removed.]\n\n`
      })}\n\n`);
    }

    // Set up keep-alive interval
    const keepAliveInterval = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    try {
      const requestStart = Date.now();

      // Check if using agentic mode
      if (useAgenticMode && useTools) {
        console.log('[Ollama] Using agentic mode with AI SDK');

        // Get the AI SDK model instance for Ollama
        const aiModel = getOllamaModel(model);

        // Extract system prompt from contextManagedMessages
        const systemMessage = contextManagedMessages.find((msg: any) => msg.role === 'system');
        const agentSystemPrompt = systemMessage?.content || undefined;

        // Convert messages to simple format for agent
        const agentMessages = convertToAgentMessages(contextManagedMessages);

        // Run the agentic loop with AI SDK v6 ToolLoopAgent
        const finalResponse = await runAgenticLoop(
          agentMessages,
          {
            maxIterations: 20,
            conversationId: dbConversation.id,
            model: aiModel,
            systemPrompt: agentSystemPrompt,
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
        // Standard streaming logic (with tool call support)
        let ttftMs: number | null = null;
        let lastChunkTime = Date.now();
        const chunkTimeout = 30000;
        let toolCallsInProgress: any[] = [];
        let thinkBuffer = ''; // Buffer to detect and suppress <think> blocks
        let insideThink = false;

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          const toolCallsDelta = chunk.choices[0]?.delta?.tool_calls;

          // Handle content chunks - filter out <think> blocks
          if (content && !toolCallsDelta) {
            lastChunkTime = Date.now();

            // Track <think> blocks and suppress them
            thinkBuffer += content;

            // Check if we're entering a think block
            if (!insideThink && thinkBuffer.includes('<think>')) {
              // Send anything before the <think> tag
              const beforeThink = thinkBuffer.split('<think>')[0];
              if (beforeThink) {
                streamedResponse += beforeThink;
                if (ttftMs === null) ttftMs = Date.now() - requestStart;
                res.write(`data: ${JSON.stringify({ type: "chunk", content: beforeThink })}\n\n`);
              }
              insideThink = true;
              thinkBuffer = thinkBuffer.substring(thinkBuffer.indexOf('<think>'));
            }

            // Check if think block has ended
            if (insideThink && thinkBuffer.includes('</think>')) {
              const afterThink = thinkBuffer.split('</think>').slice(1).join('</think>');
              thinkBuffer = afterThink;
              insideThink = false;
              // Send any content after the closing tag
              if (afterThink) {
                streamedResponse += afterThink;
                if (ttftMs === null) ttftMs = Date.now() - requestStart;
                res.write(`data: ${JSON.stringify({ type: "chunk", content: afterThink })}\n\n`);
                thinkBuffer = '';
              }
              continue;
            }

            // If inside a think block, keep buffering (don't send)
            if (insideThink) continue;

            // Not in a think block — flush the buffer
            if (thinkBuffer) {
              streamedResponse += thinkBuffer;
              if (ttftMs === null) ttftMs = Date.now() - requestStart;
              res.write(`data: ${JSON.stringify({ type: "chunk", content: thinkBuffer })}\n\n`);
              if (res.flush) res.flush();
              thinkBuffer = '';
            }
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
                console.log(`[Ollama] Initialized tool call ${index}: ${id}, name: ${funcDelta?.name}`);
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
            console.log('[Ollama] Executing tool calls:', JSON.stringify(toolCallsInProgress, null, 2));

            // Validate tool calls before execution
            const validToolCalls = toolCallsInProgress.filter(toolCall => {
              if (!toolCall.id || !toolCall.function?.name) {
                console.error('[Ollama] Invalid tool call structure:', toolCall);
                return false;
              }

              try {
                if (toolCall.function.arguments) {
                  JSON.parse(toolCall.function.arguments);
                }
                return true;
              } catch (parseError) {
                console.error(`[Ollama] Invalid JSON arguments for tool ${toolCall.function.name}:`, toolCall.function.arguments);
                return false;
              }
            });

            if (validToolCalls.length === 0) {
              console.error('[Ollama] No valid tool calls found');
              throw new Error('No valid tool calls found');
            }

            console.log(`[Ollama] Validated ${validToolCalls.length} of ${toolCallsInProgress.length} tool calls`);

            // Store tool calls as internal messages
            const toolTimestamp = new Date();
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "tool",
              content: JSON.stringify(validToolCalls),
              metadata: { type: 'tool_calls' },
              created_at: toolTimestamp,
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
              })),
              { role: 'user', content: 'Using the tool results above, give me a concise answer. Do not output raw JSON or explain your reasoning process. Just answer directly.' }
            ];

            // Get final response with tool results
            const toolCompletionResponse = await client.chat.completions.create({
              model,
              messages: toolResponseMessages,
              temperature: 0.7,
              max_tokens: 4096,
            });

            let rawToolResponse = toolCompletionResponse.choices[0]?.message?.content || '';
            let toolFinalResponse = stripThinkingOutput(rawToolResponse);

            // If the model just dumped JSON instead of a natural answer, retry once
            const trimmed = toolFinalResponse.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
              console.log('[Ollama] Model returned raw JSON in tool follow-up, retrying with stronger prompt');
              const retryMessages = [
                ...toolResponseMessages,
                { role: 'assistant', content: rawToolResponse },
                { role: 'user', content: 'That was raw JSON. Rewrite your answer as a short, natural sentence for the user. No JSON, no code blocks.' }
              ];
              const retryResponse = await client.chat.completions.create({
                model,
                messages: retryMessages,
                temperature: 0.7,
                max_tokens: 1024,
              });
              const retryContent = retryResponse.choices[0]?.message?.content || '';
              const retryClean = stripThinkingOutput(retryContent).trim();
              // Use retry if it's not JSON again, otherwise fall back to original
              if (retryClean && !retryClean.startsWith('{') && !retryClean.startsWith('[')) {
                toolFinalResponse = retryClean;
              }
            }

            if (toolFinalResponse) {
              res.write(`data: ${JSON.stringify({
                type: "chunk",
                content: '\n\n' + toolFinalResponse
              })}\n\n`);

              streamedResponse += '\n\n' + toolFinalResponse;
            }

          } catch (toolError) {
            console.error('[Ollama] Error executing tools:', toolError);
            // Store tool error as internal message
            await db.insert(messages).values({
              conversation_id: dbConversation.id,
              role: "tool",
              content: JSON.stringify({ error: toolError instanceof Error ? toolError.message : 'Unknown tool execution error' }),
              metadata: { type: 'tool_error' },
              created_at: new Date(),
            });

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
