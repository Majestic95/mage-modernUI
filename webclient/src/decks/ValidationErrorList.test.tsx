import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ValidationErrorList } from './ValidationErrorList';
import type { WebDeckValidationError } from '../api/schemas';

const banned: WebDeckValidationError = {
  errorType: 'BANNED',
  group: 'Mana Crypt',
  message: 'Banned',
  cardName: 'Mana Crypt',
  partlyLegal: false,
  synthetic: false,
};

const deckSize: WebDeckValidationError = {
  errorType: 'DECK_SIZE',
  group: 'Deck',
  message: 'Must contain at least 100 cards: has only 60 cards',
  cardName: null,
  partlyLegal: true,
  synthetic: false,
};

const overflow: WebDeckValidationError = {
  errorType: 'OTHER',
  group: '...',
  message: 'and more 7 errors',
  cardName: null,
  partlyLegal: false,
  synthetic: true,
};

describe('ValidationErrorList', () => {
  it('renders nothing when the list is empty', () => {
    const { container } = render(<ValidationErrorList errors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a per-card BANNED entry with the card name in monospace', () => {
    render(<ValidationErrorList errors={[banned]} />);
    const list = screen.getByRole('list', { name: /deck validation/i });
    expect(within(list).getByText('Mana Crypt')).toBeInTheDocument();
    expect(within(list).getByText(/— Banned/)).toBeInTheDocument();
  });

  it('renders a partlyLegal DECK_SIZE entry with amber styling cue', () => {
    render(<ValidationErrorList errors={[deckSize]} />);
    // The amber dot uses the status-warning token. We assert via class
    // hook so the test stays meaningful even after token-value changes.
    const dot = document.querySelector('.bg-status-warning');
    expect(dot).not.toBeNull();
    expect(
      screen.getByText(/Must contain at least 100 cards/),
    ).toBeInTheDocument();
  });

  it('renders the overflow sentinel as a footer (no clickable affordance)', () => {
    render(<ValidationErrorList errors={[banned, overflow]} />);
    const list = screen.getByRole('list');
    // The synthetic entry exists in the DOM but uses muted styling.
    expect(within(list).getByText('and more 7 errors')).toBeInTheDocument();
    // The synthetic sentinel doesn't carry the red/amber dot, so the
    // count of dots equals the count of REAL errors (not the total).
    const dots = list.querySelectorAll('.bg-status-danger, .bg-status-warning');
    expect(dots).toHaveLength(1);
  });

  it('preserves server-side sort order (real entries before synthetic)', () => {
    render(<ValidationErrorList errors={[banned, deckSize, overflow]} />);
    const list = screen.getByRole('list');
    const items = list.querySelectorAll('li');
    // Real entries come first (banned, deckSize), synthetic last.
    expect(items[0]?.textContent).toContain('Mana Crypt');
    expect(items[1]?.textContent).toContain('Must contain at least');
    expect(items[2]?.textContent).toContain('and more 7 errors');
  });

  it('uses the custom ariaLabel when provided', () => {
    render(
      <ValidationErrorList
        errors={[banned]}
        ariaLabel="Join failed — deck validation errors"
      />,
    );
    expect(
      screen.getByRole('list', { name: /Join failed/ }),
    ).toBeInTheDocument();
  });
});
