# New Lobby Window — Design

- **Status:** Draft (awaiting review)
- **Date:** 2026-05-02
- **Owner:** Austin
- **Builds on:** [ADR 0006](../decisions/0006-lobby-and-tables.md), [picture-catalog](picture-catalog.md), slice 70-X.0–70-X.4 (per-seat commander preview)

---

## Goal

Replace the current `CreateTableModal` + table-list pre-game flow with a **dedicated lobby screen** that is the source-of-truth for game configuration. Reference image: user-supplied "Commander Lobby" mockup (4-seat Commander FFA).

The new screen is entered after a small pre-lobby selector (format / mode / player count) and is where the host configures everything else, players choose decks, and the host starts the match once all seats are ready.

## Polish bar (non-negotiable)

The lobby must match the visual quality of **both** the reference mockup and the existing in-game redesign (slice 70-J–70-Y). Concretely:

- Dark blue/purple gradient backdrop with subtle nebula/star ambience consistent with the in-game battlefield backdrop.
- Card panels use the same surface treatment as in-game pods: rounded corners, soft inner border, subtle drop-shadow glow.
- Player ring + halo treatment **reuses `PlayerPortrait`** (slice 70-J). Multicolor rings rotate on host's pulse rhythm; ready seats get a green halo accent. No bespoke avatar rendering.
- Commander card frames use the same `CardFace` component the game uses — no new card-rendering path.
- Typography, spacing, and color tokens come from `webclient/tailwind.config.*` and `docs/design/design-system.md`. No raw hex / bespoke values in TSX.
- Buttons follow the existing `<Button variant="primary|secondary|danger">` patterns; the orange Start CTA is the redesign's existing primary affordance, not a new color.
- Motion: hover states, ready-toggle transitions, and seat-fill animations all match `docs/design/picture-catalog.md` motion principles (reserved for state signals — see [Xmage UX principles](../../C--Users-austi/memory/xmage_ux_principles.md)).

L1's exit gate isn't "renders the right elements" — it's **pixel-quality match against the mockup at 1536px**, judged side-by-side with screenshots of the existing game window for surface consistency.

## Reference image — quick read

Four functional regions plus a top bar:

- **Top bar:** Back button → main menu, settings icon, sign-out icon.
- **Header:** Lobby title (`{Format} LOBBY`) + subtitle (`{Mode} • {N} Players`) + central status pill (`WAITING FOR PLAYERS — X/N Players Ready`).
- **Game Settings panel** (left): read-only summary of MatchOptions + Edit Settings button (host-only).
- **Seat row** (top-center): N seat cards. Each shows avatar + name + commander card + deck name + ready state. Empty seats show a `+` placeholder.
- **My Decks panel** (bottom-left): user's saved decks. Selecting one updates this player's seat.
- **Deck preview** (bottom-center): selected deck's commander card, card-count validation, mana curve, type counts, color pips.
- **Commander preview** (bottom-center-right): large Scryfall art for the selected deck's commander. Commander format only.
- **Start Game** (bottom-right): host-only orange CTA, gated on all seats ready.

## Locked-in decisions (from Q&A 2026-05-02)

| # | Decision |
|---|---|
| 1 | Replaces lobby for **all formats** (not Commander-only). |
| 2 | Reshapes for different player counts; this lobby is the source of truth for game config. |
| 3 | **Per-seat ready system is new** — must implement server + client. |
| 4 | No currencies, no rank/level badges, no friends references. |
| 5 | Top bar is settings + sign-out only. |
| 6 | No chat in lobby (no system event toasts either — seat state is self-evident). |
| 7 | Avatars reuse in-game `PlayerPortrait` pattern: commander art for Commander format, username-initial fallback otherwise. |
| 8 | Subtitle under name = commander's title from deck (Commander format only); empty for other formats. |
| 9 | Keep "My Decks" only; no Recent Decks tab. |
| 10 | Color identity pips computed client-side from deck's commander. |
| 11 | Card-count validation surfaced in lobby for all formats (e.g. `100/100`, `60/60`, `40/40`). |
| 12 | Deck preview stats (mana curve, type counts, color pips) computed client-side from decklist. **High priority for v1.** |
| 13 | Omit commander lore paragraph. |
| 14 | Password-gated lobbies supported; "Privacy" maps to Public / Password. |
| 15 | Edit Settings = single entry point (no duplicate gear). Covers password + player count + life total + mulligan + time limit + skill + spectators + rated + range + attack option. |
| 16 | Back button returns to main menu. Host gets "Are you sure?" confirm (closes lobby for all). Non-host just leaves seat. |
| 17 | Crown icon next to host's name. |

## New concepts being introduced

### Per-seat ready system

Each occupied seat has a `ready: boolean`. Host's seat starts as ready (or auto-readies on entry); guests start un-ready, must opt in. Start button gated on all seats ready. Wire change required (see Backend Changes).

Edge cases:
- **Host changes a setting that invalidates current state** (e.g. format change → all decks re-validated; player count change → some seats may need to leave). All non-host seats un-ready and must re-confirm. Host gets a small "Settings changed — guests must re-ready" hint.
- **Guest changes deck while ready** → their `ready` resets to false until they reconfirm. Prevents the "I was ready with a different deck" race.
- **AI seats** are always ready (no human to acknowledge).

### Real-time table state push

Polling every 5s (current model) won't feel right when ready toggles, deck changes, and seat joins/leaves all want to be visible immediately. **Recommend per-table WebSocket topic** (`/api/rooms/{roomId}/tables/{tableId}/stream`) that pushes `WebTable` snapshots on any state change.

Polling fallback retained for clients that can't establish the WS.

## Screen flow & routing

```
Main menu
  └─ "Create Game" button
       └─ Pre-lobby selector (modal) — slim version of current CreateTableModal:
            • Format dropdown (Commander / Standard / Modern / …)
            • Game mode dropdown (FFA / 1v1 / 2HG / …)
            • Player count (per gameType.minPlayers..maxPlayers)
            • [Create] → POST /api/rooms/{roomId}/tables with default options
       └─ On 201: route to /lobby/{tableId}

/lobby/{tableId}
  └─ NewLobbyScreen — full-page (no modal)
       └─ Top bar, Header, Game Settings, Seat row, My Decks, Deck Preview, Start
       └─ Edit Settings (host only) — opens modal with the rest of MatchOptions
       └─ Back button:
            • Host → "Close lobby?" confirm → DELETE /api/.../tables/{tableId} → main menu
            • Guest → DELETE /api/.../tables/{tableId}/seat → main menu

DUELING transition
  └─ When server pushes tableState=DUELING, client routes to /game/{tableId}
```

Players joining via the existing table list (separate flow, out of scope for v1) land on the same `/lobby/{tableId}` route.

### What's locked at table creation vs. editable in the lobby

| Field | Locked at creation | Editable via Edit Settings |
|---|---|---|
| Format (deckType) | ✓ — changing post-creation invalidates all selected decks | |
| Game mode (gameType) | ✓ — reshapes seat layout | |
| Player count | | ✓ (per user direction Q18) |
| Password | | ✓ |
| Starting life total | | ✓ (display: format default; host can override — see Open Question O3) |
| Mulligan type, free mulligans | | ✓ |
| Match time limit, skill level | | ✓ |
| Spectators allowed, rated | | ✓ |
| Range of influence, attack option | | ✓ (when gameType supports) |

## Component tree

All under `webclient/src/lobby/` (new directory):

```
lobby/
├── NewLobbyScreen.tsx           — top-level page; subscribes to table stream
├── LobbyTopBar.tsx              — back / settings / sign-out
├── LobbyHeader.tsx              — title + subtitle + ready status pill
├── GameSettingsPanel.tsx        — read-only stat list + Edit Settings button
├── EditSettingsModal.tsx        — full MatchOptions form (host only)
├── SeatRow.tsx                  — flex container; renders SeatCard × N
├── SeatCard.tsx                 — avatar / name / commander / deck plate / ready
│   └── OpenSeatCard.tsx         — empty seat variant (+/wait)
├── MyDecksPanel.tsx             — list of localStorage decks + New Deck button
├── DeckPreviewPanel.tsx         — commander card + count + curve + types + pips
│   └── ManaCurveHistogram.tsx   — small SVG bar chart, CMC 0..7+
│   └── DeckTypeCounts.tsx       — Creatures / Artifacts / Enchantments / I&S
│   └── ColorPipCounts.tsx       — W/U/B/R/G mana symbol counts
├── CommanderPreviewPanel.tsx    — Scryfall art-crop + commander name
├── StartGameButton.tsx          — host-only orange CTA + gating tooltip
└── PreLobbyModal.tsx            — slim format/mode/count selector

shared:
├── webclient/src/decks/computeStats.ts      — mana curve, type counts, color pips, color identity
└── webclient/src/decks/colorIdentity.ts     — derive WUBRG from commander card
```

`PlayerPortrait` (existing, slice 70-J) is reused in `SeatCard`.

## Data flow per region

| Region | Data source |
|---|---|
| Top bar | `useSession()` (existing) for username; sign-out hits `DELETE /api/session`. |
| Header | `webTable.gameType`, `webTable.deckType`, derived `readyCount/totalSeats`. |
| Game Settings panel | All `WebTable.matchOptions` fields (read-only). |
| Edit Settings modal | Same as create — `PATCH /api/.../tables/{tableId}` (NEW endpoint, see below). Host-only. |
| Seat row | `webTable.seats[]` — per-seat `playerName`, `playerType`, `commanderName`, `commanderImageNumber`, plus new `ready`, `deckName`, `deckSize`, `deckSizeRequired`. |
| My Decks panel | `useDeckStore()` (Zustand, existing) — local decks. |
| Deck Preview | Selected deck → `computeStats(deck)` (new pure utility). |
| Commander Preview | Selected deck's commander → `scryfallCommanderImageUrl(card, 'art_crop')` (existing). |
| Start Game | `webTable.seats.every(s => s.ready)` && `session.username === webTable.controllerName`. |

## Backend changes required

### Schema bump 1.26 → 1.27

Add to `webSeatSchema` (and matching `WebSeat.java`):

```typescript
ready: z.boolean().default(false),
deckName: z.string().default(''),       // for the Deck plate on each seat
deckSize: z.number().default(0),        // mainboard count
deckSizeRequired: z.number().default(0), // 60/100/40 — derived from format
```

Existing fields kept: `playerName`, `playerType`, `occupied`, `commanderName`, `commanderImageNumber`.

### New endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/rooms/{r}/tables/{t}/seat/ready` | Toggle current user's `ready` flag. Body: `{ ready: boolean }`. |
| `PATCH` | `/api/rooms/{r}/tables/{t}` | Host-only. Update editable MatchOptions (see table above). On success, broadcasts new `WebTable` and **resets all guest `ready` flags**. |
| `WS` | `/api/rooms/{r}/tables/{t}/stream` | Server pushes `WebTable` snapshots on any change. |

Existing endpoints reused: `POST /tables` (create), `POST /tables/{t}/join` (join with deck), `POST /tables/{t}/ai` (AI seat), `POST /tables/{t}/start`, `DELETE /tables/{t}/seat`, `DELETE /tables/{t}`.

### Deck-change-while-seated

Currently no endpoint exists for changing deck mid-lobby. Add: `PUT /api/.../tables/{t}/seat/deck` accepting `WebDeckCardLists`. Validates legality, updates seat's commander preview + deckName/deckSize fields, resets `ready=false`. Broadcasts new `WebTable`.

## Slice plan (revised 2026-05-02)

Each slice is a complete commit, deployed live before the next starts.

The original L1 ("trim CreateTableModal") was reordered: the trim depends on EditSettingsModal existing (or the deferred fields like AI seats / time limit / mulligan have nowhere to live). New L1 is the static shell + route; the trim moves to **L4** alongside Edit Settings.

1. **Slice L1 — Static lobby shell + route.** Add `activeLobbyId` state to App.tsx (mirrors existing `activeGameId` pattern). Build all components in `webclient/src/lobby/` rendering hardcoded fixture data. No wire calls. Dev-only entry path (e.g. `?lobby=fixture` URL param) for visual review. CreateTableModal untouched — existing flow keeps working. Pixel-match against reference image at 1536px.

2. **Slice L2 — Wire WebTable read.** Schema bump 1.26 → 1.27 (additive: `ready`, `deckName`, `deckSize`, `deckSizeRequired`). Hook `GET /api/.../tables/{t}` polling to populate the lobby. Render real seat names, commander previews, deck plates. No interactivity yet (no ready toggle, no Start, no settings edit).

3. **Slice L3 — Edit Settings modal + PATCH endpoint.** Build `EditSettingsModal` host-only with all the deferred MatchOptions (password, life total display, mulligan, time limit, skill, spectators, rated, range, attack option, player count, AI seats). Wire `PATCH /tables/{t}` server-side; on success broadcasts new `WebTable` and resets guest ready flags. Existing CreateTableModal still creates tables for now.

4. **Slice L4 — Pre-lobby modal trim + entry wiring.** Refactor CreateTableModal into PreLobbyModal (format / mode / count only; everything else lives in EditSettingsModal). On create → set `activeLobbyId` → render new lobby. Old table list still works for joining; CreateTableModal trim is forward-only since EditSettingsModal now covers the missing fields.

5. **Slice L5 — Ready system.** New `POST /seat/ready` endpoint, ready toggle in SeatCard, status pill counts ready seats, Start button gating. AI seats auto-ready (server sets `ready=true` on AI join). Verify 4-player game with 1 host + 3 guests, all ready, Start enables.

6. **Slice L6 — My Decks + Deck Preview + deck change.** Wire `useDeckStore` to MyDecksPanel. Implement `computeStats` utility (mana curve, type counts, color pips, color identity). New `PUT /seat/deck` endpoint with debounce. Deck change broadcasts; seat un-readies.

7. **Slice L7 — WS table stream + UX polish.** Replace 5s polling with WS push. Ready toggles, deck changes, seat joins propagate <100ms. Folds in deferred polish: optimistic seat-card update on deck pick (now natural with push), settings-change → guest-ready-reset notification banner, live-deck loading skeleton, local-user identity normalization for edge wire shapes.

8. **Slice L8 — Back button + leave / close.** Host close-confirm modal. Guest leave-seat. Verify host close removes the table for everyone.

9. **Slice L9 — Retire old flow + polish.** Delete legacy CreateTableModal full-modal code. Update lobby table list to route joiners to the new lobby on join. Per-error-code user-friendly messages (404 "table no longer exists", 403 "not seated", 422 "deck invalid").

Total estimated commits: ~9. Each ~30–60 min review + deploy cycle.

## Breakage analysis

- **AI seats** must continue to render (`playerType !== "HUMAN"`). Show the AI player name + a placeholder avatar (no commander art); always `ready=true`. Test: existing add-AI flow still works.
- **Tournament tables** (`isTournament=true`) — current code surfaces this on `WebTable`; behavior is upstream. **Out of scope for v1.** New lobby renders only `isTournament=false` tables; tournament tables continue through legacy path. (See Open Question O1.)
- **Spectators** — `spectatorsAllowed` exists but spectator join flow isn't part of the new lobby for v1. Spectators join after `DUELING` via existing path. Confirm in Q&A.
- **Draft / sealed** (`limited=true`) — uses different lifecycle (sideboard build phase, etc.). **Out of scope for v1.** Limited tables continue legacy path.
- **Mid-lobby host disconnect.** Today: the table persists on the server until owner removes it. With ready system: if host drops, guests are stuck — server should auto-promote oldest guest to host or auto-close after a timeout. **Open Question O2.**
- **Existing slice 70-X.0 commander preview in the table list** — keeps working; the lobby's per-seat preview is the same wire field, no conflict.
- **Schema 1.27 backward compatibility** — new `ready`/`deckName`/`deckSize`/`deckSizeRequired` fields are additive. Old clients on 1.26 ignore them. Verify the existing version-bump test (`08594c8e`) passes for 1.27.
- **Polling → WS migration.** Slice L7 must not break the 1.27 wire shape. Frame schema must match exactly between poll response and WS push.
- **Deck change reset of `ready`.** Risk: rapid deck-toggling spams broadcasts. Server should debounce / rate-limit deck-change endpoint (e.g. 1 call / 500ms per seat).

## Resolved (was "Open questions") — confirmed 2026-05-02

- **O1.** Tournament/draft tables stay on the **legacy flow** for v1; revisit after v1 ships.
- **O2.** Host disconnect → **auto-close after 30s**. Host can rejoin within the window via reconnect.
- **O3.** Starting life total: **format default only for v1**. Display-only stat row. ADR 0006 D3 deferral on `customStartLife` stays in effect.
- **O4.** Player count shrink: **only down to currently-occupied seat count**. Expanding always allowed.
- **O5.** Avatar fallback: **one letter** (first char of username, uppercased).
- **O6.** Non-Commander color identity: **any mana color with ≥1 symbol in the mainboard shows a pip**.

---

End of design doc. Once locked, slice L1 begins.
