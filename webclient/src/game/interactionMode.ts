/**
 * Interaction mode — what the engine is currently asking the player to
 * do, projected onto a small enum so the click router and renderer
 * can switch on it instead of inspecting raw dialog state.
 *
 * <p>The store keeps the source of truth ({@link useGameStore.pendingDialog}
 * + {@link WebGameView}); this module is a pure derivation. Adding a
 * new mode means: extend the union, extend {@link deriveInteractionMode},
 * extend the click router's switch. No stored state to keep in sync.
 *
 * <p>Why derive instead of store a discriminator? The audit (ADR 0008
 * implementation review) called for an explicit state machine. We
 * went lighter: the mode is a function of (dialog, gameView, me), and
 * those three are already in the store. A separate stored mode would
 * have to be invalidated on every applyFrame, which is the bug class
 * the audit flagged.
 */
import type { WebGameClientMessage } from '../api/schemas';
import type { PendingDialog } from './store';

/**
 * Free priority — the engine is waiting for the player to do anything
 * (cast, activate, pass). Click-routing dispatches via
 * {@code sendObjectClick}; pass-priority buttons fire {@code playerAction}.
 */
export type InteractionModeFree = { kind: 'free' };

/**
 * Engine wants a target for a spell or ability. {@code messageId}
 * correlates the response. {@code eligibleIds} is the union of
 * card-IDs in {@code cardsView1} and the {@code targets[]} list — any
 * click matching one of them dispatches as the target.
 * {@code optional} controls whether the user may Skip.
 */
export type InteractionModeTarget = {
  kind: 'target';
  messageId: number;
  eligibleIds: Set<string>;
  optional: boolean;
};

/**
 * Combat: the engine is asking the active player which creatures attack.
 * The dialog stays open across N clicks (each toggles an attacker);
 * an OK button commits via boolean true.
 */
export type InteractionModeDeclareAttackers = {
  kind: 'declareAttackers';
  messageId: number;
};

/**
 * Combat: the engine is asking the defending player which creatures
 * block, and which attacker each blocks. Blocker selection toggles;
 * for each blocker chosen, a follow-up gameTarget asks which attacker.
 */
export type InteractionModeDeclareBlockers = {
  kind: 'declareBlockers';
  messageId: number;
};

/**
 * Manual mana payment. Engine fires gamePlayMana / gamePlayXMana
 * when auto-payment can't resolve a cost. Click a tapped/untapped
 * mana source on the battlefield → server picks the source. Cancel
 * button → boolean false → engine rolls back the partial cast.
 */
export type InteractionModeManaPay = {
  kind: 'manaPay';
  messageId: number;
  message: string;
  isXMana: boolean;
};

/**
 * Modal-style dialog (gameAsk yes/no, gameSelectAmount, gameChooseChoice,
 * gameChooseAbility, gameInformPersonal, gameError). The board is not
 * the input surface; the modal renders its own controls. Click-routing
 * on the board is suppressed.
 */
export type InteractionModeModal = {
  kind: 'modal';
  messageId: number;
  method: PendingDialog['method'];
};

export type InteractionMode =
  | InteractionModeFree
  | InteractionModeTarget
  | InteractionModeDeclareAttackers
  | InteractionModeDeclareBlockers
  | InteractionModeManaPay
  | InteractionModeModal;

/**
 * Derive the current interaction mode from the latest dialog frame.
 * Pure function for testability — no I/O, no state mutation.
 *
 * <p>The combat-step heuristic uses message text. Upstream's
 * {@code HumanPlayer.selectAttackers} fires gameSelect with
 * {@code "Select attackers"}; {@code selectBlockers} fires
 * {@code "Select blockers"}. These strings are stable enough to gate
 * on (verified at HumanPlayer.java:1794, :2043). When ADR 0008
 * gap U1 lands and {@code options.POSSIBLE_ATTACKERS} flows through
 * the wire, swap the heuristic for the structured signal — at that
 * point this function will accept the WebGameView + WebPlayerView
 * arguments to consult upstream's structured combat options.
 */
export function deriveInteractionMode(
  dialog: PendingDialog | null,
): InteractionMode {
  if (!dialog) {
    return { kind: 'free' };
  }

  switch (dialog.method) {
    case 'gameTarget': {
      const data = dialog.data as WebGameClientMessage;
      const ids = new Set<string>([
        ...Object.keys(data.cardsView1 ?? {}),
        ...(data.targets ?? []),
      ]);
      return {
        kind: 'target',
        messageId: dialog.messageId,
        eligibleIds: ids,
        optional: !data.flag,
      };
    }
    case 'gameSelect': {
      const data = dialog.data as WebGameClientMessage;
      const msg = (data.message ?? '').toLowerCase();
      // Heuristic — swap for options.POSSIBLE_ATTACKERS when wire
      // forwards it (ADR 0008 U1).
      if (msg.includes('select attackers')) {
        return { kind: 'declareAttackers', messageId: dialog.messageId };
      }
      if (msg.includes('select blockers')) {
        return { kind: 'declareBlockers', messageId: dialog.messageId };
      }
      // Free-priority "do something". Modal renders nothing for this
      // method (slice 14); the board is the input surface.
      return { kind: 'free' };
    }
    case 'gamePlayMana':
    case 'gamePlayXMana': {
      const data = dialog.data as WebGameClientMessage;
      return {
        kind: 'manaPay',
        messageId: dialog.messageId,
        message: data.message ?? '',
        isXMana: dialog.method === 'gamePlayXMana',
      };
    }
    case 'gameAsk':
    case 'gameSelectAmount':
    case 'gameChooseChoice':
    case 'gameChooseAbility':
    case 'gameInformPersonal':
    case 'gameError':
      return {
        kind: 'modal',
        messageId: dialog.messageId,
        method: dialog.method,
      };
  }
}
