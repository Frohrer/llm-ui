import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { manualTools } from './manual';


// Define the interface for a tool
export interface Tool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
  };
  execute: (params: any) => Promise<any>;
}

// Cache for the loaded tools
let toolsCache: Record<string, Tool> = {};
let toolsLoaded = false;

/**
 * Load all tools from the tools directory
 */
export async function loadTools(): Promise<Record<string, Tool>> {
  if (toolsLoaded) {
    return toolsCache;
  }

  try {
    // Get the directory path using import.meta.url instead of __dirname
    const __filename = fileURLToPath(import.meta.url);
    const toolsDir = path.dirname(__filename);
    console.log("Tools directory:", toolsDir);
    
    const files = fs.readdirSync(toolsDir);
    
    for (const file of files) {
      // Skip index.ts, manual directory, and non-ts files
      if (file === 'index.ts' || file === 'index.js' || file === 'manual' || (!file.endsWith('.ts') && !file.endsWith('.js'))) {
        continue;
      }

      try {
        // Import the tool module
        const toolPath = path.join(toolsDir, file);
        console.log(`Attempting to import tool from: ${toolPath}`);
        const toolModule = await import(toolPath);
        
        // Each tool file should export a default Tool object
        if (toolModule.default && typeof toolModule.default === 'object') {
          const tool = toolModule.default as Tool;
          if (tool.name && tool.description && typeof tool.execute === 'function') {
            toolsCache[tool.name] = tool;
            console.log(`Successfully loaded tool: ${tool.name}`);
          } else {
            console.warn(`Tool in file ${file} is missing required properties`);
          }
        }
      } catch (error) {
        console.error(`Error loading tool from ${file}:`, error);
      }
    }

    // If no tools were loaded dynamically, use manual tools as fallback
    if (Object.keys(toolsCache).length === 0) {
      console.log("No tools loaded dynamically, using manual tools as fallback");
      
      for (const tool of manualTools) {
        toolsCache[tool.name] = tool;
        console.log(`Using manual tool: ${tool.name}`);
      }
    }

    console.log(`Loaded ${Object.keys(toolsCache).length} tools: ${Object.keys(toolsCache).join(', ')}`);
    
    toolsLoaded = true;
    return toolsCache;
  } catch (error) {
    console.error('Error in loadTools():', error);
    
    // Final fallback: use manual tools if any other approach fails
    try {
      console.log("Error loading tools dynamically, using manual tools as fallback");
      
      for (const tool of manualTools) {
        toolsCache[tool.name] = tool;
      }
      
      console.log(`Loaded ${Object.keys(toolsCache).length} manual tools as fallback`);
      toolsLoaded = true;
      return toolsCache;
    } catch (fallbackError) {
      console.error("Error loading manual tools:", fallbackError);
      return {};
    }
  }
}

/**
 * Get all available tools
 */
export async function getTools(): Promise<Tool[]> {
  const toolsMap = await loadTools();
  return Object.values(toolsMap);
}

/**
 * Get tool definitions in OpenAI-compatible format for function calling
 */
export async function getToolDefinitions() {
  const tools = await getTools();
  
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

/**
 * Execute a tool by name with the given parameters
 */
export async function executeTool(toolName: string, params: any): Promise<any> {
  const toolsMap = await loadTools();
  
  if (!toolsMap[toolName]) {
    throw new Error(`Tool ${toolName} not found`);
  }
  
  try {
    return await toolsMap[toolName].execute(params);
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    throw error;
  }
}

/**
 * Helper to handle tool calling responses from LLMs
 */
export async function handleToolCalls(toolCalls: any[]): Promise<any[]> {
  const results = [];
  
  for (const toolCall of toolCalls) {
    try {
      // Handle both OpenAI and custom tool call formats
      const toolName = toolCall.function?.name || toolCall.name;
      const toolArgs = toolCall.function?.arguments ? 
        JSON.parse(toolCall.function.arguments) : toolCall.arguments;
      
      const result = await executeTool(toolName, toolArgs);
      results.push({
        toolCallId: toolCall.id,
        toolName,
        result
      });
    } catch (error) {
      results.push({
        toolCallId: toolCall.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
  
  return results;
} 