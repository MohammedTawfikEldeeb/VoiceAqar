# VoiceAqar — Production Hardening Report

Date: 2026-08-09
Scope: full codebase audit + fixes applied for production readiness.

This document describes every problem found during the production-readiness audit of
the VoiceAqar codebase and exactly what was changed to fix it. Each entry lists the
**Problem**, the **Fix**, and the **Files** touched.

---

## 1.  Deployment ran a stale binary — `npm start` served the wrong app

**Problem**
- `package.json` `main` and the `start` script both point to `dist/server.js`.
- The `dist/` folder only contained **7 files** and `server.js` was an ancient stub with a
  single `GET /health` — no routes, no gateways, no agent, no DB.
- Deploying as-is silently started a completely different, non-functional app.
- `npm run build` (`tsc`) failed with type errors in `src/scripts/list_live_models.ts`
  (`Model.supportedMethods` does not exist on the SDK type), so a clean rebuild was also broken.

**Fix**
- `tsconfig.json` now excludes `src/scripts` and `test` from the production build (they are
  dev utilities executed with `tsx`, not part of the app).
- Fixed the type errors in `src/scripts/list_live_models.ts` (cast SDK models to `any`).
- Deleted the stale `dist/` and re-ran `npm run build` — **exit 0**, ~65 output files,
  `dist/server.js` now boots the real application (verified with a smoke test).

**Files:** `package.json` (unchanged), `tsconfig.json`, `src/scripts/list_live_models.ts`, `dist/**` (rebuilt).

---

## 2.  Zero authentication — paid APIs were wide open

**Problem**
- `/api/chat` created users and called the paid LLM with no auth, no rate limit.
- The Twilio webhook `/api/twilio/voice` returned TwiML without validating
  `X-Twilio-Signature` — anyone could spoof incoming calls.
- WebSocket endpoints (`/ws/voice-live`, `/ws/voice-pipeline`, `/ws/twilio`) accepted any
  client with only a `phone` query param.
- Result: cost abuse (Gemini Live / STT / TTS / LLM credits) and a bloated `users` table.

**Fix**
- New `src/utils/auth.ts` with:
  - `requireApiToken` – optional shared token middleware checking the `x-api-token` header
    (constant-time comparison). Only enforced when `API_AUTH_TOKEN` is set.
  - `createRateLimiter` – in-memory sliding-window rate limiter (60 req/min for chat,
    300 req/min for the Twilio webhook) with `429` responses and periodic cleanup.
  - `isValidTwilioSignature` – HMAC-SHA1 verification of the `X-Twilio-Signature` header
    (RFC-sorted POST body params). Enforced when `TWILIO_AUTH_TOKEN` is set.
- `src/server.ts` gates all `/api/chat*` routes with `requireApiToken` + rate limiter and all
  WebSocket connections with an optional `?access_token=` shared secret.
- `src/controllers/voice.controller.ts` now rejects invalid Twilio signatures with `403` and
  appends the WSS token to the `<Stream>` URL when configured.
- Test UIs updated to carry the tokens:
  - `test_voice_client.html` reads `?access_token=` from the URL.
  - `test_text_client.html` reads `?api_token=` and sends it in `x-api-token`.

**Files:** `src/utils/auth.ts` (new), `src/server.ts`, `src/controllers/voice.controller.ts`,
`src/config/env.ts`, `test_voice_client.html`, `test_text_client.html`, `.env.example`.

---

## 3.  A single DB/Redis failure crashed the whole server

**Problem**
- `wss.on('connection')` called `geminiLiveGateway.handleConnection()` and
  `twilioGateway.handleConnection()` without any `.catch()`.
- Inside those handlers, `getOrCreateUser()` and `memoryManager.onCallStart()` are awaited with
  no try/catch. On Node ≥15 an unhandled rejection terminates the process, killing **all**
  active calls because one call hit a Redis timeout.

**Fix**
- `GeminiLiveGateway.handleConnection` and `TwilioGateway.handleConnection` bodies are now
  wrapped in try/catch; failures send an error frame to the client and close the connection
  instead of rejecting.
- `src/server.ts` adds a `safeHandle()` backstop that catches any remaining promise rejection
  per connection and closes it.
- New `src/utils/process_guard.ts` installs process-level guards:
  - `unhandledRejection` → logged, server keeps serving (safety net).
  - `uncaughtException` → logged, then `exit(1)` so the process manager restarts cleanly.

**Files:** `src/gateway/gemini_live_gateway.ts`, `src/gateway/twilio_gateway.ts`, `src/server.ts`,
`src/utils/process_guard.ts` (new).

---

## 4.  Memory context leaked across concurrent calls

**Problem**
- `ContextWindowService` (used by `MemoryManager`) was a **process-global singleton** storing a
  single `memorySummary` and `toolResults[]`.
- `onCallStart` / `onToolResult` / `onCallEnd` wrote to that one shared object, so two
  concurrent phone calls cross-contaminated each other's preferences and search results.

**Fix**
- The context window is now **per-session**: `Map<sessionId, SessionContext>` with an idle
  TTL (12h default) and `cleanupExpiredIds()` eviction.
- All methods take `sessionId` (`addToolResult`, `getToolResults`, `injectMemorySummary`,
  `getContextForLiveApi`, `reset`).
- `MemoryManager` was updated to pass `sessionId` everywhere and exposes
  `cleanupIdleSessions()` for the periodic sweeper.
- `src/server.ts` runs a 10-minute sweeper that calls `memoryManager.cleanupIdleSessions()`.

**Files:** `src/infrastructure/memory/context/interface.ts`, `context_window.ts`,
`src/infrastructure/memory/memory_manager.ts`, `src/server.ts`.

---

## 5.  Startup wasn't fail-fast; `/health` lied

**Problem**
- `initializeAgent()` (checkpointer DB setup + Neo4j constraint creation) runs inside the
  `server.listen` callback with a catch that just printed a log. If it failed, the server kept
  accepting traffic while every chat/voice request 500'd.
- `/health` only returned a hardcoded `{ status: 'ok' }` with no dependency checks.

**Fix**
- On init failure, `src/server.ts` now logs the error and calls `process.exit(1)` so the
  process manager restarts with a clean state.
- `src/controllers/health.controller.ts` now performs real liveness checks:
  - `SELECT 1` against PostgreSQL and `PING` against Redis.
  - Returns `200` when healthy, `503` otherwise, with a `checks` object and timestamp.
- `src/config/db.ts` exports the `pool` so health can use it.

**Files:** `src/server.ts`, `src/controllers/health.controller.ts`, `src/config/db.ts`.

---

## 6.  Knowledge-graph memory never reached the model

**Problem**
- `memoryManager.getAgentContext()` assembled user context + recent turns, but no gateway used it.
- The pipeline gateway invoked the agent with only the raw transcript, so the "multi-layer
  memory" (Neo4j preferences, budgets, recent searches) had zero effect in production.

**Fix**
- The pipeline gateway and the chat controller now load the caller's knowledge-graph context
  (`memoryManager.graph.getUserContext`) and inject it as a short system message before every
  agent run. Failures are tolerated (memory problems never break a call).
- `src/gateway/pipeline_voice_gateway.ts` adds `buildUserContextMessages()`.
- `src/controllers/chat.controller.ts` adds `buildContextPrompt()`.

**Files:** `src/gateway/pipeline_voice_gateway.ts`, `src/controllers/chat.controller.ts`.

---

## 7.  Concurrent first-time users collided on the unique phone constraint

**Problem**
- `getOrCreateUser()` (and the chat controller's inline logic) did select-then-insert.
- Two simultaneous first calls with the same new phone number both selected nothing, both
  inserted → the second one failed with a PostgreSQL duplicate-key error (HTTP 500).

**Fix**
- `src/utils/user_helper.ts` now uses `INSERT ... ON CONFLICT DO NOTHING ... RETURNING`.
  If the insert wins, it returns the new user; if it loses (race), it reads the winner's row.
- The chat controller now reuses this helper instead of duplicating the logic.
- `src/tools/user_profile_tool.ts` insert is also `ON CONFLICT DO NOTHING` so it can never
  crash a turn on a race.

**Files:** `src/utils/user_helper.ts`, `src/controllers/chat.controller.ts`,
`src/tools/user_profile_tool.ts`.

---

## 8.  Unbounded session state + no graceful shutdown

**Problem**
- Chat sessions lived forever in a `Set<string>` (a memory leak when clients never called
  `/api/chat/end`).
- No `SIGINT`/`SIGTERM` handling → abrupt kills orphaned WebSocket sessions, open Postgres
  pools, Redis clients and the Neo4j driver.

**Fix**
- Chat sessions are tracked in a `Map<sessionId, lastAccessMs>` with a `SESSION_TTL_HOURS`
  expiry and a 10-minute sweeper (`src/controllers/chat.controller.ts`).
- `src/server.ts` adds graceful shutdown on `SIGINT`/`SIGTERM`:
  close all WebSocket clients with `1001`, then `wss`, then `server`, then
  `pool.end()`, `redis.disconnect()`, `graphDriver.close()`, finally `exit(0)`.

**Files:** `src/controllers/chat.controller.ts`, `src/server.ts`, `src/config/env.ts`.

---

## 9.  Malformed tool arguments crashed the LLM call

**Problem**
- `CustomChatModel._generate()` did `JSON.parse(tc.function.arguments)` unguarded. A provider
  returning non-JSON tool args killed the whole request.

**Fix**
- Wrapped in try/catch; on parse failure logs a warning and treats args as `{}`.

**File:** `src/infrastructure/llm/custom_chat_model.ts`.

---

## 10.  Environment configuration was undocumented/incomplete

**Problem**
- `.env.example` listed only 7 variables. The schema in `src/config/env.ts` **requires**
  `DATABASE_URL`, `NEO4J_PASSWORD`, `GEMINI_API_KEY` and defaults the live model to a
  suspicious name — any deployer following the example would crash at boot.

**Fix**
- `.env.example` rewritten with all variables, `[REQUIRED]` markers, the correct
  docker-compose port (5433) in the sample `DATABASE_URL`, and comments.
- `env.ts` gained new documented vars: `API_AUTH_TOKEN`, `WSS_ACCESS_TOKEN`,
  `TWILIO_AUTH_TOKEN`, `SESSION_TTL_HOURS`.

**Files:** `.env.example`, `src/config/env.ts`.

---

## 11.  Docker services weren't production-safe

**Problem**
- `qdrant:latest` unpinned → a surprise upgrade could change behavior.
- Redis had no persistence or restart policy; Postgres/Neo4j had no restart policy.

**Fix**
- `docker-compose.yml`:
  - `qdrant/qdrant:v1.13.6` (pinned).
  - Redis `7-alpine` with `--appendonly yes` and a `redisdata` volume.
  - `restart: unless-stopped` on all services.
  - Postgres healthcheck (`pg_isready`).

**File:** `docker-compose.yml`.

---

## 12.  Cleanup / hygiene

- Removed the dead no-op route `POST /api/api/chat/end` from `src/routes/chat.routes.ts`.
- Added `express.json({ limit: '1mb' })` to avoid unbounded JSON bodies.
- Normalized `phone`/`phoneNumber` inputs (`substring(0, 50)`) to respect the varchar column
  limits and avoid schema insert failures.

---

## Verification performed

| Check | Result |
|---|---|
| `npx tsc --noEmit` |  0 errors |
| `npm run build` (`tsc`) |  exit 0, ~65 files output |
| `node dist/server.js` smoke test (dummy env) |  boots real app, fail-fast init: `exit(1)` with clear message when Postgres unreachable |
| Stale `dist` removed & rebuilt |  `dist/server.js` is now the full application |

## Known limitations / recommended next steps

1. **Model IDs** – `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE`, `TTS/STT` defaults are env-driven
   but must be verified against your Google account before launch; pin them explicitly in `.env`.
2. **Multi-instance deployments** – the built-in rate limiter and session sweeper are
   in-memory and per-process. If you scale beyond one Node instance, move rate limiting to
   Redis or an edge gateway, and run migrations (`npm run db:migrate`) once.
3. **TLS** – put a reverse proxy (nginx/Caddy) in front that terminates HTTPS/WSS so phone
   numbers and streams are encrypted end-to-end.
4. **Runbook** – after first deploy: `npm run db:migrate`, `npm run db:seed`,
   `tsx src/scripts/index_properties.ts` to populate Qdrant.