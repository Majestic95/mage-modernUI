import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebGameView, WebPlayerView } from '../api/schemas';
import { REDESIGN } from '../featureFlags';
import { isCommanderEntry } from './commanderPredicates';
import { LifeCounter } from './LifeCounter';
import { PlayerPortrait } from './PlayerPortrait';
import { useGameStore } from './store';

/**
 * Slice 70-F (ADR 0011 D5) — manual commander-damage tracker per
 * design-system §7.15. Mounted in the side-panel slot the
 * 70-E shell reserved.
 *
 * <p><b>Client-only state.</b> Spec §7.15 explicitly: "This is
 * manual entry; the engine does not enforce its accuracy." The
 * upstream wire format carries no commander-damage field. This
 * component owns its own per-(gameId, opponent) state in
 * {@code localStorage}, surviving page refreshes within a single
 * game and clearing when a new game starts (different gameId).
 *
 * <p>21 commander damage from a SINGLE commander ends the game. The
 * tracker shows current accumulated damage per opponent commander;
 * partner / background pairings render two counters per opponent
 * (one per commander).
 *
 * <p>Hidden entirely when no commander entries exist on the wire
 * (non-Commander format). Spec §7.15 doesn't lock this; the call
 * is consistent with the rest of the side panel's "show only what's
 * relevant" pattern.
 */
interface Props {
  gameId: string;
  gameView: WebGameView;
  opponents: readonly WebPlayerView[];
}

interface CommanderRow {
  opponentId: string;
  opponentName: string;
  commanderId: string;
  commanderName: string;
  /**
   * Slice 70-L — full opponent view so the redesign branch can
   * pass it to PlayerPortrait for art resolution. Optional in
   * the type for back-compat with any test that constructs rows
   * synthetically without a full player view; the redesign
   * branch falls back to the no-portrait layout when absent.
   */
  opponent?: WebPlayerView;
}

const STORAGE_KEY_PREFIX = 'mage-cmdr-dmg';

function storageKey(gameId: string, opponentId: string, commanderId: string): string {
  return `${STORAGE_KEY_PREFIX}:${gameId}:${opponentId}:${commanderId}`;
}

export function CommanderDamageTracker({ gameId, gameView, opponents }: Props) {
  // Bug fix (2026-05-02) — same `commandList` leaky-abstraction
  // defect documented in `xmage_commandlist_leaky.md`. The wire's
  // commandList empties when the commander leaves the command zone
  // (cast → battlefield), so a tracker reading only from live
  // commandList loses the row the moment the opponent's commander
  // gets cast — exactly when damage tracking is most relevant.
  // Fall back to the store's accumulated commanderSnapshots, which
  // remember every commander seen across the whole game.
  const commanderSnapshots = useGameStore(
    (s) => s.commanderSnapshots ?? {},
  );

  // Build the row list from each opponent's commander roster. Prefer
  // live commandList (handles partner pairings appearing mid-game)
  // and fill in from snapshot for commanders that have left the
  // command zone. Dedupe by (opponentId, commanderName) so a
  // re-cast doesn't double up.
  const rows: CommanderRow[] = opponents.flatMap((opp) => {
    const liveCommanders = opp.commandList.filter(isCommanderEntry);
    const snapshotCommanders = (commanderSnapshots[opp.playerId] ?? [])
      .filter(isCommanderEntry);
    const seenNames = new Set<string>();
    const merged: typeof liveCommanders = [];
    for (const co of [...liveCommanders, ...snapshotCommanders]) {
      if (seenNames.has(co.name)) continue;
      seenNames.add(co.name);
      merged.push(co);
    }
    return merged.map((co) => ({
      opponentId: opp.playerId,
      opponentName: opp.name || 'Unknown',
      commanderId: co.id,
      commanderName: co.name || 'Unknown commander',
      opponent: opp,
    }));
  });

  if (rows.length === 0) {
    return null;
  }

  // Slice 70-L (redesign push, picture-catalog §5.B) — 2×2 grid
  // when the redesign flag is on. Each cell shows the opponent's
  // commander portrait + damage number in a compact form.
  // Threshold-flash + lethal-ring + localStorage persistence + per-
  // game-cycle remount key (Tech-N4 fix) all carry over.
  if (REDESIGN) {
    return (
      <section
        data-testid="commander-damage-tracker"
        data-redesign="true"
        aria-label="Commander damage tracker"
        className="border-t border-zinc-800 px-3 py-2 space-y-2"
      >
        <header className="text-xs uppercase tracking-wide text-text-secondary">
          Commander damage
        </header>
        <div className="grid grid-cols-2 gap-2">
          {rows.map((row) => (
            <CommanderDamageCell
              key={`${row.opponentId}:${row.commanderId}:${gameView.gameCycle}`}
              row={row}
              gameId={gameId}
            />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section
      data-testid="commander-damage-tracker"
      aria-label="Commander damage tracker"
      className="border-t border-zinc-800 px-3 py-2 space-y-2"
    >
      <header className="text-xs uppercase tracking-wide text-text-secondary">
        Commander damage
      </header>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          // Critic Tech-N4 — gameCycle baked into the React key so
          // a new game cycle remounts the row + reads fresh
          // storage. The previous keySalt-as-prop pattern was a
          // dead prop (never consumed); this is the actual fix.
          <CommanderDamageRow
            key={`${row.opponentId}:${row.commanderId}:${gameView.gameCycle}`}
            row={row}
            gameId={gameId}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * Slice 70-L (redesign push) — single grid cell rendering an
 * opponent's commander portrait + damage number in the 2×2 grid.
 * Reuses the same localStorage / flash / lethal-threshold logic
 * as {@link CommanderDamageRow} but with a vertical compact
 * layout suited to the cell aspect ratio.
 */
function CommanderDamageCell({ row, gameId }: { row: CommanderRow; gameId: string }) {
  const key = storageKey(gameId, row.opponentId, row.commanderId);
  const [damage, setDamage] = useState<number>(() => readDamage(key));
  const flashKeyRef = useRef(0);
  const [flashTrigger, setFlashTrigger] = useState(0);

  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(damage));
    } catch {
      /* storage disabled — fail silent */
    }
  }, [key, damage]);

  const adjust = useCallback((delta: number) => {
    setDamage((d) => Math.max(0, d + delta));
    flashKeyRef.current += 1;
    setFlashTrigger(flashKeyRef.current);
  }, []);

  const lethal = damage >= 21;
  const cellRingClass = lethal
    ? 'ring-2 ring-status-danger'
    : 'ring-1 ring-zinc-800';

  return (
    <div
      data-testid={`cmdr-dmg-cell-${row.opponentId}-${row.commanderId}`}
      data-lethal={lethal || undefined}
      className={
        'relative flex items-center gap-2 rounded p-1.5 ' + cellRingClass
      }
    >
      {flashTrigger > 0 && (
        <div
          key={flashTrigger}
          data-testid={`cmdr-dmg-flash-${row.opponentId}-${row.commanderId}`}
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none rounded-[inherit] animate-cmdr-dmg-flash"
        />
      )}
      {row.opponent ? (
        <PlayerPortrait
          player={row.opponent}
          size="small"
          haloVariant="none"
          ariaLabel={`${row.opponentName} commander damage`}
        />
      ) : (
        // No opponent view — preserve the cell width so the grid
        // doesn't reflow.
        <span
          aria-hidden="true"
          className="block flex-shrink-0"
          style={{ width: 32, height: 32 }}
        />
      )}
      <div className="flex flex-col flex-1 min-w-0">
        <LifeCounter
          value={damage}
          interactive
          onAdjust={adjust}
          label={`${row.commanderName} damage to you`}
          testId={`cmdr-dmg-value-${row.opponentId}-${row.commanderId}`}
        />
      </div>
    </div>
  );
}

interface RowProps {
  row: CommanderRow;
  gameId: string;
}

function CommanderDamageRow({ row, gameId }: RowProps) {
  const key = storageKey(gameId, row.opponentId, row.commanderId);
  const [damage, setDamage] = useState<number>(() => readDamage(key));

  // Slice 70-G critic UX-3 — brief flash on every value change so
  // a player rapid-logging combat hits gets per-click confirmation
  // beyond the digit ticking up. The flash key is bumped on each
  // adjust so React remounts the briefly-animated wrapper. Initial
  // mount doesn't flash (the user didn't trigger it).
  const flashKeyRef = useRef(0);
  const [flashTrigger, setFlashTrigger] = useState(0);

  // Persist on every change. localStorage writes are synchronous +
  // cheap (one row), so no debounce is needed for the typical
  // "click ± a few times during combat" cadence.
  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(damage));
    } catch {
      // Quota exceeded / storage disabled — the tracker is a
      // memory aid, not a load-bearing surface. Fail silent; the
      // value still works in-session.
    }
  }, [key, damage]);

  const adjust = useCallback(
    (delta: number) => {
      setDamage((d) => Math.max(0, d + delta));
      flashKeyRef.current += 1;
      setFlashTrigger(flashKeyRef.current);
    },
    [],
  );

  // 21 damage from a SINGLE commander is lethal — flag the row red
  // when the threshold is crossed so the user notices.
  const lethal = damage >= 21;

  // Critic UI-#5 — when the row is lethal (≥21), the row's text
  // color goes danger but LifeCounter has its own internal text
  // color and won't inherit. Wrapping the LifeCounter in a
  // danger-tinted ring makes the lethal state unambiguous without
  // modifying the LifeCounter's internal styling.
  const counterWrapClass = lethal
    ? 'rounded ring-2 ring-status-danger px-1'
    : '';

  return (
    <li
      data-testid={`cmdr-dmg-row-${row.opponentId}-${row.commanderId}`}
      className={
        'flex items-center justify-between gap-2 text-xs ' +
        (lethal ? 'text-status-danger' : 'text-text-primary')
      }
    >
      <div className="flex flex-col min-w-0 truncate">
        <span className="truncate font-medium">{row.opponentName}</span>
        <span className="truncate text-text-secondary">
          {row.commanderName}
        </span>
      </div>
      {/*
        Slice 70-G critic UX-3 — flash overlay rendered as a SIBLING
        of the LifeCounter (not a wrapper). A wrapper would remount
        the LifeCounter + its +/- buttons on every flash-key bump,
        detaching userEvent's stored button reference and breaking
        rapid-click flows. The overlay uses absolute positioning +
        pointer-events-none so it sits above without eating clicks.
        Bumping `key={flashTrigger}` remounts the overlay only,
        replaying the 220ms keyframe from frame 0.
      */}
      <div className={`relative ${counterWrapClass}`}>
        {flashTrigger > 0 && (
          <div
            key={flashTrigger}
            data-testid={`cmdr-dmg-flash-${row.opponentId}-${row.commanderId}`}
            aria-hidden="true"
            // Slice 70-G critic Tech-C2 — corner radius matches the
            // outer wrapper (`rounded` 8px when lethal; 0 otherwise)
            // so the flash bg-tint doesn't briefly disagree with the
            // wrapper's corners during the 220ms keyframe. Inheriting
            // via `rounded-[inherit]` keeps the radii in lockstep.
            className="absolute inset-0 pointer-events-none rounded-[inherit] animate-cmdr-dmg-flash"
          />
        )}
        <LifeCounter
          value={damage}
          interactive
          onAdjust={adjust}
          label={`${row.commanderName} damage to you`}
          testId={`cmdr-dmg-value-${row.opponentId}-${row.commanderId}`}
        />
      </div>
    </li>
  );
}

function readDamage(key: string): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}
