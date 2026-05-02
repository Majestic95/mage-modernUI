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

  // Bug fix (2026-05-02) — opponent variant is now ALSO clickable
  // (drops the slice-70-P tooltip-only path). Graveyard + exile are
  // public information per MTG rules; click → modal mirrors the
  // paper-game right and works on touch input.
  describe('opponent variant (clickable like self after 2026-05-02 fix)', () => {
    it('non-empty opponent graveyard renders the count as a clickable BUTTON', () => {
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{ a: FOREST }}
          playerName="bob"
          variant="opponent"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      expect(counter.tagName).toBe('BUTTON');
      expect(counter.dataset['variant']).toBe('opponent');
    });

    it('clicking the opponent chip opens the ZoneBrowser modal', async () => {
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
      expect(screen.getByTestId('zone-browser')).toBeInTheDocument();
    });

    it('opponent variant still emits cross-zone layoutId sinks (slice 55 contract preserved)', () => {
      // Scoping the sink to self-only would silently break opponent-
      // zone cross-zone resolve glides (e.g., a Lightning Bolt
      // resolving from the stack into an opponent's graveyard).
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

    it('empty opponent graveyard still renders plain text (nothing to view)', () => {
      render(
        <ZoneIcon
          zone="graveyard"
          cards={{}}
          playerName="bob"
          variant="opponent"
        />,
      );
      const counter = screen.getByTestId('zone-count-graveyard');
      expect(counter.tagName).not.toBe('BUTTON');
      expect(counter.textContent).toBe('0');
    });
  });
});
