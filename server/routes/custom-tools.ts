import { Router, Request, Response } from 'express';
import { db } from '@db';
import { customTools } from '@db/schema';
import { eq, and, or } from 'drizzle-orm';
import { z } from 'zod';
import { refreshTools } from '../tools';
import { runPythonTool } from '../tools/manual/run-python';
import { generateText } from 'ai';
import { getModelByName } from '../ai-sdk-providers';

const router = Router();

// Validation schema for creating/updating tools
const toolSchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z_][a-z0-9_]*$/, 'Tool name must be lowercase with underscores only'),
  description: z.string().min(10).max(500),
  python_code: z.string().min(1),
  parameters_schema: z.object({
    type: z.literal('object'),
    properties: z.record(z.any()).optional(),
    required: z.array(z.string()).optional(),
  }),
  packages: z.array(z.string()).optional(),
  is_enabled: z.boolean().optional(),
  is_shared: z.boolean().optional(),
});

// Get all custom tools for the current user
router.get('/api/custom-tools', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Get user's tools and shared tools
    const tools = await db
      .select()
      .from(customTools)
      .where(
        or(
          eq(customTools.user_id, userId),
          eq(customTools.is_shared, true)
        )
      )
      .orderBy(customTools.created_at);

    res.json(tools);
  } catch (error) {
    console.error('Error fetching custom tools:', error);
    res.status(500).json({ error: 'Failed to fetch custom tools' });
  }
});

// Get a specific custom tool
router.get('/api/custom-tools/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const toolId = parseInt(req.params.id);
    if (isNaN(toolId)) {
      return res.status(400).json({ error: 'Invalid tool ID' });
    }

    const [tool] = await db
      .select()
      .from(customTools)
      .where(
        and(
          eq(customTools.id, toolId),
          or(
            eq(customTools.user_id, userId),
            eq(customTools.is_shared, true)
          )
        )
      )
      .limit(1);

    if (!tool) {
      return res.status(404).json({ error: 'Tool not found' });
    }

    res.json(tool);
  } catch (error) {
    console.error('Error fetching custom tool:', error);
    res.status(500).json({ error: 'Failed to fetch custom tool' });
  }
});

// Create a new custom tool
router.post('/api/custom-tools', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Validate request body
    const validation = toolSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid tool data', 
        details: validation.error.errors 
      });
    }

    const toolData = validation.data;

    // Check if tool name already exists for this user
    const [existingTool] = await db
      .select()
      .from(customTools)
      .where(
        and(
          eq(customTools.user_id, userId),
          eq(customTools.name, toolData.name)
        )
      )
      .limit(1);

    if (existingTool) {
      return res.status(409).json({ error: 'A tool with this name already exists' });
    }

    // Create the tool
    const [newTool] = await db
      .insert(customTools)
      .values({
        user_id: userId,
        name: toolData.name,
        description: toolData.description,
        python_code: toolData.python_code,
        parameters_schema: toolData.parameters_schema,
        packages: toolData.packages || [],
        is_enabled: toolData.is_enabled ?? true,
        is_shared: toolData.is_shared ?? false,
        created_at: new Date(),
        updated_at: new Date(),
      })
      .returning();

    // Refresh tools cache to include the new tool
    await refreshTools();

    res.status(201).json(newTool);
  } catch (error) {
    console.error('Error creating custom tool:', error);
    res.status(500).json({ error: 'Failed to create custom tool' });
  }
});

// Update an existing custom tool
router.put('/api/custom-tools/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const toolId = parseInt(req.params.id);
    if (isNaN(toolId)) {
      return res.status(400).json({ error: 'Invalid tool ID' });
    }

    // Validate request body
    const validation = toolSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid tool data', 
        details: validation.error.errors 
      });
    }

    const toolData = validation.data;

    // Check if tool exists and belongs to user
    const [existingTool] = await db
      .select()
      .from(customTools)
      .where(
        and(
          eq(customTools.id, toolId),
          eq(customTools.user_id, userId)
        )
      )
      .limit(1);

    if (!existingTool) {
      return res.status(404).json({ error: 'Tool not found or you do not have permission to edit it' });
    }

    // If name is being changed, check for conflicts
    if (toolData.name && toolData.name !== existingTool.name) {
      const [conflictingTool] = await db
        .select()
        .from(customTools)
        .where(
          and(
            eq(customTools.user_id, userId),
            eq(customTools.name, toolData.name)
          )
        )
        .limit(1);

      if (conflictingTool) {
        return res.status(409).json({ error: 'A tool with this name already exists' });
      }
    }

    // Update the tool
    const [updatedTool] = await db
      .update(customTools)
      .set({
        ...toolData,
        updated_at: new Date(),
      })
      .where(eq(customTools.id, toolId))
      .returning();

    // Refresh tools cache
    await refreshTools();

    res.json(updatedTool);
  } catch (error) {
    console.error('Error updating custom tool:', error);
    res.status(500).json({ error: 'Failed to update custom tool' });
  }
});

// Delete a custom tool
router.delete('/api/custom-tools/:id', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const toolId = parseInt(req.params.id);
    if (isNaN(toolId)) {
      return res.status(400).json({ error: 'Invalid tool ID' });
    }

    // Check if tool exists and belongs to user
    const [existingTool] = await db
      .select()
      .from(customTools)
      .where(
        and(
          eq(customTools.id, toolId),
          eq(customTools.user_id, userId)
        )
      )
      .limit(1);

    if (!existingTool) {
      return res.status(404).json({ error: 'Tool not found or you do not have permission to delete it' });
    }

    // Delete the tool
    await db
      .delete(customTools)
      .where(eq(customTools.id, toolId));

    // Refresh tools cache
    await refreshTools();

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting custom tool:', error);
    res.status(500).json({ error: 'Failed to delete custom tool' });
  }
});

// Toggle tool enabled status
router.patch('/api/custom-tools/:id/toggle', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const toolId = parseInt(req.params.id);
    if (isNaN(toolId)) {
      return res.status(400).json({ error: 'Invalid tool ID' });
    }

    // Check if tool exists and belongs to user
    const [existingTool] = await db
      .select()
      .from(customTools)
      .where(
        and(
          eq(customTools.id, toolId),
          eq(customTools.user_id, userId)
        )
      )
      .limit(1);

    if (!existingTool) {
      return res.status(404).json({ error: 'Tool not found or you do not have permission to modify it' });
    }

    // Toggle the enabled status
    const [updatedTool] = await db
      .update(customTools)
      .set({
        is_enabled: !existingTool.is_enabled,
        updated_at: new Date(),
      })
      .where(eq(customTools.id, toolId))
      .returning();

    // Refresh tools cache
    await refreshTools();

    res.json(updatedTool);
  } catch (error) {
    console.error('Error toggling custom tool:', error);
    res.status(500).json({ error: 'Failed to toggle custom tool' });
  }
});

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

// Test a tool's Python code with parameters
router.post('/api/custom-tools/test', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { python_code, parameters, packages: userPackages } = req.body;

    if (!python_code || typeof python_code !== 'string') {
      return res.status(400).json({ error: 'Python code is required' });
    }

    // Build parameter assignments for the Python code
    const paramsCode: string[] = [];
    if (parameters && typeof parameters === 'object') {
      for (const [key, value] of Object.entries(parameters)) {
        const jsonValue = JSON.stringify(value);
        paramsCode.push(`${key} = ${jsonValue}`);
      }
    }

    // Combine parameter assignments with user's Python code
    const fullCode = paramsCode.length > 0 
      ? `import json\n\n# Test Parameters\n${paramsCode.join('\n')}\n\n# User code\n${python_code}`
      : python_code;

    // Auto-detect packages from code
    const detectedPackages = detectPackagesFromCode(fullCode);
    
    // Use user-provided packages if specified, otherwise use detected packages
    const packagesToInstall = userPackages && Array.isArray(userPackages) && userPackages.length > 0
      ? userPackages
      : detectedPackages;

    console.log(`[Custom Tools Test] Detected packages: ${detectedPackages.join(', ') || 'none'}`);
    console.log(`[Custom Tools Test] User-provided packages: ${userPackages?.join(', ') || 'none'}`);
    console.log(`[Custom Tools Test] Installing packages: ${packagesToInstall.join(', ') || 'none'}`);

    // Execute the Python code
    const result = await runPythonTool.execute({
      code: fullCode,
      packages: packagesToInstall,
      timeout: 30
    });

    res.json(result);
  } catch (error) {
    console.error('Error testing custom tool:', error);
    res.status(500).json({ 
      error: 'Failed to test tool',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Generate parameter schema from Python code using LLM
router.post('/api/custom-tools/generate-schema', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { python_code, description } = req.body;

    if (!python_code || typeof python_code !== 'string') {
      return res.status(400).json({ error: 'Python code is required' });
    }

    // Get system model from environment variable
    const systemModel = process.env.SYSTEM_MODEL || 'gpt-4o';
    console.log(`[Schema Generation] Using system model: ${systemModel}`);

    try {
      const model = getModelByName(systemModel);

      const prompt = `You are an expert at analyzing Python code and generating JSON schemas. 

Given the following Python code${description ? ` with description: "${description}"` : ''}, generate a JSON schema for the parameters this code expects.

Python Code:
\`\`\`python
${python_code}
\`\`\`

Generate a JSON schema that describes the parameters. The schema should:
1. Be in the format: { "type": "object", "properties": {...}, "required": [...] }
2. Include all parameters that the code uses (look for variable assignments, function parameters, etc.)
3. Infer appropriate types (string, number, boolean, array, object)
4. Add helpful descriptions for each parameter
5. Mark parameters as required if they're used without default values

Return ONLY the JSON schema, no explanation or additional text.`;

      const result = await generateText({
        model,
        prompt,
        temperature: 0.3,
      });

      // Extract JSON from the response
      let schemaText = result.text.trim();
      
      // Remove markdown code blocks if present
      schemaText = schemaText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Parse and validate the schema
      const schema = JSON.parse(schemaText);

      // Ensure it has the required structure
      if (!schema.type || schema.type !== 'object') {
        schema.type = 'object';
      }
      if (!schema.properties) {
        schema.properties = {};
      }
      if (!schema.required) {
        schema.required = [];
      }

      res.json({ schema });
    } catch (error) {
      console.error('Error generating schema with LLM:', error);
      res.status(500).json({ 
        error: 'Failed to generate schema',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } catch (error) {
    console.error('Error in generate-schema endpoint:', error);
    res.status(500).json({ 
      error: 'Failed to generate schema',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

