import type React from 'react';

/**
 * Render upstream's tiny HTML-flavored markup safely. Engine messages
 * carry {@code <font color='#XXXXXX' object_id='YY'>name</font>} for
 * highlights (player teal {@code #20B2AA}, card colors per
 * {@code mage.util.GameLog}: green {@code #90EE90}, red
 * {@code #FF6347}, blue {@code #87CEFA}, black {@code #696969},
 * white {@code #F0E68C}, multi {@code #DAA520}, colorless
 * {@code #B0C4DE}) and {@code <br>} for line breaks. Plain React text
 * rendering would surface these as literal markup in the UI.
 *
 * <p>2026-05-03 audit fix — the prior regex only accepted
 * unquoted {@code color=#XX} with NO trailing attributes, but the
 * engine emits {@code color='#XX' object_id='YY'} (single-quoted +
 * extra attribute). Every real font tag fell through to the
 * strip-unknown-tag arm; card colors and hover-wrap never fired.
 * Tests passed because fixtures used the bogus unquoted form. New
 * tokenizer accepts:
 * <ul>
 *   <li>quoted ({@code 'X'} or {@code "X"}) and unquoted color values</li>
 *   <li>any number of trailing attributes (currently {@code object_id})</li>
 *   <li>named colors ({@code White}, {@code Red}, ...) — {@code mage.util.GameLog} emits these for tooltips</li>
 * </ul>
 *
 * <p>The shared {@link tokenizeUpstreamMarkup} iterator is also
 * consumed by {@code GameLog.tsx renderLogMarkup} so a single
 * regex is the source of truth for both dialog and log rendering.
 *
 * <p>We tokenize via regex and emit React nodes — no
 * {@code dangerouslySetInnerHTML}, so injected scripts or unknown
 * tags never reach the DOM. {@link extractFontColor} validates the
 * color value before it lands in the {@code style} attribute, so
 * a malicious upstream payload can't slip arbitrary CSS in.
 *
 * <p>Any tag we don't explicitly handle is stripped (rendered as the
 * empty string) so users never see raw markup. If upstream adds new
 * formatting, extend the parser rather than punting back to plain
 * text.
 */
export function renderUpstreamMarkup(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;
  for (const token of tokenizeUpstreamMarkup(text)) {
    if (token.kind === 'text') {
      parts.push(token.text);
    } else if (token.kind === 'br') {
      parts.push(<br key={`br-${key++}`} />);
    } else {
      // font
      parts.push(
        <span
          key={`f-${key++}`}
          style={token.color ? { color: token.color } : undefined}
        >
          {renderUpstreamMarkup(token.inner)}
        </span>,
      );
    }
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/**
 * Token shape emitted by {@link tokenizeUpstreamMarkup}. Consumers
 * pattern-match on {@code kind} to render their own React nodes
 * (the dialog renderer uses plain colored spans; the game-log
 * renderer wraps font-tokens with hoverable card-detail when the
 * inner text resolves to a known card).
 */
export type MarkupToken =
  | { kind: 'text'; text: string }
  | { kind: 'br' }
  | {
      kind: 'font';
      /** Validated color value safe for inline {@code style.color}. */
      color: string | null;
      /** Raw inner text, may itself contain nested font / br tags. */
      inner: string;
      /** Engine card-id when the highlight came through {@code injectPopupSupport}. */
      objectId: string | null;
    };

/**
 * Walk an upstream-formatted message string and yield one
 * {@link MarkupToken} per parsed token. Untokenizable tags (the
 * residual {@code <[^>]+>} arm) are skipped silently — they never
 * surface as raw markup. Order is preserved: caller can concatenate
 * yielded text + nodes in iteration order to reconstruct the
 * message.
 *
 * <p>Tokenizer regex breakdown:
 * <ul>
 *   <li>{@code <font\b([^>]*)>([\s\S]*?)<\/font>} — font with
 *     attribute soup, captures attrs + inner. Lazy on the inner so
 *     nested fonts get the inner one matched first; the outer
 *     wrapper's open/close fall through to the strip arm. Acceptable
 *     because color information in the outer wrapper (e.g.
 *     {@code <font color='White'>...</font>}) is rarely meaningful
 *     for the webclient's purposes.</li>
 *   <li>{@code <br\s*\/?>} — break.</li>
 *   <li>{@code <[^>]+>} — any other tag, dropped.</li>
 * </ul>
 */
export function* tokenizeUpstreamMarkup(text: string): Generator<MarkupToken> {
  const tokenRe = /<font\b([^>]*)>([\s\S]*?)<\/font>|<br\s*\/?>|<[^>]+>/gi;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      yield { kind: 'text', text: text.slice(lastIdx, match.index) };
    }
    const literal = match[0];
    if (literal.length >= 3 && literal.toLowerCase().startsWith('<br')) {
      yield { kind: 'br' };
    } else if (
      literal.length >= 5 &&
      literal.toLowerCase().startsWith('<font')
    ) {
      const attrs = match[1] ?? '';
      const inner = match[2] ?? '';
      yield {
        kind: 'font',
        color: extractFontColor(attrs),
        inner,
        objectId: extractObjectId(attrs),
      };
    }
    // Any other tag is intentionally dropped — strips out unhandled
    // markup without leaking it.
    lastIdx = match.index + literal.length;
  }
  if (lastIdx < text.length) {
    yield { kind: 'text', text: text.slice(lastIdx) };
  }
}

/**
 * Pull the {@code color} attribute out of a font-tag attribute soup
 * and validate it. Returns the raw value when it matches a 3-or-6-
 * digit hex (with or without {@code #}) or a CSS named color
 * (alphanumeric); returns {@code null} otherwise. Values that don't
 * pass validation are dropped — they never reach a {@code style}
 * attribute, so a malicious payload can't smuggle CSS through
 * {@code color='red; background: url(...)'}.
 */
export function extractFontColor(attrs: string): string | null {
  const m = attrs.match(/\bcolor\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/i);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  if (!raw) return null;
  // Accept #RGB / #RRGGBB or a bare alphabetical name (whitelisted
  // by length + character class, not against an exhaustive list —
  // CSS rejects unknown names harmlessly so a stray engine value
  // just renders default-coloured).
  if (/^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$/.test(raw)) {
    return raw.startsWith('#') ? raw : `#${raw}`;
  }
  if (/^[A-Za-z]+$/.test(raw) && raw.length <= 24) {
    return raw;
  }
  return null;
}

/**
 * Extract the {@code object_id} attribute (engine's per-MageObject
 * UUID emitted on card highlights via {@code GameLog.
 * injectPopupSupport}). Cards always carry one; player-name
 * highlights never do. {@link CardSearchPanel}-style filters can
 * use the presence of {@code object_id} as a precise signal that a
 * font tag wraps a card name (vs a player name or a tooltip
 * decoration).
 */
export function extractObjectId(attrs: string): string | null {
  const m = attrs.match(/\bobject_id\s*=\s*(?:'([^']*)'|"([^"]*)"|([^\s>]+))/i);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
  return raw || null;
}
