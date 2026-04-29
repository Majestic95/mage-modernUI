import type { WebGameClientMessage } from '../../api/schemas';
import { useGameStore } from '../store';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';

/* ---------- combat panel (slice 20 B1a) ---------- */

/**
 * Combat-step prompt panel. Drives the declare-attackers and
 * declare-blockers loops:
 *
 * <ul>
 *   <li>The user clicks creatures on their battlefield to toggle
 *       them as attackers / blockers — handled by clickRouter
 *       (slice 16) which dispatches via sendObjectClick without
 *       clearing the dialog.</li>
 *   <li>This panel renders the prompt text + an OK button to
 *       commit the current set ({@code playerResponse{boolean:true}})
 *       + an "All attack" button when upstream populated
 *       {@code options.specialButton} (declareAttackers only).</li>
 * </ul>
 *
 * <p>The OK + All-attack buttons read {@code dialog.messageId} from
 * the store at click time (not from a captured closure) to avoid
 * stale-messageId staleness if the engine fires multiple
 * gameSelect frames during the loop.
 */
export function CombatPanel({
  dialog,
  stream,
  clearDialog,
  isAttackers,
}: ContentProps & { isAttackers: boolean }) {
  const data = dialog.data as WebGameClientMessage;
  const specialButton = data.options?.specialButton ?? '';

  const commit = (kind: 'boolean' | 'string', value: boolean | string) => {
    // Read the current pendingDialog from the store imperatively in
    // case the engine pushed a fresh gameSelect mid-render and the
    // closure's messageId is stale.
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, kind, value);
    clearDialog();
  };

  return (
    <>
      <Header
        title={isAttackers ? 'Declare attackers' : 'Declare blockers'}
      />
      <Message
        text={
          data.message ||
          (isAttackers
            ? 'Click creatures to attack with, then OK.'
            : 'Click creatures to block with, then OK.')
        }
      />
      <Buttons>
        {isAttackers && specialButton.length > 0 && (
          <SecondaryButton
            onClick={() => commit('string', 'special')}
          >
            {specialButton}
          </SecondaryButton>
        )}
        <PrimaryButton onClick={() => commit('boolean', true)}>
          OK
        </PrimaryButton>
      </Buttons>
    </>
  );
}
