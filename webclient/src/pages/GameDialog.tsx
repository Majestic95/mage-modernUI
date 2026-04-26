import { useState } from 'react';
import type { GameStream } from '../game/stream';
import type { WebGameView } from '../api/schemas';
import {
  useGameStore,
  type PendingDialog,
  type PendingDialogAbilityPicker,
  type PendingDialogClientMessage,
} from '../game/store';

interface ResolvedTarget {
  id: string;
  label: string;
  subtitle: string;
}

/**
 * Resolve a target UUID to a friendly display tuple by walking every
 * place in the game view where the engine might be referencing.
 * Falls back to a short-id stub so the modal always has *something*
 * clickable — better to render an opaque ID than to strand the user
 * with an empty modal and a required pick (e.g. end-of-turn discard).
 */
function resolveTarget(id: string, gv: WebGameView | null): ResolvedTarget {
  if (gv) {
    const player = gv.players.find((p) => p.playerId === id);
    if (player) {
      return { id, label: 'Player', subtitle: player.name || '<unknown>' };
    }
    const inMyHand = gv.myHand[id];
    if (inMyHand) {
      return { id, label: inMyHand.name, subtitle: inMyHand.typeLine };
    }
    for (const p of gv.players) {
      const onBattlefield = p.battlefield[id];
      if (onBattlefield) {
        return {
          id,
          label: onBattlefield.card.name,
          subtitle: onBattlefield.card.typeLine,
        };
      }
      const graveCard = p.graveyard[id];
      if (graveCard) {
        return { id, label: graveCard.name, subtitle: 'graveyard' };
      }
      const exileCard = p.exile[id];
      if (exileCard) {
        return { id, label: exileCard.name, subtitle: 'exile' };
      }
      const sideboardCard = p.sideboard[id];
      if (sideboardCard) {
        return { id, label: sideboardCard.name, subtitle: 'sideboard' };
      }
    }
  }
  // Last-ditch: short-id stub. Better than an empty modal.
  return { id, label: 'Target', subtitle: id.slice(0, 8) };
}

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

  // gameSelect is upstream's "free priority — do something" prompt,
  // not a question that needs a modal. The user interacts with the
  // board (click a hand card to cast, click a permanent to
  // tap/activate) and slice 14's button handlers send the response
  // via sendObjectClick. A modal here would just block those
  // clicks. The pendingDialog stays in the store so the clear-on-
  // gameUpdate path still fires once the engine processes the
  // action, but no overlay is rendered.
  if (dialog.method === 'gameSelect') {
    return null;
  }

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
  // gameTarget can ask for non-card targets and for cards from
  // sources cardsView1 doesn't include (end-of-turn discard, where
  // the eligible IDs are in targets[] but the actual card detail
  // lives on gameView.myHand). Walk targets[] and resolve each ID
  // against every place we might find display text:
  //   - players[] → "Player <name>"
  //   - myHand    → the WebCardView (card name + typeLine)
  //   - players[].battlefield permanents → permanent's card view
  //   - players[].graveyard / exile / sideboard → those WebCardViews
  // Anything still unresolved renders as a short-id-stamped row so
  // the user can at least click it and move on.
  const targetIds = dialog.data.targets;
  const gv = dialog.data.gameView;
  const resolvedTargets = cards.length > 0
    ? []
    : targetIds.map((id) => resolveTarget(id, gv));

  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };
  return (
    <>
      <Header title="Choose target" />
      <Message text={dialog.data.message} />
      {cards.length > 0 && (
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
      {cards.length === 0 && resolvedTargets.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list-resolved">
          {resolvedTargets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => submit(t.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{t.label}</span>
                {t.subtitle && (
                  <>
                    {' '}
                    <span className="text-zinc-500 text-xs">{t.subtitle}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && resolvedTargets.length === 0 && (
        <p className="text-zinc-500 italic text-sm">
          No legal targets — pick from the battlefield directly.
        </p>
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
      {renderUpstreamMarkup(text)}
    </p>
  );
}

/**
 * Render upstream's tiny HTML-flavored markup safely. Engine messages
 * carry {@code <font color=#XXXXXX>card name</font>} for highlights
 * (typically yellow on card names, red on damage) and {@code <br>}
 * for line breaks. Plain React text rendering would surface these as
 * literal markup in the UI.
 *
 * <p>We tokenize via regex and emit React nodes — no
 * {@code dangerouslySetInnerHTML}, so injected scripts or unknown
 * tags never reach the DOM. The font-color regex only accepts a
 * 3-or-6-char hex color, so a malicious upstream payload can't slip
 * arbitrary CSS into the {@code style} attribute.
 *
 * <p>Any tag we don't explicitly handle is stripped (rendered as the
 * empty string) so users never see raw markup. If upstream adds new
 * formatting, extend the parser rather than punting back to plain
 * text.
 */
function renderUpstreamMarkup(text: string): React.ReactNode {
  const tokenRe =
    /<font\s+color=(#[0-9a-fA-F]{3,6})>([\s\S]*?)<\/font>|<br\s*\/?>|<[^>]+>/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[0].toLowerCase().startsWith('<br')) {
      parts.push(<br key={`br-${key++}`} />);
    } else if (match[0].toLowerCase().startsWith('<font')) {
      const color = match[1]!;
      const inner = match[2] ?? '';
      parts.push(
        <span key={`f-${key++}`} style={{ color }}>
          {renderUpstreamMarkup(inner)}
        </span>,
      );
    }
    // Any other tag (the third arm of the regex) is intentionally
    // dropped — strips out unhandled markup without leaking it.
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
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
