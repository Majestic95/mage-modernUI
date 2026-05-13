# Deck-Builder Cross-Game Gap Audit — 2026-05-12

Captured by the deck-builder-research agent during the DB-1a pre-launch
critic pass. The agent compared xmage's just-shipped workbench against
the current best-practice deck builders in the Magic ecosystem
(MTG Arena, Moxfield, Archidekt, TappedOut, EDHrec, Hearthstone Deck
Builder, Slay-the-Spire-style CCG patterns, Manabox). This memo
captures every gap so future slices can pick them up without
re-reconning the same territory.

## What shipped in DB-0 + DB-1a + DB-1a-fix-1

- 3-column workbench (My Decks rail | embedded editor | commander
  preview + analytics).
- Editable deck name + format dropdown + 4-state legality pill +
  delete-with-confirm in the header.
- New Deck modal with paste-import (parses MTGA / MTGO / Moxfield /
  Archidekt exports).
- Bucketed deck lanes by type (Commander / Creature / Planeswalker /
  Instant-Sorcery / Artifact / Enchantment / Land / Other).
- Per-card qty +/- / delete / art swap / display-card pick.
- Mana curve histogram (0..7+), type counts (4 buckets), color pips,
  per-color pip counts, mainboard-vs-required validity.
- Card-name substring search with debounced /api/cards/search.

## Group C / Future findings — queued by priority

### Already-queued follow-up slices (in scope, just not in DB-1a)
- **DB-1b** — Filter chips above search (color / type / CMC) + search-first
  promotion (keyboard nav, Enter-adds-top-result, `/` hotkey).
  Cross-game inspiration: MTGA filter chips + Moxfield keyboard
  ergonomics.
- **DB-1c** — Hover-card preview in DeckLane (reuse `HoverCardDetail`).
- **DB-1d** — Bulk-paste-into-current-deck modal.

### New slices added by this audit (priority order)

| Slice | Cross-game inspiration | Why now |
|---|---|---|
| **DB-1e — Export menu** (Moxfield, MTGA) | Moxfield's `Export → MTGA / MTGO / Cockatrice / plain text / image grid` | Power users have a migration path off the platform; trust win. Plain text + MTGA-format clipboard copy is the MVP. |
| **DB-1f — Pre-emptive color-identity gate on add** (Archidekt) | Archidekt blocks the add or red-flags the row inline | Server legality check is post-hoc via debounce; user can pile up illegal cards before pill catches up. Pair with format auto-detect (below). |
| **DB-1g — Card-row keyboard nav + qty shortcuts** (Moxfield) | Moxfield arrow-key list nav + `+/-`/`d` shortcuts | 100-card decks at 5 buttons per row = ~500 tab stops. Power-user reach. |
| **DB-1h — Format auto-detect** (Moxfield) | "Deck with commander → Commander format pre-selected" | Format dropdown defaults to "Pick a format" even when commander info is present; legality pill silent until manual pick. |
| **DB-1i — Average CMC + land count + mana sources** (Archidekt) | Archidekt's "5 black sources, need 8 for double-black on T3" | Lands not in any of the 4 type buckets today; no land count, no avg CMC, no mana-source analysis. |
| **DB-1j — Bulk operations** (Moxfield) | Moxfield bulk edit panel | Multi-select + "set qty 4 across selection" + "remove all sideboard". |
| **DB-1k — Mana-curve land toggle** (Moxfield) | Moxfield separates land bar | 99-card Commander deck with 38 lands flattens the readable curve. |
| **DB-1l — Visual grid mode toggle** (Moxfield, Hearthstone) | `[List | Grid]` toggle showing full card art tiles | Visual half of the playerbase; complements DB-1c hover. |
| **DB-1m — Undo / edit history** (Moxfield) | `Ctrl+Z` reverses last mutation | Single misclick on Delete = irreversible today. |
| **DB-1n — Partner / Companion / signature-spell slots** (Modern Magic) | Brawl / Oathbreaker / PDH UI for second commander slot | `sideboard[0]` is the only commander slot today; partners, Backgrounds, Companions have no UI. |
| **DB-1o — Search result rules-text preview** | Moxfield hover, Slay-the-Spire-style large preview | Disambiguating "Counterspell" vs "Mana Drain" requires opening the deck or guessing. DB-1c covers lanes but not search results. |
| **DB-1p — Click-to-add animation** (MTGA, Hearthstone) | 150 ms scale-pop on the corresponding lane entry | Cheap polish; MTGA's iconic feedback loop missing today. |
| **DB-1q — Keyboard cheat-sheet overlay** (Moxfield) | `?` opens hotkey legend | Once DB-1b ships Enter-adds-top-result, the affordance needs discoverability. |
| **DB-1r — Deck folder / tag system** (TappedOut, Moxfield) | Flat rail of 50+ decks doesn't scale | Folders + tags. |
| **DB-1s — Deck snapshots / versions** (TappedOut, Moxfield) | "Save snapshot before I tear it apart" | No reverse path on a rebuild today. |

### Future memos (not new slices yet)

- **EDHrec / Scryfall synergy** — "top 10 most-included cards for your
  commander." Archidekt + EDHrec companion ship this. Defer — needs
  external API integration plan.
- **Owned-cards-only filter** (Manabox) — requires a collection-sync
  surface that doesn't exist in xmage.
- **Price tracking** (Archidekt) — out of scope for a self-hosted
  Magic engine but expected by Moxfield refugees. Memorize.
- **Compare-decks mode** (Moxfield) — diff two saved decks side-by-side.
- **Maybeboard / Acquireboard sub-boards** (Moxfield) — sub-board system
  beyond mainboard / sideboard. Moxfield's top retention feature.
- **Deck import from URL** (Moxfield / Archidekt URL paste) — substantial
  work; defer.

## Smaller polish nits (worth picking up opportunistically)

- Color pips in `MyDecksPanel` rail use deck-derived color identity but
  the rail thumbnail uses commander art — inconsistent for non-Commander
  decks where the displayCard might be off-color from the deck contents.
- `SearchResultRow` "+ Add" has no animation feedback (covered by DB-1p).
- `useDeckLegality` pill `aria-live="polite"` spams SRs on every
  keystroke during qty adjustment — consider `aria-live="off"` + a
  debounce-settled announcement.

## How to pick the next slice

The user prefers fast ship-to-live cycles. When picking a Group-C
slice, prefer the smallest single-file change that delivers a visible
power-user win. **DB-1b → DB-1e → DB-1f → DB-1g** is the recommended
ordering: chips first (the most-asked-for affordance), then export
(trust + migration), then color-identity gate (correctness), then
keyboard nav (power-user retention).
