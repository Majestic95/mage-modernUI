/**
 * 2026-05-03 — coverage for the asymmetric-T battlefield layout.
 * Pins (a) the lane skeleton (3 stacked opponent lanes + 1 local
 * pod), (b) the per-lane two-row composition (Lands + Non-Land),
 * (c) the local pod's three-row composition (Creatures + Artifacts
 * + Lands), and (d) the click-to-focus state (collapsing siblings
 * to 40px portrait strips). Lives in its own file so its mocks
 * don't bleed into the legacy 4-pod-grid suite.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { AsymmetricTLayout } from './asymmetricT';
import type { InteractionMode } from './interactionMode';
import { buildDemoGameView } from './devFixtures';

vi.mock('../featureFlags', async () => {
  const actual = await vi.importActual<typeof import('../featureFlags')>(
    '../featureFlags',
  );
  return { ...actual, REDESIGN: true, LAYOUT_BOUNDS: true };
});

function renderLayout(opts: { onSpendMana?: (color: string) => void; me?: ReturnType<typeof buildDemoGameView>['players'][number] } = {}) {
  const gv = buildDemoGameView();
  const me = opts.me ?? gv.players.find((p) => p.playerId === gv.myPlayerId)!;
  const opponents = gv.players.filter((p) => p.playerId !== me.playerId);
  const mode: InteractionMode = { kind: 'idle' };
  return render(
    <MotionConfig reducedMotion="always">
      <LayoutGroup>
        <div style={{ height: '720px', width: '1280px' }}>
          <AsymmetricTLayout
            me={me}
            opponents={opponents}
            stack={gv.stack}
            combat={gv.combat}
            mode={mode}
            canAct
            onObjectClick={() => {}}
            onSpendMana={opts.onSpendMana ?? null}
            onBoardDrop={() => {}}
            drag={null}
            eligibleTargetIds={new Set()}
            eligibleCombatIds={new Set()}
            combatRoles={new Map()}
          />
        </div>
      </LayoutGroup>
    </MotionConfig>,
  );
}

describe('AsymmetricTLayout', () => {
  it('renders the top-half opponent rail and the bottom-half local pod', () => {
    renderLayout();
    expect(screen.getByTestId('asymmetric-t-layout')).toBeInTheDocument();
    expect(screen.getByTestId('opponent-lanes')).toBeInTheDocument();
    expect(screen.getByTestId('local-pod')).toBeInTheDocument();
  });

  it('renders the stack dock when the stack is non-empty', () => {
    // Demo fixture seeds Lightning Bolt on the stack.
    renderLayout();
    expect(screen.getByTestId('stack-dock')).toBeInTheDocument();
  });

  it('renders three opponent lanes for a 4-player game', () => {
    renderLayout();
    expect(screen.getByTestId('opponent-lane-0')).toBeInTheDocument();
    expect(screen.getByTestId('opponent-lane-1')).toBeInTheDocument();
    expect(screen.getByTestId('opponent-lane-2')).toBeInTheDocument();
  });

  it('each opponent lane has an identity gutter + a battlefield with Lands, Artifacts, and Creatures sub-rows', () => {
    renderLayout();
    expect(screen.getByTestId('opponent-lane-0-gutter')).toBeInTheDocument();
    const battlefield = screen.getByTestId('opponent-lane-0-battlefield');
    expect(battlefield.querySelector('[data-zone="lands"]')).toBeTruthy();
    expect(battlefield.querySelector('[data-zone="artifacts"]')).toBeTruthy();
    expect(battlefield.querySelector('[data-zone="creatures"]')).toBeTruthy();
  });

  it('local pod renders three labelled sub-rows (Creatures / Artifacts / Lands)', () => {
    renderLayout();
    const pod = screen.getByTestId('local-pod-rows');
    expect(pod.querySelector('[data-zone="creatures"]')).toBeTruthy();
    expect(pod.querySelector('[data-zone="artifacts"]')).toBeTruthy();
    expect(pod.querySelector('[data-zone="lands"]')).toBeTruthy();
  });

  it('local pod has no white halo border (user direction 2026-05-03)', () => {
    // Opponent lanes still carry the white halo + breathing
    // active-glow; the local pod doesn't need framing because the
    // floating portrait + mana pool + hand fan are its identity
    // affordances. Only the drop-target ring renders a border on
    // the local pod, and only while a hand drag is in flight.
    renderLayout();
    const pod = screen.getByTestId('local-pod-rows');
    expect(pod.className).not.toMatch(/animate-lane-active-glow/);
    // No `border` utility class either (drop-target adds it
    // dynamically; idle state has none).
    expect(pod.className).not.toMatch(/\bborder\b/);
    // Opponent lanes keep their halo: pick lane 0 and check.
    const oppLane = screen.getByTestId('opponent-lane-0');
    // The lane wrapper carries STATIC_HALO_STYLE inline, which sets
    // an rgba(255,255,255,0.55) border-color. Read the inline style.
    expect(oppLane.getAttribute('style') ?? '').toMatch(
      /border-color:\s*rgba\(255,\s*255,\s*255/,
    );
  });

  it('clicking an opponent lane focus button collapses the other lanes', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('opponent-lane-0-focus'));
    expect(screen.getByTestId('opponent-lane-0')).toHaveAttribute(
      'data-focused',
      'true',
    );
    expect(screen.getByTestId('opponent-lane-1')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
    expect(screen.getByTestId('opponent-lane-2')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
  });

  it('clicking the focused lane button again restores all three lanes to equal share', () => {
    renderLayout();
    const focusBtn = screen.getByTestId('opponent-lane-0-focus');
    fireEvent.click(focusBtn);
    fireEvent.click(focusBtn);
    expect(screen.getByTestId('opponent-lane-0')).not.toHaveAttribute(
      'data-focused',
    );
    expect(screen.getByTestId('opponent-lane-1')).not.toHaveAttribute(
      'data-collapsed',
    );
  });

  it('clicking a collapsed sibling promotes it to focus and collapses the previously focused lane', () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('opponent-lane-0-focus'));
    fireEvent.click(screen.getByTestId('opponent-lane-2'));
    expect(screen.getByTestId('opponent-lane-2')).toHaveAttribute(
      'data-focused',
      'true',
    );
    expect(screen.getByTestId('opponent-lane-0')).toHaveAttribute(
      'data-collapsed',
      'true',
    );
  });

  // 2026-05-03 — local floating mana pool relocated from MyHand
  // (top-right of hand region) to here (above the local portrait)
  // because the prior placement lived in a z-30 stacking context the
  // local PlayerFrame at z-40 buried, and was far from the portrait
  // anyway. User directive: "display floating mana by the local
  // player's portrait."
  it('renders the floating local mana pool to the right of the portrait, stacked vertically', () => {
    const gv = buildDemoGameView();
    const baseMe = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
    const me = {
      ...baseMe,
      manaPool: { red: 1, green: 0, blue: 0, white: 0, black: 0, colorless: 2 },
    };
    renderLayout({ me });
    const pool = screen.getByTestId('local-mana-pool-floating');
    // User direction 2026-05-03: orbs to the right of the portrait
    // (right-4 = 16px from container right edge), stacked vertically
    // so 5 colors don't crowd into the side panel. z-40 puts them on
    // the same layer as the local-player-frame-corner.
    expect(pool.className).toMatch(/right-4/);
    expect(pool.className).toMatch(/bottom-12/);
    expect(pool.className).toMatch(/z-40/);
    // Vertical stacking: ManaPool's wrapper span gets flex-col when
    // layout="vertical".
    const orbWrapper = pool.querySelector('span');
    expect(orbWrapper?.className).toMatch(/flex-col/);
  });

  it('does not render the floating local mana pool when the pool is empty', () => {
    renderLayout();
    expect(screen.queryByTestId('local-mana-pool-floating')).toBeNull();
  });

  it('passes onSpend to the local mana pool when click-to-spend is wired', () => {
    const gv = buildDemoGameView();
    const baseMe = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
    const me = {
      ...baseMe,
      manaPool: { red: 1, green: 0, blue: 0, white: 0, black: 0, colorless: 0 },
    };
    const onSpend = vi.fn();
    renderLayout({ me, onSpendMana: onSpend });
    // ManaOrb renders as a button when onClick is bound.
    const redOrb = screen.getByTestId('mana-orb-R');
    expect(redOrb.tagName).toBe('BUTTON');
    fireEvent.click(redOrb);
    expect(onSpend).toHaveBeenCalledWith('R');
  });
});
