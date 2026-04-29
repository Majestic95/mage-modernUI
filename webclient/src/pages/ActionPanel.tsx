import { useEffect, useState } from 'react';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';
import { nextPhaseAction } from './actionPanelHelpers';

interface Props {
  stream: GameStream | null;
}

// Phase-step → next-phase action mapping lives in
// ./actionPanelHelpers (slice 66a split — see that file for the
// engine-semantics contract).

/**
 * True when the orb is currently in the Beginning or Combat phase
 * blocks — used to enable/disable {@code Skip combat}, which only
 * makes sense before/during combat.
 */
function isInCombatOrBeginning(step: string): boolean {
  switch (step) {
    case 'UNTAP':
    case 'UPKEEP':
    case 'DRAW':
    case 'BEGIN_COMBAT':
    case 'DECLARE_ATTACKERS':
    case 'DECLARE_BLOCKERS':
    case 'FIRST_COMBAT_DAMAGE':
    case 'COMBAT_DAMAGE':
    case 'END_COMBAT':
      return true;
    default:
      return false;
  }
}

/**
 * Keyboard pass-priority shortcuts (slice 29). Mapping mirrors the
 * upstream Swing client where it doesn't conflict with browser
 * defaults — F5/F11/F12 are reserved by browsers (refresh,
 * fullscreen, devtools), so we skip those and use Esc for cancel.
 *
 * <p>{@code key} is matched case-insensitively against
 * {@link KeyboardEvent#key}. {@code action} is the upstream
 * {@code PlayerAction} enum name (whitelisted in
 * {@code PlayerActionAllowList}). When {@code action === 'NEXT_PHASE'}
 * the dispatch is phase-aware — see {@link nextPhaseAction}.
 */
interface Hotkey {
  key: string;
  action: string;
  label: string;
  /** Require Ctrl/Cmd modifier when matching (slice 37 — Ctrl+Z = undo). */
  ctrl?: boolean;
}

const NEXT_PHASE_SENTINEL = 'NEXT_PHASE';

const HOTKEYS: Hotkey[] = [
  { key: 'F2', action: NEXT_PHASE_SENTINEL, label: 'Next Phase' },
  { key: 'F4', action: 'PASS_PRIORITY_UNTIL_NEXT_TURN', label: 'End turn' },
  { key: 'F6', action: 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', label: 'Skip combat' },
  { key: 'F8', action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED', label: 'Resolve stack' },
  { key: 'Escape', action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS', label: 'Stop skipping' },
  { key: 'z', action: 'UNDO', label: 'Undo', ctrl: true },
];

/**
 * Persistent action bar for the controlling player. Three visual
 * groups:
 *
 * <ol>
 *   <li><b>Primary action</b> — {@code Next Phase} (fuchsia). Dispatches
 *       a phase-aware pass that advances the timeline orb by one
 *       phase block.</li>
 *   <li><b>Skip-ahead</b> — {@code End turn} / {@code Skip combat} /
 *       {@code Resolve stack}. Each maps to a single
 *       {@code PASS_PRIORITY_UNTIL_*} action.</li>
 *   <li><b>Recovery</b> — {@code Stop skipping} (cancel automation) /
 *       {@code Undo} (take back last action).</li>
 * </ol>
 *
 * <p>Plus right-aligned {@code Concede} (slice 37) which still
 * routes through the confirmation modal.
 *
 * <p>Priority indicator: the skip-ahead group is dimmed when the
 * controlling player isn't priority-holder — the server will accept
 * the action but it's effectively a no-op until priority returns.
 */
export function ActionPanel({ stream }: Props) {
  const session = useAuthStore((s) => s.session);
  const gv = useGameStore((s) => s.gameView);

  // Slice 29: keyboard pass-priority shortcuts. Listener attaches at
  // the document level so the user doesn't have to focus the panel —
  // they can press F2 from anywhere on the page. Skip when focus is
  // in an input / textarea / contenteditable so chat doesn't trip
  // the hotkeys.
  useEffect(() => {
    if (!stream) return;
    const handler = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const ctrlOrCmd = ev.ctrlKey || ev.metaKey;
      const match = HOTKEYS.find((h) => {
        if (h.key.toLowerCase() !== ev.key.toLowerCase()) return false;
        // Hotkeys with ctrl flag require the modifier; those without
        // require its absence (so a bare "z" keystroke in chat-like
        // contexts doesn't fire UNDO).
        return !!h.ctrl === ctrlOrCmd;
      });
      if (!match) return;
      ev.preventDefault();
      if (match.action === NEXT_PHASE_SENTINEL) {
        // Read latest store state directly — captured `gv` would
        // be stale across re-renders without re-binding the listener.
        const step = useGameStore.getState().gameView?.step ?? '';
        const action = nextPhaseAction(step);
        if (action) stream.sendPlayerAction(action);
      } else {
        stream.sendPlayerAction(match.action);
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
    };
  }, [stream]);

  // Slice 37 — confirmation modal for Concede so a stray click
  // doesn't end the match. Click "Concede" → opens modal; modal
  // Esc / backdrop / Cancel dismisses; "Yes, concede" sends.
  const [confirmConcede, setConfirmConcede] = useState(false);

  if (!gv || !session) return null;

  const myPriority = gv.priorityPlayerName === session.username;
  const send = (action: string) => stream?.sendPlayerAction(action);
  const stackEmpty = Object.keys(gv.stack).length === 0;
  const inCombatOrBeginning = isInCombatOrBeginning(gv.step);
  const nextPhase = nextPhaseAction(gv.step);

  return (
    <div
      data-testid="action-panel"
      // Slice 57 (UX audit fix A) — relative z-30 flex-shrink-0:
      //   - relative + z-30 establishes a stacking context above the
      //     hand fan (whose hover-lift uses z-20 post-fix). Without
      //     this, lifted hand cards paint over the buttons and
      //     intercept clicks.
      //   - flex-shrink-0 prevents the panel from compressing when
      //     the flex column is tight on vertical space; main shrinks
      //     instead. The panel must always be reachable.
      className="relative z-30 flex-shrink-0 border-t border-zinc-800 bg-zinc-950 px-4 py-2 flex flex-wrap gap-2 items-center"
    >
      <span
        className="text-xs uppercase tracking-wide text-zinc-500 mr-2"
        title={myPriority ? 'You hold priority' : 'Waiting for opponent'}
      >
        {myPriority ? 'Your priority' : 'Waiting…'}
      </span>

      {/* Group 1 — Primary action (fuchsia). Phase-aware dispatch. */}
      <button
        type="button"
        data-testid="next-phase-button"
        data-action={nextPhase ?? ''}
        onClick={() => {
          if (nextPhase) send(nextPhase);
        }}
        disabled={!nextPhase}
        title={
          nextPhase
            ? 'Advance to the next phase on the timeline above (F2)'
            : 'Disabled — no active phase'
        }
        className={
          'px-3 py-1 rounded text-xs border font-semibold ' +
          (nextPhase
            ? 'bg-fuchsia-700 hover:bg-fuchsia-600 text-white border-fuchsia-800'
            : 'bg-fuchsia-950/40 text-fuchsia-300/40 border-fuchsia-900/40 cursor-not-allowed')
        }
      >
        Next Phase
      </button>

      {/* Visual divider between groups. */}
      <span aria-hidden="true" className="w-px h-5 bg-zinc-800 mx-1" />

      {/* Group 2 — Skip-ahead. */}
      <PassButton
        label="End turn"
        action="PASS_PRIORITY_UNTIL_NEXT_TURN"
        send={send}
        active={myPriority}
        title="Skip everything until your next untap (F4)"
      />
      <PassButton
        label="Skip combat"
        action="PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE"
        send={send}
        active={myPriority}
        disabled={!inCombatOrBeginning}
        disabledTitle="Disabled — not in combat"
        title="Skip the rest of combat to the next main phase (F6)"
      />
      <PassButton
        label="Resolve stack"
        action="PASS_PRIORITY_UNTIL_STACK_RESOLVED"
        send={send}
        active={myPriority}
        disabled={stackEmpty}
        disabledTitle="Disabled — no stack to resolve"
        title="Pass through every priority window until the stack empties (F8)"
      />

      {/* Visual divider between groups. */}
      <span aria-hidden="true" className="w-px h-5 bg-zinc-800 mx-1" />

      {/* Group 3 — Recovery. Always enabled regardless of priority. */}
      <PassButton
        label="Stop skipping"
        action="PASS_PRIORITY_CANCEL_ALL_ACTIONS"
        send={send}
        active={true}
        title="Cancel any in-progress automation (Esc)"
      />
      <button
        type="button"
        data-testid="undo-button"
        onClick={() => send('UNDO')}
        className="px-3 py-1 rounded text-xs border bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
        title="Take back your last action this priority window (Ctrl+Z)"
      >
        Undo
      </button>

      <div className="flex-1" />

      {/* Match action — Concede (slice 37 modal flow). */}
      <button
        type="button"
        data-testid="concede-button"
        onClick={() => setConfirmConcede(true)}
        className="px-3 py-1 rounded text-xs bg-red-900/40 hover:bg-red-800/60 text-red-200 border border-red-900/60"
        title="Concede the current game"
      >
        Concede
      </button>
      {confirmConcede && (
        <ConfirmConcedeModal
          onCancel={() => setConfirmConcede(false)}
          onConfirm={() => {
            send('CONCEDE');
            setConfirmConcede(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * Concede confirmation modal (slice 37). Closes on backdrop click,
 * Cancel button, or Esc keydown — the Esc handler is registered
 * with capture: true and calls stopImmediatePropagation so it
 * runs before the panel's bubble-phase hotkey listener and
 * suppresses the cancel-passes shortcut while the modal is open.
 * Same pattern as the slice-31 ZoneBrowser modal.
 */
function ConfirmConcedeModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => {
      document.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [onCancel]);
  return (
    <div
      data-testid="concede-confirm"
      className="fixed inset-0 z-40 flex items-center justify-center"
    >
      <div
        data-testid="concede-confirm-backdrop"
        className="absolute inset-0 bg-black/60"
        onClick={onCancel}
      />
      <div
        role="dialog"
        aria-label="Confirm concede"
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl p-5 w-[min(90vw,360px)] space-y-4"
      >
        <h2 className="text-sm font-semibold text-zinc-100">Concede game?</h2>
        <p className="text-sm text-zinc-400">
          This ends the current game immediately. The match continues
          if more games remain.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 rounded text-xs border bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="concede-confirm-yes"
            onClick={onConfirm}
            className="px-3 py-1 rounded text-xs bg-red-700 hover:bg-red-600 text-white border border-red-800"
          >
            Yes, concede
          </button>
        </div>
      </div>
    </div>
  );
}

function PassButton({
  label,
  action,
  send,
  active,
  title,
  disabled,
  disabledTitle,
}: {
  label: string;
  action: string;
  send: (action: string) => void;
  active: boolean;
  title: string;
  /** Force-disabled (e.g. Resolve stack with empty stack). */
  disabled?: boolean;
  /** Tooltip override when {@code disabled} is true. */
  disabledTitle?: string;
}) {
  const isDisabled = !!disabled;
  return (
    <button
      type="button"
      onClick={() => {
        if (!isDisabled) send(action);
      }}
      disabled={isDisabled}
      title={isDisabled && disabledTitle ? disabledTitle : title}
      data-action={action}
      className={
        'px-3 py-1 rounded text-xs border ' +
        (isDisabled
          ? 'bg-zinc-900 text-zinc-600 border-zinc-800 opacity-50 cursor-not-allowed'
          : active
            ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700'
            : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:bg-zinc-800')
      }
    >
      {label}
    </button>
  );
}
