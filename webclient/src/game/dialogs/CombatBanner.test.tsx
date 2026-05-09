import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombatBanner } from './CombatBanner';
import { useGameStore } from '../store';
import type { GameStream } from '../stream';
import {
  webGameClientMessageSchema,
  type WebGameView,
} from '../../api/schemas';

/**
 * Bundle 3-B helper — set just enough of {@code gameView} on the store
 * for the banner's sub-title read. The banner only dereferences
 * {@code gameView?.step}, so a partial cast is safe and avoids the
 * overhead of building a full schema-validated game view for every
 * test case (the full builder pattern lives in store.test.ts and is
 * justified there because the store itself reads many fields).
 */
function setStep(step: string) {
  useGameStore.setState({
    gameView: { step } as unknown as WebGameView,
  });
}

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

describe('CombatBanner — bundle 3-B depth ladder', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('title row reads "Combat" (dropped the "— attackers/blockers" suffix; sub-step lives in sub-title now)', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.getByTestId('combat-banner-title').textContent).toBe(
      'Combat',
    );
  });

  it('renders the sub-title with the active combat sub-step name (DECLARE_ATTACKERS → "Declare attackers")', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const subtitle = screen.getByTestId('combat-banner-subtitle');
    expect(subtitle.textContent).toBe('Declare attackers');
    expect(subtitle.getAttribute('data-step')).toBe('DECLARE_ATTACKERS');
  });

  it('sub-title flips to "Declare blockers" when step = DECLARE_BLOCKERS', () => {
    setCombatDialog('Select blockers', { possibleBlockers: ['b-1'] });
    setStep('DECLARE_BLOCKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers={false} />);
    expect(screen.getByTestId('combat-banner-subtitle').textContent).toBe(
      'Declare blockers',
    );
  });

  it('hides the sub-title row when step is empty (defensive — banner without gameView)', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    // gameView is null after reset; setStep not called. The banner
    // must still render — the sub-title is purely an enrichment.
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.queryByTestId('combat-banner-subtitle')).toBeNull();
    expect(screen.getByTestId('combat-banner-message')).toBeInTheDocument();
  });

  it('hides the sub-title row when step is outside the combat enum range', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('PRECOMBAT_MAIN');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.queryByTestId('combat-banner-subtitle')).toBeNull();
  });

  it('renders the de-emphasized hint row at testid combat-banner-hint', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const hint = screen.getByTestId('combat-banner-hint');
    expect(hint.textContent).toBe('Click creatures on the board to toggle');
    // De-emphasized one notch (zinc-500 → zinc-600) per spec.
    expect(hint.className).toContain('text-zinc-600');
    expect(hint.className).not.toContain('text-zinc-500');
  });

  it('Done button is the outlined-pill primary affordance', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const done = screen.getByTestId('combat-banner-done');
    expect(done.className).toContain('rounded-full');
    expect(done.className).toContain('border-2');
    expect(done.className).toContain('border-amber-400');
  });

  it('banner has the inset top-edge highlight (lifts the frosted band off battlefield)', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const banner = screen.getByTestId('combat-banner');
    // Inline style merges the spotlight + the inset highlight; we
    // check the inset stripe by string-match on the boxShadow value.
    expect(banner.style.boxShadow).toContain('inset 0 1px 0');
  });

  it('Done click still sends boolean true (regression — depth ladder must not break dispatch)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={stream} isAttackers />);
    await user.click(screen.getByTestId('combat-banner-done'));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(11, 'boolean', true);
  });
});

describe('CombatBanner — bundle 3-C tempo meter', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('renders the tempo bar container and fill sub-element', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    expect(screen.getByTestId('combat-banner-tempo')).toBeInTheDocument();
    expect(screen.getByTestId('combat-banner-tempo-fill')).toBeInTheDocument();
  });

  it('tempo fill starts at calm intensity (initial state — no time elapsed)', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const fill = screen.getByTestId('combat-banner-tempo-fill');
    expect(fill.getAttribute('data-intensity')).toBe('calm');
    expect(fill.style.width).toBe('0%');
    // Calm color class.
    expect(fill.className).toContain('bg-zinc-500/60');
  });

  it('tempo bar respects motion-safe transition (reduced-motion users get no width-anim)', () => {
    setCombatDialog('Select attackers', { possibleAttackers: ['a-1'] });
    setStep('DECLARE_ATTACKERS');
    render(<CombatBanner stream={fakeStream()} isAttackers />);
    const fill = screen.getByTestId('combat-banner-tempo-fill');
    // motion-safe variant prefix means the transition only applies
    // when prefers-reduced-motion is NOT reduce; reduced-motion users
    // see discrete 1s width steps.
    expect(fill.className).toContain('motion-safe:transition-');
  });
});
