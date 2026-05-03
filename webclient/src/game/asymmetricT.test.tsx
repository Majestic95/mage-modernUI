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

  it('every layout zone clips its overflow (user direction: nothing bleeds outside its zone)', () => {
    renderLayout();
    // Layout shells that hold cards / player chrome — none of them
    // should let content paint past their bounding box. Locks the
    // overflow-hidden contract end-to-end so a future child whose
    // intrinsic size exceeds the zone gets clipped, not bled.
    const ids = [
      'asymmetric-t-layout',
      'opponent-lanes',
      'opponent-lane-0',
      'opponent-lane-0-gutter',
      'opponent-lane-0-battlefield',
      'opponent-lane-1',
      'opponent-lane-1-gutter',
      'opponent-lane-1-battlefield',
      'opponent-lane-2',
      'opponent-lane-2-gutter',
      'opponent-lane-2-battlefield',
      'local-pod',
      'local-pod-rows',
    ];
    for (const id of ids) {
      const el = screen.getByTestId(id);
      expect(el.className, `zone "${id}" must include overflow-hidden`).toMatch(
        /overflow-hidden/,
      );
    }
  });

  it('local pod has no white halo border (user direction 2026-05-03)', () => {
    // The local pod doesn't need framing — the floating portrait +
    // mana pool + hand fan are its identity affordances. Only the
    // drop-target ring renders a border on the local pod, and only
    // while a hand drag is in flight.
    renderLayout();
    const pod = screen.getByTestId('local-pod-rows');
    expect(pod.className).not.toMatch(/animate-lane-active-glow/);
    expect(pod.className).not.toMatch(/animate-lane-spotlight/);
    // No `border` utility class either (drop-target adds it
    // dynamically; idle state has none).
    expect(pod.className).not.toMatch(/\bborder\b/);
  });

  // 2026-05-03 (user direction) — only the active opponent's lane
  // carries the spotlight halo (rotating gold streak + co-rotating
  // bloom + breathing pulse, mimicking the focal-card spotlight).
  // Inactive opponent lanes have no halo at all; the prior static
  // white border + soft glow on every lane has been dropped.
  it('inactive opponent lanes render no halo overlay', () => {
    renderLayout();
    // buildDemoGameView marks the FIRST opponent as active; the
    // second + third are inactive. Verify both inactive lanes have
    // no spotlight and no white border.
    for (const id of ['opponent-lane-1', 'opponent-lane-2']) {
      const lane = screen.getByTestId(id);
      expect(lane.querySelector('[data-testid="lane-spotlight-halo"]')).toBeNull();
      expect(lane.getAttribute('style') ?? '').not.toMatch(
        /border-color:\s*rgba\(255,\s*255,\s*255/,
      );
    }
  });

  it('the active opponent lane mounts the spotlight halo with bloom + streak children that share --halo-angle', () => {
    const gv = buildDemoGameView();
    // Promote opponent-1 to active (override the demo fixture).
    const opponents = gv.players.filter((p) => p.playerId !== gv.myPlayerId);
    const activeOpponent = { ...opponents[1]!, isActive: true };
    const otherOpponents = opponents
      .filter((_, idx) => idx !== 1)
      .map((p) => ({ ...p, isActive: false }));
    const me = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
    render(
      <MotionConfig reducedMotion="always">
        <LayoutGroup>
          <div style={{ height: '720px', width: '1280px' }}>
            <AsymmetricTLayout
              me={{ ...me, isActive: false }}
              opponents={[otherOpponents[0]!, activeOpponent, otherOpponents[1]!]}
              stack={gv.stack}
              combat={gv.combat}
              mode={{ kind: 'idle' } as InteractionMode}
              canAct
              onObjectClick={() => {}}
              onSpendMana={null}
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
    const halo = screen.getByTestId('lane-spotlight-halo');
    expect(halo.className).toMatch(/animate-lane-spotlight/);
    // Both layers render. Single source of truth for rotation —
    // the parent owns `--halo-angle` via `animate-lane-spotlight`,
    // children read `var(--halo-angle, 0deg)` in their conic-gradient.
    const bloom = screen.getByTestId('lane-spotlight-bloom');
    const streak = screen.getByTestId('lane-spotlight-streak');
    expect(bloom.style.background).toContain(
      'conic-gradient(from var(--halo-angle, 0deg)',
    );
    expect(streak.style.background).toContain(
      'conic-gradient(from var(--halo-angle, 0deg)',
    );
    // Bloom is blurred; streak is not.
    expect(bloom.style.filter).toContain('blur');
    expect(streak.style.filter).toBe('');
    // Streak mask carves a perimeter ring — `padding: 3px` is what
    // gives the ring its thickness.
    expect(streak.style.padding).toBe('3px');
  });

  it('only one opponent lane has the spotlight at a time', () => {
    renderLayout();
    expect(screen.queryAllByTestId('lane-spotlight-halo').length).toBeLessThanOrEqual(1);
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
