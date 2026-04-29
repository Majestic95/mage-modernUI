import { useState } from 'react';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  type ContentProps,
} from './dialogPrimitives';

export function SelectDialog({ dialog, stream, clearDialog }: ContentProps) {
  // gameSelect doesn't carry a cardsView1 — the player picks from the
  // current battlefield via the GameView. Slice B's modal just shows
  // the prompt; click-to-target on the battlefield is a future slice.
  // For now: render a manual UUID input as an escape hatch.
  const [uuid, setUuid] = useState('');
  const submit = () => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', uuid);
    clearDialog();
  };
  const valid = /^[0-9a-f-]{36}$/i.test(uuid);
  return (
    <>
      <Header title="Select" />
      <Message text={dialog.data.message} />
      <p className="text-xs text-zinc-500">
        (Slice B: paste a target UUID. Click-to-target on the
        battlefield ships in the next slice.)
      </p>
      <input
        type="text"
        value={uuid}
        onChange={(e) => setUuid(e.target.value)}
        placeholder="UUID"
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-zinc-100 font-mono text-xs"
      />
      <Buttons>
        <PrimaryButton onClick={submit} disabled={!valid}>
          Submit
        </PrimaryButton>
      </Buttons>
    </>
  );
}
