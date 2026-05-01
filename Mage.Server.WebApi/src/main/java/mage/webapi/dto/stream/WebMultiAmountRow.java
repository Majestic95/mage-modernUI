package mage.webapi.dto.stream;

/**
 * Slice 70-X.14 Wave 3 (schema 1.25) — one row of a multi-amount
 * allocation. Mirrors upstream's {@code mage.util.MultiAmountMessage}.
 *
 * @param label
 *     Human-readable row label. For trample assignment this is the
 *     blocker's name + power/toughness ("Grizzly Bears (2/2)"); for
 *     counter removal this is the permanent's name; for mana
 *     allocation this is "{C}", "{R}", etc. Engine-supplied; UI does
 *     not synthesize.
 * @param min
 *     Per-row inclusive minimum. Engine-supplied. For trample
 *     assignment this is 0 (engine enforces lethals via the total-min
 *     constraint, NOT per-row min — see CR 702.19b enforcement at
 *     CombatGroup.java:290).
 * @param max
 *     Per-row inclusive maximum.
 * @param defaultValue
 *     Engine-supplied initial value. UI MUST initialize the input to
 *     this. For trample, pre-encodes lethal-per-blocker (with
 *     deathtouch → 1, CR 702.2c). Without this default, hitting Done
 *     on the unchanged form often produces a sub-totalMin sum and
 *     re-prompts the player.
 */
public record WebMultiAmountRow(
        String label,
        int min,
        int max,
        int defaultValue
) {
}
