import { db } from "@db";
import { piiEntities, piiSettings, type SelectPiiEntity } from "@db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * PII redaction service.
 *
 * Real PII never leaves this machine: right before any upstream LLM call the
 * request payload is deep-walked and every known "active" entity value (plus
 * anything the inline regex detectors catch) is replaced with a stable tag
 * like [PII_EMAIL_3]. Tags coming back from the model are converted back to
 * the real values locally — in the SSE stream, before DB persistence, and in
 * tool-call arguments before tools execute (tools always operate on real
 * values).
 *
 * The dictionary is admin-governed (see routes/admin/pii.ts): detectors
 * auto-register new finds as `active` (fail-closed, nothing leaks on first
 * sight); the admin can demote entries to `false_positive` or `allowlisted`
 * ("Philadelphia" stays visible to the LLM for inference), or add manual
 * entries the detectors can't know (e.g. a person's name).
 */

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------

const SETTINGS_TTL_MS = 5_000;

interface PiiSettingsRow {
  enabled: boolean;
  classifier_enabled: boolean;
  classifier_model: string;
}

let settingsCache: { value: PiiSettingsRow; fetchedAt: number } | null = null;
let entitiesCache: SelectPiiEntity[] | null = null;
// Compiled from the active slice of entitiesCache; rebuilt on invalidation.
let compiled: {
  matcher: RegExp | null; // alternation of active values, longest first
  valueToTag: Map<string, string>; // lowercased value -> tag
  tagToValue: Map<string, string>; // tag -> canonical value
  knownValues: Set<string>; // lowercased values of ALL statuses (detector skip-list)
} | null = null;

export function invalidatePiiCache(): void {
  settingsCache = null;
  entitiesCache = null;
  compiled = null;
}

export async function getPiiSettings(): Promise<PiiSettingsRow> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.fetchedAt < SETTINGS_TTL_MS) {
    return settingsCache.value;
  }
  try {
    const [row] = await db.select().from(piiSettings).limit(1);
    const value: PiiSettingsRow = row ?? {
      enabled: false,
      classifier_enabled: false,
      classifier_model: "onnx-community/distilbert-NER-ONNX",
    };
    settingsCache = { value, fetchedAt: now };
    // Warm the NER pipeline in the background so the first redacted request
    // doesn't pay the model-load cost inline. Singleton — repeat calls no-op.
    if (value.enabled && value.classifier_enabled) {
      getNerPipeline(value.classifier_model).catch((err) =>
        console.error("[pii] NER warmup failed:", err),
      );
    }
    return value;
  } catch (error) {
    console.error("[pii] failed to load settings, treating as disabled:", error);
    return { enabled: false, classifier_enabled: false, classifier_model: "onnx-community/distilbert-NER-ONNX" };
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function getCompiled() {
  if (compiled) return compiled;
  entitiesCache = await db.select().from(piiEntities);

  const valueToTag = new Map<string, string>();
  const tagToValue = new Map<string, string>();
  const knownValues = new Set<string>();
  const activeValues: string[] = [];

  for (const e of entitiesCache) {
    knownValues.add(e.value.toLowerCase());
    // Restore map includes every status: if an entity is demoted after tags
    // already reached a model context, old tags in later responses still
    // resolve to the real value instead of leaking placeholder text to the UI.
    tagToValue.set(e.tag, e.value);
    if (e.status === "active") {
      valueToTag.set(e.value.toLowerCase(), e.tag);
      activeValues.push(e.value);
    }
  }

  // Longest-first so "Frederic Rohrer" wins over a hypothetical "Frederic".
  activeValues.sort((a, b) => b.length - a.length);
  const matcher = activeValues.length
    ? new RegExp(
        `(?<![A-Za-z0-9])(?:${activeValues.map(escapeRegExp).join("|")})(?![A-Za-z0-9])`,
        "gi",
      )
    : null;

  compiled = { matcher, valueToTag, tagToValue, knownValues };
  return compiled;
}

// ---------------------------------------------------------------------------
// Entity registration
// ---------------------------------------------------------------------------

type PiiType = "name" | "email" | "phone" | "ssn" | "credit_card" | "ip" | "address" | "custom";

/**
 * Insert (or fetch existing) entity for `value`. Tag is derived from the row
 * id after insert (PII_EMAIL_7), which is race-free without a counter table.
 */
export async function registerEntity(
  value: string,
  type: PiiType,
  source: "regex" | "classifier" | "manual",
  status: "active" | "false_positive" | "allowlisted" = "active",
): Promise<SelectPiiEntity | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const [inserted] = await db
      .insert(piiEntities)
      .values({
        value: trimmed,
        type,
        // Placeholder — replaced with the id-derived tag right below. Unique
        // so concurrent inserts never collide on the tag column.
        tag: `PENDING_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
        status,
        source,
      })
      .onConflictDoNothing({ target: piiEntities.value })
      .returning();

    if (!inserted) {
      // Value already exists (possibly under another status) — return it.
      const [existing] = await db
        .select()
        .from(piiEntities)
        .where(eq(piiEntities.value, trimmed))
        .limit(1);
      return existing ?? null;
    }

    const tag = `PII_${type.toUpperCase()}_${inserted.id}`;
    const [updated] = await db
      .update(piiEntities)
      .set({ tag, updated_at: new Date() })
      .where(eq(piiEntities.id, inserted.id))
      .returning();
    invalidatePiiCache();
    return updated;
  } catch (error) {
    console.error("[pii] failed to register entity:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Inline regex detectors (structured PII — deterministic, run on every
// outbound payload so brand-new PII is caught before its first upstream trip)
// ---------------------------------------------------------------------------

function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const DETECTORS: Array<{
  type: PiiType;
  regex: RegExp;
  validate?: (match: string) => boolean;
}> = [
  {
    type: "email",
    regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    type: "ssn",
    regex: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g,
  },
  {
    type: "credit_card",
    regex: /(?<![\d-])(?:\d[ -]?){13,16}(?![\d-])/g,
    validate: (m) => {
      const digits = m.replace(/[ -]/g, "");
      return digits.length >= 13 && digits.length <= 16 && luhnValid(digits);
    },
  },
  {
    type: "phone",
    // +country or (area) forms with separators; min 10 digits total to keep
    // false positives down (plain digit runs are NOT matched).
    regex: /(?<![\d\w])(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{3,4}[ .-]\d{3,4}(?:[ .-]\d{2,4})?(?![\d\w])/g,
    validate: (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15;
    },
  },
  {
    type: "ip",
    regex: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    validate: (m) => m.split(".").every((o) => Number(o) <= 255) &&
      // Loopback/private-lab addresses are rarely worth hiding and extremely
      // common in dev chats; leave them readable.
      !/^(127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(m),
  },
];

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/** Strings we never scan: data URLs and long unbroken blobs (base64, embeddings). */
function isOpaqueBlob(text: string): boolean {
  if (text.startsWith("data:") && text.includes(";base64,")) return true;
  return text.length > 2000 && !/\s/.test(text);
}

/**
 * Replace known active entities and freshly detected PII with tags.
 * New detector finds are registered as active entities (fail-closed).
 *
 * Detection is inline and synchronous — including the NER name classifier
 * when enabled — so PII is caught on the request where it FIRST appears
 * (typed fresh, replayed from history, or injected from a memory body into
 * the system prompt), not one turn later.
 */
export async function redactText(text: string): Promise<string> {
  if (typeof text !== "string" || !text) return text;
  const settings = await getPiiSettings();
  if (!settings.enabled) return text;
  if (isOpaqueBlob(text)) return text;

  // Pass 1a: register anything the regex detectors find that isn't
  // dictionaried yet.
  let c = await getCompiled();
  for (const det of DETECTORS) {
    det.regex.lastIndex = 0;
    const matches = text.match(det.regex) ?? [];
    for (const m of matches) {
      if (det.validate && !det.validate(m)) continue;
      if (c.knownValues.has(m.toLowerCase())) continue;
      await registerEntity(m, det.type, "regex", "active");
      c = await getCompiled(); // refresh so pass 2 sees the new entity
    }
  }

  // Pass 1b: inline NER for person names (fail-closed like the regexes).
  // Never blocks the request on classifier problems — worst case names fall
  // back to dictionary-only matching for this turn.
  if (settings.classifier_enabled) {
    try {
      const spans = await detectPersonNames(text, settings.classifier_model);
      for (const span of spans) {
        if (c.knownValues.has(span.toLowerCase())) continue; // incl. false positives + allowlist
        await registerEntity(span, "name", "classifier", "active");
        c = await getCompiled();
      }
    } catch (err) {
      console.error("[pii] inline NER failed, continuing with dictionary+regex only:", err);
    }
  }

  // Pass 2: replace all active values with their tags.
  if (!c.matcher) return text;
  c.matcher.lastIndex = 0;
  const { matcher, valueToTag } = c;
  return text.replace(matcher, (m) => {
    const tag = valueToTag.get(m.toLowerCase());
    return tag ? `[${tag}]` : m;
  });
}

/**
 * Deep-clone `payload` with every string redacted. Aimed at the exact request
 * object handed to a provider SDK, so messages, system prompts, and tool
 * results fed back upstream are all covered regardless of provider shape.
 */
export async function redactDeep<T>(payload: T): Promise<T> {
  const settings = await getPiiSettings();
  if (!settings.enabled) return payload;
  return walkRedact(payload) as Promise<T>;
}

async function walkRedact(node: any): Promise<any> {
  if (typeof node === "string") return redactText(node);
  if (Array.isArray(node)) {
    const out = new Array(node.length);
    for (let i = 0; i < node.length; i++) out[i] = await walkRedact(node[i]);
    return out;
  }
  if (node && typeof node === "object" && node.constructor === Object) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) out[k] = await walkRedact(v);
    return out;
  }
  return node;
}

// ---------------------------------------------------------------------------
// Restore (tag -> real value)
// ---------------------------------------------------------------------------

// Models occasionally drop the brackets, so both "[PII_EMAIL_3]" and bare
// "PII_EMAIL_3" resolve. Unknown tags are left untouched.
const TAG_RE = /\[?(PII_[A-Z_]+_\d+)\]?/g;

export async function restoreText(text: string): Promise<string> {
  if (typeof text !== "string" || !text || !text.includes("PII_")) return text;
  const c = await getCompiled();
  TAG_RE.lastIndex = 0;
  return text.replace(TAG_RE, (full, tag) => c.tagToValue.get(tag) ?? full);
}

export async function restoreDeep<T>(payload: T): Promise<T> {
  return walkRestore(payload) as Promise<T>;
}

async function walkRestore(node: any): Promise<any> {
  if (typeof node === "string") return restoreText(node);
  if (Array.isArray(node)) {
    const out = new Array(node.length);
    for (let i = 0; i < node.length; i++) out[i] = await walkRestore(node[i]);
    return out;
  }
  if (node && typeof node === "object" && node.constructor === Object) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) out[k] = await walkRestore(v);
    return out;
  }
  return node;
}

/**
 * Stateful restorer for SSE token streams. A tag can be split across chunk
 * boundaries ("[PII_EM" + "AIL_3]"), so a trailing partial-tag suffix is held
 * back until the next push. flush() at stream end returns whatever remains.
 */
export function createStreamRestorer() {
  let buf = "";
  // Longest text that could still grow into a tag: "[", "[PII", "[PII_EMA…".
  const partial = /\[?P?(?:I(?:I(?:_[A-Z_]*\d*)?)?)?$/;

  return {
    async push(chunk: string): Promise<string> {
      buf += chunk;
      // Find the earliest index from which the remaining text might be an
      // incomplete tag; emit everything before it.
      let holdFrom = buf.length;
      const windowStart = Math.max(0, buf.length - 40); // tags are short
      for (let i = buf.length - 1; i >= windowStart; i--) {
        const tail = buf.slice(i);
        if ((tail.startsWith("[") || tail.startsWith("P")) && partial.test(tail) && partial.exec(tail)?.index === 0) {
          holdFrom = i;
        }
      }
      const emit = buf.slice(0, holdFrom);
      buf = buf.slice(holdFrom);
      return emit ? restoreText(emit) : "";
    },
    async flush(): Promise<string> {
      const rest = buf;
      buf = "";
      return rest ? restoreText(rest) : "";
    },
  };
}

// ---------------------------------------------------------------------------
// NER classifier (person names) — in-process ONNX model, fire-and-forget
// ---------------------------------------------------------------------------
//
// Runs a quantized DistilBERT NER model (CoNLL-2003 labels) via
// @huggingface/transformers on CPU — ~65MB download on first use, then
// tens of milliseconds per message, entirely in-process so classification
// never leaves the machine. Only PER spans are registered: structured PII
// (emails, phones, ...) is the regex detectors' job, and LOC/ORG are
// deliberately ignored so places like "Philadelphia" stay visible to the
// LLM for inference unless an admin explicitly adds them.

const CLASSIFIER_SCORE_THRESHOLD = 0.85;
const CLASSIFIER_CHUNK_CHARS = 1000; // stay well under the model's 512-token limit

let nerPipelinePromise: Promise<any> | null = null;
let nerPipelineModel: string | null = null;

async function getNerPipeline(modelId: string) {
  if (!nerPipelinePromise || nerPipelineModel !== modelId) {
    nerPipelineModel = modelId;
    nerPipelinePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      // Cache model weights on the uploads volume so the one-time download
      // survives container rebuilds.
      env.cacheDir = "./uploads/.model-cache";
      return pipeline("token-classification", modelId, { dtype: "q8" });
    })().catch((err) => {
      // Reset so a transient failure (e.g. first-download network error)
      // retries on the next turn instead of caching the rejection forever.
      nerPipelinePromise = null;
      nerPipelineModel = null;
      throw err;
    });
  }
  return nerPipelinePromise;
}

/**
 * Post-turn hook: propose person-name entities from conversation text.
 * New finds are registered active (fail-closed); admin reviews them in the
 * PII panel and can demote false positives.
 */
export function schedulePiiClassification(text: string): void {
  if (!text || typeof text !== "string") return;
  setTimeout(() => {
    classify(text).catch((err) =>
      console.error("[pii] classifier run failed:", err),
    );
  }, 100);
}

/** Merge word-level B-PER/I-PER predictions back into full-name strings. */
function extractPersonSpans(tokens: Array<{ entity: string; word: string; score: number }>): string[] {
  const spans: string[] = [];
  let current: string[] = [];
  let scores: number[] = [];

  const flush = () => {
    if (current.length) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (avg >= CLASSIFIER_SCORE_THRESHOLD) spans.push(current.join(" "));
    }
    current = [];
    scores = [];
  };

  for (const t of tokens) {
    const isPer = t.entity === "B-PER" || t.entity === "I-PER";
    if (!isPer) {
      flush();
      continue;
    }
    if (t.word.startsWith("##")) {
      // Subword continuation — glue onto the previous piece.
      if (current.length) current[current.length - 1] += t.word.slice(2);
      else current.push(t.word.slice(2));
    } else if (t.entity === "B-PER" && current.length) {
      flush();
      current.push(t.word);
    } else {
      current.push(t.word);
    }
    scores.push(t.score);
  }
  flush();
  return spans;
}

// Inline NER runs on every outbound string; conversation history repeats
// verbatim each turn, so memoize per-string results (bounded FIFO).
const nerResultCache = new Map<string, string[]>();
const NER_CACHE_MAX = 2000;

/**
 * Run NER over `text` and return validated person-name spans. Used inline by
 * redactText (fail-closed name redaction) and by the post-turn sweep.
 */
async function detectPersonNames(text: string, modelId: string): Promise<string[]> {
  const cacheKey = `${modelId} ${text}`;
  const cached = nerResultCache.get(cacheKey);
  if (cached) return cached;

  const ner = await getNerPipeline(modelId);

  // Chunk long inputs — the model silently truncates past its token limit.
  const input = text.slice(0, 12_000);
  const chunks: string[] = [];
  for (let i = 0; i < input.length; i += CLASSIFIER_CHUNK_CHARS) {
    chunks.push(input.slice(i, i + CLASSIFIER_CHUNK_CHARS));
  }

  const candidates = new Set<string>();
  for (const chunk of chunks) {
    const tokens = await ner(chunk);
    for (const span of extractPersonSpans(tokens)) candidates.add(span);
  }

  const results: string[] = [];
  for (const raw of Array.from(candidates)) {
    const value = raw.trim();
    if (value.length < 3 || value.length > 120) continue;
    // Never re-classify our own placeholder tags.
    if (/PII_/i.test(value)) continue;
    // Require the reconstructed span to actually appear in the source text —
    // guards against subword-merge artifacts producing garbage values.
    if (!input.toLowerCase().includes(value.toLowerCase())) continue;
    results.push(value);
  }

  if (nerResultCache.size >= NER_CACHE_MAX) {
    // FIFO eviction — oldest entries are least likely to recur.
    const oldest = nerResultCache.keys().next().value;
    if (oldest !== undefined) nerResultCache.delete(oldest);
  }
  nerResultCache.set(cacheKey, results);
  return results;
}

async function classify(text: string): Promise<void> {
  const settings = await getPiiSettings();
  if (!settings.enabled || !settings.classifier_enabled) return;

  const spans = await detectPersonNames(text, settings.classifier_model);
  const c = await getCompiled();
  for (const value of spans) {
    if (c.knownValues.has(value.toLowerCase())) continue; // incl. false positives + allowlist
    await registerEntity(value, "name", "classifier", "active");
    console.log("[pii] classifier registered new name entity");
  }
}
