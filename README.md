# Proofr

A collaborative math whiteboard for iOS and Android that marks handwritten work
**as you write it**.

Checking your own math is tedious. Textbook answer keys give you a single final
answer and tell you nothing about *where* you went wrong, and pasting a problem
into a chatbot just hands you the solution so you stop learning. Proofr sits in
between: photograph a problem, handwrite your working on an infinite canvas, and
each line gets marked correct or incorrect in real time, with a short explanation
when something's off.

---

## Features

- **Infinite canvas** with pen, shapes, text, sticky notes, images, two-finger
  pan and pinch-zoom
- **Live step marking** — a vision model reads your handwriting after each stroke
  and places a tick or a flagged cross next to each line
- **Object eraser** that removes pen strokes only (your problem photo is safe),
  and re-marks the remaining work automatically
- **Problem analysis sheet** — OCRs a photographed problem, then generates the
  topic, key concepts, three progressive hints, and a reference solution
- **Progress tracking** for both equation solving and proofs (induction,
  contradiction)
- **Real-time collaboration** — shared canvas state and live remote ink
- **Workspaces** with auth, board search, and favorites

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Framework | Expo SDK 57, React Native 0.86, React 19, TypeScript |
| Navigation | Expo Router (file-based) |
| Canvas | `@shopify/react-native-skia` |
| Gestures / animation | `react-native-gesture-handler`, Reanimated 4 + `react-native-worklets` |
| Real-time canvas | Liveblocks (`LiveMap` + `LiveList` storage, presence) |
| Database & backend | Convex (queries, mutations, Node actions, file storage) |
| Auth | Clerk (organizations, rebranded as "workspaces") |
| Rendering | Skia + `perfect-freehand` |
| AI | Gemini 3.8 Flash (vision OCR), Qwen 3.8 27B on Groq (vision marking), gpt-oss-120b on Groq (text reasoning) |

---

## Technical decisions

### Why two backends (Convex *and* Liveblocks)?

This looks redundant but the two solve different problems, and the split is
deliberate:

- **Liveblocks** owns *canvas contents* — every stroke, layer, and cursor.
  Freehand drawing generates a high-frequency stream of updates from multiple
  users at once, which needs CRDT conflict resolution and sub-100ms propagation.
  Building that on a general database would mean writing an operational-transform
  layer by hand.
- **Convex** owns *everything else* — board metadata, file storage for problem
  photos, and all server-side AI work. This is relational, queryable, needs a
  full-text search index, and must persist independently of whether anyone is
  currently in the room.

### Why Skia, and what it cost

The web version rendered strokes as SVG `<path>` elements inside a single
transformed `<g>`. That gave three things nearly free: camera transforms via one
CSS transform, hit testing via DOM pointer events, and screenshot capture by
cloning the SVG and rasterising it.

React Native has no DOM, so all three had to be rebuilt:

- **Camera** lives in Reanimated shared values feeding a Skia `<Group transform>`.
  Pan and zoom therefore never touch the JS thread and never re-render a layer.
  Holding the camera in React state — as the web app did — would cross the bridge
  60+ times a second while your finger is down.
- **Hit testing** is explicit geometry (`hitTestLayers`), walking layers
  front-to-back against their bounding boxes.
- **Capture** is an offscreen Skia surface (see below).

Two constraints of Skia are worth knowing before editing the canvas:

1. **React context does not cross the `<Canvas>` boundary.** Skia renders its
   subtree with its own reconciler, so any Liveblocks, Convex, or Clerk hook
   called inside `<Canvas>` fails with "RoomProvider is missing from the React
   tree". State is read in the component that *renders* the canvas and passed in
   as plain data or `SkPath` objects.
2. **Skia cannot draw text without font setup**, and has no text input at all.
   Note and text glyphs therefore live in a native overlay that shares the camera
   transform — the replacement for the web app's `<foreignObject>`. The
   consequence is that note text always composites above the ink regardless of
   layer order.

### Why one `<Picture>` instead of a component per layer

The web app rendered one React element per stroke, which was justified by DOM hit
testing and free transforms. With neither of those, per-layer elements only cost
reconciliation time. All committed layers are drawn into a single `SkPicture`,
rebuilt when storage changes rather than when the camera moves.

### Why the renderer and the capture share one draw function

`drawLayers()` is used both for on-screen rendering and for the offscreen PNG sent
to the vision model. That isn't tidiness — marking accuracy depends on the model
seeing exactly what the student sees. The web app got this guarantee by cloning
the live SVG. A declarative render path plus a separate imperative capture path
would drift, and the symptom would be marks landing on the wrong lines.

Skia also made the capture strictly better than the web version: `onlyTypes` can
genuinely restrict the render to pen strokes, whereas the SVG clone rasterised any
layer that happened to overlap the viewBox.

### Why geometric marker placement instead of trusting the model's coordinates

This was the hardest problem in the project.

The obvious approach — ask the vision model for the `(x, y)` of each step and draw
a checkmark there — fails badly. Vision models are strong at *reading* content and
weak at *estimating spatial coordinates*, so marks drift between lines and float
far from the handwriting they belong to.

Responsibility is split by what each system is actually good at:

- The **model** decides only *judgment and order* — which lines exist, top to
  bottom, and whether each is correct.
- The **client geometry** decides *position*. `getPathLineAnchors()` clusters
  strokes into lines by vertical proximity, then takes each cluster's average
  vertical centre and rightmost edge.

Ordered verdicts are mapped onto those real anchors by index. Model coordinates
are kept only as a fallback for steps with no matching ink.

**Mobile change:** A finger on a zoomed-out phone canvas produces letters
many times larger, so every stroke became its own "line" and marks landed
mid-line. The threshold is now derived from the ink itself — 0.7× the 75th
percentile of stroke heights, which approximates a tall letter. The 75th
percentile rather than the median, because dots, minus signs, and equals bars drag
a median down.

### Why the capture upscales

On a phone the captured
region is often small in canvas units, and capping at 1x handed the model a small,
thin-inked image. Capture now scales *up* to fill a 2000px target, capped at 3x.
This was a significant cause of poor recognition before it was fixed.

### Why a debounce plus a rate-limit gate on recognition

Every finished stroke could trigger a recognition call, which would be both slow
and instantly rate-limited. The pipeline layers four guards:

- **2s debounce** so a burst of strokes (one character is often several) coalesces
  into one request
- **5s minimum interval** between successful calls
- **Single in-flight request** — concurrent captures are dropped rather than
  queued
- **Server-driven backoff** honouring the provider's `retryAfterSeconds` on 429

One subtlety worth preserving: a new stroke restarts the debounce but must **not**
invalidate a request already in flight. An earlier version discarded in-flight
results whenever the student kept writing, so the progress bar sat at 0% and then
jumped to 100% at the end instead of climbing as the work developed.

### Why each AI task uses a different model

Each step has a genuinely different requirement, so a single mega-prompt would be
worse at all of them:

| Action | Model | Why |
| --- | --- | --- |
| `extractMath` | Gemini 3.8 Flash (fallback 3.6) | Strongest at clean OCR of printed math into LaTeX |
| `recognizeMath` | Qwen 3.8 27B on Groq (fallback 3.6) | Latency-critical: runs after every stroke, so Groq's inference speed matters |
| `analyseProblem` | gpt-oss-120b on Groq | Text-only reasoning for hints and solutions — no vision needed |

The original stack used Llama 4 Scout for vision and Llama 3.3 70B for text; Groq
deprecated both. `gpt-oss-120b` is text-only and cannot serve the vision routes.
Groq's `/models` endpoint does not report modality, so vision capability was
confirmed by sending a real PNG: the Qwen builds accept `image_url` content parts
and answer, while text-only models reject the request with "content must be a
string".

Every route returns a safe fallback shape instead of throwing, so a failed AI call
degrades the marking overlay rather than breaking the canvas. That matters most for
`recognizeMath`, which fires while the student is mid-stroke.

### Why prompts are proof-aware

Early prompts were written around equation solving ("isolate the unknown", "final
answer"). That mis-marked proofs badly: scaffolding lines like `When n=1` or
`Assume true for n=k` aren't standalone equations, so they got flagged as wrong.
The prompts now explicitly recognise proof structure (base case → inductive
hypothesis → inductive step → conclusion), read the whole page before judging any
line, and are instructed to be conservative — only flagging unambiguous
mathematical errors and giving the benefit of the doubt on messy handwriting.

Two mobile additions: the model is told to recompute arithmetic before flagging it,
and that rearranging an equation across the equals sign is valid. Both were added
after observing false negatives on correct intermediate lines.

Non-ASCII characters in these prompts are written as `\u` escapes. A stray
PowerShell `Set-Content` once mangled the file's encoding and destroyed the `∴`
in the proof examples; escapes make the file immune to that.

### Gesture model

Touch has no hover, no keyboard, and no separate pointer targets, so the
interaction model is rebuilt rather than ported:

- **One finger** is always the active tool; **two fingers** are always pan and
  zoom. This replaces ~120 lines of manual pointer bookkeeping the web app needed
  to disambiguate the two.
- **Tap** selects. **Press and drag** moves a layer directly, with no select-first
  step.
- **Long press** or **double tap** on a text or sticky note opens its editor.
- Gesture order inside `Race` matters: double tap and long press must be offered
  the chance to win before single tap and pan.
- `minDistance` is 0 only for pen and eraser, where a single dot must register.
  Anything else needs a threshold, or the pan gesture wins the race on touch-down
  and tap-to-select never fires.

### Smaller decisions

- **New layers are sized in screen points, then converted by zoom.** The web app
  inserted everything at a fixed 100×100 canvas units; at 40% zoom that is a 40pt
  square, too small to read or grab.
- **Stroke points are `[x, y]`, not `[x, y, pressure]`.** Finger input reports no
  pressure, so the third component was a constant stored on every point and
  broadcast on every presence update. Taper comes from `perfect-freehand`'s
  `simulatePressure` instead.
- **Presence is throttled to ~20Hz on the UI thread.** The throttle uses a shared
  value rather than a ref: a ref caught in a worklet closure triggers "[Worklets]
  Tried to modify key `current`" the moment JS mutates it.
- **Erasing is object-based, not pixel-based.** Strokes are immutable `PathLayer`
  records, so the eraser deletes whole strokes within a radius. It filters to
  `LayerType.Path` so the problem photo can't be wiped by accident, and the whole
  gesture is one history entry via `history.pause()`.
- **Problem images go to Convex file storage, not base64.** 
- **Uploads use `expo-file-system`'s `createUploadTask`.** Reading a `file://` URI
  through `fetch().blob()` round-trips the whole image through the native blob
  store as base64 and fails in practice.
- **`MAX_LAYERS` is 10,000.** Each pen stroke is a layer and one line of math is
  easily 20+ strokes.
- **Marking results live in React state, not storage.** They're derived data tied
  to a specific canvas snapshot, so persisting them would mean stale marks after
  any edit.

---

## Load-bearing workarounds

Two of these are invisible from reading the code and expensive to rediscover.
Do not remove them without understanding why they exist.

### `polyfills.ts` — must be the first import in `app/_layout.tsx`

- **`atob` / `btoa`.** Hermes doesn't implement them and Expo's winter runtime
  doesn't provide them. `@liveblocks/client` needs `atob` to decode the room
  token and refuses to create a client without it. Clerk decodes JWTs too, so the
  shim is installed globally rather than passed through Liveblocks' `polyfills`
  option.
- **`window.addEventListener` / `removeEventListener` / `postMessage`.**
  `@liveblocks/core` sets up a devtools bridge guarded only by
  `typeof window !== "undefined"`. React Native *does* define a global `window`,
  without DOM event methods — so the guard passes, the call throws, and the entire
  package fails at module-evaluation time with `undefined is not a function`. It
  sits behind `NODE_ENV !== "production"`, so it only affects development builds.
  Caveat: some libraries sniff `window.addEventListener` to detect a browser. If a
  dependency starts taking an unexpected web code path, suspect this first.

### `metro.config.js` — Liveblocks module format pinning

All four `@liveblocks` packages are `"type": "module"` and publish a non-standard
`"module"` condition nested inside `"require"`. Left to Metro's defaults,
`@liveblocks/client` resolves to the ESM build while `@liveblocks/react/suspense`
resolves to CJS; each pulls its own copy of `@liveblocks/core`, and core's
duplicate detection throws. All five entry points are pinned to ESM.

Do **not** fix this with `unstable_enablePackageExports = false` — Convex resolves
its `./react` and `./react-clerk` subpaths through its exports map, so that breaks
`convex/react` instead.

### Worklet capture

Never pass an object containing gesture instances into a worklet. `useCamera()`
returns shared values, helper functions, *and* `Gesture.Pinch()` / `Gesture.Pan()`
instances; Reanimated serialises everything a worklet closes over, and a
`PinchGesture` cannot cross to the UI thread. Destructure the specific shared
values and functions you need first. The error names `PinchGesture`, not the object
that contained it, which makes it confusing the first three times.

---

## Architecture

```
Photograph problem
      │
      ▼
Convex file storage ──► ai:extractMath (Gemini) ──► problem text + LaTeX
                                                          │
                                    ┌─────────────────────┴──────────┐
                                    ▼                                ▼
                        ai:analyseProblem (Groq)          context for marking
                        topic / hints / solution                     │
                                                                     │
Pen stroke ends                                                      │
      │                                                              │
      ▼                                                              │
insertPath() ──────────► Liveblocks storage (PathLayer)               │
      │                                                              │
      ▼                                                              │
strokeTick++ ──► useHandwritingRecognition (debounce + rate limit)    │
                       │                                             │
                       ├─► captureLayers() → offscreen Skia → PNG ◄───┘
                       │
                       ├─► ai:recognizeMath (Groq Qwen vision)
                       │        ordered per-line verdicts
                       │
                       └─► getPathLineAnchors()
                                real line positions
                                       │
                                       ▼
                              StepMarkers (inside camera Group)
```

### Project layout

```
mobile/
  app/                    Expo Router routes
    _layout.tsx           polyfills, fonts, providers, GestureHandlerRootView
    index.tsx             dashboard: board grid, search, favorites
    board/[boardId].tsx   canvas screen
  components/
    canvas/               Skia canvas, toolbar, header, overlays, markers
    dashboard/            board card, empty states, rename dialog
    auth-screen.tsx       sign in / sign up / Google SSO
  convex/                 schema, queries, mutations, AI actions, file storage
  hooks/                  camera, recognition pipeline, image insert, selection
  lib/                    geometry, Skia draw, offscreen capture
  providers/              Clerk → Convex → Liveblocks stack
  types/canvas.ts         Layer, CanvasMode, CanvasState definitions
  liveblocks.config.ts    Presence + Storage type declarations
  metro.config.js         Liveblocks ESM pinning (see above)
  polyfills.ts            atob/btoa + window shims (see above)
```

---

## Getting started

### Prerequisites

Node 18+, and accounts for Convex, Clerk, Liveblocks, Groq, and Google AI Studio.
A **development build** is required — `@shopify/react-native-skia` is not bundled
in Expo Go.

All commands run from `mobile/`.

### Install

```shell
npm install
```

### Client environment

Create `mobile/.env.local`:

```
EXPO_PUBLIC_CONVEX_URL=
EXPO_PUBLIC_CONVEX_SITE_URL=
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=
CONVEX_DEPLOYMENT=
```

`EXPO_PUBLIC_*` values are inlined into the JS bundle and readable by anyone with
the app, so only publishable keys belong here.

### Server environment

Secrets go on the Convex deployment, never in `.env.local`:

```shell
npx convex env set LIVEBLOCKS_SECRET_KEY <key>
npx convex env set CLERK_SECRET_KEY      <key>
npx convex env set GEMINI_API_KEY        <key>
npx convex env set GROQ_API_KEY          <key>
```

Clerk also needs **Organizations** enabled, **Google** enabled under Social
Connections, and a JWT template named `convex` whose issuer domain matches
`convex/auth.config.js`.

### Run

```shell
npx convex dev          # terminal 1 — watches convex/ and pushes on save
npx expo start          # terminal 2 — Metro
```

Keep `convex dev` running. Without it, changes to `convex/` are not deployed and
the app fails with "Could not find public function for ...", which looks like a
missing function rather than a stale deploy.

If the device can't reach Metro over LAN, use `npx expo start --tunnel`.

### Build

```shell
npx eas build --profile development --platform android
```

EAS runs `npm ci`, which fails if `package.json` and `package-lock.json` disagree —
commit both together after any dependency change.


## Known limitations

- **Marking accuracy is bounded by the vision model.** Messy handwriting and long
  multi-step proofs can still be misread, and mid-working pages are genuinely
  ambiguous — the model must guess whether a line is wrong or merely incomplete.
  Partial pages are less reliable than finished ones.
- **Finger input is coarser than a mouse or stylus**, and a phone screen gives the
  model fewer pixels to read. Stylus support (pressure, tilt, palm rejection) is
  not implemented.
- **Marker placement maps verdicts to line anchors by index**, so if the model
  reports a different number of lines than the geometry detects, later markers
  shift.
- **No resize handles and no marquee selection.** Layers are sized at creation and
  cannot be adjusted, which is most noticeable on sticky notes and problem photos.
- **`markWorking` is not ported.** The deliberate "submit working" pass with
  per-error explanations still needs a touch equivalent for its hover tooltips.
- **No workspace switcher or create-workspace flow.** The app adopts the user's
  first Clerk organization automatically; `@clerk/clerk-expo` at this version has
  no prebuilt organization components.
- **`@clerk/clerk-expo` is deprecated** in favour of `@clerk/expo` (Core 3), which
  is also where the prebuilt Expo organization components live.
