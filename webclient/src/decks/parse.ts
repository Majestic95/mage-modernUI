/**
 * Deck-list text parser. Accepts the standard "<count> <card name>"
 * format every MTG tool uses; comments and empty lines are skipped.
 *
 * <p>Sideboard parsing is not implemented — every entry goes to the
 * mainboard for now. Slice 4.4 ships mainboard only.
 *
 * <p>Card-name resolution against the WebApi happens in a separate
 * step ({@code resolveDeck} in this module) so the parser stays a
 * pure function — easy to test, no I/O.
 */

export interface ParsedEntry {
  /** 1..99, parsed from the leading number. */
  count: number;
  /** Raw card name, trimmed. May or may not match a real card. */
  cardName: string;
}

export interface ParseResult {
  cards: ParsedEntry[];
  errors: string[];
}

/**
 * Pure parser. Returns the recognized entries and a list of human-
 * readable error messages for lines that didn't fit the format.
 *
 * <p>Format:
 * <ul>
 *   <li>{@code 4 Lightning Bolt}</li>
 *   <li>{@code 4x Forest} (the {@code x} is optional, case-insensitive)</li>
 *   <li>Lines starting with {@code //} or {@code #} are comments</li>
 *   <li>Empty lines are skipped</li>
 * </ul>
 */
export function parseDeckText(text: string): ParseResult {
  const cards: ParsedEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;

    const match = /^(\d+)\s*[xX]?\s+(.+?)\s*$/.exec(line);
    if (!match || !match[1] || !match[2]) {
      errors.push(`Line ${i + 1}: expected "<count> <card name>", got "${line}"`);
      continue;
    }
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count < 1 || count > 99) {
      errors.push(`Line ${i + 1}: count must be 1..99, got ${match[1]}`);
      continue;
    }
    const cardName = match[2].trim();
    if (cardName.length === 0) {
      errors.push(`Line ${i + 1}: card name is empty`);
      continue;
    }
    cards.push({ count, cardName });
  }

  return { cards, errors };
}

/** Total card count across all entries. */
export function totalCount(entries: ParsedEntry[]): number {
  return entries.reduce((sum, e) => sum + e.count, 0);
}
