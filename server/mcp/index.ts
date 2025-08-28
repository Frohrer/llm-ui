// MCP (Model Context Protocol) Integration
// This module provides MCP server connectivity and tool integration

export * from './types.js';
export * from './config-manager.js';
export * from './client-manager.js';
export * from './tools-bridge.js';

// Re-export the singleton instances for easy access
export { mcpConfigManager } from './config-manager.js';
export { mcpClientManager } from './client-manager.js';
export { mcpToolsBridge } from './tools-bridge.js';

/**
 * Initialize the MCP system
 * This should be called once during server startup
 */
export async function initializeMcp(): Promise<void> {
  console.log('Initializing MCP (Model Context Protocol) system...');
  
  try {
    // Initialize the MCP client manager, which will:
    // 1. Load the configuration
    // 2. Connect to enabled MCP servers
    // 3. Discover available tools, resources, and prompts
    const { mcpClientManager } = await import('./client-manager.js');
    await mcpClientManager.initialize();
    
    console.log('MCP system initialized successfully');
  } catch (error) {
    console.error('Error initializing MCP system:', error);
    // Don't throw the error to prevent server startup failure
    // MCP tools will simply not be available
  }
}

/**
 * Shutdown the MCP system
 * This should be called during server shutdown
 */
export async function shutdownMcp(): Promise<void> {
  console.log('Shutting down MCP system...');
  
  try {
    const { mcpClientManager } = await import('./client-manager.js');
    await mcpClientManager.shutdown();
    
    console.log('MCP system shutdown complete');
  } catch (error) {
    console.error('Error shutting down MCP system:', error);
  }
}
