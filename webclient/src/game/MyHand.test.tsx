/**
 * Slice 70-P — MyHand REDESIGN coverage. Tests the dropped panel
 * chrome, the floating mana pool mount in the top-right corner,
 * and the disabled-hint relocation per picture-catalog §4.
 *
 * <p>Flag-mock pattern mirrors GameLog.test.tsx — toggle
 * {@code flagState.redesign} per test to exercise both branches.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
// vi is imported above; included here for clarity in the new
// elementFromPoint stub used by the reorder test.
import {
  webPlayerViewSchema,
  type WebPlayerView,
} from '../api/schemas';

const flagState = vi.hoisted(() => ({ redesign: false }));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
  CLICK_RESOLUTION: false,
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

describe('MyHand — hand reorder via drag-and-drop (2026-05-02)', () => {
  // Use two minimal cards. The schema requires several fields, but
  // since these tests only exercise rendering / pointer events on
  // hand-card buttons, a stripped object cast through `as any` keeps
  // the fixture compact.
  const A = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', cardId: 'aid', name: 'Card A', cardNumber: '1' } as never;
  const B = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', cardId: 'bid', name: 'Card B', cardNumber: '2' } as never;

  it('renders cards in the user-provided order; drop on a different hand card moves the dragged one to that slot', () => {
    const reorderCalls: Array<[string, string]> = [];

    // First render: hand has A then B in iteration order. The drag-
    // in-progress is on A; releasing pointer on B should fire a
    // reorder dispatch (A → B's slot).
    render(
      <MyHand
        {...PASSTHROUGH}
        hand={{ [A.id]: A, [B.id]: B }}
        draggedCardId={A.id}
        onObjectClick={() => {
          // Internal reorder doesn't go through onObjectClick — this
          // is just a placeholder so we know if a stray cast fires.
          reorderCalls.push(['cast', 'fired']);
        }}
      />,
    );

    const cards = screen.getAllByTestId('hand-card');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute('data-card-id', A.id);
    expect(cards[1]).toHaveAttribute('data-card-id', B.id);

    // The reorder detection runs at document level via
    // elementFromPoint (browser layout-aware). jsdom doesn't define
    // elementFromPoint, so install a stub that returns card B for
    // this pointerup, simulating "user released cursor over card B."
    const original = (document as unknown as { elementFromPoint: unknown })
      .elementFromPoint;
    (document as unknown as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint =
      () => cards[1];
    try {
      fireEvent.pointerUp(document, { pointerId: 1, bubbles: true });
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint =
        original;
    }

    const cardsAfter = screen.getAllByTestId('hand-card');
    expect(cardsAfter[0]).toHaveAttribute('data-card-id', B.id);
    expect(cardsAfter[1]).toHaveAttribute('data-card-id', A.id);
    // No stray cast fired during the reorder.
    expect(reorderCalls).toHaveLength(0);
  });

  it('drop card 4 onto card 1 inserts at slot 0 and shifts cards 1-3 right (insert/shift, not swap)', () => {
    // User-reported scenario (2026-05-02): "drop card 4 on card 1,
    // expect [4, 1, 2, 3] — card 4 takes card 1's slot, the rest
    // scoot over." Earlier swap semantics produced [4, 2, 3, 1] which
    // didn't match the physical-hand reorder mental model.
    const C = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', cardId: 'cid', name: 'Card C', cardNumber: '3' } as never;
    const D = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', cardId: 'did', name: 'Card D', cardNumber: '4' } as never;

    render(
      <MyHand
        {...PASSTHROUGH}
        hand={{ [A.id]: A, [B.id]: B, [C.id]: C, [D.id]: D }}
        draggedCardId={D.id}
      />,
    );

    const cards = screen.getAllByTestId('hand-card');
    expect(cards.map((el) => el.getAttribute('data-card-id'))).toEqual([
      A.id,
      B.id,
      C.id,
      D.id,
    ]);

    const original = (document as unknown as { elementFromPoint: unknown })
      .elementFromPoint;
    (document as unknown as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint =
      () => cards[0]; // drop on card A (slot 0)
    try {
      fireEvent.pointerUp(document, { pointerId: 1, bubbles: true });
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint =
        original;
    }

    const cardsAfter = screen.getAllByTestId('hand-card');
    expect(cardsAfter.map((el) => el.getAttribute('data-card-id'))).toEqual([
      D.id, // 4 took 1's slot
      A.id, // 1 shifted right
      B.id, // 2 shifted right
      C.id, // 3 shifted right
    ]);
  });

  it('drag-right insert: drop card 1 onto card 4 places 1 after 4 (cards 2-3 shift left)', () => {
    // Mirror direction of the user's example: dragging right inserts
    // AFTER the target so the visible result is "1 ends up at the
    // right end, 2-3 scoot left."
    const C = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', cardId: 'cid', name: 'Card C', cardNumber: '3' } as never;
    const D = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', cardId: 'did', name: 'Card D', cardNumber: '4' } as never;

    render(
      <MyHand
        {...PASSTHROUGH}
        hand={{ [A.id]: A, [B.id]: B, [C.id]: C, [D.id]: D }}
        draggedCardId={A.id}
      />,
    );

    const cards = screen.getAllByTestId('hand-card');
    const original = (document as unknown as { elementFromPoint: unknown })
      .elementFromPoint;
    (document as unknown as { elementFromPoint: typeof document.elementFromPoint }).elementFromPoint =
      () => cards[3]; // drop on card D (slot 3)
    try {
      fireEvent.pointerUp(document, { pointerId: 1, bubbles: true });
    } finally {
      (document as unknown as { elementFromPoint: unknown }).elementFromPoint =
        original;
    }

    const cardsAfter = screen.getAllByTestId('hand-card');
    expect(cardsAfter.map((el) => el.getAttribute('data-card-id'))).toEqual([
      B.id,
      C.id,
      D.id,
      A.id,
    ]);
  });

  it('hand cards remain interactive (aria-disabled instead of disabled) when canAct=false', () => {
    render(
      <MyHand
        {...PASSTHROUGH}
        canAct={false}
        hand={{ [A.id]: A }}
      />,
    );
    const card = screen.getByTestId('hand-card');
    // The native `disabled` attribute would block pointer events and
    // freeze drag-to-reorder. aria-disabled keeps SR semantics.
    expect(card).not.toBeDisabled();
    expect(card).toHaveAttribute('aria-disabled', 'true');
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
