# Bundle 2 — Combat Stage, scope brief

> **Status:** scope-locked, ready to slice
> **Source:** Bundle 2 of the combat-phase brainstorm ([`docs/design/combat-phase-brainstorm-bundles.md`](combat-phase-brainstorm-bundles.md))
> **Pain axis addressed:** occasion — combat starts and ends without ceremony. The game just slides from main phase into combat and back; there's no signal that *this is the dramatic part of the turn*.

## Goal

Make combat feel like a *staged event*. Today the engine emits `phase: 'COMBAT'` and the steps tick through with no visual punctuation outside the bundle-3 phase-strip ribbon. Bundle 2 adds three atmospheric layers on top of the existing battlefield surface so the central focal area reads as a "lit stage" while combat is active:

1. **A vignette dim** around the outer tabletop pods (audience seating).
2. **A central-area frame** — thin gold edge + inset shadow on the central focal cell (the spotlit stage).
3. **A cross-fade** between combat sub-steps so DECLARE_ATTACKERS → DECLARE_BLOCKERS → damage feels like one continuous scene-with-act-breaks, not a hard cut every step.
4. **A slate-clap pulse** of the central frame at the very start + end of combat ("scene begins / scene ends").

This is the *fourth* combat bundle to ship — sequenced AFTER Bundles 1 / 3 / 5 / 6 because all four pre-existing bundles have implications for Bundle 2's coordinator and we wanted their final shapes locked first. Bundle 2 is purely additive: a new top-level `<CombatStage>` wrapper overlaid via `position: absolute` on the existing battlefield surface, plus a tiny `combatStageStore` that derives stage-phase + stage-event events from `useGameStore`'s `phase` + `step` fields. **No engine code, no wire change, no schemaVersion bump.**

## Scope lock

### In scope

Three sub-features, sliced into three or four shippable units (TBD at recon — slicing depends on whether the cross-fade can ship in one or two passes given the existing 1-C wave-reveal + 6-A v2 ink-draw timeline budget):

1. **Outer vignette dim (slice 2-A).** A `position: absolute` overlay div mounts at the same z-stack tier as the battlefield wrapper (`Battlefield.tsx:163`'s outer flex container) carrying a radial-gradient inset shadow that darkens the outer 25-30% of the viewport. Opacity ramps from 0 → ~0.35 over 350ms when `phase === 'COMBAT'`, ramps back 0.35 → 0 over 250ms when phase exits. Strict opacity cap at 0.35 — the brainstorm's risk note ("can become a second modal layer over the board") forces a hard ceiling.

2. **Central-area frame (slice 2-B).** Thin gold edge (`box-shadow: inset 0 0 0 1px rgba(255,210,120,0.6)`) plus a deeper inset shadow (`inset 0 0 28px rgba(0,0,0,0.45)`) on the central focal area (the cell that already houses the stack + combat arrows). Mounts on the existing focal-zone wrapper (StackZone's outer `<section>` at the `data-testid="stack-zone"` site, with REDESIGN gating). Same lifecycle as the vignette: fade in on COMBAT entry, fade out on COMBAT exit. Independent timing knob from the vignette so the gold edge can lead slightly (e.g. +50ms) for "frame paints first, then audience dims."

3. **Cross-fade between combat sub-steps (slice 2-C).** When `gameView.step` transitions between combat sub-steps (BEGIN_COMBAT → DECLARE_ATTACKERS → DECLARE_BLOCKERS → FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE → END_COMBAT), the central focal area cross-fades a thin "step-tint" overlay (warm tints for declare-* steps, cool tints for damage-* steps) over a 0.15s out / 0.25s in window. Reads as a soft scene-change between acts. Implemented via a sibling `<div>` inside the central-area wrapper that swaps its background-color via React's normal class change + a CSS `transition: background-color 250ms ease-out`. The 0.15s "out" is achieved by deliberately leaving a 150ms gap between the old step's perceived end and the new step's tint mounting (using a `setTimeout(150ms)` in the coordinator) — feels like a soft handoff, not a smash cut.

4. **Slate-clap pulse at start + end of combat (slice 2-D, possibly bundled into 2-B).** When `phase` transitions PRECOMBAT_MAIN → COMBAT (start) and COMBAT → POSTCOMBAT_MAIN (end), the central frame's gold edge does ONE slow pulse: opacity 0.6 → 1.0 → 0.6 over 800ms with a CSS keyframe. Like a director clapping the slate. Single keyframe per event; restart-keyframe-on-event mechanism (toggle a className based on a coordinator-emitted "pulse" event).

### Out of scope

- **Bundle 3 phase-strip / combat-banner.** Already shipped (commit `b7cb6c4ce4` 2026-05-09). Bundle 2's overlays sit OUTSIDE the phase-strip ribbon; no coordination needed.
- **Bundles 5 + 6 cinematics.** The damage parcels (5-A), portrait bloom (5-B), freeze-frame (5-C), commander lethal banner (5-E), arrow ink draw-in (6-A v2), block snap-in (6-B), and shimmer overlays (6-C) all paint INSIDE the central focal area at higher z-index than Bundle 2's overlays. Bundle 2's frame + vignette must not raise z-index above the cinematic layer. See "Cross-bundle z-index ladder" below for the locked z-order.
- **Phase changes outside combat.** Bundle 2 only fires for combat entry/exit. Beginning / Main / End phase transitions get no treatment.
- **Audio.** No sound is in scope. (Brainstorm doc never raised audio; rule in.)
- **Permanent-card framing.** The brainstorm specifies "central area" gets a frame, not individual creature tiles. Bundle 4 (Combat Role Markers) handles per-tile combat affiliation.
- **`current` (asymmetric-T) variant polish.** Tabletop is the production target per T6. Legacy variant inherits whatever the chrome changes give it; no dedicated polish slice.
- **Wire-format changes.** All required fields (`phase`, `step`) are already on schema 1.35. **No `schemaVersion` bump.**

---

## Mechanism: the `combatStageStore` coordinator

The crux of Bundle 2's complexity is coordinating four overlay lifecycles with the existing `gameView.phase` + `gameView.step` stream WITHOUT firing during stack-push remounts or other transient state churn. Pattern mirrors the existing `arrowIsolationStore` phase watcher (slice 1-B / 1-C) but with richer event semantics.

### Store shape

```ts
// webclient/src/game/combatStageStore.ts (new — slice 2-A)
interface CombatStageState {
  // Whether the stage chrome (vignette + frame) is currently mounted +
  // visible. Derived from gameView.phase === 'COMBAT'. Latches across
  // stack-push frames inside combat (so an instant cast during combat
  // doesn't dim the stage off + back on).
  stageActive: boolean;

  // The most recent sub-step the stage has cross-faded INTO. Derived
  // from gameView.step ∈ {BEGIN_COMBAT, DECLARE_ATTACKERS, ...,
  // END_COMBAT}. Resets to null when stageActive flips to false.
  currentSubStep: CombatSubStep | null;

  // Slate-clap pulse trigger. Increments on every PRECOMBAT_MAIN →
  // COMBAT and COMBAT → POSTCOMBAT_MAIN transition. Consumers subscribe
  // to this counter; they fire the keyframe by toggling a className
  // keyed on the counter value (className changes restart the animation).
  slatePulseCounter: number;
}

type CombatSubStep =
  | 'BEGIN_COMBAT'
  | 'DECLARE_ATTACKERS'
  | 'DECLARE_BLOCKERS'
  | 'FIRST_COMBAT_DAMAGE'
  | 'COMBAT_DAMAGE'
  | 'END_COMBAT';
```

A module-level `useGameStore.subscribe(...)` runs once at module load (same pattern as `arrowIsolationStore.ts:201`), reads `state.gameView?.phase` and `state.gameView?.step`, and updates the store's three fields with appropriate derivation. The subscription is the ONLY source of truth for stage state; consumers (CombatStage component) read the derived store fields, not the raw game view.

### Why a separate store (not in `arrowIsolationStore`)

`arrowIsolationStore` is named for its arrow-isolation concern (hover-pin + per-arrow draw-tracking + per-defender stagger flag). Bundle 2's coordinator has different consumers (the CombatStage overlay component, not CombatArrows) and a different lifecycle granularity (slate-clap events fire on phase transitions, not on combat-phase-EXIT only). Keeping them separate avoids cross-talk between concerns — the arrow phase watcher resets `arrowsDrawn` on COMBAT exit; the stage coordinator's slate-clap counter increments on COMBAT entry AND exit. Co-mingling them would force readers to disentangle which subscriber fires when. The cost of a second module is ~80 LOC of mirrored boilerplate; the maintainability win is worth it.

### `<CombatStage>` overlay component

```tsx
// webclient/src/game/CombatStage.tsx (new — slice 2-A)
export function CombatStage() {
  const stageActive = useCombatStageStore((s) => s.stageActive);
  const currentSubStep = useCombatStageStore((s) => s.currentSubStep);
  const slatePulseCounter = useCombatStageStore((s) => s.slatePulseCounter);

  // ... renders 3-4 absolutely-positioned overlay divs:
  //   - vignette (2-A)
  //   - central-frame (2-B)
  //   - step-tint cross-fade (2-C)
  //   - slate-clap pulse (2-D, keyed on slatePulseCounter for keyframe restart)
}
```

Mounts in `Battlefield.tsx` as a sibling of the existing grid, between the `BattlefieldBackground` artwork div and the pod grid. Coordinator-driven; no props.

---

## Wire-format readiness

All sub-features read existing schema 1.35 fields. **No `schemaVersion` bump.**

| Sub-feature | Source field | Existing consumer (for reference) |
|---|---|---|
| Stage active gate (2-A vignette + 2-B frame) | `WebGameView.phase === 'COMBAT'` | `arrowIsolationStore.ts:204` phase watcher |
| Sub-step cross-fade (2-C) | `WebGameView.step` enum | `CombatArrows.tsx:97` damageStepFromGameStep helper |
| Slate-clap event (2-D start) | `phase` transition PRECOMBAT_MAIN → COMBAT | new — derived in coordinator |
| Slate-clap event (2-D end) | `phase` transition COMBAT → POSTCOMBAT_MAIN | new — derived in coordinator |

Both `phase` and `step` are already plumbed through StackZone → CombatArrows (slice 6-C). Adding a third consumer in `<CombatStage>` is mechanical.

---

## Slice breakdown

### Slice 2-A — `combatStageStore` + outer vignette dim

**Tier:** Architectural (new coordinator module + new top-level overlay component + composes with Bundles 1 / 5 / 6's existing motion budget; the brainstorm doc explicitly tagged Bundle 2 as "biggest effort" for this reason).

**Critic matrix:** Builder + Technical critic + UX critic + Graphical critic (motion timing for the vignette ramp). Magic-rules N/A (no engine semantics).

**Files touched:**
- New `webclient/src/game/combatStageStore.ts` (~120 LOC). Zustand store with the three fields above + a module-level `useGameStore.subscribe(...)` that derives state from `gameView.phase` + `gameView.step` + emits slate-pulse on phase transitions.
- New `webclient/src/game/CombatStage.tsx` (~80 LOC for slice 2-A; grows to ~180 LOC across the full bundle). Renders the vignette div initially; slice 2-B adds the frame, 2-C adds the step-tint, 2-D adds the slate-clap pulse.
- Modify `webclient/src/game/Battlefield.tsx` (~5 LOC). Mount `<CombatStage />` as the first child after `BattlefieldBackground`.
- New CSS in `webclient/src/index.css` (~25 LOC). Vignette base styles + transition. Single radial-gradient inset overlay.
- New `webclient/src/game/combatStageStore.test.ts` (~100 LOC). Tests the subscriber: stageActive derives from phase; slate-pulse counter increments on COMBAT entry/exit; currentSubStep tracks gameView.step; stack-push frames during combat don't reset state.
- New `webclient/src/game/CombatStage.test.tsx` (~60 LOC). Tests the vignette div mounts only when stageActive=true; respects reduced-motion (snap on/off instead of fade).

**Acceptance (countable per ADR 0014 D2):**
- DOM contains `<div data-testid="combat-stage-vignette">` when `phase === 'COMBAT'`; absent otherwise.
- Vignette div's inline `opacity` transitions from `0` (mount) to a settled non-zero value (CSS computed style after 400ms) when phase enters COMBAT.
- Stack-push during combat (CombatArrows unmount → remount) does NOT cause the vignette to re-mount; stageActive stays true throughout.
- Under `prefers-reduced-motion: reduce`, the vignette's `opacity` snaps to the settled value instantly (no transition).

### Slice 2-B — central-area frame + slate-clap pulse

**Tier:** Standard (extends `<CombatStage>` with two more overlay primitives; reuses the coordinator from 2-A; new CSS keyframe for the slate-clap pulse; new test surface).

**Critic matrix:** Builder + Graphical critic (timing of the slate-clap pulse against the existing slice 6-A v2 attack-ink draw-in — both fire in the same ~500ms window during DECLARE_ATTACKERS entry; verify the pulse doesn't clash with the ink animation visually).

**Files touched:**
- Modify `webclient/src/game/CombatStage.tsx` (~50 LOC). Add the central-frame overlay div + slate-clap keyframe consumer (key by slatePulseCounter to restart the animation).
- Modify `webclient/src/index.css` (~30 LOC). New `@keyframes combat-stage-slate-pulse` (opacity 0.6 → 1.0 → 0.6 over 800ms). Reduced-motion override silences the animation but keeps the gold edge static.
- New `webclient/src/game/CombatStage.frame.test.tsx` (~40 LOC). Tests the frame mounts/unmounts in sync with stageActive; slate-pulse className changes when slatePulseCounter increments; reduced-motion suppresses the keyframe.

**Acceptance:**
- DOM contains `<div data-testid="combat-stage-frame">` when stageActive=true.
- The frame's inline `box-shadow` matches the spec'd gold edge + inset dark shadow.
- When `slatePulseCounter` increments, the frame element's className includes `combat-stage-slate-pulse`; the className contains the counter value as a key so React re-mounts the animation node (alternative: toggle a data-attribute that the keyframe reads via attribute-selector).
- Under reduced-motion, the gold edge persists but the keyframe is silenced (`@media (prefers-reduced-motion: reduce)` override).

### Slice 2-C — sub-step cross-fade

**Tier:** Standard (extends `<CombatStage>` with a step-tint overlay + cross-fade transition; consumer of `currentSubStep` from 2-A's coordinator; new test surface for the 6-sub-step state machine).

**Critic matrix:** Builder + UX critic (cross-fade timing vs. Bundle 6's ink draw-in / block snap-in / shimmer overlays — three motion primitives composing on the same arrow at the same moment; verify the additional tint doesn't visually overwhelm the existing signals).

**Files touched:**
- Modify `webclient/src/game/CombatStage.tsx` (~40 LOC). Add a step-tint overlay div whose `background-color` swaps based on `currentSubStep`. Same lifecycle as the frame (mounts when stageActive=true).
- Modify `webclient/src/index.css` (~25 LOC). Per-sub-step background-color rules + a `transition: background-color 250ms ease-out` to drive the cross-fade.
- Modify `webclient/src/game/combatStageStore.ts` (~10 LOC). Add a 150ms delay buffer between sub-step transitions so the perceived "out" phase has room. Mechanism: when sub-step changes, set `currentSubStep` to `null` first, then `setTimeout(150ms)` to the new value. Coordinator-level so `<CombatStage>` stays stateless.
- New `webclient/src/game/CombatStage.crossfade.test.tsx` (~80 LOC). Tests the 150ms gap is observed in the store's `currentSubStep`; the tint div's className changes with sub-step; reduced-motion snaps the transition.

**Acceptance:**
- When `gameView.step` transitions from DECLARE_ATTACKERS to DECLARE_BLOCKERS, the coordinator's `currentSubStep` flips to `null` immediately, then to `'DECLARE_BLOCKERS'` after 150ms.
- The tint div's `data-substep` attribute matches `currentSubStep` at every observable frame.
- Per-substep colors land in a "warm declare / cool damage" palette (specific RGB values locked at slice time; brief default: declare-* steps use `rgba(220,160,80,0.08)`, damage-* steps use `rgba(120,180,220,0.08)`, begin/end use `rgba(180,180,180,0.06)`).
- Under reduced-motion, the cross-fade snaps (no gap, no transition).

### Slice 2-X.0 — Bundle-level critic pass

Same pattern as 4-X.0 / 5-X.0 / 6-X.0. Dispatch parallel critics (Technical + UX + Graphical for motion-heavy review). Apply blockers + cheap notables.

**Open question for tier of 2-X.0:** likely Trivial like the others, but if the cross-bundle composition concern surfaces unexpected issues (e.g. CombatStage's z-index conflicts with parcels), the audit might escalate to Standard. Decide at recon.

---

## Cross-slice considerations

### Cross-bundle z-index ladder (load-bearing)

Bundle 2's overlays MUST paint UNDER Bundle 5 cinematics + Bundle 6 arrow overlays. The locked z-order (highest z paints on top):

| Layer | z-index | Source |
|---|---|---|
| Game header | 30 | Game.tsx |
| ActionButton (floating) | 30 | ActionButton.tsx |
| Targeting arrows (combat + cursor) | 40 | TargetingArrow.tsx |
| Damage parcels (Bundle 5) | 25 | DamageParcelOverlay.tsx |
| Commander lethal banner (Bundle 5-E) | 50 | CommanderLethalSequence.tsx |
| Dialogs / modals | 40+ | various |
| **Bundle 2 — central-area frame + step-tint (2-B, 2-C)** | **5** | new |
| **Bundle 2 — outer vignette (2-A)** | **3** | new |
| Battlefield grid + pod cells | 1-2 | Battlefield.tsx |
| Battlefield background artwork | 0 (no explicit z) | BattlefieldBackground.tsx |

Bundle 2 occupies z-3 + z-5 — above the battlefield artwork, below the pod content. The slate-clap pulse rides on the frame's z-5 layer (no separate z assignment).

### Coordinator: stack-push frames

When the user (or any player) casts an instant during combat, the stack pushes and `gameView.phase` STAYS `'COMBAT'` — only the priority changes. The coordinator's stageActive derivation reads `phase === 'COMBAT'`, so it stays true through stack pushes. ✓ correct behavior.

**Edge case:** During DECLARE_ATTACKERS, a triggered ability can put the engine into a sub-phase where `phase === 'COMBAT'` but the priority-step changes (e.g. priority on an in-stack ability resolving). The coordinator's `currentSubStep` should NOT update during stack-resolution phases — it should stay at the underlying combat sub-step until the stack clears. Verify with the engine's PhaseStep emission semantics at slice 2-C recon; the brief currently assumes `gameView.step` continues to emit DECLARE_ATTACKERS during a triggered-ability resolution inside DECLARE_ATTACKERS (i.e. the step is the *combat sub-step*, not the *priority window*). If that assumption is wrong, the cross-fade fires spuriously on every triggered ability — needs gating logic.

### Coordinator: rapid phase exit/entry

The brainstorm doc allows for the case where combat ends and a same-turn second combat begins (e.g. After Lyra's Cleansing Light or any "untap all creatures and you may attack again" effect). The slate-clap pulse should fire TWICE in close succession — once for the first combat's exit, once for the second combat's entry. Implementation: `slatePulseCounter` increments on EACH transition independently, so consecutive pulses are emitted with their own counter values + React re-keys the keyframe element.

### Reduced motion

- **2-A vignette:** under `prefers-reduced-motion: reduce`, the opacity 0 → 0.35 transition is replaced with an instant snap. The vignette still appears (it's a state signal, not motion). WCAG 2.3.3 footnote: opacity transitions are exempt, but the dim itself can read as motion at the periphery — defensive snap.
- **2-B frame:** the gold edge persists statically. The slate-clap KEYFRAME is silenced via `@media (prefers-reduced-motion: reduce) { .combat-stage-slate-pulse { animation: none !important; } }` (mirror of slice 6-X.0's shimmer-suppress pattern).
- **2-C cross-fade:** the 250ms `transition: background-color` is silenced via the global reduced-motion rule. Sub-step tint snaps instead of cross-fading. Color signal preserved.

### Tabletop load-bearing rules (T1-T7) verification

| Rule | Verification |
|---|---|
| **T1** Zones are fixed dimensional anchors | Bundle 2's overlays are absolute-positioned and DO NOT participate in the grid. Pod-zone footprints unchanged. **Pass.** |
| **T2** Action panel floats; never displaces | Action panel z-30 paints above Bundle 2's z-3/z-5. **Pass.** |
| **T3** Cards render full Scryfall art | No card-rendering changes. **N/A.** |
| **T4** Target viewport 1440p | Vignette + frame tuned at 1440p; sub-1440p degradation acceptable (vignette may dim too aggressively at narrow viewports; defer to user verdict). **Pass at design time; verify in live-test.** |
| **T5** No engine code, no wire change, no schema bump | All work in `webclient/`. Reads existing schema 1.35 fields. **Pass.** |
| **T6** Tabletop is production default | Bundle 2 ships under tabletop default; legacy variant inherits the chrome changes. **Pass.** |
| **T7** Cross/plus 4-pod arrangement | Overlays are arrangement-agnostic (vignette is viewport-relative, frame is central-cell-relative). **Pass.** |

### File LOC trajectory

| File | Current | Δ post-bundle | Risk |
|---|---|---|---|
| `Battlefield.tsx` | ~390 (verify at recon) | +5 (`<CombatStage />` mount) | Comfortable. |
| `index.css` | ~870 (post-6-X.0) | +80 (vignette + frame + slate-clap + step-tint keyframes) | Comfortable. |
| `combatStageStore.ts` | — | ~130 (new) | Under 400. |
| `CombatStage.tsx` | — | ~180 (new, full bundle) | Under 400. |
| Tests | — | ~280 (new across 3 test files) | Distributed. |

No files projected past the 400 soft cap.

### Cinematic-lab demoability

Bundle 2 wants two new lab affordances:

- **"Enter combat"** button — clears phase to PRECOMBAT_MAIN for one frame, then sets to COMBAT. Triggers the slate-clap pulse (start) + vignette/frame fade-in.
- **"Exit combat"** button — clears phase to COMBAT (if not there), then sets to POSTCOMBAT_MAIN. Triggers slate-clap pulse (end) + vignette/frame fade-out.

A third lab affordance "Cycle sub-steps" cycles through BEGIN_COMBAT → DECLARE_ATTACKERS → DECLARE_BLOCKERS → FIRST_COMBAT_DAMAGE → COMBAT_DAMAGE → END_COMBAT with a 1500ms hold per step so the cross-fade fires N times consecutively. Useful for tuning the 0.15s out / 0.25s in window.

All three buttons mount in the existing `CinematicLabPanel`; the new triggers go in `CinematicLabTriggers.ts`. ~80 LOC across the lab files. Optional: ship as part of slice 2-A so the verification surface exists from day one (precedent: slice 6-Y.1 added 6-B + 6-C lab buttons after the bundle slices shipped). For Bundle 2 the brainstorm flagged "biggest effort, lower leverage" — having the lab affordances FROM THE START reduces iteration cost dramatically.

### Composition with Bundle 6's ink draw-in

When phase enters COMBAT (slate-clap pulse fires) and immediately step transitions to DECLARE_ATTACKERS (sub-step tint cross-fades + 6-A v2 ink draw-in fires on every attack arrow), THREE motion primitives paint in the same ~500ms window:
- Slate-clap pulse on the central frame (800ms keyframe, peaking at ~400ms).
- Sub-step tint cross-fade (250ms ease-out, settles at ~400ms).
- Attack ink draw-in (400ms symmetric ease, completes at ~400ms).

Brief expectation: these read as ONE coordinated "combat begins" beat, not three competing animations. If the live-test verdict at 2-A is "too busy," 2-X.0 will tune by either lengthening the slate-clap (1200ms) or delaying the ink draw-in (ink waits for slate-pulse peak). Decision deferred to live-test.

---

## Pre-coding breakage analysis (bundle-level)

### Scope lock

This brief covers outer vignette dim, central-area frame, sub-step cross-fade, and slate-clap pulse — all via a new `combatStageStore` coordinator + a single `<CombatStage>` overlay component. It does NOT touch arrow geometry, card rendering, hand layout, action panel, or any of Bundles 1 / 3 / 5 / 6's existing surfaces. It composes by layering UNDER (z-index 3-5) the existing cinematic and arrow surfaces (z-index 25+) without modifying them.

### What I'm changing

- New: `combatStageStore.ts` (~130 LOC), `CombatStage.tsx` (~180 LOC across the bundle), 3 test files (~280 LOC), 2-3 new CinematicLab buttons.
- Modify: `Battlefield.tsx` (~5 LOC mount), `index.css` (~80 LOC vignette + frame + keyframes + step-tint colors), `CinematicLabTriggers.ts` (~60 LOC for the 3 new lab triggers), `CinematicLabPanel.tsx` (~30 LOC for the 3 new buttons).

### What could break

- **z-index ladder regressions** — Bundle 2 introduces z-3 + z-5 layers. Any existing element with no explicit z-index (z=0 auto) under the battlefield grid could end up painting BETWEEN Bundle 2's layers if the DOM order puts it after the CombatStage mount. Mitigation: explicit z-index on every Bundle 2 layer; visual smoke test on the lab.
- **Stack-push false positives** — If the coordinator naively keys stageActive on every gameView change instead of debouncing on `phase`, an instant cast during combat could cause stageActive to flicker. Mitigation: coordinator subscribes specifically to `state.gameView?.phase` (via Zustand's selector form OR a custom equality check) so non-phase changes don't trigger.
- **Triggered abilities mid-DECLARE_ATTACKERS** — If `gameView.step` changes during a triggered-ability resolution inside a combat sub-step, the cross-fade may fire spuriously. Verify at slice 2-C recon whether the engine emits `step` as the combat sub-step (stable across stack resolution) or as the priority-step. If the latter, 2-C needs a stack-empty gate.
- **Reduced-motion cascade** — The global `prefers-reduced-motion: reduce` rule may unintentionally silence Bundle 2's snap-to-final-state opacity changes (which are actually correct for reduced-motion). Bundle 2's CSS rules explicitly use `transition-duration` instead of `transition` shorthand so the global override can neutralize transitions without affecting other properties.
- **CinematicLab fixture step plumbing** — The fixture currently has `phase: 'COMBAT'` + `step: 'COMBAT_DAMAGE'` on baseline. Slate-clap pulses fire only on phase TRANSITIONS, so the baseline mount doesn't fire one — first transition fires on the "Enter combat" button. Verify the coordinator doesn't fire a spurious pulse on initial subscribe (use a "first observation is null" pattern).

### Edge cases

- **No combat at game start** — phase starts as something other than COMBAT; stageActive=false; CombatStage's overlays render nothing. Trivial baseline.
- **Multiple combat phases in one turn** — slate-pulse counter increments on each transition; React's key-on-counter mechanism restarts the keyframe.
- **Phase exit without explicit transition** — if the wire drops the connection mid-combat, the lab's reset button (Bundle 6-Y.1) restores phase to baseline. Coordinator handles this normally (it just sees a new state).
- **Reduced-motion** — vignette snaps, frame gold edge persists static, slate-clap keyframe silenced, sub-step tint snaps. Color signals preserved.
- **Stack push at COMBAT entry** — slate-pulse fires once (on phase transition); subsequent stack push within combat doesn't re-fire.
- **Live game with priority passing rapidly between players** — sub-step gating must not fire on every priority change. Coordinator subscribes to `step`, not to priority-window state.

### Schema impact

**None.** All sub-features read existing schema 1.35 fields (`phase`, `step`). No bump.

### Upstream rebase impact

**None.** All changes in `webclient/`.

### Test plan

- Per-slice unit tests as enumerated above (~280 LOC across 3 test files).
- coordinator-store contract test (`combatStageStore.test.ts`): stageActive derivation, slate-pulse counter increments, currentSubStep tracking, stack-push insensitivity, first-observation handling.
- Visual-regression on the lab: enter/exit combat fires slate-pulse without flicker; vignette ramps cleanly; cross-fade reads as soft scene-change.
- Pre-commit gate: `pnpm typecheck && pnpm lint && pnpm test`.
- Bundle-level critic pass at 2-X.0 (per Bundle 4 / 5 / 6 pattern).

---

## Open questions to resolve before slices land

- **Vignette intensity at peak (2-A).** Brief default: opacity 0.35 settled. UX critic ratifies via lab smoke-test. If too dark → drop to 0.25.
- **Frame edge thickness (2-B).** Brief default: 1px gold inset. Alternative: 2px for stronger "stage edge" reading. Live A/B at 2-B start via the lab.
- **Sub-step tint colors (2-C).** Brief default: warm tint for declare-* (`rgba(220,160,80,0.08)`), cool tint for damage-* (`rgba(120,180,220,0.08)`), neutral for begin/end. Locked at 2-C recon; UI critic may suggest a saturation tweak.
- **Slate-clap pulse duration (2-D).** Brief default: 800ms (peak at 400ms). Alternatives: 1200ms (slower, more ceremonial) vs 600ms (snappier). Graphical critic ratifies via lab + the composition concern above.
- **Should 2-D ship inside 2-B or as a separate slice?** Brief leans 2-B+2-D bundled (both consume the frame element + share the same `<CombatStage>` overlay). Decide at 2-B recon based on whether 2-D's keyframe-restart mechanism adds enough complexity to warrant a slice break.
- **Composition with 6-A v2 ink draw-in (slate-pulse + ink overlap).** Resolve via lab live-test at the bundle critic pass.
- **Cinematic-lab affordances — ship from day one or after 2-A?** Brief recommends day-one shipping (in slice 2-A's PR) to keep iteration cost low. Lab buttons cost ~80 LOC and give 2-B / 2-C / 2-D visible verification immediately.

---

## Sequence + acceptance criteria

| Slice | Ships | Gate to next |
|---|---|---|
| 2-A | `combatStageStore` + `<CombatStage>` overlay component + outer vignette + 3 cinematic-lab buttons (Enter / Exit / Cycle sub-steps) | Vignette ramps cleanly on phase entry/exit; stack push during combat doesn't flicker; reduced-motion snaps; lab buttons all fire |
| 2-B | Central-area frame + slate-clap pulse | Frame mounts on stageActive=true; slate-pulse className restarts on counter increment; reduced-motion silences keyframe but keeps gold edge static |
| 2-C | Sub-step cross-fade with 0.15s out / 0.25s in window | currentSubStep flips to null then to new value with 150ms gap; tint div's data-substep attribute matches at every observable frame; reduced-motion snaps |
| 2-X.0 | Bundle-level critic pass | All blockers fixed; cheap notables applied; remaining queue documented |

After 2-X.0 lands, Bundle 2 is complete. **All six brainstormed combat bundles ship.** The remaining backlog is per-bundle polish + Bundle 5/6 tuning slices (live-A/B verdicts).
