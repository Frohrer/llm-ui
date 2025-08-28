-- Add OAuth tokens table for MCP server authentication
CREATE TABLE oauth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL, -- e.g., 'github', 'notion', 'linear'
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMP,
  scope TEXT,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, service_name)
);

-- Index for fast lookups
CREATE INDEX idx_oauth_tokens_user_service ON oauth_tokens(user_id, service_name);
