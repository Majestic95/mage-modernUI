import type { PendingDialog } from '../store';
import { Buttons, Header, Message, PrimaryButton } from './dialogPrimitives';

export function InformDialog({
  dialog,
  clearDialog,
  title,
}: {
  dialog: PendingDialog;
  clearDialog: () => void;
  title: string;
}) {
  // Slice 70-X.4 — informational dialog; X is identical to OK.
  // No engine response — gameInformPersonal / gameError carry no
  // pendingMessageId waiting for a reply. Local clear is the
  // entire dismissal contract.
  return (
    <>
      <Header title={title} onClose={clearDialog} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={clearDialog}>OK</PrimaryButton>
      </Buttons>
    </>
  );
}
