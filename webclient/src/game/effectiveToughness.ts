/**
 * Compute the effective toughness of a creature given its printed
 * toughness string and marked damage. Mirrors MTGO/MTGA convention:
 * a 3/3 with 2 damage marked displays as 3/1 with the toughness
 * shown in red until the cleanup step clears damage (CR 121.3).
 *
 * <p>Returns the raw toughness unchanged when:
 * <ul>
 *   <li>damage is 0 (no marking → no derived value)</li>
 *   <li>toughness is non-numeric (`*`, `1+*`, `X`, `2+*`, etc. —
 *       variable values can't be subtracted from at render time;
 *       the existing damage chip on the card surface conveys the
 *       fact that damage is marked)</li>
 * </ul>
 *
 * <p>Damage > toughness can occur in a brief snapshot window
 * between damage assignment and the next state-based-actions check.
 * We clamp to 0 rather than displaying a negative number; SBAs
 * destroy the creature within milliseconds and the next snapshot
 * removes the permanent from the wire.
 */
export interface EffectiveToughness {
  readonly display: string;
  readonly damaged: boolean;
}

export function effectiveToughness(
  toughness: string,
  damage: number,
): EffectiveToughness {
  if (damage <= 0) return { display: toughness, damaged: false };
  if (!/^-?\d+$/.test(toughness)) {
    return { display: toughness, damaged: false };
  }
  const numeric = parseInt(toughness, 10);
  const effective = Math.max(0, numeric - damage);
  return { display: String(effective), damaged: true };
}
