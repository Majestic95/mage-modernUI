import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { webCardViewSchema, type WebCardView } from '../../api/schemas';
import { LibrarySearchGrid } from './LibrarySearchGrid';

function fakeCard(opts: {
  id: string;
  name: string;
  manaValue?: number;
  types?: string[];
  supertypes?: string[];
}): WebCardView {
  return webCardViewSchema.parse({
    id: opts.id,
    cardId: opts.id,
    name: opts.name,
    displayName: opts.name,
    expansionSetCode: 'LEA',
    cardNumber: '1',
    manaCost: '',
    manaValue: opts.manaValue ?? 0,
    typeLine: (opts.types ?? ['CREATURE']).join(' '),
    supertypes: opts.supertypes ?? [],
    types: opts.types ?? ['CREATURE'],
    subtypes: [],
    colors: [],
    rarity: 'COMMON',
    power: '',
    toughness: '',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

const id = (n: number) =>
  `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;

describe('LibrarySearchGrid — CMC bucketing', () => {
  it('groups by manaValue with separate Lands bucket', () => {
    const cards = [
      fakeCard({ id: id(1), name: 'Mox Diamond', manaValue: 0, types: ['ARTIFACT'] }),
      fakeCard({ id: id(2), name: 'Bolt', manaValue: 1, types: ['INSTANT'] }),
      fakeCard({ id: id(3), name: 'Bears', manaValue: 2, types: ['CREATURE'] }),
      fakeCard({ id: id(4), name: 'Swamp', manaValue: 0, types: ['LAND'], supertypes: ['BASIC'] }),
      fakeCard({ id: id(5), name: 'Eldrazi', manaValue: 10, types: ['CREATURE'] }),
    ];
    render(
      <LibrarySearchGrid
        cards={cards}
        eligibleIds={null}
        pickedIds={[]}
        ordered={false}
        onCardClick={() => {}}
      />,
    );
    expect(screen.getByTestId('library-search-cmc-0')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-cmc-1')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-cmc-2')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-cmc-7plus')).toBeInTheDocument();
    expect(screen.getByTestId('library-search-cmc-lands')).toBeInTheDocument();
    // Empty buckets omitted
    expect(screen.queryByTestId('library-search-cmc-3')).toBeNull();
    expect(screen.queryByTestId('library-search-cmc-4')).toBeNull();
  });

  it('lands bucket pulls all LAND-type cards out regardless of manaValue', () => {
    const arbor = fakeCard({
      id: id(1),
      name: 'Dryad Arbor',
      manaValue: 0,
      types: ['CREATURE', 'LAND'],
    });
    const swamp = fakeCard({
      id: id(2),
      name: 'Swamp',
      manaValue: 0,
      types: ['LAND'],
      supertypes: ['BASIC'],
    });
    render(
      <LibrarySearchGrid
        cards={[arbor, swamp]}
        eligibleIds={null}
        pickedIds={[]}
        ordered={false}
        onCardClick={() => {}}
      />,
    );
    const lands = screen.getByTestId('library-search-cmc-lands');
    expect(lands).toContainElement(
      screen.getByTestId(`library-search-tile-${arbor.id}`),
    );
    expect(lands).toContainElement(
      screen.getByTestId(`library-search-tile-${swamp.id}`),
    );
    // Should not duplicate to CMC-0 bucket
    expect(screen.queryByTestId('library-search-cmc-0')).toBeNull();
  });
});

describe('LibrarySearchGrid — interactions', () => {
  const c1 = fakeCard({ id: id(1), name: 'Bears', manaValue: 2, types: ['CREATURE'] });
  const c2 = fakeCard({ id: id(2), name: 'Bolt', manaValue: 1, types: ['INSTANT'] });

  it('clicking a tile invokes onCardClick with that id', async () => {
    const onCardClick = vi.fn();
    const user = userEvent.setup();
    render(
      <LibrarySearchGrid
        cards={[c1, c2]}
        eligibleIds={null}
        pickedIds={[]}
        ordered={false}
        onCardClick={onCardClick}
      />,
    );
    await user.click(screen.getByTestId(`library-search-tile-${c1.id}`));
    expect(onCardClick).toHaveBeenCalledWith(c1.id);
  });

  it('ineligible tiles render disabled and do not fire onCardClick', async () => {
    const onCardClick = vi.fn();
    const user = userEvent.setup();
    render(
      <LibrarySearchGrid
        cards={[c1, c2]}
        eligibleIds={new Set([c2.id])}
        pickedIds={[]}
        ordered={false}
        onCardClick={onCardClick}
      />,
    );
    const tile = screen.getByTestId(`library-search-tile-${c1.id}`);
    expect(tile).toBeDisabled();
    await user.click(tile);
    expect(onCardClick).not.toHaveBeenCalled();
  });

  it('picked tiles render selected ring; ordered mode shows numbered badge', () => {
    render(
      <LibrarySearchGrid
        cards={[c1, c2]}
        eligibleIds={null}
        pickedIds={[c2.id, c1.id]}
        ordered
        onCardClick={() => {}}
      />,
    );
    const tile1 = screen.getByTestId(`library-search-tile-${c1.id}`);
    const tile2 = screen.getByTestId(`library-search-tile-${c2.id}`);
    expect(tile1.getAttribute('data-picked')).toBe('true');
    expect(tile2.getAttribute('data-picked')).toBe('true');
    // c2 was picked first → badge "1"; c1 second → badge "2"
    expect(tile2).toHaveTextContent('1');
    expect(tile1).toHaveTextContent('2');
  });
});
