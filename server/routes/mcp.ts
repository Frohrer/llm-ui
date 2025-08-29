import express from 'express';
import { z } from 'zod';
import { 
  mcpConfigManager, 
  mcpClientManager, 
  mcpToolsBridge,
  McpServerConfigSchema 
} from '../mcp/index.js';
import { refreshTools, getToolStatistics } from '../tools/index.js';

const router = express.Router();

/**
 * Get MCP configuration
 */
router.get('/config', async (req, res) => {
  try {
    const config = await mcpConfigManager.getConfig();
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    console.error('Error getting MCP config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Update MCP configuration
 */
router.put('/config', async (req, res) => {
  try {
    const config = mcpConfigManager.validateConfig(req.body);
    await mcpConfigManager.saveConfig(config);
    
    // Reload MCP connections with new configuration
    await mcpClientManager.reloadConfiguration();
    
    // Refresh tools cache to include new MCP tools
    await refreshTools();
    
    res.json({
      success: true,
      message: 'MCP configuration updated successfully',
    });
  } catch (error) {
    console.error('Error updating MCP config:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid configuration',
    });
  }
});

/**
 * Get server statuses
 */
router.get('/servers/status', async (req, res) => {
  try {
    const statuses = mcpClientManager.getServerStatuses();
    const statusArray = Array.from(statuses.values());
    
    res.json({
      success: true,
      data: statusArray,
    });
  } catch (error) {
    console.error('Error getting server statuses:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Add a new MCP server
 */
router.post('/servers', async (req, res) => {
  try {
    const { name, config } = req.body;
    
    if (!name || typeof name !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Server name is required',
      });
    }
    
    const validatedConfig = McpServerConfigSchema.parse(config);
    
    await mcpConfigManager.addServerConfig(name, validatedConfig);
    
    // Try to connect to the new server
    try {
      await mcpClientManager.connectToServer(name, validatedConfig);
      await refreshTools();
    } catch (connectionError) {
      console.warn(`Could not connect to new server '${name}':`, connectionError);
      // Continue anyway - the server is added to config but not connected
    }
    
    res.json({
      success: true,
      message: `MCP server '${name}' added successfully`,
    });
  } catch (error) {
    console.error('Error adding MCP server:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid server configuration',
    });
  }
});

/**
 * Update an existing MCP server
 */
router.put('/servers/:name', async (req, res) => {
  try {
    const serverName = req.params.name;
    const validatedConfig = McpServerConfigSchema.partial().parse(req.body);
    
    await mcpConfigManager.updateServerConfig(serverName, validatedConfig);
    
    // Reconnect to the server with updated configuration
    const fullConfig = await mcpConfigManager.getConfig();
    const serverConfig = fullConfig.mcpServers[serverName];
    
    if (serverConfig && !serverConfig.disabled) {
      try {
        await mcpClientManager.connectToServer(serverName, serverConfig);
        await refreshTools();
      } catch (connectionError) {
        console.warn(`Could not reconnect to server '${serverName}':`, connectionError);
      }
    } else {
      // Disconnect if disabled
      await mcpClientManager.disconnectFromServer(serverName);
      await refreshTools();
    }
    
    res.json({
      success: true,
      message: `MCP server '${serverName}' updated successfully`,
    });
  } catch (error) {
    console.error('Error updating MCP server:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid server configuration',
    });
  }
});

/**
 * Delete an MCP server
 */
router.delete('/servers/:name', async (req, res) => {
  try {
    const serverName = req.params.name;
    
    // Disconnect from the server first
    await mcpClientManager.disconnectFromServer(serverName);
    
    // Remove from configuration
    await mcpConfigManager.removeServerConfig(serverName);
    
    // Refresh tools cache
    await refreshTools();
    
    res.json({
      success: true,
      message: `MCP server '${serverName}' removed successfully`,
    });
  } catch (error) {
    console.error('Error removing MCP server:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Enable/disable an MCP server
 */
router.patch('/servers/:name/toggle', async (req, res) => {
  try {
    const serverName = req.params.name;
    const { enabled } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled field must be a boolean',
      });
    }
    
    await mcpConfigManager.setServerEnabled(serverName, enabled);
    
    const config = await mcpConfigManager.getConfig();
    const serverConfig = config.mcpServers[serverName];
    
    if (enabled && serverConfig) {
      // Connect to the server
      try {
        await mcpClientManager.connectToServer(serverName, serverConfig);
      } catch (connectionError) {
        console.warn(`Could not connect to server '${serverName}':`, connectionError);
      }
    } else {
      // Disconnect from the server
      await mcpClientManager.disconnectFromServer(serverName);
    }
    
    await refreshTools();
    
    res.json({
      success: true,
      message: `MCP server '${serverName}' ${enabled ? 'enabled' : 'disabled'} successfully`,
    });
  } catch (error) {
    console.error('Error toggling MCP server:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get MCP tools
 */
router.get('/tools', async (req, res) => {
  try {
    const tools = mcpClientManager.getAllTools();
    
    res.json({
      success: true,
      data: tools,
    });
  } catch (error) {
    console.error('Error getting MCP tools:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get MCP resources
 */
router.get('/resources', async (req, res) => {
  try {
    const resources = mcpClientManager.getAllResources();
    
    res.json({
      success: true,
      data: resources,
    });
  } catch (error) {
    console.error('Error getting MCP resources:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get MCP prompts
 */
router.get('/prompts', async (req, res) => {
  try {
    const prompts = mcpClientManager.getAllPrompts();
    
    res.json({
      success: true,
      data: prompts,
    });
  } catch (error) {
    console.error('Error getting MCP prompts:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Call an MCP tool
 */
router.post('/tools/:serverName/:toolName/call', async (req, res) => {
  try {
    const { serverName, toolName } = req.params;
    const { arguments: args } = req.body;
    
    const result = await mcpClientManager.callTool(serverName, toolName, args || {});
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error calling MCP tool:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Read an MCP resource
 */
router.post('/resources/read', async (req, res) => {
  try {
    const { serverName, uri } = req.body;
    
    if (!serverName || !uri) {
      return res.status(400).json({
        success: false,
        error: 'serverName and uri are required',
      });
    }
    
    const result = await mcpClientManager.readResource(serverName, uri);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error reading MCP resource:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get an MCP prompt
 */
router.post('/prompts/:serverName/:promptName', async (req, res) => {
  try {
    const { serverName, promptName } = req.params;
    const { arguments: args } = req.body;
    
    const result = await mcpClientManager.getPrompt(serverName, promptName, args || {});
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error getting MCP prompt:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Get MCP statistics
 */
router.get('/statistics', async (req, res) => {
  try {
    const toolStats = await getToolStatistics();
    const mcpStats = await mcpToolsBridge.getStatistics();
    
    res.json({
      success: true,
      data: {
        tools: toolStats,
        mcp: mcpStats,
      },
    });
  } catch (error) {
    console.error('Error getting MCP statistics:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Refresh MCP connections and tools
 */
router.post('/refresh', async (req, res) => {
  try {
    await mcpClientManager.reloadConfiguration();
    await mcpToolsBridge.forceRefresh();
    await refreshTools();
    
    res.json({
      success: true,
      message: 'MCP system refreshed successfully',
    });
  } catch (error) {
    console.error('Error refreshing MCP system:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Export MCP configuration
 */
router.get('/config/export', async (req, res) => {
  try {
    const configString = await mcpConfigManager.exportConfig();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="mcp-config.json"');
    res.send(configString);
  } catch (error) {
    console.error('Error exporting MCP config:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Import MCP configuration
 */
router.post('/config/import', async (req, res) => {
  try {
    const { config } = req.body;
    
    if (typeof config === 'string') {
      await mcpConfigManager.importConfig(config);
    } else if (typeof config === 'object') {
      await mcpConfigManager.saveConfig(config);
    } else {
      throw new Error('Invalid configuration format');
    }
    
    // Reload MCP connections with new configuration
    await mcpClientManager.reloadConfiguration();
    await refreshTools();
    
    res.json({
      success: true,
      message: 'MCP configuration imported successfully',
    });
  } catch (error) {
    console.error('Error importing MCP config:', error);
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : 'Invalid configuration',
    });
  }
});

/**
 * Get pending OAuth URLs from MCP servers
 */
router.get('/pending-oauth', async (req: Request, res: Response) => {
  try {
    const pendingUrls = mcpClientManager.getPendingOAuthUrls();
    const urlsArray = Array.from(pendingUrls.entries()).map(([serverName, data]) => ({
      serverName,
      ...data
    }));
    
    res.json({ pendingOAuthUrls: urlsArray });
  } catch (error) {
    console.error('Error getting pending OAuth URLs:', error);
    res.status(500).json({ error: 'Failed to get pending OAuth URLs' });
  }
});

/**
 * Start OAuth flow for an MCP server
 */
router.post('/start-oauth', async (req: Request, res: Response) => {
  try {
    const { serverName } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!serverName) {
      return res.status(400).json({ error: 'Missing serverName parameter' });
    }

    // Get the pending OAuth URL for this server
    const pendingUrls = mcpClientManager.getPendingOAuthUrls();
    const pendingAuth = pendingUrls.get(serverName);
    
    if (!pendingAuth) {
      return res.status(404).json({ error: `No pending OAuth authorization for server: ${serverName}` });
    }

    // Start the OAuth flow using our generic OAuth service
    const oauthStartResponse = await fetch(`${req.protocol}://${req.get('host')}/api/oauth/start-flow`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.get('Authorization') || '',
        'Cookie': req.get('Cookie') || '',
      },
      body: JSON.stringify({
        serverName,
        authUrl: pendingAuth.authUrl
      })
    });

    if (!oauthStartResponse.ok) {
      throw new Error('Failed to start OAuth flow');
    }

    const oauthData = await oauthStartResponse.json();
    
    // Clear the pending OAuth URL since we're handling it
    mcpClientManager.clearPendingOAuthUrl(serverName);
    
    res.json(oauthData);
  } catch (error) {
    console.error('Error starting OAuth flow for MCP server:', error);
    res.status(500).json({ error: 'Failed to start OAuth flow' });
  }
});

/**
 * Clear pending OAuth URL for a server
 */
router.delete('/pending-oauth/:serverName', async (req: Request, res: Response) => {
  try {
    const { serverName } = req.params;
    mcpClientManager.clearPendingOAuthUrl(serverName);
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing pending OAuth URL:', error);
    res.status(500).json({ error: 'Failed to clear pending OAuth URL' });
  }
});

export default router;
