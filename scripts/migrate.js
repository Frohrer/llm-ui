#!/usr/bin/env node

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';
import path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool);

async function runMigrations() {
  try {
    console.log("Starting database migration...");
    
    // Check if migrations directory exists
    const migrationsDir = path.join(process.cwd(), 'migrations');
    if (!fs.existsSync(migrationsDir)) {
      console.log("No migrations directory found, skipping migrations.");
      return;
    }

    // Run the migrations
    await migrate(db, { migrationsFolder: migrationsDir });
    
    console.log("Database migration completed successfully!");
  } catch (error) {
    console.error("Database migration failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run migrations if this script is executed directly
if (process.argv[1] === new URL(import.meta.url).pathname) {
  runMigrations().catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
}

export { runMigrations }; 