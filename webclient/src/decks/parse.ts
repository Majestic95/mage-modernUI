/**
 * Deck-list text parser. Accepts the standard "<count> <card name>"
 * format every MTG tool uses, plus the MTGA-style trailing
 * "(SET) NUM" annotation, plus sideboard sections.
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
  sideboard: ParsedEntry[];
  errors: string[];
}

/**
 * Section markers used by the major exporters (MTGA, MTGO,
 * Moxfield, Archidekt, Tappedout). Compared case-insensitively
 * against the trimmed line.
 */
const MAINBOARD_HEADERS = new Set([
  'deck',
  'mainboard',
  'main',
  'maindeck',
]);
const SIDEBOARD_HEADERS = new Set([
  'sideboard',
  'sb',
  'sideboard:',
]);

/**
 * Pure parser. Returns the recognized entries and a list of human-
 * readable error messages for lines that didn't fit the format.
 *
 * <p>Supported line shapes:
 * <ul>
 *   <li>{@code 4 Lightning Bolt} — count + name</li>
 *   <li>{@code 4x Forest} — optional case-insensitive {@code x}</li>
 *   <li>{@code 4 Lightning Bolt (M21) 162} — MTGA export; the
 *       trailing {@code (SET) NUM} is stripped from the resolved
 *       name (we resolve by name and let the server pick the
 *       printing).</li>
 *   <li>Section headers: {@code Deck}, {@code Mainboard},
 *       {@code Sideboard}, {@code SB:}, etc. (case-insensitive)</li>
 *   <li>Lines starting with {@code //} or {@code #} are comments</li>
 *   <li>An empty line after main entries flips parsing to the
 *       sideboard, mirroring MTGA's clipboard format. The flip
 *       happens at most once.</li>
 * </ul>
 *
 * <p>Hard limit: count must be in 1..99. Above that and the
 * server's deck-validator will reject anyway, so we fail early.
 */
export function parseDeckText(text: string): ParseResult {
  const main: ParsedEntry[] = [];
  const side: ParsedEntry[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);

  // null = haven't seen any cards yet; 'main' / 'side' = which
  // section the next valid entry lands in.
  let section: 'main' | 'side' = 'main';
  let blankFlipUsed = false;
  let lastNonBlankWasEntry = false;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const line = raw.trim();
    if (line === '') {
      // First blank line after we've seen ≥1 card and we're still
      // in main → flip to sideboard. Mirrors MTGA's clipboard
      // export which separates main / side with a blank line.
      if (
        !blankFlipUsed &&
        section === 'main' &&
        lastNonBlankWasEntry &&
        main.length > 0
      ) {
        section = 'side';
        blankFlipUsed = true;
      }
      lastNonBlankWasEntry = false;
      continue;
    }
    if (line.startsWith('//') || line.startsWith('#')) {
      lastNonBlankWasEntry = false;
      continue;
    }

    // Section header? Switch and skip.
    const lower = line.toLowerCase();
    if (MAINBOARD_HEADERS.has(lower)) {
      section = 'main';
      lastNonBlankWasEntry = false;
      continue;
    }
    if (SIDEBOARD_HEADERS.has(lower)) {
      section = 'side';
      blankFlipUsed = true; // explicit header trumps any later blank flip
      lastNonBlankWasEntry = false;
      continue;
    }
    // Inline "SB: 4 Lightning Bolt" prefix — common in MTGO export.
    let body = line;
    let forceSide = false;
    const sbMatch = /^SB:\s*(.+)$/i.exec(body);
    if (sbMatch && sbMatch[1]) {
      body = sbMatch[1].trim();
      forceSide = true;
    }

    const match = /^(\d+)\s*[xX]?\s+(.+?)\s*$/.exec(body);
    if (!match || !match[1] || !match[2]) {
      errors.push(`Line ${i + 1}: expected "<count> <card name>", got "${line}"`);
      lastNonBlankWasEntry = false;
      continue;
    }
    const count = Number(match[1]);
    if (!Number.isFinite(count) || count < 1 || count > 99) {
      errors.push(`Line ${i + 1}: count must be 1..99, got ${match[1]}`);
      lastNonBlankWasEntry = false;
      continue;
    }
    const cardName = stripMtgaSuffix(match[2].trim());
    if (cardName.length === 0) {
      errors.push(`Line ${i + 1}: card name is empty`);
      lastNonBlankWasEntry = false;
      continue;
    }
    const entry: ParsedEntry = { count, cardName };
    (forceSide || section === 'side' ? side : main).push(entry);
    lastNonBlankWasEntry = true;
  }

  return { cards: main, sideboard: side, errors };
}

/**
 * Strip the MTGA-style trailing annotation: a parenthesised set
 * code optionally followed by a collector number. Examples:
 * {@code "Lightning Bolt (M21) 162"} → {@code "Lightning Bolt"};
 * {@code "Forest (UNF)"} → {@code "Forest"}. Names without the
 * pattern pass through untouched.
 */
function stripMtgaSuffix(name: string): string {
  return name.replace(/\s*\([A-Z0-9]{2,5}\)\s*\S*\s*$/i, '').trim();
}

/** Total card count across all entries. */
export function totalCount(entries: ParsedEntry[]): number {
  return entries.reduce((sum, e) => sum + e.count, 0);
}
