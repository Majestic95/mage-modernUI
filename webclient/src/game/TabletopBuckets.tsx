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
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { PlayerAreaPosition } from './PlayerArea';
import type { TabletopBuckets as TabletopBucketsData } from './tabletopBattlefieldLayout';
import type { WebCardView, WebPermanentView } from '../api/schemas';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';
import { ZoneBrowser } from './ZoneBrowser';

const BUCKET_LABELS = {
  lands: 'Lands',
  creatures: 'Creatures',
  artifactsEnchantments: 'Artifacts & Enchantments',
} as const;

type BucketKind = keyof typeof BUCKET_LABELS;

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
}: {
  kind: 'lands' | 'creatures' | 'artifactsEnchantments';
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
}) {
  // Fixed flex-basis pinned to the percentage; flex-grow:0 +
  // flex-shrink:0 lock the bucket to that height regardless of
  // content (T1 compliance).
  const count = cards.length;
  return (
    <div
      data-testid={`tabletop-bucket-${kind}`}
      data-bucket-kind={kind}
      data-card-count={count}
      // Slice B-13-E — visual tuning. Border bumped from
      // border-zinc-700/50 (very dim) → border-zinc-500/70 so the
      // bucket boundaries read clearly against the colored zone.
      // Dropped the bucket's own bg-zinc-900/30 so the underlying
      // commander-identity gradient shows through (eliminates a
      // dim-overlay-on-color muddying the zone color).
      className="flex-shrink-0 flex-grow-0 min-h-0 min-w-0 relative rounded border overflow-hidden"
      style={{ flexBasis, borderColor: borderTint }}
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
      {/* Slice B-13-D + polish-pass P1 — peek raised from 10% to
          40% so cards inside a bucket are scannable at a glance
          (audit 2026-05-03: 10% collapsed 20 cards into unreadable
          stripes; 40% shows ~5-7 cards readably and matches the
          reference's tabletop density). margin-left: -48px = -60%
          of --card-size-medium 80px → each card after the first
          shows its leftmost 40% (32px). T1 ✓ — bucket footprint
          unchanged; cards adapt within the fixed box. */}
      {count > 0 && (
        <div
          data-testid={`tabletop-bucket-${kind}-cards`}
          // F1 (audit H4, 2026-05-04) — overflow-x-auto so cards
          // beyond the bucket's intrinsic width are reachable via
          // horizontal scroll. Spec-prescribed adaptation chain
          // (shrink → stack → scroll); scroll is the last fallback
          // when peek-stacking still overflows.
          //
          // Peek is now scaled to the active card-size token so
          // `--card-size-medium` overrides from podShrink keep a
          // proportional 40% visible-strip per card instead of a
          // hardcoded -48px that turns into 100% overlap when the
          // card itself shrinks below 48px.
          className="flex flex-row items-center h-full pl-12 pr-2 py-2 min-h-0 min-w-0 overflow-x-auto [&>*+*]:[margin-left:calc(-1*var(--card-size-medium,80px)*0.6)]"
        >
          {cards.map((p) => {
            // G3 (2026-05-03) — wrapper carries `data-permanent-id`
            // so StackZone's combat-arrow geometry resolver can find
            // the attacker's bounding rect via querySelector.
            // G4 (2026-05-03) — wrapper is now a `<button>` so each
            // card is clickable in tabletop. Forwards the click to
            // `onObjectClick`, which the click router maps to
            // tap/select/declare-attacker/etc. Mirrors what
            // BattlefieldTile does for variant=current. Combat
            // eligibility / role surface as data-* so the same CSS
            // hooks BattlefieldTile uses can apply (combat-eligible
            // pulse, attacker/blocker badge — visual treatment is
            // a follow-up slice; the data is here for it).
            const isEligibleTarget = eligibleTargetIds?.has(p.card.id) ?? false;
            const isEligibleCombat = eligibleCombatIds?.has(p.card.id) ?? false;
            const combatRole = combatRoles?.get(p.card.id);
            // F4 (audit C2, 2026-05-04) — during combat
            // (declareAttackers / declareBlockers), only cards in
            // `eligibleCombatIds` should dispatch. Without this gate
            // tabletop's lands and artifacts visibly remained clickable
            // during combat and dispatched useless onObjectClicks the
            // engine silently rejected. `eligibleCombatIds` is empty
            // outside combat, so this is a no-op for any other phase.
            const inCombatMode = (eligibleCombatIds?.size ?? 0) > 0;
            const clickable =
              canAct &&
              !!onObjectClick &&
              (!inCombatMode || isEligibleCombat);
            // G7 (2026-05-04) — wrap each tabletop bucket card with
            // a `<motion.div layoutId={p.card.cardId} layout>` so
            // Framer animates cross-zone glides into the bucket's
            // rendered position (hand → stack → bucket, etc.).
            // `cardId` is the stable cross-zone identity (per
            // schemas.ts: "For non-stack zones cardId === id;
            // stack-resolution may bump id but cardId stays put").
            // Mirrors BattlefieldRowGroup.tsx's `motion.div
            // layoutId={host.card.cardId}` pattern. Without this,
            // cards popped into the bucket without an entrance glide.
            const layoutId = p.card.cardId || undefined;
            return (
              <motion.div
                key={p.card.id}
                layout
                layoutId={layoutId}
                data-layout-id={layoutId}
                data-card-id={p.card.cardId || undefined}
                // H2 + H3 (2026-05-04) — CardFace's `battlefield` size
                // is `height: 100%` + aspect-ratio 5/7 (designed for
                // BattlefieldTile's slot which has explicit pixel
                // dimensions from row flex sizing). H2 set explicit
                // `width/height` here so CardFace had numbers to
                // resolve against; H3 fixes the missed second half:
                // making the motion.div a `display: flex` so the
                // intermediate HoverCardDetail span (inline-flex,
                // sizes-to-content by default) STRETCHES to fill the
                // motion.div's 112px height — and the button inside
                // it stretches likewise (inline-flex stretches its
                // children by default). Without `flex` here the chain
                // collapsed: motion.div=block child sizes-to-content
                // → span=intrinsic → button=intrinsic → CardFace
                // height:100% resolved against 0.
                className="flex"
                style={{
                  width: 'var(--card-size-medium, 80px)',
                  height: 'calc(var(--card-size-medium, 80px) * 7 / 5)',
                  flexShrink: 0,
                }}
              >
                <HoverCardDetail card={p.card}>
                  <button
                    type="button"
                    data-permanent-id={p.card.id}
                    data-tapped={p.tapped || undefined}
                    data-combat-eligible={isEligibleCombat || undefined}
                    data-combat-role={combatRole ?? undefined}
                    data-targetable={isEligibleTarget || undefined}
                    disabled={!clickable}
                    onClick={
                      clickable && onObjectClick
                        ? () => onObjectClick(p.card.id)
                        : undefined
                    }
                    className={
                      'block p-0 m-0 bg-transparent border-0 outline-none ' +
                      (clickable ? 'cursor-pointer' : 'cursor-default')
                    }
                    aria-label={p.card.name}
                  >
                    <CardFace
                      card={p.card}
                      size="battlefield"
                      perm={p}
                      tapped={p.tapped}
                      isEligibleCombat={isEligibleCombat}
                      combatRole={combatRole ?? null}
                      targetableForDialog={isEligibleTarget}
                    />
                  </button>
                </HoverCardDetail>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
