import express, { Request, Response } from 'express';
import { db } from '@db';
import { oauthTokens } from '@db/schema';
import { eq, and } from 'drizzle-orm';

const router = express.Router();

// OAuth service configurations
const OAUTH_CONFIGS = {
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    redirectUri: process.env.GITHUB_REDIRECT_URI || `${process.env.BASE_URL}/api/oauth/github/callback`,
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user',
  },
  notion: {
    clientId: process.env.NOTION_CLIENT_ID,
    clientSecret: process.env.NOTION_CLIENT_SECRET,
    redirectUri: process.env.NOTION_REDIRECT_URI || `${process.env.BASE_URL}/api/oauth/notion/callback`,
    authUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scope: 'read_content read_database',
  },
  linear: {
    clientId: process.env.LINEAR_CLIENT_ID,
    clientSecret: process.env.LINEAR_CLIENT_SECRET,
    redirectUri: process.env.LINEAR_REDIRECT_URI || `${process.env.BASE_URL}/api/oauth/linear/callback`,
    authUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scope: 'read write',
  },
  // Add more services as needed
};

// Store OAuth states temporarily (in production, use Redis or similar)
const oauthStates = new Map<string, { service: string; userId: number; timestamp: number }>();

// Clean up expired states (older than 10 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [state, data] of oauthStates.entries()) {
    if (now - data.timestamp > 10 * 60 * 1000) {
      oauthStates.delete(state);
    }
  }
}, 5 * 60 * 1000); // Clean every 5 minutes

/**
 * Generate a random state parameter for OAuth security
 */
function generateState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Initiate OAuth flow for a service
 */
router.get('/authorize/:service', async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const config = OAUTH_CONFIGS[service as keyof typeof OAUTH_CONFIGS];
    if (!config) {
      return res.status(400).json({ 
        error: `OAuth service '${service}' not supported`,
        availableServices: Object.keys(OAUTH_CONFIGS)
      });
    }
    
    if (!config.clientId) {
      // In development mode, provide a mock OAuth flow
      if (process.env.NODE_ENV === 'development') {
        console.log(`Mock OAuth flow for ${service} (development mode)`);
        
        // Create a mock authorization URL that redirects to our callback with a mock code
        const mockAuthUrl = `${req.protocol}://${req.get('host')}/api/oauth/${service}/callback?code=mock_code_${service}&state=mock_state`;
        
        // For development, we can immediately create a mock token
        setTimeout(async () => {
          try {
            await db
              .insert(oauthTokens)
              .values({
                user_id: userId,
                service_name: service,
                access_token: `mock_token_${service}_${Date.now()}`,
                refresh_token: null,
                token_type: 'Bearer',
                expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
                scope: config.scope,
              })
              .onConflictDoUpdate({
                target: [oauthTokens.user_id, oauthTokens.service_name],
                set: {
                  access_token: `mock_token_${service}_${Date.now()}`,
                  updated_at: new Date(),
                },
              });
            console.log(`Mock OAuth token created for ${service}`);
          } catch (error) {
            console.error('Error creating mock OAuth token:', error);
          }
        }, 1000); // Small delay to simulate OAuth flow
        
        // Create a proper development OAuth success URL
        const devAuthUrl = `${req.protocol}://${req.get('host')}/api/oauth/dev-success/${service}`;
        
        return res.json({ authUrl: devAuthUrl });
      }
      
      // In production, return error instead of attempting OAuth flow
      const envVarName = `${service.toUpperCase()}_CLIENT_ID`;
      return res.status(400).json({ 
        error: `OAuth not configured for ${service}`,
        details: `Missing environment variable: ${envVarName}`,
        setup: `To enable ${service} OAuth, set these environment variables:`,
        required: [
          `${service.toUpperCase()}_CLIENT_ID`,
          `${service.toUpperCase()}_CLIENT_SECRET`,
          `BASE_URL (for redirect URI)`
        ]
      });
    }

    // Generate and store state
    const state = generateState();
    oauthStates.set(state, { service, userId, timestamp: Date.now() });

    // Build authorization URL
    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set('client_id', config.clientId);
    authUrl.searchParams.set('redirect_uri', config.redirectUri);
    authUrl.searchParams.set('scope', config.scope);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('response_type', 'code');

    // Add service-specific parameters
    if (service === 'notion') {
      authUrl.searchParams.set('owner', 'user');
    }

    res.json({ authUrl: authUrl.toString() });
  } catch (error) {
    console.error('Error initiating OAuth:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
});

/**
 * Development OAuth success page
 */
router.get('/dev-success/:service', async (req: Request, res: Response) => {
  const { service } = req.params;
  
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Development OAuth - ${service}</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            text-align: center; 
            padding: 50px; 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
          }
          .container { 
            max-width: 500px; 
            background: white; 
            padding: 40px; 
            border-radius: 12px; 
            box-shadow: 0 8px 32px rgba(0,0,0,0.2);
            animation: fadeIn 0.5s ease-in;
          }
          .success { color: #28a745; margin-bottom: 20px; }
          .info { 
            color: #007bff; 
            margin: 20px 0; 
            padding: 20px; 
            background: #e7f1ff; 
            border-radius: 8px; 
            border-left: 4px solid #007bff;
          }
          .countdown {
            font-size: 14px;
            color: #6c757d;
            margin-top: 20px;
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .spinner {
            border: 2px solid #f3f3f3;
            border-top: 2px solid #007bff;
            border-radius: 50%;
            width: 20px;
            height: 20px;
            animation: spin 1s linear infinite;
            display: inline-block;
            margin-right: 10px;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="success">
            <h2>✅ Development OAuth Success</h2>
            <h3>${service.charAt(0).toUpperCase() + service.slice(1)} Connected!</h3>
          </div>
          <div class="info">
            <p><strong>🔧 Development Mode</strong></p>
            <p>Mock OAuth token created successfully for testing.</p>
            <p>In production, this would be a real ${service} OAuth flow.</p>
          </div>
          <p><span class="spinner"></span>Notifying parent window...</p>
          <div class="countdown">
            Window will close automatically in <span id="countdown">3</span> seconds
          </div>
        </div>
        <script>
          // Notify parent window immediately
          if (window.opener) {
            window.opener.postMessage({ 
              type: 'oauth_success', 
              service: '${service}' 
            }, '*');
          }
          
          // Countdown and auto-close
          let count = 3;
          const countdownEl = document.getElementById('countdown');
          const interval = setInterval(() => {
            count--;
            if (countdownEl) countdownEl.textContent = count;
            if (count <= 0) {
              clearInterval(interval);
              window.close();
            }
          }, 1000);
          
          // Also try to close on click
          document.addEventListener('click', () => {
            window.close();
          });
        </script>
      </body>
    </html>
  `);
});

/**
 * Handle OAuth callback
 */
router.get('/:service/callback', async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const { code, state, error } = req.query;

    if (error) {
      return res.status(400).json({ error: `OAuth error: ${error}` });
    }

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state parameter' });
    }

    // Verify state
    const stateData = oauthStates.get(state as string);
    if (!stateData || stateData.service !== service) {
      return res.status(400).json({ error: 'Invalid or expired state parameter' });
    }

    // Clean up state
    oauthStates.delete(state as string);

    const config = OAUTH_CONFIGS[service as keyof typeof OAUTH_CONFIGS];
    if (!config) {
      return res.status(400).json({ error: `OAuth not configured for service: ${service}` });
    }

    // Exchange code for token
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: config.clientId!,
        client_secret: config.clientSecret!,
        code: code as string,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Token exchange failed: ${tokenResponse.statusText}`);
    }

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      throw new Error(`Token error: ${tokenData.error_description || tokenData.error}`);
    }

    // Store token in database
    await db
      .insert(oauthTokens)
      .values({
        user_id: stateData.userId,
        service_name: service,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || null,
        token_type: tokenData.token_type || 'Bearer',
        expires_at: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
        scope: tokenData.scope || config.scope,
      })
      .onConflictDoUpdate({
        target: [oauthTokens.user_id, oauthTokens.service_name],
        set: {
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_type: tokenData.token_type || 'Bearer',
          expires_at: tokenData.expires_in ? new Date(Date.now() + tokenData.expires_in * 1000) : null,
          scope: tokenData.scope || config.scope,
          updated_at: new Date(),
        },
      });

    // Redirect to success page or close popup
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
            <h2>✅ Successfully connected to ${service}!</h2>
            <p>You can now close this window and return to the application.</p>
          </div>
          <script>
            // Try to close the popup window
            if (window.opener) {
              window.opener.postMessage({ type: 'oauth_success', service: '${service}' }, '*');
              window.close();
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
            <p>Failed to connect to ${req.params.service}. Please try again.</p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * Get user's OAuth tokens for connected services
 */
router.get('/tokens', async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const tokens = await db
      .select({
        service_name: oauthTokens.service_name,
        expires_at: oauthTokens.expires_at,
        scope: oauthTokens.scope,
        created_at: oauthTokens.created_at,
        updated_at: oauthTokens.updated_at,
      })
      .from(oauthTokens)
      .where(eq(oauthTokens.user_id, userId));

    res.json({ tokens });
  } catch (error) {
    console.error('Error fetching OAuth tokens:', error);
    res.status(500).json({ error: 'Failed to fetch OAuth tokens' });
  }
});

/**
 * Revoke OAuth token for a service
 */
router.delete('/tokens/:service', async (req: Request, res: Response) => {
  try {
    const { service } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    await db
      .delete(oauthTokens)
      .where(and(
        eq(oauthTokens.user_id, userId),
        eq(oauthTokens.service_name, service)
      ));

    res.json({ success: true, message: `OAuth token for ${service} revoked` });
  } catch (error) {
    console.error('Error revoking OAuth token:', error);
    res.status(500).json({ error: 'Failed to revoke OAuth token' });
  }
});

/**
 * Get OAuth token for internal use (called by MCP client manager)
 */
export async function getOAuthToken(userId: number, serviceName: string): Promise<string | null> {
  try {
    const [token] = await db
      .select()
      .from(oauthTokens)
      .where(and(
        eq(oauthTokens.user_id, userId),
        eq(oauthTokens.service_name, serviceName)
      ))
      .limit(1);

    if (!token) {
      return null;
    }

    // Check if token is expired
    if (token.expires_at && token.expires_at < new Date()) {
      // TODO: Implement token refresh logic here
      console.warn(`OAuth token for ${serviceName} is expired`);
      return null;
    }

    return token.access_token;
  } catch (error) {
    console.error('Error getting OAuth token:', error);
    return null;
  }
}

export default router;
