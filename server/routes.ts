import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { loadProviderConfigs } from "./config/loader";
import { cloudflareAuthMiddleware } from "./middleware/auth";
import knowledgeRoutes from "./routes/knowledge";
import conversationsRoutes from "./routes/conversations";
import toolsRoutes from "./routes/tools";
import {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  grokRouter,
  superModelRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
  initializeGrok,
  initializeSuperModel,
  getSuperModelStatus,
} from "./routes/providers";
import { uploadSingleMiddleware, extractTextFromFile, transformUrlToProxy } from "./file-handler";

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
const clientsInitialized: Record<string, boolean> = {
  openai: false,
  anthropic: false,
  deepseek: false,
  gemini: false,
  fal: false,
  grok: false,
  superModel: false
};

// Initialize clients from environment variables
if (process.env.OPENAI_API_KEY) {
  clientsInitialized.openai = initializeOpenAI();
}

if (process.env.ANTHROPIC_API_KEY) {
  clientsInitialized.anthropic = initializeAnthropic();
}

if (process.env.DEEPSEEK_API_KEY) {
  clientsInitialized.deepseek = initializeDeepSeek();
}

if (process.env.GEMINI_API_KEY) {
  clientsInitialized.gemini = initializeGemini();
}

if (process.env.FAL_KEY) {
  clientsInitialized.fal = initializeFal();
}

if (process.env.XAI_KEY) {
  clientsInitialized.grok = initializeGrok();
}

// Initialize super model if all required providers are available
clientsInitialized.superModel = initializeSuperModel();

export async function registerRoutes(app: Express): Promise<Server> {
  // Health check endpoint (no auth required)
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      providers: clientsInitialized
    });
  });

  // Speech credentials route
  app.get('/api/speech-credentials', (req, res) => {
    res.json({
      key: process.env.AZURE_SPEECH_KEY,
      region: process.env.AZURE_SPEECH_REGION
    });
  });
  
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
            return clientsInitialized.openai;
          case "anthropic":
            return clientsInitialized.anthropic;
          case "deepseek":
            return clientsInitialized.deepseek;
          case "gemini":
            return clientsInitialized.gemini;
          case "falai":
            return clientsInitialized.fal;
          case "grok":
            return clientsInitialized.grok;
          case "super-model":
            return clientsInitialized.superModel;
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

  // Register provider routes
  app.use('/api/chat/openai', openaiRouter);
  app.use('/api/chat/anthropic', anthropicRouter);
  app.use('/api/chat/deepseek', deepseekRouter);
  app.use('/api/chat/gemini', geminiRouter);
  app.use('/api/chat/falai', falRouter);
  app.use('/api/chat/grok', grokRouter);
  app.use('/api/chat/super-model', superModelRouter);

  // Register conversation routes
  app.use('/api/conversations', conversationsRoutes);

  // Register knowledge routes
  app.use('/api/knowledge', knowledgeRoutes);

  // Register tools routes
  app.use('/api/tools', toolsRoutes);



  // Statistics endpoint: latency per model and token counts
  app.get('/api/stats', async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Import inside to avoid top-level cycles
      const { conversations, messages } = await import('@db/schema');
      const { eq, asc } = await import('drizzle-orm');

      // Pull all messages for the current user joined with conversation metadata
      const rows = await db
        .select({
          conversationId: conversations.id,
          model: conversations.model,
          provider: conversations.provider,
          messageId: messages.id,
          role: messages.role,
          content: messages.content,
          metadata: messages.metadata,
          createdAt: messages.created_at,
        })
        .from(conversations)
        .innerJoin(messages, eq(messages.conversation_id, conversations.id))
        .where(eq(conversations.user_id, req.user.id))
        .orderBy(asc(messages.created_at));

      type Row = typeof rows[number];

      // Helper: approximate tokens if not provided by provider
      const estimateTokenCount = (text: string | null | undefined): number => {
        if (!text) return 0;
        const EULER = 2.7182818284590;
        const len = text.length;
        const base = len / EULER;
        const margin = len > 2000 ? 8 : 2;
        return Math.ceil(base) + margin;
      };

      const lastUserTimestampByConversation = new Map<number, Date>();
      const lastUserApproxTokensByConversation = new Map<number, number>();
      const latencyEvents: { timestamp: string; model: string; provider: string; latencyMs: number }[] = [];
      const ttfbEvents: { timestamp: string; model: string; provider: string; ttfbMs: number }[] = [];
      const ttftEvents: { timestamp: string; model: string; provider: string; ttftMs: number }[] = [];
      let totalTokens = 0;
      const tokensPerModel = new Map<string, number>(); // key: `${provider}:${model}` -> total tokens (assistant messages, includes input+output via metadata if available)

      for (const row of rows) {
        const convId = row.conversationId as unknown as number;
        const model = row.model as unknown as string;
        const provider = row.provider as unknown as string;
        const createdAt = row.createdAt as unknown as Date;
        const key = `${provider}:${model}`;

        if (row.role === 'user') {
          // Track last user message timestamp and approx token count for latency/reference
          lastUserTimestampByConversation.set(convId, createdAt);
          const approxUserTokens = estimateTokenCount(row.content as unknown as string);
          lastUserApproxTokensByConversation.set(convId, approxUserTokens);
          continue;
        }

        if (row.role === 'assistant') {
          // Compute latency from most recent prior user message in the same conversation
          const userTs = lastUserTimestampByConversation.get(convId);
          if (userTs) {
            const latencyMs = Math.max(0, createdAt.getTime() - userTs.getTime());
            latencyEvents.push({ timestamp: createdAt.toISOString(), model, provider, latencyMs });
          }

          // Token counting: prefer provider usage metadata first
          let tokensForMsg = 0;
          const md: any = row.metadata as any;
          // Capture TTFT events if available
          if (md) {
            if (typeof md.ttfb_ms === 'number') {
              ttfbEvents.push({ timestamp: createdAt.toISOString(), model, provider, ttfbMs: md.ttfb_ms });
            }
            if (typeof md.ttft_ms === 'number') {
              ttftEvents.push({ timestamp: createdAt.toISOString(), model, provider, ttftMs: md.ttft_ms });
            }
          }

          if (md) {
            if (typeof md.total_tokens === 'number') {
              tokensForMsg = md.total_tokens;
            } else if (
              typeof md.input_tokens === 'number' || typeof md.output_tokens === 'number'
            ) {
              const inTok = typeof md.input_tokens === 'number' ? md.input_tokens : 0;
              const outTok = typeof md.output_tokens === 'number' ? md.output_tokens : 0;
              tokensForMsg = inTok + outTok;
            } else if (typeof md.approx_input_tokens === 'number') {
              // Fallback: approximate input tokens + estimate output tokens from assistant content
              const outputEstimate = estimateTokenCount(row.content as unknown as string);
              tokensForMsg = md.approx_input_tokens + outputEstimate;
            }
          }

          if (tokensForMsg === 0) {
            // Final fallback: approximate input from last user message + assistant content
            const approxUser = lastUserApproxTokensByConversation.get(convId) || 0;
            const approxAssistant = estimateTokenCount(row.content as unknown as string);
            tokensForMsg = approxUser + approxAssistant;
          }

          totalTokens += tokensForMsg;
          tokensPerModel.set(key, (tokensPerModel.get(key) || 0) + tokensForMsg);
        }
      }

      // Aggregate average per model
      const latencyAgg = new Map<string, { sum: number; count: number; model: string; provider: string }>();
      for (const e of latencyEvents) {
        const key = `${e.provider}:${e.model}`;
        const v = latencyAgg.get(key) || { sum: 0, count: 0, model: e.model, provider: e.provider };
        v.sum += e.latencyMs;
        v.count += 1;
        latencyAgg.set(key, v);
      }

      const avgLatencyPerModel = Array.from(latencyAgg.values()).map((v) => ({
        model: v.model,
        provider: v.provider,
        avgMs: v.count ? Math.round(v.sum / v.count) : 0,
        count: v.count,
      }));

      const ttfbAgg = new Map<string, { sum: number; count: number; model: string; provider: string }>();
      for (const e of ttfbEvents) {
        const key = `${e.provider}:${e.model}`;
        const v = ttfbAgg.get(key) || { sum: 0, count: 0, model: e.model, provider: e.provider };
        v.sum += e.ttfbMs;
        v.count += 1;
        ttfbAgg.set(key, v);
      }
      const avgTTFBPerModel = Array.from(ttfbAgg.values()).map((v) => ({
        model: v.model,
        provider: v.provider,
        avgMs: v.count ? Math.round(v.sum / v.count) : 0,
        count: v.count,
      }));

      const ttftAgg = new Map<string, { sum: number; count: number; model: string; provider: string }>();
      for (const e of ttftEvents) {
        const key = `${e.provider}:${e.model}`;
        const v = ttftAgg.get(key) || { sum: 0, count: 0, model: e.model, provider: e.provider };
        v.sum += e.ttftMs;
        v.count += 1;
        ttftAgg.set(key, v);
      }
      const avgTTFTPerModel = Array.from(ttftAgg.values()).map((v) => ({
        model: v.model,
        provider: v.provider,
        avgMs: v.count ? Math.round(v.sum / v.count) : 0,
        count: v.count,
      }));

      const tokensPerModelArr = Array.from(tokensPerModel.entries()).map(([k, total]) => {
        const [prov, mod] = k.split(':');
        return { provider: prov, model: mod, totalTokens: total };
      });

      // Limit latency events to most recent 200 for the chart
      const limitedLatencyEvents = latencyEvents.slice(-200);

      res.json({
        latencyEvents: limitedLatencyEvents,
        avgLatencyPerModel,
        ttfbEvents,
        avgTTFBPerModel,
        ttftEvents,
        avgTTFTPerModel,
        totalTokens,
        tokensPerModel: tokensPerModelArr,
      });
    } catch (error) {
      console.error('Stats endpoint error:', error);
      res.status(500).json({ error: 'Failed to compute stats' });
    }
  });

  // File upload route for chat attachments
  app.post('/api/upload', uploadSingleMiddleware, async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Get file path and determine if it's an image
      const filePath = req.file.path;
      const isImage = req.file.mimetype.startsWith('image/');
      
      // Create URL based on file type
      const baseUrl = process.env.BASE_URL || `http://${req.headers.host}`;
      const urlPath = isImage ? 'uploads/images/' : 'uploads/documents/';
      let url = `${baseUrl}/${urlPath}${req.file.filename}`;
      
      // Transform URL to use proxy domain if available
      url = transformUrlToProxy(url);
      
      // For documents, extract text content
      let text: string | undefined;
      if (!isImage) {
        try {
          text = await extractTextFromFile(filePath);
        } catch (extractError) {
          console.error('Error extracting text from file:', extractError);
          text = `[Error extracting text from ${req.file.originalname}]`;
        }
      }
      
      // Return file info to client
      res.json({
        file: {
          url,
          text,
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype
        }
      });
    } catch (error) {
      console.error('File upload error:', error);
      res.status(500).json({ error: 'File upload failed' });
    }
  });

  // Error handler middleware
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Server error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "An unknown error occurred",
    });
  });

  const server = createServer(app);
  return server;
}