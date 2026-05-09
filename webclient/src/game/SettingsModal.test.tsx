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

describe('SettingsModal — card preview size slider', () => {
  it('renders the card-preview section above the audio section', () => {
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    const previewSection = screen.getByTestId('settings-card-preview-section');
    const audioSection = screen.getByTestId('settings-audio-section');
    expect(previewSection).toBeInTheDocument();
    expect(audioSection).toBeInTheDocument();
    // DOM order — preview comes first
    const both = screen.getByTestId('settings-modal').querySelectorAll(
      '[data-testid="settings-card-preview-section"], [data-testid="settings-audio-section"]',
    );
    expect(both[0]).toBe(previewSection);
    expect(both[1]).toBe(audioSection);
  });

  it('slider exposes the current scale + pixel readout', async () => {
    const { useHoverPreviewSettings } = await import('./hoverPreviewSettings');
    useHoverPreviewSettings.setState({ popoverScale: 1.0 });
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    const slider = screen.getByTestId('settings-card-preview-scale');
    expect(slider).toHaveAttribute('min', '1');
    expect(slider).toHaveAttribute('max', '3');
    expect(slider).toHaveValue('1');
    expect(
      screen.getByTestId('settings-card-preview-section'),
    ).toHaveTextContent('100% · 256px');
  });

  it('changing the slider updates the store + readout', async () => {
    const { useHoverPreviewSettings } = await import('./hoverPreviewSettings');
    useHoverPreviewSettings.setState({ popoverScale: 1.0 });
    const { fireEvent } = await import('@testing-library/react');
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    const slider = screen.getByTestId('settings-card-preview-scale');
    fireEvent.change(slider, { target: { value: '2.5' } });
    expect(useHoverPreviewSettings.getState().popoverScale).toBe(2.5);
    expect(
      screen.getByTestId('settings-card-preview-section'),
    ).toHaveTextContent('250% · 640px');
  });
});

describe('SettingsModal — mana payment section', () => {
  // The store persists across tests (module-scope zustand). Reset
  // both localStorage and the in-memory state in each case.
  function resetManaSettings() {
    window.localStorage.removeItem('xmage.manaPayment.v1');
    return import('./manaPaymentSettings').then(({ useManaPaymentSettings }) => {
      useManaPaymentSettings.setState({
        autoPay: false,
        autoPayRestricted: false,
      });
      return useManaPaymentSettings;
    });
  }

  it('renders the section with both checkboxes; restricted disabled by default', async () => {
    await resetManaSettings();
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    expect(
      screen.getByTestId('settings-mana-payment-section'),
    ).toBeInTheDocument();
    const autoPay = screen.getByTestId('settings-mana-auto-pay') as HTMLInputElement;
    const restricted = screen.getByTestId(
      'settings-mana-auto-pay-restricted',
    ) as HTMLInputElement;
    expect(autoPay.checked).toBe(false);
    expect(restricted.checked).toBe(false);
    expect(restricted.disabled).toBe(true);
  });

  it('toggling auto-pay dispatches MANA_AUTO_PAYMENT_ON via the stream', async () => {
    await resetManaSettings();
    const sendPlayerAction = vi.fn();
    const stream = {
      sendPlayerAction,
    } as unknown as import('./stream').GameStream;
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
        stream={stream}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-mana-auto-pay'));
    expect(sendPlayerAction).toHaveBeenCalledWith('MANA_AUTO_PAYMENT_ON');
  });

  it('toggling restricted (after enabling auto-pay) dispatches the RESTRICTED enum', async () => {
    const useManaPaymentSettings = await resetManaSettings();
    useManaPaymentSettings.setState({
      autoPay: true,
      autoPayRestricted: false,
    });
    const sendPlayerAction = vi.fn();
    const stream = {
      sendPlayerAction,
    } as unknown as import('./stream').GameStream;
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
        stream={stream}
      />,
    );
    const restricted = screen.getByTestId(
      'settings-mana-auto-pay-restricted',
    ) as HTMLInputElement;
    expect(restricted.disabled).toBe(false);
    await userEvent.click(restricted);
    expect(sendPlayerAction).toHaveBeenCalledWith(
      'MANA_AUTO_PAYMENT_RESTRICTED_ON',
    );
  });

  it('toggling auto-pay with no stream still saves the preference (no crash)', async () => {
    const useManaPaymentSettings = await resetManaSettings();
    render(
      <SettingsModal
        onClose={() => {}}
        onConcede={() => {}}
        onLeave={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('settings-mana-auto-pay'));
    expect(useManaPaymentSettings.getState().autoPay).toBe(true);
  });
});
