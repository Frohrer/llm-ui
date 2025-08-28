# OAuth Setup for MCP Servers

This document explains how to configure OAuth authentication for popular MCP servers.

## Overview

The LLM UI now supports OAuth authentication for remote MCP servers, enabling secure connections to services like GitHub, Notion, Linear, and more. This eliminates the need for API keys and provides a more secure, user-specific authentication flow.

## Supported Services

- **GitHub** - Access repositories, issues, pull requests
- **Notion** - Read and write to workspaces and databases
- **Linear** - Manage projects, issues, and teams
- **Sentry** - Monitor errors and performance
- **Neon** - Manage PostgreSQL databases
- **Intercom** - Customer support integration
- **Asana** - Project management
- **Webflow** - Website management
- **Wix** - Website building

## Environment Variables

Add these environment variables to your `.env` file:

```bash
# Base URL for OAuth redirects (required)
BASE_URL=https://your-domain.com

# GitHub OAuth App
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GITHUB_REDIRECT_URI=https://your-domain.com/api/oauth/github/callback

# Notion OAuth App
NOTION_CLIENT_ID=your_notion_client_id
NOTION_CLIENT_SECRET=your_notion_client_secret
NOTION_REDIRECT_URI=https://your-domain.com/api/oauth/notion/callback

# Linear OAuth App
LINEAR_CLIENT_ID=your_linear_client_id
LINEAR_CLIENT_SECRET=your_linear_client_secret
LINEAR_REDIRECT_URI=https://your-domain.com/api/oauth/linear/callback
```

## OAuth App Setup

### GitHub

1. Go to GitHub Settings > Developer settings > OAuth Apps
2. Click "New OAuth App"
3. Fill in:
   - **Application name**: LLM UI MCP Client
   - **Homepage URL**: `https://your-domain.com`
   - **Authorization callback URL**: `https://your-domain.com/api/oauth/github/callback`
4. Copy the Client ID and Client Secret

### Notion

1. Go to https://www.notion.so/my-integrations
2. Click "New integration"
3. Fill in:
   - **Name**: LLM UI MCP Client
   - **Type**: Public integration
   - **Redirect URI**: `https://your-domain.com/api/oauth/notion/callback`
4. Copy the OAuth client ID and client secret

### Linear

1. Go to Linear Settings > API > OAuth applications
2. Click "Create OAuth app"
3. Fill in:
   - **Name**: LLM UI MCP Client
   - **Redirect URI**: `https://your-domain.com/api/oauth/linear/callback`
4. Copy the Client ID and Client Secret

## Usage Flow

1. **Open MCP Configuration**: Navigate to the MCP Configuration dialog
2. **OAuth Tab**: Click on the "OAuth" tab to manage connections
3. **Connect Service**: Click "Connect" next to any service you want to authenticate with
4. **OAuth Flow**: A popup will open for OAuth authentication
5. **Grant Permissions**: Authorize the application in the popup
6. **Add MCP Server**: Go to "Add Server" tab and select a popular server that requires OAuth
7. **Configure Server**: The OAuth credentials will be automatically used when connecting

## Security Features

- **User-specific tokens**: Each user has their own OAuth tokens
- **Automatic token injection**: Tokens are automatically added to MCP server requests
- **Token expiry handling**: Expired tokens are detected and can be refreshed
- **Secure storage**: Tokens are encrypted and stored in the database
- **Easy revocation**: Users can disconnect services at any time

## Troubleshooting

### OAuth Popup Blocked
- Ensure your browser allows popups for your domain
- Try clicking the "Connect" button again

### Invalid Redirect URI
- Verify that the redirect URI in your OAuth app matches the one in your environment variables
- Ensure the BASE_URL environment variable is set correctly

### Token Expired
- Go to the OAuth tab and reconnect the service
- The system will automatically detect expired tokens

### MCP Server Connection Failed
- Ensure you have connected the required OAuth service first
- Check that the OAuth service name matches between the server config and your token

## Database Schema

OAuth tokens are stored in the `oauth_tokens` table with the following structure:

```sql
CREATE TABLE oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  service_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMP,
  scope TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, service_name)
);
```

## API Endpoints

- `GET /api/oauth/authorize/:service` - Initiate OAuth flow
- `GET /api/oauth/:service/callback` - Handle OAuth callback
- `GET /api/oauth/tokens` - Get user's OAuth tokens
- `DELETE /api/oauth/tokens/:service` - Revoke OAuth token
