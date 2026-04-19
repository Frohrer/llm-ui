import express, { Request, Response } from 'express';
import { db } from "@db";
import { conversations, messages, conversationKnowledge } from "@db/schema";
import { eq, desc, or, ilike, and, sql } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { cleanupDocumentFile, cleanupImageFile, cleanupGeneratedImage } from "../file-handler";

const router = express.Router();

// Get conversations for the current user (paginated)
router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const before = req.query.before as string | undefined;

    const conditions = [eq(conversations.user_id, req.user!.id)];
    if (before) {
      conditions.push(sql`${conversations.last_message_at} < ${before}`);
    }

    const userConversations = await db.query.conversations.findMany({
      where: and(...conditions),
      orderBy: [desc(conversations.last_message_at)],
      limit: limit + 1, // fetch one extra to detect if there's a next page
    });

    const hasMore = userConversations.length > limit;
    const page = hasMore ? userConversations.slice(0, limit) : userConversations;

    const transformedConversations = page.map(transformDatabaseConversation);

    res.json({
      conversations: transformedConversations,
      nextCursor: hasMore ? page[page.length - 1].last_message_at.toISOString() : null,
    });
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
        is_nsfw: conversations.is_nsfw,
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
        conversations.is_nsfw,
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

// Export all conversations with messages as streamed JSON
router.get("/export", async (req: Request, res: Response) => {
  try {
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="chat-export-${new Date().toISOString().slice(0, 10)}.json"`,
    );

    // Fetch conversation IDs only (lightweight)
    const convIds = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.user_id, req.user!.id))
      .orderBy(desc(conversations.last_message_at));

    // Stream JSON array — write one conversation at a time to avoid OOM
    res.write("[\n");

    for (let i = 0; i < convIds.length; i++) {
      const conv = await db.query.conversations.findFirst({
        where: eq(conversations.id, convIds[i].id),
        with: {
          messages: {
            orderBy: (messages, { asc }) => [asc(messages.created_at)],
          },
        },
      });

      if (!conv) continue;

      const entry = JSON.stringify({
        title: conv.title,
        provider: conv.provider,
        model: conv.model,
        created_at: conv.created_at,
        last_message_at: conv.last_message_at,
        messages: (conv.messages || []).map((msg) => ({
          role: msg.role,
          content: msg.content,
          created_at: msg.created_at,
        })),
      });

      res.write(entry);
      if (i < convIds.length - 1) res.write(",\n");
    }

    res.write("\n]");
    res.end();
  } catch (error) {
    console.error("Export error:", error);
    // If headers already sent, just end the stream
    if (res.headersSent) {
      res.end();
    } else {
      res.status(500).json({ error: "Failed to export conversations" });
    }
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

// Toggle NSFW flag on a conversation
router.patch("/:id/nsfw", async (req: Request, res: Response) => {
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

    const { is_nsfw } = req.body;
    if (typeof is_nsfw !== "boolean") {
      return res.status(400).json({ error: "is_nsfw must be a boolean" });
    }

    const [updated] = await db
      .update(conversations)
      .set({ is_nsfw })
      .where(eq(conversations.id, conversationId))
      .returning();

    res.json(transformDatabaseConversation(updated));
  } catch (error) {
    console.error("Database error:", error);
    res.status(500).json({ error: "Failed to update NSFW flag" });
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
      // Clean up attachments from metadata
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
      
      // Clean up generated images from message content (markdown image URLs)
      // Match URLs like /uploads/generated/xxx.png or full URLs with uploads/generated/
      const generatedImageRegex = /!\[.*?\]\((.*?\/uploads\/generated\/[^)]+)\)/g;
      let match;
      while ((match = generatedImageRegex.exec(message.content)) !== null) {
        cleanupGeneratedImage(match[1]);
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