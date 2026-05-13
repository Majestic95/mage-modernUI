# Airbend (keyword) — How To Use

> **Mechanic text:** *"Airbend target creature"* = *"Exile target creature. Until further notice, its OWNER may cast it from exile for {2}."*

## 🚨 The biggest gotcha

The "cast for `{2}`" permission goes to the **OWNER** of the exiled creature, NOT the player who cast the Airbend spell.

If you're the player who AIRBENDED an opponent's creature, you **can't** cast it back. You just removed a threat for now. **Your opponent** (the creature's owner) gets the option to bring it back for cheap on their next turn.

## Concrete example

- **Alice** controls Grizzly Bears (it started in Alice's deck — Alice is the owner).
- **Bob** casts Airbending Lesson, targeting Grizzly Bears.
- Grizzly Bears is exiled.
- On her next main phase, **Alice** can cast Grizzly Bears from exile for `{2}`. Bob cannot.

## Step-by-step (the OWNER's POV — the player whose creature got airbended)

1. Your creature got airbended. It's now in **your Exile zone**.
2. Open the exile zone (the modal showing your exiled cards). Your creature should be there with a **"Cast for {2}"** option visible.
3. On **YOUR turn**, during one of your **Main Phases** (creatures are sorcery-speed), click the exiled creature.
4. Pay exactly `{2}` generic mana — any two lands' worth, any colors.
5. The creature enters the battlefield under your control, as if normally cast.

The permission persists across turns (the rules text says "until further notice"). You don't have to cast it the very next turn — you can hold it in exile and cast it whenever a main phase opens up.

## Step-by-step (the AIRBENDER's POV — the player who cast the Airbend spell)

1. You cast the airbender card (e.g. Airbending Lesson). Pick its target creature.
2. The creature goes to its **owner's** exile zone.
3. **You're done.** No cast option for you. The creature is gone unless its owner brings it back.

## Why it might look broken

| Symptom | Likely cause |
|---|---|
| "I airbended my opponent's creature but can't cast it from exile" | **You're not supposed to.** Only the owner (your opponent) can. |
| "My creature got airbended but I don't see a Cast option in exile" | Make sure you're looking at YOUR OWN exile zone, not the airbender's. The creature is in YOUR exile (you own it), but the UI might surface multiple zones — check the one labeled with your name. |
| "I tried to cast for {2} but it failed" | Check mana: need at least 2 mana of any colors. Check phase: creature spells are sorcery-speed, your main phases only, stack must be empty. |
| "It's asking me to pay more than {2}" | The original creature has a non-mana additional cost (e.g. "as you cast this, sacrifice a creature"). That extra cost still applies on top of `{2}` per the engine's alternate-cost machinery. Vanilla creatures (mana cost only, no riders) are exactly `{2}`. |

## Verification

Engine behavior locked by [`AirbendTest`](../../Mage.Server.WebApi/src/test/java/mage/webapi/cards/keyword/AirbendTest.java) (5 scenarios, all passing as of commit `1f7b730bc3`):

- `testOwnerCastsForTwoOnly` — owner has exactly 2 mana → cast succeeds (proves `{2}` REPLACES the original mana cost, doesn't stack on top)
- `testNonOwnerCannotCastFromExile` — airbender's controller tries to cast → engine blocks (proves owner-only permission)
- `testCastFromExileNotPlayableForNonOwner` — direct check that the cast option is not available to the airbender's controller
- `testAirbendExilesAndOwnerCanCastForTwo` — base flow: cast Airbend → creature exiled → owner casts for `{2}` → battlefield
- `testOwnerCannotCastWithoutMana` — owner has zero mana → creature stays in exile through normal play

If a future engine change breaks owner-gate enforcement or stacks the original mana cost on top of `{2}`, these tests will catch it.

## Related upstream concepts

- **`setCastSourceIdWithAlternateMana`** (in `PlayerImpl.java`) — the engine API that powers all "cast from exile / elsewhere for an alternate cost" mechanics (Flashback, Overload, Madness, Foretell, and now Airbend).
- **`CAST_FROM_NOT_OWN_HAND_ZONE`** as-though effect — the rules machinery that allows casting a card from a zone other than your hand (here, exile).
- **`Duration.Custom`** — the permission persists until the card leaves exile (cast or removed). Once you cast it, the permission is gone; no double-casts.
