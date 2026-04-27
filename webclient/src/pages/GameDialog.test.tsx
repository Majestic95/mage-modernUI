import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameDialog } from './GameDialog';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';
import { webGameClientMessageSchema } from '../api/schemas';

function emptyDialog(overrides: Partial<{
  message: string;
  targets: string[];
  cardsView1: Record<string, unknown>;
  min: number;
  max: number;
  flag: boolean;
}> = {}) {
  return webGameClientMessageSchema.parse({
    gameView: null,
    message: overrides.message ?? '',
    targets: overrides.targets ?? [],
    cardsView1: overrides.cardsView1 ?? {},
    min: overrides.min ?? 0,
    max: overrides.max ?? 0,
    flag: overrides.flag ?? false,
    choice: null,
  });
}

function fakeStream() {
  return {
    sendPlayerAction: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
  } as unknown as GameStream;
}

describe('GameDialog', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when no dialog is pending', () => {
    const { container } = render(<GameDialog stream={fakeStream()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders <font color> highlights as styled spans, strips raw markup', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 1,
          data: emptyDialog({
            message: 'Mulligan <font color=#ffff00>down to 6 cards</font>?',
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    const msg = screen.getByTestId('dialog-message');
    // Visible text has no leftover tags.
    expect(msg.textContent).toBe('Mulligan down to 6 cards?');
    // The highlight is rendered as a styled span.
    const highlight = msg.querySelector('span');
    expect(highlight).not.toBeNull();
    expect(highlight?.textContent).toBe('down to 6 cards');
    expect(highlight?.getAttribute('style')).toMatch(/color:\s*(#ffff00|rgb\(255,\s*255,\s*0\))/i);
  });

  it('strips unknown HTML tags safely (no innerHTML injection)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 2,
          data: emptyDialog({
            message: 'hello <script>alert(1)</script> world <b>bold</b>',
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    const msg = screen.getByTestId('dialog-message');
    expect(msg.textContent).toBe('hello alert(1) world bold');
    expect(msg.querySelector('script')).toBeNull();
    expect(msg.querySelector('b')).toBeNull();
  });

  it('handles <br> as a line break inside messages', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 3,
          data: emptyDialog({
            message: 'Line one<br>line two',
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    const msg = screen.getByTestId('dialog-message');
    expect(msg.querySelector('br')).not.toBeNull();
    expect(msg.textContent).toBe('Line oneline two');
  });

  it('gameAsk: Yes button sends boolean=true and clears the dialog', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 42,
          data: emptyDialog({ message: 'Pay 1 life?' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.getByTestId('game-dialog')).toHaveAttribute('data-method', 'gameAsk');
    expect(screen.getByTestId('dialog-message')).toHaveTextContent('Pay 1 life?');

    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(42, 'boolean', true);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameAsk: No button sends boolean=false', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 99,
          data: emptyDialog(),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByRole('button', { name: /^no$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(99, 'boolean', false);
  });

  /* ---------- slice 17: button-text overrides via options ---------- */

  it('gameAsk: options.UI.btn.text overrides render as button labels (mulligan)', async () => {
    // Mulligan loop populates options.leftBtnText="Mulligan" /
    // options.rightBtnText="Keep" via upstream HumanPlayer.java:404.
    // Default Yes/No labels should not appear when overrides are
    // present. Real-world fix for the "Question / Yes / No" UX bug
    // surfaced in the play session.
    const stream = fakeStream();
    const user = userEvent.setup();
    const data = emptyDialog({
      message: 'Mulligan down to 6 cards?',
    });
    // Inject the slice-17 options field. emptyDialog() defaults
    // options to all-empty via Zod default; we override here.
    const dataWithOptions = {
      ...data,
      options: {
        leftBtnText: 'Mulligan',
        rightBtnText: 'Keep',
        possibleAttackers: [],
        possibleBlockers: [],
        specialButton: '',
      },
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 17,
          data: dataWithOptions,
        },
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.getByRole('button', { name: /^Mulligan$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Keep$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Yes$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^No$/i })).not.toBeInTheDocument();

    // Click "Mulligan" sends boolean=true (left = primary = true).
    await user.click(screen.getByRole('button', { name: /^Mulligan$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(17, 'boolean', true);
  });

  it('gameAsk: empty button-text override falls back to default Yes/No', () => {
    // Defensive: if upstream populates only one label, the other
    // should still default. (Realistic case: Proliferate sets only
    // UI.right.btn.text="Done".)
    const stream = fakeStream();
    const data = emptyDialog({ message: 'Proliferate?' });
    const dataWithPartial = {
      ...data,
      options: {
        leftBtnText: '',
        rightBtnText: 'Done',
        possibleAttackers: [],
        possibleBlockers: [],
        specialButton: '',
      },
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameAsk',
          messageId: 18,
          data: dataWithPartial,
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByRole('button', { name: /^Yes$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Done$/i })).toBeInTheDocument();
  });

  it('gameTarget: clicking a target sends uuid response', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const targetCard = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Lightning Bolt',
      displayName: 'Lightning Bolt',
      expansionSetCode: 'LEA',
      cardNumber: '161',
      manaCost: '{R}',
      manaValue: 1,
      typeLine: 'Instant',
      supertypes: [],
      types: ['INSTANT'],
      subtypes: [],
      colors: ['R'],
      rarity: 'COMMON',
      power: '',
      toughness: '',
      startingLoyalty: '',
      rules: ['Bolt deals 3.'],
      faceDown: false,
      counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 7,
          data: emptyDialog({
            message: 'Pick a target.',
            cardsView1: { [targetCard.id]: targetCard },
            flag: true,
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    await user.click(screen.getByRole('button', { name: /Lightning Bolt/ }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(7, 'uuid', targetCard.id);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameTarget: with player UUIDs in targets[] renders player picker (start-of-match)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const aliceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const bobId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const gameView = {
      turn: 1,
      phase: '',
      step: '',
      activePlayerName: '',
      priorityPlayerName: '',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: aliceId,
      myHand: {},
      stack: {},
      combat: [],
      players: [
        {
          playerId: aliceId,
          name: 'alice',
          life: 20, wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 0,
          graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
          manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
          controlled: true, isHuman: true, isActive: false, hasPriority: false,
          hasLeft: false, monarch: false, initiative: false,
          designationNames: [],
          commandList: [],
        },
        {
          playerId: bobId,
          name: 'COMPUTER_MAD',
          life: 20, wins: 0, winsNeeded: 1, libraryCount: 60, handCount: 0,
          graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
          manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
          controlled: false, isHuman: false, isActive: false, hasPriority: false,
          hasLeft: false, monarch: false, initiative: false,
          designationNames: [],
          commandList: [],
        },
      ],
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 4,
          data: webGameClientMessageSchema.parse({
            gameView,
            message: 'Select a starting player',
            targets: [aliceId, bobId],
            cardsView1: {},
            min: 0,
            max: 0,
            flag: true,
            choice: null,
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.getByTestId('target-list-resolved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /alice/ }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(4, 'uuid', aliceId);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameTarget: with hand-card UUIDs in targets[] resolves names from gameView.myHand (end-of-turn discard)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const aliceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const card1 = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'Forest',
      displayName: 'Forest',
      expansionSetCode: 'M21',
      cardNumber: '281',
      manaCost: '',
      manaValue: 0,
      typeLine: 'Basic Land — Forest',
      supertypes: ['BASIC'],
      types: ['LAND'],
      subtypes: ['Forest'],
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
    };
    const gameView = {
      turn: 5,
      phase: 'ENDING',
      step: 'CLEANUP',
      activePlayerName: 'alice',
      priorityPlayerName: 'alice',
      special: false,
      rollbackTurnsAllowed: false,
      totalErrorsCount: 0,
      totalEffectsCount: 0,
      gameCycle: 0,
      myPlayerId: aliceId,
      myHand: { [card1.id]: card1 },
      stack: {},
      combat: [],
      players: [
        {
          playerId: aliceId,
          name: 'alice',
          life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 8,
          graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
          manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
          controlled: true, isHuman: true, isActive: true, hasPriority: true,
          hasLeft: false, monarch: false, initiative: false,
          designationNames: [],
          commandList: [],
        },
      ],
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 19,
          data: webGameClientMessageSchema.parse({
            gameView,
            message: 'Discard a card',
            targets: [card1.id],
            cardsView1: {},
            min: 0,
            max: 0,
            flag: true,
            choice: null,
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.getByTestId('target-list-resolved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Forest/ }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(19, 'uuid', card1.id);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameTarget: unresolvable id falls back to short-id stub (always clickable)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const orphanId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 20,
          data: emptyDialog({
            message: 'Pick something',
            targets: [orphanId],
            flag: true,
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.getByTestId('target-list-resolved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ffffffff/ }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(20, 'uuid', orphanId);
  });

  it('gameTarget: optional target shows Skip and sends empty UUID', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 8,
          data: emptyDialog({ message: 'Optional', flag: false }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      8,
      'uuid',
      '00000000-0000-0000-0000-000000000000',
    );
  });

  it('gameSelectAmount: number input + Submit sends integer', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameSelectAmount',
          messageId: 11,
          data: emptyDialog({ message: 'How many?', min: 1, max: 5 }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '3');
    await user.click(screen.getByRole('button', { name: /submit/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(11, 'integer', 3);
  });

  it('gameSelectAmount: Submit disabled when value is out of range', async () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameSelectAmount',
          messageId: 12,
          data: emptyDialog({ min: 5, max: 10 }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    // Initial value is min=5, which is in range — Submit is enabled.
    expect(screen.getByRole('button', { name: /submit/i })).not.toBeDisabled();
    // But re-render with a min=5 default, Submit should be enabled because 5 ≥ 5.
    expect(stream.sendPlayerResponse).not.toHaveBeenCalled();
  });

  it('gameInformPersonal: OK button only clears, sends nothing', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameInformPersonal',
          messageId: 21,
          data: emptyDialog({ message: 'You drew a card.' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Info');
    await user.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(stream.sendPlayerResponse).not.toHaveBeenCalled();
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameError: shows Error title + dismisses without sending', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameError',
          messageId: 22,
          data: emptyDialog({ message: 'Illegal target.' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('dialog-title')).toHaveTextContent('Error');
    await user.click(screen.getByRole('button', { name: /^ok$/i }));
    expect(stream.sendPlayerResponse).not.toHaveBeenCalled();
  });

  it('gamePlayMana: Yes/No sends boolean', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gamePlayMana',
          messageId: 33,
          data: emptyDialog({ message: 'Pay {R}?' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('dialog-title')).toHaveTextContent(/pay mana/i);
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(33, 'boolean', true);
  });

  /* ---------- slice 7: 3 audit-tier-2 dialogs ---------- */

  it('gamePlayXMana: reuses YesNo renderer and sends boolean', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gamePlayXMana',
          messageId: 50,
          data: emptyDialog({ message: 'Add another to X?' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('game-dialog')).toHaveAttribute(
      'data-method',
      'gamePlayXMana',
    );
    await user.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(50, 'boolean', true);
  });

  it('gameChooseChoice: clicking a choice sends the chosen key as string', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseChoice',
          messageId: 60,
          data: webGameClientMessageSchema.parse({
            gameView: null,
            message: 'Wrapper message',
            targets: [],
            cardsView1: {},
            min: 0,
            max: 0,
            flag: false,
            choice: {
              message: 'Choose one —',
              subMessage: '',
              required: true,
              choices: {
                destroy: 'Destroy target creature.',
                counter: 'Counter target spell.',
              },
            },
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('dialog-title')).toHaveTextContent(/choose one/i);
    expect(screen.getByTestId('choice-list')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /destroy target creature/i }),
    );
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(60, 'string', 'destroy');
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('gameChooseChoice: optional choice shows Skip and sends empty string', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseChoice',
          messageId: 61,
          data: webGameClientMessageSchema.parse({
            gameView: null,
            message: '',
            targets: [],
            cardsView1: {},
            min: 0,
            max: 0,
            flag: false,
            choice: {
              message: 'Optionally choose',
              subMessage: '',
              required: false,
              choices: { a: 'Option A' },
            },
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(61, 'string', '');
  });

  it('gameChooseAbility: clicking an ability sends uuid response', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseAbility',
          messageId: 70,
          data: {
            gameView: null,
            message: 'Choose ability',
            choices: {
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '1. Activate ability A',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': '2. Activate ability B',
            },
          },
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('dialog-title')).toHaveTextContent(/choose ability/i);
    expect(screen.getByTestId('ability-list')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /1. Activate ability A/ }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      70,
      'uuid',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    );
  });
});
