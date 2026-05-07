/**
 * Static metadata for known deck-format types. Keyed by the exact
 * deckType string the server returns in WebServerState.deckTypes
 * (the same string PreLobbyModal sends back in the create-table
 * POST). Unknown formats — including custom plugin formats and any
 * future upstream additions we haven't curated copy for — return
 * null and the info panel simply doesn't render.
 *
 * <p>Webclient-only by design (T4 of the Pauper roadmap). A future
 * slice can promote this to a wire field on WebDeckType if we want
 * server-controlled copy, but for static descriptions + canonical
 * banlist URLs the client is the right home — zero schema-bump
 * cost, simpler maintenance.
 *
 * <p>Format-name strings verified against upstream class constructors
 * in {@code Mage.Server.Plugins/Mage.Deck.Constructed/src/mage/deck/}
 * and {@code Mage.Server.Plugins/Mage.Deck.Limited/src/mage/deck/}.
 * Each entry's key is the literal name passed to {@code super(...)}
 * in the corresponding {@code DeckValidator} subclass.
 */
export interface FormatInfo {
  /** One-sentence description of the format's deck-construction rules. */
  description: string;
  /** Canonical banlist URL (Wizards.com / official source), or null if the format has no public banlist. */
  banlistUrl: string | null;
}

export const FORMAT_INFO: Readonly<Record<string, FormatInfo>> = {
  'Constructed - Pauper': {
    description:
      'Common-only constructed: any card printed at common rarity in any set, with a curated banlist maintained by Wizards. 60-card minimum.',
    banlistUrl: 'https://magic.wizards.com/en/formats/pauper',
  },
  'Constructed - Standard': {
    description:
      'Rotating constructed format using cards from the most recent Standard-legal sets. 60-card minimum, four-of limit.',
    banlistUrl: 'https://magic.wizards.com/en/formats/standard',
  },
  'Constructed - Pioneer': {
    description:
      'Non-rotating constructed format using cards printed in Return to Ravnica forward, minus the Pioneer banlist. 60-card minimum, four-of limit.',
    banlistUrl: 'https://magic.wizards.com/en/formats/pioneer',
  },
  'Constructed - Modern': {
    description:
      'Non-rotating constructed format using cards printed in Eighth Edition / Mirrodin forward, minus the Modern banlist. 60-card minimum, four-of limit.',
    banlistUrl: 'https://magic.wizards.com/en/formats/modern',
  },
  'Constructed - Legacy': {
    description:
      'Eternal constructed format: nearly every card ever printed is legal except for those on the Legacy banlist. 60-card minimum, four-of limit.',
    banlistUrl: 'https://magic.wizards.com/en/formats/legacy',
  },
  'Constructed - Vintage': {
    description:
      'Eternal constructed format with the deepest card pool — most cards are legal, with Power Nine and similar restricted to one-of. 60-card minimum.',
    banlistUrl: 'https://magic.wizards.com/en/formats/vintage',
  },
  Commander: {
    description:
      '100-card singleton format with a designated commander. 40 life total, commander damage rules, and the commander’s color identity restricts the rest of the deck.',
    banlistUrl: 'https://mtgcommander.net/index.php/banned-list/',
  },
  Limited: {
    description:
      'Sealed and draft formats: build your deck from a pool you opened or drafted at the table. 40-card minimum, no four-of limit, basic lands provided.',
    banlistUrl: null,
  },
};

export function getFormatInfo(deckType: string): FormatInfo | null {
  return FORMAT_INFO[deckType] ?? null;
}
