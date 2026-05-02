/**
 * Slice L1 — mana curve bar chart for the selected deck. Bucketed
 * 0..7+ (8 buckets total), each bucket colored by the WUBRG-ramp
 * the mockup uses. Pure SVG, no chart library.
 */
const BUCKET_COLORS = [
  'var(--color-mana-white)',
  'var(--color-mana-blue)',
  'var(--color-mana-black)',
  'var(--color-mana-red)',
  'var(--color-mana-green)',
  'var(--color-mana-multicolor)',
  'var(--color-mana-colorless)',
  'var(--color-text-muted)',
];

const BUCKET_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

interface Props {
  /** Length-8 array of card counts per CMC bucket. */
  curve: number[];
}

export function ManaCurveHistogram({ curve }: Props) {
  const safeCurve = ensureLength(curve, 8);
  const max = Math.max(1, ...safeCurve);

  const width = 240;
  const height = 78;
  const labelHeight = 12;
  const valueHeight = 14;
  const barAreaHeight = height - labelHeight - valueHeight;
  const barCount = safeCurve.length;
  const slotWidth = width / barCount;
  const barWidth = slotWidth - 6;

  return (
    <div className="flex flex-col items-start gap-1">
      <svg
        data-testid="mana-curve-histogram"
        width={width}
        height={height}
        role="img"
        aria-label="Mana curve histogram"
      >
        {safeCurve.map((value, i) => {
          const barHeight = (value / max) * barAreaHeight;
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const y = valueHeight + (barAreaHeight - barHeight);
          return (
            <g key={i}>
              <text
                x={i * slotWidth + slotWidth / 2}
                y={valueHeight - 2}
                textAnchor="middle"
                fontSize="11"
                fill="var(--color-text-secondary)"
              >
                {value}
              </text>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(2, barHeight)}
                fill={BUCKET_COLORS[i] ?? 'var(--color-text-muted)'}
                rx="2"
                opacity="0.85"
              />
              <text
                x={i * slotWidth + slotWidth / 2}
                y={height - 2}
                textAnchor="middle"
                fontSize="10"
                fill="var(--color-text-muted)"
              >
                {BUCKET_LABELS[i]}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function ensureLength(arr: number[], len: number): number[] {
  if (arr.length === len) return arr;
  if (arr.length > len) return arr.slice(0, len);
  return [...arr, ...new Array<number>(len - arr.length).fill(0)];
}
