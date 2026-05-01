import {
  Header,
  Message,
  type ContentProps,
} from './dialogPrimitives';
import { CardChooserList } from './CardChooserList';

/**
 * Slice 70-X.14 (Wave A item 1+2) — gameSelect / gameTarget over a
 * card collection (cardsView1). The engine fires this for:
 *
 * <ul>
 *   <li><b>Library search / tutor</b> — Demonic Tutor, Fierce Empath,
 *     Worldly Tutor (single-pick: min=max=1).</li>
 *   <li><b>Scry partition</b> — Ponder, Preordain, fetchland scry
 *     (multi-pick: min=0, max=N; selected = "to bottom of library").</li>
 *   <li><b>Surveil partition</b> — Thought Scour, Connive (multi-pick:
 *     min=0, max=N; selected = "to graveyard").</li>
 *   <li><b>Discard / reveal</b> — Cathartic Reunion, Faithless Looting
 *     (multi-pick).</li>
 *   <li><b>Look-then-arrange / order top N</b> — Brainstorm pickback,
 *     post-scry ordering (sequential pick: min=max=N, ordered).</li>
 * </ul>
 *
 * <p>Pre-Wave-A this was a stub that ignored {@code cardsView1}
 * entirely and rendered a paste-a-UUID input. See
 * [slice-70-X.14-engine-gaps.md] Bug 1 + Bug 5.
 *
 * <p>The min/max + message text drive the picker mode:
 *
 * <ul>
 *   <li>{@code min=max=1} → single-pick (click submits).</li>
 *   <li>{@code min &lt; max} → multi-pick (Done button).</li>
 *   <li>{@code min=max=N, N&gt;1} AND message says "in order" /
 *     "in any order" → sequential pick (numbered selection).</li>
 *   <li>Empty {@code cardsView1} → fall back to a hint message; the
 *     prompt is a board-target dialog routed by clickRouter.</li>
 * </ul>
 */
export function SelectDialog({ dialog, stream, clearDialog }: ContentProps) {
  const cards = dialog.data.cardsView1;
  const cardCount = Object.keys(cards).length;
  const eligibleIds = dialog.data.targets ?? [];

  const submit = (ids: string[]) => {
    if (!stream) {
      clearDialog();
      return;
    }
    if (ids.length === 1) {
      stream.sendPlayerResponse(dialog.messageId, 'uuid', ids[0]);
    } else {
      // Multi-pick / sequential: server expects a list of UUIDs in the
      // order picked (ordered=true) or any order (multi-pick). The
      // upstream HumanPlayer.choose(Outcome, Cards, ...) loop reads
      // each response one at a time; for simultaneous multi-pick we
      // submit the array and the server unpacks in order. The wire
      // contract is "uuid list" via the same kind:'uuid' channel —
      // the server-side handler accepts an array OR repeats the
      // single-uuid call. Today we wire it as a comma-joined string
      // since playerResponse kind:'uuid' is single-value; the
      // multi-pick path needs a server-side change to accept arrays
      // (slice 70-X.14 Wave A item 1 follow-up). For now, submit
      // each id sequentially.
      for (const id of ids) {
        stream.sendPlayerResponse(dialog.messageId, 'uuid', id);
      }
    }
    clearDialog();
  };

  // Skip handling: the engine accepts the all-zeros UUID as "skip" /
  // "done with no selection" per upstream convention (mirrors the
  // pattern in TargetDialog). Optional only when flag=false.
  const onSkip = !dialog.data.flag
    ? () => {
        stream?.sendPlayerResponse(
          dialog.messageId,
          'uuid',
          '00000000-0000-0000-0000-000000000000',
        );
        clearDialog();
      }
    : undefined;

  // Detect ordered-pick: engine fires the ordering follow-up after a
  // multi-card scry/surveil with messages like "in any order on top".
  // Default to ordered=true when min===max>1 — matches the engine's
  // sequential-call pattern for ordering effects (Brainstorm pickback,
  // scry-result ordering). Conservative; sequential-pick UI works fine
  // for unordered min=max=N too (just shows numbers, server ignores).
  const ordered = dialog.data.min === dialog.data.max && dialog.data.max > 1;

  // Mandatory dialog can still be closed by the user when it's a board-
  // target prompt with no card list — TargetDialog already handles those;
  // SelectDialog is only mounted by GameDialog when the dialog method is
  // gameSelect AND cardsView1 is non-empty. Per ADR 0008 §1.33 gameSelect
  // is "click on the board" semantics; if we get here with no cards, it's
  // an unexpected wire shape and we render a hint.
  if (cardCount === 0) {
    return (
      <>
        <Header title="Select" onClose={onSkip} />
        <Message text={dialog.data.message} />
        <p className="text-zinc-500 italic text-sm">
          Click an eligible target on the battlefield to choose.
        </p>
      </>
    );
  }

  return (
    <>
      <Header title="Choose" onClose={onSkip} />
      <Message text={dialog.data.message} />
      <CardChooserList
        cards={cards}
        eligibleIds={eligibleIds}
        min={dialog.data.min}
        max={dialog.data.max}
        ordered={ordered}
        onSubmit={submit}
        onSkip={onSkip}
      />
    </>
  );
}
