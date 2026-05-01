import { Header, Message, type ContentProps } from './dialogPrimitives';
import { CardFace } from '../CardFace';

/**
 * Slice 70-X.14 Wave 3 — Fact or Fiction style pile-pick. Reveals the
 * two piles built by the OTHER player (or by the caster, depending on
 * the card; per the MTG rules expert validation pass: Fact or Fiction
 * has opponent split + caster pick, Steam Augury inverts). UI shows
 * both piles side-by-side; click a pile to commit.
 *
 * <p>Wire response: {@code playerResponse{kind:"boolean", value:true}}
 * for pile-1 (cardsView1), {@code false} for pile-2 (cardsView2).
 * Confirmed against {@code PickPileDialog.java:101} and
 * {@code HumanPlayer.choosePile():2587-2596} via the MTG rules
 * expert audit.
 *
 * <p>Empty piles permitted (CR 706.4 — splitting can produce 5/0).
 * Each pile renders with a placeholder when empty; both still clickable
 * since the engine accepts a "choose the empty pile" answer.
 *
 * <p>Mandatory dialog — no Skip / X-close. Engine waits for the answer.
 */
export function PilePickerDialog({
  dialog,
  stream,
  clearDialog,
}: ContentProps) {
  const pile1 = dialog.data.cardsView1 ?? {};
  const pile2 = dialog.data.cardsView2 ?? {};
  const pile1Cards = Object.values(pile1);
  const pile2Cards = Object.values(pile2);

  const pickPile = (isPile1: boolean) => {
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', isPile1);
    clearDialog();
  };

  return (
    <>
      <Header title="Choose a pile" />
      <Message text={dialog.data.message} />
      <div
        className="grid grid-cols-2 gap-3"
        data-testid="pile-picker-grid"
      >
        <PileColumn
          label="Pile 1"
          cards={pile1Cards}
          onPick={() => pickPile(true)}
          testid="pile-picker-pile1"
        />
        <PileColumn
          label="Pile 2"
          cards={pile2Cards}
          onPick={() => pickPile(false)}
          testid="pile-picker-pile2"
        />
      </div>
    </>
  );
}

function PileColumn({
  label,
  cards,
  onPick,
  testid,
}: {
  label: string;
  cards: ReadonlyArray<{ id: string; name: string }> & {
    map: <T>(fn: (card: { id: string; name: string }) => T) => T[];
  };
  onPick: () => void;
  testid: string;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      onClick={onPick}
      className="flex flex-col items-stretch gap-2 p-3 rounded border border-zinc-700 hover:border-fuchsia-500 hover:bg-zinc-800/60 transition cursor-pointer text-left"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-text-secondary">
          {label}
        </span>
        <span
          className="text-xs text-zinc-500"
          data-testid={`${testid}-count`}
        >
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
        </span>
      </div>
      {cards.length === 0 ? (
        <p className="text-xs italic text-zinc-500 px-2 py-4 text-center">
          (empty pile)
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {cards.map((c) => (
            <li
              key={c.id}
              data-testid={`${testid}-card-${c.id}`}
              className="pointer-events-none"
            >
              {/* CardFace expects WebCardView; cards from cardsView1/2
                  are already in that shape. The cast is safe — schema
                  validation upstream guarantees the shape. */}
              <CardFace
                card={c as unknown as Parameters<typeof CardFace>[0]['card']}
                size="hand"
              />
            </li>
          ))}
        </ul>
      )}
      <span className="text-center text-sm font-medium text-fuchsia-300">
        Click to choose this pile →
      </span>
    </button>
  );
}
