/**
 * Scry / Surveil Skip flow — contract test (2026-05-11).
 *
 * The webclient encodes "skip / done with no selection" on
 * {@code playerResponse{kind:"uuid"}} as the all-zeros UUID, because
 * the wire schema rejects JSON null. The engine's
 * {@code HumanPlayer.chooseTarget(Cards, ...)} loop terminates only
 * when {@code responseId == null}. The WebApi side maps the all-zeros
 * sentinel back to a real Java null via
 * {@code parsePlayerResponseUuidOrSkip} (locked by
 * {@code GameStreamHandlerDecodeTest} on the Java side).
 *
 * <p>This file is the WEBCLIENT half of the contract: any future
 * refactor that changes the Skip-button encoding (e.g. switches to a
 * different sentinel string, or drops the Skip path entirely) will
 * fail one of the assertions below. The Java side's helper test +
 * this file's assertions together guarantee the Scry / Surveil Skip
 * flow stays wired end-to-end.
 *
 * <p>Engine semantics (null → terminate the choose loop) are upstream
 * and stable; they're covered by upstream's own Mage.Tests harness
 * for the {@code chooseTarget} / {@code choose} flows that scry and
 * surveil sit on top of.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SelectDialog } from './SelectDialog';
import { GameStream } from '../stream';
import {
  webCardViewSchema,
  webGameClientMessageSchema,
  type WebCardView,
} from '../../api/schemas';

const SKIP_SENTINEL_UUID = '00000000-0000-0000-0000-000000000000';

function fakeCard(id: string, name: string): WebCardView {
  return webCardViewSchema.parse({
    id,
    name,
    displayName: name,
    expansionSetCode: 'LEA',
    cardNumber: '1',
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Creature - Bear',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: ['BEAR'],
    colors: ['G'],
    rarity: 'COMMON',
    power: '2',
    toughness: '2',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

const C1 = fakeCard('11111111-1111-1111-1111-111111111111', 'Grizzly Bears');
const C2 = fakeCard('22222222-2222-2222-2222-222222222222', 'Runeclaw Bear');
const C3 = fakeCard('33333333-3333-3333-3333-333333333333', 'Balduvian Bears');

interface DialogOverrides {
  min: number;
  max: number;
  flag: boolean;
  message: string;
  cards: readonly WebCardView[];
}

function makeDialog(overrides: DialogOverrides) {
  const cardsView1: Record<string, WebCardView> = {};
  for (const card of overrides.cards) {
    cardsView1[card.id] = card;
  }
  return {
    method: 'gameSelect' as const,
    messageId: 99,
    data: webGameClientMessageSchema.parse({
      gameView: null,
      message: overrides.message,
      targets: overrides.cards.map((c) => c.id),
      cardsView1: cardsView1 as never,
      min: overrides.min,
      max: overrides.max,
      flag: overrides.flag,
      choice: null,
    }),
  } as never;
}

// Real engine messages — copied verbatim from PlayerImpl.java's
// scry / surveil paths so the test fixtures match what the server
// actually emits. Engine source:
//   PlayerImpl.java:5471-5473 (scry)
//   PlayerImpl.java:5500-5502 (surveil)
const SCRY_MESSAGE =
  'card or cards to PUT on the BOTTOM of your library (Scry)';
const SURVEIL_MESSAGE =
  'card or cards to PUT into your GRAVEYARD (Surveil)';
const TUTOR_MESSAGE = 'Choose target card to put into your hand';

function makeStream() {
  // Real GameStream so that vi.spyOn(GameStream.prototype, ...)
  // intercepts the prototype method. Not connected; we only need
  // the spy to observe calls.
  return new GameStream({
    gameId: '00000000-0000-0000-0000-000000000000',
    token: 'test-token',
  });
}

describe('SelectDialog — Scry Skip', () => {
  it('renders a Skip button for a scry-shape dialog (min=0, max=N, flag=true)', () => {
    render(
      <SelectDialog
        dialog={makeDialog({
          min: 0,
          max: 2,
          flag: true,
          message: SCRY_MESSAGE,
          cards: [C1, C2],
        })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /^Skip$/ }),
    ).toBeInTheDocument();
  });

  it('clicking Skip on a scry dialog sends the all-zeros UUID and clears the dialog locally', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    const stream = makeStream();

    render(
      <SelectDialog
        dialog={makeDialog({
          min: 0,
          max: 2,
          flag: true,
          message: SCRY_MESSAGE,
          cards: [C1, C2],
        })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Skip$/ }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(99, 'uuid', SKIP_SENTINEL_UUID);
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});

describe('SelectDialog — Surveil Skip', () => {
  it('renders a Skip button for a surveil-shape dialog (min=0, max=N, flag=true)', () => {
    render(
      <SelectDialog
        dialog={makeDialog({
          min: 0,
          max: 3,
          flag: true,
          message: SURVEIL_MESSAGE,
          cards: [C1, C2, C3],
        })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /^Skip$/ }),
    ).toBeInTheDocument();
  });

  it('clicking Skip on a surveil dialog sends the all-zeros UUID and clears the dialog locally', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    const stream = makeStream();

    render(
      <SelectDialog
        dialog={makeDialog({
          min: 0,
          max: 3,
          flag: true,
          message: SURVEIL_MESSAGE,
          cards: [C1, C2, C3],
        })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Skip$/ }));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(99, 'uuid', SKIP_SENTINEL_UUID);
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});

describe('SelectDialog — regression guards', () => {
  it('does NOT render Skip on a mandatory single-pick shape (min=max=1, flag=true)', () => {
    render(
      <SelectDialog
        dialog={makeDialog({
          min: 1,
          max: 1,
          flag: true,
          message: TUTOR_MESSAGE,
          cards: [C1, C2, C3],
        })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    // Mandatory tutor-style: zero-selection is rules-illegal, so no
    // Skip affordance. Mirrors the allowSkip = !flag || min === 0
    // gate in SelectDialog.tsx — protect this rule.
    expect(screen.queryByRole('button', { name: /^Skip$/ })).toBeNull();
  });

  it('clicking a card in single-pick mode sends that card UUID (not the all-zeros sentinel)', async () => {
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    const stream = makeStream();

    render(
      <SelectDialog
        dialog={makeDialog({
          min: 1,
          max: 1,
          flag: true,
          message: TUTOR_MESSAGE,
          cards: [C1, C2, C3],
        })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(99, 'uuid', C2.id);
    expect(sendSpy).not.toHaveBeenCalledWith(
      expect.anything(),
      'uuid',
      SKIP_SENTINEL_UUID,
    );
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });

  it('clicking Skip on an OPTIONAL prompt (min=0, max=1, flag=false) also sends the all-zeros sentinel', async () => {
    // Covers the other allowSkip branch: flag=false (truly optional).
    // Same wire encoding as scry/surveil — locks the contract uniformly.
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();
    const stream = makeStream();

    render(
      <SelectDialog
        dialog={makeDialog({
          min: 0,
          max: 1,
          flag: false,
          message: 'Choose target creature (optional)',
          cards: [C1],
        })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByRole('button', { name: /^Skip$/ }));

    expect(sendSpy).toHaveBeenCalledWith(99, 'uuid', SKIP_SENTINEL_UUID);
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});
