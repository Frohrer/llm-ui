-- Migration: Add is_shared column to knowledge_sources table
-- This handles existing databases that already have the knowledge_sources table

-- Add the is_shared column if it doesn't exist
DO $$ 
BEGIN 
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'knowledge_sources' 
        AND column_name = 'is_shared'
    ) THEN
        ALTER TABLE "knowledge_sources" ADD COLUMN "is_shared" boolean DEFAULT false;
    END IF;
END $$; 