import express, { Request, Response } from "express";
import { db } from "@db";
import { memories, conversations } from "@db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { deleteMemoryWithLineage, deleteAllMemories } from "../memory-service";

const router = express.Router();

/**
 * GET /api/memory
 * The current user's active memories (not superseded, not evicted), newest
 * first, with the title of the conversation each one came from.
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    const rows = await db
      .select({
        id: memories.id,
        kind: memories.kind,
        body: memories.body,
        pinned: memories.pinned,
        use_count: memories.use_count,
        created_at: memories.created_at,
        source_conversation_id: memories.source_conversation_id,
        source_conversation_title: conversations.title,
      })
      .from(memories)
      .leftJoin(conversations, eq(memories.source_conversation_id, conversations.id))
      .where(
        and(
          eq(memories.user_id, req.user.id),
          isNull(memories.superseded_by),
          isNull(memories.evicted_at),
        ),
      )
      .orderBy(desc(memories.pinned), desc(memories.created_at));

    res.json(rows);
  } catch (error) {
    console.error("Error listing memories:", error);
    res.status(500).json({ error: "Failed to list memories" });
  }
});

/**
 * DELETE /api/memory/:id
 * Delete one memory (and its superseded lineage, so an older phrasing can't
 * resurface later). Scoped to the current user.
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid memory id" });
    }
    const deleted = await deleteMemoryWithLineage(id, req.user.id);
    if (deleted === 0) return res.status(404).json({ error: "Memory not found" });
    res.json({ success: true, deleted });
  } catch (error) {
    console.error("Error deleting memory:", error);
    res.status(500).json({ error: "Failed to delete memory" });
  }
});

/**
 * DELETE /api/memory
 * Wipe every memory the current user has, in any lifecycle state.
 */
router.delete("/", async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    const deleted = await deleteAllMemories(req.user.id);
    res.json({ success: true, deleted });
  } catch (error) {
    console.error("Error deleting all memories:", error);
    res.status(500).json({ error: "Failed to delete memories" });
  }
});

export default router;
