/**
 * Memory Service — persistent cross-conversation memory.
 *
 * Hot tier: distilled `memories` rows injected into every turn. Retrieval
 *           uses cosine similarity over OpenAI embeddings of `body`.
 * Cold tier: tsvector full-text search over the existing `messages` table,
 *            exposed both to retrieval here and to the model via the
 *            `search_past_conversations` tool.
 *
 * Lifecycle:
 *   - At chat time, retrieveForTurn() embeds the latest user message and
 *     returns a system-prompt block (pinned + top-K similar).
 *   - After a stream finishes, scheduleExtraction() debounces a background
 *     extractor that reads the conversation tail and proposes create /
 *     supersede / delete ops against the hot tier. Created/superseded
 *     memories are embedded inline.
 *
 * Chat linkage: every memory records the conversation it came from, and that
 *   link is enforced in both directions. Hidden (is_nsfw) chats never produce
 *   a memory and never appear in cold-tier search; deleting or hiding a chat
 *   deletes everything it taught the hot tier.
 */

import { db } from "@db";
import { memories, messages, conversations } from "@db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { generateText } from "ai";
import OpenAI from "openai";
import { getAnthropicModel } from "./ai-sdk-providers";
import { redactText, restoreText } from "./pii-service";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const PINNED_LIMIT = 8;           // always-on slice: pinned rows only
const SEMANTIC_LIMIT = 8;         // top-K by weighted score for current message
const SEMANTIC_THRESHOLD = 0.35;  // raw cosine floor (0..1) — below this is noise
const SEMANTIC_CANDIDATE_CAP = 500; // hard cap on memories we score per turn
const RECENT_HISTORY_LIMIT = 8;
const EXTRACTION_DEBOUNCE_MS = 5000;
const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";
const EMBEDDING_MODEL = "text-embedding-3-small";

// --- Decay / eviction ---
// A memory's effective strength halves every HALF_LIFE_DAYS[kind] days since
// it was last reinforced. Pinned rows are exempt. Below STRENGTH_FLOOR a row
// is invisible to retrieval and hard-deleted by the sweep.
const HALF_LIFE_DAYS: Record<string, number> = {
  open_thread: 14,
  fact: 90,
  entity: 90,
  decision: 120,
  preference: 365,
};
const DEFAULT_HALF_LIFE_DAYS = 90;
const STRENGTH_FLOOR = 0.15;
// FSRS-style stability (spaced repetition): each reinforcement multiplies the
// row's effective half-life by (1 + GROWTH * (1 - retrievability)) — a memory
// reinforced when nearly forgotten gains the most (the spacing effect), one
// reinforced seconds after the last gains ~nothing. Repeatedly-confirmed
// facts thus become effectively permanent without pinning.
const STABILITY_GROWTH = 1.5;
const STABILITY_CAP = 64;         // max half-life multiplier (~preference: 64y)
// Only strong semantic hits reinforce. Marginal matches (0.35–0.55) are still
// injected but do NOT reset the clock — otherwise the rich-get-richer loop
// reappears through the semantic path.
const REINFORCE_MIN_SIMILARITY = 0.55;
// Additive retrieval ranking (Stanford generative-agents style): weighted sum
// is more robust than a product when one signal is noisy.
const RANK_WEIGHT_SIMILARITY = 0.7;
const RANK_WEIGHT_STRENGTH = 0.3;
const DEDUP_SUPERSEDE_THRESHOLD = 0.88; // same-kind cosine: create becomes supersede
const DEDUP_IDENTICAL_THRESHOLD = 0.95; // same-kind cosine: create becomes reinforce
const PURGE_SUPERSEDED_AFTER_DAYS = 30; // recovery window for bad supersede chains
const PURGE_EVICTED_AFTER_DAYS = 180;   // evicted (invalidated) rows linger this long
const REEMBED_BATCH = 5;                // null-embedding rows re-embedded per sweep
const CONSOLIDATE_EVERY_N_EXTRACTIONS = 10;
const CONSOLIDATE_ACTIVE_THRESHOLD = 60; // ...or when active count exceeds this
const EXTRACTOR_CONTEXT_SIMILAR = 20;   // similarity-ranked memories shown to extractor
const EXTRACTOR_CONTEXT_RECENT = 10;    // plus most-recent, plus all pinned

// ---------------------------------------------------------------------------
// Embedding helper
// ---------------------------------------------------------------------------

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

/**
 * Embed `text` via OpenAI text-embedding-3-small.
 * Returns null on missing key or API failure — callers fall back gracefully
 * (memory still saves; retrieval just skips the row this turn).
 */
async function embedText(text: string): Promise<number[] | null> {
  const client = getOpenAI();
  if (!client) return null;
  const trimmed = text.trim().slice(0, 8000);
  if (!trimmed) return null;
  try {
    const result = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      // Redacted so raw PII never reaches the embeddings API. Consistent on
      // both sides: memory bodies and retrieval queries embed the same tags,
      // so similarity between them is unaffected.
      input: await redactText(trimmed),
    });
    return result.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[memory] embedding failed:", err);
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Decay model
// ---------------------------------------------------------------------------

type MemoryRow = typeof memories.$inferSelect;

/** Seed strength from extractor confidence: conf 70 → 0.85, conf 100 → 1.0. */
function seedStrength(confidence: number): number {
  return 0.5 + Math.min(100, Math.max(0, confidence)) / 200;
}

function reinforcedAt(m: Pick<MemoryRow, "last_reinforced_at" | "updated_at" | "created_at">): Date {
  return m.last_reinforced_at ?? m.updated_at ?? m.created_at;
}

/** Kind's base half-life times the row's earned stability multiplier. */
function effectiveHalfLifeDays(m: Pick<MemoryRow, "kind" | "stability">): number {
  return (HALF_LIFE_DAYS[m.kind] ?? DEFAULT_HALF_LIFE_DAYS) * Math.max(1, m.stability);
}

/** Decay fraction in (0, 1]: 0.5^(days_since_reinforced / effective_half_life). */
function retrievability(m: MemoryRow): number {
  const ageDays = Math.max(0, Date.now() - reinforcedAt(m).getTime()) / 86_400_000;
  return Math.pow(0.5, ageDays / effectiveHalfLifeDays(m));
}

/** strength * retrievability. Pinned rows don't decay. */
function effectiveStrength(m: MemoryRow): number {
  if (m.pinned) return m.strength;
  return m.strength * retrievability(m);
}

// The eviction sweep needs the same decay formula in SQL. Generate the
// half-life CASE from HALF_LIFE_DAYS so the TS and SQL versions can't drift.
const HALF_LIFE_CASE_SQL = `CASE "kind" ${Object.entries(HALF_LIFE_DAYS)
  .map(([kind, days]) => `WHEN '${kind}' THEN ${days}`)
  .join(" ")} ELSE ${DEFAULT_HALF_LIFE_DAYS} END`;

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

export interface MemoryRetrievalOpts {
  /** Latest user message — used to embed for semantic recall. */
  latestUserMessage?: string;
}

/**
 * Build the persistent-memory block to splice into the system prompt.
 * Returns "" if the user has no memories.
 */
export async function retrieveForTurn(
  userId: number,
  opts: MemoryRetrievalOpts = {},
): Promise<string> {
  const [pinned, semantic] = await Promise.all([
    fetchPinned(userId),
    fetchSemanticMatched(userId, opts.latestUserMessage),
  ]);

  const seen = new Set<number>();
  const all = [...pinned, ...semantic.map((s) => s.row)].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  if (all.length === 0) return "";

  void touchUsage(all.map((m) => m.id)).catch(() => {});
  // Only strong semantic hits reset the decay clock. Pinned injection is
  // deliberately NOT a reinforcement signal — that was the rich-get-richer bug.
  const strongHits = semantic
    .filter((s) => s.similarity >= REINFORCE_MIN_SIMILARITY)
    .map((s) => s.row.id);
  void reinforceMemories(strongHits, userId).catch(() => {});
  return formatMemoryBlock(all);
}

async function fetchPinned(userId: number) {
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        eq(memories.pinned, true),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(PINNED_LIMIT);
}

/**
 * Embed the latest user message once, score all active memories with embeddings
 * by cosine similarity, return the top hits above SEMANTIC_THRESHOLD.
 *
 * Ranking is an additive weighted sum (generative-agents style): rank =
 * 0.7 * cosine + 0.3 * min(1, effective strength), so a decayed exact match
 * still beats fresh noise. Rows below STRENGTH_FLOOR are invisible (the
 * sweep will invalidate them).
 *
 * This scans up to SEMANTIC_CANDIDATE_CAP memories per turn. Fine for v1
 * (a single user accumulating thousands of memories is unlikely soon). When
 * it stops being fine, switch to pgvector + IVFFlat.
 */
async function fetchSemanticMatched(
  userId: number,
  latestUserMessage?: string,
): Promise<Array<{ row: MemoryRow; similarity: number }>> {
  if (!latestUserMessage) return [];
  const queryVec = await embedText(latestUserMessage);
  if (!queryVec) return [];

  const candidates = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
        isNotNull(memories.embedding),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(SEMANTIC_CANDIDATE_CAP);

  const scored: Array<{ row: MemoryRow; similarity: number; rank: number }> = [];
  for (const row of candidates) {
    if (!row.embedding) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const similarity = cosineSimilarity(queryVec, vec);
    if (similarity < SEMANTIC_THRESHOLD) continue;
    const eff = effectiveStrength(row);
    if (eff < STRENGTH_FLOOR) continue;
    const rank =
      RANK_WEIGHT_SIMILARITY * similarity + RANK_WEIGHT_STRENGTH * Math.min(1, eff);
    scored.push({ row, similarity, rank });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, SEMANTIC_LIMIT).map(({ row, similarity }) => ({ row, similarity }));
}

/**
 * Reset the decay clock and grow stability for genuinely-relevant rows.
 * Spacing effect: the closer a memory was to forgotten (low retrievability),
 * the bigger its stability gain; back-to-back reinforcement gains ~nothing.
 */
async function reinforceMemories(ids: number[], userId: number) {
  if (ids.length === 0) return;
  const rows = await db
    .select()
    .from(memories)
    .where(and(inArray(memories.id, ids), eq(memories.user_id, userId)));
  const now = new Date();
  for (const row of rows) {
    const r = row.pinned ? 1 : retrievability(row);
    const grown = Math.min(
      STABILITY_CAP,
      Math.max(1, row.stability) * (1 + STABILITY_GROWTH * (1 - r)),
    );
    // Does NOT touch updated_at: reinforcement isn't an edit, and updated_at
    // anchors the legacy-backfill coalesce in reinforcedAt().
    await db
      .update(memories)
      .set({ last_reinforced_at: now, stability: grown })
      .where(eq(memories.id, row.id));
  }
}

function formatMemoryBlock(rows: Array<{ kind: string; body: string }>): string {
  const groups: Record<string, string[]> = {};
  for (const row of rows) {
    (groups[row.kind] ||= []).push(row.body);
  }
  const order = ["preference", "decision", "fact", "open_thread", "entity"];
  const labels: Record<string, string> = {
    preference: "Preferences",
    decision: "Past decisions",
    fact: "Facts",
    open_thread: "Open threads",
    entity: "Entities",
  };
  const sections: string[] = [];
  for (const kind of order) {
    const items = groups[kind];
    if (!items?.length) continue;
    const body = items.map((b) => `- ${b}`).join("\n");
    sections.push(`${labels[kind]}:\n${body}`);
  }

  // The model is free to reference these items conversationally and to
  // claim "I've updated/noted that" when the user corrects something — the
  // background extractor reads the resulting transcript and acts on the
  // claim, so the loop self-fulfills. The one thing to forbid is dumping
  // the raw structured block verbatim (that's what caused the XML-echo bug).
  const preamble = [
    "Background context about this user, recalled from prior conversations.",
    "Use this information to inform your responses; reference items naturally when relevant.",
    "Do NOT dump or enumerate this section verbatim to the user.",
  ].join(" ");

  return `${preamble}\n\n${sections.join("\n\n")}`;
}

// Pure telemetry since the decay rework — nothing ranks on use_count anymore.
async function touchUsage(ids: number[]) {
  if (ids.length === 0) return;
  await db
    .update(memories)
    .set({ last_used_at: new Date(), use_count: sql`${memories.use_count} + 1` })
    .where(inArray(memories.id, ids));
}

/**
 * Semantic lookup over a user's active memories — backs the forget_memory
 * tool. Unlike fetchSemanticMatched, this applies no strength floor or
 * ranking weights: the caller wants raw "which memory says this?" matches.
 */
export async function findMemoriesByQuery(
  userId: number,
  query: string,
  opts: { limit?: number; minSimilarity?: number } = {},
): Promise<Array<{ row: MemoryRow; similarity: number }>> {
  const limit = opts.limit ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.5;
  const queryVec = await embedText(query);
  if (!queryVec) return [];

  const candidates = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
        isNotNull(memories.embedding),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(SEMANTIC_CANDIDATE_CAP);

  const scored: Array<{ row: MemoryRow; similarity: number }> = [];
  for (const row of candidates) {
    if (!row.embedding) continue;
    try {
      const similarity = cosineSimilarity(queryVec, JSON.parse(row.embedding));
      if (similarity >= minSimilarity) scored.push({ row, similarity });
    } catch {
      continue;
    }
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Cold-tier search (also backs the search_past_conversations tool)
// ---------------------------------------------------------------------------

export interface PastMessageHit {
  conversation_id: number;
  conversation_title: string;
  message_id: number;
  role: string;
  snippet: string;
  created_at: Date;
}

export async function searchPastConversations(
  userId: number,
  query: string,
  opts: { limit?: number; excludeConversationId?: number } = {},
): Promise<PastMessageHit[]> {
  const limit = Math.min(opts.limit ?? 10, 25);
  const q = query.trim();
  if (!q) return [];

  const rows = await db
    .select({
      conversation_id: messages.conversation_id,
      conversation_title: conversations.title,
      message_id: messages.id,
      role: messages.role,
      content: messages.content,
      created_at: messages.created_at,
      rank: sql<number>`ts_rank(${messages.content_search}, websearch_to_tsquery('english', ${q}))`,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversation_id, conversations.id))
    .where(
      and(
        eq(conversations.user_id, userId),
        // Hidden chats stay out of every other chat, cold tier included.
        eq(conversations.is_nsfw, false),
        sql`${messages.content_search} @@ websearch_to_tsquery('english', ${q})`,
        opts.excludeConversationId
          ? sql`${messages.conversation_id} != ${opts.excludeConversationId}`
          : sql`true`,
      ),
    )
    .orderBy(sql`ts_rank(${messages.content_search}, websearch_to_tsquery('english', ${q})) DESC`)
    .limit(limit);

  return rows.map((r) => ({
    conversation_id: r.conversation_id,
    conversation_title: r.conversation_title,
    message_id: r.message_id,
    role: r.role,
    snippet: snippet(r.content, q),
    created_at: r.created_at,
  }));
}

function snippet(content: string, query: string): string {
  const max = 240;
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const lower = content.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    idx = lower.indexOf(t);
    if (idx >= 0) break;
  }
  if (idx < 0) return content.slice(0, max);
  const start = Math.max(0, idx - 60);
  const end = Math.min(content.length, start + max);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Same-kind mechanical dedup. Returns the best match at or above
 * DEDUP_SUPERSEDE_THRESHOLD, or null. Same-kind only: cross-kind matching
 * would let a `fact` clobber a semantically-near `preference`.
 *
 * Deliberately searches EVICTED rows too — re-stating a decayed-out fact is
 * the resurrection path (the caller clears evicted_at).
 */
async function findSameKindDuplicate(
  userId: number,
  kind: MemoryRow["kind"],
  vec: number[],
): Promise<{ row: MemoryRow; similarity: number } | null> {
  const candidates = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        eq(memories.kind, kind),
        isNull(memories.superseded_by),
        isNotNull(memories.embedding),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(SEMANTIC_CANDIDATE_CAP);

  let best: MemoryRow | null = null;
  let bestScore = 0;
  for (const row of candidates) {
    if (!row.embedding) continue;
    let rowVec: number[];
    try {
      rowVec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(vec, rowVec);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best && bestScore >= DEDUP_SUPERSEDE_THRESHOLD
    ? { row: best, similarity: bestScore }
    : null;
}

export async function createMemory(input: {
  userId: number;
  kind: "preference" | "fact" | "decision" | "open_thread" | "entity";
  body: string;
  confidence?: number;
  pinned?: boolean;
  sourceConversationId?: number;
  sourceMessageId?: number;
}) {
  const vec = await embedText(input.body);

  // Mechanical dedup: a near-identical active memory means this "create" is
  // really a restatement. >= 0.95: reinforce the existing row. 0.88–0.95:
  // supersede it with the fresh phrasing. No embedding -> no dedup, insert.
  if (vec) {
    const match = await findSameKindDuplicate(input.userId, input.kind, vec);
    if (match) {
      // Resurrection: the fact decayed out but the user brought it up again.
      // Reactivate before the normal reinforce/supersede handling.
      if (match.row.evicted_at) {
        await db
          .update(memories)
          .set({ evicted_at: null, last_reinforced_at: new Date() })
          .where(eq(memories.id, match.row.id));
        match.row.evicted_at = null;
        console.log(`[memory] resurrected evicted memory ${match.row.id} for user ${input.userId}`);
      }
      let surviving: MemoryRow | null;
      if (match.similarity >= DEDUP_IDENTICAL_THRESHOLD) {
        await reinforceMemories([match.row.id], input.userId);
        surviving = match.row;
      } else {
        surviving = await supersedeMemory(
          match.row.id,
          input.body,
          {
            userId: input.userId,
            conversationId: input.sourceConversationId,
            messageId: input.sourceMessageId,
          },
          vec,
        );
      }
      if (surviving) {
        // Don't silently drop an explicit pin on the incoming fact.
        if (input.pinned && !surviving.pinned) {
          await db
            .update(memories)
            .set({ pinned: true, updated_at: new Date() })
            .where(eq(memories.id, surviving.id));
        }
        return surviving;
      }
    }
  }

  const [row] = await db
    .insert(memories)
    .values({
      user_id: input.userId,
      kind: input.kind,
      body: input.body,
      embedding: vec ? JSON.stringify(vec) : null,
      confidence: input.confidence ?? 70,
      pinned: input.pinned ?? false,
      strength: seedStrength(input.confidence ?? 70),
      stability: 1,
      last_reinforced_at: new Date(),
      source_conversation_id: input.sourceConversationId,
      source_message_id: input.sourceMessageId,
    })
    .returning();
  return row;
}

export async function supersedeMemory(
  oldId: number,
  newBody: string,
  ctx: { userId: number; conversationId?: number; messageId?: number },
  precomputedVec?: number[] | null,
) {
  const vec = precomputedVec ?? (await embedText(newBody));
  return db.transaction(async (tx) => {
    const [old] = await tx
      .select()
      .from(memories)
      .where(and(eq(memories.id, oldId), eq(memories.user_id, ctx.userId)))
      .limit(1);
    if (!old) return null;
    const [created] = await tx
      .insert(memories)
      .values({
        user_id: ctx.userId,
        kind: old.kind,
        body: newBody,
        embedding: vec ? JSON.stringify(vec) : null,
        confidence: old.confidence,
        pinned: old.pinned,
        // Re-confirmation restores full strength and carries earned stability.
        strength: Math.max(1, old.strength),
        stability: Math.max(1, old.stability),
        last_reinforced_at: new Date(),
        source_conversation_id: ctx.conversationId,
        source_message_id: ctx.messageId,
      })
      .returning();
    await tx
      .update(memories)
      .set({ superseded_by: created.id, updated_at: new Date() })
      .where(eq(memories.id, oldId));
    return created;
  });
}

export async function deleteMemory(id: number, userId: number) {
  await db.delete(memories).where(and(eq(memories.id, id), eq(memories.user_id, userId)));
}

/**
 * True when the conversation is marked hidden. Hidden chats are excluded from
 * memory entirely: nothing is extracted from them and nothing they produced
 * survives the moment they're hidden.
 */
export async function isConversationHidden(conversationId: number): Promise<boolean> {
  const [row] = await db
    .select({ is_nsfw: conversations.is_nsfw })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);
  return row?.is_nsfw === true;
}

/**
 * Delete every memory sourced from `conversationId` — called when the chat is
 * deleted, and when it's marked hidden.
 *
 * A memory that superseded one of these rows would otherwise be orphaned in
 * reverse: the older row stays flagged `superseded_by: <deleted id>` and is
 * invisible to retrieval forever. So the pointers are cleared first, which
 * revives the surviving predecessor instead of silently losing it. Returns
 * the number of rows deleted.
 */
export async function deleteMemoriesForConversation(conversationId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const doomed = await tx
      .select({ id: memories.id })
      .from(memories)
      .where(eq(memories.source_conversation_id, conversationId));
    if (doomed.length === 0) return 0;

    const ids = doomed.map((m) => m.id);
    await tx
      .update(memories)
      .set({ superseded_by: null, updated_at: new Date() })
      .where(inArray(memories.superseded_by, ids));
    await tx.delete(memories).where(inArray(memories.id, ids));
    return ids.length;
  });
}

/**
 * Reflection primitive: fold >=2 active source rows into one synthesized row
 * (generative-agents style). Sources are marked superseded by the new row —
 * lineage preserved, nothing deleted. The synthesis may change kind (e.g.
 * several completed open_threads generalize into one fact).
 */
export async function mergeMemories(input: {
  userId: number;
  kind: MemoryRow["kind"];
  body: string;
  sourceIds: number[];
}): Promise<MemoryRow | null> {
  const vec = await embedText(input.body);
  return db.transaction(async (tx) => {
    const sources = await tx
      .select()
      .from(memories)
      .where(
        and(
          inArray(memories.id, input.sourceIds),
          eq(memories.user_id, input.userId),
          isNull(memories.superseded_by),
        ),
      );
    if (sources.length < 2) return null;
    const [created] = await tx
      .insert(memories)
      .values({
        user_id: input.userId,
        kind: input.kind,
        body: input.body,
        embedding: vec ? JSON.stringify(vec) : null,
        confidence: Math.max(...sources.map((s) => s.confidence)),
        pinned: sources.some((s) => s.pinned),
        strength: Math.max(1, ...sources.map((s) => s.strength)),
        // The synthesis inherits the longest-lived source's earned stability —
        // a pattern distilled from several confirmations is not a fresh fact.
        stability: Math.max(1, ...sources.map((s) => s.stability)),
        last_reinforced_at: new Date(),
      })
      .returning();
    await tx
      .update(memories)
      .set({ superseded_by: created.id, updated_at: new Date() })
      .where(inArray(memories.id, sources.map((s) => s.id)));
    return created;
  });
}

// ---------------------------------------------------------------------------
// Background extraction
// ---------------------------------------------------------------------------

const pendingExtractions = new Map<number, NodeJS.Timeout>();

// Per-conversation cursor: the id of the latest user message we've already
// extracted from. If, at extract time, no newer user message exists, we skip.
// In-memory only — a restart triggers one wasted extraction per active
// conversation, which is much cheaper than a schema migration would be.
const lastExtractedUserMsgId = new Map<number, number>();

// Per-user counter driving the periodic consolidation janitor. In-memory only,
// same trade-off as above: a restart just delays the next janitor pass.
const extractionsSinceConsolidation = new Map<number, number>();

/**
 * Debounced fire-and-forget extractor trigger. Safe to call multiple times
 * per conversation in rapid succession (tool iterations + final assistant
 * message) — only the last call within the debounce window actually fires.
 */
export function scheduleExtraction(conversationId: number, userId: number) {
  const existing = pendingExtractions.get(conversationId);
  if (existing) clearTimeout(existing);
  const handle = setTimeout(() => {
    pendingExtractions.delete(conversationId);
    extractMemories(conversationId, userId).catch((err) => {
      console.error(`[memory] extraction failed for conversation ${conversationId}:`, err);
    });
  }, EXTRACTION_DEBOUNCE_MS);
  pendingExtractions.set(conversationId, handle);
}

interface ExtractorOp {
  op: "create" | "supersede" | "delete" | "reinforce" | "merge";
  id?: number;
  /** merge (janitor only): active source rows folded into the new body. */
  ids?: number[];
  kind?: "preference" | "fact" | "decision" | "open_thread" | "entity";
  body?: string;
  confidence?: number;
  pinned?: boolean;
}

/**
 * Existing-memory context shown to the extractor: all pinned rows, the most
 * recent rows, and the rows most similar to the conversation tail (Mem0-style
 * routing context). Recency alone made the extractor blind to older
 * duplicates — similarity is what dedup decisions actually need.
 */
async function fetchExtractorContext(userId: number, transcript: string): Promise<MemoryRow[]> {
  const active = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(SEMANTIC_CANDIDATE_CAP);

  // Small corpora fit wholesale — no need to rank.
  if (active.length <= EXTRACTOR_CONTEXT_SIMILAR + EXTRACTOR_CONTEXT_RECENT) {
    return active;
  }

  const picked = new Map<number, MemoryRow>();
  for (const m of active) if (m.pinned) picked.set(m.id, m);
  for (const m of active.slice(0, EXTRACTOR_CONTEXT_RECENT)) picked.set(m.id, m);

  const queryVec = await embedText(transcript.slice(-6000));
  if (queryVec) {
    const scored: Array<{ m: MemoryRow; score: number }> = [];
    for (const m of active) {
      if (!m.embedding || picked.has(m.id)) continue;
      try {
        scored.push({ m, score: cosineSimilarity(queryVec, JSON.parse(m.embedding)) });
      } catch {
        continue;
      }
    }
    scored.sort((a, b) => b.score - a.score);
    for (const { m } of scored.slice(0, EXTRACTOR_CONTEXT_SIMILAR)) picked.set(m.id, m);
  }
  return Array.from(picked.values());
}

/**
 * Read the recent tail of a conversation, ask Haiku to emit memory ops,
 * and apply them. Quiet on the happy path: errors logged, never thrown.
 */
export async function extractMemories(conversationId: number, userId: number): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;

  // Hidden chats never feed memory. Checked here rather than at schedule time
  // because the flag can be flipped during the debounce window, and this is
  // the last point before conversation text reaches the extractor model.
  if (await isConversationHidden(conversationId)) return;

  // Dedup: skip if no new user content since the last successful extraction.
  // Without this, each turn of a back-and-forth chat fires a fresh Haiku call,
  // even though most turns add nothing extraction-worthy.
  const [latestUserMsg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.conversation_id, conversationId), eq(messages.role, "user")))
    .orderBy(desc(messages.id))
    .limit(1);
  if (!latestUserMsg) return;
  const cursor = lastExtractedUserMsgId.get(conversationId);
  if (cursor !== undefined && latestUserMsg.id <= cursor) return;

  const recent = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(desc(messages.created_at))
    .limit(RECENT_HISTORY_LIMIT);

  if (recent.length === 0) return;
  const transcript = recent
    .reverse()
    .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 2000)}`)
    .join("\n\n");

  const existing = await fetchExtractorContext(userId, transcript);

  const existingBlock = existing.length
    ? existing
        .map((m) => `  ${m.id} [${m.kind}]${m.pinned ? " [pinned]" : ""} ${m.body}`)
        .join("\n")
    : "  (none)";

  const prompt = `You are a memory extractor for a conversational AI. Default is to save NOTHING. Only emit ops when you can name a concrete future conversation that would be worse off without this memory.

Each operation is one of:
  { "op": "create", "kind": "preference" | "fact" | "decision" | "open_thread" | "entity", "body": "<one or two sentences>", "confidence": 0-100, "pinned": true | false }
  { "op": "supersede", "id": <existing memory id>, "body": "<replacement>" }
  { "op": "delete", "id": <existing memory id> }
  { "op": "reinforce", "id": <existing memory id> }

REINFORCE when the conversation re-confirms an existing memory as accurate and still relevant — the user restated it, acted consistently with it, or it was clearly load-bearing for a good answer. Reinforce extends the memory's lifetime. Use it instead of superseding with near-identical wording, and instead of no-op when an existing memory demonstrably mattered this conversation.

SAVE ONLY user-specific information that:
- Is novel — would NOT already be known by a general-purpose LLM. Skip world facts, definitions, public knowledge, anything an LLM has in training.
- Is stable — describes the user, their work, their preferences, their decisions, their constraints. Not the topic of one conversation.
- Is load-bearing — a future answer would be wrong, awkward, or generic without it.

DO NOT SAVE:
- General knowledge (history, definitions, how things work in the world)
- Information the user could trivially restate ("I'm asking about X")
- Summaries of what the assistant just said or did
- Ephemeral task state (current bug, today's question, file they're editing now)
- Vague affect ("Fred seems frustrated", "Fred liked the answer")
- Memories that essentially duplicate or trivially extend an existing one — prefer "supersede" or skip
- Anything where the existing memories already cover it — bias hard toward no-op

PIN (set "pinned": true) only when the fact should influence EVERY future conversation, regardless of topic. Examples:
- Identity: name, role, employer, location, languages spoken
- Stylistic preferences: "wants concise answers", "no emojis", "formal tone"
- Hard rules: "always uses docker compose", "never recommend X"
Do NOT pin topic-specific preferences (favorite color, opinion on one country's politics, project-specific decisions) — those should surface via semantic recall, not always.

Other rules:
- Write the body self-contained — a future reader has NO surrounding conversation. Name the subject explicitly (not "it" or "this").
- Supersede instead of creating a near-duplicate. If existing memory already captures it, do nothing.
- If the user explicitly said "forget X", emit a delete op.
- Confidence: 90+ for direct statements ("my name is Fred"), 70-85 for clear inferences, below 70 = don't save.
- If nothing meets the bar, return [].

Existing memories for this user:
${existingBlock}

Recent conversation tail (oldest first):
${transcript}

Return ONLY a JSON array of operations, no commentary or markdown.`;

  let ops: ExtractorOp[];
  try {
    const model = getAnthropicModel(EXTRACTOR_MODEL);
    // Redacted: this prompt carries conversation/memory text to a hosted API.
    const result = await generateText({ model, prompt: await redactText(prompt), temperature: 0.2 });
    const parsed = parseOpsJson(result.text);
    if (!parsed) {
      console.warn("[memory] extractor returned non-array, skipping");
      return;
    }
    // The extractor only ever saw tags; memories store REAL values (the
    // injection path re-redacts at request time), so restore op bodies.
    for (const op of parsed) {
      if (op.body) op.body = await restoreText(op.body);
    }
    ops = parsed;
  } catch (err) {
    console.error("[memory] extractor call/parse failed:", err);
    return;
  }

  const [lastMsg] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversation_id, conversationId))
    .orderBy(desc(messages.created_at))
    .limit(1);

  for (const op of ops) {
    try {
      if (op.op === "create" && op.kind && op.body) {
        await createMemory({
          userId,
          kind: op.kind,
          body: op.body,
          confidence: op.confidence,
          pinned: op.pinned === true,
          sourceConversationId: conversationId,
          sourceMessageId: lastMsg?.id,
        });
      } else if (op.op === "supersede" && op.id && op.body) {
        await supersedeMemory(op.id, op.body, {
          userId,
          conversationId,
          messageId: lastMsg?.id,
        });
      } else if (op.op === "delete" && op.id) {
        await deleteMemory(op.id, userId);
      } else if (op.op === "reinforce" && op.id) {
        await reinforceMemories([op.id], userId);
      }
    } catch (err) {
      console.error("[memory] failed to apply op:", op, err);
    }
  }

  // Advance the cursor regardless of whether ops were applied — a no-op
  // extraction was still a valid one (we looked, found nothing new) and we
  // don't want to redo the same scan on the next debounce.
  lastExtractedUserMsgId.set(conversationId, latestUserMsg.id);

  if (ops.length > 0) {
    console.log(`[memory] applied ${ops.length} op(s) for user ${userId} from conversation ${conversationId}`);
  }

  // Lifecycle maintenance piggybacks on extraction — no separate scheduler.
  // Runs AFTER the ops loop so the sweep can't race an op targeting a row it
  // would delete (per-op try/catch tolerates the remaining ghosts anyway).
  try {
    await sweepDecayed(userId);
  } catch (err) {
    console.error(`[memory] sweep failed for user ${userId}:`, err);
  }

  const count = (extractionsSinceConsolidation.get(userId) ?? 0) + 1;
  extractionsSinceConsolidation.set(userId, count);
  if (
    count >= CONSOLIDATE_EVERY_N_EXTRACTIONS ||
    (await countActiveMemories(userId)) > CONSOLIDATE_ACTIVE_THRESHOLD
  ) {
    extractionsSinceConsolidation.set(userId, 0);
    try {
      await consolidateMemories(userId);
    } catch (err) {
      console.error(`[memory] consolidation failed for user ${userId}:`, err);
    }
  }
}

/** Strip an optional ```json fence and parse; null unless a JSON array. */
function parseOpsJson(text: string): ExtractorOp[] | null {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function countActiveMemories(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
      ),
    );
  return row?.count ?? 0;
}

// ---------------------------------------------------------------------------
// Eviction sweep
// ---------------------------------------------------------------------------

/**
 * Invalidate rows whose decayed strength fell below STRENGTH_FLOOR (Zep-style:
 * forgetting is loss of accessibility, not erasure), purge long-dead rows,
 * and re-embed a few embedding-less rows. Piggybacks on extraction; every
 * step is per-user and cheap.
 */
export async function sweepDecayed(userId: number): Promise<void> {
  // 1) Invalidate decayed, unpinned, active rows by stamping evicted_at.
  //    `embedding IS NOT NULL` matters: a row that never embedded can never
  //    be semantically reinforced, so evicting it would turn one transient
  //    embedding-API failure at create time into guaranteed loss.
  //    Half-life = kind base * earned stability, mirroring effectiveStrength().
  const evicted = await db
    .update(memories)
    .set({ evicted_at: new Date() })
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
        eq(memories.pinned, false),
        isNotNull(memories.embedding),
        sql`${memories.strength} * power(0.5, GREATEST(0, extract(epoch from (now() - coalesce(${memories.last_reinforced_at}, ${memories.updated_at}, ${memories.created_at})))) / 86400.0 / ((${sql.raw(HALF_LIFE_CASE_SQL)}) * GREATEST(1, ${memories.stability}))) < ${STRENGTH_FLOOR}`,
      ),
    )
    .returning({ id: memories.id, kind: memories.kind, body: memories.body });

  // 2) Hard-purge only long-dead rows: superseded past the recovery window,
  //    evicted rows nobody resurrected for months.
  await db
    .delete(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNotNull(memories.superseded_by),
        sql`${memories.updated_at} < now() - ${sql.raw(`interval '${PURGE_SUPERSEDED_AFTER_DAYS} days'`)}`,
      ),
    );
  await db
    .delete(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNotNull(memories.evicted_at),
        sql`${memories.evicted_at} < now() - ${sql.raw(`interval '${PURGE_EVICTED_AFTER_DAYS} days'`)}`,
      ),
    );

  // 3) Opportunistically re-embed rows whose embedding call failed at create,
  //    so they rejoin the semantic-reinforcement lifecycle.
  const missing = await db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
        isNull(memories.embedding),
      ),
    )
    .limit(REEMBED_BATCH);
  for (const row of missing) {
    const vec = await embedText(row.body);
    if (vec) {
      await db
        .update(memories)
        .set({ embedding: JSON.stringify(vec) })
        .where(eq(memories.id, row.id));
    }
  }

  // Tombstone log: forgetting is silent by design, but it shouldn't be
  // untraceable. `docker compose logs` answers "what did it just forget?"
  for (const row of evicted) {
    console.log(`[memory] evicted (invalidated) memory ${row.id} [${row.kind}] for user ${userId}: ${row.body}`);
  }
}

// ---------------------------------------------------------------------------
// Consolidation janitor
// ---------------------------------------------------------------------------

/**
 * Periodic LLM pass over the FULL active memory list (no conversation
 * context): merges paraphrase-duplicates the cosine dedup missed, deletes
 * completed/stale threads, rewrites stale phrasing, and — reflection — may
 * synthesize one higher-level memory out of several related rows via the
 * merge op. It can never invent memories from nothing: every merge must cite
 * source rows, which become superseded by the synthesis.
 */
export async function consolidateMemories(userId: number): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;

  const active = await db
    .select({
      id: memories.id,
      kind: memories.kind,
      body: memories.body,
      pinned: memories.pinned,
    })
    .from(memories)
    .where(
      and(
        eq(memories.user_id, userId),
        isNull(memories.superseded_by),
        isNull(memories.evicted_at),
      ),
    )
    .orderBy(desc(memories.updated_at));
  if (active.length < 2) return;

  const list = active
    .map((m) => `  ${m.id} [${m.kind}]${m.pinned ? " [pinned]" : ""} ${m.body}`)
    .join("\n");

  const prompt = `You are a memory janitor for a conversational AI. Below is the FULL list of stored memories for one user. Your job is consolidation: merge duplicates, remove stale entries, tighten wording, and distill patterns. Default is to change NOTHING.

Each operation is one of:
  { "op": "supersede", "id": <memory id>, "body": "<replacement, one or two sentences>" }
  { "op": "delete", "id": <memory id> }
  { "op": "merge", "ids": [<two or more memory ids>], "kind": "preference" | "fact" | "decision" | "open_thread" | "entity", "body": "<one or two sentences>" }

Apply ops ONLY for:
- Duplicates/paraphrases of the same underlying fact: merge them — cite all duplicate ids, keep the best phrasing, fold in any unique detail.
- Completed or abandoned open threads — one-off progress notes with no future value: delete.
- Bodies anchored to stale context ("currently", "this week", a clearly-finished task): supersede with a timeless phrasing, or delete if nothing timeless remains.
- Reflection: several related rows that together show a durable pattern (e.g. multiple completed threads about the same ongoing project or interest) may merge into ONE higher-level memory stating that pattern. The merged kind may differ from the sources (e.g. open_threads distill into a fact).

Rules:
- NEVER invent memories. Every merge must cite only ids listed below, and its body must be fully supported by the cited rows — no embellishment, no inference beyond what is written.
- Do not delete [pinned] rows unless they duplicate another row.
- Reflection merges should be rare and obviously right. When in doubt, leave rows alone.
- If the list is healthy, return [].

Memories:
${list}

Return ONLY a JSON array of operations, no commentary or markdown.`;

  let ops: ExtractorOp[];
  try {
    const model = getAnthropicModel(EXTRACTOR_MODEL);
    // Redacted: this prompt carries conversation/memory text to a hosted API.
    const result = await generateText({ model, prompt: await redactText(prompt), temperature: 0.2 });
    const parsed = parseOpsJson(result.text);
    if (!parsed) {
      console.warn("[memory] janitor returned non-array, skipping");
      return;
    }
    // Janitor saw tags; memories store REAL values (see extractMemories).
    for (const op of parsed) {
      if (op.body) op.body = await restoreText(op.body);
    }
    ops = parsed;
  } catch (err) {
    console.error("[memory] janitor call/parse failed:", err);
    return;
  }

  let applied = 0;
  for (const op of ops) {
    try {
      if (op.op === "supersede" && op.id && op.body) {
        await supersedeMemory(op.id, op.body, { userId });
        applied++;
      } else if (op.op === "delete" && op.id) {
        await deleteMemory(op.id, userId);
        applied++;
      } else if (op.op === "merge" && op.kind && op.body && (op.ids?.length ?? 0) >= 2) {
        const created = await mergeMemories({
          userId,
          kind: op.kind,
          body: op.body,
          sourceIds: op.ids!,
        });
        if (created) applied++;
      }
      // Bare "create" and anything else is deliberately ignored.
    } catch (err) {
      console.error("[memory] failed to apply janitor op:", op, err);
    }
  }

  if (applied > 0) {
    console.log(`[memory] janitor applied ${applied} op(s) for user ${userId}`);
  }
}
