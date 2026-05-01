# Multiplayer Commander Interaction Frequency

**Status:** Living document
**Last reviewed:** 2026-05-01
**Scope:** 4-player FFA Commander (the playtest format). Extends ADR 0008
which is 1v1-scoped.

## Purpose

A frequency-ranked catalog of player-input prompts in 4-player Commander.
Drives priority of dialog/UI work — top-10 must work for the format to be
playable; long tail can be deferred.

**This is not a callback catalog.** For the full engine→wire callback
contract, read [ADR 0008 §1](../decisions/0008-player-interactions.md).
This doc only adds the multiplayer + frequency lens.

## Methodology

Rankings are hand-graded against typical 4p Commander gameplay. Future
iterations should regenerate from instrumented playtest logs (count
prompt-fires per `WebSocketCallbackHandler.mapToFrame` method per
session). Until then: opinion + experience.

## Frequency tiers

- **HIGH** — fires every game, often many times per turn cycle
- **MEDIUM** — fires most games, several times per game
- **LOW** — fires some games
- **RARE** — occasional / niche / specific archetype

---

## TOP-10 (must work for playable Commander)

### 1. Basic targeting — HIGH
Pick one legal target — creature, player, planeswalker, permanent, card in a zone.

- **Engine path:** `chooseTarget(Outcome, Target, ...)` → `fireSelectTargetEvent` Set\<UUID\> overload at `GameImpl#fireSelectTargetEvent(UUID, MessageToClient, Set<UUID>, boolean, Map)`. See [ADR 0008 §1.28](../decisions/0008-player-interactions.md).
- **Wire shape:** `WebGameClientMessage.targets[]` populated with eligible UUIDs; `cardsView1` empty.
- **Examples:** Swords to Plowshares, Path to Exile, Lightning Bolt, Beast Within, Pongify.
- **Edge cases:**
  - **Hexproof / shroud / protection** filter `possibleTargets` AT TARGET-SELECTION (CR 702.11, 702.18, 702.16). The legal-set is pre-filtered server-side; the renderer just renders the set it gets.
  - 4-player: target list must distinguish all opponents (color-coded seat).
  - Targeting yourself is selectable when legal (Vampiric Tutor, Necropotence).

### 2. Mana payment — HIGH
Pay generic + colored cost from available mana sources.

- **Engine path:** `playMana(Ability, ManaCost, ...)` loop. Distinct from priority — see [ADR 0008 §1.34](../decisions/0008-player-interactions.md).
- **Wire shape:** `gamePlayMana` frame with `message` describing remaining cost.
- **Response shapes (multiple):** UUID (click permanent), Boolean (cancel), String "special" (Convoke/Improvise/Delve), ManaType (spend pool orb).
- **Examples:** Sol Ring, Arcane Signet, Command Tower, fetchlands, Mana Crypt.
- **Edge cases:**
  - Phyrexian mana ({W/P}) → life-or-mana choice.
  - Hybrid mana ({2/W}, {U/B}) — auto-pay vs manual prompt for which color.
  - Snow mana, color-restricted costs, Convoke (creatures as mana), Delve (graveyard exile).
  - Floating mana between phases (rare in Commander but possible).

### 3. Yes/no with stickies — HIGH
Optional triggered abilities and "may" effects. **Stickies are critical for playability** in Commander.

- **Engine path:** `chooseUse(Outcome, message, ...)` → `gameAsk` frame.
- **Examples:** Smothering Tithe (each opponent's draw — fires 3+ times per turn cycle), Rhystic Study, Esper Sentinel, Mystic Remora upkeep.
- **Edge cases:**
  - **MUST support "Always Yes / Always No for this turn / this game" stickies** — without these, Smothering Tithe alone makes the format unplayable on web (60+ prompts per game).
  - Prompt should show *who's casting what* so opponents can decide whether to pay.
  - Some chooseUse paths show different button labels (Mulligan/Keep, Pay/Decline).

### 4. Declare attackers (multi-defender) — HIGH
Choose which creatures attack and which player/planeswalker each attacks.

- **Engine path:** `selectAttackers(Game, attackingPlayerId)` + per-attacker `chooseTarget` for defending player/planeswalker.
- **Wire shape:** `gameSelect` + `POSSIBLE_ATTACKERS` option list.
- **Examples:** every commander swing, Craterhoof Behemoth, Edric incentives.
- **Edge cases:**
  - **In 4p, choosing which opponent to attack is the core political decision.** UI must surface commander damage threat per defender.
  - Goad forces attacks to non-controllers (CR 701.39).
  - Must-attack effects (Lightmine Field, Grand Melee), can't-attack restrictions, planeswalkers as defenders.

### 5. Declare blockers + damage order — HIGH
Assign blockers; multi-block damage ordering.

- **Engine path:** `selectBlockers(Ability, defendingPlayerId)` + `getMultiAmount` for damage assignment.
- **Edge cases:**
  - **Damage-order assignment** for multi-block (CR 509.2, 510.1c): defender picks block ORDER per attacker; attacker picks HOW MUCH damage to assign respecting that order.
  - Trample: lethal-damage minimum to each blocker before excess goes to player; deathtouch = 1 damage = lethal (CR 702.19b, 702.2c).
  - First/double strike → re-fires the damage step.
  - Menace = must assign ≥2 blockers.

### 6. Trigger order APNAP — HIGH
When multiple triggers go on the stack at once, active player orders theirs first, then each opponent in turn order (CR 101.4).

- **Engine path:** `chooseTriggerOrder(...)` — abilities list as `cardsView1`, `flag=true`. See [ADR 0008 §1.29](../decisions/0008-player-interactions.md) (note: same callback as ability picker).
- **Examples:** Boardwipes (every "dies" trigger fires), mass ETB (Avenger of Zendikar landfall), stacked upkeep triggers (Smothering Tithe + Rhystic Study + Mystic Remora).
- **Edge cases:**
  - A single player with 3+ triggers needs an ordered-list UI, **not 3 sequential popups**.
  - After a Wrath in a stax pod, this can fire 8+ times in succession.
  - Auto-order toggles (TRIGGER_AUTO_ORDER_*) suppress these prompts.

### 7. Library look + scry/surveil — HIGH
Look at top N, partition into top/bottom (or top/graveyard), then order the top group.

- **Engine path:** `choose(Outcome, Cards, TargetCard, ...)` → `fireSelectTargetEvent` Cards overload. **Two-phase:**
  1. **Partition** — `choose` with `min=0, max=N` to select cards going to bottom (scry) or graveyard (surveil).
  2. **Order** — if 2+ cards remain on top, a follow-up `choose` to order them (CR 701.27 for scry, 701.42 for surveil).
- **Wire shape:** `gameSelect` with `cardsView1` populated. `min/max` distinguishes from "pick exactly K" (Fierce Empath has min=max=1).
- **Examples:** Brainstorm (look 3, return 2 to top in any order), Ponder, Preordain, Serum Visions, Thought Scour (surveil), Sensei's Divining Top, Sylvan Library.
- **Edge cases:**
  - **Scry:** each card individually goes top OR bottom, then the top group is reorderable.
  - **Surveil:** each card individually goes top OR graveyard, then the top group is reorderable.
  - **Plain "look at top N":** order matters, no graveyard/bottom option.
  - The UI must distinguish these three flows — they look similar but have different valid actions.

### 8. Search library (tutor) — HIGH
Search library for a card matching criteria, reveal (or not), shuffle.

- **Engine path:** `choose(Outcome, Cards, TargetCard, ...)` over filtered library list. Same Cards overload as scry, but `min=max=1` (or N for "search for up to N").
- **Wire shape:** `cardsView1` is the pre-filtered legal subset.
- **Examples:** Demonic Tutor, Vampiric Tutor, Cultivate, Kodama's Reach, Fierce Empath, Eladamri's Call, fetchlands.
- **Edge cases:**
  - Filter UI must show only legal cards (mana value 6+ for Fierce Empath, creature type X, basic land for fetch). **Pre-filtered server-side**, so the wire's `cardsView1` already contains only legal results.
  - Failure-to-find allowed for most tutors but not all.
  - Reveal vs hidden after picking.

### 9. Cast commander from command zone — HIGH (Commander-specific)

- **Engine path:** Cast flow with {2}-tax adjusted cost in `playMana`. Tax tracked per-cast.
- **Frequency:** every game has 4-12 commander casts (across all 4 players). **Promoted to top-10 from "RARE" because Commander format demands it.**
- **Edge cases:**
  - **Partner / Background commanders** (CR 702.124) — TWO commanders in command zone, each with own tax counter. Webclient must support `commanderIdentities: List<UUID>` not single UUID (Bug 4 fix dependency).
  - Companion declaration at game start (CR 702.139) — distinct callback at pre-game.
  - **Commander damage tracking** (CR 903.10) — 21 combat damage from a single commander to one player = loss. Tracked per-source-per-defender; required field on `WebPlayerView`.
  - **"Dies → command zone instead?"** replacement (CR 903.9) — controller chooses post-2020-rules; `chooseUse` fires.

### 10. X-cost / amount — MEDIUM-HIGH
Pick X when casting/activating, or pick a number.

- **Engine path:** `announceX(min, max, ...)` for X spells; `getAmount(min, max, ...)` for generic.
- **Wire shape:** `gameSelectAmount` or `gamePlayXMana` frame with `min`, `max`.
- **Examples:** Hydroid Krasis, Comet Storm, Genesis Wave, Walking Ballista, Exsanguinate, Crackle with Power.
- **Edge cases:**
  - Max-X bounded by available mana (UI defaults to "pay all").
  - With cost reducers (Heartless Summoning, Goreclaw), mana floor changes mid-prompt.
  - {X}{X}{X} casts.
  - Distribute-as-resolve (Comet Storm = X *and* divide) collapses with #11.

---

## MEDIUM (most games)

### 11. Modal spells / charms
- **Engine path:** `chooseMode(Modes, ...)` → `gameChooseAbility` (note: same callback as ability picker, distinguished by data shape).
- **Examples:** Cryptic Command, Mystic Confluence (3 modes, may pick same twice), Esper Charm, Atarka's Command, Kolaghan's Command.
- **Edge cases:** Confluence-style "choose three, may repeat." Escalate. Targets per mode resolved together — UI must collect all targets before going on stack.

### 12. Sacrifice as cost
Sacrificing your own permanents as part of cost or resolution.

- **Engine path:** `chooseTarget` with controlled-permanent filter (cost) OR `choose(Outcome, Target, ...)` (effect — Diabolic Edict makes defender choose).
- **Examples:** Birthing Pod (sac creature, search), Phyrexian Tower, Ashnod's Altar, Diabolic Edict, Innocent Blood, Solemn Simulacrum.
- **Edge cases:** Free vs cost-to-activate distinction. Defending player chooses for "edict" effects, not the caster.

### 13. Discard from hand
- **Engine path:** `choose(Outcome, Cards, TargetCard, ...)` over your hand (or random for Mind Twist).
- **Examples:** Faithless Looting, Liliana of the Veil, Wheel of Fortune, Thoughtseize (opponent picks).
- **Edge cases:** Random discard needs server-side RNG. **Madness alt-cost** triggers on discard (CR 702.34).

### 14. Activated ability mode/cost
- **Engine path:** `chooseAbility(...)` when multiple abilities exist + cost-payment prompts follow.
- **Examples:** Skullclamp equip cost, planeswalker loyalty abilities, Birthing Pod, Walking Ballista.
- **Edge cases:** UI must list each separately when permanent has multiple activated abilities (Mishra's Workshop, Karakas, planeswalkers).

### 15. Replacement effects ordering
- **Engine path:** `chooseReplacementEffect(...)` → `gameChooseChoice`.
- **Examples:** Doubling Season + Hardened Scales (CR 616.1 — order matters: DS→HS = 4 counters vs HS→DS = 3); Leyline of the Void + Rest in Peace (both replace death-to-graveyard).
- **Edge cases:** Self-replacing effects only apply once each. "As it enters" choices are CHOICE prompts, not replacement-orderings.

### 16. Counterspell / stack targeting
- **Engine path:** `chooseTarget` with stack-object filter.
- **Examples:** Counterspell, Force of Will, Mana Drain, Swan Song, Stifle (target ABILITY not spell — different filter).
- **Edge cases:** Counter-spell vs counter-ability vs counter-creature-spell filters. Splice/copy/X still resolves trigger-wise on countered spells. Chained counterwars need stack visualization.

### 17. ETB choice (as it enters)
- **Engine path:** `choose(...)` or `chooseMode(...)` invoked at ETB.
- **Examples:** Thespian's Stage / Vesuva (copy a land), Glasspool Mimic / Phantasmal Image (copy a creature), Maze of Ith targeting, Chord of Calling X.

### 18. Cycle / Channel / activated discard alt-costs
- **Engine path:** `activateAbility` with discard-as-cost.
- **Examples:** Cycling lands, Shefet Dunes, Moss-Pit Skeleton (channel), Renewing Dawn.
- **Edge cases:** All collapse under #14 routing.

---

## LOW (some games)

### 19. Distribute damage / counters
Variable targets, distribute amount.

- **Engine path:** Multi-target collection + per-target `getMultiAmount`.
- **Examples:** Crackle with Power, Fight with Fire, Lightning Storm.
- **Edge cases:** "Any number including zero" — UI must allow zero. Per-target slider summing to X.
- **CRITICAL:** `GAME_GET_MULTI_AMOUNT` is currently NOT WIRED in the WebApi mapper (see [ADR 0008 §1.37](../decisions/0008-player-interactions.md)). All distribute-damage spells hang.

### 20. Hand reveal / opponent picks
- Thoughtseize, Inquisition (full hand reveal then opponent's `choose`).
- Random discard (Hymn to Tourach) — server picks.

### 21. Vote (multiplayer-specific)
- **Engine path:** Looped `chooseTarget` (per-permanent vote) OR `choose(Choice)` (named-option vote) OR `chooseUse` (binary). Council's Judgment is per-permanent, not per-name.
- **Examples:** Council's Judgment, Coercive Portal, Plea for Power, Magister of Worth, Brago's Representative.
- **Edge cases:** Must collect all 4 votes before resolution. Brago's Representative shifts a vote. UI shows running tally per card rules.

### 22. Aura / Equipment attach choice
- **Engine path:** `chooseTarget` with attachment-legal filter.
- **Examples:** Lightning Greaves equip, Sword of Feast and Famine, Rancor (returns on removal), Bestow casts.
- **Edge cases:** Aura with invalid target on resolve = state-based to graveyard. **Bestow** (CR 702.103): cast as enchantment with creature-target, becomes creature when **unattached** (host dies, host loses creature type, aura is bounced — ANY unattach event, not just "host dies").

### 23. Flicker / exile-and-return
- Exiled-and-returned is a **new object** — auras fall off, +1/+1 counters lost, summoning sickness resets. Tokens cease to exist.
- Examples: Cloudshift, Ephemerate, Conjurer's Closet, Eldrazi Displacer.

### 24. Pile pick (Fact or Fiction)
- **Engine path:** `choosePile(Outcome, msg, p1, p2, ...)`.
- **CRITICAL:** `GAME_CHOOSE_PILE` NOT YET WIRED ([ADR 0008 §1.30](../decisions/0008-player-interactions.md)). Fact or Fiction hangs.

---

## RARE (occasional / niche)

### 25. Suspend / foretell / plot / adventure
Exile-with-counter alt-costs. Routes through `activateAbility` + cast-from-exile. Examples: Lotus Bloom, Brazen Borrower (adventure half), suspend resume.

### 26. Monarch / initiative / day-night / ring tempts you
State-based passive features. Ring tempts = `chooseMode` with 4 escalating modes. Day/Night flips automatically based on prior turn's spell count (no prompt, just state — CR 726).

### 27. Copy spells with new targets
Twincast, Reverberate, Fork. `chooseUse` (change targets?) + `chooseTarget` if yes.

### 28. Redirect targets
Misdirection, Deflecting Swat, Bolt Bend. `chooseTarget` with "different legal target" constraint.

### 29. Mana ability stack-bypass (CR 605.3a)
Mana abilities don't use the stack and skip `priority`. Routed through `activateAbility` shortcut. Worth noting: Cabal Coffers, Crypt Ghast tap-trigger paths.

### 30. Cascade
`chooseUse` ("cast for free?"). Rare in vanilla Commander but high-impact (Maelstrom Wanderer commanders).

---

## Critical UI investments (what we MUST build for Commander to be playable)

Ordered by blocking impact:

1. **Yes/No stickies** (#3) — without "Always Yes / No this turn" toggles, Rhystic / Tithe / Sentinel are unplayable. ~half day.
2. **Card-grid renderer for `cardsView1`** (#7, #8, #13) — single fix unblocks library search, scry, surveil, discard. ~1 day. **Currently a stub** at `webclient/src/game/dialogs/SelectDialog.tsx`. See [slice 70-Y](../decisions/slice-70-Y-click-resolution.md) for the planned conversion.
3. **Wire `GAME_GET_MULTI_AMOUNT` + `GAME_CHOOSE_PILE`** (#19, #24) — currently fall through and return null in `WebSocketCallbackHandler.mapToFrame`, hanging trample damage assignment + Fact or Fiction. ~half day server-side + half day per client renderer.
4. **Commander identity + damage tracking** (#9) — `WebPlayerView.commanderIdentities: List<UUID>` (Partner support) + `commanderDamage: Map<UUID, Map<UUID, Integer>>`. Schema bump 1.24 → 1.25. ~1 day.
5. **Multi-defender attack target picker** (#4) — currently the per-attacker defender choice is unclear. ~half day.
6. **Trigger-order list UI** (#6) — exists per [ADR 0008 §1.29](../decisions/0008-player-interactions.md) but verify it handles 3+ triggers from one player as ordered list, not sequential popups.

## Maintenance

When upstream xmage adds a new mechanic with a new prompt shape, add a row.
When a prompt shape changes (rare), update the rules-correctness notes.
When playtest evidence contradicts a frequency rank, regenerate from logs.

When a card breaks for a reason that maps to one of these rows, that's a bug
in the corresponding implementation, not a missing row in this doc.

## See also

- [ADR 0008](../decisions/0008-player-interactions.md) — canonical engine→wire callback catalog (1v1-scoped).
- [Slice 70-Y](../decisions/slice-70-Y-click-resolution.md) — planned conversion of dialog popups to click-to-resolve.
- [docs/design/gap-inventory-2026-04-29.md](gap-inventory-2026-04-29.md) — design-system gap audit.
- [Slice 70-X.14](../decisions/slice-70-X.14-engine-gaps.md) — bug triage and fix order from the 2026-04-30 multi-agent review.
