import React from 'react';

/* ---------- waiting ---------- */

/**
 * P1 audit fix — when `onReconnect` is provided AND the connection is
 * in a failed state, render a manual "Reconnect" button. Without this,
 * a user whose auto-reconnect cap was exhausted (~75s of dropouts) had
 * no recovery path short of a page refresh — which loses unsubmitted
 * clicks and any locally-held draft state.
 */
export function Waiting({
  connection,
  onReconnect,
}: {
  connection: string;
  onReconnect?: () => void;
}) {
  if (connection === 'connecting') {
    return <Centered>Connecting…</Centered>;
  }
  if (connection === 'error' || connection === 'closed') {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-3">
          <span>Connection {connection}.</span>
          {onReconnect && (
            <button
              type="button"
              data-testid="manual-reconnect-button"
              onClick={onReconnect}
              className="px-4 py-2 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-zinc-100 text-sm font-semibold"
            >
              Reconnect
            </button>
          )}
        </div>
      </Centered>
    );
  }
  return <Centered>Waiting for game state…</Centered>;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center text-zinc-500">
      {children}
    </div>
  );
}
