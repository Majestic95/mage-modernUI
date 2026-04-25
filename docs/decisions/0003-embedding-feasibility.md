# 0003 — Embedding feasibility (Phase 1 spike)

- **Status:** Accepted
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —
- **Confirms:** [ADR 0001](0001-path-c-strategy.md), [ADR 0002](0002-tech-stack.md)

---

## Context

[ADR 0001](0001-path-c-strategy.md) committed the project to Path C: a JSON/WebSocket facade that **embeds `MageServerImpl` in-process** and exposes its functionality over HTTP/WebSocket. The strategy is reversible only at high cost after Phase 2, so [PATH_C_PLAN.md](../PATH_C_PLAN.md) defines a Phase 1 spike with two checkpoints:

1. Can `MageServerImpl` be instantiated outside `Main.main()` and answer a basic read method?
2. Can JBoss Remoting 2.5.4 (the Java-8-era network library upstream uses) run on a modern JDK with `--add-opens` flags, allowing a single-JDK toolchain end-to-end?

If either fails, the strategy needs reconsideration.

---

## Decision

**Both checkpoints pass.** Path C is fully validated:

1. **Embedding works.** `Mage.Server.WebApi/src/test/java/.../EmbeddedServerTest.java` runs the bootstrap sequence outside `Main.main()` and instantiates `MageServerImpl` — `getServerState()` returns a non-null `ServerState`. All seven incremental steps green.
2. **Single JDK 17+ toolchain works.** With the `--add-opens` flag set documented below, JDK 17 successfully launched both the upstream server **and** the upstream Swing client; the client handshake completed and a user logged in. No `InaccessibleObjectException`, no *"Wrong java version"* popup.

The dual-JDK setup documented in earlier Phase 0 commits is **no longer required**. Build and runtime both target JDK 17+. Phase 0 docs are updated in the same commit that lands this ADR.

---

## Evidence

### Embedding test output (2026-04-25)

```
[INFO] Tests run: 7, Failures: 0, Errors: 0, Skipped: 0, Time elapsed: 23.88 s
- step1_loadsConfigXml                       PASS
- step2_wrapsConfigSettings                  PASS
- step3_bootstrapsLocalDb                    PASS  (sets: 574, cards: 89,222)
- step4_scansCards                           PASS
- step5_buildsManagerFactory                 PASS
- step6_instantiatesMageServerImpl           PASS
- step7_callsReadMethodOnEmbeddedServer      PASS  (getServerState non-null)
```

### Bootstrap sequence (validated)

```
ConfigFactory.loadFromFile(path)                     → Config
new ConfigWrapper(config)                            → ConfigSettings
RepositoryUtil.bootstrapLocalDb()                    (creates H2 db on first run)
CardScanner.scan()                                   (89k+ card classes registered)
new MainManagerFactory(configSettings)               → ManagerFactory
new MageServerImpl(factory, "", false, false)        → in-process server
```

Plugin loading (game types, tournament types, player types, cube types, deck validators — Main.java L206-246) is **deliberately skipped** in the spike. `getServerState()` returns mostly-empty plugin lists when omitted, but does not throw. Phase 2 must replicate this loop for production usage.

### `--add-opens` flag set (validated)

The full bundle below is sufficient for both server and client launches on JDK 17. Narrowing to the minimal subset is a Phase 2 cleanup task; for now this works:

```
--add-opens java.base/java.io=ALL-UNNAMED
--add-opens java.base/java.lang=ALL-UNNAMED
--add-opens java.base/java.lang.reflect=ALL-UNNAMED
--add-opens java.base/java.util=ALL-UNNAMED
--add-opens java.base/sun.nio.ch=ALL-UNNAMED
--add-opens java.base/java.net=ALL-UNNAMED
--add-opens java.base/sun.security.action=ALL-UNNAMED
```

Configured in `Mage.Server.WebApi/pom.xml` via `maven-surefire-plugin <argLine>` for tests, and added to `dev-setup.md` for runtime launches.

---

## Consequences

### Positive
- Path C is locked in with empirical confirmation, not just architectural confidence.
- Single JDK toolchain (17+) for build, embedded server tests, runtime, and our future WebApi module. No JDK 8 install required.
- The bootstrap sequence is short (~6 lines of code), so wrapping it for production use is straightforward.
- `MageServerImpl` is genuinely a POJO with no hard JBoss Remoting coupling — we can call its methods directly and intercept callback dispatch at the `Session.fireCallback()` layer rather than below `InvokerCallbackHandler`.

### Negative
- The `--add-opens` flag bundle is broad. We don't yet know the minimal set; this is a Phase 2 cleanup task. The risk is low — these flags only weaken module encapsulation for our process, not for any consumer.
- Plugin loading is the next non-trivial step. Phase 2 must replicate Main.java L206-246 (≈40 lines of factory wiring) and confirm the result still embeds cleanly.
- The spike was a single test run on one machine. CI must continue to verify on every commit. A weekly job (per [PATH_C_PLAN.md](../PATH_C_PLAN.md) cross-cutting concerns) should also run the test against the latest upstream master to catch view-class drift early.

### Neutral
- The 23.88s test runtime is dominated by `bootstrapLocalDb()` and `CardScanner.scan()` on first run (574 sets, 89,222 card definitions). Subsequent runs are faster — the H2 db is cached on disk. This is fine for CI; consider a separate fast smoke-test profile for tighter dev feedback loops.

---

## Phase 2 implications

Confirmed:
- `mage.webapi.embed.EmbeddedServer` becomes a real class (not just a spike) — extend with plugin loading, callback bridge, lifecycle (clean shutdown).
- Javalin remains the chosen HTTP/WS framework (no contrary evidence emerged in Phase 1).
- The DTO firewall is unchanged: hand-written `WebGameView` records mapping from `mage.view.GameView` etc. The 43-class view inventory documented in the Phase 1 read is the master list.
- WebSocket bridge: subscribe at the `Session.fireCallback()` layer (per Phase 1 callback wiring read) — implement `InvokerCallbackHandler` for our WebSocket-bound sessions and translate `ClientCallback` → JSON frames.

Open follow-ups:
- [ ] Narrow the `--add-opens` set to the minimum needed (probably just `java.io` and `java.lang`).
- [ ] Replicate plugin loading in `EmbeddedServer.boot()` to make `getServerState()` return populated plugin lists.
- [ ] Decide: does WebApi need session-affinity to a single embedded server instance, or can future scale-out spawn multiple `MageServerImpl` instances per JVM? (Likely irrelevant until much later.)

---

## References

- [PATH_C_PLAN.md — Phase 1](../PATH_C_PLAN.md)
- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [ADR 0002 — Tech stack](0002-tech-stack.md)
- `Mage.Server.WebApi/src/test/java/mage/webapi/embed/EmbeddedServerTest.java` — the seven-step spike test
- `Mage.Server.WebApi/src/main/java/mage/webapi/embed/EmbeddedServer.java` — bootstrap implementation
- Upstream `Main.java` L141-301 — original boot sequence for reference
