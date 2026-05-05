/**
 * User direction (2026-05-03) — clicking a bucket title opens a modal
 * listing every card in that bucket at full size, solving overcrowding
 * once a bucket stacks 20+ cards. Tests lock in the click affordance
 * + esc-close + single-modal-per-pod invariant.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TabletopBuckets } from './TabletopBuckets';
import {
  webCardViewSchema,
  webPermanentViewSchema,
  type WebPermanentView,
} from '../api/schemas';

function makePerm(name: string, types: readonly string[], id: string): WebPermanentView {
  return webPermanentViewSchema.parse({
    card: webCardViewSchema.parse({
      id,
      cardId: id,
      name,
      displayName: name,
      expansionSetCode: 'TST',
      cardNumber: '001',
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
    }),
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

const FOREST = makePerm('Forest', ['LAND'], '11111111-1111-1111-1111-111111111111');
const ELF = makePerm('Llanowar Elves', ['CREATURE'], '22222222-2222-2222-2222-222222222222');
const RING = makePerm('Sol Ring', ['ARTIFACT'], '33333333-3333-3333-3333-333333333333');

const BUCKETS = {
  lands: [FOREST],
  creatures: [ELF],
  artifactsEnchantments: [RING],
} as const;

describe('TabletopBuckets — bucket-title modal', () => {
  it('renders no ZoneBrowser by default', () => {
    render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    expect(screen.queryByTestId('zone-browser')).toBeNull();
  });

  it('clicking the Lands label opens a ZoneBrowser titled with player + bucket name', async () => {
    const user = userEvent.setup();
    render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    await user.click(screen.getByTestId('tabletop-bucket-lands-label'));
    const browser = screen.getByTestId('zone-browser');
    expect(browser).toBeInTheDocument();
    expect(browser.getAttribute('aria-label') ?? browser.textContent).toContain('alice');
    expect(browser.textContent).toContain('Lands');
  });

  it('switching from one bucket to another swaps the open modal contents', async () => {
    const user = userEvent.setup();
    render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    await user.click(screen.getByTestId('tabletop-bucket-lands-label'));
    expect(screen.getByTestId('zone-browser').textContent).toContain('Lands');

    await user.click(screen.getByTestId('tabletop-bucket-creatures-label'));
    // Only one modal should be mounted at a time per pod.
    expect(screen.getAllByTestId('zone-browser')).toHaveLength(1);
    expect(screen.getByTestId('zone-browser').textContent).toContain('Creatures');
  });

  it('clicking the close button dismisses the modal', async () => {
    const user = userEvent.setup();
    render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    await user.click(screen.getByTestId('tabletop-bucket-creatures-label'));
    expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    await user.click(screen.getByTestId('zone-browser-close'));
    expect(screen.queryByTestId('zone-browser')).toBeNull();
  });

  it('G3 — each rendered card carries `data-permanent-id` so StackZone combat arrows can resolve attacker rects', () => {
    const { container } = render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    // Three cards in BUCKETS (FOREST land, ELF creature, RING artifact).
    // Each must surface a [data-permanent-id="..."] wrapper that StackZone
    // querySelectors against when rendering combat arrows.
    expect(container.querySelector(`[data-permanent-id="${FOREST.card.id}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-permanent-id="${ELF.card.id}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-permanent-id="${RING.card.id}"]`)).toBeInTheDocument();
  });

  it('G4 — clicking a card while canAct dispatches onObjectClick with the card id', async () => {
    const user = userEvent.setup();
    const onObjectClick = vi.fn();
    const { container } = render(
      <TabletopBuckets
        buckets={BUCKETS}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
        canAct
        onObjectClick={onObjectClick}
      />,
    );
    const elfButton = container.querySelector(
      `[data-permanent-id="${ELF.card.id}"]`,
    ) as HTMLButtonElement | null;
    expect(elfButton).not.toBeNull();
    await user.click(elfButton!);
    expect(onObjectClick).toHaveBeenCalledWith(ELF.card.id);
  });

  it('G7 — each card surfaces `data-layout-id={cardId}` so Framer can glide cross-zone (cardId is the stable cross-zone identity per schemas.ts)', () => {
    const { container } = render(
      <TabletopBuckets buckets={BUCKETS} position="bottom" playerName="alice" colorIdentity={[]} />,
    );
    expect(container.querySelector(`[data-layout-id="${FOREST.card.cardId}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-layout-id="${ELF.card.cardId}"]`)).toBeInTheDocument();
    expect(container.querySelector(`[data-layout-id="${RING.card.cardId}"]`)).toBeInTheDocument();
  });

  it('FB#10 (2026-05-05) — bucket card row always uses flex-wrap + vertical scroll (replaces FB#6 gap-vs-peek toggle)', () => {
    const { container } = render(
      <TabletopBuckets
        buckets={{
          lands: [],
          creatures: [
            ELF,
            makePerm('Grizzly Bears', ['CREATURE'], '44444444-4444-4444-4444-444444444444'),
          ],
          artifactsEnchantments: [],
        }}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
      />,
    );
    const row = container.querySelector('[data-testid="tabletop-bucket-creatures-cards"]');
    expect(row).not.toBeNull();
    expect(row!.getAttribute('data-row-mode')).toBe('wrap');
    // flex-wrap + overflow-y-auto are the load-bearing classes.
    expect(row!.className).toContain('flex-wrap');
    expect(row!.className).toContain('overflow-y-auto');
    // No more horizontal-scroll fallback (FB#6's overflow-x-auto).
    expect(row!.className).not.toContain('overflow-x-auto');
  });

  it('FB#10 — distinct creatures render as separate sibling cards (no negative-margin peek between them)', () => {
    const creatures = Array.from({ length: 5 }, (_, i) =>
      makePerm(`Creature ${i}`, ['CREATURE'], `99999999-9999-4999-9999-9999999999${i.toString(16)}`),
    );
    const { container } = render(
      <TabletopBuckets
        buckets={{
          lands: [],
          creatures,
          artifactsEnchantments: [],
        }}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
      />,
    );
    const row = container.querySelector('[data-testid="tabletop-bucket-creatures-cards"]')!;
    // Each distinct card has its own [data-permanent-id] button.
    const buttons = row.querySelectorAll('[data-permanent-id]');
    expect(buttons.length).toBe(5);
    // No data-stack-count on any wrapper (singletons only).
    const stacks = row.querySelectorAll('[data-stack-count]');
    expect(stacks.length).toBe(0);
  });

  it('FB#10 — duplicate stack (3 Forests) renders 3 click-through cards with peek offsets and a stack-count badge', () => {
    const FOREST_COPIES = Array.from({ length: 3 }, (_, i) => {
      const id = `bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbb${i.toString(16)}`;
      return makePerm('Forest', ['LAND'], id);
    });
    const { container } = render(
      <TabletopBuckets
        buckets={{
          lands: FOREST_COPIES,
          creatures: [],
          artifactsEnchantments: [],
        }}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
      />,
    );
    const row = container.querySelector('[data-testid="tabletop-bucket-lands-cards"]')!;
    // One container with data-stack-count=3 wraps the whole stack.
    const stackContainer = row.querySelector('[data-stack-count="3"]');
    expect(stackContainer).not.toBeNull();
    // All 3 Forests are individually clickable buttons inside the container.
    const buttons = stackContainer!.querySelectorAll('[data-permanent-id]');
    expect(buttons.length).toBe(3);
    // Stack-count badge present on the host (×3).
    const badge = stackContainer!.querySelector('[data-testid="stack-count-badge"]');
    expect(badge).not.toBeNull();
    expect(badge!.textContent).toContain('×3');
    // data-stack-index marks each card; host = 0, dups = 1..N-1.
    const indices = Array.from(stackContainer!.querySelectorAll('[data-stack-index]'))
      .map((el) => el.getAttribute('data-stack-index'))
      .sort();
    expect(indices).toEqual(['0', '1', '2']);
  });

  it('FB#10 — clicking a back-of-stack duplicate dispatches THAT card\'s id (not the host\'s)', async () => {
    const user = userEvent.setup();
    const onObjectClick = vi.fn();
    const FOREST_HOST_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccc01';
    const FOREST_BACK_ID = 'cccccccc-cccc-4ccc-cccc-cccccccccc02';
    const { container } = render(
      <TabletopBuckets
        buckets={{
          lands: [
            makePerm('Forest', ['LAND'], FOREST_HOST_ID),
            makePerm('Forest', ['LAND'], FOREST_BACK_ID),
          ],
          creatures: [],
          artifactsEnchantments: [],
        }}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
        canAct
        onObjectClick={onObjectClick}
      />,
    );
    // Click the back card — its [data-permanent-id] should match the
    // back Forest's id, not the host's.
    const backButton = container.querySelector(
      `[data-permanent-id="${FOREST_BACK_ID}"]`,
    ) as HTMLButtonElement;
    expect(backButton).not.toBeNull();
    await user.click(backButton);
    expect(onObjectClick).toHaveBeenCalledWith(FOREST_BACK_ID);
    // And the click did NOT dispatch the host's id.
    expect(onObjectClick).not.toHaveBeenCalledWith(FOREST_HOST_ID);
  });

  it('G4 — clicking a card while !canAct does NOT dispatch (silent gate)', async () => {
    const user = userEvent.setup();
    const onObjectClick = vi.fn();
    const { container } = render(
      <TabletopBuckets
        buckets={BUCKETS}
        position="bottom"
        playerName="alice"
        colorIdentity={[]}
        canAct={false}
        onObjectClick={onObjectClick}
      />,
    );
    const elfButton = container.querySelector(
      `[data-permanent-id="${ELF.card.id}"]`,
    ) as HTMLButtonElement | null;
    expect(elfButton).not.toBeNull();
    expect(elfButton!.disabled).toBe(true);
    await user.click(elfButton!);
    expect(onObjectClick).not.toHaveBeenCalled();
  });
});
