# AI SDK Agentic Mode

This document describes the new agentic mode implementation using the [Vercel AI SDK](https://ai-sdk.dev/docs/introduction).

## Overview

The agentic workflow has been completely rewritten to use the Vercel AI SDK, which provides a unified interface for working with multiple AI providers. This eliminates the need for provider-specific implementations and makes it easy to add support for new providers.

## Supported Providers

The AI SDK agentic mode now works with **ALL** providers supported by the Vercel AI SDK, including:

### Fully Supported Providers

- **OpenAI** - GPT-4, GPT-4 Turbo, GPT-4o, GPT-5, o1, o3, etc.
- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- **Google** - Gemini Pro, Gemini Flash, Gemini Ultra
- **xAI** - Grok, Grok-2
- **DeepSeek** - DeepSeek models
- **Groq** - Fast inference with various models
- **Mistral** - Mistral Large, Medium, Small
- **Cohere** - Command models
- **Together.ai** - Various open-source models
- **Fireworks** - Fast inference platform

### OpenAI-Compatible Providers

Any provider that is OpenAI-compatible can be used by configuring a custom base URL.

## How It Works

### 1. Unified Tool Calling

The AI SDK handles all tool calling logic automatically:

```typescript
import { generateText } from "ai";
import { getOpenAIModel } from "./ai-sdk-providers";

const model = getOpenAIModel("gpt-4");
const result = await generateText({
  model,
  messages: [{ role: 'user', content: 'What is the weather?' }],
  tools: {
    getWeather: {
      description: 'Get the current weather',
      parameters: z.object({
        location: z.string()
      }),
      execute: async ({ location }) => {
        return await fetchWeather(location);
      }
    }
  },
  maxSteps: 5
});
```

### 2. Automatic Message Formatting

The AI SDK automatically formats messages for each provider:

- **OpenAI**: Uses Chat Completions API format
- **Anthropic**: Uses Messages API with content blocks
- **Google**: Uses Gemini API format
- **Others**: Automatically adapts to the provider's format

### 3. Agentic Loop

The agentic workflow runs in a loop:

1. Send messages + available tools to the LLM
2. LLM responds with either:
   - Final answer (loop ends)
   - Tool calls to execute
3. If tool calls:
   - Execute all tools in parallel
   - Add results to conversation
   - Continue to next iteration
4. Repeat until final answer or max iterations reached

## Usage

### From Provider Routes

The provider routes automatically use the AI SDK when agentic mode is enabled:

```typescript
// OpenAI example
if (useAgenticMode && useTools) {
  const aiModel = getOpenAIModel(effectiveModel);
  const coreMessages = convertToCoreMessages(apiMessages);
  
  const finalResponse = await runAgenticLoop(
    coreMessages,
    {
      maxIterations: 10,
      maxContextMessages: 15,
      conversationId: dbConversation.id,
      model: aiModel,
      systemPrompt
    }
  );
}
```

### Configuration Options

```typescript
interface AgenticConfig {
  maxIterations?: number;        // Max iterations (default: 10)
  maxContextMessages?: number;   // Max messages to keep in context (default: 20)
  conversationId: number;        // Database conversation ID
  model: LanguageModel;          // AI SDK model instance
  systemPrompt?: string;         // System prompt for the model
}
```

## Adding a New Provider

To add a new provider to agentic mode:

### 1. Install the AI SDK provider package

```bash
npm install @ai-sdk/provider-name
```

### 2. Add provider helper to `ai-sdk-providers.ts`

```typescript
import { providerName } from '@ai-sdk/provider-name';

export function getProviderModel(modelName: string, apiKey?: string): LanguageModel {
  const provider = providerName({
    apiKey: apiKey || process.env.PROVIDER_API_KEY,
  });
  
  return provider(modelName);
}
```

### 3. Use in provider route

```typescript
import { getProviderModel } from "../../ai-sdk-providers";

// In your route handler
if (useAgenticMode && useTools) {
  const aiModel = getProviderModel(model);
  // ... rest of agentic mode setup
}
```

That's it! The AI SDK handles all the provider-specific details automatically.

## Benefits Over Previous Implementation

### 1. **Unified Interface**
- One codebase works with all providers
- No need to write provider-specific adapters
- Automatic message format conversion

### 2. **Better Tool Handling**
- Built-in tool call parsing
- Automatic tool result formatting
- Parallel tool execution support

### 3. **Easier Maintenance**
- Updates to the AI SDK benefit all providers
- Less code to maintain
- Better error handling

### 4. **More Features**
- Multi-modal support (images, files)
- Streaming support
- Better token counting
- Request/response middleware

### 5. **Future-Proof**
- New providers added to AI SDK work automatically
- Provider updates handled by AI SDK team
- Active development and community support

## Debugging

### Enable Detailed Logging

The agentic workflow logs detailed information about each iteration:

```
[Agentic] Starting agentic loop with max 10 iterations
[Agentic] Loaded 12 tools: web-search, calculator, ...
[Agentic] Iteration 1/10
[Agentic] LLM responded with 150 chars, 2 tool calls
[Agentic] Executing 2 tool calls: web-search, calculator
[Agentic] Tool execution completed
[Agentic] Iteration 2/10
[Agentic] No tool calls, finishing with response
[Agentic] Loop completed in 2 iterations
```

### Check Database Messages

All tool calls and results are stored in the database with:
- `type: 'agentic_tool_calls'`
- `type: 'agentic_tool_results'`
- `type: 'agentic_summary'`

## Migration Notes

### From Previous Implementation

The previous implementation used custom provider adapters (`AgenticProvider` interface). These have been removed in favor of the AI SDK's unified interface.

**Before:**
```typescript
class OpenAIAgenticProvider implements AgenticProvider {
  async makeRequest(messages, tools) { ... }
  formatToolMessages(toolCalls, toolResults) { ... }
}
```

**After:**
```typescript
const aiModel = getOpenAIModel(modelName);
// AI SDK handles everything automatically
```

### Breaking Changes

- `AgenticProvider` interface removed
- Provider-specific adapter classes removed
- Message format now uses AI SDK's `CoreMessage` type
- Tool definitions use AI SDK's `CoreTool` format

### Database Schema

No changes to database schema required. The agentic workflow continues to store messages and metadata in the same format.

## Performance Considerations

### Token Usage

The agentic loop can use many tokens due to:
- Multiple iterations
- Tool call context
- Tool results in messages

**Mitigation:**
- `maxContextMessages` limits context size
- Tool results are truncated if too large
- System monitors token usage

### Latency

Each iteration requires:
- LLM API call (1-5 seconds)
- Tool execution (0.1-10 seconds)
- Database writes (< 0.1 seconds)

**Expected total time:**
- Simple tasks: 5-15 seconds (1-2 iterations)
- Complex tasks: 30-60 seconds (5-10 iterations)

## References

- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs/introduction)
- [AI SDK Agents Guide](https://ai-sdk.dev/docs/ai-sdk-core/agents)
- [AI SDK Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Supported Providers](https://ai-sdk.dev/providers)

