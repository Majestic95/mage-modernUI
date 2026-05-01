import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardChooserList } from './CardChooserList';
import { webCardViewSchema, type WebCardView } from '../../api/schemas';

/**
 * Slice 70-X.14 (Wave A) — locks the {@link CardChooserList}
 * contract. Pre-Wave-A the SelectDialog stub had no tests because
 * it didn't render cardsView1 at all. This primitive replaces it
 * across SelectDialog + TargetDialog; pin its three modes
 * (single-pick / multi-pick / ordered) plus eligibility + skip.
 */

function fakeCard(id: string, name: string): WebCardView {
  return webCardViewSchema.parse({
    id,
    name,
    displayName: name,
    expansionSetCode: 'LEA',
    cardNumber: '1',
    manaCost: '{1}{G}',
    manaValue: 2,
    typeLine: 'Creature - Bear',
    supertypes: [],
    types: ['CREATURE'],
    subtypes: ['BEAR'],
    colors: ['G'],
    rarity: 'COMMON',
    power: '2',
    toughness: '2',
    startingLoyalty: '',
    rules: [],
    faceDown: false,
    counters: {},
    transformable: false,
    transformed: false,
    secondCardFace: null,
  });
}

const C1 = fakeCard('11111111-1111-1111-1111-111111111111', 'Grizzly Bears');
const C2 = fakeCard('22222222-2222-2222-2222-222222222222', 'Runeclaw Bear');
const C3 = fakeCard('33333333-3333-3333-3333-333333333333', 'Balduvian Bears');
const cards = { [C1.id]: C1, [C2.id]: C2, [C3.id]: C3 };

describe('CardChooserList — single-pick (Fierce Empath / tutor)', () => {
  it('renders one tile per card with set+cardNumber for art', () => {
    render(
      <CardChooserList cards={cards} min={1} max={1} onSubmit={() => {}} />,
    );
    for (const c of [C1, C2, C3]) {
      expect(
        screen.getByTestId(`card-chooser-tile-${c.id}`),
      ).toBeInTheDocument();
    }
  });

  it('clicking a card submits immediately with that single id', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={1} max={1} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    expect(onSubmit).toHaveBeenCalledWith([C2.id]);
  });

  it('does not render Done button in single-pick mode', () => {
    render(
      <CardChooserList cards={cards} min={1} max={1} onSubmit={() => {}} />,
    );
    expect(screen.queryByText(/done \(/i)).toBeNull();
  });

  it('renders Skip button when onSkip is provided in single-pick mode', () => {
    render(
      <CardChooserList
        cards={cards}
        min={1}
        max={1}
        onSubmit={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });
});

describe('CardChooserList — multi-pick (discard / scry partition)', () => {
  it('clicking toggles selection without submitting', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={0} max={3} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(
      screen
        .getByTestId(`card-chooser-tile-${C1.id}`)
        .getAttribute('data-picked'),
    ).toBe('true');
  });

  it('clicking a picked card unselects it', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={0} max={3} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    expect(
      screen
        .getByTestId(`card-chooser-tile-${C1.id}`)
        .getAttribute('data-picked'),
    ).toBeNull();
  });

  it('Done submits the selected ids', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={0} max={3} onSubmit={onSubmit} />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C3.id}`));
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(onSubmit).toHaveBeenCalledWith([C1.id, C3.id]);
  });

  it('Done is disabled while picked < min', () => {
    render(
      <CardChooserList cards={cards} min={2} max={3} onSubmit={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /done/i })).toBeDisabled();
  });

  it('cannot pick more than max — extra clicks are no-ops', async () => {
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={0} max={2} onSubmit={() => {}} />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C3.id}`));
    expect(
      screen
        .getByTestId(`card-chooser-tile-${C3.id}`)
        .getAttribute('data-picked'),
    ).toBeNull();
  });

  it('Done counter shows progress toward max', async () => {
    const user = userEvent.setup();
    render(
      <CardChooserList cards={cards} min={0} max={3} onSubmit={() => {}} />,
    );
    expect(screen.getByText(/done \(0/i)).toBeInTheDocument();
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    expect(screen.getByText(/done \(1/i)).toBeInTheDocument();
  });

  it('multi-pick Skip fires the onSkip handler', async () => {
    const onSkip = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList
        cards={cards}
        min={0}
        max={3}
        onSubmit={() => {}}
        onSkip={onSkip}
      />,
    );
    await user.click(screen.getByRole('button', { name: /skip/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});

describe('CardChooserList — ordered pick (post-scry ordering)', () => {
  it('shows numbered badges in pick order when ordered=true', async () => {
    const user = userEvent.setup();
    render(
      <CardChooserList
        cards={cards}
        min={3}
        max={3}
        ordered
        onSubmit={() => {}}
      />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    // badges 1 and 2 visible
    expect(screen.getAllByText('1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('Done submits the ordered list as selected', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList
        cards={cards}
        min={3}
        max={3}
        ordered
        onSubmit={onSubmit}
      />,
    );
    // Pick in 2-1-3 order
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C1.id}`));
    await user.click(screen.getByTestId(`card-chooser-tile-${C3.id}`));
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(onSubmit).toHaveBeenCalledWith([C2.id, C1.id, C3.id]);
  });
});

describe('CardChooserList — eligibility filter', () => {
  it('non-eligible cards render disabled', () => {
    render(
      <CardChooserList
        cards={cards}
        eligibleIds={[C1.id, C3.id]}
        min={1}
        max={1}
        onSubmit={() => {}}
      />,
    );
    expect(
      screen.getByTestId(`card-chooser-tile-${C2.id}`),
    ).toBeDisabled();
    expect(
      screen.getByTestId(`card-chooser-tile-${C1.id}`),
    ).not.toBeDisabled();
  });

  it('clicking a non-eligible card does not submit', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList
        cards={cards}
        eligibleIds={[C1.id]}
        min={1}
        max={1}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('empty eligibleIds is treated as "all eligible" (permissive)', async () => {
    // Slice 70-X.12 alignment: when the engine ships an empty
    // eligibleIds set, the prompt is permissive — any card click
    // proceeds and the engine validates server-side.
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <CardChooserList
        cards={cards}
        eligibleIds={[]}
        min={1}
        max={1}
        onSubmit={onSubmit}
      />,
    );
    await user.click(screen.getByTestId(`card-chooser-tile-${C2.id}`));
    expect(onSubmit).toHaveBeenCalledWith([C2.id]);
  });
});
