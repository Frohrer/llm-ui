import type { Tool } from './types';
import { generateText } from 'ai';
import { db } from '@db';
import { customTools } from '@db/schema';
import { eq, and } from 'drizzle-orm';
import { refreshTools } from '../index';
import { runPythonTool } from './run-python';
import { getModelByName } from '../../ai-sdk-providers';
import fs from 'fs';
import path from 'path';

/**
 * Tool that creates custom tools using AI (Claude Sonnet 4.5)
 * This is a meta-tool that generates complete tool definitions from natural language descriptions
 */

// Load the custom tools guide
const CUSTOM_TOOLS_GUIDE = fs.readFileSync(
  path.join(process.cwd(), 'CUSTOM_TOOLS_GUIDE.md'),
  'utf-8'
);

export const createCustomToolTool: Tool = {
  name: 'create_custom_tool',
  description: `Create a new custom Python tool using AI (Claude Sonnet 4.5). This meta-tool analyzes your requirements and automatically generates:
- Tool name (in snake_case)
- Description for the LLM
- Complete Python code
- Parameter schema (JSON Schema format)
- Optionally tests the tool before creating it

Use this when the user wants to create a new custom tool or add functionality. The AI will handle all the technical details of tool creation.`,
  
  parameters: {
    type: 'object',
    properties: {
      tool_description: {
        type: 'string',
        description: 'Natural language description of what the tool should do. Be specific about inputs, outputs, and behavior. Example: "Create a tool that calculates the distance between two GPS coordinates using the Haversine formula"'
      },
      test_after_creation: {
        type: 'boolean',
        description: 'Whether to test the tool with sample parameters after creating it. Default: true'
      },
      make_shared: {
        type: 'boolean',
        description: 'Whether to make this tool available to all users. Default: false'
      }
    },
    required: ['tool_description']
  },

  execute: async (params: any, context?: { userId?: number }) => {
    const { tool_description, test_after_creation = true, make_shared = false } = params;
    const userId = context?.userId;
    try {
      if (!userId) {
        return {
          success: false,
          error: 'User authentication required to create custom tools',
        };
      }

      console.log(`[Create Custom Tool] Generating tool from description: ${tool_description}`);

      // Use Claude Sonnet 4.5 to generate the complete tool definition
      const model = getModelByName('claude-sonnet-4-20250514');
      
      const prompt = `You are an expert at creating custom Python tools for an AI assistant system.

# CUSTOM TOOLS GUIDE
${CUSTOM_TOOLS_GUIDE}

# TASK
Create a complete custom tool definition based on this user request:
"${tool_description}"

# REQUIREMENTS
1. Generate a tool name in snake_case (lowercase with underscores only)
2. Write a clear description that helps the LLM understand when to use this tool
3. Write complete, working Python code that:
   - Uses print() statements for all output (NOT return statements)
   - Handles edge cases and errors gracefully
   - Uses clear variable names that match the parameter schema
   - Includes any necessary imports
   - Is production-ready and well-tested logic
4. Create a JSON schema for parameters following JSON Schema format
5. Include example test parameters that would validate the tool works

# OUTPUT FORMAT
Return a JSON object with this exact structure:
{
  "tool_name": "snake_case_name",
  "description": "Clear description for the LLM (10-500 chars)",
  "python_code": "Complete Python code with print() statements",
  "parameters_schema": {
    "type": "object",
    "properties": {
      "param_name": {
        "type": "string|number|integer|boolean|array|object",
        "description": "Parameter description"
      }
    },
    "required": ["param1", "param2"]
  },
  "packages": ["package1", "package2"],
  "test_parameters": {
    "param_name": "test_value"
  }
}

# IMPORTANT
- Use ONLY print() for output, never return statements
- The python_code should be a complete, working script
- Parameter names in the schema must match variable names used in the code
- Ensure the code handles errors and edge cases
- The test_parameters should demonstrate the tool's functionality
- The packages array should list PIP package names (not import names):
  * cv2 → opencv-python
  * PIL → Pillow
  * sklearn → scikit-learn
  * bs4 → beautifulsoup4
  * yaml → PyYAML
  * For other packages, use the pip install name
- Only include packages that aren't in Python's standard library
- Leave packages array empty [] if only using standard library modules

Return ONLY the JSON object, no explanation or markdown.`;

      console.log('[Create Custom Tool] Calling Claude Sonnet 4.5...');
      const result = await generateText({
        model,
        prompt,
        temperature: 0.7,
      });

      // Extract JSON from the response
      let responseText = result.text.trim();
      
      // Remove markdown code blocks if present
      responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Parse the tool definition
      let toolDef;
      try {
        toolDef = JSON.parse(responseText);
      } catch (parseError) {
        console.error('[Create Custom Tool] Failed to parse AI response:', responseText);
        return {
          success: false,
          error: 'Failed to parse AI-generated tool definition. The AI response was not valid JSON.',
          raw_response: responseText,
        };
      }

      // Validate the tool definition structure
      if (!toolDef.tool_name || !toolDef.description || !toolDef.python_code || !toolDef.parameters_schema) {
        return {
          success: false,
          error: 'AI-generated tool definition is missing required fields',
          generated_definition: toolDef,
        };
      }

      // Validate tool name format
      const nameRegex = /^[a-z_][a-z0-9_]*$/;
      if (!nameRegex.test(toolDef.tool_name)) {
        return {
          success: false,
          error: `Invalid tool name "${toolDef.tool_name}". Must be lowercase with underscores only.`,
          generated_definition: toolDef,
        };
      }

      // Check if tool already exists
      const [existingTool] = await db
        .select()
        .from(customTools)
        .where(
          and(
            eq(customTools.user_id, userId),
            eq(customTools.name, toolDef.tool_name)
          )
        )
        .limit(1);

      if (existingTool) {
        return {
          success: false,
          error: `A tool named "${toolDef.tool_name}" already exists. Please delete it first or use a different description.`,
          existing_tool: existingTool,
        };
      }

      // Test the tool before creating it (if requested)
      let testResult = null;
      if (test_after_creation && toolDef.test_parameters) {
        console.log('[Create Custom Tool] Testing generated code...');
        
        // Build parameter assignments
        const paramsCode: string[] = [];
        for (const [key, value] of Object.entries(toolDef.test_parameters)) {
          const jsonValue = JSON.stringify(value);
          paramsCode.push(`${key} = ${jsonValue}`);
        }

        const fullCode = paramsCode.length > 0 
          ? `import json\n\n# Test Parameters\n${paramsCode.join('\n')}\n\n# Tool code\n${toolDef.python_code}`
          : toolDef.python_code;

        // Use AI-generated packages or auto-detect
        let testPackages: string[] = [];
        if (toolDef.packages && Array.isArray(toolDef.packages) && toolDef.packages.length > 0) {
          testPackages = toolDef.packages;
          console.log(`[Create Custom Tool] Testing with AI-generated packages: ${testPackages.join(', ')}`);
        } else {
          testPackages = detectPackagesFromCode(fullCode);
          console.log(`[Create Custom Tool] Testing with auto-detected packages: ${testPackages.join(', ') || 'none'}`);
        }

        try {
          testResult = await runPythonTool.execute({
            code: fullCode,
            packages: testPackages,
            timeout: 30
          });

          if (!testResult.success) {
            return {
              success: false,
              error: 'Tool test failed. The generated code has errors.',
              test_result: testResult,
              generated_definition: toolDef,
              suggestion: 'You can try creating the tool manually or provide more specific requirements.',
            };
          }
        } catch (testError) {
          return {
            success: false,
            error: 'Failed to test the generated tool',
            test_error: testError instanceof Error ? testError.message : 'Unknown error',
            generated_definition: toolDef,
          };
        }
      }

      // Use AI-generated packages list, or fall back to auto-detection
      let packagesToStore: string[] = [];
      
      if (toolDef.packages && Array.isArray(toolDef.packages) && toolDef.packages.length > 0) {
        // Use packages provided by Claude (preferred - handles pip name differences)
        packagesToStore = toolDef.packages;
        console.log(`[Create Custom Tool] Using AI-generated packages: ${packagesToStore.join(', ')}`);
      } else {
        // Fall back to auto-detection if Claude didn't provide packages
        packagesToStore = detectPackagesFromCode(toolDef.python_code);
        console.log(`[Create Custom Tool] Auto-detected packages: ${packagesToStore.join(', ') || 'none'}`);
      }

      // Create the tool in the database
      console.log('[Create Custom Tool] Creating tool in database...');
      const [newTool] = await db
        .insert(customTools)
        .values({
          user_id: userId,
          name: toolDef.tool_name,
          description: toolDef.description,
          python_code: toolDef.python_code,
          parameters_schema: toolDef.parameters_schema,
          packages: packagesToStore,
          is_enabled: true,
          is_shared: make_shared,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning();

      // Refresh tools cache to include the new tool
      await refreshTools();
      console.log('[Create Custom Tool] Tool created and cache refreshed');

      return {
        success: true,
        message: `Successfully created custom tool: ${toolDef.tool_name}`,
        tool: {
          id: newTool.id,
          name: newTool.name,
          description: newTool.description,
          parameters: Object.keys(toolDef.parameters_schema.properties || {}),
          packages: packagesToStore,
          is_shared: make_shared,
        },
        test_result: testResult ? {
          tested: true,
          output: testResult.output,
          execution_time: testResult.execution_time,
        } : {
          tested: false,
          reason: 'Testing was disabled or no test parameters provided',
        },
        next_steps: `The tool "${toolDef.tool_name}" is now available for use.${packagesToStore.length > 0 ? ` Required packages: ${packagesToStore.join(', ')}.` : ''} You can test it by asking me to use it, or view/edit it in the Custom Tools page.`,
      };

    } catch (error) {
      console.error('[Create Custom Tool] Error:', error);
      return {
        success: false,
        error: 'Failed to create custom tool',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
};

// Helper function to detect packages from Python code
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
    'geopy': 'geopy',
    'haversine': 'haversine',
  };

  const stdLibModules = new Set([
    'os', 'sys', 'json', 'time', 'datetime', 'random', 'math', 'collections',
    'itertools', 'functools', 'operator', 'pathlib', 'glob', 'shutil', 'tempfile',
    'subprocess', 'threading', 'multiprocessing', 'asyncio', 'concurrent', 'queue',
    'socket', 'ssl', 'urllib', 'http', 'email', 'base64', 'hashlib', 'hmac',
    'secrets', 'uuid', 'pickle', 'shelve', 'dbm', 'sqlite3', 'zlib', 'gzip',
    'bz2', 'lzma', 'zipfile', 'tarfile', 'csv', 'configparser', 'logging',
    'getpass', 'platform', 'stat', 're', 'string', 'typing', 'io', 'copy',
    'statistics',
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

