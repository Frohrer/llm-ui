import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";

if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is required");
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required");
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export function registerRoutes(app: Express): Server {
  app.post('/api/chat/openai', async (req, res) => {
    try {
      const { message, conversationId, context = [], model = "gpt-3.5-turbo" } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Format messages for OpenAI
      const apiMessages = context.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      }));
      apiMessages.push({ role: "user", content: message });

      // Make the OpenAI API request
      const completion = await openai.chat.completions.create({
        messages: apiMessages,
        model,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error("No response from OpenAI");
      }

      let dbConversation;

      if (!conversationId) {
        // Create new conversation
        const [newConversation] = await db.insert(conversations)
          .values({
            title: message.slice(0, 100),
            provider: 'openai',
            model,
            created_at: new Date(),
            last_message_at: new Date()
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        // Insert both messages
        await Promise.all([
          db.insert(messages)
            .values({
              conversation_id: newConversation.id,
              role: 'user',
              content: message,
              created_at: new Date()
            }),
          db.insert(messages)
            .values({
              conversation_id: newConversation.id,
              role: 'assistant',
              content: response,
              created_at: new Date()
            })
        ]);

        // Fetch complete conversation
        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, newConversation.id),
          with: {
            messages: true
          }
        });
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error('Invalid conversation ID');
        }

        // Check if conversation exists
        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum)
        });

        if (!existingConversation) {
          throw new Error('Conversation not found');
        }

        // Update conversation timestamp
        await db.update(conversations)
          .set({ last_message_at: new Date() })
          .where(eq(conversations.id, conversationIdNum));

        // Insert both messages
        await Promise.all([
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'user',
              content: message,
              created_at: new Date()
            }),
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'assistant',
              content: response,
              created_at: new Date()
            })
        ]);

        // Fetch updated conversation
        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
          with: {
            messages: true
          }
        });
      }

      if (!dbConversation) {
        throw new Error('Failed to retrieve conversation');
      }

      res.json({ 
        response,
        conversation: transformDatabaseConversation(dbConversation)
      });
    } catch (error) {
      console.error("Error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to process request" 
      });
    }
  });

  app.get('/api/conversations', async (req, res) => {
    try {
      const result = await db.query.conversations.findMany({
        orderBy: (conversations, { desc }) => [desc(conversations.last_message_at)],
        with: {
          messages: true
        }
      });

      // Transform and sort conversations for frontend
      const transformedConversations = result.map(conv => transformDatabaseConversation(conv));

      res.json(transformedConversations);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get('/api/conversations/:id', async (req, res) => {
    try {
      const result = await db.query.conversations.findFirst({
        where: eq(conversations.id, parseInt(req.params.id)),
        with: {
          messages: true
        }
      });

      if (!result) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      // Transform the conversation for frontend
      const transformedConversation = transformDatabaseConversation(result);

      res.json(transformedConversation);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}