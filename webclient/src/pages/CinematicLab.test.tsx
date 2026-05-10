import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { CinematicLab } from './CinematicLab';
import { useGameStore } from '../game/store';
import { useAuthStore } from '../auth/store';

/**
 * Bundle 5 cinematic lab — smoke test for the four trigger buttons
 * + game-store mutations. Verifies the page mounts cleanly and each
 * button mutates the store as the lab's docstring describes (combat
 * damage = -3 life on a defender; creature dies = battlefield count
 * drops by 1 on an opponent; lethal = commanderDamageReceived map
 * contains a >=21 entry on an opponent after raf flush; reset =
 * baseline life 40 restored).
 *
 * <p>Visual cinematic playback is verified manually post-deploy —
 * this suite locks the lab's behavior contract (button → store
 * mutation), not the cinematic frame timing.
 */

beforeEach(() => {
  // Clean slate — the lab seeds the store on mount; tests should not
  // inherit state from previous tests.
  useGameStore.getState().reset();
  useAuthStore.setState({ session: null });
});

afterEach(() => {
  useGameStore.getState().reset();
  useAuthStore.setState({ session: null });
});

describe('CinematicLab', () => {
  it('mounts the lab page with all four trigger buttons + status text', () => {
    render(<CinematicLab />);
    expect(screen.getByTestId('cinematic-lab')).toBeInTheDocument();
    expect(screen.getByTestId('cinematic-lab-panel')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-combat-damage')).toBeInTheDocument();
    expect(screen.getByTestId('trigger-creature-dies')).toBeInTheDocument();
    expect(
      screen.getByTestId('trigger-lethal-commander'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('trigger-reset')).toBeInTheDocument();
    expect(screen.getByTestId('cinematic-lab-status')).toBeInTheDocument();
  });

  it('seeds the store with the combat-active fixture on mount', () => {
    render(<CinematicLab />);
    const view = useGameStore.getState().gameView;
    expect(view).not.toBeNull();
    // combatActive: true — combat[] populated with 3 groups against
    // goat / momur / alloc.
    expect(view!.combat.length).toBeGreaterThanOrEqual(1);
    // Baseline life is 40 on most Commander players, 35 on alloc
    // (the fixture pre-seeds alloc lower for low-life-trigger
    // verification — see devFixtures.ts:365). Either way > 30.
    for (const p of view!.players) {
      expect(p.life).toBeGreaterThanOrEqual(35);
    }
  });

  it('combat-damage button decrements an opponent life by 3', () => {
    render(<CinematicLab />);
    const initialView = useGameStore.getState().gameView!;
    const firstDefenderId = initialView.combat[0]!.defenderId;
    const initialLife = initialView.players.find(
      (p) => p.playerId === firstDefenderId,
    )!.life;
    fireEvent.click(screen.getByTestId('trigger-combat-damage'));
    const nextView = useGameStore.getState().gameView!;
    const nextLife = nextView.players.find(
      (p) => p.playerId === firstDefenderId,
    )!.life;
    expect(nextLife).toBe(initialLife - 3);
  });

  it('creature-dies button moves a battlefield creature to graveyard', () => {
    render(<CinematicLab />);
    const myId = useGameStore.getState().gameView!.myPlayerId;
    const findOpponentBfCount = () => {
      const view = useGameStore.getState().gameView!;
      const opponent = view.players.find((p) => p.playerId !== myId)!;
      return Object.keys(opponent.battlefield).length;
    };
    const findOpponentGraveCount = () => {
      const view = useGameStore.getState().gameView!;
      const opponent = view.players.find((p) => p.playerId !== myId)!;
      return Object.keys(opponent.graveyard).length;
    };
    const beforeBf = findOpponentBfCount();
    const beforeGrave = findOpponentGraveCount();
    fireEvent.click(screen.getByTestId('trigger-creature-dies'));
    expect(findOpponentBfCount()).toBe(beforeBf - 1);
    expect(findOpponentGraveCount()).toBe(beforeGrave + 1);
  });

  it('lethal-commander button writes >=21 to an opponent commanderDamageReceived after raf', async () => {
    render(<CinematicLab />);
    const myId = useGameStore.getState().gameView!.myPlayerId;
    fireEvent.click(screen.getByTestId('trigger-lethal-commander'));
    // The two-step setState uses requestAnimationFrame between step
    // 1 (seed at 20) and step 2 (cross to 21). Flush the raf manually
    // by spying on the global. JSDOM defers raf without a time tick,
    // so we run the queued frame via a microtask wait.
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    const view = useGameStore.getState().gameView!;
    const opponent = view.players.find((p) => p.playerId !== myId)!;
    const damages = Object.values(opponent.commanderDamageReceived ?? {});
    expect(damages.some((v) => v >= 21)).toBe(true);
  });

  it('reset button restores baseline life totals after combat-damage mutation', () => {
    render(<CinematicLab />);
    // Capture per-player baseline (alloc starts at 35; rest at 40
    // per the fixture seed in devFixtures.ts:254-365).
    const baselineByPlayer = new Map<string, number>();
    for (const p of useGameStore.getState().gameView!.players) {
      baselineByPlayer.set(p.playerId, p.life);
    }
    fireEvent.click(screen.getByTestId('trigger-combat-damage'));
    fireEvent.click(screen.getByTestId('trigger-reset'));
    const view = useGameStore.getState().gameView!;
    for (const p of view.players) {
      expect(p.life).toBe(baselineByPlayer.get(p.playerId)!);
    }
  });

  it('status text updates after each trigger (non-empty acknowledgement)', () => {
    render(<CinematicLab />);
    const initialStatus = screen.getByTestId('cinematic-lab-status').textContent ?? '';
    fireEvent.click(screen.getByTestId('trigger-combat-damage'));
    const afterStatus = screen.getByTestId('cinematic-lab-status').textContent ?? '';
    expect(afterStatus).not.toBe(initialStatus);
    expect(afterStatus.length).toBeGreaterThan(0);
  });
});
