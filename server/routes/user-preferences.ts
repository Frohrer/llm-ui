import { Router, type Request, type Response } from "express";
import { db } from "@db";
import { userPreferences } from "@db/schema";
import { eq } from "drizzle-orm";

const router = Router();

// GET user preferences
router.get("/preferences", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Find existing preferences
    const [preferences] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.user_id, req.user.id))
      .limit(1);

    if (preferences) {
      return res.json({
        primaryColor: preferences.primary_color,
        customPrompt: preferences.custom_prompt || "",
      });
    }

    // Return defaults if no preferences exist
    return res.json({
      primaryColor: "hsl(250 100% 60%)",
      customPrompt: "",
    });
  } catch (error) {
    console.error("Error fetching user preferences:", error);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

// POST/UPDATE user preferences
router.post("/preferences", async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { primaryColor, customPrompt } = req.body;

    // Validate input
    if (!primaryColor || typeof primaryColor !== "string") {
      return res.status(400).json({ error: "Invalid primary color" });
    }

    if (customPrompt !== undefined && typeof customPrompt !== "string") {
      return res.status(400).json({ error: "Invalid custom prompt" });
    }

    // Check if preferences exist
    const [existing] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.user_id, req.user.id))
      .limit(1);

    if (existing) {
      // Update existing preferences
      const [updated] = await db
        .update(userPreferences)
        .set({
          primary_color: primaryColor,
          custom_prompt: customPrompt || "",
          updated_at: new Date(),
        })
        .where(eq(userPreferences.user_id, req.user.id))
        .returning();

      return res.json({
        primaryColor: updated.primary_color,
        customPrompt: updated.custom_prompt || "",
      });
    } else {
      // Create new preferences
      const [created] = await db
        .insert(userPreferences)
        .values({
          user_id: req.user.id,
          primary_color: primaryColor,
          custom_prompt: customPrompt || "",
        })
        .returning();

      return res.json({
        primaryColor: created.primary_color,
        customPrompt: created.custom_prompt || "",
      });
    }
  } catch (error) {
    console.error("Error saving user preferences:", error);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

export default router;
