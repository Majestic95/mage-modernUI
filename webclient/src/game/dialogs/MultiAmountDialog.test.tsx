import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiAmountDialog } from './MultiAmountDialog';
import type { GameStream } from '../stream';

const fakeStream = (): GameStream =>
  ({
    sendObjectClick: vi.fn(),
    sendPlayerResponse: vi.fn(),
    sendChat: vi.fn(),
    sendPlayerAction: vi.fn(),
  }) as unknown as GameStream;

function dialog(rows: Array<{ label: string; min: number; max: number; defaultValue: number }>, totalMin: number, totalMax: number, message = '') {
  return {
    method: 'gameSelectMultiAmount' as const,
    messageId: 42,
    data: {
      gameView: null,
      message,
      targets: [],
      cardsView1: {},
      min: totalMin,
      max: totalMax,
      flag: false,
      choice: null,
      cardsView2: {},
      multiAmount: {
        title: 'Assign combat damage',
        header: 'Trample over excess',
        rows,
        totalMin,
        totalMax,
      },
      options: {
        leftBtnText: '', rightBtnText: '',
        possibleAttackers: [], possibleBlockers: [],
        specialButton: '',
      },
    },
  };
}

describe('MultiAmountDialog — trample damage assignment', () => {
  it('renders one row per blocker + defending player', () => {
    render(
      <MultiAmountDialog
        dialog={dialog(
          [
            { label: 'Grizzly Bears (2/2)', min: 0, max: 5, defaultValue: 2 },
            { label: 'Birds of Paradise (0/1)', min: 0, max: 5, defaultValue: 1 },
            { label: 'Defending player', min: 0, max: 5, defaultValue: 0 },
          ],
          /* totalMin */ 3,
          /* totalMax */ 5,
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('multi-amount-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('multi-amount-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('multi-amount-row-2')).toBeInTheDocument();
  });

  it('initializes each input to defaultValue (engine pre-computed lethals)', () => {
    render(
      <MultiAmountDialog
        dialog={dialog(
          [
            { label: '2/2', min: 0, max: 5, defaultValue: 2 },
            { label: '0/1', min: 0, max: 5, defaultValue: 1 },
            { label: 'player', min: 0, max: 5, defaultValue: 0 },
          ],
          3,
          5,
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    const r0 = screen.getByTestId('multi-amount-row-0-input') as HTMLInputElement;
    const r1 = screen.getByTestId('multi-amount-row-1-input') as HTMLInputElement;
    const r2 = screen.getByTestId('multi-amount-row-2-input') as HTMLInputElement;
    expect(r0.value).toBe('2');
    expect(r1.value).toBe('1');
    expect(r2.value).toBe('0');
  });

  it('Done with default values submits "2,1,0" (sum=3, meets totalMin)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    render(
      <MultiAmountDialog
        dialog={dialog(
          [
            { label: '2/2', min: 0, max: 5, defaultValue: 2 },
            { label: '0/1', min: 0, max: 5, defaultValue: 1 },
            { label: 'player', min: 0, max: 5, defaultValue: 0 },
          ],
          3,
          5,
        )}
        stream={stream}
        clearDialog={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(42, 'string', '2,1,0');
  });

  it('Done is disabled when sum < totalMin', () => {
    render(
      <MultiAmountDialog
        dialog={dialog(
          [
            { label: '2/2', min: 0, max: 5, defaultValue: 0 },
            { label: 'player', min: 0, max: 5, defaultValue: 0 },
          ],
          /* totalMin */ 2,
          /* totalMax */ 5,
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    const done = screen.getByRole('button', { name: /done/i }) as HTMLButtonElement;
    expect(done).toBeDisabled();
  });

  it('user can over-assign damage to one row (CR 702.19b — sum is what matters)', async () => {
    const stream = fakeStream();
    const user = userEvent.setup();
    render(
      <MultiAmountDialog
        dialog={dialog(
          [
            { label: '2/2', min: 0, max: 5, defaultValue: 2 },
            { label: 'player', min: 0, max: 5, defaultValue: 0 },
          ],
          /* totalMin */ 2,
          /* totalMax */ 5,
        )}
        stream={stream}
        clearDialog={() => {}}
      />,
    );
    const r0 = screen.getByTestId('multi-amount-row-0-input') as HTMLInputElement;
    const r1 = screen.getByTestId('multi-amount-row-1-input') as HTMLInputElement;
    await user.clear(r0);
    await user.type(r0, '5');
    await user.clear(r1);
    await user.type(r1, '0');
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(stream.sendPlayerResponse).toHaveBeenCalledWith(42, 'string', '5,0');
  });

  it('renders title from MultiAmountType options', () => {
    render(
      <MultiAmountDialog
        dialog={dialog(
          [{ label: 'r', min: 0, max: 1, defaultValue: 0 }],
          0,
          1,
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    expect(screen.getByTestId('dialog-title').textContent).toBe(
      'Assign combat damage',
    );
  });

  it('total display flips amber when sum is invalid, fuchsia when valid', async () => {
    const user = userEvent.setup();
    render(
      <MultiAmountDialog
        dialog={dialog(
          [{ label: 'r', min: 0, max: 5, defaultValue: 1 }],
          /* totalMin */ 2,
          /* totalMax */ 5,
        )}
        stream={fakeStream()}
        clearDialog={() => {}}
      />,
    );
    const total = screen.getByTestId('multi-amount-total-value');
    expect(total.className).toContain('amber'); // 1 < 2
    const r0 = screen.getByTestId('multi-amount-row-0-input') as HTMLInputElement;
    await user.clear(r0);
    await user.type(r0, '3');
    expect(screen.getByTestId('multi-amount-total-value').className).toContain(
      'fuchsia',
    ); // 3 in [2, 5]
  });
});
