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
  const userEmail = req.headers["cf-access-authenticated-user-email"];

  if (!userEmail || typeof userEmail !== "string") {
    return res.status(401).json({ error: "Unauthorized - No valid Cloudflare authentication" });
  }

  try {
    // Try to find existing user
    let [user] = await db
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
