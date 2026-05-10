/**
 * Slice FB#10 (2026-05-05) — bucket card row + duplicate-stack
 * click-through. Houses the tabletop bucket's inner card layout:
 *
 * <ul>
 *   <li>{@link BucketCardsRow} — flex-wrap row with vertical scroll
 *       (last-resort overflow). Cards wrap to a new row when the
 *       current row is full; vertical scroll catches anything past
 *       the bucket's visible height. T1 ✓ — bucket footprint
 *       unchanged; cards adapt within fixed bucket box.</li>
 *
 *   <li>{@link DuplicateStackContainer} — for {@code StackedGroup}s
 *       with N {@code stackedDuplicates}, renders the host plus each
 *       duplicate as an independently-clickable card with a small
 *       (~16px / 20% of card width) peek offset so back cards have a
 *       clickable strip. Use case: declaring blockers with N tokens
 *       — players need to select which token blocks. Lands stack
 *       similarly so players can pick which copy taps for mana.</li>
 *
 *   <li>{@link TabletopCardButton} — the per-card button + hover-
 *       detail wrapper. Shared by host, attachment, and duplicate
 *       render paths to keep the eligibility / combat / click
 *       semantics identical across all three.</li>
 * </ul>
 *
 * <p>Replaces the prior gap-vs-peek toggle (FB#6) — wrap is the
 * always-on default now. Same {@code shrink → wrap → vertical-scroll}
 * adaptation chain for the bucket; {@code peek-with-click-through}
 * applies only inside a duplicate-stack container, not the row.
 */
import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { WebPermanentView } from '../api/schemas';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';
import { RoleMarkers } from './RoleMarkers';

export type BucketKind = 'lands' | 'creatures' | 'artifactsEnchantments';

/**
 * Pixel offset between adjacent cards inside a {@link DuplicateStackContainer}.
 * 20% of the default 80px card width = 16px. Each card after the first
 * shows a 16px peek strip on its right side, which is the clickable
 * surface for "select THIS copy" actions.
 */
const DUPLICATE_PEEK_PX = 16;

export function BucketCardsRow({
  kind,
  children,
}: {
  kind: BucketKind;
  children: ReactNode;
}) {
  // Adaptation chain for the bucket interior:
  //   1. Cards keep their natural width (--card-size-medium, default 80px).
  //   2. Row uses flex-wrap so cards flow onto a NEW row when the
  //      current row's width is exhausted. items-start + content-start
  //      keep wrapped rows top-aligned (rather than centered) so the
  //      first row anchors at the top of the bucket and additional
  //      rows stack downward.
  //   3. overflow-y-auto kicks in only when wrapped rows exceed the
  //      bucket's visible height — the FINAL fallback. T1 holds:
  //      bucket footprint never grows; cards adapt within.
  return (
    <div
      data-testid={`tabletop-bucket-${kind}-cards`}
      data-row-mode="wrap"
      className="flex flex-row flex-wrap items-start content-start gap-1.5 h-full pl-12 pr-2 py-2 min-h-0 min-w-0 overflow-y-auto"
    >
      {children}
    </div>
  );
}

interface CardButtonProps {
  perm: WebPermanentView;
  clickable: boolean;
  onObjectClick: ((id: string) => void) | undefined;
  isEligibleTarget: boolean;
  isEligibleCombat: boolean;
  combatRole: 'attacker' | 'blocker' | null;
}

/**
 * One clickable battlefield card. Shared by host, attachment, and
 * duplicate-stack render paths so eligibility/combat/click
 * semantics stay identical across them. The wrapping {@code <div>}
 * carries the H3 flex stretch chain (parent flex → HoverCardDetail
 * inline-flex span stretches → button stretches → CardFace
 * height:100% resolves) — see TabletopBuckets.tsx history block H2-H3.
 */
export function TabletopCardButton({
  perm,
  clickable,
  onObjectClick,
  isEligibleTarget,
  isEligibleCombat,
  combatRole,
}: CardButtonProps) {
  return (
    <HoverCardDetail card={perm.card}>
      <button
        type="button"
        data-permanent-id={perm.card.id}
        data-tapped={perm.tapped || undefined}
        data-combat-eligible={isEligibleCombat || undefined}
        data-combat-role={combatRole ?? undefined}
        data-targetable={isEligibleTarget || undefined}
        disabled={!clickable}
        onClick={
          clickable && onObjectClick
            ? () => onObjectClick(perm.card.id)
            : undefined
        }
        className={
          'relative block p-0 m-0 bg-transparent border-0 outline-none ' +
          (clickable ? 'cursor-pointer' : 'cursor-default')
        }
        aria-label={perm.card.name}
      >
        <CardFace
          card={perm.card}
          size="battlefield"
          perm={perm}
          tapped={perm.tapped}
          isEligibleCombat={isEligibleCombat}
          combatRole={combatRole}
          targetableForDialog={isEligibleTarget}
        />
        <RoleMarkers combatRole={combatRole} />
      </button>
    </HoverCardDetail>
  );
}

interface DuplicateStackProps {
  /** Front-of-stack card; rendered at left=0, highest z-index. */
  host: WebPermanentView;
  /**
   * Other identical perms behind the host. Each renders at left
   * offset (i+1)*DUPLICATE_PEEK_PX behind the host, with z-index
   * descending so click-targeting cascades outward.
   */
  duplicates: readonly WebPermanentView[];
  /** Layout id for Framer cross-zone glide on the host. */
  hostLayoutId: string | undefined;
  /** Eligibility maps + click handler — applied per-card (NOT per-stack). */
  canAct: boolean;
  onObjectClick: ((id: string) => void) | undefined;
  eligibleTargetIds: ReadonlySet<string> | undefined;
  eligibleCombatIds: ReadonlySet<string> | undefined;
  combatRoles: ReadonlyMap<string, 'attacker' | 'blocker'> | undefined;
}

/**
 * Render a {@code StackedGroup}'s host plus its duplicates as
 * independently-clickable cards with peek offsets, instead of the
 * single host + ×N badge approach (FB#6). Closes the long-standing
 * "can't select back-of-stack tokens during declare-blockers / can't
 * pick which Forest taps for mana" bug class.
 *
 * <p>Layout: container width = {@code card_width + N*DUPLICATE_PEEK_PX}.
 * Host at {@code left:0}, duplicate {@code i} at
 * {@code left:(i+1)*DUPLICATE_PEEK_PX}, z-index descends so each
 * card's right-edge peek strip is the clickable surface for
 * "select THIS copy". The {@code ×N} badge stays on the host as
 * visual confirmation of stack size.
 */
export function DuplicateStackContainer({
  host,
  duplicates,
  hostLayoutId,
  canAct,
  onObjectClick,
  eligibleTargetIds,
  eligibleCombatIds,
  combatRoles,
}: DuplicateStackProps) {
  const baseW = 'var(--card-size-medium, 80px)';
  const heightCalc = 'calc(var(--card-size-medium, 80px) * 7 / 5)';
  const dupCount = duplicates.length;
  const stackCount = dupCount + 1;
  // Container width = host card width + one peek per duplicate.
  // Host occupies [0, card_width]; each duplicate occupies
  // [(i+1)*peek, (i+1)*peek + card_width]. Right-most card's
  // visible/clickable peek strip is [(N-1)*peek + card_width - peek,
  //   (N-1)*peek + card_width].
  const containerWidth = `calc(${baseW} + ${dupCount} * ${DUPLICATE_PEEK_PX}px)`;
  const inCombatMode = (eligibleCombatIds?.size ?? 0) > 0;

  function clickableFor(card: WebPermanentView): boolean {
    const eligibleCombat = eligibleCombatIds?.has(card.card.id) ?? false;
    return canAct && !!onObjectClick && (!inCombatMode || eligibleCombat);
  }

  // Host renders on top (z = stackCount). Duplicates fan to the right
  // with descending z so each card's peek strip on the right side is
  // the click target.
  return (
    <motion.div
      key={host.card.id}
      layout
      data-layout-id={hostLayoutId}
      data-card-id={host.card.cardId || undefined}
      data-stack-count={stackCount}
      {...(hostLayoutId ? { layoutId: hostLayoutId } : {})}
      className="relative"
      style={{
        width: containerWidth,
        height: heightCalc,
        flexShrink: 0,
      }}
    >
      {/* Duplicates first (lower z, no key collision with host). */}
      {duplicates.map((dup, i) => {
        const eligibleTarget = eligibleTargetIds?.has(dup.card.id) ?? false;
        const eligibleCombat = eligibleCombatIds?.has(dup.card.id) ?? false;
        const role = combatRoles?.get(dup.card.id) ?? null;
        return (
          <div
            key={dup.card.id}
            data-stack-index={i + 1}
            className="absolute top-0 flex"
            style={{
              left: `${(i + 1) * DUPLICATE_PEEK_PX}px`,
              width: baseW,
              height: heightCalc,
              zIndex: stackCount - 1 - i,
            }}
          >
            <TabletopCardButton
              perm={dup}
              clickable={clickableFor(dup)}
              onObjectClick={onObjectClick}
              isEligibleTarget={eligibleTarget}
              isEligibleCombat={eligibleCombat}
              combatRole={role}
            />
          </div>
        );
      })}
      {/* Host on top. */}
      <div
        data-stack-index={0}
        className="absolute top-0 left-0 flex"
        style={{
          width: baseW,
          height: heightCalc,
          zIndex: stackCount,
        }}
      >
        <span
          data-testid="stack-count-badge"
          aria-label={`${stackCount} copies`}
          className="absolute top-1 right-1 z-10 px-1.5 py-0.5 rounded-full bg-zinc-900/85 border border-zinc-600 text-[11px] font-mono font-semibold text-zinc-100 pointer-events-none shadow"
        >
          ×{stackCount}
        </span>
        <TabletopCardButton
          perm={host}
          clickable={clickableFor(host)}
          onObjectClick={onObjectClick}
          isEligibleTarget={eligibleTargetIds?.has(host.card.id) ?? false}
          isEligibleCombat={eligibleCombatIds?.has(host.card.id) ?? false}
          combatRole={combatRoles?.get(host.card.id) ?? null}
        />
      </div>
    </motion.div>
  );
}
