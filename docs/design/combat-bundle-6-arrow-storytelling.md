# Bundle 6 — Arrow Storytelling, scope brief

> **Branch:** `feat/combat-bundle-6-arrow-storytelling`
> **Status:** scope-locked, ready to slice
> **Source:** Bundle 6 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axis addressed:** narrative — arrows currently appear/disappear too instantly. They label combat but don't *narrate* it.

## Goal

Make combat arrows tell the story of combat as it unfolds. Today arrows teleport in fully drawn at the moment attackers are declared, then teleport out at end-of-combat. They label "what's attacking what" but don't convey the rhythm of the conversation: declare → response → first-strike-resolves → regular-damage. Bundle 6 layers four temporal/palette signals on top of the existing arrow renderer (Bundle 1's defender colors + foundation Option D's continuous mounting + Bundle 5's parcel cinematic) so each combat sub-step has its own visual character.

This is the third combat bundle that touches the arrow renderer (after Bundles 1 and 5). The recon-and-decide work for the renderer redesign was already absorbed by Bundles 1 and 5; Bundle 6 is purely additive — new keyframes layered onto the existing `<TargetingArrow>` SVG `<path>`, plus a step-aware palette read off the existing `WebGameView.step` field.

## Scope lock

### In scope

Three sub-features (consolidated from the brainstorm's four — sub-features 3 and 4 share the same step-driven palette mechanism so they ship as one slice), sliced into three shippable units:

1. **Attack-arrow pen-stroke draw-in.** When attackers are declared, each arrow strokes itself in over ~400ms using SVG `stroke-dashoffset` animation. The arrowhead appears only in the last quarter of the path (~last 100ms). Feels like the system is *deciding* what's attacking, not just teleporting in a final state. Block-arrow snap-in (sub-feature 2) is the response.

2. **Block-arrow snap-in.** When blockers are declared, their arrows have a different rhythm — shorter (~200ms), snappier easing, almost interrupting the attack arrows. Visually you read attack-then-response, like a conversation. Distinct timing primitive from 6-A.

3. **First-strike-vs-regular palette shift.** The arrow's stroke palette + shimmer character changes between `FIRST_COMBAT_DAMAGE` and `COMBAT_DAMAGE` steps. First-strike damage uses cooler cyan-white stroke + sharp fast shimmer. Regular damage cross-dissolves to warmer amber-orange + slower shimmer. When both happen in one turn (a creature with first strike that survives to deal regular damage), you can tell them apart at a glance. Both palettes inherit Bundle 1's defender-color tinting via blend mode so commander-color identity stays readable underneath.

### Out of scope

- **Hover-isolation freeze.** Already shipped in Bundle 1 slice 1-B (hover-precedence + click-to-pin). No changes.
- **Wave-reveal stagger.** Bundle 1 slice 1-C ships the 90ms-per-defender stagger. Bundle 6 keeps it (operates on a separate timeline from pen-stroke draw-in — opacity fades 120ms, stroke draws 400ms; no fight).
- **Defender color tinting.** Bundle 1 slice 1-A ships per-defender stroke colors. Bundle 6's palette shifts are LAYERED on top via blend mode + shimmer overlay, not replacements.
- **Damage parcel cinematic.** Bundle 5 slice 5-A ships parcels. Bundle 6's palette shift may want to coordinate parcel color (warm vs cool); flagged as optional cross-bundle polish in slice 6-C.
- **Wire-format changes.** All step + combat data already on schema 1.35.
- **`current` (asymmetric-T) variant polish.** Tabletop is the production target. Legacy variant inherits whatever the renderer changes give it; no dedicated polish.

---

## Wire-format readiness (recon result)

All sub-features read existing schema 1.35 fields. **No `schemaVersion` bump.**

| Sub-feature | Source field | File:line |
|---|---|---|
| Pen-stroke draw-in trigger (attack arrow appears) | First frame the attacker exists in `gameView.combat[i].attackers` | [`webclient/src/game/CombatArrows.tsx:86`](../../webclient/src/game/CombatArrows.tsx#L86) |
| Block-arrow snap-in trigger | First frame the blocker exists in `gameView.combat[i].blockers` | Same file |
| First-strike vs regular palette discrimination | `WebGameView.step` enum: `'FIRST_COMBAT_DAMAGE'` vs `'COMBAT_DAMAGE'` | [`webclient/src/api/schemas.ts:801`](../../webclient/src/api/schemas.ts#L801) |
| Existing per-defender color tinting (preserved) | Bundle 1's `arrowStrokeForColorIdentity` | [`webclient/src/game/halo.ts:279`](../../webclient/src/game/halo.ts#L279) |
| Existing wave-reveal stagger (preserved) | Bundle 1 slice 1-C; `transition-delay` on opacity | [`webclient/src/game/TargetingArrow.tsx:255`](../../webclient/src/game/TargetingArrow.tsx#L255) |

**Damage-event step extension (slice 6-C):** existing `DamageEvent` type in `useDamageEvents.ts` carries `attackerId`, `defenderId`, `amount`. Bundle 6 needs to know whether each damage event came from `FIRST_COMBAT_DAMAGE` or `COMBAT_DAMAGE` step. Extend the type with `step: 'first-strike' | 'regular'` (derived from `WebGameView.step` at diff time). No schema bump — engine emits the step on every frame; the diff function reads it.

---

## Slice breakdown

### Slice 6-A — Attack-arrow pen-stroke draw-in

**Tier:** Standard (new motion primitive on existing renderer; no wire change; reduced-motion gate).

**Critic matrix:** Builder + Technical critic + Graphical critic (motion timing).
- UI deferred to bundle-level 6-X.0 (cross-slice palette decisions).
- UX (`covered by Graphical` — motion timing IS the UX surface for storytelling).

**Files touched:**
- `webclient/src/game/TargetingArrow.tsx` modify (~+30 LOC). Add `drawIn?: boolean` prop. When true, set initial `stroke-dashoffset = path.getTotalLength()` and animate to 0 over `ATTACK_ARROW_DRAW_MS`. The existing uniform `'8 6'` dash is replaced by a single dash-and-gap matching the path length so dashoffset can sweep cleanly (visual aliasing concern from recon: `'8 6'` + dashoffset can shimmer on short strokes).
- `webclient/src/game/CombatArrows.tsx` modify (~+15 LOC). Pass `drawIn={true}` for arrows that JUST appeared (compare to previous frame's combat-snapshot). Use a module-level `drawnAttackerIds: Set<string>` flag (mirrors slice 1-C's `arrowsAlreadyStaggered` lifecycle) so a stack push that remounts CombatArrows doesn't replay the draw-in.
- `webclient/src/animation/transitions.ts` +5 LOC. `ATTACK_ARROW_DRAW_MS = 400`, `ATTACK_ARROW_HEAD_DELAY_FRACTION = 0.75`.
- `webclient/src/game/arrowIsolationStore.ts` +20 LOC. Module-level `drawnAttackerIds` Set + helpers `markAttackerDrawn` / `getAttackerDrawn` / `resetAttackerDrawn` mirroring 1-C's stagger flag pattern. Phase-watcher resets on COMBAT → non-COMBAT exit so the next combat re-draws.
- New `TargetingArrow.draw-in.test.tsx` (~80 LOC). Tests: stroke-dashoffset starts at totalLength, animates to 0; arrowhead opacity is 0 for first 75% of timeline, fades in over last 25%; remount within combat doesn't replay; reduced-motion users get instant final state.

**Acceptance:** on a 3-attacker fixture transitioning from PRECOMBAT_MAIN to DECLARE_ATTACKERS, the 3 arrows draw in defender-by-defender (Bundle 1 slice 1-C wave-reveal) AND each individual arrow strokes itself in over 400ms. A stack push during combat (instant cast) does NOT replay the draw-in. Reduced-motion → arrows appear instant-static.

### Slice 6-B — Block-arrow snap-in

**Tier:** Standard (sibling motion primitive to 6-A; same renderer surface).

**Critic matrix:** Builder + Graphical critic.

**Files touched:**
- `webclient/src/game/TargetingArrow.tsx` modify (~+15 LOC). Extend `drawIn` prop into a discriminated union: `drawIn?: { kind: 'attack' } | { kind: 'block' } | undefined`. Block kind uses `BLOCK_ARROW_SNAP_MS = 200` with a snappier easing curve (`cubic-bezier(0.5, 0, 0.4, 1.4)` overshoot).
- `webclient/src/game/CombatArrows.tsx` modify (~+10 LOC). Differentiate "attacker → blocker" arrows from "attacker → player" arrows. The arrow geometry already discriminates via target type (Bundle 1 slice 1-A's `defenderId` lookup).
- `transitions.ts` +3 LOC. `BLOCK_ARROW_SNAP_MS = 200`.
- New tests (~60 LOC). Block arrow uses 200ms; attack arrow uses 400ms; both visible side-by-side in mixed-fixture.

**Key design points:**
- The "interrupting" feel comes from the timing contrast (400ms slow stroke + 200ms snap), not from any actual interruption logic. Block arrows' draw is shorter so they "land" while attack arrows are still finishing — visually reads as "answer cuts off the question."
- Block arrow draw is keyed off the BLOCKER's permanent ID (similar to 6-A's attacker tracking) so reblocking after a destroyed blocker re-draws cleanly.

**Acceptance:** on a fixture with 2 attackers and 1 blocker, the 2 attack arrows draw in over 400ms and the 1 block arrow draws in over 200ms with a snappier overshoot. The block arrow visibly "answers" mid-attack-draw.

### Slice 6-C — First-strike-vs-regular damage palette shift

**Tier:** Standard (extends `DamageEvent` + adds shimmer keyframe + cross-bundle polish for parcels).

**Critic matrix:** Builder + Technical critic + UI critic + Magic-rules critic (CR 510.1 — first-strike timing semantics).

**Files touched:**
- `webclient/src/animation/useDamageEvents.ts` modify (~+15 LOC). Extend `DamageEvent` discriminated union: `{ kind: 'parcel_hit_player'; ...existing; step: 'first-strike' | 'regular' }`. Diff function reads `next.step` and maps `'FIRST_COMBAT_DAMAGE'` → `'first-strike'`, `'COMBAT_DAMAGE'` → `'regular'`.
- `webclient/src/game/TargetingArrow.tsx` modify (~+25 LOC). Add `damageStep?: 'first-strike' | 'regular' | undefined` prop. When set, apply a step-keyed shimmer overlay (CSS keyframe on a sibling layer) + adjust the stroke's mix-blend tint:
  - `'first-strike'` → cool overlay `rgba(180, 230, 255, 0.4)`, sharp 200ms shimmer keyframe.
  - `'regular'` → warm overlay `rgba(255, 200, 130, 0.4)`, slower 350ms shimmer keyframe.
- `webclient/src/game/CombatArrows.tsx` modify (~+10 LOC). Pass `damageStep` from `gameView.step` ('FIRST_COMBAT_DAMAGE' / 'COMBAT_DAMAGE' → mapped enum; otherwise undefined). Cross-dissolve handled by CSS transition on the overlay layer.
- `webclient/src/game/DamageParcelOverlay.tsx` modify (~+10 LOC). Optional cross-bundle polish: parcel fill matches step palette (cool for first-strike, warm for regular). Currently always warm-amber.
- `webclient/src/index.css` +30 LOC. Two keyframes (`arrow-shimmer-first-strike`, `arrow-shimmer-regular`) + matching utility classes. Cross-fade between them via the existing `transition` on the overlay element.
- `transitions.ts` +5 LOC. `ARROW_SHIMMER_FIRST_STRIKE_MS = 200`, `ARROW_SHIMMER_REGULAR_MS = 350`.
- Tests (~120 LOC). Diff function emits correct step enum across fixtures; arrow renders with correct overlay class per step; cross-dissolve transition is wired.

**Magic-rules verification (CR 510.1):**
- First-strike damage step exists ONLY when at least one attacker or blocker has first-strike or double-strike (CR 510.1a/b).
- Regular damage step always fires (post-first-strike survivors deal damage normally).
- A creature with double-strike deals damage in BOTH steps (CR 702.4); the palette shift correctly differentiates.

**Acceptance:** in a fixture transitioning through `FIRST_COMBAT_DAMAGE` → `COMBAT_DAMAGE`, the arrows shift palette + shimmer cadence at the step boundary. A double-strike fixture shows the same arrow in both steps with the palette change. Reduced-motion users see static palette differentiation (no shimmer animation, but the color remains).

### Slice 6-X.0 — Bundle-level critic pass

Same pattern as Bundle 4's 4-X.0 + Bundle 5's 5-X.0. Dispatch parallel 4-specialist (Technical + UI + UX + Graphical for motion-heavy review) + Magic-rules for CR 510.1 verification on slice 6-C. Apply blockers + cheap notables.

---

## Cross-slice considerations

### Renderer cohesion across the bundle

All three sub-features layer onto the same `<TargetingArrow>` SVG `<path>`. Slice 6-A introduces `stroke-dashoffset` animation; 6-B parameterizes it for blocker timing; 6-C adds a sibling shimmer overlay. No conflicts — separate timelines on separate properties.

The existing uniform `'8 6'` dasharray (Bundle 1 slice 1-X-tunings round 7) **is replaced** in 6-A by a single dash-and-gap matching the path length. Otherwise dashoffset sweep produces visual aliasing on short strokes (recon flag). Net result: arrows are now solid-stroked (no dashes) — slight Bundle 1 visual change documented in 6-A's commit message.

### Bundle 5 + Bundle 6 cross-bundle polish

Slice 5-A's damage parcels currently always render warm-amber. Slice 6-C optionally shifts parcel color to match the step palette (cool for first-strike, warm for regular). Implemented as a cross-bundle polish item in 6-C — adds ~10 LOC to `DamageParcelOverlay.tsx`. Defer if 6-C's UI critic prefers the constant warm-amber for parcel readability.

### Tabletop load-bearing rules (T1–T7) verification

| Rule | Verification |
|---|---|
| **T1** Zones are fixed dimensional anchors | Arrow rendering doesn't change layout. **Pass.** |
| **T2** Action panel floats; never displaces | No interaction with action panel. **N/A.** |
| **T3** Cards render full Scryfall art | No card-rendering changes. **N/A.** |
| **T4** Target viewport 1440p | Stroke timings tuned at 1440p; sub-1440p degradation acceptable. **Pass at design time; verify in live-test.** |
| **T5** No engine code, no wire change, no schema bump | All work in `webclient/`. Reads existing schema 1.35 fields. **Pass.** |
| **T6** Tabletop is production default | Bundle 6 ships under tabletop default; legacy variant inherits the renderer changes. **Pass.** |
| **T7** Cross/plus 4-pod arrangement | Arrow geometry is variant-agnostic. **Pass.** |

### File LOC trajectory

| File | Current | Δ post-bundle | Risk |
|---|---|---|---|
| `TargetingArrow.tsx` | 260 | ~330 (6-A: +30, 6-B: +15, 6-C: +25) | Comfortable. |
| `CombatArrows.tsx` | 274 | ~310 (6-A: +15, 6-B: +10, 6-C: +10) | Comfortable. |
| `useDamageEvents.ts` | 161 | ~180 (6-C: +15) | Comfortable. |
| `arrowIsolationStore.ts` | 143 | ~165 (6-A stagger Set) | Comfortable. |
| `DamageParcelOverlay.tsx` | 275 | ~285 (6-C cross-bundle polish, optional) | Comfortable. |
| `transitions.ts` | 425 | ~445 | Comfortable. |
| `index.css` | (large) | +35 (2 shimmer keyframes + dasharray utility) | Comfortable. |
| Tests | — | ~260 LOC | Distributed across 3 new test files. |

### Test fixture coverage

Existing `?game=fixture&variant=tabletop&combat=1` is parked at `COMBAT_DAMAGE`. Slices 6-A and 6-B need a fixture parked at the first-paint of `DECLARE_ATTACKERS` so the draw-in is visible (the `?combat=declare` knob from slice 4-X.1 already does this). Slice 6-C needs a fixture transitioning between `FIRST_COMBAT_DAMAGE` and `COMBAT_DAMAGE` to verify the palette shift — extend the fixture with a `?firststrike=1` knob OR rely on real-game smoke vs AI Commander deck running first-strike commanders.

### Reduced motion

- **6-A pen-stroke draw-in:** snap to final state (no animation) under `prefers-reduced-motion: reduce`. The Bundle 1 slice 1-C wave-reveal stagger already handles this pattern cleanly; 6-A inherits the same gate at the call site.
- **6-B block snap-in:** same — snap to final state.
- **6-C palette shift:** the COLOR change persists under reduced-motion (color isn't motion); only the SHIMMER keyframe is suppressed. Static cool-vs-warm differentiation remains, satisfying WCAG 1.4.1 redundant-signal claim.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers attack-arrow draw-in, block-arrow snap-in, and first-strike-vs-regular palette shift. It does NOT touch arrow geometry, hover-isolation, wave-reveal stagger, defender-color tinting, parcel cinematic core, or freeze-frame. It explicitly preserves Bundles 1 + 5's existing behaviors as additive layers.

### What I'm changing

- Modify: `TargetingArrow.tsx` (largest delta, ~70 LOC), `CombatArrows.tsx` (~35 LOC), `useDamageEvents.ts` (~15 LOC), `DamageParcelOverlay.tsx` (~10 LOC optional), `arrowIsolationStore.ts` (~20 LOC), `transitions.ts` (~13 LOC).
- New CSS keyframes in `index.css` (~35 LOC).
- New test files for each slice.

### What could break

- **Existing Bundle 1 dasharray uniform `'8 6'`** is replaced by single-dash-matching-path-length. Visual change for ALL arrows. Bundle critic at 6-X.0 verifies this still reads as "combat arrow" and not "weird solid line."
- **Bundle 1 slice 1-C wave-reveal stagger** is `transition-delay` on opacity. 6-A's pen-stroke is on `stroke-dashoffset`. Both can run simultaneously — verify in 6-A test.
- **Bundle 5's `DamageEvent` type** gets a new `step` field. Existing consumers (`DamageParcelOverlay`, `usePortraitBloom`, `DamageFreezeFrame`) ignore the new field; unchanged behavior.
- **Module-level `drawnAttackerIds` Set lifetime** — must reset on COMBAT → non-COMBAT phase exit (mirrors slice 1-C's stagger flag pattern). Without reset, an attacker that survived this combat and re-attacks next turn wouldn't redraw.
- **Reduced-motion completeness** — three new motion primitives (6-A, 6-B, 6-C shimmer); each must have a static fallback. Color change in 6-C is NOT motion and persists.

### Edge cases

- **Stack push during combat** — CombatArrows unmounts (Bundle 5 / foundation Option D mitigated arrow-side, but stack-fan still preempts the focal cell). When CombatArrows remounts after stack clears, the module-level `drawnAttackerIds` Set survives → no replay. ✓
- **Reblocking** — first blocker dies, second blocker assigned. Block-arrow re-draws because the blocker permanent ID is new.
- **Triple block / multi-block** — N block arrows all draw in 200ms simultaneously. Acceptable; brief doesn't ask for inter-blocker stagger.
- **Double-strike creature** — fires in BOTH `FIRST_COMBAT_DAMAGE` and `COMBAT_DAMAGE`. Palette shifts twice (cool → warm) on the same arrow.
- **Reduced-motion** — all three motion primitives snap to final state; palette differentiation via static color persists.
- **No combat (PRECOMBAT_MAIN)** — no arrows, no draw-in, no shimmer. Trivial baseline.

### Schema impact

**None.** All four sub-features read existing schema 1.35 fields (`combat`, `step`). No bump.

### Upstream rebase impact

**None.** All changes in `webclient/src/`.

### Test plan

- Per-slice unit tests as enumerated. Every acceptance criterion is countable per ADR 0014 D2.
- Regression check: existing `TargetingArrow.test.tsx`, `CombatArrows.test.tsx`, `halo.test.ts`, `useDamageEvents.test.ts` continue to pass.
- Pre-commit gate: `pnpm typecheck && pnpm lint && pnpm test`.
- Manual smoke per slice via existing `?combat=1` / `?combat=declare` knobs; new `?firststrike=1` knob in 6-C if first-strike fixture extension is needed.
- Bundle-level critic pass at 6-X.0 (per Bundle 4 / Bundle 5's pattern).

---

## Open questions to resolve before slices land

- **Pen-stroke easing curve.** Brief default: `cubic-bezier(0.45, 0, 0.55, 1)` (smooth in/out). Decide at 6-A start with a 30-min A/B against the live build.
- **Block snap easing overshoot magnitude.** Brief default: `cubic-bezier(0.5, 0, 0.4, 1.4)` (slight overshoot for "snap" feel). UI/Graphical critic ratifies.
- **First-strike palette saturation.** Default cool overlay alpha 0.4; defer tuning to live-test.
- **Parcel color cross-bundle polish (6-C).** Default ON (parcel matches step palette); UI critic can ratify or revert to constant warm-amber.
- **Dasharray replacement for 6-A.** Default: replace `'8 6'` with single-dash-matching-path-length so dashoffset sweeps cleanly. Live-test verifies the resulting "solid" arrow still reads correctly.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 6-A | Attack-arrow pen-stroke draw-in | 3-attacker fixture: arrows draw in over 400ms; stack-push remount doesn't replay; reduced-motion clean |
| 6-B | Block-arrow snap-in | Mixed fixture: block arrow draws in 200ms with snappier easing while attack arrows are still mid-stroke |
| 6-C | First-strike-vs-regular palette shift + shimmer + parcel polish | First-strike → regular step transition shifts palette + shimmer; static color differentiation persists under reduced-motion |

After 6-C lands, dispatch a bundle-level critic pass (Technical + UI + UX + Graphical + Magic-rules per CR 510.1) per Bundle 4 / Bundle 5's pattern. Apply blockers + cheap notables as 6-X.0. After 6-X.0 cleanup, Bundle 6 is complete; **Bundle 2 (Combat Stage)** is the only remaining brainstorm bundle.
