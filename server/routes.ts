import type { Express } from "express";
import { createServer, type Server } from "http";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@db";
import { conversations, messages } from "@db/schema";
import { eq } from "drizzle-orm";
import { transformDatabaseConversation } from "@/lib/llm/types";
import { loadProviderConfigs } from "./config/loader";
import { cloudflareAuthMiddleware } from "./middleware/auth";
import type { SQL } from "drizzle-orm";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import fs from 'fs';
import path from 'path';
import fluent from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { transcribeAudioBuffer, synthesizeSpeech, convertAudioBuffer } from './speech-service';

// Load provider configurations at startup
let providerConfigs: Awaited<ReturnType<typeof loadProviderConfigs>>;
loadProviderConfigs()
  .then((configs) => {
    providerConfigs = configs;
  })
  .catch((error) => {
    console.error("Failed to load provider configurations:", error);
    process.exit(1);
  });

// Initialize API clients based on available API keys
const clients: Record<string, any> = {};

// OpenAI client initialization
if (process.env.OPENAI_API_KEY) {
  clients.openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

// Anthropic client initialization
if (process.env.ANTHROPIC_API_KEY) {
  clients.anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

// DeepSeek client initialization
if (process.env.DEEPSEEK_API_KEY) {
  clients.deepseek = new OpenAI({
    baseURL: "https://api.deepseek.com/v1",
    apiKey: process.env.DEEPSEEK_API_KEY,
  });
}

export function registerRoutes(app: Express): Server {
  // Apply authentication middleware to all /api routes
  app.use("/api", cloudflareAuthMiddleware);

  // Add endpoint to get current user info
  app.get("/api/user", (req, res) => {
    res.json(req.user);
  });

  // Add provider configurations endpoint - only return providers with available API keys
  app.get("/api/providers", async (_req, res) => {
    try {
      if (!providerConfigs) {
        providerConfigs = await loadProviderConfigs();
      }

      // Filter providers based on available API keys
      const availableProviders = providerConfigs.filter((provider) => {
        switch (provider.id) {
          case "openai":
            return !!clients.openai;
          case "anthropic":
            return !!clients.anthropic;
          case "deepseek":
            return !!clients.deepseek;
          default:
            return false;
        }
      });

      res.json(availableProviders);
    } catch (error) {
      console.error("Error fetching provider configurations:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch provider configurations" });
    }
  });

  // Modified stream handling for OpenAI endpoint (similar changes needed for other providers)
  app.post("/api/chat/openai", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "gpt-4",
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Set up SSE headers with keep-alive
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no"); // Disable proxy buffering

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "openai",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      apiMessages.push({ role: "user", content: message });

      // Stream the completion with retries
      const maxRetries = 3;
      let retryCount = 0;
      let stream;

      while (retryCount < maxRetries) {
        try {
          stream = await clients.openai.chat.completions.create({
            messages: apiMessages,
            model,
            stream: true,
            max_completion_tokens: 4096, // Increased from 2048 to 4096
            temperature: 0.7,
          });
          console.log("Stream created with model:", model); //Added logging
          break;
        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * retryCount),
          ); // Exponential backoff
        }
      }

      if (!stream) {
        throw new Error("Failed to create stream after retries");
      }

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      // Set up keep-alive interval
      const keepAliveInterval = setInterval(() => {
        res.write(": keep-alive\n\n");
      }, 15000); // Send keep-alive every 15 seconds

      try {
        let lastChunkTime = Date.now();
        const chunkTimeout = 30000; // 30 seconds timeout between chunks

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            streamedResponse += content;
            lastChunkTime = Date.now();
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
            );
            if (res.flush) res.flush();
          }

          // Check for timeout between chunks
          if (Date.now() - lastChunkTime > chunkTimeout) {
            throw new Error("Stream timeout - no data received for 30 seconds");
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.response?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
      } finally {
        clearInterval(keepAliveInterval);
        res.end();
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Update Anthropic chat endpoint to use streaming
  app.post("/api/chat/anthropic", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "claude-3-5-sonnet-20241022",
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "anthropic",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      apiMessages.push({ role: "user", content: message });

      // Stream the completion
      const stream = await clients.anthropic.messages.create({
        messages: apiMessages,
        model,
        max_tokens: 4096, // Increased from 1024 to 4096
        temperature: 0.7,
        stream: true,
      });
      console.log("Anthropic stream created with model:", model);

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      try {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.text) {
            streamedResponse += chunk.delta.text;
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content: chunk.delta.text })}\n\n`,
            );
            if (res.flush) res.flush();
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );

        res.end();
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.completion?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
        res.end();
        return;
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Add DeepSeek chat endpoint with streaming
  app.post("/api/chat/deepseek", async (req, res) => {
    try {
      const {
        message,
        conversationId,
        context = [],
        model = "deepseek-chat",
      } = req.body;
      if (!message || typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message" });
      }

      // Set up SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let conversationTitle = message.slice(0, 100);
      let dbConversation;
      let streamedResponse = "";

      // Create or update conversation first
      if (!conversationId) {
        const timestamp = new Date();
        const [newConversation] = await db
          .insert(conversations)
          .values({
            title: conversationTitle,
            provider: "deepseek",
            model,
            user_id: req.user!.id,
            created_at: timestamp,
            last_message_at: timestamp,
          })
          .returning();

        if (!newConversation) {
          throw new Error("Failed to create conversation");
        }

        await db.insert(messages).values({
          conversation_id: newConversation.id,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = newConversation;
      } else {
        const conversationIdNum = parseInt(conversationId);
        if (isNaN(conversationIdNum)) {
          throw new Error("Invalid conversation ID");
        }

        const existingConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, conversationIdNum),
        });

        if (
          !existingConversation ||
          existingConversation.user_id !== req.user!.id
        ) {
          throw new Error("Conversation not found or unauthorized");
        }

        const timestamp = new Date();
        await db
          .update(conversations)
          .set({ last_message_at: timestamp })
          .where(eq(conversations.id, conversationIdNum));

        await db.insert(messages).values({
          conversation_id: conversationIdNum,
          role: "user",
          content: message,
          created_at: timestamp,
        });

        dbConversation = existingConversation;
      }

      // Ensure context messages are properly ordered
      const apiMessages = context
        .sort(
          (a: any, b: any) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        )
        .map((msg: any) => ({
          role: msg.role,
          content: msg.content,
        }));

      apiMessages.push({ role: "user", content: message });

      // Stream the completion using DeepSeek
      const stream = await clients.deepseek.chat.completions.create({
        messages: apiMessages,
        model,
        stream: true,
        max_tokens: 4096, // Increased token limit
        temperature: 0.7,
      });

      console.log("DeepSeek stream created with model:", model);

      // Send initial conversation data
      res.write(
        `data: ${JSON.stringify({ type: "start", conversationId: dbConversation.id })}\n\n`,
      );

      try {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            streamedResponse += content;
            res.write(
              `data: ${JSON.stringify({ type: "chunk", content })}\n\n`,
            );
            if (res.flush) res.flush();
          }
        }

        // Save the complete response only after successful streaming
        const timestamp = new Date();
        await db.insert(messages).values({
          conversation_id: dbConversation.id,
          role: "assistant",
          content: streamedResponse,
          created_at: timestamp,
        });

        // Send completion event after successful save
        const updatedConversation = await db.query.conversations.findFirst({
          where: eq(conversations.id, dbConversation.id),
          with: {
            messages: {
              orderBy: (messages, { asc }) => [asc(messages.created_at)],
            },
          },
        });

        if (!updatedConversation) {
          throw new Error("Failed to retrieve conversation");
        }

        res.write(
          `data: ${JSON.stringify({
            type: "end",
            conversation: transformDatabaseConversation(updatedConversation),
          })}\n\n`,
        );

        res.end();
      } catch (streamError) {
        console.error("Streaming error:", streamError);
        console.log("Completion reason:", (stream as any)?.response?.reason); //Added logging for completion reason
        res.write(
          `data: ${JSON.stringify({
            type: "error",
            error:
              streamError instanceof Error
                ? streamError.message
                : "Stream interrupted",
          })}\n\n`,
        );
        res.end();
        return;
      }
    } catch (error) {
      console.error("Error:", error);
      res.write(
        `data: ${JSON.stringify({
          type: "error",
          error:
            error instanceof Error
              ? error.message
              : "Failed to process request",
        })}\n\n`,
      );
      res.end();
    }
  });

  // Rest of the routes (conversations endpoints)
  app.delete("/api/conversations/:id", async (req, res) => {
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

  app.get("/api/conversations", async (req, res) => {
    try {
      const result = await db.query.conversations.findMany({
        where: eq(conversations.user_id, req.user!.id),
        orderBy: (conversations, { desc }) => [
          desc(conversations.last_message_at),
        ],
        with: {
          messages: true,
        },
      });
      const transformedConversations = result.map((conv) =>
        transformDatabaseConversation(conv),
      );
      res.json(transformedConversations);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/conversations/:id", async (req, res) => {
    try {
      const result = await db.query.conversations.findFirst({
        where: eq(conversations.id, parseInt(req.params.id)),
        with: {
          messages: true,
        },
      });

      if (!result) {
        return res.status(404).json({ error: "Conversation not found" });
      }

      if (result.user_id !== req.user!.id) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const transformedConversation = transformDatabaseConversation(result);
      res.json(transformedConversation);
    } catch (error) {
      console.error("Database error:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Text-to-Speech endpoint
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = "en-US-JennyNeural" } = req.body;
      
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Invalid text" });
      }
      
      if (!process.env.SPEECH_KEY || !process.env.SPEECH_REGION) {
        return res.status(500).json({ 
          error: "Speech service credentials not configured",
          missing: !process.env.SPEECH_KEY ? "SPEECH_KEY" : "SPEECH_REGION"
        });
      }
      
      // Set up headers for audio streaming
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Transfer-Encoding", "chunked");
      
      try {
        // Use our improved speech service
        const audioBuffer = await synthesizeSpeech(text);
        
        // Stream the audio data
        res.write(audioBuffer);
        res.end();
      } catch (synthError) {
        console.error("Speech synthesis error:", synthError);
        res.status(500).json({ 
          error: "Speech synthesis failed", 
          reason: synthError instanceof Error ? synthError.message : "Unknown error" 
        });
      }
    } catch (error) {
      console.error("TTS Error:", error);
      res.status(500).json({ 
        error: "Failed to process text-to-speech request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Speech-to-Text streaming endpoint
  app.post("/api/stt", (req, res) => {
    try {
      if (!process.env.SPEECH_KEY || !process.env.SPEECH_REGION) {
        return res.status(500).json({ 
          error: "Speech service credentials not configured",
          missing: !process.env.SPEECH_KEY ? "SPEECH_KEY" : "SPEECH_REGION"
        });
      }
      
      // Get the audio data from request
      const chunks: Buffer[] = [];
      
      req.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      req.on('end', async () => {
        try {
          const audioData = Buffer.concat(chunks);
          
          // Convert the audio data to the correct format for Azure
          const convertedAudio = await convertAudioBuffer(audioData);
          
          // Use our improved speech service to transcribe
          const transcription = await transcribeAudioBuffer(convertedAudio);
          
          res.json({ text: transcription });
        } catch (processError) {
          console.error("Error processing audio:", processError);
          res.status(500).json({ 
            error: "Speech recognition failed", 
            reason: processError instanceof Error ? processError.message : "Unknown error" 
          });
        }
      });
      
      req.on('error', (error) => {
        console.error("Error receiving audio data:", error);
        res.status(500).json({ error: "Error receiving audio data" });
      });
      
    } catch (error) {
      console.error("STT Error:", error);
      res.status(500).json({ 
        error: "Failed to process speech-to-text request",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
