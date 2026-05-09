/**
 * Helpers + types for the library-search modal filter state. Split
 * out of {@link LibrarySearchFilters} (the .tsx component file) so
 * Fast Refresh can hot-reload the component without invalidating
 * shared constants. Imported by the modal and the filter component.
 */

/**
 * Type-chip filter set. Wire values match the upstream
 * {@code CardType.name()} enum constants (SCREAMING_SNAKE_CASE,
 * emitted as-is by {@code CardViewMapper.cardTypeNames}). Display
 * labels are the conventional title-case rendering. Order is the
 * conventional MTG type ordering (creatures first — dominate most
 * tutor pools; lands last — the structural-spell pile).
 */
export const FILTER_TYPES = [
  { wire: 'CREATURE', label: 'Creature' },
  { wire: 'INSTANT', label: 'Instant' },
  { wire: 'SORCERY', label: 'Sorcery' },
  { wire: 'ARTIFACT', label: 'Artifact' },
  { wire: 'ENCHANTMENT', label: 'Enchantment' },
  { wire: 'PLANESWALKER', label: 'Planeswalker' },
  { wire: 'LAND', label: 'Land' },
] as const;
export type FilterType = (typeof FILTER_TYPES)[number]['wire'];

export interface FilterState {
  name: string;
  types: ReadonlySet<FilterType>;
}

export const EMPTY_FILTER: FilterState = {
  name: '',
  types: new Set(),
};

/**
 * Apply the current filter state to a card collection. Name match is
 * case-insensitive substring; type match is OR across active chips.
 * Empty filter (no name + zero types) returns all cards.
 *
 * <p>Type matching reads {@code types} ("CREATURE", "LAND", etc.)
 * and {@code supertypes} ("BASIC", "LEGENDARY", "SNOW") — both wire
 * values. A Treasure-spawning creature (types=["ARTIFACT","CREATURE"])
 * matches both Creature and Artifact chips, as expected.
 */
export function applyFilter<
  T extends { name: string; types: string[]; supertypes: string[] },
>(cards: ReadonlyArray<T>, filter: FilterState): T[] {
  const nameNeedle = filter.name.trim().toLowerCase();
  const typeFilter = filter.types;
  if (!nameNeedle && typeFilter.size === 0) return [...cards];
  return cards.filter((c) => {
    if (nameNeedle && !c.name.toLowerCase().includes(nameNeedle)) return false;
    if (typeFilter.size > 0) {
      const haystack = [...c.types, ...c.supertypes];
      let typeMatch = false;
      for (const t of typeFilter) {
        if (haystack.includes(t)) {
          typeMatch = true;
          break;
        }
      }
      if (!typeMatch) return false;
    }
    return true;
  });
}
