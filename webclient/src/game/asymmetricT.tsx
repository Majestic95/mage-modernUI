import { useMemo, useState, type CSSProperties } from 'react';
import type { WebGameView, WebPlayerView, WebPermanentView } from '../api/schemas';
import type { InteractionMode } from './interactionMode';
import type { DragState } from './useDragState';
import { StackZone } from './StackZone';
import { PlayerArea } from './PlayerArea';
import { PlayerFrame } from './PlayerFrame';
import { BattlefieldRowGroup } from './BattlefieldRowGroup';
import { bucketBattlefield } from './battlefieldRows';
import { hasAnyMana } from './manaPoolUtil';
import { ManaPool } from './ManaPool';
import type { ManaOrbColor } from './ManaOrb';
import { REDESIGN } from '../featureFlags';

/**
 * 2026-05-03 (user direction) — active-player lane spotlight. The
 * lane of the player whose turn it is gets the focal-card-style
 * effect: a white-and-gold gradient with a sharp gold streak that
 * rotates around the perimeter, a soft bloom that rotates in
 * lockstep with it, and a breathing opacity pulse layered on top.
 * Inactive opponent lanes have NO halo at all (was: a constant
 * static white border + soft glow on every lane).
 *
 * <p>Why both layers share `var(--halo-angle)`: the parent
 * component owns the rotation animation (animates the registered
 * `@property --halo-angle`) and both children inherit the var via
 * the cascade, so the streak and the bloom can never drift out of
 * sync — there's literally one source of truth for the angle.
 */
const SPOTLIGHT_GRADIENT =
  'conic-gradient(from var(--halo-angle, 0deg), ' +
  'transparent 0deg, ' +
  'rgba(255, 240, 180, 0.95) 35deg, ' +
  'rgba(255, 215, 100, 1.0) 70deg, ' +
  'rgba(255, 240, 180, 0.95) 105deg, ' +
  'transparent 140deg, ' +
  'transparent 360deg)';

function LaneSpotlightHalo() {
  // Two mask-carved perimeter rings, BOTH constrained to the lane's
  // edge — never the interior. The single source of truth for
  // rotation is the parent: it owns `animate-lane-spotlight`
  // (rotates `--halo-angle`, plus `halo-breathe` for the pulse), so
  // both children read `var(--halo-angle)` from the cascade and can
  // never drift. The pair:
  //   1. Bloom — a wider ring with a blur filter for soft outward
  //      glow. Mask-carved so the BLUR effect is also limited to
  //      the perimeter — earlier iterations used `drop-shadow` which
  //      paints AROUND the carved ring AT ITS STACKING POSITION,
  //      reaching inward far enough to obscure the opponent's
  //      portrait at high intensity. With the bloom mask-carved
  //      itself, the soft glow is physically confined to the ring.
  //   2. Streak — a thin 3px ring with no blur for the sharp gold
  //      sweep that reads as the foreground spotlight.
  //
  // The composite reads as: a bright gold streak rotating around
  // the lane edge, surrounded by a soft golden halo that follows
  // it in lockstep, breathing in and out.
  const mask =
    'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)';
  return (
    <div
      data-testid="lane-spotlight-halo"
      aria-hidden="true"
      className="animate-lane-spotlight absolute -inset-[6px] rounded-md pointer-events-none"
    >
      {/* Bloom ring — same gradient + var(--halo-angle), wider
          ring (padding 9px) with blur, opacity 0.85 for visibility. */}
      <div
        data-testid="lane-spotlight-bloom"
        aria-hidden="true"
        className="absolute inset-0 rounded-md"
        style={{
          background: SPOTLIGHT_GRADIENT,
          WebkitMask: mask,
          WebkitMaskComposite: 'xor',
          mask: mask,
          maskComposite: 'exclude',
          padding: '9px',
          filter: 'blur(6px)',
          opacity: 0.85,
        }}
      />
      {/* Sharp streak — 3px ring at the lane edge proper. */}
      <div
        data-testid="lane-spotlight-streak"
        aria-hidden="true"
        className="absolute inset-1 rounded-md"
        style={{
          background: SPOTLIGHT_GRADIENT,
          WebkitMask: mask,
          WebkitMaskComposite: 'xor',
          mask: mask,
          maskComposite: 'exclude',
          padding: '3px',
        }}
      />
    </div>
  );
}

/* =====================================================================
 * 2026-05-03 — Asymmetric T layout (Slices 1 / 2 / 3 / 4).
 *
 * Top 55% of the battlefield viewport holds three opponent LANES,
 * each laid out horizontally with a fixed 140px identity gutter on
 * the left and a battlefield region (Lands top, Non-Land bottom) on
 * the right. Bottom 45% holds the local pod with three sub-rows
 * (Creatures / Artifacts+Enchants / Lands) at full viewport width.
 *
 * Click any lane gutter to FOCUS that opponent — focused lane
 * expands to fill the entire top 55%, the other two collapse to
 * 40px portrait strips that summarise name + life. Click the focused
 * lane's gutter again (or its × button) to return all three lanes
 * to equal share.
 *
 * Boxes are static (zone wrappers never resize/move/wrap/warp). Cards
 * inside a zone use the existing pile-stack + flex-wrap behavior
 * provided by BattlefieldRowGroup; this layout owns the OUTER shell
 * only. Stack overlay floats at viewport center between the two halves
 * so it does not compete with player regions for layout space.
 * ===================================================================*/
export function AsymmetricTLayout({
  me,
  opponents,
  stack,
  combat,
  canAct,
  onObjectClick,
  onSpendMana,
  onBoardDrop,
  drag,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
}: {
  me: WebPlayerView | null;
  opponents: WebPlayerView[];
  stack: WebGameView['stack'];
  combat: WebGameView['combat'];
  mode: InteractionMode;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  /**
   * 2026-05-03 — click-to-spend handler for the floating local mana
   * pool that mounts next to the local portrait. {@code null} when
   * no stream is connected, in which case orbs render as
   * non-interactive display elements.
   */
  onSpendMana: ((color: ManaOrbColor) => void) | null;
  onBoardDrop: () => void;
  drag: DragState | null;
  eligibleTargetIds: Set<string>;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  // Slice 4 — focused opponent state. null = no focus (all 3 lanes
  // share top 55% equally). Set to a playerId to expand that lane
  // and collapse the others to 40px portrait strips.
  const [focusedOpponentId, setFocusedOpponentId] = useState<string | null>(null);

  // Pad up to 3 lane slots so the grid template stays predictable
  // even at 1v1 or 3p (empty slots render placeholder chrome).
  const laneSlots = useMemo<Array<WebPlayerView | null>>(
    () => [opponents[0] ?? null, opponents[1] ?? null, opponents[2] ?? null],
    [opponents],
  );

  // If the focused opponent leaves the table, reset focus so a
  // collapsed-strip layout doesn't outlive the seat it was built for.
  if (focusedOpponentId && !laneSlots.some((p) => p?.playerId === focusedOpponentId)) {
    setFocusedOpponentId(null);
  }

  const lanesGridRows = focusedOpponentId
    ? laneSlots
        .map((opp) => (opp?.playerId === focusedOpponentId ? '1fr' : '40px'))
        .join(' ')
    : '1fr 1fr 1fr';

  const onLaneFocus = (id: string) => {
    setFocusedOpponentId((prev) => (prev === id ? null : id));
  };

  return (
    <div
      data-testid="asymmetric-t-layout"
      className="flex-1 min-h-0 grid relative overflow-hidden"
      style={{ gridTemplateRows: '55% 45%', gridTemplateColumns: '1fr' }}
    >
      <div
        data-testid="opponent-lanes"
        className="relative grid min-h-0 min-w-0 overflow-hidden"
        style={{ gridTemplateRows: lanesGridRows, gap: '4px', padding: '4px' }}
      >
        {laneSlots.map((opp, idx) => (
          <OpponentLane
            key={opp?.playerId ?? `empty-${idx}`}
            opponent={opp}
            laneIndex={idx}
            collapsed={focusedOpponentId != null && opp?.playerId !== focusedOpponentId}
            focused={opp?.playerId === focusedOpponentId}
            onFocus={() => opp && onLaneFocus(opp.playerId)}
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        ))}
      </div>

      <div
        data-testid="local-pod"
        className="relative min-h-0 min-w-0 overflow-hidden"
        style={{ padding: '4px', paddingBottom: '14rem' }}
      >
        {me ? (
          <LocalPod
            me={me}
            canAct={canAct}
            onObjectClick={onObjectClick}
            onBoardDrop={onBoardDrop}
            drag={drag}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        ) : (
          <p className="text-zinc-500 italic">Spectator view — no controlling player.</p>
        )}
      </div>

      {/* Stack dock — anchored to the top of the local pod (bottom
          edge at the 55% seam, panel extending UPWARD into the
          opponent rail). Wrapped in a translucent backdrop-blurred
          panel so the focal card reads clearly without fully
          obscuring whatever opponent row sits behind it. Only
          renders when the stack is non-empty; collapses to nothing
          otherwise so the local pod's first row never has reserved
          dead space.

          Combat arrows render separately as a full-viewport overlay
          (below) — they need to span attacker pod → defender pod
          and would lose meaning confined to the dock. */}
      {Object.keys(stack).length > 0 && (
        <div
          data-testid="stack-dock"
          className="absolute left-1/2 pointer-events-auto"
          style={{
            top: '55%',
            transform: 'translate(-50%, -100%)',
            zIndex: 10,
          }}
        >
          <div className="rounded-lg border border-zinc-700/60 bg-zinc-900/85 backdrop-blur-md px-4 py-3 shadow-2xl">
            <StackZone stack={stack} combat={combat} />
          </div>
        </div>
      )}
      {Object.keys(stack).length === 0 && combat.length > 0 && (
        <div
          data-testid="central-focal-zone"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ zIndex: 5 }}
        >
          <div className="pointer-events-auto">
            <StackZone stack={stack} combat={combat} />
          </div>
        </div>
      )}

      {/* Floating local mana pool — sits to the RIGHT of the local
          portrait, stacked VERTICALLY (user direction 2026-05-03).
          Earlier iterations parked the pool above the portrait
          (right-32, calc(3rem+11rem)) but that put a horizontal row
          on top of the portrait stack. With 5 colors a horizontal
          row would crowd into the player's name / chip cluster; a
          vertical column slots cleanly into the gap between the
          portrait and the side panel.
          Position: bottom-12 matches the local-player-frame-corner's
          vertical anchor so the orbs share its baseline; right-4
          tucks them just inside the asymmetric T container's right
          edge (the side panel sits OUTSIDE this container so there's
          no risk of overlap with COMMANDER DAMAGE / Next Phase). z-40
          matches the corner so both render on the same layer.
          Renders only when the pool has mana (catalog §2.3 "Empty
          pool: Don't render anything"). */}
      {REDESIGN && me && hasAnyMana(me.manaPool) && (
        <div
          data-testid="local-mana-pool-floating"
          className="absolute right-4 bottom-12 z-40 pointer-events-auto"
        >
          <ManaPool
            player={me}
            size="medium"
            glow
            layout="vertical"
            onSpend={onSpendMana ?? undefined}
          />
        </div>
      )}

      {/* Local PlayerFrame mounts at the corner via the existing
          REDESIGN slotPart='frame' channel so chips stay glanceable
          and z-40 stays above the hand wrapper. */}
      {REDESIGN && me && (
        <div
          data-testid="local-player-frame-corner"
          // 2026-05-03 — shifted right-10 → right-32 so the
          // horizontal chip cluster (Lib / Hand / Grave / Exile),
          // which is centered absolutely beneath the portrait, has
          // enough clearance from the battlefield's right edge to
          // render fully without being clipped by overflow-hidden /
          // hidden behind the side-panel boundary. The Exile chip
          // was previously partially obscured, breaking the always-
          // accessible-zones contract.
          className="absolute bottom-12 right-32 z-40 pointer-events-auto"
        >
          <PlayerArea
            player={me}
            perspective="self"
            position="bottom"
            slotPart="frame"
            canAct={canAct}
            onObjectClick={onObjectClick}
            targetable={eligibleTargetIds.has(me.playerId)}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
            isDropTarget={false}
            onBoardDrop={onBoardDrop}
            tabIndex={9}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------
 * OpponentLane — one horizontal lane: identity gutter on the left,
 * battlefield zones on the right (Lands top, Non-Land bottom).
 * Empty seat → dashed placeholder. Collapsed (slice 4) → 40px
 * portrait strip with name + life.
 * -------------------------------------------------------------------*/
function OpponentLane({
  opponent,
  laneIndex,
  collapsed,
  focused,
  onFocus,
  canAct,
  onObjectClick,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
}: {
  opponent: WebPlayerView | null;
  laneIndex: number;
  collapsed: boolean;
  focused: boolean;
  onFocus: () => void;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleTargetIds: Set<string>;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  if (!opponent) {
    return (
      <div
        data-testid={`opponent-lane-${laneIndex}`}
        data-empty="true"
        className="rounded-md border border-dashed border-zinc-800/60 bg-zinc-950/40 flex items-center justify-center overflow-hidden min-h-0 min-w-0"
      >
        <span className="text-[10px] uppercase tracking-wider text-zinc-700">
          Empty seat
        </span>
      </div>
    );
  }

  // Active-player turn signal — the active lane gets the LaneSpotlightHalo
  // overlay (rotating gold streak + co-rotating bloom + breathing
  // pulse, mounted as the first child below). Inactive lanes render
  // with no halo at all (was: static white border + soft glow on every
  // lane, replaced 2026-05-03 per user direction).
  const isActive = opponent.isActive;

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid={`opponent-lane-${laneIndex}`}
        data-player-id={opponent.playerId}
        data-collapsed="true"
        data-active={isActive || undefined}
        onClick={onFocus}
        className="relative rounded border border-zinc-800/60 bg-zinc-900/40 flex items-center gap-3 px-3 hover:bg-zinc-900/70 transition-colors text-left min-h-0 min-w-0 overflow-hidden"
      >
        {isActive && <LaneSpotlightHalo />}
        <span className="text-xs font-semibold text-zinc-200">{opponent.name}</span>
        <span className="text-xs text-zinc-400">{opponent.life} life</span>
        <span className="ml-auto text-[10px] text-zinc-500 italic">
          click to expand
        </span>
      </button>
    );
  }

  const battlefield = Object.values(opponent.battlefield);
  const rows = bucketBattlefield(battlefield);

  return (
    <div
      data-testid={`opponent-lane-${laneIndex}`}
      data-player-id={opponent.playerId}
      data-focused={focused || undefined}
      data-active={isActive || undefined}
      className="relative rounded-md border border-zinc-800/60 bg-zinc-900/30 flex min-h-0 min-w-0 overflow-hidden"
    >
      {isActive && <LaneSpotlightHalo />}
      <div
        data-testid={`opponent-lane-${laneIndex}-gutter`}
        // 2026-05-03 — gutter width 170px. Earlier 120px clipped
        // the Grave + Exile chip buttons (each chip is "Grave [N]"
        // ≈ 70px wide; two side-by-side with gap-2 + padding needs
        // ~166px). 170px fits both buttons fully and leaves ~4px
        // breathing room. items-center keeps the portrait stack +
        // chip cluster horizontally centered in the gutter rather
        // than pinned to the left edge.
        //
        // 2026-05-03 (user direction) — nothing overflows outside
        // its zone. `min-h-0 overflow-hidden` keeps the portrait
        // stack + name + chip cluster clipped to this gutter's
        // share of the lane row even on short viewports, so the
        // gutter never bleeds into the lane below or visually
        // crowds the battlefield's sub-rows on the right.
        className="flex-shrink-0 w-[170px] min-h-0 flex flex-col items-center p-2 border-r border-zinc-800/60 relative overflow-hidden"
      >
        <button
          type="button"
          aria-label={focused ? 'Unfocus this opponent' : 'Focus this opponent'}
          data-testid={`opponent-lane-${laneIndex}-focus`}
          onClick={onFocus}
          className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded text-[10px] bg-zinc-800/60 hover:bg-zinc-700 text-zinc-300"
        >
          {focused ? '×' : '⤢'}
        </button>
        <PlayerFrame
          player={opponent}
          perspective="opponent"
          position="left"
          chipsLayout="vertical"
          onPlayerClick={onObjectClick}
          targetable={eligibleTargetIds.has(opponent.playerId)}
          eligibleTargetIds={eligibleTargetIds}
          canAct={canAct}
          onObjectClick={onObjectClick}
        />
      </div>

      {/* Two sub-rows. Lands fill the top row (full width). Bottom
          row is a 50/50 horizontal split: Creatures on the left,
          Artifacts & Enchants on the right. Avoids adding a third
          row (which would shrink each row's height too far on a
          1080p viewport) while still giving artifacts their own
          dedicated zone — opponent's mana, threats, and value
          engines are each glanceable without overlap. */}
      <div
        data-testid={`opponent-lane-${laneIndex}-battlefield`}
        className="flex-1 flex flex-col min-w-0 min-h-0 gap-2 p-2 overflow-hidden"
      >
        <SubRowZone
          label="Lands"
          zone="lands"
          row="lands"
          permanents={rows.lands}
          perspective="opponent"
          canAct={canAct}
          onObjectClick={onObjectClick}
          eligibleTargetIds={eligibleTargetIds}
          eligibleCombatIds={eligibleCombatIds}
          combatRoles={combatRoles}
        />
        <div className="flex-1 flex flex-row gap-2 min-h-0 min-w-0 overflow-hidden">
          <SubRowZone
            label="Creatures"
            zone="creatures"
            row="creatures"
            permanents={rows.creatures}
            perspective="opponent"
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
          <SubRowZone
            label="Artifacts & Enchants"
            zone="artifacts"
            row="artifacts"
            permanents={rows.artifacts}
            perspective="opponent"
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------
 * LocalPod — bottom 45% region. Three horizontal sub-rows at full
 * width: Creatures (top, facing the focal zone), Artifacts &
 * Enchants (middle), Lands (bottom, closest to the player edge).
 * The local PlayerFrame still mounts at the corner via the
 * AsymmetricTLayout's slotPart='frame' channel — this component owns
 * battlefield rows only. Drop-target ring decorates the whole pod
 * when a hand drag is in flight.
 * -------------------------------------------------------------------*/
function LocalPod({
  me,
  canAct,
  onObjectClick,
  onBoardDrop,
  drag,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
}: {
  me: WebPlayerView;
  canAct: boolean;
  onObjectClick: (id: string) => void;
  onBoardDrop: () => void;
  drag: DragState | null;
  eligibleTargetIds: Set<string>;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
}) {
  const battlefield = Object.values(me.battlefield);
  const rows = bucketBattlefield(battlefield);
  const isDropTarget = drag != null;
  const isActive = me.isActive;

  return (
    <div
      data-testid="local-pod-rows"
      data-droppable="board"
      data-drop-target={isDropTarget || undefined}
      data-active={isActive || undefined}
      onPointerUp={onBoardDrop}
      // 2026-05-03 — local pod no longer renders the white halo /
      // active-glow that opponent lanes carry (user direction).
      // Opponent lanes still need the halo to delineate seats; the
      // local player has the floating portrait + mana pool + hand
      // fan as their identity affordances and doesn't need a frame
      // around the pod itself.
      // Drop-target ring still applies — the dashed fuchsia outline
      // tells the player where the card will land while a hand drag
      // is in flight.
      className={
        'flex flex-col gap-2 min-w-0 min-h-0 h-full p-2 transition-colors overflow-hidden ' +
        (isDropTarget
          ? 'rounded border ring-2 ring-fuchsia-500/40 outline outline-dashed outline-fuchsia-500 border-transparent'
          : '')
      }
    >
      <SubRowZone
        label="Creatures"
        zone="creatures"
        row="creatures"
        permanents={rows.creatures}
        perspective="self"
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
      />
      <SubRowZone
        label="Artifacts & Enchants"
        zone="artifacts"
        row="artifacts"
        permanents={rows.artifacts}
        perspective="self"
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
      />
      <SubRowZone
        label="Lands"
        zone="lands"
        row="lands"
        permanents={rows.lands}
        perspective="self"
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------
 * SubRowZone — one labelled static box. Wraps BattlefieldRowGroup
 * with a fixed bordered shell + corner label. Empty zones still
 * render the shell (per the static-boxes contract from the user).
 * -------------------------------------------------------------------*/
function SubRowZone({
  label,
  zone,
  row,
  permanents,
  perspective,
  canAct,
  onObjectClick,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
  style,
}: {
  label: string;
  zone: string;
  row: 'creatures' | 'artifacts' | 'lands';
  permanents: WebPermanentView[];
  perspective: 'self' | 'opponent';
  canAct: boolean;
  onObjectClick: (id: string) => void;
  eligibleTargetIds: Set<string>;
  eligibleCombatIds: Set<string>;
  combatRoles: Map<string, 'attacker' | 'blocker'>;
  style?: CSSProperties;
}) {
  return (
    <div
      data-zone={zone}
      style={style}
      className="flex-1 min-h-0 min-w-0 border border-zinc-800/30 rounded relative overflow-hidden"
    >
      <span
        // 2026-05-03 — labels read white/cream (was text-zinc-700,
        // ~#3F3F46, which faded into the panel bg and was barely
        // legible). Now text-zinc-200 (~#E4E4E7) with the existing
        // pointer-events-none + z-[1] so it stays a non-interactive
        // overlay above the cards.
        className="absolute top-0 left-1 text-[10px] uppercase tracking-wider text-zinc-200 pointer-events-none z-[1]"
        aria-hidden="true"
      >
        {label}
      </span>
      <div className="h-full w-full overflow-x-auto overflow-y-hidden">
        {permanents.length > 0 && (
          <BattlefieldRowGroup
            row={row}
            permanents={permanents}
            perspective={perspective}
            orientation="horizontal"
            canAct={canAct}
            onObjectClick={onObjectClick}
            eligibleTargetIds={eligibleTargetIds}
            eligibleCombatIds={eligibleCombatIds}
            combatRoles={combatRoles}
          />
        )}
      </div>
    </div>
  );
}
