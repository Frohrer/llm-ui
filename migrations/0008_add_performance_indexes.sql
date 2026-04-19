-- Add missing indexes for conversation and message loading performance
-- These indexes are critical: without them, every query does a full table scan

CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user_last_message ON conversations(user_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_conversation_knowledge_conversation_id ON conversation_knowledge(conversation_id);
