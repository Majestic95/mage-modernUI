/**
 * Pure dispatcher for board clicks (hand cards, permanents, players).
 * Centralizes the slice-15 + slice-16 routing rules so each mode's
 * dispatch shape is one place, easy to test.
 *
 * <p>Slice 15 had this logic inlined in {@code Battlefield.onObjectClick}
 * with a single-branch {@code if (targeting)}. Slice 16 (the audit's
 * substrate slice) extracts it because combat (B1) and manual mana
 * (B2) add three more branches; the inline pattern was about to fan
 * out into a tangle of {@code pendingDialog.method ===} checks.
 *
 * <p>The router takes a typed {@link InteractionMode} and an
 * {@link OutboundActions} adapter (exposing the GameStream methods we
 * need + the dialog-clear callback). No imports of the concrete
 * GameStream / store from this module — keeps it pure for unit tests.
 */
import type { InteractionMode } from './interactionMode';

/**
 * Minimal interface the router needs to fire side effects. Concrete
 * GameStream + useGameStore satisfy this; tests inject a mock.
 */
export interface OutboundActions {
  sendObjectClick: (objectId: string) => void;
  sendPlayerResponse: (
    messageId: number,
    kind: 'uuid' | 'string' | 'boolean' | 'integer' | 'manaType',
    value: unknown,
  ) => void;
  clearDialog: () => void;
}

/**
 * Outcome of a click — useful for tests to assert what happened
 * without inspecting the mock's call log. Renderer code can ignore
 * the return value.
 */
export type ClickOutcome =
  | { dispatched: false; reason: string }
  | {
      dispatched: true;
      via: 'objectClick' | 'playerResponse';
      kind?: 'uuid';
      messageId?: number;
      value: string;
    };

/**
 * Route a click on a board object (hand card, permanent, player) to
 * the right outbound action for the current interaction mode.
 *
 * <p>Modes:
 * <ul>
 *   <li>{@code free}: dispatch via sendObjectClick. The engine's
 *       priorityPlay loop interprets — cast, activate, etc. Gated
 *       by {@code canAct} (held priority + open WS).</li>
 *   <li>{@code target}: dispatch via sendPlayerResponse(uuid). Only
 *       fires if the click ID is in {@code eligibleIds}; otherwise
 *       the click is a no-op (engine would reject anyway, but we
 *       guard at the source for clean UX).</li>
 *   <li>{@code manaPay}: dispatch via sendObjectClick (the engine
 *       interprets a UUID during gamePlayMana as "use this source's
 *       mana ability"). messageId=0 is fine — upstream's getPlayerResponse
 *       loop polls the latest UUID regardless of correlation.</li>
 *   <li>{@code declareAttackers} / {@code declareBlockers}: dispatch
 *       via sendObjectClick to toggle. Dialog stays open until the
 *       OK button (rendered by the combat panel, not here) sends
 *       boolean true.</li>
 *   <li>{@code modal}: the modal owns the input. Board clicks are
 *       suppressed.</li>
 * </ul>
 *
 * <p>Slice-15 cleared the dialog after a target dispatch; slice 16
 * preserves that behavior (target picks are single-shot per slot).
 * Combat / mana pay do NOT clear — the dialog stays alive across
 * multiple clicks until OK / Cancel.
 */
export function routeObjectClick(
  mode: InteractionMode,
  objectId: string,
  canAct: boolean,
  out: OutboundActions,
): ClickOutcome {
  switch (mode.kind) {
    case 'modal':
      return { dispatched: false, reason: 'modal-active' };

    case 'target': {
      // Slice 70-X.12 (user feedback 2026-04-30) — when eligibleIds
      // is empty (cardsView1 + targets[] both empty on the wire),
      // allow ANY click through. The engine validates and rejects
      // illegal picks via gameError; dropping the click silently
      // strands the user when the wire didn't surface specific UUIDs
      // (verified in the wild against Fortified Village's reveal-
      // from-hand cost — engine fires gameTarget with possibleTargets
      // populated, but the wire map shipped empty in some flows).
      if (mode.eligibleIds.size > 0 && !mode.eligibleIds.has(objectId)) {
        return { dispatched: false, reason: 'not-eligible-target' };
      }
      const permissive = mode.eligibleIds.size === 0;
      out.sendPlayerResponse(mode.messageId, 'uuid', objectId);
      // Slice 70-X.13 (Wave 3) — only the strict-eligible path clears
      // the dialog locally. In permissive mode the engine may reject
      // (gameError fires); without the dialog the user has lost the
      // prompt context. Strict-eligible dispatches are by-construction
      // valid against the engine's reported possibleTargets, so the
      // local clear is safe — but the resulting fresh gameView frame
      // would replace pendingDialog anyway, so the difference is one
      // frame of staleness vs UX correctness on reject. Picked
      // correctness.
      if (!permissive) {
        out.clearDialog();
      }
      return {
        dispatched: true,
        via: 'playerResponse',
        kind: 'uuid',
        messageId: mode.messageId,
        value: objectId,
      };
    }

    case 'orderTriggers': {
      // Slice 26 / ADR 0009. Same dispatch shape as `target` (uuid
      // response + clearDialog), but the eligibility check uses the
      // ability-id set rather than the target-id set, and board
      // objects are NOT eligible — only ability rows in the panel
      // can trigger this branch (the panel passes the ability UUID
      // directly).
      if (!mode.abilityIds.has(objectId)) {
        return { dispatched: false, reason: 'not-eligible-ability' };
      }
      out.sendPlayerResponse(mode.messageId, 'uuid', objectId);
      out.clearDialog();
      return {
        dispatched: true,
        via: 'playerResponse',
        kind: 'uuid',
        messageId: mode.messageId,
        value: objectId,
      };
    }

    case 'declareAttackers':
    case 'declareBlockers':
    case 'manaPay':
      // Combat and mana-payment clicks are toggles / source-picks.
      // The engine's getPlayerResponse loop accepts the UUID; the
      // dialog stays open until the user explicitly commits or
      // cancels. Same dispatch shape as free priority — different
      // mode just means "the modal doesn't close on click".
      out.sendObjectClick(objectId);
      return {
        dispatched: true,
        via: 'objectClick',
        value: objectId,
      };

    case 'free':
      if (!canAct) {
        return { dispatched: false, reason: 'no-priority' };
      }
      out.sendObjectClick(objectId);
      return {
        dispatched: true,
        via: 'objectClick',
        value: objectId,
      };
  }
}

/**
 * Whether the board accepts clicks at all in the given mode + canAct
 * state. Drives the disabled state on hand-card / permanent buttons.
 */
export function isBoardClickable(
  mode: InteractionMode,
  canAct: boolean,
): boolean {
  switch (mode.kind) {
    case 'modal':
    case 'orderTriggers':
      // Slice 26: trigger-order picks happen in the side panel,
      // never on the board. Suppress board click-through so a stray
      // click on a permanent during the prompt doesn't leak as a
      // free-priority dispatch.
      return false;
    case 'target':
    case 'declareAttackers':
    case 'declareBlockers':
    case 'manaPay':
      return true;
    case 'free':
      return canAct;
  }
}
