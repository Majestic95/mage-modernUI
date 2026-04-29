import { useGameStore } from '../store';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';

/* ---------- mana-pay panel (slice 21 B2) ---------- */

/**
 * Manual-mana-payment panel. Engine fires gamePlayMana when
 * auto-pay can't resolve a cost (hybrid mana, conditional mana, X
 * costs that need explicit player picks). The user pays by
 * clicking mana-producing permanents on the battlefield —
 * slice 16's clickRouter routes those clicks via sendObjectClick
 * during {@code manaPay} mode without clearing the dialog.
 *
 * <p>This panel renders the cost message and a Cancel button that
 * sends {@code playerResponse{boolean:false}} (upstream rolls back
 * any partial payment).
 *
 * <p>For gamePlayXMana the same panel renders, plus a "Done"
 * button to commit the current X value (upstream uses
 * {@code boolean:false} as the finalize signal here too —
 * verified against HumanPlayer's playXMana loop).
 */
export function ManaPayPanel({
  dialog,
  stream,
  clearDialog,
  isXMana,
}: ContentProps & { isXMana: boolean }) {
  const send = (value: boolean) => {
    // Read messageId from the store at click time — the engine
    // fires fresh gamePlayMana frames as each mana is paid; the
    // imperative read avoids stale-id staleness.
    const current = useGameStore.getState().pendingDialog;
    const mid = current?.messageId ?? dialog.messageId;
    stream?.sendPlayerResponse(mid, 'boolean', value);
    clearDialog();
  };

  return (
    <>
      <Header title={isXMana ? 'Pay X mana' : 'Pay mana'} />
      <Message text={dialog.data.message} />
      <p className="text-xs text-zinc-500 italic">
        Click a mana source on the battlefield to pay.
      </p>
      <Buttons>
        {isXMana && (
          <PrimaryButton onClick={() => send(false)}>Done</PrimaryButton>
        )}
        <SecondaryButton onClick={() => send(false)}>Cancel</SecondaryButton>
      </Buttons>
    </>
  );
}
