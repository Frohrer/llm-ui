/**
 * Scope policy for PII redaction: which parts of an outbound payload may be
 * rewritten.
 *
 * Redaction replaces strings. Run over a whole provider request object it
 * also rewrites the API parameters, and a rewritten parameter is a broken
 * request, not a protected one: an entity named "Claude" turns
 * `model: "claude-opus-4-5"` into `model: "[PII_NAME_3]-opus-4-5"`, and a
 * rewritten tool name no longer matches the tool the model then calls.
 *
 * So only context and prompt text is rewritten:
 *   - at the top level of a request object, descend ONLY into the keys that
 *     carry conversation/prompt text (REQUEST_CONTENT_KEYS);
 *   - anywhere inside that text, skip keys that are identifiers or wire
 *     format rather than prose (NON_CONTENT_KEYS).
 *
 * No DB imports here on purpose — the policy is pure and directly testable
 * (see tests/pii-scope.test.mjs).
 */

/**
 * Top-level request keys that carry conversation/prompt text, across every
 * provider shape used in this codebase: OpenAI chat + Responses, Anthropic,
 * Gemini (`systemInstruction`, `history`, `contents`), Ollama, Grok,
 * DeepSeek, OpenRouter.
 */
export const REQUEST_CONTENT_KEYS: ReadonlySet<string> = new Set([
  "messages",
  "system",
  "systemInstruction",
  "system_instruction",
  "instructions",
  "prompt",
  "input",
  "contents",
  "history",
  "parts",
  "content",
  "text",
]);

/**
 * Keys whose values are identifiers, enums, ids or binary payloads — never
 * prose, and load-bearing for the request to work. Skipped at every depth.
 */
export const NON_CONTENT_KEYS: ReadonlySet<string> = new Set([
  // Model / routing
  "model",
  "provider",
  "service_tier",
  "previous_response_id",
  "user",
  // Message + block structure
  "role",
  "type",
  "id",
  "name",
  "index",
  "finish_reason",
  "stop_reason",
  "cache_control",
  // Tool wiring — a rewritten tool name breaks the call round-trip
  "tool_call_id",
  "tool_use_id",
  "tool_choice",
  // Attachments: identifiers and base64/binary, not readable text
  "data",
  "url",
  "image_url",
  "file_id",
  "media_type",
  "mime_type",
  "mimeType",
  "encoding_format",
]);

export type StringMapper = (value: string) => Promise<string>;

function isPlainObject(node: unknown): node is Record<string, any> {
  return !!node && typeof node === "object" && (node as any).constructor === Object;
}

/**
 * Deep-map every prose string in a content payload (a message array, a list
 * of parts, a tool result, a bare string). Structural keys are passed
 * through untouched.
 */
export async function mapContentStrings(node: any, fn: StringMapper): Promise<any> {
  if (typeof node === "string") return fn(node);
  if (Array.isArray(node)) {
    const out = new Array(node.length);
    for (let i = 0; i < node.length; i++) out[i] = await mapContentStrings(node[i], fn);
    return out;
  }
  if (isPlainObject(node)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = NON_CONTENT_KEYS.has(k) ? v : await mapContentStrings(v, fn);
    }
    return out;
  }
  return node;
}

/**
 * Map only the context/prompt of a provider request object. Every other
 * top-level key — model, temperature, tools, stream, max_tokens, anything a
 * provider adds later — is copied through verbatim.
 *
 * A non-object payload (an array of messages or parts handed straight to an
 * SDK method) is all content, so it maps in full.
 */
export async function mapRequestStrings(payload: any, fn: StringMapper): Promise<any> {
  if (!isPlainObject(payload)) return mapContentStrings(payload, fn);
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[k] = REQUEST_CONTENT_KEYS.has(k) ? await mapContentStrings(v, fn) : v;
  }
  return out;
}
