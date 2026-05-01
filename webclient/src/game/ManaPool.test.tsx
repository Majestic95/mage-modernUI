import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManaPool } from './ManaPool';
import { webPlayerViewSchema } from '../api/schemas';

/**
 * Slice 70-X.10 (Wave 2) — locks the mana-payment dispatch chain. The
 * webclient's full {@code gamePlayMana} response path is:
 *
 * <pre>
 *   GameTable derives onSpendMana(color)
 *     → MyHand passes via prop
 *       → ManaPool's onSpend(color) callback
 *         → ManaOrb.onClick (per orb)
 *           → engine response sendPlayerResponse(messageId, 'manaType', ...)
 * </pre>
 *
 * <p>Pre-Wave-2 nothing tested {@link ManaPool} at all. The orb
 * unit test ({@code ManaOrb.test.tsx}) confirms the click handler
 * fires; this file confirms the pool wires the right color to each
 * orb, only renders orbs for non-zero pools, and threads the
 * {@code onSpend} callback only when provided. The slice 70-X.10
 * regression mode would be to drop the per-color handler entirely —
 * pool renders fine but clicks do nothing.
 */
const ZERO_POOL = {
  white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0,
};

function playerWithPool(pool: Partial<typeof ZERO_POOL>) {
  return webPlayerViewSchema.parse({
    playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'alice',
    life: 20, wins: 0, winsNeeded: 1, libraryCount: 53, handCount: 7,
    graveyard: {}, exile: {}, sideboard: {}, battlefield: {},
    manaPool: { ...ZERO_POOL, ...pool },
    controlled: true, isHuman: true, isActive: true, hasPriority: true,
    hasLeft: false, monarch: false, initiative: false, designationNames: [],
  });
}

describe('ManaPool', () => {
  it('renders no orbs when every pool color is zero', () => {
    render(<ManaPool player={playerWithPool({})} />);
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
      expect(screen.queryByTestId(`mana-orb-${color}`)).toBeNull();
    }
  });

  it('renders one orb per non-zero color', () => {
    render(<ManaPool player={playerWithPool({ red: 2, blue: 1 })} />);
    expect(screen.getByTestId('mana-orb-R')).toBeInTheDocument();
    expect(screen.getByTestId('mana-orb-U')).toBeInTheDocument();
    expect(screen.queryByTestId('mana-orb-W')).toBeNull();
    expect(screen.queryByTestId('mana-orb-B')).toBeNull();
    expect(screen.queryByTestId('mana-orb-G')).toBeNull();
    expect(screen.queryByTestId('mana-orb-C')).toBeNull();
  });

  it('orbs are non-interactive spans when onSpend is omitted', () => {
    render(<ManaPool player={playerWithPool({ red: 3 })} />);
    expect(screen.getByTestId('mana-orb-R').tagName).toBe('SPAN');
  });

  it('orbs become buttons when onSpend is provided', () => {
    render(
      <ManaPool player={playerWithPool({ red: 3, white: 1 })} onSpend={() => {}} />,
    );
    expect(screen.getByTestId('mana-orb-R').tagName).toBe('BUTTON');
    expect(screen.getByTestId('mana-orb-W').tagName).toBe('BUTTON');
  });

  it('clicking an orb fires onSpend with the matching color', async () => {
    const onSpend = vi.fn();
    const user = userEvent.setup();
    render(
      <ManaPool
        player={playerWithPool({ red: 2, blue: 3, green: 1 })}
        onSpend={onSpend}
      />,
    );
    await user.click(screen.getByTestId('mana-orb-G'));
    expect(onSpend).toHaveBeenCalledWith('G');
    await user.click(screen.getByTestId('mana-orb-U'));
    expect(onSpend).toHaveBeenLastCalledWith('U');
    expect(onSpend).toHaveBeenCalledTimes(2);
  });

  it('all six color codes route through onSpend correctly', async () => {
    const onSpend = vi.fn();
    const user = userEvent.setup();
    render(
      <ManaPool
        player={playerWithPool({
          white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 1,
        })}
        onSpend={onSpend}
      />,
    );
    for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
      await user.click(screen.getByTestId(`mana-orb-${color}`));
    }
    expect(onSpend.mock.calls.map((c) => c[0])).toEqual([
      'W', 'U', 'B', 'R', 'G', 'C',
    ]);
  });

  it('does not render orbs for negative-or-zero counts (defensive)', () => {
    // Defensive: schema doesn't allow negative but the > 0 filter is
    // load-bearing; lock it.
    render(<ManaPool player={playerWithPool({ red: 0, blue: 5 })} />);
    expect(screen.queryByTestId('mana-orb-R')).toBeNull();
    expect(screen.getByTestId('mana-orb-U')).toBeInTheDocument();
  });
});
