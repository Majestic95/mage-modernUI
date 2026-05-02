/**
 * Slice 70-Z (P2 audit) — extracted from PlayerFrame.tsx so the
 * 953-LOC file can be split into focused per-branch modules
 * (PlayerFrame.tsx legacy + PlayerFrameRedesigned.tsx) without
 * duplicating the two pure helpers between them.
 *
 * <p>Both functions are byte-preserved from the pre-split file at
 * lines 397-425 (formatColorIdentity) and 410-425 (colorWordFor).
 * No behavior change; the extraction is purely structural.
 */

/**
 * Slice 70-D — convert a colorIdentity array into an SR-friendly
 * suffix (UX-I3). Empty list returns null so the join can drop it;
 * otherwise produces "white, blue, black, green" in WUBRG order
 * (the wire format already arrives sorted).
 */
export function formatColorIdentity(colorIdentity: readonly string[]): string | null {
  if (colorIdentity.length === 0) {
    return null;
  }
  return colorIdentity.map(colorWordFor).join(', ');
}

export function colorWordFor(code: string): string {
  switch (code) {
    case 'W':
      return 'white';
    case 'U':
      return 'blue';
    case 'B':
      return 'black';
    case 'R':
      return 'red';
    case 'G':
      return 'green';
    default:
      return code;
  }
}
