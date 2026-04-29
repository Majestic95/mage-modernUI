# 0010 — Multiplayer architecture (v2)

- **Status:** Accepted
- **Date:** 2026-04-29
- **Supersedes:** 0010 v1 (same date — initial 5-decision draft, replaced after 4-specialist + synthesis critique)
- **Deciders:** Austin
- **Builds on:** [ADR 0005](0005-game-window-architecture.md), [ADR 0007](0007-game-stream-protocol.md), [ADR 0008](0008-player-interactions.md)
- **Scope:** v2 multiplayer surface — FFA (3-4 players), Two-Headed Giant (2v2), spectators. Draft / tournament / replay remain Phase 6+ as per ADR 0005.

---

## Context

v1.1 ships a stable 1v1 vs AI loop. v2 opens the game window to N players. Slice 68 v1 of this ADR was a 5-decision document; a 4-specialist critique (Reviewers A: MTG rules, B: WebSocket protocol, C: UX/design philosophy, D: test strategy + observability) plus a Synthesis pass found 2 BLOCKERs, 1 a11y BLOCKER, 12 NOTABLEs, and 8 items the v1 ADR missed entirely. This v2 ADR consolidates all findings into a single coherent reference per Synthesis Option C.

Most of v1's "PlayerArea / PhaseTimeline / targeting are already N-player ready" framing holds — `Battlefield.tsx:24-31, 212-225` already iterates `gv.players` per-player; `targets: z.array(z.string())` (`webclient/src/api/schemas.ts:478`) is set-semantics; the dialog dispatcher covers all multiplayer card mechanics via existing envelopes. What v1 missed: server-side filtering for `RangeOfInfluence`, eliminated-player UI, the `processWatchedHands` self-spectate leak, frame-ordering correlation, design tokens, observability minimums, and a11y beyond color-blind. v2 covers all of it without expanding past the multiplayer scope (replay, tokens-everywhere, draft remain deferred).

Slice 69 is the multiplayer-enable slice (5+ files including the new server-side filter); slice 71 lands spectator route + observability; slice 68b owns reconnect/resume.

---

## Decisions

### D1. Range-of-influence — server-side filtering, not client-render

**Decision.** When a player is in `RangeOfInfluence.ONE` or `RangeOfInfluence.TWO`, the server filters `WebGameView.players` per-recipient at `GameView` construction time. The webclient renders only what it receives. `RangeOfInfluence.ALL` (FFA default) emits the full roster unchanged.

**Rationale.** v1 ADR's "do nothing — render only visible players" was wrong: `gv.players` is currently NOT range-filtered (`Mage.Common/src/main/java/mage/view/GameView.java:72-90` iterates `state.getPlayers().values()` regardless of range), so a `RangeOfInfluence.ONE` table would leak hidden information about out-of-range opponents to all players (CR 801.7 violation). Reviewer A flagged this as a BLOCKER for any RoI ≠ ALL format. Filtering at the wire, not the client, is the only correct fix.

**Consequences.**
- Slice 69 adds a per-recipient filter pass in `CardViewMapper`/`GameViewMapper` that drops out-of-range players from the players array.
- When target dialog opens with `eligibleIds.size === 0` (caller has no in-range targets), webclient renders an inline `"No legal in-range targets"` chip — silent empty state is a UX hole.
- Forward-compat: when `RangeOfInfluence.ONE` table users want to see eliminated/out-of-range life totals, add `WebPlayerView.isInRange: boolean` (v3+, schema 1.21+).
- 2HG uses `RangeOfInfluence.ALL` per upstream convention — no impact.

### D2. Hidden information — strict per-recipient construction

**Decision.** Spectators receive the **intersection** of all seated players' visibility (no peek), constructed via `new GameView(state, game, /*createdForPlayerId=*/ null, /*watcherUserId=*/ null)`. This excludes:
- Hand contents (`handCount` only)
- Library order (count only)
- Face-down / morph / manifest / disguise faces for non-controllers
- `gameInformPersonal` payloads (per-player private reveals)

For any seated player who is also subscribed via the spectator route on **the same gameId** (R6), `processWatchedHands` (`Mage.Server/src/main/java/mage/server/game/GameSessionWatcher.java:101-111`) MUST exclude their own seat from `watchedHands` projection — otherwise the spectator-of-self path leaks their own hand from a perspective other clients can't reproduce.

Spectators receive **PULSE frames** for `gameInformPersonal` events: `{playerId, status: 'pending' | 'resolved'}` with no payload — the spectator UI shows a "Player X is choosing…" spinner without revealing the choice content.

**Rationale.** Reviewer C found that v1 ADR's "neutral world view" left spectators with zero feedback during private decisions ("watching paint dry"). Reviewer B found the `processWatchedHands` self-leak path. Reviewer A confirmed `cardId` stability across face-down/exile is a side-channel for retroactive identity inference (deferred to v3 — distinct subsystem).

**Consequences.**
- Slice 71 mapper builds spectator `GameView` with both nullable args — confirmed valid via `Mage.Common/src/main/java/mage/view/GameView.java:72`.
- Slice 71 adds a `gameInformPulse` wire envelope (schema 1.20). Distinct method from `gameInformPersonal` so player clients ignore it cleanly.
- Snapshot-test (Test 3 in Test Contracts): assert `myHand=={}`, every `WebPlayerView.controlled==false`, every `handCount>0`, no card data leaks via `graveyard`/`exile`/`sideboard` projections.
- Worked example: Player A casts Brainstorm — spectator sees the Brainstorm spell on the stack (public), receives a `gameInformPulse{playerId: A, status: pending}` for the 3-card draw, then `{status: resolved}`. Spectator never sees what 3 cards were revealed or which 2 went back.
- v3-deferred known leaks: `cardId` retroactive-inference for face-down cards (Reviewer A6); buddy-spectate explicit hand-share (`USER_REQUEST_DIALOG`, ADR 0008 §1.20).

### D3. 2HG team UI — three sub-rules

**Decision.**
- **(a) Shared life total** rendered at team-frame level with **color + shape badge + numeric team label**. Never color-only. Team A = `--team-ring-a` color + shield icon + "Team 1" label; Team B = `--team-ring-b` color + crest icon + "Team 2" label. Per-PlayerArea `WebPlayerView.life` chip stays for redundancy (will equal team total by upstream's life-share semantics).
- **(b) Monarch crown chip** lives on the **individual** PlayerArea, not the team frame. Per `Mage/src/main/java/mage/game/GameImpl.java:4125-4143`, monarch is per-player-UUID even in 2HG. Same for Initiative.
- **(c) Goad badge** required on goaded permanents — small arrow icon + tooltip "Must attack a player who isn't <controller>". Single-color is fine (semantic = "attack obligation"), no a11y requirement beyond tooltip.

**Rationale.**
- (a) is a hard a11y requirement: ADR 0005 D10 commits to "no information conveyed by color alone" (deuteranopia/protanopia). Reviewer C flagged v1's "blue ring / red ring" as a self-violation of the parent ADR.
- (b) corrects v1 ADR D3's wireframe — Reviewer A read `GameImpl.java` and confirmed monarch is per-player. Putting the crown on the team header chip would silently misrepresent state.
- (c) closes Reviewer A's goad-badge gap. Without it, players in 4-player FFA receive "must attack" errors mid-combat with no UI explanation.

**Consequences.**
- New schema field: `WebPlayerView.teamId: string | null` (UUID). 1v1 maps to all-null; non-2HG multiplayer maps to all-null (each player a "team of one" is not modeled — null is the no-team sentinel). **Mapper read path is unsettled.** Engine has `Team.getId()` (`Mage/src/main/java/mage/game/Team.java:25-27`) but NO `Game.getTeam(playerId)` accessor and NO `Team.getPlayers()` getter (private field). Mapper options: (1) compute teamId from `MatchType.getPlayersPerTeam()` + player seat-index (2HG: seats 0,1 → team A; seats 2,3 → team B) — no upstream change, lives entirely in WebApi; (2) add upstream `Team.getPlayers()` accessor + a teams-collection accessor on Game — small upstream patch on the personal fork. **Slice 69 picks (1) unless seat-order assumption breaks for sit-anywhere or future async-team formats.** R1 expanded to track this.
- New schema field: `WebPermanentView.goadingPlayerIds: string[]` (UUIDs of players who have goaded this permanent). Empty array = not goaded.
- Battlefield restructure: when any player has non-null `teamId`, group by team for layout (D5); render team-frame above/around the paired PlayerAreas with the shared-life chip. Otherwise fall through to FFA layout.
- R1: verify upstream's life-share semantics surface via `Player.life` (read by mapper) vs require a separate `Team.getLifeTotal()` accessor. Snapshot-test 2HG fixture: lifegain on Player 1 → both teammates' `life` field updates equally.
- Verified during ADR drafting: there is **no** `TwoHeadedGiantType` class upstream (glob `Mage*\**\TwoHeadedGiant*` returns no files). 2HG is implemented via match config + `Team` grouping (`Mage/src/main/java/mage/game/Team.java:14-32`).

### D4. Spectator route — separate WebSocket endpoint with full contract

**Decision.** Spectators connect to **`/api/games/{gameId}/spectate`**, a distinct route from the player `/api/games/{gameId}/stream`. Specific contract:

- **Membership gate:** registered-spectator allow-list maintained by `LobbyService`. Allow-list entries created on `LobbyService.registerSpectator(gameId, userId)`, removed on game-end or on socket close.
- **Same-gameId player-or-spectator XOR:** if a user is currently a seated player on gameId X, opening `/api/games/X/spectate` is rejected with close 4003 + reason `ALREADY_SEATED_NO_SELF_SPECTATE`. Cross-game (player on X, spectator on Y) is permitted. **An eliminated player is no longer in `userPlayerMap` per the slice-63 gate logic, so they pass the XOR — they route to spectator cleanly per D11(c).**
- **Read-only scope:** inbound `playerAction` and `playerResponse` envelopes are rejected with a `streamError` frame `{code: "SPECTATOR_RO", message: "spectators cannot send playerAction"}` and the **socket stays open**. Repeated violations within a session (3+) → close 1008. v1 ADR's "frame-then-close on first offense" was bad UX (misbehaving client reconnect-storms).
- **`chatSend`:** v2 ships **read-only** — spectators receive game-chat frames but cannot send. Send-disabled at handler level. v3 may add a separate spectator-chat room.
- **Outbound envelope:** identical shape to player route, constructed from `GameView` per D2.
- **`WATCHGAME` callback** (ADR 0008 §1.17) routes via new per-WsContext attribute `ATTR_ROUTE_KIND` (values: `'player'` | `'spectator'`). `WebSocketCallbackHandler.mapToFrame` checks this when adding the `case WATCHGAME:` arm.

**Rationale.**
- The slice-63 game-membership gate (`Mage.Server.WebApi/src/main/java/mage/webapi/ws/GameStreamHandler.java:144-171`) explicitly anticipates this: "When spectator mode lands, this gate extends with a spectator-allow-list." A separate route is cleaner than tangling two access policies onto one handler.
- Same-gameId XOR closes the `processWatchedHands` self-leak path (R6).
- `chatSend` write-disabled is a v2 simplification; trolls in spectator chat is a real concern (Reviewer B). Send-enabled becomes a v3 decision after observing v2 spectator behavior.
- `WATCHGAME` route filtering needs the new attribute; without it, callbacks would broadcast to all sockets on a per-user handler regardless of their route. Mirrors the `ATTR_BOUND_CHAT_ID` pattern.

**Consequences.**
- Slice 71 owns: route registration + `LobbyService.registerSpectator/unregister` + `ATTR_ROUTE_KIND` plumbing + spectator-chat-write-disabled + 3-strikes-then-1008 contract.
- Allow-list semantics: v2 ships wide-open (any authenticated user when `MatchOptions.spectatorsAllowed=true` registers themselves on connect). v3 may tighten to per-game invitation.
- Slice 69 (multiplayer enable) does NOT ship spectate. Spectate is additive in slice 71.
- R5: reconnect-after-elimination routes to spectator path automatically — see D11.

### D5. Layout density — CSS Grid responsive + active-player glow + a11y

**Decision.** Opponents-row layout adapts to opponent count via CSS Grid + Tailwind utility at the `Battlefield.tsx` orchestrator level:

| Opponents | Layout | Tailwind |
|---|---|---|
| 1 | Vertical (current) | `space-y-4` |
| 2 | 2-col grid | `grid grid-cols-2 gap-4` |
| 3 (FFA 4p) | 3-col grid | `grid grid-cols-3 gap-4` |
| 2HG | Team-grouped paired columns | `grid grid-cols-2 gap-4` for opp row + ally cell separate |

Additional hierarchy:
- **Active-player** gets a glow ring on the PlayerArea outer container, driven by `--active-glow` CSS token (D7). 1.0 → 0.6 alpha pulse, 1.5s.
- **Priority-holder** gets a stronger glow via `--priority-glow`. Active+Priority can stack (most common case in 1v1 anyway).
- The text-pill ACTIVE / PRIORITY indicators stay as redundant a11y labels (paired with the glow per D9 redundant-encoding rule).
- **`aria-live="polite"` region** announces priority transitions: "Priority: <player>, <phase>". Lives at the Battlefield root. Closes Reviewer C / synthesis miss #2.
- **Tab order** in 4-player target picker: clockwise from your seat (you → opp-right → opp-top → opp-left → battlefield → stack). Document via explicit `tabIndex` if browser default insufficient. Closes synthesis miss #3.

**Rationale.** Reviewer C confirmed v1's text-pill ACTIVE / PRIORITY fails at FFA densities. CSS Grid handles N=2..4 declaratively. Asymmetric `grid-template-areas` (12-o'clock / 9 / 3 layout for table-feel) is queued for v3 — the equal-width 3-col is acceptable v2.

**Consequences.**
- Slice 69's 5-file enable list includes `Battlefield.tsx` (~10 LOC).
- PlayerArea unchanged.
- Stack zone position unchanged (between rows).
- `--active-glow` and `--priority-glow` defined in D7's token file.
- ARIA-live region added to Battlefield orchestrator. Tab-order may need explicit `tabIndex` declarations on PlayerArea components.
- Hexagonal/circular layout REJECTED — Phase 7 trap, breaks Framer Motion `<motion.div layout>` axis-aligned bbox assumption.

### D6. Frame ordering & ID semantics

**Decision.** Each outbound frame carries `{messageId: monotonic-uint64-per-recipient, gameId, route: 'player' | 'spectator'}`. The `messageId` is per-recipient (per-WebSession), monotonic, matches the existing slice-3 contract — NO new game-scoped global counter. `synchronized updateGame()` (`Mage.Server/src/main/java/mage/server/game/GameController.java:820-827`) preserves cross-recipient fan-out order; `messageId` makes per-recipient ordering auditable for reconnect.

Frame buffering is **per-handler** (per-WebSession). v2 keeps the slice-3 64-frame ring. A user observing 2 games + 1 spectate stream shares one buffer with frames interleaved — pre-existing limitation, surfaced by spectate but not introduced by it. Slice 68b (reconnect/resume) decides whether to partition by gameId or extend buffer size.

**Buffer overflow policy:** when the 64-frame ring fills, drop **oldest non-state frames** (chat, pulse, informational), preserve all `gameStateUpdate` / `gameAsk` / `gameTarget` / dialog frames. Log WARN with `{gameId, userId, droppedKind}`.

**Rationale.** Reviewer B traced upstream: `Session.java:68,437` allocates `messageId` per-`Session`, not per-game; each player has their own `GameSessionPlayer` and its own `AtomicInteger`. There is no game-global frame id. v1 ADR's "Already resolved: gv.players ordering preserved" addressed player-array ordering, not frame ordering — Reviewer B correctly flagged the conflation. The honest answer: per-recipient ordering is what we have; cross-recipient correlation is unnecessary for v2 (no consumer needs it). Adding a game-scoped counter is forward-compat for replay tooling but not required now.

**Consequences.**
- v2 ships unchanged ordering semantics.
- Slice 68b reconnect contract uses `?since=<messageId>` against the per-recipient buffer (existing slice-3 behavior).
- Frame deduplication via `messageId` works for one user across two routes (player + spectator on different games) because they share one handler with one ID space. Does NOT work for cross-user comparison — that's by construction.
- v3+ may add `frameSeq: uint64` per-game scoped — useful for canonical-replay tooling. Out of v2 scope.

### D7. Design tokens — scoped wedge

**Decision.** Introduce `webclient/src/styles/tokens.css` scoped to **the surfaces v2 multiplayer touches**. No big-bang refactor of `webclient/src/index.css`.

```css
:root {
  --team-ring-a: #4a90e2;       /* blue, paired with shield badge */
  --team-ring-b: #d04a4a;       /* red, paired with crest badge */
  --team-ring-c: #4ad04a;       /* future 3-team formats */
  --team-ring-d: #d0c04a;       /* future 4-team formats */
  --active-glow: rgba(168, 85, 247, 0.6);    /* fuchsia-500 @ 60% */
  --priority-glow: rgba(245, 158, 11, 0.7);  /* amber-500 @ 70% */
  --targetable-accent: rgba(168, 85, 247, 0.4);
  --focus-ring: rgba(168, 85, 247, 0.9);
  --badge-fill-goad: rgba(245, 158, 11, 0.85);
  --badge-fill-monarch: rgba(234, 179, 8, 0.9);
  --badge-fill-initiative: rgba(99, 102, 241, 0.9);
}
```

Tokens drive **semantic** colors only (status, team, mana identity). Tailwind utilities continue to drive layout + structural surfaces. No literal hex / Tailwind-color-class is allowed for newly-added semantic surfaces; existing literals stay (no rip-and-replace).

**Rationale.** Reviewer C: "exact moment to start tokenization is now — team rings are the wedge. Otherwise we're doubling down on 'literal colors everywhere' right when multiplayer doubles the surface area that needs theming." The full migration of `index.css` is a separate Phase 7 ADR; this is a wedge.

**Consequences.**
- New file `webclient/src/styles/tokens.css` imported once at the App root (after Tailwind base).
- Slice 69 D3 implementation uses tokens (not literal colors) — locked at first use.
- Slice 73-77 polish slices (combat lunge, targeting line, etc.) gain access to the same token surface.
- Phase 7 light theme: tokens become the override surface.
- 4 team slots reserved (`--team-ring-a` through `-d`) for future 3HG/Star/grand-melee formats.

### D8. Sit-anywhere & layout invariants

**Decision.**
- **Sit-anywhere camera:** the local player (`gv.myPlayerId`) ALWAYS renders at the bottom of the layout (6 o'clock). Server seat order does NOT drive client placement.
- **Spectator perspective:** spectators see seat 0 by default, with a **perspective-rotation toggle** in the spectator banner. Rotation is purely client-side (`myPlayerId` shimmed through the seats); no server change.
- **HoverCardDetail invariant:** every PlayerArea cell emits identical hover events; the popover is opponent-index-agnostic. No special-casing for "self vs opponent N".

**Rationale.** Reviewer C noted v1 implicitly does sit-anywhere via `Battlefield.tsx:24-31`'s self/opponents partition, but doesn't lock it as a stated principle. A future contributor could "fix" the asymmetry. Lock it now.

**Consequences.**
- Slice 71 spectator UI adds a top-banner "SPECTATING — [Player A] vs [Player B]" with perspective-rotation toggle. ~50 LOC.
- Test: render 4-player game from each player's perspective, assert their `myPlayerId` always renders at the bottom.

### D9. Information density philosophy

**Decision.** xmage's webclient targets **MTGA-grade minimalism with at-a-glance state surfacing**. Operative rules:

1. **Information density is per-format, not global.** 1v1 affords detail; 4-player FFA affords glance. Game-state-relevant information is always *findable* — never removed, only collapsed behind hover/expand.
2. **Redundant encoding for status.** Color always rides on shape, label, or position (ADR 0005 D10). Active-player, priority-holder, turn-phase use redundant encoding (glow + label + position).
3. **Decorative chrome scales down before informational chrome.** Frames thin before badges shrink.
4. **Spectator UI is not a stripped player UI.** It's a distinct mode with persistent banner, perspective toggle, and pulse frames during hidden engine work.
5. **Animation scales with frequency, not importance.** High-frequency events (draw, play, tap, target, life-change) get animated transitions. Low-frequency events (game-over, mulligan) get larger static moments.

When in doubt, prefer one more pixel of game state over one more pixel of brand.

**Rationale.** Reviewer C explicitly flagged v1 ADR for not stating the design philosophy that the user requested. "Modern, slick, cohesive" is meaningless without a stated bar.

**Consequences.**
- Slice 73-77 polish slices reference D9 in their builder briefs.
- Future ADRs (Phase 7 themes, mobile/responsive) inherit D9 as the philosophical constraint.

### D10. Observability minimums

**Decision.** Server exposes `GET /api/admin/metrics` (Bearer-auth-gated, admin-only) returning Prometheus-text-format gauges:

- `xmage_active_games` (gauge)
- `xmage_total_spectators` (gauge)
- `xmage_frames_egressed_total{route="player"|"spectator",game_id="..."}` (counter)
- `xmage_frames_per_second` (gauge, 10s rolling)
- `xmage_buffer_overflow_drops_total{route}` (counter)
- `xmage_out_of_order_frames_total` (counter — client-attested via reconnect mismatch)
- `xmage_long_priority_window_p99_ms` (histogram bucketed at 5/10/30/60/120s)
- `xmage_team_life_divergence_alarm{game_id}` (gauge 0/1, set when 2HG teammates' `life` fields disagree)
- `xmage_dialog_clears_emitted_total` (counter, per R4)

Server logs WARN on:
- Buffer overflow (any frame dropped)
- Out-of-order frame received
- 2HG team-life divergence

**Rationale.** Reviewers B + D + C+SE-audit all flagged the lack of observability infrastructure as a v2-prerequisite. Without it, ops at multiplayer scale is blind. Prometheus text-format is universal; basic-auth gating reuses the existing admin token.

**Consequences.**
- Slice 71 (spectator route) and slice 70 (server resource scaling) both depend on this — implement first or jointly.
- `WebApiServer.java` adds the `/api/admin/metrics` route + a thin metrics aggregator (Micrometer or hand-rolled).
- Admin token check uses existing slice-64 `XMAGE_ADMIN_PASSWORD` infrastructure.

### D11. Eliminated player semantics + dialog reconciliation

**Decision.** When `WebPlayerView.hasLeft = true`:

- **(a) Battlefield filter:** `webclient/src/game/Battlefield.tsx:212-225` opponent loop adds `&& !p.hasLeft` predicate. Eliminated player's PlayerArea collapses to a thin "ELIMINATED" overlay stub: name + status + remaining chat history. No active glow, no priority pill.
- **(b) Dialog reconciliation:** any open dialog (vote loop, target prompt, cost decision) targeting the leaver dismisses via a new `dialogClear{playerId, reason: 'PLAYER_LEFT'}` wire frame. Vote loops in `VoteHandler.doVotes` skip the leaver server-side (engine already does, per Reviewer A1 evidence at `VoteHandler.java:33-39`); the new frame announces this to all clients so stuck modals close. If the engine then re-prompts a different player after skip (e.g., choose-new-target), that arrives as a fresh `gameAsk` envelope — the client does NOT chain off `dialogClear`. `dialogClear` is a fire-and-forget UI-teardown signal, not a transition trigger.
- **(c) Reconnect-after-elimination:** user reconnects to a game where they were eliminated. Server routes them to the **spectator path** with seat = their old seat for camera. Auth check: original session UUID. Closes R5.
- **(d) Throttle:** `dialogClear` frames are rate-limited per game (max 5/sec) to prevent client UI thrash on cascading concession (one player concedes triggers another's elimination via state-based actions).
- **(e) Simultaneous-action prompts** (e.g., 2HG declare-attackers with shared turn): if one player disconnects mid-prompt and the other has already submitted, server holds for full reconnect-timeout (60s default), then auto-passes the disconnected player and emits `dialogClear`.

**Rationale.** Reviewer A flagged eliminated-player as a BLOCKER for slice 69's FFA exit gate. Reviewer A also flagged concession-mid-vote as a stuck-modal hazard. Synthesis miss #1 surfaced the multi-player disconnect reconciliation. Synthesis miss #6 surfaced simultaneous-action prompts. Synthesis miss #8 surfaced the throttle need.

**Consequences.**
- Slice 69 implements (a) `!hasLeft` filter — 1-line change. BLOCKER for FFA exit gate.
- Slice 69 implements (b) `dialogClear` wire frame + server emission on `playerLeft` event.
- Slice 71 implements (c) reconnect-after-elimination → spectator path routing.
- Slice 70 implements (d) `dialogClear` rate-limit + (e) simultaneous-action timeout.
- Schema 1.20: new `dialogClear` method, new `WebPlayerView.hasLeft` already exists per `webclient/src/api/schemas.ts:406`.

### D12. Protocol versioning & client-server negotiation

**Decision.** WS upgrade includes a `protocolVersion` field in the handshake. Server compares to its `SUPPORTED_PROTOCOL_VERSIONS` set; mismatched clients receive close 4400 + reason `PROTOCOL_VERSION_UNSUPPORTED` + JSON body listing supported versions.

**Rationale.** Synthesis miss #7: D6 introduces frame-shape changes but no negotiation handshake. v2→v3 migration with mixed clients (old client connects to new server) silently breaks. Pin the contract now.

**Consequences.**
- Slice 69 adds `protocolVersion` to `WebStreamHello` envelope. v2 = `2`; v1 servers default to `1`.
- Webclient sends `?protocolVersion=2` in upgrade query string.
- Forward-compat: v3 server accepts v2 + v3 clients during transition window.

### D13. Accessibility — keyboard nav + screen reader

**Decision.**
- **`aria-live="polite"` region** at the Battlefield root announces priority transitions: "Priority: <player>, <phase>". Already in D5 — restated here as standalone a11y decision.
- **Focus order in 4-player target picker:** clockwise from your seat (you → opp-right → opp-top → opp-left → battlefield → stack). Implemented via explicit `tabIndex` declarations on PlayerArea wrappers.
- **All custom controls** (PlayerArea, BattlefieldTile, dialog buttons) expose `aria-label` with semantic role + state. E.g., a tapped Llanowar Elves: `aria-label="Llanowar Elves, creature, tapped, controlled by you"`.
- **Spectator perspective rotation** (D8) is keyboard-accessible via Left/Right arrow keys when banner has focus.

**Rationale.** Synthesis miss #2 + #3 — Reviewer C addressed color-blind via D3+D7 but not full a11y. Priority handoff at 4-player with no ARIA-live is as severe as color-only encoding for blind users. Tab order without explicit declaration is undefined for opponent grid.

**Consequences.**
- Slice 69 includes ARIA-live region (~5 LOC) + tabIndex declarations.
- v3 may extend with skip-to-content links, full keyboard-only target-picking flow.

---

## Already resolved — do NOT re-open

These were explicitly investigated by the 5-reviewer pass and CLOSED. Reopening any of them requires a new ADR.

- **PlayerArea structure for N players** — `PlayerArea.tsx:9-53` takes a single `WebPlayerView` and renders one seat. No structural change needed.
- **PhaseTimeline active-player indicator** — already keys on `gv.activePlayerName: string`. Strings work for N. (Glow ring per D5/D13 supplements text-pill, doesn't replace it.)
- **Targeting expansion to N targets** — already `targets: z.array(z.string())`. Set semantics work for N.
- **Multiplayer card mechanics dialog kinds** — Reviewer A confirmed: voting (Council's Dilemma), Tempt offers, Goad enforcement, Monarch, Initiative, Group-Hug all reuse existing `gameAsk` / `gameTarget` / `gameChooseChoice` per ADR 0007 D5. No new wire frames for card mechanics. (Goad UI BADGE per D3(c) is a new visual surface, not a new dialog kind.)
- **Per-player chat scoping** — ADR 0007 D6 + the per-WsContext chat-scoping filter already work for N players. Spectator chat is the new addition (D4).
- **Schema 1.20 wire breaks** — slice 69 is **additive only** per Phase 3+ policy from ADR 0007 D11. New fields: `WebPlayerView.teamId`, `WebPermanentView.goadingPlayerIds`, new method `dialogClear`, new method `gameInformPulse`, `WebStreamHello.protocolVersion`. All optional / default-safe.
- **`gv.players` ordering** — server-side ordering matches turn order; client filter preserves it. v2 ships unchanged.
- **TriggerOrderDialog at N=4** — owned by ADR 0009 (flat list, source-attributed). v2 keeps that semantics; multiplayer doesn't change it.
- **Combat panel symmetry** — `webclient/src/game/dialogs/CombatPanel.tsx` is dialog-state-only; assignment routing lives elsewhere. 2HG combat reuses unchanged.
- **2HG combat shared step** — engine handles (`Combat.java`); dialog dispatch reuses gameSelect declareAttackers/declareBlockers.

---

## Risk register

### R1. 2HG life-share + team-mapping verification gap
Two unknowns to verify before slice 69 merges:
- **Life-share.** Confirm whether upstream's life-share semantics surface via `Player.life` (each teammate's `life` field set to team total) or require a separate `Team.getLifeTotal()` accessor. Snapshot-test 2HG fixture: Healing Salve on teammate A → both teammates' `life` reads same total.
- **Team mapping (D3 prerequisite).** Engine exposes `Team.getId()` but no `Game.getTeam(playerId)` and no `Team.getPlayers()`. Slice 69 ships path (1) — derive teamId from `MatchType.getPlayersPerTeam()` + seat-index in the WebApi mapper, NOT a new upstream accessor. Snapshot-test 2HG fixture: 4 seats → exactly 2 distinct teamIds, seats 0+1 share teamId-A, seats 2+3 share teamId-B.

**Mitigation:** both verifications land as snapshot tests in slice 69. If life-share requires a pooled accessor, the mapper extends one method. If seat-index derivation breaks (e.g., a future format permits async team assignment), R1 escalates to "add `Team.getPlayers()` upstream patch" before that format ships.

### R2. Spectator allow-list mechanism missing server-side
`LobbyService` has no per-game spectator registry today. Slice 71 adds `registerSpectator/unregister`. **Mitigation:** slice 71 owns the change; if delayed, slice 69 ships without spectate (acceptable — slice 69 exit gate is "FFA + 2HG playable").

### R3. Hidden-info gap when `createdForPlayerId=null`
D2 assumes upstream's `GameView`/`PlayerView` constructors handle the null path cleanly. Verified for `controlled` field. **The `processWatchedHands` path on `GameSessionWatcher.java:101-111` is the actual leak vector** — populates `watchedHands` map for any user with explicit hand-share permission. Slice 71 mapper MUST construct `GameView(state, game, null, null)` directly, NOT call through `GameSessionWatcher.getGameView()`. **Mitigation:** snapshot-test asserts `watchedHands={}` on spectator path.

### R4. Concession-mid-dialog teardown
Player concedes while a vote / target / cost dialog targeting them is open. Engine skips at `VoteHandler.java:33-39`, but client never receives a clear signal. **Mitigation:** D11(b) `dialogClear` wire frame. Test: 4-player Tempt-with-Discovery, mid-loop concession, assert all clients receive `dialogClear`.

### R5. Reconnect-after-elimination policy
Eliminated player reconnects. Without explicit policy, behavior is undefined (rejected? joined as zombie? hung?). **Mitigation:** D11(c) routes to spectator path with seat-= old-seat camera. Test: disconnect+eliminate+reconnect sequence asserts spectator role.

### R6. Spectator-on-own-game leak via `processWatchedHands`
Same user opens player route + spectator route to same gameId — without seat-exclusion in `processWatchedHands`, peeks own hand from a perspective other clients can't reproduce. **Mitigation:** D4 same-gameId XOR check (close 4003) + D2 spectator-self exclusion in mapper. Test: assert seated user opening WATCH route gets 4003.

### R7. Token rollout discipline
D7 introduces tokens scoped to v2 surfaces only — but every future polish slice now has access. Discipline risk: a contributor adds a literal color when a token would do. **Mitigation:** lint rule (custom ESLint plugin) flags hex literals in component files; allow-list known structural surfaces. Defer rule to slice 73-77 polish track; for slice 69 just code-review for token usage.

---

## Design philosophy prose

> **Information density is a per-format budget, not a global setting.** 1v1 affords detail; 4-player FFA affords glance. The ADR commits to: (1) every piece of game-state-relevant information is *findable* at any density — never removed, only collapsed behind hover/expand; (2) no information is conveyed by color alone (ADR 0005 D10) — color always rides on shape, label, or position; (3) active-player, priority-holder, and turn-phase are first-class visual citizens at every density and use redundant encoding (glow + label + position); (4) decorative chrome scales down before informational chrome — frames thin before badges shrink; (5) spectator UI is *not* a stripped player UI — it's a distinct mode with its own affordances (perspective toggle, persistent banner, pulse frames during hidden engine work); (6) animation scales with frequency, not importance — high-frequency events (draw, play, tap, target, life-change) get animated transitions; low-frequency events (game-over, mulligan) get larger static moments. When in doubt, prefer one more pixel of game state over one more pixel of brand.
>
> **Cohesion.** All semantic colors flow through CSS custom properties (D7). Tailwind utilities handle layout; design tokens handle meaning. Multiplayer (v2), light theme (Phase 7), and any future user-customizable theming all read the same token surface. No literal hex / Tailwind-color-class is allowed for *semantic* purposes (status, team, mana identity); literals remain fine for *structural* surfaces (panel backgrounds, borders without semantic meaning).

---

## Appendix A — Test contracts

| # | Test | Severity | Lives at | Owning slice |
|---|---|---|---|---|
| 1 | FFA 4p Playwright multi-context | REQUIRED | `webclient/e2e/multiplayer/ffa.spec.ts` | 69 |
| 2 | 2HG life-share invariant + team-ring snapshot | REQUIRED | `webclient/e2e/multiplayer/2hg.spec.ts` + mvn fixture | 69 |
| 3 | Spectator `GameView` snapshot — no leaks | REQUIRED | `Mage.Server.WebApi/.../SpectatorGameViewTest.java` | 71 |
| 4 | Spectator inbound-reject contract | REQUIRED | `Mage.Server.WebApi/.../SpectatorRouteTest.java` | 71 |
| 5 | Frame ordering parity (player vs spectator) | RECOMMENDED | server unit | 71 |
| 6 | Frame buffer overflow at 4× rate | REQUIRED | `GameStreamHandlerTest.java` extension | 70 |
| 7 | D5 layout className branching | RECOMMENDED | `webclient/src/game/Battlefield.test.tsx` | 69 |
| 8 | Eliminated UI + dialogClear | REQUIRED | `webclient/e2e/multiplayer/elimination.spec.ts` | 69 |
| 9 | Reconnect-after-elimination | REQUIRED | server unit + e2e | 71 |
| 10 | chatSend rate-limit at 4 players | RECOMMENDED | server unit | 70 |
| 11 | Multiplayer server fixtures (FFA, 2HG, spectator) | REQUIRED | `Mage.Server.WebApi/.../fixtures/MultiplayerFixtures.java` | 69 |
| 12 | Load test (50 games, 200 spectators) | RECOMMENDED | `tools/loadtest/` | 70 |
| 13 | Spectator-of-self exclusion (R6) | REQUIRED | server unit | 71 |
| 14 | 2HG monarch-on-individual-PlayerArea | REQUIRED | webclient unit | 69 |
| 15 | RoI ONE/TWO server-side filter | REQUIRED | mapper unit | 69 |
| 16 | `protocolVersion` mismatch handshake (close 4400 + reason `PROTOCOL_VERSION_UNSUPPORTED` + supported-versions JSON body) | REQUIRED | server unit | 69 |

Test infra updates:
- `playwright.config.ts:13` timeout 60_000 → 180_000
- New `webclient/e2e/helpers/multi-player.ts` shared fixture builder
- New `Mage.Server.WebApi/src/test/java/mage/webapi/ws/fixtures/MultiplayerFixtures.java`
- New `tools/loadtest/` (manual, not in CI)

CI impact: server mvn-test +15s wallclock for 5 multiplayer fixture tests. Stays under slice-56 15-min budget. Webclient unit +0.5s. Multi-context Playwright e2e is NOT in CI (queued slice 62b auto-start); run manually pre-release.

---

## Appendix B — Observability surfaces

| Gauge / Counter | Endpoint | Source |
|---|---|---|
| `xmage_active_games` | `/api/admin/metrics` | `GameManager` |
| `xmage_total_spectators` | `/api/admin/metrics` | `LobbyService.spectatorRegistry` |
| `xmage_frames_egressed_total{route,game_id}` | `/api/admin/metrics` | WS send-site |
| `xmage_frames_per_second` | `/api/admin/metrics` | rolling 10s window |
| `xmage_buffer_overflow_drops_total{route}` | `/api/admin/metrics` + WARN log | per-handler buffer |
| `xmage_out_of_order_frames_total` | `/api/admin/metrics` + WARN log | client→server attestation |
| `xmage_long_priority_window_p99_ms` | `/api/admin/metrics` | engine timing |
| `xmage_team_life_divergence_alarm{game_id}` | `/api/admin/metrics` (alarm bool) | 2HG team accumulator |
| `xmage_dialog_clears_emitted_total` | `/api/admin/metrics` | per R4 — counter assertion folded into Test 8 |

---

## Items deferred to v3+

- **Replay system inheriting filtering rules.** Synthesis miss #5: spectator + replay share the GameView construction path. v3 ADR for replay must address whether replays are seat-1 or omniscient.
- **`cardId` retroactive identity inference for face-down cards.** Reviewer A6: distinct subsystem (card ID generator); needs its own design pass.
- **Buddy-spectate explicit hand-share via `USER_REQUEST_DIALOG`.** ADR 0008 §1.20.
- **Separate spectator-chat room.** v2 ships read-only player-chat mirror; v3 may add isolation.
- **Asymmetric `grid-template-areas` for table-feel layout.** v3 evolves D5 from equal-width 3-col to 12 / 9 / 3 layout.
- **`isInRange: boolean` placeholder seat for `RangeOfInfluence.ONE/TWO` UX.** D1 v2 filters server-side; v3 may surface "out-of-range opponent" placeholder.
- **Full `index.css` token migration.** D7 wedges 4 surfaces; Phase 7 light theme owns the rest.
- **Spectator perspective rotation memory across reconnects.** Cookie-persisted preference.
- **Lint rule for token usage discipline.** R7; deferred to slice 73-77.
- **COPPA / age-gated chat for spectators.** Synthesis miss #4. Flag for legal/policy review before any public spectator deployment; v2 personal-fork scope skips.
- **Sound design.** Phase 7 trap; users don't ask for it.
- **i18n string extraction.** Premature without users.

---

## Update log

- **2026-04-29 (v1)** — initial 5-decision draft (D1-D5) with 3 risks. Plan-agent generated.
- **2026-04-29 (v2 — current)** — comprehensive rewrite after 4-specialist critique (Reviewers A: MTG rules, B: WebSocket protocol, C: UX/design philosophy, D: test strategy + observability) plus Synthesis pass. Adds D6-D13, R4-R7, design philosophy prose, test contracts appendix, observability appendix, and explicit v3 deferrals. Supersedes v1 — no in-place merge; v1 is replaced wholesale. Fixer pass after final critic resolved D1 line-citation drift, D3/R1 team-mapping prerequisite (no `Game.getTeam(playerId)` accessor exists upstream — mapper computes from `MatchType` + seat-index), D4↔D11(c) reconcile, D11(b) re-prompt chain semantics.

---

## References

- [ADR 0005 — Game window architecture](0005-game-window-architecture.md) (D10 a11y commit)
- [ADR 0007 — Game stream protocol](0007-game-stream-protocol.md) (D5 wire frames; D6 inbound envelopes; D11 schema-bump policy)
- [ADR 0008 — Player interactions: 1v1 duel matrix](0008-player-interactions.md) (§1.17 WATCHGAME, §1.20 USER_REQUEST_DIALOG, §1.25 gameInformPersonal)
- [ADR 0009 — Triggered ability ordering](0009-triggered-ability-ordering.md) (TriggerOrderDialog flat list at N=4)
- Upstream `GameView` constructor — `Mage.Common/src/main/java/mage/view/GameView.java:72-90`
- Upstream `PlayerView` controlled flag — `Mage.Common/src/main/java/mage/view/PlayerView.java:63-66`
- Upstream `Team` — `Mage/src/main/java/mage/game/Team.java`
- Upstream `Session` messageId — `Mage.Server/src/main/java/mage/server/Session.java:68,437`
- Upstream `GameController` fan-out — `Mage.Server/src/main/java/mage/server/game/GameController.java:820-827`
- Upstream `VoteHandler` — `Mage/src/main/java/mage/choices/VoteHandler.java:33-82`
- Upstream Monarch — `Mage/src/main/java/mage/game/GameImpl.java:4125-4143`
- Upstream `GameSessionWatcher.processWatchedHands` — `Mage.Server/src/main/java/mage/server/game/GameSessionWatcher.java:101-111`
- Upstream Goad effect — `Mage/src/main/java/mage/abilities/effects/common/combat/GoadTargetEffect.java:62-70`
- Slice-63 game-membership gate — `Mage.Server.WebApi/src/main/java/mage/webapi/ws/GameStreamHandler.java:144-171`
- Slice-63 spectator TODO comment — `Mage.Server.WebApi/src/main/java/mage/webapi/ws/GameStreamHandler.java:151`
- Slice-3 `?since=` reconnect tests — `Mage.Server.WebApi/src/test/java/mage/webapi/ws/GameStreamHandlerTest.java:311+`
- Slice-62 single-player Playwright e2e — `webclient/e2e/smoke.spec.ts:15-61`
- Webclient opponents loop — `webclient/src/game/Battlefield.tsx:212-225`
- Webclient PlayerArea — `webclient/src/game/PlayerArea.tsx:9-53`
- Webclient schemas — `webclient/src/api/schemas.ts:389-433`
- Webclient base CSS (token target) — `webclient/src/index.css:1-42`
