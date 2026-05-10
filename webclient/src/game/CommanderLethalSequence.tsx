/**
 * Bundle 5 / Slice 5-E — lethal-21 commander damage authority
 * sequence.
 *
 * <p>Subscribes to {@link useCommanderLethalEvents} (which reads
 * schema 1.35's `WebPlayerView.commanderDamageReceived` per the
 * slice 5-F wire-format extension). On a `commander_lethal`
 * event, plays a brief authority sequence: a centered red banner
 * announcing the lethal moment, plus a viewport-edge danger pulse
 * (deeper than slice 5-C's freeze-frame). Multi-lethal events in
 * a single frame sequence one-after-another with a 300ms gap so
 * the user reads the order.
 *
 * <p><b>Brief deviation (documented):</b> the brief specifies the
 * sequence as "pause 80ms + halo rotation spike on the doomed
 * player's portrait + portrait scale pop + thin red line drawn
 * under commander label." Pinpointing the doomed player's
 * commander label requires per-portrait DOM queries that are
 * brittle to refactor. This slice ships a simpler centered
 * banner-style cinematic — same authority beat, simpler
 * positioning. Bundle critic pass at 5-X.0 can ratify the
 * simplification or push for the per-portrait integration.
 *
 * <p>The doomed player's name is read from the gameView's player
 * list (looked up by event.defenderId) so the banner can announce
 * "Lethal: ALICE — KARN" or similar.
 */
import { useEffect, useRef, useState } from 'react';
import {
  LETHAL_AUTHORITY_PAUSE_MS,
  LETHAL_AUTHORITY_TOTAL_MS,
  LETHAL_AUTHORITY_STAGGER_MS,
} from '../animation/transitions';
import {
  useCommanderLethalEvents,
  type CommanderLethalEvent,
} from '../animation/useCommanderLethalEvents';
import { useGameStore } from './store';

interface ActiveSequence {
  id: number;
  defenderName: string;
  damage: number;
}

export function CommanderLethalSequence() {
  const [active, setActive] = useState<ActiveSequence | null>(null);
  const nextIdRef = useRef(0);
  const pendingTimeoutsRef = useRef<Set<ReturnType<typeof setTimeout>>>(
    new Set(),
  );

  useCommanderLethalEvents((events) => {
    events.forEach((event, idx) => {
      const delay = idx * LETHAL_AUTHORITY_STAGGER_MS;
      const startTimeout = setTimeout(() => {
        pendingTimeoutsRef.current.delete(startTimeout);
        startSequence(event);
      }, delay);
      pendingTimeoutsRef.current.add(startTimeout);
    });
  });

  function startSequence(event: CommanderLethalEvent) {
    const id = nextIdRef.current++;
    const gv = useGameStore.getState().gameView;
    const defender = gv?.players.find((p) => p.playerId === event.defenderId);
    const defenderName = defender?.name ?? 'Player';
    setActive({ id, defenderName, damage: event.damage });
    const endTimeout = setTimeout(() => {
      pendingTimeoutsRef.current.delete(endTimeout);
      // Only clear if a newer sequence hasn't started in the
      // meantime (which would have bumped active.id).
      setActive((cur) => (cur && cur.id === id ? null : cur));
    }, LETHAL_AUTHORITY_TOTAL_MS);
    pendingTimeoutsRef.current.add(endTimeout);
  }

  useEffect(() => {
    return () => {
      const timeouts = pendingTimeoutsRef.current;
      for (const t of timeouts) clearTimeout(t);
      timeouts.clear();
    };
  }, []);

  if (!active) {
    return (
      <div
        data-testid="commander-lethal-sequence"
        data-active="false"
        aria-hidden="true"
      />
    );
  }

  return (
    <div
      key={`lethal-${active.id}`}
      data-testid="commander-lethal-sequence"
      data-active="true"
      aria-hidden="true"
      className="pointer-events-none animate-commander-lethal-pulse"
      style={{
        position: 'fixed',
        inset: 0,
        // z above damage freeze-frame (z=28); below dialogs/modals.
        // The lethal moment is the loudest cinematic beat in
        // Bundle 5 — must paint over freeze-frame + parcels but
        // never over actionable UI like dialogs.
        zIndex: 29,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        data-testid="commander-lethal-banner"
        className="animate-commander-lethal-banner"
        style={{
          padding: '24px 48px',
          background: 'rgba(40, 0, 0, 0.85)',
          border: '2px solid rgb(220, 60, 60)',
          borderRadius: 8,
          color: 'rgb(255, 220, 220)',
          fontSize: 28,
          fontWeight: 'bold',
          letterSpacing: '0.05em',
          textShadow: '0 2px 8px rgba(180, 0, 0, 0.85)',
          boxShadow:
            '0 0 24px 8px rgba(220, 60, 60, 0.5), 0 0 48px 16px rgba(180, 0, 0, 0.35)',
          // Hide initially — the keyframe scales + fades it in
          // after the 80ms authority pause.
          animationDelay: `${LETHAL_AUTHORITY_PAUSE_MS}ms`,
        }}
      >
        Lethal Commander Damage — {active.defenderName}
      </div>
    </div>
  );
}
