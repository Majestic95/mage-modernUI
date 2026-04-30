import type { WebPlayerView } from '../api/schemas';

/**
 * Slice 70-P — derived helper for "does this pool have any mana?"
 * Used at consumer sites to gate the wrapper render so an empty
 * pool produces NO DOM at all (catalog §2.3 "Empty pool: Don't
 * render anything (no zero-orb or 'empty' placeholder)"). The
 * internal filter in {@link ManaPool} removes zero-count cells but
 * the wrapper {@code <span>} still mounts; gating outside avoids
 * that 1px shell.
 *
 * <p>Lives in its own module so {@link ManaPool} can stay
 * react-refresh-clean (only-export-components).
 */
export function hasAnyMana(pool: WebPlayerView['manaPool']): boolean {
  return Object.values(pool).some((n) => n > 0);
}
