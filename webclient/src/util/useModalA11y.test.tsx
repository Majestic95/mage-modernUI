import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useModalA11y } from './useModalA11y';

/**
 * Three-button fixture wired through the hook. Renders a dialog
 * with Save / Cancel / Close buttons so focus-trap cycling has a
 * non-trivial ordering to verify.
 */
function ModalFixture({ onClose }: { onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, { onClose });
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="test modal"
      data-testid="modal-root"
    >
      <button type="button">Save</button>
      <button type="button">Cancel</button>
      <button type="button">Close</button>
    </div>
  );
}

describe('useModalA11y', () => {
  afterEach(() => {
    cleanup();
  });

  it('focuses the first focusable on mount', () => {
    render(<ModalFixture />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ModalFixture onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not crash when Escape is pressed without an onClose', async () => {
    const user = userEvent.setup();
    render(<ModalFixture />);
    await user.keyboard('{Escape}');
    // First button still focused; nothing happens.
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('cycles forward (Tab on last → first)', async () => {
    const user = userEvent.setup();
    render(<ModalFixture />);
    // Initial focus is Save (idx 0). Tab twice → Close (idx 2),
    // then Tab once more should wrap to Save.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();
  });

  it('cycles backward (Shift+Tab on first → last)', async () => {
    const user = userEvent.setup();
    render(<ModalFixture />);
    // Initial focus is Save (idx 0). Shift+Tab should wrap to last.
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });

  it('restores focus to the previously-focused element on unmount', () => {
    // Render an opener button, focus it, then mount the modal,
    // then unmount it — focus should land back on the opener.
    const opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    opener.focus();
    expect(opener).toHaveFocus();

    const { unmount } = render(<ModalFixture />);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveFocus();

    act(() => {
      unmount();
    });
    expect(opener).toHaveFocus();

    document.body.removeChild(opener);
  });
});
