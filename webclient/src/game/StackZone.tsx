import { AnimatePresence, motion } from 'framer-motion';
import type { WebCardView } from '../api/schemas';
import { slow, SLOWMO } from '../animation/debug';
import {
  STACK_ENTER_EXIT,
  STACK_ZONE_COLLAPSE_MS,
} from '../animation/transitions';
import { CardFace } from './CardFace';
import { HoverCardDetail } from './HoverCardDetail';

export function StackZone({ stack }: { stack: Record<string, WebCardView> }) {
  const entries = Object.values(stack).reverse();
  // Slice 50 â€” keep the section mounted while AnimatePresence flushes
  // the last exit animation, otherwise the stack tile pops out
  // immediately when the spell resolves and the section unmounts.
  const isEmpty = entries.length === 0;
  return (
    <section
      data-testid="stack-zone"
      className={`flex-shrink-0 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2 transition-opacity ${
        isEmpty ? 'opacity-0 pointer-events-none h-0 overflow-hidden py-0 border-b-0' : 'opacity-100'
      }`}
      style={{ transitionDuration: `${STACK_ZONE_COLLAPSE_MS * SLOWMO}ms` }}
    >
      <div className="text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
        Stack ({entries.length}) â€” top resolves first
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <AnimatePresence mode="popLayout" initial={false}>
          {entries.map((card, idx) => {
            const tooltip = [card.typeLine, ...(card.rules ?? [])]
              .filter(Boolean)
              .join('\n');
            // Slice 52c â€” layoutId={card.cardId} ties this stack tile
            // to the resolved permanent's battlefield tile (same
            // cardId after the spell resolves, since cardId is the
            // underlying-Card UUID â€” Spell.id â‰  Permanent.id but
            // Spell.getCard().getId() === Permanent.id). LayoutGroup
            // at the Game-page root crosses the AnimatePresence
            // boundary so Framer matches the two siblings.
            //
            // Empty-string cardId is a defensive default for older
            // fixtures (slice 52b) â€” passing '' as layoutId would
            // collide every "missing" card into one shared id.
            // {@code undefined} disables layout-id matching for
            // that tile.
            const layoutId = card.cardId ? card.cardId : undefined;
            return (
              <motion.div
                key={card.id}
                layout
                layoutId={layoutId}
                data-layout-id={layoutId}
                initial={{ opacity: 0, y: -16, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 24, scale: 0.85 }}
                transition={slow(STACK_ENTER_EXIT)}
              >
                <HoverCardDetail card={card}>
                  <div
                    data-testid="stack-entry"
                    className="relative"
                    title={tooltip || card.name}
                  >
                    <CardFace card={card} size="stack" />
                    {idx === 0 && (
                      <span
                        data-testid="stack-top-marker"
                        className="absolute -top-1.5 -right-1.5 text-[9px] font-semibold bg-fuchsia-500 text-zinc-100 px-1 rounded shadow"
                      >
                        TOP
                      </span>
                    )}
                  </div>
                </HoverCardDetail>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </section>
  );
}
