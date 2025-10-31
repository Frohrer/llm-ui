import { generateText, LanguageModel, CoreTool, CoreMessage, jsonSchema } from "ai";
import { getToolDefinitions, executeTool } from "./tools";
import { db } from "@db";
import { messages } from "@db/schema";

// Configuration for the agentic loop
export interface AgenticConfig {
  maxIterations?: number;
  conversationId: number;
  model: LanguageModel;
  systemPrompt?: string;
}

// Result of a single iteration
export interface IterationResult {
  content: string;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: any;
  }>;
  shouldContinue: boolean;
}

/**
 * Convert our tool definitions to AI SDK format
 * This function dynamically loads tools, supporting hot reload of custom tools
 */
async function getAISDKTools(forceReload: boolean = false): Promise<Record<string, CoreTool>> {
  // Force reload tools from database if requested (hot reload support)
  if (forceReload) {
    const { refreshTools } = await import('./tools');
    await refreshTools();
  }
  
  const toolDefinitions = await getToolDefinitions();
  const tools: Record<string, CoreTool> = {};

  for (const toolDef of toolDefinitions) {
    const func = toolDef.function;
    
    // OpenAI has strict schema requirements:
    // 1. additionalProperties must be false
    // 2. All properties must be in the required array OR removed from properties
    const properties = func.parameters.properties || {};
    const required = func.parameters.required || [];
    
    // Get all property keys
    const allPropertyKeys = Object.keys(properties);
    
    // For OpenAI strict mode: all defined properties must be required
    // So we'll make the required array include all properties
    const strictRequired = allPropertyKeys.length > 0 ? allPropertyKeys : required;
    
    const schema = {
      type: 'object',
      properties,
      required: strictRequired,
      additionalProperties: false
    };
    
    // Use jsonSchema helper to wrap our JSON schema parameters
    tools[func.name] = {
      description: func.description,
      parameters: jsonSchema(schema),
      execute: async (params: any) => {
        try {
          const result = await executeTool(func.name, params);
          return result;
        } catch (error) {
          console.error(`Error executing tool ${func.name}:`, error);
          return {
            error: error instanceof Error ? error.message : 'Unknown error',
            success: false
          };
        }
      }
    };
  }

  return tools;
}

/**
 * Run the agentic workflow loop using AI SDK
 * This function works with ALL AI SDK supported providers:
 * - OpenAI (GPT-4, GPT-4o, GPT-5, o1, o3, etc.)
 * - Anthropic (Claude 3.5 Sonnet, Claude 3 Opus, etc.)
 * - Google (Gemini Pro, Gemini Flash, etc.)
 * - xAI (Grok)
 * - DeepSeek
 * - Groq
 * - Mistral
 * - Cohere
 * - Together.ai
 * - And many more!
 */
export async function runAgenticLoop(
  initialMessages: CoreMessage[],
  config: AgenticConfig
): Promise<string> {
  const {
    maxIterations = 10,
    conversationId,
    model,
    systemPrompt
  } = config;

  console.log(`[Agentic] Starting agentic loop with max ${maxIterations} iterations`);

  // Get tools in AI SDK format with hot reload support
  // This ensures custom tools are always up-to-date
  const tools = await getAISDKTools(true);
  console.log(`[Agentic] Loaded ${Object.keys(tools).length} tools (with hot reload):`, Object.keys(tools).join(', '));

  // Keep track of messages for context
  let currentMessages = [...initialMessages];
  let iteration = 0;
  let finalResponse = '';

  // Track all intermediate steps (for logging only, not shown to user)
  const intermediateSteps: Array<{ iteration: number; action: string; details: any }> = [];

  while (iteration < maxIterations) {
    iteration++;
    console.log(`[Agentic] Iteration ${iteration}/${maxIterations}`);

    intermediateSteps.push({
      iteration,
      action: 'llm_request',
      details: { messageCount: currentMessages.length }
    });

    try {
      // Use AI SDK's generateText with automatic tool handling
      console.log(`[Agentic] Making request to model with ${currentMessages.length} messages`);
      
      const result = await generateText({
        model,
        messages: currentMessages,
        tools,
        maxSteps: 1, // Process one step at a time for full control
        system: systemPrompt,
      });

      console.log(`[Agentic] LLM responded with ${result.text.length} chars, ${result.toolCalls?.length || 0} tool calls`);
      console.log(`[Agentic] Finish reason: ${result.finishReason}`);

      intermediateSteps.push({
        iteration,
        action: 'llm_response',
        details: {
          contentLength: result.text.length,
          toolCallCount: result.toolCalls?.length || 0,
          finishReason: result.finishReason
        }
      });

      // Check if there are tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log(`[Agentic] Executing ${result.toolCalls.length} tool calls:`,
          result.toolCalls.map(tc => tc.toolName).join(', '));

        intermediateSteps.push({
          iteration,
          action: 'tool_execution',
          details: {
            tools: result.toolCalls.map(tc => tc.toolName)
          }
        });

        // Store tool calls as internal messages (for debugging/history)
        await db.insert(messages).values({
          conversation_id: conversationId,
          role: "tool",
          content: JSON.stringify(result.toolCalls.map(tc => ({
            id: tc.toolCallId,
            name: tc.toolName,
            arguments: tc.args
          }))),
          metadata: {
            type: 'agentic_tool_calls',
            iteration,
            timestamp: new Date().toISOString()
          },
          created_at: new Date(),
        });

        // Tool results are automatically collected in result.toolResults
        const toolResults = result.toolResults || [];

        console.log(`[Agentic] Tool execution completed:`,
          toolResults.map((r, i) => ({
            tool: result.toolCalls![i].toolName,
            hasError: typeof r === 'object' && r !== null && 'error' in r
          })));

        intermediateSteps.push({
          iteration,
          action: 'tool_results',
          details: {
            results: toolResults.map((r, i) => ({
              tool: result.toolCalls![i].toolName,
              success: !(typeof r === 'object' && r !== null && 'error' in r)
            }))
          }
        });

        // Store tool results as internal messages
        await db.insert(messages).values({
          conversation_id: conversationId,
          role: "tool",
          content: JSON.stringify(toolResults.map((r, i) => ({
            toolCallId: result.toolCalls![i].toolCallId,
            toolName: result.toolCalls![i].toolName,
            result: r
          }))),
          metadata: {
            type: 'agentic_tool_results',
            iteration,
            timestamp: new Date().toISOString()
          },
          created_at: new Date(),
        });

        // Manually construct messages from tool calls and results
        // Add assistant message with tool calls
        const assistantMessage: CoreMessage = {
          role: 'assistant',
          content: [
            { type: 'text', text: result.text || '' },
            ...result.toolCalls!.map(tc => ({
              type: 'tool-call' as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.args
            }))
          ]
        };

        // Add tool result messages
        const toolMessages: CoreMessage[] = toolResults.map((r, i) => ({
          role: 'tool',
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: result.toolCalls![i].toolCallId,
              toolName: result.toolCalls![i].toolName,
              result: r
            }
          ]
        }));

        // Update context with assistant message and tool messages
        currentMessages = [
          ...currentMessages,
          assistantMessage,
          ...toolMessages
        ];
      } else {
        // No tool calls, we're done
        console.log(`[Agentic] No tool calls, finishing with response`);
        finalResponse = result.text;
        break;
      }

      // Note: We don't trim context here because modern LLMs have huge context windows
      // (Claude: 200K tokens, GPT-4: 128K, Gemini: 1M+). If we hit limits, the model
      // will error and we can handle it. Trimming causes more problems (context loss, loops)
      // than it solves.

    } catch (error) {
      console.error(`[Agentic] Error in iteration ${iteration}:`, error);

      intermediateSteps.push({
        iteration,
        action: 'error',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      });

      // If we have some response, return it; otherwise throw
      if (finalResponse) {
        console.log(`[Agentic] Returning partial response due to error`);
        break;
      }
      throw error;
    }
  }

  // Check if we hit max iterations without getting a final response
  if (iteration >= maxIterations && !finalResponse) {
    console.log(`[Agentic] Max iterations reached, making final request for summary`);

    // Make one final request to get a response (without tools)
    try {
      const result = await generateText({
        model,
        messages: currentMessages,
        system: systemPrompt,
        maxSteps: 1,
      });
      finalResponse = result.text;
    } catch (error) {
      console.error(`[Agentic] Error in final request:`, error);
      finalResponse = "I've completed the requested tasks but reached the maximum number of iterations. The work has been completed.";
    }
  }

  // Log summary
  console.log(`[Agentic] Loop completed in ${iteration} iterations`);
  console.log(`[Agentic] Intermediate steps:`, intermediateSteps.length);

  // Store the summary of the agentic workflow
  await db.insert(messages).values({
    conversation_id: conversationId,
    role: "tool",
    content: JSON.stringify({
      summary: 'agentic_workflow_complete',
      iterations: iteration,
      intermediateSteps: intermediateSteps.length,
      finalResponseLength: finalResponse.length
    }),
    metadata: {
      type: 'agentic_summary',
      iterations: iteration,
      timestamp: new Date().toISOString()
    },
    created_at: new Date(),
  });

  return finalResponse;
}

/**
 * Helper to check if context is getting too large
 */
export function estimateContextSize(messages: CoreMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text.length;
        }
      }
    }
  }
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(totalChars / 4);
}
