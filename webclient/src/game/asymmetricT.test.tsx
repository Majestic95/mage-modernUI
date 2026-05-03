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

function renderLayout() {
  const gv = buildDemoGameView();
  const me = gv.players.find((p) => p.playerId === gv.myPlayerId)!;
  const opponents = gv.players.filter((p) => p.playerId !== gv.myPlayerId);
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

  it('renders three opponent lanes for a 4-player game', () => {
    renderLayout();
    expect(screen.getByTestId('opponent-lane-0')).toBeInTheDocument();
    expect(screen.getByTestId('opponent-lane-1')).toBeInTheDocument();
    expect(screen.getByTestId('opponent-lane-2')).toBeInTheDocument();
  });

  it('each opponent lane has an identity gutter + a battlefield with Lands and Non-Land sub-rows', () => {
    renderLayout();
    expect(screen.getByTestId('opponent-lane-0-gutter')).toBeInTheDocument();
    const battlefield = screen.getByTestId('opponent-lane-0-battlefield');
    expect(battlefield.querySelector('[data-zone="lands"]')).toBeTruthy();
    expect(battlefield.querySelector('[data-zone="non-land"]')).toBeTruthy();
  });

  it('local pod renders three labelled sub-rows (Creatures / Artifacts / Lands)', () => {
    renderLayout();
    const pod = screen.getByTestId('local-pod-rows');
    expect(pod.querySelector('[data-zone="creatures"]')).toBeTruthy();
    expect(pod.querySelector('[data-zone="artifacts"]')).toBeTruthy();
    expect(pod.querySelector('[data-zone="lands"]')).toBeTruthy();
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
});
