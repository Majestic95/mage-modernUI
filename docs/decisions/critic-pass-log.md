# Critic-pass log

Per-slice record of which specialist critics ran, which were skipped,
and why. The CLAUDE.md tier table tells you WHEN to skip; this log
records WHAT was actually skipped per slice so a future audit can
trace coverage gaps.

Format:

| Slice | Tier | Specialists run | Specialists skipped (rationale) | Critical findings caught |
|---|---|---|---|---|

If a slice's tier table cell says "Technical + UI + UX + Graphical"
but only Technical + UI ran, the row records UX + Graphical as
skipped with the reason. Empty "Specialists skipped" is the norm —
fill the column only when a deviation happened.

## Why this log exists

We adopted the tier-by-risk specialist matrix in commit `1908613b`
(CLAUDE.md cadence reform) after observing that slice 70-C's
mechanical ZoneCounter→ZoneIcon rename ran a full 3-specialist
pass for a low-risk slice. The tier system reduces over-application;
this log catches under-application — slices that should have run
more critics than they did.

It's also a forward-reference for new contributors: "did slice 70-X
get UX coverage?" is answerable by scanning one column.

---

## Active log

| Slice | Tier | Specialists run | Specialists skipped (rationale) | Critical findings caught |
|---|---|---|---|---|
| 70-A | Architectural | Technical, UI, UX | — | Token namespace circularity, accent-vs-active separation, react-refresh export rule |
| 70-B | Architectural (motion-only domain) | Technical, Graphical | UX (no user-facing affordance change — foundation slice), UI (motion-only, not visual surface) | Pseudo-element carve-out bug, Framer easing-string mismatch with token, card-targeted-pulse keyframe geometry |
| 70-C | Standard (rename + extend per ADR line 20) | Technical, UI, UX | — (ran full 3 — over-applied per cadence reform; documented as a tier-mismatch case) | Missing `key="priority"` in AnimatePresence, LifeCounter stale-state on interactive switch, ManaPool small→medium default |
| 70-D | Architectural (schema bump + structural component + cross-slice deps) | Technical (parallel-with-builder), UI, UX, Graphical | GUI (redundant with UX + UI per tier table — the structural-game-table-specific concerns are covered) | Multi-color halo painting full pod (mask-composite fix), Framer easing-string vs token cubic-bezier, dropped disconnected overlay (no wire signal) |
| 70-E | Architectural (structural-rewrite gate) | Technical (parallel-with-builder), UI, UX | Graphical (slice is structural / layout only — no new motion or animation surfaces; existing slice-70-B reduced-motion contract holds; visual-quality concerns surfaced via UI critic). GUI (covered by UX) | Tailwind grid-template-areas tokenizer bug (would not render at runtime), 2/3 dialog dock sites missed by replace_all |
| 70-F | Architectural (4 new components + drag-state lift + region extract) | Technical (post-builder; parallel-with-builder run hit a 529 and was re-dispatched), UI, UX | Graphical (`covered by UI` — converged 3-critic signal on particle-drift visibility + button order made Graphical redundant; SVG curve geometry on TargetingArrow had no motion-specific concerns) | MulliganModal premature unmount on local commit (no "waiting for opponents" affordance), particle-drift effectively invisible (alpha × opacity-40 wrapper below threshold), MTG button-order convention inverted, missing focus trap on full-mode modal, dead `keySalt` prop hiding a same-gameId/new-cycle persistence bug |
| 70-G | Standard (polish pass, 6 deferred items) | Technical, Graphical | UI (`covered by Graphical` — slice is motion + token tweaks + i18n robustness; UI-style concerns absorbed by Graphical's contrast/perception lane), UX (`no UI surface` — no new interactions; cmdr-dmg flash is per-click feedback already specced) | `isMulliganDialog` warn fires on every render (gameUpdate-storm spam — needed module-scope dedup latch), halo rotation on non-square element clipped corners through neighboring pod chrome (rotated background-angle CSS var instead of transform), mana-black FG actually 6.74:1 not the claimed 7:1 (darkened to clear AAA), flash overlay corner radius mismatch with wrapper |
| 72-A | Architectural (schema bump + race surface) | Technical, UX | UI (no UI surface — server-side wire shape only) | Validator-instance race in joinTable, deck-level partlyLegal rollup missing, sentinel synthetic flag |
| 72-B | Architectural (cross-stack feature) | Technical, UX, UI | Graphical (no new motion) | onImport silent regression, optgroup React key, Decks page format-picker stale-tail UX |
| 70-H | Architectural (schema bump + cross-stack disconnect detection; partial ship — timer + auto-pass deferred to 70-H.5) | Technical (parallel-with-builder), UI, UX | Graphical (`no new motion` — DISCONNECTED pill is a 250ms opacity fade only, no animation-quality concerns; existing slice-70-B reduced-motion contract handles essential-motion preserve via the data-essential-motion attribute) | Game-end timer leak risk (C1) + closeAllSockets cleanup (C2) caught early — both deferred to 70-H.5 alongside the timer they apply to; route-filtered socket count (C3 — handler-per-username conflates lobby + game sockets); CSS tokens reference 3 non-existent names retargeted to extant tokens; z.string→z.enum to lock literal set; pill copy "Disconnected — waiting for reconnect" sets correct expectation pending 70-H.5 auto-pass; pill repositioned top-right to keep life/mana/hand visible on opponents; defensive self-perspective short-circuit eliminates buffered-replay race (UX-C2/N3); CHANGELOG MUST-NOT clause for client-side dialog dismissal; aria-live region deferred to 70-H.5 |

---

| 70-K.1 | Standard (layout-fix slice; first slice run under the new critic checklist) | UI (per critic-checklist-redesign.md template) | none — single tier checklist run | CRITICAL: height: 100% chain broken by HoverCardDetail's inline-flex span with items-center cross-axis (cards would render 0×0 in real browsers despite jsdom tests passing). IMPORTANT: opponent pods didn't honor --card-size-small (carry-over from 70-K). IMPORTANT: bottom local pod renders portrait above rows; catalog §2.D says rows above portrait (carry-over from 70-K). All three fixed; the CRITICAL was caught only because the critic loaded the picture-catalog and traced the CSS chain manually — validation that the new process catches what the old one missed. |
| 70-M | Architectural (single morphing ActionButton + side-panel reorder + footer drop) | UI (per critic-checklist-redesign.md) | none | No CRITICAL findings. IMPORTANT-1: disabled state used fuchsia tokens carried over from legacy ActionPanel (caught via tokens.css comment about violet/fuchsia separation). IMPORTANT-2/3/4/5: label wording diverged from catalog §5.C ("Declare Attackers" → "Attack", "End Turn" → "End Step", menu item labels mismatched). IMPORTANT-6: F6 + Esc-when-menu-closed hotkeys uncovered by tests. IMPORTANT-7: menu backdrop z-40 tied with GameDialog z-40 producing inconsistent click-out. CARRY-OVER-1: side panel `bg-zinc-900/40` instead of catalog §5.0 `--color-bg-elevated` (slice 70-E carry-over invalidated by catalog 2026-04-29). All fixed pre-commit. |
| 70-P | Standard (mana pool relocation + ZoneIcon opponent variant + hand chrome cleanup; per critic-checklist-redesign.md) | UI/UX, Technical (parallel post-builder) | Graphical (`no new motion` — slice 70-P just relocates existing components; reduced-motion contract holds) | **2 CRITICAL fixes pre-commit:** (UI/UX-C1) local floating ManaPool didn't render the catalog §2.3 "Glow halo on each orb" — ManaPool now accepts `glow?: boolean` prop wired through to ManaOrb's box-shadow, MyHand passes `glow` for the floating mount; (UI/UX-C2) PlayerFrameInfoCluster sat as the third row of the flex-col under the name stack, violating catalog §2.2 "NOT attached to the portrait stack" — switched to `absolute top-full left-1/2 -translate-x-1/2 mt-1` so it floats adjacent to the frame rather than peer-stacked. **4 IMPORTANT fixes pre-commit:** (UI/UX-I1) floating mana pool collided with rightmost hand card at narrow viewports + 5-7 hand sizes — added `pr-[150px]` right-gutter on the fan container so cards never overlap the pool footprint; (UI/UX-I3) opponent ManaPool reused `size="medium"` despite catalog §2.3 "Visible but smaller" — ManaPool now accepts `size?: ManaOrbSize` prop, opponent cluster passes `size="small"`; (UI/UX-I4) native `title=` tooltip would have produced a 30+-line column for mid-late-game graveyards — capped at 10 cards with "... and N more" overflow suffix via new `buildOpponentTooltip` helper; (Tech adjacent) MyHand's floating ManaPool wrapper still mounted as a 1px shell when the pool was empty — gated the `<div data-testid="hand-mana-pool">` on a new `hasAnyMana(pool)` helper so an empty pool produces zero DOM. **2 NICE-TO-HAVE picked up:** (Tech-IMP-1) replaced the 6-field `opponentPoolNonEmpty` chain with `hasAnyMana(pool)` for schema-tied semantics; (Tech adjacent) added explicit test "opponent variant still emits cross-zone layoutId sinks (slice 55 contract preserved)" so a future refactor can't silently scope sinks to the self path. **Deferred to slice 70-Z polish:** (Tech-IMP-3) `h-52 pt-2` inline pixel sizing on the hand fan container should derive from `--card-size-large` token; (UI/UX-N2) zone chip glyphs (catalog §2.2 "🪦 or simple G glyph") not yet rendered as 16-20px square icons — current text labels are an acceptable v1; (UI/UX-N3) cluster max-width / flex-wrap guard for worst-case mana+zone densities. **Deferred for user clarification:** (UI/UX-CO1) catalog §2.5 lists "hand count" as removed from the legacy strip but never relocates it — the redesigned PlayerFrame doesn't surface `player.handCount` anywhere. Players normally need at-a-glance opponent hand size (strategic signal: "do they have a counterspell?"). Flagged for user decision: add a chip to the cluster, leave dropped, or surface elsewhere. `hasAnyMana` extracted to `manaPoolUtil.ts` to keep `ManaPool.tsx` react-refresh-clean (only-export-components rule). |
| 70-O | Architectural (header rewrite + 4-icon strip + SettingsModal + side-panel collapse + Concede/Leave relocation; per critic-checklist-redesign.md) | Technical, UI/UX (parallel post-builder) | Graphical (`no new motion` — header uses no animations beyond CSS hover transitions on icons; existing reduced-motion contract holds) | **3 CRITICAL fixes pre-commit:** (UI/UX-C1) layout/zoom collapse hid ActionButton entirely (the only visible primary-action surface for non-power users) — added a fixed bottom-right floating ActionButton dock that mounts mutually-exclusive with the side-panel mount when sidePanelCollapsed=true; (UI/UX-C2 / Tech-I-2) JSDoc claimed slowmo "relocated to dev-only corner" but code only removed it — dropped the misleading paragraph (removal alone matches catalog §1.4); (Tech-CRITICAL-1+2 / UI/UX-I5+CV2) empty `<header>` placeholder in GameTable.tsx had `border-b border-zinc-800` producing a stray rule directly under the redesigned header AND duplicate `data-testid="game-table-header"` collision with the actual GameHeader — gated the placeholder behind `!REDESIGN`, dropped the `header` row from the REDESIGN grid template (header now sibling-only, per catalog §1.1 "Header sits OUTSIDE the side panel"). **5 IMPORTANT fixes pre-commit:** (UI/UX-I1 / Tech-I-1) `py-2` (16px vertical) + `h-7 w-7` icon button + 18px SVG produced a ~44px header strip vs catalog §1.1's "~36px tall, --space-3 vertical padding" — switched to `py-3` (12px) + `h-6 w-6` button + 16px SVG; (UI/UX-I3) Concede red + Leave grey at peer height misrepresented their semantic asymmetry (Concede irreversible, Leave recoverable) — demoted Leave to a small grey link below Concede; (UI/UX-I4) SettingsModal mixed `border-zinc-700` with token classes — unified on `border-zinc-800` matching the rest of the redesign; (UI/UX-I6) "GAME" lobby-name fallback flashed during Waiting (gameView=null) — RedesignedHeader passes empty string instead so the strip renders blank until first gameView; (Tech-I-7) defensive empty-players guard added to `synthesizeLobbyName` (was emitting nonsensical "0 PLAYER FREE-FOR-ALL"). **NICE-TO-HAVE picked up:** (UI/UX-N2) chat icon now visibly disabled (opacity-50 + cursor-not-allowed) until slice 70-R lights up the slide-out — was a "feels broken" footgun; (Tech-N-5) autoFocus Cancel after concede confirm reveal so keyboard users land on the safer button. **Deferred to 70-Z polish:** (UI/UX-N1) layout-icon arrow direction convention (current-state vs future-state); (UI/UX-N3) fullscreen icon corner-bracket geometry reads weakly at 16px; (UI/UX-N4) close `×` glyph could be an SVG; (UI/UX-CV3+CV4) hand-region `border-t border-zinc-800` and side-panel `border-l border-zinc-800` carry-overs from earlier slices; (Tech-I-3) dead `gameId/connection/closeReason` props on REDESIGN path; (Tech-N-3) test gap for fullscreen exit branch. ActionButton.tsx Concede menu item + dead `requiresConfirmation` machinery + inlined ConfirmConcedeModal subcomponent removed in lockstep — Concede now lives ONLY in SettingsModal per catalog §1.3, single canonical destructive-action surface. |
| 70-N | Architectural (StackZone focal-zone rewrite + combat-mode arrows; per critic-checklist-redesign.md) | Technical, UI, Graphical (parallel post-builder) | UX (`covered by UI` — no new interaction surface; focal card inherits HoverCardDetail click target, arrows are aria-hidden, mode transitions are automatic from gameView state) | **7 CRITICAL fixes pre-commit:** (UI-C1 / Graph-IMP-5) fan tiles used `CardFace size="stack"` 60×84 carry-over from slice 50, ~3× too small per catalog §3.1's "85% of focal" — refactored FanCard to `size="focal"` + scale transform; (UI-C2 / Graph-IMP-2) multicolor halo used flat gold instead of catalog §3.1 "alternating bands" — switched to `computeHaloBackground` conic-gradient + `animate-halo-rotate` matching PlayerPortrait halos; (UI-C3) `layoutId` collision risk between FanCard and FocalCard during stack resolution (two copies of same card collapsed into one Framer slot) — namespaced fan layoutIds as `stack-fan-${cardId}`; (Graph-CRIT-3) fan tiles rendered at section's top-left instead of centered behind focal — added `top-1/2 left-1/2` + transform-translate centering; (Tech-CRIT-1) `computeStackGlowColor` regex fell through to non-glow `--color-team-neutral` for unknown codes — added explicit fallback (resolved by switch to `computeHaloBackground` which routes through halo.ts's typed default); (Tech-CRIT-2) `combat` array unmemoized churned listener stack on every gameUpdate frame — added `useCombatFingerprint` memo + `cancelled` flag in cleanup; (Tech-CRIT-3) global capture-phase scroll listener fired on game-log auto-scroll during combat — switched to passive non-capture scroll. **4 IMPORTANT fixes pre-commit:** (UI-N1) overflow pill at `-top-2 -right-2` competed with focal mana cost overlay — moved to `-top-2 -left-2`; (UI-I2 / Graph-IMP-1) halo box-shadow used 8px spread producing hard ring — dropped spread, kept blur for "soft halo" anchor; (Graph-IMP-5 / Tech-IMP-2) FAN_CAP=5 → 4 since 5th tile at 25% scale was illegible smear; (Tech-IMP-4) defender arrow targeted pod center instead of catalog §3.2 "portrait" — added `data-portrait-target-player-id` to PlayerPortrait, made `rectForPlayer` prefer portrait selector with pod fallback. **Deferred / catalog-clarification needed:** all three critics flagged `--card-size-focal: 170px` token vs catalog §3.1 "~150% of medium = ~125×175" math (170 = ~210% of medium) — token shipped in slice 70-I; defer to user spec-clarification before retuning either side. Combat-arrow color reuses `--color-targeting-arrow` (Graph-IMP-4 / catalog §3.2 silent on color) — defer to 70-Z polish + catalog amendment. Stack-glow-pulse trough opacity 0.55→0.65 polish (Graph-CARRY-2) deferred to 70-Z. MotionConfig reducedMotion verification (Graph-CRIT-1) is a separate concern outside this slice's surface. |

---

## Process amendment 2026-04-30 — picture-catalog as load-bearing critic reference

After slice 70-K shipped with the row-stretch carry-over bug
(picture-catalog §2.1 specs "rows fixed, cards shrink"; the
implementation kept slice-53's `flex-wrap`), the user flagged
that critics were not consistently referencing the canonical
visual spec.

**Standing requirement going forward:** every critic dispatched
on a redesign-push slice (70-I → 70-Z + any future visual work)
loads `docs/design/picture-catalog.md` and reviews per the
template at `docs/decisions/critic-checklist-redesign.md`.
Critic reports that don't cite catalog clauses get re-dispatched.

This applies retroactively to slice 70-K.1 (the row-stretch fix
slice that landed concurrent with this amendment) and forward.

The slice plan's "Definition of done" (slice-plan-redesign-2026-04-29.md)
was updated to make this checkpoint the second item — directly
after "implementation matches catalog" — to surface it during
sign-off review.
| 70-H.5 | Architectural (per-prompt timer state machine + cross-handler broadcast + auto-pass engine integration; closes 70-H deferral) | Technical (slice-70-H critic findings carried forward as the requirements list — no fresh dispatch) | UI (`no UI surface` — server-side timer + a single sr-only aria-live region; visual treatments unchanged from 70-H), UX (`covered by Technical` — the slice-70-H UX critic already prescribed the timer behavior + dialogClear broadcast + aria-live region; 70-H.5 implements the prescription rather than re-evaluating it), Graphical (`no motion`) | Single-flight CAS via AtomicReference&lt;ScheduledFuture&gt; per (gameId, playerId) eliminates register-while-firing race (per critic I5 carried forward); shared `disconnectTimerScheduler` at AuthService level (one daemon thread, predictable shutdown per critic N11); cleanup on closeAllSockets + every prompt-close frame (closes critic C2); `XMAGE_DISCONNECT_TIMEOUT_SEC` env clamps to [30, 180] with WARN-on-fallback (per critic N10 soft-fail); `nextSyntheticMessageId` ensures synthesized dialogClear sits AFTER buffered frames so reconnect-replay catches it; `useConnectionStateAnnouncements` uses the SideboardModal "adjust state during render" pattern to avoid `react-hooks/set-state-in-effect`; per-method auto-pass dispatch (gameAsk→false, gameTarget→null, gameSelectAmount→0, etc.) via existing MageServerImpl.sendPlayerXxx — fire-and-forget with try/catch around MageException so an unresolvable prompt doesn't crash the timer thread |

---

## Skip-rationale categories

Use one of these short tags in the rationale column to keep the log scannable:

- **`no UI surface`** — slice is server-side or pure logic; UI critic has nothing to assess
- **`no motion`** — slice ships no new animations / transitions; Graphical has nothing to assess
- **`covered by X`** — another specialist's coverage absorbs this angle (e.g. GUI usually covered by UX + UI on game-table slices)
- **`foundation slice`** — slice ships infrastructure consumers will use later; UX angle deferred to consumer slice
- **`spec-locked`** — visual / interaction decisions are pre-decided in a design doc; specialist would have nothing new to flag
- **`over-applied`** — full panel ran when tier table says fewer would have sufficed (record but don't repeat)

---

## How to use this log

**Before starting a slice:** check the tier table in CLAUDE.md and pick the matrix. Note any deferrals here BEFORE the build starts so the rationale is captured at decision time, not retrofitted.

**At commit time:** add the row to "Active log" above. The "Critical findings caught" column is the value-added evidence — empty rows are a signal that the slice may not have needed those critics at all.

**During audits:** scan the "Specialists skipped" column for clusters. If the same specialist gets skipped 5+ slices in a row, the tier table may be wrong (or the slices are all genuinely outside that specialist's domain).

---

## Open questions (for future reference)

- **Should the Graphical specialist always run for slices that touch Framer / CSS animations, even if the slice is primarily structural?** Slice 70-E skipped Graphical and shipped a Tailwind grid-template-areas tokenizer bug; would Graphical have caught it? (Probably no — that's a UI/build-time concern. The skip was correct.)
- **Is "GUI" ever non-redundant with "UX + UI"?** ADR 0011 line 195 says yes for structural rewrites; cadence-reform tier table says "redundant with UX + UI" and drops it. Slice 70-D + 70-E both skipped GUI without missing anything. Worth confirming or flipping the convention after 3 more architectural-tier slices.
