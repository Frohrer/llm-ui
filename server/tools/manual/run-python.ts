import axios from 'axios';
import type { Tool } from './types';

const SUPPORTED_LANGUAGES = ['python', 'node', 'ruby', 'bash', 'go'] as const;
type Language = typeof SUPPORTED_LANGUAGES[number];

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

interface ExecuteParams {
  code: string;
  language?: Language;
  packages?: string[];
  container_id?: string;
  timeout?: number;
}

interface ExecuteResult {
  success: boolean;
  output?: string | null;
  error?: string | null;
  outputTruncated?: boolean;
  execution_time?: number | null;
  container_id?: string | null;
  status?: string;
  timed_out?: boolean;
  timings_ms?: Record<string, number> | null;
  web_service?: { type?: string; external_port?: number; proxy_url?: string } | null;
  language?: Language;
  used_existing_container?: boolean;
  message?: string;
  status_code?: number;
}

async function executeCode(params: ExecuteParams): Promise<ExecuteResult> {
  if (!params || typeof params !== 'object') {
    return {
      success: false,
      error: 'Invalid parameters',
      message: 'Tool parameters must be provided as an object. Received: ' + typeof params,
    };
  }

  const { code, language = 'python', packages = [], container_id, timeout = 30 } = params;

  const supakilnUrl = process.env.SUPAKILN_API_URL;
  if (!supakilnUrl) {
    return {
      success: false,
      error: 'Supakiln API URL not configured',
      message: 'SUPAKILN_API_URL environment variable is not set.',
    };
  }

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return {
      success: false,
      error: 'Empty or invalid code provided',
      message: `The code parameter must be a non-empty string. Received: ${typeof code}${code ? ` with length ${code.length}` : ''}`,
    };
  }

  if (!SUPPORTED_LANGUAGES.includes(language as Language)) {
    return {
      success: false,
      error: 'Unsupported language',
      message: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}. Received: ${language}`,
    };
  }

  const clampedTimeout = Math.min(Math.max(timeout, 1), 300);
  const executionData: Record<string, any> = {
    code: code.trim(),
    language,
    timeout: clampedTimeout,
  };
  if (container_id) {
    executionData.container_id = container_id;
  } else if (language !== 'bash' && language !== 'go') {
    executionData.packages = packages || [];
  }

  console.log(`[supakiln] execute language=${language} packages=${(packages || []).join(',') || 'none'} timeout=${clampedTimeout}s${container_id ? ` container=${container_id}` : ''}`);

  try {
    const response = await axios.post(`${supakilnUrl}/execute`, executionData, {
      timeout: (clampedTimeout + 10) * 1000,
      headers: { 'Content-Type': 'application/json', ...createCloudflareHeaders() },
    });
    const result = response.data || {};

    const MAX_OUTPUT_LENGTH = 4000;
    let output: string | null = result.output ?? result.stdout ?? null;
    let outputTruncated = false;
    if (typeof output === 'string' && output.length > MAX_OUTPUT_LENGTH) {
      output = output.substring(0, MAX_OUTPUT_LENGTH) + '\n\n[Output truncated - showing first 4000 characters]';
      outputTruncated = true;
    }

    let errorOutput: string | null = result.error ?? result.stderr ?? null;
    if (typeof errorOutput === 'string' && errorOutput.length > MAX_OUTPUT_LENGTH) {
      errorOutput = errorOutput.substring(0, MAX_OUTPUT_LENGTH) + '\n\n[Error output truncated]';
    }

    const success = typeof result.success === 'boolean'
      ? result.success
      : !errorOutput && !result.timed_out;

    return {
      success,
      output,
      error: errorOutput,
      outputTruncated,
      execution_time: result.execution_time ?? null,
      container_id: result.container_id ?? container_id ?? null,
      status: result.status || (success ? 'completed' : 'failed'),
      timed_out: result.timed_out ?? false,
      timings_ms: result.timings_ms ?? null,
      web_service: result.web_service ?? null,
      language,
      used_existing_container: !!container_id,
    };
  } catch (error) {
    console.error('[supakiln] execute failed:', error);
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNREFUSED') {
        return {
          success: false,
          error: 'Connection refused',
          message: 'Could not connect to supakiln service. Check the URL and that the service is running.',
        };
      }
      if (error.response) {
        return {
          success: false,
          error: `HTTP ${error.response.status}: ${error.response.statusText}`,
          message: error.response.data?.detail || error.response.data?.error || 'Unknown server error',
          status_code: error.response.status,
        };
      }
      if (error.request) {
        return {
          success: false,
          error: 'Network error',
          message: 'Request to supakiln timed out or failed.',
        };
      }
    }
    return {
      success: false,
      error: 'Execution failed',
      message: error instanceof Error ? error.message : 'Unknown error during code execution',
    };
  }
}

export const runPythonTool: Tool = {
  name: 'run_python',
  description: 'Executes Python code in a secure sandboxed container via supakiln. Use print() to see output - return values are not visible. For other languages (node/ruby/bash/go), use run_code instead.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The Python code to execute. Must be a non-empty string. Use print() to see output.',
        minLength: 1,
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'pip packages to install before running (e.g. ["pandas", "numpy"]). Ignored if container_id is set.',
        default: [],
      },
      container_id: {
        type: 'string',
        description: 'Optional: ID of an existing legacy named container. Bypasses the worker cache.',
      },
      timeout: {
        type: 'integer',
        description: 'Execution timeout in seconds (1-300, default 30).',
        default: 30,
        minimum: 1,
        maximum: 300,
      },
    },
    required: ['code'],
  },
  execute: async (params: Omit<ExecuteParams, 'language'>) => executeCode({ ...params, language: 'python' }),
};

export const runCodeTool: Tool = {
  name: 'run_code',
  description: 'Executes code in a secure sandboxed container via supakiln. Supports python, node (Node.js 20 with global fetch), ruby, bash (curl/jq preinstalled), and go (stdlib only). For Python web apps (Streamlit/FastAPI/Flask/Dash/Gradio), the response includes a web_service.proxy_url. Use print/console.log/puts/echo/fmt.Println to see output.',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'Source code to execute. Must be non-empty.',
        minLength: 1,
      },
      language: {
        type: 'string',
        enum: [...SUPPORTED_LANGUAGES],
        description: 'Runtime to use. Default: python.',
        default: 'python',
      },
      packages: {
        type: 'array',
        items: { type: 'string' },
        description: 'Package specifiers for the runtime\'s package manager (pip / npm / gem). Ignored for bash and go.',
        default: [],
      },
      container_id: {
        type: 'string',
        description: 'Optional: ID of an existing legacy named container. Bypasses the worker cache.',
      },
      timeout: {
        type: 'integer',
        description: 'Execution timeout in seconds (1-300, default 30).',
        default: 30,
        minimum: 1,
        maximum: 300,
      },
    },
    required: ['code'],
  },
  execute: executeCode,
};
