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
