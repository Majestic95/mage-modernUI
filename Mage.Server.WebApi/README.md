# Mage.Server.WebApi

JSON/WebSocket facade in front of the embedded Mage server. Owned module, part of the [Path C strategy](../docs/decisions/0001-path-c-strategy.md).

**Status:** Phase 1 spike — embedding feasibility being validated. Not yet a production module.

## Build

This is a **standalone** Maven project. It is intentionally not registered in the parent `pom.xml` so that all our work stays in new directories and upstream rebases keep working without conflicts. Build:

```bash
# from F:/xmage
mvn -f Mage.Server.WebApi/pom.xml clean test
mvn -f Mage.Server.WebApi/pom.xml package
```

The first build requires upstream artifacts in your local Maven cache. If they aren't there, run `mvn install -DskipTests` from `F:/xmage` first to populate `~/.m2/repository`.

## Phase 1 deliverables (spike)

- [ ] Confirm `MageServerImpl` can be instantiated in-process and a read method (`getServerState`) returns non-null
- [ ] Document the bootstrap sequence required (config → repos → cards → factories → ManagerFactory → MageServerImpl)
- [ ] Identify any blockers (static singletons, plugin loading complexity, etc.)
- [ ] Pick a callback-bridge strategy: subclass `Session`, or implement `InvokerCallbackHandler` directly

See [`docs/decisions/0003-embedding-feasibility.md`](../docs/decisions/0003-embedding-feasibility.md) for findings.

## Layout

```
src/
├── main/java/mage/webapi/
│   ├── WebApiMain.java              # Phase 2+ entry point (placeholder)
│   └── embed/
│       └── EmbeddedServer.java      # Boots MageServerImpl in-process
└── test/java/mage/webapi/
    └── embed/
        └── EmbeddedServerTest.java  # Spike: incremental boot test
```
