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

      // Format conversation history for OpenAI
      const messages = context.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      messages.push({ role: "user", content: message });

      const completion = await openai.chat.completions.create({
        messages,
        model,
      });

      const response = completion.choices[0]?.message?.content;
      if (!response) {
        throw new Error("No response from OpenAI");
      }

      res.json({ response });
    } catch (error) {
      console.error("OpenAI API error:", error);
      res.status(500).json({ error: "Failed to process OpenAI request" });
    }
  });

  app.post('/api/chat/anthropic', async (req, res) => {
    try {
      const { message, conversationId, context = [], model = "claude-3-opus-20240229" } = req.body;

      // Format conversation history for Anthropic
      const messages = context.map(msg => ({
        role: msg.role,
        content: msg.content
      }));
      messages.push({ role: "user", content: message });

      const completion = await anthropic.messages.create({
        messages,
        model,
        max_tokens: 1024,
      });

      const response = completion.content[0].text;
      if (!response) {
        throw new Error("No response from Anthropic");
      }

      res.json({ response });
    } catch (error) {
      console.error("Anthropic API error:", error);
      res.status(500).json({ error: "Failed to process Anthropic request" });
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