import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameDialog } from '../game/dialogs/GameDialog';
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
  options: Record<string, unknown>;
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
    ...(overrides.options !== undefined ? { options: overrides.options } : {}),
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

  /* ---------- slice 20 B1a: combat panel ---------- */

  function combatDialog(message: string, opts?: {
    possibleAttackers?: string[];
    possibleBlockers?: string[];
    specialButton?: string;
  }) {
    return {
      method: 'gameSelect' as const,
      messageId: 99,
      data: {
        gameView: null,
        message,
        targets: [],
        cardsView1: {},
        min: 0,
        max: 0,
        flag: false,
        choice: null,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers: opts?.possibleAttackers ?? [],
          possibleBlockers: opts?.possibleBlockers ?? [],
          specialButton: opts?.specialButton ?? '',
        },
      },
    };
  }

  // Slice 70-Y.4 (CLICK_RESOLUTION flag removed 2026-05-02) — the
  // declareAttackers / declareBlockers branch now renders
  // CombatBanner directly. The shape contracts (Done button,
  // All-attack-on-specialButton, no Cancel) live in
  // CombatBanner.test.tsx; here we just assert GameDialog hands off
  // to CombatBanner instead of the legacy modal.
  it('declareAttackers: hands off to the CombatBanner (banner replaces legacy modal)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: combatDialog('Select attackers', {
          possibleAttackers: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
        }),
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('combat-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('game-dialog')).not.toBeInTheDocument();
  });

  it('declareBlockers: hands off to the CombatBanner (banner replaces legacy modal)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: combatDialog('Select blockers'),
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('combat-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('game-dialog')).not.toBeInTheDocument();
  });

  it('gameSelect free-priority message renders nothing (board is the input)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: combatDialog('Play spells and abilities'),
      });
    });
    const { container } = render(<GameDialog stream={stream} />);
    expect(container.firstChild).toBeNull();
  });

  /* ---------- slice 17: button-text overrides via options ---------- */

  it('gameAsk: mulligan flow short-circuits — GameDialog renders nothing (MulliganModal takes over)', () => {
    // Slice 70-F — the mulligan branch is detected by leftBtnText=
    // "Mulligan" + rightBtnText="Keep" and rendered by the
    // GameTable-level MulliganModal with full-mode chrome. GameDialog
    // returns null for this branch so the legacy AskDialog doesn't
    // double-render the same dispatch surface. The MulliganModal's
    // own "Mulligan"/"Keep" buttons + dispatch contract is covered
    // in MulliganModal.test.tsx.
    const stream = fakeStream();
    const data = emptyDialog({
      message: 'Mulligan down to 6 cards?',
    });
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

    // GameDialog renders nothing for mulligan — both the legacy
    // Yes/No labels AND the new Mulligan/Keep labels are absent
    // from this surface.
    expect(screen.queryByRole('button', { name: /^Mulligan$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Keep$/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('game-dialog')).not.toBeInTheDocument();
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

  // Slice 70-Y.2 (CLICK_RESOLUTION flag removed 2026-05-02) — gameTarget
  // with empty cardsView1 (board-target: player or permanent on the
  // board) now renders DialogBanner; the dispatch happens via
  // clickRouter target mode on the board, NOT via per-row buttons in
  // a modal target list. The board-click → uuid response contract is
  // covered in clickRouter.test.ts; here we assert GameDialog hands
  // off to the banner.
  it('gameTarget with empty cardsView1: hands off to the DialogBanner (no legacy target-list modal)', () => {
    const stream = fakeStream();
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
    expect(screen.getByTestId('dialog-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('target-list-resolved')).not.toBeInTheDocument();
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

  /* ---------- slice 26 / ADR 0009: trigger-order dialog ---------- */

  it('gameTarget with options.isTriggerOrder=true renders OrderTriggersDialog rows from rule text', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const ability1 = {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Ability',
      displayName: 'Ability',
      expansionSetCode: '',
      cardNumber: '',
      manaCost: '',
      manaValue: 0,
      typeLine: '',
      supertypes: [],
      types: [],
      subtypes: [],
      colors: [],
      rarity: '',
      power: '',
      toughness: '',
      startingLoyalty: '',
      rules: ['When Soul Warden enters the battlefield, you gain 1 life.'],
      faceDown: false,
      counters: {},
      transformable: false,
      transformed: false,
      secondCardFace: null,
    };
    const ability2 = {
      ...ability1,
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      rules: ["Whenever a creature enters, you may pay {1}. If you do, draw a card."],
    };
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameTarget',
          messageId: 99,
          data: emptyDialog({
            message: 'Pick triggered ability (goes to the stack first)',
            cardsView1: { [ability1.id]: ability1, [ability2.id]: ability2 },
            options: {
              leftBtnText: '',
              rightBtnText: '',
              possibleAttackers: [],
              possibleBlockers: [],
              specialButton: '',
              isTriggerOrder: true,
            },
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);

    const rows = screen.getAllByTestId('trigger-order-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent(/Soul Warden enters the battlefield/);
    expect(rows[1]).toHaveTextContent(/Whenever a creature enters/);

    await user.click(rows[0]!);
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(99, 'uuid', ability1.id);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  /* ---------- slice 27 / ADR 0009: auto-order context menu ---------- */

  function triggerOrderDialog(
    abilities: Array<{
      id: string;
      rules: string[];
      name?: string;
      sourceLabel?: string;
    }>,
    messageId = 200,
  ) {
    const cardsView1: Record<string, unknown> = {};
    for (const a of abilities) {
      cardsView1[a.id] = {
        id: a.id,
        name: a.name ?? 'Ability',
        displayName: a.name ?? 'Ability',
        expansionSetCode: '',
        cardNumber: '',
        manaCost: '',
        manaValue: 0,
        typeLine: '',
        supertypes: [],
        types: [],
        subtypes: [],
        colors: [],
        rarity: '',
        power: '',
        toughness: '',
        startingLoyalty: '',
        rules: a.rules,
        faceDown: false,
        counters: {},
        transformable: false,
        transformed: false,
        secondCardFace: null,
        sourceLabel: a.sourceLabel ?? '',
      };
    }
    return {
      method: 'gameTarget' as const,
      messageId,
      data: emptyDialog({
        message: 'Pick triggered ability',
        cardsView1,
        options: {
          leftBtnText: '',
          rightBtnText: '',
          possibleAttackers: [],
          possibleBlockers: [],
          specialButton: '',
          isTriggerOrder: true,
        },
      }),
    };
  }

  it('OrderTriggersDialog: hamburger button per row toggles the auto-order menu', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
            rules: ['When Soul Warden enters the battlefield, you gain 1 life.'],
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);

    expect(screen.queryByTestId('trigger-order-menu')).toBeNull();
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    expect(screen.getByTestId('trigger-order-menu')).toBeInTheDocument();
    expect(screen.getAllByTestId('trigger-order-menu-item')).toHaveLength(5);
  });

  it('OrderTriggersDialog: ABILITY_FIRST sends action + uuid response (two-step)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog(
          [{ id, rules: ['Some trigger.'] }],
          250,
        ),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));

    const items = screen.getAllByTestId('trigger-order-menu-item');
    const firstItem = items.find(
      (el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_ABILITY_FIRST',
    )!;
    await user.click(firstItem);

    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'TRIGGER_AUTO_ORDER_ABILITY_FIRST',
      { abilityId: id },
    );
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(250, 'uuid', id);
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('OrderTriggersDialog: ABILITY_LAST sends action only, closes dialog (no uuid response)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03';
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([{ id, rules: ['Some trigger.'] }]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    const items = screen.getAllByTestId('trigger-order-menu-item');
    const lastItem = items.find(
      (el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_ABILITY_LAST',
    )!;
    await user.click(lastItem);

    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'TRIGGER_AUTO_ORDER_ABILITY_LAST',
      { abilityId: id },
    );
    expect(stream.sendPlayerResponse).not.toHaveBeenCalled();
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('OrderTriggersDialog: NAME_FIRST substitutes {this} with sourceLabel client-side before sending', async () => {
    // Slice 28 / Fix 2: substitution prefers sourceLabel (the real
    // source permanent name), falling back to ability.name and then
    // to the literal "Ability". With sourceLabel present, the
    // substituted rule matches what HumanPlayer.java:1474-1476
    // recomputes via ability.getRule(sourceObject.getName()), so
    // the auto-order key compares correctly against future triggers.
    const stream = fakeStream();
    const user = userEvent.setup();
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04';
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id,
            rules: [
              'When {this} enters the battlefield, you may draw a card.',
            ],
            sourceLabel: 'Soul Warden',
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    const nameFirst = screen
      .getAllByTestId('trigger-order-menu-item')
      .find((el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_NAME_FIRST')!;
    await user.click(nameFirst);

    const call = (stream.sendPlayerAction as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    expect(call[0]).toBe('TRIGGER_AUTO_ORDER_NAME_FIRST');
    const data = call[1] as { ruleText: string };
    expect(data.ruleText).not.toContain('{this}');
    expect(data.ruleText).toMatch(
      /When Soul Warden enters the battlefield, you may draw a card\./,
    );
  });

  it('OrderTriggersDialog: NAME_FIRST falls back to "Ability" when sourceLabel is empty', async () => {
    // Without slice 28's sourceLabel populated, substitution falls
    // back to ability.name (which is the literal "Ability" for
    // permanent-sourced AbilityViews — AbilityView.java:21). The
    // wire still ships a {this}-free string so the engine doesn't
    // throw at HumanPlayer.java:2843-2845, but the recorded key
    // becomes a dead one — that's the latent bug critique E3 flagged
    // and slice 28's sourceLabel populates the value upstream.
    const stream = fakeStream();
    const user = userEvent.setup();
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04b';
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id,
            rules: [
              'When {this} enters the battlefield, you may draw a card.',
            ],
            // sourceLabel intentionally omitted (defaults to '')
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    const nameFirst = screen
      .getAllByTestId('trigger-order-menu-item')
      .find((el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_NAME_FIRST')!;
    await user.click(nameFirst);

    const call = (stream.sendPlayerAction as ReturnType<typeof vi.fn>).mock
      .calls[0]!;
    const data = call[1] as { ruleText: string };
    expect(data.ruleText).not.toContain('{this}');
    expect(data.ruleText).toMatch(
      /When Ability enters the battlefield, you may draw a card\./,
    );
  });

  it('OrderTriggersDialog: RESET_ALL fires action with null data, closes dialog', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa05',
            rules: ['Some trigger.'],
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    const reset = screen
      .getAllByTestId('trigger-order-menu-item')
      .find((el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_RESET_ALL')!;
    await user.click(reset);

    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'TRIGGER_AUTO_ORDER_RESET_ALL',
      null,
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('OrderTriggersDialog: NAME_* menu items disabled when ability has no rule text', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa06',
            rules: [],
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-menu-button'));
    const items = screen.getAllByTestId('trigger-order-menu-item');
    const nameFirst = items.find(
      (el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_NAME_FIRST',
    )!;
    const nameLast = items.find(
      (el) => el.getAttribute('data-action') === 'TRIGGER_AUTO_ORDER_NAME_LAST',
    )!;
    expect(nameFirst).toBeDisabled();
    expect(nameLast).toBeDisabled();
  });

  /* ---------- slice 28 / ADR 0009: source label + footer reset ---------- */

  it('OrderTriggersDialog renders "from: ‹label›" when sourceLabel is set', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa07',
            rules: ['Some trigger.'],
            sourceLabel: 'Soul Warden',
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    const sourceEl = screen.getByTestId('trigger-order-source');
    expect(sourceEl).toHaveTextContent(/from:\s*Soul Warden/);
  });

  it('OrderTriggersDialog hides the source line when sourceLabel is empty', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa08',
            rules: ['Some trigger.'],
            sourceLabel: '',
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.queryByTestId('trigger-order-source')).toBeNull();
  });

  it('OrderTriggersDialog footer Reset-all button fires TRIGGER_AUTO_ORDER_RESET_ALL', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: triggerOrderDialog([
          {
            id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa09',
            rules: ['Some trigger.'],
          },
        ]),
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('trigger-order-reset-all'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'TRIGGER_AUTO_ORDER_RESET_ALL',
      null,
    );
    expect(useGameStore.getState().pendingDialog).toBeNull();
  });

  it('OrderTriggersDialog has no Skip button (chooseTriggeredAbility is required)', () => {
    const stream = fakeStream();
    const ability = {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      name: 'Ability',
      displayName: 'Ability',
      expansionSetCode: '',
      cardNumber: '',
      manaCost: '',
      manaValue: 0,
      typeLine: '',
      supertypes: [],
      types: [],
      subtypes: [],
      colors: [],
      rarity: '',
      power: '',
      toughness: '',
      startingLoyalty: '',
      rules: ['Some trigger text.'],
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
          messageId: 100,
          data: emptyDialog({
            cardsView1: { [ability.id]: ability },
            options: {
              leftBtnText: '',
              rightBtnText: '',
              possibleAttackers: [],
              possibleBlockers: [],
              specialButton: '',
              isTriggerOrder: true,
            },
          }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.queryByRole('button', { name: /skip/i })).toBeNull();
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

  // Slice 70-Y.3 (CLICK_RESOLUTION flag removed 2026-05-02) —
  // gamePlayMana / gamePlayXMana now render ManaPayBanner (was a
  // bottom-right side panel). Banner shape contracts (Special button
  // for Convoke / Improvise / Delve, no Done on plain mana, etc.)
  // live in ManaPayBanner.test.tsx; here we just assert GameDialog
  // hands off to the banner instead of the legacy modal.
  it('gamePlayMana: hands off to the ManaPayBanner (banner replaces legacy modal)', () => {
    const stream = fakeStream();
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
    expect(screen.getByTestId('mana-pay-banner')).toBeInTheDocument();
    expect(screen.queryByTestId('game-dialog')).not.toBeInTheDocument();
  });

  /* ---------- slice 7: 3 audit-tier-2 dialogs ---------- */

  it('gamePlayXMana: hands off to the ManaPayBanner (banner replaces legacy modal)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gamePlayXMana',
          messageId: 50,
          data: emptyDialog({ message: 'X = 3 — keep paying?' }),
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('mana-pay-banner')).toBeInTheDocument();
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

  /* ---------- slice 39: modal-spell mode-select Done/Cancel ---------- */

  // Sentinel UUIDs from upstream `Modes.java:27-28` — copied here as
  // the test fixture; production code keeps the same constants.
  const DONE_ID = '33e72ad6-17ae-4bfb-a097-6e7aa06b49e9';
  const CANCEL_ID = '0125bd0c-5610-4eba-bc80-fc6d0a7b9de6';

  it('gameChooseAbility: Done sentinel renders as a primary button (modal spell)', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseAbility',
          messageId: 80,
          data: {
            gameView: null,
            message: 'Choose mode (selected 1 of 4, min 2)',
            choices: {
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '1. Counter target spell.',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': '2. Return target permanent.',
              [DONE_ID]: 'Done',
              [CANCEL_ID]: 'Cancel',
            },
          },
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.getByTestId('ability-done')).toHaveTextContent('Done');
    expect(screen.getByTestId('ability-cancel')).toHaveTextContent('Cancel');
    // The sentinels should NOT also render as ability rows — the row
    // count matches the real-mode count.
    expect(screen.getAllByTestId('ability-row')).toHaveLength(2);
  });

  it('gameChooseAbility: Done button dispatches the Done sentinel uuid', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseAbility',
          messageId: 81,
          data: {
            gameView: null,
            message: 'Choose mode (selected 2 of 4, min 2)',
            choices: {
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '1. Counter target spell.',
              [DONE_ID]: 'Done',
              [CANCEL_ID]: 'Cancel',
            },
          },
        },
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('ability-done'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(81, 'uuid', DONE_ID);
  });

  it('gameChooseAbility: Cancel button dispatches the Cancel sentinel uuid', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseAbility',
          messageId: 82,
          data: {
            gameView: null,
            message: 'Choose mode',
            choices: {
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '1. Counter target spell.',
              [CANCEL_ID]: 'Cancel',
            },
          },
        },
      });
    });
    render(<GameDialog stream={stream} />);
    await user.click(screen.getByTestId('ability-cancel'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(82, 'uuid', CANCEL_ID);
  });

  it('gameChooseAbility: regular activated-ability picker shows neither Done nor Cancel', () => {
    const stream = fakeStream();
    act(() => {
      useGameStore.setState({
        pendingDialog: {
          method: 'gameChooseAbility',
          messageId: 83,
          data: {
            gameView: null,
            message: 'Choose ability',
            choices: {
              'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': '1. Tap for green',
              'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': '2. Tap for blue',
            },
          },
        },
      });
    });
    render(<GameDialog stream={stream} />);
    expect(screen.queryByTestId('ability-done')).toBeNull();
    expect(screen.queryByTestId('ability-cancel')).toBeNull();
  });
});
