/**
 * Subscribes to the game store and plays a chime on the rising edge
 * of the LOCAL player's priority or active-turn flags. Designed to
 * be mounted exactly once per game window (Game.tsx); subscribing
 * twice would fire each chime twice.
 *
 * <p>Why a store-subscribe pattern instead of a useEffect on the
 * gameView snapshot? The store snapshot updates ~10x/turn during
 * combat; reading it via {@code useGameStore((s) => s.gameView)} in
 * a component and firing useEffect on every change is fine for
 * components that ALREADY render on every change (most of the game
 * board), but for a sound-trigger that ONLY needs the rising edge
 * we'd waste the React work. {@code useGameStore.subscribe} runs as
 * an external event source: no re-render, just a callback when the
 * store changes.
 */
import { useEffect } from 'react';
import { playChime } from './audioCues';
import { useAudioSettings } from './audioSettingsStore';
import { useGameStore } from './store';

export function useAudioCues(): void {
  useEffect(() => {
    let prevPriority = false;
    let prevActive = false;
    let initialized = false;
    return useGameStore.subscribe((state) => {
      const gv = state.gameView;
      if (!gv) {
        // Game ended / not loaded — reset edge tracking so a new
        // game's first priority gain doesn't get suppressed by a
        // stale "true" from the previous game.
        prevPriority = false;
        prevActive = false;
        initialized = false;
        return;
      }
      const me = gv.players.find((p) => p.playerId === gv.myPlayerId);
      if (!me) return;
      const hasPriority = me.hasPriority;
      const isActive = me.isActive;
      // First observation: prime the edge tracker without playing.
      // Otherwise reloading the page mid-priority would fire the
      // chime spuriously.
      if (!initialized) {
        prevPriority = hasPriority;
        prevActive = isActive;
        initialized = true;
        return;
      }
      const settings = useAudioSettings.getState();
      if (hasPriority && !prevPriority && settings.priorityEnabled) {
        playChime('priority', settings.priorityVolume);
      }
      if (isActive && !prevActive && settings.turnEnabled) {
        playChime('turn', settings.turnVolume);
      }
      prevPriority = hasPriority;
      prevActive = isActive;
    });
  }, []);
}
