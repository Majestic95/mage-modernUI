import { useMemo } from 'react';
import type { GameStream } from '../stream';
import type { PendingDialog } from '../store';

/**
 * Slice UIFIX-4 (2026-05-11) — per-method skip dispatcher invoked when
 * the user clicks the centered-modal backdrop OR presses Esc. Returns
 * `null` for dialogs where no Skip response is engine-accepted (e.g.
 * gameAsk Yes/No, gameSelectAmount, gameChooseAbility) — backdrop / Esc
 * becomes a no-op and the user must still answer.
 *
 * <p>Per-method wire follows each dialog's existing Skip / × dispatch:
 * <ul>
 *   <li>gameTarget / gameSelect / gameChoosePile → all-zeros UUID
 *       sentinel via {@code playerResponse kind:'uuid'} (engine-side
 *       skip handler translates to Java null per
 *       {@code GameStreamHandler.parsePlayerResponseUuidOrSkip}).
 *       Covers bottom-right gameSelect (scry/surveil/discard/reveal) —
 *       backdrop click can't reach it (no scrim), but Esc can.</li>
 *   <li>gameChooseChoice → empty-string via
 *       {@code playerResponse kind:'string'} when flag=false.</li>
 *   <li>gameInformPersonal / gameError → close-only; no engine response
 *       expected (informational dialogs).</li>
 * </ul>
 */
export function useDialogSkipDispatcher(
  dialog: PendingDialog | null,
  stream: GameStream | null,
  clearDialog: () => void,
): (() => void) | null {
  return useMemo(() => {
    if (!dialog) return null;
    if (dialog.method === 'gameChooseAbility') return null;

    const data = dialog.data as { flag?: boolean; min?: number };

    switch (dialog.method) {
      case 'gameTarget':
      case 'gameSelect':
      case 'gameChoosePile': {
        const allowSkip = !data.flag || data.min === 0;
        if (!allowSkip) return null;
        return () => {
          stream?.sendPlayerResponse(
            dialog.messageId,
            'uuid',
            '00000000-0000-0000-0000-000000000000',
          );
          clearDialog();
        };
      }
      case 'gameChooseChoice': {
        if (data.flag) return null;
        return () => {
          stream?.sendPlayerResponse(dialog.messageId, 'string', '');
          clearDialog();
        };
      }
      case 'gameInformPersonal':
      case 'gameError':
        return () => clearDialog();
      default:
        return null;
    }
  }, [dialog, stream, clearDialog]);
}
