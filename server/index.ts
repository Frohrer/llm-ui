import express, { type Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import https from "https";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Serve uploaded files
app.use("/uploads/images", express.static(path.join(process.cwd(), "uploads/images")));
app.use("/uploads/documents", express.static(path.join(process.cwd(), "uploads/documents")));
app.use("/uploads/screenshots", express.static(path.join(process.cwd(), "uploads/screenshots")));
// Increase JSON body size limit for all routes
app.use(
  express.json({
    limit: "50mb",
    verify: (req, res, buf) => {
      // Store raw body buffer for potential reuse
      if (buf && buf.length) {
        (req as any).rawBody = buf;
      }
    },
  }),
);
app.use(express.urlencoded({ extended: false, limit: "50mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "vitedev") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client
  const PORT = 5000;
  server.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT}`);
    log(`Version 3`);
  });

  // Optional: Set up HTTPS server for features requiring secure context (like microphone access)
  if (process.env.SSL_ENABLED === 'true') {
    const SSL_PORT = 5443;
    const sslKeyPath = process.env.SSL_KEY_PATH || './ssl/key.pem';
    const sslCertPath = process.env.SSL_CERT_PATH || './ssl/cert.pem';

    if (fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath)) {
      const httpsOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
      };

      const httpsServer = https.createServer(httpsOptions, app);
      
      // Copy WebSocket upgrade handler to HTTPS server
      httpsServer.on('upgrade', server.listeners('upgrade')[0]);

      httpsServer.listen(SSL_PORT, "0.0.0.0", () => {
        log(`HTTPS server listening on port ${SSL_PORT}`);
        log(`Access via: https://localhost:${SSL_PORT}`);
      });
    } else {
      log(`SSL enabled but certificate files not found at ${sslKeyPath} and ${sslCertPath}`);
    }
  }

  // Graceful shutdown handling
  const gracefulShutdown = async (signal: string) => {
    log(`Received ${signal}, shutting down gracefully...`);
    
    // Close HTTP server
    server.close(() => {
      log("HTTP server closed.");
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      log("Forcing exit...");
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
})();
