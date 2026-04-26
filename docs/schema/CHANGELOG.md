# JSON wire-format schema changelog

This document tracks every change to the WebApi JSON schema. Every payload
on the wire carries a `"schemaVersion"` field whose value is the current
version below; clients refuse to connect on a major mismatch and warn on
minor mismatches.

## Versioning policy

- **Major bump (1.0 → 2.0):** breaking change. Field removed, type
  changed, semantics changed in a way clients will misinterpret. Clients
  refuse to connect.
- **Minor bump (1.0 → 1.1):** additive change. New optional field, new
  enum value, new endpoint. Clients warn and continue.
- The single source of truth for the constant is
  [`mage.webapi.SchemaVersion#CURRENT`](../../Mage.Server.WebApi/src/main/java/mage/webapi/SchemaVersion.java).
  Bump it in the same commit that lands the schema change and add an
  entry below.

---

## 1.1 — 2026-04-25 — Add `/api/server/state` (Phase 2 slice 3)

Additive change: new endpoint and new DTO records. Existing endpoints
unchanged in shape; the schemaVersion field they report bumps to
`"1.1"` because that is the global wire-format version.

### New endpoint

- `GET /api/server/state` → `WebServerState`

### New DTOs

#### `WebServerState` (top-level — carries `schemaVersion`)

```json
{
  "schemaVersion":    "1.1",
  "gameTypes":        [ <WebGameType>, ... ],
  "tournamentTypes":  [ <WebTournamentType>, ... ],
  "playerTypes":      [ "Human", "Computer - simple", ... ],
  "deckTypes":        [ "Constructed - Standard", ... ],
  "draftCubes":       [ "Cube - Vintage 2017", ... ],
  "testMode":         false
}
```

#### `WebGameType` (nested — no `schemaVersion`)

```json
{
  "name":            "Two Player Duel",
  "minPlayers":      2,
  "maxPlayers":      2,
  "numTeams":        0,
  "playersPerTeam":  0,
  "useRange":        false,
  "useAttackOption": false
}
```

#### `WebTournamentType` (nested — no `schemaVersion`)

```json
{
  "name":          "Booster Draft",
  "minPlayers":    2,
  "maxPlayers":    8,
  "numBoosters":   3,
  "draft":         true,
  "limited":       true,
  "cubeBooster":   false,
  "elimination":   false,
  "random":        false,
  "reshuffled":    false,
  "richMan":       false,
  "jumpstart":     false
}
```

### Convention

**Top-level response DTOs carry `schemaVersion`. Nested DTOs do not.**
Schema version is a wire-format concept; repeating it on every nested
object would bloat the payload without adding info.

---

## 1.0 — 2026-04-25 — Initial baseline (Phase 2 slice 1)

First slice of the WebApi facade. Two endpoints, two DTOs.

### Endpoints

- `GET /api/version` → `WebVersion`
- `GET /api/health`  → `WebHealth`

### DTOs

#### `WebVersion`

```json
{
  "schemaVersion": "1.0",
  "mageVersion":   "1.4.58-V1",
  "buildTime":     "<jar manifest build-time, may be empty>"
}
```

| Field | Type | Source | Note |
|---|---|---|---|
| `schemaVersion` | string | `mage.webapi.SchemaVersion.CURRENT` | wire-format version |
| `mageVersion` | string | upstream `mage.utils.MageVersion` constants | upstream release identifier |
| `buildTime` | string | upstream jar manifest | empty for developer builds |

#### `WebHealth`

```json
{
  "schemaVersion": "1.0",
  "status":        "ready"
}
```

| Field | Type | Note |
|---|---|---|
| `schemaVersion` | string | wire-format version |
| `status` | string enum | one of `ready`, `starting`, `error` |

### Snapshot policy

Every DTO mapper has a snapshot test under
`Mage.Server.WebApi/src/test/java/mage/webapi/mapper/` that locks the
JSON output shape (field set + types). When the upstream view classes
drift, that test goes red — handle the change deliberately and update
this changelog before bumping the schema version.
