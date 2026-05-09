import type { Dispatch, SetStateAction } from 'react';
import {
  FILTER_TYPES,
  type FilterState,
  type FilterType,
} from './librarySearchFilter';

interface Props {
  state: FilterState;
  setState: Dispatch<SetStateAction<FilterState>>;
}

/**
 * Filter row for {@link LibrarySearchModal}. Renders a name-substring
 * input plus per-type toggle chips. Pure presentational — owns no
 * filtering logic; the modal applies the filter to {@code cardsView1}
 * via {@code applyFilter} from {@link ./librarySearchFilter}.
 *
 * <p>Chips toggle independently — Creature ON + Instant ON shows
 * cards matching EITHER (union), which matches how players think
 * about tutor narrowing ("I want a creature OR an instant").
 */
export function LibrarySearchFilters({ state, setState }: Props) {
  const toggleType = (wire: FilterType) => {
    setState((prev) => {
      const next = new Set(prev.types);
      if (next.has(wire)) next.delete(wire);
      else next.add(wire);
      return { ...prev, types: next };
    });
  };
  return (
    <div
      data-testid="library-search-filters"
      className="flex flex-col gap-2 sm:flex-row sm:items-center"
    >
      <input
        type="text"
        value={state.name}
        onChange={(e) =>
          setState((prev) => ({ ...prev, name: e.target.value }))
        }
        placeholder="Filter by name…"
        data-testid="library-search-name-input"
        aria-label="Filter cards by name"
        className="flex-1 px-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500"
      />
      <div
        role="group"
        aria-label="Filter by card type"
        className="flex flex-wrap gap-1"
      >
        {FILTER_TYPES.map(({ wire, label }) => {
          const active = state.types.has(wire);
          return (
            <button
              key={wire}
              type="button"
              data-testid={`library-search-type-${wire.toLowerCase()}`}
              data-active={active || undefined}
              aria-pressed={active}
              onClick={() => toggleType(wire)}
              className={
                'px-2.5 py-1 rounded text-xs font-medium transition border ' +
                (active
                  ? 'bg-fuchsia-600 border-fuchsia-500 text-white'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500')
              }
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
