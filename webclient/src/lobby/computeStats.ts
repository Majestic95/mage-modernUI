/**
 * Slice L6 — compute lobby deck-preview stats from a list of resolved
 * cards + per-card counts. Pure function; takes a card-info cache as
 * input rather than fetching, so consumers can integrate fetching at
 * whatever layer makes sense for their lifecycle.
 *
 * <p>Inputs:
 * <ul>
 *   <li>{@code mainboard} — list of mainboard entries (cardName +
 *       amount). The deck's wire shape stores only identifiers; this
 *       function resolves CMC / types / mana symbols via the
 *       {@code cards} cache.</li>
 *   <li>{@code commander} — first sideboard entry (Commander format
 *       only). Used to derive color identity from its
 *       {@link WebCardInfo#colors} array. For non-Commander formats,
 *       pass {@code null}.</li>
 *   <li>{@code cards} — name → resolved {@link WebCardInfo} map. If
 *       a name is missing, that card is skipped (its absence won't
 *       crash; the curve / counts just skip its contribution).</li>
 * </ul>
 *
 * <p>Outputs match the {@link LobbyDeck} fixture shape so the lobby
 * components can render either fixture or live data interchangeably.
 */
import type { WebCardInfo, WebDeckCardInfo } from '../api/schemas';
import type { LobbyColor } from './fixtures';

const COLOR_LETTERS: LobbyColor[] = ['W', 'U', 'B', 'R', 'G'];

interface ComputeStatsInput {
  mainboard: WebDeckCardInfo[];
  commander: WebDeckCardInfo | null;
  cards: Map<string, WebCardInfo>;
}

export interface ComputedStats {
  mainboardSize: number;
  manaCurve: number[];
  typeCounts: {
    creatures: number;
    artifacts: number;
    enchantments: number;
    instantsAndSorceries: number;
  };
  colorPipCounts: Record<LobbyColor, number>;
  colorIdentity: LobbyColor[];
}

export function computeStats({
  mainboard,
  commander,
  cards,
}: ComputeStatsInput): ComputedStats {
  const manaCurve = new Array<number>(8).fill(0);
  const typeCounts = {
    creatures: 0,
    artifacts: 0,
    enchantments: 0,
    instantsAndSorceries: 0,
  };
  const colorPipCounts: Record<LobbyColor, number> = {
    W: 0,
    U: 0,
    B: 0,
    R: 0,
    G: 0,
  };
  let mainboardSize = 0;

  for (const entry of mainboard) {
    mainboardSize += entry.amount;
    const card = cards.get(entry.cardName);
    if (!card) continue;

    // Mana curve — bucket by manaValue (CMC). 0..6 are exact;
    // 7 holds "7+". Lands have manaValue 0 and land in bucket 0,
    // which matches MTGA's display convention (lands count as CMC 0).
    const cmcBucket = Math.min(7, Math.max(0, Math.floor(card.manaValue)));
    manaCurve[cmcBucket] = (manaCurve[cmcBucket] ?? 0) + entry.amount;

    // Type counts — primary-type-wins precedence so a card counts
    // exactly once. Order: Creature > Planeswalker > Instant >
    // Sorcery > Artifact > Enchantment > Land. We bucket
    // Planeswalkers with creatures (battle-line presence) and
    // Instant+Sorcery into one combined slot per the design doc.
    // Lands aren't in any bucket today; the four buckets in the
    // mockup are Creatures / Artifacts / Enchantments / I&S.
    const types = card.types ?? [];
    if (types.includes('Creature') || types.includes('Planeswalker')) {
      typeCounts.creatures += entry.amount;
    } else if (types.includes('Instant') || types.includes('Sorcery')) {
      typeCounts.instantsAndSorceries += entry.amount;
    } else if (types.includes('Artifact')) {
      typeCounts.artifacts += entry.amount;
    } else if (types.includes('Enchantment')) {
      typeCounts.enchantments += entry.amount;
    }
    // Lands and other types aren't surfaced in the four buckets —
    // intentional. The total card count is rendered separately.

    // Color pip counts — count {W}, {U}, {B}, {R}, {G} symbols
    // across the card's manaCosts array. Multiply by deck count.
    // {W/U}, {2/W} hybrid / phyrexian costs each contribute one pip
    // to whichever colors they include; we count each occurrence.
    for (const cost of card.manaCosts ?? []) {
      for (const c of COLOR_LETTERS) {
        if (cost.includes(c)) {
          colorPipCounts[c] += entry.amount;
        }
      }
    }
  }

  // Color identity — Commander format: from the commander's colors
  // array. Non-Commander: derive from any color with a pip in the
  // mainboard (locked decision O6).
  let colorIdentity: LobbyColor[];
  if (commander) {
    const commanderInfo = cards.get(commander.cardName);
    colorIdentity = commanderInfo
      ? COLOR_LETTERS.filter((c) => (commanderInfo.colors ?? []).includes(c))
      : [];
  } else {
    colorIdentity = COLOR_LETTERS.filter((c) => colorPipCounts[c] > 0);
  }

  return {
    mainboardSize,
    manaCurve,
    typeCounts,
    colorPipCounts,
    colorIdentity,
  };
}
