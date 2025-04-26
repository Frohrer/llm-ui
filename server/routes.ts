import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { db } from "@db";
import { loadProviderConfigs } from "./config/loader";
import { cloudflareAuthMiddleware } from "./middleware/auth";
import knowledgeRoutes from "./routes/knowledge";
import conversationsRoutes from "./routes/conversations";
import {
  openaiRouter,
  anthropicRouter,
  deepseekRouter,
  geminiRouter,
  falRouter,
  initializeOpenAI,
  initializeAnthropic,
  initializeDeepSeek,
  initializeGemini,
  initializeFal,
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
  fal: false
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

export function registerRoutes(app: Express): Server {
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

  // Register conversation routes
  app.use('/api/conversations', conversationsRoutes);

  // Register knowledge routes
  app.use('/api/knowledge', knowledgeRoutes);

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