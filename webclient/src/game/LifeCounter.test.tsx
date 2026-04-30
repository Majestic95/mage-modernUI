import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LifeCounter } from './LifeCounter';

/**
 * Slice 70-C — pin the {@link LifeCounter} contract.
 *
 * Display-only behavior is preserved verbatim from {@code LifeTotal}
 * (slice 51) — the integration tests in Game.test.tsx already lock
 * the flash + floating-delta pipeline. Here we add coverage for the
 * NEW interactive mode used by the {@code CommanderDamageTracker}
 * (slice 70-F).
 */
describe('LifeCounter', () => {
  describe('display-only mode (default)', () => {
    it('renders the value with the "Life" label', () => {
      render(<LifeCounter value={20} />);
      expect(screen.getByText('Life')).toBeInTheDocument();
      expect(screen.getByTestId('life-counter-value').textContent).toBe('20');
    });

    it('respects a custom label override', () => {
      render(<LifeCounter value={40} label="Commander" />);
      expect(screen.getByText('Commander')).toBeInTheDocument();
    });

    it('does NOT render +/- buttons in display-only mode', () => {
      render(<LifeCounter value={20} />);
      expect(screen.queryByLabelText(/Decrement/)).toBeNull();
      expect(screen.queryByLabelText(/Increment/)).toBeNull();
    });
  });

  describe('interactive mode', () => {
    it('renders +/- buttons + value with no "Life" label', () => {
      render(<LifeCounter value={5} interactive onAdjust={() => {}} />);
      expect(screen.getByLabelText('Decrement Life')).toBeInTheDocument();
      expect(screen.getByLabelText('Increment Life')).toBeInTheDocument();
      expect(screen.getByTestId('life-counter-value').textContent).toBe('5');
      // Per spec §7.4 interactive mode is for the commander-damage
      // tracker — no "Life" prefix label.
      expect(screen.queryByText('Life')).toBeNull();
    });

    it('emits +1 on the increment button', async () => {
      const onAdjust = vi.fn();
      const user = userEvent.setup();
      render(<LifeCounter value={5} interactive onAdjust={onAdjust} />);
      await user.click(screen.getByLabelText('Increment Life'));
      expect(onAdjust).toHaveBeenCalledExactlyOnceWith(1);
    });

    it('emits -1 on the decrement button', async () => {
      const onAdjust = vi.fn();
      const user = userEvent.setup();
      render(<LifeCounter value={5} interactive onAdjust={onAdjust} />);
      await user.click(screen.getByLabelText('Decrement Life'));
      expect(onAdjust).toHaveBeenCalledExactlyOnceWith(-1);
    });

    it('aria-labels include the custom label so SRs distinguish multiple counters', () => {
      // Used by the commander damage tracker — one LifeCounter per
      // opponent. SR users need to know which opponent's damage
      // they're adjusting.
      render(<LifeCounter value={3} interactive label="Damage from Atraxa" />);
      expect(
        screen.getByLabelText('Decrement Damage from Atraxa'),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText('Increment Damage from Atraxa'),
      ).toBeInTheDocument();
    });

    it('no flash + no floating-delta animation when interactive (spec §7.4)', () => {
      // Drive a value change in interactive mode; nothing should
      // appear in the delta zone.
      const { rerender } = render(
        <LifeCounter value={5} interactive onAdjust={() => {}} />,
      );
      act(() => {
        rerender(<LifeCounter value={3} interactive onAdjust={() => {}} />);
      });
      expect(screen.queryAllByTestId('life-delta')).toHaveLength(0);
    });
  });
});
