/**
 * Slice E (2026-05-08) — extracted from PreLobbyModal.tsx so the
 * difficulty selector could land without pushing PreLobbyModal past
 * the 500-LOC hard cap. Behavior is identical to the original inline
 * AI section apart from the new difficulty dropdown.
 *
 * <p>State lives in PreLobbyModal (it's needed by handleSubmit); this
 * component is a controlled view of the AI seat count + AI type +
 * AI difficulty trio. The seat-count input + type/difficulty selectors
 * are gated together: the type + difficulty dropdowns only render
 * when {@code aiSeatCount > 0}, matching the slice-L4 behavior.
 */
import type { Dispatch, SetStateAction } from 'react';
import {
  AI_OPTIONS,
  AI_DIFFICULTIES,
  type AiTypeValue,
  type AiDifficultyValue,
} from './aiSelectionConstants';

interface Props {
  maxAiSeats: number;
  aiSeatCount: number;
  setAiSeatCount: Dispatch<SetStateAction<number>>;
  aiType: AiTypeValue;
  setAiType: Dispatch<SetStateAction<AiTypeValue>>;
  aiDifficulty: AiDifficultyValue;
  setAiDifficulty: Dispatch<SetStateAction<AiDifficultyValue>>;
}

const inputClass =
  'rounded-md border border-card-frame-default/80 bg-surface-card px-3 py-2 text-sm text-text-primary outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-focus-ring';

const labelClass = 'text-xs uppercase text-text-secondary';
const labelStyle = { letterSpacing: '0.08em' } as const;

export function PreLobbyAiSection({
  maxAiSeats,
  aiSeatCount,
  setAiSeatCount,
  aiType,
  setAiType,
  aiDifficulty,
  setAiDifficulty,
}: Props) {
  const clampedAiSeatCount = clamp(aiSeatCount, 0, maxAiSeats);
  const aiTypeHint = AI_OPTIONS.find((o) => o.value === aiType)?.hint;
  const aiDifficultyHint = AI_DIFFICULTIES.find(
    (o) => o.value === aiDifficulty,
  )?.hint;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass} style={labelStyle}>
          AI opponents (0–{maxAiSeats})
        </span>
        <input
          type="number"
          data-testid="pre-lobby-ai-seat-count"
          min={0}
          max={maxAiSeats}
          value={clampedAiSeatCount}
          onChange={(e) =>
            setAiSeatCount(
              clamp(parseInt(e.target.value, 10) || 0, 0, maxAiSeats),
            )
          }
          className={inputClass}
        />
      </label>
      <p className="text-xs text-text-secondary">
        {clampedAiSeatCount === 0
          ? `${maxAiSeats} open seat${maxAiSeats === 1 ? '' : 's'} for friends.`
          : clampedAiSeatCount === maxAiSeats
            ? `Solo vs ${maxAiSeats} AI opponent${maxAiSeats === 1 ? '' : 's'}.`
            : `${clampedAiSeatCount} AI + ${maxAiSeats - clampedAiSeatCount} open seat${maxAiSeats - clampedAiSeatCount === 1 ? '' : 's'} for friends.`}
      </p>
      {clampedAiSeatCount > 0 && (
        <>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="pre-lobby-ai-type"
              className={labelClass}
              style={labelStyle}
            >
              AI type
            </label>
            <select
              id="pre-lobby-ai-type"
              data-testid="pre-lobby-ai-type"
              value={aiType}
              onChange={(e) => setAiType(e.target.value as AiTypeValue)}
              className={inputClass}
            >
              {AI_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">{aiTypeHint}</p>
          </div>
          <div className="flex flex-col gap-1">
            <label
              htmlFor="pre-lobby-ai-difficulty"
              className={labelClass}
              style={labelStyle}
            >
              AI difficulty
            </label>
            <select
              id="pre-lobby-ai-difficulty"
              data-testid="pre-lobby-ai-difficulty"
              value={aiDifficulty}
              onChange={(e) =>
                setAiDifficulty(e.target.value as AiDifficultyValue)
              }
              className={inputClass}
            >
              {AI_DIFFICULTIES.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-secondary">{aiDifficultyHint}</p>
          </div>
        </>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}
