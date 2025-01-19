import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { loadProviderConfigs } from "./config/loader";

// Load provider configurations at startup
let providerConfigs: Awaited<ReturnType<typeof loadProviderConfigs>>;
loadProviderConfigs().then(configs => {
  providerConfigs = configs;
}).catch(error => {
  console.error('Failed to load provider configurations:', error);
  process.exit(1);
});

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
  // Add new endpoint to get provider configurations
  app.get('/api/providers', async (_req, res) => {
    try {
      if (!providerConfigs) {
        providerConfigs = await loadProviderConfigs();
      }
      res.json(providerConfigs);
    } catch (error) {
      console.error('Error fetching provider configurations:', error);
      res.status(500).json({ error: 'Failed to fetch provider configurations' });
    }
  });

  app.post('/api/chat/openai', async (req, res) => {
    try {
      const { message, conversationId, context = [], model = "gpt-3.5-turbo" } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Ensure the context messages are properly ordered
      const apiMessages = context
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content
        }));

      apiMessages.push({ role: "user", content: message });

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

        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, newConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)]
            }
          }
        });
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error('Invalid conversation ID');
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum)
        });

        if (!existingConversation) {
          throw new Error('Conversation not found');
        }

        await db.update(conversations)
          .set({ last_message_at: new Date() })
          .where(eq(conversations.id, conversationIdNum));

        const userMessageTime = new Date();
        const assistantMessageTime = new Date(userMessageTime.getTime() + 1000); // Ensure assistant message is after user message

        await Promise.all([
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'user',
              content: message,
              created_at: userMessageTime
            }),
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'assistant',
              content: response,
              created_at: assistantMessageTime
            })
        ]);

        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)]
            }
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

  app.post('/api/chat/anthropic', async (req, res) => {
    try {
      const { message, conversationId, context = [], model = "claude-3-5-sonnet-20241022" } = req.body;
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Ensure the context messages are properly ordered
      const apiMessages = context
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content
        }));

      apiMessages.push({ role: "user", content: message });

      const completion = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        messages: apiMessages,
      });

      // Handle response content safely
      const response = completion.content[0]?.type === 'text' 
        ? completion.content[0].text
        : '';

      if (!response) {
        throw new Error("No response from Anthropic");
      }

      let dbConversation;
      if (!conversationId) {
        const [newConversation] = await db.insert(conversations)
          .values({
            title: message.slice(0, 100),
            provider: 'anthropic',
            model,
            created_at: new Date(),
            last_message_at: new Date()
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        const userMessageTime = new Date();
        const assistantMessageTime = new Date(userMessageTime.getTime() + 1000); // Ensure assistant message is after user message

        await Promise.all([
          db.insert(messages)
            .values({
              conversation_id: newConversation.id,
              role: 'user',
              content: message,
              created_at: userMessageTime
            }),
          db.insert(messages)
            .values({
              conversation_id: newConversation.id,
              role: 'assistant',
              content: response,
              created_at: assistantMessageTime
            })
        ]);

        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, newConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)]
            }
          }
        });
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error('Invalid conversation ID');
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum)
        });

        if (!existingConversation) {
          throw new Error('Conversation not found');
        }

        await db.update(conversations)
          .set({ last_message_at: new Date() })
          .where(eq(conversations.id, conversationIdNum));

        const userMessageTime = new Date();
        const assistantMessageTime = new Date(userMessageTime.getTime() + 1000); // Ensure assistant message is after user message

        await Promise.all([
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'user',
              content: message,
              created_at: userMessageTime
            }),
          db.insert(messages)
            .values({
              conversation_id: conversationIdNum,
              role: 'assistant',
              content: response,
              created_at: assistantMessageTime
            })
        ]);

        dbConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)]
            }
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

  // Rest of the routes remain unchanged
  app.delete('/api/conversations/:id', async (req, res) => {
    try {
      const conversationId = parseInt(req.params.id);
      if (isNaN(conversationId)) {
        return res.status(400).json({ error: "Invalid conversation ID" });
      }
      const conversation = await db.query.conversations.findFirst({
        where: eq(conversations.id, conversationId)
      });
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      await db.delete(messages)
        .where(eq(messages.conversation_id, conversationId));
      await db.delete(conversations)
        .where(eq(conversations.id, conversationId));
      res.json({ success: true });
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
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