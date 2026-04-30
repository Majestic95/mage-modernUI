import { useEffect, useMemo, useRef, useState } from 'react';
import type { WebGameView } from '../api/schemas';
import type { GameStream } from './stream';
import { useGameStore } from './store';
import { useModalA11y } from '../util/useModalA11y';

/**
 * Slice 70-F (ADR 0011 D5) — full-mode mulligan modal per
 * design-system §7.14 Modal + screens-game-table-commander-4p.md
 * §Mulligan.
 *
 * <p><b>Wire-contract preservation:</b> the engine sends a standard
 * {@code gameAsk} dialog with {@code leftBtnText: "Mulligan"} +
 * {@code rightBtnText: "Keep"} when the player must decide. This
 * modal RENDERS that same flow with new chrome — the dispatch goes
 * through {@code stream.sendPlayerResponse(messageId, 'boolean',
 * value)} per slice 16's clickRouter. No new wire shape; no engine
 * change.
 *
 * <p><b>Per-player "deciding" status (spec §Mulligan):</b> the wire
 * doesn't surface "opponent X has committed their mulligan
 * decision" — the engine just resolves once all clients respond.
 * The modal shows every player as "deciding" until the LOCAL
 * player commits, at which point the modal unmounts (the local
 * pendingDialog clears). Sighted users see only their own
 * commit; the per-opponent status is decorative until a future
 * server-side signal lands.
 *
 * <p>Rendered as a sibling of {@code GameDialog} at the GameTable
 * shell level. {@code GameDialog} returns null for the mulligan
 * branch (see {@link isMulliganDialog}) so the legacy AskDialog
 * doesn't render in parallel.
 */
interface Props {
  stream: GameStream | null;
  gameView: WebGameView;
}

export function MulliganModal({ stream, gameView }: Props) {
  const pendingDialog = useGameStore((s) => s.pendingDialog);
  const clearDialog = useGameStore((s) => s.clearDialog);

  const isMulligan = pendingDialog ? isMulliganDialog(pendingDialog) : false;

  // Critic Tech-C2 / UX-1 — local "committed" latch. Without this,
  // dispatch() → clearDialog() → isMulligan flips false → modal
  // unmounts BEFORE opponents commit. Spec §Mulligan: the modal
  // persists showing "waiting for opponents" until engine resolution.
  //
  // Reset triggers (in order of likelihood):
  //   1. A NEW pendingDialog arrives (deeper mulligan loop OR the
  //      engine moved on to the post-mulligan priority prompt).
  //      Detected by messageId change. Covers the common case.
  //   2. The next mulligan dialog isn't a mulligan — handled by the
  //      first useEffect's isMulligan branch (any new dialog
  //      arrival is a release signal).
  //
  // We do NOT reset on `pendingDialog === null` alone — the local
  // dispatch clears pendingDialog synchronously, and resetting on
  // null would defeat the latch entirely (the original bug). The
  // engine ALWAYS follows mulligan resolution with another dialog
  // (priority pass for turn 1, or another gameAsk for the deeper
  // mulligan loop), so the messageId-change path is reliable.
  const [committedLocally, setCommittedLocally] = useState(false);
  useEffect(() => {
    // Reset the latch whenever a NEW dialog arrives (any kind —
    // the engine has moved past the prior mulligan iteration).
    if (pendingDialog) {
      setCommittedLocally(false);
    }
  }, [pendingDialog?.messageId, pendingDialog]);

  const dispatch = useMemo(
    () =>
      stream
        ? (response: boolean) => {
            if (!pendingDialog) return;
            stream.sendPlayerResponse(pendingDialog.messageId, 'boolean', response);
            clearDialog();
            setCommittedLocally(true);
          }
        : null,
    [stream, pendingDialog, clearDialog],
  );

  // Critic Tech-I4 / UX-4 — focus trap + initial-focus management.
  // useModalA11y owns ESC + focus trap; we pass onClose=undefined so
  // ESC is a no-op (mulligan choice is mandatory per spec).
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  useModalA11y(dialogRef, {});
  // Initial focus on Keep — the safe default. Runs once when the
  // modal mounts; useModalA11y's focus trap takes over after.
  useEffect(() => {
    if ((isMulligan || committedLocally) && keepRef.current) {
      keepRef.current.focus();
    }
  }, [isMulligan, committedLocally]);

  // Modal renders while either a mulligan dialog is pending OR the
  // local player has committed (waiting-for-opponents state).
  if ((!isMulligan && !committedLocally) || !dispatch) {
    return null;
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label="Mulligan decision"
      data-testid="mulligan-modal"
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-2xl w-full space-y-4 shadow-2xl">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-text-primary">
            Mulligan
          </h2>
          <p className="text-sm text-text-secondary">
            {committedLocally
              ? 'Decision sent. Waiting for opponents to commit.'
              : 'Keep your opening hand or take a mulligan? Mulligans resolve simultaneously when every player has decided.'}
          </p>
        </header>

        <PlayerStatusPanel
          gameView={gameView}
          committedLocally={committedLocally}
        />

        {/* Critic UI-#3 — MTG convention puts the primary action on
            the right. Keep is the primary (safe, default-expected)
            choice; Mulligan is the secondary destructive-ish action.
            Mulligan first in JSX → Keep last in JSX → visual order
            with `justify-end` is `[Mulligan] [Keep]` flush right.
            Tab order matches: Mulligan → Keep, with initial focus on
            Keep (set above). Critic Tech-I4 — buttons disabled after
            committedLocally so a stale-click doesn't double-dispatch
            against the cleared pendingDialog. */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            data-testid="mulligan-take"
            disabled={committedLocally}
            onClick={() => dispatch(true)}
            className={
              'px-4 py-2 rounded font-medium ' +
              'bg-surface-card text-text-primary hover:bg-surface-card-hover transition-colors ' +
              'disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            Mulligan
          </button>
          <button
            ref={keepRef}
            type="button"
            data-testid="mulligan-keep"
            disabled={committedLocally}
            onClick={() => dispatch(false)}
            className={
              'px-4 py-2 rounded font-medium ' +
              'bg-status-success text-bg-base hover:opacity-90 transition-opacity ' +
              'disabled:opacity-50 disabled:cursor-not-allowed'
            }
          >
            Keep
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shows every player as "deciding". The LOCAL player updates to
 * "committed" once {@code committedLocally} flips. Opponents stay
 * in "deciding" — no per-opponent commit signal exists on the wire
 * (deferred to a future server change).
 *
 * <p>Critic UI-#4 — uses an auto-fit grid so 1v1 (2 cells) fills a
 * 2-col row, 4p (4 cells) fills 2x2, and 3p (3 cells) avoids the
 * half-empty 4th cell that fixed 2-col would produce.
 */
function PlayerStatusPanel({
  gameView,
  committedLocally,
}: {
  gameView: WebGameView;
  committedLocally: boolean;
}) {
  return (
    <ul
      data-testid="mulligan-player-status"
      className="grid gap-2 text-sm"
      style={{
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
      }}
      aria-label="Player decisions"
    >
      {gameView.players.map((p) => {
        const isLocal = p.playerId === gameView.myPlayerId;
        const status = isLocal && committedLocally ? 'committed' : 'deciding…';
        const statusClass =
          isLocal && committedLocally
            ? 'text-xs text-status-success'
            : 'text-xs italic text-text-muted';
        return (
          <li
            key={p.playerId}
            data-testid={`mulligan-player-${p.playerId}`}
            className="flex items-center justify-between rounded border border-zinc-800 px-3 py-2 bg-zinc-950"
          >
            <span className="font-medium text-text-primary truncate">
              {p.name || 'Unknown'}
              {isLocal && (
                <span className="text-text-secondary text-xs ml-1.5">
                  (you)
                </span>
              )}
            </span>
            <span className={statusClass}>{status}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Detect a mulligan-shape gameAsk by the engine's button-text
 * convention. The engine populates {@code leftBtnText: "Mulligan"}
 * + {@code rightBtnText: "Keep"} for the mulligan loop only —
 * Proliferate / Time Travel / generic Y/N use different labels.
 *
 * <p>Exported so {@code GameDialog} can short-circuit when this
 * modal is the active renderer.
 *
 * <p>Slice 70-G critic Tech-I2 — i18n robustness. The match is on
 * the English literals "Mulligan"/"Keep". Upstream xmage doesn't
 * ship a translated server today, but if a future version does,
 * this predicate would silently return false → MulliganModal
 * hides → GameDialog renders the legacy AskDialog without the
 * modal chrome. The console.warn below surfaces the drift in dev
 * tools so a maintainer notices BEFORE the regression ships.
 *
 * <p>Slice 70-G critic Tech-C1 — warn dedup latch. The predicate
 * is called from MulliganModal's render body on every store update;
 * a `gameUpdate` storm would otherwise fire dozens of duplicate
 * warns per second on a drifted label. Module-scope Set tracks
 * which (left,right) pairs we've already warned about; clears
 * when the test suite calls {@link _resetMulliganWarnCacheForTest}.
 */
const warnedDriftLabels = new Set<string>();

/** Visible-for-test reset hook. Module-scope Set persists across
 *  test cases; call this in beforeEach to keep tests isolated. */
export function _resetMulliganWarnCacheForTest(): void {
  warnedDriftLabels.clear();
}

export function isMulliganDialog(pendingDialog: {
  method: string;
  data?: unknown;
}): boolean {
  if (pendingDialog.method !== 'gameAsk') return false;
  const data = pendingDialog.data as
    | { options?: { leftBtnText?: string; rightBtnText?: string } }
    | undefined;
  const left = data?.options?.leftBtnText ?? '';
  const right = data?.options?.rightBtnText ?? '';
  if (left === 'Mulligan' && right === 'Keep') return true;

  // Heuristic drift detector. A gameAsk with leftBtnText matching
  // /mull/i (Mull*, Mulligan, Mulliganer hypothetical i18n stems)
  // but NOT exactly "Mulligan" suggests i18n drift shipped. The
  // early-return above already handled the canonical pair, so the
  // /mull/i match here is unambiguous.
  if (typeof left === 'string' && /mull/i.test(left)) {
    const key = `${left}|${right}`;
    if (!warnedDriftLabels.has(key)) {
      warnedDriftLabels.add(key);
      // eslint-disable-next-line no-console
      console.warn(
        '[MulliganModal] gameAsk with mulligan-like label drift — ' +
          `left="${left}" right="${right}". MulliganModal will NOT render; ` +
          'falls back to legacy AskDialog. Likely i18n shipped on the ' +
          'engine side; update isMulliganDialog match accordingly.',
      );
    }
  }
  return false;
}
