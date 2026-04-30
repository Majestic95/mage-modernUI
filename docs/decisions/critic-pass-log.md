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
