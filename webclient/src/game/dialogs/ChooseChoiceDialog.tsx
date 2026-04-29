import {
  Buttons,
  Header,
  Message,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';

export function ChoiceDialog({ dialog, stream, clearDialog }: ContentProps) {
  const choice = dialog.data.choice;
  if (!choice) {
    // Defensive: server should always populate choice on
    // gameChooseChoice; if it doesn't, surface a textual fallback so
    // the user isn't stuck on an empty modal.
    return (
      <>
        <Header title="Choose" />
        <Message text={dialog.data.message || '(no choice payload)'} />
        <Buttons>
          <SecondaryButton onClick={clearDialog}>Dismiss</SecondaryButton>
        </Buttons>
      </>
    );
  }
  const submit = (key: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'string', key);
    clearDialog();
  };
  const entries = Object.entries(choice.choices);
  return (
    <>
      <Header title="Choose one" />
      <Message text={choice.message || dialog.data.message} />
      {choice.subMessage && (
        <p className="text-xs text-zinc-500" data-testid="choice-submessage">
          {choice.subMessage}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No options available.
        </p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="choice-list">
          {entries.map(([key, label]) => (
            <li key={key}>
              <button
                type="button"
                onClick={() => submit(key)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {!choice.required && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // Optional choice — send empty string per upstream
              // convention for "skip" on string-kind responses.
              stream?.sendPlayerResponse(dialog.messageId, 'string', '');
              clearDialog();
            }}
          >
            Skip
          </SecondaryButton>
        </Buttons>
      )}
    </>
  );
}
