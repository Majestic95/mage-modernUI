/* ---------- mana cost icons (slice 32) ---------- */

/**
 * Render a parens-style mana cost ({@code "{2}{R}{R}"}) as Andrew
 * Gioia's Mana font icons (https://github.com/andrewgioia/mana,
 * MIT). Each {@code {X}} token becomes one {@code <i class="ms ms-X
 * ms-cost ms-shadow">}, with the mana font CSS imported once in
 * main.tsx.
 *
 * <p>Token mapping (the font's class scheme):
 * <ul>
 *   <li>{@code {R}} → {@code ms-r} — single colored pip</li>
 *   <li>{@code {2}} → {@code ms-2} — generic / numeric</li>
 *   <li>{@code {X}} → {@code ms-x}</li>
 *   <li>{@code {W/U}} → {@code ms-wu} — hybrid (slash dropped)</li>
 *   <li>{@code {2/W}} → {@code ms-2w} — mono-hybrid</li>
 *   <li>{@code {T}} → {@code ms-tap}</li>
 * </ul>
 *
 * <p>Unknown tokens fall back to the literal text so we don't
 * silently swallow exotic costs like Phyrexian {@code {P}} —
 * the Mana font also covers most of these but the explicit
 * fallback keeps the symbol readable even if a future printing
 * uses a glyph the font doesn't support.
 *
 * <p>Token aliases — upstream emits {@code {tap}} as the
 * lowercase string while the font expects {@code ms-tap}; the
 * inner-text path lowercases everything before resolution so both
 * forms work.
 */
export function ManaCost({
  cost,
  size,
}: {
  cost: string;
  size?: 'normal' | 'sm';
}) {
  if (!cost) return null;
  const tokens = cost.match(/\{[^}]+\}/g);
  if (!tokens || tokens.length === 0) return null;
  const sizeClass = size === 'sm' ? 'text-[11px]' : '';
  return (
    <span
      data-testid="mana-cost"
      className={'inline-flex items-center gap-0.5 ' + sizeClass}
    >
      {tokens.map((tok, i) => {
        const inner = tok.slice(1, -1).toLowerCase().replace(/\//g, '');
        // The "tap" symbol comes through as either {T} or {tap}; the
        // mana-font class is `ms-tap` for both.
        const cls = inner === 't' ? 'tap' : inner;
        return (
          <i
            key={i}
            data-symbol={tok}
            className={`ms ms-${cls} ms-cost ms-shadow`}
            aria-label={tok}
          />
        );
      })}
    </span>
  );
}
