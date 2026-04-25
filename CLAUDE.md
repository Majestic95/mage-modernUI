# CLAUDE.md — Xmage Modern UI Fork

> Personal fork of [magefree/mage](https://github.com/magefree/mage) focused on a modern UI/UX rewrite while preserving the existing Java game engine, server, and card database.

This file is the project's working contract. Read it at the start of any session. Update it the same session a convention changes — stale guidance is worse than no guidance.

---

## Project Overview

**Repo:** `https://github.com/Majestic95/mage-modernUI` (fork of `magefree/mage`)
**Local path:** `F:\xmage`
**Strategy:** Path C — JSON/WebSocket facade in front of the existing Java server, plus a new web/desktop client. The engine, server core, and 28k+ card implementations stay upstream-tracked and untouched.

The two artifacts we own:
1. **`Mage.Server.WebApi/`** — new Maven module exposing REST + WebSocket on top of the existing `MageServerImpl`. This is the protocol firewall.
2. **`webclient/`** — new top-level monorepo directory holding the React + TypeScript client. Ships as a web app and (later) a Tauri-wrapped desktop binary.

Everything else in the repo is upstream territory and is **read-only for us**.

---

## Hard Constraints — Load-Bearing Rules

These are non-negotiable. Violating them undoes the whole project's leverage.

1. **Never push to upstream.** The `upstream` remote has its push URL set to `DISABLED_NEVER_PUSH_TO_UPSTREAM`. Git will hard-fail any accidental `git push upstream`. No `gh pr create` against `magefree/mage` without explicit per-action authorization.
2. **Never modify upstream-tracked files** without explicit sign-off. Specifically: anything under `Mage/`, `Mage.Common/`, `Mage.Server/`, `Mage.Sets/`, `Mage.Server.Console/`, `Mage.Server.Plugins/`, `Mage.Plugins/`, `Mage.Tests/`, `Mage.Verify/`, `Mage.Reports/`, `Utils/`, the root `pom.xml`, `Makefile`, `clean_dbs.sh`, `repository/`, and any existing top-level docs. The only exception is the root `pom.xml` to register a new module — and that needs sign-off.
3. **DTO firewall.** `Mage.Server.WebApi`'s public types (anything serialized to JSON or referenced by the client) must not be `mage.view.*` classes. Hand-written DTOs only. Mappers do the translation. This isolates the client from upstream view-class drift.
4. **Schema versioning.** Every JSON payload includes `"schemaVersion": "X.Y"`. Bump on any breaking change. Client refuses to connect on mismatch.
5. **Upstream is fetch-only.** The `upstream` remote is used to pull new card additions and bugfixes into our `master` tracking branch. We never edit `master` ourselves; we merge from `upstream/master`.

---

## Repository Topology

```
F:\xmage\
├── Mage/                        ← UPSTREAM (read-only)
├── Mage.Common/                 ← UPSTREAM (read-only) — DTOs, RPC interfaces, mage.view.*
├── Mage.Server/                 ← UPSTREAM (read-only)
├── Mage.Sets/                   ← UPSTREAM (read-only) — 28k card classes
├── Mage.Server.Plugins/         ← UPSTREAM (read-only)
├── Mage.Server.Console/         ← UPSTREAM (read-only)
├── Mage.Plugins/                ← UPSTREAM (read-only)
├── Mage.Client/                 ← UPSTREAM (read-only) — old Swing client; kept as reference
├── Mage.Tests/                  ← UPSTREAM (read-only)
├── Mage.Verify/                 ← UPSTREAM (read-only)
├── Mage.Reports/                ← UPSTREAM (read-only)
├── Utils/                       ← UPSTREAM (read-only)
├── repository/                  ← UPSTREAM (read-only)
├── pom.xml                      ← UPSTREAM (modify only to register new modules, with sign-off)
├── Makefile                     ← UPSTREAM (read-only)
│
├── Mage.Server.WebApi/          ← OURS — JSON/WebSocket facade module
├── webclient/                   ← OURS — React + TS client
├── docs/                        ← OURS — design docs, plans, decisions
└── CLAUDE.md                    ← OURS — this file
```

**Git remotes:**
- `origin` → `Majestic95/mage-modernUI` (our fork; push + fetch)
- `upstream` → `magefree/mage` (fetch only; push is disabled)

**Branches:**
- `master` — tracks `upstream/master`. Never directly modified. `git merge --ff-only upstream/master` only.
- `main` — our default working branch. Branches off `master`. All feature branches branch from `main`.
- `feat/*`, `fix/*`, `refactor/*`, `docs/*`, `chore/*` — short-lived feature branches. Squash-merge into `main` (or rebase, depending on history shape).

**Upstream sync cadence:** weekly, or before starting a major feature. New cards are added daily upstream — we want them.

```bash
git fetch upstream
git checkout master && git merge --ff-only upstream/master
git checkout main && git merge master
```

---

## Tech Stack

### Server side (`Mage.Server.WebApi`)
- **Java 17+ LTS** for the WebApi module (overrides upstream's Java 8 target via module-local `pom.xml`). JDK 17 minimum, JDK 21 fine. JDK 17+ compiles Java 8 source for the upstream modules via `--release 8`, so the whole build works with one toolchain.
- **[Javalin 5+](https://javalin.io/)** — lightweight web framework, native WebSocket, ~5MB. Built on Jetty.
- **Jackson** for JSON. **No auto-serialization of upstream classes** — see DTO firewall.
- **SLF4J + Logback** for logging (matches the migration upstream is moving toward).
- **JUnit 5** for tests.

### Client side (`webclient/`)
- **React 18+ + TypeScript 5+ + Vite 5+** — strict mode, no exceptions.
- **Zustand** for state — game state is WebSocket-driven, Zustand handles it cleanly without Redux ceremony.
- **Tailwind CSS v4** for styling. No component library — card-game UI is too custom.
- **Zod** for runtime validation of every WebSocket payload. Catches DTO drift loudly at the boundary.
- **Vitest + Testing Library** for tests.
- **Tauri v2** for desktop packaging (deferred; web app first).
- **Card images:** fetch from Scryfall by `setCode + collectorNumber`. Cache via service worker.
- **Card rendering:** CSS transforms for tap/flip/counters, SVG for mana symbols.

### Toolchain prerequisites
- **Build JDK 17+** (`JAVA_HOME` set to it; JDK 17 currently used). Used for `mvn` and our `Mage.Server.WebApi` module.
- **Runtime JDK 8** for upstream `mage-server.jar` / `mage-client.jar`. JBoss Remoting (the network library) uses pre-module-system reflection that JDK 9+ rejects; client errors with *"Wrong java version"* on JDK 17. Phase 1 spike will evaluate `--add-opens` flags as a route to a single-JDK setup.
- Maven 3.9+
- Node 20+ (Node 24 currently installed)
- pnpm (preferred over npm) — install via `corepack enable && corepack prepare pnpm@latest --activate`

---

## Build & Run

### Full build (Java side)
```bash
# From F:\xmage
make build      # mvn install package -DskipTests
make package    # zips client + server artifacts
make install    # clean + build + package
```

### Build just our module (faster iteration)
```bash
mvn -pl Mage.Server.WebApi -am package -DskipTests
```

### Run the server with WebApi attached
```bash
# From F:\xmage\Mage.Server.WebApi (or wherever WebApiMain lives)
java -cp <webapi-and-deps> mage.webapi.WebApiMain
# Defaults: classic server on 17171, WebApi REST on 18080, WebApi WS on 18081
```

### Webclient
```bash
# From F:\xmage\webclient
pnpm install
pnpm dev          # Vite dev server, default port 5173
pnpm build        # tsc + vite build
pnpm test         # vitest one-shot
pnpm test:watch
pnpm lint
pnpm typecheck    # tsc --noEmit
```

### Pre-commit gate
```bash
# Java side (when WebApi has changed)
mvn -pl Mage.Server.WebApi -am verify

# Webclient side (when webclient has changed)
cd webclient && pnpm typecheck && pnpm lint && pnpm test
```

---

## Coding Standards

### TypeScript
- **No `any`.** Use `unknown` and narrow, or define proper types. `as any` is a code smell that gets removed in review.
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types/components/classes, `UPPER_SNAKE_CASE` for constants, `kebab-case.ts` for filenames.
- **Prefer `interface` over `type`** for object shapes. Use `type` for unions, intersections, and utility types.
- **`satisfies` over `as`** wherever possible.
- **No default exports** except React components and Vite-required entry points. Named exports keep refactors safe.
- **Strict mode on** in `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.
- **Functional components only.** No class components.
- **No raw `useState` for derived state** — `useMemo` it.
- **Effects are escape hatches, not the default.** If you reach for `useEffect`, ask whether the data should live in Zustand or be derived during render.

### Java (WebApi module only)
- **Java 17+ features encouraged:** records for DTOs, `var` for local inference, sealed types for closed hierarchies, pattern matching in switch, text blocks for SQL/JSON literals.
- **Naming:** `PascalCase` for classes/interfaces/records, `camelCase` for methods/fields, `UPPER_SNAKE_CASE` for constants.
- **No raw types.** No `List` without generic; no `Object` return where a real type fits.
- **No `System.out.println` in committed code.** Use SLF4J: `private static final Logger log = LoggerFactory.getLogger(MyClass.class);`
- **Records for DTOs.** `public record WebGameView(String schemaVersion, ...) {}` — compact, immutable, free `equals`/`hashCode`/`toString`.
- **Prefer `Optional<T>` over nullable returns** at API boundaries. Inside hot loops, plain null is fine.
- **No checked exceptions in WebApi public methods.** Wrap in `WebApiException extends RuntimeException`.

### File size discipline (both languages)
- **Soft cap: 400 lines per source file.** Past this, evaluate whether the file is doing too much. Quick overshoots in the 410–440 range are fine; a file *trending* toward 500 means plan a split now, not later.
- **Hard cap: 500 lines.** Split before merge. **Documented exceptions allowed** — write a comment block at the top of the file explaining why splitting hurts more than it helps (e.g., generated code, exhaustive enum mapping, large data table, single-purpose snapshot). No silent overshoots; if there's no comment, it gets split.
- **Test files are exempt.**
- **Generated code is exempt** (and should live in `.gitignore`-managed paths anyway).

### Comments
- Comments explain **why**, not what. The code is the *what*.
- No commented-out code. Delete it; git remembers.
- No "this was added for ticket #X" — that belongs in the commit message.
- Multi-line block comments only for module-level rationale, never per-function.

---

## Architecture Principles

### 1. Server-authoritative, always
The existing Xmage server is the single source of truth for game state. The new client is a **view + input layer**. Never duplicate game logic client-side. If the client looks like it needs a rule (e.g., "can I tap this?"), the server should answer; the client renders the answer.

### 2. DTO firewall is sacred
- `mage.view.*` types **never** appear in WebApi public method signatures, public fields of public classes, or any JSON.
- Mapper classes (`*Mapper`) are package-private utilities. They convert `GameView` → `WebGameView` and `WebPlayerAction` → `PlayerAction` payload.
- This is the **only** thing that protects the client from upstream churn. Treat it like a security boundary.

### 3. Explicit JSON schema, versioned
- Every payload includes `"schemaVersion": "X.Y"`.
- Schema lives in `docs/schema/` as `.json` snapshots. CI checks generated JSON against snapshots.
- On breaking change: bump major (`1.0` → `2.0`), update snapshot, update client zod schemas, write a migration note in `docs/schema/CHANGELOG.md`.

### 4. WebSocket per game, REST for the rest
- **REST** for: auth, lobby/table CRUD, card lookup, replay metadata, server status.
- **WebSocket** for: per-game state stream (server → client) and player actions (client → server).
- One WS connection per active game; closed when the user leaves the game. Lobby presence is REST-polled or a separate lightweight WS — TBD in Phase 2.

### 5. Embed, don't duplicate
WebApi instantiates `MageServerImpl` in-process and calls its existing methods. Never reimplement server logic in WebApi. If `MageServerImpl` lacks an entry point we need, add a thin adapter in WebApi that uses what's there — don't fork upstream.

---

## Testing

- **Every WebApi route has at least one integration test** that hits the real Javalin instance with an embedded `MageServerImpl`. Mocks lie; integration tests don't.
- **Every DTO mapper has a snapshot test** of its JSON output. Snapshot tests catch upstream view-class drift the moment it happens, even if our code still compiles.
- **Every client zod schema has a parse test** with a representative payload pulled from a snapshot.
- **No skipping tests.** A feature without tests is incomplete.
- **Test files mirror source paths.** `webclient/src/game/Stack.tsx` → `webclient/src/game/Stack.test.tsx`. `Mage.Server.WebApi/src/main/java/.../GameRoutes.java` → `Mage.Server.WebApi/src/test/java/.../GameRoutesTest.java`.

---

## Mandatory Breakage Analysis — ALWAYS Before Coding

**Every change** — no matter how small — gets a written breakage analysis **before** any code is written. This is a hard constraint, not a guideline. The goal is **scope-locked, mindful** changes; the cost is one minute of typing.

If you find yourself coding without having written this analysis, **stop, revert if needed, and write it.** The scope drift you avoid by being mindful is worth multiples of the typing cost.

### What every analysis must include

1. **Scope lock** — one sentence: what IS in scope, what is NOT. Anything outside scope gets noted as a follow-up; do not let it pull in.
2. **What I'm changing** — files, types, functions, public contracts, build config, JSON schema.
3. **What could break** — direct callers, indirect callers via reflection/DI, tests, the wire schema, the client, upstream rebase compatibility, runtime behavior under disconnect / concurrency / mid-game state.
4. **Edge cases** — empty inputs, null states, race conditions, schema mismatches, partially-applied changes if interrupted.
5. **Schema impact** — does this require a `schemaVersion` bump? (Yes/no + which version.)
6. **Upstream rebase impact** — does this touch upstream-tracked files? **If yes: stop and confirm with the user before continuing.**
7. **Test plan** — which new tests, which existing tests cover the change.

### The rule is ALWAYS — the depth scales

- **Trivial change** (rename a local var, typo, formatting, comment fix): a single sentence covering scope + "no breakage expected, covered by existing tests" is sufficient — but it must be written.
- **Non-trivial change** (anything that touches a public type, a route, a mapper, the wire format, build config, or behavior under load): full structured analysis as above.
- **Cross-module or cross-stack change**: full analysis + a checkpoint commit of the working state before starting.

If a change has no identified risks, say so explicitly. Skipping the analysis is never acceptable, even when the answer is "nothing breaks."

---

## Git Conventions

### Branch naming
- `feat/<short-description>` — new features
- `fix/<short-description>` — bug fixes
- `refactor/<short-description>` — non-behavioral cleanup
- `docs/<short-description>` — documentation only
- `chore/<short-description>` — build, deps, tooling
- `spike/<short-description>` — exploratory branches (rebase or delete; don't merge as-is)

### Commits
- **Conventional Commits format:** `feat(webapi): add session login endpoint`, `fix(webclient): correct mana symbol rendering`, `refactor(mapper): extract card cost serializer`.
- **One concern per commit.** A commit that "fixes a bug and adds a test and refactors X" is three commits.
- **Checkpoint before risky fixes.** Before attempting a non-trivial debug session, commit the working state — even if "wip: pre-debug snapshot". Gives a clean revert point.
- **Body explains why, subject describes what.** Subject under 72 chars. Body wrapped at 80.
- **No `--no-verify`.** Hooks exist for a reason; if a hook fails, fix it.

### Push discipline
- Always push to `origin`. **Never** push to `upstream` (the URL is disabled to enforce this).
- Force-pushes only on personal feature branches, never on `main` or `master`.
- Open PRs against your own fork's `main` branch (origin → origin) for self-review on non-trivial work.

---

## Documentation

- **`CLAUDE.md`** (this file) — project contract. Update the same session a convention changes.
- **`docs/PATH_C_PLAN.md`** — phased roadmap. Living document; update as phases close.
- **`docs/schema/`** — JSON schema snapshots and changelog.
- **`docs/decisions/`** — ADRs (Architecture Decision Records) for non-obvious choices. Format: `NNNN-short-title.md`. One ADR per decision.
- **Per-module READMEs** (`Mage.Server.WebApi/README.md`, `webclient/README.md`) — quickstart and module-specific notes. Don't duplicate things that belong in CLAUDE.md.

---

## Phase Roadmap (Summary)

See `docs/PATH_C_PLAN.md` for full detail. High-level:

| Phase | Scope | Gate |
|---|---|---|
| 0 | Setup, build green, play vanilla game vs. AI | `make package` clean; one game played |
| 1 | Spike — embed `MageServerImpl`, pick framework, read core view classes | In-process boot test green |
| 2 | WebApi MVP — auth, server status, card lookup, lobby/table CRUD | curl/Postman flow works |
| 3 | WebApi game stream — WS, GameView, all PlayerActions encoded | Scripted JS plays a 1v1 game end-to-end |
| 4 | Webclient foundation — auth, lobby, deck list, card library | Browse cards, join a table from new UI |
| 5 | Game window MVP — battlefield, hand, stack, mana, priority, combat (1v1 only) | Full 1v1 game playable from new UI |
| 6 | Parity sweep — multiplayer, draft, tournament, replays, preferences | Feature parity with Swing client |
| 7 | Polish — animations, responsive, Tauri wrap, theming | Ongoing |

---

## Known Limitations & Pain Points

- **Upstream uses Java 8** for everything else. Our WebApi module targets Java 17+; the build toolchain must be JDK 17+ to compile both. JDK 17+ compiles upstream's Java 8 modules via `--release 8`.
- **Runtime requires JDK 8 today** for `mage-server.jar` / `mage-client.jar` because JBoss Remoting 2.5.4 uses reflection forbidden by the JDK 9+ module system. Verified 2026-04-25 — JDK 17 client throws `InaccessibleObjectException: Unable to make private void java.io.ObjectOutputStream.clear() accessible: module java.base does not "opens java.io" to unnamed module`. Phase 1 spike will evaluate whether `--add-opens` flags can keep us on a single modern JDK; if not, the WebApi module either runs on JDK 8 or in a separate process.
- **JBoss Remoting / bisocket transport** is not human-readable. Our WebApi sits on top of `MageServerImpl` rather than the wire protocol.
- **SwingX 1.6.1** is unmaintained upstream — we don't care, since we replace the Swing client.
- **Three-person upstream bus factor** (theelk801, LevelX2, JayDi85). If upstream slows, our fork still works; we just stop getting new cards.
- **Card images** are not in the repo and not served by the Java server. Client fetches from Scryfall directly.
- **No prior UI rewrite has shipped** in the project's history. We're trailblazing — if we hit a structural blocker, no one has solved it before us.

---

## Updating This File

- A convention changed? Update it the same session.
- A new module landed? Add it to the topology.
- A pain point bit you? Note it under "Known Limitations" so future-you doesn't relearn it.
- A decision was made? If it's non-obvious, write an ADR in `docs/decisions/` and link from here.

CLAUDE.md is the contract. Stale guidance is worse than no guidance.
