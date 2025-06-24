import axios from 'axios';
import type { Tool } from './types';

// Helper function to create Cloudflare Access headers for service-to-service authentication
function createCloudflareHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  
  const clientId = process.env.CF_ACCESS_CLIENT_ID;
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  
  if (clientId && clientSecret) {
    headers['CF-Access-Client-Id'] = clientId;
    headers['CF-Access-Client-Secret'] = clientSecret;
  }
  
  return headers;
}

export const runPythonTool: Tool = {
  name: 'run_python',
  description: 'Executes Python code in a secure sandboxed environment using supakiln. Can install packages and run complex Python scripts with full output capture. IMPORTANT: Use print() statements to see output - return values are not visible. Always provide the actual Python code as a string in the code parameter.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute. Must be provided as a non-empty string containing valid Python code. Use print() statements to see output - return values are not captured. Example: "print(\'Hello, World!\')\nx = 1 + 1\nprint(f\'Result: {x}\')"',
        minLength: 1
      },
      packages: {
        type: 'array',
        items: {
          type: 'string'
        },
        description: 'List of Python packages to install before executing the code (e.g., ["pandas", "numpy", "matplotlib"]). Ignored if container_id is provided.',
        default: []
      },
      container_id: {
        type: 'string',
        description: 'Optional: ID of an existing container to run the code in. If provided, the code will execute in this container instead of creating a new one.'
      },
      timeout: {
        type: 'integer',
        description: 'Execution timeout in seconds (default: 30)',
        default: 30,
        minimum: 1,
        maximum: 300
      }
    },
    required: ['code']
  },
  execute: async (params: { code: string; packages?: string[]; container_id?: string; timeout?: number }) => {
    try {
      // Handle case where params might be undefined or malformed
      if (!params || typeof params !== 'object') {
        return {
          success: false,
          error: 'Invalid parameters',
          message: 'Tool parameters must be provided as an object. Received: ' + typeof params
        };
      }

      const { code, packages = [], container_id, timeout = 30 } = params;
      
      // Get supakiln API URL from environment variables
      const supakilnUrl = process.env.SUPAKILN_API_URL;
      if (!supakilnUrl) {
        return {
          success: false,
          error: 'Supakiln API URL not configured',
          message: 'SUPAKILN_API_URL environment variable is not set. Please configure it to use Python code execution.'
        };
      }

      // Debug logging to understand what's being passed
      console.log('run_python tool called with params:', {
        code: code ? `"${code.substring(0, 100)}${code.length > 100 ? '...' : ''}"` : code,
        packages: packages,
        container_id: container_id,
        timeout: timeout
      });

      // Validate inputs
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return {
          success: false,
          error: 'Empty or invalid code provided',
          message: 'The code parameter must be a non-empty string containing valid Python code. Received: ' + (typeof code) + (code ? ` with length ${code.length}` : '')
        };
      }

      // Prepare the execution request
      const executionData: any = {
        code: code.trim(),
        timeout: Math.min(Math.max(timeout, 1), 300) // Clamp between 1 and 300 seconds
      };

      // Add container_id if provided, otherwise add packages
      if (container_id) {
        executionData.container_id = container_id;
        console.log(`Executing Python code with supakiln at ${supakilnUrl} using container: ${container_id}`);
      } else {
        executionData.packages = packages || [];
        console.log(`Executing Python code with supakiln at ${supakilnUrl}`);
        console.log(`Packages to install: ${packages?.join(', ') || 'none'}`);
      }
      
      console.log(`Timeout: ${timeout} seconds`);

      // Prepare headers with Cloudflare authentication
      const headers = {
        'Content-Type': 'application/json',
        ...createCloudflareHeaders()
      };

      // Make the API request to supakiln
      const response = await axios.post(`${supakilnUrl}/execute`, executionData, {
        timeout: (timeout + 10) * 1000, // Add buffer to HTTP timeout
        headers
      });

      // Parse the response
      const result = response.data;
      
      return {
        success: true,
        output: result.output || result.stdout || '',
        error: result.error || result.stderr || null,
        execution_time: result.execution_time || null,
        container_id: result.container_id || container_id || null,
        status: result.status || 'completed',
        packages_installed: container_id ? null : packages, // Only show packages if we created a new container
        code_executed: code,
        used_existing_container: !!container_id
      };

    } catch (error) {
      console.error('Error executing Python code with supakiln:', error);
      
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
          return {
            success: false,
            error: 'Connection refused',
            message: 'Could not connect to supakiln service. Please check if the service is running and the URL is correct.'
          };
        }
        
        if (error.response) {
          // Server responded with error status
          return {
            success: false,
            error: `HTTP ${error.response.status}: ${error.response.statusText}`,
            message: error.response.data?.detail || error.response.data?.error || 'Unknown server error',
            status_code: error.response.status
          };
        }
        
        if (error.request) {
          // Request timeout or network error
          return {
            success: false,
            error: 'Network error',
            message: 'Request to supakiln service timed out or failed. Please check your network connection.'
          };
        }
      }
      
      return {
        success: false,
        error: 'Execution failed',
        message: error instanceof Error ? error.message : 'Unknown error occurred during Python code execution'
      };
    }
  }
}; 