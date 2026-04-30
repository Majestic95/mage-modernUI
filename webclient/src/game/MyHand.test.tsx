/**
 * Slice 70-P — MyHand REDESIGN coverage. Tests the dropped panel
 * chrome, the floating mana pool mount in the top-right corner,
 * and the disabled-hint relocation per picture-catalog §4.
 *
 * <p>Flag-mock pattern mirrors GameLog.test.tsx — toggle
 * {@code flagState.redesign} per test to exercise both branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  webPlayerViewSchema,
  type WebPlayerView,
} from '../api/schemas';

const flagState = vi.hoisted(() => ({ redesign: false }));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
}));

import { MyHand } from './MyHand';

function makePlayer(overrides: Partial<WebPlayerView> = {}): WebPlayerView {
  return webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 40,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield: {},
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: true,
    isHuman: true,
    isActive: true,
    hasPriority: true,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
    ...overrides,
  });
}

const PASSTHROUGH = {
  hand: {},
  canAct: true,
  onObjectClick: () => {},
  isMyTurn: true,
  hasPriority: true,
  onPointerDown: () => {},
  draggedCardId: null,
};

afterEach(() => {
  flagState.redesign = false;
});

describe('MyHand — REDESIGN branch (picture-catalog §4)', () => {
  it('drops the legacy "Your hand (N)" header (catalog §4.2)', () => {
    flagState.redesign = true;
    render(<MyHand {...PASSTHROUGH} player={makePlayer()} />);
    expect(screen.queryByText(/Your hand/)).toBeNull();
  });

  it('drops the panel chrome (no border / bg / padding ring) per catalog §4.1', () => {
    flagState.redesign = true;
    render(<MyHand {...PASSTHROUGH} player={makePlayer()} />);
    const root = screen.getByTestId('my-hand');
    // Catalog §4.1: "Background: Transparent (no panel fill, no
    // border)." Drop the `rounded border bg-zinc-900/40 p-3` chrome
    // from the root element.
    expect(root.className).not.toMatch(/rounded/);
    expect(root.className).not.toMatch(/border/);
    expect(root.className).not.toMatch(/bg-zinc-900/);
  });

  it('mounts the floating mana pool in the top-right corner (catalog §2.3)', () => {
    flagState.redesign = true;
    render(
      <MyHand
        {...PASSTHROUGH}
        player={makePlayer({
          manaPool: {
            red: 1,
            green: 0,
            blue: 0,
            white: 0,
            black: 0,
            colorless: 2,
          },
        })}
      />,
    );
    const pool = screen.getByTestId('hand-mana-pool');
    // Catalog §2.3: "Position for local player: TOP-RIGHT of the
    // hand region." Tailwind classes encode the corner.
    expect(pool.className).toMatch(/right-/);
    expect(pool.className).toMatch(/top-/);
  });

  it('does not render the mana pool slot when player prop is omitted', () => {
    flagState.redesign = true;
    render(<MyHand {...PASSTHROUGH} />);
    expect(screen.queryByTestId('hand-mana-pool')).toBeNull();
  });

  it('relocates the disabled-hint to a faint corner pill', () => {
    flagState.redesign = true;
    render(
      <MyHand
        {...PASSTHROUGH}
        hasPriority={false}
        player={makePlayer()}
      />,
    );
    const hint = screen.getByTestId('hand-disabled-hint');
    expect(hint).toHaveTextContent(/Waiting for opponent/);
    // Hint sits in the corner so the hand fan stays unobstructed.
    expect(hint.className).toMatch(/absolute/);
  });
});

describe('MyHand — legacy branch (slice 57 verbatim)', () => {
  it('renders the "Your hand (N)" header when REDESIGN=false', () => {
    flagState.redesign = false;
    render(<MyHand {...PASSTHROUGH} hand={{}} />);
    expect(screen.getByText(/Your hand/)).toBeInTheDocument();
  });

  it('keeps the panel chrome (border + bg) on the legacy root', () => {
    flagState.redesign = false;
    render(<MyHand {...PASSTHROUGH} />);
    const root = screen.getByTestId('my-hand');
    expect(root.className).toMatch(/border/);
    expect(root.className).toMatch(/bg-zinc-900/);
  });
});
