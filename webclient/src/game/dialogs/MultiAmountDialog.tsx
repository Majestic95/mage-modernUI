import { useMemo, useState } from 'react';
import {
  Buttons,
  Header,
  Message,
  PrimaryButton,
  type ContentProps,
} from './dialogPrimitives';

/**
 * Slice 70-X.14 Wave 3 — distribute amount X across N labeled rows
 * with per-row min/max + total-sum constraints.
 *
 * <p>Use cases (per MTG rules expert validation):
 *
 * <ul>
 *   <li><b>Trample damage assignment</b> — N+1 rows (N blockers + the
 *     defending player). totalMin = sum-of-lethals (CR 702.19b
 *     enforced via total, not per-row); totalMax = damage. Each row's
 *     defaultValue = lethal-per-blocker (deathtouch → 1, CR 702.2c).</li>
 *   <li><b>Counter removal</b> — distribute removals across multiple
 *     permanents (Hex Parasite, Power Conduit).</li>
 *   <li><b>Mana allocation</b> — split mana across colors when the
 *     engine offers "any combination of {C}{U}{R}".</li>
 * </ul>
 *
 * <p>Inputs initialize to engine-supplied {@code defaultValue} per
 * row — without this, hitting Done on an unchanged form often produces
 * a sub-totalMin sum and re-prompts.
 *
 * <p>Wire response: {@code playerResponse{kind:"string", value:"3,2,1"}}
 * — comma-separated integers in row order.
 *
 * <p>First-strike / double-strike: per MTG rules validation, this
 * dialog can fire TWICE per double-strike trample (once per damage
 * step). The dialog's outer keying on {@code messageId} handles this
 * correctly (handled in {@code GameDialog} dispatcher); each prompt
 * is a fresh render with re-evaluated {@code defaultValue}s.
 */
export function MultiAmountDialog({
  dialog,
  stream,
  clearDialog,
}: ContentProps) {
  const info = dialog.data.multiAmount;

  // Initialize each input to the engine's defaultValue (lethal-per-
  // blocker for trample, etc). This is load-bearing for trample —
  // without it, sum starts below totalMin and Done is disabled.
  const [values, setValues] = useState<number[]>(() =>
    info ? info.rows.map((r) => r.defaultValue) : [],
  );

  const total = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);

  if (!info || info.rows.length === 0) {
    // Defensive — engine skips the prompt entirely when needCount===0
    // (HumanPlayer.java:2169-2174 per the rules-expert audit). If we
    // get here with empty rows, render an OK button that sends "" so
    // the engine isn't left waiting.
    const submit = () => {
      stream?.sendPlayerResponse(dialog.messageId, 'string', '');
      clearDialog();
    };
    return (
      <>
        <Header title="Distribute" />
        <Message text={dialog.data.message} />
        <Buttons>
          <PrimaryButton onClick={submit}>OK</PrimaryButton>
        </Buttons>
      </>
    );
  }

  const totalValid = total >= info.totalMin && total <= info.totalMax;
  const perRowValid = values.every(
    (v, i) => v >= info.rows[i].min && v <= info.rows[i].max,
  );
  const submittable = totalValid && perRowValid;

  const setRow = (i: number, v: number) => {
    setValues((prev) => {
      const next = [...prev];
      next[i] = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
      return next;
    });
  };

  const submit = () => {
    if (!submittable) return;
    stream?.sendPlayerResponse(
      dialog.messageId,
      'string',
      values.join(','),
    );
    clearDialog();
  };

  const title = info.title || 'Distribute';
  const headerText = info.header || dialog.data.message || '';

  return (
    <>
      <Header title={title} />
      {headerText && <Message text={headerText} />}
      <ul
        className="space-y-2 max-h-[50vh] overflow-y-auto"
        data-testid="multi-amount-rows"
      >
        {info.rows.map((row, i) => (
          <li
            key={i}
            data-testid={`multi-amount-row-${i}`}
            className="flex items-center gap-2"
          >
            <span className="flex-1 text-sm text-zinc-100">{row.label}</span>
            <span
              className="text-xs text-zinc-500 font-mono"
              data-testid={`multi-amount-row-${i}-bounds`}
            >
              {row.min}–{row.max}
            </span>
            <input
              type="number"
              min={row.min}
              max={row.max}
              value={values[i]}
              onChange={(e) => setRow(i, Number(e.target.value))}
              data-testid={`multi-amount-row-${i}-input`}
              className="w-20 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-100 font-mono text-sm focus:outline-none focus:border-fuchsia-500"
            />
          </li>
        ))}
      </ul>
      <div
        className="flex items-center justify-between border-t border-zinc-800 pt-3"
        data-testid="multi-amount-total"
      >
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          Total
        </span>
        <span
          className={
            'font-mono text-sm ' +
            (totalValid ? 'text-fuchsia-300' : 'text-amber-400')
          }
          data-testid="multi-amount-total-value"
        >
          {total} / {info.totalMin === info.totalMax
            ? info.totalMax
            : `${info.totalMin}–${info.totalMax}`}
        </span>
      </div>
      <Buttons>
        <PrimaryButton onClick={submit} disabled={!submittable}>
          Done
        </PrimaryButton>
      </Buttons>
    </>
  );
}
