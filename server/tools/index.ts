import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { manualTools } from './manual/index.js';
import { db } from '@db';
import { customTools } from '@db/schema';
import { eq } from 'drizzle-orm';
import { runPythonTool } from './manual/run-python.js';
import { truncateToolResult } from '../context-manager.js';


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
 * Helper function to detect packages from Python code
 */
function detectPackagesFromCode(code: string): string[] {
  const importToPackage: Record<string, string> = {
    'cv2': 'opencv-python',
    'sklearn': 'scikit-learn',
    'PIL': 'Pillow',
    'bs4': 'beautifulsoup4',
    'yaml': 'PyYAML',
    'dns': 'dnspython',
    'serial': 'pyserial',
    'crypto': 'pycryptodome',
    'jwt': 'PyJWT',
    'dateutil': 'python-dateutil',
    'magic': 'python-magic',
    'psutil': 'psutil',
    'requests': 'requests',
    'numpy': 'numpy',
    'pandas': 'pandas',
    'matplotlib': 'matplotlib',
    'seaborn': 'seaborn',
    'plotly': 'plotly',
    'scipy': 'scipy',
    'tensorflow': 'tensorflow',
    'torch': 'torch',
    'transformers': 'transformers',
    'flask': 'flask',
    'fastapi': 'fastapi',
    'django': 'django',
    'sqlalchemy': 'sqlalchemy',
    'pymongo': 'pymongo',
    'redis': 'redis',
    'celery': 'celery',
    'pytest': 'pytest',
    'click': 'click',
    'rich': 'rich',
    'typer': 'typer',
    'pydantic': 'pydantic',
    'httpx': 'httpx',
    'aiohttp': 'aiohttp',
    'websockets': 'websockets',
    'paramiko': 'paramiko',
    'fabric': 'fabric',
    'invoke': 'invoke',
  };

  const stdLibModules = new Set([
    'os', 'sys', 'json', 'time', 'datetime', 'random', 'math', 'collections',
    'itertools', 'functools', 'operator', 'pathlib', 'glob', 'shutil', 'tempfile',
    'subprocess', 'threading', 'multiprocessing', 'asyncio', 'concurrent', 'queue',
    'socket', 'ssl', 'urllib', 'http', 'email', 'base64', 'hashlib', 'hmac',
    'secrets', 'uuid', 'pickle', 'shelve', 'dbm', 'sqlite3', 'zlib', 'gzip',
    'bz2', 'lzma', 'zipfile', 'tarfile', 'csv', 'configparser', 'logging',
    'getpass', 'platform', 'stat', 're', 'string', 'typing', 'io', 'copy',
  ]);

  const importPatterns = [
    /^import\s+([\w.]+)/gm,
    /^from\s+([\w.]+)\s+import/gm,
  ];

  const detectedImports = new Set<string>();

  for (const pattern of importPatterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const rootModule = match[1].split('.')[0];
      detectedImports.add(rootModule);
    }
  }

  const packages: string[] = [];
  detectedImports.forEach(imp => {
    if (importToPackage[imp]) {
      packages.push(importToPackage[imp]);
    } else if (!stdLibModules.has(imp)) {
      packages.push(imp);
    }
  });

  return Array.from(new Set(packages)).sort();
}

/**
 * Load custom Python tools from the database
 */
async function loadCustomTools(): Promise<void> {
  try {
    // Get all enabled custom tools
    const customToolsList = await db
      .select()
      .from(customTools)
      .where(eq(customTools.is_enabled, true));

    console.log(`Loading ${customToolsList.length} custom Python tools from database`);

    for (const customTool of customToolsList) {
      // Create a tool wrapper that executes Python code
      const tool: Tool = {
        name: customTool.name,
        description: customTool.description,
        parameters: customTool.parameters_schema as any,
        execute: async (params: any) => {
          try {
            // Extract the parameters from the schema
            const paramsList: string[] = [];
            const paramsCode: string[] = [];
            
            if (customTool.parameters_schema && 
                typeof customTool.parameters_schema === 'object' && 
                'properties' in customTool.parameters_schema) {
              const properties = (customTool.parameters_schema as any).properties || {};
              
              // Build parameter assignments for the Python code
              for (const [key, value] of Object.entries(params)) {
                const jsonValue = JSON.stringify(value);
                paramsCode.push(`${key} = ${jsonValue}`);
              }
            }

            // Combine parameter assignments with user's Python code
            const fullCode = paramsCode.length > 0 
              ? `import json\n\n# Parameters\n${paramsCode.join('\n')}\n\n# User code\n${customTool.python_code}`
              : customTool.python_code;

            // Use stored packages if available, otherwise auto-detect
            let packagesToInstall: string[] = [];
            
            // Check if tool has manually specified packages
            if (customTool.packages && Array.isArray(customTool.packages) && customTool.packages.length > 0) {
              packagesToInstall = customTool.packages as string[];
              console.log(`[Custom Tool: ${customTool.name}] Using stored packages: ${packagesToInstall.join(', ')}`);
            } else {
              // Auto-detect packages from the code
              const detectedPackages = detectPackagesFromCode(fullCode);
              packagesToInstall = detectedPackages;
              console.log(`[Custom Tool: ${customTool.name}] Auto-detected packages: ${detectedPackages.join(', ') || 'none'}`);
            }

            // Execute the Python code using the run_python tool
            const result = await runPythonTool.execute({
              code: fullCode,
              packages: packagesToInstall,
              timeout: 30
            });

            // Update execution statistics
            await db
              .update(customTools)
              .set({
                execution_count: customTool.execution_count + 1,
                last_executed_at: new Date(),
              })
              .where(eq(customTools.id, customTool.id));

            return result;
          } catch (error) {
            console.error(`Error executing custom tool ${customTool.name}:`, error);
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              tool_name: customTool.name
            };
          }
        }
      };

      toolsCache[tool.name] = tool;
      console.log(`Loaded custom Python tool: ${tool.name}`);
    }
  } catch (error) {
    console.error('Error loading custom tools:', error);
  }
}

/**
 * Load all tools from the tools directory
 */
export async function loadTools(): Promise<Record<string, Tool>> {
  if (toolsLoaded) {
    return toolsCache;
  }

  try {
    // Load local tools
    await loadLocalTools();

    // Load custom Python tools from database
    await loadCustomTools();

    console.log(`Loaded ${Object.keys(toolsCache).length} total tools: ${Object.keys(toolsCache).join(', ')}`);
    
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
 * Load local tools from the tools directory
 */
async function loadLocalTools(): Promise<void> {
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
            console.log(`Successfully loaded local tool: ${tool.name}`);
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

    console.log(`Loaded ${Object.keys(toolsCache).length} local tools`);
  } catch (error) {
    console.error('Error loading local tools:', error);
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
export async function executeTool(toolName: string, params: any, userId?: number): Promise<any> {
  const toolsMap = await loadTools();
  
  if (!toolsMap[toolName]) {
    throw new Error(`Tool ${toolName} not found`);
  }
  
  try {
    // Pass userId as a second parameter for tools that need it
    return await toolsMap[toolName].execute(params, { userId });
  } catch (error) {
    console.error(`Error executing tool ${toolName}:`, error);
    throw error;
  }
}

/**
 * Helper to handle tool calling responses from LLMs
 * Includes automatic truncation of large tool results to prevent context overflow
 */
export async function handleToolCalls(toolCalls: any[], options: { maxResultTokens?: number } = {}): Promise<any[]> {
  const { maxResultTokens = 8000 } = options; // Default 8K tokens per tool result
  const results = [];
  
  for (const toolCall of toolCalls) {
    try {
      // Handle both OpenAI and custom tool call formats
      const toolName = toolCall.function?.name || toolCall.name;
      const toolArgs = toolCall.function?.arguments ? 
        JSON.parse(toolCall.function.arguments) : toolCall.arguments;
      
      const result = await executeTool(toolName, toolArgs);
      
      // Truncate large results to prevent context overflow
      let processedResult = result;
      const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
      
      // Check if result is too large (roughly estimate tokens as chars / 2.7)
      const estimatedTokens = Math.ceil(resultStr.length / 2.7);
      if (estimatedTokens > maxResultTokens) {
        console.log(`[Tools] Truncating large tool result from ${toolName}: ~${estimatedTokens} tokens -> ~${maxResultTokens} tokens`);
        const truncatedStr = truncateToolResult(result, maxResultTokens);
        try {
          // Try to parse back to object if it was JSON
          processedResult = JSON.parse(truncatedStr);
        } catch {
          processedResult = truncatedStr;
        }
      }
      
      results.push({
        toolCallId: toolCall.id,
        toolName,
        result: processedResult
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

/**
 * Refresh tools cache
 */
export async function refreshTools(): Promise<void> {
  toolsLoaded = false;
  toolsCache = {};
  await loadTools();
}

/**
 * Get tool statistics
 */
export async function getToolStatistics(): Promise<{
  totalTools: number;
  localTools: number;
}> {
  const tools = await getTools();
  
  return {
    totalTools: tools.length,
    localTools: tools.length,
  };
} 