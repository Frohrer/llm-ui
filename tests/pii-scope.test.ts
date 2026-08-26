/**
 * Scope tests for PII redaction: it must rewrite context/prompt text and
 * nothing else. Runs the real walkers with a stand-in mapper (every string it
 * reaches becomes "<REDACTED>"), so the assertions are about WHICH strings
 * were reachable, not about the detector rules.
 *
 *   npm run test:pii-scope
 */

import assert from "node:assert/strict";
import { mapContentStrings, mapRequestStrings } from "../server/pii-scope";

const redact = async () => "<REDACTED>";

let failures = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err instanceof Error ? err.message : err}`);
  }
}

// --- Anthropic-shaped request -------------------------------------------
await test("anthropic request: prose redacted, params untouched", async () => {
  const out = await mapRequestStrings(
    {
      model: "claude-opus-4-5-20251101",
      max_tokens: 4096,
      stream: true,
      system: "You are helpful. Fred lives in Philadelphia.",
      messages: [{ role: "user", content: "my email is a@b.com" }],
      tools: [{ name: "send_email", description: "Send an email", input_schema: {} }],
    },
    redact,
  );

  assert.equal(out.model, "claude-opus-4-5-20251101");
  assert.equal(out.max_tokens, 4096);
  assert.equal(out.stream, true);
  assert.equal(out.tools[0].name, "send_email");
  assert.equal(out.tools[0].description, "Send an email");
  assert.equal(out.system, "<REDACTED>");
  assert.equal(out.messages[0].content, "<REDACTED>");
  assert.equal(out.messages[0].role, "user");
});

// --- Gemini model config (the reported bug) -----------------------------
await test("gemini modelConfig: model name survives, systemInstruction redacted", async () => {
  const out = await mapRequestStrings(
    { model: "gemini-2.5-pro", systemInstruction: "Fred prefers short answers." },
    redact,
  );
  assert.equal(out.model, "gemini-2.5-pro");
  assert.equal(out.systemInstruction, "<REDACTED>");
});

// --- OpenAI chat completions with a tool-call round-trip ----------------
await test("openai request: tool ids and function names survive", async () => {
  const out = await mapRequestStrings(
    {
      model: "gpt-5",
      temperature: 0.7,
      tool_choice: "auto",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "web_search", arguments: '{"q":"fred"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", name: "web_search", content: "results about Fred" },
      ],
    },
    redact,
  );
  assert.equal(out.model, "gpt-5");
  assert.equal(out.temperature, 0.7);
  assert.equal(out.tool_choice, "auto");
  assert.equal(out.messages[0].tool_calls[0].id, "call_1");
  assert.equal(out.messages[0].tool_calls[0].function.name, "web_search");
  assert.equal(out.messages[0].tool_calls[0].function.arguments, "<REDACTED>");
  assert.equal(out.messages[1].tool_call_id, "call_1");
  assert.equal(out.messages[1].name, "web_search");
  assert.equal(out.messages[1].content, "<REDACTED>");
});

// --- Content parts ------------------------------------------------------
await test("content parts: text redacted, block type and image data untouched", async () => {
  const out = await mapContentStrings(
    [
      { type: "text", text: "call me at 215 555 1212" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
    ],
    redact,
  );
  assert.equal(out[0].type, "text");
  assert.equal(out[0].text, "<REDACTED>");
  assert.equal(out[1].source.media_type, "image/png");
  assert.equal(out[1].source.data, "iVBORw0KGgo=");
});

// --- Bare payloads ------------------------------------------------------
await test("arrays and strings handed straight to an SDK are all content", async () => {
  assert.equal(await mapRequestStrings("hello", redact), "<REDACTED>");
  const parts = await mapRequestStrings([{ text: "hello" }], redact);
  assert.equal(parts[0].text, "<REDACTED>");
});

// --- Unknown API params default to untouched ----------------------------
await test("unknown top-level request keys are not rewritten", async () => {
  const out = await mapRequestStrings(
    { model: "m", some_future_param: "verbatim", reasoning: { effort: "high" } },
    redact,
  );
  assert.equal(out.some_future_param, "verbatim");
  assert.equal(out.reasoning.effort, "high");
});

// --- Non-mutation -------------------------------------------------------
await test("input payload is not mutated", async () => {
  const input = { model: "m", messages: [{ role: "user", content: "secret" }] };
  await mapRequestStrings(input, redact);
  assert.equal(input.messages[0].content, "secret");
});

console.log(failures === 0 ? "\nAll pii-scope tests passed." : `\n${failures} failing test(s).`);
process.exit(failures === 0 ? 0 : 1);
