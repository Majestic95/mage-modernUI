import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombatBanner } from './CombatBanner';
import { useGameStore } from '../store';
import type { GameStream } from '../stream';
import { webGameClientMessageSchema } from '../../api/schemas';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

function setCombatDialog(
  message: string,
  options: Partial<{
    possibleAttackers: string[];
    possibleBlockers: string[];
    specialButton: string;
  }> = {},
) {
  const data = webGameClientMessageSchema.parse({
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
      possibleAttackers: options.possibleAttackers ?? [],
      possibleBlockers: options.possibleBlockers ?? [],
      specialButton: options.specialButton ?? '',
    },
  });
  useGameStore.setState({
    pendingDialog: { method: 'gameSelect', messageId: 11, data } as never,
  });
}

describe('CombatBanner — declare attackers', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the prompt + Done button', () => {
    setCombatDialog('Select attackers', {
      possibleAttackers: ['a-1', 'a-2'],
    });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.getByTestId('combat-banner-message').textContent).toBe(
      'Select attackers',
    );
    expect(screen.getByTestId('combat-banner-done')).toBeInTheDocument();
  });

  it('Done sends boolean true (commit) — NOT false (which would be misleading)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={stream} isAttackers />);
    await user.click(screen.getByTestId('combat-banner-done'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(11, 'boolean', true);
  });

  it('does NOT render a Cancel button', () => {
    // Per MTG rules expert audit: boolean false hits the same
    // checkIfAttackersValid branch as true. Rendering a "Cancel"
    // would be misleading UX — looks reversible but commits.
    setCombatDialog('Select attackers');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('renders "All attack" button only when specialButton option is present', () => {
    setCombatDialog('Select attackers', {
      possibleAttackers: ['a-1'],
      specialButton: 'All attack',
    });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.getByTestId('combat-banner-all-attack').textContent).toBe(
      'All attack',
    );
  });

  it('omits "All attack" button when specialButton option is empty', () => {
    setCombatDialog('Select attackers', {
      possibleAttackers: ['a-1'],
      specialButton: '',
    });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.queryByTestId('combat-banner-all-attack')).toBeNull();
  });

  it('All attack click sends string "special"', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setCombatDialog('Select attackers', {
      possibleAttackers: ['a-1'],
      specialButton: 'All attack',
    });
    render(<CombatBanner stream={stream} isAttackers />);
    await user.click(screen.getByTestId('combat-banner-all-attack'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(
      11,
      'string',
      'special',
    );
  });
});

describe('CombatBanner — declare blockers', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders the prompt + Done button', () => {
    setCombatDialog('Select blockers', {
      possibleBlockers: ['b-1', 'b-2'],
    });
    render(<CombatBanner stream={fakeStream()} isAttackers={false} />);
    expect(screen.getByTestId('combat-banner-message').textContent).toBe(
      'Select blockers',
    );
    expect(screen.getByTestId('combat-banner-done')).toBeInTheDocument();
  });

  it('does NOT render an "All attack" button on blockers (selectBlockers does not populate SPECIAL_BUTTON)', () => {
    setCombatDialog('Select blockers', {
      possibleBlockers: ['b-1'],
      // Even if specialButton is somehow present, the `isAttackers`
      // gate hides it — declare-blockers semantically has no all-attack.
      specialButton: 'something',
    });
    render(<CombatBanner stream={fakeStream()} isAttackers={false} />);
    expect(screen.queryByTestId('combat-banner-all-attack')).toBeNull();
  });

  it('phase data attribute distinguishes attackers vs blockers', () => {
    setCombatDialog('Select blockers', { possibleBlockers: ['b-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers={false} />);
    expect(
      screen.getByTestId('combat-banner').getAttribute('data-combat-phase'),
    ).toBe('blockers');
  });
});

describe('CombatBanner — defensive', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders nothing when no pendingDialog', () => {
    const { container } = render(
      <CombatBanner stream={fakeStream()} isAttackers />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when method is not gameSelect', () => {
    useGameStore.setState({
      pendingDialog: {
        method: 'gameAsk',
        messageId: 1,
        data: webGameClientMessageSchema.parse({
          gameView: null, message: 'q', targets: [], cardsView1: {},
          min: 0, max: 0, flag: false, choice: null,
        }),
      } as never,
    });
    const { container } = render(
      <CombatBanner stream={fakeStream()} isAttackers />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('banner confines pointer events to its own bounding box; creature clicks elsewhere pass through', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    // Banner positions itself via {@link useDraggable}; no
    // enclosing positioner div, so click-through behind the banner
    // is preserved by the banner's small bounding box.
    expect(
      screen.getByTestId('combat-banner').className,
    ).toContain('pointer-events-auto');
    expect(screen.queryByTestId('combat-banner-positioner')).toBeNull();
  });

  it('halo spotlight is rendered for visual attention', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const halo = screen.getByTestId('combat-banner-halo');
    expect(halo.className).toContain('animate-banner-halo-rotate');
  });

  it('drag handle attribute is set so useDraggable can pick it up', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const banner = screen.getByTestId('combat-banner');
    expect(banner.hasAttribute('data-drag-handle')).toBe(true);
    expect(banner.className).toContain('cursor-move');
  });
});
