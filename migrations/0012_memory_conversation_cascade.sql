-- Memory <-> conversation link (0012).
-- A memory belongs to the chat it was learned from: deleting the chat must
-- delete the memory. The columns exist already (drizzle-kit db:push); this
-- file swaps the foreign key from ON DELETE SET NULL to ON DELETE CASCADE.
--
-- Forward-looking only: memories whose chat was already deleted under the old
-- behaviour had their link nulled out, so they can no longer be traced back
-- and are left alone. Idempotent — re-running is a no-op.

DO $$
DECLARE
  fk_name text;
BEGIN
  IF to_regclass('public.memories') IS NULL THEN
    RETURN;
  END IF;

  FOR fk_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'memories'
      AND con.contype = 'f'
      AND att.attname = 'source_conversation_id'
      AND con.confdeltype <> 'c'   -- 'c' = cascade; anything else needs swapping
  LOOP
    EXECUTE format('ALTER TABLE memories DROP CONSTRAINT %I', fk_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE rel.relname = 'memories'
      AND con.contype = 'f'
      AND att.attname = 'source_conversation_id'
  ) THEN
    ALTER TABLE memories
      ADD CONSTRAINT memories_source_conversation_id_conversations_id_fk
      FOREIGN KEY (source_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

-- The delete path filters by source conversation; without this it is a scan.
CREATE INDEX IF NOT EXISTS memories_source_conversation_idx
  ON memories (source_conversation_id);
