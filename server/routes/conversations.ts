import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq, desc } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { cleanupDocumentFile, cleanupImageFile } from "../file-handler";

const router = express.Router();

// Get all conversations for the current user
router.get("/", async (req: Request, res: Response) => {
  try {
    const userConversations = await db.query.conversations.findMany({
      where: eq(conversations.user_id, req.user!.id),
      orderBy: [desc(conversations.last_message_at)],
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

// Get a specific conversation by ID with messages
router.get("/:id/messages", async (req: Request, res: Response) => {
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
    res.status(500).json({ error: "Failed to fetch conversation messages" });
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

    // Get all messages from the conversation to find attachments
    const conversationMessages = await db.query.messages.findMany({
      where: eq(messages.conversation_id, conversationId),
    });

    // Clean up any files associated with the messages
    for (const message of conversationMessages) {
      if (message.attachments) {
        for (const attachment of message.attachments) {
          if (attachment.type === 'image' && attachment.url) {
            cleanupImageFile(attachment.url);
          } else if (attachment.type === 'document' && attachment.url) {
            cleanupDocumentFile(attachment.url);
          }
        }
      }
    }

    // Delete messages and conversation
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