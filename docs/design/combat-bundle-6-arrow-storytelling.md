# Bundle 6 — Arrow Storytelling, scope brief (v2 — overlay-path redesign)

> **Status:** scope-locked, ready to slice
> **Source:** Bundle 6 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axis addressed:** narrative — arrows currently appear/disappear too instantly. They label combat but don't *narrate* it.
> **Supersedes:** v1 (commit `88afd4e962`). Slice 6-A v1 was reverted (`f0d03cc1e2`) because its dasharray override turned Bundle 1's dashed `'8 6'` arrows solid at-rest, which the user explicitly rejected on live.

## Goal

Make combat arrows tell the story of combat as it unfolds. Today arrows teleport in fully drawn at the moment attackers are declared, then teleport out at end-of-combat. They label "what's attacking what" but don't convey the rhythm of the conversation: declare → response → first-strike-resolves → regular-damage. Bundle 6 layers four temporal/palette signals on top of the existing arrow renderer (Bundle 1's defender colors + foundation Option D's continuous mounting + Bundle 5's parcel cinematic) so each combat sub-step has its own visual character.

This is the third combat bundle that touches the arrow renderer (after Bundles 1 and 5). Bundle 6 v2 is purely additive — new keyframes and a sibling SVG `<path>` layered on top of the existing dashed `<path>`, plus a step-aware palette read off the existing `WebGameView.step` field. **The Bundle 1 dashed `'8 6'` at-rest appearance is preserved exactly.**

## Scope lock

### In scope

Three sub-features (consolidated from the brainstorm's four — sub-features 3 and 4 share the same step-driven palette mechanism so they ship as one slice), sliced into three shippable units:

1. **Attack-arrow pen-stroke draw-in.** When attackers are declared, an **overlay ink path** is painted on top of the existing dashed arrow. The overlay strokes itself in over ~400ms via SVG `stroke-dashoffset`, with the arrowhead appearing only in the last quarter (~last 100ms). After the draw completes, the overlay fades to opacity 0 (~80ms) and unmounts; the underlying Bundle 1 dashed path is what remains visible at-rest. Feels like the system is *deciding* what's attacking, not just teleporting in a final state.

2. **Block-arrow snap-in.** When blockers are declared, their overlay paint has a different rhythm — shorter (~200ms), snappier easing, almost interrupting the attack arrows. Visually you read attack-then-response, like a conversation. Distinct timing primitive from 6-A; same overlay-path mechanism.

3. **First-strike-vs-regular palette shift.** During `FIRST_COMBAT_DAMAGE` and `COMBAT_DAMAGE` steps, a **shimmer overlay path** (a third sibling `<path>`) cross-dissolves between cool cyan-white (first-strike) and warm amber-orange (regular). When both happen in one turn (a creature with first strike that survives to deal regular damage), you can tell them apart at a glance. Both palettes inherit Bundle 1's defender-color tinting via blend mode so commander-color identity stays readable underneath.

### Out of scope

- **Hover-isolation freeze.** Already shipped in Bundle 1 slice 1-B (hover-precedence + click-to-pin). No changes.
- **Wave-reveal stagger.** Bundle 1 slice 1-C ships the 90ms-per-defender stagger on the bottom path's opacity. Bundle 6 layers on top — see "Cinematic stack composition" below.
- **Defender color tinting.** Bundle 1 slice 1-A ships per-defender stroke colors. Bundle 6's palette shifts are LAYERED on top via blend mode + a separate shimmer path, not replacements.
- **Damage parcel cinematic.** Bundle 5 slice 5-A ships parcels. Slice 6-C may want to coordinate parcel color with the step palette; flagged as optional cross-bundle polish.
- **Bundle 1 dasharray.** The dashed `'8 6'` at-rest appearance is **load-bearing** — the user verified on live that this is the correct visual identity for combat arrows. v1's dasharray override is permanently off the table.
- **Wire-format changes.** All step + combat data already on schema 1.35. **No `schemaVersion` bump.**
- **`current` (asymmetric-T) variant polish.** Tabletop is the production target. Legacy variant inherits whatever the renderer changes give it; no dedicated polish.

---

## Mechanism: the overlay-path approach

The crux of the v2 redesign. v1 tried to repurpose the existing `<path>`'s `strokeDasharray` for a dashoffset sweep — which conflicts with Bundle 1's dashed at-rest appearance. v2 keeps the at-rest path untouched and adds **one or two sibling `<path>` elements** on top, each with its own dasharray + opacity timeline:

```
┌─ <svg> ─────────────────────────────────────────────────────────────┐
│ ┌─ <path data-arrow-layer="base"> ─────────────────────────────┐    │
│ │  Bundle 1's existing dashed '8 6' arrow.                     │    │
│ │  Always present when the combat group exists.                │    │
│ │  Drives the wave-reveal opacity stagger (1-C).               │    │
│ └──────────────────────────────────────────────────────────────┘    │
│ ┌─ <path data-arrow-layer="ink"> (slice 6-A / 6-B) ────────────┐    │
│ │  Solid stroke. Same path geometry.                           │    │
│ │  strokeDasharray = "<L> <L>" (where L = pathLength).         │    │
│ │  strokeDashoffset animates L → 0 over draw-in window.        │    │
│ │  Opacity fades to 0 + unmounts on draw-in completion.        │    │
│ │  Has its OWN useId-prefixed marker so the arrowhead         │    │
│ │  appears with the ink, not against the bottom path.          │    │
│ └──────────────────────────────────────────────────────────────┘    │
│ ┌─ <path data-arrow-layer="shimmer"> (slice 6-C) ──────────────┐    │
│ │  Solid stroke, mix-blend-mode: screen.                       │    │
│ │  Cool/warm fill toggles on `WebGameView.step`.               │    │
│ │  CSS keyframe pulses opacity during damage step only.        │    │
│ └──────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

Each layer has its own `data-arrow-layer` attribute so tests can target them deterministically. The base path is the existing one — no changes to its DOM shape, dasharray, or transition-delay. The ink and shimmer layers are conditional renders inside `<TargetingArrow>` gated on incoming props.

---

## Wire-format readiness (recon result — unchanged from v1)

All sub-features read existing schema 1.35 fields. **No `schemaVersion` bump.**

| Sub-feature | Source field | File:line |
|---|---|---|
| Pen-stroke draw-in trigger (attack arrow appears) | First frame the attacker exists in `gameView.combat[i].attackers` | [`webclient/src/game/CombatArrows.tsx:86`](../../webclient/src/game/CombatArrows.tsx#L86) |
| Block-arrow snap-in trigger | First frame the blocker exists in `gameView.combat[i].blockers` | Same file |
| First-strike vs regular palette discrimination | `WebGameView.step` enum: `'FIRST_COMBAT_DAMAGE'` vs `'COMBAT_DAMAGE'` | `webclient/src/api/schemas.ts` |
| Existing per-defender color tinting (preserved) | Bundle 1's `arrowStrokeForColorIdentity` | [`webclient/src/game/halo.ts:279`](../../webclient/src/game/halo.ts#L279) |
| Existing wave-reveal stagger (preserved on the BASE path) | Bundle 1 slice 1-C; `transition-delay` on opacity | [`webclient/src/game/TargetingArrow.tsx:255`](../../webclient/src/game/TargetingArrow.tsx#L255) |

**Damage-event step extension (slice 6-C):** existing `DamageEvent` type in `useDamageEvents.ts` carries `attackerId`, `defenderId`, `amount`. Bundle 6 needs to know whether each damage event came from `FIRST_COMBAT_DAMAGE` or `COMBAT_DAMAGE` step. Extend the type with `step: 'first-strike' | 'regular'` (derived from `WebGameView.step` at diff time). No schema bump — engine emits the step on every frame; the diff function reads it.

---

## Slice breakdown

### Slice 6-A — Attack-arrow pen-stroke draw-in (overlay-path redesign)

**Tier:** Architectural (new motion primitive on existing renderer + DOM-shape change adding a sibling `<path>` layer + module-level lifecycle tracking; no wire change; reduced-motion gate).

**Why architectural rather than standard:** the v1 approach was Standard because it modified an existing prop. v2 changes the DOM shape of `<TargetingArrow>` (now mounts 1–3 sibling paths conditionally), introduces a per-attacker draw-tracking lifecycle (mirroring 1-C's pattern), and has to compose cleanly with three pre-existing motion timelines (1-C wave-reveal, 5-A parcel travel, hover-isolation dim). Full critic matrix per CLAUDE.md.

**Critic matrix:** Builder + Technical critic + Graphical critic (motion timing) + UX critic (cumulative cinematic concern, see open questions).
- UI critic deferred to bundle-level 6-X.0.
- Magic-rules: N/A for this slice.

**Files touched:**
- `webclient/src/game/TargetingArrow.tsx` modify (~+50 LOC). Add `drawIn?: { kind: 'attack' } | { kind: 'block' } | undefined` prop. When set, render a second `<path>` sibling (the "ink" layer) with its own marker id, its own gradient id (when stroke is gradient), `strokeDasharray="<L> <L>"` where L is the path total length, and an inline-style `strokeDashoffset` animating from L → 0 over the kind-specific duration. After completion, opacity transitions to 0 over 80ms and the layer is unmounted via local component state. The base path's existing dasharray + opacity transitions are completely untouched.
- `webclient/src/game/CombatArrows.tsx` modify (~+25 LOC). Compute per-arrow `drawIn` value: `{ kind: 'attack' }` when this is the first paint of an attacker's arrow, `{ kind: 'block' }` when it's a blocker arrow's first paint (slice 6-B's portion), `undefined` otherwise. Lookup is against the new draw-tracking flag set.
- `webclient/src/animation/transitions.ts` +8 LOC. `ATTACK_ARROW_INK_DRAW_MS = 400`, `BLOCK_ARROW_INK_DRAW_MS = 200` (used by 6-B), `ARROW_INK_FADEOUT_MS = 80`, `ARROW_INK_HEAD_DELAY_FRACTION = 0.75`.
- `webclient/src/game/arrowIsolationStore.ts` +30 LOC. Module-level `Set<string>` keyed by attacker permanent id (for 6-A) and blocker permanent id (for 6-B), plus helpers `markArrowDrawn(id)` / `hasArrowDrawn(id)` / `resetArrowDrawn()`. The existing phase watcher (subscribed to `useGameStore`) gets one extra line: clear this Set on COMBAT → non-COMBAT transitions, alongside the existing `arrowsAlreadyStaggered` reset.
- New `TargetingArrow.draw-in.test.tsx` (~100 LOC). Tests:
  - When `drawIn={{ kind: 'attack' }}`, two `<path>` elements render with `data-arrow-layer="base"` and `data-arrow-layer="ink"`.
  - The ink path's initial inline-style `strokeDashoffset` equals its `strokeDasharray`'s first value (i.e., starts hidden).
  - The ink path's transition target is `strokeDashoffset: 0`.
  - The base path's `strokeDasharray="8 6"` is **unchanged** (regression test for the v1 bug).
  - When `drawIn` is undefined, only the base path renders.
  - Reduced-motion users: ink path either never mounts OR mounts with instant final state (decided at builder time per `usePrefersReducedMotion()`). Brief default: never mount.

**Acceptance (countable per ADR 0014 D2):**
- DOM contains exactly 2 `<path>` elements per arrow during the draw-in window (`data-arrow-layer="base"` + `data-arrow-layer="ink"`).
- After the draw-in completes, DOM contains exactly 1 `<path>` element per arrow (the ink layer has unmounted).
- The base path's `strokeDasharray` attribute is exactly `"8 6"` at every observed moment of the draw-in window.
- On a 3-attacker fixture transitioning from PRECOMBAT_MAIN to DECLARE_ATTACKERS, the 3 ink paths' `strokeDashoffset` values transition to 0 over 400ms each, defender-by-defender per Bundle 1 slice 1-C wave-reveal.
- A stack push during combat (instant cast) does NOT replay the draw-in: when CombatArrows remounts after stack clears, `hasArrowDrawn(attackerId)` returns true and the ink layer never mounts for the same attacker.
- Reduced-motion → only base paths mount; ink layer is suppressed entirely.

### Slice 6-B — Block-arrow snap-in

**Tier:** Standard (sibling motion primitive to 6-A; same renderer surface; no new mechanism).

**Critic matrix:** Builder + Graphical critic.

**Files touched:**
- `webclient/src/game/TargetingArrow.tsx` modify (~+10 LOC). The `drawIn.kind === 'block'` branch uses `BLOCK_ARROW_INK_DRAW_MS = 200` with a snappier easing curve (`cubic-bezier(0.5, 0, 0.4, 1.4)` overshoot). Same overlay-path mechanism as 6-A — only the duration + easing differ.
- `webclient/src/game/CombatArrows.tsx` modify (~+10 LOC). Differentiate "attacker → blocker" arrows from "attacker → player" arrows via the existing `targetId` discrimination (a permanent id vs. `"player:<uuid>"`).
- `transitions.ts` already has `BLOCK_ARROW_INK_DRAW_MS` from slice 6-A's constant block.
- New tests (~60 LOC). Block-arrow ink uses 200ms transition; attack-arrow ink uses 400ms; both visible side-by-side in mixed-fixture; block ink overshoot easing applied.

**Key design points:**
- The "interrupting" feel comes from the timing contrast (400ms slow stroke + 200ms snap), not from any actual interruption logic. Block arrows' ink is shorter so they "land" while attack arrows' ink is still finishing — visually reads as "answer cuts off the question."
- Block arrow ink is keyed off the BLOCKER's permanent ID (similar to 6-A's attacker tracking) so reblocking after a destroyed blocker re-draws cleanly.

**Acceptance:** on a fixture with 2 attackers and 1 blocker, the 2 attack-arrow ink layers transition over 400ms and the 1 block-arrow ink layer transitions over 200ms with a snappier overshoot. The block-arrow ink visibly "answers" mid-attack-draw.

### Slice 6-C — First-strike-vs-regular damage palette shift

**Tier:** Standard (extends `DamageEvent` + adds shimmer-overlay layer + cross-bundle polish for parcels).

**Critic matrix:** Builder + Technical critic + UI critic + Magic-rules critic (CR 510.1 — first-strike timing semantics).

**Files touched:**
- `webclient/src/animation/useDamageEvents.ts` modify (~+15 LOC). Extend `DamageEvent` discriminated union: `{ kind: 'parcel_hit_player'; ...existing; step: 'first-strike' | 'regular' }`. Diff function reads `next.step` and maps `'FIRST_COMBAT_DAMAGE'` → `'first-strike'`, `'COMBAT_DAMAGE'` → `'regular'`.
- `webclient/src/game/TargetingArrow.tsx` modify (~+30 LOC). Add `damageStep?: 'first-strike' | 'regular' | undefined` prop. When set, mount a third sibling `<path data-arrow-layer="shimmer">` with same geometry, `mix-blend-mode: screen`, and a step-keyed CSS keyframe class:
  - `'first-strike'` → cool overlay `rgba(180, 230, 255, 0.4)`, sharp 200ms shimmer keyframe.
  - `'regular'` → warm overlay `rgba(255, 200, 130, 0.4)`, slower 350ms shimmer keyframe.
- `webclient/src/game/CombatArrows.tsx` modify (~+10 LOC). Pass `damageStep` from `gameView.step` ('FIRST_COMBAT_DAMAGE' / 'COMBAT_DAMAGE' → mapped enum; otherwise undefined). Cross-dissolve between cool and warm handled by CSS class swap with the existing transition.
- `webclient/src/game/DamageParcelOverlay.tsx` modify (~+10 LOC). Optional cross-bundle polish: parcel fill matches step palette (cool for first-strike, warm for regular). Currently always warm-amber.
- `webclient/src/index.css` +30 LOC. Two keyframes (`arrow-shimmer-first-strike`, `arrow-shimmer-regular`) + matching utility classes.
- `transitions.ts` +5 LOC. `ARROW_SHIMMER_FIRST_STRIKE_MS = 200`, `ARROW_SHIMMER_REGULAR_MS = 350`.
- Tests (~120 LOC). Diff function emits correct step enum across fixtures; arrow renders shimmer layer with correct class per step; cross-dissolve transition is wired.

**Magic-rules verification (CR 510.1):**
- First-strike damage step exists ONLY when at least one attacker or blocker has first-strike or double-strike (CR 510.1a/b).
- Regular damage step always fires (post-first-strike survivors deal damage normally).
- A creature with double-strike deals damage in BOTH steps (CR 702.4); the palette shift correctly differentiates.

**Acceptance:** in a fixture transitioning through `FIRST_COMBAT_DAMAGE` → `COMBAT_DAMAGE`, the shimmer layer's class shifts from `arrow-shimmer-first-strike` to `arrow-shimmer-regular`. A double-strike fixture shows the same arrow with the class change. Reduced-motion users see static palette differentiation (no shimmer keyframe animation, but the color persists as a static fill).

### Slice 6-X.0 — Bundle-level critic pass

Same pattern as Bundle 4's 4-X.0 + Bundle 5's 5-X.0. Dispatch parallel 4-specialist (Technical + UI + UX + Graphical for motion-heavy review) + Magic-rules for CR 510.1 verification on slice 6-C. Apply blockers + cheap notables.

---

## Cross-slice considerations

### Cinematic stack composition (open question — see below)

When attackers are first declared, three timelines compose on the same arrow:

| Layer | Property | Duration | Trigger |
|---|---|---|---|
| Base path opacity | `opacity 0 → 1` | 120ms (fixed) + 0–450ms reveal-delay (1-C wave-reveal) | First paint |
| Ink path dashoffset | `strokeDashoffset L → 0` | 400ms | Mounted after... what? See open question. |
| Ink path opacity | `opacity 1 → 0` | 80ms | After dashoffset reaches 0, unmount |

**Worst case:** at a 5-defender table with reveal-delay capped at 450ms, the last defender's arrow finishes its base reveal at 450 + 120 = 570ms, then begins ink draw → +400ms = 970ms cumulative cinematic if the ink fires after the base reveal completes. If the ink fires simultaneously with the base reveal, the worst case is 850ms (450ms reveal-delay + 400ms ink).

Three options to resolve, decided at slice 6-A start:

1. **Ink fires concurrently with base reveal** (default — least cumulative time). The base path's reveal-delay applies; the ink path mounts at the same delay and animates over 400ms. User sees the base path emerging dimly while the ink scratches it in.
2. **Ink fires after base reveal completes per-defender.** Cleaner sequencing — "the arrow appears, then is inked." Worst case 970ms; could feel slow at a full table.
3. **Ink suppressed when base reveal-delay > 0.** Only the first defender's arrows get the pen-stroke storytelling; subsequent defenders snap-in via base reveal. Trades visual richness for time budget.

Brief default: **option 1** (concurrent). Live-test at slice 6-A start to ratify.

### Renderer cohesion across the bundle

All three sub-features layer onto the same `<TargetingArrow>` SVG. The base `<path>` is the existing one — completely unchanged. Slice 6-A introduces the ink `<path>`; 6-B parameterizes its duration; 6-C adds a third shimmer `<path>`. No conflicts — three distinct DOM elements with separate timelines.

Each layer's marker (`<defs><marker>`) gets its own useId-prefixed id so the ink layer's arrowhead doesn't share fill with the base layer's. The base layer's marker fill is still defender-color-keyed; the ink layer's marker uses the ink's solid stroke color (default: same as base, but a future tuning could brighten it).

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
| `TargetingArrow.tsx` | 260 | ~350 (6-A: +50, 6-B: +10, 6-C: +30) | Watch — approaching 400 soft cap. Consider extracting `<ArrowInkLayer>` and `<ArrowShimmerLayer>` as sub-components if 6-C pushes over 400. |
| `CombatArrows.tsx` | 274 | ~320 (6-A: +25, 6-B: +10, 6-C: +10) | Comfortable. |
| `useDamageEvents.ts` | 161 | ~180 (6-C: +15) | Comfortable. |
| `arrowIsolationStore.ts` | 143 | ~175 (6-A draw-tracking Set) | Comfortable. |
| `DamageParcelOverlay.tsx` | 275 | ~285 (6-C cross-bundle polish, optional) | Comfortable. |
| `transitions.ts` | 425 | ~445 | Comfortable. |
| `index.css` | (large) | +35 (2 shimmer keyframes) | Comfortable. |
| Tests | — | ~280 LOC | Distributed across 3 new test files. |

### Cinematic-lab demoability

The lab page at `?game=cinematic-lab` (commit `72db4a7b6d`) currently has 4 buttons triggering Bundle 5 cinematics. Bundle 6 wants two new lab affordances:

- **"Declare attackers"** button — clears combat and re-paints it from a non-combat baseline. Slice 6-A's first-paint draw-in fires.
- **"Declare blockers"** button — adds blockers to existing attackers. Slice 6-B's snap-in fires.

Both can be added in slice 6-A's PR (~30 LOC each) so the lab is the verification surface for slices 6-A + 6-B. Slice 6-C's lab affordance is "transition step from FIRST_COMBAT_DAMAGE to COMBAT_DAMAGE" (~20 LOC).

### Reduced motion

- **6-A pen-stroke draw-in:** ink layer is **never mounted** under `prefers-reduced-motion: reduce`. The base path is the only thing on screen — same as today. The Bundle 1 slice 1-C wave-reveal stagger is opacity-only and exempt per WCAG 2.3.3 footnote.
- **6-B block snap-in:** same — ink layer not mounted.
- **6-C palette shift:** the COLOR change persists under reduced-motion (color isn't motion); only the SHIMMER keyframe is suppressed (mount the shimmer layer with the static class but no keyframe animation). Static cool-vs-warm differentiation remains, satisfying WCAG 1.4.1 redundant-signal claim.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers attack-arrow draw-in, block-arrow snap-in, and first-strike-vs-regular palette shift — all via the overlay-path mechanism that preserves Bundle 1's at-rest dashed appearance. It does NOT touch arrow geometry, hover-isolation, wave-reveal stagger, defender-color tinting, parcel cinematic core, freeze-frame, or the base path's existing dasharray. It explicitly preserves Bundles 1 + 5's existing behaviors as additive layers.

### What I'm changing

- Modify: `TargetingArrow.tsx` (largest delta, ~90 LOC across slices), `CombatArrows.tsx` (~45 LOC), `useDamageEvents.ts` (~15 LOC), `DamageParcelOverlay.tsx` (~10 LOC optional), `arrowIsolationStore.ts` (~30 LOC), `transitions.ts` (~13 LOC).
- New CSS keyframes in `index.css` (~35 LOC).
- New test files for each slice (~280 LOC total).
- Optional new cinematic-lab buttons (~80 LOC across slices).

### What could break

- **Base path appearance regression** — the explicit avoidance criterion. Tests assert `data-arrow-layer="base"` always carries `strokeDasharray="8 6"`; any refactor that touches the base path's attributes fails the test.
- **DOM count change** — anything that counts `<path>` elements in `<TargetingArrow>` (e.g., a future test or hover-isolation iterator) sees 1–3 paths instead of 1. Audit existing tests for hardcoded `<path>` counts.
- **Marker id collisions** — each layer's marker now needs its own useId-prefixed id. The existing `markerId` and `gradientId` constants are shared across layers; new constants per layer needed.
- **Module-level `arrowsDrawn` Set lifetime** — must reset on COMBAT → non-COMBAT phase exit (same hook as 1-C's stagger flag). Without reset, an attacker that survived this combat and re-attacks next turn wouldn't redraw.
- **Reduced-motion completeness** — three new motion primitives (6-A, 6-B, 6-C shimmer); each has a static fallback. Color change in 6-C is NOT motion and persists.
- **Bundle 5 `DamageEvent` consumers** — `DamageParcelOverlay`, `usePortraitBloom`, `DamageFreezeFrame`. Adding a `step` field with TypeScript exact-optional does NOT break them; they ignore the new field.
- **Cumulative cinematic time** — at a 5-defender table, worst case 850ms–970ms before all arrows are settled. Per "Cinematic stack composition" above; option 1 (concurrent) is the brief default.

### Edge cases

- **Stack push during combat** — CombatArrows unmounts (foundation Option D mitigated arrow-side, but stack-fan still preempts). When CombatArrows remounts after stack clears, the module-level `arrowsDrawn` Set survives → ink layer skipped. ✓
- **Reblocking** — first blocker dies, second blocker assigned. Block-ink re-draws because the blocker permanent ID is new.
- **Triple block / multi-block** — N block-arrow ink layers all draw in 200ms simultaneously. Acceptable; brief doesn't ask for inter-blocker stagger.
- **Double-strike creature** — fires in BOTH `FIRST_COMBAT_DAMAGE` and `COMBAT_DAMAGE`. Shimmer layer's class shifts twice (cool → warm) on the same arrow.
- **Reduced-motion** — ink layer not mounted; shimmer layer mounts with static class (no animation). Palette differentiation via static color persists.
- **Mid-draw component unmount** — user navigates away during the 400ms ink animation. The dashoffset interpolation lives on the component's React state + style; unmount cleans it up. No leaks.
- **No combat (PRECOMBAT_MAIN)** — no arrows, no draw-in, no shimmer. Trivial baseline.

### Schema impact

**None.** All four sub-features read existing schema 1.35 fields (`combat`, `step`). No bump.

### Upstream rebase impact

**None.** All changes in `webclient/src/`.

### Test plan

- Per-slice unit tests as enumerated. Every acceptance criterion is countable per ADR 0014 D2.
- Regression check on the base path's dasharray attribute is mandatory in slice 6-A's tests (the v1 regression check).
- Existing `TargetingArrow.test.tsx`, `CombatArrows.test.tsx`, `halo.test.ts`, `useDamageEvents.test.ts` continue to pass.
- Pre-commit gate: `pnpm typecheck && pnpm lint && pnpm test`.
- Manual smoke per slice via the cinematic lab + new lab buttons.
- Bundle-level critic pass at 6-X.0 (per Bundle 4 / Bundle 5's pattern).

---

## Open questions to resolve before slices land

- **Cinematic stack composition.** Brief default: option 1 (ink fires concurrently with base reveal). Decide at 6-A start with a 30-min A/B against the cinematic lab (add the "Declare attackers" button first).
- **Pen-stroke easing curve.** Brief default: `cubic-bezier(0.45, 0, 0.55, 1)` (smooth in/out, symmetric). Front-loaded ease-out option (`cubic-bezier(0.2, 0.7, 0.3, 1)`) — pen lands fast, decelerates into the head. Live A/B at slice 6-A start.
- **Ink layer color.** Brief default: same as base path's stroke (defender color). Alternative: pure white (`#fff`) for a "freshly drawn" feel. Live-test at slice 6-A start.
- **Block snap easing overshoot magnitude.** Brief default: `cubic-bezier(0.5, 0, 0.4, 1.4)` (slight overshoot for "snap" feel). UI/Graphical critic ratifies.
- **First-strike palette saturation.** Default cool overlay alpha 0.4; defer tuning to live-test.
- **Parcel color cross-bundle polish (6-C).** Default ON (parcel matches step palette); UI critic can ratify or revert to constant warm-amber.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 6-A | Attack-arrow ink-overlay draw-in (+ "Declare attackers" lab button) | Cinematic lab fires draw-in cleanly; base path retains `'8 6'` dasharray throughout; stack-push remount doesn't replay; reduced-motion clean |
| 6-B | Block-arrow ink-overlay snap-in (+ "Declare blockers" lab button) | Mixed fixture: block ink draws in 200ms with snappier easing while attack ink is still mid-stroke |
| 6-C | First-strike-vs-regular shimmer layer + parcel polish (+ step-transition lab button) | First-strike → regular step transition shifts shimmer class; static color differentiation persists under reduced-motion |

After 6-C lands, dispatch a bundle-level critic pass (Technical + UI + UX + Graphical + Magic-rules per CR 510.1) per Bundle 4 / Bundle 5's pattern. Apply blockers + cheap notables as 6-X.0. After 6-X.0 cleanup, Bundle 6 is complete; **Bundle 2 (Combat Stage)** is the only remaining brainstorm bundle.
