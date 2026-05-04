/**
 * Slice 70-Z.1 — PlayerArea REDESIGN per-pod battlefield-area
 * composition coverage. Locks the artifact-zone presence rules,
 * the per-pod row orientation (horizontal for top/bottom pods,
 * vertical for left/right opponents), and the empty-state
 * fallback. Lives in its own test file so the vi.mock for
 * featureFlags doesn't bleed into the legacy PlayerArea.test.tsx.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  webPermanentViewSchema,
  webPlayerViewSchema,
  type WebPermanentView,
  type WebPlayerView,
} from '../api/schemas';

const flagState = vi.hoisted(() => ({ redesign: false, layoutBounds: false }));
vi.mock('../featureFlags', () => ({
  get REDESIGN() {
    return flagState.redesign;
  },
  // 2026-05-03 — LAYOUT_BOUNDS gate. Default false in tests so the
  // existing legacy-path orientation/empty-state assertions still
  // apply; opt in per-test where the locked-zone path is exercised.
  get LAYOUT_BOUNDS() {
    return flagState.layoutBounds;
  },
}));

import { PlayerArea } from './PlayerArea';

function makePerm(name: string, types: string[]): WebPermanentView {
  return webPermanentViewSchema.parse({
    card: {
      id: `card-${name}`,
      cardId: `card-${name}`,
      name,
      displayName: name,
      expansionSetCode: 'TEST',
      cardNumber: '1',
      manaCost: '',
      manaValue: 0,
      typeLine: types.join(' '),
      supertypes: [],
      types,
      subtypes: [],
      colors: [],
      rarity: 'COMMON',
      power: '',
      toughness: '',
      startingLoyalty: '',
      rules: [],
      faceDown: false,
      counters: {},
      transformable: false,
      transformed: false,
      secondCardFace: null,
    },
    controllerName: 'alice',
    tapped: false,
    flipped: false,
    transformed: false,
    phasedIn: true,
    summoningSickness: false,
    damage: 0,
    attachments: [],
    attachedTo: '',
    attachedToPermanent: false,
  });
}

function makePlayer(perms: WebPermanentView[]): WebPlayerView {
  const battlefield: Record<string, WebPermanentView> = {};
  for (const p of perms) battlefield[p.card.id] = p;
  return webPlayerViewSchema.parse({
    playerId: '11111111-1111-1111-1111-111111111111',
    name: 'alice',
    life: 20,
    wins: 0,
    winsNeeded: 1,
    libraryCount: 60,
    handCount: 7,
    graveyard: {},
    exile: {},
    sideboard: {},
    battlefield,
    manaPool: {
      red: 0,
      green: 0,
      blue: 0,
      white: 0,
      black: 0,
      colorless: 0,
    },
    controlled: false,
    isHuman: true,
    isActive: false,
    hasPriority: false,
    hasLeft: false,
    monarch: false,
    initiative: false,
    designationNames: [],
  });
}

const PASSTHROUGH = {
  canAct: false,
  onObjectClick: () => {},
  targetable: false,
  eligibleCombatIds: new Set<string>(),
  combatRoles: new Map<string, 'attacker' | 'blocker'>(),
  isDropTarget: false,
  onBoardDrop: () => {},
};

beforeEach(() => {
  flagState.redesign = true;
});

afterEach(() => {
  flagState.redesign = false;
});

describe('PlayerArea — REDESIGN battlefield composition (slice 70-Z.1)', () => {
  describe('artifact zone visibility', () => {
    it('renders the artifact zone when at least one artifact / enchantment is on the battlefield', () => {
      const perms = [
        makePerm('Sol Ring', ['ARTIFACT']),
        makePerm('Forest', ['LAND']),
        makePerm('BearCub', ['CREATURE']),
      ];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      expect(screen.getByTestId('artifact-zone')).toBeInTheDocument();
    });

    it('omits the artifact zone entirely when no artifacts (catalog: "render nothing until needed")', () => {
      const perms = [
        makePerm('Forest', ['LAND']),
        makePerm('BearCub', ['CREATURE']),
      ];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      expect(screen.queryByTestId('artifact-zone')).toBeNull();
    });

    it('routes planeswalkers to the creatures lane (artifact zone stays empty if no artifacts)', () => {
      // Slice 70-Z.1 user direction: "Planeswalkers and commanders
      // should be in the creature zone since they are creatures."
      const perms = [
        makePerm('Liliana', ['PLANESWALKER']),
        makePerm('BearCub', ['CREATURE']),
        makePerm('Forest', ['LAND']),
      ];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      // No artifacts on board → no artifact zone.
      expect(screen.queryByTestId('artifact-zone')).toBeNull();
      // Both BearCub + Liliana render — count permanent buttons.
      // Each tile is a `data-testid="permanent"` button.
      const allPerms = screen.getAllByTestId('permanent');
      expect(allPerms).toHaveLength(3); // bear + liliana + forest
    });

    it('skips the main-rows wrapper entirely on artifacts-only boards (Tech IMP-2)', () => {
      // Slice 70-Z.1 critic Tech IMP-2 — when both creatures and
      // lands buckets are empty (turn-1 Mox / Sol Ring opening),
      // the empty `battlefield-main-rows` flex-1 div would otherwise
      // sit next to the artifact box consuming the remaining axis
      // space. Skip the wrapper entirely so the artifact box pins
      // to the screen edge cleanly.
      const perms = [makePerm('Sol Ring', ['ARTIFACT'])];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      expect(screen.getByTestId('artifact-zone')).toBeInTheDocument();
      expect(screen.queryByTestId('battlefield-main-rows')).toBeNull();
    });

    it('routes unknown card types to the artifact zone (default fallback)', () => {
      const perms = [
        makePerm('FutureCard', ['SOME_NEW_TYPE']),
        makePerm('BearCub', ['CREATURE']),
      ];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      const artifactZone = screen.getByTestId('artifact-zone');
      expect(within(artifactZone).getAllByTestId('permanent')).toHaveLength(1);
    });
  });

  describe('per-pod row orientation', () => {
    const POSITIONS_VERTICAL_PODS = ['top', 'bottom'] as const;
    const POSITIONS_HORIZONTAL_PODS = ['left', 'right'] as const;

    it.each(POSITIONS_VERTICAL_PODS)(
      '%s pod uses HORIZONTAL row orientation (cards lay left→right)',
      (position) => {
        const perms = [
          makePerm('Sol Ring', ['ARTIFACT']),
          makePerm('Forest', ['LAND']),
          makePerm('BearCub', ['CREATURE']),
        ];
        render(
          <PlayerArea
            player={makePlayer(perms)}
            perspective={position === 'bottom' ? 'self' : 'opponent'}
            position={position}
            {...PASSTHROUGH}
          />,
        );
        // BattlefieldRowGroup emits data-orientation; assert it is
        // 'horizontal' for the main rows (creatures + lands).
        const rows = screen
          .getAllByTestId('battlefield-row')
          .filter(
            (r) =>
              r.dataset['row'] === 'creatures' || r.dataset['row'] === 'lands',
          );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.dataset['orientation']).toBe('horizontal');
        }
        // Artifact zone for top/bottom is the perpendicular column,
        // so its inner row uses VERTICAL orientation.
        const artifactRow = screen
          .getAllByTestId('battlefield-row')
          .find((r) => r.dataset['row'] === 'artifacts');
        expect(artifactRow?.dataset['orientation']).toBe('vertical');
      },
    );

    it.each(POSITIONS_HORIZONTAL_PODS)(
      '%s pod uses VERTICAL row orientation (cards lay top→bottom)',
      (position) => {
        const perms = [
          makePerm('Sol Ring', ['ARTIFACT']),
          makePerm('Forest', ['LAND']),
          makePerm('BearCub', ['CREATURE']),
        ];
        render(
          <PlayerArea
            player={makePlayer(perms)}
            perspective="opponent"
            position={position}
            {...PASSTHROUGH}
          />,
        );
        const rows = screen
          .getAllByTestId('battlefield-row')
          .filter(
            (r) =>
              r.dataset['row'] === 'creatures' || r.dataset['row'] === 'lands',
          );
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.dataset['orientation']).toBe('vertical');
        }
        // Layout 2026-05-03 — for left/right pods the artifact zone
        // now stacks IN the same vertical column as creatures + lands
        // (pre-fix it was a perpendicular bottom strip with cards
        // going horizontally). Inner row matches the rest of the
        // column and uses VERTICAL orientation. Driven by the user
        // direction "All zones should be stacking vertically instead
        // of horizontally for left and right player zones."
        const artifactRow = screen
          .getAllByTestId('battlefield-row')
          .find((r) => r.dataset['row'] === 'artifacts');
        expect(artifactRow?.dataset['orientation']).toBe('vertical');
      },
    );
  });

  describe('LEGACY branch regression (Tech IMP-1)', () => {
    // Slice 70-Z.1 critic Tech IMP-1 — `rowOrder` was narrowed to 2
    // rows for the redesign. The legacy branch needs to keep
    // rendering all 3 (creatures + artifacts + lands) so REDESIGN=
    // false production users don't suddenly lose visibility of
    // artifacts/enchantments/battles when this slice ships.
    it('renders artifacts row on the legacy branch (REDESIGN=false)', () => {
      flagState.redesign = false; // override beforeEach for this case
      const perms = [
        makePerm('Sol Ring', ['ARTIFACT']),
        makePerm('Forest', ['LAND']),
        makePerm('BearCub', ['CREATURE']),
      ];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          {...PASSTHROUGH}
        />,
      );
      // All three permanents must be visible on the legacy layout
      // — the artifact must NOT silently disappear.
      expect(screen.getAllByTestId('permanent')).toHaveLength(3);
      // Legacy branch has no battlefield-area or artifact-zone
      // testids — those are REDESIGN-only.
      expect(screen.queryByTestId('battlefield-area')).toBeNull();
      expect(screen.queryByTestId('artifact-zone')).toBeNull();
    });
  });

  describe('empty-state fallback', () => {
    it('shows "No permanents yet." when the entire battlefield is empty', () => {
      render(
        <PlayerArea
          player={makePlayer([])}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      expect(screen.getByText(/No permanents yet/)).toBeInTheDocument();
      // Artifact zone also absent when empty.
      expect(screen.queryByTestId('artifact-zone')).toBeNull();
      // Slice B-9-A.1 — battlefield-area wrapper now renders even
      // when empty so the variant=tabletop colored zone gradient
      // continues to apply on empty pods. The "No permanents yet"
      // placeholder is now a child INSIDE the wrapper rather than
      // a replacement for it.
      expect(screen.getByTestId('battlefield-area')).toBeInTheDocument();
    });

    it('renders the battlefield-area wrapper when at least one permanent exists', () => {
      const perms = [makePerm('Forest', ['LAND'])];
      render(
        <PlayerArea
          player={makePlayer(perms)}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      expect(screen.getByTestId('battlefield-area')).toBeInTheDocument();
      expect(screen.queryByText(/No permanents yet/)).toBeNull();
    });
  });

  // Slice 70-Z bug fix — Path to Exile / Murder / Lightning Bolt
  // (any unrestricted "target X" spell) prompts the engine to ship
  // the FULL legal-target UUID set in `targets[]`. The webclient
  // accepted clicks on opponents' creatures correctly, but it never
  // surfaced a visual affordance — opponent permanents looked
  // unclickable, so the user perceived the engine as restricting
  // targeting to their own creatures. Fix: thread eligibleTargetIds
  // from interactionMode through PlayerArea → BattlefieldRowGroup →
  // BattlefieldTile → CardFace's existing `targetableForDialog`
  // pulse. Lock both the affordance presence (legal target → pulse)
  // and absence (non-target ids → no pulse).
  describe('eligibleTargetIds → tile pulse (slice 70-Z bug fix)', () => {
    it('pulses a battlefield tile whose card.id is in eligibleTargetIds', () => {
      const target = makePerm('Quirion Sentinel', ['CREATURE']);
      const other = makePerm('Forest', ['LAND']);
      render(
        <PlayerArea
          player={makePlayer([target, other])}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
          eligibleTargetIds={new Set([target.card.id])}
        />,
      );
      // CardFace data-targetable-for-dialog only renders when the
      // prop is true; absent attribute means false. Cross-check
      // via DOM query.
      const targetTile = document.querySelector(
        `[data-permanent-id="${target.card.id}"]`,
      );
      expect(targetTile).not.toBeNull();
      const targetFace = targetTile?.querySelector(
        '[data-targetable-for-dialog="true"]',
      );
      expect(targetFace).not.toBeNull();

      const otherTile = document.querySelector(
        `[data-permanent-id="${other.card.id}"]`,
      );
      expect(
        otherTile?.querySelector('[data-targetable-for-dialog="true"]'),
      ).toBeNull();
    });

    it('pulses opponent permanents the same as own permanents', () => {
      // The bug specifically manifested as "I cannot target opponent
      // creatures" — verify the pulse appears regardless of
      // perspective. Lock the symmetry so a future regression that
      // gates the pulse on perspective gets caught here.
      const opponentCreature = makePerm("Opponent's Bear", ['CREATURE']);
      render(
        <PlayerArea
          player={makePlayer([opponentCreature])}
          perspective="opponent"
          position="top"
          {...PASSTHROUGH}
          eligibleTargetIds={new Set([opponentCreature.card.id])}
        />,
      );
      const tile = document.querySelector(
        `[data-permanent-id="${opponentCreature.card.id}"]`,
      );
      expect(tile?.querySelector('[data-targetable-for-dialog="true"]'))
        .not.toBeNull();
    });

    it('renders no pulse when eligibleTargetIds is empty (default)', () => {
      const perm = makePerm('BearCub', ['CREATURE']);
      render(
        <PlayerArea
          player={makePlayer([perm])}
          perspective="self"
          position="bottom"
          {...PASSTHROUGH}
        />,
      );
      const tile = document.querySelector(
        `[data-permanent-id="${perm.card.id}"]`,
      );
      expect(tile?.querySelector('[data-targetable-for-dialog="true"]'))
        .toBeNull();
    });
  });
});
