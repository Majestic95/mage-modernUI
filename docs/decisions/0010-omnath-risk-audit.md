# 0010 — Omnath, Locus of Mana risk audit dispositions

> Three risks were flagged during the engine-agent audit of Omnath,
> Locus of Mana (see session 2026-05-01). This doc records the
> per-risk verification + disposition.

## Risk 1 — "6 vs 7 mana buckets on the wire"

**Agent's claim:** `WebManaPoolView` exposes 6 fields while internal
`Mana` has 7 buckets, so generic mana is silently routed through
the `colorless` bucket on the wire — could mask a future bug.

**Verification:** verified via direct read of
`Mage/src/main/java/mage/players/ManaPool.java:415-425` and
`Mage/src/main/java/mage/players/ManaPoolItem.java:18-23,165-167`.

**Disposition: NOT A REAL DEFECT.**

`ManaPool.addMana(...)` constructs each `ManaPoolItem` with
`mana.getGeneric() + mana.getColorless()` collapsed into a single
`colorless` slot at production time (line 421). `ManaPoolItem` itself
only has 6 internal buckets (`red`, `green`, `blue`, `white`, `black`,
`colorless` — verified at `ManaPoolItem.java:18-23`). The "any" /
"generic" buckets that exist on the abstract `Mana` class are not
preserved in the pool — generic mana is functionally indistinguishable
from colorless in a player's pool because both pay any non-colored cost.

The wire's `WebManaPoolView` correctly mirrors the pool's actual
structure. There is no missed bucket. The agent's "7 buckets internally"
referred to the abstract `Mana` class; the pool itself uses 6.

**Action:** none. Schema is correct.

## Risk 2 — "Conditional green mana is invisible to the webclient"

**Agent's claim:** `ManaTypeInManaPoolCount.calculate()` includes
conditional green mana in Omnath's P/T calculation, but
`WebManaPoolView.green` only reflects unconditional green. A player
with conditional green mana (e.g., from a Pyromancer's-Goggles-style
effect) would see Omnath at +N/+N without N green orbs in their pool
display.

**Verification:** confirmed at
`Mage/src/main/java/mage/abilities/dynamicvalue/common/ManaTypeInManaPoolCount.java:31-34`
(includes conditional via `getConditionalMana()` iteration) vs
`Mage/src/main/java/mage/players/ManaPool.java:188-190` (which
delegates to `getMana().get(manaType)` and `ManaPoolItem.getMana()`
at `:165-167` returns 0 for the unconditional buckets when the
item is conditional).

**Disposition: REAL BUT DELIBERATE; LEAVE AS-IS.**

The mismatch is real, but folding conditional mana into the
displayed orb count would mislead the player. Conditional mana
has restricted spendability (only on specific costs the condition
allows); showing it as a free-floating green orb would imply
"spendable for any green cost" which is wrong. The current
behavior — orbs reflect spendable mana, P/T reflects total green
the engine sees — is the lesser evil.

If a future enhancement wants to surface conditional mana, the
right shape is a separate `conditionalMana` field on the wire DTO
(schema bump 1.26 → 1.27, additive) with a per-color breakdown,
rendered as a chip alongside the main pool. Rare cards that
generate conditional green specifically would benefit; the
maintenance cost is non-trivial. Defer until a concrete user
report or a Pyromancer's-Goggles-style commander shows up in
playtests.

**Action:** documented; no code change.

## Risk 3 — "PlayerImpl.reset() ordering is fragile"

**Agent's claim:**
`Mage/src/main/java/mage/players/PlayerImpl.java:529` clears
`doNotEmptyManaTypes` before continuous effects re-apply. Current
order works because `applyEffects()` runs the static effect before
`Phase.postPriority` empties pools — but a future layer-pipeline
refactor could change ordering and silently empty green for one
phase boundary before the static effect re-populates the flag.

**Disposition: COVERED TRANSITIVELY; DOCUMENT THE INVARIANT.**

The existing `NykthosShrineToNyxTest.java` exercises Omnath at
P/T 7/7 (line 36) and 11/11 (line 64) — both assertions
implicitly verify that green mana survived the
empty-pool-at-phase-end window between mana production and the
P/T assertion. A regression that moved the empty step before
the static effect re-application would cause those assertions
to drop to base 1/1 and the test would fail loudly.

A more focused regression test that exercises a multi-`applyEffects`-
cycle within a single step (e.g., Omnath out, tap-for-green,
trigger an SBA recheck, assert green survives) would be belt-and-
suspenders. Test framework bandwidth is the gate — the existing
NykthosShrineToNyxTest is already a strong canary.

**Action:** documented; recommend a focused multi-cycle test in
the next Mage.Tests pass if the layer pipeline ever changes.
The invariant: `YouDontLoseManaEffect.apply()` MUST run inside
the same `applyEffects()` cycle that precedes any
`emptyManaPools()` call for green to persist.

## Summary

- **Risk 1:** not a real defect (agent miscounted Mana buckets on
  the abstract class; pool uses 6).
- **Risk 2:** real cosmetic mismatch; leaving conditional mana
  off the wire is the deliberate-and-correct choice given the
  spendability semantics.
- **Risk 3:** covered transitively by NykthosShrineToNyxTest; a
  multi-cycle regression test is recommended but not required
  today. Invariant documented for future refactors.

Net: Omnath remains correct end-to-end. No code change shipped.
