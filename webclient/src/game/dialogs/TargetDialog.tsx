import {
  Buttons,
  Header,
  Message,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';
import { resolveTarget } from './targetResolver';
import { CardChooserList } from './CardChooserList';

export function TargetDialog({ dialog, stream, clearDialog }: ContentProps) {
  const cards = dialog.data.cardsView1;
  const hasCards = Object.keys(cards).length > 0;
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
  const resolvedTargets = !hasCards
    ? targetIds.map((id) => resolveTarget(id, gv))
    : [];

  const submitOne = (id: string) => {
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
      {/* Slice 70-X.14 — render cardsView1 as CardFace tiles via the
          shared CardChooserList primitive. min/max from the wire let
          single-pick (most target prompts) and multi-pick (rare in
          gameTarget but possible for "target up to N creatures" effects)
          share one surface. Eligibility = cardsView1 keys (already a
          pre-filtered legal set per upstream possibleTargets). */}
      {hasCards && (
        <CardChooserList
          cards={cards}
          min={Math.max(dialog.data.min, 1)}
          max={dialog.data.max > 0 ? dialog.data.max : 1}
          onSubmit={(ids) => {
            // gameTarget single-pick is the default; multi-pick falls
            // through here as sequential one-shots like SelectDialog.
            for (const id of ids) {
              stream?.sendPlayerResponse(dialog.messageId, 'uuid', id);
            }
            clearDialog();
          }}
          onSkip={skipTarget}
        />
      )}
      {!hasCards && resolvedTargets.length > 0 && (
        <ul
          className="space-y-1 max-h-64 overflow-y-auto"
          data-testid="target-list-resolved"
        >
          {resolvedTargets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => submitOne(t.id)}
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
      {!hasCards && resolvedTargets.length === 0 && (
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
      {!hasCards && !dialog.data.flag && (
        <Buttons>
          <SecondaryButton
            onClick={() => {
              // gameTarget with flag=false (not required) — server
              // accepts an empty UUID as "skip" per upstream convention.
              stream?.sendPlayerResponse(
                dialog.messageId,
                'uuid',
                '00000000-0000-0000-0000-000000000000',
              );
              clearDialog();
            }}
          >
            Skip
          </SecondaryButton>
        </Buttons>
      )}
      {/*
        Bug fix (2026-05-02) — defensive escape hatch for a mandatory
        gameTarget (flag=true) with NO legal targets in either
        cardsView1 or the resolvable targets list. Per CR 603.3c, a
        triggered ability with no legal target on resolution should
        be REMOVED automatically by the engine — but xmage's upstream
        engine occasionally fires the prompt anyway (most commonly
        Spell Queller's exiled-card-returns trigger after the
        creature is silenced before resolution). Without this button
        the user is stuck; the engine waits forever for a selection
        from an empty set.

        We send the all-zeros UUID and tear down the dialog locally.
        If upstream re-fires the same prompt, it remounts naturally
        on the next frame (no protocol divergence). The button is
        labeled "Forfeit (no legal targets)" to communicate that this
        is a stuck-state escape — not a normal cancel.

        Eligible only when:
          - dialog is mandatory (flag=true)
          - cardsView1 is empty (no card-shaped legal options)
          - resolvedTargets is empty (no player / synthetic targets)
        Otherwise the user has a legitimate choice they should make.
      */}
      {!hasCards &&
        resolvedTargets.length === 0 &&
        dialog.data.flag && (
          <Buttons>
            <SecondaryButton
              data-testid="target-forfeit"
              onClick={() => {
                stream?.sendPlayerResponse(
                  dialog.messageId,
                  'uuid',
                  '00000000-0000-0000-0000-000000000000',
                );
                clearDialog();
              }}
            >
              Forfeit (no legal targets)
            </SecondaryButton>
          </Buttons>
        )}
    </>
  );
}
