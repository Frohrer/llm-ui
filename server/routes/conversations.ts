import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";

const router = express.Router();

// Get all conversations for the current user
router.get("/", async (req: Request, res: Response) => {
  try {
    const userConversations = await db.query.conversations.findMany({
      where: eq(conversations.user_id, req.user!.id),
      orderBy: [desc(conversations.last_message_at)],
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.created_at)],
        },
      },
    });

    const transformedConversations = userConversations.map(
      transformDatabaseConversation,
    );

    res.json(transformedConversations);
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// Get a specific conversation by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id);
    if (isNaN(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }

    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      with: {
        messages: {
          orderBy: (messages, { asc }) => [asc(messages.created_at)],
        },
      },
    });

    if (!conversation || conversation.user_id !== req.user!.id) {
      return res
        .status(404)
        .json({ error: "Conversation not found or unauthorized" });
    }

    res.json(transformDatabaseConversation(conversation));
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// Delete a conversation
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const conversationId = parseInt(req.params.id);
    if (isNaN(conversationId)) {
      return res.status(400).json({ error: "Invalid conversation ID" });
    }
    const conversation = await db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
    });
    if (!conversation || conversation.user_id !== req.user!.id) {
      return res
        .status(404)
        .json({ error: "Conversation not found or unauthorized" });
    }
    await db
      .delete(messages)
      .where(eq(messages.conversation_id, conversationId));
    await db
      .delete(conversations)
      .where(eq(conversations.id, conversationId));
    res.json({ success: true });
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

export default router;