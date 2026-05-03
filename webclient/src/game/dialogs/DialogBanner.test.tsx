import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DialogBanner } from './DialogBanner';

describe('DialogBanner', () => {
  it('renders the message', () => {
    render(
      <DialogBanner
        message="Discard a card."
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    expect(screen.getByTestId('dialog-banner-message').textContent).toContain(
      'Discard a card.',
    );
  });

  it('does NOT render Done button in single-pick mode (min=max=1)', () => {
    render(
      <DialogBanner
        message="Choose target creature."
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    expect(screen.queryByTestId('dialog-banner-done')).toBeNull();
  });

  it('renders Done button in multi-pick mode and disables it below min', () => {
    render(
      <DialogBanner
        message="Discard 2 cards."
        pickedCount={0}
        min={2}
        max={2}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    const done = screen.getByTestId('dialog-banner-done') as HTMLButtonElement;
    expect(done).toBeDisabled();
  });

  it('enables Done when picked >= min', () => {
    render(
      <DialogBanner
        message="Discard 2 cards."
        pickedCount={2}
        min={2}
        max={2}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    const done = screen.getByTestId('dialog-banner-done') as HTMLButtonElement;
    expect(done).not.toBeDisabled();
  });

  it('Done click fires onDone', async () => {
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <DialogBanner
        message="Pick 2"
        pickedCount={2}
        min={2}
        max={2}
        onDone={onDone}
        onCancel={null}
      />,
    );
    await user.click(screen.getByTestId('dialog-banner-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('progress shows {picked}/{max} for bounded multi-pick', () => {
    render(
      <DialogBanner
        message="Pick"
        pickedCount={1}
        min={0}
        max={3}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    expect(screen.getByTestId('dialog-banner-progress').textContent).toBe('1/3');
  });

  it('progress shows just {picked} for unbounded max', () => {
    render(
      <DialogBanner
        message="Distribute counters"
        pickedCount={2}
        min={0}
        max={999}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    expect(screen.getByTestId('dialog-banner-progress').textContent).toBe('2');
  });

  it('Skip button renders when onCancel is provided and fires it', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <DialogBanner
        message="Optional pick"
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={onCancel}
      />,
    );
    await user.click(screen.getByTestId('dialog-banner-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Skip button is absent for mandatory prompts (onCancel=null)', () => {
    render(
      <DialogBanner
        message="Mandatory pick"
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    expect(screen.queryByTestId('dialog-banner-cancel')).toBeNull();
  });

  it('banner is pointer-events-auto on its own bounding box; cards outside the banner remain clickable', () => {
    render(
      <DialogBanner
        message="Pick"
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    // The banner now positions itself via {@link useDraggable} —
    // there's no enclosing positioner div. The banner's own
    // {@code pointer-events-auto} confines interactivity to its
    // bounding box; the rest of the viewport is unaffected because
    // no full-viewport sibling intercepts pointer events.
    const banner = screen.getByTestId('dialog-banner');
    expect(banner.className).toContain('pointer-events-auto');
    expect(screen.queryByTestId('dialog-banner-positioner')).toBeNull();
  });

  it('halo spotlight is rendered for visual attention', () => {
    render(
      <DialogBanner
        message="Pick"
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    const halo = screen.getByTestId('dialog-banner-halo');
    expect(halo.className).toContain('animate-banner-halo-rotate');
  });

  it('drag handle attribute is set on the banner so useDraggable can pick it up', () => {
    render(
      <DialogBanner
        message="Pick"
        pickedCount={0}
        min={1}
        max={1}
        onDone={() => {}}
        onCancel={null}
      />,
    );
    const banner = screen.getByTestId('dialog-banner');
    expect(banner.hasAttribute('data-drag-handle')).toBe(true);
    expect(banner.className).toContain('cursor-move');
  });
});
