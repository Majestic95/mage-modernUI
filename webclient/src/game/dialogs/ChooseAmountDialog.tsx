import { useState } from 'react';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  type ContentProps,
} from './dialogPrimitives';

export function AmountDialog({ dialog, stream, clearDialog }: ContentProps) {
  // The parent re-mounts this component on each new dialog (key=
  // messageId), so useState's initializer is enough — no effect-
  // driven reset needed.
  const [amount, setAmount] = useState(dialog.data.min);
  const submit = () => {
    stream?.sendPlayerResponse(dialog.messageId, 'integer', amount);
    clearDialog();
  };
  const valid = amount >= dialog.data.min && amount <= dialog.data.max;
  return (
    <>
      <Header title="Pick a number" />
      <Message text={dialog.data.message} />
      <div className="flex items-baseline gap-3">
        <input
          type="number"
          min={dialog.data.min}
          max={dialog.data.max}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 w-24"
        />
        <span className="text-xs text-zinc-500">
          [{dialog.data.min}–{dialog.data.max}]
        </span>
      </div>
      <Buttons>
        <PrimaryButton onClick={submit} disabled={!valid}>
          Submit
        </PrimaryButton>
      </Buttons>
    </>
  );
}
