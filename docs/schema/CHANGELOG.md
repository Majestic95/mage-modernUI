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
