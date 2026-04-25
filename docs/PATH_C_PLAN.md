# Path C — Phased Plan

> Living document. Update as phases close, decisions firm up, or assumptions change. See [`decisions/`](decisions/) for ADRs locking in specific choices.

**Last reviewed:** 2026-04-25

---

## Goal

Deliver a modern, web-native client for [Xmage](https://github.com/magefree/mage) by running the existing Java game engine unchanged behind a JSON/WebSocket facade, with a React + TypeScript client on top. The fork stays compatible with upstream so we keep getting daily card additions for free.

**Definition of done (long horizon):** a player can install our fork, run the server, open the new client in a browser or Tauri-wrapped desktop app, and play 1v1 + multiplayer + draft + tournament games against humans or AI with feature parity to the existing Swing client. UX is materially better than today's; performance is at least as good.

---

## Strategy in one paragraph

Two artifacts own the work: **`Mage.Server.WebApi/`** (a new Maven module that embeds `MageServerImpl` in-process and exposes REST + WebSocket endpoints) and **`webclient/`** (a new React + TS + Vite frontend). Everything else in the repo — engine, server core, 28k+ card classes, plugins — stays upstream-tracked and untouched. The `mage.view.*` types are isolated inside WebApi via hand-written DTO mappers; the wire format is *our* contract, versioned, and never auto-derived from upstream classes. See [ADR 0001](decisions/0001-path-c-strategy.md) for why this strategy over alternatives.

---

## Phase plan

Each phase has a single exit gate. Don't move on until the gate is met. Estimates are calendar weeks at full-time pace; halve the velocity for part-time.

### Phase 0 — Setup (1-2 weeks)

**Goal:** local environment is reproducible and the existing system works end-to-end before we touch anything.

**Deliverables:**
- [ ] JDK 21 installed, `JAVA_HOME` pointed at it
- [ ] Maven 3.9+ verified
- [ ] Node 20+ + pnpm verified
- [ ] `make build` runs clean to completion
- [ ] `make package` produces server + client zips
- [ ] Vanilla server + Swing client run locally; one full game played vs. AI
- [ ] One set of card images downloads successfully via the existing pipeline
- [ ] `docs/dev-setup.md` written, capturing exact steps that worked
- [ ] Per-directory `.gitignore` strategy decided (since we can't modify root upstream `.gitignore`)

**Exit gate:** you've played one game vs. AI on the unmodified system. We know the baseline works.

**Risks:**
- First Maven build can take 5-15 minutes (28k card classes); failures are common on Windows + Java toolchain mismatches
- Card image download pipeline depends on external sources; rate-limit issues possible

---

### Phase 1 — Spike (2-3 weeks)

**Goal:** prove the embedding strategy works before committing to a framework. Read enough of the codebase to write Phase 2 confidently.

**Deliverables:**
- [ ] Read in detail: `MageServerImpl`, `Session` interface family, `GameView`, `PlayerView`, `CardView`, `PermanentView`, `StackView`, `CombatGroupView`
- [ ] Read in detail: `PlayerAction` enum + how `sendPlayerAction` dispatches on data type
- [ ] Read in detail: `Connection.java`, `SessionImpl.java`, callback registration
- [ ] Write a minimal Java test under `Mage.Server.WebApi/src/test/` that boots `MageServerImpl` in-process, instantiates a session manually, asserts at least one server method returns expected data
- [ ] Decide: HTTP/WS framework — Javalin (current default per [ADR 0002](decisions/0002-tech-stack.md)) vs. Vert.x vs. Spring Boot. Document the call.
- [ ] Decide: callback bridge approach — does our WS layer subscribe to existing `InvokerCallbackHandler` flow, or are we wrapping `MageServerImpl` methods that the callback layer drives?
- [ ] Update [ADR 0002](decisions/0002-tech-stack.md) with concrete reasoning if Javalin is confirmed

**Exit gate:** an in-process boot test compiles and passes. We've answered "does the embedding strategy actually work?" with code, not theory.

**Risks:**
- Server may have static-singleton or process-wide state that resists in-process embedding (port bindings, thread pools, file locks)
- Callback fan-out may have ordering subtleties not visible from interface signatures

---

### Phase 2 — WebApi MVP (6-8 weeks)

**Goal:** REST surface area covering everything except in-game state. Authentication, lobby, table CRUD, card metadata, server status. No game stream yet.

**Deliverables:**
- [ ] `Mage.Server.WebApi` module created and registered in root `pom.xml` (the only sanctioned root-pom modification)
- [ ] `WebApiMain` boots Javalin on port 18080, in-process server on existing port
- [ ] `GET /api/version` — schema, server, build info
- [ ] `GET /api/health` — server readiness probe
- [ ] `POST /api/session` / `DELETE /api/session` — login/logout, session token
- [ ] `GET /api/rooms` / `GET /api/rooms/{id}/tables` — lobby state
- [ ] `POST /api/rooms/{id}/tables` — create table
- [ ] `POST /api/rooms/{id}/tables/{id}/join` — join table
- [ ] `GET /api/cards/{id}` and `GET /api/cards?q=` — card lookup against H2 `CardRepository`
- [ ] All routes have integration tests against an embedded server
- [ ] All DTO mappers have JSON snapshot tests
- [ ] First JSON schema snapshots committed to `docs/schema/`
- [ ] `docs/api.md` reference documenting every endpoint and payload

**Exit gate:** a Postman/curl/HTTPie session can log in, list tables, create a table, join a table, look up a card — without ever launching the Swing client.

**Risks:**
- Session/auth flow tightly coupled to old client behaviors we don't fully understand yet
- `DeckCardLists` JSON encoding for table-creation payloads may be more nuanced than expected (deck file format vs. live deck object)

---

### Phase 3 — WebApi game stream (8-12 weeks)

**Goal:** the missing piece — a non-Java client can play a full game.

**Deliverables:**
- [ ] WebSocket endpoint `/api/games/{id}/stream` (per-game subscription)
- [ ] Callback bridge: subscribes to server's existing game-update callbacks and fans out as JSON frames
- [ ] `WebGameView` + all sub-DTOs (`WebPlayerView`, `WebCardView`, `WebPermanentView`, `WebStackEntry`, `WebCombatGroup`, etc.) — hand-written, no `mage.view.*` types in public surface
- [ ] `POST /api/games/{id}/actions` — encodes all 60+ `PlayerAction` enum values + their data payloads
- [ ] `PlayerActionCodec` with explicit tagged-union encoding and exhaustive switch over `PlayerAction`
- [ ] Test matrix covering every action type (one test per action with representative data)
- [ ] Snapshot tests for every view DTO
- [ ] Scripted JS/TS test client that plays a full 1v1 game end-to-end (driven by Vitest + ws library)

**Exit gate:** a Node test script can connect to WebApi, join a 1v1 table against AI, play a real game (cast spells, attack, block, end the game), and the full flow completes without manual intervention.

**Risks:**
- `PlayerAction` data-payload polymorphism is the highest-risk encoding work; getting type discriminators wrong silently corrupts game state
- Callback ordering across concurrent state updates may not survive serialization-and-replay
- Triggered ability ordering UI (when multiple triggers stack) is one of the messiest game flows to encode
- Disconnect/reconnect semantics need explicit thought; Phase 3 covers happy path, but at least define behavior

---

### Phase 4 — Webclient foundation (6-8 weeks, can overlap Phase 3)

**Goal:** the new UI exists, can authenticate, browse cards, and join a table. Game window is the next phase.

**Deliverables:**
- [ ] `webclient/` directory scaffolded with Vite + TS + Tailwind v4
- [ ] `webclient/.gitignore` for `node_modules/`, `dist/`, `.vite/`, `.env*`
- [ ] Per-directory `tsconfig.json` with strict mode + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
- [ ] Auth flow — login, registration, session restore
- [ ] Lobby — room list, table list, table detail
- [ ] Card library — searchable, sortable, with Scryfall image fetching by `setCode + collectorNumber`
- [ ] Service-worker image cache
- [ ] Deck list view (read-only first; deck builder is Phase 5+)
- [ ] Zod schemas for every WebApi response, validated at parse time
- [ ] Typed WebSocket client wrapper
- [ ] Zustand store with logical slices (auth, lobby, cards, decks, game)
- [ ] Storybook or equivalent for component review (optional but recommended)

**Exit gate:** you can open `pnpm dev`, log in, browse cards, see active tables, and click "join" on one — without touching the Swing client.

**Risks:**
- Scryfall rate-limits aggressive image bulk fetch (~20 req/s soft limit)
- Session/auth handshake mismatches between WebApi shape and what the client expects (the integration smoke test catches this)

---

### Phase 5 — Game window MVP (16-24 weeks)

**Goal:** the hardest UI in the project. Full 1v1 game playable through the new client. No multiplayer, no draft yet — focused parity for one game type.

**Deliverables:**
- [ ] Battlefield rendering — your permanents + opponent's permanents, with attack/block highlighting
- [ ] Hand — drag-or-click-to-play, hover-to-zoom
- [ ] Stack — visible, with rules-text-on-hover for each entry
- [ ] Mana pool — interactive, showing pending mana
- [ ] Phase / turn / priority indicators
- [ ] Targeting UI — click target, multi-target, illegal-target feedback
- [ ] Combat declaration — declare attackers, declare blockers, damage assignment order
- [ ] Triggered ability ordering UI (when multiple triggers stack)
- [ ] "Choose one" / "X is" / mode-select dialogs
- [ ] Mulligan flow
- [ ] Card-detail overlay (zoom + full text)
- [ ] Graveyard / exile / library (top-card-revealed) browsers
- [ ] Game log + chat
- [ ] Concede / draw / undo flow
- [ ] Game-over screen with replay link

**Exit gate:** a complete 1v1 game vs. AI plays from start to finish through the new client, with no graceful-failure modes ("oops can't do that here, please use Swing"). Record a 5-minute screen capture as the exit artifact.

**Risks:**
- This is the project's defining phase. If it slips, ship it slipped — don't compromise on correctness. A game that mostly works ruins the project's value.
- AI bot's response time is bounded but variable; UI needs to handle "thinking..." states gracefully
- Multiplayer-aware widgets (like phase indicators) need to render gracefully even though Phase 5 is 1v1 only

---

### Phase 6 — Parity sweep (24-40 weeks)

**Goal:** match the existing Swing client's feature surface so the new client is a drop-in replacement.

**Deliverables:**
- [ ] Multiplayer (3+ player tables)
- [ ] Free-for-all, two-headed-giant, commander multiplayer modes
- [ ] Draft mode (one of the more visually complex flows)
- [ ] Tournament UI
- [ ] Replays — read replay format, render game state over time
- [ ] Preferences — every Swing client preference key has a webclient equivalent
- [ ] Themes — at minimum, a dark theme + a light theme
- [ ] Keyboard shortcuts (parity with Swing client where they exist)
- [ ] Accessibility pass — ARIA labels, keyboard nav, color-blind-safe palettes
- [ ] Internationalization scaffold (string extraction; not actual translations)

**Exit gate:** a Swing-client user can install ours and not feel anything is missing. Get one external person to play 5 games and report no blockers.

**Risks:**
- Long phase = morale risk. Break it into 2-3 milestones with public demos.
- Multiplayer state push is more complex than 1v1 (4-8 simultaneous viewers per game)

---

### Phase 7 — Polish (ongoing)

**Goal:** the things that take a working app and make it good.

**Areas:**
- Animations and transitions (card draws, stack resolution, attack movements)
- Sound design (subtle, not Hearthstone-loud)
- Mobile + tablet responsive layouts
- Tauri v2 desktop packaging — installer for Win/Mac/Linux
- Performance — frame budget, memory caps for large games
- Telemetry (opt-in) for stability metrics
- Public docs site for end users

This phase has no exit gate; it's where the project lives forever.

---

## Cross-cutting concerns

### Upstream sync cadence
- Weekly `git fetch upstream && git merge --ff-only upstream/master` into local `master`, then merge `master` into `main`
- Before any major feature, sync first to catch upstream-driven view-class changes
- Snapshot tests in `Mage.Server.WebApi` will trip when upstream renames a field; that's the signal to update mappers, not panic

### Schema versioning
- Every JSON payload includes `"schemaVersion": "X.Y"`
- Bump major (`1.0` → `2.0`) on breaking changes
- Bump minor (`1.0` → `1.1`) on additive changes
- Schemas snapshotted in `docs/schema/`; CI compares output to snapshots
- Client refuses to connect on major mismatch; logs warning on minor mismatch

### Image strategy
- Card images sourced from Scryfall via `setCode + collectorNumber`
- Service worker caches in browser; Tauri version uses native file cache
- Bundle nothing in the repo — images are user-cached on demand
- No fallback to upstream's `Mage.Plugins` image providers in Phase 4-5; revisit in Phase 6 if Scryfall coverage is incomplete

### Telemetry
- Deferred to Phase 7
- Opt-in only; no telemetry on by default
- Local-first metrics: log to file, optional upload

### CI
- Phase 2 stand-up: GitHub Actions on push to `main` and PR
- Run: Java unit + integration tests for WebApi, webclient typecheck + lint + tests
- Defer Playwright E2E to Phase 5+
- Weekly job: `git fetch upstream && git diff upstream/master -- 'Mage.Common/**'` to flag view-class drift early

### Build orchestration
- Phase 2 stand-up: a `Makefile` target `make webapi` for "build just our module"
- Phase 4 stand-up: a `Makefile` target `make webclient` for the frontend
- Don't replace upstream's `make build` — add to it

### Auth and session model
- Phase 2 mirrors existing Xmage auth (username + password against `UserManager`)
- Phase 7 (or earlier if needed): consider OAuth/OIDC for federated identity

---

## Risk register

| ID | Risk | Severity | Mitigation | Owned by |
|---|---|---|---|---|
| R1 | In-process embedding of `MageServerImpl` reveals static-singleton issues | High | Phase 1 spike validates before Phase 2 commitment | — |
| R2 | `PlayerAction` JSON encoding has silent type-confusion bugs | High | Phase 3 exit gate is end-to-end game; test matrix per action | — |
| R3 | Upstream renames a `View` field; mappers compile but emit wrong data | High | Snapshot tests + weekly drift CI | — |
| R4 | Scryfall rate-limits or changes API | Medium | Cache aggressively; bundle a `cards.json` snapshot for offline lookup | — |
| R5 | Phase 5 (game window) burns out solo dev | Real | Break into milestones; public demos; ship at any usable point | — |
| R6 | Schema drift between WebApi and client during co-development | Medium | Zod parse tests + JSON snapshot tests + version handshake | — |
| R7 | Multiplayer state push has ordering issues 1v1 doesn't expose | Medium | Phase 6 includes a 4-player integration test | — |
| R8 | Tauri packaging discovers platform-specific WS/auth issues | Low | Tauri deferred to Phase 7; web app proves the architecture first | — |
| R9 | Triggered ability ordering UI is fundamentally hard | Medium | Steal patterns from MTGA / Magic Online observation; Phase 5 buffer for it | — |
| R10 | Disconnect/reconnect mid-game corrupts state | Medium | Define behavior in Phase 3; reconnect-resume test in Phase 5 | — |

---

## Open questions

These need answers before the phase that depends on them. Track here; convert to ADRs as they get answered.

1. **(Phase 2)** Auth — do we mirror existing `UserManager` exactly, or simplify (e.g., session token only, no password reset)?
2. **(Phase 3)** Disconnect/reconnect — does the server hold game state for N minutes when a player drops, or end the game immediately? What does the existing Swing client do today?
3. **(Phase 3)** Spectator mode — does WebApi expose game state to non-player observers? When?
4. **(Phase 4)** Deck file format — do we accept the existing `.dck` format, JSON, both, or a new format?
5. **(Phase 5)** Card-art licensing — Scryfall's terms permit our usage pattern, but do we cache and re-serve? Worth confirming for the Tauri version.
6. **(Phase 6)** Themes — do users define their own (CSS vars), or do we ship N curated themes?
7. **(Phase 7)** Public hosting — does the user run their own server, or do we offer a hosted option? Implications for auth, costs, ToS.

---

## Update log

- **2026-04-25** — Doc created. Path C confirmed via [ADR 0001](decisions/0001-path-c-strategy.md). Tech stack confirmed via [ADR 0002](decisions/0002-tech-stack.md). Phase plan locked through Phase 5; Phase 6+ scoped at high level only.
