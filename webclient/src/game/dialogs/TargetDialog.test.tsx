/**
 * Bug fix (2026-05-02) — TargetDialog forfeit-button coverage.
 *
 * Per CR 603.3c, a triggered ability with no legal targets at
 * resolution should be removed automatically by the engine. Xmage's
 * upstream Java engine occasionally fails to do so (most commonly
 * Spell Queller's exiled-card-returns trigger after the Queller is
 * silenced before resolution), leaving the player stuck in a
 * mandatory gameTarget prompt with an empty cardsView1 and no
 * resolvable target IDs. The defensive "Forfeit (no legal targets)"
 * button gives the player an explicit escape hatch that sends the
 * all-zeros UUID + locally clears the dialog.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TargetDialog } from './TargetDialog';
import { GameStream } from '../stream';

function makeDialog(overrides: { flag: boolean; cardsView1?: Record<string, unknown>; targets?: string[] }) {
  return {
    method: 'gameTarget' as const,
    messageId: 99,
    data: {
      gameView: null,
      message: overrides.flag
        ? 'Choose target creature you control'
        : 'Choose target creature (optional)',
      targets: overrides.targets ?? [],
      cardsView1: (overrides.cardsView1 ?? {}) as never,
      min: 1,
      max: 1,
      flag: overrides.flag,
      choice: null,
    },
  } as never;
}

describe('TargetDialog — forfeit escape hatch (2026-05-02)', () => {
  it('shows the forfeit button when flag=true AND no legal targets exist', () => {
    render(
      <TargetDialog
        dialog={makeDialog({ flag: true })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('target-forfeit')).toHaveTextContent(
      /Forfeit/i,
    );
  });

  it('does NOT show the forfeit button when flag=false (Skip already covers it)', () => {
    render(
      <TargetDialog
        dialog={makeDialog({ flag: false })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.queryByTestId('target-forfeit')).toBeNull();
    // The optional-Skip button is the existing path.
    expect(screen.getByText(/^Skip$/)).toBeInTheDocument();
  });

  it('does NOT show the forfeit button when cardsView1 has eligible options', () => {
    render(
      <TargetDialog
        dialog={makeDialog({
          flag: true,
          cardsView1: {
            'card-id-1': {
              id: 'card-id-1',
              name: 'Lightning Bolt',
            },
          },
        })}
        stream={null}
        clearDialog={() => {}}
      />,
    );
    expect(screen.queryByTestId('target-forfeit')).toBeNull();
  });

  it('clicking forfeit sends the all-zeros UUID and clears the dialog locally', async () => {
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup();
    const sendSpy = vi
      .spyOn(GameStream.prototype, 'sendPlayerResponse')
      .mockImplementation(() => {});
    const clearDialog = vi.fn();

    // Construct a real GameStream so the spy intercepts the prototype
    // method. The stream isn't connected; we only need the spy.
    const stream = new GameStream(
      'ws://test',
      '00000000-0000-0000-0000-000000000000',
    );

    render(
      <TargetDialog
        dialog={makeDialog({ flag: true })}
        stream={stream}
        clearDialog={clearDialog}
      />,
    );
    await user.click(screen.getByTestId('target-forfeit'));

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith(
      99,
      'uuid',
      '00000000-0000-0000-0000-000000000000',
    );
    expect(clearDialog).toHaveBeenCalledTimes(1);
    sendSpy.mockRestore();
  });
});
