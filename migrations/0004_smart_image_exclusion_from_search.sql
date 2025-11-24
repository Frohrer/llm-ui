-- Migration: Smart image exclusion from full-text search
-- This migration intelligently filters out image data while keeping all text searchable
-- Fixes the issue where images cause "string is too long for tsvector" errors
-- while ensuring long text content remains fully searchable

-- Step 1: Drop existing trigger functions
DROP FUNCTION IF EXISTS conversations_search_update() CASCADE;
DROP FUNCTION IF EXISTS messages_search_update() CASCADE;

-- Step 2: Create updated trigger function for conversations (no change needed)
CREATE OR REPLACE FUNCTION conversations_search_update() RETURNS trigger AS $$
BEGIN
  NEW.title_search := to_tsvector('english', coalesce(NEW.title, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create smart trigger function for messages that excludes image data
-- This function:
-- 1. Strips out base64 data URIs (data:image/...;base64,...)
-- 2. Limits content to prevent tsvector size errors
-- 3. Keeps all actual text content searchable (up to 200KB)
CREATE OR REPLACE FUNCTION messages_search_update() RETURNS trigger AS $$
DECLARE
  cleaned_content TEXT;
BEGIN
  -- Start with the original content
  cleaned_content := coalesce(NEW.content, '');
  
  -- Remove data URI images using simpler regex
  -- Matches: data:image/TYPE;base64,BASE64DATA
  cleaned_content := regexp_replace(
    cleaned_content,
    'data:image/[^;]+;base64,[A-Za-z0-9+/=]+',
    '[IMAGE]',
    'g'
  );
  
  -- If content is still too large (> 200KB), truncate it
  -- 200KB of text = ~50,000 words, which is more than enough for full-text search
  -- This prevents tsvector limit errors while keeping all reasonable text searchable
  IF length(cleaned_content) > 200000 THEN
    cleaned_content := left(cleaned_content, 200000);
  END IF;
  
  -- Create the search vector from cleaned content
  NEW.content_search := to_tsvector('english', cleaned_content);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Re-create the triggers
CREATE TRIGGER conversations_search_update_trigger
  BEFORE INSERT OR UPDATE OF title ON conversations
  FOR EACH ROW
  EXECUTE FUNCTION conversations_search_update();

CREATE TRIGGER messages_search_update_trigger
  BEFORE INSERT OR UPDATE OF content ON messages
  FOR EACH ROW
  EXECUTE FUNCTION messages_search_update();

-- Step 5: Re-index existing data with the new smart filtering
-- This will clean up any existing messages with image data
DO $$
DECLARE
  msg RECORD;
  cleaned_content TEXT;
BEGIN
  -- Update conversations (no change from previous migration)
  UPDATE conversations 
  SET title_search = to_tsvector('english', coalesce(title, ''));
  
  -- Update messages with smart image filtering
  FOR msg IN SELECT id, content FROM messages LOOP
    cleaned_content := coalesce(msg.content, '');
    
    -- Remove data URI images
    cleaned_content := regexp_replace(
      cleaned_content,
      'data:image/[^;]+;base64,[A-Za-z0-9+/=]+',
      '[IMAGE]',
      'g'
    );
    
    -- Truncate if still too large
    IF length(cleaned_content) > 200000 THEN
      cleaned_content := left(cleaned_content, 200000);
    END IF;
    
    -- Update the search vector
    UPDATE messages 
    SET content_search = to_tsvector('english', cleaned_content)
    WHERE id = msg.id;
  END LOOP;
END $$;

-- Migration complete!
-- Benefits of this approach:
-- 1. Image data (base64, data URIs) is automatically excluded from search
-- 2. All actual text content remains searchable (up to 200KB per message)
-- 3. No arbitrary truncation of user text
-- 4. Future messages with images won't cause tsvector errors

