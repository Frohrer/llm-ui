import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "@db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Parse the database URL to get host and port
const dbUrl = new URL(process.env.DATABASE_URL);
const host = dbUrl.hostname;
const port = dbUrl.port || process.env.PGPORT || "5432";

// Construct WebSocket URL with explicit port
const wsUrl = `ws://${host}:${port}/v2`;

console.log('Connecting to database with WebSocket URL:', wsUrl);

export const db = drizzle({
  connection: process.env.DATABASE_URL,
  schema,
  ws: {
    WebSocket: ws,
    wsEndpoint: wsUrl,
  },
});