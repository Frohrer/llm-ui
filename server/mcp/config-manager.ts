import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { McpConfig, McpConfigSchema, DEFAULT_MCP_CONFIG } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * MCP Configuration Manager
 * Handles loading, saving, and validating MCP configurations
 */
export class McpConfigManager {
  private configPath: string;
  private config: McpConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'mcp-config.json');
  }

  /**
   * Load configuration from file or create default if it doesn't exist
   */
  async loadConfig(): Promise<McpConfig> {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      const parsedConfig = JSON.parse(configData);
      
      // Validate the configuration
      const validatedConfig = McpConfigSchema.parse(parsedConfig);
      this.config = validatedConfig;
      
      console.log(`MCP configuration loaded from ${this.configPath}`);
      return validatedConfig;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        // File doesn't exist, create default configuration
        console.log('MCP configuration file not found, creating default configuration');
        await this.saveConfig(DEFAULT_MCP_CONFIG);
        this.config = DEFAULT_MCP_CONFIG;
        return DEFAULT_MCP_CONFIG;
      } else {
        console.error('Error loading MCP configuration:', error);
        // If there's an error parsing, fall back to default config
        console.log('Using default MCP configuration due to error');
        this.config = DEFAULT_MCP_CONFIG;
        return DEFAULT_MCP_CONFIG;
      }
    }
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config: McpConfig): Promise<void> {
    try {
      // Validate the configuration before saving
      const validatedConfig = McpConfigSchema.parse(config);
      
      // Ensure the directory exists
      const configDir = path.dirname(this.configPath);
      await fs.mkdir(configDir, { recursive: true });
      
      // Save the configuration
      await fs.writeFile(this.configPath, JSON.stringify(validatedConfig, null, 2), 'utf-8');
      this.config = validatedConfig;
      
      console.log(`MCP configuration saved to ${this.configPath}`);
    } catch (error) {
      console.error('Error saving MCP configuration:', error);
      throw error;
    }
  }

  /**
   * Get current configuration
   */
  async getConfig(): Promise<McpConfig> {
    if (!this.config) {
      return await this.loadConfig();
    }
    return this.config;
  }

  /**
   * Update a specific server configuration
   */
  async updateServerConfig(serverName: string, serverConfig: Partial<McpConfig['mcpServers'][string]>): Promise<void> {
    const config = await this.getConfig();
    
    if (!config.mcpServers[serverName]) {
      throw new Error(`MCP server '${serverName}' not found`);
    }
    
    config.mcpServers[serverName] = {
      ...config.mcpServers[serverName],
      ...serverConfig,
    };
    
    await this.saveConfig(config);
  }

  /**
   * Add a new server configuration
   */
  async addServerConfig(serverName: string, serverConfig: McpConfig['mcpServers'][string]): Promise<void> {
    const config = await this.getConfig();
    config.mcpServers[serverName] = serverConfig;
    await this.saveConfig(config);
  }

  /**
   * Remove a server configuration
   */
  async removeServerConfig(serverName: string): Promise<void> {
    const config = await this.getConfig();
    delete config.mcpServers[serverName];
    await this.saveConfig(config);
  }

  /**
   * Enable/disable a server
   */
  async setServerEnabled(serverName: string, enabled: boolean): Promise<void> {
    const config = await this.getConfig();
    
    if (!config.mcpServers[serverName]) {
      throw new Error(`MCP server '${serverName}' not found`);
    }
    
    config.mcpServers[serverName].disabled = !enabled;
    await this.saveConfig(config);
  }

  /**
   * Get enabled servers only
   */
  async getEnabledServers(): Promise<Record<string, McpConfig['mcpServers'][string]>> {
    const config = await this.getConfig();
    const enabledServers: Record<string, McpConfig['mcpServers'][string]> = {};
    
    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (!serverConfig.disabled) {
        enabledServers[name] = serverConfig;
      }
    }
    
    return enabledServers;
  }

  /**
   * Validate a configuration object without saving
   */
  validateConfig(config: unknown): McpConfig {
    return McpConfigSchema.parse(config);
  }

  /**
   * Get the configuration file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Reset to default configuration
   */
  async resetToDefault(): Promise<void> {
    await this.saveConfig(DEFAULT_MCP_CONFIG);
  }

  /**
   * Export configuration for backup
   */
  async exportConfig(): Promise<string> {
    const config = await this.getConfig();
    return JSON.stringify(config, null, 2);
  }

  /**
   * Import configuration from backup
   */
  async importConfig(configString: string): Promise<void> {
    const config = JSON.parse(configString);
    const validatedConfig = this.validateConfig(config);
    await this.saveConfig(validatedConfig);
  }
}

// Singleton instance
export const mcpConfigManager = new McpConfigManager();
