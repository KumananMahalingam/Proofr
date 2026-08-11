# Proofr

A collaborative whiteboard that marks handwritten math **as you write it**.

Checking your own math work is tedious. Textbook answer keys give you a single final
answer and tell you nothing about *where* you went wrong, and pasting a problem into a
chatbot just hands you the solution so you stop learning. Proofr sits in between: you
handwrite your working on an infinite canvas, and each line gets marked correct or
incorrect in real time, with a short explanation when something's off.

Try It Out: proofr.vercel.app

![Alt Text](public/demo.png)

---

## Features

- **Infinite canvas** with pen, shapes, text, sticky notes, images, pan and pinch-zoom
- **Live step marking** — a vision model reads your handwriting after each stroke and
  places a tick or a flagged issue next to each line
- **Object eraser** that removes pen strokes only (your problem image is safe), and
  automatically re-marks the remaining work
- **Problem analysis panel** — OCRs an uploaded problem, then generates the topic,
  key concepts, progressive hints, and a reference solution
- **Progress tracking** for both equation-solving and proofs (induction, contradiction)
- **Real-time collaboration** — multiplayer cursors, presence, and shared canvas state
- **Workspaces** with auth, board search, and favorites

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Next.js 14 (App Router), TypeScript |
| Real-time canvas | Liveblocks (`LiveMap` + `LiveList` storage, presence) |
| Database | Convex |
| Auth | Clerk (with organizations, rebranded as "workspaces") |
| Styling | Tailwind CSS, shadcn/ui, Radix primitives |
| Rendering | SVG + `perfect-freehand` |
| AI | Groq (Llama 4 Scout vision, Llama 3.3 70B text), Google Gemini 2.5 Flash |
| Client state | Zustand |

---

## Technical decisions

### Why two separate backends (Convex *and* Liveblocks)?

This looks redundant but the two solve different problems, and the split is deliberate:

- **Liveblocks** owns *canvas contents* — every stroke, layer, and cursor. Freehand
  drawing generates a high-frequency stream of updates from multiple users at once, which
  needs CRDT conflict resolution and sub-100ms propagation. Building that on a general
  database would mean writing my own operational-transform layer.
- **Convex** owns *board metadata* — which boards exist, titles, owners, favorites. This
  is relational, queryable, needs a full-text search index, and must persist
  independently of whether anyone is currently in the room.

Using Liveblocks for metadata would mean no queryable board list; using Convex for
strokes would mean hand-rolling realtime conflict resolution. Each tool does what it's
actually good at.

### Why SVG instead of Canvas 2D or WebGL?

Strokes are React components in a single transformed `<g>` element. This gives three
things nearly free:

1. **Camera transforms** — pan and zoom are one CSS transform on the parent group, so
   overlays (marks, selection boxes, cursors) stay locked to content automatically.
2. **Hit testing** — pointer events on individual paths come from the DOM instead of
   manual geometry math.
3. **Screenshot capture for AI** — the SVG can be cloned, re-scoped with a `viewBox`, and
   rasterised to PNG. No separate render pipeline.

The tradeoff is DOM node count on very large drawings. It's acceptable here because a
page of math working is on the order of hundreds of strokes, not tens of thousands.

### Why geometric marker placement instead of trusting the model's coordinates

This was the hardest problem in the project, and the most interesting fix.

The obvious approach: ask the vision model for the `(x, y)` of each step and draw a
checkmark there. This failed badly — vision models are strong at *reading* content and
weak at *estimating spatial coordinates*, so marks drifted between lines and floated far
from the handwriting they belonged to.

The fix was to split responsibility by what each system is actually good at:

- The **model** decides only *judgment and order* — which lines exist, top to bottom, and
  whether each is correct.
- The **client geometry** decides *position*. Since every stroke's bounding box is already
  in storage, `getPathLineAnchors()` clusters strokes into lines by vertical proximity,
  then takes each cluster's average vertical centre and rightmost edge.

The model's ordered verdicts are then mapped onto those real anchors by index. Markers now
land exactly at the end of the line they refer to, and stay attached under pan and zoom
because they render inside the same transformed group. Model coordinates are kept only as
a fallback for steps with no matching ink.

### Why a debounce plus a rate-limit gate on recognition

Every finished stroke could trigger a recognition call, which would be both slow and
instantly rate-limited. The pipeline layers four guards:

- **2s debounce** so a burst of strokes (one character is often several strokes) coalesces
  into one request
- **5s minimum interval** between successful calls
- **Single in-flight request** — concurrent captures are dropped rather than queued
- **Server-driven backoff** honouring the API's `retryAfterSeconds` on HTTP 429

### Why the AI work is split across four API routes

Each step has a genuinely different requirement, so a single mega-prompt would be worse at
all of them:

| Route | Model | Why |
| --- | --- | --- |
| `extract-math` | Gemini 2.5 Flash | Strongest at clean OCR of printed math into LaTeX |
| `recognize-math` | Llama 4 Scout (vision) | Latency-critical: runs on every stroke, so Groq's speed matters more than peak accuracy |
| `mark-working` | Llama 4 Scout (vision) | Deliberate full-page marking, lower temperature for consistency |
| `analyse-problem` | Llama 3.3 70B (text) | Text-only reasoning for hints and solutions — no vision needed, so a stronger text model is cheaper and better |

All routes are server-side so API keys never reach the browser, and every route returns a
safe fallback shape instead of throwing, so a failed AI call degrades the marking overlay
rather than breaking the canvas.

### Why prompts are proof-aware

Early prompts were written around equation solving ("isolate the unknown", "final
answer"). That mis-marked proofs badly: scaffolding lines like `When n=1` or
`Assume true for n=k` aren't standalone equations, so they got flagged as wrong. The
prompts now explicitly recognise proof structure (base case → inductive hypothesis →
inductive step → conclusion), read the whole page before judging any line, and are
instructed to be conservative — only flagging unambiguous mathematical errors and giving
the benefit of the doubt on messy handwriting.

### Smaller decisions

- **Erasing is object-based, not pixel-based.** Strokes are immutable `PathLayer` records,
  so an eraser deletes whole strokes within a radius. This keeps undo/redo coherent (the
  whole gesture is one history entry via `history.pause()`) and it filters to
  `LayerType.Path` so the problem image can't be wiped by accident.
- **Uploaded images become base64 data URLs.** No blob store to configure, and canvas
  capture can't be tainted by cross-origin images — at the cost of document size, which is
  fine for single problem screenshots.
- **`MAX_LAYERS` is 10,000.** Each pen stroke is a layer and one line of math is easily
  20+ strokes, so a low cap gets hit during normal use.
- **Marking results live in React state, not storage.** They're derived data tied to a
  specific canvas snapshot, so persisting them would mean stale marks after any edit.

---

## Architecture

```
Pen stroke ends
      │
      ▼
insertPath() ──────────► Liveblocks storage (PathLayer)
      │
      ▼
strokeEndTick++  ──►  HandwritingOverlay (debounce + rate limit)
                            │
                            ├─► captureCanvas()  → SVG clone → PNG
                            │
                            ├─► POST /api/recognize-math  → Groq vision
                            │        returns ordered per-line verdicts
                            │
                            └─► getPathLineAnchors()
                                     provides real line positions
                                              │
                                              ▼
                                    StepMarkers (inside camera <g>)
```

### Project layout

```
app/
  (dashboard)/          Board list, workspace sidebar, search, favorites
  board/[boardId]/      Canvas and all its overlays
  api/                  AI + upload routes (server-side only)
convex/                 Schema, queries, mutations for board metadata
lib/                    Geometry helpers, canvas capture
types/canvas.ts         Layer, CanvasMode, CanvasState definitions
liveblocks.config.ts    Presence + Storage type declarations
```

---

## Getting started

### Prerequisites

Node 18+, plus accounts for Convex, Clerk, Liveblocks, Groq, and Google AI Studio.

```

### Install packages

```shell
npm i
```

### Setup .env file


```js
CONVEX_DEPLOYMENT=
NEXT_PUBLIC_CONVEX_URL=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
LIVEBLOCKS_SECRET_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
```

### Setup Convex

```shell
npx convex dev

```

### Start the app

```shell
npm run dev
```
