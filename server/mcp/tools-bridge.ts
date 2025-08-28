import { Tool } from '../tools/index.js';
import { mcpClientManager } from './client-manager.js';
import { McpTool } from './types.js';

/**
 * MCP Tools Bridge
 * Converts MCP tools to the local Tool interface format
 */
export class McpToolsBridge {
  private mcpToolsCache: Map<string, Tool> = new Map();
  private lastUpdate: number = 0;
  private cacheTimeout: number = 30000; // 30 seconds

  /**
   * Get all MCP tools converted to local Tool format
   */
  async getMcpTools(): Promise<Record<string, Tool>> {
    const now = Date.now();
    
    // Check if cache is still valid
    if (now - this.lastUpdate < this.cacheTimeout && this.mcpToolsCache.size > 0) {
      return Object.fromEntries(this.mcpToolsCache);
    }
    
    // Refresh cache
    await this.refreshMcpTools();
    return Object.fromEntries(this.mcpToolsCache);
  }

  /**
   * Refresh the MCP tools cache
   */
  private async refreshMcpTools(): Promise<void> {
    try {
      this.mcpToolsCache.clear();
      
      const mcpTools = mcpClientManager.getAllTools();
      
      for (const mcpTool of mcpTools) {
        const localTool = this.convertMcpToolToLocal(mcpTool);
        const toolKey = `${mcpTool.serverName}:${mcpTool.name}`;
        this.mcpToolsCache.set(toolKey, localTool);
      }
      
      this.lastUpdate = Date.now();
      console.log(`Refreshed MCP tools cache with ${this.mcpToolsCache.size} tools`);
    } catch (error) {
      console.error('Error refreshing MCP tools cache:', error);
    }
  }

  /**
   * Convert an MCP tool to local Tool format
   */
  private convertMcpToolToLocal(mcpTool: McpTool): Tool {
    return {
      name: `mcp_${mcpTool.serverName}_${mcpTool.name}`,
      description: mcpTool.description || `MCP tool '${mcpTool.name}' from server '${mcpTool.serverName}'`,
      parameters: this.convertJsonSchemaToParameters(mcpTool.inputSchema),
      execute: async (params: any) => {
        try {
          console.log(`Executing MCP tool '${mcpTool.name}' on server '${mcpTool.serverName}' with params:`, params);
          
          const result = await mcpClientManager.callTool(
            mcpTool.serverName,
            mcpTool.name,
            params
          );
          
          // Format the result consistently
          return {
            success: true,
            data: result,
            toolName: mcpTool.name,
            serverName: mcpTool.serverName,
          };
        } catch (error) {
          console.error(`Error executing MCP tool '${mcpTool.name}':`, error);
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            toolName: mcpTool.name,
            serverName: mcpTool.serverName,
          };
        }
      },
    };
  }

  /**
   * Convert JSON Schema to local parameters format
   * This is a simplified conversion - may need enhancement for complex schemas
   */
  private convertJsonSchemaToParameters(jsonSchema: any): any {
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      return {
        type: 'object',
        properties: {},
        required: [],
      };
    }

    // If it's already in the right format, return as-is
    if (jsonSchema.type && jsonSchema.properties) {
      return jsonSchema;
    }

    // Try to extract properties and required fields
    const properties = jsonSchema.properties || {};
    const required = jsonSchema.required || [];

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: jsonSchema.additionalProperties || false,
    };
  }

  /**
   * Get a specific MCP tool by full name (serverName:toolName)
   */
  async getMcpTool(fullToolName: string): Promise<Tool | undefined> {
    const tools = await this.getMcpTools();
    
    // Try direct lookup first
    if (tools[fullToolName]) {
      return tools[fullToolName];
    }
    
    // Try to find by the local tool name format
    const localToolName = fullToolName.startsWith('mcp_') ? fullToolName : `mcp_${fullToolName}`;
    for (const [key, tool] of Object.entries(tools)) {
      if (tool.name === localToolName) {
        return tool;
      }
    }
    
    return undefined;
  }

  /**
   * Check if a tool name corresponds to an MCP tool
   */
  isMcpTool(toolName: string): boolean {
    return toolName.startsWith('mcp_');
  }

  /**
   * Parse MCP tool name to get server and tool components
   */
  parseMcpToolName(toolName: string): { serverName: string; toolName: string } | null {
    if (!this.isMcpTool(toolName)) {
      return null;
    }
    
    // Remove 'mcp_' prefix
    const nameWithoutPrefix = toolName.substring(4);
    
    // Find the first underscore to split server and tool name
    const firstUnderscoreIndex = nameWithoutPrefix.indexOf('_');
    
    if (firstUnderscoreIndex === -1) {
      return null;
    }
    
    const serverName = nameWithoutPrefix.substring(0, firstUnderscoreIndex);
    const originalToolName = nameWithoutPrefix.substring(firstUnderscoreIndex + 1);
    
    return { serverName, toolName: originalToolName };
  }

  /**
   * Force refresh of MCP tools cache
   */
  async forceRefresh(): Promise<void> {
    await this.refreshMcpTools();
  }

  /**
   * Get MCP tool statistics
   */
  async getStatistics(): Promise<{
    totalMcpTools: number;
    toolsByServer: Record<string, number>;
    connectedServers: number;
    lastUpdate: Date;
  }> {
    const tools = await this.getMcpTools();
    const toolsByServer: Record<string, number> = {};
    
    for (const toolName of Object.keys(tools)) {
      const parsed = this.parseMcpToolName(toolName);
      if (parsed) {
        toolsByServer[parsed.serverName] = (toolsByServer[parsed.serverName] || 0) + 1;
      }
    }
    
    const serverStatuses = mcpClientManager.getServerStatuses();
    const connectedServers = Array.from(serverStatuses.values()).filter(status => status.connected).length;
    
    return {
      totalMcpTools: Object.keys(tools).length,
      toolsByServer,
      connectedServers,
      lastUpdate: new Date(this.lastUpdate),
    };
  }
}

// Singleton instance
export const mcpToolsBridge = new McpToolsBridge();
