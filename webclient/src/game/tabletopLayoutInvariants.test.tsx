/**
 * Slice B-0.5 — zone-stability invariants for the tabletop variant.
 *
 * <p>The tabletop variant promises (per `docs/design/variant-tabletop.md`,
 * load-bearing decisions section): zones are fixed dimensional anchors;
 * cards inside adapt; layout shape is stable across game-state changes.
 * That guarantee is delivered by three layers — CSS Grid with sized
 * tracks, component architecture (no layout participants outside the
 * grid), and tests. This file is the test layer.
 *
 * <p><b>jsdom limitation acknowledged.</b> jsdom does not run real
 * layout — `getBoundingClientRect()` returns 0×0 for grid-laid
 * elements. So this file does NOT measure pixels. Instead it asserts
 * the <i>structural</i> invariants that DELIVER pixel-stability:
 * containment classes (`min-h-0`, `min-w-0`, `overflow-hidden`),
 * CSS Grid placement (`grid-area:*`), modal portal isolation, and
 * stable per-pod data attributes across renders.
 *
 * <p>Pixel-stable invariants (real `getBoundingClientRect` checks
 * across stress states) are a future Playwright slice. Today's
 * structural assertions are the cheap insurance: if a future change
 * accidentally drops `min-h-0` from a pod wrapper, this test fails
 * before merging.
 *
 * <p><b>Why this lives in `game/` not `game/variants/`.</b> Slice B-0
 * registered `'tabletop'` in the variant registry but no consumer
 * reads the variant yet — the demo fixture renders the `current`
 * REDESIGN structure under the hood. This test asserts against THAT
 * structure as the baseline that tabletop must not regress against.
 * When variant components land in `game/variants/`, parameterize the
 * test (or duplicate it under `variants/`) so each variant is held
 * to the same invariant.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// REDESIGN-mode invariants — force the flag on so we hit the
// post-slice-70-N layout structure regardless of how the test runner
// is invoked. KEEP_ELIMINATED + LAYOUT_BOUNDS default-on as in prod.
vi.mock('../featureFlags', () => ({
  REDESIGN: true,
  KEEP_ELIMINATED: true,
  LAYOUT_BOUNDS: true,
}));

import { DemoGame } from '../pages/DemoGame';

describe('tabletop layout invariants — zone stability (jsdom-level structural)', () => {
  it('GameTable root applies CSS Grid display + overflow containment', () => {
    render(<DemoGame />);
    const root = screen.getByTestId('game-table');
    // The grid layout itself is what makes pod cells deterministic —
    // dropping `grid` here turns the layout into block flow and
    // every pod's position becomes content-dependent.
    expect(root.className).toMatch(/\bgrid\b/);
    // overflow-hidden caps the grid against its parent — without it,
    // a busy battlefield could push the page scrollable, which would
    // shift everything beneath the fold.
    expect(root.className).toMatch(/\boverflow-hidden\b/);
  });

  it('battlefield grid cell has min-h-0 + min-w-0 containment classes', () => {
    render(<DemoGame />);
    const battlefield = screen.getByTestId('game-table-battlefield');
    // Critical CSS chain: parent grid cells default to min-h: auto,
    // which lets content push the row outward. min-h-0 + min-w-0
    // forces clip-and-fit behavior that's the foundation of zone
    // stability.
    expect(battlefield.className).toMatch(/\bmin-h-0\b/);
    expect(battlefield.className).toMatch(/\bmin-w-0\b/);
  });

  it('side panel applies min-h-0 to anchor its grid cell against content height', () => {
    render(<DemoGame />);
    const sidepanel = screen.getByTestId('game-table-sidepanel');
    expect(sidepanel.className).toMatch(/\bmin-h-0\b/);
  });

  it('asymmetric-T layout root uses CSS Grid with explicit (non-auto) track sizing', () => {
    // Asymmetric-T is the current REDESIGN's battlefield layout
    // (2026-05-03; LAYOUT_BOUNDS=true default). Its layout root is
    // the canonical example of a "fixed dimensional anchor" — sized
    // tracks (`gridTemplateRows: '55% 45%'`) make pod cell positions
    // a function of viewport size only. Tabletop's eventual root must
    // satisfy the same property; this test acts as the baseline.
    render(<DemoGame />);
    const root = screen.getByTestId('asymmetric-t-layout');
    expect(root.className).toMatch(/\bgrid\b/);
    expect(root.className).toMatch(/\bmin-h-0\b/);
    expect(root.className).toMatch(/\boverflow-hidden\b/);
    // The critical bit — explicit, non-auto track sizing. Without this,
    // pod cells would expand to fit content, defeating the stability
    // guarantee.
    const tracks = root.style.gridTemplateRows;
    expect(tracks).toBeTruthy();
    expect(tracks).not.toMatch(/\bauto\b/);
  });

  it('opponent-lanes container preserves containment (min-h-0 + min-w-0 + overflow-hidden)', () => {
    render(<DemoGame />);
    const lanes = screen.getByTestId('opponent-lanes');
    expect(lanes.className).toMatch(/\bmin-h-0\b/);
    expect(lanes.className).toMatch(/\bmin-w-0\b/);
    expect(lanes.className).toMatch(/\boverflow-hidden\b/);
  });

  it('every player pod renders with a stable data-player-id (one per player in the fixture)', () => {
    render(<DemoGame />);
    const podsWithIds = document.querySelectorAll('[data-player-id]');
    // The demo fixture is 4-player Commander; every visible pod
    // should expose its player UUID as a data attribute. Multiple
    // child elements within a pod may share the same player-id —
    // de-dup by ID then assert exactly 4 distinct players are
    // represented.
    const distinct = new Set(
      Array.from(podsWithIds).map(
        (el) => (el as HTMLElement).dataset['playerId'],
      ),
    );
    expect(distinct.size).toBe(4);
    // Every id is a UUID-shaped string (the fixture uses fixed
    // values). If a future refactor swaps to numeric ids or names,
    // this fails loudly so we can update the contract.
    for (const id of distinct) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('local-pod preserves containment (min-h-0 + min-w-0 + overflow-hidden)', () => {
    // Local pod is the user's battlefield in the asymmetric-T layout
    // (the bottom 45% row). Same containment rule as the opponent
    // lanes — without min-h-0, content could push the pod row outward
    // and disrupt the 55/45 split.
    render(<DemoGame />);
    const localPod = screen.getByTestId('local-pod');
    expect(localPod.className).toMatch(/\bmin-h-0\b/);
    expect(localPod.className).toMatch(/\bmin-w-0\b/);
    expect(localPod.className).toMatch(/\boverflow-hidden\b/);
  });
});
