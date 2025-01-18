import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";

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

      // Format messages for OpenAI
      const messages = context.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      }));
      messages.push({ role: "user", content: message });

      // Make the API request with proper error handling
      let completion;
      try {
        completion = await openai.chat.completions.create({
          messages,
          model,
        });
      } catch (apiError: any) {
        console.error("OpenAI API error details:", apiError);
        throw new Error(apiError.message || "OpenAI API request failed");
      }

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error("No response from OpenAI");
      }

      let dbConversation;

      try {
        if (!conversationId) {
          // Create new conversation
          const [newConversation] = await db.insert(conversations).values({
            title: message.slice(0, 100),
            provider: 'openai',
            model,
            createdAt: new Date(),
            lastMessageAt: new Date()
          }).returning();

          // Insert user message
          await db.insert(messages).values({
            conversationId: newConversation.id,
            role: 'user',
            content: message,
            createdAt: new Date()
          });

          // Insert assistant message
          await db.insert(messages).values({
            conversationId: newConversation.id,
            role: 'assistant',
            content: response,
            createdAt: new Date()
          });

          // Fetch the complete conversation
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

          // Verify conversation exists
          const existingConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationIdNum)
          });

          if (!existingConversation) {
            throw new Error('Conversation not found');
          }

          // Update existing conversation
          await db.update(conversations)
            .set({ lastMessageAt: new Date() })
            .where(eq(conversations.id, conversationIdNum));

          // Insert user message
          await db.insert(messages).values({
            conversationId: conversationIdNum,
            role: 'user',
            content: message,
            createdAt: new Date()
          });

          // Insert assistant message
          await db.insert(messages).values({
            conversationId: conversationIdNum,
            role: 'assistant',
            content: response,
            createdAt: new Date()
          });

          // Fetch the updated conversation
          dbConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationIdNum),
            with: {
              messages: true
            }
          });
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        throw new Error('Failed to save conversation to database');
      }

      res.json({ response, conversation: dbConversation });
    } catch (error) {
      console.error("OpenAI API error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to process OpenAI request" 
      });
    }
  });

  app.post('/api/chat/anthropic', async (req, res) => {
    try {
      const { message, conversationId, context = [], model = "claude-3-opus-20240229" } = req.body;

      // Format messages for Anthropic
      const messages = context.map((msg: any) => ({
        role: msg.role,
        content: msg.content
      }));
      messages.push({ role: "user", content: message });

      const completion = await anthropic.messages.create({
        messages,
        model,
        max_tokens: 1024,
      });

      // Extract response from Anthropic's response format
      const content = completion.content[0];
      if (!content || content.type !== 'text') {
        throw new Error("Unexpected response format from Anthropic");
      }

      const response = content.text;
      if (!response) {
        throw new Error("No response from Anthropic");
      }

      let dbConversation;

      try {
        if (!conversationId) {
          // Create new conversation
          const [newConversation] = await db.insert(conversations).values({
            title: message.slice(0, 100),
            provider: 'anthropic',
            model,
            createdAt: new Date(),
            lastMessageAt: new Date()
          }).returning();

          // Insert user message
          await db.insert(messages).values({
            conversationId: newConversation.id,
            role: 'user',
            content: message,
            createdAt: new Date()
          });

          // Insert assistant message
          await db.insert(messages).values({
            conversationId: newConversation.id,
            role: 'assistant',
            content: response,
            createdAt: new Date()
          });

          // Fetch the complete conversation
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

          // Verify conversation exists
          const existingConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationIdNum)
          });

          if (!existingConversation) {
            throw new Error('Conversation not found');
          }

          // Update existing conversation
          await db.update(conversations)
            .set({ lastMessageAt: new Date() })
            .where(eq(conversations.id, conversationIdNum));

          // Insert user message
          await db.insert(messages).values({
            conversationId: conversationIdNum,
            role: 'user',
            content: message,
            createdAt: new Date()
          });

          // Insert assistant message
          await db.insert(messages).values({
            conversationId: conversationIdNum,
            role: 'assistant',
            content: response,
            createdAt: new Date()
          });

          // Fetch the updated conversation
          dbConversation = await db.query.conversations.findFirst({
            where: eq(conversations.id, conversationIdNum),
            with: {
              messages: true
            }
          });
        }
      } catch (dbError) {
        console.error('Database error:', dbError);
        throw new Error('Failed to save conversation to database');
      }

      res.json({ response, conversation: dbConversation });
    } catch (error) {
      console.error("Anthropic API error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to process Anthropic request" 
      });
    }
  });

  // Get all conversations
  app.get('/api/conversations', async (req, res) => {
    try {
      const result = await db.query.conversations.findMany({
        orderBy: (conversations, { desc }) => [desc(conversations.lastMessageAt)],
        with: {
          messages: true
        }
      });
      res.json(result);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get a single conversation
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
      res.json(result);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}