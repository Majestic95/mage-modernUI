# 0001 — Strategy: Facade + new client (Path C)

- **Status:** Accepted
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —

---

## Context and problem statement

The user (Austin) wants a modern UI/UX for [Xmage](https://github.com/magefree/mage) on a personal fork with full creative control, while staying compatible with the upstream server, hosting setup, and card database so daily card additions can be pulled cheaply.

The existing client is Java Swing (~86k LOC, ~40+ UI surfaces, a 2,200+ LOC `GamePanel`, custom `paintComponent` card rendering). The transport between client and server is JBoss Remoting 2.5.4 with Java object serialization — effectively Java-only without server-side changes.

We need to choose a strategy that delivers a meaningfully modern UX while preserving rebase compatibility with upstream and not forking the engine itself (which would mean re-implementing 28,000+ card classes — a separate ADR rejects that path).

---

## Considered options

### Path A — Modernize Swing in place
Replace Look-and-Feel (FlatLaf), refresh iconography, retire the unmaintained SwingX, tighten layouts. Stays fully Java; rebases are free.

- ✅ Lowest effort (1-3 months)
- ✅ Zero risk to upstream compatibility
- ❌ Visual ceiling is fundamentally Swing — cannot achieve "modern" UX
- ❌ Doesn't satisfy stated goal

### Path B — JavaFX migration
Migrate panel-by-panel via `JFXPanel` coexistence (JavaFX 11 already declared in `Mage.Client/pom.xml`). Eventually replace `Mage.Client` entirely with JavaFX.

- ✅ Modern desktop UI possible
- ✅ Same JVM, same protocol — no facade work
- ❌ Locks the client to Java forever
- ❌ JavaFX ecosystem is shrinking, not growing
- ❌ 12-24 months of work to fully migrate; coexistence period adds complexity
- ❌ Nothing in JavaFX gives us materially better outcomes than React for this UI domain

### Path C — JSON/WebSocket facade + new client *(chosen)*
Add a new Maven module `Mage.Server.WebApi` that embeds `MageServerImpl` in-process and exposes REST + WebSocket endpoints. Build a new client (React + TypeScript + Vite) against that API. The original Swing client can keep running — they're additional doors into the same server.

- ✅ Unlimited UX ceiling — pick any frontend tech
- ✅ Full creative control on the client
- ✅ Preserves server, card DB, and (most importantly) the 28k+ card implementations untouched
- ✅ Rebase compatibility is high: we add new files, don't edit upstream-tracked ones (one root `pom.xml` line for module registration is the sole exception, with sign-off)
- ✅ Solves a long-requested upstream feature (issue [#4521](https://github.com/magefree/mage/issues/4521), open since 2018) — we don't need to PR it back, but the option exists
- ❌ Highest effort (12-15 months to playable MVP, 24-30 to parity)
- ❌ Carries the risk of in-process embedding revealing server-side static state issues
- ❌ DTO drift across upstream releases requires snapshot-test discipline

### Path D — New engine from scratch
Build a new MTG engine; pull only card metadata (oracle text, types, mana cost) from Scryfall.

- ✅ Total architectural freedom
- ❌ Re-implementing the rules engine + 28k cards is 10-15 person-years of work
- ❌ Card DBs (Scryfall) don't include executable rules — only metadata
- ❌ Defeats the user's "stay compatible with existing card DB" goal
- ❌ Different project than the one being scoped

This path is rejected separately; including for completeness.

---

## Decision outcome

**Chosen: Path C — JSON/WebSocket facade + new client.**

It is the only option that delivers a modern UX while preserving the 10-15 person-years of card-implementation work the project depends on. The effort cost is high, but the alternatives either fail to satisfy the goal (A, B) or multiply effort 5-10× without proportional benefit (D).

The strategy hinges on three architectural firewalls that protect rebase compatibility:

1. **All our code is in new directories** — `Mage.Server.WebApi/`, `webclient/`, `docs/`. Upstream-tracked code is read-only.
2. **The DTO firewall** — `Mage.Server.WebApi`'s public types and JSON output never reference `mage.view.*` classes. Hand-written DTOs and mappers translate. This isolates the client from upstream view-class churn.
3. **Versioned wire schema** — every JSON payload carries a `schemaVersion`. Snapshot tests catch silent drift.

---

## Consequences

### Positive
- Modern UX is achievable; client tech choices are unconstrained
- Card additions from upstream flow in for free (weekly merges, near-zero conflicts)
- The original Swing client keeps working as an additional reference and fallback
- The facade module is independently useful and could be PR'd to upstream as a clean contribution if we choose

### Negative
- ~30-month commitment to feature parity. Solo developer at full-time pace; longer at part-time.
- Phase 1 carries embedding-feasibility risk; if the server resists in-process embedding, we re-architect (probably to a separate process with IPC, which adds complexity).
- DTO mappers are manual labor. Every new view-class field upstream adds requires a one-line mapper update (or it gets dropped).
- Two languages, two build systems, two test runners. CI complexity is real.

### Neutral
- We are not contributing to upstream by default (per separate constraint memory). Upstream visibility is opt-in per change.
- The `Mage.Client` Swing code stays in the repo, untouched. We don't delete it. It's a permanent reference for "how does this feature work today?"

---

## Validation plan

The decision is reversible only at high cost after Phase 2. Validate early:

- **Phase 1 spike** (2-3 weeks): write an in-process boot test for `MageServerImpl`. If it fails fundamentally, this ADR is revisited. If it succeeds, Path C is locked in.
- **Phase 3 exit gate**: a scripted JS client plays a full 1v1 game end-to-end. If we can't reach this gate within ~12 weeks of Phase 3 start, the protocol design needs reconsideration.

If either checkpoint fails, the alternative most likely to recover the goal is a *separate-process* facade (instead of in-process embedding) talking to the existing JBoss Remoting protocol via a Java client library. That's a fallback path, not the preferred one.

---

## References

- [Path C plan](../PATH_C_PLAN.md)
- [ADR 0002 — tech stack](0002-tech-stack.md)
- [Upstream issue #4521 — JSON client protocol](https://github.com/magefree/mage/issues/4521)
- [Upstream issue #7010 — Unity3D rewrite proposal](https://github.com/magefree/mage/issues/7010)
