import { getToolDefinitions, handleToolCalls } from "./tools";
import { db } from "@db";
import { messages } from "@db/schema";

// Configuration for the agentic loop
export interface AgenticConfig {
  maxIterations?: number;
  maxContextMessages?: number;
  conversationId: number;
  provider: 'anthropic' | 'openai';
}

// Tool call format (provider-agnostic)
export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

// Result of a single iteration
export interface IterationResult {
  content: string;
  toolCalls: ToolCall[];
  shouldContinue: boolean;
}

// Provider interface that must be implemented
export interface AgenticProvider {
  // Make a single LLM request and return the response
  makeRequest(messages: any[], tools: any[]): Promise<{
    content: string;
    toolCalls: ToolCall[];
  }>;
  
  // Convert tool results into the provider's message format
  formatToolMessages(toolCalls: ToolCall[], toolResults: any[]): any[];
}

/**
 * Run the agentic workflow loop
 * This function is provider-agnostic and handles the core loop logic
 */
export async function runAgenticLoop(
  provider: AgenticProvider,
  initialMessages: any[],
  config: AgenticConfig
): Promise<string> {
  const {
    maxIterations = 10,
    maxContextMessages = 20,
    conversationId,
  } = config;
  
  console.log(`[Agentic] Starting agentic loop with max ${maxIterations} iterations`);
  
  // Get tool definitions once
  const toolDefinitions = await getToolDefinitions();
  console.log(`[Agentic] Loaded ${toolDefinitions.length} tool definitions`);
  
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
      // Make LLM request
      const response = await provider.makeRequest(currentMessages, toolDefinitions);
      
      console.log(`[Agentic] LLM responded with ${response.content.length} chars, ${response.toolCalls.length} tool calls`);
      
      intermediateSteps.push({
        iteration,
        action: 'llm_response',
        details: {
          contentLength: response.content.length,
          toolCallCount: response.toolCalls.length
        }
      });
      
      // If there are no tool calls, we're done
      if (response.toolCalls.length === 0) {
        console.log(`[Agentic] No tool calls, finishing with response`);
        finalResponse = response.content;
        break;
      }
      
      // Execute tool calls
      console.log(`[Agentic] Executing ${response.toolCalls.length} tool calls:`, 
        response.toolCalls.map(tc => tc.name).join(', '));
      
      intermediateSteps.push({
        iteration,
        action: 'tool_execution',
        details: {
          tools: response.toolCalls.map(tc => tc.name)
        }
      });
      
      // Store tool calls as internal messages (for debugging/history)
      await db.insert(messages).values({
        conversation_id: conversationId,
        role: "tool",
        content: JSON.stringify(response.toolCalls),
        metadata: { 
          type: 'agentic_tool_calls',
          iteration,
          timestamp: new Date().toISOString()
        },
        created_at: new Date(),
      });
      
      // Execute all tool calls
      const toolResults = await handleToolCalls(response.toolCalls);
      
      console.log(`[Agentic] Tool execution completed:`,
        toolResults.map(r => ({ tool: r.toolName, hasError: !!r.error })));
      
      intermediateSteps.push({
        iteration,
        action: 'tool_results',
        details: {
          results: toolResults.map(r => ({
            tool: r.toolName,
            success: !r.error
          }))
        }
      });
      
      // Store tool results as internal messages
      await db.insert(messages).values({
        conversation_id: conversationId,
        role: "tool",
        content: JSON.stringify(toolResults),
        metadata: { 
          type: 'agentic_tool_results',
          iteration,
          timestamp: new Date().toISOString()
        },
        created_at: new Date(),
      });
      
      // Add assistant message with tool calls to context
      const assistantMessage = {
        role: 'assistant',
        content: response.content || '' // OpenAI requires string, not null
      };
      
      // Format tool messages for the provider
      const toolMessages = provider.formatToolMessages(response.toolCalls, toolResults);
      
      // Update context with assistant message and tool results
      currentMessages = [
        ...currentMessages,
        assistantMessage,
        ...toolMessages
      ];
      
      // Manage context length - keep only recent messages if too many
      if (currentMessages.length > maxContextMessages) {
        console.log(`[Agentic] Trimming context from ${currentMessages.length} to ${maxContextMessages} messages`);
        // Keep the first message (usually system or initial user message) and the most recent messages
        const firstMessage = currentMessages[0];
        const recentMessages = currentMessages.slice(-maxContextMessages + 1);
        currentMessages = [firstMessage, ...recentMessages];
      }
      
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
    
    // Make one final request to get a response
    try {
      const response = await provider.makeRequest(currentMessages, []);
      finalResponse = response.content;
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
export function estimateContextSize(messages: any[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (typeof part === 'string') {
          totalChars += part.length;
        } else if (part.text) {
          totalChars += part.text.length;
        }
      }
    }
  }
  // Rough estimate: 1 token ≈ 4 characters
  return Math.ceil(totalChars / 4);
}

