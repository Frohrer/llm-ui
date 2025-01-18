import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

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
      const { message } = req.body;

      const completion = await openai.chat.completions.create({
        messages: [{ role: "user", content: message }],
        model: "gpt-3.5-turbo",
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
      const { message } = req.body;

      const completion = await anthropic.messages.create({
        messages: [{ role: "user", content: message }],
        model: "claude-3-opus-20240229",
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

  const httpServer = createServer(app);
  return httpServer;
}