import { useGameStore } from './store';
import type { GameStream } from './stream';
import type { WebGameView } from '../api/schemas';

/**
 * Slice 70-Y.1 (Wave 2 of slice 70-X.14) — central derivation for
 * click-to-resolve dialog modes. Reads the active pendingDialog and
 * decides whether the dialog is "click cards in their existing
 * visible zone" (hand for discard, graveyard for return-from-graveyard,
 * battlefield for target / sacrifice) versus "modal needed because
 * cards live in a hidden zone" (library search after Demonic Tutor;
 * scry top-of-library cards).
 *
 * <p>Consumers (BattlefieldTile, MyHand cards, CommandZoneCard) read
 * {@code eligibleCardIds} to apply the pulse class; clickRouter reads
 * {@code dispatchPick} to route clicks through the dialog response
 * channel instead of the default cast/target path.
 *
 * <p>The legacy modal is the fallback — when no dialog is active OR
 * the dialog's cards aren't in a visible zone, this hook returns
 * {@code active: false} and the GameDialog renders its modal.
 */
export interface DialogTargetState {
  /** True iff a click-to-resolve dialog is active. */
  readonly active: boolean;
  /** Set of card UUIDs eligible to be clicked. Empty when not active. */
  readonly eligibleCardIds: ReadonlySet<string>;
  /** Set of player UUIDs eligible (for player-target gameTarget). */
  readonly eligiblePlayerIds: ReadonlySet<string>;
  /** Human-readable instruction for the banner. */
  readonly message: string;
  /** Selection minimum (engine-supplied). */
  readonly min: number;
  /** Selection maximum (engine-supplied). */
  readonly max: number;
  /** Submit a single id (single-pick mode auto-submits). */
  readonly pick: ((id: string) => void) | null;
  /** Cancel handler when the dialog is optional; null otherwise. */
  readonly cancel: (() => void) | null;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
const INACTIVE: DialogTargetState = {
  active: false,
  eligibleCardIds: EMPTY_SET,
  eligiblePlayerIds: EMPTY_SET,
  message: '',
  min: 0,
  max: 0,
  pick: null,
  cancel: null,
};

/**
 * Compute the set of card UUIDs that are CLICKABLE on the current
 * board surface — hand cards (rendered as the fan) and battlefield
 * permanents (rendered as tiles). When a dialog's cardsView1 is a
 * subset of this, click-to-resolve works because the user can
 * actually click the cards in their existing position.
 *
 * <p><b>Slice 70-Y.5 narrowing (2026-05-01):</b> graveyard, exile,
 * and sideboard ARE on the wire (each is a {@code CardsView} in
 * {@link WebPlayerView}) but they are NOT rendered as clickable
 * card faces — they live behind a chip+ZoneBrowser modal. Activating
 * the click-resolution banner for a "return creature from graveyard"
 * prompt would strand the user with nothing to click. Drop those
 * zones from the visible set; the dialog falls through to the
 * existing modal CardChooserList grid (TargetDialog), which renders
 * the graveyard cards as a card grid the user CAN click.
 *
 * <p>Future enhancement (deferred): auto-open the ZoneBrowser with
 * pulse highlights when the dialog targets graveyard/exile, then
 * click in the browser resolves. Until then, modal grid is the
 * better UX vs an inactive banner over an unreachable target.
 */
function visibleZoneCardIds(gv: WebGameView | null): Set<string> {
  const ids = new Set<string>();
  if (!gv) return ids;
  for (const id of Object.keys(gv.myHand)) ids.add(id);
  for (const p of gv.players) {
    for (const id of Object.keys(p.battlefield)) ids.add(id);
  }
  return ids;
}

/**
 * Hook returning the active click-to-resolve dialog state, or
 * {@link INACTIVE} when no such dialog is open. The {@code stream}
 * param is the GameStream the consumer wants picks dispatched on —
 * passed in (not pulled from store) so tests can inject mocks and
 * GameTable can pass null when offline.
 */
export function useDialogTargets(stream: GameStream | null): DialogTargetState {
  const pendingDialog = useGameStore((s) => s.pendingDialog);
  const gameView = useGameStore((s) => s.gameView);

  if (!pendingDialog || !stream) return INACTIVE;
  // gameChooseAbility uses a different DTO (no cardsView1); modal-only.
  if (pendingDialog.method === 'gameChooseAbility') return INACTIVE;

  const data = pendingDialog.data;
  const cardsView1 = data.cardsView1 ?? {};
  const cardCount = Object.keys(cardsView1).length;
  if (cardCount === 0) {
    // gameSelect over board permanents (no cardsView1) IS click-to-
    // resolve via the existing clickRouter target/manaPay paths — but
    // those are not driven by this hook. This hook only covers the
    // cardsView1 path; pure board-target dialogs route through
    // clickRouter directly.
    return INACTIVE;
  }

  const visibleIds = visibleZoneCardIds(gameView);
  const allInVisibleZone = Object.keys(cardsView1).every((id) =>
    visibleIds.has(id),
  );
  if (!allInVisibleZone) {
    // Library search / scry / surveil cards aren't in any visible
    // zone — modal is required.
    return INACTIVE;
  }

  // Eligibility: cardsView1 keys ARE the legal set (server pre-
  // filters). The engine's targets[] is the alternative legal set
  // for permanent/player target picks; for cardsView1-driven
  // picks, the keys themselves are the eligible set.
  const eligibleCardIds = new Set<string>(Object.keys(cardsView1));

  const messageId = pendingDialog.messageId;
  const pick = (id: string) => {
    stream.sendPlayerResponse(messageId, 'uuid', id);
    // Don't clear locally — let the server-driven pendingDialog
    // replacement (next gameUpdate / next prompt) handle teardown.
    // Same rule as slice 70-X.13 Wave 3 clickRouter permissive mode.
  };

  const cancel = !data.flag
    ? () => {
        stream.sendPlayerResponse(
          messageId,
          'uuid',
          '00000000-0000-0000-0000-000000000000',
        );
      }
    : null;

  return {
    active: true,
    eligibleCardIds,
    eligiblePlayerIds: EMPTY_SET,
    message: data.message,
    min: data.min,
    max: data.max,
    pick,
    cancel,
  };
}
