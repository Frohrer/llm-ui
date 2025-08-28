import { z } from 'zod';

/**
 * MCP Server Configuration Schema
 * Based on the official MCP configuration format
 */
export const McpServerConfigSchema = z.object({
  command: z.string().describe('The command to run the MCP server'),
  args: z.array(z.string()).optional().describe('Arguments to pass to the command'),
  env: z.record(z.string()).optional().describe('Environment variables for the server process'),
  disabled: z.boolean().optional().default(false).describe('Whether the server is disabled'),
  autoApprove: z.array(z.string()).optional().describe('List of tool names to auto-approve without prompting'),
  transport: z.enum(['stdio', 'sse', 'streamableHttp']).optional().default('stdio').describe('Transport protocol to use'),
  workingDir: z.string().optional().describe('Working directory for the server process'),
  timeout: z.number().optional().default(30000).describe('Connection timeout in milliseconds'),
  retryAttempts: z.number().optional().default(3).describe('Number of retry attempts on connection failure'),
  description: z.string().optional().describe('Human-readable description of the server'),
  requiresOAuth: z.boolean().optional().default(false).describe('Whether this server requires OAuth authentication'),
  oauthService: z.string().optional().describe('The OAuth service name (e.g., github, notion, linear)'),
});

export const McpConfigSchema = z.object({
  mcpServers: z.record(McpServerConfigSchema).describe('Map of server names to their configurations'),
  globalSettings: z.object({
    timeout: z.number().optional().default(30000),
    retryAttempts: z.number().optional().default(3),
    autoApproveAll: z.boolean().optional().default(false),
    enableLogging: z.boolean().optional().default(true),
  }).optional().default({}),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;
export type McpConfig = z.infer<typeof McpConfigSchema>;

/**
 * MCP Tool Information
 */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: any;
  serverName: string;
}

/**
 * MCP Resource Information
 */
export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  serverName: string;
}

/**
 * MCP Prompt Information
 */
export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  serverName: string;
}

/**
 * MCP Server Status
 */
export interface McpServerStatus {
  name: string;
  connected: boolean;
  lastConnected?: Date;
  lastError?: string;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  serverInfo?: {
    name: string;
    version: string;
  };
}

/**
 * Default MCP configuration with some popular servers
 */
export const DEFAULT_MCP_CONFIG: McpConfig = {
  mcpServers: {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', './'],
      description: 'File system operations server',
      transport: 'stdio',
      autoApprove: ['read_file', 'list_directory'],
    },
    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      description: 'Memory/note-taking server',
      transport: 'stdio',
      disabled: true, // Disabled by default
    },
    brave_search: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      description: 'Brave search integration',
      transport: 'stdio',
      disabled: true, // Requires API key
      env: {
        BRAVE_API_KEY: '',
      },
    },
    sqlite: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
      description: 'SQLite database operations',
      transport: 'stdio',
      disabled: true, // Disabled by default
    },
  },
  globalSettings: {
    timeout: 30000,
    retryAttempts: 3,
    autoApproveAll: false,
    enableLogging: true,
  },
};
