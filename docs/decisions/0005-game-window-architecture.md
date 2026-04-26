# 0005 — Game window architecture (Phase 5)

- **Status:** Draft (living document — populated as Phase 3 and Phase 4 surface answers)
- **Date:** 2026-04-25
- **Deciders:** Austin
- **Supersedes:** —
- **Superseded by:** —
- **Builds on:** [ADR 0001](0001-path-c-strategy.md), [ADR 0002](0002-tech-stack.md)

---

## Context

[PATH_C_PLAN.md](../PATH_C_PLAN.md) Phase 5 is the single largest UI undertaking on the project — 16-24 weeks of work, the defining player-facing surface, and the phase most likely to slip without explicit decomposition. This ADR is the planning artifact: it captures the sub-phasing, the locked-in decisions, the open questions, and the honest scope reality so that Phase 5 begins with a known design surface rather than a blank page.

The ADR is a **living document.** Phase 3 (WebApi game stream) and Phase 4 (webclient foundation) will surface answers to several open questions organically. Update this file the same session a decision firms up; do not let it rot.

---

## North star

**MTGA polish. As close to *Magic: The Gathering Arena* as a single-developer effort can plausibly reach.**

This is a stretch goal. MTGA was built by a team of dozens with multi-million-dollar budgets. A solo developer realistically gets to **~80% of MTGA polish in Phase 5's 21-30 weeks**, with the remaining 20% landing as iterative improvements over the months following. Scope discipline matters: pick the 3-5 animation and interaction moments players see every turn, polish those to MTGA-grade, and accept that the rarer moments (mulligan, game-over, edge-case dialogs) get less love in v1.

What we are **not** doing:
- 3D-rendered cards (MTGA's signature look). We use Scryfall flat card images.
- Custom card-frame rendering from oracle data. Scryfall ships finished art.
- Cinematic spell-resolution animations. We do tasteful effects, not fireworks.

---

## Sub-phasing — Phase 5 in seven slices

Each sub-phase has a single exit gate. Don't move on until the gate is met. Multiplayer (3+ players), draft, tournaments, replays, themes are Phase 6, not Phase 5.

| # | Scope | Effort | Exit gate |
|---|---|---|---|
| **5.0** | Pre-work *(during Phase 3-4)* — synthetic GameView fixtures, wireframes, layout architecture spike, animation budget | 1-2 wk | Storybook of representative game states renders cleanly |
| **5.1** | Static rendering — read-only render of any `WebGameView`. Battlefield, hand, stack, mana pool, life, phase indicator. Tap/flip/transform visuals. No inputs. | 4-6 wk | Replay scrub through any fixture; every zone renders for every state |
| **5.2** | Input scaffolding — pass priority, click-to-play simple cards, action codec end-to-end | 3-4 wk | Player plays a Forest, taps it, passes priority — actions reach server, GameView updates |
| **5.3** | Targeting — click-target spells, multi-target, illegal-target feedback, cancel-action | 3-4 wk | Cast Lightning Bolt at a creature; cast Naturalize on permanent of choice |
| **5.4** | Combat — declare attackers, declare blockers, damage assignment order, combat damage step | 4-6 wk | Full attack-block-resolve combat round-trips correctly with the server |
| **5.5** | Triggers and modal choices — triggered ability ordering dialog, "choose one of X modes," yes/no prompts | 2-3 wk | Multi-trigger ordering UI works; modal spells (Charm cycles) playable |
| **5.6** | Lifecycle flows — mulligan (London), game-over screen, concede/draw, game log | 2-3 wk | Full game lifecycle 1v1 vs AI from mulligan to game-over |
| **5.7** | Polish + zone browsers — graveyard/exile/library browsers, card-detail overlay, chat | 2 wk | Feature parity for 1v1 only |

**Total: 21-30 weeks** at full-time pace. Multiplayer/draft/tournament/replay are Phase 6.

---

## Locked decisions

### From this ADR session (2026-04-25)

1. **State sync model — full snapshot per server push.** Simpler, bandwidth is fine for 2-player MTG. Server pushes the entire `WebGameView` whenever state changes; client diffs against last snapshot for animation cues.
2. **Strict server-authoritative — no optimistic UI.** Player actions wait for server acknowledgement before the client applies them. Adds a small latency on every click; gives correctness for free. Document the tradeoff visibly in player-facing tooltips ("waiting for server" indicator on slow networks).
3. **Visual north star — MTGA polish.** See *North star* above.
4. **Animation framework — Framer Motion.** Rich animation budget. Layout transitions via `<motion.div layout>` + `<LayoutGroup>` (FLIP pattern). GPU-accelerated transforms; cheap enough to hit the perf target.
5. **Battlefield layout — Framer Motion `<motion.div layout>` over flexbox/grid.** Declarative resting positions; smooth automatic interpolation when permanents enter, leave, or re-order. Hand uses an arc-fan layout with hover-lift on the focused card.
6. **Drag-and-drop is in scope.** Desktop-only app, mouse-first input. Click and drag both supported (DnD is the better experience on desktop, click is the fallback for accessibility and as a backup interaction). Pointer events API; no third-party DnD library unless one becomes necessary.
7. **Desktop only.** No mobile/tablet support in Phase 5 or 6. Tauri v2 wraps the web app for native desktop in Phase 7.
8. **Performance target — 60 fps as a hard requirement.** Missing it is a bug, not a polish issue. Framer Motion's GPU transforms are the right tool; React virtual DOM is the risk vector. Profile on a battlefield with 20+ permanents during Phase 5.1.
9. **Theme — dark default.** Light theme is Phase 7.
10. **Color-blind support — Phase 5 deliverable.** Deuteranopia/protanopia palettes for color identity (W/U/B/R/G), ARIA labels on color swatches, no information conveyed by color alone.

### Inherited from earlier ADRs

- React 18 + TypeScript 5 + Vite 5 ([ADR 0002](0002-tech-stack.md))
- Zustand for state ([ADR 0002](0002-tech-stack.md))
- Tailwind v4 for styling ([ADR 0002](0002-tech-stack.md))
- Zod for runtime validation of every WebSocket payload ([ADR 0002](0002-tech-stack.md))
- Card images from Scryfall by `setCode + collectorNumber` ([ADR 0002](0002-tech-stack.md))
- Schema versioning with `schemaVersion` field on every payload ([CLAUDE.md](../../CLAUDE.md))

---

## Open decisions (with current leaning)

These are not yet locked. Each has a recommendation we'll revisit as Phase 3-4 work surfaces concrete information.

### O1. Sound design — include in Phase 5?

**Recommendation: yes, minimal set.** Without audio the polish gap to MTGA is bigger than visual fidelity alone can close. Budget six to eight SFX in Phase 5: card play, spell resolve, mana tap, combat hit, life-total tick, draw card, button hover, error. Expand in Phase 7.

**Open question:** music? MTGA has ambient music. Recommend skipping for v1 — adds licensing complexity.

### O2. Mana-symbol rendering inside rules text

**Recommendation: the [Mana](https://github.com/andrewgioia/mana) icon font by Andrew Gioia.** Drop-in CSS, consistent rendering inside flowed text, MIT-licensed, every mana symbol covered. Alternative is SVG sprites — more flexible but more work. Lock during Phase 4 once card text rendering is on the schedule.

### O3. State persistence and reconnect

**Recommendation: defer.** Phase 5 MVP behavior — "if you disconnect, the game is over (effective concede)." MTGA-style mid-game reconnect is a Phase 6 polish feature. Requires server-side game state to outlive the WebSocket plus a client-side reconnect handshake.

### O4. Keyboard shortcuts

**Recommendation: include the core set in Phase 5.** MTG players value them deeply. Minimum:
- `Space` — pass priority
- `F2` — pass until end of turn
- `F3` — pass until next main phase
- `F4` — pass until next turn
- `Esc` — cancel current action
- `Tab` — cycle through attackers/blockers when declaring

Discoverable via a `?` overlay (MTGA pattern).

### O5. Card hover preview / detail overlay

**Recommendation: floating panel on the right edge of the screen.** Hovering any card in any zone updates the panel with the full Scryfall image and oracle text. Right-click pins the panel. MTGA's pattern; players know it.

### O6. Battlefield zone layout (high-level wireframe)

**Recommendation:**

```
+--------------------------------------------------+
| Opponent's hand (face-down count)   | Opponent   |
|                                     | avatar +   |
| Opponent's battlefield (lands row,  | life +     |
|   non-lands row)                    | mana pool  |
|------------------------------------+|            |
| Stack zone (vertical, right side)   | Card detail|
|------------------------------------+|  panel     |
| Your battlefield (non-lands row,    |  (hover)   |
|   lands row)                        |            |
|                                     | You        |
| Your hand (arc-fan)                 | avatar +   |
|                                     | life +     |
| Phase indicator + priority button   | mana pool  |
+--------------------------------------------------+
```

Wireframe finalized during Phase 5.0. Lock dimensions only after Storybook of fixtures exists.

### O7. Hand sorting / library / graveyard order

**Recommendation:** standard MTG conventions — hand left-to-right by mana value then alphabetical, library shuffled (no peek), graveyard reverse-chronological (top of pile = most recently put there). Configurable in user prefs eventually; defaults are universal.

---

## Animation menu — high-impact MTGA-style moments

Pick what fits the budget. Don't ship all of these in v1.

### Priority A — players see every turn (must-have)

- **Card draw** — slide from library deck to hand with slight arc, scale-up, tiny landing bounce
- **Card play** — hand → stack (or directly to battlefield for lands), glow flash on landing
- **Mana tap** — rotate 90° with bounce overshoot; mana symbol "pops" out into the mana pool
- **Pay cost** — mana symbols streak from pool back into the spell being cast
- **Damage numbers** — float up from creature in red, fade out
- **Life total change** — number rolls; red flash on damage, green flash on gain

### Priority B — players see every game (high-value)

- **Resolve spell** — slides off the stack with a fade; sparkle/glow on the target
- **Card to graveyard** — flip to back, dim, slide to graveyard pile
- **Death animation** — desaturate, fade, fall to graveyard pile
- **Hand hover** — hovered card lifts (translateY ~30px) + scale 1.05; neighbors slide aside
- **Targeting line** — animated dashed line from source to target while choosing
- **Target reticle** — appears on hover-eligible permanents
- **+1/+1 counter** — counter token bounces in; creature scales briefly

### Priority C — adds polish but lower frequency

- **Attacker tilt** — declared attackers rotate forward ~10°
- **Combat lunge** — attackers lunge toward defender on damage step
- **Trigger fires** — pulse ring radiates from source, then trigger appears on stack
- **Phase indicator slide** — phase changes animate
- **Spell-on-stack hover bob** — subtle idle animation

### Priority D — nice-to-have, last in the budget

- **Mulligan card flutter**
- **Game-end screen** — confetti / faded backdrop / etc.
- **Counterspell** — red X overlay + shake
- **Priority-pass ripple** — visual cue when priority shifts between players

**Allocation:** target Priority A + B for the Phase 5.1-5.4 polish budget. Defer C and D to Phase 5.7 or post-MVP.

---

## Pre-work to de-risk Phase 5

Three deliverables that should land in Phase 3-4 to make Phase 5 trivially startable:

1. **Synthetic GameView fixture library** — 12-15 hand-crafted JSON files of `WebGameView` representing distinctive states (turn 1, mid-combat, stacked triggers, mulligan, game-over, end-of-turn, modal spell on stack, etc.). Becomes the test fixture for both client rendering and server snapshot tests. Build during Phase 3 as the WebSocket DTOs land.
2. **Replay seed.** Xmage upstream has a replay format. If we can read replays into our `WebGameView` shape, we get an infinite supply of real game states to test rendering against. Probably 1-2 days during a Phase 3 sub-slice.
3. **Storybook (or equivalent) of game-state fixtures.** Renders every fixture in isolation. Becomes the visual-regression workbench for Phase 5.1. Optional but high-leverage.

---

## Performance budget — concrete targets

To pin down "60 fps as a hard requirement" so it's measurable:

- **First Contentful Paint** of the game window: ≤ 1.5 s on a cold cache
- **Sustained frame rate** during animation: ≥ 60 fps
- **Worst-case battlefield** (20+ permanents per side, multiple stacked triggers): ≥ 30 fps absolute floor
- **Memory** at game end: ≤ 250 MB working set
- **Bundle size** (game window route): ≤ 500 KB gzipped (excluding card images, which are external)

Profile during Phase 5.1 with synthetic worst-case fixtures. Surface regressions in CI via Lighthouse or equivalent.

---

## Honest scope reality

> MTGA was built by a team of dozens with multi-million-dollar budgets. A solo dev aiming for MTGA-grade polish on a personal fork is ambitious by definition.

What this means in practice:

- **Time estimates are likely understated.** 21-30 weeks is the optimistic case. Realistic budget: assume +25-50% if part-time, especially through 5.4 (combat) and 5.5 (triggers/modals) which are MTG-rules-deep.
- **Polish at 80% of MTGA in v1, 90%+ over the year following.** Iterative improvement is the model. Don't gate v1 on perfection.
- **Pick the high-frequency moments first.** Card draw, play, mana tap, damage numbers, hand hover — these five animations alone cover ~70% of the "feels like MTGA" sensation. Get them MTGA-grade before moving to anything else.
- **External tools are leverage.** Scryfall, Mana font, Framer Motion — using polished open-source tools is what makes solo MTGA-polish possible at all.
- **Cut features ruthlessly when they fight scope.** Spectator mode, replays, themes, light mode — Phase 6 or later. The MVP is "1v1 game window that feels great." Everything else is gravy.

---

## Validation plan

Phase 5's exit gate is **a complete 1v1 game vs AI playing from start to finish through the new client, with no graceful-failure modes.** Specifically:

- 5-minute screen capture of a representative game from mulligan to game-over
- All Priority-A animations visible
- 60 fps maintained
- No "oops, please use the Swing client for this" gaps
- One external playtester (not the developer) plays five games with no critical-blocker bug reports

If we can't reach this gate within ~30 weeks of Phase 5 start, the scope is wrong, not the architecture — narrow the feature set rather than extending the timeline indefinitely.

---

## References

- [PATH_C_PLAN.md](../PATH_C_PLAN.md) — Phase 5 in the broader project plan
- [ADR 0001 — Path C strategy](0001-path-c-strategy.md)
- [ADR 0002 — Tech stack](0002-tech-stack.md)
- [ADR 0003 — Embedding feasibility](0003-embedding-feasibility.md)
- [Framer Motion docs](https://www.framer.com/motion/)
- [Mana font (Andrew Gioia)](https://github.com/andrewgioia/mana)
- [Scryfall API](https://scryfall.com/docs/api)
