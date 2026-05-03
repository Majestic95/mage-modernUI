/**
 * Dev fixture renderer — no auth, no server, no WebSocket. Renders
 * GameTable with a stress-tested 4-player Commander view from
 * {@link buildDemoGameView}. Used for layout iteration where standing
 * up a real game would be slow / require AI bots / etc.
 *
 * <p>Wrapped in MotionConfig + LayoutGroup the same way Game.tsx does
 * in production so motion components don't warn. The {@code stream}
 * passed to GameTable is intentionally null — no priority dispatch,
 * no responses; this is a STATIC view for layout review. Click
 * affordances render but do nothing actionable beyond local state
 * (ZoneBrowser modals, hover tooltips, etc.).
 *
 * <p><b>Slice A</b> — mounts the {@link LayoutVariantProvider} +
 * {@link VariantSwitcher} so layout-variant work happens entirely
 * inside the fixture surface without polluting the production game
 * window. The variant lives in React state above the provider; the
 * switcher updates both state (re-render) and URL (share-link /
 * reload persistence). Today only {@code 'current'} exists — adding
 * a variant is mechanical (extend LAYOUT_VARIANTS, branch inside the
 * consuming component).
 *
 * <p>Extracted from App.tsx in slice A to bring App.tsx back under
 * the 500-LOC hard cap (App.tsx hit 509 LOC pre-extraction with no
 * documented exception).
 */
import { useMemo, useState } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import { GameTable } from '../game/GameTable';
import { buildDemoGameView } from '../game/devFixtures';
import { VariantSwitcher } from '../game/VariantSwitcher';
import {
  LayoutVariantProvider,
  getActiveVariant,
  setVariantInUrl,
  type LayoutVariant,
} from '../layoutVariants';

export function DemoGame() {
  const gameView = useMemo(() => buildDemoGameView(), []);
  // Source-of-truth for the active variant lives here — above the
  // Provider — so the switcher can update both React state (forces
  // re-render through the context) and the URL (shareable + survives
  // reload) in one operation.
  const [variant, setVariant] = useState<LayoutVariant>(() =>
    getActiveVariant(),
  );

  const onVariantChange = (next: LayoutVariant) => {
    setVariantInUrl(next);
    setVariant(next);
  };

  // Mirror Game.tsx's outer chrome — h-screen + overflow-hidden is
  // load-bearing: GameTable uses h-full which collapses to 0 without
  // a parent that has a defined height. Pre-extraction the demo
  // route let body scroll vertically because GameTable content
  // overflowed an undefined-height root, violating the battlefield's
  // "no scroll wheel" rule.
  return (
    <LayoutVariantProvider variant={variant}>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
            <VariantSwitcher current={variant} onChange={onVariantChange} />
            <GameTable
              gameId="demo-fixture"
              gameView={gameView}
              stream={null}
            />
          </div>
        </LayoutGroup>
      </MotionConfig>
    </LayoutVariantProvider>
  );
}
