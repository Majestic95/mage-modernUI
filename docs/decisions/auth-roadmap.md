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
