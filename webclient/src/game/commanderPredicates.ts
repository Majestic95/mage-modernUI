import type { WebCommandObjectView } from '../api/schemas';

/**
 * P2 audit fix — single source of truth for "is this entry a
 * commander?" Pre-extraction the predicate
 * {@code e.kind === 'commander'} appeared in 9 files with subtly
 * different shapes (some did filter, some did some, some name-matched
 * inline). The slice 70-Z snapshot bug — where the wrong filter
 * skipped commanders that had left the command zone — is the kind
 * of regression that decentralized predicates invite. Centralizing
 * the predicates closes that bug class.
 *
 * <p>Two predicates only:
 * <ol>
 *   <li>{@link isCommanderEntry} — kind discriminator only.</li>
 *   <li>{@link isCommanderNamed} — kind + name match for the
 *       "this card IS the commander" question.</li>
 * </ol>
 */

type CommanderLike = Pick<WebCommandObjectView, 'kind' | 'name'>;

/**
 * True iff the entry is a commander. Use for filtering a
 * {@code commandList} or a {@code commanderSnapshots} entry array.
 */
export function isCommanderEntry(entry: CommanderLike): boolean {
  return entry.kind === 'commander';
}

/**
 * True iff the entry is a commander AND its name matches the given
 * card name. Use to answer "does THIS card represent the commander?"
 * — e.g., when checking a stack/battlefield permanent against the
 * commander roster.
 */
export function isCommanderNamed(
  entry: CommanderLike,
  cardName: string,
): boolean {
  return entry.kind === 'commander' && entry.name === cardName;
}

/**
 * Filter a list to commander entries. Convenience over
 * {@code list.filter(isCommanderEntry)} — keeps the predicate name
 * out of the call site.
 */
export function filterCommanders<T extends CommanderLike>(list: readonly T[]): T[] {
  return list.filter(isCommanderEntry);
}
