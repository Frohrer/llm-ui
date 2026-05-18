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
 */

import { db } from "@db";
import { memories, messages, conversations } from "@db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { generateText } from "ai";
import OpenAI from "openai";
import { getAnthropicModel } from "./ai-sdk-providers";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

const ALWAYS_ON_LIMIT = 8;        // pinned + heavy-use, regardless of similarity
const SEMANTIC_LIMIT = 8;         // top-K by cosine similarity to current message
const SEMANTIC_THRESHOLD = 0.35;  // cosine similarity floor (0..1) — below this is noise
const SEMANTIC_CANDIDATE_CAP = 500; // hard cap on memories we score per turn
const RECENT_HISTORY_LIMIT = 8;
const EXTRACTION_DEBOUNCE_MS = 5000;
const EXTRACTOR_MODEL = "claude-haiku-4-5-20251001";
const EMBEDDING_MODEL = "text-embedding-3-small";

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
      input: trimmed,
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
  const [alwaysOn, semantic] = await Promise.all([
    fetchAlwaysOn(userId),
    fetchSemanticMatched(userId, opts.latestUserMessage),
  ]);

  const seen = new Set<number>();
  const all = [...alwaysOn, ...semantic].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  if (all.length === 0) return "";

  void touchUsage(all.map((m) => m.id)).catch(() => {});
  return formatMemoryBlock(all);
}

async function fetchAlwaysOn(userId: number) {
  return db
    .select()
    .from(memories)
    .where(and(eq(memories.user_id, userId), isNull(memories.superseded_by)))
    .orderBy(desc(memories.pinned), desc(memories.use_count), desc(memories.updated_at))
    .limit(ALWAYS_ON_LIMIT);
}

/**
 * Embed the latest user message once, score all active memories with embeddings
 * by cosine similarity, return the top hits above SEMANTIC_THRESHOLD.
 *
 * This scans up to SEMANTIC_CANDIDATE_CAP memories per turn. Fine for v1
 * (a single user accumulating thousands of memories is unlikely soon). When
 * it stops being fine, switch to pgvector + IVFFlat.
 */
async function fetchSemanticMatched(userId: number, latestUserMessage?: string) {
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
        isNotNull(memories.embedding),
      ),
    )
    .orderBy(desc(memories.updated_at))
    .limit(SEMANTIC_CANDIDATE_CAP);

  const scored: Array<{ row: typeof candidates[number]; score: number }> = [];
  for (const row of candidates) {
    if (!row.embedding) continue;
    let vec: number[];
    try {
      vec = JSON.parse(row.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryVec, vec);
    if (score >= SEMANTIC_THRESHOLD) scored.push({ row, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, SEMANTIC_LIMIT).map((s) => s.row);
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

async function touchUsage(ids: number[]) {
  if (ids.length === 0) return;
  await db
    .update(memories)
    .set({ last_used_at: new Date(), use_count: sql`${memories.use_count} + 1` })
    .where(inArray(memories.id, ids));
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
  const [row] = await db
    .insert(memories)
    .values({
      user_id: input.userId,
      kind: input.kind,
      body: input.body,
      embedding: vec ? JSON.stringify(vec) : null,
      confidence: input.confidence ?? 70,
      pinned: input.pinned ?? false,
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
) {
  const vec = await embedText(newBody);
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

// ---------------------------------------------------------------------------
// Background extraction
// ---------------------------------------------------------------------------

const pendingExtractions = new Map<number, NodeJS.Timeout>();

// Per-conversation cursor: the id of the latest user message we've already
// extracted from. If, at extract time, no newer user message exists, we skip.
// In-memory only — a restart triggers one wasted extraction per active
// conversation, which is much cheaper than a schema migration would be.
const lastExtractedUserMsgId = new Map<number, number>();

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
  op: "create" | "supersede" | "delete";
  id?: number;
  kind?: "preference" | "fact" | "decision" | "open_thread" | "entity";
  body?: string;
  confidence?: number;
  pinned?: boolean;
}

/**
 * Read the recent tail of a conversation, ask Haiku to emit memory ops,
 * and apply them. Quiet on the happy path: errors logged, never thrown.
 */
export async function extractMemories(conversationId: number, userId: number): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) return;

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

  const existing = await db
    .select({ id: memories.id, kind: memories.kind, body: memories.body })
    .from(memories)
    .where(and(eq(memories.user_id, userId), isNull(memories.superseded_by)))
    .orderBy(desc(memories.updated_at))
    .limit(40);

  const existingBlock = existing.length
    ? existing.map((m) => `  ${m.id} [${m.kind}] ${m.body}`).join("\n")
    : "  (none)";

  const prompt = `You are a memory extractor for a conversational AI. Default is to save NOTHING. Only emit ops when you can name a concrete future conversation that would be worse off without this memory.

Each operation is one of:
  { "op": "create", "kind": "preference" | "fact" | "decision" | "open_thread" | "entity", "body": "<one or two sentences>", "confidence": 0-100, "pinned": true | false }
  { "op": "supersede", "id": <existing memory id>, "body": "<replacement>" }
  { "op": "delete", "id": <existing memory id> }

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
    const result = await generateText({ model, prompt, temperature: 0.2 });
    const text = result.text.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      console.warn("[memory] extractor returned non-array, skipping");
      return;
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
}
