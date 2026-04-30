# Target Visual Reference — Commander 4-Player Game Table

> **Superseded by [`picture-catalog.md`](picture-catalog.md) (2026-04-29).**
> The picture-catalog is the canonical source of truth for the visual
> identity of v2. This document is preserved for **historical decision
> context** — the four "Locked decisions" in §"Locked decisions (from
> spec reconciliation, this push)" remain authoritative for those
> specific reconciliation choices. Use this document to understand
> WHY the catalog made certain calls (e.g. KEEP-WITH-SLASH eliminated
> overlay, ADR-wins disconnect behavior). Use the catalog for HOW
> elements should look.

This document captures the canonical visual target for the Commander game-table redesign and the decisions reached during reconciliation between the design spec and locked v2 architecture (ADR 0010 v2). It is the single point of reference that future implementation slices, design iterations, and reviewer agents should ground in.

The reference screenshot itself is not committed (the user provided it inline during the design-spec push); this document preserves the load-bearing visual details verbatim so anyone implementing without the screenshot can still match intent.

---

## Reference screenshot — described

A wide landscape view of a 4-player Commander Free-for-All in progress. Dark teal-to-near-black background, MTG-Arena-grade visual polish, no skeuomorphic table edge.

### Header strip

- **Top-left:** "COMMANDER — 4 PLAYER FREE-FOR-ALL" in soft purple, all caps, light tracking.
- **Top-right:** four icons in this order — chat, layout/zoom, fullscreen, settings. Subtle, white-on-transparent.

### Battlefield — 4-pod arrangement

The four player pods are arranged in a circular layout around a center focal zone. **Local player always at the bottom regardless of turn order** (sit-anywhere — already locked by ADR D8).

- **Top opponent — Korvold, Fae-Cursed King** — life 38. Halo: blue-green multicolor ring. Battlefield row of 6 face-down or back-side cards above the player frame, plus a row of small permanents (the Treasure-token-style horizontal cards) curving around the upper edge.
- **Left opponent — Atraxa, Praetors' Voice** — life 35. Halo: dark purple/blue (color-identity-driven). Two columns of cards stacked vertically along the left edge, lands closer to the screen edge.
- **Right opponent — Meren of Clan Nel Toth** — life 32. Halo: green ring. Mirror of Atraxa, columns along the right edge.
- **Bottom (local) — The Locust God** — life 29. Halo: blue-cyan ring with a soft pulse. The local player's pod has a wider footprint than opponents; the battlefield row above the hand shows ~10 permanents at full readability.

### Center focal zone

A single card in the geometric center: **The Locust God** rendered at focal size (~1.5× battlefield-size cards), with a subtle frame glow in the card's color identity (cyan) and a pulsing halo. Currently mid-cast — the spell is on top of the stack, drawn at this prominence so it reads instantly even in a busy 4-pod board state.

The focal zone's empty state (no spell on stack, no combat) shows ambient particles drifting slowly — no UI chrome, no labels.

### Hand area

Bottom strip, ~6 hand cards shown in a slight fan. Cards at full hand-size (~1.4× battlefield size). Subtle arc, not a Hearthstone-style steep curve. The hand sits flush against the bottom edge of the viewport — no margin, no decorative tray.

### Right side panel

Vertically split into three stacks:

1. **GAME LOG** (top) — recent entries with a small player-portrait avatar on the left, action text on the right:
   - "Korvold played Blood Crypt"
   - "Atraxa cast Toxic Deluge"
   - "Meren returned Sakara-Trib Elder to hand"
   - "You cast The Locust God"
   - Card names underlined / interactive (hover preview).
2. **COMMANDER DAMAGE** (middle) — a 2×2 grid of opponent portrait + damage number:
   - Atraxa 7
   - Korvold 5
   - Meren 6
   - (the user) 6
   - Manual entry; engine does not enforce.
3. **TURN / ACTION** (bottom) — "TURN 8" label above a single large purple "End Step" button. Ellipsis (`...`) menu adjacent for multi-phase passes ("Pass to Next Turn", "Pass to Your Turn").

The whole right panel is collapsed-friendly — when collapsed, the battlefield expands to fill the freed horizontal space; a thin vertical tab remains to expand it again.

### Color and motion impressions

- **Background:** very dark teal-black, slight gradient toward the corners. Not solid black — there's a faint atmospheric depth.
- **Player halos:** single solid ring or multicolor band rotation, all glowing softly. Active player's halo is brighter and pulses; priority holder gets a separate text tag ("PRIORITY") that fades in/out (not visible in the static screenshot but spec'd in `screens-game-table-commander-4p.md` §Player states).
- **Card frames on battlefield:** dark frame with the card art clearly visible, P/T box bottom-right, no big chunky borders. MTG-Arena-style readability.
- **Focal-zone glow:** cyan/teal cast on the central card matching The Locust God's color identity. Pulses at ~1.5s period.
- **Targeting state:** spec'd as cream/white SVG arrows from source to target (not visible in the screenshot since no target is being chosen).

### Visual tone summary

The table reads as **clean, dark, MTGA-grade information density** — high contrast type, restrained chrome, generous whitespace between pods, glow as the primary "what's important right now" signal. No vintage parchment, no faux-table-edge, no skeuomorphic shadows on the pods. The only color saturation comes from card art, mana colors on halos, and the purple End Step accent.

---

## Locked decisions (from spec reconciliation, this push)

Three places where the design spec and ADR 0010 v2 conflicted; user resolved as follows. All future implementation slices must respect these.

### 1. Spectator UI — DEFERRED entirely

- Design spec said: "verbatim reuse of game-table screen with hand hidden."
- ADR 0010 v2 D2/D4/D8/D9/D11c said: distinct mode, perspective-rotation banner, pulse frames, "spectator UI is not a stripped player UI."
- **Decision: defer spectator UI entirely from this push.** The server-side spectator route (slice 71) is shipped and stable; client-side spectator UX is a future v2.x slice. Slice 70-A through 70-G builds the player game-table only.
- Update `screens-game-table-commander-4p.md` to remove the verbatim-reuse claim — spectator UI gets its own future screen spec.

### 2. Eliminated player — KEEP-WITH-SLASH OVERLAY (spec wins)

- Design spec said: keep the eliminated player's pod visible with a red diagonal claw-rip slash overlay; permanents fade out over 800ms; player frame desaturates to grey.
- ADR D11a / slice 69b said: drop them from layout entirely (the `selectOpponents` filter at `webclient/src/game/battlefieldLayout.ts:18` removes `hasLeft` players).
- **Decision: spec wins.** Slice 70-D will overturn the layout-drop and implement the keep-with-slash overlay. The visual target ("you see your defeated foe's gravestone") is more readable in 4p FFA than the disappearing-seat behavior. ADR 0010 v2 D11a will be amended to reflect the new contract.

### 3. Disconnect behavior — ADR WINS

- Design spec said: "Game pauses for everyone when any player disconnects."
- ADR D11e said: per-prompt timeout (60s default), then auto-pass; game continues for non-disconnected players.
- **Decision: ADR wins.** Pausing the whole table on every disconnect creates a denial-of-service vector and would make a 4p game unplayable on flaky networks. The design-spec doc gets updated to match ADR contract; visual treatment of a disconnected player (desaturated pod + "DISCONNECTED" overlay) still applies, the game just doesn't pause for everyone.

### 4. Spec precedence rule

For ALL OTHER design decisions — themes, layouts, formats, motion specifications, component anatomy, color/typography/spacing tokens — **the design spec takes precedence over the existing implementation.** That means slice 70-A onwards systematically migrates the codebase to the spec's surface. ADR 0010 v2 architectural decisions (state-machine, wire format, security boundaries, observability) remain locked; visual/UX decisions defer to the spec.

---

## Cross-references

- Design system: [docs/design/design-system.md](design-system.md)
- Screen spec: [docs/design/screens-game-table-commander-4p.md](screens-game-table-commander-4p.md)
- Locked architecture: [docs/decisions/0010-multiplayer-architecture.md](../decisions/0010-multiplayer-architecture.md)
- ADR amendment for this push: [docs/decisions/0011-design-system-adoption.md](../decisions/0011-design-system-adoption.md) (to be written before slice 70-D)
- Slice plan: see this conversation's TodoWrite (slices 70-A through 70-G)

---

## Notes for future implementing agents

- **Card art is Scryfall, fetched at runtime, never bundled.** Confirmed via `webclient/src/game/scryfall.ts` and `CardFace.tsx:149`. Do not change this.
- **Most "new" components in the design spec already exist under different names.** ~9 of 15 are rename + extend, not greenfield. Specifically: `CardFace=CardTile`, `LifeTotal=LifeCounter`, `ZoneCounter=ZoneIcon`, `PhaseTimeline=PhaseIndicator`, `StackZone=Stack`, `CommandZone=CommandZoneSlot`, `GameLog=GameLogEntry`, `PlayerArea⊃PlayerFrame`, `ManaPool⊃ManaOrb`. Per the design-system's own reconciliation rule, prefer existing names — `design-system.md` will be updated alongside slice 70-A to reflect the rename map.
- **Eliminated-player layout drop is being overturned.** Don't carry forward `selectOpponents`'s `hasLeft` filter into the new layout shell unconditionally — see decision #2 above.
- **Spectator route exists server-side (slice 71); client-side spectator UI does not.** When working on player-route UI, do NOT also build spectator-side variants in the same slice. Spectator UX is a separate future push.
- **Player color-identity isn't on the wire today.** Schema 1.21 will add `WebPlayerView.colorIdentity: string[]` (server-side, derived from `Player.commander.colorIdentity`) before slice 70-D — that's the data the player-halo ring consumes.
