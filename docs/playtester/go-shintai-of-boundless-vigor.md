# Go-Shintai of Boundless Vigor — How To Use

> **Card text:** *"At the beginning of your end step, you may pay {1}. When you do, put a +1/+1 counter on target Shrine for each Shrine you control."*

The trigger has **two stages** that both happen at the start of your End Step. Miss either stage and no counters land.

## Stage 1 — pay the {1}

1. It's **your turn** (the trigger fires only on YOUR end step, not your opponents').
2. Phase: **End Step** (after Main Phase 2, before Cleanup).
3. A prompt pops up: **"Pay {1}?"** with Yes / No buttons.
4. Click **Yes**, then tap a land to pay `{1}` generic mana.
5. Click **No** (or don't have the mana) → trigger fizzles, **nothing happens**. This is the easiest miscue.

## Stage 2 — pick the target Shrine

1. After the `{1}` is paid, a **second prompt** appears: choose a target Shrine.
2. Any Shrine on the battlefield is a legal target — yours OR an opponent's. Go-Shintai itself is a legal target.
3. Click the Shrine you want.
4. That Shrine gets **+1/+1 counters equal to the number of Shrines you control** (including Go-Shintai itself if it's yours).

## Worked example

You control:

- Go-Shintai of Boundless Vigor (it counts as a Shrine)
- Honden of Cleansing Fire (another Shrine)
- Sanctum of Tranquil Light (another Shrine)

That's 3 Shrines. End step → "Pay {1}?" → Yes → tap a land → "Choose target Shrine" → click Honden → **Honden gets 3 +1/+1 counters**.

Edge cases that have been verified:

- **Single Shrine** (only Go-Shintai, no others): pay → target Go-Shintai → 1 counter (the source still counts itself).
- **Decline pay**: 0 counters added; trigger doesn't progress to the target prompt.
- **Target a different Shrine**: counters go to that Shrine, not Go-Shintai. Go-Shintai still gets 0 counters this turn unless you re-target it next end step.

## Why it might look broken

| Symptom | Likely cause |
|---|---|
| "Nothing happened on my end step" | Clicked **No** to "Pay {1}?" — the trigger is optional. |
| "I paid the {1} but no counter appeared" | The target-Shrine prompt comes **AFTER** the pay prompt. If you advance phases without picking a target, the trigger fizzles. |
| "I never saw a prompt at all" | Auto-passing through End Step skipped the trigger. Stop on End Step at least the first few times. |
| "I targeted my Shrine but counters went on an opponent's" | Read the second prompt carefully — it asks for **any** legal Shrine target, including opponents'. Click YOUR Shrine. |

## Verification

Engine behavior locked by [`GoShintaiOfBoundlessVigorTest`](../../Mage.Server.WebApi/src/test/java/mage/webapi/cards/g/GoShintaiOfBoundlessVigorTest.java) (4 scenarios, all passing as of commit `44011d18e8`):

- `threeShrines_payOne_targetSelf_putsThreeCounters` — 3 Shrines on board, target Go-Shintai, 3 counters land
- `onlyGoShintai_payOne_targetSelf_putsOneCounter` — only Go-Shintai, target self, 1 counter (source still counts)
- `threeShrines_dontPay_noCounters` — decline payment, 0 counters
- `threeShrines_payOne_targetOtherShrine_putsThreeCountersThere` — target Honden, 3 counters on Honden, 0 on Go-Shintai

If a future change causes any of these to fail, the test will catch it.
