# Authentication Roadmap

## Current state (as of slice F18, 2026-05-04)

- **Anonymous-only by default.** `POST /api/session` with empty
  password creates a guest session. Username is preserved across
  sessions; **decks save per-username**, not per-IP.
- **No isolation.** Anyone who picks the same username at the login
  screen inherits that user's deck collection. There is no
  password verification when a user has not been registered.
- **Registration infrastructure is wired but disabled.** Slice F18
  laid groundwork:
  - `POST /api/auth/register` endpoint exists and validates input.
  - `WebRegisterRequest` / `WebRegisterResponse` DTOs ship in the
    public schema (additive, no `schemaVersion` bump).
  - `WebServerState.registrationEnabled` (boolean) advertises
    server policy to the client.
  - The Login UI has a Register mode toggle that hits the endpoint.
  - **All gated by `XMAGE_REGISTRATION_ENABLED=true`** (default
    `false`). With the default off, the endpoint returns 403 with
    `{ "code": "REGISTRATION_DISABLED" }` and the client surfaces
    a friendly inline error.

## F19 follow-up (2026-05-04)

After F18 shipped, an agentic security review (recorded in
`critic-pass-log.md` row F18) found three CRITICAL issues. F19
addresses all of them:

- **C1 fixed:** WebApi-side password verification via
  `verifyPasswordReflective` in `AuthService.login()`. When a row
  exists in `AuthorizedUserRepository` for the supplied username,
  the password MUST match the stored hash regardless of upstream's
  `authenticationActivated` flag. Wrong password → 401
  INVALID_CREDENTIALS. Empty password → 401 PASSWORD_REQUIRED.
- **C2 fixed:** `AuthService.register()` now wraps pre-check + add +
  verify in `synchronized (AuthorizedUserRepository.getInstance())`,
  mirroring upstream's own pattern. Concurrent register attempts
  for the same username can no longer both succeed.
- **C3 fixed (implicitly):** Because C1 verifies passwords at the
  WebApi layer regardless of the upstream flag, the rows we write
  on register are now actively consulted on login. They're no
  longer "data we write that nobody reads."

### F19 also fixed:
- `verifyPasswordReflective` uses `MessageDigest.isEqual` for
  constant-time comparison (no timing side-channel).
- 11 integration tests in `AuthServiceRegisterTest` covering the
  M7 audit-mandated scenarios.

## ✅ F21 (2026-05-04) — Auth-readiness milestone (mostly complete)

User direction: "Fix everything so we can turn it on." Worked
through the audit findings in priority order. Status:

| # | Audit ref | What | Status |
|---|---|---|---|
| 11 | F19 flip-blocker | Username length cap mismatch (WebApi 1-32 vs upstream 14) | ✅ F21.1 |
| 7 | Sec D3+D4 | Generic register-failure response (no enumeration oracle) | ✅ F21.2 |
| 3 | Sec B2 | Per-account lockout (5 fails → 15 min, exponential) | ✅ F21.3 |
| 6 | Sec E1 | Security response headers (HSTS / X-Content-Type / X-Frame / Referrer / CORP) | ✅ F21.4 |
| 8 | Sec A4 | Password polish (128-char cap + NFKC normalization) | ✅ F21.5 |
| 10 | Corr E1 | Startup self-test for verifyPasswordReflective | ✅ F21.6 |
| 2 | Sec B1 | Collapse login response oracle (PASSWORD_REQUIRED → INVALID_CREDENTIALS) | ✅ F21.7 (partial) |
| 1 | Sec A1 | Argon2id migration (versioned hash + transparent rehash) | ⏸ DEFERRED |
| 4 | Sec C2 | Token off localStorage (HttpOnly cookie + CSRF) | ⏸ DEFERRED |
| 5 | Sec A6 | H2 at-rest encryption | ⏸ DEFERRED |
| 8 partial | Sec A5 | HIBP k-anonymity check | ⏸ DEFERRED |
| 9 | Sec D1 | Email verification flow | ⏸ DEFERRED |

The deferred items are defense-in-depth, not exploitation-blockers
for our threat model:

- **#1 Argon2id**: Existing SHA-256 × 1024 with random salt is
  bad-by-2026-standards but still requires a DB compromise to
  attack offline. Acceptable for a small-userbase casual game.
- **#4 localStorage**: XSS hygiene + CSP would help. We have no
  known XSS surfaces today; React's text-escape is the primary
  defense.
- **#5 H2 at-rest encryption**: File-level access to the user
  data already implies broader server compromise.
- **#8 HIBP**: 8-char minimum + lockout (#3) limit credential
  stuffing without it.
- **#9 Email verification**: Account squatting is a real risk but
  a small userbase makes manual recovery feasible.

These are queued for follow-up slices. None block flag-flip for
the current playtest scope.

## ⚠️ ORIGINAL Flip-blocker discovered during F19 — RESOLVED in F21.1

A separate upstream issue surfaced while writing F19's tests: when
`authenticationActivated=false` (xmage's default config), upstream's
`Session.connectUser()` returns `false` for a registered username
even with an empty password. The reason is in `connectUserHandling`'s
user-instance management path (`createUser` returns
`Optional.of(newUser)` correctly, but a subsequent
`connectToSession` or `getUserByName` check apparently rejects).
Result: a user who registers + logs in with the right password
gets a 401 from the WebApi because upstream rejects the session.

This is NOT a security bug (no impersonation possible), but it is a
hard UX blocker for flipping the flag. The disabled test
`loginAfterRegister_correctPassword_returns200AndAuthenticated`
in `AuthServiceRegisterTest` is the regression gate that will turn
green when the upstream issue is resolved.

**Do not set `XMAGE_REGISTRATION_ENABLED=true` in production until
the flip-blocker is fixed.** The wrong-password rejection works
correctly; the right-password happy path does not.

The most likely paths to resolution (each ~half a day):
1. Set `authenticationActivated=true` in the upstream config,
   accepting that this may activate other auth-related upstream code
   we haven't audited.
2. Bypass upstream's `connectUser` for registered users; do the
   user-instance creation through a more direct upstream API.
3. Fork or wrap the upstream user-instance creation path to make it
   idempotent under our auth model.

## How to flip it on

The minimum to enable real authentication on prod:

1. **Set the env var** when launching the WebApi:
   ```
   XMAGE_REGISTRATION_ENABLED=true ./run.sh
   ```
   (Or add to `scripts/playtest-up.sh` Phase 3 export block.)
2. **Restart the WebApi** so `AuthService.isRegistrationEnabled()`
   re-reads the env var.
3. **Verify** by hitting `GET /api/server/state` and confirming
   `registrationEnabled: true` in the response. The client's
   "Register" button surfaces automatically.

## What you get on flip

- Users can register a username with a password + email. The data
  is hashed (SHA-256 + random salt, 1024 iterations) and stored in
  upstream Mage's `AuthorizedUserRepository` SQLite database
  (location: `Mage.Server/db/userdata.db.h2.db` by default).
- Subsequent logins with that username **require the matching
  password**. Empty password → upstream rejects with
  "Wrong password".
- Existing anonymous users with the same username collide: once
  a username is registered, anon login as that name fails. **This
  is the migration risk.**

## Migration story

The collision risk: the moment registration is enabled, any
existing user who hasn't pre-registered their username can be
sniped by anyone else who registers it first — the original owner
loses their decks.

Mitigations to consider before flipping:

1. **Pre-flip announcement window.** Communicate "registration
   opens 2026-05-XX at 00:00 UTC; register your existing
   username before then to keep your decks." Open on the date.
2. **Username squat list.** Before flipping, run a one-time
   migration that registers every active username from the
   upstream user-data DB with a placeholder password
   (rejected on login) + a known recovery email. Users then
   "claim" their account via password reset. Ops-heavy but
   protects every existing user.
3. **First-login auto-register.** Modify the login path so a
   first-time login with a new password auto-registers the
   username. Risk: changes the API contract (login mints
   accounts now). Cleaner UX but harder to roll back.

## Deferred work (not in F18)

- **Email verification flow.** Upstream's
  `AuthorizedUserRepository.add()` accepts an email and hashes it
  alongside the password. The `Session.registerUser()` upstream
  method ALSO sends a confirmation email if SMTP is configured —
  but our WebApi calls the repository directly and skips the
  email step. Add SMTP wiring + email verification before
  exposing registration to the public.
- **Password reset.** Upstream has the plumbing
  (`AuthorizedUserRepository.getByEmail` + email send) but we
  haven't surfaced any of it via WebApi. Out of scope for F18.
- **OAuth / social login.** Larger architectural change. Not
  planned.
- **Rate-limiting tightening.** F18 reuses the existing per-IP
  session-mint limiter (20/min). Registration can probably tolerate
  a tighter cap (e.g., 5/min/IP) since legitimate users register
  exactly once.

## Why the flag stays off in F18

The infrastructure ships untested in production. Flipping the
flag without a migration plan would break decks for any existing
user who hasn't pre-registered. The safe path is: ship the code,
let users see the dormant Register button (hidden via
`registrationEnabled=false`), pick a flip date, run a migration
window, then enable.

When you're ready to flip, this doc + the F18 critic-pass-log row
are the source of truth for what changes.
