-- Migration: Fix tsvector size limit for large message content
-- This migration modifies the search trigger to truncate large content before indexing
-- to prevent "string is too long for tsvector max 1048575 bytes" errors

-- Step 1: Drop existing trigger functions
DROP FUNCTION IF EXISTS conversations_search_update() CASCADE;
DROP FUNCTION IF EXISTS messages_search_update() CASCADE;

-- Step 2: Create updated trigger function for conversations with size limit
-- Truncates title to first 50,000 characters (well under the 1MB tsvector limit)
CREATE OR REPLACE FUNCTION conversations_search_update() RETURNS trigger AS $$
BEGIN
  NEW.title_search := to_tsvector('english', coalesce(left(NEW.title, 50000), ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create updated trigger function for messages with size limit
-- Truncates content to first 100,000 characters (about 25KB, well under the 1MB tsvector limit)
-- This should capture all text-only messages while avoiding image/binary data issues
CREATE OR REPLACE FUNCTION messages_search_update() RETURNS trigger AS $$
BEGIN
  -- Only index the first 100,000 characters to prevent tsvector size limit errors
  -- This is sufficient for full-text search while avoiding issues with large attachments
  NEW.content_search := to_tsvector('english', coalesce(left(NEW.content, 100000), ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Re-create the triggers (CASCADE in DROP should have removed them)
CREATE TRIGGER conversations_search_update_trigger
  BEFORE INSERT OR UPDATE OF title ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION conversations_search_update();

CREATE TRIGGER messages_search_update_trigger
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_update();

-- Step 5: Re-index existing data with the new truncation logic
-- This is safe and will fix any existing rows that might have issues
UPDATE conversations SET title_search = to_tsvector('english', coalesce(left(title, 50000), ''));
UPDATE messages SET content_search = to_tsvector('english', coalesce(left(content, 100000), ''));

-- Migration complete!
-- This fix ensures that:
-- 1. Large message content won't cause tsvector size limit errors
-- 2. Full-text search still works effectively (100k chars is plenty for search)
-- 3. Existing and new messages are all properly indexed

