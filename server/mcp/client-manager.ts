import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { spawn, ChildProcess } from 'child_process';
import { McpServerConfig, McpServerStatus, McpTool, McpResource, McpPrompt } from './types.js';
import { mcpConfigManager } from './config-manager.js';

/**
 * MCP Client Manager
 * Manages connections to MCP servers and handles tool/resource discovery
 */
export class McpClientManager {
  private clients: Map<string, Client> = new Map();
  private processes: Map<string, ChildProcess> = new Map();
  private serverStatuses: Map<string, McpServerStatus> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor() {
    // Initialize with empty state
  }

  /**
   * Initialize all enabled MCP servers
   */
  async initialize(): Promise<void> {
    console.log('Initializing MCP Client Manager...');
    
    try {
      const enabledServers = await mcpConfigManager.getEnabledServers();
      
      for (const [serverName, config] of Object.entries(enabledServers)) {
        try {
          await this.connectToServer(serverName, config);
        } catch (error) {
          console.error(`Failed to connect to MCP server '${serverName}':`, error);
          // Continue with other servers even if one fails
        }
      }
      
      console.log(`MCP Client Manager initialized with ${this.clients.size} connected servers`);
    } catch (error) {
      console.error('Error initializing MCP Client Manager:', error);
    }
  }

  /**
   * Connect to a specific MCP server
   */
  async connectToServer(serverName: string, config: McpServerConfig, userId?: number): Promise<void> {
    console.log(`Connecting to MCP server: ${serverName}`);
    
    try {
      // Disconnect existing connection if any
      await this.disconnectFromServer(serverName);

      // Create the transport based on the server configuration
      const transport = await this.createTransport(serverName, config, userId);
      
      // Create the client
      const client = new Client({
        name: 'llm-ui-client',
        version: '1.0.0',
      });

      // Connect to the server
      await client.connect(transport);
      
      // Store the client
      this.clients.set(serverName, client);
      
      // Discover server capabilities
      const serverStatus = await this.discoverServerCapabilities(serverName, client);
      this.serverStatuses.set(serverName, serverStatus);
      
      console.log(`Successfully connected to MCP server '${serverName}' with ${serverStatus.tools.length} tools, ${serverStatus.resources.length} resources, and ${serverStatus.prompts.length} prompts`);
      
    } catch (error) {
      console.error(`Error connecting to MCP server '${serverName}':`, error);
      
      // Update status to reflect the error
      this.serverStatuses.set(serverName, {
        name: serverName,
        connected: false,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        tools: [],
        resources: [],
        prompts: [],
      });
      
      // Schedule a reconnection attempt if enabled
      this.scheduleReconnection(serverName, config);
      
      throw error;
    }
  }

  /**
   * Create transport for the server
   */
  private async createTransport(serverName: string, config: McpServerConfig, userId?: number): Promise<StdioClientTransport | SSEClientTransport> {
    if (config.transport === 'sse') {
      // For SSE transport, assume the first arg is the URL
      const url = config.args && config.args.length > 0 ? config.args[0] : config.command;
      if (!url.startsWith('http')) {
        throw new Error(`SSE transport requires a valid URL, got: ${url}`);
      }
      console.log(`Creating SSE transport for server '${serverName}' with URL: ${url}`);
      
      // Create headers for OAuth if required
      const headers: Record<string, string> = {};
      if (config.requiresOAuth && config.oauthService && userId) {
        const { getOAuthToken } = await import('../routes/oauth.js');
        const token = await getOAuthToken(userId, config.oauthService);
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          throw new Error(`OAuth token not found for service: ${config.oauthService}`);
        }
      }
      
      return new SSEClientTransport(new URL(url), { headers });
    } else if (config.transport === 'streamableHttp') {
      // For streamableHttp, we would use StreamableHTTPClientTransport
      // But for now, fall back to SSE as it's more commonly supported
      console.warn(`StreamableHttp transport not yet fully supported for server '${serverName}', using SSE`);
      const url = config.args && config.args.length > 0 ? config.args[0] : config.command;
      if (!url.startsWith('http')) {
        throw new Error(`HTTP transport requires a valid URL, got: ${url}`);
      }
      
      // Create headers for OAuth if required
      const headers: Record<string, string> = {};
      if (config.requiresOAuth && config.oauthService && userId) {
        const { getOAuthToken } = await import('../routes/oauth.js');
        const token = await getOAuthToken(userId, config.oauthService);
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        } else {
          throw new Error(`OAuth token not found for service: ${config.oauthService}`);
        }
      }
      
      return new SSEClientTransport(new URL(url), { headers });
    } else {
      // Default to stdio transport
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: {
          ...process.env,
          ...config.env,
        },
        cwd: config.workingDir,
      });

      return transport;
    }
  }

  /**
   * Discover server capabilities (tools, resources, prompts)
   */
  private async discoverServerCapabilities(serverName: string, client: Client): Promise<McpServerStatus> {
    const tools: McpTool[] = [];
    const resources: McpResource[] = [];
    const prompts: McpPrompt[] = [];
    let serverInfo: { name: string; version: string } | undefined;

    try {
      // Get server information
      try {
        // Note: This might not be available in all implementations
        // serverInfo = await client.getServerInfo();
      } catch (error) {
        // Server info is optional
      }

      // List tools
      try {
        const toolsList = await client.listTools();
        for (const tool of toolsList.tools) {
          tools.push({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            serverName,
          });
        }
      } catch (error) {
        console.warn(`Error listing tools for server '${serverName}':`, error);
      }

      // List resources
      try {
        const resourcesList = await client.listResources();
        for (const resource of resourcesList.resources) {
          resources.push({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            serverName,
          });
        }
      } catch (error) {
        console.warn(`Error listing resources for server '${serverName}':`, error);
      }

      // List prompts
      try {
        const promptsList = await client.listPrompts();
        for (const prompt of promptsList.prompts) {
          prompts.push({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
            serverName,
          });
        }
      } catch (error) {
        console.warn(`Error listing prompts for server '${serverName}':`, error);
      }

    } catch (error) {
      console.error(`Error discovering capabilities for server '${serverName}':`, error);
    }

    return {
      name: serverName,
      connected: true,
      lastConnected: new Date(),
      tools,
      resources,
      prompts,
      serverInfo,
    };
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnectFromServer(serverName: string): Promise<void> {
    console.log(`Disconnecting from MCP server: ${serverName}`);
    
    // Clear reconnection timer
    const timer = this.reconnectTimers.get(serverName);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(serverName);
    }

    // Close client connection
    const client = this.clients.get(serverName);
    if (client) {
      try {
        await client.close();
      } catch (error) {
        console.warn(`Error closing client for server '${serverName}':`, error);
      }
      this.clients.delete(serverName);
    }

    // Terminate process
    const process = this.processes.get(serverName);
    if (process) {
      try {
        process.kill();
      } catch (error) {
        console.warn(`Error terminating process for server '${serverName}':`, error);
      }
      this.processes.delete(serverName);
    }

    // Update status
    const status = this.serverStatuses.get(serverName);
    if (status) {
      status.connected = false;
      this.serverStatuses.set(serverName, status);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnection(serverName: string, config: McpServerConfig): void {
    const retryDelay = 5000; // 5 seconds
    
    const timer = setTimeout(async () => {
      console.log(`Attempting to reconnect to MCP server: ${serverName}`);
      try {
        await this.connectToServer(serverName, config);
      } catch (error) {
        console.error(`Reconnection failed for server '${serverName}':`, error);
        // Schedule another reconnection attempt
        this.scheduleReconnection(serverName, config);
      }
    }, retryDelay);
    
    this.reconnectTimers.set(serverName, timer);
  }

  /**
   * Get all connected clients
   */
  getClients(): Map<string, Client> {
    return new Map(this.clients);
  }

  /**
   * Get a specific client
   */
  getClient(serverName: string): Client | undefined {
    return this.clients.get(serverName);
  }

  /**
   * Get all server statuses
   */
  getServerStatuses(): Map<string, McpServerStatus> {
    return new Map(this.serverStatuses);
  }

  /**
   * Get a specific server status
   */
  getServerStatus(serverName: string): McpServerStatus | undefined {
    return this.serverStatuses.get(serverName);
  }

  /**
   * Get all available tools from all connected servers
   */
  getAllTools(): McpTool[] {
    const allTools: McpTool[] = [];
    
    for (const status of this.serverStatuses.values()) {
      if (status.connected) {
        allTools.push(...status.tools);
      }
    }
    
    return allTools;
  }

  /**
   * Get all available resources from all connected servers
   */
  getAllResources(): McpResource[] {
    const allResources: McpResource[] = [];
    
    for (const status of this.serverStatuses.values()) {
      if (status.connected) {
        allResources.push(...status.resources);
      }
    }
    
    return allResources;
  }

  /**
   * Get all available prompts from all connected servers
   */
  getAllPrompts(): McpPrompt[] {
    const allPrompts: McpPrompt[] = [];
    
    for (const status of this.serverStatuses.values()) {
      if (status.connected) {
        allPrompts.push(...status.prompts);
      }
    }
    
    return allPrompts;
  }

  /**
   * Call a tool on a specific server
   */
  async callTool(serverName: string, toolName: string, arguments_: any): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    try {
      const result = await client.callTool({
        name: toolName,
        arguments: arguments_,
      });
      
      return result;
    } catch (error) {
      console.error(`Error calling tool '${toolName}' on server '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Read a resource from a specific server
   */
  async readResource(serverName: string, uri: string): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    try {
      const result = await client.readResource({ uri });
      return result;
    } catch (error) {
      console.error(`Error reading resource '${uri}' from server '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Get a prompt from a specific server
   */
  async getPrompt(serverName: string, promptName: string, arguments_?: any): Promise<any> {
    const client = this.clients.get(serverName);
    if (!client) {
      throw new Error(`MCP server '${serverName}' is not connected`);
    }

    try {
      const result = await client.getPrompt({
        name: promptName,
        arguments: arguments_,
      });
      
      return result;
    } catch (error) {
      console.error(`Error getting prompt '${promptName}' from server '${serverName}':`, error);
      throw error;
    }
  }

  /**
   * Reload configuration and reconnect servers
   */
  async reloadConfiguration(): Promise<void> {
    console.log('Reloading MCP configuration...');
    
    // Disconnect all current connections
    const currentServers = Array.from(this.clients.keys());
    for (const serverName of currentServers) {
      await this.disconnectFromServer(serverName);
    }
    
    // Reinitialize with new configuration
    await this.initialize();
  }

  /**
   * Shutdown all connections
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down MCP Client Manager...');
    
    const serverNames = Array.from(this.clients.keys());
    for (const serverName of serverNames) {
      await this.disconnectFromServer(serverName);
    }
    
    console.log('MCP Client Manager shutdown complete');
  }
}

// Singleton instance
export const mcpClientManager = new McpClientManager();
