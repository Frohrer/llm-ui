# GPT-5 Responses API Usage Guide

This guide demonstrates how to use the new GPT-5 Responses API features in the application.

## Overview

The GPT-5 Responses API introduces several new features:
- **Reasoning effort control**: Choose between minimal, low, medium, or high reasoning
- **Verbosity control**: Control the length of responses (low, medium, high)
- **Custom tools**: Use freeform text inputs for tools
- **Allowed tools**: Restrict which tools can be used
- **Chain of thought persistence**: Pass reasoning between turns

### Key Differences from Chat Completions API

⚠️ **Important**: The Responses API has different parameters:
- ❌ **No `temperature` parameter** - Use `reasoning.effort` and `text.verbosity` instead
- ❌ **No `max_tokens` parameter** - Use `text.verbosity` to control length
- ✅ **Single `input` string** instead of `messages` array
- ✅ **Enhanced tool capabilities** with custom tools and allowed tools
- ✅ **Chain of thought persistence** with `previous_response_id`

## Supported Models

- `gpt-5` - The main GPT-5 model with broad world knowledge
- `gpt-5-mini` - Cost-optimized reasoning and chat
- `gpt-5-nano` - High-throughput tasks and simple instruction-following

## API Usage

### Basic Request

```typescript
import { ResponsesAPIRequest } from '@/lib/llm/types';

const request: ResponsesAPIRequest = {
  input: "How much gold would it take to coat the Statue of Liberty in a 1mm layer?",
  model: "gpt-5",
  reasoning: { effort: "medium" },
  text: { verbosity: "medium" }
};
```

### Minimal Reasoning (Fast Response)

```typescript
const request: ResponsesAPIRequest = {
  input: "Generate a simple Python function to calculate factorial",
  model: "gpt-5",
  reasoning: { effort: "minimal" },
  text: { verbosity: "low" }
};
```

### High Reasoning (Complex Tasks)

```typescript
const request: ResponsesAPIRequest = {
  input: "Analyze the economic implications of renewable energy adoption",
  model: "gpt-5",
  reasoning: { effort: "high" },
  text: { verbosity: "high" }
};
```

### Custom Tools

```typescript
const request: ResponsesAPIRequest = {
  input: "Use the code_exec tool to calculate the area of a circle with radius 5",
  model: "gpt-5",
  tools: [
    {
      type: "custom",
      name: "code_exec",
      description: "Executes arbitrary python code"
    }
  ],
  useTools: true
};
```

### Allowed Tools (Restricted Tool Usage)

```typescript
const request: ResponsesAPIRequest = {
  input: "Get the weather and send an email",
  model: "gpt-5",
  tools: [
    // Define all available tools
    { type: "function", function: { name: "get_weather", description: "...", parameters: {} } },
    { type: "function", function: { name: "send_email", description: "...", parameters: {} } },
    { type: "function", function: { name: "web_search", description: "...", parameters: {} } }
  ],
  tool_choice: {
    type: "allowed_tools",
    mode: "auto",
    tools: [
      { type: "function", name: "get_weather" },
      { type: "function", name: "send_email" }
      // web_search is not allowed
    ]
  },
  useTools: true
};
```

### Chain of Thought Continuation

```typescript
// First request
const firstRequest: ResponsesAPIRequest = {
  input: "Start analyzing this complex problem...",
  model: "gpt-5",
  reasoning: { effort: "medium" }
};

// Follow-up request using previous response
const followUpRequest: ResponsesAPIRequest = {
  input: "Continue the analysis with this new information...",
  model: "gpt-5",
  previous_response_id: firstResponse.id, // Pass the previous response ID
  reasoning: { effort: "medium" }
};
```

## Frontend Integration

### Using the Unified Provider

```typescript
import { UnifiedProvider } from '@/lib/llm/providers/unified';

const provider = new UnifiedProvider(openaiConfig);

// Check if model supports Responses API
if (provider.supportsResponsesAPI('gpt-5')) {
  const response = await provider.sendResponsesAPIMessage({
    input: "Your question here",
    model: "gpt-5",
    reasoning: { effort: "medium" },
    text: { verbosity: "medium" }
  });
  
  console.log('Response:', response.text?.content);
  console.log('Reasoning tokens:', response.usage?.reasoning_tokens);
}
```

### Server-Side Streaming

The Responses API endpoint supports Server-Sent Events (SSE) for real-time streaming:

```javascript
const eventSource = new EventSource('/api/chat/openai/responses', {
  method: 'POST',
  body: JSON.stringify(request)
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  switch (data.type) {
    case 'start':
      console.log('Conversation started:', data.conversationId);
      break;
    case 'chunk':
      console.log('Content chunk:', data.content);
      break;
    case 'end':
      console.log('Response complete:', data.response_metadata);
      break;
    case 'error':
      console.error('Error:', data.error);
      break;
  }
};
```

## Best Practices

### Reasoning Effort Guidelines

- **Minimal**: Use for simple instruction-following, classification, or when you need the fastest response
- **Low**: Good for straightforward coding tasks and basic analysis
- **Medium**: Default setting, good for most tasks requiring some reasoning
- **High**: Use for complex reasoning, multi-step problems, or when maximum accuracy is needed

### Verbosity Guidelines

- **Low**: Use for concise answers, simple code generation, or SQL queries
- **Medium**: Default setting, balanced explanations
- **High**: Use when you need thorough explanations, extensive code refactoring, or detailed analysis

### Tool Usage

- Always validate tool outputs on the server side
- Use custom tools for domain-specific languages or when you need freeform input
- Use allowed tools to prevent unintended tool usage in long conversations
- Provide clear, explicit tool descriptions

## Error Handling

```typescript
try {
  const response = await provider.sendResponsesAPIMessage(request);
  // Handle successful response
} catch (error) {
  if (error.message.includes('does not support Responses API')) {
    // Fallback to regular chat completions
    const fallbackResponse = await provider.sendMessage(request.input);
  } else {
    console.error('Responses API error:', error);
  }
}
```

## Migration from Chat Completions

To migrate existing Chat Completions usage to the Responses API:

1. Change the endpoint from `/api/chat/openai` to `/api/chat/openai/responses`
2. Replace `message` parameter with `input`
3. **Remove `temperature` parameter** - Not supported in Responses API
4. Add reasoning and text configuration instead of temperature for control
5. Update tool definitions to use the new format
6. Handle the new response structure with reasoning tokens

### Parameter Mapping

| Chat Completions | Responses API | Notes |
|------------------|---------------|-------|
| `temperature` | `reasoning.effort` + `text.verbosity` | Temperature is replaced by these parameters |
| `max_tokens` | `text.verbosity` | Verbosity controls output length |
| `messages` | `input` | Single input string instead of message array |
| `tools` | `tools` | Same structure but supports custom tools |
| `tool_choice` | `tool_choice` | Enhanced with allowed_tools option |

### Temperature Replacement Guide

- **High temperature (creative)** → `reasoning: { effort: "low" }, text: { verbosity: "high" }`
- **Medium temperature (balanced)** → `reasoning: { effort: "medium" }, text: { verbosity: "medium" }`
- **Low temperature (focused)** → `reasoning: { effort: "high" }, text: { verbosity: "low" }`

## Zero Data Retention (ZDR) Mode

For organizations with ZDR requirements:

```typescript
const request: ResponsesAPIRequest = {
  input: "Your question",
  model: "gpt-5",
  store: false, // Automatically enforced for ZDR orgs
  include: ["reasoning.encrypted_content"] // Get encrypted reasoning for future use
};
```

The encrypted reasoning content can be passed back in future requests while maintaining zero data retention.