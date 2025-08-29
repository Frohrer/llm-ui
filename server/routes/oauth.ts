import express, { Request, Response } from 'express';

const router = express.Router();

// Store OAuth flow information temporarily (in production, use Redis or similar)
const oauthFlows = new Map<string, { 
  serverName: string; 
  userId: number; 
  timestamp: number;
  callbackUrl?: string;
}>();

// Clean up expired OAuth flows (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [flowId, data] of oauthFlows.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      oauthFlows.delete(flowId);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

/**
 * Generate a random flow ID for OAuth security
 */
function generateFlowId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Start an OAuth flow for an MCP server
 */
router.post('/start-flow', async (req: Request, res: Response) => {
  try {
    const { serverName, authUrl } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    if (!serverName || !authUrl) {
      return res.status(400).json({ error: 'Missing serverName or authUrl parameter' });
    }

    // Validate that the URL is from a trusted domain or localhost for development
    const trustedDomains = [
      'mcp.linear.app',
      'linear.app', 
      'api.notion.com',
      'github.com',
      'mcp.github.com',
      'mcp.notion.com',
      'mcp.sentry.io',
      'mcp.neon.tech',
      'mcp.intercom.com',
      'mcp.asana.com',
      'mcp.webflow.com',
      'mcp.wix.com',
      'localhost', // For development
      '127.0.0.1', // For development
    ];

    try {
      const urlObj = new URL(authUrl);
      if (!trustedDomains.some(domain => 
        urlObj.hostname === domain || 
        urlObj.hostname.endsWith('.' + domain) ||
        urlObj.hostname.startsWith('localhost:') ||
        urlObj.hostname.startsWith('127.0.0.1:')
      )) {
        return res.status(400).json({ error: 'Untrusted OAuth domain' });
      }
    } catch (error) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Generate a flow ID and store OAuth flow info
    const flowId = generateFlowId();
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const callbackUrl = `${baseUrl}/api/oauth/callback?flow=${flowId}`;
    
    oauthFlows.set(flowId, { 
      serverName, 
      userId, 
      timestamp: Date.now(),
      callbackUrl 
    });

    // Modify the OAuth URL to include our callback if it doesn't have one
    const modifiedUrl = new URL(authUrl);
    if (!modifiedUrl.searchParams.has('redirect_uri') && !modifiedUrl.searchParams.has('callback')) {
      modifiedUrl.searchParams.set('redirect_uri', callbackUrl);
    }

    res.json({ 
      authUrl: modifiedUrl.toString(),
      flowId,
      callbackUrl,
      instructions: `Please visit the URL to complete OAuth authorization for ${serverName}.`
    });
  } catch (error) {
    console.error('Error starting OAuth flow:', error);
    res.status(500).json({ error: 'Failed to start OAuth flow' });
  }
});

/**
 * Generic OAuth callback that works with any MCP server
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { flow: flowId, code, state, error, ...otherParams } = req.query;

    if (error) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>❌ OAuth Error</h2>
              <p>OAuth authorization failed: ${error}</p>
              <p>Please try again or contact support if the issue persists.</p>
            </div>
            <script>
              // Try to close the popup window
              if (window.opener) {
                window.opener.postMessage({ type: 'oauth_error', error: '${error}' }, '*');
                window.close();
              }
            </script>
          </body>
        </html>
      `);
    }

    if (!flowId) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>❌ OAuth Error</h2>
              <p>Missing flow parameter. Please restart the OAuth process.</p>
            </div>
          </body>
        </html>
      `);
    }

    // Verify flow
    const flowData = oauthFlows.get(flowId as string);
    if (!flowData) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="error">
              <h2>❌ OAuth Error</h2>
              <p>Invalid or expired OAuth flow. Please restart the process.</p>
            </div>
          </body>
        </html>
      `);
    }

    // Clean up flow
    oauthFlows.delete(flowId as string);

    const { serverName } = flowData;

    // Return success page with OAuth data
    // The MCP server will handle the actual token exchange
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Success</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: #28a745; }
          </style>
        </head>
        <body>
          <div class="success">
            <h2>✅ OAuth Authorization Successful!</h2>
            <p>Authorization completed for <strong>${serverName}</strong>.</p>
            <p>You can now close this window and return to the application.</p>
            <p><small>The server will complete the authentication process automatically.</small></p>
          </div>
          <script>
            // Send success message to parent window with OAuth data
            const oauthData = {
              type: 'oauth_success', 
              serverName: '${serverName}',
              code: '${code || ''}',
              state: '${state || ''}',
              ${Object.entries(otherParams).map(([key, value]) => `${key}: '${value}'`).join(', ')}
            };
            
            // Try to close the popup window
            if (window.opener) {
              window.opener.postMessage(oauthData, '*');
              window.close();
            } else if (parent && parent !== window) {
              parent.postMessage(oauthData, '*');
            }
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>OAuth Error</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .error { color: #dc3545; }
          </style>
        </head>
        <body>
          <div class="error">
            <h2>❌ OAuth Error</h2>
            <p>An unexpected error occurred during OAuth processing.</p>
            <p>Please try again or contact support if the issue persists.</p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * Get active OAuth flows (for debugging/admin purposes)
 */
router.get('/flows', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Return user's active flows (without sensitive data)
    const userFlows = Array.from(oauthFlows.entries())
      .filter(([_, data]) => data.userId === userId)
      .map(([flowId, data]) => ({
        flowId,
        serverName: data.serverName,
        timestamp: data.timestamp,
        age: Date.now() - data.timestamp
      }));

    res.json({ flows: userFlows });
  } catch (error) {
    console.error('Error fetching OAuth flows:', error);
    res.status(500).json({ error: 'Failed to fetch OAuth flows' });
  }
});

export default router;
