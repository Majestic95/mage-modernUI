import { useEffect, useState } from 'react';
import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';

interface Props {
  stream: GameStream | null;
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
 * {@code PlayerActionAllowList}).
 */
interface Hotkey {
  key: string;
  action: string;
  label: string;
  /** Require Ctrl/Cmd modifier when matching (slice 37 — Ctrl+Z = undo). */
  ctrl?: boolean;
}

const HOTKEYS: Hotkey[] = [
  { key: 'F2', action: 'PASS_PRIORITY_UNTIL_TURN_END_STEP', label: 'Pass step' },
  { key: 'F4', action: 'PASS_PRIORITY_UNTIL_NEXT_TURN', label: 'To end turn' },
  { key: 'F6', action: 'PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE', label: 'To next main' },
  { key: 'F8', action: 'PASS_PRIORITY_UNTIL_STACK_RESOLVED', label: 'Resolve stack' },
  { key: 'Escape', action: 'PASS_PRIORITY_CANCEL_ALL_ACTIONS', label: 'Cancel' },
  { key: 'z', action: 'UNDO', label: 'Undo', ctrl: true },
];

/**
 * Persistent action bar for the controlling player. Currently:
 *
 * <ul>
 *   <li>Pass priority — five canonical pass modes (until-end-of-turn,
 *       until-next-main, until-next-turn, until-stack-resolved, plus
 *       a single-step pass)</li>
 *   <li>Concede — sends {@code PlayerAction.CONCEDE}</li>
 * </ul>
 *
 * <p>Priority indicator: buttons are dimmed when the current
 * priority-holder isn't the controlling player, so the user has a
 * visual signal that "passing" right now is a no-op (server will
 * accept but it's already not your priority).
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
      stream.sendPlayerAction(match.action);
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

  return (
    <div
      data-testid="action-panel"
      className="border-t border-zinc-800 bg-zinc-950 px-4 py-2 flex flex-wrap gap-2 items-center"
    >
      <span
        className="text-xs uppercase tracking-wide text-zinc-500 mr-2"
        title={myPriority ? 'You hold priority' : 'Waiting for opponent'}
      >
        {myPriority ? 'Your priority' : 'Waiting…'}
      </span>
      <PassButton
        label="Pass step"
        action="PASS_PRIORITY_UNTIL_TURN_END_STEP"
        send={send}
        active={myPriority}
        title="Pass priority through the current step (F2)"
      />
      <PassButton
        label="To end turn"
        action="PASS_PRIORITY_UNTIL_NEXT_TURN"
        send={send}
        active={myPriority}
        title="Skip ahead to your next untap step (F4)"
      />
      <PassButton
        label="To next main"
        action="PASS_PRIORITY_UNTIL_NEXT_MAIN_PHASE"
        send={send}
        active={myPriority}
        title="Skip ahead to the next main phase (F6)"
      />
      <PassButton
        label="Resolve stack"
        action="PASS_PRIORITY_UNTIL_STACK_RESOLVED"
        send={send}
        active={myPriority}
        title="Pass through every priority window until the stack empties (F8)"
      />
      <PassButton
        label="Cancel passes"
        action="PASS_PRIORITY_CANCEL_ALL_ACTIONS"
        send={send}
        active={true}
        title="Stop any ongoing pass-priority-until automation (Esc)"
      />
      <button
        type="button"
        data-testid="undo-button"
        onClick={() => send('UNDO')}
        className="px-3 py-1 rounded text-xs border bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700"
        title="Undo your last action this priority window (Ctrl+Z)"
      >
        Undo
      </button>
      <div className="flex-1" />
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
}: {
  label: string;
  action: string;
  send: (action: string) => void;
  active: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={() => send(action)}
      title={title}
      data-action={action}
      className={
        'px-3 py-1 rounded text-xs border ' +
        (active
          ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border-zinc-700'
          : 'bg-zinc-900 text-zinc-500 border-zinc-800 hover:bg-zinc-800')
      }
    >
      {label}
    </button>
  );
}
