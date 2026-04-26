# 0004 — Auth and sessions

- **Status:** Accepted (planning) — implementation lands as Phase 2 slice 5
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —
- **Builds on:** [ADR 0001](0001-path-c-strategy.md), [ADR 0002](0002-tech-stack.md), [ADR 0003](0003-embedding-feasibility.md)

---

## Context

The WebApi facade needs an auth layer before any client-state route (lobby, tables, deck list, game) can land. Upstream Xmage uses JBoss-Remoting-managed sessions tied to TCP connections; HTTP is connection-less, so we need a portable token model that maps onto upstream's session machinery without forking it.

This ADR specifies that mapping. It defers implementation to Phase 2 slice 5 — code lands then, this ADR is the contract.

### Investigation findings (2026-04-25 deep reads)

- **`SessionManagerImpl` is thread-safe** (`ConcurrentHashMap<String, Session>` at line 24) and **decoupled from Remoting at the API**. `createSession(sessionId, callbackHandler)` accepts any `InvokerCallbackHandler` — Remoting's interface, but the implementation can be ours. (See `Mage.Server/src/main/java/mage/server/SessionManagerImpl.java:36-39`.)
- **Session IDs are caller-provided strings.** We generate them; nothing forces UUIDs but they are the obvious choice.
- **Four upstream auth modes:** anonymous (`config.xml: authenticationActivated="false"`, the default), authenticated (SHA-256 + salt + 1024 iterations via Apache Shiro), admin (single shared password from `adminPassword` config field), test (`-testMode` CLI flag relaxes password verification).
- **Registration is real but unusable without email infra.** Upstream's registration auto-generates a 10-char password and emails it via Mailgun or SMTP. We have neither configured. Registration is deferred until Phase 6 or when an op puts email infra behind it.
- **Pre-existing `authToken` is a 6-digit password-reset code only** (`Mage.Common/src/main/java/mage/remote/Connection.java:23`). Bearer-token auth is new ground; we own that contract.
- **The session→callback wiring** routes game updates as `User.fireCallback() → SessionManager.getSession() → Session.fireCallback() → InvokerCallbackHandler.handleCallbackOneway()`. For slice 5 (login/logout only), a no-op handler is fine — the WebSocket-backed handler arrives in Phase 3.

---

## Decisions

### D1. Token transport — `Authorization: Bearer <token>`

REST-standard, easy to test with curl/Postman, browsers handle it without CSRF concern when paired with same-origin policy. Cookies are rejected — they pull in CSRF-token plumbing we don't need for a same-origin desktop client.

### D2. Token format — opaque random UUID

`UUID.randomUUID().toString()`, server-side. **Not a JWT.** Justification:
- No key management
- Easy to revoke (just drop from the map)
- Easy to rotate
- We never need to decode the token client-side

Stored in a `ConcurrentHashMap<String, WebSession>` in `Mage.Server.WebApi`. In-memory only — tokens are wiped on server restart, which is acceptable behavior (existing Xmage Swing client also forces re-login on server restart).

### D3. Session lifetime — sliding 24 h, hard cap 7 d

- `expiresAt = now() + 24h` on creation
- Sliding: every authenticated request bumps `expiresAt` by 24 h
- Hard cap: `createdAt + 7d` is the absolute ceiling regardless of activity
- Expired tokens return `401 Unauthorized` and are removed from the map

A background sweep runs every 60 s to evict expired entries (Javalin scheduler or simple `ScheduledExecutorService`).

### D4. Anonymous mode is mirrored

`config.xml: authenticationActivated="false"` is the production default for Xmage. The WebApi mirrors that:

- `POST /api/session` with **no body** (or empty body) returns a guest session
- `username` is generated server-side as `guest-<random-6-chars>` if not supplied; or use the provided one if `username` field is set without password
- The resulting `WebSession` has `isAnonymous: true`

When `authenticationActivated="true"` (a future op-config decision), `POST /api/session` with no credentials returns `401`.

### D5. Admin mode — explicit endpoint

Admin login is rare (server administration only). Separate it from the public flow:

- `POST /api/session/admin` with body `{ adminPassword }` — returns a `WebSession` with `isAdmin: true`
- Wrong password: 3-second delay (matching upstream's brute-force defense) then `401`

### D6. Registration deferred to Phase 6+

Upstream's registration requires Mailgun or SMTP for the auto-generated-password email. We have neither. Until ops sets up email infrastructure, the WebApi exposes **no** registration endpoint. If a registered account is needed, an admin creates it directly via the upstream Swing console.

### D7. Per-username concurrency — newest connection wins

If a user attempts to log in while another `WebSession` is active for the same username, the prior session is invalidated (its token is dropped, its upstream `Session` is disconnected via `SessionManager.disconnect()`). The new session takes its place.

This matches upstream's behavior (`Session.java:312-318` disconnects the prior session with `DisconnectReason.AnotherUserInstance`). Rationale: avoids stale dangling sessions, makes "I lost my browser tab" recovery automatic.

### D8. WebSocket callback handler — Phase 3 concern

For Phase 2 slice 5, the `InvokerCallbackHandler` we provide to `SessionManagerImpl.createSession()` is a no-op (drops callbacks silently). Login/logout work; game state push is impossible until Phase 3.

Phase 3 replaces the no-op with `WebSocketCallbackHandler` — receives the `ClientCallback`, serializes via the JSON DTO mapper, pushes through the per-game `/api/games/{id}/stream` WebSocket. The session lookup mechanism is unchanged; only the handler implementation evolves.

### D9. Auth middleware — Javalin handler chain

A single `BearerAuthMiddleware` sits in front of every protected route. It:

1. Reads the `Authorization` header
2. Looks up the token in the WebSession map
3. If absent or expired: short-circuit with `401`
4. If present: bumps `expiresAt`, attaches the `WebSession` to the Javalin request context (`ctx.attribute("session", webSession)`), and continues

Routes that don't need auth (`/api/version`, `/api/health`, `POST /api/session`, `POST /api/session/admin`) are explicitly excluded.

### D10. CORS — dev-friendly defaults, env-override for everything else

The default allow-list bakes in three origins so dev workflows just work:

- `http://localhost:5173` — Vite dev server
- `http://localhost:4173` — Vite preview
- `tauri://localhost` — Tauri-bundled production webclient

`XMAGE_CORS_ORIGINS` env var (comma-separated) **replaces** the default list when ops needs different origins. Empty string disables CORS entirely (locked-down).

Rationale: the project is desktop-only and the production webclient ships same-origin via Tauri, so the security argument for a strict default is weak in our specific shape. `localhost:*` is private to the dev's machine. The friction cost of a strict default ("dev had to set an env var to make `pnpm dev` work") outweighs the marginal lock-down.

---

## Architecture — `WebSession` ↔ upstream `Session`

```
HTTP request
   |
   | Authorization: Bearer <token>
   v
+---------------------------------+
| BearerAuthMiddleware            |
|   tokens: Map<String, WebSession>|
+---------------------------------+
   | ctx.attribute("session", ws)
   v
+---------------------------------+        +-----------------------------+
| Route handler                   |  uses  | EmbeddedServer (in-process) |
|   reads ctx.attribute(..)       |------->|   MageServerImpl            |
|   calls upstream methods        |        |   SessionManagerImpl        |
+---------------------------------+        |   UserManagerImpl           |
                                            +-----------------------------+
                                                       ^
                                                       | uses sessionId
                                                       |
                                            +-----------------------------+
                                            | NoOpCallbackHandler (slice 5)|
                                            | WebSocketCallbackHandler (P3)|
                                            +-----------------------------+
```

Each `WebSession` (one per Bearer token) owns exactly one upstream `Session` (one per `sessionId`). They live and die together. Token map is the only WebApi-side state; upstream's `SessionManagerImpl` is the source of truth for engine state.

---

## Wire format

### `WebSession` (top-level — carries `schemaVersion`)

```json
{
  "schemaVersion": "1.3",
  "token":         "550e8400-e29b-41d4-a716-446655440000",
  "username":      "alice",
  "isAnonymous":   false,
  "isAdmin":       false,
  "expiresAt":     "2026-04-26T22:30:00Z"
}
```

| Field | Type | Note |
|---|---|---|
| `schemaVersion` | string | wire-format version (bumps to 1.3 in slice 5) |
| `token` | string | UUID; client sends as `Authorization: Bearer <token>` |
| `username` | string | the actual username after server-side resolution (anon usernames look like `guest-ab12cd`) |
| `isAnonymous` | bool | true if no password was supplied or auth mode is off |
| `isAdmin` | bool | true if obtained via `POST /api/session/admin` |
| `expiresAt` | string | ISO-8601 UTC timestamp |

---

## Endpoint surface

### `POST /api/session`

**Request body** (all fields optional):

```json
{
  "username": "alice",
  "password": "..."
}
```

**Behavior:**
- Empty body → guest session, generated username
- `username` only → guest session with that username (anon mode)
- `username + password` → authenticated session (auth mode); `401` if password wrong; `403` if account locked

**Response:** `200 OK` with `WebSession` JSON. Sets the token only in the body — no `Set-Cookie`.

### `POST /api/session/admin`

**Request body:** `{ "adminPassword": "..." }`

**Response:** `200 OK` with admin `WebSession`, or `401` after a 3-second delay on wrong password.

### `GET /api/session/me`

Requires `Authorization: Bearer <token>`. Returns the current `WebSession` with `expiresAt` reflecting the post-bump value.

`401` if token missing/expired.

### `DELETE /api/session`

Requires `Authorization: Bearer <token>`. Revokes both the WebApi token and the upstream `SessionManager` session. Returns `204 No Content`.

`401` if token missing/expired.

---

## Error contract

| Status | When |
|---|---|
| 400 | Malformed body, invalid field types, username out of length range, invalid characters |
| 401 | Wrong password, expired token, missing token on protected route, unknown token, anonymous-mode-disabled with no credentials |
| 403 | Account locked (`AuthorizedUser.lockedUntil` in the future), account deactivated |
| 409 | Currently unused — username collisions are resolved via D7 (newest wins), not rejected |
| 412 | Version mismatch — should be impossible in-process; if it ever fires, log loudly |
| 429 | Rate-limit (deferred to a Javalin filter; not in slice 5) |
| 500 | Unexpected upstream error |

The error response body uses a single shape:

```json
{
  "schemaVersion": "1.3",
  "code":          "INVALID_CREDENTIALS",
  "message":       "Wrong username or password."
}
```

`code` is a stable enum-style string clients can switch on; `message` is human-friendly text safe to display.

---

## Open / deferred decisions

- **Rate limiting.** Defer to a slice 5b polish task once basic auth ships. Hot endpoints to protect: `POST /api/session`, `POST /api/session/admin`. Recommend `bucket4j` or a simple in-memory token bucket per IP.
- **Token persistence across server restarts.** Out of scope. If users care, they re-log-in. Match upstream's behavior.
- **Refresh tokens.** Not needed with sliding expiry on the access token. Revisit if we ever issue tokens to long-lived background processes.
- **Multi-factor auth.** Out of scope for the foreseeable future.
- **OIDC / federated auth.** Phase 7+ if ever. Not on the roadmap.

---

## Validation plan

Phase 2 slice 5 implementation must satisfy:

- All four endpoints (`POST /api/session`, `POST /api/session/admin`, `GET /api/session/me`, `DELETE /api/session`) have integration tests covering happy path + every error contract row
- Snapshot test for `WebSession` JSON output (locks the 6-field shape)
- Sliding-expiry behavior verified with a unit test that fast-forwards a stub clock
- The newest-wins concurrency rule (D7) verified with a test that creates two sessions for the same username and asserts the first one is gone
- Admin failed-login 3-second delay verified (test marks slow with appropriate annotation)
- Bearer auth middleware tested against an unauthenticated route (returns 401) and an authenticated one (forwards `WebSession` via `ctx.attribute`)
- Schema CHANGELOG bumped 1.2 → 1.3 in the same commit

If any test reveals an upstream-coupling assumption that doesn't hold (e.g., `SessionManagerImpl` rejects our custom `InvokerCallbackHandler`), the spike pauses and this ADR gets revisited.

---

## References

- [PATH_C_PLAN.md — Phase 2](../PATH_C_PLAN.md) — slice 5 placement
- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [ADR 0002 — Tech stack](0002-tech-stack.md)
- [ADR 0003 — Embedding feasibility](0003-embedding-feasibility.md)
- Upstream `SessionManagerImpl` — `Mage.Server/src/main/java/mage/server/SessionManagerImpl.java`
- Upstream `Session` — `Mage.Server/src/main/java/mage/server/Session.java`
- Upstream `UserManagerImpl` — `Mage.Server/src/main/java/mage/server/UserManagerImpl.java`
- Upstream `AuthorizedUserRepository` — `Mage.Server/src/main/java/mage/server/AuthorizedUserRepository.java`
- Upstream `Connection` — `Mage.Common/src/main/java/mage/remote/Connection.java`
- Upstream `config.xml` — `Mage.Server/config/config.xml`
