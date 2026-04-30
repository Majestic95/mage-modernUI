import type { GameStream } from '../stream';
import type { WebGameClientMessage } from '../../api/schemas';
import { deriveInteractionMode } from '../interactionMode';
import { useGameStore, type PendingDialog } from '../store';
import { YesNoDialog } from './AskDialog';
import { TargetDialog } from './TargetDialog';
import { OrderTriggersDialog } from './TriggerOrderDialog';
import { SelectDialog } from './SelectDialog';
import { AmountDialog } from './ChooseAmountDialog';
import { ChoiceDialog } from './ChooseChoiceDialog';
import { AbilityPickerDialog } from './AbilityPickerDialog';
import { InformDialog } from './InformDialog';
import { CombatPanel } from './CombatPanel';
import { ManaPayPanel } from './ManaPayPanel';
import { isMulliganDialog } from '../MulliganModal';

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

  // Slice 70-F — the mulligan flow is a gameAsk with the
  // "Mulligan"/"Keep" button text convention. MulliganModal at the
  // GameTable shell level renders the full-mode chrome around it;
  // short-circuit here so the legacy AskDialog doesn't double-render
  // the same dispatch surface.
  if (isMulliganDialog(dialog)) return null;

  // gameSelect is upstream's "free priority / combat" prompt.
  // Three sub-modes:
  //   * declareAttackers — banner + OK + (optional) All-attack button
  //   * declareBlockers — banner + OK button
  //   * free priority — render nothing; the board is the input surface
  //     (slice 14 / 15 / 16 handle the clicks).
  if (dialog.method === 'gameSelect') {
    const mode = deriveInteractionMode(dialog);
    if (mode.kind === 'declareAttackers' || mode.kind === 'declareBlockers') {
      return (
        <div
          role="dialog"
          aria-modal="false"
          data-testid="game-dialog"
          data-method={dialog.method}
          data-combat-mode={mode.kind}
          className="fixed bottom-4 right-[calc(var(--side-panel-width,0px)+1rem)] z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
        >
          <CombatPanel
            dialog={dialog}
            stream={stream}
            clearDialog={clearDialog}
            isAttackers={mode.kind === 'declareAttackers'}
          />
        </div>
      );
    }
    return null;
  }

  // gameTarget renders as a non-blocking side panel — the
  // Battlefield wires click-on-board to dispatch the target
  // response, so the user can pick by clicking either a card/
  // permanent on the board OR a row in the picker. A full-screen
  // backdrop would prevent the board interaction.
  if (dialog.method === 'gameTarget') {
    return (
      <div
        role="dialog"
        aria-modal="false"
        data-testid="game-dialog"
        data-method={dialog.method}
        className="fixed bottom-4 right-[calc(var(--side-panel-width,0px)+1rem)] z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
      >
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    );
  }

  // gamePlayMana / gamePlayXMana — slice 21 (B2). The user pays
  // mana by clicking lands / mana sources on the battlefield;
  // slice 16's clickRouter dispatches manaPay-mode clicks via
  // sendObjectClick. A full-screen modal would block those clicks,
  // so render the panel as a non-blocking side strip instead.
  if (dialog.method === 'gamePlayMana' || dialog.method === 'gamePlayXMana') {
    return (
      <div
        role="dialog"
        aria-modal="false"
        data-testid="game-dialog"
        data-method={dialog.method}
        className="fixed bottom-4 right-[calc(var(--side-panel-width,0px)+1rem)] z-40 max-w-sm w-full bg-zinc-900 border border-zinc-700 rounded-lg p-5 space-y-3 shadow-2xl"
      >
        <DialogContent dialog={dialog} stream={stream} clearDialog={clearDialog} />
      </div>
    );
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
      return (
        <ManaPayPanel
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
          isXMana={dialog.method === 'gamePlayXMana'}
        />
      );
    case 'gameTarget': {
      // Slice 26 / ADR 0009: gameTarget doubles as the trigger-order
      // prompt. Branch when upstream's queryType discriminator is set.
      const data = dialog.data as WebGameClientMessage;
      if (data.options?.isTriggerOrder) {
        return (
          <OrderTriggersDialog
            dialog={dialog}
            stream={stream}
            clearDialog={clearDialog}
          />
        );
      }
      return <TargetDialog dialog={dialog} stream={stream} clearDialog={clearDialog} />;
    }
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
