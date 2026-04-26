import { useAuthStore } from '../auth/store';
import { useGameStore } from '../game/store';
import type { GameStream } from '../game/stream';

interface Props {
  stream: GameStream | null;
}

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
        title="Pass priority through the current step"
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
        title="Stop any ongoing pass-priority-until automation"
      />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => send('CONCEDE')}
        className="px-3 py-1 rounded text-xs bg-red-900/40 hover:bg-red-800/60 text-red-200 border border-red-900/60"
        title="Concede the current game"
      >
        Concede
      </button>
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
