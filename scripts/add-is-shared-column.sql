-- Add is_shared column to knowledge_sources table if it doesn't exist
-- This handles existing databases that already have the knowledge_sources table

DO $$ 
BEGIN 
    -- Check if the column exists and add it if it doesn't
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'knowledge_sources' 
        AND column_name = 'is_shared'
    ) THEN
        ALTER TABLE knowledge_sources ADD COLUMN is_shared boolean DEFAULT false;
        
        -- Update existing records to have is_shared = false
        UPDATE knowledge_sources SET is_shared = false WHERE is_shared IS NULL;
        
        RAISE NOTICE 'Added is_shared column to knowledge_sources table';
    ELSE
        RAISE NOTICE 'is_shared column already exists in knowledge_sources table';
    END IF;
END $$; 