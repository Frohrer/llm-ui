import express, { Request, Response } from "express";
import { db } from "@db";
import { modelSettings } from "@db/schema";
import { eq, and, asc, sql } from "drizzle-orm";
import { getOpenAIClient } from "../providers/openai";
import { getAnthropicClient } from "../providers/anthropic";
import { getDeepSeekClient } from "../providers/deepseek";
import { getGrokClient } from "../providers/grok";
import { getOllamaClient } from "../providers/ollama";
import { getModelDisplayInfo } from "../../config/known-models";

const router = express.Router();

// Providers that only use static config (no API discovery)
const STATIC_ONLY_PROVIDERS = new Set(["falai", "super-model"]);

// Per-provider chat model filters
const PROVIDER_CHAT_FILTERS: Record<string, {
  include?: RegExp[];
  exclude?: RegExp[];
}> = {
  openai: {
    include: [/^gpt-/, /^o1/, /^o3/, /^o4/, /^chatgpt-/],
    exclude: [
      /^whisper-/, /^tts-/, /^dall-e-/, /^text-embedding-/, /^moderation-/,
      /^davinci/, /^babbage/, /^curie/, /^ada/, /^text-/, /^code-/, /^canary-/,
      /-realtime-/, /-audio-/, /^omni-/, /^gpt-4o-transcribe/, /^gpt-4o-mini-transcribe/,
      /^gpt-4o-mini-tts/,
    ],
  },
  anthropic: {
    include: [/^claude-/],
  },
  deepseek: {
    include: [/^deepseek-/],
    exclude: [/embedding/],
  },
  grok: {
    include: [/^grok-/],
    exclude: [/image/],
  },
  gemini: {
    // Gemini filtering is done in fetchModelsFromApi via supportedGenerationMethods
  },
  ollama: {
    // Include all — user-managed local models
  },
};

function isChatModelForProvider(modelId: string, providerId: string): boolean {
  const filter = PROVIDER_CHAT_FILTERS[providerId];
  if (!filter) return true; // No filter = include all

  // Check exclusions first
  if (filter.exclude) {
    for (const pattern of filter.exclude) {
      if (pattern.test(modelId)) return false;
    }
  }

  // Check inclusions (if defined)
  if (filter.include && filter.include.length > 0) {
    for (const pattern of filter.include) {
      if (pattern.test(modelId)) return true;
    }
    return false; // Has include patterns but none matched
  }

  return true; // No include patterns = include all that pass exclusions
}

type NormalizedModel = {
  id: string;
  owned_by: string;
  displayName?: string;
  contextLength?: number;
  publishedAt?: Date;
};

async function fetchModelsFromApi(providerId: string): Promise<NormalizedModel[]> {
  switch (providerId) {
    case "openai":
    case "deepseek":
    case "grok":
    case "ollama": {
      // All use OpenAI-compatible SDK
      let client;
      if (providerId === "openai") client = getOpenAIClient();
      else if (providerId === "deepseek") client = getDeepSeekClient();
      else if (providerId === "grok") client = getGrokClient();
      else client = getOllamaClient();

      if (!client) {
        throw new Error(`${providerId} client not initialized`);
      }

      const apiModels = await client.models.list();
      const results: NormalizedModel[] = [];
      for await (const model of apiModels) {
        results.push({
          id: model.id,
          owned_by: model.owned_by,
          publishedAt: model.created ? new Date(model.created * 1000) : undefined,
        });
      }
      return results;
    }

    case "anthropic": {
      const client = getAnthropicClient();
      if (!client) {
        throw new Error("Anthropic client not initialized");
      }

      const page = await client.models.list({ limit: 1000 });
      return page.data.map((m: any) => ({
        id: m.id,
        owned_by: "anthropic",
        displayName: m.display_name || undefined,
        publishedAt: m.created_at ? new Date(m.created_at) : undefined,
      }));
    }

    case "gemini": {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY not set");
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`;
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Gemini API error: ${resp.status} ${resp.statusText}`);
      }

      const data = await resp.json();
      const models: NormalizedModel[] = [];

      for (const m of data.models || []) {
        // Filter to models that support generateContent
        const methods: string[] = m.supportedGenerationMethods || [];
        if (!methods.includes("generateContent")) continue;

        // Use the short model ID (strip "models/" prefix)
        const id = m.name?.replace(/^models\//, "") || m.baseModelId || m.name;
        models.push({
          id,
          owned_by: "google",
          displayName: m.displayName || undefined,
          contextLength: m.inputTokenLimit || undefined,
        });
      }
      return models;
    }

    default:
      throw new Error(`Unsupported provider for API fetch: ${providerId}`);
  }
}

/**
 * GET /api/admin/models/:providerId
 * List all models (enabled + disabled) from DB for a provider.
 * Ordered by sort_order (nulls last), then id.
 */
router.get("/:providerId", async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;

    const models = await db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.provider_id, providerId))
      .orderBy(sql`${modelSettings.sort_order} ASC NULLS LAST`, asc(modelSettings.id));

    res.json(models);
  } catch (error) {
    console.error("Error fetching model settings:", error);
    res.status(500).json({ error: "Failed to fetch model settings" });
  }
});

/**
 * POST /api/admin/models/:providerId/refresh
 * Fetch models from provider API, upsert results into DB, filter to chat models only.
 * New API-discovered models are disabled by default.
 */
router.post("/:providerId/refresh", async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;

    if (STATIC_ONLY_PROVIDERS.has(providerId)) {
      return res.status(400).json({ error: `${providerId} does not support model refresh` });
    }

    // Fetch models from provider API
    const apiModels = await fetchModelsFromApi(providerId);

    // Filter to chat models (Gemini is pre-filtered in fetchModelsFromApi)
    const chatModels = providerId === "gemini"
      ? apiModels
      : apiModels.filter((m) => isChatModelForProvider(m.id, providerId));

    // Get existing models from DB
    const existingModels = await db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.provider_id, providerId));

    const existingModelIds = new Set(existingModels.map((m) => m.model_id));

    // Upsert: insert new models, update owned_by for existing ones
    let newCount = 0;
    let updatedCount = 0;

    for (const apiModel of chatModels) {
      const displayInfo = getModelDisplayInfo(apiModel.id, providerId);

      // Prefer API-provided values over known-models lookup
      const displayName = apiModel.displayName || displayInfo.name;
      const contextLength = apiModel.contextLength || displayInfo.contextLength;

      if (!existingModelIds.has(apiModel.id)) {
        // New model discovered from API — disabled by default
        await db.insert(modelSettings).values({
          provider_id: providerId,
          model_id: apiModel.id,
          display_name: displayName,
          context_length: contextLength,
          is_enabled: false,
          is_default: false,
          source: "api_discovered",
          owned_by: apiModel.owned_by,
          published_at: apiModel.publishedAt || null,
        });
        newCount++;
      } else {
        // Update owned_by and published_at for existing entries
        const updates: Record<string, any> = {
          owned_by: apiModel.owned_by,
          updated_at: new Date(),
        };
        if (apiModel.publishedAt) {
          updates.published_at = apiModel.publishedAt;
        }
        await db
          .update(modelSettings)
          .set(updates)
          .where(
            and(
              eq(modelSettings.provider_id, providerId),
              eq(modelSettings.model_id, apiModel.id),
            ),
          );
        updatedCount++;
      }
    }

    // Return updated list
    const updatedModels = await db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.provider_id, providerId))
      .orderBy(sql`${modelSettings.sort_order} ASC NULLS LAST`, asc(modelSettings.id));

    res.json({
      message: `Refresh complete: ${newCount} new models discovered, ${updatedCount} existing models updated`,
      newCount,
      updatedCount,
      models: updatedModels,
    });
  } catch (error) {
    console.error("Error refreshing models:", error);
    res.status(500).json({ error: "Failed to refresh models from API" });
  }
});

/**
 * POST /api/admin/models/:providerId/reorder
 * Persist a custom sort order. Body: { model_ids: string[] }
 * Array index becomes the sort_order value.
 */
router.post("/:providerId/reorder", async (req: Request, res: Response) => {
  try {
    const { providerId } = req.params;
    const { model_ids } = req.body;

    if (!Array.isArray(model_ids)) {
      return res.status(400).json({ error: "model_ids must be an array" });
    }

    for (let i = 0; i < model_ids.length; i++) {
      await db
        .update(modelSettings)
        .set({ sort_order: i, updated_at: new Date() })
        .where(
          and(
            eq(modelSettings.provider_id, providerId),
            eq(modelSettings.model_id, model_ids[i]),
          ),
        );
    }

    const updatedModels = await db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.provider_id, providerId))
      .orderBy(sql`${modelSettings.sort_order} ASC NULLS LAST`, asc(modelSettings.id));

    res.json(updatedModels);
  } catch (error) {
    console.error("Error reordering models:", error);
    res.status(500).json({ error: "Failed to reorder models" });
  }
});

/**
 * PATCH /api/admin/models/:providerId/:modelId
 * Toggle isEnabled, update displayName/contextLength for a specific model.
 */
router.patch("/:providerId/:modelId", async (req: Request, res: Response) => {
  try {
    const { providerId, modelId } = req.params;
    const { is_enabled, display_name, context_length } = req.body;

    const updates: Record<string, any> = { updated_at: new Date() };

    if (typeof is_enabled === "boolean") {
      updates.is_enabled = is_enabled;
    }
    if (typeof display_name === "string") {
      updates.display_name = display_name;
    }
    if (typeof context_length === "number") {
      updates.context_length = context_length;
    }

    const [updated] = await db
      .update(modelSettings)
      .set(updates)
      .where(
        and(
          eq(modelSettings.provider_id, providerId),
          eq(modelSettings.model_id, modelId),
        ),
      )
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Model setting not found" });
    }

    res.json(updated);
  } catch (error) {
    console.error("Error updating model setting:", error);
    res.status(500).json({ error: "Failed to update model setting" });
  }
});

export default router;
