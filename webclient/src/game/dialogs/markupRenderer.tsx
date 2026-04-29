import type React from 'react';

/**
 * Render upstream's tiny HTML-flavored markup safely. Engine messages
 * carry {@code <font color=#XXXXXX>card name</font>} for highlights
 * (typically yellow on card names, red on damage) and {@code <br>}
 * for line breaks. Plain React text rendering would surface these as
 * literal markup in the UI.
 *
 * <p>We tokenize via regex and emit React nodes — no
 * {@code dangerouslySetInnerHTML}, so injected scripts or unknown
 * tags never reach the DOM. The font-color regex only accepts a
 * 3-or-6-char hex color, so a malicious upstream payload can't slip
 * arbitrary CSS into the {@code style} attribute.
 *
 * <p>Any tag we don't explicitly handle is stripped (rendered as the
 * empty string) so users never see raw markup. If upstream adds new
 * formatting, extend the parser rather than punting back to plain
 * text.
 */
export function renderUpstreamMarkup(text: string): React.ReactNode {
  const tokenRe =
    /<font\s+color=(#[0-9a-fA-F]{3,6})>([\s\S]*?)<\/font>|<br\s*\/?>|<[^>]+>/g;
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push(text.slice(lastIdx, match.index));
    }
    if (match[0].toLowerCase().startsWith('<br')) {
      parts.push(<br key={`br-${key++}`} />);
    } else if (match[0].toLowerCase().startsWith('<font')) {
      const color = match[1]!;
      const inner = match[2] ?? '';
      parts.push(
        <span key={`f-${key++}`} style={{ color }}>
          {renderUpstreamMarkup(inner)}
        </span>,
      );
    }
    // Any other tag (the third arm of the regex) is intentionally
    // dropped — strips out unhandled markup without leaking it.
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push(text.slice(lastIdx));
  }
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
