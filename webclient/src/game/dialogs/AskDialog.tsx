import { useEffect, useRef, useState } from 'react';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  SecondaryButton,
  type ContentProps,
} from './dialogPrimitives';
import { stickyAnswerKey, useGameStore } from '../store';

/**
 * Slice 70-Y / Wave 8 (2026-05-01) — yes/no with optional "remember"
 * sticky. The user can opt to auto-answer subsequent identical
 * prompts for the rest of the turn, or for the rest of the game.
 *
 * <p>Solves the Smothering Tithe / Rhystic Study / Esper Sentinel
 * playability problem: those triggers fire once per opponent action,
 * so a 4p game can stack a dozen "Pay 1?" prompts in a single turn
 * cycle. Sticky lets the user commit once and skim past the rest
 * without losing the modal-confirm muscle memory for ad-hoc decisions.
 *
 * <p>Mulligan dialogs are filtered out earlier in GameDialog (via
 * {@code isMulliganDialog}), so YesNoDialog never sees them — the
 * sticky toggle is rendered unconditionally for any gameAsk that
 * lands here.
 */
export function YesNoDialog({ dialog, stream, clearDialog }: ContentProps) {
  const stickyAnswers = useGameStore((s) => s.stickyAnswers);
  const setStickyAnswer = useGameStore((s) => s.setStickyAnswer);
  const key = stickyAnswerKey(dialog.method, dialog.data.message);
  const matched = stickyAnswers[key];

  // Auto-fire matched stickies. Track per-messageId so a second
  // dispatch attempt for the same prompt (StrictMode double-mount,
  // re-render storm) is a no-op. A new pendingDialog with the same
  // key but different messageId fires again, which is the intent.
  const dispatchedForRef = useRef<number | null>(null);
  useEffect(() => {
    if (!matched) return;
    if (dispatchedForRef.current === dialog.messageId) return;
    dispatchedForRef.current = dialog.messageId;
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', matched.answer);
    clearDialog();
  }, [matched, dialog.messageId, stream, clearDialog]);

  const [rememberScope, setRememberScope] = useState<'turn' | 'game' | null>(
    null,
  );

  const submit = (value: boolean) => {
    if (rememberScope) {
      setStickyAnswer(key, value, rememberScope);
    }
    stream?.sendPlayerResponse(dialog.messageId, 'boolean', value);
    clearDialog();
  };

  // Render nothing while the auto-fire effect resolves — clearDialog
  // unmounts us synchronously next render, so this is a one-frame
  // blank rather than a sustained empty modal.
  if (matched) return null;

  // Slice 17: upstream's options.UI.{left,right}.btn.text overrides
  // the default Yes/No labels. Mulligan loop populates these as
  // "Mulligan" / "Keep" (filtered upstream); Proliferate / Time Travel
  // use "Done"; any future spell with custom labels is automatic.
  const data = dialog.data as {
    options?: { leftBtnText?: string; rightBtnText?: string };
  };
  const opts = data.options ?? { leftBtnText: '', rightBtnText: '' };
  const yesLabel =
    opts.leftBtnText && opts.leftBtnText.length > 0 ? opts.leftBtnText : 'Yes';
  const noLabel =
    opts.rightBtnText && opts.rightBtnText.length > 0
      ? opts.rightBtnText
      : 'No';

  return (
    <>
      <Header
        title={dialog.method === 'gamePlayMana' ? 'Pay mana?' : 'Question'}
      />
      <Message text={dialog.data.message} />
      <StickyToggle
        scope={rememberScope}
        onChange={setRememberScope}
      />
      <Buttons>
        <PrimaryButton onClick={() => submit(true)}>{yesLabel}</PrimaryButton>
        <SecondaryButton onClick={() => submit(false)}>{noLabel}</SecondaryButton>
      </Buttons>
    </>
  );
}

/**
 * Slice 70-Y / Wave 8 — checkbox + select to opt the next answer
 * into the sticky table. {@code null} means "don't remember this
 * answer"; {@code 'turn'} clears at next turn change; {@code 'game'}
 * persists until reset().
 */
function StickyToggle({
  scope,
  onChange,
}: {
  scope: 'turn' | 'game' | null;
  onChange: (next: 'turn' | 'game' | null) => void;
}) {
  const enabled = scope !== null;
  return (
    <div
      className="flex items-center gap-2 text-xs text-zinc-400"
      data-testid="sticky-toggle"
    >
      <label className="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          data-testid="sticky-toggle-checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? 'turn' : null)}
          className="rounded border-zinc-600 bg-zinc-800 text-fuchsia-600 focus:ring-fuchsia-500"
        />
        Remember answer for
      </label>
      <select
        data-testid="sticky-toggle-scope"
        value={scope ?? 'turn'}
        disabled={!enabled}
        onChange={(e) => onChange(e.target.value as 'turn' | 'game')}
        className="rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-zinc-200 disabled:opacity-50"
      >
        <option value="turn">this turn</option>
        <option value="game">whole game</option>
      </select>
    </div>
  );
}
