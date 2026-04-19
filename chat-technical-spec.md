# Chat Feature — Technical Implementation Spec

## Overview

A full-page AI chat assistant integrated into the dashboard. Users can ask questions about their dashboard data, attach/browse documents, and use voice input. The AI has tool access to query negotiations, documents, risk metrics, key dates, and more.

**Stack:** React 19 (frontend) + Hono (backend) + OpenAI GPT (LLM) + Whisper (speech-to-text) + Vercel AI SDK (streaming/tools)

---

## File Structure

| File | Purpose |
|------|---------|
| `services/web/src/pages/dashboard/chat.astro` | Astro page wrapper |
| `services/web/src/components/dashboard/DashboardChat.tsx` | Main React component (~800 lines) |
| `services/web/src/components/Sidebar.tsx` | Sidebar nav item for Chat |
| `services/api/src/routes/dashboard-chat.ts` | Backend: chat streaming + transcription (~314 lines) |
| `services/api/src/app.ts` | Route registration: `/dashboard/chat` |

---

## Page Setup

### `chat.astro`

```astro
---
import DashboardLayout from "../../layouts/DashboardLayout.astro";
import { DashboardChat } from "../../components/dashboard/DashboardChat";
---
<DashboardLayout title="Chat - Acrebase">
  <DashboardChat client:only="react" />
</DashboardLayout>
```

- Uses `client:only="react"` — no SSR, renders entirely on the client
- Wrapped in `DashboardLayout` which provides the sidebar + main content shell

### Sidebar Entry

In `Sidebar.tsx`, a `ChatIcon` SVG component and nav item:

```typescript
{ href: "/dashboard/chat", label: "Chat", icon: ChatIcon }
```

Positioned as the last item before the Settings separator. Uses the same active-state styling (gold left bar + highlighted background) as other nav items.

---

## Frontend Component: `DashboardChat.tsx`

### Data Types

```typescript
interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachmentNames?: string[];  // display names of attached docs
  timestamp?: number;          // Date.now() when message was created
}

interface Attachment {
  file?: File;                 // present for file uploads, absent for server docs
  name: string;
  documentId?: string;
  status: "uploading" | "ready" | "error";
  error?: string;
}

interface ServerDocument {
  id: string;
  filename: string;
  title?: string;
  status: string;
  folderPath?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
```

### State Variables

| State | Type | Default | Purpose |
|-------|------|---------|---------|
| `input` | string | `""` | Current text in the input field |
| `messages` | ChatMessage[] | from sessionStorage | Full conversation history |
| `streaming` | boolean | false | Whether an SSE stream is active |
| `attachments` | Attachment[] | `[]` | Documents attached to the current message being composed |
| `dragOver` | boolean | false | File drag-over state for drop zone |
| `showAttachMenu` | boolean | false | Attach dropdown visibility |
| `showDocPicker` | boolean | false | Document picker modal visibility |
| `serverDocs` | ServerDocument[] | `[]` | Documents in picker modal |
| `childFolders` | string[] | `[]` | Subfolders in picker modal |
| `currentFolder` | string | `"/"` | Current path in picker modal |
| `docSearch` | string | `""` | Search query in picker modal |
| `loadingDocs` | boolean | false | Picker modal loading state |
| `inlineDocs` | ServerDocument[] | `[]` | Documents in empty-state browser |
| `inlineFolders` | string[] | `[]` | Folders in empty-state browser |
| `inlineFolder` | string | `"/"` | Current path in empty-state browser |
| `inlineSearch` | string | `""` | Search in empty-state browser |
| `inlineLoading` | boolean | false | Empty-state browser loading |
| `recording` | boolean | false | Microphone recording active |
| `transcribing` | boolean | false | Audio being sent to Whisper |
| `audioLevels` | number[] | `[]` | Frequency data (0–1) for waveform bars |

### Refs

| Ref | Type | Purpose |
|-----|------|---------|
| `scrollRef` | HTMLDivElement | Messages scroll container |
| `inputRef` | HTMLInputElement | Text input for focus management |
| `fileInputRef` | HTMLInputElement | Hidden file input element |
| `attachMenuRef` | HTMLDivElement | Click-outside detection for attach menu |
| `mediaRecorderRef` | MediaRecorder | Audio recording instance |
| `audioChunksRef` | Blob[] | Accumulated audio data |
| `audioContextRef` | AudioContext | Web Audio API context |
| `analyserRef` | AnalyserNode | Frequency analysis for waveform |
| `animFrameRef` | number | requestAnimationFrame ID |
| `mediaStreamRef` | MediaStream | Microphone stream |
| `stuckToBottomRef` | boolean | Whether auto-scroll is engaged |

### Persistence

- **Messages**: Stored in `sessionStorage` under key `"chat-messages"`. Updated after every non-streaming state change. Loaded on component mount.
- **Scope**: Per-tab, lost on page reload or tab close.

---

## UI Layout

### Two States

The component renders one of two layouts based on `messages.length > 0`:

#### 1. Empty State (No Messages)

```
┌──────────────────────────────────────────┐
│                                          │
│          (25vh padding from top)          │
│                                          │
│      What's on your mind today?          │
│                                          │
│   ┌──────────────────────────────────┐   │
│   │ [+]  Ask anything        [mic]   │   │
│   └──────────────────────────────────┘   │
│                                          │
│   Documents                              │
│   ┌──────────────────────────────────┐   │
│   │ [Search documents...]            │   │
│   │ 📁 Test                     >    │   │
│   │ ☐ Shopping Center Lease...       │   │
│   │ ☐ Lease First Draft...           │   │
│   │ ☐ LOI.docx                       │   │
│   └──────────────────────────────────┘   │
│                                          │
└──────────────────────────────────────────┘
```

- Heading + input are pinned at `pt-[25vh]` so they don't shift when the document list changes height
- Document browser is a separate section below, scrollable (max-h-64)
- Documents have checkbox multi-select (toggle on/off)
- Folder navigation with breadcrumbs
- Search bypasses folders (searches all)

#### 2. Active Chat (Has Messages)

```
┌──────────────────────────────────────────┐
│                           [+ New chat]   │
│                                          │
│  ┌─ max-w-2xl centered ──────────────┐   │
│  │                                    │   │
│  │                    ┌──────────┐    │   │
│  │                    │ user msg │    │   │
│  │                    └──────────┘    │   │
│  │                    Today, 2:30 PM  │   │
│  │                                    │   │
│  │  Assistant response text here      │   │
│  │  rendered as Markdown              │   │
│  │  [📋]  Today, 2:31 PM             │   │
│  │                                    │   │
│  └────────────────────────────────────┘   │
│                                          │
│  ┌────────────────────────────────────┐   │
│  │ [+]  Ask anything         [send]  │   │
│  └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

- Slim centered column: `max-w-2xl` (~672px)
- User messages: right-aligned bubble (`bg-surface-subtle`, `rounded-3xl rounded-br-lg`)
- Assistant messages: left-aligned, no bubble, Markdown rendered via `react-markdown`
- Each assistant response has a copy button + timestamp below it
- Each user message has a timestamp below it (right-aligned)
- Input bar pinned at bottom

### Input Bar (Shared Between States)

The input bar is a pill-shaped container (`rounded-2xl`) with three modes:

**Normal Mode:**
```
┌─────────────────────────────────────────┐
│ [+]  Ask anything              [🎤/➤]  │
└─────────────────────────────────────────┘
```
- `[+]` button opens attach menu (Upload file / Choose from documents)
- Right button: microphone icon when input is empty, send arrow when input has text
- Focus changes border color to `action` (gold)
- Inner `<input>` has `outline: none` (inline style) to override global `*:focus-visible` rule

**Recording Mode:**
```
┌─────────────────────────────────────────┐
│ [+]  ·||·|||·||||||·||·|||·     [✕] [✓] │
└─────────────────────────────────────────┘
```
- `[+]` button disabled
- Waveform: ~40 vertical bars reflecting real-time audio frequency levels
- Bar height: `Math.max(3, level * 28)px`, width 2px, 2px gap
- Cancel (✕): discards recording
- Confirm (✓): stops recording, sends to Whisper, fills input

**Transcribing Mode:**
```
┌─────────────────────────────────────────┐
│          ⟳ Transcribing...              │
└─────────────────────────────────────────┘
```

### Context Limit Warning

When `messages.length >= 20`, a gold warning appears above the input:

```
⚠ Start a new chat for better accuracy
```

Styled: `bg-action/10 text-action`, rounded pill.

---

## Attach Menu & Document Picker

### Attach Menu (Dropdown)

Positioned `absolute bottom-full` above the `[+]` button:

1. **Upload file** — triggers hidden `<input type="file">` accepting `.docx,.pdf,.doc`
   - Uploads to `/api/v1/ingestion/upload` with `folderPath: "/Chat Uploads"`
   - Shows uploading spinner → ready state in attachment chips
2. **Choose from documents** — opens document picker modal

### Document Picker Modal

Full-screen overlay with backdrop blur. Features:
- Header: "Choose documents" + selected count + "Done" button
- Search input
- Breadcrumb navigation (when in subfolder)
- Back (`..`) button in subfolders
- Folders shown with gold folder icon + chevron
- Documents shown with checkbox toggle (gold checkmark when selected)
- Search results include `folderPath` for non-root documents
- Clicking a document toggles it on/off (doesn't close modal)
- "Done" button closes modal

### Inline Document Browser (Empty State)

Same functionality as the modal but rendered inline below the input bar:
- Separate `inlineDocs`/`inlineFolders`/`inlineFolder`/`inlineSearch` state
- Uses `fetchInlineDocs()` function (separate from `fetchServerDocs()` used by modal)
- `max-h-64` with `overflow-y-auto`
- Loaded on mount when `hasMessages === false`

---

## Message Sending Flow

```
1. User clicks Send (or presses Enter)
2. Validate: input not empty, not streaming, no uploads in progress
3. Collect attachment IDs from ready attachments
4. Clear input + attachments
5. Append user message to messages[] (with timestamp)
6. Set streaming = true
7. POST to /api/v1/dashboard/chat:
   {
     message: "user text",
     message_history: [...previous messages],
     page_context: window.__chatPageContext,  // if set by page
     attachment_ids: ["uuid1", ...]           // only for this message
   }
8. Append empty assistant message to messages[]
9. Read SSE stream:
   - "text" events → accumulate assistantText, update last message
   - Other events → ignored on frontend
10. On stream end: set streaming = false
11. On error: replace last message with error text
12. Messages auto-saved to sessionStorage (outside streaming)
```

---

## Auto-Scroll Behavior

During streaming, the component tracks whether the user is "stuck to bottom":

```typescript
const stuckToBottomRef = useRef(true);

// On scroll: check if within 80px of bottom
const onScroll = () => {
  stuckToBottomRef.current =
    el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};

// Every 100ms: only scroll if stuck
const interval = setInterval(() => {
  if (stuckToBottomRef.current) el.scrollTop = el.scrollHeight;
}, 100);
```

- Streaming starts → `stuckToBottom = true` → auto-scrolls
- User scrolls up → `stuckToBottom = false` → auto-scroll stops
- User scrolls back to bottom → `stuckToBottom = true` → auto-scroll resumes
- Streaming ends → `stuckToBottom` reset to `true`

New messages (non-streaming) always scroll to bottom via a separate `useEffect` that checks `messages.length` changes.

---

## Speech-to-Text (Whisper)

### Frontend Flow

1. **Start**: `navigator.mediaDevices.getUserMedia({ audio: true })`
2. **Record**: `MediaRecorder` with `audio/webm;codecs=opus` (fallback: `audio/webm`)
   - Chunks collected every 250ms via `ondataavailable`
3. **Visualize**: `AudioContext` → `AnalyserNode` (fftSize 128)
   - `requestAnimationFrame` loop reads `getByteFrequencyData`
   - Samples ~40 bars from frequency bins, normalized to 0–1
   - Stored in `audioLevels` state, rendered as vertical bars
4. **Stop (confirm)**: `recorder.stop()` → `onstop` callback:
   - Create `Blob` from chunks
   - POST to `/api/v1/dashboard/chat/transcribe` as FormData
   - Set `transcribing = true` during request
   - On success: populate input with transcript text
5. **Stop (cancel)**: Just stops recording, discards data
6. **Cleanup on unmount**: Stops recorder, cancels animation, closes AudioContext, stops media tracks

### Backend Endpoint

```
POST /api/v1/dashboard/chat/transcribe
Content-Type: multipart/form-data

Body: { audio: File }
```

- Requires authentication (`requireAuth`)
- 25MB file size limit
- Forwards to OpenAI Whisper API:
  ```
  POST https://api.openai.com/v1/audio/transcriptions
  model: whisper-1
  language: en
  ```
- Returns: `{ text: string }`

---

## Backend: Chat Streaming Route

### Endpoint

```
POST /api/v1/dashboard/chat
Content-Type: application/json

Body: {
  message: string,                         // required
  message_history?: {role, content}[],     // previous conversation
  page_context?: {page, summary},          // current dashboard page
  attachment_ids?: string[]                // document UUIDs
}
```

### System Prompt

```
You are a helpful legal analytics assistant for a contract negotiation platform.
You have access to tools that query the firm's dashboard data, including negotiations,
risk metrics, team workload, and outside counsel spend. You can also search and read
documents from the tenant's document library.

Be concise. Answer with data when possible. Format numbers clearly.
Keep responses to 1-4 sentences unless the user asks for details.

When asked about a specific document's contents, use getDocumentFullText to retrieve it.
When asked to find documents by topic, use searchDocuments first, then retrieve full text
if needed. If the user has attached documents, their content is included in this
conversation — refer to it directly.

IMPORTANT: You MUST use your tools to fetch real data. NEVER fabricate, simulate,
or placeholder content.
```

### Attachment Handling

When `attachment_ids` are provided:
1. Validate each ID (UUID format regex)
2. Fetch document metadata only (title, filename, status) — NOT full content
3. Append to system prompt:
   ```
   The user has attached these documents to the conversation.
   Use getDocumentFullText with their IDs to read them when the user asks about them:
   - "Shopping Center Lease" (id: abc-123, status: ready)
   ```
4. The AI uses its `getDocumentFullText` tool to read content on demand

This approach avoids injecting large document content into every request.

### AI Tools (6 total)

All tools use the Vercel AI SDK `tool()` helper with Zod schemas:

#### `getDashboardStats`
- **Parameters**: none
- **Returns**: All dashboard metrics (summary cards, pipeline, negotiations, risk distribution, team workload, outside counsel)
- **Service**: `dashboardService.getDashboardStats(tenantId)`

#### `getKeyDates`
- **Parameters**: `month: string` (YYYY-MM format, empty = current month)
- **Returns**: Deadlines, expirations, renewals for the month
- **Service**: `dashboardService.getKeyDates(tenantId, month)`

#### `getNegotiationDetail`
- **Parameters**: `negotiationId: UUID`
- **Returns**: Title, counterparty, stage, priority, assignees, attached documents
- **Service**: `negotiationService.getNegotiation(negotiationId, tenantId)`

#### `getDocumentDetail`
- **Parameters**: `documentId: UUID`
- **Returns**: Title, status, metadata, analysis results
- **Service**: `documentService.getDocument(documentId, tenantId)`

#### `getDocumentFullText`
- **Parameters**: `documentId: UUID`
- **Returns**: Full concatenated clause text (sorted by chunkIndex), truncated to 80KB
- **Service**: `documentService.getDocument()` → joins `doc.clauses[].content`
- **Error handling**: Returns error message if doc not ready or not found

#### `searchDocuments`
- **Parameters**: `query: string`, `mode: "name" | "content"`
- **Mode "name"**: `documentService.listDocuments(tenantId, 1, 10, { search: query })`
- **Mode "content"**: `searchService.hybridSearch(tenantId, query, 10)` with deduplication by documentId
- **Returns**: Document IDs, titles, filenames, snippets (first 200 chars for content mode)

### Streaming Implementation

Uses Vercel AI SDK's `streamText()` with `ReadableStream`:

```typescript
const result = streamText({
  model: openai("gpt-5.4"),
  system: systemPrompt,
  messages,
  tools,
  maxSteps: 8,  // max tool call rounds
});

for await (const part of result.fullStream) {
  if (part.type === "text-delta") {
    send({ type: "text", content: part.textDelta });
  }
  // tool-call and tool-result are logged to console
}
```

### Fallback Handling

1. **No text produced** (model only called tools): Makes a second `streamText()` call with the full response messages (including tool results) to generate a text summary.
2. **Still no text**: Returns canned message: "I retrieved the data but wasn't able to generate a summary."

### SSE Event Format

```
data: {"type":"start"}\n\n
data: {"type":"text","content":"Hello "}\n\n
data: {"type":"text","content":"there!"}\n\n
data: {"type":"done","success":true,"message_history":[...]}\n\n
```

On error:
```
data: {"type":"error","message":"Chat failed"}\n\n
```

Response headers:
```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

### Input Sanitization

- `page_context.page`: stripped to alphanumeric + dash, max 50 chars
- `page_context.summary`: control chars removed, max 500 chars
- `attachment_ids`: filtered to valid UUID format (`/^[0-9a-f-]{36}$/`)
- `message_history`: only `user` and `assistant` roles kept

---

## Theme & Styling

All colors use CSS custom property tokens that automatically switch between light/dark mode via a `.dark` class on `<html>`:

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| `text-primary` | #2d2d2d | #e5e5e5 | Main text |
| `text-secondary` | #5a5a5a | #9a9a9a | Secondary text |
| `text-tertiary` | #5a5a5a | #9a9a9a | Muted text, timestamps |
| `surface-subtle` | #ececec | #363636 | Input background, user bubble |
| `surface-hover` | #f7f7f7 | #2a2a2a | Hover states |
| `card-bg` | #ffffff | #212121 | Card/modal backgrounds |
| `card-border` | #dedede | #363636 | Borders |
| `page-bg` | #f2f2f2 | #1a1a1a | Page background |
| `action` | #b8832d | #e0ac52 | Gold brand color, focus states |

### Key Styling Patterns

- **Input pill**: `bg-surface-subtle rounded-2xl border border-card-border focus-within:border-action`
- **User bubble**: `bg-surface-subtle rounded-3xl rounded-br-lg`
- **Assistant text**: No bubble, plain `text-text-primary`
- **Copy button**: `hover:border-card-border` border appears on hover, strokeWidth 2 for bolder icon
- **Send button**: `bg-text-primary text-page-bg` — inverts properly in both themes
- **Waveform bars**: `bg-text-primary`, height based on audio level
- **Checkboxes**: `bg-action border-action` when selected, `border-card-border` when not
- **Inner input outline suppression**: `style={{ outline: "none" }}` to override global `*:focus-visible` rule

---

## API Endpoints Summary

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/dashboard/chat` | POST | Yes | Main chat with SSE streaming |
| `/api/v1/dashboard/chat/transcribe` | POST | Yes | Whisper speech-to-text |
| `/api/v1/ingestion/upload` | POST | Yes | Upload file (used with `folderPath: "/Chat Uploads"`) |
| `/api/v1/documents` | GET | Yes | List/search documents (used by both inline browser and modal picker) |

---

## Key Design Decisions

1. **No SSR**: Component uses `client:only="react"` — avoids hydration issues with sessionStorage, MediaRecorder, etc.
2. **Session-scoped persistence**: Chat history in sessionStorage (per-tab). No server-side chat history storage.
3. **Tool-based document reading**: Documents are NOT injected into context. The AI is told which docs are attached (metadata only) and uses `getDocumentFullText` tool to read them on demand. This prevents context window bloat.
4. **Uploads go to "/Chat Uploads"**: Prevents cluttering the main document library.
5. **Smart auto-scroll**: Tracks "stuck to bottom" state. User can scroll up during streaming without being yanked back down.
6. **Context limit warning at 20 messages**: Heuristic to suggest starting fresh before token limits degrade quality.
7. **Whisper over Web Speech API**: Server-side Whisper transcription is more reliable and consistent across browsers than the browser's built-in SpeechRecognition API.
8. **Multi-select documents**: Document picker uses checkbox toggle (click to select, click again to deselect) with a "Done" button instead of single-select-and-close.
9. **Separate inline vs modal document state**: Empty state browser and modal picker have independent state to avoid conflicts.
10. **Fallback LLM calls**: If the AI only calls tools without producing text, a second LLM call generates a summary from tool results.
