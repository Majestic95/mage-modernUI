# Mage.Server.WebApi

JSON/WebSocket facade in front of the embedded Mage server. Owned module, part of the [Path C strategy](../docs/decisions/0001-path-c-strategy.md).

**Status:** Active production module (Path C). The service runs in `mage-stack` and is deployed behind `https://api.modern-mage.com`.

## Build

This is a **standalone** Maven project. It is intentionally not registered in the parent `pom.xml` so that all our work stays in new directories and upstream rebases keep working without conflicts. Build:

```bash
# from F:/xmage
mvn -f Mage.Server.WebApi/pom.xml clean test
mvn -f Mage.Server.WebApi/pom.xml package
```

The first build requires upstream artifacts in your local Maven cache. If they aren't there, run `mvn install -DskipTests` from `F:/xmage` first to populate `~/.m2/repository`.

## Current Scope

- REST surface for auth/session, server state, card search, lobby/table CRUD, and deck validation.
- WebSocket surface for game stream, room stream, table stream, and spectator stream.
- DTO firewall between upstream `mage.view.*` and the webclient-facing JSON schema.
- Scryfall-backed Pauper legality overlay with cache + scheduled refresh.

For operating/deploy workflow, see [`mage-stack/README.md`](../mage-stack/README.md).
For roadmap status and active milestone, see [`docs/PATH_C_PLAN.md`](../docs/PATH_C_PLAN.md).

## Layout

```
src/
├── main/java/mage/webapi/
│   ├── WebApiMain.java              # service entrypoint
│   ├── server/                      # HTTP + WS route wiring
│   ├── ws/                          # game/room/table/spectator streams
│   ├── lobby/                       # table/seat/lobby orchestration
│   ├── format/                      # deck-format validators (e.g. Pauper)
│   ├── auth/                        # session + auth services
│   ├── mapper/                      # upstream -> web DTO mappers
│   └── embed/
│       └── EmbeddedServer.java      # boots MageServerImpl in-process
└── test/java/mage/webapi/
    ├── server/                      # integration tests
    ├── ws/                          # stream tests
    ├── mapper/                      # snapshot + mapper tests
    └── format/                      # format-validator tests
```
