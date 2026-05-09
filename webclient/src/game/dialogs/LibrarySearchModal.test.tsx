import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LibrarySearchModal } from './LibrarySearchModal';
import { GameStream } from '../stream';
import {
  webCardViewSchema,
  webGameClientMessageSchema,
  type WebCardView,
} from '../../api/schemas';

function fakeCard(opts: {
  id: string;
  name: string;
  manaValue?: number;
  types?: string[];
}): WebCardView {
  return webCardViewSchema.parse({
    id: opts.id,
    cardId: opts.id,
    name: opts.name,
    displayName: opts.name,
    expansionSetCode: 'LEA',
    cardNumber: '1',
    manaCost: '',
    manaValue: opts.manaValue ?? 1,
    typeLine: (opts.types ?? ['CREATURE']).join(' '),
    supertypes: [],
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

const C1 = fakeCard({ id: id(1), name: 'Bears', manaValue: 2, types: ['CREATURE'] });
const C2 = fakeCard({ id: id(2), name: 'Bolt', manaValue: 1, types: ['INSTANT'] });
const C3 = fakeCard({ id: id(3), name: 'Counterspell', manaValue: 2, types: ['INSTANT'] });

function makeDialog(overrides: {
  flag: boolean;
  min?: number;
  max?: number;
  cards?: Record<string, WebCardView>;
}) {
  return {
    method: 'gameTarget' as const,
    messageId: 42,
    data: webGameClientMessageSchema.parse({
      gameView: null,
      message: 'Search your library',
      targets: [],
      cardsView1: (overrides.cards ?? {
        [C1.id]: C1,
        [C2.id]: C2,
        [C3.id]: C3,
      }) as never,
      min: overrides.min ?? 1,
      max: overrides.max ?? 1,
      flag: overrides.flag,
      choice: null,
    }),
  } as never;
}

function makeStream() {
  return new GameStream({
    gameId: '00000000-0000-0000-0000-000000000000',
    token: 'test-token',
  });
}

describe('LibrarySearchModal — single-pick', () => {
  it('clicking a card submits with its id and clears the dialog', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    const stream = makeStream();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId(`library-search-tile-${C2.id}`));
    expect(sendSpy).toHaveBeenCalledWith(42, 'uuid', C2.id);
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });

  it('does not render Done button in single-pick mode', () => {
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.queryByText(/^Done/)).toBeNull();
  });

  it('renders Skip button when flag=false', () => {
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('library-search-skip')).toBeInTheDocument();
  });

  it('does NOT render Skip when flag=true (mandatory)', () => {
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.queryByTestId('library-search-skip')).toBeNull();
  });
});

describe('LibrarySearchModal — multi-pick', () => {
  it('toggles selection and submits selected list on Done', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false, min: 1, max: 3 })}
        stream={makeStream()}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId(`library-search-tile-${C1.id}`));
    await user.click(screen.getByTestId(`library-search-tile-${C2.id}`));
    expect(screen.getByText('Done (2/3)')).toBeInTheDocument();
    await user.click(screen.getByText('Done (2/3)'));
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls.map((c) => c[2])).toEqual([C1.id, C2.id]);
    sendSpy.mockRestore();
  });

  it('Done is disabled when picked count is below min', () => {
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false, min: 2, max: 3 })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByText('Done (0/3)')).toBeDisabled();
  });
});

describe('LibrarySearchModal — Skip / Esc / scrim', () => {
  it('clicking Skip sends all-zeros uuid', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false })}
        stream={makeStream()}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId('library-search-skip'));
    expect(sendSpy).toHaveBeenCalledWith(
      42,
      'uuid',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(clearDialog).toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('Escape triggers Skip when flag=false', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false })}
        stream={makeStream()}
        clearDialog={clearDialog}
      />,
    );
    await user.keyboard('{Escape}');
    expect(sendSpy).toHaveBeenCalledWith(
      42,
      'uuid',
      '00000000-0000-0000-0000-000000000000',
    );
    sendSpy.mockRestore();
  });

  it('Escape does NOTHING when flag=true (mandatory)', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={makeStream()}
        clearDialog={clearDialog}
      />,
    );
    await user.keyboard('{Escape}');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(clearDialog).not.toHaveBeenCalled();
    sendSpy.mockRestore();
  });

  it('scrim click skips when flag=false', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: false })}
        stream={makeStream()}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId('library-search-backdrop'));
    expect(sendSpy).toHaveBeenCalled();
    expect(clearDialog).toHaveBeenCalled();
    sendSpy.mockRestore();
  });
});

describe('LibrarySearchModal — filter narrowing + no-matches', () => {
  it('typing into the name filter narrows the visible grid', async () => {
    const user = userEvent.setup();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId(`library-search-tile-${C1.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`library-search-tile-${C2.id}`)).toBeInTheDocument();
    await user.type(screen.getByTestId('library-search-name-input'), 'bolt');
    expect(screen.queryByTestId(`library-search-tile-${C1.id}`)).toBeNull();
    expect(screen.getByTestId(`library-search-tile-${C2.id}`)).toBeInTheDocument();
  });

  it('no-matches state shows clear-filters pill when filter narrows to zero', async () => {
    const user = userEvent.setup();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    await user.type(
      screen.getByTestId('library-search-name-input'),
      'xyz_no_match',
    );
    const pill = screen.getByTestId('library-search-no-matches');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent(/clear filters/i);
    await user.click(screen.getByText(/clear filters/i));
    expect(
      screen.queryByTestId('library-search-no-matches'),
    ).toBeNull();
    expect(screen.getByTestId(`library-search-tile-${C1.id}`)).toBeInTheDocument();
  });

  it('type chip filter narrows by wire CardType (Instant)', async () => {
    const user = userEvent.setup();
    render(
      <LibrarySearchModal
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    await user.click(screen.getByTestId('library-search-type-instant'));
    expect(screen.queryByTestId(`library-search-tile-${C1.id}`)).toBeNull();
    expect(screen.getByTestId(`library-search-tile-${C2.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`library-search-tile-${C3.id}`)).toBeInTheDocument();
  });
});
