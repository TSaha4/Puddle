# PUDDLE

**stop scrolling. start puddling.** A tiny, playful replacement for another lap around your feed.

## Phase 1: the thin slice

Tap **puddle now** → Express returns a canned two-minute ambient-audio session → Tone.js plays it in your browser → give a thumbs-up/down. Feedback is logged in the browser console only. End early whenever you like; mute and volume controls are available throughout.

This is an **unpersonalized prototype**, not yet an AI-powered recommendation. No accounts, database, context collection, tracking, screen-time blocking, or sentiment/emotion classification. No API keys required.

## Run locally

Use Node.js 22 and npm 10 or newer, from the repository root:

```sh
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to the orchestrator on port 3001. The audio context unlocks directly on your button press, as required by browsers. Use headphones at a comfortable volume. If sound is unavailable, the app offers a retry rather than pretending a session started.

```sh
npm run typecheck
npm test
npm run build
npm start
```

The production server serves both `/api` and the built frontend at http://localhost:3001. `PORT` overrides the server port (the dev proxy expects 3001). The source-only initial commit has no generated lockfile: after the first successful install, commit `package-lock.json` and use `npm ci` for reproducible installs.

## Demo / deployment

`render.yaml` defines a single Render web service for this phase. Connect this GitLab repository to Render, create a Blueprint using that file, and approve deployment. If a free instance is unavailable for your account, choose an available plan explicitly; nothing here provisions paid services automatically. The single service avoids cross-origin configuration and separate frontend deployment overhead. Free services can cold-start.

Deployment and runtime verification require an external environment: this implementation was authored with repository tools, without a shell, browser, or Render credentials. It is **not claimed to be tested or deployed**. Before demoing:

1. Run the commands above and confirm Jest, TypeScript, and Vite succeed.
2. Tap `puddle now` in Chrome and Safari (including a phone); confirm sound only starts after the click, mute/volume work, and early finish stops all sound.
3. Run another session; check there is no overlapping audio. Let a full session finish and verify silence at two minutes.
4. Give either feedback; check one `puddle.feedback` entry with the session ID in the browser console and disabled feedback buttons afterward.
5. Stop the API while Vite is running; confirm retryable error UI, then restart it. Check the deployed `/api/health` and repeat the happy path.

## Architecture and the MCP boundary

Today:

```text
React + Tone.js ── POST /api/sessions ──> orchestrator-service
                                         └─ canned ambient-audio payload
browser console <── thumbs up / down
```

Next (not implemented):

```text
context ──> orchestrator (MCP client) <── bandit ranking + Claude selection
                 │
                 │ endpoint registry; generate_session contract
       ══════════╪════ MCP PLUGIN BOUNDARY ══════════
                 ├── mcp-ambient-audio   (independent server/container)
                 ├── mcp-blob-visual     (independent server/container)
                 ├── mcp-rant-doodle     (independent server/container)
                 └── mcp-breathing-game  (independent server/container)
```

**The novel part is MCP as a hot-swappable plugin bus for generative personal content**, rather than its usual enterprise tool-orchestration role. Each session type will expose one `generate_session` tool through the official TypeScript MCP SDK. Adding/removing a generator should change only the endpoint registry, not the orchestrator's core routing logic. The frontend still needs a renderer for a genuinely new payload modality; plugin independence does not imply arbitrary new UI renders itself.

`shared/session.ts` makes the current JSON payload explicit. `services/orchestrator-service/src/session.ts` is the temporary canned generator; Phase 2 replaces this implementation with a real MCP client call. **There is no MCP traffic or AI selection in Phase 1.**

## Structure

- `frontend/`: React/TypeScript/Vite, Tone.js engine, warm neubrutalist UI.
- `services/orchestrator-service/`: Express/TypeScript API, Jest routing tests, production static serving.
- `shared/session.ts`: transport contract and runtime response validation.
- `render.yaml`: one-service Phase 1 deployment.

## Assumptions and intentionally deferred work

- Sessions last 120 seconds and use a fixed seed/tempo/key/texture. IDs/timestamps are real; personalization is not.
- Feedback is intentionally ephemeral and never sent to the backend. Refresh resets the app.
- A single user-triggered audio session owns Tone's transport; finishing/unmounting disposes its audio graph. A separately scheduled audio gate limits the session even when browser timers are throttled.
- Typography uses system fonts; no external font fetches or visual asset dependencies.
- Phase 2: real ambient and blob MCP servers, random routing, Prisma/PostgreSQL sessions and feedback.
- Phase 3: independent Thompson-sampling bandit service, additional generators, context providers, Claude selection.
- Phase 4: content-free WebSocket presence, Redis, full Compose stack, GitHub Actions CI (on a GitHub mirror, since this repository is on GitLab), load test, multi-service deployment.
- Phase 5: clearly labeled synthetic history and a finalized architecture diagram.

The rant generator, when added, uses only word counts and keyword buckets—never sentiment, emotion, or mental-health inference. Presence will share only room membership and blob appearance/position, not session content.
