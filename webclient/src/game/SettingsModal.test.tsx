/**
 * Slice 70-O — SettingsModal coverage. Tests the relocated Concede
 * + Leave actions, the two-step concede confirmation gesture, focus
 * management via useModalA11y, and Esc / backdrop dismissal.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from './SettingsModal';

describe('SettingsModal', () => {
  it('renders the dialog with Concede + Leave buttons', () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-concede-button'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('settings-leave-button'),
    ).toBeInTheDocument();
  });

  it('Leave button dispatches onLeave AND onClose', async () => {
    const onLeave = vi.fn();
    const onClose = vi.fn();
    render(
      <SettingsModal
        onClose={onClose}
        onConcede={() => {}}
        onLeave={onLeave}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-leave-button'));
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Concede button reveals two-step confirmation, does NOT fire onConcede yet', async () => {
    const onConcede = vi.fn();
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={onConcede}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-concede-button'));
    expect(
      screen.getByTestId('settings-concede-confirm'),
    ).toBeInTheDocument();
    expect(onConcede).not.toHaveBeenCalled();
    // Original concede button replaced by the confirm pair.
    expect(screen.queryByTestId('settings-concede-button')).toBeNull();
  });

  it('Cancel in concede confirm returns to the resting state without firing', async () => {
    const onConcede = vi.fn();
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={onConcede}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-concede-button'));
    await userEvent.click(screen.getByTestId('settings-concede-cancel'));
    expect(onConcede).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('settings-concede-button'),
    ).toBeInTheDocument();
  });

  it('Yes-confirm dispatches onConcede AND closes the modal', async () => {
    const onConcede = vi.fn();
    const onClose = vi.fn();
    render(
      <SettingsModal
        onClose={onClose}
        onConcede={onConcede}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-concede-button'));
    await userEvent.click(
      screen.getByTestId('settings-concede-confirm-yes'),
    );
    expect(onConcede).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the backdrop dismisses via onClose', async () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        onClose={onClose}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc dismisses via onClose (useModalA11y wiring)', async () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        onClose={onClose}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('explicit close button (×) dismisses via onClose', async () => {
    const onClose = vi.fn();
    render(
      <SettingsModal
        onClose={onClose}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-modal-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
