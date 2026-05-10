import { createContext, useContext, type PropsWithChildren } from 'react';

/**
 * "Minimal-chrome" mode for the cinematic lab. When enabled, the
 * pod-cell drop shadows + rings, the 4-pod grid container's outer
 * border + inset ring + dark-scrim fill + inner-shadow vignette, and
 * the per-bucket commander-color borders inside each pod are
 * suppressed so the {@link BattlefieldBackground} artwork shows
 * through unobscured.
 *
 * <p>Player commander-color zone fills (via
 * {@code computeTabletopZoneBackground}) STAY because they're the
 * player-identity cue — removing them would render the pods identical
 * which makes "whose creatures are these" unreadable.
 *
 * <p>Default is {@code false}, so real games (Game.tsx) and the
 * fixture page (DemoGame.tsx) get the production chrome unchanged.
 * Only CinematicLab opts in via {@link MinimalChromeProvider}.
 */
const MinimalChromeContext = createContext<boolean>(false);

export function MinimalChromeProvider({
  children,
  enabled,
}: PropsWithChildren<{ enabled: boolean }>) {
  return (
    <MinimalChromeContext.Provider value={enabled}>
      {children}
    </MinimalChromeContext.Provider>
  );
}

export function useMinimalChrome(): boolean {
  return useContext(MinimalChromeContext);
}
