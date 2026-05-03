import { useMemo, useState, type CSSProperties } from 'react';
import type { WebGameView, WebPlayerView, WebPermanentView } from '../api/schemas';
import type { InteractionMode } from './interactionMode';
import type { DragState } from './useDragState';
import { StackZone } from './StackZone';
import { PlayerArea } from './PlayerArea';
import { PlayerFrame } from './PlayerFrame';
import { BattlefieldRowGroup } from './BattlefieldRowGroup';
import { bucketBattlefield } from './battlefieldRows';
import { REDESIGN } from '../featureFlags';

/**
 * 2026-05-03 — uniform white halo for every player's lane. Earlier
 * iteration tried per-seat hues (cyan / amber / violet / emerald)
 * for at-a-glance delineation, but the user prefers a single
 * neutral border so commander color identity stays the only
 * meaningful color signal on the board.
 *
 * Active-player turn signal: lane border BREATHES via the
 * `animate-lane-active-glow` keyframe (1900ms period, matches the
 * portrait halo's `animate-player-active-halo` rhythm so portrait
 * + lane pulse in lockstep).
 */
const STATIC_HALO_STYLE: CSSProperties = {
  borderColor: 'rgba(255, 255, 255, 0.55)',
  boxShadow:
    '0 0 0 1px rgba(255, 255, 255, 0.30), 0 0 14px 2px rgba(255, 255, 255, 0.18)',
};

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
      className="flex-1 min-h-0 grid relative"
      style={{ gridTemplateRows: '55% 45%', gridTemplateColumns: '1fr' }}
    >
      <div
        data-testid="opponent-lanes"
        className="relative grid min-h-0 min-w-0"
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
        className="relative min-h-0 min-w-0"
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

      {/* Local PlayerFrame mounts at the corner via the existing
          REDESIGN slotPart='frame' channel so chips stay glanceable
          and z-40 stays above the hand wrapper. */}
      {REDESIGN && me && (
        <div
          data-testid="local-player-frame-corner"
          className="absolute bottom-12 right-10 z-40 pointer-events-auto"
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
        className="rounded-md border border-dashed border-zinc-800/60 bg-zinc-950/40 flex items-center justify-center"
      >
        <span className="text-[10px] uppercase tracking-wider text-zinc-700">
          Empty seat
        </span>
      </div>
    );
  }

  // Active-player turn signal — lane border breathes via CSS
  // animation while opponent.isActive is true. Class drives the
  // box-shadow keyframe (overrides the inline static halo style).
  const isActive = opponent.isActive;
  const activeAnim = isActive ? ' animate-lane-active-glow' : '';

  if (collapsed) {
    return (
      <button
        type="button"
        data-testid={`opponent-lane-${laneIndex}`}
        data-player-id={opponent.playerId}
        data-collapsed="true"
        data-active={isActive || undefined}
        onClick={onFocus}
        style={STATIC_HALO_STYLE}
        className={
          'rounded border bg-zinc-900/40 flex items-center gap-3 px-3 hover:bg-zinc-900/70 transition-colors text-left' +
          activeAnim
        }
      >
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
      style={STATIC_HALO_STYLE}
      className={
        'rounded-md border bg-zinc-900/30 flex min-h-0 min-w-0 overflow-hidden' +
        activeAnim
      }
    >
      <div
        data-testid={`opponent-lane-${laneIndex}-gutter`}
        className="flex-shrink-0 w-[140px] flex flex-col p-2 border-r border-zinc-800/60 relative"
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
        className="flex-1 flex flex-col min-w-0 min-h-0 gap-2 p-2"
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
        <div className="flex-1 flex flex-row gap-2 min-h-0 min-w-0">
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
      // Drop-target ring overrides the white halo + active glow
      // while a hand drag is in flight (the dashed fuchsia outline
      // is the higher-priority affordance — the player needs to
      // know where the card will land).
      style={isDropTarget ? undefined : { ...STATIC_HALO_STYLE, borderRadius: '0.375rem' }}
      className={
        'flex flex-col gap-2 min-w-0 min-h-0 h-full p-2 border transition-colors ' +
        (isDropTarget
          ? 'rounded ring-2 ring-fuchsia-500/40 outline outline-dashed outline-fuchsia-500 border-transparent'
          : isActive
            ? 'animate-lane-active-glow'
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
        className="absolute top-0 left-1 text-[10px] uppercase tracking-wider text-zinc-700 pointer-events-none z-[1]"
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
