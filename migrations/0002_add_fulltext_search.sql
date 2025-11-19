-- Migration: Add full-text search to conversations and messages
-- This migration is SAFE and REVERSIBLE - it only ADDS columns and indexes
-- Original data in 'title' and 'content' columns remains untouched

-- Step 1: Add tsvector columns for full-text search
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS title_search tsvector;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_search tsvector;

-- Step 2: Populate the new columns with existing data
-- This converts existing text to searchable format
UPDATE conversations SET title_search = to_tsvector('english', coalesce(title, ''));
UPDATE messages SET content_search = to_tsvector('english', coalesce(content, ''));

-- Step 3: Create GIN indexes for fast full-text searching
-- These indexes dramatically improve search performance (10-100x faster)
CREATE INDEX IF NOT EXISTS idx_conversations_title_search ON conversations USING GIN(title_search);
CREATE INDEX IF NOT EXISTS idx_messages_content_search ON messages USING GIN(content_search);

-- Step 4: Create trigger functions to automatically update search columns
-- These keep the search columns in sync when data is inserted or updated
CREATE OR REPLACE FUNCTION conversations_search_update() RETURNS trigger AS $$
BEGIN
  NEW.title_search := to_tsvector('english', coalesce(NEW.title, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION messages_search_update() RETURNS trigger AS $$
BEGIN
  NEW.content_search := to_tsvector('english', coalesce(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create triggers that call the functions above
CREATE TRIGGER conversations_search_update_trigger
  BEFORE INSERT OR UPDATE OF title ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION conversations_search_update();

CREATE TRIGGER messages_search_update_trigger
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_update();

-- Migration complete!
-- To rollback, run the following:
-- DROP TRIGGER IF EXISTS conversations_search_update_trigger ON conversations;
-- DROP TRIGGER IF EXISTS messages_search_update_trigger ON messages;
-- DROP FUNCTION IF EXISTS conversations_search_update();
-- DROP FUNCTION IF EXISTS messages_search_update();
-- DROP INDEX IF EXISTS idx_conversations_title_search;
-- DROP INDEX IF EXISTS idx_messages_content_search;
-- ALTER TABLE conversations DROP COLUMN IF EXISTS title_search;
-- ALTER TABLE messages DROP COLUMN IF EXISTS content_search;

