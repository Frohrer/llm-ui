import type { Request, Response, NextFunction } from "express";
import { db } from "@db";
import { users } from "@db/schema";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        email: string;
      };
    }
  }
}

export async function cloudflareAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const isDevelopment = process.env.NODE_ENV !== 'production';
  const userEmail = req.headers["cf-access-authenticated-user-email"];

  // If no Cloudflare header in production, return unauthorized
  if (!isDevelopment && !userEmail) {
    return res.status(401).json({ error: "Unauthorized - No valid Cloudflare authentication" });
  }

  try {
    let user;

    if (!userEmail && isDevelopment) {
      // In development, use a test user if no Cloudflare header
      const testEmail = 'test@example.com';
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, testEmail))
        .limit(1);

      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({
            email: testEmail,
          })
          .returning();
        user = newUser;
      }
    } else if (typeof userEmail === "string") {
      // Try to find existing user with Cloudflare email
      [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, userEmail))
        .limit(1);

      // Create new user if they don't exist
      if (!user) {
        const [newUser] = await db
          .insert(users)
          .values({
            email: userEmail,
          })
          .returning();
        user = newUser;
      }
    }

    if (!user) {
      return res.status(401).json({ error: "Failed to authenticate user" });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Internal server error during authentication" });
  }
}