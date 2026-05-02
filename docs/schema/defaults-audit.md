# Zod schema `.default()` audit

Per-field rationale for every `.default(...)` in `webclient/src/api/schemas.ts`.
Drives future Tier 1 removal decisions.

## Tiers

- **Tier 1 (remove):** field is unconditionally emitted by the server,
  default only masks future server bugs. Pure liability.
- **Tier 2 (instrument before removing):** field is mostly emitted but
  the rolling-upgrade window may not have closed; or the field could
  be legitimately optional in some path we haven't traced. Add
  diagnostic logging when the default fires before deciding to remove.
- **Tier 3 (keep):** legitimate optionality. Default IS the contract;
  removal would break valid wire shapes.

## Inventory (schema 1.26)

| Field | Schema rev added | Tier | Rationale |
|---|---|---|---|
| `WebDeckValidationError.partlyLegal` | early 1.x | **1 — REMOVED** | Java DTO declares as primitive boolean (always emitted); mapper at DeckValidationMapper unconditionally populates. Default was forward-compat shim from before it was always emitted. |
| `WebDeckValidationError.synthetic` | early 1.x | **1 — REMOVED** | Same as partlyLegal. |
| `WebError.validationErrors` (nullable.default(null)) | 1.21 | **3** | Server omits via `@JsonInclude(NON_NULL)` on non-DECK_INVALID errors. Null IS the contract for those paths. |
| `WebSeat.commanderName` | 1.13 | **3** | Empty string for non-Commander format games. Contract is "empty when seat isn't Commander." |
| `WebSeat.commanderImageNumber` | 1.13 | **3** | Same as commanderName. |
| `protocolVersion` | 1.20 | **3** | Server echoes the client's `?protocolVersion=` query param; default 1 covers older servers in a rolling upgrade. Removal needs production-traffic confirmation that no v1 server exists. |
| `WebCardView.cardId` | 1.19 | **2** | Comment in source explicitly justifies the default as "wire-format defense for server forgot to emit." Test infrastructure also relies on it (~27 test fixtures use the empty default). Removal would force a fixture audit. Worth it eventually but not in this pass. |
| `WebCardView.sourceLabel` | 1.18 | **3** | Empty string for non-AbilityView cards. Optional contract. |
| `WebCardView.source` (nullable.default(null)) | 1.26 | **3** | Null for non-ability stack views. Contract optional. |
| `WebPermanentView.goadingPlayerIds` | 1.20 | **2** | Always emitted by mapper now. Default `[]` matches legitimate "not goaded" but a missing field would be a real bug. Could be Tier 1 once we confirm no <1.20 server exists. |
| `WebCommandObjectView.cardNumber` | 1.24 | **3** | Recent (slice 70-X.2). Rolling-upgrade window may still be open against a 1.23-cached server. |
| `WebPlayerView.commandList` | 1.13 | **3** | Empty array for non-Commander format. Optional contract. |
| `WebPlayerView.teamId` (nullable.default(null)) | 1.13 | **3** | Null for non-team formats. Contract optional. |
| `WebPlayerView.colorIdentity` | 1.22 | **3** | Empty array for non-Commander or no commander selected. Optional. |
| `WebPlayerView.connectionState` | 1.23 | **3** | Source comment explicitly notes default fires on missing key from a 1.22 server during rolling upgrade. |
| `WebClientMessageOptions.leftBtnText` | 1.x base | **2** | EMPTY constant on the Java side fills with empty string. Always emitted; default is double-defensive. Could be Tier 1 next pass. |
| `WebClientMessageOptions.rightBtnText` | 1.x base | **2** | Same. |
| `WebClientMessageOptions.possibleAttackers` | 1.x base | **2** | Same. |
| `WebClientMessageOptions.possibleBlockers` | 1.x base | **2** | Same. |
| `WebClientMessageOptions.specialButton` | 1.x base | **2** | Same. |
| `WebClientMessageOptions.isTriggerOrder` | 1.x base | **2** | Same. |
| `WebMultiAmountRow.label` / `min` / `max` / `defaultValue` | 1.25 | **3** | Recent. Multi-amount frames are rare; rolling-upgrade window still open. |
| `WebMultiAmountInfo.title` / `header` / `rows` / `totalMin` / `totalMax` | 1.25 | **3** | Same. |
| `WebGameClientMessage.options` | 1.x base | **2** | Always emitted; EMPTY_CLIENT_MESSAGE_OPTIONS guards a totally-missing options object. Could be Tier 1. |
| `WebGameClientMessage.cardsView2` | 1.25 | **3** | Empty for non-pile prompts. Optional contract. |
| `WebGameClientMessage.multiAmount` (nullable.default(null)) | 1.25 | **3** | Null for non-multi-amount prompts. Optional. |

## Removed in this pass

- `partlyLegal` and `synthetic` — both Tier 1, mapper always emits, no
  fixture relies on the default. Net effect: a server-side regression
  that drops either now produces a console.error parse-failure trail
  instead of a silently false-defaulted boolean.

## Future Tier 1 candidates (next pass)

After observing live traffic for a playtest cycle to confirm no
default fires:

- `WebPermanentView.goadingPlayerIds`
- `WebClientMessageOptions.*` inner fields (if EMPTY_CLIENT_MESSAGE_OPTIONS
  is verified to always be the floor)
- `WebGameClientMessage.options` (the parent field)

Removal sequence: drop the default, run full test suite, deploy,
watch for one playtest cycle. If parse failures show up, restore
the default and reclassify the field to Tier 3.

## Reversion

`git reset --hard pre-schema-defaults` restores all defaults if
something breaks in production.
