import { useState } from 'react';
import type { GameStream } from '../game/stream';
import {
  useGameStore,
  type PendingDialog,
  type PendingDialogAbilityPicker,
  type PendingDialogClientMessage,
} from '../game/store';

interface Props {
  stream: GameStream | null;
}

/**
 * Modal overlay rendered when the store has a {@code pendingDialog}.
 * Per ADR 0007 D6, each dialog method maps to a specific
 * {@code playerResponse.kind} on the inbound side.
 *
 * <p>Slice 7 adds gamePlayXMana / gameChooseChoice / gameChooseAbility
 * — completing the audit-tier-2 dialog set. Two methods remain
 * deferred (gameChoosePile, gameSelectMultiAmount, userRequestDialog)
 * pending richer view DTOs.
 */
export function GameDialog({ stream }: Props) {
  const dialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);

  if (!dialog) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="game-dialog"
      data-method={dialog.method}
      className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-lg w-full space-y-4 shadow-2xl">
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    </div>
  );
}

/* ---------- per-method renderers ---------- */

function DialogContent({
  dialog,
  stream,
  clearDialog,
}: {
  dialog: PendingDialog;
  stream: GameStream | null;
  clearDialog: () => void;
}) {
  // gameChooseAbility branches first because its data shape is
  // distinct (WebAbilityPickerView, not WebGameClientMessage). After
  // this branch TypeScript narrows the rest to client-message shape.
  if (dialog.method === 'gameChooseAbility') {
    return (
      <AbilityPickerDialog
        dialog={dialog}
        stream={stream}
        clearDialog={clearDialog}
      />
    );
  }
  switch (dialog.method) {
    case 'gameAsk':
      return <YesNoDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gamePlayMana':
    case 'gamePlayXMana':
      return <YesNoDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gameTarget':
      return <TargetDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gameSelect':
      return <SelectDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    case 'gameSelectAmount':
      // Re-key on messageId so a new dialog re-mounts the component
      // and useState's initializer picks up the new min/max defaults.
      return (
        <AmountDialog
          key={dialog.messageId}
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
        />
      );
    case 'gameChooseChoice':
      return (
        <ChoiceDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />
      );
    case 'gameInformPersonal':
      return <InformDialog dialog={dialog} clearDialog={clearDialog} title="Info" />;
    case 'gameError':
      return <InformDialog dialog={dialog} clearDialog={clearDialog} title="Error" />;
  }
}

function YesNoDialog({ dialog, stream, clearDialog }: ContentProps) {
  const submit = (value: boolean) => {
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', value);
    clearDialog();
  };
  return (
    <>
      <Header title={dialog.method === 'gamePlayMana' ? 'Pay mana?' : 'Question'} />
      <Message text={dialog.data.message} />
      <Buttons>
        <PrimaryButton onClick={() => submit(true)}>Yes</PrimaryButton>
        <SecondaryButton onClick={() => submit(false)}>No</SecondaryButton>
      </Buttons>
    </>
  );
}

function TargetDialog({ dialog, stream, clearDialog }: ContentProps) {
  const cards = Object.values(dialog.data.cardsView1);
  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };
  return (
    <>
      <Header title="Choose target" />
      <Message text={dialog.data.message} />
      {cards.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No legal targets — pick from the battlefield directly.
        </p>
      ) : (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list">
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => submit(c.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{c.name}</span>{' '}
                <span className="text-zinc-500 text-xs">{c.typeLine}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!dialog.data.flag && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // gameTarget with flag=false (not required) — server
              // accepts an empty UUID as "skip" per upstream convention.
              stream?.sendPlayerResponse(dialog.messageId, 'uuid',
                '00000000-0000-0000-0000-000000000000');
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

function SelectDialog({ dialog, stream, clearDialog }: ContentProps) {
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

function AmountDialog({ dialog, stream, clearDialog }: ContentProps) {
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

function ChoiceDialog({ dialog, stream, clearDialog }: ContentProps) {
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

function AbilityPickerDialog({
  dialog,
  stream,
  clearDialog,
}: AbilityPickerProps) {
  const submit = (abilityId: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', abilityId);
    clearDialog();
  };
  const entries = Object.entries(dialog.data.choices);
  return (
    <>
      <Header title="Choose ability" />
      <Message text={dialog.data.message} />
      {entries.length === 0 ? (
        <p className="text-zinc-500 italic text-sm">
          No abilities available.
        </p>
      ) : (
        <ul
          className="space-y-1 max-h-64 overflow-y-auto"
          data-testid="ability-list"
        >
          {entries.map(([abilityId, label]) => (
            <li key={abilityId}>
              <button
                type="button"
                onClick={() => submit(abilityId)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                {label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function InformDialog({
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

/* ---------- shared UI primitives ---------- */

interface ContentProps {
  dialog: PendingDialogClientMessage;
  stream: GameStream | null;
  clearDialog: () => void;
}

interface AbilityPickerProps {
  dialog: PendingDialogAbilityPicker;
  stream: GameStream | null;
  clearDialog: () => void;
}

function Header({ title }: { title: string }) {
  return (
    <h2 className="text-lg font-semibold text-zinc-100" data-testid="dialog-title">
      {title}
    </h2>
  );
}

function Message({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-sm text-zinc-300" data-testid="dialog-message">
      {text}
    </p>
  );
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex justify-end gap-2 pt-2">{children}</div>;
}

function PrimaryButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="px-4 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-medium"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-4 py-2 rounded text-zinc-300 hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}
