import express, { Request, Response } from "express";
import { db } from "@db";
import { piiEntities, piiSettings } from "@db/schema";
import { desc, eq } from "drizzle-orm";
import { invalidatePiiCache, registerEntity } from "../../pii-service";

const router = express.Router();

const ENTITY_TYPES = ["name", "email", "phone", "ssn", "credit_card", "ip", "address", "custom"] as const;
const ENTITY_STATUSES = ["active", "false_positive", "allowlisted"] as const;

/**
 * GET /api/admin/pii/settings
 */
router.get("/settings", async (_req: Request, res: Response) => {
  try {
    let [row] = await db.select().from(piiSettings).limit(1);
    if (!row) {
      [row] = await db.insert(piiSettings).values({}).returning();
    }
    res.json(row);
  } catch (error) {
    console.error("Error fetching PII settings:", error);
    res.status(500).json({ error: "Failed to fetch PII settings" });
  }
});

/**
 * PUT /api/admin/pii/settings
 * Body: { enabled?, classifier_enabled?, classifier_model? }
 */
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const { enabled, classifier_enabled, classifier_model } = req.body;
    const updates: Record<string, any> = { updated_at: new Date() };
    if (typeof enabled === "boolean") updates.enabled = enabled;
    if (typeof classifier_enabled === "boolean") updates.classifier_enabled = classifier_enabled;
    if (typeof classifier_model === "string" && classifier_model.trim()) {
      updates.classifier_model = classifier_model.trim();
    }

    let [row] = await db.select().from(piiSettings).limit(1);
    if (!row) {
      [row] = await db.insert(piiSettings).values({}).returning();
    }
    const [updated] = await db
      .update(piiSettings)
      .set(updates)
      .where(eq(piiSettings.id, row.id))
      .returning();

    invalidatePiiCache();
    res.json(updated);
  } catch (error) {
    console.error("Error updating PII settings:", error);
    res.status(500).json({ error: "Failed to update PII settings" });
  }
});

/**
 * GET /api/admin/pii/entities
 * Full dictionary, newest first. Small enough to filter client-side.
 */
router.get("/entities", async (_req: Request, res: Response) => {
  try {
    const entities = await db
      .select()
      .from(piiEntities)
      .orderBy(desc(piiEntities.created_at));
    res.json(entities);
  } catch (error) {
    console.error("Error fetching PII entities:", error);
    res.status(500).json({ error: "Failed to fetch PII entities" });
  }
});

/**
 * POST /api/admin/pii/entities
 * Manual add. Body: { value, type, status? }
 * status "allowlisted" is how admins pre-approve terms like "Philadelphia".
 */
router.post("/entities", async (req: Request, res: Response) => {
  try {
    const { value, type, status } = req.body;
    if (typeof value !== "string" || !value.trim()) {
      return res.status(400).json({ error: "value is required" });
    }
    const entityType = ENTITY_TYPES.includes(type) ? type : "custom";
    const entityStatus = ENTITY_STATUSES.includes(status) ? status : "active";

    const entity = await registerEntity(value, entityType, "manual", entityStatus);
    if (!entity) {
      return res.status(500).json({ error: "Failed to create entity" });
    }
    // registerEntity returns the pre-existing row on value conflict; make the
    // requested status win in that case so re-adding acts as an update.
    if (entity.status !== entityStatus || entity.source !== "manual") {
      const [updated] = await db
        .update(piiEntities)
        .set({ status: entityStatus, updated_at: new Date() })
        .where(eq(piiEntities.id, entity.id))
        .returning();
      invalidatePiiCache();
      return res.json(updated);
    }
    res.json(entity);
  } catch (error) {
    console.error("Error creating PII entity:", error);
    res.status(500).json({ error: "Failed to create PII entity" });
  }
});

/**
 * PATCH /api/admin/pii/entities/:id
 * Status transitions: mark false positive, allowlist, or re-activate.
 */
router.patch("/entities/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    if (!Number.isInteger(id) || !ENTITY_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Valid id and status required" });
    }

    const [updated] = await db
      .update(piiEntities)
      .set({ status, updated_at: new Date() })
      .where(eq(piiEntities.id, id))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Entity not found" });
    }
    invalidatePiiCache();
    res.json(updated);
  } catch (error) {
    console.error("Error updating PII entity:", error);
    res.status(500).json({ error: "Failed to update PII entity" });
  }
});

/**
 * DELETE /api/admin/pii/entities/:id
 * Hard delete. Note: any tag already stored upstream in an old model context
 * will no longer restore once deleted — prefer marking false_positive.
 */
router.delete("/entities/:id", async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: "Valid id required" });
    }
    const [deleted] = await db
      .delete(piiEntities)
      .where(eq(piiEntities.id, id))
      .returning();
    if (!deleted) {
      return res.status(404).json({ error: "Entity not found" });
    }
    invalidatePiiCache();
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting PII entity:", error);
    res.status(500).json({ error: "Failed to delete PII entity" });
  }
});

export default router;
