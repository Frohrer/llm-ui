import { drizzle } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePostgres } from "drizzle-orm/node-postgres";
import pkg from 'pg';
const { Pool } = pkg;
import ws from "ws";
import * as schema from "@db/schema";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Initialize database connection based on environment
const isDevelopment = process.env.NODE_ENV !== 'production';

let db;
if (isDevelopment) {
  // For development, use Neon serverless with WebSocket
  db = drizzle({
    connection: process.env.DATABASE_URL,
    schema,
    ws: ws,
  });
} else {
  // For production (Docker), use regular PostgreSQL connection
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  db = drizzlePostgres(pool, { schema });
}

export { db };