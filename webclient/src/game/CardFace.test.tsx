import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { CardFace } from './CardFace';
import {
  webCardViewSchema,
  webPermanentViewSchema,
  type WebCardView,
  type WebPermanentView,
} from '../api/schemas';

/**
 * Slice 59 — combat damage flash + counter pop tests.
 *
 * Both effects mirror the LifeTotal precedent in Game.tsx: a useRef
 * tracks the previous value, a useEffect detects an INCREASE, and a
 * keyed motion.div pops/flashes once per increase. Decreases (heal,
 * counter removal) and the first render do NOT fire the effect.
 *
 * Tests render {@link CardFace} directly and rerender with mutated
 * permanents. Detection is via {@code data-damage-flash-key} (damage
 * overlay) and {@code data-counter-pop-key} (counter chip).
 */

const BASE_CARD = webCardViewSchema.parse({
  id: '11111111-1111-1111-1111-111111111111',
  cardId: '22222222-2222-2222-2222-222222222222',
  name: 'Grizzly Bear',
  displayName: 'Grizzly Bear',
  expansionSetCode: 'M21',
  cardNumber: '001',
  manaCost: '{1}{G}',
  manaValue: 2,
  typeLine: 'Creature — Bear',
  supertypes: [],
  types: ['CREATURE'],
  subtypes: ['Bear'],
  colors: ['G'],
  rarity: 'COMMON',
  power: '2',
  toughness: '2',
  startingLoyalty: '',
  rules: [],
  faceDown: false,
  counters: {},
  transformable: false,
  transformed: false,
  secondCardFace: null,
});

function buildPerm(
  card: WebCardView,
  damage: number,
): WebPermanentView {
  return webPermanentViewSchema.parse({
    card,
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  });
}

function withCounters(counters: Record<string, number>): WebCardView {
  return { ...BASE_CARD, counters };
}

describe('CardFace damage flash (slice 59)', () => {
  it('does not show a damage flash on first render even if damage > 0', () => {
    // First-render contract — the useEffect detector compares against
    // useRef seeded with the initial value, so the first commit is
    // never an "increase" relative to itself. A creature ETBing with
    // damage already marked (rare but possible — e.g. mid-game state
    // refresh) should not pop a spurious flash.
    render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 2)}
      />,
    );
    expect(screen.queryByTestId('damage-flash')).toBeNull();
  });

  it('shows a damage flash when damage increases', () => {
    const { rerender } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
      />,
    );
    expect(screen.queryByTestId('damage-flash')).toBeNull();

    act(() => {
      rerender(
        <CardFace
          card={BASE_CARD}
          size="battlefield"
          perm={buildPerm(BASE_CARD, 2)}
        />,
      );
    });

    const flash = screen.getByTestId('damage-flash');
    expect(flash).toBeInTheDocument();
    expect(flash.getAttribute('data-damage-flash-key')).toBe('1');
  });

  it('does not show a damage flash when damage decreases (heal)', () => {
    const { rerender } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 3)}
      />,
    );

    act(() => {
      rerender(
        <CardFace
          card={BASE_CARD}
          size="battlefield"
          perm={buildPerm(BASE_CARD, 0)}
        />,
      );
    });

    expect(screen.queryByTestId('damage-flash')).toBeNull();
  });
});

describe('CardFace counter pop (slice 59)', () => {
  it('does not pop on the first render when counters already exist', () => {
    // The chip mounts with counterPopKey === 0; initial: scale 1
    // (not 1.3). The data-counter-pop-key attribute reads "0" so the
    // test can lock the no-spurious-pop contract on mount.
    render(
      <CardFace
        card={withCounters({ '+1/+1': 2 })}
        size="battlefield"
        perm={buildPerm(withCounters({ '+1/+1': 2 }), 0)}
      />,
    );
    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('0');
  });

  it('pops when counter total increases (0 → 1)', () => {
    const { rerender } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
      />,
    );
    // No counters yet — chip not rendered.
    expect(screen.queryByTestId('permanent-counters')).toBeNull();

    const buffed = withCounters({ '+1/+1': 1 });
    act(() => {
      rerender(
        <CardFace
          card={buffed}
          size="battlefield"
          perm={buildPerm(buffed, 0)}
        />,
      );
    });

    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('1');
  });

  it('pops again on subsequent counter increases (1 → 3)', () => {
    const start = withCounters({ '+1/+1': 1 });
    const { rerender } = render(
      <CardFace
        card={start}
        size="battlefield"
        perm={buildPerm(start, 0)}
      />,
    );

    const more = withCounters({ '+1/+1': 3 });
    act(() => {
      rerender(
        <CardFace
          card={more}
          size="battlefield"
          perm={buildPerm(more, 0)}
        />,
      );
    });

    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('1');
  });

  it('does not pop when counter total decreases (3 → 1)', () => {
    const start = withCounters({ '+1/+1': 3 });
    const { rerender } = render(
      <CardFace
        card={start}
        size="battlefield"
        perm={buildPerm(start, 0)}
      />,
    );

    const removed = withCounters({ '+1/+1': 1 });
    act(() => {
      rerender(
        <CardFace
          card={removed}
          size="battlefield"
          perm={buildPerm(removed, 0)}
        />,
      );
    });

    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('0');
  });

  it('pops when total grows across multiple counter types (2 → 3)', () => {
    // Multi-type contract — counterTotal sums every counter species,
    // so {+1/+1: 1, -1/-1: 1} → {+1/+1: 2, -1/-1: 1} (total 2 → 3)
    // is still an INCREASE and must pop. This guards against a naive
    // "detect on a single counter type" implementation.
    const start = withCounters({ '+1/+1': 1, '-1/-1': 1 });
    const { rerender } = render(
      <CardFace
        card={start}
        size="battlefield"
        perm={buildPerm(start, 0)}
      />,
    );

    const grown = withCounters({ '+1/+1': 2, '-1/-1': 1 });
    act(() => {
      rerender(
        <CardFace
          card={grown}
          size="battlefield"
          perm={buildPerm(grown, 0)}
        />,
      );
    });

    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('1');
  });

  it('does not pop when total shrinks across multiple counter types (2 → 1)', () => {
    // Inverse of the prior — {+1/+1: 1, -1/-1: 1} → {+1/+1: 1}
    // (total 2 → 1, a -1/-1 wears off). Net counters DOWN, no pop.
    const start = withCounters({ '+1/+1': 1, '-1/-1': 1 });
    const { rerender } = render(
      <CardFace
        card={start}
        size="battlefield"
        perm={buildPerm(start, 0)}
      />,
    );

    const shrunk = withCounters({ '+1/+1': 1 });
    act(() => {
      rerender(
        <CardFace
          card={shrunk}
          size="battlefield"
          perm={buildPerm(shrunk, 0)}
        />,
      );
    });

    const chip = screen.getByTestId('permanent-counters');
    expect(chip.getAttribute('data-counter-pop-key')).toBe('0');
  });
});

describe('CardFace damaged toughness display (CR 121.3)', () => {
  it('renders effective toughness in red when damage > 0', () => {
    // 2/2 with 1 damage marked → renders as 2/1 with the toughness
    // span carrying data-damaged + the danger-color class. Mirrors
    // MTGO/MTGA convention; damage chip stays as the absolute marker.
    render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 1)}
      />,
    );
    const tough = screen.getByTestId('permanent-toughness');
    expect(tough.textContent).toBe('1');
    expect(tough.getAttribute('data-damaged')).toBe('true');
    expect(tough.className).toContain('text-status-danger');
  });

  it('renders raw toughness without red when damage is 0', () => {
    render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
      />,
    );
    const tough = screen.getByTestId('permanent-toughness');
    expect(tough.textContent).toBe('2');
    expect(tough.getAttribute('data-damaged')).toBeNull();
    expect(tough.className).not.toContain('text-status-danger');
  });

  it('clamps display to 0 when damage exceeds toughness', () => {
    // Mid-frame snapshot before SBAs destroy the creature. We render
    // 0 (red) rather than a negative number; the next wire update
    // removes the permanent.
    render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 5)}
      />,
    );
    const tough = screen.getByTestId('permanent-toughness');
    expect(tough.textContent).toBe('0');
    expect(tough.getAttribute('data-damaged')).toBe('true');
  });

  it('passes through `*` toughness unchanged even with damage', () => {
    const tarmogoyf = { ...BASE_CARD, power: '*', toughness: '1+*' };
    render(
      <CardFace
        card={tarmogoyf}
        size="battlefield"
        perm={buildPerm(tarmogoyf, 2)}
      />,
    );
    const tough = screen.getByTestId('permanent-toughness');
    expect(tough.textContent).toBe('1+*');
    expect(tough.getAttribute('data-damaged')).toBeNull();
  });
});

/* ===================================================================
 * Bundle 4 / Slice 4-C — combat-eligibility shimmer.
 *
 * Coverage matrix:
 *   - isEligibleCombat=true → element carries both the static ring
 *     class AND the new pulse class.
 *   - isEligibleCombat=false → neither class present (creature is
 *     not legal during the current declare-step).
 *   - Reduced-motion is handled by the global rule at index.css:644
 *     and is not a CardFace.tsx concern — pulse class still applied,
 *     keyframe is suppressed by the media query. We test the class
 *     application here; the suppression behavior is a CSS contract
 *     covered by the project-wide reduced-motion machinery.
 * =================================================================*/

describe('CardFace combat eligibility shimmer (slice 4-C)', () => {
  it('isEligibleCombat=true adds both the static ring and the pulse class', () => {
    const { container } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
        isEligibleCombat={true}
      />,
    );
    // Find the element carrying the eligibility ring — the
    // composed className includes both `ring-2 ring-amber-400/60`
    // (static) and `animate-combat-eligibility-pulse` (animated).
    const ringEl = container.querySelector(
      '.animate-combat-eligibility-pulse',
    );
    expect(ringEl).not.toBeNull();
    expect(ringEl?.className).toContain('ring-2');
    expect(ringEl?.className).toContain('ring-amber-400/60');
  });

  it('isEligibleCombat=false has neither the static ring nor the pulse class', () => {
    const { container } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
        isEligibleCombat={false}
      />,
    );
    expect(
      container.querySelector('.animate-combat-eligibility-pulse'),
    ).toBeNull();
    expect(container.querySelector('.ring-amber-400\\/60')).toBeNull();
  });

  it('omitted isEligibleCombat (default false) has no pulse class', () => {
    // Default behavior — slice 4-C must not regress non-combat
    // creatures into showing the pulse.
    const { container } = render(
      <CardFace
        card={BASE_CARD}
        size="battlefield"
        perm={buildPerm(BASE_CARD, 0)}
      />,
    );
    expect(
      container.querySelector('.animate-combat-eligibility-pulse'),
    ).toBeNull();
  });
});
