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
import { ManaPayBanner } from './ManaPayBanner';
import { isMulliganDialog } from '../MulliganModal';
import { PilePickerDialog } from './PilePickerDialog';
import { MultiAmountDialog } from './MultiAmountDialog';
import { CLICK_RESOLUTION } from '../../featureFlags';
import { useDialogTargets } from '../useDialogTargets';
import { DialogBanner } from './DialogBanner';

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
  // Slice 70-Y.1 — when click-resolution is active, the relevant
  // cards pulse in their existing zone and the banner replaces the
  // modal. Hook returns active=false unless: flag on, dialog is a
  // cardsView1 prompt, AND every cardsView1 id is in a visible zone
  // (hand / graveyard / exile / battlefield). Library-search /
  // scry / surveil cardsView1 ids aren't in visible zones — the
  // hook returns inactive and the legacy modal still renders.
  const dialogTargets = useDialogTargets(stream);

  if (!dialog) return null;

  // Slice 70-F — the mulligan flow is a gameAsk with the
  // "Mulligan"/"Keep" button text convention. MulliganModal at the
  // GameTable shell level renders the full-mode chrome around it;
  // short-circuit here so the legacy AskDialog doesn't double-render
  // the same dispatch surface.
  if (isMulliganDialog(dialog)) return null;

  // Slice 70-Y.1 — click-resolution path. When the flag is on AND the
  // hook says the dialog can be resolved by clicking cards in their
  // existing zones, render the bottom-center banner ONLY and let the
  // pulsing cards drive the dispatch via clickRouter target mode.
  // The legacy modal is suppressed for this dialog frame.
  if (CLICK_RESOLUTION && dialogTargets.active) {
    const pickedCount = 0; // single-pick mode; click submits per id
    return (
      <DialogBanner
        message={dialogTargets.message}
        pickedCount={pickedCount}
        min={dialogTargets.min}
        max={dialogTargets.max}
        onDone={() => {
          // No-op for single-pick — the per-card click already submits.
          // For multi-pick (future slice 70-Y.5 zone-source select),
          // this Done button submits the accumulated selection.
        }}
        onCancel={dialogTargets.cancel}
      />
    );
  }

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

  // gameTarget — three sub-cases at slice 70-X.13 onwards:
  //   1. cardsView1 cards in VISIBLE zones (hand discard, graveyard
  //      pick) → handled at the top by the useDialogTargets active
  //      branch above (DialogBanner + pulse cards in zone).
  //   2. cardsView1 cards in HIDDEN zones (Demonic Tutor library
  //      search) → modal with CardChooserList grid (TargetDialog).
  //      Cards aren't on the board — modal is the only sensible UI.
  //   3. cardsView1 EMPTY (board-target: player or permanent on
  //      board) → slice 70-Y.2 (2026-05-01) renders as a bottom-
  //      center banner (DialogBanner). User clicks targets ON THE
  //      BOARD via clickRouter target mode; banner only shows the
  //      message text + Skip button (when optional).
  if (dialog.method === 'gameTarget') {
    const targetData =
      'cardsView1' in dialog.data ? dialog.data : null;
    const cardCount = targetData
      ? Object.keys(targetData.cardsView1).length
      : 0;
    // Case 3 — board target with no cardsView1 → banner.
    if (CLICK_RESOLUTION && targetData && cardCount === 0) {
      const skipTarget = !targetData.flag
        ? () => {
            stream?.sendPlayerResponse(
              dialog.messageId,
              'uuid',
              '00000000-0000-0000-0000-000000000000',
            );
            clearDialog();
          }
        : null;
      return (
        <DialogBanner
          message={targetData.message ?? 'Choose target'}
          pickedCount={0}
          min={1}
          max={1}
          onDone={() => {
            // No-op; user clicks on board (clickRouter target mode
            // dispatches sendPlayerResponse). DialogBanner hides the
            // Done button when min=max=1, so this is unreachable in
            // practice — defensive fallback only.
          }}
          onCancel={skipTarget}
        />
      );
    }
    // Case 2 — modal with card grid (Demonic Tutor etc.) OR legacy
    // path when CLICK_RESOLUTION off.
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

  // gamePlayMana / gamePlayXMana — slice 21 (B2) → slice 70-Y.3
  // (2026-05-01). The user pays mana by clicking lands / mana
  // sources on the battlefield + mana orbs in the pool. With
  // CLICK_RESOLUTION on, render as a bottom-center banner
  // (ManaPayBanner) instead of the bottom-right side panel.
  // Banner adds the "Special" button (Convoke / Improvise / Delve)
  // that the legacy panel lacked entirely.
  if (dialog.method === 'gamePlayMana' || dialog.method === 'gamePlayXMana') {
    if (CLICK_RESOLUTION) {
      return <ManaPayBanner stream={stream} />;
    }
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
    case 'gameChoosePile':
      return (
        <PilePickerDialog
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
        />
      );
    case 'gameSelectMultiAmount':
      // Re-key on messageId so first-strike → normal-damage step
      // re-fires produce a fresh component with new defaultValues
      // (per MTG rules expert: trample fires this twice on double-
      // strike trample, with re-evaluated lethals each time).
      return (
        <MultiAmountDialog
          key={dialog.messageId}
          dialog={dialog}
          stream={stream}
          clearDialog={clearDialog}
        />
      );
  }
}
