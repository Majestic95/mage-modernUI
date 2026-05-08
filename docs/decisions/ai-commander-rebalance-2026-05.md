# AI Commander deck rebalance — May 2026

**Slice:** A (recon + spec, doc-only)
**Tier:** trivial
**Source:** [AiDeckLibrary.java:130-409](../../Mage.Server.WebApi/src/main/java/mage/webapi/lobby/AiDeckLibrary.java#L130-L409)
**Target power:** Bracket 2-3 (precon to lightly-upgraded). Each deck keeps **one global anthem**, **one mild engine** (the commander itself, in most cases), and **one ramp creature** — but loses snowball multipliers, board-locking finishers, and Bracket 4 game-enders.
**Status:** spec only — Slice B is the mechanical apply.

---

## Why this slice exists

3-AI Commander lobbies feel overwhelming because the 5 mono-color decks pack high-density synergy webs. Each individual card is reasonable for casual EDH; the *density* is the problem. White stacks 7 anthems. Red has Krenko + Krenko Tin Street + Hanweir Garrison + Goblin Rabblemaster + Hellrider + Purphoros + Coat of Arms + Goblin Bombardment all enabling each other. Green ends games on turn 6 with Craterhoof or Avenger.

The fix is to thin each web — not gut the deck. Commanders stay. Land/ramp/draw/creature/removal/utility shape stays. We swap ~7-9 cards per deck, all on the cuts side targeting **synergy multipliers and game-enders**.

## Constraints carried forward

The existing AI-friendliness filter (AiDeckLibrary lines 55-58) still applies to all replacements:
- No counterspells, no X-cost spells, no modal "choose one", no tutors, no hybrid mana, no extra-turn effects.

This slice's *additional* constraints:

| Cut category | Examples in current decks |
|---|---|
| Stacked anthems (>1 per deck) | White's Cathars' Crusade, Honor of the Pure, Spear of Heliod, Marshal's Anthem, True Conviction, Anointed Procession |
| Exponential snowball | Coat of Arms, Anointed Procession, Cathars' Crusade, Necropolis Regent |
| Board-locking finishers | Avacyn (indestructible everything), Sheoldred (sac-each-turn), Stormtide Leviathan (no creature attacks), Asceticism (full hexproof) |
| Bracket 4 game-enders | Craterhoof Behemoth, Hellkite Charger, Apex Devastator, Cyclonic Rift |
| Heavy draw engines | Mystic Remora; double draw-on-attack (Bident + Coastal Piracy in same deck). Mind's Eye intentionally KEPT in W/B/R/G — it's only cut from Blue Medium where it stacks with Mystic Remora + Bident + Coastal Piracy as redundant draw overload. |
| Free / on-cast amplifiers | Purphoros God of the Forge, Hellrider, Lurking Predators |

Sol Ring stays — it's a precon staple and explicitly exempt from the WotC Game Changers list.

---

## Per-deck swap spec

Each block is sized to be a self-contained Slice B edit (replace specific lines in `addAll(...)` calls). Card counts net to zero per deck so the 99-card mainboard target is preserved. `addEntryOrFallback` already handles missing-from-DB cases.

### White (Adeline) — `buildCommanderFallbackDeckWhite`, line 130

Pile shape unchanged: 36 Plains / 8 ramp / 6 draw / 30 creatures / 8 removal / 11 utility + commander.

**Cuts (8) — all from creature + utility lists:**

| Card | Reason | Source line |
|---|---|---|
| Honor of the Pure | Stacked anthem #2 | 174 |
| Spear of Heliod | Stacked anthem #3 | 175 |
| True Conviction | Stacked anthem (mass double strike) | 174 |
| Marshal's Anthem | Stacked anthem + recursion | 175 |
| Cathars' Crusade | Exponential snowball — game-warping | 178 |
| Anointed Procession | Token doubling — exponential | 177 |
| Hero of Bladehold | Anthem-on-attack + token bodies | 160 |
| Avacyn, Angel of Hope | Board-lock finisher (indestructible everything) | 165 |

**Adds (8) — vanilla-rate humans/angels with no synergy multiplier:**

| Card | Role |
|---|---|
| Dragon Hunter | 1-drop human (1W 2/1 prot-from-Dragon — M14; replaces "Steadfast Sentry" which is card-DB-uncertain) |
| Trueheart Duelist | 1-drop human (1W 2/1 first strike, mono-white — Kaldheim; replaces "Town Gossipmonger" which has {R} color identity in its transform face) |
| Veteran Armorsmith | 2-drop soldier (small body anthem, NOT global) |
| Veteran Swordsmith | 3-drop soldier (paired with Armorsmith above) |
| Crusader of Odric | 4-drop variable human |
| Cloudgoat Ranger | 5-drop one-shot tokens (no engine) |
| Serra Avenger | 3-drop flyer |
| Angel of Sanctions | 5-drop removal-ETB angel |

**Anthem kept:** Glorious Anthem (line 174) — the single +1/+1.

### Blue (Talrand) — `buildCommanderFallbackDeckBlue`, line 191

Pile shape unchanged: 36 Island / 8 ramp / 14 cantrips+draw / 16 removal+bounce / 15 creatures / 10 utility + commander. Talrand's drake-spam stays — just trim the most oppressive supports.

**Cuts (7):**

| Card | Reason | Source line |
|---|---|---|
| Cyclonic Rift | Game-Changer-list staple wipe | 217 |
| Treasure Cruise | Fast 3-card delve dig | 212 |
| Mind's Eye | Heavy draw engine | 235 |
| Coastal Piracy | Stacked draw-on-attack engine (with Bident in same deck) | 235 |
| Mystic Remora | Early-game overdraw engine | 234 |
| Stormtide Leviathan | Board-lock finisher (no creature attacks) | 227 |
| Inkwell Leviathan | Uncounterable shroud finisher | 226 |

**Adds (7):**

| Card | Role |
|---|---|
| Brainstorm | Cantrip (still drake fuel) |
| Snap | Bounce + untap 2 lands (drake fuel — replaces "Whirlpool Whelm" which is card-DB-uncertain) |
| Lay Claim | One-shot steal (no engine) |
| Mahamoti Djinn | 5/6 flyer top-end |
| Spire Owl | 2-drop scry-ETB flyer |
| Air Elemental | 4-drop vanilla flyer |
| Sphinx of Magosi | 6-drop top-end (no haste, no doubler) |

### Black (Drana) — `buildCommanderFallbackDeckBlack`, line 246

Pile shape unchanged: 36 Swamp / 8 ramp / 6 draw / 30 creatures / 8 removal / 11 utility + commander.

**Cuts (7):**

| Card | Reason | Source line |
|---|---|---|
| Whip of Erebos | Recursion + lifegain double-effect | 288 |
| Sanguine Bond | Combo half (with Vito or Exquisite Blood) | 290 |
| Vito, Thorn of the Dusk Rose | Combo half + drain payoff | 290 |
| Necropolis Regent | Exponential +1/+1 counter snowball | 277 |
| Sheoldred, Whispering One | Board-lock finisher (sac-each-turn) | 279 |
| Captivating Vampire | Steal-creature engine under tribal counter | 274 |
| Reaper from the Abyss | Forced-sacrifice each turn | 278 |

**Adds (7) — vanilla vampire bodies, no engine:**

| Card | Role |
|---|---|
| Markov Patrician | 3-drop 3/3 lifelink (mono-black vamp) |
| Falkenrath Noble | 4-drop drain on creature death (one-shot trigger, mono-black) |
| Bloodhunter Bat | 4-drop 2/2 flying ETB-drain (replaces "Falkenrath Marauders" which is RED — Falkenrath family is red) |
| Vampire Outcasts | 4-drop bloodthirst body (mono-black) |
| Phyrexian Rager | 3-drop 2/2 ETB-draw + 1 life loss (replaces "Markov Blademaster" which is RED) |
| Dusk Legion Zealot | 1-drop vampire soldier ETB-draw (replaces "Crossway Vampire" which is RED) |
| Bloodrite Invoker | 5-drop top-end vamp |

**Anthem kept:** Bad Moon (line 287) — the single global +1/+1.

### Red (Krenko) — `buildCommanderFallbackDeckRed`, line 303

The worst offender. Krenko himself is a tap-double engine — he stays — but every surrounding amplifier comes out.

Pile shape unchanged: 36 Mountain / 8 ramp / 6 draw / 30 creatures / 10 removal / 9 utility + commander.

**Cuts (9):**

| Card | Reason | Source line |
|---|---|---|
| Coat of Arms | Exponential tribal snowball | 347 |
| Purphoros, God of the Forge | 2-damage-per-token amplifier (lethal under Krenko) | 348 |
| Hellrider | Attack-trigger × N goblins (lethal under Krenko) | 333 |
| Hellkite Charger | Extra combat (Bracket 4 staple) | 337 |
| Goblin Bombardment | Token-sac ping engine (lethal under Krenko) | 347 |
| Hanweir Garrison | Extra-tokens-on-attack engine | 336 |
| Krenko's Command | Redundant token source (Krenko already does this exponentially) | 348 |
| Goldspan Dragon | Treasure ramp + double-on-target | 337 |
| Outpost Siege | Engine: extra draw OR extra burn each turn | 325 |

**Adds (9) — vanilla goblins + vanilla dragons:**

| Card | Role |
|---|---|
| Browbeat | 4-mana draw-or-burn (replaces Outpost Siege's draw slot; opponent-modal, not caster-modal — passes AI filter) |
| Goblin Cohort | 1-drop goblin |
| Goblin Heelcutter | 3-drop reach |
| Mogg Maniac | 1-drop reflect |
| Cinder Pyromancer | 2-drop ping |
| Volcanic Dragon | 5-drop haste flyer |
| Shivan Dragon | 6-drop classic flyer |
| Furnace Whelp | 3-drop dragon |
| Inferno Hellion | 6-drop trampler |

**Engine kept:** Goblin Chieftain (line 332) — the single tribal anthem (+1/+1 + haste, *not* exponential).

**Shape note:** Outpost Siege's draw slot is filled by Browbeat (above). The other 8 cuts (5 creatures + 3 utility) are replaced by 8 creatures, so the deck shifts slightly toward "more creatures, less utility" (33 creatures + 6 utility) vs. Hard's 30+9. Acceptable for goblin tribal feel.

### Green (Yeva) — `buildCommanderFallbackDeckGreen`, line 361

Pile shape unchanged: 36 Forest / 10 ramp / 6 draw / 30 creatures / 8 removal / 9 utility + commander.

**Cuts (9):**

| Card | Reason | Source line |
|---|---|---|
| Craterhoof Behemoth | One-shot lethal (Bracket 4 staple) | 393 |
| Avenger of Zendikar | Landfall-token engine + Overrun synergy | 393 |
| Apex Devastator | Cascade × 4 (top-deck quality engine) | 394 |
| Asceticism | Full board hexproof + regenerate (lock) | 402 |
| Lurking Predators | Free creatures from opp casts (engine) | 404 |
| Overrun | Mass combat-ending pump | 403 |
| Beastmaster Ascension | Anthem-under-counter (lethal swing) | 402 |
| Hornet Queen | 5-token deathtouch swarm | 393 |
| Terastodon | 3-permanent destroy + 6 tokens (mass disruption) | 394 |

**Adds (9):**

| Card | Role |
|---|---|
| Yavimaya Wurm | 5-drop trample |
| Vorapede | 5-drop vigilance/trample |
| Phantom Centaur | 4-drop pro-black |
| Giant Spider | 2-drop reach |
| Ravenous Baloth | 4-drop sac-for-life |
| Stingerfling Spider | 5-drop 2/4 reach with destroy-flying ETB (replaces "Silklash Spider" — that card has an X-cost activation, violating the AI-friendliness filter) |
| Loaming Shaman | 3-drop graveyard removal |
| Heart Warden | 1-drop sac-cantrip |
| Quirion Sentinel | 1-drop ETB-add-G elf (replaces "Charging Badger" which is card-DB-uncertain; Quirion Sentinel is already proven present — it's used in the bears-deck fallback) |

**Anthems kept (2 — Green's documented exception):** Garruk's Uprising (anthem + draw-on-cast) AND Nylea, God of the Hunt (anthem + trample-grant activation). Both are static +1/+1 effects — modest, no exponential or stacking. Green keeps two because both also serve secondary roles (Garruk's = draw, Nylea = trample) and Yeva's deck has no other "bigness" payoff. Test threshold for `medium_atMostNAnthemsPerDeck` raises to N=2 to accommodate; other 4 colors stay at 1.

**Protection kept:** Heroic Intervention — single-cast, no lock.

---

## Risks / open questions for Slice B

1. **Color-identity check on Adds.** Some replacements above (especially `Whirlpool Whelm`, `Browbeat`) need a Scryfall color-identity check before commit — hybrid mana would silently get substituted to basic land via `addEntryOrFallback`. If three cards in a row substitute, the deck shape is damaged silently. Slice B should grep Scryfall (or the local card DB) before committing each.
2. **Card-DB completeness.** Each Add must exist in the local repository. The `addEntryOrFallback` substitution preserves count but quietly damages deck quality. Slice B should run a one-shot test that builds each rebalanced deck and asserts substitution count ≤ 1 per deck.
3. **Power-balancing across colors.** Even at Bracket 2-3, Talrand is still a self-engine commander (each spell → drake). Krenko is still self-doubling. White and Black don't have that — their commanders are anthems-on-trigger. There may be residual asymmetry — flag it after live-testing post-Slice C/D/E (when the user resumes WebApi runs).
4. **Curve verification.** Each deck's mana curve will shift slightly with the swaps (cuts skew expensive→mid, Adds skew mid→mid). Slice B should print the per-CMC histogram before and after as a sanity check.
5. **Fallback commander lists unchanged.** None of the 5 fallback ladders (Linden / Patron / Mikaeus / Etali / Ezuri etc.) are touched by this spec. Their power level is already inside the target range or close enough.

## Test plan for Slice B

- New JUnit test: `AiDeckLibraryRebalanceTest` — builds all 5 decks, asserts:
  - Mainboard count = 99 per deck
  - Sideboard = exactly 1 commander per deck
  - At most 1 substitution per deck (i.e., at most 1 `addEntryOrFallback` log warning)
  - At most 1 anthem per deck (regex: card name matches anthem allow-list)
  - No card from the Bracket-4 disallow list appears in any deck
- Existing `AiDeckLibraryTest` (or wherever the build-fallback tests live) keeps passing unchanged.

## Next slices

- **Slice B** — apply this spec as ~50 line edits across 5 deck builders inside `AiDeckLibrary.java`. Standard tier. Critic = AI-aware + Magic-rules expert per the durable rule.
- **Slice C** — refactor `AiDeckLibrary` into per-format files (mandatory before D/E to clear the 500-LOC hard cap).
- **Slices D, E** — 10 Pauper + 10 Standard AI decks per the locked plan.
