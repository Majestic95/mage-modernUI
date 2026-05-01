import {
  Buttons,
  Header,
  Message,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';
import { resolveTarget } from './targetResolver';

export function TargetDialog({ dialog, stream, clearDialog }: ContentProps) {
  const cards = Object.values(dialog.data.cardsView1);
  // gameTarget can ask for non-card targets and for cards from
  // sources cardsView1 doesn't include (end-of-turn discard, where
  // the eligible IDs are in targets[] but the actual card detail
  // lives on gameView.myHand). Walk targets[] and resolve each ID
  // against every place we might find display text:
  //   - players[] → "Player <name>"
  //   - myHand    → the WebCardView (card name + typeLine)
  //   - players[].battlefield permanents → permanent's card view
  //   - players[].graveyard / exile / sideboard → those WebCardViews
  // Anything still unresolved renders as a short-id-stamped row so
  // the user can at least click it and move on.
  const targetIds = dialog.data.targets;
  const gv = dialog.data.gameView;
  const resolvedTargets = cards.length > 0
    ? []
    : targetIds.map((id) => resolveTarget(id, gv));

  const submit = (id: string) => {
    stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
    clearDialog();
  };
  // Slice 70-X.4 — X close mirrors the existing Skip button when
  // targeting is optional (flag=false → server treats all-zeros UUID
  // as "skip" per upstream convention). Mandatory targets
  // (flag=true) get no X — the engine waits for a real selection.
  const skipTarget = !dialog.data.flag
    ? () => {
        stream?.sendPlayerResponse(
          dialog.messageId,
          'uuid',
          '00000000-0000-0000-0000-000000000000',
        );
        clearDialog();
      }
    : undefined;
  return (
    <>
      <Header title="Choose target" onClose={skipTarget} />
      <Message text={dialog.data.message} />
      {cards.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list">
          {cards.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => submit(c.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{c.name}</span>{' '}
                <span className="text-zinc-500 text-xs">{c.typeLine}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && resolvedTargets.length > 0 && (
        <ul className="space-y-1 max-h-64 overflow-y-auto" data-testid="target-list-resolved">
          {resolvedTargets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => submit(t.id)}
                className="w-full text-left px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-100 text-sm"
              >
                <span className="font-medium">{t.label}</span>
                {t.subtitle && (
                  <>
                    {' '}
                    <span className="text-zinc-500 text-xs">{t.subtitle}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {cards.length === 0 && resolvedTargets.length === 0 && (
        <p className="text-zinc-500 italic text-sm">
          {/* Slice 70-X.12 — pick the right "where to click" hint
              from the dialog message. "from your hand" / "in your
              hand" → click a card in your hand. Otherwise default
              to the battlefield. */}
          {/from\s+your\s+hand|in\s+your\s+hand/i.test(dialog.data.message)
            ? 'Click a card in your hand to choose.'
            : 'No legal targets — pick from the battlefield directly.'}
        </p>
      )}
      {!dialog.data.flag && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // gameTarget with flag=false (not required) — server
              // accepts an empty UUID as "skip" per upstream convention.
              stream?.sendPlayerResponse(dialog.messageId, 'uuid',
                '00000000-0000-0000-0000-000000000000');
              clearDialog();
            }}
          >
            Skip
          </SecondaryButton>
        </Buttons>
      )}
    </>
  );
}
