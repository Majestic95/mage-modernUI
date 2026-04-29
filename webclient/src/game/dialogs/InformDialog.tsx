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
  return (
    <>
      <Header title={title} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={clearDialog}>OK</PrimaryButton>
      </Buttons>
    </>
  );
}
