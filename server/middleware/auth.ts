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
        is_admin: boolean;
      };
    }
  }
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: "Forbidden - Admin access required" });
  }
  next();
}

const adminEmails = new Set(
  (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

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

    // Attach user to request — env var overrides DB flag
    const isAdmin = user.is_admin || adminEmails.has(user.email.toLowerCase());

    req.user = {
      id: user.id,
      email: user.email,
      is_admin: isAdmin,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Internal server error during authentication" });
  }
}