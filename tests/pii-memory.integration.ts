/**
 * Integration checks against a live Postgres, exercising the real services
 * (no mocks): PII redaction scope, and the memory <-> conversation link.
 *
 * Needs DATABASE_URL pointed at a throwaway database — it writes and deletes
 * rows. See tests/README.md.
 *
 *   npm run test:integration
 */

import assert from "node:assert/strict";
import { db } from "../db";
import { conversations, memories, messages, piiEntities, piiSettings, users } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { invalidatePiiCache, redactContent, redactRequest, redactText } from "../server/pii-service";
import {
  createMemory,
  deleteMemoriesForConversation,
  isConversationHidden,
  searchPastConversations,
  supersedeMemory,
} from "../server/memory-service";

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.stack : err}`);
  }
}

// --- fixtures -----------------------------------------------------------

const [user] = await db
  .insert(users)
  .values({ email: `pii-memory-test-${Date.now()}@example.test` })
  .returning();

async function newConversation(title: string, hidden = false) {
  const [c] = await db
    .insert(conversations)
    .values({ title, user_id: user.id, provider: "anthropic", model: "claude-opus-4-5", is_nsfw: hidden })
    .returning();
  return c;
}

// PII on, with "Claude" registered as a person name — exactly the situation
// that was rewriting model ids.
await db.delete(piiSettings);
await db.insert(piiSettings).values({ enabled: true, classifier_enabled: false });
await db.delete(piiEntities).where(eq(piiEntities.value, "Claude"));
const [claude] = await db
  .insert(piiEntities)
  .values({ value: "Claude", type: "name", tag: "PII_NAME_TEST", status: "active", source: "manual" })
  .returning();
invalidatePiiCache();

// --- PII scope ----------------------------------------------------------

await test("the entity really is being redacted in prose", async () => {
  assert.equal(await redactText("ask Claude about it"), "ask [PII_NAME_TEST] about it");
});

await test("the model id IS a match for the entity — this is the bug being fixed", async () => {
  // What the old blanket deep-walk produced for the `model` field, and what
  // the request-level scoping now prevents from ever being applied there.
  assert.equal(
    await redactText("claude-opus-4-5-20251101"),
    "[PII_NAME_TEST]-opus-4-5-20251101",
  );
});

await test("a request's model id survives redaction, its prompt does not", async () => {
  const out = await redactRequest({
    model: "claude-opus-4-5-20251101",
    max_tokens: 1024,
    system: "You are Claude.",
    messages: [{ role: "user", content: "hi Claude" }],
    tools: [{ name: "claude_search", description: "Search as Claude" }],
  });
  assert.equal(out.model, "claude-opus-4-5-20251101");
  assert.equal(out.max_tokens, 1024);
  assert.equal(out.tools[0].name, "claude_search");
  assert.equal(out.system, "You are [PII_NAME_TEST].");
  assert.equal(out.messages[0].content, "hi [PII_NAME_TEST]");
});

await test("gemini model config: only systemInstruction is rewritten", async () => {
  const out = await redactRequest({ model: "gemini-2.5-pro", systemInstruction: "Claude is the user." });
  assert.equal(out.model, "gemini-2.5-pro");
  assert.equal(out.systemInstruction, "[PII_NAME_TEST] is the user.");
});

await test("content payloads are redacted throughout", async () => {
  const out = await redactContent([{ role: "user", content: "hi Claude" }]);
  assert.equal(out[0].content, "hi [PII_NAME_TEST]");
  assert.equal(out[0].role, "user");
});

// --- memory <-> conversation link ---------------------------------------

await test("hidden conversations report as hidden", async () => {
  const open = await newConversation("open chat");
  const hidden = await newConversation("hidden chat", true);
  assert.equal(await isConversationHidden(open.id), false);
  assert.equal(await isConversationHidden(hidden.id), true);
});

await test("deleting a conversation's memories removes exactly those rows", async () => {
  const a = await newConversation("chat A");
  const b = await newConversation("chat B");
  const fromA = await createMemory({ userId: user.id, kind: "fact", body: "Fact from chat A", sourceConversationId: a.id });
  const fromB = await createMemory({ userId: user.id, kind: "decision", body: "Totally unrelated decision in chat B", sourceConversationId: b.id });

  const removed = await deleteMemoriesForConversation(a.id);
  assert.equal(removed, 1);

  const survivors = await db.select({ id: memories.id }).from(memories).where(eq(memories.user_id, user.id));
  const ids = survivors.map((s) => s.id);
  assert.ok(!ids.includes(fromA.id), "chat A's memory should be gone");
  assert.ok(ids.includes(fromB.id), "chat B's memory should survive");
});

await test("deleting the superseding chat revives the superseded memory", async () => {
  const a = await newConversation("chat A");
  const b = await newConversation("chat B");
  const original = await createMemory({
    userId: user.id,
    kind: "preference",
    body: "Fred wants answers in French",
    sourceConversationId: a.id,
  });
  const replacement = await supersedeMemory(original.id, "Fred wants answers in German", {
    userId: user.id,
    conversationId: b.id,
  });
  assert.ok(replacement);

  const [beforeDelete] = await db.select().from(memories).where(eq(memories.id, original.id));
  assert.equal(beforeDelete.superseded_by, replacement!.id, "precondition: original is superseded");

  await deleteMemoriesForConversation(b.id);

  const [afterDelete] = await db.select().from(memories).where(eq(memories.id, original.id));
  assert.equal(afterDelete.superseded_by, null, "original must become active again, not stay pointing at a deleted row");
  const [gone] = await db.select().from(memories).where(eq(memories.id, replacement!.id));
  assert.equal(gone, undefined);
});

await test("deleting the conversation row cascades to its memories", async () => {
  const c = await newConversation("cascade chat");
  const m = await createMemory({ userId: user.id, kind: "fact", body: "Cascade test fact about widgets", sourceConversationId: c.id });
  // Delete the conversation directly, bypassing the route's explicit cleanup.
  await db.delete(conversations).where(eq(conversations.id, c.id));
  const [row] = await db.select().from(memories).where(eq(memories.id, m.id));
  assert.equal(row, undefined, "FK must be ON DELETE CASCADE, not SET NULL");
});

await test("cold-tier search skips hidden conversations", async () => {
  const open = await newConversation("open chat");
  const hidden = await newConversation("hidden chat", true);
  await db.insert(messages).values([
    { conversation_id: open.id, role: "user", content: "the zorblatt protocol is documented here" },
    { conversation_id: hidden.id, role: "user", content: "the zorblatt protocol is a secret" },
  ]);
  // content_search is filled by a trigger from migration 0002; populate it
  // directly so this test does not depend on the trigger being installed.
  await db.execute(sql`UPDATE messages SET content_search = to_tsvector('english', content) WHERE content_search IS NULL`);

  const hits = await searchPastConversations(user.id, "zorblatt");
  assert.ok(hits.length > 0, "expected at least the open conversation to match");
  assert.ok(
    hits.every((h) => h.conversation_id !== hidden.id),
    "hidden conversation must not appear in cold-tier results",
  );
});

// --- cleanup ------------------------------------------------------------

await db.delete(memories).where(eq(memories.user_id, user.id));
await db.delete(messages).where(
  sql`${messages.conversation_id} IN (SELECT id FROM conversations WHERE user_id = ${user.id})`,
);
await db.delete(conversations).where(eq(conversations.user_id, user.id));
await db.delete(users).where(eq(users.id, user.id));
await db.delete(piiEntities).where(eq(piiEntities.id, claude.id));
await db.delete(piiSettings);
invalidatePiiCache();

console.log(failures === 0 ? "\nAll integration tests passed." : `\n${failures} failing test(s).`);
process.exit(failures === 0 ? 0 : 1);
