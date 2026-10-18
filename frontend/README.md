# ForteBank video review UI

React + TypeScript + Vite with shadcn/ui preset `b4N1aI2yW` (Base UI / nova, mauve, violet, Figtree). Layout follows the six supplied wireframes. Russian interface.

## Run

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Verification and production build:

```sh
npm test
npm run build
```

## Try the wireframe states

For local demos only, set `VITE_USE_MOCK_API=true` in `.env.local` and restart `npm run dev`.
Production builds never use the in-browser mock.

- Start with the history drawer, wide upload button and model dropdown.
- First demo history item: two possible violations. Select a card or red timeline marker to seek; its card gets a green border and a red box appears in the player. Seeking or playing through an event selects its card automatically.
- Second demo item: no violations.
- Upload a nonempty MOV, MP4 or WebM up to 100 MiB. The original plays locally if its codec is supported by the browser. Analysis is simulated and takes about 18 seconds.
- Choose **Демо: без нарушений** before upload for a clean result. **Локальная модель** and **Демо: с нарушениями** both return fixed mock violations.
- While processing, click **Загрузить ещё видео** and upload another file to see the queue dialog. Jobs run automatically in sequence.
- Use the small top-left menu button to reopen history. Its upload button returns to the upload screen.

Seeded history uses a clearly labeled demo player because no source video was provided. Play/pause and the timeline simulate playback for these demos; uploads use a real HTML video element. Unsupported codecs show a message. History and files live in browser memory and reset on reload. No uploads leave the browser in mock mode.

## UX behavior

- The drawer stays as you leave it when choosing a check, uploading, navigating back, and resizing. Open/closed state and model selection are saved in browser preferences. Mobile defaults to a closed drawer on a first visit.
- Completed results are cached for this session. Reopening the same check does not reload it or interrupt playback. Switching away and back restores the playback position and selected event.
- Selecting history updates the active row immediately. The first result load uses a loading placeholder, never an incorrect processing message.
- Uploads validate locally before a request; the upload button responds immediately and prevents duplicate submissions. Files can also be dragged onto the upload area.
- Playback updates only the player. Event cards update when the selected event changes. Automatic scrolling stays inside the event list and never jumps the entire page.
- Layout responds to available content width, including the space occupied by an open drawer. Mobile controls have larger touch targets; the drawer supports Escape, focus trapping and focus restoration. Reduced motion preferences are respected.
- Abandoned result requests are cancelled. Sequential history polling pauses in background tabs. Request timeouts and retry actions prevent indefinite loading screens.

## Connect a real backend

Copy `.env.example` to `.env.local`, set the following values and restart Vite:

```dotenv
VITE_USE_MOCK_API=false
VITE_API_BASE_URL=/api/v1
BACKEND_URL=http://127.0.0.1:8000
```

The development proxy forwards `/api/v1` to the backend. The current backend is a shared-user service without authentication. If an authenticated upstream is used later, the proxy can supply `X-API-Key` via server-side `BACKEND_API_KEY`; never put a key in a `VITE_*` variable. In production, serve `dist` and proxy `/api/v1` to the backend on the same origin; Vite's development proxy is not part of the built frontend.

The API client is `src/lib/api.ts`, using the real backend by default. The optional local mock transport is `src/lib/mock-api.ts`. The current backend contract is `../API_CONTRACT.md`, covering request/response schemas, queue semantics and media handling.

## Deliberate limits

The frontend does not perform inference: it displays the backend's results. The backend currently includes a mock analysis pipeline, so real HTTP requests alone do not establish that model inference is connected. Mock evidence arrays are empty; rule references are explicitly unavailable.

No dashboard, login screens, reports, analytics, batch upload or reviewer actions were added. History and model selection follow the wireframes. The UI can display real evidence JPEGs and rule titles/sections when supplied by a backend. Bounding boxes are static per event interval, without tracking. The 100 MiB limit and 18-second mock delay are implementation choices, not case requirements.
