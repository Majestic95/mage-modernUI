/**
 * Slice B-13-B (refined in B-13-B.1) — three-bucket layout for the
 * tabletop variant's battlefield content area (element #4 of
 * variant-tabletop.md).
 *
 * <p>Each pod's colored zone subdivides into three bucket boxes
 * arranged along the pod's LONG axis (mirrors the per-pod cluster
 * orientation rule from element #6):
 * <ul>
 *   <li><b>TOP / BOTTOM pods</b> (horizontal-layout pods): buckets
 *       stack <i>horizontally</i> (left-to-right). Each bucket is a
 *       vertical column within the wide pod.</li>
 *   <li><b>LEFT / RIGHT pods</b> (vertical-layout pods): buckets
 *       stack <i>vertically</i> (top-to-bottom). Each bucket is a
 *       horizontal strip within the tall pod.</li>
 * </ul>
 *
 * <p>Size ratios are uniform across orientations:
 * <ul>
 *   <li><b>Lands</b> — 25%</li>
 *   <li><b>Creatures</b> — 50% (largest; contains Creatures +
 *       Planeswalkers)</li>
 *   <li><b>Artifacts &amp; Enchantments</b> — 25% (incl Battles)</li>
 * </ul>
 *
 * <p>Bucket boxes are FIXED-SIZE — they don't shrink/expand based on
 * how many cards they hold. This enforces tabletop's load-bearing
 * rule T1 ("zones are fixed dimensional anchors; cards inside
 * adapt"). Cards adapt via the shrink → stack → scroll sequence
 * (element #11), which lands in slice B-13-C.
 *
 * <p>Empty buckets render with a faint label inside the empty
 * colored region (per user direction during element #6 walkthrough:
 * "labels can be visible for empty bucket zones").
 *
 * <p>This slice (B-13-B + B-13-B.1) ships the bucket SHELL only —
 * orientation-aware layout + labels + fixed sizes are visible;
 * card rendering inside each bucket is deferred to B-13-C.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { motion } from 'framer-motion';
import type { PlayerAreaPosition } from './PlayerArea';
import type { TabletopBuckets as TabletopBucketsData } from './tabletopBattlefieldLayout';
import type { WebCardView, WebPermanentView } from '../api/schemas';
import { ZoneBrowser } from './ZoneBrowser';
import { groupWithAttachmentsAndStacks } from './battlefieldRows';
import { computePodCardSizeVars } from './podShrink';
import {
  BucketCardsRow,
  DuplicateStackContainer,
  TabletopCardButton,
  type BucketKind,
} from './tabletopBucketStacking';

const BUCKET_LABELS: Record<BucketKind, string> = {
  lands: 'Lands',
  creatures: 'Creatures',
  artifactsEnchantments: 'Artifacts & Enchantments',
};

// Polish-pass P11 (audit nice-to-have #13, 2026-05-03) — bucket
// border tinted by commander color identity at ~30% alpha so the
// "whose pod is this" wayfinding signal returns without re-flooding
// the zones with color (the user's earlier "remove the colors under
// each zone" directive stands). First color of identity wins for
// multi-color; empty identity falls back to a neutral gold.
const COLOR_TINT_RGBA: Record<string, string> = {
  W: 'rgba(255, 245, 205, 0.45)',
  U: 'rgba(150, 190, 235, 0.45)',
  B: 'rgba(180, 160, 200, 0.45)',
  R: 'rgba(225, 140, 140, 0.45)',
  G: 'rgba(150, 200, 150, 0.45)',
};
const COLORLESS_TINT_RGBA = 'rgba(245, 230, 180, 0.35)';

function tintForIdentity(colorIdentity: readonly string[]): string {
  if (colorIdentity.length === 0) return COLORLESS_TINT_RGBA;
  const first = colorIdentity[0]!;
  return COLOR_TINT_RGBA[first] ?? COLORLESS_TINT_RGBA;
}

export function TabletopBuckets({
  buckets,
  position,
  playerName,
  colorIdentity,
  canAct = false,
  onObjectClick,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
  colorIdentityByPlayerName,
}: {
  buckets: TabletopBucketsData;
  position: PlayerAreaPosition;
  playerName: string;
  colorIdentity: readonly string[];
  // G4 (2026-05-03) — click + combat affordance threading. Optional
  // so existing test renders that don't care about live-game
  // behavior keep working.
  canAct?: boolean;
  onObjectClick?: (id: string) => void;
  eligibleTargetIds?: ReadonlySet<string>;
  eligibleCombatIds?: ReadonlySet<string>;
  combatRoles?: ReadonlyMap<string, 'attacker' | 'blocker'>;
  // Slice 4-B — controller-name → commander color identity lookup
  // for the per-creature outer halo. Threaded from Battlefield.tsx
  // through PlayerArea. Optional to preserve existing test renders.
  // `| undefined` widens for `exactOptionalPropertyTypes:true` —
  // PlayerArea always passes the prop (which itself may be
  // undefined) rather than conditionally omitting it.
  colorIdentityByPlayerName?: ReadonlyMap<string, readonly string[]> | undefined;
}) {
  const tint = tintForIdentity(colorIdentity);
  // Buckets stack along the pod's LONG axis. Top/bottom pods are
  // wide-horizontal so buckets line up left-to-right (flex-row).
  // Left/right pods are tall-vertical so buckets stack top-to-
  // bottom (flex-col). Same percentage size ratios in either case.
  const isHorizontalArrangement = position === 'top' || position === 'bottom';
  const flexDirClass = isHorizontalArrangement
    ? 'flex flex-row'
    : 'flex flex-col';
  // User direction (2026-05-03) — clicking a bucket label opens a
  // ZoneBrowser modal listing every card in that bucket at full
  // size. Solves overcrowding once buckets stack 20+ cards. Only
  // one modal is open per pod at a time (state lifted here).
  const [openKind, setOpenKind] = useState<BucketKind | null>(null);
  const openCards: readonly WebPermanentView[] =
    openKind === null ? [] : buckets[openKind];
  return (
    <div
      data-testid="tabletop-buckets"
      data-bucket-orientation={isHorizontalArrangement ? 'horizontal' : 'vertical'}
      className={`${flexDirClass} h-full w-full gap-1 min-h-0 min-w-0`}
    >
      <BucketBox
        kind="lands"
        label={BUCKET_LABELS.lands}
        cards={buckets.lands}
        flexBasis="25%"
        onOpen={() => setOpenKind('lands')}
        borderTint={tint}
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
        colorIdentityByPlayerName={colorIdentityByPlayerName}
      />
      <BucketBox
        kind="creatures"
        label={BUCKET_LABELS.creatures}
        cards={buckets.creatures}
        flexBasis="50%"
        onOpen={() => setOpenKind('creatures')}
        borderTint={tint}
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
        colorIdentityByPlayerName={colorIdentityByPlayerName}
      />
      <BucketBox
        kind="artifactsEnchantments"
        label={BUCKET_LABELS.artifactsEnchantments}
        cards={buckets.artifactsEnchantments}
        flexBasis="25%"
        onOpen={() => setOpenKind('artifactsEnchantments')}
        borderTint={tint}
        canAct={canAct}
        onObjectClick={onObjectClick}
        eligibleTargetIds={eligibleTargetIds}
        eligibleCombatIds={eligibleCombatIds}
        combatRoles={combatRoles}
        colorIdentityByPlayerName={colorIdentityByPlayerName}
      />
      {openKind !== null && (
        <ZoneBrowser
          title={`${playerName} — ${BUCKET_LABELS[openKind]}`}
          cards={projectPermsToCards(openCards)}
          onClose={() => setOpenKind(null)}
        />
      )}
    </div>
  );
}

// Permanents carry tap / counters / attachments state that ZoneBrowser
// doesn't render today. For "browse what's in this bucket" the .card
// projection is sufficient — full Scryfall art renders + hover-detail
// works. Live perm-state inside the modal is a follow-up if requested.
function projectPermsToCards(
  perms: readonly WebPermanentView[],
): Record<string, WebCardView> {
  const out: Record<string, WebCardView> = {};
  for (const p of perms) out[p.card.id] = p.card;
  return out;
}

function BucketBox({
  kind,
  label,
  cards,
  flexBasis,
  onOpen,
  borderTint,
  canAct,
  onObjectClick,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
  colorIdentityByPlayerName,
}: {
  kind: BucketKind;
  label: string;
  cards: readonly WebPermanentView[];
  flexBasis: string;
  onOpen: () => void;
  borderTint: string;
  canAct: boolean;
  onObjectClick: ((id: string) => void) | undefined;
  eligibleTargetIds: ReadonlySet<string> | undefined;
  eligibleCombatIds: ReadonlySet<string> | undefined;
  combatRoles: ReadonlyMap<string, 'attacker' | 'blocker'> | undefined;
  colorIdentityByPlayerName: ReadonlyMap<string, readonly string[]> | undefined;
}) {
  // Fixed flex-basis pinned to the percentage; flex-grow:0 +
  // flex-shrink:0 lock the bucket to that height regardless of
  // content (T1 compliance).
  const count = cards.length;
  // 2026-05-04 — per-bucket shrink (was per-pod). Group identical
  // cards into ×N stacks once here so we can both (a) iterate the
  // groups in JSX and (b) drive shrink off the visible-card count,
  // not the raw permanent count. Without grouping, 10 basic lands
  // would count as 10 perms and trigger a shrink on the WHOLE pod
  // even though they collapse to a single host card with a `×10`
  // badge in the rendered row. Per-bucket shrink keeps each zone's
  // adaptation independent (per the user's mental model: cards
  // shrink only when THEIR zone is too crowded, not because a
  // sibling zone is full).
  const groupedCards = useMemo(
    () => groupWithAttachmentsAndStacks(cards as WebPermanentView[]),
    [cards],
  );
  const visibleCount = groupedCards.length;
  const bucketSizeVars: CSSProperties =
    computePodCardSizeVars(visibleCount) ?? {};
  return (
    <div
      data-testid={`tabletop-bucket-${kind}`}
      data-bucket-kind={kind}
      data-card-count={count}
      data-visible-card-count={visibleCount}
      // Slice B-13-E — visual tuning. Border bumped from
      // border-zinc-700/50 (very dim) → border-zinc-500/70 so the
      // bucket boundaries read clearly against the colored zone.
      // Dropped the bucket's own bg-zinc-900/30 so the underlying
      // commander-identity gradient shows through (eliminates a
      // dim-overlay-on-color muddying the zone color).
      className="flex-shrink-0 flex-grow-0 min-h-0 min-w-0 relative rounded border overflow-hidden"
      style={{ flexBasis, borderColor: borderTint, ...bucketSizeVars }}
    >
      {/* Label is a click target — opens a ZoneBrowser modal listing
          every card in this bucket at full size (user direction
          2026-05-03: "solves overcrowding in zones"). Hover ring +
          pointer cursor telegraph the affordance. Empty buckets stay
          clickable so the user can see "yep, nothing here."
          Polish-pass P7 (audit should-close #7) — bumped from
          text-[10px] to text-xs + px-1.5 py-0.5 for discoverability. */}
      <button
        type="button"
        data-testid={`tabletop-bucket-${kind}-label`}
        onClick={onOpen}
        aria-label={`Open ${label} (${count} card${count === 1 ? '' : 's'})`}
        className={
          'absolute top-1 left-2 z-20 text-xs uppercase tracking-wider font-semibold ' +
          'rounded px-1.5 py-0.5 cursor-pointer ' +
          'hover:bg-zinc-800/70 hover:text-zinc-100 transition-colors ' +
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400 ' +
          (count === 0 ? 'text-zinc-400' : 'text-zinc-500/70')
        }
      >
        {label}
      </button>
      {/* Polish-pass P7 (audit should-close #8) — empty-bucket
          ghost label centered inside the bucket interior so the
          geometry reads even at zero permanents. Pointer-events
          none so it never intercepts the corner-label click. */}
      {count === 0 && (
        <span
          data-testid={`tabletop-bucket-${kind}-empty-ghost`}
          className="absolute inset-0 flex items-center justify-center text-sm italic text-zinc-600/40 pointer-events-none select-none"
        >
          {label}
        </span>
      )}
      {/* FB#10 (2026-05-05) — adaptation chain rewrite:
          shrink → wrap → vertical-scroll. The prior gap-vs-peek
          toggle is gone (FB#6); BucketCardsRow now always uses
          flex-wrap. T1 ✓ — bucket footprint unchanged; cards
          adapt within (wrap onto next row, then scroll vertically).
          F5 — identical perms still group via groupWithAttachmentsAndStacks
          but stacks now render as N click-through cards with a 16px
          peek offset (DuplicateStackContainer) so each copy is
          selectable individually (declare-blockers with N tokens,
          pick which Forest taps for mana). F16 — attachment fan-out
          path preserved: hosts with attached auras/equipment render
          fan layers behind the host (mutually exclusive with
          duplicates per stackKey rule). */}
      {count > 0 && (
        <BucketCardsRow kind={kind}>
          {groupedCards.map((group) => {
            const p = group.host;
            const hasDuplicates = group.stackedDuplicates.length > 0;
            const hasAttachments = group.attachments.length > 0;
            const layoutId = p.card.cardId || undefined;

            // Branch 1: duplicates-only path (most common for stacked
            // basic lands and tokens). DuplicateStackContainer renders
            // host + each duplicate as independently clickable.
            if (hasDuplicates) {
              return (
                <DuplicateStackContainer
                  key={p.card.id}
                  host={p}
                  duplicates={group.stackedDuplicates}
                  hostLayoutId={layoutId}
                  canAct={canAct}
                  onObjectClick={onObjectClick}
                  eligibleTargetIds={eligibleTargetIds}
                  eligibleCombatIds={eligibleCombatIds}
                  combatRoles={combatRoles}
                  colorIdentityByPlayerName={colorIdentityByPlayerName}
                />
              );
            }

            // Branch 2: attachment fan-out (host + auras/equipment).
            // Mutually exclusive with duplicates per stackKey rule.
            // F16 — auras fan out to the right at 30% peek each;
            // z-index descends so host stays on top, rightmost
            // attachment at the bottom of the local stack.
            const FAN_OFFSET = 0.3;
            const fanCount = group.attachments.length;
            const baseW = 'var(--card-size-medium, 80px)';
            const heightCalc = 'calc(var(--card-size-medium, 80px) * 7 / 5)';
            const containerWidth = hasAttachments
              ? `calc(${baseW} * (1 + ${fanCount} * ${FAN_OFFSET}))`
              : baseW;
            const hostZ = fanCount + 1;
            const inCombatMode = (eligibleCombatIds?.size ?? 0) > 0;
            const isEligibleTarget = eligibleTargetIds?.has(p.card.id) ?? false;
            const isEligibleCombat = eligibleCombatIds?.has(p.card.id) ?? false;
            const combatRole = combatRoles?.get(p.card.id) ?? null;
            const clickable =
              canAct &&
              !!onObjectClick &&
              (!inCombatMode || isEligibleCombat);
            return (
              <motion.div
                key={p.card.id}
                layout
                data-layout-id={layoutId}
                data-card-id={p.card.cardId || undefined}
                data-attachment-host={hasAttachments || undefined}
                {...(layoutId ? { layoutId } : {})}
                data-attachment-count={
                  hasAttachments ? group.attachments.length : undefined
                }
                className="relative"
                style={{
                  width: containerWidth,
                  height: heightCalc,
                  flexShrink: 0,
                }}
              >
                <div
                  className="absolute top-0 left-0 flex"
                  style={{ width: baseW, height: heightCalc, zIndex: hostZ }}
                >
                  <TabletopCardButton
                    perm={p}
                    clickable={clickable}
                    onObjectClick={onObjectClick}
                    isEligibleTarget={isEligibleTarget}
                    isEligibleCombat={isEligibleCombat}
                    combatRole={combatRole}
                    controllerColorIdentity={colorIdentityByPlayerName?.get(
                      p.controllerName,
                    )}
                  />
                </div>
                {group.attachments.map((att, idx) => {
                  const attEligibleTarget =
                    eligibleTargetIds?.has(att.card.id) ?? false;
                  const attEligibleCombat =
                    eligibleCombatIds?.has(att.card.id) ?? false;
                  const attClickable =
                    canAct &&
                    !!onObjectClick &&
                    (!inCombatMode || attEligibleCombat);
                  return (
                    <div
                      key={att.card.id}
                      data-attachment-of={p.card.id}
                      data-card-id={att.card.cardId || undefined}
                      className="absolute top-0 flex"
                      style={{
                        left: `calc(${baseW} * ${FAN_OFFSET} * ${idx + 1})`,
                        width: baseW,
                        height: heightCalc,
                        zIndex: hostZ - 1 - idx,
                      }}
                    >
                      <TabletopCardButton
                        perm={att}
                        clickable={attClickable}
                        onObjectClick={onObjectClick}
                        isEligibleTarget={attEligibleTarget}
                        isEligibleCombat={attEligibleCombat}
                        combatRole={null}
                        controllerColorIdentity={colorIdentityByPlayerName?.get(
                          att.controllerName,
                        )}
                      />
                    </div>
                  );
                })}
              </motion.div>
            );
          })}
        </BucketCardsRow>
      )}
    </div>
  );
}
