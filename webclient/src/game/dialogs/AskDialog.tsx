import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';

export function YesNoDialog({ dialog, stream, clearDialog }: ContentProps) {
  const submit = (value: boolean) => {
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', value);
    clearDialog();
  };
  // Slice 17: upstream's options.UI.{left,right}.btn.text overrides
  // the default Yes/No labels. Mulligan loop populates these as
  // "Mulligan" / "Keep"; Proliferate / Time Travel use "Done";
  // any future spell with custom labels is automatic.
  const data = (dialog.data as { options?: { leftBtnText?: string; rightBtnText?: string } });
  const opts = data.options ?? { leftBtnText: '', rightBtnText: '' };
  const yesLabel = opts.leftBtnText && opts.leftBtnText.length > 0
    ? opts.leftBtnText
    : 'Yes';
  const noLabel = opts.rightBtnText && opts.rightBtnText.length > 0
    ? opts.rightBtnText
    : 'No';
  return (
    <>
      <Header title={dialog.method === 'gamePlayMana' ? 'Pay mana?' : 'Question'} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={() => submit(true)}>{yesLabel}</PrimaryButton>
        <SecondaryButton onClick={() => submit(false)}>{noLabel}</SecondaryButton>
      </Buttons>
    </>
  );
}
