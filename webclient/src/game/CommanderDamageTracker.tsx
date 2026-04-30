import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebGameView, WebPlayerView } from '../api/schemas';
import { LifeCounter } from './LifeCounter';

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
}

const STORAGE_KEY_PREFIX = 'mage-cmdr-dmg';

function storageKey(gameId: string, opponentId: string, commanderId: string): string {
  return `${STORAGE_KEY_PREFIX}:${gameId}:${opponentId}:${commanderId}`;
}

export function CommanderDamageTracker({ gameId, gameView, opponents }: Props) {
  // Build the row list from each opponent's command zone. Filter
  // for entries with kind="commander" (excludes emblems / dungeons /
  // planes per slice 70-D's WebCommandObjectView discriminator).
  const rows: CommanderRow[] = opponents.flatMap((opp) =>
    opp.commandList
      .filter((co) => co.kind === 'commander')
      .map((co) => ({
        opponentId: opp.playerId,
        opponentName: opp.name || 'Unknown',
        commanderId: co.id,
        commanderName: co.name || 'Unknown commander',
      })),
  );

  if (rows.length === 0) {
    return null;
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
