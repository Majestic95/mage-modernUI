import {
  Buttons,
  Header,
  Message,
  type AbilityPickerProps,
} from './dialogPrimitives';

/**
 * Mode-select sentinel UUIDs (slice 39). Upstream's
 * {@code chooseMode} loop adds two synthetic entries to the
 * choices map when the player can finish a multi-mode pick:
 * a "Done" row keyed to {@code CHOOSE_OPTION_DONE_ID} and a
 * "Cancel" row keyed to {@code CHOOSE_OPTION_CANCEL_ID}
 * ({@code Modes.java:27-28}). They look like ordinary mode rows
 * on the wire — same {@code choices} map. We surface them as
 * proper terminal buttons (Primary / Secondary at the bottom of
 * the dialog) instead of inline rows, mirroring the upstream
 * Swing client and the standing convention for every other
 * dialog in this app (Yes/No, OK/Cancel, etc.).
 */
export const ABILITY_PICKER_DONE_ID = '33e72ad6-17ae-4bfb-a097-6e7aa06b49e9';
export const ABILITY_PICKER_CANCEL_ID = '0125bd0c-5610-4eba-bc80-fc6d0a7b9de6';

export function AbilityPickerDialog({
  dialog,
  stream,
  clearDialog,
}: AbilityPickerProps) {
  const submit = (abilityId: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', abilityId);
    clearDialog();
  };
  const allEntries = Object.entries(dialog.data.choices);
  // Filter out Done / Cancel sentinels — they get rendered as
  // proper terminal buttons, not inline rows.
  const modeRows = allEntries.filter(
    ([id]) => id !== ABILITY_PICKER_DONE_ID && id !== ABILITY_PICKER_CANCEL_ID,
  );
  const doneLabel = dialog.data.choices[ABILITY_PICKER_DONE_ID];
  const cancelLabel = dialog.data.choices[ABILITY_PICKER_CANCEL_ID];
  // Slice 70-X.4 — X close mirrors the Cancel button when upstream
  // surfaced a CANCEL sentinel. Cancellation here means "don't
  // activate any ability" — the engine accepts it and re-prompts as
  // appropriate. When upstream forces a pick (no CANCEL sentinel),
  // X is intentionally absent.
  const closeViaCancel =
    cancelLabel !== undefined ? () => submit(ABILITY_PICKER_CANCEL_ID) : undefined;
  return (
    <>
      <Header title="Choose ability" onClose={closeViaCancel} />
      <Message text={dialog.data.message} />
      {modeRows.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No abilities available.
        </p>
      ) : (
        <ul
          className="space-y-1 max-h-64 overflow-y-auto"
          data-testid="ability-list"
        >
          {modeRows.map(([abilityId, label]) => (
            <li key={abilityId}>
              <button
                type="button"
                data-testid="ability-row"
                data-ability-id={abilityId}
                onClick={() => submit(abilityId)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {(doneLabel !== undefined || cancelLabel !== undefined) && (
        <Buttons>
          {cancelLabel !== undefined && (
            <button
              type="button"
              data-testid="ability-cancel"
              onClick={() => submit(ABILITY_PICKER_CANCEL_ID)}
              className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
            >
              {cancelLabel}
            </button>
          )}
          {doneLabel !== undefined && (
            <button
              type="button"
              data-testid="ability-done"
              onClick={() => submit(ABILITY_PICKER_DONE_ID)}
              className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-medium"
            >
              {doneLabel}
            </button>
          )}
        </Buttons>
      )}
    </>
  );
}
