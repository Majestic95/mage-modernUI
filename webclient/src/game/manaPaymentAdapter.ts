import type { GameStream } from './stream';
import type { ManaOrbColor } from './ManaOrb';
import type { PendingDialog } from './store';

/**
 * Slice 70-X.13 (Wave 4) — extracted from {@link GameTable} so the
 * mana-payment color→enum mapping + dispatch factory live in one
 * testable module instead of leaking into the layout component.
 *
 * <p>Mirrors {@code mage.constants.ManaType}. The keys are the
 * webclient's internal {@link ManaOrbColor} codes; the values are
 * upstream's enum string names (per {@code HumanPlayer.playManaHandling}
 * at HumanPlayer.java:1612-1616 "pay from own mana pool" branch).
 *
 * <p>Promoted to module scope so the literal isn't reallocated per
 * GameTable render.
 */
export const MANA_COLOR_TO_ENUM: Record<ManaOrbColor, string> = {
  W: 'WHITE',
  U: 'BLUE',
  B: 'BLACK',
  R: 'RED',
  G: 'GREEN',
  C: 'COLORLESS',
};

/**
 * Build the {@code onSpendMana(color)} handler for the floating mana
 * pool. Returns {@code undefined} unless the engine has an active
 * {@code gamePlayMana} / {@code gamePlayXMana} dialog — outside those
 * windows clicking a pool orb would race the engine, so the orbs
 * render as static spans (per {@link ManaPool}'s spec).
 *
 * @param stream  active {@link GameStream}; null disables the click
 * @param dialog  current {@link PendingDialog} state; null or non-mana
 *                method disables the click
 * @returns       a {@code (color) => void} dispatcher, or {@code undefined}
 */
export function buildOnSpendMana(
  stream: GameStream | null,
  dialog: PendingDialog | null,
): ((color: ManaOrbColor) => void) | undefined {
  if (!stream || !dialog) return undefined;
  if (dialog.method !== 'gamePlayMana' && dialog.method !== 'gamePlayXMana') {
    return undefined;
  }
  const messageId = dialog.messageId;
  return (color: ManaOrbColor) => {
    const manaType = MANA_COLOR_TO_ENUM[color];
    if (!manaType) return;
    stream.sendPlayerResponse(messageId, 'manaType', { manaType });
  };
}
