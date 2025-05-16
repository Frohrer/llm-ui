# Tool Framework

This directory contains the tool framework which allows you to define custom tools that can be called by LLM models in your application.

## How It Works

The tool framework allows you to:
1. Define tools as TypeScript files in the `tools` directory
2. Automatically discover and load tools at runtime
3. Expose tools to LLMs for function calling
4. Execute tool calls and handle their results

## Creating a New Tool

To create a new tool, add a new TypeScript file in this directory. Each tool file should export a default `Tool` object that implements the `Tool` interface:

```typescript
import { Tool } from './index';

const myTool: Tool = {
  name: 'myToolName',
  description: 'Description of what this tool does',
  parameters: {
    type: 'object',
    properties: {
      // Define the parameters your tool accepts
      param1: {
        type: 'string',
        description: 'Description of param1',
      },
      param2: {
        type: 'number',
        description: 'Description of param2',
      },
    },
    // List required parameters
    required: ['param1'],
  },
  execute: async (params) => {
    // Implement your tool's functionality here
    const { param1, param2 = 0 } = params;
    
    // Return the result
    return {
      result: `Processed ${param1} with value ${param2}`
    };
  },
};

export default myTool;
```

## Using Tools with LLM Providers

The tool framework is integrated with providers like OpenAI and Grok. To use tools in your conversation:

1. Set `useTools: true` in your request to the provider's endpoint
2. All available tools will be automatically loaded and made available to the LLM

Example:

```javascript
// Client-side request
const response = await fetch('/api/providers/openai', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    message: 'What's the weather in London?',
    useTools: true,
    // ...other parameters
  }),
});
```

## Handling Tool Call Events

The providers send SSE events during tool calls:

- `tool_call_progress`: When the LLM is generating a tool call
- `tool_execution_start`: When the tool is about to be executed
- `tool_execution_complete`: When the tool execution is completed with results
- `tool_execution_error`: If there was an error executing the tool

## Extending the Framework

You can extend the framework by:

1. Adding more sophisticated tool discovery mechanisms
2. Implementing authentication or permission checks for tool execution
3. Adding tool versioning or categorization
4. Creating tools that integrate with external APIs or services

For more complex tools, consider organizing them into subdirectories with their own module structure. 