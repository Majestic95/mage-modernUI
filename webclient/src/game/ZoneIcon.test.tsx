import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZoneIcon } from './ZoneIcon';
import type { WebCardView } from '../api/schemas';

const FOREST: WebCardView = {
  id: '11111111-1111-1111-1111-111111111111',
  cardId: '99999999-9999-9999-9999-999999999999',
  name: 'Forest',
  displayName: 'Forest',
  expansionSetCode: 'M21',
  cardNumber: '281',
  manaCost: '',
  manaValue: 0,
  typeLine: 'Basic Land — Forest',
  supertypes: ['BASIC'],
  types: ['LAND'],
  subtypes: ['Forest'],
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
  sourceLabel: '',
};

describe('ZoneIcon', () => {
  describe('library', () => {
    it('renders the count with no clickable behavior (libraries are face-down)', () => {
      render(<ZoneIcon zone="library" count={42} playerName="alice" />);
      const counter = screen.getByTestId('zone-count-library');
      expect(counter.textContent).toBe('42');
      // Library is intentionally NOT a button — the spec §7.9 says
      // "library shows just a number (no icon, since libraries are
      // not viewable)".
      expect(counter.tagName).not.toBe('BUTTON');
    });

    it('uses the "Lib" default label', () => {
      render(<ZoneIcon zone="library" count={60} playerName="alice" />);
      expect(screen.getByText('Lib')).toBeInTheDocument();
    });

    it('respects a custom label override', () => {
      render(
        <ZoneIcon zone="library" count={5} playerName="alice" label="Deck" />,
      );
      expect(screen.getByText('Deck')).toBeInTheDocument();
    });

    it('renders 0 when count is omitted', () => {
      render(<ZoneIcon zone="library" playerName="alice" />);
      expect(screen.getByTestId('zone-count-library').textContent).toBe('0');
    });
  });

  describe('hand (slice 70-P.1)', () => {
    it('renders the count with no clickable behavior (private cards but public count)', () => {
      render(<ZoneIcon zone="hand" count={5} playerName="bob" />);
      const counter = screen.getByTestId('zone-count-hand');
      expect(counter.textContent).toBe('5');
      expect(counter.tagName).not.toBe('BUTTON');
    });

    it('uses the "Hand" default label', () => {
      render(<ZoneIcon zone="hand" count={7} playerName="alice" />);
      expect(screen.getByText('Hand')).toBeInTheDocument();
    });

    it('renders 0 when count is omitted', () => {
      render(<ZoneIcon zone="hand" playerName="alice" />);
      expect(screen.getByTestId('zone-count-hand').textContent).toBe('0');
    });
  });

  describe('graveyard / exile', () => {
    it('empty graveyard renders count 0 as plain text (no button)', () => {
      render(
        <ZoneIcon zone="graveyard" cards={{}} playerName="alice" />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      expect(counter.textContent).toBe('0');
      expect(counter.tagName).not.toBe('BUTTON');
    });

    it('non-empty graveyard renders count as a clickable button', () => {
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="alice"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      expect(counter.tagName).toBe('BUTTON');
      expect(counter.textContent).toBe('1');
    });

    it('clicking the chip opens the ZoneBrowser modal', async () => {
      const user = userEvent.setup();
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="alice"
        />,
      );
      expect(screen.queryByTestId('zone-browser')).toBeNull();
      await user.click(screen.getByTestId('zone-count-graveyard'));
      expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    });

    it('emits the cross-zone layoutId sink per card (slice 55 contract preserved)', () => {
      // Hidden zero-size motion.span per cardId so the LayoutGroup at
      // the Game root can glide a resolving instant INTO the chip's
      // position. Slice 70-C carries this contract over from the
      // legacy ZoneCounter.
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="alice"
        />,
      );
      const targets = screen.getAllByTestId('zone-target-graveyard');
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveAttribute('data-layout-id', FOREST.cardId);
    });

    it('uses the "Grave" / "Exile" default labels', () => {
      const { rerender } = render(
        <ZoneIcon zone="graveyard" cards={{}} playerName="alice" />,
      );
      expect(screen.getByText('Grave')).toBeInTheDocument();
      rerender(<ZoneIcon zone="exile" cards={{}} playerName="alice" />);
      expect(screen.getByText('Exile')).toBeInTheDocument();
    });
  });

  // Slice 70-P (picture-catalog §2.2) — opponent variant: hover
  // tooltip listing card names instead of clickable modal. Public
  // information per MTG rules; modal would be overdesign.
  describe('opponent variant (slice 70-P, picture-catalog §2.2)', () => {
    it('non-empty opponent graveyard renders the count as plain text, NOT a button', () => {
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="bob"
          variant="opponent"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      expect(counter.tagName).not.toBe('BUTTON');
      expect(counter.dataset['variant']).toBe('opponent');
    });

    it('opponent graveyard tooltip lists the card names', () => {
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST, b: { ...FOREST, id: 'b', name: 'Mountain' } }}
          playerName="bob"
          variant="opponent"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      // Format: "<name>'s <zone>:\n<card1>\n<card2>"
      expect(counter.getAttribute('title')).toBe(
        "bob's graveyard:\nForest\nMountain",
      );
    });

    it('clicking the opponent chip does NOT open the ZoneBrowser modal', async () => {
      const user = userEvent.setup();
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="bob"
          variant="opponent"
        />,
      );
      await user.click(screen.getByTestId('zone-count-graveyard'));
      expect(screen.queryByTestId('zone-browser')).toBeNull();
    });

    it('self variant still opens the modal (default behavior preserved)', async () => {
      const user = userEvent.setup();
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="alice"
          variant="self"
        />,
      );
      await user.click(screen.getByTestId('zone-count-graveyard'));
      expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    });

    it('opponent variant still emits cross-zone layoutId sinks (slice 55 contract preserved)', () => {
      // Slice 70-P Tech critic: scoping the sink to self-only would
      // silently break opponent-zone cross-zone resolve glides
      // (e.g., a Lightning Bolt resolving from the stack into an
      // opponent's graveyard). Lock the contract for both variants.
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="bob"
          variant="opponent"
        />,
      );
      const targets = screen.getAllByTestId('zone-target-graveyard');
      expect(targets).toHaveLength(1);
      expect(targets[0]).toHaveAttribute('data-layout-id', FOREST.cardId);
    });

    it('caps opponent tooltip at 10 cards with "... and N more" overflow (UI/UX critic I4)', () => {
      // 13 cards → tooltip shows 10 names + "... and 3 more".
      const cards: Record<string, typeof FOREST> = {};
      for (let i = 0; i < 13; i++) {
        cards[`card-${i}`] = { ...FOREST, id: `card-${i}`, name: `Card ${i}` };
      }
      render(
        <ZoneIcon
          zone="graveyard"
          cards={cards}
          playerName="bob"
          variant="opponent"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      const title = counter.getAttribute('title') ?? '';
      expect(title).toContain('Card 0');
      expect(title).toContain('Card 9');
      expect(title).not.toContain('Card 10');
      expect(title).toContain('... and 3 more');
    });

    it('opponent tooltip omits the "and N more" suffix when count fits within cap', () => {
      const cards = { a: FOREST, b: { ...FOREST, id: 'b', name: 'Mountain' } };
      render(
        <ZoneIcon
          zone="graveyard"
          cards={cards}
          playerName="bob"
          variant="opponent"
        />,
      );
      const title =
        screen
          .getByTestId('zone-count-graveyard')
          .getAttribute('title') ?? '';
      expect(title).not.toContain('and');
    });
  });
});
