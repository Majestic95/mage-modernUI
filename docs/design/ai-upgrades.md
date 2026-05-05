# AI Upgrades — From "Plays Legally" to "Plays Like a Human"

> **Status:** living doc. AI-8.0 (skeleton + lowest-life targeting) shipped 2026-05-05.
> Source: parallel research from an xmage-AI-internals expert agent and a
> Commander-format strategy expert agent, synthesized 2026-05-05. See the
> commit message of AI-8.0 for the full context.

## Background — why this matters

Our fork uses xmage's stock `COMPUTER_MAD` AI (a minimax planner originally
designed for Standard / Modern / Legacy 1v1) as the default for Commander
games. It plays the format **legally** — the AI-7 audit slice locked down
color identity, banlist, singleton, and 99-card legality at CI time — but
it almost certainly plays it **badly** because it doesn't know what makes
Commander, well, Commander.

This document captures the upgrade menu produced by a parallel two-agent
research pass on 2026-05-05, prioritized by impact / effort, and tracks
which items have shipped vs. are queued.

## The headline finding

The AI has **three structural problems** that compound in Commander:

1. **It only models ONE opponent.** Literally — the evaluator at
   [`GameStateEvaluator2.java:35`](../../Mage.Server.Plugins/Mage.Player.AI/src/main/java/mage/player/ai/score/GameStateEvaluator2.java#L35)
   does `getOpponents(playerId, false).stream().findFirst()`. In a 4-player
   pod the AI is optimizing for whichever opponent the iterator returned
   first, not the actual threat. There's a `// TODO: add multi opponents support`
   comment on line 32 that's been sitting there for years.
2. **It only attacks the FIRST opponent.** Same pattern at
   [`SimulatedPlayer2.java:240`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/SimulatedPlayer2.java#L240)
   — `getOpponents(playerId, true).iterator().next()`. The AI literally
   cannot evaluate "should I attack player A or player B?"
3. **Zero Commander format awareness.** No commander damage tracking, no
   command zone modeling, no awareness that 21 commander damage is a
   separate clock. No recast-tax decision. No color-identity reasoning
   about removal threats.

Everything in **Tier 1** below is structural fixes for these three.

## Architecture — how upgrades are delivered

We do **not** modify upstream. Per CLAUDE.md hard constraint, all work lives
in our own module via subclass overrides. The mechanism:

1. New subclass extending `ComputerPlayerControllableProxy` (which extends
   `ComputerPlayer7`) under `Mage.Server.WebApi/src/main/java/mage/webapi/ai/`.
2. Match the constructor signature exactly: `(String name, RangeOfInfluence range, int skill)`.
3. After `EmbeddedServer.boot()` finishes the upstream-driven `loadPlugins(config)`
   call, register our subclass via
   `PlayerFactory.instance.addPlayerType("Computer - mad", CommanderComputerPlayer7.class)` —
   this OVERWRITES the default registration since `addPlayerType` is keyed by
   `PlayerType` enum.
4. Override only public methods. Private/protected upstream surface is not
   touched (rebase fragility).

### What this buys us

A single line in `EmbeddedServer.boot()` hijacks every "Computer - mad" seat
in every game on our server. No new `PlayerType`, no upstream config edit,
no schema change. The cost: every upstream rebase needs a quick check that
the methods we override still exist with compatible signatures.

## Tier 1 — Quick wins (~1 week split across 2-3 slices)

| # | Upgrade | Effort | Impact | Status |
|---|---|---|---|---|
| 1 | **Lowest-life targeting** — bias single-opponent harmful spells/abilities toward the player at lowest life | Half-day | **Large** | ✅ AI-8.0 |
| 2 | **Commander damage tracking + finisher bias** — score targets by `min(life, 21 - cmdDamageDealt)`; whoever is closer to losing by either clock gets picked | Half-day | Medium-large | ✅ AI-8.1 |
| 3 | **Don't recast commander into tax hell** — drop spell-ability when commander tax ≥ 8 (= died 4+ times) before invocation | 1 day | Medium | ✅ AI-8.3 |
| 4 | **Don't wipe your own board** — drop board-wipe spell-ability when our creature count ≥ each opponent's max AND we have ≥ 2 creatures | 1 day | Medium | ✅ AI-8.3 |
| 5 | **Lethal short-circuit** — when `CombatUtil.canKillOpponent` says yes, just attack instead of 12s of search | Half-day | Small but visible | Queued (AI-8.2) |
| 6 | **AI activity telemetry** — count actions vs priority handoffs per (turn, AI player); WARN when ≥20 passes occur within one turn with 0 actions (empty-tree bug signature) | Half-day | Diagnostic | ✅ AI-8.2 |

**Tier 1 total when complete:** ~5 days, "turns the AI from comically bad
to passably casual" per the Commander expert agent.

## Tier 2 — Real lift (~1 week)

These are the upgrades the upstream maintainers' own TODOs flag as
most-wanted but never built. Build only after Tier 1 is shipped.

| # | Upgrade | Effort | Impact |
|---|---|---|---|
| 7 | **Multi-opponent evaluator** — wrap `GameStateEvaluator2.evaluate` to sum all opponents weighted by threat (low life × 1.5, big board × 1.2, has commander out × 1.3) | 1-2 days | **Large** — structural fix for problem #1 |
| 8 | **Hand quality scoring** — replace `handSize × 5` with sum of `cardScore × 0.4`; drawing a Craterhoof no longer worth the same as drawing a Forest | 1 day | Medium |
| 9 | **Removal conservation** — only fire removal when threats-on-board ratio is high or target is lethal-next-turn | 1-2 days | Medium |
| 10 | **Smarter mulligans** — keep hands by curve + color castability; aggressively mull bad hands; commander-aware | 1 day | Small-medium |

After Tier 2 the Commander expert estimates "~60% of the gap to a
competent casual player." Diminishing returns kick in past this without
changing AI architecture.

## Tier 3 — Conditional (~1 week, only if Tier 1+2 still feels weak)

| # | Upgrade | Notes |
|---|---|---|
| 11 | **Multi-opponent attack enumeration** — subclass `SimulatedPlayer2` so combat sim considers each opponent as defender | Deeper version of Tier 1 #1; medium effort |
| 12 | **Reactive priority** — actually hold mana on opponents' turns to cast counters/instants | Large effort; only matters IF the deck has counterspells/instants. **Probably skip until we ship a control deck** — current AI decks have zero counters by design. |
| 13 | **Smarter X-cost spells** — pick X = lethal-on-target instead of random | Small effort; only matters for X-cost cards. **Probably skip** — current AI decks have ~zero X-spells. |

## What NOT to do (both research agents independently flagged)

- ❌ **Rewrite the simulation tree.** 20+ days for ~10% strength gain over
  current MAD. The minimax/alpha-beta core is load-bearing and full of
  subtle interactions.
- ❌ **Fix the upstream empty-tree bug at its root.** The
  `// TODO: root can be null again` comment at
  [`ComputerPlayer7.java:119`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/ComputerPlayer7.java#L119)
  has been there for years. Nobody knows why. Our skill=4 mitigation is
  the right shape. Tier 1 #6 (telemetry) lets us measure how often it
  actually fires.
- ❌ **Reach for ML.** Training a value network on Magic positions is a
  year-long research project. The gap between "current MAD" and
  "MAD + Tier 1+2" is bigger than the gap to a trained model would be.
- ❌ **Teach bargaining, bluffing, combo assembly, or true long-horizon
  patience.** These need opponent modeling + deck semantic annotation —
  a different AI architecture entirely. Out of reach with heuristics.
- ❌ **Modify `Mage.Player.AI.MA/...` directly even if "just one line."**
  CLAUDE.md hard constraint #2. Every fix must live in our own module
  via subclass.

## Why the iterator-first-opponent bug exists upstream

It's not laziness — it's that 1v1 is the default game shape for
competitive Magic and the entire upstream evaluator was built around
zero-sum 1v1. Multiplayer support is structurally bolt-on. The TODOs
have lived in the codebase for years because fixing them well requires
threat-weighted evaluation infrastructure that doesn't exist (and would
take weeks to build properly). Our heuristic-first approach (Tier 1)
gives ~80% of the visible improvement without the infrastructure cost.

## Appendix — key file paths

### Upstream AI (read-only)
- [`ComputerPlayer7.java`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/ComputerPlayer7.java) — entry point (MAD)
- [`ComputerPlayer6.java`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/ComputerPlayer6.java) — minimax/alpha-beta sim engine
- [`SimulatedPlayer2.java`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/SimulatedPlayer2.java) — opponent modeling, attacker enumeration
- [`ComputerPlayerControllableProxy.java`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/ComputerPlayerControllableProxy.java) — what the factory actually registers (extends ComputerPlayer7 + adds human-takeover hooks)
- [`CombatUtil.java`](../../Mage.Server.Plugins/Mage.Player.AI.MA/src/mage/player/ai/util/CombatUtil.java) — lethal detection helper
- [`ComputerPlayer.java`](../../Mage.Server.Plugins/Mage.Player.AI/src/main/java/mage/player/ai/ComputerPlayer.java) — base class (mulligan, X values)
- [`GameStateEvaluator2.java`](../../Mage.Server.Plugins/Mage.Player.AI/src/main/java/mage/player/ai/score/GameStateEvaluator2.java) — board-state scorer (the one file to read first)
- [`ComputerPlayerMCTS.java`](../../Mage.Server.Plugins/Mage.Player.AIMCTS/src/mage/player/ai/ComputerPlayerMCTS.java) — MCTS comparator
- [`PlayerFactory.java`](../../Mage.Server/src/main/java/mage/server/game/PlayerFactory.java) — registration mechanism

### Our fork (where new subclasses + evaluators live)
- `Mage.Server.WebApi/src/main/java/mage/webapi/ai/CommanderComputerPlayer7.java` — Tier 1 subclass
- `Mage.Server.WebApi/src/main/java/mage/webapi/embed/EmbeddedServer.java` — boot-time override registration
- `Mage.Server.WebApi/src/test/java/mage/webapi/ai/CommanderComputerPlayer7Test.java` — Tier 1 tests

### Prior decisions
- [`docs/decisions/mad-ai-no-plays-recon.md`](../decisions/mad-ai-no-plays-recon.md) — empty-tree bug recon (slice 47); skill=4 cliff rationale
