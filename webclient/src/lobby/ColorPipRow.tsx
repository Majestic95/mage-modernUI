/**
 * Slice L1 — small mana-color pip row used in deck list rows and
 * deck-preview color identity. Single-color pip is a circle; we
 * don't render the mana-font glyphs here so the component has no
 * font dependency.
 */
import type { LobbyColor } from './fixtures';

const COLOR_TOKEN: Record<LobbyColor, string> = {
  W: 'var(--color-mana-white)',
  U: 'var(--color-mana-blue)',
  B: 'var(--color-mana-black)',
  R: 'var(--color-mana-red)',
  G: 'var(--color-mana-green)',
};

const SIZE_PX = { sm: 12, md: 16, lg: 22 } as const;

export function ColorPipRow({
  colors,
  size = 'md',
}: {
  colors: LobbyColor[];
  size?: keyof typeof SIZE_PX;
}) {
  if (colors.length === 0) {
    return (
      <div
        data-testid="color-pip-colorless"
        className="h-3 w-3 flex-shrink-0 rounded-full border"
        style={{
          background: 'var(--color-mana-colorless)',
          borderColor: 'var(--color-mana-colorless)',
          width: SIZE_PX[size],
          height: SIZE_PX[size],
        }}
      />
    );
  }
  return (
    <div data-testid="color-pip-row" className="flex items-center gap-0.5">
      {colors.map((c) => (
        <div
          key={c}
          data-testid={`color-pip-${c}`}
          className="rounded-full"
          style={{
            background: COLOR_TOKEN[c],
            width: SIZE_PX[size],
            height: SIZE_PX[size],
            boxShadow: '0 0 4px rgba(0,0,0,0.4) inset',
          }}
        />
      ))}
    </div>
  );
}
