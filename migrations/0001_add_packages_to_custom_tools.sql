-- Migration: Add packages field to custom_tools table
-- This allows users to manually specify Python packages to install

ALTER TABLE custom_tools ADD COLUMN packages jsonb DEFAULT '[]'::jsonb;

