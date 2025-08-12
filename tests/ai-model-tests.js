/*
  Simple integration test that verifies image acceptance across providers/models.
  It:
    1) Creates a tiny PNG fixture
    2) Uploads it via /api/upload
    3) Sends a prompt with the uploaded image to each provider/model
    4) Parses SSE and asserts we receive chunks or an end event

  Run with:  npm run test:ai-models
*/

/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const UPLOAD_ENDPOINT = `${BASE_URL}/api/upload`;

// 1x1 red PNG (base64)
const RED_DOT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAKUlEQVR42mNgGAWjYBSMglEwCkYGQ4ZRMH8Gg/8Yg4HhPwYGBgYAAJ7kBz8L1qbrAAAAAElFTkSuQmCC'; // 10x10 PNG

const SAMPLE_JPEG_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a9/Example.jpg/240px-Example.jpg';

async function ensureFixture() {
  const dir = path.join(process.cwd(), 'tests', 'fixtures');
  fs.mkdirSync(dir, { recursive: true });
  const jpgPath = path.join(dir, 'sample.jpg');
  const pngPath = path.join(dir, 'red-dot.png');
  // Try to download a small, valid JPEG for better provider compatibility
  try {
    const resp = await fetch(SAMPLE_JPEG_URL);
    if (resp.ok) {
      const ab = await resp.arrayBuffer();
      fs.writeFileSync(jpgPath, Buffer.from(ab));
      return { path: jpgPath, mime: 'image/jpeg', name: 'sample.jpg' };
    }
  } catch {}
  // Fallback: write a 10x10 PNG
  if (!fs.existsSync(pngPath)) {
    const buf = Buffer.from(RED_DOT_BASE64, 'base64');
    fs.writeFileSync(pngPath, buf);
  }
  return { path: pngPath, mime: 'image/png', name: 'red-dot.png' };
}

async function uploadImage(fixture) {
  const buf = fs.readFileSync(fixture.path);
  const file = new File([buf], fixture.name, { type: fixture.mime });
  const form = new FormData();
  form.append('file', file);

  const res = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    body: form
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upload failed: ${res.status} ${text}`);
  }
  const data = await res.json();
  const url = data?.file?.url;
  if (!url) throw new Error('Upload did not return file.url');
  return url;
}

async function postSSE(url, body, timeoutMs = 40000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status}: ${text}` };
    }

    const reader = res.body?.getReader();
    if (!reader) return { ok: false, error: 'No response body' };

    let receivedChunk = false;
    let receivedEnd = false;
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const eventBlock = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = eventBlock.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data?.type === 'chunk') receivedChunk = true;
          if (data?.type === 'end') receivedEnd = true;
          if (data?.type === 'error') return { ok: false, error: data.error || 'Unknown SSE error' };
        } catch {}
      }
    }

    if (receivedChunk || receivedEnd) return { ok: true };
    return { ok: false, error: 'No chunk or end event received' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

async function testModel(provider, model, imageUrl) {
  const endpoint = `${BASE_URL}/api/chat/${provider}`;
  const body = {
    message: 'Describe this image briefly.',
    model,
    allAttachments: [
      { type: 'image', url: imageUrl, name: 'red-dot.png' }
    ],
    useKnowledge: false,
    useTools: false,
    context: []
  };
  return postSSE(endpoint, body);
}

async function run() {
  console.log('Preparing fixture...');
  const fixture = await ensureFixture();
  console.log('Uploading image...');
  const imageUrl = await uploadImage(fixture);
  console.log('Uploaded image URL:', imageUrl);

  const tests = [
    // OpenAI
    { provider: 'openai', model: 'gpt-5' },
    { provider: 'openai', model: 'gpt-4o' },
    // Anthropic
    { provider: 'anthropic', model: 'claude-3-5-sonnet-latest' },
    // Gemini
    { provider: 'gemini', model: 'gemini-1.5-pro' },
    // Grok (vision-capable model)
    { provider: 'grok', model: 'grok-2-vision' },
    // DeepSeek (treated as text, but should not error with image present)
    { provider: 'deepseek', model: 'deepseek-chat' },
  ];

  const results = [];
  for (const t of tests) {
    process.stdout.write(`Testing ${t.provider}:${t.model} ... `);
    const result = await testModel(t.provider, t.model, imageUrl);
    if (result.ok) {
      console.log('OK');
      results.push({ ...t, ok: true });
    } else {
      console.log('FAIL:', result.error);
      results.push({ ...t, ok: false, error: result.error });
    }
  }

  const failed = results.filter(r => !r.ok);
  console.log('\nSummary:');
  for (const r of results) {
    console.log(`- ${r.provider}:${r.model} => ${r.ok ? 'OK' : `FAIL (${r.error})`}`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

run().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});

