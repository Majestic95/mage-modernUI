import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PilePickerDialog } from './PilePickerDialog';
import { webCardViewSchema } from '../../api/schemas';
import type { GameStream } from '../stream';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

const card = (id: string, name: string) =>
  webCardViewSchema.parse({
    id, name, displayName: name,
    expansionSetCode: 'LEA', cardNumber: '1',
    manaCost: '', manaValue: 0,
    typeLine: 'Sorcery', supertypes: [], types: ['SORCERY'], subtypes: [],
    colors: [], rarity: 'COMMON', power: '', toughness: '', startingLoyalty: '',
    rules: [], faceDown: false, counters: {}, transformable: false, transformed: false,
    secondCardFace: null,
  });

const C1 = card('11111111-1111-1111-1111-111111111111', 'Brainstorm');
const C2 = card('22222222-2222-2222-2222-222222222222', 'Counterspell');
const C3 = card('33333333-3333-3333-3333-333333333333', 'Force of Will');
const C4 = card('44444444-4444-4444-4444-444444444444', 'Mana Drain');
const C5 = card('55555555-5555-5555-5555-555555555555', 'Daze');

function dialog(
  pile1: Record<string, unknown>,
  pile2: Record<string, unknown>,
  message = 'Choose a pile.',
) {
  return {
    method: 'gameChoosePile' as const,
    messageId: 17,
    data: {
      gameView: null,
      message,
      targets: [],
      cardsView1: pile1,
      min: 0, max: 0, flag: true,
      choice: null,
      cardsView2: pile2,
      multiAmount: null,
      options: {
        leftBtnText: '', rightBtnText: '',
        possibleAttackers: [], possibleBlockers: [],
        specialButton: '',
      },
    },
  };
}

describe('PilePickerDialog — Fact or Fiction style', () => {
  it('renders both piles side-by-side', () => {
    render(
      <PilePickerDialog
        dialog={dialog(
          { [C1.id]: C1, [C2.id]: C2 },
          { [C3.id]: C3, [C4.id]: C4, [C5.id]: C5 },
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('pile-picker-pile1')).toBeInTheDocument();
    expect(screen.getByTestId('pile-picker-pile2')).toBeInTheDocument();
  });

  it('shows correct card counts on each pile', () => {
    render(
      <PilePickerDialog
        dialog={dialog(
          { [C1.id]: C1, [C2.id]: C2 },
          { [C3.id]: C3, [C4.id]: C4, [C5.id]: C5 },
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('pile-picker-pile1-count').textContent).toBe(
      '2 cards',
    );
    expect(screen.getByTestId('pile-picker-pile2-count').textContent).toBe(
      '3 cards',
    );
  });

  it('Pile 1 click sends boolean true (per PickPileDialog.java:101)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    render(
      <PilePickerDialog
        dialog={dialog(
          { [C1.id]: C1 },
          { [C2.id]: C2 },
        )}
        stream={stream}
        clearDialog={() => {}}
      />,
    );
    await user.click(screen.getByTestId('pile-picker-pile1'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(17, 'boolean', true);
  });

  it('Pile 2 click sends boolean false', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    render(
      <PilePickerDialog
        dialog={dialog(
          { [C1.id]: C1 },
          { [C2.id]: C2 },
        )}
        stream={stream}
        clearDialog={() => {}}
      />,
    );
    await user.click(screen.getByTestId('pile-picker-pile2'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(17, 'boolean', false);
  });

  it('renders empty pile placeholder when one side has no cards (CR 706.4 — 5/0 split allowed)', () => {
    render(
      <PilePickerDialog
        dialog={dialog(
          {},
          { [C1.id]: C1, [C2.id]: C2, [C3.id]: C3, [C4.id]: C4, [C5.id]: C5 },
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('pile-picker-pile1-count').textContent).toBe(
      '0 cards',
    );
    expect(screen.getByTestId('pile-picker-pile1').textContent).toContain(
      'empty pile',
    );
  });

  it('clicking empty pile is still a valid choice', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    render(
      <PilePickerDialog
        dialog={dialog({}, { [C1.id]: C1 })}
        stream={stream}
        clearDialog={() => {}}
      />,
    );
    await user.click(screen.getByTestId('pile-picker-pile1'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(17, 'boolean', true);
  });

  it('mandatory dialog — no Skip / X-close button', () => {
    render(
      <PilePickerDialog
        dialog={dialog({ [C1.id]: C1 }, { [C2.id]: C2 })}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.queryByTestId('dialog-close')).toBeNull();
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
  });
});
