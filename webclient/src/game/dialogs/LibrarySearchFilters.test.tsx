import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibrarySearchFilters } from './LibrarySearchFilters';
import {
  applyFilter,
  EMPTY_FILTER,
  type FilterState,
} from './librarySearchFilter';

function Harness({ initial = EMPTY_FILTER }: { initial?: FilterState }) {
  const [state, setState] = useState<FilterState>(initial);
  return (
    <>
      <LibrarySearchFilters state={state} setState={setState} />
      <span data-testid="harness-name">{state.name}</span>
      <span data-testid="harness-types">
        {[...state.types].sort().join(',')}
      </span>
    </>
  );
}

function fakeCard(
  name: string,
  types: string[],
  supertypes: string[] = [],
): { name: string; types: string[]; supertypes: string[] } {
  return { name, types, supertypes };
}

describe('LibrarySearchFilters — name input', () => {
  it('typing into the input updates name state', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByTestId('library-search-name-input'), 'bolt');
    expect(screen.getByTestId('harness-name')).toHaveTextContent('bolt');
  });
});

describe('LibrarySearchFilters — type chips', () => {
  it('toggling a chip adds the wire value to the types set', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByTestId('library-search-type-creature'));
    expect(screen.getByTestId('harness-types')).toHaveTextContent('CREATURE');
    expect(
      screen
        .getByTestId('library-search-type-creature')
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('clicking an active chip removes it from the types set', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ name: '', types: new Set(['CREATURE']) }} />);
    await user.click(screen.getByTestId('library-search-type-creature'));
    expect(screen.getByTestId('harness-types')).toHaveTextContent('');
  });

  it('renders the seven canonical type chips with title-case labels', () => {
    render(
      <LibrarySearchFilters state={EMPTY_FILTER} setState={vi.fn()} />,
    );
    for (const label of [
      'Creature',
      'Instant',
      'Sorcery',
      'Artifact',
      'Enchantment',
      'Planeswalker',
      'Land',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });
});

describe('applyFilter', () => {
  const bolt = fakeCard('Lightning Bolt', ['INSTANT']);
  const bear = fakeCard('Grizzly Bears', ['CREATURE']);
  const swamp = fakeCard('Swamp', ['LAND'], ['BASIC']);
  const dryad = fakeCard('Dryad Arbor', ['CREATURE', 'LAND']);
  const cards = [bolt, bear, swamp, dryad];

  it('empty filter returns all cards', () => {
    expect(applyFilter(cards, EMPTY_FILTER)).toEqual(cards);
  });

  it('name substring match is case-insensitive', () => {
    const out = applyFilter(cards, { name: 'BoLt', types: new Set() });
    expect(out).toEqual([bolt]);
  });

  it('single type chip narrows to wire-matching cards', () => {
    const out = applyFilter(cards, { name: '', types: new Set(['CREATURE']) });
    expect(out).toEqual([bear, dryad]);
  });

  it('multi-type chips OR (union) — creature OR instant', () => {
    const out = applyFilter(cards, {
      name: '',
      types: new Set(['CREATURE', 'INSTANT']),
    });
    expect(out).toEqual([bolt, bear, dryad]);
  });

  it('Dryad Arbor matches both Creature AND Land chip independently', () => {
    expect(
      applyFilter(cards, { name: '', types: new Set(['LAND']) }),
    ).toEqual([swamp, dryad]);
    expect(
      applyFilter(cards, { name: '', types: new Set(['CREATURE']) }),
    ).toEqual([bear, dryad]);
  });

  it('name + type combine with AND', () => {
    const out = applyFilter(cards, {
      name: 'dryad',
      types: new Set(['CREATURE']),
    });
    expect(out).toEqual([dryad]);
  });

  it('zero matches returns empty array', () => {
    const out = applyFilter(cards, {
      name: 'xyz_nonexistent',
      types: new Set(),
    });
    expect(out).toEqual([]);
  });
});
