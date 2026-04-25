# 0002 — Tech stack

- **Status:** Accepted (subject to Phase 1 confirmation of Java framework)
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —

---

## Context and problem statement

[ADR 0001](0001-path-c-strategy.md) commits us to two new artifacts: `Mage.Server.WebApi` (a Java Maven module embedding the existing server) and `webclient/` (a new frontend). We need to lock in language and framework choices before Phase 2.

Constraints:
- Upstream targets Java 8 (`source/target=1.8`). Our module can override its own target.
- The webclient must be deliverable both as a web app and as a desktop binary (Tauri-wrappable).
- The user has prior comfort with React + TypeScript + Vite (Capital Engine, ProcureFlow, Stock Simulator) and with Tauri v2 (Stock Simulator).
- File-size discipline (400 soft / 500 hard) and "no `any`" / "no raw types" coding standards from CLAUDE.md must be supportable by the chosen tooling.

---

## Decision

### Server side — `Mage.Server.WebApi`

| Concern | Choice | Reasoning |
|---|---|---|
| Language | **Java 17+ LTS for build, Java 8 for runtime today** | **Build:** JDK 17 minimum, JDK 21 fine. Records, sealed types, pattern matching, `var`, text blocks all available in 17. JDK 17+ compiles upstream's Java 8 modules via `--release 8`. **Runtime today:** JDK 8 required to launch `mage-server.jar` / `mage-client.jar` because JBoss Remoting 2.5.4 uses pre-module-system reflection forbidden by JDK 9+. Verified 2026-04-25: JDK 17 client throws `InaccessibleObjectException` and shows *"Wrong java version"*. **Phase 1 will evaluate `--add-opens` JVM flags** to determine whether a single modern JDK can run both upstream code and our WebApi module. If `--add-opens` works, we collapse to one runtime; if not, WebApi targets Java 8 source level (still simpler than upstream because we're starting fresh) or runs in a separate process. |
| HTTP/WS framework | **Javalin 5+** *(provisional — confirm Phase 1)* | Lightweight (~5MB), built on Jetty, native WebSocket, idiomatic Kotlin/Java API. Lower ceremony than Spring Boot; lower learning curve than Vert.x. Phase 1 spike re-evaluates if embedding `MageServerImpl` reveals constraints we didn't anticipate. |
| JSON | **Jackson** | De facto Java standard. Already on classpath via upstream deps likely. **Auto-serialization of upstream classes is forbidden** — see DTO firewall. |
| Logging | **SLF4J + Logback** | Aligns with upstream's stated migration direction (root `pom.xml` notes a log4j → logback TODO). No `System.out.println` in committed code. |
| Tests | **JUnit 5** | Modern, parametric tests, reasonable assertion library. |
| DTO style | **Java records** | `public record WebGameView(String schemaVersion, ...) {}` — immutable, free `equals`/`hashCode`/`toString`, no Lombok dependency. |
| Optional handling | `Optional<T>` at API boundaries; plain null fine in hot paths | Standard idiom; avoid `Optional` field types. |

### Client side — `webclient/`

| Concern | Choice | Reasoning |
|---|---|---|
| Language | **TypeScript 5+** | User's standard. Strict mode mandatory. |
| UI framework | **React 18+** | User's standard. Matures alongside Suspense + Server Components, but we use neither here. |
| Build tool | **Vite 5+** | Fast dev server (HMR <1s), proven for both web + Tauri targets. |
| State management | **Zustand** | Game state is WebSocket-driven; Zustand handles streaming updates without Redux ceremony. Capital Engine validates this pattern. |
| Styling | **Tailwind CSS v4** | Utility-first, no runtime cost, plays well with custom card-game UI where component libraries don't fit. v4 is current. |
| Component library | **None** | MUI/shadcn/Chakra optimize for forms-and-dashboards UIs; a card game's primary surface is custom and would fight a component library more than benefit from one. |
| Runtime validation | **Zod** | Every WebSocket payload + REST response is parsed through a Zod schema. Catches DTO drift loudly at the boundary, not deep in component logic. |
| Tests | **Vitest + Testing Library** | Native TypeScript, fast, same mental model as Jest. |
| Card images | **Scryfall** (direct fetch by `setCode + collectorNumber`), service-worker cached | No image bundling in the repo. Tauri version uses native file cache (Phase 7). |
| Card rendering | **CSS transforms** for tap/flip/counters; **SVG** for mana symbols | No canvas/WebGL; React + CSS gives us declarative card layout that's easy to debug. WebGL only revisited if we hit measurable frame-rate problems with high permanent counts. |
| Desktop wrap | **Tauri v2** (deferred to Phase 7) | User already runs Tauri v2 in Stock Simulator. Web app first; Tauri later. |
| Package manager | **pnpm** | Faster, content-addressed, better monorepo support than npm. Install via Corepack. |

### Toolchain prerequisites

- JDK 17+ with `JAVA_HOME` pointed at it (JDK 17 currently used; JDK 21 acceptable)
- Maven 3.9+
- Node 20+ (Node 24 already installed locally)
- pnpm via Corepack (`corepack enable && corepack prepare pnpm@latest --activate`)
- Git 2.40+

---

## Considered options (highlights)

### Server framework alternatives

- **Spring Boot** — too heavy (~50MB+ deps, slow startup, opinionated DI). Pays off for a microservice fleet; here it's overkill for one embedded module.
- **Vert.x** — excellent for high-concurrency event-loop workloads, but its API style is verbose for our straightforward request-response + WS use case. Reconsider only if performance requires it.
- **Spark** — abandoned upstream, not maintained.
- **Micronaut / Quarkus** — both interesting but neither's strength (GraalVM native image) helps us here, and both add framework complexity for marginal benefit.

### Client state management alternatives

- **Redux Toolkit** — proven, but ceremonial; the ergonomics gap vs. Zustand is significant for a streaming-state app.
- **Jotai** — atomic state model is interesting; less proven for game-loop-style updates.
- **MobX** — works, but its mental model conflicts with the explicit data-flow style we want for a multiplayer game.
- **React Context + useReducer only** — works for small apps; will not scale to game-window complexity.

### Build tool alternatives

- **Webpack** — slower, more config, no advantages here.
- **Turbopack** — Next.js-coupled; we're not using Next.js.
- **esbuild directly** — Vite uses esbuild internally; using it directly loses HMR.

---

## Consequences

### Positive
- Modern Java features (records, pattern matching) drastically reduce DTO boilerplate
- React + TS + Vite is well-trodden territory the user has shipped multiple times
- Zod catches schema drift at the network boundary instead of letting bad data corrupt component state
- All chosen tools are actively maintained by major communities

### Negative
- Two language ecosystems means two build systems, two test runners, two lint configs
- JDK 17+ requirement may surprise contributors used to Java 8; documented in `CLAUDE.md` and `docs/PATH_C_PLAN.md`
- Tailwind v4 is recent; if a regression bites us, fallback is v3 with no other code changes
- Javalin is provisional — Phase 1 spike may surface a reason to switch

### Neutral
- pnpm vs. npm is a developer-preference change with minimal user-facing impact

---

## Validation plan

- **Phase 1 spike** confirms Javalin can embed `MageServerImpl` cleanly. If not, Vert.x or a custom Jetty setup is the next try.
- **Phase 2** confirms Jackson record-serialization plus our hand-written mappers produce stable JSON output (snapshot tests).
- **Phase 4** confirms the React + Zustand + Zod combination scales to the lobby + card library; if Zustand creaks, we switch slices to Jotai or Redux Toolkit (it's a slice-by-slice migration, not a wholesale rewrite).
- **Phase 5** is the real test of the rendering choices (CSS transforms for tap, SVG for mana). If frame-rate or layout bugs prove intractable, revisit canvas/WebGL.

---

## References

- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [Path C plan](../PATH_C_PLAN.md)
- [Javalin docs](https://javalin.io/)
- [Vite docs](https://vitejs.dev/)
- [Zustand docs](https://zustand-demo.pmnd.rs/)
- [Tailwind v4 docs](https://tailwindcss.com/)
- [Tauri v2 docs](https://v2.tauri.app/)
