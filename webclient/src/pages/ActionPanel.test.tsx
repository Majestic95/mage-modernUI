import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionPanel } from './ActionPanel';
import { nextPhaseAction } from './actionPanelHelpers';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';
import {
  webCardViewSchema,
  webGameViewSchema,
  webPlayerViewSchema,
} from '../api/schemas';

/** Minimal card fixture for tests that need a non-empty stack. */
const STACK_CARD = webCardViewSchema.parse({
  id: '99999999-9999-9999-9999-999999999999',
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
  rules: ['Lightning Bolt deals 3 damage to any target.'],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
});

const ANON_SESSION = {
  schemaVersion: '1.15',
  token: 'tok-anon',
  username: 'alice',
  isAnonymous: true,
  isAdmin: false,
  expiresAt: '2026-04-27T00:00:00Z',
};

function gameViewWithPriorityOn(
  priorityName: string,
  opts: { step?: string; stack?: Record<string, typeof STACK_CARD> } = {},
) {
  const me = webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { red: 0, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    controlled: true, isHuman: true, isActive: true,
    hasPriority: priorityName === 'alice',
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
  return webGameViewSchema.parse({
    turn: 1,
    phase: opts.step ?? 'PRECOMBAT_MAIN',
    step: opts.step ?? 'PRECOMBAT_MAIN',
    activePlayerName: 'alice',
    priorityPlayerName: priorityName,
    special: false,
    rollbackTurnsAllowed: false,
    totalErrorsCount: 0,
    totalEffectsCount: 0,
    gameCycle: 0,
    myPlayerId: me.playerId,
    myHand: {},
    stack: opts.stack ?? {},
    combat: [],
    players: [me],
  });
}

function fakeStream() {
  return {
    sendPlayerAction: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
  } as unknown as GameStream;
}

describe('ActionPanel', () => {
  beforeEach(() => {
    useAuthStore.setState({
      session: ANON_SESSION,
      loading: false,
      error: null,
      verifying: false,
    });
    useGameStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders nothing when there is no gameView', () => {
    const { container } = render(<ActionPanel stream={fakeStream()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows priority indicator when controlling player has priority', () => {
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={fakeStream()} />);
    expect(screen.getByText(/your priority/i)).toBeInTheDocument();
  });

  it('shows waiting indicator when opponent has priority', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO'),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    expect(screen.getByText(/waiting/i)).toBeInTheDocument();
  });

  // Slice 70-X.6 lock (Wave 2) — when opponent has priority, every
  // priority-gated button MUST be disabled with title "waiting for
  // opponent". Pre-Wave-2 only the "shows waiting indicator" string
  // was asserted; nothing pinned the disabled state. A regression that
  // re-enabled the buttons would let the player queue actions out of
  // priority. Also asserts the click is a no-op (no dispatch fires)
  // for the same reason.
  it('priority-gated buttons are disabled when opponent has priority', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO', {
          step: 'BEGIN_COMBAT',
          stack: { [STACK_CARD.id]: STACK_CARD },
        }),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    const buttons: Array<[string, HTMLButtonElement]> = [
      [
        'next-phase',
        screen.getByTestId('next-phase-button') as HTMLButtonElement,
      ],
      [
        'end-turn',
        screen.getByRole('button', { name: /end turn/i }) as HTMLButtonElement,
      ],
      [
        'skip-combat',
        screen.getByRole('button', {
          name: /skip combat/i,
        }) as HTMLButtonElement,
      ],
      [
        'resolve-stack',
        screen.getByRole('button', {
          name: /resolve stack/i,
        }) as HTMLButtonElement,
      ],
    ];
    for (const [label, btn] of buttons) {
      expect(btn.disabled, `${label} should be disabled`).toBe(true);
      expect(
        btn.title.toLowerCase(),
        `${label} title should mention waiting`,
      ).toContain('waiting for opponent');
    }
  });

  it('Stop-skipping and Undo remain enabled when opponent has priority', () => {
    // Slice 70-X.6 contract — the two emergency-exit buttons MUST stay
    // available regardless of priority so the user can interrupt a
    // runaway pass / undo a misclick when waiting on opponent.
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO'),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    const stop = screen.getByRole('button', {
      name: /stop skipping/i,
    }) as HTMLButtonElement;
    const undo = screen.getByTestId('undo-button') as HTMLButtonElement;
    expect(stop.disabled).toBe(false);
    expect(undo.disabled).toBe(false);
  });

  it('clicking a disabled priority-gated button does not dispatch', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO'),
      });
    });
    render(<ActionPanel stream={stream} />);
    // userEvent.click on a disabled button is a no-op in the browser
    // and in jsdom; this asserts the disabled attribute is doing its
    // job (vs slipping a click through via some pointerEvents bypass).
    await user.click(screen.getByTestId('next-phase-button'));
    await user.click(screen.getByRole('button', { name: /end turn/i }));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  /* ---------- slice 38: Next Phase (phase-aware) ---------- */

  describe('nextPhaseAction helper', () => {
    it.each([
      ['UNTAP', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['UPKEEP', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['DRAW', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      // Slice 70-Y / Issue 3 (2026-05-01) — main1 → main2 stop, not
      // turn-end. The old TURN_END_STEP set passedUntilEndOfTurn=true
      // which short-circuits priority on every step except END_TURN,
      // skipping main2 entirely. NEXT_MAIN_PHASE correctly stops at
      // main2 via the skippedAtLeastOnce check.
      ['PRECOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['BEGIN_COMBAT', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['DECLARE_ATTACKERS', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['DECLARE_BLOCKERS', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['FIRST_COMBAT_DAMAGE', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['COMBAT_DAMAGE', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['END_COMBAT', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
      ['POSTCOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_TURN_END_STEP'],
      ['END_TURN', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
      ['CLEANUP', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
    ])('maps step %s → %s', (step, expected) => {
      expect(nextPhaseAction(step)).toBe(expected);
    });

    it('returns null for empty step (pre-game / between-game)', () => {
      expect(nextPhaseAction('')).toBeNull();
    });

    it('returns null for unknown step values', () => {
      expect(nextPhaseAction('SIDEBOARD')).toBeNull();
    });
  });

  it.each([
    ['UNTAP', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['PRECOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['DECLARE_ATTACKERS', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['POSTCOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_TURN_END_STEP'],
    ['END_TURN', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
  ])('Next Phase button from %s dispatches %s', async (step, expected) => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step }),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('next-phase-button'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(expected);
  });

  it('Next Phase button is disabled when step is empty', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step: '' }),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    const btn = screen.getByTestId('next-phase-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('End-turn button sends PASS_PRIORITY_UNTIL_NEXT_TURN', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /end turn/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_TURN',
    );
  });

  it('Skip-combat button sends PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step: 'BEGIN_COMBAT' }),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /skip combat/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE',
    );
  });

  it('Skip-combat button is disabled outside combat / beginning phases', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step: 'POSTCOMBAT_MAIN' }),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    const btn = screen.getByRole('button', {
      name: /skip combat/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title.toLowerCase()).toContain('not in combat');
  });

  it('Resolve-stack button is disabled when stack is empty', () => {
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={fakeStream()} />);
    const btn = screen.getByRole('button', {
      name: /resolve stack/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title.toLowerCase()).toContain('no stack');
  });

  it('Resolve-stack button sends PASS_PRIORITY_UNTIL_STACK_RESOLVED when stack non-empty', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', {
          stack: { [STACK_CARD.id]: STACK_CARD },
        }),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /resolve stack/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_UNTIL_STACK_RESOLVED',
    );
  });

  it('Stop-skipping button always enabled, sends PASS_PRIORITY_CANCEL_ALL_ACTIONS', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('COMPUTER_MONTE_CARLO'),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByRole('button', { name: /stop skipping/i }));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(
      'PASS_PRIORITY_CANCEL_ALL_ACTIONS',
    );
  });

  it('all primary/skip buttons carry tooltips (title attribute)', () => {
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', {
          step: 'BEGIN_COMBAT',
          stack: { [STACK_CARD.id]: STACK_CARD },
        }),
      });
    });
    render(<ActionPanel stream={fakeStream()} />);
    for (const name of [
      /next phase/i,
      /end turn/i,
      /skip combat/i,
      /resolve stack/i,
      /stop skipping/i,
      /undo/i,
    ]) {
      const btn = screen.getByRole('button', { name });
      expect(btn.getAttribute('title')).toBeTruthy();
    }
  });

  /* ---------- Concede flow (slice 37, unchanged) ---------- */

  it('Concede button opens confirmation modal; confirm sends CONCEDE', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    // Modal opens, no dispatch yet.
    expect(screen.getByTestId('concede-confirm')).toBeInTheDocument();
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('concede-confirm-yes'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('CONCEDE');
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
  });

  it('Concede modal Cancel does not dispatch', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
  });

  it('Concede modal Esc closes without firing the cancel-passes hotkey', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('concede-button'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('concede-confirm')).toBeNull();
    // Esc should NOT have fired PASS_PRIORITY_CANCEL_ALL_ACTIONS — the
    // capture-phase modal listener stopImmediatePropagation'd it.
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  /* ---------- slice 37: Undo button + Ctrl+Z hotkey ---------- */

  it('Undo button sends UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.click(screen.getByTestId('undo-button'));
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('UNDO');
  });

  it('Ctrl+Z fires UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{Control>}z{/Control}');
    expect(stream.sendPlayerAction).toHaveBeenCalledWith('UNDO');
  });

  it('bare z (no modifier) does not fire UNDO', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('z');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  it('Ctrl+F2 does not fire next-phase (modifier mismatch)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{Control>}{F2}{/Control}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  /* ---------- slice 29: keyboard pass shortcuts (now phase-aware F2) ---------- */

  it.each([
    ['F4', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
    ['F6', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['F8', 'PASS_PRIORITY_UNTIL_STACK_RESOLVED'],
    ['Escape', 'PASS_PRIORITY_CANCEL_ALL_ACTIONS'],
  ])('keydown %s dispatches %s', async (key, expectedAction) => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard(`{${key}}`);
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(expectedAction);
  });

  it.each([
    ['UNTAP', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['PRECOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['DECLARE_ATTACKERS', 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE'],
    ['POSTCOMBAT_MAIN', 'PASS_PRIORITY_UNTIL_TURN_END_STEP'],
    ['END_TURN', 'PASS_PRIORITY_UNTIL_NEXT_TURN'],
  ])('F2 from step %s dispatches %s (phase-aware)', async (step, expected) => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step }),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{F2}');
    expect(stream.sendPlayerAction).toHaveBeenCalledWith(expected);
  });

  it('F2 dispatches no action when step is empty', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({
        gameView: gameViewWithPriorityOn('alice', { step: '' }),
      });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{F2}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  it('hotkeys are suppressed when focus is in an input element', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    const { container } = render(
      <>
        <input data-testid="chat-input" />
        <ActionPanel stream={stream} />
      </>,
    );
    const input = container.querySelector(
      '[data-testid="chat-input"]',
    ) as HTMLInputElement;
    input.focus();
    await user.keyboard('{F2}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });

  it('unrelated keys do not dispatch any action', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    act(() => {
      useGameStore.setState({ gameView: gameViewWithPriorityOn('alice') });
    });
    render(<ActionPanel stream={stream} />);
    await user.keyboard('{F1}{F3}{F7}{a}{Enter}');
    expect(stream.sendPlayerAction).not.toHaveBeenCalled();
  });
});
