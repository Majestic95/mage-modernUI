# Bundle 5 — Damage Moment, scope brief

> **Branch:** `feat/combat-bundle-5-damage-moment`
> **Status:** scope-locked, ready to slice (one sub-feature descoped pending wire-format work — see below)
> **Source:** Bundle 5 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axis addressed:** cinematic punctuation — *"Damage just... happens. The life total ticks down and I missed why. Did my creature die? Was that lethal? Was that commander damage?"*

## Goal

Make combat damage *feel* like an event, not a silent tick. Today the user sees life totals decrement and creatures vanish, but the *connection* between attacker and defender is silent. Bundle 5 layers cinematic damage feedback on top of the existing arrow renderer (Bundle 1) and creature chrome (Bundle 4): glowing parcels travel along arrow paths from attacker to defender, portrait halos bloom in time with life-total updates, the board does a brief freeze-frame on resolution, and dying creatures get a desaturation beat before the existing graveyard animation kicks in.

This is the **cinematic-payoff bundle** per the brainstorm — *"the one most likely to make combat feel exciting."* Bundles 1, 3, 4 made combat *readable*. Bundle 5 makes it *felt*.

Critical foundation work was completed at [`docs/design/foundation-central-area-mutex.md`](foundation-central-area-mutex.md) (ratified 2026-05-10): the prior StackZone mutex would have unmounted CombatArrows whenever anything was on the stack mid-combat, silently neutering Bundle 5's parcel cinematic. Option D (z-layer cohabitation) keeps arrows mounted continuously — Bundle 5 builds on that guarantee.

## Scope lock

### In scope

Five sub-features, sliced into shippable units:

1. **Damage parcels** — small bright pulses traveling along arrow paths from attacker to defender when damage actually lands. ~300-400ms per parcel; multi-attacker hits stagger 50ms apart so the user can count them. SVG path traversal via `<path>.getPointAtLength()`.
2. **Portrait halo bloom on life-loss** — when a player's `life` decreases between frames, that player's portrait halo flares (alpha + scale spike) peaked exactly at the moment the number changes. Synchronizes with the existing `LifeCounter` flash so visual + numeric feel like one event.
3. **Freeze-frame on damage resolution** — brief board-wide lighting shift (~0.3-0.5s): survivors get a faint green rim, dying creatures get a red rim, the player who just lost life gets a danger-tinted edge bloom. Cinematic punctuation through color, not motion blur.
4. **Death handoff** — when a creature leaves battlefield → graveyard, the parcel arrives, the creature desaturates for a heartbeat (~150ms), *and then* the existing fly-to-graveyard animation kicks in. Right now creatures vanish too cleanly; this gives the kill a tiny pause that registers as significant.
5. **Lethal-21 commander-damage authority sequence** — when a player crosses 21 commander damage from one opponent, special "authority sequence" plays: pause + halo rotation spike + portrait scale pop + red underline drawn under the commander label. Multiple lethal moments in one update sequence one after the other so the order reads.

**Wire-format readiness for sub-feature 5:** today, `WebPlayerView` carries no per-opponent commander-damage field; the client-side `CommanderDamageTracker` ([`webclient/src/game/CommanderDamageTracker.tsx:14-19`](../../webclient/src/game/CommanderDamageTracker.tsx#L14)) tracks via localStorage as a manual-entry tool. Bundle 5 includes a **foundation slice 5-F** that adds the field to the wire (Mage.Server.WebApi mapper + schema 1.34 → 1.35 bump + client zod update + CommanderDamageTracker migration). User direction (2026-05-10): *"add lethal-21 to the wire so we do not lose any scoped features."* Slice 5-F is the prerequisite for 5-E.

### Out of scope (other)

- **Pen-stroke arrow draw-in** — Bundle 6 territory.
- **First-strike-vs-regular palette shift** — Bundle 6 territory.
- **Creature-tile chrome** (corner brackets, role rings, eligibility shimmer). Bundle 4 territory (already shipped).
- **Wire-format changes for sub-features 1-4.** All four read existing fields via frame diffing.

---

## Wire-format readiness (recon result)

Sub-features 1-4 read existing fields via the established `gameDelta` frame-diff system; no schema bump required for them. **Sub-feature 5 (lethal-21) requires a schema bump 1.34 → 1.35** to expose per-opponent commander damage on `WebPlayerView`. Slice 5-F (foundation) lands the schema bump first; slices 5-A through 5-D run on the existing schema; slice 5-E consumes the new field.

| Sub-feature | Source | File:line |
|---|---|---|
| Damage event detection | `useGameDelta()` hook synthesizes a `creature_died` event on graveyard transitions; sub-features 1+4 also need a new `damage_dealt_to_player` synthetic event derived from `WebPlayerView.life` deltas | [`webclient/src/animation/gameDelta.ts`](../../webclient/src/animation/gameDelta.ts), [`webclient/src/animation/useGameDelta.ts:1-78`](../../webclient/src/animation/useGameDelta.ts) |
| Per-creature damage delta | `WebPermanentView.damage` already part of schema; CardFace damage-flash precedent at [`CardFace.test.tsx:73-113`](../../webclient/src/game/CardFace.test.tsx#L73) | [`webclient/src/api/schemas.ts:623-655`](../../webclient/src/api/schemas.ts#L623) |
| Player life delta | `WebPlayerView.life` already part of schema; LifeCounter flash precedent at [`LifeCounter.tsx:49-91`](../../webclient/src/game/LifeCounter.tsx#L49) | [`webclient/src/api/schemas.ts:690-781`](../../webclient/src/api/schemas.ts#L690) |
| Arrow path traversability | `<path>` SVG element rendered with quadratic-curve `d` attribute; native `getPointAtLength()` available | [`webclient/src/game/TargetingArrow.tsx:223-257`](../../webclient/src/game/TargetingArrow.tsx#L223) |

**Damage-event derivation:** new helper `useDamageEvents()` (sibling to `useGameDelta`) subscribes to consecutive game-views and synthesizes one of three event kinds per frame: `parcel_hit_player` (life decreased + creature with `damage > 0` change), `creature_damaged` (perm.damage increased), `creature_died` (already emitted). Each event carries `{ attackerId, defenderId, amount }` so the parcel cinematic can resolve which arrow path to traverse.

---

## Slice breakdown

### Slice 5-F — Foundation: per-opponent commander damage on the wire

**Tier:** Architectural (touches the DTO firewall + schema bump + Java-side mapper code; client-side migration). MUST land before slice 5-E.

**Critic matrix:** Builder + Technical + UI (skip-redundant) + Magic-rules (CR 704.5b lethal-21 verification: damage from any one commander reaching 21 is a state-based loss; per-opponent tracking required).

**Files touched (Java side — Mage.Server.WebApi only; upstream-tracked Mage/* untouched per CLAUDE.md):**
- `Mage.Server.WebApi/src/main/java/.../dto/WebPlayerView.java` (or wherever the record/class lives) — add `Map<UUID, Integer> commanderDamageReceived` field. Key: opposing commander's UUID. Value: total commander damage from that commander to this player.
- `Mage.Server.WebApi/src/main/java/.../mapper/WebPlayerViewMapper.java` — populate the new field by reading the engine's existing tracker. Look for `Player.getCommandersIds()` + `Player.getCommanderDamage(UUID commanderId)` (engine API; if not present in this exact shape, find the equivalent — engine MUST track this for the rules engine).
- `Mage.Server.WebApi/src/main/java/.../api/handler/SchemaVersion.java` — bump `1.34` → `1.35`.
- `Mage.Server.WebApi/src/test/java/.../mapper/WebPlayerViewMapperTest.java` — snapshot test for the new field's JSON output across single-commander, partner-pairing, and the empty / no-damage default cases.

**Files touched (client side):**
- `webclient/src/api/schemas.ts` — add `commanderDamageReceived: Record<string, number>` to `webPlayerViewSchema` + matching TS interface. `.default({})` so older 1.34 servers parse cleanly during a rolling deploy.
- `webclient/src/api/protocol.ts` (or wherever `EXPECTED_SCHEMA_VERSION` lives) — bump to `'1.35'`.
- `docs/schema/web-player-view.json` — schema snapshot updated.
- `docs/schema/CHANGELOG.md` — migration note: *"1.34 → 1.35 — `WebPlayerView.commanderDamageReceived` added (Map<commanderId, totalDamage>). Empty `{}` default for older clients. Engine-side tracker has always existed; this exposes it for client-side cinematic and tracker UI."*
- `webclient/src/game/CommanderDamageTracker.tsx` — migrate from localStorage source-of-truth to wire source-of-truth. Keep localStorage as a fallback during the rolling-deploy window only. Update its tests to assert the wire path.

**Test plan:**
- Mapper snapshot test verifies `commanderDamageReceived` shape matches expected fixtures across (a) no commander damage, (b) one opponent dealt N damage with one commander, (c) partner-pairings where two opponent commanders deal damage independently, (d) Karn-the-Liberated colorless commander identity.
- Client zod parse test for the new field.
- Integration test: render `<CommanderDamageTracker>` with a wire-populated value vs. the legacy localStorage value; behaviors converge.
- WebApi integration test (per CLAUDE.md test policy: every WebApi route has at least one integration test against an embedded `MageServerImpl`).

**Acceptance:** schema 1.35 deployed; CommanderDamageTracker reads the wire field; lethal-21 sub-feature (5-E) can detect "this player just crossed 21 damage from this commander" by frame-diffing the new field.

### Slice 5-A — Damage parcels traveling along arrows

**Tier:** Standard (new visual surface; SVG path traversal; new event-derivation hook).
**Critic matrix:** Builder + Technical + UI + Graphical (motion).

**Files touched:**
- New `webclient/src/animation/useDamageEvents.ts` (~120 LOC) — frame-diff hook synthesizing the three event types from `useGameDelta`'s underlying frame stream.
- New `webclient/src/game/DamageParcelOverlay.tsx` (~180 LOC) — viewport-fixed SVG overlay; subscribes to `useDamageEvents`; for each `parcel_hit_player` event, queries the matching arrow path via `document.querySelector('path[data-arrow-defender-id="..."]')`, animates a small bright `<circle>` from 0 → 1 progress via `getPointAtLength()` over 350ms with RAF.
- Stagger: when N parcels fire in the same frame, schedule them 50ms apart in `requestAnimationFrame` queue.
- `transitions.ts` +5 LOC — register `DAMAGE_PARCEL_TRAVEL_MS = 350`, `DAMAGE_PARCEL_STAGGER_MS = 50` per the motion-vocabulary registry convention.
- New tests at `webclient/src/animation/useDamageEvents.test.ts` (~120 LOC) and `webclient/src/game/DamageParcelOverlay.test.tsx` (~150 LOC).

**Tests (countable per ADR 0014 D2):**
- `useDamageEvents` returns `parcel_hit_player` event when `players[i].life` decreases between two frames (synthetic test).
- Returns `creature_damaged` when `perm.damage` increases.
- Returns `creature_died` when perm leaves battlefield → graveyard.
- Multi-attacker frame returns N events in deterministic order.
- `<DamageParcelOverlay>` renders 0 elements when no events fired.
- Renders N `<circle>` parcels for N events; staggered offsets pinned (event[0] starts at 0ms, event[1] at 50ms, etc.).
- Reduced-motion suppresses the parcel animation; falls back to portrait-bloom only.

**Acceptance:** during a 3-attacker fixture combat damage step, 3 parcels travel along the 3 arrow paths in sequence; the user can visually count them; no path is traversed twice.

### Slice 5-B — Portrait halo bloom on life-loss

**Tier:** Standard (extends an existing visual; new bloom keyframe + life-delta gate).
**Critic matrix:** Builder + Technical + UI.

**Files touched:**
- `webclient/src/game/PlayerPortrait.tsx` modify (~+30 LOC) — subscribe to `useDamageEvents`; when a `parcel_hit_player` event names this player as defender, set a 600ms timer that advances a `bloomState` from `idle → ramping → peak → fading → idle`. The peak coincides with the existing `LifeCounter` flash so visual + numeric land together.
- `index.css` (or `tokens.css`) +~10 LOC — `@keyframes player-portrait-bloom` (alpha + scale spike on the existing halo ring).
- `transitions.ts` +3 LOC — `PORTRAIT_BLOOM_MS = 600`.
- Tests at `PlayerPortrait.test.tsx` extend (~30 LOC) — bloom class applied iff event fires within window; reduced-motion gate.

**Acceptance:** taking 3 damage from an attacker triggers a visible halo bloom on the player's portrait; the bloom peak is within ±100ms of the LifeCounter's flash; reduced-motion users see only the static life-counter flash.

### Slice 5-C — Freeze-frame on damage resolution

**Tier:** Standard (new board-wide overlay; brief duration).
**Critic matrix:** Builder + Technical + UI + Graphical.

**Files touched:**
- New `webclient/src/game/DamageFreezeFrame.tsx` (~140 LOC) — viewport overlay mounted at GameTable level. On any `parcel_hit_player` event (or batch within a frame), pulses a brief lighting shift: viewport-edge bloom on the hit player (danger-tinted), per-creature rim styling pushed via `data-` attributes on each `<TabletopCardButton>` (survivors faint-green, dying red).
- `tabletopBucketStacking.tsx` +~5 LOC — accept a `damageRimState?: 'survivor' | 'dying' | undefined` prop; pass through as `data-damage-rim` for CSS targeting.
- `index.css` +~25 LOC — `@keyframes damage-freeze-frame-edge-bloom`, plus `[data-damage-rim="survivor"]::after` / `[data-damage-rim="dying"]::after` rules for per-creature rim glow.
- `transitions.ts` +3 LOC — `DAMAGE_FREEZE_FRAME_MS = 400`.
- Tests at `DamageFreezeFrame.test.tsx` (~100 LOC).

**Acceptance:** during a damage step where multiple creatures die and a player loses life, the screen briefly tints (~400ms): the hit player's edge has a danger bloom, dying creatures pulse red, survivors get a faint green rim, then everything settles. Reduced-motion users skip the animation; static rim colors persist for the same 400ms instead.

### Slice 5-D — Death handoff (desaturation beat)

**Tier:** Standard (extends an existing animation pipeline; sequence-coordination rather than new visual primitive).
**Critic matrix:** Builder + Technical + UI.

**Files touched:**
- `webclient/src/animation/CardAnimationLayer.tsx` modify (~+50 LOC) — when consuming a `creature_died` event from `useGameDelta`, insert a 150ms desaturation phase BEFORE the existing fly-to-graveyard animation kicks in. Implementation: new keyframe `card-death-desaturate` that ramps `filter: grayscale(0) → grayscale(1)` over 150ms; the fly-to animation defers its start by that 150ms.
- `index.css` +~10 LOC — `@keyframes card-death-desaturate`.
- `transitions.ts` +3 LOC — `CREATURE_DEATH_DESATURATE_MS = 150`.
- Tests at `CardAnimationLayer.test.tsx` extend — desaturate phase precedes fly-to-graveyard; reduced-motion skips the desaturation but keeps the existing fly-to.

**Acceptance:** when a creature dies, a brief desaturation flash happens BEFORE the card flies to graveyard. Multiple deaths in one frame stagger via the parcel-stagger logic (50ms apart) so deaths read as distinct events.

### Slice 5-E — Lethal-21 commander damage authority sequence

**Tier:** Standard (new cinematic surface; depends on schema 1.35 from slice 5-F). MUST land after 5-F, ideally after 5-A through 5-D so the cinematic builds on the established damage-event infrastructure.

**Critic matrix:** Builder + Technical + UI + Graphical + Magic-rules (CR 704.5b verification).

**Files touched:**
- New `webclient/src/animation/useCommanderLethalEvents.ts` (~80 LOC) — frame-diff hook over `WebPlayerView.commanderDamageReceived`; emits `commander_lethal` event when any (player, commander) pair crosses the 21 threshold between frames. Sibling to `useDamageEvents`.
- New `webclient/src/game/CommanderLethalSequence.tsx` (~150 LOC) — viewport overlay that, on `commander_lethal` event, pauses 80ms (everything else fades to 0.4 alpha briefly), spikes the doomed player's portrait halo with one fast rotation, scale-pops the portrait by 4%, draws a thin red line under the commander label via SVG, then releases.
- `transitions.ts` +5 LOC — `LETHAL_AUTHORITY_PAUSE_MS = 80`, `LETHAL_AUTHORITY_HALO_SPIKE_MS = 240`, `LETHAL_AUTHORITY_LINE_DRAW_MS = 320`.
- `index.css` +~20 LOC — keyframes for halo spike + portrait scale pop.
- Tests at `useCommanderLethalEvents.test.ts` + `CommanderLethalSequence.test.tsx` (~200 LOC combined).

**Edge cases (Magic-rules verified):**
- **Crossing exactly 21:** lethal triggers at >= 21 (CR 704.5b). Test fixture covers exactly 21 + greater than 21.
- **Multiple commanders dealing damage to one player:** each is tracked independently. Hitting 21 from commander A while commander B has dealt 14 fires only one lethal event (for A).
- **Partner-pairings:** each partner is its own commander. Reaching 21 from EITHER triggers lethal.
- **Multiple lethal events in one frame:** sequence one-after-the-other (300ms gap between authority sequences) so the order reads.
- **Damage spike past 21 in one hit (e.g., 0 → 30 from Voltron):** still emits one lethal event for that frame, not multiple.
- **Reduced-motion:** authority sequence skipped; the doomed-player overlay still draws the static red underline so the lethality is visually announced without animation.

**Acceptance:** Voltron fixture (commander deals 21+ damage in one swing) plays the authority sequence cleanly; multi-commander partner fixtures correctly distinguish per-commander damage; the red-line-under-commander-label persists after the sequence completes (visual marker that this opponent is the lethality source). WCAG-acceptable contrast on the red line against various commander color halos.

### Slice 5-X.0 — Bundle-level critic pass

Same shape as Bundle 4's 4-X.0. Dispatch technical + UI + UX + bug-hunter against the assembled bundle. Apply blockers + cheap notables.

**Critical critic-pass concerns to surface:**
- Parcel-vs-stack-tile occlusion (foundation Option D ratified the tradeoff at the brief level; verify it still reads acceptable when actual parcels are flying, not just static arrows).
- Visual-noise audit when all 4 sub-features fire on the same frame (3 parcels + 3 portrait blooms + 1 freeze-frame + 2 deaths). Worst-case scenario is a 4p Commander board with massive simultaneous damage.
- Reduced-motion completeness check across all 4 sub-features.
- Rapid-fire damage (e.g., one creature taking lethal damage from triple block, multiple lethal damages in one frame) — does the cinematic queue or pile up?

---

## Cross-slice considerations

### Bundle 5 + foundation Option D interaction

Foundation Option D's commitment was *"arrows stay mounted during combat; brief obscuration of arrow paths by on-stack tiles is the trade."* Bundle 5's parcels traveling along those arrows will surface the obscuration most acutely — a parcel disappearing behind a stack tile mid-flight is the exact failure mode the foundation brief flagged.

**5-X.0 critic pass MUST include a focused live-test against `?game=fixture&variant=tabletop&combat=1&stack=1` AFTER 5-A lands.** If the live verdict is "the parcel's brief vanish reads broken," escalate per the foundation brief's documented fallback (Option C — compact stack restructure). Reverting Option D is a 5-LOC change; restoring the legacy mutex would unmount arrows during stack-busy periods and cause parcels to silently skip those moments — clean degradation rather than visual breakage.

### Tabletop load-bearing rules (T1–T7) verification

| Rule | Verification |
|---|---|
| **T1** Zones are fixed dimensional anchors | Parcels are `position: fixed` viewport overlay (5-A); freeze-frame is also viewport overlay (5-C); portrait bloom is overlay on the existing portrait wrapper (5-B). All `pointer-events: none`. **Pass.** |
| **T2** Action panel floats; never displaces | All bundle elements are overlays at z-indices below the floating ActionButton's `--z-ui-chrome = 30`. **Pass.** |
| **T3** Cards render full Scryfall art | 5-D's desaturate is a CSS filter on the dying card during its handoff window — does NOT modify the cardart pixels permanently; existing fly-to-graveyard animation finishes the transition. 5-C's per-creature rim uses `::after` overlay, no cardart mutation. **Pass.** |
| **T4** Target viewport 1440p | Parcel size + freeze-frame edge-bloom both tuned at 1440p; sub-1440p degradation acceptable. **Pass at design time; verify in live-test.** |
| **T5** No engine code, no wire change, no schema bump | Sub-features 1-4: webclient-only, no wire change. Sub-feature 5: **EXCEPTION** — slice 5-F adds `commanderDamageReceived` to `WebPlayerView` (schema 1.34 → 1.35). T5's "no wire change" rule applies to layout-variant work; cross-bundle wire extensions are governed by the schema-bump protocol (CLAUDE.md hard constraint #4: bump schemaVersion → update snapshot → update zod schemas → write CHANGELOG migration note). The mapper change lives in `Mage.Server.WebApi/` (ours), NOT `Mage/*` (upstream). **Pass with documented schema bump.** |
| **T6** Tabletop is production default | Bundle 5 ships under tabletop default; `current` variant inherits 5-A (overlay is variant-agnostic). 5-B/5-C/5-D use existing per-tile / per-portrait elements that work in either variant. **Pass.** |
| **T7** Cross/plus 4-pod arrangement | Parcel paths key off existing arrow geometry (which is variant-agnostic); freeze-frame and portrait bloom key off per-player elements. No pod-position assumptions. **Pass.** |

### File LOC trajectory

| File | Current | Δ post-bundle | Risk |
|---|---|---|---|
| `useDamageEvents.ts` (new) | — | ~120 | Comfortable. |
| `DamageParcelOverlay.tsx` (new) | — | ~180 | Comfortable. |
| `DamageFreezeFrame.tsx` (new) | — | ~140 | Comfortable. |
| `PlayerPortrait.tsx` | 510+ (already over hard cap, documented exception) | +30 (5-B) | **Plan a split first.** Use a sibling `PlayerPortraitBloom.tsx` for the bloom logic so PlayerPortrait doesn't grow further. |
| `CardAnimationLayer.tsx` | 590 (over hard cap, documented exception) | +50 (5-D) | **Don't make it worse.** Extract the desaturate sequencing into a sibling `CardDeathSequence.tsx`. |
| `tabletopBucketStacking.tsx` | 308 (post-Bundle-4) | +5 (5-C prop addition) | Comfortable. |
| `transitions.ts` | (motion-vocabulary registry) | +14 | Comfortable. |
| `index.css` | (manageable) | +45 (3 keyframes + per-creature rim rules) | Comfortable. |
| Test files | — | +400 | Comfortable, distributed. |

### Test fixture coverage

The existing `?combat=1` fixture renders combat at COMBAT_DAMAGE step, which is the primary surface Bundle 5 fires on. To exercise the cinematic in the static fixture:
- New fixture knob `?damage=1` triggers a synthetic damage event on first paint (parcels fly, portraits bloom, freeze-frame plays). Default-off so other slice fixtures aren't affected.
- The `?stack=1` knob (foundation Option D) can stack with `?damage=1` to test the parcel-vs-stack-tile cohabitation case explicitly.
- Real-game smoke vs AI is the gold-standard verification (mid-combat instants, triggered abilities, multi-defender damage).

### Accessibility

- **Reduced-motion users:** every sub-feature has a static fallback. 5-A static fallback = no parcels (existing portrait flash + life counter is the only damage signal); 5-B static fallback = existing static halo; 5-C static fallback = static rim colors persist for 400ms then fade; 5-D static fallback = no desaturate, fly-to-graveyard happens immediately.
- **Color-blind viewers:** 5-C's red/green rims pair with shape redundancy via Bundle 4's existing role markers (sigil/brackets) — survivors keep brackets, dying creatures lose them. WCAG 1.4.1 — pass.
- **Decorative overlays:** all bundle elements are `aria-hidden="true"`. The wire-driven game-log strip remains the screen-reader-readable surface.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers damage parcels, portrait bloom, freeze-frame, and death desaturate handoff. It does NOT touch arrow path geometry, banner content, phase strip, creature-tile chrome, OR the lethal-21 commander-damage cinematic (which is descoped pending upstream wire work). It explicitly avoids extending `PlayerPortrait.tsx` and `CardAnimationLayer.tsx` past their already-over-cap LOC.

### What I'm changing

- New files: `useDamageEvents.ts`, `DamageParcelOverlay.tsx`, `DamageFreezeFrame.tsx`, `PlayerPortraitBloom.tsx`, `CardDeathSequence.tsx` (the last two extracted siblings to avoid LOC creep on existing over-cap files).
- Modify: `tabletopBucketStacking.tsx` (1 prop addition), `transitions.ts` (3 motion-registry constants), `index.css` (3 keyframes + per-creature rim rules), GameTable mount points for the two new viewport overlays.

### What could break

- **Foundation Option D regression risk:** parcels traveling behind on-stack tiles MAY read as broken. Mitigated by 5-X.0 live-test gate; documented fallback in foundation brief.
- **Frame-diff hook performance:** `useDamageEvents` synthesizes events on every game-view tick. Naive implementation that diffs all players + all permanents every frame is fine for 4p (~30 perms × 4 = 120 diffs); pre-emptively memoize on `gameView.gameCycle` if needed.
- **Stagger ordering determinism:** when multiple parcels fire in one frame, the user expects to count them in a stable order. `useDamageEvents` MUST sort by `(defenderId, attackerId)` deterministically.
- **Bloom synchronization:** 5-B's portrait bloom MUST peak within ±100ms of the LifeCounter flash. If async timing drifts, the visual + numeric desync. Mitigation: derive both from the same `useDamageEvents` event tick, not from independent life-delta detection.
- **5-D and existing graveyard animation interaction:** desaturate phase prepends 150ms BEFORE fly-to-graveyard. If graveyard animation has its own timing assumptions, the prepended delay could shift downstream timing. Mitigation: 5-D slice's technical critic verifies the chain.

### Edge cases

- **0 damage in a damage step** (e.g., all attackers blocked by creatures with toughness ≥ power) — no events fire; cinematic correctly silent.
- **Trample damage** (damage to creature AND player from same attacker) — `useDamageEvents` MUST emit both events. Test fixture covers this.
- **Replacement effects redirecting damage** — the wire-format final state is the only thing the client sees; replacements happen server-side. Cinematic correctly fires on the FINAL damage assignment.
- **Player loses ALL life in one step** (e.g., 40 → 0 from a Craterhoof) — life counter flash + portrait bloom + freeze-frame all fire, but no death sequence (player elimination is a separate code path, not creature-death). Verify the player-dies overlay coordinates cleanly with Bundle 5's freeze-frame.
- **Multiple lethal hits in one frame** (3 creatures all die in one damage step) — 3 desaturates stagger 50ms apart, then 3 graveyard animations. Test fixture covers this.
- **Damage from non-combat sources during combat phase** (e.g., shock landing during combat) — `useDamageEvents` doesn't differentiate; ALL life-loss events fire parcels. **Decision deferred to 5-A's UI critic:** is that desirable (every damage feels cinematic) or noisy (only combat damage should fly parcels)? Default-recommendation: only combat damage fires parcels; non-combat life loss fires bloom + freeze-frame only.

### Schema impact

**Schema 1.34 → 1.35** at slice 5-F. New field: `WebPlayerView.commanderDamageReceived: Record<string, number>` (commander UUID → total damage from that commander). Empty-default for backward compat with rolling deploys. Full migration note in `docs/schema/CHANGELOG.md` per CLAUDE.md hard constraint #4 (all four: bump + snapshot + zod + CHANGELOG, or none).

**Sub-features 1-4 unaffected** — they read existing fields via frame diff and don't touch the schema.

### Upstream rebase impact

**None.** All changes in `webclient/src/`, which is ours.

### Test plan

- Per-slice unit tests as enumerated under each slice. Every acceptance criterion is countable per ADR 0014 D2.
- Regression check: existing `LifeCounter.test.tsx`, `PlayerPortrait.test.tsx`, `CardFace.test.tsx`, `CardAnimationLayer.test.tsx` continue to pass without modification.
- Pre-commit gate: `cd webclient && pnpm typecheck && pnpm lint && pnpm test`.
- One manual `?game=fixture&variant=tabletop&combat=1&damage=1` walk-through per slice.
- After 5-D lands, dispatch bundle-level critic pass per Bundle 4's pattern.

---

## Open questions to resolve before slices land

- **Parcel trigger discrimination.** Combat-damage-only OR all life-loss-fires-parcels? Default suggestion: combat-damage only. Decide at 5-A start with a UI A/B against a non-combat-damage fixture.
- **Parcel visual size + brightness.** Default: 6 px circle, alpha 0.85, color-keyed to the attacker's commander color (matches Bundle 1's arrow stroke palette). Decide at 5-A's UI critic pass.
- **Freeze-frame intensity.** Default: 0.3-second duration; per-creature rim alpha 0.4; player-edge bloom alpha 0.5. Decide at 5-C live-test.
- **Death desaturate intensity.** Default: full grayscale at 150ms peak. Decide at 5-D's UI critic — full grayscale may look harsh; partial (0.7x) may read better.
- **Lethal-21 sub-feature timing.** Currently descoped. Re-open when (a) wire-format expansion adds per-opponent commander damage on `WebPlayerView`, OR (b) user opts into a separate engine-side feature branch. Estimate: ~150 LOC of client work + Java side schema bump.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 5-F | Foundation: per-opponent commander damage on the wire (schema 1.34 → 1.35) | Mapper integration test green; client zod parses 1.35 fixture; CommanderDamageTracker reads wire field; rolling-deploy fallback verified |
| 5-A | Damage parcels traveling along arrows | 3-attacker fixture renders 3 parcels in sequence; foundation Option D obscuration acceptable; no path traversed twice |
| 5-B | Portrait halo bloom on life-loss | Bloom peak within ±100ms of LifeCounter flash; reduced-motion clean |
| 5-C | Freeze-frame on damage resolution | 400ms board-tint pulses correctly on multi-death frame; per-creature rim accurate; no T1 displacement |
| 5-D | Death handoff (desaturate beat) | 150ms desaturate precedes fly-to-graveyard; multi-death stagger reads as distinct events |
| 5-E | Lethal-21 commander-damage authority sequence | Voltron fixture triggers cleanly at exactly 21 damage; partner-pairing fixtures distinguish per-commander damage; multi-lethal events sequence in order; reduced-motion fallback paints static red line |

After 5-E lands, dispatch a bundle-level critic pass (technical + UI + UX + bug-hunter + Magic-rules) per Bundle 4's pattern. Apply findings as 5-X.* follow-up slices. After 5-X cleanup, Bundle 5 is complete with all 5 sub-features shipping.

After Bundle 5 ships, **Bundle 6 (Arrow Storytelling)** is unblocked — same renderer surface, additive on top of 5-A's path-traversal infrastructure.
