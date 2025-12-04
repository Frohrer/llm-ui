import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages, conversationKnowledge } from "@db/schema";
import { eq, desc, or, ilike, and, sql } from "drizzle-orm";
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

// Search conversations by title and message content using PostgreSQL Full-Text Search
router.get("/search", async (req: Request, res: Response) => {
  try {
    const { q } = req.query;
    
    if (!q || typeof q !== 'string' || q.trim().length === 0) {
      return res.json([]);
    }

    // Prepare search query: split by spaces and join with & for AND search
    // This allows searching for multiple words (e.g., "hello world" becomes "hello & world")
    const searchTerms = q.trim().split(/\s+/).filter(term => term.length > 0);
    const tsquery = searchTerms.join(' & ');
    
    // Search using PostgreSQL full-text search with ranking
    // Uses the tsvector columns created by the migration for fast indexed search
    const results = await db
      .selectDistinct({
        id: conversations.id,
        title: conversations.title,
        user_id: conversations.user_id,
        provider: conversations.provider,
        model: conversations.model,
        created_at: conversations.created_at,
        last_message_at: conversations.last_message_at,
        // Calculate relevance rank (higher = better match)
        rank: sql<number>`
          ts_rank(${conversations.title_search}, to_tsquery('english', ${tsquery})) +
          COALESCE(MAX(ts_rank(${messages.content_search}, to_tsquery('english', ${tsquery}))), 0)
        `.as('rank'),
      })
      .from(conversations)
      .leftJoin(messages, eq(messages.conversation_id, conversations.id))
      .where(
        and(
          eq(conversations.user_id, req.user!.id),
          // Match in either title or message content
          sql`(
            ${conversations.title_search} @@ to_tsquery('english', ${tsquery}) OR
            ${messages.content_search} @@ to_tsquery('english', ${tsquery})
          )`
        )
      )
      .groupBy(
        conversations.id,
        conversations.title,
        conversations.user_id,
        conversations.provider,
        conversations.model,
        conversations.created_at,
        conversations.last_message_at,
        conversations.title_search
      )
      .orderBy(sql`rank DESC, ${conversations.last_message_at} DESC`);

    const transformedConversations = results.map(
      transformDatabaseConversation,
    );

    res.json(transformedConversations);
  } catch (error) {
    console.error("Search error:", error);
    res.status(500).json({ error: "Failed to search conversations" });
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
      const metadata = message.metadata as { attachments?: Array<{ type: string; url: string }> } | null;
      if (metadata?.attachments) {
        for (const attachment of metadata.attachments) {
          if (attachment.type === 'image' && attachment.url) {
            cleanupImageFile(attachment.url);
          } else if (attachment.type === 'document' && attachment.url) {
            cleanupDocumentFile(attachment.url);
          }
        }
      }
    }

    // Delete in this order:
    // 1. conversation_knowledge (join table)
    // 2. messages
    // 3. conversation
    await db
      .delete(conversationKnowledge)
      .where(eq(conversationKnowledge.conversation_id, conversationId));
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