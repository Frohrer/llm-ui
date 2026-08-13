import { ToolLoopAgent, isStepCount, tool, LanguageModel } from "ai";
import { z, ZodTypeAny, ZodObject, ZodRawShape } from "zod";
import { getToolDefinitions, executeTool, refreshTools } from "./tools";
import { db } from "@db";
import { messages } from "@db/schema";
import { truncateToolResult } from "./context-manager";
import { redactDeep, redactText, restoreDeep, restoreText } from "./pii-service";

// Maximum tokens per tool result to prevent context overflow during agentic loops
// With 20 iterations max and ~2000 tokens each, worst case is ~40K tokens for tool results
// Plus initial context and system prompts, this keeps us well under most model limits
const MAX_TOOL_RESULT_TOKENS = 2000;

// Configuration for the agentic loop
export interface AgenticConfig {
  maxIterations?: number;
  maxContextTokens?: number; // Max tokens before trimming (default: 120K)
  conversationId: number;
  model: LanguageModel;
  systemPrompt?: string;
  userId?: number; // User ID for tools that need authentication/authorization
}

/**
 * Convert a JSON Schema property to a Zod type
 * This handles the basic types used in our tool definitions
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

  // Add description if present
  if (prop.description) {
    zodType = zodType.describe(prop.description);
  }

  return zodType;
}

/**
 * Convert a JSON Schema object to a Zod schema
 * This converts our tool parameter definitions to Zod schemas for AI SDK v7
 */
function jsonSchemaToZod(schema: any): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  const properties = schema.properties || {};
  const required = schema.required || [];

  for (const [key, prop] of Object.entries(properties)) {
    let zodProp = jsonSchemaPropertyToZod(prop);
    
    // Make optional if not in required array
    if (!required.includes(key)) {
      zodProp = zodProp.optional();
    }
    
    shape[key] = zodProp;
  }

  return z.object(shape);
}

/**
 * Convert our tool definitions to AI SDK v7 tool format
 * This function dynamically loads tools, supporting hot reload of custom tools
 */
async function buildAgentTools(forceReload: boolean = false, userId?: number): Promise<Record<string, any>> {
  // Force reload tools from database if requested (hot reload support)
  if (forceReload) {
    await refreshTools();
  }
  
  const toolDefinitions = await getToolDefinitions();
  const tools: Record<string, any> = {};

  for (const toolDef of toolDefinitions) {
    const func = toolDef.function;
    
    // Convert JSON Schema parameters to Zod schema
    // AI SDK v7 works best with Zod schemas
    const zodSchema = jsonSchemaToZod(func.parameters);
    
    // Use AI SDK v7 tool() helper with Zod schema
    // Note: AI SDK v7 uses 'inputSchema' instead of 'parameters'
    tools[func.name] = tool({
      description: func.description,
      inputSchema: zodSchema,
      execute: async (params: any) => {
        try {
          // The model only ever saw PII tags in its context; tools must run
          // on real values (send-email to the real address, etc.).
          const result = await executeTool(func.name, await restoreDeep(params), userId);

          // CRITICAL: Truncate tool results to prevent context overflow
          // The AI SDK ToolLoopAgent accumulates all tool results in context
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          const estimatedTokens = Math.ceil(resultStr.length / 3.2);

          if (estimatedTokens > MAX_TOOL_RESULT_TOKENS) {
            console.log(`[Agent] Truncating tool result from ${func.name}: ~${estimatedTokens} -> ~${MAX_TOOL_RESULT_TOKENS} tokens`);
            const truncated = truncateToolResult(result, MAX_TOOL_RESULT_TOKENS);
            try {
              return await redactDeep(JSON.parse(truncated));
            } catch {
              return redactText(truncated);
            }
          }

          // Redacted: the AI SDK feeds this result straight back to the
          // upstream model on the next loop iteration, so real values from
          // tool output must not leave the machine.
          return redactDeep(result);
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

/**
 * Create a ToolLoopAgent instance for agentic workflows
 * This leverages the new AI SDK v7 Agent class for cleaner, more maintainable code
 */
export async function createAgenticAgent(config: {
  model: LanguageModel;
  systemPrompt?: string;
  maxIterations?: number;
  userId?: number;
}): Promise<ToolLoopAgent<any, any>> {
  const { model, systemPrompt, maxIterations = 20, userId } = config;
  
  // Load tools with hot reload support
  const tools = await buildAgentTools(true, userId);
  console.log(`[Agent] Loaded ${Object.keys(tools).length} tools:`, Object.keys(tools).join(', '));

  // Create the agent using ToolLoopAgent class
  const agent = new ToolLoopAgent({
    model,
    instructions: systemPrompt,
    tools,
    stopWhen: isStepCount(maxIterations),
  });

  return agent;
}

/**
 * Run the agentic workflow using AI SDK v7 ToolLoopAgent
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
  initialMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  config: AgenticConfig
): Promise<string> {
  const {
    maxIterations = 20,
    conversationId,
    model,
    systemPrompt,
    userId
  } = config;

  console.log(`[Agent] Starting agentic workflow with max ${maxIterations} iterations`);

  // Load tools with hot reload support
  const tools = await buildAgentTools(true, userId);
  console.log(`[Agent] Loaded ${Object.keys(tools).length} tools:`, Object.keys(tools).join(', '));

  // Track steps for logging
  let stepCount = 0;
  const startTime = Date.now();

  // Redact everything that will be sent to the upstream model: the system
  // prompt and the conversation history. Only PII tags may leave the machine.
  const redactedSystemPrompt = systemPrompt ? await redactText(systemPrompt) : systemPrompt;
  const redactedMessages = await redactDeep(initialMessages);

  // Create the agent using ToolLoopAgent class
  const agent = new ToolLoopAgent({
    model,
    instructions: redactedSystemPrompt,
    tools,
    stopWhen: isStepCount(maxIterations),
  });

  try {
    // Build the prompt from initial messages
    // AI SDK v7 ToolLoopAgent doesn't allow both prompt and messages at the same time
    // So we use prompt for new conversations, and messages for conversations with history
    const lastUserMessage = redactedMessages.filter(m => m.role === 'user').pop();
    const prompt = lastUserMessage?.content || '';

    // Check if we have previous messages (conversation history)
    const hasPreviousMessages = redactedMessages.length > 1;
    
    console.log(`[Agent] Running with prompt: "${prompt.substring(0, 100)}..."`);

    // Run the agent - use messages format if we have history, otherwise use prompt
    let result;
    if (hasPreviousMessages) {
      // For existing conversations with history, use messages array
      // Include all messages (both previous and current)
      result = await agent.generate({
        messages: redactedMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content
        })),
      });
    } else {
      // For new conversations with just one message, use prompt
      result = await agent.generate({
        prompt,
      });
    }

    // Log tool usage from steps
    if (result.steps && result.steps.length > 0) {
      stepCount = result.steps.length;
      
      for (let i = 0; i < result.steps.length; i++) {
        const step = result.steps[i];
        
        // Log tool calls if any
        if (step.toolCalls && step.toolCalls.length > 0) {
          console.log(`[Agent] Step ${i + 1}: ${step.toolCalls.length} tool calls:`, 
            step.toolCalls.map(tc => tc.toolName).join(', '));
          
          // Store tool calls in database (restored: the model emitted PII
          // tags in its arguments; the DB keeps real values)
          await db.insert(messages).values({
            conversation_id: conversationId,
            role: "tool",
            content: JSON.stringify(await restoreDeep(step.toolCalls.map(tc => ({
              id: tc.toolCallId,
              name: tc.toolName,
              arguments: tc.input
            })))),
            metadata: {
              type: 'agentic_tool_calls',
              step: i + 1,
              timestamp: new Date().toISOString()
            },
            created_at: new Date(),
          });

          // Store tool results if available
          if (step.toolResults && step.toolResults.length > 0) {
            // Restored: tool results were re-redacted before being handed
            // back to the model loop; the DB keeps real values.
            await db.insert(messages).values({
              conversation_id: conversationId,
              role: "tool",
              content: JSON.stringify(await restoreDeep(step.toolResults.map((r, idx) => ({
                toolCallId: step.toolCalls![idx]?.toolCallId,
                toolName: step.toolCalls![idx]?.toolName,
                result: r
              })))),
              metadata: {
                type: 'agentic_tool_results',
                step: i + 1,
                timestamp: new Date().toISOString()
              },
              created_at: new Date(),
            });
          }
        }
      }
    }

    // The model only ever saw PII tags; callers stream/persist this text, so
    // convert tags back to real values before returning.
    const finalResponse = await restoreText(result.text || '');
    const duration = Date.now() - startTime;

    console.log(`[Agent] Completed in ${stepCount} steps, ${duration}ms`);

    // Store the summary of the agentic workflow
    await db.insert(messages).values({
      conversation_id: conversationId,
      role: "tool",
      content: JSON.stringify({
        summary: 'agentic_workflow_complete',
        steps: stepCount,
        duration_ms: duration,
        finalResponseLength: finalResponse.length,
        finishReason: result.finishReason
      }),
      metadata: {
        type: 'agentic_summary',
        steps: stepCount,
        timestamp: new Date().toISOString()
      },
      created_at: new Date(),
    });

    return finalResponse;

  } catch (error) {
    console.error(`[Agent] Error in agentic workflow:`, error);
    
    // Log the error
    await db.insert(messages).values({
      conversation_id: conversationId,
      role: "tool",
      content: JSON.stringify({
        summary: 'agentic_workflow_error',
        // Provider errors can echo tagged content; keep the DB row real.
        error: error instanceof Error ? await restoreText(error.message) : 'Unknown error',
        steps: stepCount
      }),
      metadata: {
        type: 'agentic_error',
        timestamp: new Date().toISOString()
      },
      created_at: new Date(),
    });

    throw error;
  }
}

/**
 * Helper to estimate token count from messages (kept for compatibility)
 */
export function estimateTokenCount(messages: Array<{ role: string; content: string | any[] }>): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text?.length || 0;
        } else if (part.type === 'tool-result') {
          const resultStr = typeof part.result === 'string' 
            ? part.result 
            : JSON.stringify(part.result);
          totalChars += resultStr.length;
        }
      }
    }
  }
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(totalChars / 4);
}
